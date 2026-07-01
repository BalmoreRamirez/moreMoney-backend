'use strict';

module.exports = {
  async up(queryInterface) {
    // 1. UNIQUE (tasa_cero_id, numero_cuota) en cuotas_mensuales
    await queryInterface.addConstraint('cuotas_mensuales', {
      fields: ['tasa_cero_id', 'numero_cuota'],
      type: 'unique',
      name: 'uq_cuotas_mensuales_tasa_cuota',
    });

    // 2. UNIQUE (credito_id, numero_cuota) en cuotas_credito
    await queryInterface.addConstraint('cuotas_credito', {
      fields: ['credito_id', 'numero_cuota'],
      type: 'unique',
      name: 'uq_cuotas_credito_credito_cuota',
    });

    // 3. Reparar FK cobros_inversion.cuenta_id — la original no tiene onDelete/onUpdate
    await queryInterface.sequelize.query(
      `ALTER TABLE cobros_inversion
       DROP CONSTRAINT IF EXISTS cobros_inversion_cuenta_id_fkey`
    );
    await queryInterface.addConstraint('cobros_inversion', {
      fields: ['cuenta_id'],
      type: 'foreign key',
      name: 'cobros_inversion_cuenta_id_fkey',
      references: { table: 'cuentas', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    // 4. Índice en cobros_inversion.cuenta_id (faltaba en migración de performance)
    await queryInterface.addIndex('cobros_inversion', ['cuenta_id'], {
      name: 'idx_ci_cuenta_id',
    });

    // 5. CHECK polimórfico en creditos_recibidos: ambos null o ambos con valor
    await queryInterface.sequelize.query(
      `ALTER TABLE creditos_recibidos
       ADD CONSTRAINT chk_proposito_ambos_o_ninguno
       CHECK (
         (proposito_tipo IS NULL AND proposito_id IS NULL) OR
         (proposito_tipo IS NOT NULL AND proposito_id IS NOT NULL)
       )`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE creditos_recibidos
       DROP CONSTRAINT IF EXISTS chk_proposito_ambos_o_ninguno`
    );
    await queryInterface.removeIndex('cobros_inversion', 'idx_ci_cuenta_id');
    await queryInterface.removeConstraint('cobros_inversion', 'cobros_inversion_cuenta_id_fkey');
    // Restaurar FK original sin onDelete/onUpdate
    await queryInterface.addConstraint('cobros_inversion', {
      fields: ['cuenta_id'],
      type: 'foreign key',
      name: 'cobros_inversion_cuenta_id_fkey',
      references: { table: 'cuentas', field: 'id' },
    });
    await queryInterface.removeConstraint('cuotas_credito',   'uq_cuotas_credito_credito_cuota');
    await queryInterface.removeConstraint('cuotas_mensuales', 'uq_cuotas_mensuales_tasa_cuota');
  },
};
