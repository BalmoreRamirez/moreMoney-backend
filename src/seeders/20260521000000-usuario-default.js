'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('usuarios', [
      {
        id: 1,
        usuario: 'balmore',
        correo: 'balmore@gmail.com',
        // Cambiar contraseña en producción via UPDATE en BD directamente
        contrasena: '$2b$10$zYpbg.SoICYWVAMeSUArbeN7uQSKuu.kPl7eVjIHrJ7y.uW0iJVmW',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('usuarios', { usuario: 'balmore' });
  },
};
