'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Prestamo extends Model {
    static associate(models) {
      Prestamo.belongsTo(models.Cuenta,      { foreignKey: 'cuenta_id',   as: 'cuenta' });
      Prestamo.hasMany(models.PagoPrestamo,  { foreignKey: 'prestamo_id', as: 'pagos', onDelete: 'CASCADE' });
    }
  }

  Prestamo.init({
    id:                   { type: DataTypes.INTEGER,       primaryKey: true, autoIncrement: true },
    deudor_nombre:        { type: DataTypes.STRING,        allowNull: false, validate: { notEmpty: true } },
    deudor_contacto:      { type: DataTypes.STRING,        allowNull: true },
    capital:              { type: DataTypes.DECIMAL(10,2), allowNull: false, validate: { min: 0.01 } },
    tasa_interes_mensual: { type: DataTypes.DECIMAL(5,4),  allowNull: false, validate: { min: 0 } },
    fecha_inicio:         { type: DataTypes.DATEONLY,      allowNull: false },
    estado:               { type: DataTypes.ENUM('activo', 'pagado'), allowNull: false, defaultValue: 'activo' },
    cuenta_id:            { type: DataTypes.INTEGER,       allowNull: false },
  }, {
    sequelize,
    modelName: 'Prestamo',
    tableName:  'prestamos',
    underscored: true,
  });

  return Prestamo;
};
