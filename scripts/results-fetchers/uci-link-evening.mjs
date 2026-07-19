#!/usr/bin/env node
/**
 * uci-link-evening.mjs — PASADA DE TARDE de enlazado UCI. Cierra los dos huecos que
 * el pre-enlace de la mañana (uci-link-discover.yml, 05:40) NO puede cubrir:
 *
 *   1) TIMING — carreras creadas tarde o competiciones que la UCI publica el MISMO día.
 *      A las 05:40 aún no estaban en el calendario UCI; al re-correr el matcher por la
 *      tarde (con datos UCI frescos) ya casan → se enlazan los `unique ∩ horizonte`
 *      rezagados (idéntico al backfill, ON CONFLICT DO NOTHING: nunca pisa nada).
 *
 *   2) AMBIGÜEDAD — carreras que el matcher dejó `ambiguous` (≥2 candidatos sin ganador
 *      claro) o en COLISIÓN masc/fem (≥2 carreras nuestras apuntando a la MISMA
 *      competición). Por la tarde ya hay RESULTADOS publicados, así que tenemos una
 *      señal que el matcher no tenía: la STARTLIST curada de la carrera. Para cada
 *      candidata se descargan sus participantes (Races→Events→Results de la 1ª etapa) y
 *      se mide cuántos están en nuestra startlist. La candidata cuyos corredores
 *      coinciden ES la carrera; las de otro género/otra prueba dan solape ~0 y se
 *      descartan. Si ninguna supera el umbral → se deja para revisión manual (como hoy).
 *      Esto resuelve los pares masc/fem (corredores completamente distintos) sin riesgo
 *      de enlazar la competición equivocada.
 *
 * NO RE-IMPLEMENTA EL MATCHING: ejecuta uci-match-poc.mjs (única fuente de verdad) y lee
 * su match-report.json. Solo añade la capa de VALIDACIÓN por startlist para los ambiguos.
 *
 * QUÉ ESCRIBE
 *   INSERT en race_uci_links con autoMatched=TRUE, syncStatus='pending' y matchMethod
 *   (migración 107): 'unique' para los rezagados inequívocos, 'ambiguous-startlist' para
 *   los ambiguos resueltos por validación (marcados así para poder AUDITARLOS/revertirlos
 *   a ojo desde el panel/BD — son los más delicados), 'cn-event' para los Campeonatos
 *   Nacionales enlazados a nivel de PRUEBA (el matcher resolvió la prueba concreta dentro
 *   del competitionId del campeonato vía cnMatch; el enlace lleva uciRaceId != 0, migración
 *   110). REGLA DE ORO heredada: nunca pisa un enlace existente (ON CONFLICT ("raceId") DO
 *   NOTHING) ni reusa un competitionId ya enlazado a otra carrera (la des-colisión: el
 *   primero que valida se lo queda). Para CN la des-colisión es por (competitionId,
 *   uciRaceId): varias fichas del mismo campeonato conviven (cada una su prueba).
 *
 *   NO vuelca resultados: de eso se encarga el paso siguiente del workflow
 *   (uci-results-cron.mjs --scope today --ignore-window --skip-existing), que recoge lo
 *   recién enlazado del día y lo vuelca de una.
 *
 * AÑOS: el actual siempre; el siguiente si estamos en Q4 (la UCI ya publica la próxima
 * temporada). Un año sin seasonId conocido se OMITE con aviso (ver ROAD_SEASON).
 *
 * Uso:
 *   node scripts/results-fetchers/uci-link-evening.mjs
 *   node scripts/results-fetchers/uci-link-evening.mjs --year 2026
 *   node scripts/results-fetchers/uci-link-evening.mjs --dry-run     # no escribe, solo decide
 *   node scripts/results-fetchers/uci-link-evening.mjs --threshold 0.5 --margin 0.2 --min-shared 5
 *
 * Args:
 *   --year N        barrer SOLO ese año (repetible). Default: actual (+ próximo en Q4).
 *   --slack D       tolerancia de fechas del matcher (default 1).
 *   --threshold F   solape mínimo de corredores para validar un ambiguo (0..1, default 0.5):
 *                   fracción de los participantes de la candidata que están en nuestra startlist.
 *   --margin F      ventaja mínima del mejor candidato sobre el 2º (default 0.2). Evita
 *                   enlazar cuando dos candidatas validan parecido (ahí sí es ambiguo de verdad).
 *   --min-shared N  nº absoluto mínimo de corredores compartidos (default 5). Anti-fluke.
 *   --delay ms      pausa entre peticiones a la UCI (default 150; educado con el servidor).
 *   --dry-run       no inserta ni vuelca: imprime las decisiones (validación incluida).
 *
 * Requiere DATABASE_URL (.env o entorno) salvo en --dry-run (que igualmente consulta
 * la BD para saber qué está ya enlazado / qué carreras han terminado — necesita la URL).
 * Resumen JSON en la última línea de stdout; logs en stderr.
 *
 * Nota Date.now(): script Node CLI normal (no un Workflow del harness) → el reloj del
 * sistema es válido y necesario para saber el año/mes y "hoy".
 */
