'use strict';

require('dotenv').config();

const databaseName = process.env.TEST_DB_DATABASE;
if (!/^more_money_test(?:[_-][a-z0-9]+)*$/i.test(databaseName || '')) {
  throw new Error('Usa TEST_DB_DATABASE con un nombre aislado que comience por more_money_test.');
}
if (databaseName === process.env.DB_DATABASE) {
  throw new Error('La base de integración debe ser distinta de la base de desarrollo.');
}

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const {
  Cuenta,
  Transaccion,
  Tarjeta,
  CompraNormal,
  Sueldo,
  CobroSueldo,
  Prestamo,
  PagoPrestamo,
  CreditoRecibido,
  CuotaCredito,
  CompraTasaCero,
  CuotaMensual,
  CobroInversion,
  Inversion,
  sequelize,
} = db;

const cuentasController = require('../src/controllers/cuentasController');
const egresosController = require('../src/controllers/egresosController');
const ingresosManualController = require('../src/controllers/ingresosManualController');
const comprasController = require('../src/controllers/comprasController');
const ingresosController = require('../src/controllers/ingresosController');
const prestamosController = require('../src/controllers/prestamosController');
const creditosController = require('../src/controllers/creditosController');
const tarjetasController = require('../src/controllers/tarjetasController');
const calendarioController = require('../src/controllers/calendarioController');

function invocar(handler, { body = {}, params = {}, query = {}, usuario = null } = {}) {
  return new Promise((resolve, reject) => {
    let status = 200;
    let terminado = false;
    const terminar = (resultado) => {
      if (terminado) return;
      terminado = true;
      resolve({ status, ...resultado });
    };
    const res = {
      status(codigo) { status = codigo; return this; },
      json(data) { terminar({ data }); return this; },
      send(data) { terminar({ data }); return this; },
      end(data) { terminar({ data }); return this; },
    };
    const next = (error) => {
      if (terminado) return;
      terminado = true;
      reject(error);
    };
    Promise.resolve(handler({ body, params, query, usuario }, res, next)).catch(next);
  });
}

async function crearCuenta(saldo_inicial = 0) {
  return Cuenta.create({
    nombre: `IT ${Date.now()} ${Math.random()}`,
    tipo: 'banco',
    saldo_inicial,
  });
}

async function borrarTransaccionesDeCuenta(cuentaId) {
  await Transaccion.destroy({ where: { cuenta_id: cuentaId } });
}

test.before(async () => {
  await sequelize.authenticate();
});

after(async () => {
  await sequelize.close();
});

test('dos egresos concurrentes no pueden gastar dos veces el mismo saldo', async (t) => {
  const cuenta = await crearCuenta(100);
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await cuenta.destroy();
  });

  const req = () => ({ body: {
    cuenta_id: cuenta.id,
    monto: 80,
    descripcion: 'Prueba de débito concurrente',
    fecha: '2026-10-28',
  } });
  const resultados = await Promise.all([
    invocar(egresosController.store, req()),
    invocar(egresosController.store, req()),
  ]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [201, 422]);
  const saldo = await Cuenta.calcularSaldo(cuenta.id, sequelize);
  assert.equal(saldo.saldo_actual, 20);
  assert.equal(await Transaccion.count({ where: { cuenta_id: cuenta.id, tipo: 'egreso' } }), 1);
});

test('dos compras concurrentes no pueden exceder el límite de la tarjeta', async (t) => {
  const tarjeta = await Tarjeta.create({
    nombre: `IT tarjeta ${Date.now()}`,
    banco: 'Pruebas',
    limite_credito: 100,
    dia_corte: 15,
    dia_pago: 28,
  });
  t.after(async () => {
    await CompraNormal.destroy({ where: { tarjeta_id: tarjeta.id } });
    await tarjeta.destroy();
  });

  const req = () => ({ body: {
    tarjeta_id: tarjeta.id,
    nombre: 'Compra concurrente',
    monto: 80,
    fecha_compra: '2026-10-28',
  } });
  const resultados = await Promise.all([
    invocar(comprasController.storeNormal, req()),
    invocar(comprasController.storeNormal, req()),
  ]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [201, 422]);
  const compras = await CompraNormal.findAll({ where: { tarjeta_id: tarjeta.id } });
  assert.equal(compras.length, 1);
  assert.equal(parseFloat(compras[0].monto), 80);
});

