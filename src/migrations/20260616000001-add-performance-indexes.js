'use strict';

module.exports = {
  async up(queryInterface) {
    // transacciones — la tabla más consultada; filtra por cuenta_id, tipo y fecha
    await queryInterface.addIndex('transacciones', ['cuenta_id'],             { name: 'idx_tx_cuenta_id' });
    await queryInterface.addIndex('transacciones', ['cuenta_id', 'tipo'],     { name: 'idx_tx_cuenta_tipo' });
    await queryInterface.addIndex('transacciones', ['fecha'],                  { name: 'idx_tx_fecha' });
    await queryInterface.addIndex('transacciones', ['referencia_tipo', 'referencia_id'], { name: 'idx_tx_referencia' });

    // compras_normales — filtra por tarjeta_id y estado frecuentemente
    await queryInterface.addIndex('compras_normales', ['tarjeta_id'],          { name: 'idx_cn_tarjeta_id' });
    await queryInterface.addIndex('compras_normales', ['tarjeta_id', 'estado'],{ name: 'idx_cn_tarjeta_estado' });

    // compras_tasa_cero
    await queryInterface.addIndex('compras_tasa_cero', ['tarjeta_id'],         { name: 'idx_ctc_tarjeta_id' });
    await queryInterface.addIndex('compras_tasa_cero', ['tarjeta_id', 'estado'],{ name: 'idx_ctc_tarjeta_estado' });

    // cuotas_mensuales — filtra por tasa_cero_id, estado y fecha_estimada_pago
    await queryInterface.addIndex('cuotas_mensuales', ['tasa_cero_id'],        { name: 'idx_cm_tasa_cero_id' });
    await queryInterface.addIndex('cuotas_mensuales', ['estado', 'fecha_estimada_pago'], { name: 'idx_cm_estado_fecha' });

    // prestamos / pagos_prestamo
    await queryInterface.addIndex('prestamos',      ['cuenta_id'],             { name: 'idx_prest_cuenta_id' });
    await queryInterface.addIndex('prestamos',      ['estado'],                { name: 'idx_prest_estado' });
    await queryInterface.addIndex('pagos_prestamo', ['prestamo_id'],           { name: 'idx_pp_prestamo_id' });

    // creditos_recibidos / cuotas_credito
    await queryInterface.addIndex('creditos_recibidos', ['cuenta_id'],         { name: 'idx_cr_cuenta_id' });
    await queryInterface.addIndex('creditos_recibidos', ['estado'],            { name: 'idx_cr_estado' });
    await queryInterface.addIndex('cuotas_credito',     ['credito_id'],        { name: 'idx_cc_credito_id' });
    await queryInterface.addIndex('cuotas_credito',     ['credito_id', 'estado'], { name: 'idx_cc_credito_estado' });

    // inversiones / cobros_sueldo
    await queryInterface.addIndex('inversiones',    ['estado'],                { name: 'idx_inv_estado' });
    await queryInterface.addIndex('sueldos',        ['cuenta_id'],             { name: 'idx_sue_cuenta_id' });
  },

  async down(queryInterface) {
    const indexes = [
      ['transacciones',      'idx_tx_cuenta_id'],
      ['transacciones',      'idx_tx_cuenta_tipo'],
      ['transacciones',      'idx_tx_fecha'],
      ['transacciones',      'idx_tx_referencia'],
      ['compras_normales',   'idx_cn_tarjeta_id'],
      ['compras_normales',   'idx_cn_tarjeta_estado'],
      ['compras_tasa_cero',  'idx_ctc_tarjeta_id'],
      ['compras_tasa_cero',  'idx_ctc_tarjeta_estado'],
      ['cuotas_mensuales',   'idx_cm_tasa_cero_id'],
      ['cuotas_mensuales',   'idx_cm_estado_fecha'],
      ['prestamos',          'idx_prest_cuenta_id'],
      ['prestamos',          'idx_prest_estado'],
      ['pagos_prestamo',     'idx_pp_prestamo_id'],
      ['creditos_recibidos', 'idx_cr_cuenta_id'],
      ['creditos_recibidos', 'idx_cr_estado'],
      ['cuotas_credito',     'idx_cc_credito_id'],
      ['cuotas_credito',     'idx_cc_credito_estado'],
      ['inversiones',        'idx_inv_estado'],
      ['sueldos',            'idx_sue_cuenta_id'],
    ];
    for (const [table, name] of indexes) {
      await queryInterface.removeIndex(table, name);
    }
  },
};
