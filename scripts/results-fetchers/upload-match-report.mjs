#!/usr/bin/env node
/**
 * upload-match-report.mjs — sube el match-report.json del matcher UCI al bucket
 * PRIVADO `uci-reports` de Supabase Storage (migración 133).
 *
 * POR QUÉ EXISTE: hasta 2026-07-19 los crons COMMITEABAN el report a main y el
 * panel lo leía con una ruta relativa (../scripts/...). Dos problemas:
 *
 *   1) ROTO EN PRODUCCIÓN — build-site.yml excluye `scripts/` del rsync a _site,
 *      así que esa ruta daba 404 y la auto-detección de candidatos UCI del panel
 *      no funcionaba (regresión silenciosa de la migración a Pages-por-artifact).
 *   2) RUIDO EN EL HISTORIAL — dos commits "[auto]" diarios en main.
 *
 * Ambos se arreglan sirviendo el report desde Storage. Lo lee `_loadUciReport`
 * (js/panel.js) con la sesión del panel; el bucket es privado a propósito (el
 * report expone el calendario interno y los candidatos sin casar).
 *
 * QUIÉN LO LLAMA: uci-link-discover.yml (05:40) y uci-link-evening.yml (19:00),
 * justo después de correr el matcher. NINGÚN otro script lee el report de disco
 * ajeno: uci-backfill-links.mjs y uci-link-evening.mjs lo GENERAN ellos mismos y
 * lo leen del disco del runner → no dependen de esta subida.
 *
 * REST directo con fetch, sin @supabase/supabase-js: es una sola petición y CI
 * no tiene (ni necesita) el SDK instalado.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... node upload-match-report.mjs [--year 2026] [--dry-run]
 *   --file <path>   ruta explícita del report (por defecto, la del año)
 *
 * FALLA RUIDOSAMENTE (exit != 0) si la subida no cuaja: degradarse en silencio
 * dejaría al panel con un report viejo sin que nadie se entere, que es justo el
 * fallo mudo que este cambio viene a arreglar.
 *
 * Nota Date.now(): script Node CLI normal (no un Workflow del harness) → el reloj
 * del sistema es válido y necesario para saber el año en curso.
 */
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getArg = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] != null ? args[i + 1] : d;
};
const hasFlag = (n) => args.includes(`--${n}`);

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const fail = (msg) => { log(`FATAL: ${msg}`); process.exit(1); };

const YEAR = getArg('year') || String(new Date().getUTCFullYear());
const DRY = hasFlag('dry-run');

// La URL del proyecto NO es secreta (va hardcodeada en uci-link-evening.mjs y en
// js/config.js). Se admite override por entorno porque el workflow ya inyecta el
// secret SUPABASE_URL para otros scripts (translate-content.yml).
const SUPA_URL = (process.env.SUPABASE_URL || 'https://bcecwlkynpgovnzhbpah.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'uci-reports';
const OBJECT = `match-${YEAR}.json`;

const HERE = new URL('.', import.meta.url).pathname;
const REPORT = getArg('file') || join(HERE, '_results_run', `match-${YEAR}`, 'match-report.json');

// ── validaciones previas ────────────────────────────────────────────────────
if (!existsSync(REPORT)) {
  // No es un error: si el matcher no corrió (año sin seasonId), no hay nada que
  // subir y el cron no debe romperse por ello.
  log(`No existe ${REPORT} — nada que subir.`);
  process.exit(0);
}

const raw = readFileSync(REPORT, 'utf8');

// Un report truncado/corrupto subido a Storage rompería el panel en silencio:
// se valida que parsea y que trae los tres buckets que el panel indexa.
let parsed;
try { parsed = JSON.parse(raw); }
catch (e) { fail(`${REPORT} no es JSON válido: ${e.message}`); }

for (const k of ['unique', 'ambiguous', 'none']) {
  if (!Array.isArray(parsed[k])) fail(`el report no trae el array "${k}" (¿formato cambiado?)`);
}
const total = parsed.unique.length + parsed.ambiguous.length + parsed.none.length;
if (total === 0) fail('el report no trae ni un registro — no se sube (dejaría al panel sin candidatos).');

log(`Report: ${REPORT}`);
log(`  ${(raw.length / 1024).toFixed(0)} KB · unique=${parsed.unique.length} ambiguous=${parsed.ambiguous.length} none=${parsed.none.length}`);
log(`Destino: ${BUCKET}/${OBJECT}`);

if (DRY) { log('--dry-run: no se sube nada.'); process.exit(0); }

if (!SERVICE_KEY) fail('falta SUPABASE_SERVICE_ROLE_KEY en el entorno.');

// ── subida (upsert) ─────────────────────────────────────────────────────────
const url = `${SUPA_URL}/storage/v1/object/${BUCKET}/${OBJECT}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'x-upsert': 'true',           // sobrescribe la copia anterior
    'cache-control': 'max-age=60' // el panel hace su propia caché en memoria
  },
  body: raw
});

if (!res.ok) {
  const body = await res.text().catch(() => '');
  fail(`subida rechazada: HTTP ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
}

log(`OK — subido ${BUCKET}/${OBJECT} (${(raw.length / 1024).toFixed(0)} KB)`);
process.stdout.write(JSON.stringify({ ok: true, bucket: BUCKET, object: OBJECT, bytes: raw.length, records: total }) + '\n');