test('dos solicitudes concurrentes solo cobran una vez el mismo sueldo y periodo', async (t) => {
  const cuenta = await crearCuenta();
  const sueldo = await Sueldo.create({
    nombre: `IT sueldo ${Date.now()}`,
    monto: 125,
    dia_cobro: 28,
    cuenta_id: cuenta.id,
    activo: true,
  });
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await CobroSueldo.destroy({ where: { sueldo_id: sueldo.id } });
    await sueldo.destroy();
    await cuenta.destroy();
  });

  const req = () => ({ body: { mes: 10, anio: 2026, fecha_cobro: '2026-10-28' }, params: { id: sueldo.id } });
  const resultados = await Promise.all([
    invocar(ingresosController.cobrarSueldo, req()),
    invocar(ingresosController.cobrarSueldo, req()),
  ]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [200, 422]);
  assert.equal(await CobroSueldo.count({ where: { sueldo_id: sueldo.id, mes: 10, anio: 2026 } }), 1);
  assert.equal(await Transaccion.count({ where: { cuenta_id: cuenta.id, referencia_tipo: 'sueldo' } }), 1);
});

test('dos abonos concurrentes no aceptan pagos acumulados por encima de la deuda', async (t) => {
  const cuenta = await crearCuenta(500);
  const prestamo = await Prestamo.create({
    deudor_nombre: `IT deudor ${Date.now()}`,
    capital: 100,
    tasa_interes_mensual: 0,
    fecha_inicio: '2026-10-28',
    cuenta_id: cuenta.id,
    estado: 'activo',
  });
  await Transaccion.create({
    cuenta_id: cuenta.id,
    tipo: 'egreso',
    monto: 100,
    descripcion: 'Desembolso de prueba',
    fecha: '2026-10-28',
    referencia_tipo: 'prestamo',
    referencia_id: prestamo.id,
  });
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await PagoPrestamo.destroy({ where: { prestamo_id: prestamo.id } });
    await prestamo.destroy();
    await cuenta.destroy();
  });

  const req = () => ({ body: { monto: 60, fecha_pago: '2026-10-28' }, params: { id: prestamo.id } });
  const resultados = await Promise.all([
    invocar(prestamosController.registrarAbono, req()),
    invocar(prestamosController.registrarAbono, req()),
  ]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [201, 422]);
  const pagos = await PagoPrestamo.findAll({ where: { prestamo_id: prestamo.id } });
  assert.equal(pagos.length, 1);
  assert.equal(await Transaccion.count({ where: { referencia_tipo: 'pago_prestamo', referencia_id: pagos[0].id } }), 1);
});

test('dos pagos concurrentes no registran dos veces una cuota de crédito', async (t) => {
  const cuenta = await crearCuenta(500);
  const credito = await CreditoRecibido.create({
    nombre: `IT crédito ${Date.now()}`,
    capital: 100,
    tipo_interes: 'simple',
    tasa_mensual: 0,
    num_cuotas: 1,
    fecha_inicio: '2026-10-28',
    cuenta_id: cuenta.id,
    estado: 'activo',
  });
  const cuota = await CuotaCredito.create({
    credito_id: credito.id,
    numero_cuota: 1,
    capital_cuota: 100,
    interes_cuota: 0,
    monto_total_cuota: 100,
    fecha_estimada: '2026-11-28',
    estado: 'pendiente',
  });
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await CuotaCredito.destroy({ where: { credito_id: credito.id } });
    await credito.destroy();
    await cuenta.destroy();
  });

  const req = () => ({
    body: { cuenta_pago_id: cuenta.id, fecha_pago: '2026-10-28' },
    params: { id: credito.id, cuotaId: cuota.id },
  });
  const resultados = await Promise.all([
    invocar(creditosController.pagarCuota, req()),
    invocar(creditosController.pagarCuota, req()),
  ]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [200, 422]);
  assert.equal(await CuotaCredito.count({ where: { id: cuota.id, estado: 'pagada' } }), 1);
  assert.equal(await Transaccion.count({ where: { referencia_tipo: 'cuota_credito', referencia_id: cuota.id } }), 1);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 400);
});

