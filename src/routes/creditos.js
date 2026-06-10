'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/creditosController');

const router = Router();

router.get('/',                              ctrl.index);
router.post('/',                             ctrl.store);
router.get('/:id',                           ctrl.show);
router.delete('/:id',                        ctrl.destroy);
router.post('/:id/cuotas/:cuotaId/pagar',    ctrl.pagarCuota);

module.exports = router;
