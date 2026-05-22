'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cuotas_mensuales', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      tasa_cero_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'compras_tasa_cero',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      numero_cuota: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      monto_cuota: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      fecha_estimada_pago: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      estado: {
        type: Sequelize.ENUM('pendiente', 'pagada'),
        allowNull: false,
        defaultValue: 'pendiente',
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
    await queryInterface.dropTable('cuotas_mensuales');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_cuotas_mensuales_estado";');
  },
};
