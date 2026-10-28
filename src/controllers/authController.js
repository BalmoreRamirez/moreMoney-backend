'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Usuario } = require('../models');

exports.login = async (req, res, next) => {
  try {
    const { usuario, contrasena } = req.body;

    if (typeof usuario !== 'string' || typeof contrasena !== 'string' || !usuario || !contrasena) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }
    if (usuario.length > 255 || Buffer.byteLength(contrasena, 'utf8') > 72) {
      return res.status(400).json({ error: 'Usuario o contraseña inválidos.' });
    }

    const user = await Usuario.findOne({
      where: { usuario },
    });

    const credencialesValidas = user && await bcrypt.compare(contrasena, user.contrasena);

    if (!credencialesValidas) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, correo: user.correo },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      token,
      usuario: { id: user.id, usuario: user.usuario, correo: user.correo },
    });
  } catch (err) {
    next(err);
  }
};
