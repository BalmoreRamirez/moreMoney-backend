'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CobroSueldo extends Model {
    static associate(models) {
      CobroSueldo.belongsTo(models.Sueldo, { foreignKey: 'sueldo_id', as: 'sueldo' });
    }
  }

  CobroSueldo.init({
    id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sueldo_id:   { type: DataTypes.INTEGER, allowNull: false },
    mes:         { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 12 } },
    anio:        { type: DataTypes.INTEGER, allowNull: false },
    fecha_cobro: { type: DataTypes.DATEONLY, allowNull: false },
  }, {
    sequelize,
    modelName: 'CobroSueldo',
    tableName: 'cobros_sueldo',
    underscored: true,
  });

  return CobroSueldo;
};
