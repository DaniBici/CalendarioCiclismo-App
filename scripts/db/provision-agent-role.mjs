#!/usr/bin/env node
// Aprovisiona o rota la credencial del rol acotado cc_agent (migración
// 20260929065609_cc_agent_role) y la guarda en el .env del checkout principal:
//
//   AGENT_DATABASE_URL  → cc_agent (sql.mjs y demás herramientas de agentes)
//   DATABASE_URL        → administradora (postgres), sin cambios; solo
//                         apply-migration.mjs y este script
//
//   node scripts/db/provision-agent-role.mjs [--valid-days 180]
//
// Conecta con DATABASE_URL. Genera la contraseña en local y envía a la base
// solo su verificador SCRAM, con VALID UNTIL. Comprueba la conexión nueva antes
// de reescribir el .env (modo 0600). No imprime credenciales.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { loadEnv, mainCheckoutEnvPath, withUrl } from './env.mjs';

export const AGENT_ROLE = 'cc_agent';

export function scramVerifier(password, { salt = randomBytes(16), iterations = 4096 } = {}) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

// Supavisor identifica el proyecto con el sufijo del usuario (postgres.<ref>);
// la conexión directa usa el nombre del rol sin sufijo.
export function agentUrl(adminUrl, password) {
  const url = new URL(adminUrl);
  const user = decodeURIComponent(url.username);
  const dot = user.indexOf('.');
  url.username = `${AGENT_ROLE}${dot === -1 ? '' : user.slice(dot)}`;
  url.password = password;
  return url.toString();
}

export function roleOfUrl(value) {
  return decodeURIComponent(new URL(value).username).split('.')[0];
}

// Sustituye o añade claves conservando el resto de líneas y comentarios.
export function upsertEnv(text, entries) {
  const pending = new Map(Object.entries(entries));
  const lines = text.split('\n').map(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (lines.length && lines.at(-1) === '') lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const options = { validDays: 180 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--valid-days') options.validDays = Number(argv[++i]);
    else throw new Error(`Opción desconocida: ${argv[i]}`);
  }
  if (!Number.isInteger(options.validDays) || options.validDays < 1 || options.validDays > 366) {
    throw new Error('--valid-days debe ser un entero entre 1 y 366.');
  }
  return options;
}

async function connectsAsAgent(url) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const role = await withUrl(url, async client => (await client.query('SELECT current_user AS role')).rows[0].role);
      if (role === AGENT_ROLE) return;
      throw new Error(`La conexión nueva entra como ${role}, no como ${AGENT_ROLE}.`);
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(done => setTimeout(done, attempt * 3000));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envPath = mainCheckoutEnvPath();
  loadEnv(envPath);
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('Falta DATABASE_URL (credencial administradora) en el entorno o en el .env del checkout principal.');
  if (roleOfUrl(adminUrl) === AGENT_ROLE) throw new Error('DATABASE_URL apunta a cc_agent: debe ser la credencial administradora.');

  const password = randomBytes(36).toString('base64url');
  const validUntil = new Date(Date.now() + options.validDays * 86400000).toISOString().slice(0, 10);
  await withUrl(adminUrl, async client => {
    const { rows } = await client.query('SELECT current_user AS role, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists', [AGENT_ROLE]);
    if (rows[0].role === AGENT_ROLE) throw new Error('La credencial administradora apunta a cc_agent.');
    if (!rows[0].exists) throw new Error('El rol cc_agent no existe: aplicar antes la migración cc_agent_role.');
    await client.query(`ALTER ROLE ${AGENT_ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(scramVerifier(password))} VALID UNTIL ${client.escapeLiteral(validUntil)}`);
  });

  const url = agentUrl(adminUrl, password);
  await connectsAsAgent(url);

  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const temporary = `${envPath}.tmp-${process.pid}`;
  writeFileSync(temporary, upsertEnv(current, { AGENT_DATABASE_URL: url }), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, envPath);
  chmodSync(envPath, 0o600);
  console.log(`cc_agent aprovisionado hasta ${validUntil}; ${envPath} actualizado sin mostrar credenciales.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
