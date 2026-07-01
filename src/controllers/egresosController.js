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
  const t = await sequelize.transaction();
  try {
    const { cuenta_id, monto, descripcion, fecha } = req.body;
    const { saldo_actual } = await Cuenta.calcularSaldo(parseInt(cuenta_id), sequelize);
    if (parseFloat(monto) > saldo_actual) {
      await t.rollback();
      return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${saldo_actual.toFixed(2)}` });
    }
    const egreso = await Transaccion.create(
      {
        cuenta_id:       parseInt(cuenta_id),
        tipo:            'egreso',
        monto:           parseFloat(monto),
        descripcion,
        fecha,
        referencia_tipo: 'manual',
        referencia_id:   null,
        usuario_id:      req.usuario?.id || null,
      },
      { transaction: t }
    );
    await t.commit();
    res.status(201).json(egreso);
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

// C3: Solo se permite editar la descripcion. Monto, cuenta y fecha son inmutables
// para preservar la integridad del historial de saldos.
const update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const egreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'egreso', referencia_tipo: 'manual' },
    });
    if (!egreso) {
      await t.rollback();
      return res.status(404).json({ error: 'Egreso no encontrado' });
    }

    const { descripcion } = req.body;
    await egreso.update({ descripcion }, { transaction: t });
    await t.commit();
    res.json(egreso);
  } catch (e) {
    await t.rollback();
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
