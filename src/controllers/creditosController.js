'use strict';

const db = require('../models');
const { CreditoRecibido, CuotaCredito, Cuenta, Transaccion, sequelize } = db;

// ─── helpers ────────────────────────────────────────────────────────────────

function sumarFechaMeses(fechaStr, meses) {
  const d = new Date(fechaStr + 'T12:00:00');
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().split('T')[0];
}

function generarCuotasSimple(capital, tasa, n, fechaInicio) {
  const cap = parseFloat(capital);
  const r   = parseFloat(tasa);
  const capitalCuota  = parseFloat((cap / n).toFixed(2));
  const interesCuota  = parseFloat((cap * r).toFixed(2));
  const totalCuota    = parseFloat((capitalCuota + interesCuota).toFixed(2));

  return Array.from({ length: n }, (_, i) => ({
    numero_cuota:      i + 1,
    capital_cuota:     capitalCuota,
    interes_cuota:     interesCuota,
    monto_total_cuota: totalCuota,
    fecha_estimada:    sumarFechaMeses(fechaInicio, i + 1),
    estado:            'pendiente',
  }));
}

function generarCuotasCompuesto(capital, tasa, n, fechaInicio) {
  const cap = parseFloat(capital);
  const r   = parseFloat(tasa);

  const cuotaFija = r === 0
    ? parseFloat((cap / n).toFixed(2))
    : parseFloat((cap * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)).toFixed(2));

  let saldo = cap;
  return Array.from({ length: n }, (_, i) => {
    const interesCuota  = parseFloat((saldo * r).toFixed(2));
    const capitalCuota  = parseFloat((cuotaFija - interesCuota).toFixed(2));
    saldo = parseFloat((saldo - capitalCuota).toFixed(2));

    return {
      numero_cuota:      i + 1,
      capital_cuota:     capitalCuota,
      interes_cuota:     interesCuota,
      monto_total_cuota: cuotaFija,
      fecha_estimada:    sumarFechaMeses(fechaInicio, i + 1),
      estado:            'pendiente',
    };
  });
}

function includeBase() {
  return [
    { model: Cuenta,      as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] },
    { model: CuotaCredito, as: 'cuotas', order: [['numero_cuota', 'ASC']] },
  ];
}

function mapCredito(c) {
  const json   = c.toJSON ? c.toJSON() : c;
  const cuotas = json.cuotas || [];

  const total_interes   = parseFloat(cuotas.reduce((s, q) => s + parseFloat(q.interes_cuota), 0).toFixed(2));
  const total_deuda     = parseFloat((parseFloat(json.capital) + total_interes).toFixed(2));
  const total_pagado    = parseFloat(cuotas.filter(q => q.estado === 'pagada').reduce((s, q) => s + parseFloat(q.monto_total_cuota), 0).toFixed(2));
  const saldo_pendiente = parseFloat(cuotas.filter(q => q.estado === 'pendiente').reduce((s, q) => s + parseFloat(q.monto_total_cuota), 0).toFixed(2));
  const proxima_cuota   = cuotas.find(q => q.estado === 'pendiente') || null;
  const cuotas_pagadas  = cuotas.filter(q => q.estado === 'pagada').length;

  return { ...json, total_interes, total_deuda, total_pagado, saldo_pendiente, proxima_cuota, cuotas_pagadas };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const index = async (req, res, next) => {
  try {
    const { estado } = req.query;
    const where = {};
    if (estado) where.estado = estado;

    const list = await CreditoRecibido.findAll({
      where,
      include: includeBase(),
      order: [['created_at', 'DESC']],
    });

    res.json({ data: list.map(mapCredito) });
  } catch (err) { next(err); }
};

const show = async (req, res, next) => {
  try {
    const credito = await CreditoRecibido.findByPk(req.params.id, { include: includeBase() });
    if (!credito) return res.status(404).json({ error: 'Crédito no encontrado' });
    res.json(mapCredito(credito));
  } catch (err) { next(err); }
};

// POST /api/creditos
const store = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { nombre, capital, tipo_interes, tasa_mensual, num_cuotas, fecha_inicio, cuenta_id, proposito_tipo, proposito_id } = req.body;

    const cuenta = await Cuenta.findByPk(cuenta_id);
    if (!cuenta) { await t.rollback(); return res.status(404).json({ error: 'Cuenta no encontrada' }); }

    const credito = await CreditoRecibido.create(
      { nombre, capital, tipo_interes, tasa_mensual, num_cuotas, fecha_inicio, cuenta_id, proposito_tipo: proposito_tipo || null, proposito_id: proposito_id || null, estado: 'activo' },
      { transaction: t },
    );

    // Generar tabla de amortización
    const cuotas = tipo_interes === 'simple'
      ? generarCuotasSimple(capital, tasa_mensual, num_cuotas, fecha_inicio)
      : generarCuotasCompuesto(capital, tasa_mensual, num_cuotas, fecha_inicio);

    await CuotaCredito.bulkCreate(
      cuotas.map(q => ({ ...q, credito_id: credito.id })),
      { transaction: t },
    );

    await Transaccion.create({
      cuenta_id,
      tipo:            'ingreso',
      monto:           capital,
      descripcion:     `Crédito recibido — ${nombre}`,
      fecha:           fecha_inicio,
      referencia_tipo: 'credito_recibido',
      referencia_id:   credito.id,
    }, { transaction: t });

    await t.commit();

    const result = await CreditoRecibido.findByPk(credito.id, { include: includeBase() });
    res.status(201).json(mapCredito(result));
  } catch (err) { await t.rollback(); next(err); }
};

