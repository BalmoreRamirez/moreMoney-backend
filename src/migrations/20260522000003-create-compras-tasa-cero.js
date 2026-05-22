'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('compras_tasa_cero', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      tarjeta_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'tarjetas',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      monto_total: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      total_cuotas: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      fecha_compra: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      estado: {
        type: Sequelize.ENUM('activa', 'finalizada'),
        allowNull: false,
        defaultValue: 'activa',
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('compras_tasa_cero');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_compras_tasa_cero_estado";');
  },
};
