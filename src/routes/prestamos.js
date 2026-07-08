'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/prestamosController');

const router = Router();

router.get('/',                ctrl.index);
router.post('/',               ctrl.store);
router.get('/:id',             ctrl.show);
router.put('/:id',             ctrl.update);
router.delete('/:id',          ctrl.destroy);
router.post('/:id/abono',                  ctrl.registrarAbono);
router.put('/:id/abono/:abonoId',          ctrl.updateAbono);
router.delete('/:id/abono/:abonoId',       ctrl.destroyAbono);
router.post('/:id/pagar',                  ctrl.marcarPagado);

module.exports = router;
