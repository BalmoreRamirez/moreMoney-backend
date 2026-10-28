'use strict';

const bcrypt = require('bcryptjs');

const DEFAULT_USERNAME = 'balmore';
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD || 'moremoney123';
const LEGACY_PASSWORD_HASH = '$2b$10$zYpbg.SoICYWVAMeSUArbeN7uQSKuu.kPl7eVjIHrJ7y.uW0iJVmW';

module.exports = {
  async up(queryInterface) {
    const users = await queryInterface.select(null, 'usuarios', {
      where: { usuario: DEFAULT_USERNAME },
    });
    const user = users[0];

    if (!user || user.contrasena !== LEGACY_PASSWORD_HASH) return;

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await queryInterface.bulkUpdate('usuarios', {
      contrasena: passwordHash,
      updated_at: new Date(),
    }, { usuario: DEFAULT_USERNAME });
  },

  async down(queryInterface) {
    const users = await queryInterface.select(null, 'usuarios', {
      where: { usuario: DEFAULT_USERNAME },
    });
    const user = users[0];

    if (!user || !await bcrypt.compare(DEFAULT_PASSWORD, user.contrasena)) return;

    await queryInterface.bulkUpdate('usuarios', {
      contrasena: LEGACY_PASSWORD_HASH,
      updated_at: new Date(),
    }, { usuario: DEFAULT_USERNAME });
  },
};
