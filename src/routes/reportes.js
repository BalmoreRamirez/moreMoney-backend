'use strict';

const router = require('express').Router();
const { getMensual, getFlujo } = require('../controllers/reportesController');

router.get('/mensual', getMensual);
router.get('/flujo',   getFlujo);

module.exports = router;
