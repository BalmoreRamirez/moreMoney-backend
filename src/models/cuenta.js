'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Cuenta extends Model {
    static associate(models) {
      Cuenta.hasMany(models.Transaccion, {
        foreignKey: 'cuenta_id',
        as: 'transacciones',
      });
    }

    static async calcularSaldo(cuentaId, sequelizeInstance) {
      const [[row]] = await sequelizeInstance.query(
        `SELECT
           c.saldo_inicial,
           COALESCE(SUM(CASE WHEN t.tipo = 'ingreso' THEN t.monto ELSE 0 END), 0) AS total_ingresos,
           COALESCE(SUM(CASE WHEN t.tipo = 'egreso'  THEN t.monto ELSE 0 END), 0) AS total_egresos
         FROM cuentas c
         LEFT JOIN transacciones t ON t.cuenta_id = c.id
         WHERE c.id = :id
         GROUP BY c.id, c.saldo_inicial`,
        { replacements: { id: cuentaId } }
      );
      const saldoInicial = parseFloat(row.saldo_inicial);
      const ingresos     = parseFloat(row.total_ingresos);
      const egresos      = parseFloat(row.total_egresos);
      return {
        saldo_inicial:  saldoInicial,
        total_ingresos: ingresos,
        total_egresos:  egresos,
        saldo_actual:   saldoInicial + ingresos - egresos,
      };
    }
  }

  Cuenta.init(
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
      tipo: {
        type: DataTypes.ENUM('banco', 'efectivo', 'digital'),
        allowNull: false,
      },
      saldo_inicial: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
    },
    {
      sequelize,
      modelName: 'Cuenta',
      tableName: 'cuentas',
      underscored: true,
    }
  );

  Cuenta.addHook('beforeDestroy', async (cuenta) => {
    const count = await sequelize.models.Transaccion.count({
      where: { cuenta_id: cuenta.id },
    });
    if (count > 0) {
      throw new Error(
        `No se puede eliminar la cuenta "${cuenta.nombre}": tiene ${count} transacción(es) registrada(s).`
      );
    }
  });

  return Cuenta;
};
