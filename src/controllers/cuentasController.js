'use strict';

const db = require('../models');
const { Cuenta, Transaccion, sequelize } = db;

// GET /api/cuentas/stats?year=YYYY&month=MM
const dashboardStats = async (req, res, next) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const cuentas = await Cuenta.findAll({ order: [['created_at', 'ASC']] });
    const saldos  = await Promise.all(cuentas.map(c => Cuenta.calcularSaldo(c.id, sequelize)));
    const saldo_total_cuentas = parseFloat(saldos.reduce((s, c) => s + c.saldo_actual, 0).toFixed(2));

    const [[capitalRow]] = await sequelize.query(
      `SELECT COALESCE(SUM(capital), 0) AS capital_en_calle FROM prestamos WHERE estado = 'activo'`,
    );
    const capital_en_calle = parseFloat(capitalRow.capital_en_calle);

    const [[flujoRow]] = await sequelize.query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto ELSE 0 END), 0) AS egresos
       FROM transacciones
       WHERE EXTRACT(YEAR FROM fecha) = :year AND EXTRACT(MONTH FROM fecha) = :month`,
      { replacements: { year, month } },
    );
    const ingresos = parseFloat(flujoRow.ingresos);
    const egresos  = parseFloat(flujoRow.egresos);

    res.json({
      saldo_total_cuentas,
      capital_en_calle,
      flujo_mes: { ingresos, egresos, neto: parseFloat((ingresos - egresos).toFixed(2)) },
    });
  } catch (err) { next(err); }
};

// Saldo dinámico de una cuenta
async function saldoCuenta(cuentaId) {
  return Cuenta.calcularSaldo(cuentaId, sequelize);
}

// GET /api/cuentas
const index = async (req, res, next) => {
  try {
    const cuentas = await Cuenta.findAll({ order: [['created_at', 'ASC']] });

    const data = await Promise.all(
      cuentas.map(async (c) => ({
        ...c.toJSON(),
        ...(await saldoCuenta(c.id)),
      }))
    );

    const saldo_total = data.reduce((s, c) => s + c.saldo_actual, 0);
    res.json({ data, saldo_total });
  } catch (err) { next(err); }
};

// POST /api/cuentas
const store = async (req, res, next) => {
  try {
    const { nombre, tipo, saldo_inicial } = req.body;
    const cuenta = await Cuenta.create({ nombre, tipo, saldo_inicial: saldo_inicial ?? 0 });
    res.status(201).json({ ...cuenta.toJSON(), ...(await saldoCuenta(cuenta.id)) });
  } catch (err) { next(err); }
};

// PUT /api/cuentas/:id
const update = async (req, res, next) => {
  try {
    const cuenta = await Cuenta.findByPk(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const { nombre, tipo, saldo_inicial } = req.body;
    await cuenta.update({ nombre, tipo, saldo_inicial });
    res.json({ ...cuenta.toJSON(), ...(await saldoCuenta(cuenta.id)) });
  } catch (err) { next(err); }
};

// DELETE /api/cuentas/:id
const destroy = async (req, res, next) => {
  try {
    const cuenta = await Cuenta.findByPk(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
    await cuenta.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
};

// GET /api/cuentas/:id/transacciones
const transacciones = async (req, res, next) => {
  try {
    const { tipo, fecha_desde, fecha_hasta, page: pageRaw } = req.query;
    const page  = Math.max(1, parseInt(pageRaw) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const where = { cuenta_id: req.params.id };
    if (tipo)        where.tipo  = tipo;
    if (fecha_desde) where.fecha = { ...where.fecha, [db.Sequelize.Op.gte]: fecha_desde };
    if (fecha_hasta) where.fecha = { ...where.fecha, [db.Sequelize.Op.lte]: fecha_hasta };

    const { count, rows } = await Transaccion.findAndCountAll({
      where,
      order: [['fecha', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
    });

    res.json({ data: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) });
  } catch (err) { next(err); }
};

// POST /api/cuentas/:id/transacciones  (transacción manual)
const storeTransaccion = async (req, res, next) => {
  try {
    const cuenta = await Cuenta.findByPk(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const { tipo, monto, descripcion, fecha } = req.body;
    const tx = await Transaccion.create({
      cuenta_id: cuenta.id,
      tipo,
      monto,
      descripcion,
      fecha: fecha || new Date().toISOString().split('T')[0],
      referencia_tipo: 'manual',
    });
    res.status(201).json(tx);
  } catch (err) { next(err); }
};

// DELETE /api/cuentas/transacciones/:id
const destroyTransaccion = async (req, res, next) => {
  try {
    const tx = await Transaccion.findByPk(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transacción no encontrada' });
    if (tx.referencia_tipo && tx.referencia_tipo !== 'manual') {
      return res.status(422).json({ error: 'Solo se pueden eliminar transacciones registradas manualmente.' });
    }
    await tx.destroy();
    res.status(204).send();
  } catch (err) { next(err); }
};

module.exports = { index, store, update, destroy, transacciones, storeTransaccion, destroyTransaccion, dashboardStats };
