'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('inversiones', {
      id:     { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      nombre: { type: Sequelize.STRING, allowNull: false },
      costo_total:        { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      precio_venta_total: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      fecha_compra: { type: Sequelize.DATEONLY, allowNull: false },
      fecha_venta:  { type: Sequelize.DATEONLY, allowNull: true },
      estado: {
        type: Sequelize.ENUM('en_curso', 'vendida'),
        allowNull: false,
        defaultValue: 'en_curso',
      },
      cuenta_egreso_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'cuentas', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      cuenta_ingreso_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'cuentas', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inversiones');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_inversiones_estado";');
  },
};
