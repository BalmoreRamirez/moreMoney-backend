'use strict';

require('dotenv').config();

// A4: Abortar si JWT_SECRET no está configurado o es demasiado corto
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET no configurado o inseguro (mínimo 32 caracteres). Abortando.');
  process.exit(1);
}

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const { sequelize } = require('./models');
const authMiddleware = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// A5: Cabeceras de seguridad HTTP (configurado para API REST, sin CSP que no aplica a JSON)
app.use(helmet({
  contentSecurityPolicy:        false,
  crossOriginResourcePolicy:    { policy: 'cross-origin' },
  crossOriginOpenerPolicy:      false,
  crossOriginEmbedderPolicy:    false,
}));

app.use(compression());

// Define solo el número de proxies confiables del entorno de despliegue.
if (process.env.TRUST_PROXY_HOPS !== undefined) {
  const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS debe ser un entero igual o mayor que cero.');
  }
  app.set('trust proxy', trustProxyHops);
}

// C2: CORS restringido al origen del frontend
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));

// C3: Rate limiting solo en /api/auth — máx 10 intentos cada 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' },
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', loginLimiter, require('./routes/auth'));

app.use('/api/tarjetas',     authMiddleware, require('./routes/tarjetas'));
app.use('/api/compras',      authMiddleware, require('./routes/compras'));
app.use('/api/calendario',   authMiddleware, require('./routes/calendario'));
app.use('/api/reportes',     authMiddleware, require('./routes/reportes'));
app.use('/api/cuentas',      authMiddleware, require('./routes/cuentas'));
app.use('/api/ingresos',     authMiddleware, require('./routes/ingresos'));
app.use('/api/egresos',      authMiddleware, require('./routes/egresos'));
app.use('/api/prestamos',    authMiddleware, require('./routes/prestamos'));
app.use('/api/creditos',     authMiddleware, require('./routes/creditos'));

app.use((err, _req, res, _next) => {
  const mappedErrors = {
    SequelizeValidationError: { status: 422, message: 'Los datos no cumplen las reglas de validación.' },
    SequelizeUniqueConstraintError: { status: 409, message: 'Ya existe un registro con esos datos.' },
    SequelizeForeignKeyConstraintError: { status: 409, message: 'La operación contradice una relación existente.' },
  };
  const mapped = mappedErrors[err.name];
  const status = mapped?.status || (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500);

  if (status >= 500) {
    console.error({ name: err.name, stack: err.stack });
  }

  const message = mapped?.message || (status >= 500 ? 'Error interno del servidor.' : err.message);
  res.status(status).json({ error: message });
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
