#!/usr/bin/env node
// Mueve el `rank`/`rankText` de un bloque de equipo (clasificación de etapa CRE)
// al corredor que REALMENTE marcó el tiempo del equipo, cuando el corredor que
// lo llevaba (normalmente el líder GC/bib bajo, tal como lo publica Tissot/UCI)
// no es el más rápido real del bloque — cazado con Bernal (INEOS, rank pero
// +3:06 real, mientras Ganna es quien marcó los +8" oficiales de teams/stage).
//
// Requiere que las filas ya estén reordenadas por tiempo ascendente dentro de
// cada bloque (ver _reorder-ttt-riders-by-time.mjs): el primer corredor de cada
// bloque por sortOrder es el más rápido real, y por tanto quien debe llevar el
// rank. NO cambia rowCount/rank del EQUIPO en sí (posiciones 1..N entre
// equipos), solo QUÉ CORREDOR de cada bloque la lleva.
//
// Uso: node _fix-ttt-lead-rank.mjs --race-id <id> --stage <n> [--dry-run]
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

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { console.error('FATAL: falta DATABASE_URL'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select r.id, r.bib, r.rank, r."rankText", r.irm, r."riderDisplay", r."sortOrder"
      from race_uci_results r
      join race_uci_stages s on s.id = r."stageRef"
      where s."raceId" = $1 and s."stageNumber" = $2 and s."classKind"='stage' and s.scope='stage'
      order by r."sortOrder";
    `, [RACE_ID, STAGE]);
    if (!rows.length) { console.log('Sin filas.'); return; }

    // Agrupar por EQUIPO real (decena del dorsal: 1-8, 11-18, 21-28…, patrón
    // verificado contra la startlist de esta carrera) — NO por "aparece rank",
    // que tras el reordenado por tiempo ya no delimita el bloque correctamente
    // (el corredor con rank puede haber quedado al final del bloque, no al
    // principio, si no era el más rápido real).
    const byDecade = new Map();
    for (const r of rows) {
      const bibNum = r.bib != null && /^\d+$/.test(String(r.bib)) ? Number(r.bib) : null;
      const decade = bibNum != null ? Math.floor(bibNum / 10) : `no-bib-${r.id}`;
      if (!byDecade.has(decade)) byDecade.set(decade, []);
      byDecade.get(decade).push(r);
    }
    // dentro de cada bloque, ya vienen en orden de sortOrder (= tiempo ascendente,
    // asumiendo que _reorder-ttt-riders-by-time.mjs ya corrió antes).
    const blocks = [...byDecade.values()];

    let fixed = 0;
    for (const block of blocks) {
      const leadIdx = block.findIndex((r) => r.rank != null);
      if (leadIdx === -1) continue; // bloque sin rank (sueltos), no tocar
      const lead = block[leadIdx];
      const first = block[0]; // ya viene ordenado por tiempo ascendente
      if (first.id === lead.id) continue; // ya coincide, nada que hacer
      if (first.irm) continue; // el más "rápido" del bloque es un abandono con timeText null: no mover el rank ahí
      console.log(`${DRY ? '[dry-run] ' : ''}bloque: rank ${lead.rank} pasa de bib=${lead.bib} ${lead.riderDisplay} → bib=${first.bib} ${first.riderDisplay}`);
      if (!DRY) {
        await client.query(`update race_uci_results set rank=null, "rankText"=null where id=$1`, [lead.id]);
        await client.query(`update race_uci_results set rank=$1, "rankText"=$2 where id=$3`, [lead.rank, lead.rankText, first.id]);
      }
      fixed++;
    }
    console.log(`${DRY ? '[dry-run] se corregirían' : 'corregidos'}: ${fixed} bloques.`);
  } finally {
    await client.end();
  }
}
main();
