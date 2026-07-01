'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, Cuenta, sequelize } = db;

async function calcularSaldos(tarjetaId) {
  const [[row]] = await sequelize.query(
    `SELECT
       t.limite_credito,
       COALESCE((
         SELECT SUM(cn.monto) FROM compras_normales cn
         WHERE cn.tarjeta_id = :id AND cn.estado = 'pendiente'
       ), 0) AS sum_normales,
       COALESCE((
         SELECT SUM(ctc.monto_total) FROM compras_tasa_cero ctc
         WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa'
       ), 0) AS sum_tasa_cero,
       COALESCE((
         SELECT SUM(cm.monto_cuota) FROM cuotas_mensuales cm
         INNER JOIN compras_tasa_cero ctc ON cm.tasa_cero_id = ctc.id
         WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa' AND cm.estado = 'pagada'
       ), 0) AS sum_cuotas_pagadas
     FROM tarjetas t WHERE t.id = :id`,
    { replacements: { id: tarjetaId } }
  );

  const limite = parseFloat(row.limite_credito);
  const gastado = parseFloat(row.sum_normales) + parseFloat(row.sum_tasa_cero) - parseFloat(row.sum_cuotas_pagadas);
  return {
    limite_credito: limite,
    saldo_gastado: Math.max(0, gastado),
    saldo_disponible: limite - Math.max(0, gastado),
  };
}

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
      ...(await calcularSaldos(t.id)),
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

    const saldos = await calcularSaldos(tarjeta.id);

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
  try {
    const tarjeta = await Tarjeta.findByPk(req.params.id);
    if (!tarjeta) return res.status(404).json({ error: 'Tarjeta no encontrada' });

    const { nombre, banco, limite_credito, dia_corte, dia_pago, cuenta_pago_id } = req.body;
    await tarjeta.update({
      nombre, banco, limite_credito, dia_corte, dia_pago,
      cuenta_pago_id: cuenta_pago_id !== undefined
        ? (cuenta_pago_id ? parseInt(cuenta_pago_id) : null)
        : tarjeta.cuenta_pago_id,
    });
    res.json(tarjeta);
  } catch (err) { next(err); }
};

const destroy = async (req, res, next) => {
  try {
    const tarjeta = await Tarjeta.findByPk(req.params.id);
    if (!tarjeta) return res.status(404).json({ error: 'Tarjeta no encontrada' });

    await tarjeta.destroy();
    res.status(204).send();
  } catch (err) {
    // El hook beforeDestroy lanza un Error con el mensaje de negocio
    res.status(422).json({ error: err.message });
  }
};

module.exports = { index, store, show, update, destroy };
