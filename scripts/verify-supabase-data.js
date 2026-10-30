#!/usr/bin/env node
'use strict';

// Compara recuentos y huellas por tabla sin mostrar filas ni valores financieros.
const { Client } = require('pg');
const path = require('node:path');
const dotenv = require('dotenv');
const { getExpectedSupabaseProjectRef } = require('./supabase-project');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.supabase.local'), override: true, quiet: true });

const TABLES = [
  'cobros_inversion', 'cobros_sueldo', 'compras_normales', 'compras_tasa_cero',
  'creditos_recibidos', 'cuentas', 'cuotas_credito', 'cuotas_mensuales',
  'inversiones', 'pagos_prestamo', 'prestamos', 'sueldos', 'tarjetas',
  'transacciones', 'usuarios',
];

function validateConfiguration() {
  if (process.env.DB_DATABASE !== 'more-money') throw new Error('La fuente debe ser more-money.');
  const sourceHost = process.env.DB_HOST || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(sourceHost)) {
    throw new Error('La fuente debe ser la PostgreSQL local more-money.');
  }
  if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD || !process.env.SUPABASE_DB_URL) {
    throw new Error('Falta configuración local o SUPABASE_DB_URL.');
  }
  const target = new URL(process.env.SUPABASE_DB_URL);
  const projectRef = getExpectedSupabaseProjectRef();
  const isSupabaseHost = target.hostname.endsWith('.supabase.co') || target.hostname.endsWith('.supabase.com');
  const identifiesProject = target.hostname.includes(projectRef) || target.username.includes(projectRef);
  if (!isSupabaseHost || !identifiesProject) {
    throw new Error('El destino debe ser el host PostgreSQL de Supabase.');
  }
}

function createSourceClient() {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: false,
  });
}

function createTargetClient() {
  return new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: true } });
}

async function fingerprint(client, table) {
  const result = await client.query(`
    SELECT count(*)::text AS total,
      md5(COALESCE(
        string_agg(md5((to_jsonb(source_row) - 'auth_user_id')::text), '' ORDER BY source_row.id),
        ''
      )) AS digest
    FROM public."${table}" AS source_row
  `);
  return result.rows[0];
}

async function main() {
  validateConfiguration();
  const source = createSourceClient();
  const target = createTargetClient();
  let mismatches = 0;

  try {
    await Promise.all([source.connect(), target.connect()]);
    await Promise.all([
      source.query("SET TIME ZONE 'UTC'"),
      target.query("SET TIME ZONE 'UTC'"),
    ]);
    await Promise.all([
      source.query('BEGIN TRANSACTION READ ONLY'),
      target.query('BEGIN TRANSACTION READ ONLY'),
    ]);

    for (const table of TABLES) {
      const [sourceResult, targetResult] = await Promise.all([
        fingerprint(source, table),
        fingerprint(target, table),
      ]);
      const matches = sourceResult.total === targetResult.total && sourceResult.digest === targetResult.digest;
      if (!matches) mismatches += 1;
      console.log(`${table}: origen=${sourceResult.total}, destino=${targetResult.total}, ${matches ? 'OK' : 'DIFERENCIA'}`);
    }
  } catch {
    console.error('No se pudo comparar el origen y el destino; no se imprimieron datos ni credenciales.');
    process.exitCode = 2;
  } finally {
    await Promise.all([source.end().catch(() => {}), target.end().catch(() => {})]);
  }

  if (mismatches) {
    console.error(`La verificación encontró diferencias en ${mismatches} tabla(s).`);
    process.exitCode = 1;
  } else if (!process.exitCode) {
    console.log('Los recuentos y las huellas coinciden en todas las tablas migradas.');
  }
}

main().catch(() => {
  console.error('La configuración de verificación es inválida; no se imprimieron datos ni credenciales.');
  process.exit(2);
});
