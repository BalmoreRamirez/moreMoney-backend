'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Transaccion extends Model {
    static associate(models) {
      Transaccion.belongsTo(models.Cuenta, {
        foreignKey: 'cuenta_id',
        as: 'cuenta',
      });
    }
  }

  Transaccion.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      cuenta_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      tipo: {
        type: DataTypes.ENUM('ingreso', 'egreso'),
        allowNull: false,
      },
      monto: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0.01 },
      },
      descripcion: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      referencia_tipo: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      referencia_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Transaccion',
      tableName: 'transacciones',
      underscored: true,
    }
  );

  return Transaccion;
};
