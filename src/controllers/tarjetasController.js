'use strict';

const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, Cuenta, sequelize } = db;
const { bloquearRegistros } = require('../utils/bloqueos');
const { calcularSaldosTarjeta } = require('../utils/saldosTarjeta');

const index = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const { count, rows } = await Tarjeta.findAndCountAll({
      limit, offset, order: [['created_at', 'DESC']],
      include: [{ model: Cuenta, as: 'cuenta_pago', attributes: ['id', 'nombre', 'tipo'], required: false }],
    });

    const data = await Promise.all(rows.map(async (t) => ({
      ...t.toJSON(),
      ...(await calcularSaldosTarjeta(sequelize, t.id)),
    })));

    res.json({ data, total: count, page, limit, totalPages: Math.ceil(count / limit) });
  } catch (err) { next(err); }
};

const store = async (req, res, next) => {
  try {
    const { nombre, banco, limite_credito, dia_corte, dia_pago, cuenta_pago_id } = req.body;
    const tarjeta = await Tarjeta.create({
      nombre, banco, limite_credito, dia_corte, dia_pago,
      cuenta_pago_id: cuenta_pago_id ? parseInt(cuenta_pago_id) : null,
    });
    res.status(201).json(tarjeta);
  } catch (err) { next(err); }
};

const show = async (req, res, next) => {
  try {
    const tarjeta = await Tarjeta.findByPk(req.params.id, {
      include: [{ model: Cuenta, as: 'cuenta_pago', attributes: ['id', 'nombre', 'tipo'], required: false }],
    });
    if (!tarjeta) return res.status(404).json({ error: 'Tarjeta no encontrada' });

    const saldos = await calcularSaldosTarjeta(sequelize, tarjeta.id);

    const compras_normales = await CompraNormal.findAll({
      where: { tarjeta_id: tarjeta.id },
      order: [['fecha_compra', 'DESC']],
    });

    const compras_tasa_cero = await CompraTasaCero.findAll({
      where: { tarjeta_id: tarjeta.id },
      include: [{ model: CuotaMensual, as: 'cuotas', order: [['numero_cuota', 'ASC']] }],
      order: [['fecha_compra', 'DESC']],
    });

    res.json({ tarjeta, saldos, compras_normales, compras_tasa_cero });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const tarjetas = await bloquearRegistros(Tarjeta, [req.params.id], t);
    const tarjeta = tarjetas.get(Number(req.params.id));
    if (!tarjeta) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }

    const { nombre, banco, limite_credito, dia_corte, dia_pago, cuenta_pago_id } = req.body;
    const saldos = await calcularSaldosTarjeta(sequelize, tarjeta.id, t);
    const nuevoLimite = limite_credito !== undefined ? Number(limite_credito) : parseFloat(tarjeta.limite_credito);
    if (!Number.isFinite(nuevoLimite) || nuevoLimite < saldos.saldo_gastado) {
      await t.rollback();
      return res.status(422).json({ error: `El límite no puede ser menor que el saldo utilizado ($${saldos.saldo_gastado.toFixed(2)}).` });
    }
    await tarjeta.update({
      nombre: nombre ?? tarjeta.nombre,
      banco: banco ?? tarjeta.banco,
      limite_credito: nuevoLimite,
      dia_corte: dia_corte ?? tarjeta.dia_corte,
      dia_pago: dia_pago ?? tarjeta.dia_pago,
      cuenta_pago_id: cuenta_pago_id !== undefined
        ? (cuenta_pago_id ? parseInt(cuenta_pago_id) : null)
        : tarjeta.cuenta_pago_id,
    }, { transaction: t });
    await t.commit();
    res.json(tarjeta);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const tarjetas = await bloquearRegistros(Tarjeta, [req.params.id], t);
    const tarjeta = tarjetas.get(Number(req.params.id));
    if (!tarjeta) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }

    const comprasNormales = await CompraNormal.count({ where: { tarjeta_id: tarjeta.id }, transaction: t });
    const comprasTasaCero = await CompraTasaCero.count({ where: { tarjeta_id: tarjeta.id }, transaction: t });
    if (comprasNormales || comprasTasaCero) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede eliminar una tarjeta con compras registradas.' });
    }

    await tarjeta.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) {
    await t.rollback();
    if (err.message?.startsWith('No se puede eliminar')) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
};

module.exports = { index, store, show, update, destroy };
