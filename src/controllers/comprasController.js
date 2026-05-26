'use strict';

const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, sequelize } = db;

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
  try {
    const { tarjeta_id, nombre, monto, fecha_compra } = req.body;
    const compra = await CompraNormal.create({
      tarjeta_id, nombre, monto, fecha_compra, estado: 'pendiente',
    });
    res.status(201).json(compra);
  } catch (err) { next(err); }
};

const destroyNormal = async (req, res, next) => {
  try {
    const compra = await CompraNormal.findByPk(req.params.id);
    if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });
    await compra.destroy();
    res.status(204).send();
  } catch (err) { next(err); }
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

    const tarjeta = await Tarjeta.findByPk(tarjeta_id);
    if (!tarjeta) { await t.rollback(); return res.status(404).json({ error: 'Tarjeta no encontrada' }); }

    const compra = await CompraTasaCero.create(
      { tarjeta_id, nombre, monto_total, total_cuotas, fecha_compra, estado: 'activa' },
      { transaction: t }
    );

    const n         = parseInt(total_cuotas);
    const montoCuota = Math.round((parseFloat(monto_total) / n) * 100) / 100;
    const fechas    = calcFechasPago(fecha_compra, tarjeta.dia_pago, n);

    await CuotaMensual.bulkCreate(
      fechas.map((fecha, i) => ({
        tasa_cero_id:       compra.id,
        numero_cuota:       i + 1,
        monto_cuota:        montoCuota,
        fecha_estimada_pago: fecha,
        estado:             'pendiente',
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
    const compra = await CompraTasaCero.findByPk(req.params.id, {
      include: [{ model: CuotaMensual, as: 'cuotas' }],
    });
    if (!compra) { await t.rollback(); return res.status(404).json({ error: 'Compra no encontrada' }); }

    const { tarjeta_id, nombre, monto_total, total_cuotas, fecha_compra } = req.body;

    // Detectar si cambia algún campo financiero que afecte las cuotas
    const financialChanged =
      (tarjeta_id   !== undefined && parseInt(tarjeta_id)       !== compra.tarjeta_id)   ||
      (monto_total  !== undefined && parseFloat(monto_total)    !== parseFloat(compra.monto_total)) ||
      (total_cuotas !== undefined && parseInt(total_cuotas)     !== compra.total_cuotas)  ||
      (fecha_compra !== undefined && fecha_compra               !== compra.fecha_compra);

    if (financialChanged) {
      const cuotasPagadas = compra.cuotas.filter(c => c.estado === 'pagada').length;
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

      const tarjeta = await Tarjeta.findByPk(newTarjetaId, { transaction: t });
      if (!tarjeta) { await t.rollback(); return res.status(404).json({ error: 'Tarjeta no encontrada' }); }

      await CuotaMensual.destroy({ where: { tasa_cero_id: compra.id }, transaction: t });

      const montoCuota = Math.round((newMontoTotal / newTotalCuotas) * 100) / 100;
      const fechas     = calcFechasPago(newFecha, tarjeta.dia_pago, newTotalCuotas);

      await CuotaMensual.bulkCreate(
        fechas.map((fecha, i) => ({
          tasa_cero_id:        compra.id,
          numero_cuota:        i + 1,
          monto_cuota:         montoCuota,
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
  try {
    const compra = await CompraTasaCero.findByPk(req.params.id);
    if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });
    await compra.destroy(); // hook beforeDestroy valida cuotas pagadas
    res.status(204).send();
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
};

module.exports = { indexNormales, storeNormal, destroyNormal, indexTasaCero, storeTasaCero, updateTasaCero, destroyTasaCero };
