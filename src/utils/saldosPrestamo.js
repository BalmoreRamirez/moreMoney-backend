'use strict';

function calcularSaldoPrestamo(prestamo, pagos) {
  const capital = parseFloat(prestamo.capital);
  const tasa = parseFloat(prestamo.tasa_interes_mensual);
  const interes_generado = parseFloat((capital * tasa).toFixed(2));
  const total_deuda = parseFloat((capital + interes_generado).toFixed(2));
  const total_pagado = parseFloat(pagos.reduce((s, pago) => s + parseFloat(pago.monto), 0).toFixed(2));
  const saldo_pendiente = parseFloat((total_deuda - total_pagado).toFixed(2));
  const ganancia = parseFloat((total_pagado - capital).toFixed(2));

  return { interes_generado, total_deuda, total_pagado, saldo_pendiente, ganancia };
}

module.exports = { calcularSaldoPrestamo };
