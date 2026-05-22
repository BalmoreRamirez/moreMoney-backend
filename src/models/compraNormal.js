'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CompraNormal extends Model {
    static associate(models) {
      CompraNormal.belongsTo(models.Tarjeta, {
        foreignKey: 'tarjeta_id',
        as: 'tarjeta',
      });
    }
  }

  CompraNormal.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tarjeta_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      monto: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0.01 },
      },
      fecha_compra: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      estado: {
        type: DataTypes.ENUM('pendiente', 'pagada'),
        allowNull: false,
        defaultValue: 'pendiente',
      },
    },
    {
      sequelize,
      modelName: 'CompraNormal',
      tableName: 'compras_normales',
      underscored: true,
    }
  );

  return CompraNormal;
};
