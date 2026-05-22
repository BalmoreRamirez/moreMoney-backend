'use strict';

const router = require('express').Router();
const { getMensual } = require('../controllers/reportesController');

router.get('/mensual', getMensual);

module.exports = router;
