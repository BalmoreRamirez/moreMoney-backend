'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Tarjeta extends Model {
    static associate(models) {
      Tarjeta.hasMany(models.CompraNormal, {
        foreignKey: 'tarjeta_id',
        as: 'compras_normales',
      });
      Tarjeta.hasMany(models.CompraTasaCero, {
        foreignKey: 'tarjeta_id',
        as: 'compras_tasa_cero',
      });
      Tarjeta.belongsTo(models.Cuenta, {
        foreignKey: 'cuenta_pago_id',
        as: 'cuenta_pago',
      });
    }

    // Fórmula de saldo dinámico según reglas del negocio
    static async calcularSaldos(tarjetaId, models) {
      const { CompraNormal, CompraTasaCero, CuotaMensual } = models;
      const { Op, fn, col, literal } = require('sequelize');

      const [sumaNormales] = await CompraNormal.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('monto')), literal('0')), 'total']],
        where: { tarjeta_id: tarjetaId, estado: 'pendiente' },
        raw: true,
      });

      const [sumaTasaCero] = await CompraTasaCero.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('monto_total')), literal('0')), 'total']],
        where: { tarjeta_id: tarjetaId, estado: 'activa' },
        raw: true,
      });

      // Cuotas ya pagadas de compras tasa cero activas (reducen el saldo gastado)
      const [sumaCuotasPagadas] = await CuotaMensual.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('cuota_mensual.monto_cuota')), literal('0')), 'total']],
        where: { estado: 'pagada' },
        include: [
          {
            model: CompraTasaCero,
            as: 'compra_tasa_cero',
            attributes: [],
            where: { tarjeta_id: tarjetaId, estado: 'activa' },
            required: true,
          },
        ],
        raw: true,
      });

      const tarjeta = await Tarjeta.findByPk(tarjetaId);
      const normales = parseFloat(sumaNormales.total) || 0;
      const tasaCero = parseFloat(sumaTasaCero.total) || 0;
      const cuotasPagadas = parseFloat(sumaCuotasPagadas.total) || 0;

      const saldoGastado = normales + tasaCero - cuotasPagadas;
      const saldoDisponible = parseFloat(tarjeta.limite_credito) - saldoGastado;

      return {
        limite_credito: parseFloat(tarjeta.limite_credito),
        saldo_gastado: Math.max(0, saldoGastado),
        saldo_disponible: saldoDisponible,
      };
    }
  }

  Tarjeta.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      banco: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      limite_credito: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      dia_corte: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 31 },
      },
      dia_pago: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 31 },
      },
      cuenta_pago_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Tarjeta',
      tableName: 'tarjetas',
      underscored: true,
    }
  );

  // Restricción: no eliminar si tiene compras asociadas
  Tarjeta.addHook('beforeDestroy', async (tarjeta, options) => {
    const { CompraNormal, CompraTasaCero } = sequelize.models;

    const normales = await CompraNormal.count({ where: { tarjeta_id: tarjeta.id } });
    if (normales > 0) {
      throw new Error(
        `No se puede eliminar la tarjeta "${tarjeta.nombre}": tiene ${normales} compra(s) normal(es) registrada(s).`
      );
    }

    const tasaCero = await CompraTasaCero.count({ where: { tarjeta_id: tarjeta.id } });
    if (tasaCero > 0) {
      throw new Error(
        `No se puede eliminar la tarjeta "${tarjeta.nombre}": tiene ${tasaCero} compra(s) a tasa cero registrada(s).`
      );
    }
  });

  return Tarjeta;
};
