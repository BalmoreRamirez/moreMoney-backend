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

// Saldo dinámico de una cuenta (usado en escrituras puntuales)
async function saldoCuenta(cuentaId) {
  return Cuenta.calcularSaldo(cuentaId, sequelize);
}

// Saldos de todas las cuentas en una sola query
async function saldosTodas() {
  const [rows] = await sequelize.query(
    `SELECT
       c.id,
       c.saldo_inicial,
       COALESCE(SUM(CASE WHEN t.tipo = 'ingreso' THEN t.monto ELSE 0 END), 0) AS total_ingresos,
       COALESCE(SUM(CASE WHEN t.tipo = 'egreso'  THEN t.monto ELSE 0 END), 0) AS total_egresos
     FROM cuentas c
     LEFT JOIN transacciones t ON t.cuenta_id = c.id
     GROUP BY c.id, c.saldo_inicial`
  );
  return Object.fromEntries(rows.map(r => {
    const saldo_inicial  = parseFloat(r.saldo_inicial);
    const total_ingresos = parseFloat(r.total_ingresos);
    const total_egresos  = parseFloat(r.total_egresos);
    return [r.id, { saldo_inicial, total_ingresos, total_egresos, saldo_actual: saldo_inicial + total_ingresos - total_egresos }];
  }));
}

// GET /api/cuentas
const index = async (req, res, next) => {
  try {
    const [cuentas, saldos] = await Promise.all([
      Cuenta.findAll({ order: [['created_at', 'ASC']] }),
      saldosTodas(),
    ]);

    const data = cuentas.map(c => ({ ...c.toJSON(), ...(saldos[c.id] ?? { saldo_inicial: 0, total_ingresos: 0, total_egresos: 0, saldo_actual: 0 }) }));
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

    // A1: saldo_inicial es inmutable una vez que existen transacciones
    if (saldo_inicial !== undefined && parseFloat(saldo_inicial) !== parseFloat(cuenta.saldo_inicial)) {
      const txCount = await Transaccion.count({ where: { cuenta_id: cuenta.id } });
      if (txCount > 0) {
        return res.status(422).json({
          error: `No se puede modificar el saldo inicial de "${cuenta.nombre}": tiene ${txCount} transacción(es) registrada(s). El saldo inicial solo se puede cambiar antes del primer movimiento.`,
        });
      }
    }

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
      cuenta_id:       cuenta.id,
      tipo,
      monto,
      descripcion,
      fecha:           fecha || new Date().toISOString().split('T')[0],
      referencia_tipo: 'manual',
      usuario_id:      req.usuario?.id || null,
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

// POST /api/cuentas/transferir  { origen_id, destino_id, monto, descripcion?, fecha? }
const transferir = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { origen_id, destino_id, monto, descripcion, fecha } = req.body;

    if (!origen_id || !destino_id || !monto) {
      await t.rollback();
      return res.status(422).json({ error: 'Se requieren origen_id, destino_id y monto.' });
    }
    if (parseInt(origen_id) === parseInt(destino_id)) {
      await t.rollback();
      return res.status(422).json({ error: 'La cuenta de origen y destino deben ser diferentes.' });
    }

    const [origen, destino] = await Promise.all([
      Cuenta.findByPk(origen_id),
      Cuenta.findByPk(destino_id),
    ]);
    if (!origen)  { await t.rollback(); return res.status(404).json({ error: 'Cuenta de origen no encontrada.' }); }
    if (!destino) { await t.rollback(); return res.status(404).json({ error: 'Cuenta de destino no encontrada.' }); }

    const { saldo_actual } = await Cuenta.calcularSaldo(parseInt(origen_id), sequelize);
    if (parseFloat(monto) > saldo_actual) {
      await t.rollback();
      return res.status(422).json({ error: `Saldo insuficiente en "${origen.nombre}". Disponible: $${saldo_actual.toFixed(2)}` });
    }

    const fechaTx  = fecha || new Date().toISOString().split('T')[0];
    const desc     = descripcion || `Transferencia a ${destino.nombre}`;

    const egreso = await Transaccion.create({
      cuenta_id:       origen_id,
      tipo:            'egreso',
      monto,
      descripcion:     desc,
      fecha:           fechaTx,
      referencia_tipo: 'transferencia',
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    await Transaccion.create({
      cuenta_id:       destino_id,
      tipo:            'ingreso',
      monto,
      descripcion:     `Transferencia desde ${origen.nombre}`,
      fecha:           fechaTx,
      referencia_tipo: 'transferencia',
      referencia_id:   egreso.id,
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    await t.commit();

    const [saldoOrigen, saldoDestino] = await Promise.all([
      saldoCuenta(origen_id),
      saldoCuenta(destino_id),
    ]);

    res.status(201).json({
      origen:  { ...origen.toJSON(),  ...saldoOrigen },
      destino: { ...destino.toJSON(), ...saldoDestino },
    });
  } catch (err) { await t.rollback(); next(err); }
};

module.exports = { index, store, update, destroy, transacciones, storeTransaccion, destroyTransaccion, dashboardStats, transferir };
