'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Inversion extends Model {
    static associate(models) {
      Inversion.belongsTo(models.Cuenta, { foreignKey: 'cuenta_egreso_id',  as: 'cuenta_egreso' });
      Inversion.belongsTo(models.Cuenta, { foreignKey: 'cuenta_ingreso_id', as: 'cuenta_ingreso' });
      Inversion.hasMany(models.CobroInversion, { foreignKey: 'inversion_id', as: 'cobros' });
    }
  }

  Inversion.init({
    id:                 { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre:             { type: DataTypes.STRING, allowNull: false, validate: { notEmpty: true } },
    costo_total:        { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0.01 } },
    precio_esperado:    { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    precio_venta_total: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    fecha_compra:       { type: DataTypes.DATEONLY, allowNull: false },
    fecha_venta:        { type: DataTypes.DATEONLY, allowNull: true },
    estado:             { type: DataTypes.ENUM('en_curso', 'vendida'), allowNull: false, defaultValue: 'en_curso' },
    cuenta_egreso_id:   { type: DataTypes.INTEGER, allowNull: false },
    cuenta_ingreso_id:  { type: DataTypes.INTEGER, allowNull: true },
  }, {
    sequelize,
    modelName: 'Inversion',
    tableName: 'inversiones',
    underscored: true,
  });

  return Inversion;
};