test('borrar la ficha de un préstamo conserva el egreso y el saldo contable', async (t) => {
  const cuenta = await crearCuenta(500);
  const prestamo = await Prestamo.create({
    deudor_nombre: `IT archivo préstamo ${Date.now()}`,
    capital: 100,
    tasa_interes_mensual: 0,
    fecha_inicio: '2026-10-28',
    cuenta_id: cuenta.id,
    estado: 'activo',
  });
  await Transaccion.create({
    cuenta_id: cuenta.id,
    tipo: 'egreso',
    monto: 100,
    descripcion: 'Desembolso a conservar',
    fecha: '2026-10-28',
    referencia_tipo: 'prestamo',
    referencia_id: prestamo.id,
  });
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await PagoPrestamo.destroy({ where: { prestamo_id: prestamo.id } });
    await prestamo.destroy();
    await cuenta.destroy();
  });

  const resultado = await invocar(prestamosController.destroy, { params: { id: prestamo.id } });

  assert.equal(resultado.status, 204);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 400);
  const movimiento = await Transaccion.findOne({ where: { cuenta_id: cuenta.id } });
  assert.equal(movimiento.referencia_tipo, 'prestamo_archivado');
  assert.equal(movimiento.referencia_id, null);
});

test('borrar la ficha de una inversión conserva el egreso y el saldo contable', async (t) => {
  const cuenta = await crearCuenta(500);
  const inversion = await Inversion.create({
    nombre: `IT archivo inversión ${Date.now()}`,
    costo_total: 100,
    fecha_compra: '2026-10-28',
    cuenta_egreso_id: cuenta.id,
    estado: 'en_curso',
  });
  await Transaccion.create({
    cuenta_id: cuenta.id,
    tipo: 'egreso',
    monto: 100,
    descripcion: 'Costo a conservar',
    fecha: '2026-10-28',
    referencia_tipo: 'inversion',
    referencia_id: inversion.id,
  });
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await inversion.destroy();
    await cuenta.destroy();
  });

  const resultado = await invocar(ingresosController.destroyInversion, { params: { id: inversion.id } });

  assert.equal(resultado.status, 204);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 400);
  const movimiento = await Transaccion.findOne({ where: { cuenta_id: cuenta.id } });
  assert.equal(movimiento.referencia_tipo, 'inversion_archivada');
  assert.equal(movimiento.referencia_id, null);
});

