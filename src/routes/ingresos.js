'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/ingresosController');

const router = Router();

// Sueldos
router.get('/sueldos',              ctrl.indexSueldos);
router.post('/sueldos',             ctrl.storeSueldo);
router.put('/sueldos/:id',          ctrl.updateSueldo);
router.delete('/sueldos/:id',       ctrl.destroySueldo);
router.post('/sueldos/:id/cobrar',  ctrl.cobrarSueldo);

// Inversiones
router.get('/inversiones',                 ctrl.indexInversiones);
router.post('/inversiones',                ctrl.storeInversion);
router.post('/inversiones/:id/vender',     ctrl.venderInversion);
router.delete('/inversiones/:id',          ctrl.destroyInversion);

module.exports = router;
