'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cobros_inversion', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      inversion_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'inversiones', key: 'id' },
        onDelete: 'CASCADE',
      },
      monto: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      cuenta_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cuentas', key: 'id' },
      },
      fecha_cobro: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      nota: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('cobros_inversion', ['inversion_id'], { name: 'idx_ci_inversion_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cobros_inversion');
  },
};
