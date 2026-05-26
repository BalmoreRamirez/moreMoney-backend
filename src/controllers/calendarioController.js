'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, sequelize } = db;

function monthRange(year, month) {
  const lastDay     = new Date(year, month, 0).getDate();
  const paddedMonth = String(month).padStart(2, '0');
  return {
    lastDay,
    fechaInicio: `${year}-${paddedMonth}-01`,
    fechaFin:    `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

// Calcula el año/mes donde caerá el próximo pago real de una tarjeta
function nextPagoYearMonth(diaPago) {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth() + 1; // 1-indexed
  const d   = now.getDate();
  // Si el día de pago de este mes todavía no ha pasado, el próximo pago es este mes
  if (d <= diaPago) return { pagoYear: y, pagoMonth: m };
  // Si ya pasó, el próximo pago es el mes siguiente
  return m + 1 > 12
    ? { pagoYear: y + 1, pagoMonth: 1 }
    : { pagoYear: y,     pagoMonth: m + 1 };
}

// GET /api/calendario?year=YYYY&month=MM
const getCalendario = async (req, res, next) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const { lastDay, fechaInicio, fechaFin } = monthRange(year, month);

    const tarjetas = await Tarjeta.findAll({ order: [['nombre', 'ASC']] });

    const events = [];
    for (const t of tarjetas) {
      events.push({
        type:           'corte',
        day:            Math.min(t.dia_corte, lastDay),
        tarjeta_id:     t.id,
        tarjeta_nombre: t.nombre,
        banco:          t.banco,
      });

      const diaPago = Math.min(t.dia_pago, lastDay);

      // Compras normales pendientes del mes (según fecha_compra)
      const pendingNormales = await CompraNormal.count({
        where: {
          tarjeta_id: t.id,
          estado: 'pendiente',
          fecha_compra: { [Op.between]: [fechaInicio, fechaFin] },
        },
      });

      const cuotasEnMes = await CuotaMensual.count({
        where: { estado: 'pendiente', fecha_estimada_pago: { [Op.between]: [fechaInicio, fechaFin] } },
        include: [{
          model: CompraTasaCero, as: 'compra_tasa_cero',
          where: { tarjeta_id: t.id, estado: 'activa' }, required: true,
        }],
      });

      events.push({
        type:              'pago',
        day:               diaPago,
        tarjeta_id:        t.id,
        tarjeta_nombre:    t.nombre,
        banco:             t.banco,
        tiene_pendientes:  pendingNormales > 0 || cuotasEnMes > 0,
        pendientes_count:  pendingNormales + cuotasEnMes,
      });
    }

    res.json({ year, month, tarjetas, events });
  } catch (err) { next(err); }
};

// GET /api/calendario/pago/detalle?tarjeta_id=X&year=YYYY&month=MM
const getDetallePago = async (req, res, next) => {
  try {
    const { tarjeta_id, year, month } = req.query;
    if (!tarjeta_id || !year || !month) return res.status(400).json({ error: 'Faltan parámetros' });

    const tarjeta = await Tarjeta.findByPk(tarjeta_id);
    if (!tarjeta) return res.status(404).json({ error: 'Tarjeta no encontrada' });

    const yearInt = parseInt(year);
    const monthInt = parseInt(month);

    const { fechaInicio, fechaFin } = monthRange(yearInt, monthInt);

    // Compras normales pendientes del mes (según fecha_compra)
    const compras_normales = await CompraNormal.findAll({
      where: {
        tarjeta_id,
        estado: 'pendiente',
        fecha_compra: { [Op.between]: [fechaInicio, fechaFin] },
      },
      order: [['fecha_compra', 'ASC']],
    });

    const cuotas = await CuotaMensual.findAll({
      where: { estado: 'pendiente', fecha_estimada_pago: { [Op.between]: [fechaInicio, fechaFin] } },
      include: [{
        model: CompraTasaCero, as: 'compra_tasa_cero',
        where: { tarjeta_id, estado: 'activa' }, required: true,
        attributes: ['id', 'nombre', 'total_cuotas'],
      }],
      order: [['fecha_estimada_pago', 'ASC']],
    });

    const total_normales = compras_normales.reduce((s, c) => s + parseFloat(c.monto), 0);
    const total_cuotas   = cuotas.reduce((s, c) => s + parseFloat(c.monto_cuota), 0);

    res.json({ tarjeta, compras_normales, cuotas, total_normales, total_cuotas, total: total_normales + total_cuotas });
  } catch (err) { next(err); }
};

// POST /api/calendario/pago/confirmar
const confirmarPago = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { tarjeta_id, year, month } = req.body;
    if (!tarjeta_id || !year || !month) {
      await t.rollback();
      return res.status(400).json({ error: 'Faltan parámetros' });
    }

    const { fechaInicio, fechaFin } = monthRange(parseInt(year), parseInt(month));

    const [updatedNormales] = await CompraNormal.update(
      { estado: 'pagada' },
      {
        where: {
          tarjeta_id,
          estado: 'pendiente',
          fecha_compra: { [Op.between]: [fechaInicio, fechaFin] },
        },
        transaction: t,
      }
    );

    const cuotas = await CuotaMensual.findAll({
      where: { estado: 'pendiente', fecha_estimada_pago: { [Op.between]: [fechaInicio, fechaFin] } },
      include: [{
        model: CompraTasaCero, as: 'compra_tasa_cero',
        where: { tarjeta_id, estado: 'activa' }, required: true,
      }],
      transaction: t,
    });

    for (const cuota of cuotas) {
      await cuota.update({ estado: 'pagada' }, { transaction: t });

      const restantes = await CuotaMensual.count({
        where: { tasa_cero_id: cuota.tasa_cero_id, estado: 'pendiente' },
        transaction: t,
      });
      if (restantes === 0) {
        await CompraTasaCero.update(
          { estado: 'finalizada' },
          { where: { id: cuota.tasa_cero_id }, transaction: t }
        );
      }
    }

    await t.commit();

    const [[row]] = await sequelize.query(
      `SELECT t.limite_credito,
         COALESCE((SELECT SUM(cn.monto) FROM compras_normales cn WHERE cn.tarjeta_id = :id AND cn.estado = 'pendiente'), 0) AS sum_normales,
         COALESCE((SELECT SUM(ctc.monto_total) FROM compras_tasa_cero ctc WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa'), 0) AS sum_tasa_cero,
         COALESCE((SELECT SUM(cm.monto_cuota) FROM cuotas_mensuales cm INNER JOIN compras_tasa_cero ctc ON cm.tasa_cero_id = ctc.id WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa' AND cm.estado = 'pagada'), 0) AS sum_cuotas_pagadas
       FROM tarjetas t WHERE t.id = :id`,
      { replacements: { id: tarjeta_id } }
    );

    const limite  = parseFloat(row.limite_credito);
    const gastado = parseFloat(row.sum_normales) + parseFloat(row.sum_tasa_cero) - parseFloat(row.sum_cuotas_pagadas);

    res.json({
      ok: true,
      normales_pagadas: updatedNormales,
      cuotas_pagadas:   cuotas.length,
      saldos: {
        limite_credito:   limite,
        saldo_gastado:    Math.max(0, gastado),
        saldo_disponible: limite - Math.max(0, gastado),
      },
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

module.exports = { getCalendario, getDetallePago, confirmarPago };
