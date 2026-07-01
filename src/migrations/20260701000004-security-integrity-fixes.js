'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // C4: usuario_id en transacciones — idempotente (puede que ya exista si migración previa falló a medias)
    const [cols] = await queryInterface.sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'transacciones' AND column_name = 'usuario_id'`,
    );
    if (cols.length === 0) {
      await queryInterface.addColumn('transacciones', 'usuario_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    const [idxRows] = await queryInterface.sequelize.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'transacciones' AND indexname = 'idx_tx_usuario_id'`,
    );
    if (idxRows.length === 0) {
      await queryInterface.addIndex('transacciones', ['usuario_id'], {
        name: 'idx_tx_usuario_id',
      });
    }

    // A6: CHECK constraint en referencia_tipo — previene strings arbitrarios
    const [chkRows] = await queryInterface.sequelize.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'transacciones' AND constraint_name = 'chk_referencia_tipo'`,
    );
    if (chkRows.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE transacciones
          ADD CONSTRAINT chk_referencia_tipo
          CHECK (
            referencia_tipo IS NULL OR referencia_tipo IN (
              'manual', 'sueldo', 'pago_tarjeta', 'transferencia',
              'inversion', 'cobro_inversion', 'reversion',
              'credito_recibido', 'cuota_credito', 'prestamo'
            )
          )
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE transacciones DROP CONSTRAINT IF EXISTS chk_referencia_tipo`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS idx_tx_usuario_id`,
    );
    await queryInterface.removeColumn('transacciones', 'usuario_id');
  },
};
