#!/usr/bin/env node
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { openSync, writeFileSync, closeSync, lstatSync, readFileSync } from 'node:fs';

// Ejecutar solo como root en el VPS. No abre conexiones ni lee otros secretos.
// stdout contiene exclusivamente el verificador SCRAM para el canal administrativo.
const [host, output] = process.argv.slice(2);
if (process.getuid?.() !== 0 || !/^db\.[a-z]{20}\.supabase\.co$/.test(host || '')
  || output !== '/etc/calendario-ciclismo/uci-catalog.env.pending') throw new Error('invalid_provisioning_arguments');
let password;
try {
  const stat = lstatSync(output);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600) throw new Error('unsafe_pending_credential');
  const line = readFileSync(output, 'utf8').trim();
  if (!line.startsWith('UCI_CATALOG_DATABASE_URL=')) throw new Error('invalid_pending_credential');
  let url;
  try { url = new URL(line.slice('UCI_CATALOG_DATABASE_URL='.length)); }
  catch { throw new Error('invalid_pending_url'); }
  if (url.hostname !== host || url.username !== 'cc_uci_catalog_worker' || url.search || url.hash
    || url.protocol !== 'postgresql:' || url.pathname !== '/postgres' || url.port !== '5432') throw new Error('pending_endpoint_mismatch');
  password = url.password;
  if (!/^[A-Za-z0-9_-]{48}$/.test(password)) throw new Error('invalid_pending_password');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  password = randomBytes(36).toString('base64url');
  const fd = openSync(output, 'wx', 0o600);
  try { writeFileSync(fd, `UCI_CATALOG_DATABASE_URL=postgresql://cc_uci_catalog_worker:${password}@${host}:5432/postgres\n`); }
  finally { closeSync(fd); }
}
const iterations = 32768, salt = randomBytes(16);
const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const clientKey = createHmac('sha256', salted).update('Client Key').digest();
const stored = createHash('sha256').update(clientKey).digest('base64');
const server = createHmac('sha256', salted).update('Server Key').digest('base64');
console.log(JSON.stringify({ role: 'cc_uci_catalog_worker',
  verifier: `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`, pendingFile: output }));
