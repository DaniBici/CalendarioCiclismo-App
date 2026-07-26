#!/usr/bin/env node
// Verificación post-volcado de una etapa CRE/TTT: por cada clasificación de la
// etapa, comprueba isTeamEvent/raceType y cuenta filas problemáticas (sin bib
// en la individual, bib sin globalRiderId enlazado, filas sin timeText/gapText
// ni irm = fallback a medio expandir). Uso:
//   node _verify-ttt-stage.mjs --race-id <id> --stage <n>
'use strict';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const RACE_ID = arg('race-id');
const STAGE = Number(arg('stage'));
if (!RACE_ID || !Number.isFinite(STAGE)) { console.error('Uso: --race-id <id> --stage <n>'); process.exit(1); }

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
  if (!url) { console.error('FATAL: falta DATABASE_URL (.env o entorno)'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select s.id, s."classKind", s.scope, s."isTeamEvent", s."raceType", s."rowCount", s."winnerName",
             count(r.*) filter (where r.bib is null) as filas_sin_bib,
             count(r.*) filter (where r."globalRiderId" is null and r.bib is not null) as bib_sin_enlazar,
             count(r.*) filter (where r."timeText" is null and r."gapText" is null and r.irm is null) as filas_sin_tiempo_ni_irm
      from race_uci_stages s
      left join race_uci_results r on r."stageRef" = s.id
      where s."raceId" = $1 and s."stageNumber" = $2
      group by s.id, s."classKind", s.scope, s."isTeamEvent", s."raceType", s."rowCount", s."winnerName"
      order by s."classKind";
    `, [RACE_ID, STAGE]);
    if (!rows.length) { console.log('⚠️  Sin clasificaciones en BD para esta etapa todavía.'); return; }
    for (const r of rows) {
      console.log(
        `${String(r.classKind).padEnd(8)} ${String(r.scope).padEnd(7)} isTeamEvent=${String(r.isTeamEvent).padEnd(5)} raceType=${String(r.raceType).padEnd(5)} `
        + `rows=${String(r.rowCount).padStart(3)} sinBib=${String(r.filas_sin_bib).padStart(3)} `
        + `bibSinEnlazar=${String(r.bib_sin_enlazar).padStart(3)} sinTiempoNiIrm=${String(r.filas_sin_tiempo_ni_irm).padStart(3)} `
        + `winner=${r.winnerName || ''}`,
      );
    }
    // Chequeos de alerta explícitos.
    const stageCl = rows.find((r) => r.classKind === 'stage' && r.scope === 'stage');
    const teamsCl = rows.find((r) => r.classKind === 'teams' && r.scope === 'stage');
    if (stageCl && stageCl.isTeamEvent === true) console.log('⚠️  ALERTA: stage/stage tiene isTeamEvent=true (debería ser false, corredores individuales).');
    if (teamsCl && teamsCl.isTeamEvent !== true) console.log('⚠️  ALERTA: teams/stage tiene isTeamEvent≠true (debería ser true).');
    if (stageCl && Number(stageCl.bib_sin_enlazar) > 0) console.log(`⚠️  ALERTA: ${stageCl.bib_sin_enlazar} filas de corredor con bib pero SIN globalRiderId enlazado.`);
    if (stageCl && Number(stageCl.filas_sin_tiempo_ni_irm) > 0) console.log(`ℹ️  ${stageCl.filas_sin_tiempo_ni_irm} filas de corredor aún sin timeText/gapText ni irm (fallback pendiente de que DataRide publique — normal hasta que se autocorrija).`);
  } finally {
    await client.end();
  }
}
main();
