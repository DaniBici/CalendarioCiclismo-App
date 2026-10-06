#!/usr/bin/env node
// Ejecuta SQL contra la base de producción con AGENT_DATABASE_URL (rol
// cc_agent). Alternativa al execute_sql del conector MCP de Supabase para
// agentes sin MCP.
//
//   node scripts/db/sql.mjs "SELECT 1"
//   node scripts/db/sql.mjs --file consulta.sql
//   node scripts/data-preflight/startlist-import.mjs --in fuente.json | node scripts/db/sql.mjs
//
// Opciones: --read-only (transacción de solo lectura), --rollback (ejecuta en
// una transacción y la revierte: prueba escrituras sin dejar cambios; pg_net no
// envía nada revertido), --all (resultados de todas las sentencias; por
// defecto, solo la última, como execute_sql).
// Salida: JSON compacto por stdout. Código 1 ante error. Aviso por stderr si la
// credencial caduca en menos de EXPIRY_WARNING_DAYS días (VALID UNTIL).
import { readFileSync } from 'node:fs';
import { withClient } from './env.mjs';

export const EXPIRY_WARNING_DAYS = 30;

export function expiryWarning(validUntil, now = new Date()) {
  if (!validUntil) return null;
  const days = Math.floor((new Date(validUntil) - now) / 86400000);
  if (days >= EXPIRY_WARNING_DAYS) return null;
  const date = new Date(validUntil).toISOString().slice(0, 10);
  return `Aviso: la credencial de base de datos caduca el ${date} (${Math.max(days, 0)} días). Rotarla con node scripts/db/provision-agent-role.mjs.`;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function parseArgs(argv) {
  const options = { readOnly: false, rollback: false, all: false, file: null, query: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--rollback') options.rollback = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--file') options.file = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Opción desconocida: ${arg}`);
    else options.query = arg;
  }
  return options;
}

// Detecta BEGIN/COMMIT/ROLLBACK/END/START TRANSACTION/SAVEPOINT como sentencia
// propia, fuera de comentarios, cadenas y cuerpos $$…$$ (los BEGIN/END de
// PL/pgSQL no cuentan). Un COMMIT interno anularía --rollback y --read-only.
export function hasTransactionControl(sql) {
  const code = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  return code.split(';').some(statement =>
    /^\s*(begin|commit|rollback|end|abort|start\s+transaction|savepoint|release)\b/i.test(statement));
}

export function pickRows(result, all) {
  const results = (Array.isArray(result) ? result : [result]).filter(r => r.command);
  const rows = results.map(r => (r.rows?.length || r.command === 'SELECT' ? r.rows : { command: r.command, rowCount: r.rowCount }));
  return all ? rows : rows.at(-1) ?? [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const query = options.query ?? (options.file ? readFileSync(options.file, 'utf8') : readStdin());
  if (!query.trim()) throw new Error('Sin SQL: pasar la consulta como argumento, con --file o por stdin.');
  if ((options.readOnly || options.rollback) && hasTransactionControl(query)) {
    throw new Error('El SQL contiene control de transacción (BEGIN/COMMIT/…): con --read-only o --rollback se confirmaría. Retirarlo antes, p. ej. grep -vxiE "BEGIN;|COMMIT;".');
  }
  const output = await withClient(async client => {
    const { rows } = await client.query('SELECT rolvaliduntil FROM pg_catalog.pg_roles WHERE rolname = current_user');
    const warning = expiryWarning(rows[0]?.rolvaliduntil);
    if (warning) console.error(warning);
    if (!options.readOnly && !options.rollback) return pickRows(await client.query(query), options.all);
    await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    try {
      const result = await client.query(query);
      return pickRows(result, options.all);
    } finally {
      await client.query('ROLLBACK');
    }
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
