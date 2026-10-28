'use strict';

const MAX_CENTAVOS = 9_999_999_999; // DECIMAL(10, 2)

/** Convierte una cantidad de entrada a centavos sin redondeo implícito. */
function parsearCentavos(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(texto)) return null;

  const [unidades, fraccion = ''] = texto.split('.');
  const centavos = Number(unidades) * 100 + Number(fraccion.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS) return null;
  return centavos;
}

function aCentavos(valor) {
  const cantidad = Number(valor);
  return Number.isFinite(cantidad) ? Math.round(cantidad * 100) : NaN;
}

function desdeCentavos(centavos) {
  return centavos / 100;
}

module.exports = { parsearCentavos, aCentavos, desdeCentavos };
