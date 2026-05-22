'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/tarjetas',   require('./routes/tarjetas'));
app.use('/api/compras',    require('./routes/compras'));
app.use('/api/calendario', require('./routes/calendario'));
app.use('/api/reportes',   require('./routes/reportes'));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

sequelize.authenticate()
  .then(() => {
    console.log('BD conectada correctamente.');
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Error al conectar la BD:', err);
    process.exit(1);
  });
