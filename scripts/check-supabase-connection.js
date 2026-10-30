#!/usr/bin/env node
'use strict';

// Comprueba solo conectividad; no lee ni modifica tablas de negocio.
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const { getExpectedSupabaseProjectRef } = require('./supabase-project');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.supabase.local'), override: true, quiet: true });

function readConfiguration() {
  const projectRef = getExpectedSupabaseProjectRef();
  const publicKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  let authUrl = null;
  let authError = null;
  try {
    authUrl = new URL(process.env.SUPABASE_URL || '');
  } catch {
    authError = 'Configura SUPABASE_URL en .env.supabase.local.';
  }
  if (!authError && (authUrl.protocol !== 'https:' || authUrl.hostname !== `${projectRef}.supabase.co`)) {
    authError = 'SUPABASE_URL no corresponde al proyecto Supabase esperado.';
  }
  if (!publicKey) authError = authError || 'Falta SUPABASE_ANON_KEY o SUPABASE_PUBLISHABLE_KEY.';

  let databaseUrl = null;
  let databaseError = null;
  try {
    databaseUrl = new URL(process.env.SUPABASE_DB_URL || '');
  } catch {
    databaseError = 'Configura SUPABASE_DB_URL en .env.supabase.local.';
  }
  if (!databaseError && !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    databaseError = 'SUPABASE_DB_URL debe usar el protocolo PostgreSQL.';
  }
  if (!databaseError) {
    const missingParts = [];
    if (!databaseUrl.username) missingParts.push('usuario');
    if (!databaseUrl.password || databaseUrl.password.includes('<')) missingParts.push('contraseña real');
    if (!databaseUrl.hostname) missingParts.push('host');
    if (!databaseUrl.pathname.replace(/^\//, '')) missingParts.push('base');
    if (missingParts.length) {
      databaseError = `SUPABASE_DB_URL incompleta: faltan ${missingParts.join(', ')}.`;
    }
  }
  if (!databaseError) {
    const validDatabaseHost = databaseUrl.hostname.endsWith('.supabase.co')
      || databaseUrl.hostname.endsWith('.supabase.com');
    const identifiesProject = databaseUrl.hostname.includes(projectRef)
      || databaseUrl.username.includes(projectRef);
    if (!validDatabaseHost || !identifiesProject) {
      databaseError = 'SUPABASE_DB_URL debe apuntar al PostgreSQL del proyecto Supabase esperado.';
    }
  }

  return { authUrl, authError, publicKey, databaseUrl, databaseError };
}

async function checkAuth(authUrl, publicKey) {
  try {
    const response = await fetch(`${authUrl.origin}/auth/v1/health`, {
      headers: publicKey ? { apikey: publicKey } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      console.log(`Supabase Auth: conectado (HTTP ${response.status}).`);
      return true;
    }
    console.error(`Supabase Auth respondió HTTP ${response.status}; revisa la clave pública y el estado del proyecto.`);
    return false;
  } catch (error) {
    const code = error.cause?.code;
    console.error(`Supabase Auth: sin conexión${code ? ` (${code})` : ''}.`);
    return false;
  }
}

async function checkDatabase(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl.toString(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 8000,
    statement_timeout: 5000,
    application_name: 'moremoney-supabase-read-only-check',
  });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query('SELECT current_database() AS database, current_setting(\'server_version\') AS version');
    await client.query('ROLLBACK');
    console.log(`PostgreSQL Supabase: conectado (PostgreSQL ${result.rows[0].version}, base ${result.rows[0].database}).`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const code = error.code;
    console.error(`PostgreSQL Supabase: sin conexión${code ? ` (${code})` : ''}.`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  let config;
  try {
    config = readConfiguration();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const [authConnected, databaseConnected] = await Promise.all([
    config.authError
      ? Promise.resolve(false).then(() => console.error(`Supabase Auth: ${config.authError}`))
      : checkAuth(config.authUrl, config.publicKey),
    config.databaseError
      ? Promise.resolve(false).then(() => console.error(`PostgreSQL Supabase: ${config.databaseError}`))
      : checkDatabase(config.databaseUrl),
  ]);
  if (config.authError || config.databaseError) process.exitCode = 2;
  else if (!authConnected || !databaseConnected) process.exitCode = 1;
}

main().catch(() => {
  console.error('No se pudo completar la comprobación de conexión. No se imprimieron credenciales.');
  process.exitCode = 1;
});
