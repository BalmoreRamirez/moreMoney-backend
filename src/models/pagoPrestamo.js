'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PagoPrestamo extends Model {
    static associate(models) {
      PagoPrestamo.belongsTo(models.Prestamo, { foreignKey: 'prestamo_id', as: 'prestamo' });
    }
  }

  PagoPrestamo.init({
    id:          { type: DataTypes.INTEGER,       primaryKey: true, autoIncrement: true },
    prestamo_id: { type: DataTypes.INTEGER,       allowNull: false },
    monto:       { type: DataTypes.DECIMAL(10,2), allowNull: false, validate: { min: 0.01 } },
    fecha_pago:  { type: DataTypes.DATEONLY,      allowNull: false },
    nota:        { type: DataTypes.STRING,        allowNull: true },
  }, {
    sequelize,
    modelName:   'PagoPrestamo',
    tableName:   'pagos_prestamo',
    underscored: true,
  });

  return PagoPrestamo;
};
