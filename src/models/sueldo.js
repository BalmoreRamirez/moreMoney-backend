'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Sueldo extends Model {
    static associate(models) {
      Sueldo.belongsTo(models.Cuenta, { foreignKey: 'cuenta_id', as: 'cuenta' });
      Sueldo.hasMany(models.CobroSueldo, { foreignKey: 'sueldo_id', as: 'cobros' });
    }
  }

  Sueldo.init({
    id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre:    { type: DataTypes.STRING, allowNull: false, validate: { notEmpty: true } },
    monto:     { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0.01 } },
    dia_cobro: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 31 } },
    cuenta_id: { type: DataTypes.INTEGER, allowNull: false },
    activo:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    sequelize,
    modelName: 'Sueldo',
    tableName: 'sueldos',
    underscored: true,
  });

  return Sueldo;
};
