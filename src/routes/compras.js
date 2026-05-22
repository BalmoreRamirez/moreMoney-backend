'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/comprasController');

const router = Router();

router.get('/normales',      ctrl.indexNormales);
router.post('/normales',     ctrl.storeNormal);
router.delete('/normales/:id', ctrl.destroyNormal);

router.get('/tasa-cero',       ctrl.indexTasaCero);
router.post('/tasa-cero',      ctrl.storeTasaCero);
router.delete('/tasa-cero/:id', ctrl.destroyTasaCero);

module.exports = router;
