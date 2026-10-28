'use strict';

const db = require('../models');
const { Sueldo, CobroSueldo, Inversion, CobroInversion, Cuenta, Transaccion, sequelize } = db;
const { bloquearRegistros } = require('../utils/bloqueos');
const { archivarMovimientos } = require('../utils/archivarMovimientos');

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
  const t = await sequelize.transaction();
  try {
    const sueldo = await Sueldo.findByPk(req.params.id, {
      include: [{ model: CobroSueldo, as: 'cobros' }],
    });
    if (!sueldo) { await t.rollback(); return res.status(404).json({ error: 'Sueldo no encontrado' }); }

    // A2: Bloquear eliminación si ya tiene cobros registrados
    if (sueldo.cobros?.length) {
      await t.rollback();
      return res.status(422).json({ error: `No se puede eliminar "${sueldo.nombre}": tiene ${sueldo.cobros.length} cobro(s) registrado(s).` });
    }

    await sueldo.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) { await t.rollback(); next(err); }
};

// POST /api/ingresos/sueldos/:id/cobrar  { mes, anio, fecha_cobro? }
const cobrarSueldo = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sueldo = await Sueldo.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sueldo) { await t.rollback(); return res.status(404).json({ error: 'Sueldo no encontrado' }); }
    if (!sueldo.activo) { await t.rollback(); return res.status(422).json({ error: 'Este sueldo está inactivo.' }); }

    const { mes, anio } = req.body;
    if (!mes || !anio) { await t.rollback(); return res.status(422).json({ error: 'Se requieren mes y año.' }); }

    const yaExiste = await CobroSueldo.findOne({
      where: { sueldo_id: sueldo.id, mes, anio },
      transaction: t,
    });
    if (yaExiste) { await t.rollback(); return res.status(422).json({ error: `El sueldo ya fue marcado como cobrado en ${mes}/${anio}.` }); }

    const cuentas = await bloquearRegistros(Cuenta, [sueldo.cuenta_id], t);
    if (!cuentas.has(Number(sueldo.cuenta_id))) {
      await t.rollback();
      return res.status(404).json({ error: 'Cuenta de ingreso no encontrada.' });
    }

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
      usuario_id:      req.usuario?.id || null,
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

function mapInversion(json) {
  const costo         = parseFloat(json.costo_total);
  const venta         = json.precio_venta_total != null ? parseFloat(json.precio_venta_total) : null;
  const esperado      = json.precio_esperado    != null ? parseFloat(json.precio_esperado)    : null;
  const cobros        = json.cobros || [];
  const total_cobrado = parseFloat(cobros.reduce((s, c) => s + parseFloat(c.monto), 0).toFixed(2));
  const saldo_por_cobrar = esperado != null
    ? parseFloat((esperado - total_cobrado).toFixed(2))
    : null;
  return {
    ...json,
    total_cobrado,
    saldo_por_cobrar,
    ganancia:          venta    != null ? parseFloat((venta    - costo).toFixed(2)) : null,
    ganancia_esperada: esperado != null ? parseFloat((esperado - costo).toFixed(2)) : null,
  };
}

