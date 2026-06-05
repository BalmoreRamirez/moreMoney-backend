'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/egresosController');

const router = Router();

router.get('/',      ctrl.index);
router.post('/',     ctrl.store);
router.put('/:id',   ctrl.update);
router.delete('/:id', ctrl.destroy);

module.exports = router;
