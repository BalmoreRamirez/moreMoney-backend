'use strict';

const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const [scheme, token, extra] = typeof authHeader === 'string' ? authHeader.trim().split(/\s+/) : [];

  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
    return res.status(401).json({ error: 'No autorizado: token requerido.' });
  }

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!Number.isInteger(req.usuario.id)) {
      return res.status(401).json({ error: 'No autorizado: token inválido o expirado.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'No autorizado: token inválido o expirado.' });
  }
};
