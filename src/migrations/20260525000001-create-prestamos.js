'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('prestamos', {
      id:                   { type: Sequelize.INTEGER,         primaryKey: true, autoIncrement: true, allowNull: false },
      deudor_nombre:        { type: Sequelize.STRING,          allowNull: false },
      deudor_contacto:      { type: Sequelize.STRING,          allowNull: true },
      capital:              { type: Sequelize.DECIMAL(10, 2),  allowNull: false },
      tasa_interes_mensual: { type: Sequelize.DECIMAL(5, 4),   allowNull: false },
      fecha_inicio:         { type: Sequelize.DATEONLY,        allowNull: false },
      estado:               { type: Sequelize.ENUM('activo', 'pagado'), allowNull: false, defaultValue: 'activo' },
      cuenta_id:            { type: Sequelize.INTEGER,         allowNull: false,
                              references: { model: 'cuentas', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      created_at:           { type: Sequelize.DATE,            allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at:           { type: Sequelize.DATE,            allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('pagos_prestamo', {
      id:          { type: Sequelize.INTEGER,        primaryKey: true, autoIncrement: true, allowNull: false },
      prestamo_id: { type: Sequelize.INTEGER,        allowNull: false,
                     references: { model: 'prestamos', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      monto:       { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      fecha_pago:  { type: Sequelize.DATEONLY,       allowNull: false },
      nota:        { type: Sequelize.STRING,         allowNull: true },
      created_at:  { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at:  { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pagos_prestamo');
    await queryInterface.dropTable('prestamos');
  },
};
