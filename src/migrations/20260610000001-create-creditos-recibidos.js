'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('creditos_recibidos', {
      id:             { type: Sequelize.INTEGER,        primaryKey: true, autoIncrement: true, allowNull: false },
      nombre:         { type: Sequelize.STRING,         allowNull: false },
      capital:        { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      tipo_interes:   { type: Sequelize.ENUM('simple', 'compuesto'), allowNull: false },
      tasa_mensual:   { type: Sequelize.DECIMAL(6, 4),  allowNull: false },
      num_cuotas:     { type: Sequelize.INTEGER,        allowNull: false },
      fecha_inicio:   { type: Sequelize.DATEONLY,       allowNull: false },
      cuenta_id:      { type: Sequelize.INTEGER,        allowNull: false,
                        references: { model: 'cuentas', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      proposito_tipo: { type: Sequelize.STRING,         allowNull: true },
      proposito_id:   { type: Sequelize.INTEGER,        allowNull: true },
      estado:         { type: Sequelize.ENUM('activo', 'pagado'), allowNull: false, defaultValue: 'activo' },
      created_at:     { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at:     { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('cuotas_credito', {
      id:               { type: Sequelize.INTEGER,        primaryKey: true, autoIncrement: true, allowNull: false },
      credito_id:       { type: Sequelize.INTEGER,        allowNull: false,
                          references: { model: 'creditos_recibidos', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      numero_cuota:     { type: Sequelize.INTEGER,        allowNull: false },
      capital_cuota:    { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      interes_cuota:    { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      monto_total_cuota: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      fecha_estimada:   { type: Sequelize.DATEONLY,       allowNull: false },
      estado:           { type: Sequelize.ENUM('pendiente', 'pagada'), allowNull: false, defaultValue: 'pendiente' },
      fecha_pago:       { type: Sequelize.DATEONLY,       allowNull: true },
      created_at:       { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at:       { type: Sequelize.DATE,           allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cuotas_credito');
    await queryInterface.dropTable('creditos_recibidos');
  },
};