'use strict';

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getArgs = (n) => args.reduce((acc, a, i) => (a === `--${n}` && args[i + 1] != null ? [...acc, args[i + 1]] : acc), []);
const getArg = (n, d = null) => { const v = getArgs(n); return v.length ? v[v.length - 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const SLACK = getArg('slack') || '1';
const THRESHOLD = parseFloat(getArg('threshold') || '0.5');
const MARGIN = parseFloat(getArg('margin') || '0.2');
const MIN_SHARED = parseInt(getArg('min-shared') || '5', 10);
const DELAY = parseInt(getArg('delay') || '150', 10);
const DRY = hasFlag('dry-run');
const FORCE_MONTH = getArg('month') ? parseInt(getArg('month'), 10) : null;

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// seasonId road por año (espejo de uci-match-poc.mjs). MANTENIMIENTO ANUAL: añadir el
// año nuevo aquí Y en el matcher/backfill/discover cuando la UCI abra la temporada.
const ROAD_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

const SUPA_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const SUPA_KEY = 'sb_publishable_4j0S4lUm6dYphrb0DEUYkw_OGAUoCLL'; // publishable (pública)
const UCI_BASE = 'https://dataride.uci.ch/iframe';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';

const HERE = new URL('.', import.meta.url).pathname;
const MATCHER = join(HERE, 'uci-match-poc.mjs');

// ── normalización de nombres (mismo fold que el matcher) ────────────────────
function fold(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
// Clave de corredor estable entre fuentes: tokens plegados de "apellido nombre" ordenados
// → "POGAČAR Tadej" y "Tadej Pogacar" colapsan a "pogacar tadej". Si no hay nombre/apellido,
// cae al display. Comparar claves EXACTAS evita falsos solapes entre carreras distintas.
function riderKey(first, last, display) {
  let raw = (last || first) ? `${last || ''} ${first || ''}` : (display || '');
  const toks = fold(raw).split(/\s+/).filter(Boolean).sort();
  return toks.length ? toks.join(' ') : null;
}

// ── años a barrer (igual que uci-link-discover-cron.mjs) ────────────────────
function yearsToSweep() {
  const explicit = getArgs('year').map((y) => parseInt(y, 10)).filter((y) => Number.isFinite(y));
  if (explicit.length) return [...new Set(explicit)].sort();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = FORCE_MONTH ?? (now.getUTCMonth() + 1);
  const years = [year];
  if (month >= 10) years.push(year + 1);
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

// ── ejecutar el matcher canónico y leer su reporte ──────────────────────────
function runMatcher(year) {
  const outDir = join(HERE, '_results_run', `match-${year}`);
  log(`  ▸ matcher (uci-match-poc.mjs) — año ${year}, slack ${SLACK}d…`);
  execFileSync(process.execPath, [MATCHER, '--year', String(year), '--slack', String(SLACK), '--out', outDir],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  const path = join(outDir, 'match-report.json');
  if (!existsSync(path)) throw new Error(`el matcher no generó ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ── startlist curada de una carrera → set de claves de corredor ─────────────
async function fetchStartlistKeys(raceId) {
  const url = `${SUPA_URL}/rest/v1/startlist_riders_resolved?raceId=eq.${encodeURIComponent(raceId)}&select=firstName,lastName`;
  const res = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) { log(`    ⚠️  startlist ${raceId}: HTTP ${res.status}`); return new Set(); }
  const rows = await res.json();
  const set = new Set();
  for (const r of rows) { const k = riderKey(r.firstName, r.lastName, null); if (k) set.add(k); }
  return set;
}

// ── fetch ligero de participantes de una competición UCI (1ª etapa) ─────────
let COOKIE = '';
async function seedCookie() {
  const res = await fetch('https://dataride.uci.ch/', { headers: { 'User-Agent': UA } });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  COOKIE = (sc || []).map((c) => c.split(';')[0]).join('; ');
}
async function uciPost(path, formObj, needCookie = false) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA };
  if (needCookie && COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(`${UCI_BASE}/${path}`, { method: 'POST', headers, body: new URLSearchParams(formObj).toString() });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}
// Participantes de una candidata: Races (1ª etapa o el un-día) → Events (la clasificación
// individual de etapa/final) → Results. Acotado a ~2 etapas y ~25 corredores: basta para
// validar la identidad (la startlist es la misma todas las etapas). NO descarga la
// competición entera (un grande costaría decenas de peticiones).
async function fetchCandidateRiderKeys(competitionId) {
  const races = await uciPost('Races/', { disciplineId: '10', competitionId: String(competitionId), take: 60, skip: 0, page: 1, pageSize: 60 });
  const list = (races && races.data) || [];
  if (!list.length) return [];
  const keys = new Set();
  for (const race of list.slice(0, 2)) {
    await sleep(DELAY);
    const events = await uciPost('Events/', { disciplineId: '10', raceId: race.Id }, true);
    const evs = Array.isArray(events) ? events : ((events && events.data) || []);
    const pick = evs.find((e) => /^(stage|final) classification$/i.test((e.EventName || '').trim()))
      || evs.find((e) => /^(final )?result$/i.test((e.EventName || '').trim()))
      || evs.find((e) => /classification/i.test(e.EventName || ''))
      || evs[0];
    if (!pick) continue;
    await sleep(DELAY);
    const resu = await uciPost('Results/', { disciplineId: '10', eventId: pick.EventId, take: 150, skip: 0, page: 1, pageSize: 150 });
    for (const row of ((resu && resu.data) || [])) {
      const k = riderKey(row.DisplayFirstName || row.IndividualFirstName, row.DisplayLastName || row.IndividualLastName, row.DisplayName || row.IndividualDisplayName);
      if (k) keys.add(k);
    }
    if (keys.size >= 25) break;
  }
  return [...keys];
}

// Valida los candidatos de un ambiguo contra la startlist; devuelve la decisión.
async function validateAmbiguous(rec, startlist) {
  const cands = (rec.candidates || []).slice(0, 4);
  const scored = [];
  for (const c of cands) {
    const keys = await fetchCandidateRiderKeys(c.competitionId);
    let shared = 0;
    for (const k of keys) if (startlist.has(k)) shared++;
    const overlap = keys.length ? shared / keys.length : 0;
    scored.push({ c, overlap, shared, n: keys.length });
    await sleep(DELAY);
  }
  scored.sort((a, b) => b.overlap - a.overlap);
  const top = scored[0] || null;
  const second = scored[1] || null;
  const margin = top ? (top.overlap - (second ? second.overlap : 0)) : 0;
  const pass = !!top && top.overlap >= THRESHOLD && top.shared >= MIN_SHARED && (!second || margin >= MARGIN);
  return { pass, top, second, scored, margin };
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  if (!env.DATABASE_URL) { log('FATAL: falta DATABASE_URL (.env o entorno)'); process.exit(1); }

  const years = yearsToSweep();
  const known = years.filter((y) => ROAD_SEASON[y]);
  const unknown = years.filter((y) => !ROAD_SEASON[y]);
  for (const y of unknown) log(`⚠️  ${y}: seasonId road DESCONOCIDO → se OMITE (MANTENIMIENTO ANUAL: añádelo a ROAD_SEASON).`);
  log(`Pasada de tarde — años: [${known.join(', ')}]${DRY ? ' (DRY-RUN)' : ''} · umbral ${THRESHOLD} margen ${MARGIN} min-compartidos ${MIN_SHARED}`);

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Estado actual de enlaces (en memoria; se actualiza al insertar para la des-colisión).
  const linkedRaceIds = new Set();
  const linkedCompIds = new Set();          // competición ENTERA (no-CN, uciRaceId=0)
  const linkedCompEvents = new Set();       // PRUEBA concreta (CN): clave "competitionId|uciRaceId"
  {
    const { rows } = await client.query('SELECT "raceId","competitionId","uciRaceId" FROM public.race_uci_links');
    for (const r of rows) {
      linkedRaceIds.add(r.raceId);
      // Para la des-colisión por-competición de los no-CN, solo cuenta el enlace de
      // competición entera (uciRaceId=0); un competitionId "ocupado" por una prueba CN NO
      // debe bloquear el enlace de competición entera de otra carrera (no chocan en el índice).
      if (!r.uciRaceId) linkedCompIds.add(r.competitionId);
      else linkedCompEvents.add(`${r.competitionId}|${r.uciRaceId}`);
    }
  }

  await seedCookie();
  let linkedUnique = 0, linkedAmbig = 0, leftAmbig = 0, skippedNoStartlist = 0, linkedCN = 0;

  try {
    for (const year of known) {
      log(`\n▶ Año ${year}`);
      let report;
      try { report = runMatcher(year); }
      catch (e) { log(`  ✗ matcher ${year} falló: ${e.message}`); continue; }
      const seasonId = ROAD_SEASON[year] ?? report.seasonId ?? null;

      // (1) UNIQUE ∩ horizonte rezagados → enlazar (idéntico al backfill).
      for (const r of (report.unique || [])) {
        if (!r.inHorizon || !r.match || !r.match.competitionId) continue;
        if (linkedRaceIds.has(r.our.id) || linkedCompIds.has(r.match.competitionId)) continue;
        log(`  + UNIQUE «${r.our.name}» → #${r.match.competitionId} ${r.match.uciName}`);
        if (!DRY) {
          try {
            const res = await client.query(
              `INSERT INTO public.race_uci_links ("raceId","competitionId","disciplineId","seasonId","autoMatched","syncStatus","matchMethod")
               VALUES ($1,$2,10,$3,TRUE,'pending','unique')
               ON CONFLICT ("raceId") DO NOTHING RETURNING "raceId"`,
              [r.our.id, r.match.competitionId, seasonId]);
            if (!res.rowCount) continue; // ya existía (carrera de otra)
          } catch (e) {
            if (e.code === '23505') { log(`    · competitionId ya en uso, se omite`); continue; }
            throw e;
          }
        }
        linkedRaceIds.add(r.our.id); linkedCompIds.add(r.match.competitionId); linkedUnique++;
      }

      // (1.b) CN ∩ horizonte → enlazar a nivel de PRUEBA. La UCI publica el campeonato entero
      //       bajo un competitionId; el matcher (rama CN) ya resolvió la prueba concreta
      //       (cnMatch{competitionId,uciRaceId}). Aquí NO se valida por startlist: el matcher
      //       casó por (edad,género,tipo) contra el CategoryCode/RaceTypeCode de DataRide,
      //       que es inequívoco. Des-colisión por (competitionId,uciRaceId), NO por
      //       competitionId solo (varias fichas CN comparten competición legítimamente).
      for (const r of (report.unique || [])) {
        if (!r.inHorizon || !r.cnMatch || !r.cnMatch.uciRaceId) continue;
        if (linkedRaceIds.has(r.our.id)) continue;
        const evKey = `${r.cnMatch.competitionId}|${r.cnMatch.uciRaceId}`;
        if (linkedCompEvents.has(evKey)) continue;
        log(`  + CN «${r.our.name}» → #${r.cnMatch.competitionId} prueba ${r.cnMatch.uciRaceId} «${r.cnMatch.uciRaceName}»`);
        if (!DRY) {
          try {
            const res = await client.query(
              `INSERT INTO public.race_uci_links ("raceId","competitionId","disciplineId","seasonId","uciRaceId","autoMatched","syncStatus","matchMethod")
               VALUES ($1,$2,10,$3,$4,TRUE,'pending','cn-event')
               ON CONFLICT ("raceId") DO NOTHING RETURNING "raceId"`,
              [r.our.id, r.cnMatch.competitionId, seasonId, r.cnMatch.uciRaceId]);
            if (!res.rowCount) continue; // la ficha ya tenía enlace (p. ej. PDF) → no se pisa
          } catch (e) {
            if (e.code === '23505') { log(`    · prueba ya enlazada a otra ficha, se omite`); continue; }
            throw e;
          }
        }
        linkedRaceIds.add(r.our.id); linkedCompEvents.add(evKey); linkedCN++;
      }

      // (2) AMBIGUOS ∩ horizonte, ya TERMINADOS y SIN enlace → validar por startlist.
      const ambig = (report.ambiguous || []).filter((r) => r.inHorizon && !linkedRaceIds.has(r.our.id) && (r.candidates || []).length);
      if (ambig.length) {
        // ¿Cuáles han terminado ya? (hay resultados que validar solo si la carrera corrió).
        const ids = ambig.map((r) => r.our.id);
        const { rows: fin } = await client.query(
          `SELECT DISTINCT "raceId" FROM public.race_days
           WHERE "raceId" = ANY($1::text[]) AND "dateKey" <= to_char(now(),'YYYY-MM-DD')`, [ids]);
        const finished = new Set(fin.map((x) => x.raceId));

        for (const r of ambig) {
          if (!finished.has(r.our.id)) continue; // aún no corrida → nada que validar hoy
          const startlist = await fetchStartlistKeys(r.our.id);
          if (startlist.size === 0) {
            log(`  ? AMBIGUO «${r.our.name}» — sin startlist curada, no se puede validar → manual`);
            skippedNoStartlist++; leftAmbig++; continue;
          }
          const v = await validateAmbiguous(r, startlist);
          const detail = v.scored.map((s) => `#${s.c.competitionId}:${(s.overlap * 100).toFixed(0)}%(${s.shared}/${s.n})`).join(' ');
          if (v.pass && !linkedCompIds.has(v.top.c.competitionId)) {
            log(`  ✓ AMBIGUO «${r.our.name}» → #${v.top.c.competitionId} ${v.top.c.uciName}  [${detail}]`);
            if (!DRY) {
              try {
                const res = await client.query(
                  `INSERT INTO public.race_uci_links ("raceId","competitionId","disciplineId","seasonId","autoMatched","syncStatus","matchMethod")
                   VALUES ($1,$2,10,$3,TRUE,'pending','ambiguous-startlist')
                   ON CONFLICT ("raceId") DO NOTHING RETURNING "raceId"`,
                  [r.our.id, v.top.c.competitionId, seasonId]);
                if (!res.rowCount) { leftAmbig++; continue; }
              } catch (e) {
                if (e.code === '23505') { log(`    · competitionId ya en uso, se omite`); leftAmbig++; continue; }
                throw e;
              }
            }
            linkedRaceIds.add(r.our.id); linkedCompIds.add(v.top.c.competitionId); linkedAmbig++;
          } else {
            const why = !v.top ? 'sin candidatos con resultados'
              : v.top.overlap < THRESHOLD ? `solape bajo (${(v.top.overlap * 100).toFixed(0)}% < ${THRESHOLD * 100}%)`
              : v.top.shared < MIN_SHARED ? `pocos compartidos (${v.top.shared} < ${MIN_SHARED})`
              : linkedCompIds.has(v.top.c.competitionId) ? 'competitionId ya enlazado'
              : `margen escaso (${(v.margin * 100).toFixed(0)}% < ${MARGIN * 100}%)`;
            log(`  – AMBIGUO «${r.our.name}» → manual (${why})  [${detail}]`);
            leftAmbig++;
          }
        }
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  log(`\n✅ Resumen: ${linkedUnique} unique rezagados + ${linkedCN} CN por prueba + ${linkedAmbig} ambiguos resueltos por startlist · ${leftAmbig} ambiguos quedan manuales` +
      (skippedNoStartlist ? ` (${skippedNoStartlist} sin startlist)` : '') + (DRY ? ' (DRY-RUN, nada escrito)' : ''));
  process.stdout.write(JSON.stringify({
    years: known, linkedUnique, linkedCN, linkedAmbiguous: linkedAmbig, leftAmbiguous: leftAmbig,
    skippedNoStartlist, changed: (linkedUnique + linkedCN + linkedAmbig) > 0, dryRun: DRY,
  }) + '\n');
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