const indexInversiones = async (req, res, next) => {
  try {
    const { estado } = req.query;
    const where = {};
    if (estado) where.estado = estado;

    const inversiones = await Inversion.findAll({
      where,
      include: [
        { model: Cuenta,        as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta,        as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
        { model: CobroInversion, as: 'cobros', separate: true, order: [['fecha_cobro', 'ASC']] },
      ],
      order: [['fecha_compra', 'DESC']],
    });

    res.json({ data: inversiones.map((inv) => mapInversion(inv.toJSON())) });
  } catch (err) { next(err); }
};

const storeInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { nombre, costo_total, precio_esperado, fecha_compra, cuenta_egreso_id } = req.body;

    const cuentas = await bloquearRegistros(Cuenta, [cuenta_egreso_id], t);
    const cuenta = cuentas.get(Number(cuenta_egreso_id));
    if (!cuenta) { await t.rollback(); return res.status(404).json({ error: 'Cuenta de egreso no encontrada' }); }

    const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
    if (parseFloat(costo_total) > saldo_actual) {
      await t.rollback();
      return res.status(422).json({ error: `Saldo insuficiente. Disponible: $${saldo_actual.toFixed(2)}` });
    }

    const inv = await Inversion.create(
      { nombre, costo_total, precio_esperado: precio_esperado || null, fecha_compra, cuenta_egreso_id, estado: 'en_curso' },
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
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta, as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta, as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
      ],
    });
    res.status(201).json(mapInversion({ ...result.toJSON(), cobros: [] }));
  } catch (err) { await t.rollback(); next(err); }
};

// POST /api/ingresos/inversiones/:id/cobrar
const registrarCobro = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const inv = await Inversion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!inv)                    { await t.rollback(); return res.status(404).json({ error: 'Inversión no encontrada' }); }
    if (inv.estado === 'vendida'){ await t.rollback(); return res.status(422).json({ error: 'Esta inversión ya está completada.' }); }

    const { monto, cuenta_id, fecha_cobro, nota, es_pago_final } = req.body;
    if (!monto || !cuenta_id || !fecha_cobro) {
      await t.rollback();
      return res.status(422).json({ error: 'Se requieren monto, cuenta y fecha.' });
    }

    const cobro = await CobroInversion.create(
      { inversion_id: inv.id, monto, cuenta_id, fecha_cobro, nota: nota || null },
      { transaction: t },
    );

    await Transaccion.create({
      cuenta_id,
      tipo:            'ingreso',
      monto,
      descripcion:     `Cobro inversión: ${inv.nombre}`,
      fecha:           fecha_cobro,
      referencia_tipo: 'cobro_inversion',
      referencia_id:   cobro.id,
      usuario_id:      req.usuario?.id || null,
    }, { transaction: t });

    // Auto-completar
    const cobrosRegistrados = await CobroInversion.findAll({
      where: { inversion_id: inv.id },
      transaction: t,
    });
    const totalCobrado = cobrosRegistrados.reduce((s, c) => s + parseFloat(c.monto), 0);
    const precioEsperado = inv.precio_esperado != null ? parseFloat(inv.precio_esperado) : null;
    const completar = es_pago_final || (precioEsperado !== null && totalCobrado >= precioEsperado);

    if (completar) {
      await inv.update({
        estado:             'vendida',
        precio_venta_total: parseFloat(totalCobrado.toFixed(2)),
        cuenta_ingreso_id:  cuenta_id,
      }, { transaction: t });
    }

    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta,        as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta,        as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
        { model: CobroInversion, as: 'cobros', separate: true, order: [['fecha_cobro', 'ASC']] },
      ],
    });
    res.status(201).json(mapInversion(result.toJSON()));
  } catch (err) { await t.rollback(); next(err); }
};

const updateInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const inv = await Inversion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!inv) { await t.rollback(); return res.status(404).json({ error: 'Inversión no encontrada' }); }

    const { nombre, precio_esperado, fecha_compra } = req.body;
    // M6: Guardar fecha anterior antes de update (inv.fecha_compra cambia en memoria tras update)
    const fechaAnterior = inv.fecha_compra;
    await inv.update({ nombre, precio_esperado: precio_esperado || null, fecha_compra }, { transaction: t });

    if (fecha_compra && fecha_compra !== fechaAnterior) {
      await Transaccion.update(
        { fecha: fecha_compra },
        { where: { referencia_tipo: 'inversion', referencia_id: inv.id }, transaction: t }
      );
    }

    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta,         as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta,         as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
        { model: CobroInversion, as: 'cobros', separate: true, order: [['fecha_cobro', 'ASC']] },
      ],
    });
    res.json(mapInversion(result.toJSON()));
  } catch (err) { await t.rollback(); next(err); }
};

const resetearInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const inv = await Inversion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!inv) { await t.rollback(); return res.status(404).json({ error: 'Inversión no encontrada' }); }
    if (inv.estado !== 'vendida') { await t.rollback(); return res.status(422).json({ error: 'La inversión no está en estado vendida.' }); }

    const cobros = await CobroInversion.findAll({ where: { inversion_id: inv.id }, transaction: t });
    const cobroIds = cobros.map(c => c.id);
    if (cobroIds.length) {
      const cuentasAgrupadas = cobros.reduce((acumulado, cobro) => {
        acumulado[cobro.cuenta_id] = (acumulado[cobro.cuenta_id] || 0) + parseFloat(cobro.monto);
        return acumulado;
      }, {});
      const cuentas = await bloquearRegistros(Cuenta, Object.keys(cuentasAgrupadas), t);
      for (const [cuentaId, montoARevertir] of Object.entries(cuentasAgrupadas)) {
        const cuenta = cuentas.get(Number(cuentaId));
        const { saldo_actual } = await Cuenta.calcularSaldo(cuenta.id, sequelize, t);
        if (montoARevertir > saldo_actual + 0.001) {
          await t.rollback();
          return res.status(422).json({ error: 'No se puede restablecer la inversión: alguna cuenta no conserva los cobros que deben revertirse.' });
        }
      }
      await Transaccion.destroy({ where: { referencia_tipo: 'cobro_inversion', referencia_id: cobroIds }, transaction: t });
      await CobroInversion.destroy({ where: { id: cobroIds }, transaction: t });
    }

    await inv.update(
      { estado: 'en_curso', precio_venta_total: null, cuenta_ingreso_id: null, fecha_venta: null },
      { transaction: t },
    );
    await t.commit();

    const result = await Inversion.findByPk(inv.id, {
      include: [
        { model: Cuenta,         as: 'cuenta_egreso',  attributes: ['id', 'nombre'] },
        { model: Cuenta,         as: 'cuenta_ingreso', attributes: ['id', 'nombre'] },
        { model: CobroInversion, as: 'cobros', separate: true, order: [['fecha_cobro', 'ASC']] },
      ],
    });
    res.json(mapInversion(result.toJSON()));
  } catch (err) { await t.rollback(); next(err); }
};

const destroyInversion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const inv = await Inversion.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!inv) { await t.rollback(); return res.status(404).json({ error: 'Inversión no encontrada' }); }
    if (inv.estado === 'vendida') { await t.rollback(); return res.status(422).json({ error: 'No se puede eliminar una inversión ya vendida.' }); }
    const cobros = await CobroInversion.count({ where: { inversion_id: inv.id }, transaction: t });
    if (cobros > 0) { await t.rollback(); return res.status(422).json({ error: 'No se puede eliminar una inversión con cobros registrados.' }); }

    const movimientos = await Transaccion.findAll({
      where: { tipo: 'egreso', referencia_tipo: 'inversion', referencia_id: inv.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (movimientos.length === 0) {
      await t.rollback();
      return res.status(409).json({ error: 'No se puede eliminar: falta el movimiento contable asociado a la inversión. Revisa la integridad de la cuenta.' });
    }

    // Archivar conserva el egreso: borrar la ficha no reintegra el costo de la inversión.
    await archivarMovimientos(movimientos, {
      tipo: 'inversion_archivada', entidad: 'inversión', entidadId: inv.id, transaction: t,
    });

    await inv.destroy({ transaction: t });
    await t.commit();
    res.status(204).send();
  } catch (err) { await t.rollback(); next(err); }
};

module.exports = {
  indexSueldos, storeSueldo, updateSueldo, destroySueldo, cobrarSueldo,
  indexInversiones, storeInversion, updateInversion, resetearInversion, registrarCobro, destroyInversion,
};
