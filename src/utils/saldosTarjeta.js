'use strict';

function resumirSaldosTarjeta({ limite_credito, sum_normales, sum_tasa_cero, sum_cuotas_pagadas }) {
  const limite = parseFloat(limite_credito);
  const gastado = parseFloat(sum_normales) + parseFloat(sum_tasa_cero) - parseFloat(sum_cuotas_pagadas);
  const saldo_gastado = Math.max(0, gastado);
  return { limite_credito: limite, saldo_gastado, saldo_disponible: limite - saldo_gastado };
}

async function calcularSaldosTarjeta(sequelize, tarjetaId, transaction = null) {
  const [[row]] = await sequelize.query(
    `SELECT
       t.limite_credito,
       COALESCE((SELECT SUM(cn.monto) FROM compras_normales cn
                 WHERE cn.tarjeta_id = :id AND cn.estado = 'pendiente'), 0) AS sum_normales,
       COALESCE((SELECT SUM(ctc.monto_total) FROM compras_tasa_cero ctc
                 WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa'), 0) AS sum_tasa_cero,
       COALESCE((SELECT SUM(cm.monto_cuota) FROM cuotas_mensuales cm
                 INNER JOIN compras_tasa_cero ctc ON cm.tasa_cero_id = ctc.id
                 WHERE ctc.tarjeta_id = :id AND ctc.estado = 'activa' AND cm.estado = 'pagada'), 0) AS sum_cuotas_pagadas
     FROM tarjetas t WHERE t.id = :id`,
    { replacements: { id: tarjetaId }, transaction },
  );

  if (!row) {
    const error = new Error('Tarjeta no encontrada');
    error.status = 404;
    throw error;
  }

  return resumirSaldosTarjeta(row);
}

module.exports = { calcularSaldosTarjeta, resumirSaldosTarjeta };
