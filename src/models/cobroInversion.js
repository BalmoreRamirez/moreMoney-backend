'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CobroInversion extends Model {
    static associate(models) {
      CobroInversion.belongsTo(models.Inversion, { foreignKey: 'inversion_id', as: 'inversion' });
      CobroInversion.belongsTo(models.Cuenta,    { foreignKey: 'cuenta_id',    as: 'cuenta' });
    }
  }

  CobroInversion.init({
    id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    inversion_id: { type: DataTypes.INTEGER, allowNull: false },
    monto:        { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0.01 } },
    cuenta_id:    { type: DataTypes.INTEGER, allowNull: false },
    fecha_cobro:  { type: DataTypes.DATEONLY, allowNull: false },
    nota:         { type: DataTypes.STRING, allowNull: true },
  }, {
    sequelize,
    modelName: 'CobroInversion',
    tableName: 'cobros_inversion',
    underscored: true,
  });

  return CobroInversion;
};
