'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sueldos', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      nombre: { type: Sequelize.STRING, allowNull: false },
      monto:  { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      dia_cobro: { type: Sequelize.INTEGER, allowNull: false },
      cuenta_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'cuentas', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('cobros_sueldo', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      sueldo_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'sueldos', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      mes:         { type: Sequelize.INTEGER, allowNull: false },
      anio:        { type: Sequelize.INTEGER, allowNull: false },
      fecha_cobro: { type: Sequelize.DATEONLY, allowNull: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('cobros_sueldo', {
      fields: ['sueldo_id', 'mes', 'anio'],
      type: 'unique',
      name: 'cobros_sueldo_unique_mes_anio',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cobros_sueldo');
    await queryInterface.dropTable('sueldos');
  },
};
