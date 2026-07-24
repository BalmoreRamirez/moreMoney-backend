'use strict';

const router = require('express').Router();
const { getMensual, getFlujo, getFlujoTarjetas, getHistorialTarjetas } = require('../controllers/reportesController');

router.get('/mensual',            getMensual);
router.get('/flujo',              getFlujo);
router.get('/flujo-tarjetas',     getFlujoTarjetas);
router.get('/historial-tarjetas', getHistorialTarjetas);

module.exports = router;
