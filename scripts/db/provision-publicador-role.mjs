#!/usr/bin/env node
// Aprovisiona o rota la credencial del rol de solo lectura cc_publicador (migración
// cc_publicador_role) y la guarda en el VPS, en /etc/calendario-ciclismo/publicador.env
// (root:cc-results, 0640), como PUBLICADOR_DATABASE_URL.
//
//   node scripts/db/provision-publicador-role.mjs [--valid-days 366]
//
// Conecta con DATABASE_URL. Genera la contraseña en local y envía a la base solo su
// verificador SCRAM, con VALID UNTIL. Comprueba la conexión nueva antes de escribirla en el
// VPS. No imprime credenciales ni las guarda en este equipo.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnv, mainCheckoutEnvPath, withUrl } from './env.mjs';
import { agentUrl, connectsAsAgent, roleOfUrl, scramVerifier } from './provision-agent-role.mjs';

const ROLE = 'cc_publicador';
const VPS = 'root@116.203.47.20';
const DESTINO = '/etc/calendario-ciclismo/publicador.env';

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--valid-days');
  const validDays = at === -1 ? 366 : Number(args[at + 1]);
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 366) throw new Error('--valid-days debe ser un entero entre 1 y 366.');
  loadEnv(mainCheckoutEnvPath());
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('Falta DATABASE_URL (credencial administradora) en el .env del checkout principal.');
  if (roleOfUrl(adminUrl) === ROLE) throw new Error('DATABASE_URL apunta a cc_publicador: debe ser la credencial administradora.');

  const password = randomBytes(36).toString('base64url');
  const validUntil = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
  await withUrl(adminUrl, async client => {
    const { rows } = await client.query('SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists', [ROLE]);
    if (!rows[0].exists) throw new Error('El rol cc_publicador no existe: aplicar antes la migración cc_publicador_role.');
    await client.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(scramVerifier(password))} VALID UNTIL ${client.escapeLiteral(validUntil)}`);
  });
  const url = agentUrl(adminUrl, password, ROLE);
  await connectsAsAgent(url, ROLE);

  const orden = `umask 027 && cat > ${DESTINO}.tmp && chown root:cc-results ${DESTINO}.tmp && chmod 640 ${DESTINO}.tmp && mv ${DESTINO}.tmp ${DESTINO}`;
  const envio = spawnSync('ssh', ['-o', 'BatchMode=yes', VPS, orden], { input: `PUBLICADOR_DATABASE_URL=${url}\n`, stdio: ['pipe', 'ignore', 'inherit'] });
  if (envio.status !== 0) throw new Error(`No se pudo escribir ${DESTINO} en el VPS.`);
  console.log(`${ROLE} aprovisionado hasta ${validUntil}; ${DESTINO} actualizado sin mostrar credenciales.`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
