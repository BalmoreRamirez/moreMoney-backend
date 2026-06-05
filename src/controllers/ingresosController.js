'use strict';

const db = require('../models');
const { Sueldo, CobroSueldo, Inversion, Cuenta, Transaccion, sequelize } = db;

// ─── SUELDOS ────────────────────────────────────────────────────────────────

const indexSueldos = async (req, res, next) => {
  try {
    const sueldos = await Sueldo.findAll({
      include: [
        { model: Cuenta,      as: 'cuenta',  attributes: ['id', 'nombre', 'tipo'] },
        { model: CobroSueldo, as: 'cobros',  order: [['anio', 'DESC'], ['mes', 'DESC']] },
      ],
      order: [['created_at', 'DESC']],
    });
    res.json({ data: sueldos });
  } catch (err) { next(err); }
};

const storeSueldo = async (req, res, next) => {
  try {
    const { nombre, monto, dia_cobro, cuenta_id } = req.body;
    const sueldo = await Sueldo.create({ nombre, monto, dia_cobro, cuenta_id, activo: true });
    const result = await Sueldo.findByPk(sueldo.id, {
      include: [
        { model: Cuenta,      as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] },
        { model: CobroSueldo, as: 'cobros' },
      ],
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const updateSueldo = async (req, res, next) => {
  try {
    const sueldo = await Sueldo.findByPk(req.params.id);
    if (!sueldo) return res.status(404).json({ error: 'Sueldo no encontrado' });
    const { nombre, monto, dia_cobro, cuenta_id, activo } = req.body;
    await sueldo.update({ nombre, monto, dia_cobro, cuenta_id, activo });
    res.json(sueldo);
  } catch (err) { next(err); }
};

const destroySueldo = async (req, res, next) => {
  try {
    const sueldo = await Sueldo.findByPk(req.params.id);
    if (!sueldo) return res.status(404).json({ error: 'Sueldo no encontrado' });
    await sueldo.destroy();
    res.status(204).send();
  } catch (err) { next(err); }
};

// POST /api/ingresos/sueldos/:id/cobrar  { mes, anio, fecha_cobro? }
const cobrarSueldo = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sueldo = await Sueldo.findByPk(req.params.id, { include: [{ model: Cuenta, as: 'cuenta' }] });
    if (!sueldo) { await t.rollback(); return res.status(404).json({ error: 'Sueldo no encontrado' }); }
    if (!sueldo.activo) { await t.rollback(); return res.status(422).json({ error: 'Este sueldo está inactivo.' }); }

    const { mes, anio } = req.body;
    if (!mes || !anio) { await t.rollback(); return res.status(422).json({ error: 'Se requieren mes y año.' }); }

    const yaExiste = await CobroSueldo.findOne({ where: { sueldo_id: sueldo.id, mes, anio } });
    if (yaExiste) { await t.rollback(); return res.status(422).json({ error: `El sueldo ya fue marcado como cobrado en ${mes}/${anio}.` }); }

    const fecha = req.body.fecha_cobro || new Date().toISOString().split('T')[0];
    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    await CobroSueldo.create({ sueldo_id: sueldo.id, mes, anio, fecha_cobro: fecha }, { transaction: t });

    await Transaccion.create({
      cuenta_id:       sueldo.cuenta_id,
      tipo:            'ingreso',
      monto:           sueldo.monto,
      descripcion:     `${sueldo.nombre} — ${MESES[mes - 1]} ${anio}`,
      fecha:           fecha,
      referencia_tipo: 'sueldo',
      referencia_id:   sueldo.id,
    }, { transaction: t });

    await t.commit();

    const result = await Sueldo.findByPk(sueldo.id, {
      include: [
        { model: Cuenta,      as: 'cuenta', attributes: ['id', 'nombre', 'tipo'] },
        { model: CobroSueldo, as: 'cobros', order: [['anio', 'DESC'], ['mes', 'DESC']] },
      ],
    });
    res.json(result);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── INVERSIONES ────────────────────────────────────────────────────────────

const indexInversiones = async (req, res, next) => {
  try {
    const { estado } = req.query;
    const where = {};
    if (estado) where.estado = estado;

    const inversiones = await Inversion.findAll({
      where,
      include: [
        { model: Cuenta, as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta, as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
      ],
      order: [['fecha_compra', 'DESC']],
    });

    const data = inversiones.map((inv) => {
      const json    = inv.toJSON();
      const costo   = parseFloat(json.costo_total);
      const venta   = json.precio_venta_total != null ? parseFloat(json.precio_venta_total) : null;
      return { ...json, ganancia: venta != null ? venta - costo : null };
    });

    res.json({ data });
  } catch (err) { next(err); }
};

const storeInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { nombre, costo_total, fecha_compra, cuenta_egreso_id } = req.body;

    const cuenta = await Cuenta.findByPk(cuenta_egreso_id);
    if (!cuenta) { await t.rollback(); return res.status(404).json({ error: 'Cuenta de egreso no encontrada' }); }

    const inv = await Inversion.create(
      { nombre, costo_total, fecha_compra, cuenta_egreso_id, estado: 'en_curso' },
      { transaction: t }
    );

    await Transaccion.create({
      cuenta_id:       cuenta_egreso_id,
      tipo:            'egreso',
      monto:           costo_total,
      descripcion:     `Inversión: ${nombre}`,
      fecha:           fecha_compra,
      referencia_tipo: 'inversion',
      referencia_id:   inv.id,
    }, { transaction: t });

    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta, as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta, as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
      ],
    });
    res.status(201).json({ ...result.toJSON(), ganancia: null });
  } catch (err) { await t.rollback(); next(err); }
};

