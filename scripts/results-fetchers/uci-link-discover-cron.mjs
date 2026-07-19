#!/usr/bin/env node
/**
 * uci-link-discover-cron.mjs — Fase 7 (PLAN-resultados-web.md): DESCUBRIMIENTO y
 * enlazado diario de carreras nuevas publicadas por la UCI. Es el cuerpo del cron
 * .github/workflows/uci-link-discover.yml.
 *
 * EL HUECO QUE CIERRA
 *   El cron de RESULTADOS (uci-results.yml) solo vuelca resultados de carreras YA
 *   enlazadas en race_uci_links; explícitamente NO descubre carreras nuevas. El
 *   alta del enlace carrera↔competitionId era manual (backfill one-shot + panel).
 *   Este cron automatiza ese alta: la UCI publica el calendario con ~1-2 meses de
 *   antelación, así que cada día aparecen competiciones nuevas en su iframe; esta
 *   pasada las casa con nuestras carreras y enlaza las INEQUÍVOCAS.
 *
 * QUÉ HACE
 *   Para cada temporada a barrer (ver AÑOS, abajo), ejecuta el backfill canónico
 *     uci-backfill-links.mjs --year N --apply
 *   que a su vez corre el matcher (uci-match-poc.mjs, fetch EN VIVO del iframe UCI)
 *   y enlaza solo los `unique ∩ horizonte` con ON CONFLICT DO NOTHING. NO re-implementa
 *   nada: una sola fuente de verdad para el matching y el enlazado. Las ambiguas y
 *   los pares masc/fem en colisión NUNCA se enlazan solos → el backfill las imprime
 *   por stderr (quedan en el log del workflow) para resolverlas en la pestaña
 *   «Resultados UCI» del panel.
 *
 *   NO da de alta carreras que no existan en nuestra DB (eso es curado): solo crea
 *   el ENLACE de una carrera nuestra ya existente con su competición UCI.
 *
 * QUÉ AÑOS BARRE (auto-consciente — para que el cron no caduque)
 *   - El año en curso, SIEMPRE.
 *   - El año siguiente si estamos en el último trimestre (oct-dic): en esa franja la
 *     UCI ya publica calendario de la próxima temporada y nosotros ya tenemos esas
 *     carreras en DB.
 *   Un año cuyo seasonId road aún no conocemos (no está en ROAD_SEASON del matcher)
 *   se OMITE con un aviso en el log — NO tumba el cron. Ver "MANTENIMIENTO ANUAL".
 *
 * MANTENIMIENTO ANUAL (1 línea, una vez al año)
 *   El matcher (uci-match-poc.mjs) y el backfill (uci-backfill-links.mjs) tienen un
 *   mapa `ROAD_SEASON = { año: seasonId }`. Cuando la UCI abra la temporada nueva
 *   (típicamente ~oct/nov), este cron empezará a AVISAR en el log que no conoce el
 *   seasonId del año siguiente. Para resolverlo: obtener el seasonId road de ese año
 *   de DataRide (GetRestrictedResultsDisciplineSeasons?disciplineId=10) y añadir la
 *   entrada a ROAD_SEASON en AMBOS scripts. A partir de ahí el cron lo barre solo.
 *
 * Uso:
 *   node scripts/results-fetchers/uci-link-discover-cron.mjs
 *   node scripts/results-fetchers/uci-link-discover-cron.mjs --slack 1
 *   node scripts/results-fetchers/uci-link-discover-cron.mjs --year 2026   # forzar un año
 *   node scripts/results-fetchers/uci-link-discover-cron.mjs --dry-run     # SQL, sin escribir
 *   node scripts/results-fetchers/uci-link-discover-cron.mjs --month 11    # simular mes (test de AÑOS)
 *
 * Args:
 *   --year N    barrer SOLO ese año (ignora la selección automática). Repetible.
 *   --slack D   tolerancia de fechas para el matcher (default 1). Se pasa al backfill.
 *   --month M   forzar el "mes actual" (1-12) para probar la selección de años. Solo test.
 *   --dry-run   modo SQL del backfill (no escribe en Postgres; útil para revisar el plan).
 *
 * Requiere DATABASE_URL (.env o entorno) salvo en --dry-run. Salida JSON de resumen
 * en la última línea de stdout (para el workflow); logs en stderr.
 *
 * Nota Date.now(): el harness de Workflow prohíbe Date.now()/new Date() argless, pero
 * esto es un script Node CLI normal (no un Workflow) → el reloj del sistema es válido y
 * necesario para saber el año/mes en curso.
 */
