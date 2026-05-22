'use strict';

const router = require('express').Router();
const { getCalendario, getDetallePago, confirmarPago } = require('../controllers/calendarioController');

router.get('/',               getCalendario);
router.get('/pago/detalle',   getDetallePago);
router.post('/pago/confirmar', confirmarPago);

module.exports = router;
