#!/usr/bin/env node
'use strict';

// Restaura únicamente los datos del respaldo local en un esquema Supabase ya preparado.
// No limpia ni sobrescribe filas: rechaza el destino si alguna tabla de negocio ya contiene datos.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
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

function fail(message) {
  console.error(message);
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`Falló ${command}.`);
  return result;
}

async function main() {
  const backupFile = process.argv[2] && path.resolve(process.argv[2]);
  const target = process.env.SUPABASE_DB_URL;
  if (!backupFile || !fs.existsSync(backupFile)) fail('Indica la ruta existente del respaldo custom de more-money.');
  if (!target) fail('Configura SUPABASE_DB_URL en moreMoney-backend/.env.supabase.local.');
  if (process.env.DB_DATABASE !== 'more-money') fail('DB_DATABASE debe ser more-money antes de iniciar la restauración.');

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    fail('SUPABASE_DB_URL no es una URL PostgreSQL válida.');
  }
  let projectRef;
  try {
    projectRef = getExpectedSupabaseProjectRef();
  } catch (error) {
    fail(error.message);
  }
  const isSupabaseHost = targetUrl.hostname.endsWith('.supabase.co') || targetUrl.hostname.endsWith('.supabase.com');
  const identifiesProject = targetUrl.hostname.includes(projectRef) || targetUrl.username.includes(projectRef);
  if (!isSupabaseHost || !identifiesProject || ['localhost', '127.0.0.1'].includes(targetUrl.hostname)) {
    fail('SUPABASE_DB_URL debe apuntar al host PostgreSQL de Supabase.');
  }

  const client = new Client({ connectionString: target, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    const counts = await Promise.all(TABLES.map(async (table) => {
      const result = await client.query(`SELECT count(*)::bigint AS total FROM public."${table}"`);
      return [table, Number(result.rows[0].total)];
    }));
    const occupied = counts.filter(([, count]) => count > 0);
    if (occupied.length) fail('El destino ya contiene datos; no se inició la restauración para evitar duplicados.');
  } catch (error) {
    if (error.code === 'ERR_EXIT') throw error;
    fail('No se pudo comprobar que el esquema Supabase esté vacío. Revisa conexión y migraciones.');
  } finally {
    await client.end().catch(() => {});
  }

  let listResult;
  try {
    listResult = run('pg_restore', ['--list', backupFile]);
  } catch {
    fail('No se pudo leer el respaldo; no se inició la restauración.');
  }
  const entries = listResult.stdout
    .split('\n')
    .filter((line) => line && !line.includes('SequelizeMeta'));
  if (!entries.some((line) => line.includes('TABLE DATA public cuentas'))) {
    fail('El respaldo no parece contener los datos de MoreMoney.');
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moremoney-supabase-restore-'));
  fs.chmodSync(directory, 0o700);
  const listFile = path.join(directory, 'restore.list');
  fs.writeFileSync(listFile, entries.join('\n'));
  fs.chmodSync(listFile, 0o600);
  const password = decodeURIComponent(targetUrl.password);
  targetUrl.password = '';
  if (!targetUrl.searchParams.has('sslmode')) targetUrl.searchParams.set('sslmode', 'require');
  const pgEnv = { ...process.env, PGPASSWORD: password };
  const dataFile = path.join(directory, 'restore.sql');

  try {
    run('pg_restore', [
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      `--use-list=${listFile}`,
      `--file=${dataFile}`,
      backupFile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.chmodSync(dataFile, 0o600);

    // pg_dump 18 emits this setting, which does not exist on older Supabase Postgres majors.
    const portableSql = fs.readFileSync(dataFile, 'utf8').replace(/^SET transaction_timeout = 0;\r?\n/gm, '');
    fs.writeFileSync(dataFile, portableSql, { mode: 0o600 });

    run('psql', [
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '--single-transaction',
      `--dbname=${targetUrl.toString()}`,
      `--file=${dataFile}`,
    ], { env: pgEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log('Restauración completada en Supabase. Se conservaron los IDs y las relaciones del respaldo.');
  console.log('La base local no fue modificada. Ejecuta npm run db:verify:supabase antes de habilitar la aplicación.');
}

main().catch(() => fail('Falló la restauración; revisa conexión y compatibilidad de PostgreSQL.'));
