require('dotenv').config();

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
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    dialect:  'postgres',
  },
  production: {
    // Fly.io inyecta DATABASE_URL al adjuntar un Postgres app
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    define:  { underscored: true, timestamps: true },
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
    },
  },
};
