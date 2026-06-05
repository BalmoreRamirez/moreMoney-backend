'use strict';

const { Transaccion, Cuenta, sequelize } = require('../models');

const index = async (req, res, next) => {
  try {
    const egresos = await Transaccion.findAll({
      where: { tipo: 'egreso', referencia_tipo: 'manual' },
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
      order: [['fecha', 'DESC'], ['created_at', 'DESC']],
    });
    res.json(egresos);
  } catch (e) {
    next(e);
  }
};

const store = async (req, res, next) => {
  try {
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    const { saldo_actual } = await Cuenta.calcularSaldo(parseInt(cuenta_id), sequelize);
    if (parseFloat(monto) > saldo_actual) {
      return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${saldo_actual.toFixed(2)}` });
    }
    const egreso = await Transaccion.create({
      cuenta_id:      parseInt(cuenta_id),
      tipo:           'egreso',
      monto:          parseFloat(monto),
      descripcion,
      fecha,
      referencia_tipo: 'manual',
      referencia_id:   null,
    });
    res.status(201).json(egreso);
  } catch (e) {
    next(e);
  }
};

const update = async (req, res, next) => {
  try {
    const egreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'egreso', referencia_tipo: 'manual' },
    });
    if (!egreso) return res.status(404).json({ error: 'Egreso no encontrado' });
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    const { saldo_actual } = await Cuenta.calcularSaldo(parseInt(cuenta_id), sequelize);
    if (parseFloat(monto) > saldo_actual + parseFloat(egreso.monto)) {
      return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${(saldo_actual + parseFloat(egreso.monto)).toFixed(2)}` });
    }
    await egreso.update({
      cuenta_id: parseInt(cuenta_id),
      monto:     parseFloat(monto),
      descripcion,
      fecha,
    });
    res.json(egreso);
  } catch (e) {
    next(e);
  }
};

const destroy = async (req, res, next) => {
  try {
    const egreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'egreso', referencia_tipo: 'manual' },
    });
    if (!egreso) return res.status(404).json({ error: 'Egreso no encontrado' });
    await egreso.destroy();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};

module.exports = { index, store, update, destroy };
