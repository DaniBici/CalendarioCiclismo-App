#!/usr/bin/env node
// Rellena los tiempos INDIVIDUALES de corredor en la clasificación de ETAPA
// (classKind='stage', scope='stage') de una CRE, usando los tiempos reales de
// la GC provisional del día (classKind='gc', scope='stage') como fuente —
// Tissot publica ahí el tiempo real de cada corredor (útil cuando el equipo
// llega desunido: un corredor puede ir muy por delante/detrás del resto).
//
// NO TOCA rank/rankText/irm de la clasificación de etapa (el tiempo/rank de
// EQUIPO ya está bien: lo marca el primer corredor del equipo en cruzar, y
// eso ya está en BD). Solo escribe timeText (absoluto) en las filas que aún
// lo tienen NULL, usando bib como clave de cruce entre ambas clasificaciones.
//
// Uso: node _apply-ttt-individual-times.mjs --json <path> --race-id <id> --stage <n> [--dry-run]
'use strict';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);
const JSON_PATH = arg('json');
const RACE_ID = arg('race-id');
const STAGE = Number(arg('stage'));
const DRY = has('dry-run');
if (!JSON_PATH || !RACE_ID || !Number.isFinite(STAGE)) {
  console.error('Uso: --json <path> --race-id <id> --stage <n> [--dry-run]');
  process.exit(1);
}

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

// "H:MM:SS" | "MM:SS" (absoluto) | "+H:MM:SS" | "+MM:SS" | "+SS" (gap) → segundos.
function toSeconds(txt) {
  if (!txt) return null;
  const neg = txt.startsWith('+');
  const clean = txt.replace(/^\+/, '');
  const parts = clean.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return { secs, isGap: neg };
}
function secondsToAbsText(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function main() {
  const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  const stg = (data.stages || []).find((s) => s.stageNumber === STAGE);
  if (!stg) { console.error(`No hay stage ${STAGE} en el JSON.`); process.exit(1); }
  const gc = stg.classifications.find((c) => c.classKind === 'gc' && c.scope === 'stage');
  if (!gc) { console.error('No hay clasificación gc/stage en el JSON — nada que aplicar.'); process.exit(1); }

  // Tiempo absoluto por bib, derivado de gc/stage (rank1 = timeText absoluto; resto = ganador+gap).
  const winner = gc.rows.find((r) => r.rank === 1 && r.timeText);
  const winnerSecs = winner ? toSeconds(winner.timeText)?.secs : null;
  const absByBib = new Map();
  for (const r of gc.rows) {
    if (!r.bib) continue;
    if (r.irm) continue; // abandono: no tiene tiempo, no tocar
    let secs = null;
    if (r.timeText) secs = toSeconds(r.timeText)?.secs ?? null;
    else if (r.gapText && winnerSecs != null) {
      const g = toSeconds(r.gapText);
      if (g) secs = winnerSecs + g.secs;
    }
    if (secs != null) absByBib.set(String(r.bib), secs);
  }
  console.log(`gc/stage: ${gc.rows.length} filas, ${absByBib.size} con tiempo absoluto derivado.`);

  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { console.error('FATAL: falta DATABASE_URL'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: stageRows } = await client.query(`
      select r.id, r.bib, r.rank, r."timeText", r."gapText", r.irm, r."riderDisplay"
      from race_uci_results r
      join race_uci_stages s on s.id = r."stageRef"
      where s."raceId" = $1 and s."stageNumber" = $2 and s."classKind"='stage' and s.scope='stage'
      order by r."sortOrder";
    `, [RACE_ID, STAGE]);
    console.log(`stage/stage en BD: ${stageRows.length} filas.`);

    // OJO: el corredor con `rank` (líder de bloque, el que la UCI/Tissot usa
    // como referencia del EQUIPO en stage/stage) NO tiene por qué ser el más
    // rápido real del equipo — cazado con Bernal (rank=2 del bloque INEOS,
    // pero +3:06 en gc/stage, mientras Ganna es +8 real). Así que el timeText
    // individual de TODOS los corredores (líder incluido) se sobreescribe con
    // el dato real de gc/stage; solo se preserva rank/irm (esos sí son el
    // oficial del equipo/abandono, no se tocan).
    let updated = 0, skippedIrm = 0, skippedNoAbs = 0, skippedSameValue = 0;
    for (const row of stageRows) {
      if (row.irm) { skippedIrm++; continue; } // abandono: no tiene tiempo, no tocar
      const secs = row.bib ? absByBib.get(String(row.bib)) : null;
      if (secs == null) { skippedNoAbs++; continue; }
      const timeText = secondsToAbsText(secs);
      if (row.timeText === timeText) { skippedSameValue++; continue; } // ya correcto
      if (DRY) {
        console.log(`  [dry-run] bib=${row.bib} ${row.riderDisplay} (rank=${row.rank ?? '·'}) → timeText ${row.timeText ?? '∅'} → ${timeText}`);
      } else {
        await client.query(`update race_uci_results set "timeText"=$1 where id=$2`, [timeText, row.id]);
      }
      updated++;
    }
    console.log(`${DRY ? '[dry-run] se actualizarían' : 'actualizadas'}: ${updated} filas. `
      + `(ya correctas: ${skippedSameValue}, irm sin tocar: ${skippedIrm}, sin dato en gc: ${skippedNoAbs})`);
  } finally {
    await client.end();
  }
}
main();
