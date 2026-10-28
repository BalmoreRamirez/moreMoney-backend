'use strict';

const CHECKS = [
  ['cuentas', 'chk_cuentas_saldo_inicial_no_negativo', 'saldo_inicial >= 0'],
  ['tarjetas', 'chk_tarjetas_limite_no_negativo', 'limite_credito >= 0'],
  ['tarjetas', 'chk_tarjetas_dias_validos', 'dia_corte BETWEEN 1 AND 31 AND dia_pago BETWEEN 1 AND 31'],
  ['transacciones', 'chk_transacciones_monto_positivo', 'monto > 0'],
  ['compras_normales', 'chk_compras_normales_monto_positivo', 'monto > 0'],
  ['compras_tasa_cero', 'chk_compras_tasa_cero_valores_positivos', 'monto_total > 0 AND total_cuotas > 0'],
  ['cuotas_mensuales', 'chk_cuotas_mensuales_valores_validos', 'numero_cuota > 0 AND monto_cuota > 0'],
  ['sueldos', 'chk_sueldos_valores_validos', 'monto > 0 AND dia_cobro BETWEEN 1 AND 31'],
  ['cobros_sueldo', 'chk_cobros_sueldo_periodo_valido', 'mes BETWEEN 1 AND 12 AND anio > 0'],
  [
    'inversiones',
    'chk_inversiones_montos_validos',
    'costo_total > 0 AND (precio_esperado IS NULL OR precio_esperado >= 0) AND (precio_venta_total IS NULL OR precio_venta_total >= 0)',
  ],
  ['cobros_inversion', 'chk_cobros_inversion_monto_positivo', 'monto > 0'],
  [
    'prestamos',
    'chk_prestamos_valores_validos',
    'capital > 0 AND tasa_interes_mensual >= 0 AND (dias_duracion IS NULL OR dias_duracion > 0)',
  ],
  ['pagos_prestamo', 'chk_pagos_prestamo_monto_positivo', 'monto > 0'],
  [
    'creditos_recibidos',
    'chk_creditos_recibidos_valores_validos',
    'capital > 0 AND tasa_mensual >= 0 AND num_cuotas > 0',
  ],
  [
    'cuotas_credito',
    'chk_cuotas_credito_valores_validos',
    'numero_cuota > 0 AND capital_cuota >= 0 AND interes_cuota >= 0 AND monto_total_cuota > 0',
  ],
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, name, condition] of CHECKS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${condition})`,
          { transaction },
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, name] of [...CHECKS].reverse()) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`,
          { transaction },
        );
      }
    });
  },
};
