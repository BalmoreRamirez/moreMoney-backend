'use strict';

const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, sequelize } = db;
const { bloquearRegistros } = require('../utils/bloqueos');
const { calcularSaldosTarjeta } = require('../utils/saldosTarjeta');

// Proyecta las fechas de pago a partir de la fecha de compra y el dia_pago de la tarjeta
function calcFechasPago(fechaCompra, diaPago, totalCuotas) {
  const base = new Date(fechaCompra + 'T12:00:00Z');
  const results = [];
  for (let i = 1; i <= totalCuotas; i++) {
    let month = base.getUTCMonth() + i;
    let year  = base.getUTCFullYear() + Math.floor(month / 12);
    month = month % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(diaPago, lastDay);
    results.push(new Date(Date.UTC(year, month, day)).toISOString().split('T')[0]);
  }
  return results;
}

// ─── Compras Normales ───────────────────────────────────────────────

const indexNormales = async (req, res, next) => {
  try {
    const { tarjeta_id, estado } = req.query;
    const where = {};
    if (tarjeta_id) where.tarjeta_id = tarjeta_id;
    if (estado)     where.estado     = estado;

    const compras = await CompraNormal.findAll({
      where,
      include: [{ model: Tarjeta, as: 'tarjeta', attributes: ['id', 'nombre', 'banco'] }],
      order: [['fecha_compra', 'DESC']],
    });
    res.json({ data: compras });
  } catch (err) { next(err); }
};

const storeNormal = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { tarjeta_id, nombre, monto, fecha_compra } = req.body;
    const tarjetas = await bloquearRegistros(Tarjeta, [tarjeta_id], t);
    const tarjeta = tarjetas.get(Number(tarjeta_id));
    if (!tarjeta) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }
    const saldos = await calcularSaldosTarjeta(sequelize, tarjeta.id, t);
    const montoNumerico = Number(monto);
    if (!Number.isFinite(montoNumerico) || montoNumerico <= 0 || montoNumerico > saldos.saldo_disponible) {
      await t.rollback();
      return res.status(422).json({ error: `La compra debe ser positiva y no superar el disponible ($${saldos.saldo_disponible.toFixed(2)}).` });
    }
    const compra = await CompraNormal.create({
      tarjeta_id: tarjeta.id, nombre, monto: montoNumerico, fecha_compra, estado: 'pendiente',
    }, { transaction: t });
    await t.commit();
    res.status(201).json(compra);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const updateNormal = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const snapshot = await CompraNormal.findByPk(req.params.id, { transaction: t });
    if (!snapshot) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    const { tarjeta_id, nombre, monto, fecha_compra, estado } = req.body;
    const tarjetaSolicitada = tarjeta_id !== undefined ? Number(tarjeta_id) : snapshot.tarjeta_id;
    const tarjetas = await bloquearRegistros(Tarjeta, [snapshot.tarjeta_id, tarjetaSolicitada], t);
    const compra = await CompraNormal.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!compra) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    if (compra.tarjeta_id !== snapshot.tarjeta_id) {
      await t.rollback();
      return res.status(409).json({ error: 'La compra cambió durante la operación; vuelve a cargarla e inténtalo de nuevo.' });
    }
    const nuevaTarjetaId = tarjeta_id !== undefined ? Number(tarjeta_id) : compra.tarjeta_id;
    const nuevoMonto = monto !== undefined ? Number(monto) : parseFloat(compra.monto);
    const nuevoEstado = estado ?? compra.estado;
    if (!tarjetas.has(nuevaTarjetaId)) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }
    const cambiosFinancieros = nuevaTarjetaId !== compra.tarjeta_id
      || nuevoMonto !== parseFloat(compra.monto)
      || (fecha_compra !== undefined && fecha_compra !== compra.fecha_compra)
      || nuevoEstado !== compra.estado;
    if (compra.estado === 'pagada' && cambiosFinancieros) {
      await t.rollback();
      return res.status(422).json({ error: 'Una compra pagada no se puede alterar; solo se permite corregir su nombre.' });
    }
    if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) {
      await t.rollback();
      return res.status(422).json({ error: 'El monto debe ser mayor que cero.' });
    }
    if (nuevoEstado === 'pendiente') {
      const saldos = await calcularSaldosTarjeta(sequelize, nuevaTarjetaId, t);
      const disponible = saldos.saldo_disponible
        + (nuevaTarjetaId === compra.tarjeta_id && compra.estado === 'pendiente' ? parseFloat(compra.monto) : 0);
      if (nuevoMonto > disponible) {
        await t.rollback();
        return res.status(422).json({ error: `La compra supera el disponible ($${disponible.toFixed(2)}).` });
      }
    }
    await compra.update({
      tarjeta_id: nuevaTarjetaId,
      nombre: nombre ?? compra.nombre,
      monto: nuevoMonto,
      fecha_compra: fecha_compra ?? compra.fecha_compra,
      estado: nuevoEstado,
    }, { transaction: t });
    await t.commit();
    const result = await CompraNormal.findByPk(compra.id, {
      include: [{ model: Tarjeta, as: 'tarjeta', attributes: ['id', 'nombre', 'banco'] }],
    });
    res.json(result);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const destroyNormal = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const snapshot = await CompraNormal.findByPk(req.params.id, { transaction: t });
    if (!snapshot) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    const tarjetas = await bloquearRegistros(Tarjeta, [snapshot.tarjeta_id], t);
    const compra = await CompraNormal.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!compra) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    if (compra.tarjeta_id !== snapshot.tarjeta_id) {
      await t.rollback();
      return res.status(409).json({ error: 'La compra cambió durante la operación; vuelve a cargarla e inténtalo de nuevo.' });
    }
    if (!tarjetas.has(Number(compra.tarjeta_id))) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }
    if (compra.estado === 'pagada') {
      await t.rollback();
      return res.status(422).json({ error: 'No se puede borrar una compra pagada; conserva el historial de la tarjeta.' });
    }
    await compra.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── Compras Tasa Cero ──────────────────────────────────────────────

