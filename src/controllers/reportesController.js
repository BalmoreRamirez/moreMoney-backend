'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { Tarjeta, CompraNormal, CompraTasaCero, CuotaMensual, sequelize } = db;

// GET /api/reportes/flujo-tarjetas?periodo=dia|semana|mes|anio
const getFlujoTarjetas = async (req, res, next) => {
  try {
    const periodo = req.query.periodo || 'mes';

    const MAP_COMPRAS = {
      dia:    { where: `fecha_compra >= CURRENT_DATE - INTERVAL '29 days'`,                       group: `fecha_compra::text`,                                    order: `1` },
      semana: { where: `fecha_compra >= CURRENT_DATE - INTERVAL '83 days'`,                       group: `TO_CHAR(DATE_TRUNC('week',fecha_compra),'IYYY-IW')`,    order: `1` },
      mes:    { where: `fecha_compra >= DATE_TRUNC('month',CURRENT_DATE) - INTERVAL '11 months'`, group: `TO_CHAR(fecha_compra,'YYYY-MM')`,                        order: `1` },
      anio:   { where: `fecha_compra >= DATE_TRUNC('year',CURRENT_DATE) - INTERVAL '4 years'`,    group: `EXTRACT(YEAR FROM fecha_compra)::int::text`,             order: `1` },
    };
    const MAP_CUOTAS = {
      dia:    { where: `fecha_estimada_pago >= CURRENT_DATE - INTERVAL '29 days'`,                       group: `fecha_estimada_pago::text`,                                    order: `1` },
      semana: { where: `fecha_estimada_pago >= CURRENT_DATE - INTERVAL '83 days'`,                       group: `TO_CHAR(DATE_TRUNC('week',fecha_estimada_pago),'IYYY-IW')`,    order: `1` },
      mes:    { where: `fecha_estimada_pago >= DATE_TRUNC('month',CURRENT_DATE) - INTERVAL '11 months'`, group: `TO_CHAR(fecha_estimada_pago,'YYYY-MM')`,                        order: `1` },
      anio:   { where: `fecha_estimada_pago >= DATE_TRUNC('year',CURRENT_DATE) - INTERVAL '4 years'`,    group: `EXTRACT(YEAR FROM fecha_estimada_pago)::int::text`,             order: `1` },
    };

    const cfgC = MAP_COMPRAS[periodo];
    const cfgQ = MAP_CUOTAS[periodo];
    if (!cfgC) return res.status(422).json({ error: 'Periodo inválido. Usa: dia, semana, mes, anio' });

    const [serie] = await sequelize.query(`
      SELECT label, SUM(egresos)::numeric AS egresos
      FROM (
        SELECT
          ${cfgC.group} AS label,
          COALESCE(SUM(monto::numeric), 0) AS egresos
        FROM compras_normales
        WHERE ${cfgC.where}
        GROUP BY ${cfgC.group}

        UNION ALL

        SELECT
          ${cfgQ.group} AS label,
          COALESCE(SUM(monto_cuota::numeric), 0) AS egresos
        FROM cuotas_mensuales
        WHERE ${cfgQ.where}
        GROUP BY ${cfgQ.group}
      ) combined
      GROUP BY label
      ORDER BY label
    `);

    res.json({
      periodo,
      serie: serie.map(r => ({
        label:    r.label,
        ingresos: 0,
        egresos:  parseFloat(r.egresos),
      })),
    });
  } catch (err) { next(err); }
};

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

// GET /api/reportes/flujo?periodo=dia|semana|mes|anio
const getFlujo = async (req, res, next) => {
  try {
    const periodo = req.query.periodo || 'mes';

    const SQL_MAP = {
      dia:    { where: `fecha >= CURRENT_DATE - INTERVAL '29 days'`,                          group: `fecha::text`,                               order: `fecha::text` },
      semana: { where: `fecha >= CURRENT_DATE - INTERVAL '83 days'`,                          group: `TO_CHAR(DATE_TRUNC('week',fecha),'IYYY-IW')`, order: `TO_CHAR(DATE_TRUNC('week',fecha),'IYYY-IW')` },
      mes:    { where: `fecha >= DATE_TRUNC('month',CURRENT_DATE) - INTERVAL '11 months'`,    group: `TO_CHAR(fecha,'YYYY-MM')`,                   order: `TO_CHAR(fecha,'YYYY-MM')` },
      anio:   { where: `fecha >= DATE_TRUNC('year',CURRENT_DATE) - INTERVAL '4 years'`,       group: `EXTRACT(YEAR FROM fecha)::int::text`,         order: `EXTRACT(YEAR FROM fecha)` },
    };

    const cfg = SQL_MAP[periodo];
    if (!cfg) return res.status(422).json({ error: 'Periodo inválido. Usa: dia, semana, mes, anio' });

    const [serie] = await sequelize.query(`
      SELECT
        ${cfg.group} AS label,
        COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto::numeric ELSE 0 END),0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo='egreso'  THEN monto::numeric ELSE 0 END),0) AS egresos
      FROM transacciones
      WHERE ${cfg.where}
      GROUP BY ${cfg.group}
      ORDER BY ${cfg.order}
    `);

    const [categorias] = await sequelize.query(`
      SELECT
        COALESCE(referencia_tipo,'otro') AS categoria,
        COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto::numeric ELSE 0 END),0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo='egreso'  THEN monto::numeric ELSE 0 END),0) AS egresos
      FROM transacciones
      WHERE ${cfg.where}
      GROUP BY referencia_tipo
      ORDER BY (COALESCE(SUM(CASE WHEN tipo='egreso'  THEN monto::numeric ELSE 0 END),0)
              + COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto::numeric ELSE 0 END),0)) DESC
    `);

    res.json({
      periodo,
      serie: serie.map(r => ({
        label:    r.label,
        ingresos: parseFloat(r.ingresos),
        egresos:  parseFloat(r.egresos),
      })),
      categorias: categorias.map(r => ({
        categoria: r.categoria,
        ingresos:  parseFloat(r.ingresos),
        egresos:   parseFloat(r.egresos),
      })),
    });
  } catch (err) { next(err); }
};

module.exports = { getMensual, getFlujo, getFlujoTarjetas };
