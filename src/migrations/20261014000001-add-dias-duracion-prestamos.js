'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('prestamos', 'dias_duracion', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'fecha_inicio',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('prestamos', 'dias_duracion');
  },
};
