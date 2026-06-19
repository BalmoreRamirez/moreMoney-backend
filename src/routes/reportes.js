'use strict';

const router = require('express').Router();
const { getMensual, getFlujo, getFlujoTarjetas } = require('../controllers/reportesController');

router.get('/mensual',        getMensual);
router.get('/flujo',          getFlujo);
router.get('/flujo-tarjetas', getFlujoTarjetas);

module.exports = router;
