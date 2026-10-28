'use strict';

const { Transaccion, Cuenta, sequelize } = require('../models');
const { bloquearRegistros } = require('../utils/bloqueos');

const index = async (req, res, next) => {
  try {
    const ingresos = await Transaccion.findAll({
      where: { tipo: 'ingreso', referencia_tipo: 'manual' },
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
      order: [['fecha', 'DESC'], ['created_at', 'DESC']],
    });
    res.json(ingresos);
  } catch (e) { next(e); }
};

const store = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    if (!cuenta_id || !monto || !descripcion || !fecha) {
      await t.rollback();
      return res.status(422).json({ error: 'Todos los campos son requeridos.' });
    }
    const cuentas = await bloquearRegistros(Cuenta, [cuenta_id], t);
    const cuenta = cuentas.get(Number(cuenta_id));
    if (!cuenta) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }
    const ingreso = await Transaccion.create({
      cuenta_id:       cuenta.id,
      tipo:            'ingreso',
      monto:           parseFloat(monto),
      descripcion,
      fecha,
      referencia_tipo: 'manual',
      referencia_id:   null,
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });
    await t.commit();
    const result = await Transaccion.findByPk(ingreso.id, {
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
    });
    res.status(201).json(result);
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

const update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const ingreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'ingreso', referencia_tipo: 'manual' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!ingreso) {
      await t.rollback();
      return res.status(404).json({ error: 'Ingreso no encontrado' });
    }
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    const nuevaCuentaId = cuenta_id != null ? Number(cuenta_id) : ingreso.cuenta_id;
    const nuevoMonto = monto != null ? Number(monto) : parseFloat(ingreso.monto);
    if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El monto debe ser mayor que cero.' });
    }
    const cuentas = await bloquearRegistros(Cuenta, [ingreso.cuenta_id, nuevaCuentaId], t);
    if (!cuentas.has(nuevaCuentaId)) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta seleccionada no encontrada' });
    }
    const saldoAnterior = (await Cuenta.calcularSaldo(ingreso.cuenta_id, sequelize, t)).saldo_actual;
    const saldoProyectadoAnterior = saldoAnterior - parseFloat(ingreso.monto);
    if (nuevaCuentaId !== ingreso.cuenta_id && saldoProyectadoAnterior < -0.001) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede mover el ingreso: la cuenta original no conserva ese monto.' });
    }
    if (nuevaCuentaId === ingreso.cuenta_id && nuevoMonto < parseFloat(ingreso.monto)
      && saldoAnterior - parseFloat(ingreso.monto) + nuevoMonto < -0.001) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede reducir el ingreso: la cuenta no conserva ese monto.' });
    }
    await ingreso.update({
      cuenta_id: nuevaCuentaId,
      monto: nuevoMonto,
      descripcion: descripcion ?? ingreso.descripcion,
      fecha: fecha ?? ingreso.fecha,
    }, { transaction: t });
    await t.commit();
    const result = await Transaccion.findByPk(ingreso.id, {
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
    });
    res.json(result);
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

const destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const ingreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'ingreso', referencia_tipo: 'manual' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!ingreso) {
      await t.rollback();
      return res.status(404).json({ error: 'Ingreso no encontrado' });
    }
    const cuentas = await bloquearRegistros(Cuenta, [ingreso.cuenta_id], t);
    const cuenta = cuentas.get(Number(ingreso.cuenta_id));
    const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
    if (parseFloat(ingreso.monto) > saldo_actual) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede eliminar el ingreso: la cuenta no conserva ese monto.' });
    }
    await ingreso.destroy({ transaction: t });
    await t.commit();
    res.status(204).end();
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

module.exports = { index, store, update, destroy };
