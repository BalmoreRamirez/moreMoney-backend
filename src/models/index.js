'use strict';

require('dotenv').config();
const { Sequelize } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: env === 'development' ? console.log : false,
    define: dbConfig.define,
  }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.Tarjeta = require('./tarjeta')(sequelize, Sequelize.DataTypes);
db.CompraNormal = require('./compraNormal')(sequelize, Sequelize.DataTypes);
db.CompraTasaCero = require('./compraTasaCero')(sequelize, Sequelize.DataTypes);
db.CuotaMensual = require('./cuotaMensual')(sequelize, Sequelize.DataTypes);

Object.values(db).forEach((model) => {
  if (model.associate) {
    model.associate(db);
  }
});

module.exports = db;
