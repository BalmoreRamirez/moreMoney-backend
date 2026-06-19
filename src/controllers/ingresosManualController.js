'use strict';

const { Transaccion, Cuenta } = require('../models');

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
  try {
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    if (!cuenta_id || !monto || !descripcion || !fecha) {
      return res.status(422).json({ error: 'Todos los campos son requeridos.' });
    }
    const ingreso = await Transaccion.create({
      cuenta_id:       parseInt(cuenta_id),
      tipo:            'ingreso',
      monto:           parseFloat(monto),
      descripcion,
      fecha,
      referencia_tipo: 'manual',
      referencia_id:   null,
    });
    const result = await Transaccion.findByPk(ingreso.id, {
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
};

const update = async (req, res, next) => {
  try {
    const ingreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'ingreso', referencia_tipo: 'manual' },
    });
    if (!ingreso) return res.status(404).json({ error: 'Ingreso no encontrado' });
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    await ingreso.update({ cuenta_id: parseInt(cuenta_id), monto: parseFloat(monto), descripcion, fecha });
    const result = await Transaccion.findByPk(ingreso.id, {
      include: [{ model: Cuenta, as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] }],
    });
    res.json(result);
  } catch (e) { next(e); }
};

const destroy = async (req, res, next) => {
  try {
    const ingreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'ingreso', referencia_tipo: 'manual' },
    });
    if (!ingreso) return res.status(404).json({ error: 'Ingreso no encontrado' });
    await ingreso.destroy();
    res.status(204).end();
  } catch (e) { next(e); }
};

module.exports = { index, store, update, destroy };