// POST /api/ingresos/inversiones/:id/vender  { precio_venta_total, fecha_venta, cuenta_ingreso_id }
const venderInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const inv = await Inversion.findByPk(req.params.id);
    if (!inv)                   { await t.rollback(); return res.status(404).json({ error: 'Inversión no encontrada' }); }
    if (inv.estado === 'vendida'){ await t.rollback(); return res.status(422).json({ error: 'Esta inversión ya fue vendida.' }); }

    const { precio_venta_total, fecha_venta, cuenta_ingreso_id } = req.body;

    const cuentaIngreso = await Cuenta.findByPk(cuenta_ingreso_id);
    if (!cuentaIngreso) { await t.rollback(); return res.status(404).json({ error: 'Cuenta de ingreso no encontrada' }); }

    const fechaVenta = fecha_venta || new Date().toISOString().split('T')[0];

    await inv.update(
      { precio_venta_total, fecha_venta: fechaVenta, cuenta_ingreso_id, estado: 'vendida' },
      { transaction: t }
    );

    await Transaccion.create({
      cuenta_id:       cuenta_ingreso_id,
      tipo:            'ingreso',
      monto:           precio_venta_total,
      descripcion:     `Venta inversión: ${inv.nombre}`,
      fecha:           fechaVenta,
      referencia_tipo: 'inversion',
      referencia_id:   inv.id,
    }, { transaction: t });

    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta, as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta, as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
      ],
    });
    const json    = result.toJSON();
    const ganancia = parseFloat(json.precio_venta_total) - parseFloat(json.costo_total);
    res.json({ ...json, ganancia });
  } catch (err) { await t.rollback(); next(err); }
};

const destroyInversion = async (req, res, next) => {
  try {
    const inv = await Inversion.findByPk(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Inversión no encontrada' });
    if (inv.estado === 'vendida') return res.status(422).json({ error: 'No se puede eliminar una inversión ya vendida.' });
    await inv.destroy();
    res.status(204).send();
  } catch (err) { next(err); }
};

module.exports = {
  indexSueldos, storeSueldo, updateSueldo, destroySueldo, cobrarSueldo,
  indexInversiones, storeInversion, venderInversion, destroyInversion,
};
