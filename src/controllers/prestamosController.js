'use strict';

const db = require('../models');
const { Op } = require('sequelize');
const { Prestamo, PagoPrestamo, Cuenta, Transaccion, sequelize } = db;
const { bloquearRegistros } = require('../utils/bloqueos');
const { parsearCentavos, aCentavos, desdeCentavos } = require('../utils/montos');
const { archivarMovimientos } = require('../utils/archivarMovimientos');
const { calcularSaldoPrestamo } = require('../utils/saldosPrestamo');

// ─── helpers ────────────────────────────────────────────────────────────────

function includeBase() {
  return [
    { model: Cuenta,       as: 'cuenta',  attributes: ['id', 'nombre', 'tipo'] },
    { model: PagoPrestamo, as: 'pagos',   order: [['fecha_pago', 'ASC']] },
  ];
}

function mapPrestamo(p) {
  const json  = p.toJSON ? p.toJSON() : p;
  const pagos = json.pagos || [];
  return { ...json, ...calcularSaldoPrestamo(json, pagos) };
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
    const { deudor_nombre, deudor_contacto, capital, tasa_interes_mensual, fecha_inicio, dias_duracion, cuenta_id } = req.body;

    const cuentas = await bloquearRegistros(Cuenta, [cuenta_id], t);
    const cuenta = cuentas.get(Number(cuenta_id));
    if (!cuenta) { await t.rollback(); return res.status(404).json({ error: 'Cuenta no encontrada' }); }

    const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
    if (parseFloat(capital) > saldo_actual) {
      await t.rollback();
      return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${saldo_actual.toFixed(2)}` });
    }

    const prestamo = await Prestamo.create(
      { deudor_nombre, deudor_contacto, capital, tasa_interes_mensual, fecha_inicio, dias_duracion: dias_duracion || null, cuenta_id, estado: 'activo' },
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
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.status(201).json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// PUT /api/prestamos/:id  — permite editar préstamos activos con abonos
const update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo) { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    if (prestamo.estado === 'pagado') {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede editar un préstamo pagado.' });
    }

    const { deudor_nombre, deudor_contacto, capital, tasa_interes_mensual, fecha_inicio, dias_duracion, cuenta_id } = req.body;
    const nuevoCapitalCentavos = parsearCentavos(capital);
    if (nuevoCapitalCentavos == null || nuevoCapitalCentavos <= 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El capital debe ser positivo y tener como máximo dos decimales.' });
    }
    const nuevoCapital = desdeCentavos(nuevoCapitalCentavos);
    const pagosExistentes = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const saldoRecalculado = calcularSaldoPrestamo(
      { ...prestamo.toJSON(), capital: nuevoCapital, tasa_interes_mensual },
      pagosExistentes,
    );
    if (aCentavos(saldoRecalculado.saldo_pendiente) < 0) {
      await t.rollback();
      return res.status(422).json({ error: 'La nueva deuda no puede ser menor al total de abonos registrados.' });
    }

    const movimientoPrestamo = await Transaccion.findOne({
      where: { referencia_tipo: 'prestamo', referencia_id: prestamo.id, tipo: 'egreso' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!movimientoPrestamo) {
      await t.rollback();
      return res.status(409).json({ error: 'No se puede editar: falta el movimiento contable asociado al préstamo.' });
    }

    const pagosIds = pagosExistentes.map((pago) => pago.id);
    const movimientosAbonos = pagosIds.length
      ? await Transaccion.findAll({
          where: { referencia_tipo: 'pago_prestamo', referencia_id: { [Op.in]: pagosIds } },
          transaction: t,
          lock: t.LOCK.UPDATE,
        })
      : [];
    const movimientosPorPago = new Set(movimientosAbonos.map((movimiento) => Number(movimiento.referencia_id)));
    if (pagosIds.some((id) => !movimientosPorPago.has(Number(id)))) {
      await t.rollback();
      return res.status(409).json({ error: 'No se puede editar: falta un movimiento contable asociado a un abono.' });
    }

    const cuentaDestinoId = Number(cuenta_id);
    const cuentaIdsAfectadas = [
      movimientoPrestamo.cuenta_id,
      cuentaDestinoId,
      ...movimientosAbonos.map((movimiento) => movimiento.cuenta_id),
    ];
    const cuentas = await bloquearRegistros(Cuenta, cuentaIdsAfectadas, t);
    if (cuentaIdsAfectadas.some((id) => !cuentas.has(Number(id)))) {
      await t.rollback();
      return res.status(404).json({ error: 'No se encontró una de las cuentas involucradas.' });
    }

    // Verificar los saldos finales tras mover el egreso y todos sus abonos a la cuenta elegida.
    const deltasCentavos = new Map();
    const sumarDelta = (id, delta) => deltasCentavos.set(Number(id), (deltasCentavos.get(Number(id)) || 0) + delta);
    const capitalAnteriorCentavos = aCentavos(prestamo.capital);
    sumarDelta(movimientoPrestamo.cuenta_id, capitalAnteriorCentavos);
    sumarDelta(cuentaDestinoId, -nuevoCapitalCentavos);
    for (const movimiento of movimientosAbonos) {
      const montoCentavos = aCentavos(movimiento.monto);
      sumarDelta(movimiento.cuenta_id, -montoCentavos);
      sumarDelta(cuentaDestinoId, montoCentavos);
    }

    for (const [id, delta] of deltasCentavos) {
      const { saldo_actual: saldoActual } = await Cuenta.calcularSaldo(id, sequelize, t);
      if (aCentavos(saldoActual) + delta < 0) {
        await t.rollback();
        return res.status(422).json({ error: `Saldo insuficiente en la cuenta "${cuentas.get(id).nombre}" para aplicar los cambios.` });
      }
    }

    await prestamo.update({
      deudor_nombre,
      deudor_contacto: deudor_contacto || null,
      capital: nuevoCapital,
      tasa_interes_mensual,
      fecha_inicio,
      dias_duracion: dias_duracion || null,
      cuenta_id: cuentaDestinoId,
      estado: aCentavos(saldoRecalculado.saldo_pendiente) === 0 ? 'pagado' : 'activo',
    }, { transaction: t });

    await movimientoPrestamo.update({
      cuenta_id: cuentaDestinoId,
      monto: nuevoCapital,
      descripcion: `Préstamo a ${deudor_nombre}`,
      fecha: fecha_inicio,
    }, { transaction: t });

    for (const movimiento of movimientosAbonos) {
      const descripcion = movimiento.descripcion.startsWith('Pago final préstamo')
        ? `Pago final préstamo — ${deudor_nombre}`
        : `Abono préstamo — ${deudor_nombre}`;
      await movimiento.update({ cuenta_id: cuentaDestinoId, descripcion }, { transaction: t });
    }

    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// DELETE /api/prestamos/:id  — solo si no tiene pagos
const destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo) { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }

    const pagos = await PagoPrestamo.count({ where: { prestamo_id: prestamo.id }, transaction: t });
    if (pagos > 0) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede eliminar un préstamo con abonos registrados.' });
    }

    const movimientos = await Transaccion.findAll({
      where: { tipo: 'egreso', referencia_tipo: 'prestamo', referencia_id: prestamo.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (movimientos.length === 0) {
      await t.rollback();
      return res.status(409).json({ error: 'No se puede eliminar: falta el movimiento contable asociado al préstamo. Revisa la integridad de la cuenta.' });
    }

    // Archivar conserva el egreso: borrar la ficha no devuelve el dinero prestado.
    await archivarMovimientos(movimientos, {
      tipo: 'prestamo_archivado', entidad: 'préstamo', entidadId: prestamo.id, transaction: t,
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
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo)              { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    if (prestamo.estado === 'pagado') { await t.rollback(); return res.status(422).json({ error: 'Este préstamo ya está pagado.' }); }

    const { monto, fecha_pago, nota } = req.body;
    if (!monto || !fecha_pago) { await t.rollback(); return res.status(422).json({ error: 'Se requieren monto y fecha de pago.' }); }
    const montoCentavos = parsearCentavos(monto);
    if (montoCentavos == null || montoCentavos <= 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El monto del abono debe ser positivo y tener como máximo dos decimales.' });
    }
    const montoNumerico = desdeCentavos(montoCentavos);

    const pagosActuales = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const { saldo_pendiente: saldoPendiente } = calcularSaldoPrestamo(prestamo, pagosActuales);
    if (montoCentavos > aCentavos(saldoPendiente)) {
      await t.rollback();
      return res.status(422).json({ error: `El abono supera el saldo pendiente de $${Math.max(0, saldoPendiente).toFixed(2)}.` });
    }

    const cuentas = await bloquearRegistros(Cuenta, [prestamo.cuenta_id], t);
    if (!cuentas.has(Number(prestamo.cuenta_id))) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta del préstamo no encontrada.' });
    }

    const pago = await PagoPrestamo.create(
      { prestamo_id: prestamo.id, monto: montoNumerico, fecha_pago, nota },
      { transaction: t },
    );

    await Transaccion.create({
      cuenta_id:       prestamo.cuenta_id,
      tipo:            'ingreso',
      monto:            montoNumerico,
      descripcion:     `Abono préstamo — ${prestamo.deudor_nombre}`,
      fecha:           fecha_pago,
      referencia_tipo: 'pago_prestamo',
      referencia_id:   pago.id,
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    // Auto-completar si el total de abonos cubre la deuda
    const pagosSimulados = [...pagosActuales, { monto: montoNumerico }];
    const { saldo_pendiente } = calcularSaldoPrestamo(prestamo, pagosSimulados);
    if (saldo_pendiente <= 0) {
      await prestamo.update({ estado: 'pagado' }, { transaction: t });
    }

    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.status(201).json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// PUT /api/prestamos/:id/abono/:abonoId  { monto, fecha_pago, nota? }
const updateAbono = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo) { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    const pago = await PagoPrestamo.findOne({
      where: { id: req.params.abonoId, prestamo_id: req.params.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!pago) { await t.rollback(); return res.status(404).json({ error: 'Abono no encontrado' }); }

    const { monto, fecha_pago, nota } = req.body;
    if (!monto || !fecha_pago) { await t.rollback(); return res.status(422).json({ error: 'Se requieren monto y fecha de pago.' }); }
    const montoCentavos = parsearCentavos(monto);
    if (montoCentavos == null || montoCentavos <= 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El monto del abono debe ser positivo y tener como máximo dos decimales.' });
    }
    const montoNumerico = desdeCentavos(montoCentavos);

    const pagosActuales = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const pagosSinEste = pagosActuales.filter((pagoActual) => pagoActual.id !== pago.id);
    const { saldo_pendiente: saldoSinEste } = calcularSaldoPrestamo(prestamo, pagosSinEste);
    if (montoCentavos > aCentavos(saldoSinEste)) {
      await t.rollback();
      return res.status(422).json({ error: `El abono supera el saldo pendiente de $${Math.max(0, saldoSinEste).toFixed(2)}.` });
    }
    const cuentas = await bloquearRegistros(Cuenta, [prestamo.cuenta_id], t);
    const cuenta = cuentas.get(Number(prestamo.cuenta_id));
    if (!cuenta) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta del préstamo no encontrada.' });
    }
    if (montoNumerico < parseFloat(pago.monto)) {
      const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
      const reversoCentavos = aCentavos(pago.monto) - montoCentavos;
      if (reversoCentavos > aCentavos(saldo_actual)) {
        await t.rollback();
        return res.status(422).json({ error: 'No se puede reducir el abono: la cuenta no conserva el monto que debe revertirse.' });
      }
    }

    await pago.update({ monto: montoNumerico, fecha_pago, nota: nota ?? pago.nota }, { transaction: t });

    await Transaccion.update(
      { monto: montoNumerico, fecha: fecha_pago },
      { where: { referencia_tipo: 'pago_prestamo', referencia_id: pago.id }, transaction: t },
    );

    // Re-evaluar si el préstamo debe pasar a pagado o volver a activo
    const pagosActualizados = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const { saldo_pendiente } = calcularSaldoPrestamo(prestamo, pagosActualizados);
    const nuevoEstado = saldo_pendiente <= 0 ? 'pagado' : 'activo';
    if (prestamo.estado !== nuevoEstado) {
      await prestamo.update({ estado: nuevoEstado }, { transaction: t });
    }

    await t.commit();

    const result = await Prestamo.findByPk(req.params.id, { include: includeBase() });
    res.json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// DELETE /api/prestamos/:id/abono/:abonoId
const destroyAbono = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo) { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    const pago = await PagoPrestamo.findOne({
      where: { id: req.params.abonoId, prestamo_id: req.params.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!pago) { await t.rollback(); return res.status(404).json({ error: 'Abono no encontrado' }); }

    const cuentas = await bloquearRegistros(Cuenta, [prestamo.cuenta_id], t);
    const cuenta = cuentas.get(Number(prestamo.cuenta_id));
    const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
    if (aCentavos(pago.monto) > aCentavos(saldo_actual)) {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede borrar el abono: el saldo actual de la cuenta no cubre su reversión.' });
    }

    await Transaccion.destroy({
      where: { referencia_tipo: 'pago_prestamo', referencia_id: pago.id },
      transaction: t,
    });
    await pago.destroy({ transaction: t });

    // Si el préstamo estaba pagado y se borra un abono, vuelve a activo
    const pagosRestantes = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const { saldo_pendiente } = calcularSaldoPrestamo(prestamo, pagosRestantes);
    if (saldo_pendiente > 0 && prestamo.estado === 'pagado') {
      await prestamo.update({ estado: 'activo' }, { transaction: t });
    }

    await t.commit();

    const result = await Prestamo.findByPk(req.params.id, { include: includeBase() });
    res.json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

// ─── MARCAR COMO PAGADO ──────────────────────────────────────────────────────

// POST /api/prestamos/:id/pagar
const marcarPagado = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const prestamo = await Prestamo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!prestamo)              { await t.rollback(); return res.status(404).json({ error: 'Préstamo no encontrado' }); }
    if (prestamo.estado === 'pagado') { await t.rollback(); return res.status(422).json({ error: 'Este préstamo ya está marcado como pagado.' }); }

    const pagos = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id }, transaction: t });
    const { saldo_pendiente: saldoPendiente } = calcularSaldoPrestamo(prestamo, pagos);
    const saldoPendienteCentavos = aCentavos(saldoPendiente);
    if (saldoPendienteCentavos < 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El préstamo tiene abonos por encima de la deuda calculada; revisa los movimientos antes de cerrarlo.' });
    }

    if (saldoPendienteCentavos > 0) {
      const cuentas = await bloquearRegistros(Cuenta, [prestamo.cuenta_id], t);
      if (!cuentas.has(Number(prestamo.cuenta_id))) {
        await t.rollback();
        return res.status(404).json({ error: 'Cuenta del préstamo no encontrada.' });
      }
      const fechaPago = new Date().toISOString().slice(0, 10);
      const montoFinal = desdeCentavos(saldoPendienteCentavos);
      const pagoFinal = await PagoPrestamo.create({
        prestamo_id: prestamo.id,
        monto: montoFinal,
        fecha_pago: fechaPago,
        nota: 'Pago final confirmado',
      }, { transaction: t });
      await Transaccion.create({
        cuenta_id: prestamo.cuenta_id,
        tipo: 'ingreso',
        monto: montoFinal,
        descripcion: `Pago final préstamo — ${prestamo.deudor_nombre}`,
        fecha: fechaPago,
        referencia_tipo: 'pago_prestamo',
        referencia_id: pagoFinal.id,
        usuario_id: req.usuario?.id || null,
      }, { transaction: t });
    }

    await prestamo.update({ estado: 'pagado' }, { transaction: t });
    await t.commit();

    const result = await Prestamo.findByPk(prestamo.id, { include: includeBase() });
    res.json(mapPrestamo(result));
  } catch (err) { await t.rollback(); next(err); }
};

module.exports = { index, show, store, update, destroy, registrarAbono, updateAbono, destroyAbono, marcarPagado };
