'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CreditoRecibido extends Model {
    static associate(models) {
      CreditoRecibido.belongsTo(models.Cuenta, { foreignKey: 'cuenta_id', as: 'cuenta' });
      CreditoRecibido.hasMany(models.CuotaCredito, { foreignKey: 'credito_id', as: 'cuotas', onDelete: 'CASCADE' });
    }
  }

  CreditoRecibido.init({
    id:             { type: DataTypes.INTEGER,        primaryKey: true, autoIncrement: true },
    nombre:         { type: DataTypes.STRING,         allowNull: false, validate: { notEmpty: true } },
    capital:        { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0.01 } },
    tipo_interes:   { type: DataTypes.ENUM('simple', 'compuesto'), allowNull: false },
    tasa_mensual:   { type: DataTypes.DECIMAL(6, 4),  allowNull: false, validate: { min: 0 } },
    num_cuotas:     { type: DataTypes.INTEGER,        allowNull: false, validate: { min: 1 } },
    fecha_inicio:   { type: DataTypes.DATEONLY,       allowNull: false },
    cuenta_id:      { type: DataTypes.INTEGER,        allowNull: false },
    proposito_tipo: { type: DataTypes.STRING,         allowNull: true },
    proposito_id:   { type: DataTypes.INTEGER,        allowNull: true },
    estado:         { type: DataTypes.ENUM('activo', 'pagado'), allowNull: false, defaultValue: 'activo' },
  }, {
    sequelize,
    modelName:   'CreditoRecibido',
    tableName:   'creditos_recibidos',
    underscored: true,
  });

  return CreditoRecibido;
};