// DELETE /api/creditos/:id — solo si no hay cuotas pagadas
const destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const credito = await CreditoRecibido.findByPk(req.params.id, {
      include: [{ model: CuotaCredito, as: 'cuotas' }],
    });
    if (!credito) { await t.rollback(); return res.status(404).json({ error: 'Crédito no encontrado' }); }

    const tienePagadas = credito.cuotas.some(q => q.estado === 'pagada');
    if (tienePagadas) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede eliminar un crédito con cuotas ya pagadas.' });
    }

    await Transaccion.destroy({
      where: { referencia_tipo: 'credito_recibido', referencia_id: credito.id },
      transaction: t,
    });

    await credito.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) { await t.rollback(); next(err); }
};

// ─── PAGAR CUOTA ─────────────────────────────────────────────────────────────

// POST /api/creditos/:id/cuotas/:cuotaId/pagar  { cuenta_pago_id, fecha_pago }
const pagarCuota = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const credito = await CreditoRecibido.findByPk(req.params.id, {
      include: [{ model: CuotaCredito, as: 'cuotas' }],
    });
    if (!credito)            { await t.rollback(); return res.status(404).json({ error: 'Crédito no encontrado' }); }
    if (credito.estado === 'pagado') { await t.rollback(); return res.status(422).json({ error: 'Este crédito ya está pagado.' }); }

    const cuota = credito.cuotas.find(q => q.id === parseInt(req.params.cuotaId));
    if (!cuota)               { await t.rollback(); return res.status(404).json({ error: 'Cuota no encontrada' }); }
    if (cuota.estado === 'pagada') { await t.rollback(); return res.status(422).json({ error: 'Esta cuota ya fue pagada.' }); }

    const { cuenta_pago_id, fecha_pago } = req.body;
    if (!cuenta_pago_id || !fecha_pago) {
      await t.rollback();
      return res.status(422).json({ error: 'Se requiere cuenta_pago_id y fecha_pago.' });
    }

    const cuentaPago = await Cuenta.findByPk(cuenta_pago_id);
    if (!cuentaPago) { await t.rollback(); return res.status(404).json({ error: 'Cuenta de pago no encontrada' }); }

    await cuota.update({ estado: 'pagada', fecha_pago }, { transaction: t });

    await Transaccion.create({
      cuenta_id:       cuenta_pago_id,
      tipo:            'egreso',
      monto:           cuota.monto_total_cuota,
      descripcion:     `Cuota ${cuota.numero_cuota}/${credito.num_cuotas} — ${credito.nombre}`,
      fecha:           fecha_pago,
      referencia_tipo: 'cuota_credito',
      referencia_id:   cuota.id,
    }, { transaction: t });

    // Si todas las cuotas están pagadas, marcar el crédito como pagado
    const todasPagadas = credito.cuotas.every(q => q.id === cuota.id || q.estado === 'pagada');
    if (todasPagadas) {
      await credito.update({ estado: 'pagado' }, { transaction: t });
    }

    await t.commit();

    const result = await CreditoRecibido.findByPk(credito.id, { include: includeBase() });
    res.json(mapCredito(result));
  } catch (err) { await t.rollback(); next(err); }
};

module.exports = { index, show, store, destroy, pagarCuota };
