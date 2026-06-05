'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/cuentasController');

const router = Router();

router.get('/stats', ctrl.dashboardStats);
router.get('/',    ctrl.index);
router.post('/',   ctrl.store);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.destroy);

router.get('/:id/transacciones',  ctrl.transacciones);
router.post('/:id/transacciones', ctrl.storeTransaccion);
router.delete('/transacciones/:id', ctrl.destroyTransaccion);

module.exports = router;
