'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CuotaMensual extends Model {
    static associate(models) {
      CuotaMensual.belongsTo(models.CompraTasaCero, {
        foreignKey: 'tasa_cero_id',
        as: 'compra_tasa_cero',
      });
    }
  }

  CuotaMensual.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tasa_cero_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      numero_cuota: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      monto_cuota: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0.01 },
      },
      fecha_estimada_pago: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      estado: {
        type: DataTypes.ENUM('pendiente', 'pagada'),
        allowNull: false,
        defaultValue: 'pendiente',
      },
      fecha_pago: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'CuotaMensual',
      tableName: 'cuotas_mensuales',
      underscored: true,
    }
  );

  return CuotaMensual;
};