test('cuentas, transferencias y movimientos manuales mantienen los saldos y permiten reversa', async (t) => {
  const cuentaVacia = await crearCuenta();
  t.after(async () => {
    const sigue = await Cuenta.findByPk(cuentaVacia.id);
    if (sigue) await sigue.destroy();
  });
  assert.equal((await invocar(cuentasController.destroy, { params: { id: cuentaVacia.id } })).status, 204);

  const origenResult = await invocar(cuentasController.store, { body: {
    nombre: `IT cuenta origen ${Date.now()}`, tipo: 'banco', saldo_inicial: 200,
  } });
  assert.equal(origenResult.status, 201);
  const origenId = origenResult.data.id;
  const destino = await crearCuenta(10);
  t.after(async () => {
    await borrarTransaccionesDeCuenta(origenId);
    await borrarTransaccionesDeCuenta(destino.id);
    await Cuenta.destroy({ where: { id: [origenId, destino.id] }, force: true });
  });

  const editada = await invocar(cuentasController.update, {
    params: { id: origenId }, body: { nombre: 'IT cuenta editada', tipo: 'efectivo', saldo_inicial: 200 },
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.data.nombre, 'IT cuenta editada');

  const transferencia = await invocar(cuentasController.transferir, { body: {
    origen_id: origenId, destino_id: destino.id, monto: 40, fecha: '2026-10-28',
  } });
  assert.equal(transferencia.status, 201);
  assert.equal((await Cuenta.calcularSaldo(origenId, sequelize)).saldo_actual, 160);
  assert.equal((await Cuenta.calcularSaldo(destino.id, sequelize)).saldo_actual, 50);
  assert.equal(await Transaccion.count({ where: { referencia_tipo: 'transferencia' } }), 2);

  const manual = await invocar(cuentasController.storeTransaccion, { params: { id: origenId }, body: {
    tipo: 'ingreso', monto: 20, descripcion: 'Ingreso manual', fecha: '2026-10-28',
  } });
  assert.equal(manual.status, 201);
  const egreso = await invocar(egresosController.store, { body: {
    cuenta_id: origenId, monto: 15, descripcion: 'Egreso manual', fecha: '2026-10-28',
  } });
  assert.equal(egreso.status, 201);
  const egresoEditado = await invocar(egresosController.update, {
    params: { id: egreso.data.id }, body: { monto: 25, descripcion: 'Egreso editado' },
  });
  assert.equal(egresoEditado.status, 200);
  assert.equal(parseFloat(egresoEditado.data.monto), 25);
  assert.equal((await invocar(egresosController.destroy, { params: { id: egreso.data.id } })).status, 204);

  const ingreso = await invocar(ingresosManualController.store, { body: {
    cuenta_id: origenId, monto: 10, descripcion: 'Ingreso CRUD', fecha: '2026-10-28',
  } });
  assert.equal(ingreso.status, 201);
  const ingresoEditado = await invocar(ingresosManualController.update, {
    params: { id: ingreso.data.id }, body: { monto: 12, descripcion: 'Ingreso editado' },
  });
  assert.equal(ingresoEditado.status, 200);
  assert.equal(parseFloat(ingresoEditado.data.monto), 12);
  assert.equal((await invocar(ingresosManualController.destroy, { params: { id: ingreso.data.id } })).status, 204);

  assert.equal((await Cuenta.calcularSaldo(origenId, sequelize)).saldo_actual, 180);
  assert.equal((await invocar(cuentasController.destroy, { params: { id: origenId } })).status, 422);
  assert.equal((await invocar(cuentasController.destroyTransaccion, { params: { id: manual.data.id } })).status, 204);
  assert.equal((await Cuenta.calcularSaldo(origenId, sequelize)).saldo_actual, 160);
});

test('sueldos se pueden editar y cobrar; se protege el historial y se rechaza cobrar inactivos', async (t) => {
  const cuenta = await crearCuenta(0);
  const sueldoResult = await invocar(ingresosController.storeSueldo, { body: {
    nombre: 'IT sueldo CRUD', monto: 120, dia_cobro: 28, cuenta_id: cuenta.id,
  } });
  assert.equal(sueldoResult.status, 201);
  const sueldoId = sueldoResult.data.id;
  const sueldoVacioResult = await invocar(ingresosController.storeSueldo, { body: {
    nombre: 'IT sueldo sin cobros', monto: 50, dia_cobro: 15, cuenta_id: cuenta.id,
  } });
  assert.equal(sueldoVacioResult.status, 201);
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await CobroSueldo.destroy({ where: { sueldo_id: sueldoId } });
    await Sueldo.destroy({ where: { id: sueldoId } });
    await Sueldo.destroy({ where: { id: sueldoVacioResult.data.id } });
    await cuenta.destroy();
  });

  const update = await invocar(ingresosController.updateSueldo, {
    params: { id: sueldoId }, body: { nombre: 'IT sueldo ajustado', monto: 125, dia_cobro: 28, cuenta_id: cuenta.id, activo: true },
  });
  assert.equal(update.status, 200);
  const cobro = await invocar(ingresosController.cobrarSueldo, {
    params: { id: sueldoId }, body: { mes: 10, anio: 2026, fecha_cobro: '2026-10-28' },
  });
  assert.equal(cobro.status, 200);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 125);
  assert.equal((await invocar(ingresosController.destroySueldo, { params: { id: sueldoId } })).status, 422);
  assert.equal((await invocar(ingresosController.destroySueldo, { params: { id: sueldoVacioResult.data.id } })).status, 204);

  await invocar(ingresosController.updateSueldo, {
    params: { id: sueldoId }, body: { activo: false },
  });
  const cobroInactivo = await invocar(ingresosController.cobrarSueldo, {
    params: { id: sueldoId }, body: { mes: 11, anio: 2026, fecha_cobro: '2026-11-28' },
  });
  assert.equal(cobroInactivo.status, 422);
});

