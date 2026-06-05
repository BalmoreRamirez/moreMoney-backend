'use strict';

const db = require('../models');
const { Prestamo, PagoPrestamo, Cuenta, Transaccion, sequelize } = db;

// ─── helpers ────────────────────────────────────────────────────────────────

function calcularSaldo(prestamo, pagos) {
  const hoy   = new Date();
  const inicio = new Date(prestamo.fecha_inicio);
  const meses_transcurridos = Math.max(
    0,
    (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth()),
  );

  const capital             = parseFloat(prestamo.capital);
  const tasa                = parseFloat(prestamo.tasa_interes_mensual);
  const interes_generado    = parseFloat((capital * tasa * meses_transcurridos).toFixed(2));
  const total_deuda         = parseFloat((capital + interes_generado).toFixed(2));
  const total_pagado        = parseFloat(pagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2));
  const saldo_pendiente     = parseFloat((total_deuda - total_pagado).toFixed(2));
  const ganancia            = parseFloat((total_pagado - capital).toFixed(2));

  return { meses_transcurridos, interes_generado, total_deuda, total_pagado, saldo_pendiente, ganancia };
}

function includeBase() {
  return [
    { model: Cuenta,       as: 'cuenta',  attributes: ['id', 'nombre', 'tipo'] },
    { model: PagoPrestamo, as: 'pagos',   order: [['fecha_pago', 'ASC']] },
  ];
}

function mapPrestamo(p) {
  const json  = p.toJSON ? p.toJSON() : p;
  const pagos = json.pagos || [];
  return { ...json, ...calcularSaldo(json, pagos) };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const index = async (req, res, next) => {
  try {
    const { estado } = req.query;
    const where = {};
    if (estado) where.estado = estado;

    const list = await Prestamo.findAll({
      where,
      include: includeBase(),
      order: [['created_at', 'DESC']],
    });

    res.json({ data: list.map(mapPrestamo) });
  } catch (err) { next(err); }
};

const show = async (req, res, next) => {
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, { include: includeBase() });
    if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });
    res.json(mapPrestamo(prestamo));
  } catch (err) { next(err); }
};

// POST /api/prestamos  { deudor_nombre, deudor_contacto?, capital, tasa_interes_mensual, fecha_inicio, cuenta_id }
const store = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { deudor_nombre, deudor_contacto, capital, tasa_interes_mensual, fecha_inicio, cuenta_id } = req.body;

    const cuenta = await Cuenta.findByPk(cuenta_id);
    if (!cuenta) { await t.rollback(); return res.status(404).json({ error: 'Cuenta no encontrada' }); }

    const prestamo = await Prestamo.create(
      { deudor_nombre, deudor_contacto, capital, tasa_interes_mensual, fecha_inicio, cuenta_id, estado: 'activo' },
      { transaction: t },
    );

    await Transaccion.create({
      cuenta_id,
      tipo:            'egreso',
      monto:           capital,
      descripcion:     `Préstamo a ${deudor_nombre}`,
      fecha:           fecha_inicio,
      referencia_tipo: 'prestamo',
      referencia_id:   prestamo.id,
    }, { transaction: t });

    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.status(201).json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// DELETE /api/prestamos/:id  — solo si no tiene pagos
const destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      include: [{ model: PagoPrestamo, as: 'pagos' }],
    });
    if (!prestamo) { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }

    if (prestamo.pagos.length > 0) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede eliminar un préstamo con abonos registrados.' });
    }

    // Eliminar la transacción de egreso asociada
    await Transaccion.destroy({
      where: { referencia_tipo: 'prestamo', referencia_id: prestamo.id },
      transaction: t,
    });

    await prestamo.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) { await t.rollback(); next(err); }
};

// ─── ABONO ───────────────────────────────────────────────────────────────────

// POST /api/prestamos/:id/abono  { monto, fecha_pago, nota? }
const registrarAbono = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      include: [{ model: PagoPrestamo, as: 'pagos' }],
    });
    if (!prestamo)              { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    if (prestamo.estado === 'pagado') { await t.rollback(); return res.status(422).json({ error: 'Este préstamo ya está pagado.' }); }

    const { monto, fecha_pago, nota } = req.body;
    if (!monto || !fecha_pago) { await t.rollback(); return res.status(422).json({ error: 'Se requieren monto y fecha de pago.' }); }

    const pago = await PagoPrestamo.create(
      { prestamo_id: prestamo.id, monto, fecha_pago, nota },
      { transaction: t },
    );

    await Transaccion.create({
      cuenta_id:       prestamo.cuenta_id,
      tipo:            'ingreso',
      monto,
      descripcion:     `Abono préstamo — ${prestamo.deudor_nombre}`,
      fecha:           fecha_pago,
      referencia_tipo: 'pago_prestamo',
      referencia_id:   pago.id,
    }, { transaction: t });

    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.status(201).json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// ─── MARCAR COMO PAGADO ──────────────────────────────────────────────────────

// POST /api/prestamos/:id/pagar
const marcarPagado = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      include: [{ model: PagoPrestamo, as: 'pagos' }],
    });
    if (!prestamo)              { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    if (prestamo.estado === 'pagado') { await t.rollback(); return res.status(422).json({ error: 'Este préstamo ya está marcado como pagado.' }); }

    const pagos        = prestamo.pagos || [];
    const capital      = parseFloat(prestamo.capital);
    const total_pagado = parseFloat(pagos.reduce((s, p) => s + parseFloat(p.monto), 0).toFixed(2));
    const ganancia     = parseFloat((total_pagado - capital).toFixed(2));

    // Solo registrar ganancia si es positiva
    if (ganancia > 0) {
      await Transaccion.create({
        cuenta_id:       prestamo.cuenta_id,
        tipo:            'ingreso',
        monto:           ganancia,
        descripcion:     `Ganancia préstamo — ${prestamo.deudor_nombre}`,
        fecha:           new Date().toISOString().split('T')[0],
        referencia_tipo: 'ganancia_prestamo',
        referencia_id:   prestamo.id,
      }, { transaction: t });
    }

    await prestamo.update({ estado: 'pagado' }, { transaction: t });
    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

module.exports = { index, show, store, destroy, registrarAbono, marcarPagado };
