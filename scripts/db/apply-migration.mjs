#!/usr/bin/env node
// Aplica una migración y la registra como el apply_migration del conector MCP
// de Supabase, para agentes sin MCP: ejecuta el SQL, inserta la fila en
// supabase_migrations.schema_migrations y escribe
// supabase/migrations/<versión>_<nombre>.sql con el texto exacto aplicado.
//
//   node scripts/db/apply-migration.mjs <nombre_snake_case> <archivo.sql> [--dry-run]
//
// --dry-run ejecuta todo dentro de la transacción y la revierte. El SQL no puede
// llevar control de transacción propio (BEGIN/COMMIT/…): su COMMIT confirmaría
// la simulación y dejaría el registro fuera de la transacción del script.
// Usa DATABASE_URL, la credencial administradora (el rol cc_agent de
// AGENT_DATABASE_URL no puede aplicar migraciones).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { withClient } from './env.mjs';
import { hasTransactionControl } from './sql.mjs';

export function migrationVersion(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function checkMigrationSql(query) {
  if (!query.trim()) throw new Error('Migración vacía.');
  if (hasTransactionControl(query)) {
    throw new Error('El SQL contiene control de transacción (BEGIN/COMMIT/…): apply-migration.mjs ya lo ejecuta en una transacción y un COMMIT propio confirmaría también --dry-run. Retirarlo, p. ej. grep -vxiE "BEGIN;|COMMIT;".');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const [name, file] = args.filter(arg => !arg.startsWith('--'));
  if (!/^[a-z0-9_]+$/.test(name || '') || !file) {
    throw new Error('Uso: apply-migration.mjs <nombre_snake_case> <archivo.sql> [--dry-run]');
  }
  const query = readFileSync(file, 'utf8');
  checkMigrationSql(query);
  const author = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim() || null;
  const version = migrationVersion();
  await withClient(async client => {
    await client.query('BEGIN');
    try {
      await client.query(query);
      await client.query(
        'INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by) VALUES ($1, $2, ARRAY[$3], $4)',
        [version, name, query, author],
      );
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }, { variables: ['DATABASE_URL'] });
  if (dryRun) {
    console.log(`Simulación correcta de ${name}; transacción revertida.`);
    return;
  }
  const out = resolve('supabase/migrations', `${version}_${name}.sql`);
  writeFileSync(out, query);
  console.log(`Aplicada ${version}_${name}; archivo ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