test('inversiones cubren alta, edición, cobros, cierre sin duplicar y restablecimiento', async (t) => {
  const cuentaEgreso = await crearCuenta(500);
  const cuentaIngreso = await crearCuenta(0);
  const alta = await invocar(ingresosController.storeInversion, { body: {
    nombre: 'IT inversión', costo_total: 50, precio_esperado: 120,
    fecha_compra: '2026-10-28', cuenta_egreso_id: cuentaEgreso.id,
  } });
  assert.equal(alta.status, 201);
  const inversionId = alta.data.id;
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuentaEgreso.id);
    await borrarTransaccionesDeCuenta(cuentaIngreso.id);
    await CobroInversion.destroy({ where: { inversion_id: inversionId } });
    await Inversion.destroy({ where: { id: inversionId } });
    await cuentaEgreso.destroy();
    await cuentaIngreso.destroy();
  });

  const update = await invocar(ingresosController.updateInversion, {
    params: { id: inversionId }, body: { nombre: 'IT inversión editada', precio_esperado: 120, fecha_compra: '2026-10-27' },
  });
  assert.equal(update.status, 200);
  assert.equal((await Transaccion.findOne({ where: { referencia_tipo: 'inversion', referencia_id: inversionId } })).fecha, '2026-10-27');

  const parcial = await invocar(ingresosController.registrarCobro, {
    params: { id: inversionId }, body: { monto: 30, cuenta_id: cuentaIngreso.id, fecha_cobro: '2026-10-28' },
  });
  assert.equal(parcial.status, 201);
  assert.equal(parcial.data.total_cobrado, 30);
  const final = await invocar(ingresosController.registrarCobro, {
    params: { id: inversionId }, body: { monto: 90, cuenta_id: cuentaIngreso.id, fecha_cobro: '2026-10-29', es_pago_final: true },
  });
  assert.equal(final.status, 201);
  assert.equal(final.data.total_cobrado, 120);
  assert.equal(parseFloat(final.data.precio_venta_total), 120);
  assert.equal((await Cuenta.calcularSaldo(cuentaIngreso.id, sequelize)).saldo_actual, 120);

  const reset = await invocar(ingresosController.resetearInversion, { params: { id: inversionId } });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.estado, 'en_curso');
  assert.equal(reset.data.total_cobrado, 0);
  assert.equal(await CobroInversion.count({ where: { inversion_id: inversionId } }), 0);
  assert.equal((await Cuenta.calcularSaldo(cuentaIngreso.id, sequelize)).saldo_actual, 0);
  assert.equal(await Transaccion.count({ where: { referencia_tipo: 'cobro_inversion' } }), 0);
});

