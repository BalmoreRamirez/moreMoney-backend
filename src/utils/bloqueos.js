'use strict';

/** Bloquea filas en orden estable para serializar movimientos financieros. */
async function bloquearRegistros(Model, ids, transaction) {
  const idsOrdenados = [...new Set(ids.map(Number))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);
  const registros = new Map();

  for (const id of idsOrdenados) {
    const registro = await Model.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (registro) registros.set(id, registro);
  }

  return registros;
}

module.exports = { bloquearRegistros };
