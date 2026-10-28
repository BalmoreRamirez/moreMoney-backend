require('dotenv').config();

const testDatabase = process.env.TEST_DB_DATABASE;
if (process.env.NODE_ENV === 'test' && !/^more_money_test(?:[_-][a-z0-9]+)*$/i.test(testDatabase || '')) {
  throw new Error('TEST_DB_DATABASE debe comenzar por more_money_test para proteger las bases de desarrollo y producción.');
}
if (process.env.NODE_ENV === 'test' && testDatabase === process.env.DB_DATABASE) {
  throw new Error('Las pruebas de integración no pueden usar la base configurada para desarrollo.');
}

module.exports = {
  development: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    dialect:  'postgres',
    define:   { underscored: true, timestamps: true },
  },
  test: {
    username: process.env.TEST_DB_USERNAME ?? process.env.DB_USERNAME,
    password: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD,
    database: testDatabase,
    host:     process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.TEST_DB_PORT) || parseInt(process.env.DB_PORT) || 5432,
    dialect:  'postgres',
  },
  production: {
    // Fly.io inyecta DATABASE_URL al adjuntar un Postgres app
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    define:  { underscored: true, timestamps: true },
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      },
    },
  },
};
