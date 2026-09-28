#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStartlistSource } from '../../js/startlist/source.mjs';
export { normalizeStartlistSource } from '../../js/startlist/source.mjs';
const sql = value => `'${String(value).replaceAll("'", "''")}'`;

export function prepareStartlistSql(source, { provisional = false } = {}) {
  const document = normalizeStartlistSource(source);
  return `SELECT public.prepare_startlist_import(${sql(document.raceId)},${sql(JSON.stringify(document))}::jsonb,${provisional ? 'true' : 'false'}) AS report;\n`;
}

export function applyStartlistSql(importId, overrides = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(importId || '')) throw new Error('importId debe ser UUID.');
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Las correcciones deben ser un objeto.');
  return `SELECT public.apply_startlist_import(${sql(importId)}::uuid,${sql(JSON.stringify(overrides))}::jsonb) AS report;\n`;
}

export function withStartlistTiming(query) {
  const operation = query.trim().replace(/;$/, ' FROM started WHERE started.t IS NOT NULL');
  return `WITH started AS MATERIALIZED (SELECT clock_timestamp() t), operation AS MATERIALIZED (${operation}) SELECT report, EXTRACT(EPOCH FROM (clock_timestamp()-started.t))*1000 AS server_ms FROM operation CROSS JOIN started;\n`;
}

function main() {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
  const id = arg('import-id');
  const input = arg('in');
  const pdf = arg('pdf');
  const overridesFile = arg('overrides');
  const overridesJson = arg('overrides-json');
  if (overridesFile && overridesJson) throw new Error('Usa --overrides o --overrides-json, no ambos.');
  if ([id, input, pdf].filter(Boolean).length !== 1) throw new Error('Uso: startlist-import.mjs --in fuente.json | --pdf lista.pdf --race-id ID --year AÑO --source-out fuente.json | --import-id UUID [--overrides correcciones.json | --overrides-json JSON]; opciones: --timed --provisional --sql-out ruta|-');
  let sourcePath = input;
  if (pdf) {
    sourcePath = arg('source-out');
    if (!sourcePath || !arg('race-id') || !/^\d{4}$/.test(arg('year') || '')) throw new Error('El PDF requiere --race-id, --year y --source-out.');
    const extraction = spawnSync('python3', [fileURLToPath(new URL('./startlist-onepage-pdf.py', import.meta.url)),
      '--in', pdf, '--race-id', arg('race-id'), '--year', arg('year'), '--out', sourcePath], { encoding: 'utf8' });
    if (extraction.error || extraction.status !== 0) throw new Error(extraction.error?.message || extraction.stderr.trim() || 'Falló la extracción del PDF.');
  }
  const document = id ? null : JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (document && arg('race-id') && document.raceId !== arg('race-id')) throw new Error('La fuente pertenece a otra carrera.');
  let query = id
    ? applyStartlistSql(id, overridesFile ? JSON.parse(readFileSync(overridesFile, 'utf8')) : overridesJson ? JSON.parse(overridesJson) : {})
    : prepareStartlistSql(document, { provisional: process.argv.includes('--provisional') });
  if (process.argv.includes('--timed')) query = withStartlistTiming(query);
  const out = arg('sql-out') || '-';
  if (out === '-') process.stdout.write(query);
  else writeFileSync(out, query);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