test('préstamos cubren edición previa, reversa de abonos y cierre del saldo restante', async (t) => {
  const cuenta = await crearCuenta(500);
  const alta = await invocar(prestamosController.store, { body: {
    deudor_nombre: 'IT deudor CRUD', capital: 100, tasa_interes_mensual: 0,
    fecha_inicio: '2026-10-28', cuenta_id: cuenta.id,
  } });
  assert.equal(alta.status, 201);
  const prestamoId = alta.data.id;
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await PagoPrestamo.destroy({ where: { prestamo_id: prestamoId } });
    await Prestamo.destroy({ where: { id: prestamoId } });
    await cuenta.destroy();
  });

  const update = await invocar(prestamosController.update, {
    params: { id: prestamoId }, body: {
      deudor_nombre: 'IT deudor editado', capital: 120, tasa_interes_mensual: 0,
      fecha_inicio: '2026-10-27', cuenta_id: cuenta.id,
    },
  });
  assert.equal(update.status, 200);
  assert.equal(parseFloat(update.data.capital), 120);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 380);

  const abono = await invocar(prestamosController.registrarAbono, {
    params: { id: prestamoId }, body: { monto: 40, fecha_pago: '2026-10-28', nota: 'Primer abono' },
  });
  assert.equal(abono.status, 201);
  assert.equal((await invocar(prestamosController.update, {
    params: { id: prestamoId }, body: {
      deudor_nombre: 'Cambio bloqueado', capital: 120, tasa_interes_mensual: 0,
      fecha_inicio: '2026-10-27', cuenta_id: cuenta.id,
    },
  })).status, 422);
  const pagoId = abono.data.pagos[0].id;
  const abonoEditado = await invocar(prestamosController.updateAbono, {
    params: { id: prestamoId, abonoId: pagoId }, body: { monto: 30, fecha_pago: '2026-10-29', nota: 'Corregido' },
  });
  assert.equal(abonoEditado.status, 200);
  assert.equal(parseFloat(abonoEditado.data.total_pagado), 30);
  const borrado = await invocar(prestamosController.destroyAbono, { params: { id: prestamoId, abonoId: pagoId } });
  assert.equal(borrado.status, 200);
  assert.equal(borrado.data.total_pagado, 0);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 380);

  const cerrado = await invocar(prestamosController.marcarPagado, { params: { id: prestamoId } });
  assert.equal(cerrado.status, 200);
  assert.equal(cerrado.data.estado, 'pagado');
  assert.equal(cerrado.data.total_pagado, 120);
  assert.equal((await invocar(prestamosController.marcarPagado, { params: { id: prestamoId } })).status, 422);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 500);
});

test('créditos generan cronograma, exigen orden, registran cuotas y revierten alta no pagada', async (t) => {
  const cuenta = await crearCuenta(1000);
  const alta = await invocar(creditosController.store, { body: {
    nombre: 'IT crédito ciclo', capital: 90, tipo_interes: 'simple', tasa_mensual: 0,
    num_cuotas: 3, fecha_inicio: '2026-10-28', cuenta_id: cuenta.id,
  } });
  assert.equal(alta.status, 201);
  const creditoId = alta.data.id;
  const cuotas = alta.data.cuotas;
  assert.equal(cuotas.length, 3);
  assert.deepEqual(cuotas.map((cuota) => cuota.numero_cuota), [1, 2, 3]);
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    await CuotaCredito.destroy({ where: { credito_id: creditoId } });
    await CreditoRecibido.destroy({ where: { id: creditoId } });
    await cuenta.destroy();
  });

  const segundoFueraDeOrden = await invocar(creditosController.pagarCuota, {
    params: { id: creditoId, cuotaId: cuotas[1].id },
    body: { cuenta_pago_id: cuenta.id, fecha_pago: '2026-10-28' },
  });
  assert.equal(segundoFueraDeOrden.status, 422);

  const pagoPrimero = await invocar(creditosController.pagarCuota, {
    params: { id: creditoId, cuotaId: cuotas[0].id },
    body: { cuenta_pago_id: cuenta.id, fecha_pago: '2026-10-28' },
  });
  assert.equal(pagoPrimero.status, 200);
  assert.equal(pagoPrimero.data.cuotas_pagadas, 1);
  assert.equal((await invocar(creditosController.destroy, { params: { id: creditoId } })).status, 422);
  for (const cuota of cuotas.slice(1)) {
    const pago = await invocar(creditosController.pagarCuota, {
      params: { id: creditoId, cuotaId: cuota.id },
      body: { cuenta_pago_id: cuenta.id, fecha_pago: '2026-10-28' },
    });
    assert.equal(pago.status, 200);
  }
  assert.equal((await CreditoRecibido.findByPk(creditoId)).estado, 'pagado');
  assert.equal((await invocar(creditosController.destroy, { params: { id: creditoId } })).status, 422);

  const otro = await invocar(creditosController.store, { body: {
    nombre: 'IT crédito reversible', capital: 10, tipo_interes: 'simple', tasa_mensual: 0,
    num_cuotas: 1, fecha_inicio: '2026-10-28', cuenta_id: cuenta.id,
  } });
  assert.equal(otro.status, 201);
  assert.equal((await invocar(creditosController.destroy, { params: { id: otro.data.id } })).status, 204);
  assert.equal(await CuotaCredito.count({ where: { credito_id: otro.data.id } }), 0);
});

