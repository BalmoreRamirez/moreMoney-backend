#!/usr/bin/env node
'use strict';

// Exporta la base local more-money a un archivo privado. No modifica la BD.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

function fail(message) {
  console.error(message);
  process.exit(2);
}

for (const command of ['pg_dump', 'pg_restore', 'psql']) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`No se encontró una instalación válida de ${command}.`);
}

const database = process.env.DB_DATABASE;
const host = process.env.DB_HOST || 'localhost';
if (database !== 'more-money') fail('DB_DATABASE debe ser exactamente more-money para proteger otras bases.');
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  fail('DB_HOST debe apuntar a una base local (localhost) para usar este respaldo.');
}
if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD) {
  fail('Falta configurar DB_USERNAME o DB_PASSWORD en moreMoney-backend/.env.');
}

const pgEnv = {
  ...process.env,
  PGHOST: host,
  PGPORT: process.env.DB_PORT || '5432',
  PGUSER: process.env.DB_USERNAME,
  PGPASSWORD: process.env.DB_PASSWORD,
  PGDATABASE: database,
  PGAPPNAME: 'moremoney-local-backup',
};

const versionResult = spawnSync(
  'psql',
  ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'SHOW server_version_num'],
  { encoding: 'utf8', env: pgEnv },
);
if (versionResult.error || versionResult.status !== 0) {
  fail('No se pudo conectar a la PostgreSQL local more-money. Revisa el servicio y la configuración local.');
}

const serverVersionNum = Number(versionResult.stdout.trim());
const serverMajor = Math.floor(serverVersionNum / 10000);
const dumpVersionText = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' }).stdout;
const dumpMajor = Number(dumpVersionText.match(/\(PostgreSQL\)\s*(\d+)(?:\.\d+)?/)?.[1]);
if (!Number.isInteger(serverMajor) || !Number.isInteger(dumpMajor)) fail('No se pudo identificar la versión de PostgreSQL.');
if (dumpMajor < serverMajor) fail(`pg_dump ${dumpMajor} no puede exportar PostgreSQL ${serverMajor}.`);

if (process.argv.length > 3) fail('Uso: npm run db:backup [ruta-nueva-del-respaldo.dump]');

let temporaryDirectory = '';
let outputFile;
if (process.argv[2]) {
  outputFile = path.resolve(process.argv[2]);
  if (fs.existsSync(outputFile)) fail('El archivo ya existe; elige una ruta nueva para no sobrescribirlo.');
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
} else {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'moremoney-local-backup-'));
  fs.chmodSync(temporaryDirectory, 0o700);
  outputFile = path.join(temporaryDirectory, 'more-money.dump');
}

const dump = spawnSync('pg_dump', [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  `--file=${outputFile}`,
  database,
], { encoding: 'utf8', env: pgEnv, stdio: ['ignore', 'ignore', 'pipe'] });

if (dump.error || dump.status !== 0) {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  else fs.rmSync(outputFile, { force: true });
  fail('Falló la exportación PostgreSQL; no se conservó un archivo parcial.');
}

fs.chmodSync(outputFile, 0o600);
const verify = spawnSync('pg_restore', ['--list', outputFile], { stdio: 'ignore' });
if (verify.error || verify.status !== 0) {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  else fs.rmSync(outputFile, { force: true });
  fail('El archivo exportado no pasó la verificación de pg_restore.');
}

console.log(`Respaldo local verificado: ${outputFile}`);
console.log('No se modificó la base. Protege este archivo porque contiene todos los datos exportados.');
