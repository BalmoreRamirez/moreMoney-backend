#!/usr/bin/env node
'use strict';

// Crea o recupera la única cuenta Auth con el hash bcrypt existente y la vincula al perfil importado.
// Nunca escribe ni imprime la contraseña en texto plano; las credenciales remotas solo vienen del archivo ignorado por Git.
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { getExpectedSupabaseProjectRef } = require('./supabase-project');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.supabase.local'), override: true, quiet: true });

function fail(message) {
  console.error(message);
  process.exit(2);
}

function validateConfig() {
  if (process.env.DB_DATABASE !== 'more-money') fail('La fuente debe ser la base local more-money.');
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost')) {
    fail('La fuente debe ser PostgreSQL local.');
  }
  if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD) fail('Falta configuración de la base local.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) {
    fail('Configura Supabase URL, service role y URL PostgreSQL en .env.supabase.local.');
  }

  const authUrl = new URL(process.env.SUPABASE_URL);
  const dbUrl = new URL(process.env.SUPABASE_DB_URL);
  let projectRef;
  try {
    projectRef = getExpectedSupabaseProjectRef();
  } catch (error) {
    fail(error.message);
  }
  const isSupabaseDatabase = dbUrl.hostname.endsWith('.supabase.co') || dbUrl.hostname.endsWith('.supabase.com');
  const databaseMatchesProject = dbUrl.hostname.includes(projectRef) || dbUrl.username.includes(projectRef);
  if (authUrl.protocol !== 'https:' || authUrl.hostname !== `${projectRef}.supabase.co`) {
    fail('SUPABASE_URL debe apuntar al proyecto Supabase por HTTPS.');
  }
  if (!isSupabaseDatabase || !databaseMatchesProject) {
    fail('SUPABASE_DB_URL debe apuntar a PostgreSQL de Supabase.');
  }
}

function createLocalClient() {
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
  return new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: true },
  });
}

async function getLocalProfile(client) {
  const result = await client.query(`
    SELECT id, usuario, correo, contrasena
    FROM public.usuarios
    ORDER BY id
  `);
  if (result.rowCount !== 1) fail('Se esperaba exactamente un perfil en la base local.');

  const profile = result.rows[0];
  if (typeof profile.correo !== 'string' || !profile.correo.trim()) fail('El perfil local no tiene correo válido.');
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(profile.contrasena)) {
    fail('El hash local no tiene formato bcrypt compatible; no se creó ninguna cuenta Auth.');
  }
  return profile;
}

async function checkTargetProfile(client, profile) {
  const result = await client.query(`
    SELECT id, usuario, correo, contrasena, auth_user_id
    FROM public.usuarios
    ORDER BY id
  `);
  if (result.rowCount !== 1) fail('El destino debe contener exactamente el perfil restaurado.');

  const targetProfile = result.rows[0];
  if (String(targetProfile.id) !== String(profile.id)
    || targetProfile.usuario !== profile.usuario
    || targetProfile.correo.toLowerCase() !== profile.correo.toLowerCase()
    || targetProfile.contrasena !== profile.contrasena) {
    fail('El perfil restaurado no coincide con la fuente local. No se creó ni vinculó la cuenta Auth.');
  }

  const owner = await client.query(`
    SELECT auth_user_id FROM app_private.single_user_owner WHERE singleton = true
  `);
  if (owner.rowCount > 1) fail('La configuración de propietario no es válida.');
  return { targetProfile, currentOwnerId: owner.rows[0]?.auth_user_id ?? null };
}

async function adminRequest(pathname, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin${pathname}`, {
      method,
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    fail('No se pudo conectar con Supabase Auth.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('Supabase Auth devolvió una respuesta inválida.');
  }
  if (!response.ok) fail('Supabase Auth rechazó la importación de la cuenta; revisa el proyecto sin compartir claves.');
  return payload;
}

async function getOrCreateAuthUser(profile) {
  const result = await adminRequest('/users?per_page=1000&page=1');
  const users = result.users;
  if (!Array.isArray(users) || users.length >= 1000) fail('No se pudo comprobar que el proyecto tenga una sola cuenta.');

  const email = profile.correo.trim().toLowerCase();
  const matchingUsers = users.filter((user) => user.email?.toLowerCase() === email);
  const otherUsers = users.filter((user) => user.email?.toLowerCase() !== email);
  if (otherUsers.length || matchingUsers.length > 1) {
    fail('El proyecto Auth contiene cuentas distintas a la única cuenta esperada.');
  }

  if (matchingUsers.length === 1) {
    const user = matchingUsers[0];
    if (user.app_metadata?.moremoney_bcrypt_imported !== true) {
      fail('Ya existe una cuenta Auth con ese correo que no fue creada por esta migración.');
    }
    return user.id;
  }

  const user = await adminRequest('/users', 'POST', {
    email,
    password_hash: profile.contrasena,
    email_confirm: true,
    user_metadata: { usuario: profile.usuario },
    app_metadata: { moremoney_bcrypt_imported: true },
  });
  const userId = user.id ?? user.user?.id;
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    fail('Supabase Auth creó una respuesta sin un UUID válido; revisa la consola del proyecto.');
  }
  return userId;
}

async function linkOwner(client, profile, authUserId, currentOwnerId, currentProfileAuthId) {
  if (currentOwnerId && currentOwnerId !== authUserId) fail('Ya hay otra identidad configurada como propietaria.');
  if (currentProfileAuthId && currentProfileAuthId !== authUserId) fail('El perfil ya está vinculado a otra cuenta Auth.');

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE public.usuarios SET auth_user_id = $1 WHERE id = $2`,
      [authUserId, profile.id],
    );
    if (!currentOwnerId) {
      await client.query(
        `INSERT INTO app_private.single_user_owner (singleton, auth_user_id) VALUES (true, $1)`,
        [authUserId],
      );
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    fail('No se pudo vincular la cuenta Auth al perfil importado.');
  }
}

async function main() {
  validateConfig();
  const local = createLocalClient();
  const target = createTargetClient();
  let profile;
  let targetState;

  try {
    await Promise.all([local.connect(), target.connect()]);
    await local.query('BEGIN TRANSACTION READ ONLY');
    profile = await getLocalProfile(local);
    await local.query('COMMIT');
    targetState = await checkTargetProfile(target, profile);
  } catch {
    await local.query('ROLLBACK').catch(() => {});
    fail('No se pudieron validar los perfiles de origen y destino; no se mostró ningún dato.');
  }

  try {
    const authUserId = await getOrCreateAuthUser(profile);
    await linkOwner(target, profile, authUserId, targetState.currentOwnerId, targetState.targetProfile.auth_user_id);
    console.log(`Cuenta Supabase Auth vinculada. OWNER_USER_ID=${authUserId}`);
    console.log('Configura ese UUID como secreto OWNER_USER_ID de la Edge Function api. El correo y el hash no se imprimieron.');
  } finally {
    await Promise.all([local.end().catch(() => {}), target.end().catch(() => {})]);
  }
}

main().catch(() => fail('Falló la configuración de Supabase Auth; no se mostraron datos ni credenciales.'));
