'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tarjetas', 'cuenta_pago_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'cuentas', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('tarjetas', ['cuenta_pago_id'], {
      name: 'idx_tarjetas_cuenta_pago_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('tarjetas', 'idx_tarjetas_cuenta_pago_id');
    await queryInterface.removeColumn('tarjetas', 'cuenta_pago_id');
  },
};
