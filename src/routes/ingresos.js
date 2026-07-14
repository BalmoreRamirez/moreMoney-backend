'use strict';

const { Router } = require('express');
const ctrl       = require('../controllers/ingresosController');
const ctrlManual = require('../controllers/ingresosManualController');

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
router.put('/inversiones/:id',             ctrl.updateInversion);
router.post('/inversiones/:id/resetear',   ctrl.resetearInversion);
router.post('/inversiones/:id/cobrar',     ctrl.registrarCobro);
router.delete('/inversiones/:id',          ctrl.destroyInversion);

// Otros ingresos (manuales)
router.get('/otros',        ctrlManual.index);
router.post('/otros',       ctrlManual.store);
router.put('/otros/:id',    ctrlManual.update);
router.delete('/otros/:id', ctrlManual.destroy);

module.exports = router;