const indexTasaCero = async (req, res, next) => {
  try {
    const { tarjeta_id, estado } = req.query;
    const where = {};
    if (tarjeta_id) where.tarjeta_id = tarjeta_id;
    if (estado)     where.estado     = estado;

    const compras = await CompraTasaCero.findAll({
      where,
      include: [
        { model: Tarjeta,      as: 'tarjeta', attributes: ['id', 'nombre', 'banco', 'dia_pago'] },
        { model: CuotaMensual, as: 'cuotas',  order: [['numero_cuota', 'ASC']] },
      ],
      order: [['fecha_compra', 'DESC']],
    });
    res.json({ data: compras });
  } catch (err) { next(err); }
};

const storeTasaCero = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { tarjeta_id, nombre, monto_total, total_cuotas, fecha_compra } = req.body;

    const tarjetas = await bloquearRegistros(Tarjeta, [tarjeta_id], t);
    const tarjeta = tarjetas.get(Number(tarjeta_id));
    if (!tarjeta) { await t.rollback(); return res.status(404).json({ error: 'Tarjeta no encontrada' }); }
    const saldos = await calcularSaldosTarjeta(sequelize, tarjeta.id, t);
    const montoNumerico = Number(monto_total);
    const cuotasNumero = Number(total_cuotas);
    if (!Number.isFinite(montoNumerico) || montoNumerico <= 0
      || !Number.isSafeInteger(cuotasNumero) || cuotasNumero <= 0
      || montoNumerico > saldos.saldo_disponible) {
      await t.rollback();
      return res.status(422).json({ error: `La compra debe tener monto y cuotas válidos, y no superar el disponible ($${saldos.saldo_disponible.toFixed(2)}).` });
    }

    const compra = await CompraTasaCero.create(
      { tarjeta_id: tarjeta.id, nombre, monto_total: montoNumerico, total_cuotas: cuotasNumero, fecha_compra, estado: 'activa' },
      { transaction: t }
    );

    const n         = cuotasNumero;
    const montoCuota = Math.round((montoNumerico / n) * 100) / 100;
    const fechas    = calcFechasPago(fecha_compra, tarjeta.dia_pago, n);

    await CuotaMensual.bulkCreate(
      fechas.map((fecha, i) => ({
        tasa_cero_id:        compra.id,
        numero_cuota:        i + 1,
        monto_cuota:         i === n - 1
          ? parseFloat((montoNumerico - montoCuota * (n - 1)).toFixed(2))
          : montoCuota,
        fecha_estimada_pago: fecha,
        estado:              'pendiente',
      })),
      { transaction: t }
    );

    await t.commit();

    const result = await CompraTasaCero.findByPk(compra.id, {
      include: [{ model: CuotaMensual, as: 'cuotas', order: [['numero_cuota', 'ASC']] }],
    });
    res.status(201).json(result);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const updateTasaCero = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const snapshot = await CompraTasaCero.findByPk(req.params.id, { transaction: t });
    if (!snapshot) { await t.rollback(); return res.status(404).json({ error: 'Compra no encontrada' }); }
    const { tarjeta_id, nombre, monto_total, total_cuotas, fecha_compra } = req.body;
    const tarjetaSolicitada = tarjeta_id !== undefined ? Number(tarjeta_id) : snapshot.tarjeta_id;
    const tarjetas = await bloquearRegistros(Tarjeta, [snapshot.tarjeta_id, tarjetaSolicitada], t);
    const compra = await CompraTasaCero.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!compra) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    if (compra.tarjeta_id !== snapshot.tarjeta_id) {
      await t.rollback();
      return res.status(409).json({ error: 'La compra cambió durante la operación; vuelve a cargarla e inténtalo de nuevo.' });
    }
    const cuotasExistentes = await CuotaMensual.findAll({
      where: { tasa_cero_id: compra.id },
      transaction: t,
    });

    // Detectar si cambia algún campo financiero que afecte las cuotas
    const financialChanged =
      (tarjeta_id   !== undefined && parseInt(tarjeta_id)       !== compra.tarjeta_id)   ||
      (monto_total  !== undefined && parseFloat(monto_total)    !== parseFloat(compra.monto_total)) ||
      (total_cuotas !== undefined && parseInt(total_cuotas)     !== compra.total_cuotas)  ||
      (fecha_compra !== undefined && fecha_compra               !== compra.fecha_compra);

    if (financialChanged) {
      const cuotasPagadas = cuotasExistentes.filter(c => c.estado === 'pagada').length;
      if (cuotasPagadas > 0) {
        await t.rollback();
        return res.status(422).json({
          error: `No se pueden modificar los montos o fechas de "${compra.nombre}": ya tiene ${cuotasPagadas} cuota(s) pagada(s). Solo puedes editar la descripción.`,
        });
      }

      // Recalcular cuotas desde cero
      const newTarjetaId   = tarjeta_id   !== undefined ? parseInt(tarjeta_id)    : compra.tarjeta_id;
      const newMontoTotal  = monto_total  !== undefined ? parseFloat(monto_total) : parseFloat(compra.monto_total);
      const newTotalCuotas = total_cuotas !== undefined ? parseInt(total_cuotas)  : compra.total_cuotas;
      const newFecha       = fecha_compra !== undefined ? fecha_compra            : compra.fecha_compra;

      const tarjeta = tarjetas.get(newTarjetaId);
      if (!tarjeta) { await t.rollback(); return res.status(404).json({ error: 'Tarjeta no encontrada' }); }
      const saldos = await calcularSaldosTarjeta(sequelize, newTarjetaId, t);
      const disponible = saldos.saldo_disponible
        + (newTarjetaId === compra.tarjeta_id && compra.estado === 'activa' ? parseFloat(compra.monto_total) : 0);
      if (!Number.isFinite(newMontoTotal) || newMontoTotal <= 0
        || !Number.isSafeInteger(newTotalCuotas) || newTotalCuotas <= 0
        || newMontoTotal > disponible) {
        await t.rollback();
        return res.status(422).json({ error: `Los datos nuevos deben ser válidos y no superar el disponible ($${disponible.toFixed(2)}).` });
      }

      await CuotaMensual.destroy({ where: { tasa_cero_id: compra.id }, transaction: t });

      const montoCuota = Math.round((newMontoTotal / newTotalCuotas) * 100) / 100;
      const fechas     = calcFechasPago(newFecha, tarjeta.dia_pago, newTotalCuotas);

      await CuotaMensual.bulkCreate(
        fechas.map((fecha, i) => ({
          tasa_cero_id:        compra.id,
          numero_cuota:        i + 1,
          monto_cuota:         i === newTotalCuotas - 1
            ? parseFloat((newMontoTotal - montoCuota * (newTotalCuotas - 1)).toFixed(2))
            : montoCuota,
          fecha_estimada_pago: fecha,
          estado:              'pendiente',
        })),
        { transaction: t }
      );

      await compra.update(
        { tarjeta_id: newTarjetaId, nombre: nombre ?? compra.nombre, monto_total: newMontoTotal, total_cuotas: newTotalCuotas, fecha_compra: newFecha },
        { transaction: t }
      );
    } else {
      // Solo actualizar nombre (seguro sin afectar cuotas)
      await compra.update({ nombre: nombre ?? compra.nombre }, { transaction: t });
    }

    await t.commit();

    const result = await CompraTasaCero.findByPk(compra.id, {
      include: [
        { model: Tarjeta,      as: 'tarjeta', attributes: ['id', 'nombre', 'banco', 'dia_pago'] },
        { model: CuotaMensual, as: 'cuotas',  order: [['numero_cuota', 'ASC']] },
      ],
    });
    res.json(result);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const destroyTasaCero = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const snapshot = await CompraTasaCero.findByPk(req.params.id, { transaction: t });
    if (!snapshot) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    const tarjetas = await bloquearRegistros(Tarjeta, [snapshot.tarjeta_id], t);
    const compra = await CompraTasaCero.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!compra) {
      await t.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    if (compra.tarjeta_id !== snapshot.tarjeta_id) {
      await t.rollback();
      return res.status(409).json({ error: 'La compra cambió durante la operación; vuelve a cargarla e inténtalo de nuevo.' });
    }
    if (!tarjetas.has(Number(compra.tarjeta_id))) {
      await t.rollback();
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }
    const cuotasPagadas = await CuotaMensual.count({
      where: { tasa_cero_id: compra.id, estado: 'pagada' },
      transaction: t,
    });
    if (cuotasPagadas > 0) {
      await t.rollback();
      return res.status(422).json({ error: `No se puede eliminar la compra: tiene ${cuotasPagadas} cuota(s) pagada(s).` });
    }
    await compra.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) {
    await t.rollback();
    if (err.message?.startsWith('No se puede eliminar')) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
};

module.exports = { indexNormales, storeNormal, updateNormal, destroyNormal, indexTasaCero, storeTasaCero, updateTasaCero, destroyTasaCero };
