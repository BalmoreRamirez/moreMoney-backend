'use strict';

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const { sequelize } = require('./models');
const authMiddleware = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',       require('./routes/auth'));

app.use('/api/tarjetas',     authMiddleware, require('./routes/tarjetas'));
app.use('/api/compras',      authMiddleware, require('./routes/compras'));
app.use('/api/calendario',   authMiddleware, require('./routes/calendario'));
app.use('/api/reportes',     authMiddleware, require('./routes/reportes'));
app.use('/api/cuentas',      authMiddleware, require('./routes/cuentas'));
app.use('/api/ingresos',     authMiddleware, require('./routes/ingresos'));
app.use('/api/egresos',      authMiddleware, require('./routes/egresos'));
app.use('/api/prestamos',    authMiddleware, require('./routes/prestamos'));
app.use('/api/creditos',     authMiddleware, require('./routes/creditos'));

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