test('tarjetas, compras normales y tasa cero, calendario y pago son idempotentes', async (t) => {
  const cuenta = await crearCuenta(1000);
  const alta = await invocar(tarjetasController.store, { body: {
    nombre: 'IT tarjeta ciclo', banco: 'Pruebas', limite_credito: 500,
    dia_corte: 15, dia_pago: 28, cuenta_pago_id: cuenta.id,
  } });
  assert.equal(alta.status, 201);
  const tarjetaId = alta.data.id;
  const compraIds = { normal: [], tasaCero: [] };
  t.after(async () => {
    await borrarTransaccionesDeCuenta(cuenta.id);
    const comprasTasaCero = await CompraTasaCero.findAll({ where: { tarjeta_id: tarjetaId }, attributes: ['id'] });
    const idsTasaCero = comprasTasaCero.map((compra) => compra.id);
    await CuotaMensual.destroy({ where: { tasa_cero_id: idsTasaCero } });
    await CompraTasaCero.destroy({ where: { tarjeta_id: tarjetaId } });
    await CompraNormal.destroy({ where: { tarjeta_id: tarjetaId } });
    await Tarjeta.destroy({ where: { id: tarjetaId } });
    await cuenta.destroy();
  });

  const normalAlta = await invocar(comprasController.storeNormal, { body: {
    tarjeta_id: tarjetaId, nombre: 'Compra editable', monto: 30, fecha_compra: '2026-10-20',
  } });
  assert.equal(normalAlta.status, 201);
  compraIds.normal.push(normalAlta.data.id);
  const normalEditada = await invocar(comprasController.updateNormal, {
    params: { id: normalAlta.data.id }, body: { nombre: 'Compra editada', monto: 35 },
  });
  assert.equal(normalEditada.status, 200);
  assert.equal(parseFloat(normalEditada.data.monto), 35);
  assert.equal((await invocar(comprasController.destroyNormal, { params: { id: normalAlta.data.id } })).status, 204);

  const tasaEditable = await invocar(comprasController.storeTasaCero, { body: {
    tarjeta_id: tarjetaId, nombre: 'Tasa cero editable', monto_total: 50, total_cuotas: 2, fecha_compra: '2026-10-20',
  } });
  assert.equal(tasaEditable.status, 201);
  compraIds.tasaCero.push(tasaEditable.data.id);
  const tasaEditada = await invocar(comprasController.updateTasaCero, {
    params: { id: tasaEditable.data.id }, body: { nombre: 'Tasa editada', monto_total: 60, total_cuotas: 3 },
  });
  assert.equal(tasaEditada.status, 200);
  assert.equal(tasaEditada.data.cuotas.length, 3);
  assert.equal((await invocar(comprasController.destroyTasaCero, { params: { id: tasaEditable.data.id } })).status, 204);

  const normalProgramada = await invocar(comprasController.storeNormal, { body: {
    tarjeta_id: tarjetaId, nombre: 'Compra de calendario', monto: 35, fecha_compra: '2026-10-28',
  } });
  assert.equal(normalProgramada.status, 201);
  compraIds.normal.push(normalProgramada.data.id);
  const tasaProgramada = await invocar(comprasController.storeTasaCero, { body: {
    tarjeta_id: tarjetaId, nombre: 'Cuotas de calendario', monto_total: 50, total_cuotas: 2, fecha_compra: '2026-10-28',
  } });
  assert.equal(tasaProgramada.status, 201);
  compraIds.tasaCero.push(tasaProgramada.data.id);

  const tarjetaActualizada = await invocar(tarjetasController.update, {
    params: { id: tarjetaId }, body: { nombre: 'IT tarjeta actualizada', limite_credito: 500, dia_corte: 15, dia_pago: 28, cuenta_pago_id: cuenta.id },
  });
  assert.equal(tarjetaActualizada.status, 200);
  assert.equal((await invocar(tarjetasController.update, {
    params: { id: tarjetaId }, body: { limite_credito: 40 },
  })).status, 422);

  const detalle = await invocar(calendarioController.getDetallePago, {
    query: { tarjeta_id: tarjetaId, year: 2026, month: 11 },
  });
  assert.equal(detalle.status, 200);
  assert.equal(detalle.data.total, 60);
  const calendario = await invocar(calendarioController.getCalendario, { query: { year: 2026, month: 11 } });
  assert.equal(calendario.status, 200);
  assert.ok(calendario.data.events.some((event) => event.type === 'pago' && event.tarjeta_id === tarjetaId && event.monto_total === 60));

  const pagosConcurrentes = await Promise.all([
    invocar(calendarioController.confirmarPago, { body: { tarjeta_id: tarjetaId, year: 2026, month: 11 } }),
    invocar(calendarioController.confirmarPago, { body: { tarjeta_id: tarjetaId, year: 2026, month: 11 } }),
  ]);
  assert.deepEqual(pagosConcurrentes.map((resultado) => resultado.data.total_pagado).sort((a, b) => a - b), [0, 60]);
  for (const pago of pagosConcurrentes) assert.equal(pago.status, 200);
  const pagoExitoso = pagosConcurrentes.find((resultado) => resultado.data.total_pagado === 60);
  assert.equal(pagoExitoso.data.normales_pagadas, 1);
  assert.equal(pagoExitoso.data.cuotas_pagadas, 1);
  assert.equal((await Cuenta.calcularSaldo(cuenta.id, sequelize)).saldo_actual, 940);
  assert.equal(await Transaccion.count({ where: { cuenta_id: cuenta.id, referencia_tipo: 'pago_tarjeta' } }), 1);
  assert.equal((await invocar(comprasController.destroyNormal, { params: { id: normalProgramada.data.id } })).status, 422);
  assert.equal((await invocar(comprasController.updateTasaCero, {
    params: { id: tasaProgramada.data.id }, body: { monto_total: 55 },
  })).status, 422);
  assert.equal((await invocar(comprasController.destroyTasaCero, { params: { id: tasaProgramada.data.id } })).status, 422);
  assert.equal((await invocar(tarjetasController.destroy, { params: { id: tarjetaId } })).status, 422);

  await CuotaMensual.destroy({ where: { tasa_cero_id: tasaProgramada.data.id } });
  await CompraTasaCero.destroy({ where: { id: tasaProgramada.data.id } });
  await CompraNormal.destroy({ where: { id: normalProgramada.data.id } });
  assert.equal((await invocar(tarjetasController.destroy, { params: { id: tarjetaId } })).status, 204);
});
