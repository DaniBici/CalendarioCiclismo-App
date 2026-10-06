// Carga las variables del .env del checkout principal, sin imprimirlas. Las
// variables ya presentes en el entorno prevalecen.
// AGENT_DATABASE_URL es la credencial del rol acotado cc_agent, la de las
// herramientas de agentes; DATABASE_URL, la administradora (postgres), solo
// para migraciones y aprovisionamiento.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function mainCheckoutEnvPath(cwd = process.cwd()) {
  const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (git.status !== 0) return resolve(cwd, '.env');
  return resolve(dirname(git.stdout.trim()), '.env');
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

export function loadEnv(path = mainCheckoutEnvPath()) {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Conexión de los scripts que también corren en el VPS: AGENT_DATABASE_URL
// (cc_agent) en la máquina local; en el VPS no existe y se usa DATABASE_URL
// del rol worker.
export function databaseUrl(source = process.env) {
  return source.AGENT_DATABASE_URL || source.DATABASE_URL;
}

export async function withClient(callback, { variables = ['AGENT_DATABASE_URL'] } = {}) {
  loadEnv();
  const url = variables.map(name => process.env[name]).find(Boolean);
  if (!url) {
    const hint = variables.includes('AGENT_DATABASE_URL') ? ' Aprovisionarla con node scripts/db/provision-agent-role.mjs (docs/runbooks/rol-agentes.md).' : '';
    throw new Error(`Falta ${variables.join(' o ')} en el entorno o en el .env del checkout principal.${hint}`);
  }
  return withUrl(url, callback);
}

export async function withUrl(url, callback) {
  const { default: pg } = await import('pg');
  // `date` como texto YYYY-MM-DD: el parser por defecto lo convierte a medianoche
  // local y el JSON lo desplaza un día al este de UTC.
  pg.types.setTypeParser(1082, value => value);
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}
