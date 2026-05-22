'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CompraTasaCero extends Model {
    static associate(models) {
      CompraTasaCero.belongsTo(models.Tarjeta, {
        foreignKey: 'tarjeta_id',
        as: 'tarjeta',
      });
      CompraTasaCero.hasMany(models.CuotaMensual, {
        foreignKey: 'tasa_cero_id',
        as: 'cuotas',
        onDelete: 'CASCADE',
      });
    }
  }

  CompraTasaCero.init(
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
      monto_total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0.01 },
      },
      total_cuotas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      fecha_compra: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      estado: {
        type: DataTypes.ENUM('activa', 'finalizada'),
        allowNull: false,
        defaultValue: 'activa',
      },
    },
    {
      sequelize,
      modelName: 'CompraTasaCero',
      tableName: 'compras_tasa_cero',
      underscored: true,
    }
  );

  // Restricción: no eliminar si tiene al menos una cuota pagada
  CompraTasaCero.addHook('beforeDestroy', async (compra, options) => {
    const { CuotaMensual } = sequelize.models;

    const cuotasPagadas = await CuotaMensual.count({
      where: { tasa_cero_id: compra.id, estado: 'pagada' },
    });

    if (cuotasPagadas > 0) {
      throw new Error(
        `No se puede eliminar "${compra.nombre}": ya tiene ${cuotasPagadas} cuota(s) pagada(s).`
      );
    }
  });

  return CompraTasaCero;
};
