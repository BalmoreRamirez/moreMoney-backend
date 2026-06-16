'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual } = db;

function monthRange(year, month) {
  const lastDay     = new Date(year, month, 0).getDate();
  const paddedMonth = String(month).padStart(2, '0');
  return {
    fechaInicio: `${year}-${paddedMonth}-01`,
    fechaFin:    `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

// GET /api/reportes/mensual?year=YYYY&month=MM
const getMensual = async (req, res, next) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const { fechaInicio, fechaFin } = monthRange(year, month);

    const tarjetas = await Tarjeta.findAll({ order: [['nombre', 'ASC']] });

    const resumen = await Promise.all(tarjetas.map(async (t) => {
      const [normalesRows, cuotasRows] = await Promise.all([
        CompraNormal.findAll({
          where: { tarjeta_id: t.id, estado: 'pendiente' },
          attributes: ['monto'],
        }),
        CuotaMensual.findAll({
          where: { estado: 'pendiente', fecha_estimada_pago: { [Op.between]: [fechaInicio, fechaFin] } },
          include: [{
            model: CompraTasaCero, as: 'compra_tasa_cero',
            where: { tarjeta_id: t.id, estado: 'activa' }, required: true,
            attributes: ['id', 'nombre', 'total_cuotas'],
          }],
          attributes: ['monto_cuota', 'numero_cuota'],
        }),
      ]);

      const total_normales = normalesRows.reduce((s, c) => s + parseFloat(c.monto), 0);
      const total_cuotas   = cuotasRows.reduce((s, c) => s + parseFloat(c.monto_cuota), 0);

      return {
        tarjeta_id:      t.id,
        nombre:          t.nombre,
        banco:           t.banco,
        dia_pago:        t.dia_pago,
        total_normales,
        total_cuotas,
        total:           total_normales + total_cuotas,
        normales_count:  normalesRows.length,
        cuotas_detalle:  cuotasRows.map(c => ({
          nombre_compra: c.compra_tasa_cero.nombre,
          numero_cuota:  c.numero_cuota,
          total_cuotas:  c.compra_tasa_cero.total_cuotas,
          monto_cuota:   parseFloat(c.monto_cuota),
        })),
      };
    }));

    const grand_total = resumen.reduce((s, r) => s + r.total, 0);

    res.json({ year, month, resumen, grand_total });
  } catch (err) { next(err); }
};

module.exports = { getMensual };
