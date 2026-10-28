'use strict';

const { Transaccion, Cuenta, sequelize } = require('../models');
const { bloquearRegistros } = require('../utils/bloqueos');

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
    const cuentas = await bloquearRegistros(Cuenta, [cuenta_id], t);
    const cuenta = cuentas.get(Number(cuenta_id));
    if (!cuenta) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }
    const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
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

const update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const egreso = await Transaccion.findOne({
      where: { id: req.params.id, tipo: 'egreso', referencia_tipo: 'manual' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!egreso) {
      await t.rollback();
      return res.status(404).json({ error: 'Egreso no encontrado' });
    }

    const { descripcion, monto, fecha, cuenta_id } = req.body;

    const nuevoMonto    = monto     != null ? parseFloat(monto)    : parseFloat(egreso.monto);
    const nuevaCuentaId = cuenta_id != null ? parseInt(cuenta_id)  : egreso.cuenta_id;
    const mismasCuenta  = nuevaCuentaId === egreso.cuenta_id;
    const cuentas = await bloquearRegistros(Cuenta, [egreso.cuenta_id, nuevaCuentaId], t);
    const cuentaDestino = cuentas.get(nuevaCuentaId);
    if (!cuentaDestino) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta seleccionada no encontrada' });
    }

    if (mismasCuenta) {
      // El egreso ya está restado: disponible real = saldo_actual + monto_anterior
      const { saldo_actual } = await Cuenta.calcularSaldo(nuevaCuentaId, sequelize, t);
      const disponible = saldo_actual + parseFloat(egreso.monto);
      if (nuevoMonto > disponible) {
        await t.rollback();
        return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${disponible.toFixed(2)}` });
      }
    } else {
      // Cuenta distinta: verificar que la nueva cuenta tenga saldo suficiente
      const { saldo_actual } = await Cuenta.calcularSaldo(nuevaCuentaId, sequelize, t);
      if (nuevoMonto > saldo_actual) {
        await t.rollback();
        return res.status(422).json({ error: `Saldo insuficiente en la cuenta seleccionada. Disponible: $${saldo_actual.toFixed(2)}` });
      }
    }

    await egreso.update(
      {
        descripcion,
        monto:     nuevoMonto,
        fecha:     fecha != null ? fecha : egreso.fecha,
        cuenta_id: nuevaCuentaId,
      },
      { transaction: t }
    );
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