'use strict';

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getArgs = (n) => args.reduce((acc, a, i) => (a === `--${n}` && args[i + 1] != null ? [...acc, args[i + 1]] : acc), []);
const getArg = (n, d = null) => { const v = getArgs(n); return v.length ? v[v.length - 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const SLACK = getArg('slack') || '1';
const DRY = hasFlag('dry-run');
const FORCE_MONTH = getArg('month') ? parseInt(getArg('month'), 10) : null;
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const HERE = new URL('.', import.meta.url).pathname;
const BACKFILL = join(HERE, 'uci-backfill-links.mjs');

// Espejo del mapa del matcher (uci-match-poc.mjs / uci-backfill-links.mjs). Solo se usa
// aquí para SABER qué años son barribles; la fuente de verdad sigue siendo el matcher.
// Cuando la UCI abra una temporada nueva, añadir su seasonId aquí Y en los otros dos scripts.
const ROAD_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

// Años a barrer: el actual siempre; el siguiente si estamos en Q4 (la UCI ya publica
// la próxima temporada y nosotros ya tenemos esas carreras en DB).
function yearsToSweep() {
  const explicit = getArgs('year').map((y) => parseInt(y, 10)).filter((y) => Number.isFinite(y));
  if (explicit.length) return [...new Set(explicit)].sort();

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = FORCE_MONTH ?? (now.getUTCMonth() + 1); // 1-12
  const years = [year];
  if (month >= 10) years.push(year + 1); // oct-dic → también la próxima temporada
  return years;
}

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

// Ejecuta el backfill como subproceso; hereda stderr (los avisos van al log del workflow).
function runBackfill(year) {
  return new Promise((resolve) => {
    const bfArgs = ['--year', String(year), '--slack', String(SLACK)];
    if (DRY) bfArgs.push('--emit-sql', '-'); // modo SQL a stdout (no escribe en BD)
    else bfArgs.push('--apply');
    // El backfill emite su resumen por stderr y (en dry-run) el SQL por stdout; aquí
    // solo nos importa el exit code: 0 = ok (enlazó o nada que enlazar), !=0 = falló.
    const p = spawn(process.execPath, [BACKFILL, ...bfArgs], { stdio: ['ignore', DRY ? 'inherit' : 'ignore', 'inherit'] });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  if (!DRY && !env.DATABASE_URL) { log('FATAL: falta DATABASE_URL (.env o entorno)'); process.exit(1); }
  // El backfill lee DATABASE_URL de su propio entorno; nos aseguramos de propagarlo.
  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

  const years = yearsToSweep();
  const known = years.filter((y) => ROAD_SEASON[y]);
  const unknown = years.filter((y) => !ROAD_SEASON[y]);

  log(`Barrido de enlazado UCI — años candidatos: [${years.join(', ')}]` + (DRY ? ' (DRY-RUN)' : ''));
  for (const y of unknown) {
    log(`⚠️  ${y}: seasonId road DESCONOCIDO (no está en ROAD_SEASON). Se OMITE.`);
    log(`    → MANTENIMIENTO ANUAL: añade { ${y}: <seasonId> } a ROAD_SEASON en uci-match-poc.mjs,`);
    log(`      uci-backfill-links.mjs y este script. Saca el seasonId de DataRide`);
    log(`      (GetRestrictedResultsDisciplineSeasons?disciplineId=10).`);
  }
  if (!known.length) {
    log('No hay ningún año barrible (todos sin seasonId conocido). Nada que hacer.');
    process.stdout.write(JSON.stringify({ years, swept: [], ok: 0, errored: 0, skippedUnknown: unknown, changed: false }) + '\n');
    if (unknown.length) process.exit(1); // hay trabajo pero no puedo hacerlo → job en rojo (visible)
    return;
  }

  let ok = 0, errored = 0;
  for (const y of known) {
    log(`\n▶ Barriendo ${y} (road seasonId ${ROAD_SEASON[y]})…`);
    const code = await runBackfill(y);
    if (code === 0) ok++;
    else { log(`  ✗ backfill ${y} falló (exit ${code})`); errored++; }
  }

  log(`\n✅ Resumen: ${ok}/${known.length} años barridos ok` + (errored ? `, ${errored} con error` : '') + (unknown.length ? `, ${unknown.length} omitidos (sin seasonId)` : ''));
  // changed=true para que el workflow regenere páginas: un enlace nuevo no genera
  // página por sí solo (la página nace cuando hay resultados), pero el backfill no
  // distingue "enlacé algo nuevo" de "nada nuevo" en su exit code, así que dejamos que
  // el workflow decida con su propio detector si hace falta. Aquí reportamos actividad.
  process.stdout.write(JSON.stringify({ years, swept: known, ok, errored, skippedUnknown: unknown, changed: false }) + '\n');
  if (errored > 0 && ok === 0) process.exit(1); // todo falló → job en rojo
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
