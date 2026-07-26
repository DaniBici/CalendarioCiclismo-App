#!/usr/bin/env node
// Reordena las sub-filas de corredor DENTRO de cada bloque de equipo de una
// clasificación de etapa CRE (classKind='stage', scope='stage'), por timeText
// ascendente (el más rápido primero). El render web pinta los corredores en
// el orden de `sortOrder` sin reordenar por tiempo — así que si sortOrder viene
// por dorsal (como lo deja el fetcher/upsert), el desplegable sale desordenado
// (p. ej. Affini 26:10 antes que Piganzoli 22:15 en el bloque de Visma).
//
// NO reordena los BLOQUES de equipo entre sí (eso ya va bien: por rank/orden
// de llegada). Solo reordena los corredores dentro de cada bloque. El líder
// (fila con rank no-null) se identifica por bib pero no se fuerza su posición:
// si su propio timeText es el menor del bloque (normal, es quien marca el
// tiempo de equipo), quedará primero de forma natural.
//
// Uso: node _reorder-ttt-riders-by-time.mjs --race-id <id> --stage <n> [--dry-run]
'use strict';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);
const RACE_ID = arg('race-id');
const STAGE = Number(arg('stage'));
const DRY = has('dry-run');
if (!RACE_ID || !Number.isFinite(STAGE)) { console.error('Uso: --race-id <id> --stage <n> [--dry-run]'); process.exit(1); }

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}
function timeToSecs(txt) {
  if (!txt) return null;
  const parts = String(txt).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { console.error('FATAL: falta DATABASE_URL'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select r.id, r.bib, r.rank, r."timeText", r.irm, r."riderDisplay", r."sortOrder"
      from race_uci_results r
      join race_uci_stages s on s.id = r."stageRef"
      where s."raceId" = $1 and s."stageNumber" = $2 and s."classKind"='stage' and s.scope='stage'
      order by r."sortOrder";
    `, [RACE_ID, STAGE]);
    if (!rows.length) { console.log('Sin filas.'); return; }

    // Agrupar en bloques: nuevo bloque cada vez que aparece una fila con rank no-null.
    const blocks = [];
    let cur = null;
    for (const r of rows) {
      if (r.rank != null) { cur = []; blocks.push(cur); }
      if (cur == null) { cur = []; blocks.push(cur); } // filas sueltas antes del primer rank (no debería pasar)
      cur.push(r);
    }

    const updates = [];
    let nextSort = 0;
    for (const block of blocks) {
      // Orden dentro del bloque: por timeText ascendente; irm (DNF/DNS/...) al final;
      // sin timeText y sin irm (no debería quedar ninguno tras el relleno) al final también.
      const sorted = [...block].sort((a, b) => {
        const aIrm = !!a.irm, bIrm = !!b.irm;
        if (aIrm !== bIrm) return aIrm ? 1 : -1;
        const aSec = timeToSecs(a.timeText), bSec = timeToSecs(b.timeText);
        if (aSec == null && bSec == null) return 0;
        if (aSec == null) return 1;
        if (bSec == null) return -1;
        return aSec - bSec;
      });
      for (const r of sorted) {
        if (r.sortOrder !== nextSort) updates.push({ id: r.id, from: r.sortOrder, to: nextSort, bib: r.bib, name: r.riderDisplay, time: r.timeText });
        nextSort++;
      }
    }

    console.log(`${blocks.length} bloques de equipo, ${rows.length} filas totales, ${updates.length} filas a reordenar.`);
    for (const u of updates.slice(0, 30)) {
      console.log(`  ${DRY ? '[dry-run] ' : ''}bib=${u.bib} ${u.name} (${u.time}) sortOrder ${u.from} → ${u.to}`);
    }
    if (updates.length > 30) console.log(`  ... y ${updates.length - 30} más.`);

    if (!DRY) {
      for (const u of updates) {
        await client.query(`update race_uci_results set "sortOrder"=$1 where id=$2`, [u.to, u.id]);
      }
      console.log(`Aplicado: ${updates.length} filas reordenadas.`);
    }
  } finally {
    await client.end();
  }
}
main();
