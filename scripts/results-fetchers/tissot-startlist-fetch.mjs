#!/usr/bin/env node
/**
 * tissot-startlist-fetch.mjs — FETCHER de inscritos y orden de salida desde TISSOT.
 *
 * Complementa a tissot-results-fetch.mjs: mientras aquel solo emite resultados,
 * este extrae la startlist oficial (y, en CRI, el orden de salida con hora
 * individual) para importarla con las RPC de inscritos.
 *
 * NO escribe en BD ni conoce la base: emite un documento crudo y determinista
 * que consume `tissot-startlists-sync.mjs` (que resuelve selección y ficha
 * contra Supabase y llama a la RPC). Así el fetcher es testeable sin red de BD.
 *
 * TOPOLOGÍAS (mismas que tissot-results-fetch.mjs):
 *   - Carrera por etapas: `/competitions/{comp}/stages/{n}/teams` y `.../startlist`.
 *   - MultiEvents (Mundial): `--tissot-event N` →
 *     `/competitions/{comp}/events/{N}/phases/{p}/teams` y `.../startlist`.
 *
 * FORMA DE LOS DATOS (verificado contra crdwch2025 y tds2026):
 *   /teams     → [{name, nation, members:[{bib,name,nation,uciRiderId,status}]}]
 *                En un Mundial `name` es el país en MAYÚSCULAS ("BELGIUM") y
 *                `nation` el IOC-3 ("BEL"). En carreras por equipos, el equipo
 *                comercial. La resolución canónica la hace el sync con la BD.
 *   /startlist → {results:[{rank, value, rider:{bib,name,nation,uciRiderId}}]}
 *                En CRI: `rank` = orden de salida y `value` = hora local
 *                ("14:57:00"). En línea: `rank` 0 y sin `value`.
 *
 * Uso:
 *   node scripts/results-fetchers/tissot-startlist-fetch.mjs \
 *     --competition crdwch2026 --tissot-event 2 --race-id <raceId> \
 *     --gender male --out /tmp/sl.json
 *
 * Args:
 *   --competition   comp_id Tissot ({código}{año}).
 *   --tissot-event  nº de evento (MultiEvents). Alternativo a --stage.
 *   --stage         nº de etapa (carrera por etapas). Alternativo a --tissot-event.
 *   --race-id       raceId nuestro (va dentro del documento).
 *   --gender        male|female|null (para elegir riders_men/riders_women en el sync).
 *   --out           ruta del JSON de salida (default _results_run/tissot-startlist-<comp>).
 *   --pretty        además vuelca a stdout.
 *   --delay         ms entre peticiones (default 150).
 *
 * Salida (documento crudo):
 *   { competition, event|stage, raceId, gender, sourceUrl, riders:[...],
 *     startOrder:[...], startOrderTeams:[...] }
 *   riders: [{bib, displayName, firstName, lastName, nation, teamCode, uciRiderId, teamHint}]
 *   startOrder (solo CRI): [{order, bib, startTime, displayName}]
 *   startOrderTeams (solo CRE): [{order, teamName, startTime}]
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const COMP = getArg('competition');
const TISSOT_EVENT = getArg('tissot-event') != null ? parseInt(getArg('tissot-event'), 10) : null;
const STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
const RACE_ID = getArg('race-id');
const GENDER = getArg('gender') ?? null;
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '150', 10);
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `tissot-startlist-${COMP || 'unknown'}`);

const BASE = 'https://prod.server.tissottiming.com';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// "EVENEPOEL Remco" | "van WILDER Ilan" → {firstName,lastName}. Espejo de la
// heurística de results-upsert.splitUciDisplay: el apellido son los tokens en
// MAYÚSCULAS (con partículas intercaladas); el resto, el nombre. El sync
// reemplaza esto por el nombre canónico de la ficha cuando la resuelve.
const PARTICLES = /^(de|del|della|der|den|van|von|da|di|do|dos|das|la|le|el|al|bin|ben|mac|mc|ter|ten|zur|zum)$/i;
export function splitDisplayName(display) {
  const str = clean(display);
  if (!str) return { firstName: '', lastName: '' };
  const tokens = str.split(' ');
  const isUpper = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t);
  let i = 0;
  const last = [];
  while (i < tokens.length) {
    if (isUpper(tokens[i])) { last.push(tokens[i]); i++; continue; }
    if (PARTICLES.test(tokens[i]) && i + 1 < tokens.length && isUpper(tokens[i + 1])) {
      last.push(tokens[i]); i++; continue;
    }
    break;
  }
  if (!last.length) return { firstName: str, lastName: '' };
  const firstName = tokens.slice(i).join(' ');
  return { firstName, lastName: last.join(' ') };
}

// Hora local de salida de una CRI ("14:57:00" | "14:57"). En línea no hay valor.
export function startTimeOf(row) {
  const v = clean(row?.value);
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(v) ? v : null;
}

// Rows de /startlist → orden de salida individual (solo CRI, solo filas con
// dorsal). Orden por `rank`.
export function buildStartOrder(results) {
  const entries = [];
  for (const r of results || []) {
    const t = startTimeOf(r);
    if (!t || !(r.rank > 0) || !(r.rider?.bib > 0)) continue;
    entries.push({ order: r.rank, bib: r.rider.bib, startTime: t, displayName: clean(r.rider.name) });
  }
  return entries.sort((a, b) => a.order - b.order);
}

// Rows de /startlist de una CRE → orden de salida por EQUIPO (dorsal=0 en el
// volcado). `team.name` es el nombre publicado (en un Mundial, el país).
export function buildTeamStartOrder(results) {
  const entries = [];
  for (const r of results || []) {
    const t = startTimeOf(r);
    if (!t || !(r.rank > 0) || !r.team || r.rider) continue;
    entries.push({ order: r.rank, teamName: clean(r.team.name) || clean(r.key), startTime: t });
  }
  return entries.sort((a, b) => a.order - b.order);
}

// members de /teams → shape estable. Solo miembros con dorsal positivo.
export function normalizeTeams(teams) {
  const out = [];
  for (const t of teams || []) {
    const name = clean(t?.name);
    if (!name) continue;
    const riders = [];
    for (const m of t?.members || []) {
      const bib = m?.bib != null ? Number(m.bib) : 0;
      if (!(bib > 0)) continue;
      riders.push({
        bib,
        displayName: clean(m?.name),
        nation: clean(m?.nation) || null,
        uciRiderId: clean(m?.uciRiderId) || null,
      });
    }
    if (!riders.length) continue;
    out.push({ tissotName: name, nation: clean(t?.nation) || null, riders });
  }
  return out;
}

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
};

function checkArgs() {
  if (!COMP) { log('FATAL: falta --competition'); process.exit(1); }
  if (!RACE_ID) { log('FATAL: falta --race-id <raceId nuestro>'); process.exit(1); }
  if (TISSOT_EVENT == null && STAGE == null) { log('FATAL: falta --tissot-event (MultiEvents) o --stage'); process.exit(1); }
  if (TISSOT_EVENT != null && STAGE != null) { log('FATAL: usa --tissot-event o --stage, no ambos'); process.exit(1); }
}

// Resuelve la base de los endpoints y una etiqueta legible.
async function resolveTarget() {
  if (TISSOT_EVENT != null) {
    const phases = (await get(`/competitions/${COMP}/events/${TISSOT_EVENT}/phases`)) || [];
    if (!phases.length) return null;
    const phase = phases[phases.length - 1];
    const base = `/competitions/${COMP}/events/${TISSOT_EVENT}/phases/${phase.number}`;
    return { base, label: `${COMP} evento ${TISSOT_EVENT} (${clean(phase.name) || 'prueba'})` };
  }
  const base = `/competitions/${COMP}/stages/${STAGE}`;
  return { base, label: `${COMP} etapa ${STAGE}` };
}

async function main() {
  checkArgs();
  const target = await resolveTarget();
  if (!target) { log(`${COMP}: sin fases/etapa publicada para ese selector`); process.exit(3); }

  await sleep(DELAY);
  const teamsRaw = (await get(`${target.base}/teams`)) || [];
  await sleep(DELAY);
  const slRaw = (await get(`${target.base}/startlist`));
  const slRows = Array.isArray(slRaw) ? slRaw : (slRaw && Array.isArray(slRaw.results) ? slRaw.results : []);

  const teams = normalizeTeams(teamsRaw);
  // Pista de equipo por dorsal: en un Mundial `/teams` da el país ("BELGIUM");
  // en carreras por equipos, el equipo comercial. Solo es respaldo: el sync
  // resuelve la selección canónica contra la startlist existente.
  const hintByBib = new Map();
  for (const t of teams) for (const m of t.riders) hintByBib.set(m.bib, t.tissotName);

  // La lista AUTORITATIVA son las filas de /startlist (en una carrera por
  // etapas /teams puede traer el roster completo del equipo, no los inscritos
  // de la etapa). Si /startlist aún no existe —o trae filas de EQUIPO, como una
  // CRE—, se cae a los miembros de /teams.
  let riders = [];
  if (slRows.length) {
    riders = slRows
      .filter((r) => r?.rider?.bib > 0)
      .map((r) => {
        const split = splitDisplayName(r.rider.name);
        return {
          bib: r.rider.bib,
          displayName: clean(r.rider.name),
          firstName: split.firstName,
          lastName: split.lastName,
          nation: clean(r.rider.nation) || null,
          teamCode: clean(r.rider.teamCode) || null,
          uciRiderId: clean(r.rider.uciRiderId) || null,
          teamHint: hintByBib.get(Number(r.rider.bib)) || null,
        };
      });
  }
  if (!riders.length) {
    for (const t of teams) for (const m of t.riders) {
      const split = splitDisplayName(m.displayName);
      riders.push({
        bib: m.bib, displayName: m.displayName, firstName: split.firstName,
        lastName: split.lastName, nation: m.nation, teamCode: null,
        uciRiderId: m.uciRiderId, teamHint: t.tissotName,
      });
    }
  }
  const startOrder = buildStartOrder(slRows);
  const startOrderTeams = buildTeamStartOrder(slRows);

  if (!riders.length) {
    log(`${target.label}: sin startlist publicada aún`);
    process.exit(3);
  }

  const out = {
    competition: COMP,
    ...(TISSOT_EVENT != null ? { event: TISSOT_EVENT } : { stage: STAGE }),
    raceId: RACE_ID,
    gender: GENDER,
    sourceUrl: `${BASE}${target.base}/startlist`,
    riders,
    startOrder,
    startOrderTeams,
  };

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${RACE_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`${target.label}: ${riders.length} corredores, ${startOrder.length} en orden de salida`
    + `${startOrderTeams.length ? `, ${startOrderTeams.length} equipos en orden` : ''}`);
  log(`\n✅ ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
