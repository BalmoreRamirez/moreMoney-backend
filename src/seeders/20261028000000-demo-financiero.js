'use strict';

const CUENTAS = [
  'DEMO - Cuenta principal',
  'DEMO - Efectivo',
  'DEMO - Billetera digital',
];
const TARJETA = 'DEMO - Tarjeta principal';
const COMPRA_TASA_CERO = 'DEMO - Teléfono en cuotas';
const SUELDO = 'DEMO - Sueldo mensual';
const INVERSION = 'DEMO - Inversión vendida';
const CREDITO = 'DEMO - Crédito recibido';
const DESCRIPCIONES_TRANSACCIONES = [
  'DEMO - Cobro de sueldo',
  'DEMO - Compra de supermercado',
  'DEMO - Compra de inversión',
  'DEMO - Venta de inversión',
  'DEMO - Préstamo otorgado',
  'DEMO - Pago de préstamo',
  'DEMO - Crédito recibido',
];

function dateInMonth(offset, day = 1) {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, day))
    .toISOString()
    .slice(0, 10);
}

async function findOne(queryInterface, table, where, transaction) {
  const rows = await queryInterface.select(null, table, { where, transaction });
  return rows[0] || null;
}

async function insertOne(queryInterface, table, row, where, transaction) {
  await queryInterface.bulkInsert(table, [row], { transaction });
  return findOne(queryInterface, table, where, transaction);
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const existingDemo = await findOne(queryInterface, 'cuentas', {
        nombre: CUENTAS[0],
      }, transaction);
      if (existingDemo) return;

      const now = new Date();
      const usuario = await findOne(queryInterface, 'usuarios', { usuario: 'balmore' }, transaction);

      await queryInterface.bulkInsert('cuentas', [
        { nombre: CUENTAS[0], tipo: 'banco', saldo_inicial: 1200, created_at: now, updated_at: now },
        { nombre: CUENTAS[1], tipo: 'efectivo', saldo_inicial: 100, created_at: now, updated_at: now },
        { nombre: CUENTAS[2], tipo: 'digital', saldo_inicial: 50, created_at: now, updated_at: now },
      ], { transaction });

      const cuentasDemo = [];
      for (const nombre of CUENTAS) {
        cuentasDemo.push(await findOne(queryInterface, 'cuentas', { nombre }, transaction));
      }
      const [cuentaPrincipal, , cuentaDigital] = cuentasDemo;

      const tarjeta = await insertOne(queryInterface, 'tarjetas', {
        nombre: TARJETA,
        banco: 'Banco de demostración',
        limite_credito: 2500,
        dia_corte: 15,
        dia_pago: 5,
        cuenta_pago_id: cuentaPrincipal.id,
        created_at: now,
        updated_at: now,
      }, { nombre: TARJETA }, transaction);

      await queryInterface.bulkInsert('compras_normales', [{
        tarjeta_id: tarjeta.id,
        nombre: 'DEMO - Compra de supermercado',
        monto: 83.5,
        fecha_compra: dateInMonth(-1, 12),
        estado: 'pendiente',
        created_at: now,
        updated_at: now,
      }], { transaction });

      const compraTasaCero = await insertOne(queryInterface, 'compras_tasa_cero', {
        tarjeta_id: tarjeta.id,
        nombre: COMPRA_TASA_CERO,
        monto_total: 900,
        total_cuotas: 6,
        fecha_compra: dateInMonth(-2, 15),
        estado: 'activa',
        created_at: now,
        updated_at: now,
      }, { nombre: COMPRA_TASA_CERO }, transaction);

      const cuotasMensuales = Array.from({ length: 6 }, (_, index) => {
        const mesOffset = index - 1;
        const fecha = dateInMonth(mesOffset, 10);
        const pagada = mesOffset < 0;
        return {
          tasa_cero_id: compraTasaCero.id,
          numero_cuota: index + 1,
          monto_cuota: 150,
          fecha_estimada_pago: fecha,
          estado: pagada ? 'pagada' : 'pendiente',
          fecha_pago: pagada ? fecha : null,
          created_at: now,
          updated_at: now,
        };
      });
      await queryInterface.bulkInsert('cuotas_mensuales', cuotasMensuales, { transaction });

      const sueldo = await insertOne(queryInterface, 'sueldos', {
        nombre: SUELDO,
        monto: 2500,
        dia_cobro: 1,
        cuenta_id: cuentaPrincipal.id,
        activo: true,
        created_at: now,
        updated_at: now,
      }, { nombre: SUELDO }, transaction);

      const mesActual = now.getUTCMonth() + 1;
      const anioActual = now.getUTCFullYear();
      const cobroExistente = await findOne(queryInterface, 'cobros_sueldo', {
        mes: mesActual,
        anio: anioActual,
      }, transaction);
      if (!cobroExistente) {
        await queryInterface.bulkInsert('cobros_sueldo', [{
          sueldo_id: sueldo.id,
          mes: mesActual,
          anio: anioActual,
          fecha_cobro: dateInMonth(0, now.getUTCDate()),
          created_at: now,
          updated_at: now,
        }], { transaction });
        await queryInterface.bulkInsert('transacciones', [{
          cuenta_id: cuentaPrincipal.id,
          tipo: 'ingreso',
          monto: 2500,
          descripcion: DESCRIPCIONES_TRANSACCIONES[0],
          fecha: dateInMonth(0, now.getUTCDate()),
          referencia_tipo: 'sueldo',
          referencia_id: sueldo.id,
          usuario_id: usuario ? usuario.id : null,
          created_at: now,
          updated_at: now,
        }], { transaction });
      }

      await queryInterface.bulkInsert('transacciones', [{
        cuenta_id: cuentaPrincipal.id,
        tipo: 'egreso',
        monto: 180.5,
        descripcion: DESCRIPCIONES_TRANSACCIONES[1],
        fecha: dateInMonth(0, 5),
        referencia_tipo: 'manual',
        referencia_id: null,
        usuario_id: usuario ? usuario.id : null,
        created_at: now,
        updated_at: now,
      }], { transaction });

      const inversion = await insertOne(queryInterface, 'inversiones', {
        nombre: INVERSION,
        costo_total: 300,
        precio_esperado: 450,
        precio_venta_total: 450,
        fecha_compra: dateInMonth(-3, 5),
        fecha_venta: dateInMonth(-1, 5),
        estado: 'vendida',
        cuenta_egreso_id: cuentaPrincipal.id,
        cuenta_ingreso_id: cuentaDigital.id,
        created_at: now,
        updated_at: now,
      }, { nombre: INVERSION }, transaction);

      const cobroInversion = await insertOne(queryInterface, 'cobros_inversion', {
        inversion_id: inversion.id,
        monto: 450,
        cuenta_id: cuentaDigital.id,
        fecha_cobro: dateInMonth(-1, 5),
        nota: 'DEMO - Cobro de venta',
        created_at: now,
        updated_at: now,
      }, { inversion_id: inversion.id }, transaction);

      const prestamo = await insertOne(queryInterface, 'prestamos', {
        deudor_nombre: 'Cliente de demostración',
        deudor_contacto: 'demo@example.com',
        capital: 500,
        tasa_interes_mensual: 0.015,
        fecha_inicio: dateInMonth(-2, 1),
        dias_duracion: 90,
        estado: 'activo',
        cuenta_id: cuentaPrincipal.id,
        created_at: now,
        updated_at: now,
      }, { deudor_nombre: 'Cliente de demostración' }, transaction);

      const pagoPrestamo = await insertOne(queryInterface, 'pagos_prestamo', {
        prestamo_id: prestamo.id,
        monto: 100,
        fecha_pago: dateInMonth(-1, 1),
        nota: 'DEMO - Pago parcial',
        created_at: now,
        updated_at: now,
      }, { prestamo_id: prestamo.id, nota: 'DEMO - Pago parcial' }, transaction);

      const credito = await insertOne(queryInterface, 'creditos_recibidos', {
        nombre: CREDITO,
        capital: 1200,
        tipo_interes: 'simple',
        tasa_mensual: 0.02,
        num_cuotas: 6,
        fecha_inicio: dateInMonth(-1, 1),
        cuenta_id: cuentaPrincipal.id,
        proposito_tipo: null,
        proposito_id: null,
        estado: 'activo',
        created_at: now,
        updated_at: now,
      }, { nombre: CREDITO }, transaction);

      const cuotasCredito = Array.from({ length: 6 }, (_, index) => ({
        credito_id: credito.id,
        numero_cuota: index + 1,
        capital_cuota: 200,
        interes_cuota: 24,
        monto_total_cuota: 224,
        fecha_estimada: dateInMonth(index, 10),
        estado: 'pendiente',
        fecha_pago: null,
        created_at: now,
        updated_at: now,
      }));
      await queryInterface.bulkInsert('cuotas_credito', cuotasCredito, { transaction });

      const transaccionesFinales = [
        {
          cuenta_id: cuentaPrincipal.id,
          tipo: 'egreso',
          monto: 300,
          descripcion: DESCRIPCIONES_TRANSACCIONES[2],
          fecha: dateInMonth(-3, 5),
          referencia_tipo: 'inversion',
          referencia_id: inversion.id,
        },
        {
          cuenta_id: cuentaDigital.id,
          tipo: 'ingreso',
          monto: 450,
          descripcion: DESCRIPCIONES_TRANSACCIONES[3],
          fecha: dateInMonth(-1, 5),
          referencia_tipo: 'cobro_inversion',
          referencia_id: cobroInversion.id,
        },
        {
          cuenta_id: cuentaPrincipal.id,
          tipo: 'egreso',
          monto: 500,
          descripcion: DESCRIPCIONES_TRANSACCIONES[4],
          fecha: dateInMonth(-2, 1),
          referencia_tipo: 'prestamo',
          referencia_id: prestamo.id,
        },
        {
          cuenta_id: cuentaPrincipal.id,
          tipo: 'ingreso',
          monto: 100,
          descripcion: DESCRIPCIONES_TRANSACCIONES[5],
          fecha: dateInMonth(-1, 1),
          referencia_tipo: 'pago_prestamo',
          referencia_id: pagoPrestamo.id,
        },
        {
          cuenta_id: cuentaPrincipal.id,
          tipo: 'ingreso',
          monto: 1200,
          descripcion: DESCRIPCIONES_TRANSACCIONES[6],
          fecha: dateInMonth(-1, 1),
          referencia_tipo: 'credito_recibido',
          referencia_id: credito.id,
        },
      ].map((row) => ({
        ...row,
        usuario_id: usuario ? usuario.id : null,
        created_at: now,
        updated_at: now,
      }));

      await queryInterface.bulkInsert('transacciones', transaccionesFinales, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const cuentas = [];
      for (const nombre of CUENTAS) {
        cuentas.push(await findOne(queryInterface, 'cuentas', { nombre }, transaction));
      }
      const tarjeta = await findOne(queryInterface, 'tarjetas', { nombre: TARJETA }, transaction);
      const compraTasaCero = await findOne(
        queryInterface,
        'compras_tasa_cero',
        { nombre: COMPRA_TASA_CERO },
        transaction
      );
      const sueldo = await findOne(queryInterface, 'sueldos', { nombre: SUELDO }, transaction);
      const inversion = await findOne(queryInterface, 'inversiones', { nombre: INVERSION }, transaction);
      const prestamo = await findOne(
        queryInterface,
        'prestamos',
        { deudor_nombre: 'Cliente de demostración' },
        transaction
      );
      const credito = await findOne(queryInterface, 'creditos_recibidos', { nombre: CREDITO }, transaction);

      for (const descripcion of DESCRIPCIONES_TRANSACCIONES) {
        await queryInterface.bulkDelete('transacciones', { descripcion }, { transaction });
      }

      if (credito) {
        await queryInterface.bulkDelete('cuotas_credito', { credito_id: credito.id }, { transaction });
        await queryInterface.bulkDelete('creditos_recibidos', { id: credito.id }, { transaction });
      }
      if (prestamo) {
        await queryInterface.bulkDelete('pagos_prestamo', { prestamo_id: prestamo.id }, { transaction });
        await queryInterface.bulkDelete('prestamos', { id: prestamo.id }, { transaction });
      }
      if (inversion) {
        await queryInterface.bulkDelete('cobros_inversion', { inversion_id: inversion.id }, { transaction });
        await queryInterface.bulkDelete('inversiones', { id: inversion.id }, { transaction });
      }
      if (sueldo) {
        await queryInterface.bulkDelete('cobros_sueldo', { sueldo_id: sueldo.id }, { transaction });
        await queryInterface.bulkDelete('sueldos', { id: sueldo.id }, { transaction });
      }
      if (compraTasaCero) {
        await queryInterface.bulkDelete('cuotas_mensuales', { tasa_cero_id: compraTasaCero.id }, { transaction });
        await queryInterface.bulkDelete('compras_tasa_cero', { id: compraTasaCero.id }, { transaction });
      }
      if (tarjeta) {
        await queryInterface.bulkDelete('compras_normales', { tarjeta_id: tarjeta.id }, { transaction });
        await queryInterface.bulkDelete('tarjetas', { id: tarjeta.id }, { transaction });
      }
      for (const cuenta of cuentas) {
        if (cuenta) await queryInterface.bulkDelete('cuentas', { id: cuenta.id }, { transaction });
      }
    });
  },
};
