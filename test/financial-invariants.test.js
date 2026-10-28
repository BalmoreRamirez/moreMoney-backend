'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsearCentavos, aCentavos, desdeCentavos } = require('../src/utils/montos');
const { calcularSaldoPrestamo } = require('../src/utils/saldosPrestamo');
const { resumirSaldosTarjeta } = require('../src/utils/saldosTarjeta');
const { bloquearRegistros } = require('../src/utils/bloqueos');
const { archivarMovimientos } = require('../src/utils/archivarMovimientos');

test('parsearCentavos acepta valores de hasta dos decimales sin redondear', () => {
  assert.equal(parsearCentavos('12'), 1200);
  assert.equal(parsearCentavos('12.3'), 1230);
  assert.equal(parsearCentavos('12.34'), 1234);
  assert.equal(parsearCentavos(0.1), 10);
  assert.equal(parsearCentavos('99999999.99'), 9_999_999_999);
});

test('parsearCentavos rechaza precisión inválida y valores fuera de DECIMAL(10,2)', () => {
  for (const valor of ['-1.00', '1.001', '1e2', '', '100000000.00', NaN, null, {}]) {
    assert.equal(parsearCentavos(valor), null, `valor inválido: ${String(valor)}`);
  }
});

test('conversiones de centavos mantienen el importe a dos decimales', () => {
  assert.equal(aCentavos('123.45'), 12345);
  assert.equal(desdeCentavos(12345), 123.45);
  assert.equal(aCentavos('no es monto'), NaN);
});

test('el saldo del préstamo solo acumula interés al cumplir cada aniversario mensual', () => {
  const prestamo = {
    capital: '1000.00',
    tasa_interes_mensual: '0.0500',
    fecha_inicio: '2024-01-15',
  };
  const pagos = [{ monto: '75.00' }];

  const antesDelSegundoAniversario = calcularSaldoPrestamo(
    prestamo,
    pagos,
    new Date('2024-03-14T12:00:00'),
  );
  assert.deepEqual(antesDelSegundoAniversario, {
    meses_transcurridos: 1,
    interes_generado: 50,
    total_deuda: 1050,
    total_pagado: 75,
    saldo_pendiente: 975,
    ganancia: -925,
  });

  const enElSegundoAniversario = calcularSaldoPrestamo(
    prestamo,
    pagos,
    new Date('2024-03-15T12:00:00'),
  );
  assert.equal(enElSegundoAniversario.meses_transcurridos, 2);
  assert.equal(enElSegundoAniversario.interes_generado, 100);
  assert.equal(enElSegundoAniversario.saldo_pendiente, 1025);
});

test('el cálculo de crédito de tarjeta descuenta cuotas pagadas del saldo usado', () => {
  assert.deepEqual(resumirSaldosTarjeta({
    limite_credito: '1000.00',
    sum_normales: '120.00',
    sum_tasa_cero: '300.00',
    sum_cuotas_pagadas: '50.00',
  }), {
    limite_credito: 1000,
    saldo_gastado: 370,
    saldo_disponible: 630,
  });
});

test('los bloqueos de registros se solicitan en orden estable y sin IDs duplicados', async () => {
  const solicitados = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const Model = {
    async findByPk(id, options) {
      solicitados.push({ id, options });
      return { id };
    },
  };

  const bloqueados = await bloquearRegistros(Model, [3, 2, 3, 0, -1, '1'], transaction);

  assert.deepEqual(solicitados.map(({ id }) => id), [1, 2, 3]);
  assert.equal(solicitados[0].options.transaction, transaction);
  assert.equal(solicitados[0].options.lock, 'UPDATE');
  assert.deepEqual([...bloqueados.keys()], [1, 2, 3]);
});

test('archivar movimientos conserva monto y tipo, y elimina la referencia huérfana', async () => {
  const transaction = { id: 'tx' };
  const movimiento = {
    monto: '250.00',
    tipo: 'egreso',
    referencia_tipo: 'prestamo',
    referencia_id: 17,
    descripcion: 'Préstamo a Ana',
    async update(values, options) {
      assert.equal(options.transaction, transaction);
      Object.assign(this, values);
    },
  };

  await archivarMovimientos([movimiento], {
    tipo: 'prestamo_archivado',
    entidad: 'préstamo',
    entidadId: 17,
    transaction,
  });

  assert.equal(movimiento.monto, '250.00');
  assert.equal(movimiento.tipo, 'egreso');
  assert.equal(movimiento.referencia_tipo, 'prestamo_archivado');
  assert.equal(movimiento.referencia_id, null);
  assert.match(movimiento.descripcion, /Ficha de préstamo #17 archivada/);
});

test('la descripción archivada no excede el tamaño VARCHAR(255)', async () => {
  const movimiento = {
    descripcion: 'X'.repeat(300),
    async update(values) { Object.assign(this, values); },
  };

  await archivarMovimientos([movimiento], {
    tipo: 'inversion_archivada',
    entidad: 'inversión',
    entidadId: 4,
    transaction: {},
  });

  assert.equal(movimiento.descripcion.length, 255);
  assert.match(movimiento.descripcion, /Ficha de inversión #4 archivada/);
});
