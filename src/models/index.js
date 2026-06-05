'use strict';

require('dotenv').config();
const { Sequelize } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = dbConfig.use_env_variable
  ? new Sequelize(process.env[dbConfig.use_env_variable], {
      dialect: dbConfig.dialect,
      logging: false,
      define: dbConfig.define,
    })
  : new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
      host:    dbConfig.host,
      port:    dbConfig.port,
      dialect: dbConfig.dialect,
      logging: env === 'development' ? console.log : false,
      define:  dbConfig.define,
    });

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.Usuario = require('./usuario')(sequelize, Sequelize.DataTypes);
db.Tarjeta = require('./tarjeta')(sequelize, Sequelize.DataTypes);
db.CompraNormal = require('./compraNormal')(sequelize, Sequelize.DataTypes);
db.CompraTasaCero = require('./compraTasaCero')(sequelize, Sequelize.DataTypes);
db.CuotaMensual = require('./cuotaMensual')(sequelize, Sequelize.DataTypes);
db.Cuenta = require('./cuenta')(sequelize, Sequelize.DataTypes);
db.Transaccion = require('./transaccion')(sequelize, Sequelize.DataTypes);
db.Sueldo = require('./sueldo')(sequelize, Sequelize.DataTypes);
db.CobroSueldo = require('./cobroSueldo')(sequelize, Sequelize.DataTypes);
db.Inversion    = require('./inversion')(sequelize, Sequelize.DataTypes);
db.Prestamo     = require('./prestamo')(sequelize, Sequelize.DataTypes);
db.PagoPrestamo = require('./pagoPrestamo')(sequelize, Sequelize.DataTypes);

Object.values(db).forEach((model) => {
  if (model.associate) {
    model.associate(db);
  }
});

module.exports = db;
