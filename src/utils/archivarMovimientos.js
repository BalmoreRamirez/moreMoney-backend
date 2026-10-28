'use strict';

const MAX_DESCRIPCION = 255;

async function archivarMovimientos(transacciones, { tipo, entidad, entidadId, transaction }) {
  const marca = ` [Ficha de ${entidad} #${entidadId} archivada]`;
  for (const transaccion of transacciones) {
    const descripcion = String(transaccion.descripcion || 'Movimiento financiero')
      .slice(0, MAX_DESCRIPCION - marca.length) + marca;
    await transaccion.update({
      referencia_tipo: tipo,
      referencia_id: null,
      descripcion,
    }, { transaction });
  }
}

module.exports = { archivarMovimientos };
