'use strict';

const bcrypt = require('bcryptjs');

const DEFAULT_USERNAME = 'balmore';
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD || 'moremoney123';
const LEGACY_PASSWORD_HASH = '$2b$10$zYpbg.SoICYWVAMeSUArbeN7uQSKuu.kPl7eVjIHrJ7y.uW0iJVmW';

module.exports = {
  async up(queryInterface) {
    const existingUsers = await queryInterface.select(null, 'usuarios', {
      where: { usuario: DEFAULT_USERNAME },
    });

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    if (existingUsers.length > 0) {
      if (existingUsers[0].contrasena === LEGACY_PASSWORD_HASH) {
        await queryInterface.bulkUpdate('usuarios', {
          contrasena: passwordHash,
          updated_at: new Date(),
        }, { usuario: DEFAULT_USERNAME });
      }
      return;
    }

    await queryInterface.bulkInsert('usuarios', [
      {
        usuario: DEFAULT_USERNAME,
        correo: 'balmore@gmail.com',
        contrasena: passwordHash,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('usuarios', {
      usuario: DEFAULT_USERNAME,
      correo: 'balmore@gmail.com',
    });
  },
};
