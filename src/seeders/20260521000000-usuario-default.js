'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('usuarios', [
      {
        id: 1,
        usuario: 'balmore',
        correo: 'balmore@gmail.com',
        // bcrypt hash de '1234567'
        contrasena: '$2b$10$zw37Dz.57MW/Hk2kzO7aPeIY8sl0rKN.ZGbCq70saowhdGvWfveQC',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('usuarios', { usuario: 'balmore' });
  },
};
