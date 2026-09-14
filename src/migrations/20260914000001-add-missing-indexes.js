'use strict';

module.exports = {
  async up(queryInterface) {
    // B3: Índice compuesto para queries del calendario que filtran por tarjeta y fecha
    await queryInterface.addIndex(
      'compras_normales',
      ['tarjeta_id', 'fecha_compra'],
      { name: 'idx_cn_tarjeta_fecha' }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('compras_normales', 'idx_cn_tarjeta_fecha');
  },
};
