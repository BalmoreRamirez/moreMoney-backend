'use strict';

const REFERENCIAS = [
  'manual', 'sueldo', 'pago_tarjeta', 'transferencia',
  'inversion', 'cobro_inversion', 'reversion',
  'credito_recibido', 'cuota_credito', 'prestamo', 'pago_prestamo',
  'prestamo_archivado', 'inversion_archivada',
];

const REFERENCIAS_PREVIAS = REFERENCIAS.filter((tipo) => !tipo.endsWith('_archivada') && tipo !== 'prestamo_archivado');

async function crearRestriccion(queryInterface, referencias, transaction) {
  const valores = referencias.map((tipo) => `'${tipo}'`).join(', ');
  await queryInterface.sequelize.query(`
    ALTER TABLE transacciones
    ADD CONSTRAINT chk_referencia_tipo
    CHECK (referencia_tipo IS NULL OR referencia_tipo IN (${valores}))
  `, { transaction });
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'ALTER TABLE transacciones DROP CONSTRAINT IF EXISTS chk_referencia_tipo',
        { transaction },
      );
      const valores = REFERENCIAS.map((tipo) => `'${tipo}'`).join(', ');
      await queryInterface.sequelize.query(`
        ALTER TABLE transacciones
        ADD CONSTRAINT chk_referencia_tipo
        CHECK (referencia_tipo IS NULL OR referencia_tipo IN (${valores}))
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT COUNT(*) AS total FROM transacciones
         WHERE referencia_tipo IN ('prestamo_archivado', 'inversion_archivada')`,
        { transaction },
      );
      if (Number(rows[0].total) > 0) {
        throw new Error('No se puede revertir: existen movimientos financieros archivados.');
      }
      await queryInterface.sequelize.query(
        'ALTER TABLE transacciones DROP CONSTRAINT IF EXISTS chk_referencia_tipo',
        { transaction },
      );
      await crearRestriccion(queryInterface, REFERENCIAS_PREVIAS, transaction);
    });
  },
};
