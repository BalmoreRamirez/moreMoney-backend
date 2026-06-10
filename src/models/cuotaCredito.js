'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CuotaCredito extends Model {
    static associate(models) {
      CuotaCredito.belongsTo(models.CreditoRecibido, { foreignKey: 'credito_id', as: 'credito' });
    }
  }

  CuotaCredito.init({
    id:                { type: DataTypes.INTEGER,        primaryKey: true, autoIncrement: true },
    credito_id:        { type: DataTypes.INTEGER,        allowNull: false },
    numero_cuota:      { type: DataTypes.INTEGER,        allowNull: false },
    capital_cuota:     { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    interes_cuota:     { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    monto_total_cuota: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    fecha_estimada:    { type: DataTypes.DATEONLY,       allowNull: false },
    estado:            { type: DataTypes.ENUM('pendiente', 'pagada'), allowNull: false, defaultValue: 'pendiente' },
    fecha_pago:        { type: DataTypes.DATEONLY,       allowNull: true },
  }, {
    sequelize,
    modelName:   'CuotaCredito',
    tableName:   'cuotas_credito',
    underscored: true,
  });

  return CuotaCredito;
};
