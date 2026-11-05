#!/usr/bin/env node
/**
 * Zone4 → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * Zone4 (zone4.ca) cronometra con chip buena parte de las pruebas de Canadá
 * (Hardwood Cross, Campeonato de Canadá) y otras de Norteamérica. La página de
 * resultados de cada oleada (`/race/<fecha>/<formato>/results/`) no trae la
 * tabla en el HTML: la pinta el navegador a partir de `window.z4data`, el árbol
 * completo de la carrera con inscritos, grupos de salida, recorridos, pasos por
 * chip y formatos de resultados. El documento se calcula desde ese árbol:
 *
 *   - Salida: `recorded_start_time` del grupo de salida del inscrito
 *     (`time_0_list` del inscrito si tuviera salida propia).
 *   - Vueltas: puntos `mode=lap` de `points_list` del recorrido; cada paso es
 *     `time_<índice>_list` del inscrito, en microsegundos UTC.
 *   - Orden por vueltas completadas y, a igualdad, por la hora del último paso,
 *     como el visor. Las vueltas perdidas son `irm=LAP` con `gapText=-n LAP`.
 *   - Estados: `is_dns` (DNS), `dnf_time` (DNF), `dsq_time` (DSQ).
 *   - Estado del grupo: `description` del grupo de resultados («Official»,
 *     «Unofficial»). Solo «Official» se emite salvo `--allow-unofficial`, y solo
 *     entonces la categoría lleva `officialReviewed`.
 *
 *   node scripts/results-fetchers/zone4-cx-fetch.mjs \
 *     --url 'https://zone4.ca/race/2026-11-01/bb48534c/results/,https://zone4.ca/race/2026-11-01/ef6a990c/results/' \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-01 \
 *     --map 'U19 W/F (17-18 yrs/ans)=WJ,U19 M/H (17-18 yrs/ans)=MJ' [--allow-unofficial true] [--out doc.json]
 *
 * Las claves de `--map` son los nombres de los grupos del formato de la URL (el
 * identificador corto de la URL es el del formato). Sin `--map` el documento no
 * emite categorías y `skipped` lista los grupos disponibles. No resuelve fichas
 * ni equipos: conserva la grafía de la fuente para la normalización posterior.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { cxNaturalRiderDisplay, personCase } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const ORIGIN = 'https://zone4.ca';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
// Provincias y territorios de Canadá y estados de EE. UU. del campo `prov`/`state`.
const CA_REGIONS = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
const US_REGIONS = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const fold = value => clean(value).toLowerCase();
// Cada campo del árbol es `[valor, marca de edición]`.
const field = value => Array.isArray(value) ? value[0] : value;
const mixedCase = text => /\p{Lu}/u.test(text) && /\p{Ll}/u.test(text);
const displayCase = text => mixedCase(text) ? text : personCase(text);
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// «https://zone4.ca/race/2026-11-01/bb48534c/results/» → fecha e identificador corto del formato.
export function zone4Target(url) {
  const match = /zone4\.ca\/race\/(\d{4}-\d{2}-\d{2})\/([0-9a-f]{8})(?:\/|$)/i.exec(String(url));
  if (!match) throw new Error(`URL de resultados Zone4 no reconocida: ${url}`);
  return { date: match[1], formatId: match[2].toLowerCase(), resultsUrl: `${ORIGIN}/race/${match[1]}/${match[2].toLowerCase()}/results/` };
}

export function zone4Tree(html) {
  const match = /window\.z4data\s*=\s*(\{.*?\});?\s*\n/s.exec(html);
  if (!match) throw new Error('La página de Zone4 no contiene window.z4data');
  const tree = JSON.parse(match[1]).tree;
  if (!tree?._child_racers || !tree._child_resultformats) throw new Error('Árbol de Zone4 sin inscritos o formatos de resultados');
  return tree;
}

// Nacionalidad: campo `nat`/`nationality`/`country` (IOC o ISO-2); si falta, la
// provincia o el estado de la licencia (`prov`/`state`) indican CA o US.
export function zone4Country(racer) {
  for (const key of ['nat', 'nationality', 'country']) {
    const text = clean(field(racer[key])).toUpperCase();
    if (/^[A-Z]{3}$/.test(text) && countryCode(text)) return countryCode(text).toUpperCase();
    if (/^[A-Z]{2}$/.test(text)) return text;
  }
  const region = clean(field(racer.prov) ?? field(racer.state)).toUpperCase();
  if (CA_REGIONS.has(region)) return 'CA';
  if (US_REGIONS.has(region)) return 'US';
  return /^[A-Z]{3}$/.test(region) ? countryCode(region)?.toUpperCase() || null : null;
}

// Un criterio del grupo es un objeto de condiciones; basta con que se cumpla uno.
// `course` se compara con el recorrido del paso cronometrado; el resto, con el
// campo del inscrito (null equivale a vacío).
const matches = (criteria, racer, entity) => criteria.some(condition => Object.entries(condition).every(([key, value]) => key === 'course'
  ? field(entity.course) === value
  : (clean(field(racer[key])) || null) === (clean(value) || null)));

function racerRow(racer) {
  const firstName = displayCase(clean(field(racer.first_name)));
  const lastName = displayCase(clean(field(racer.last_name)));
  const license = clean(field(racer.uciid)).replace(/\s/g, '');
  const dob = clean(field(racer.dob));
  return { bib: clean(field(racer.bib)) || null, riderDisplay: cxNaturalRiderDisplay(firstName, lastName), firstName, lastName,
    sourceName: clean(`${clean(field(racer.last_name))} ${clean(field(racer.first_name))}`), teamName: clean(field(racer.team)) || null,
    isoCode2: zone4Country(racer), uciLicenseId: /^\d{11}$/.test(license) ? license : null,
    birthYear: /^\d{4}$/.test(dob) ? dob : null, bonusSeconds: null };
}

/** Filas de un grupo de resultados del árbol → filas del contrato CX. */
export function zone4GroupRows(tree, group) {
  const criteria = field(group.criteria_list) || [];
  const courseId = criteria.map(condition => condition.course).find(Boolean);
  const course = tree._child_courses.find(item => field(item.uuid) === courseId);
  if (!course) throw new Error(`Grupo «${clean(field(group.name))}» sin recorrido en el árbol`);
  const laps = (field(course.points_list) || []).flatMap((point, index) => point.mode === 'lap' ? [index] : []);
  if (!laps.length) throw new Error(`Recorrido «${clean(field(course.name))}» sin puntos de vuelta`);
  const starts = new Map(tree._child_startgroups.map(item => [field(item.uuid), field(item.recorded_start_time)]));
  const passage = (entity, index) => field(entity[`time_${index}_list`])?.[0] ?? null;
  const entrants = []; const withoutTimes = [];
  for (const racer of tree._child_racers) {
    const entities = (racer._child_timedentitys || []).filter(entity => matches(criteria, racer, entity));
    if (!entities.length) continue;
    if (entities.length > 1) throw new Error(`Dorsal ${clean(field(racer.bib))}: varias mangas en el mismo grupo`);
    const [entity] = entities;
    const state = field(entity.dsq_time) ? 'DSQ' : field(entity.dnf_time) ? 'DNF' : field(entity.is_dns) ? 'DNS' : null;
    let done = 0;
    for (let lap = 0; lap < laps.length; lap++) if (passage(entity, laps[lap]) != null) done = lap + 1;
    const start = passage(entity, 0) ?? starts.get(field(entity.startgroup)) ?? null;
    if (!state && !done) { withoutTimes.push(clean(field(racer.bib))); continue; }
    if (!state && start == null) throw new Error(`Dorsal ${clean(field(racer.bib))}: salida sin registrar`);
    entrants.push({ racer, state, done, finishAt: done ? passage(entity, laps[done - 1]) : null, start });
  }
  const finishers = entrants.filter(item => !item.state).sort((a, b) => b.done - a.done || a.finishAt - b.finishAt);
  if (!finishers.length) return { rows: [], withoutTimes };
  const leaderLaps = finishers[0].done;
  // Tiempo y diferencia se truncan al segundo desde los microsegundos, como las décimas del visor.
  const elapsed = item => item.finishAt - item.start;
  const winner = elapsed(finishers[0]);
  if (winner <= 0) throw new Error(`Grupo «${clean(field(group.name))}»: tiempo del ganador no positivo`);
  const rows = finishers.map((item, position) => {
    const down = leaderLaps - item.done;
    const rank = { rank: position + 1, rankText: String(position + 1) };
    if (down > 0) return { ...racerRow(item.racer), ...rank, irm: 'LAP', gapText: `-${down} LAP`, timeText: null, timeSeconds: null };
    const time = Math.trunc(elapsed(item) / 1e6);
    return { ...racerRow(item.racer), ...rank, irm: null, timeText: hms(time), timeSeconds: String(time),
      gapText: position ? gap(Math.trunc((elapsed(item) - winner) / 1e6)) : null };
  });
  for (const state of ['DNF', 'DSQ', 'DNS']) for (const item of entrants.filter(entry => entry.state === state)) {
    rows.push({ ...racerRow(item.racer), rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null });
  }
  return { rows, withoutTimes };
}

/** Grupos del formato de la URL asignados con `map` (nombre de grupo → categoría CX). */
export function parseZone4Cx(tree, { formatId, map = {}, dateKey = null, resultsUrl, allowUnofficial = false, urlDate = null }) {
  const raceDate = clean(field(tree.date));
  if (dateKey && raceDate !== dateKey) throw new Error(`Fecha de la oleada ${raceDate} distinta de ${dateKey}`);
  const format = tree._child_resultformats.find(item => String(field(item.uuid)).startsWith(formatId));
  if (!format) throw new Error(`Formato de resultados ${formatId} ausente del árbol`);
  const groups = format._child_resultgroups || [];
  const wanted = new Map(Object.entries(map).map(([name, category]) => [fold(name), { name: clean(name), category }]));
  const mapped = [...wanted.keys()];
  const categories = []; const skipped = []; const warnings = [];
  for (const group of groups) {
    const name = clean(field(group.name));
    const { category, name: mapName } = wanted.get(fold(name)) || {};
    const status = clean(field(group.description)) || null;
    if (!category) { skipped.push({ group: name, status, reason: 'Grupo sin categoría asignada en --map' }); continue; }
    wanted.delete(fold(name));
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    const official = /^official$/i.test(status || '');
    if (!official && !allowUnofficial) { skipped.push({ group: name, category, status, reason: 'Clasificación no marcada «Official» en Zone4' }); continue; }
    const { rows, withoutTimes } = zone4GroupRows(tree, group);
    if (withoutTimes.length) warnings.push({ group: name, category, reason: 'Inscritos sin pasos ni estado, omitidos', bibs: withoutTimes });
    if (!rows.length) { skipped.push({ group: name, category, status, reason: 'Grupo sin llegadas' }); continue; }
    const pageUrl = field(group.page_url) ? `${ORIGIN}${field(group.page_url)}` : resultsUrl;
    categories.push({ category, dateKey: dateKey || raceDate, sourceGroup: name,
      evidence: { sourceUrl: pageUrl, zone4: { key: zone4Key(urlDate || raceDate, formatId, mapName), resultsUrl, group: name, status },
        ...(official ? { officialReviewed: true, officialReviewSourceUrl: pageUrl } : {}) }, rows });
  }
  // Con varias oleadas y un mapa común, buildZone4CxDocument exige cada grupo en alguna de las que lo buscan.
  return { raceName: clean(field(tree.name)) || null, formatName: clean(field(format.name)) || null, raceDate, categories, skipped, warnings,
    mapped, unmatched: [...wanted.keys()] };
}

// Clave de un grupo en cx_race_timing_links."categoryKeys": «<fecha>/<formato>/<nombre del grupo>».
export const zone4Key = (date, formatId, group) => `${date}/${formatId}/${clean(group)}`;
export function zone4ParseKey(key) {
  const match = /^(\d{4}-\d{2}-\d{2})\/([0-9a-f]{8})\/(.+)$/.exec(String(key));
  if (!match) throw new Error(`Clave Zone4 inválida: ${key}`);
  return { date: match[1], formatId: match[2], group: clean(match[3]), resultsUrl: `${ORIGIN}/race/${match[1]}/${match[2]}/results/` };
}

export function buildZone4CxDocument({ pages, raceId, seasonKey, sourceUrl, source = 'manual' }) {
  for (const name of new Set(pages.flatMap(page => page.unmatched))) {
    const searched = pages.filter(page => page.mapped.includes(name));
    if (searched.every(page => page.unmatched.includes(name))) {
      throw new Error(`Grupo «${name}» ausente de los formatos ${searched.map(page => page.formatName).join(', ')}`);
    }
  }
  const categories = pages.flatMap(page => page.categories);
  const seen = new Set();
  for (const { category } of categories) {
    if (seen.has(category)) throw new Error(`Categoría ${category} asignada en más de un grupo`);
    seen.add(category);
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl, timer: 'zone4', waves: pages.map(page => ({ resultsUrl: page.resultsUrl, race: page.raceName, format: page.formatName })) },
    categories, skipped: pages.flatMap(page => page.skipped), warnings: pages.flatMap(page => page.warnings) };
}

export async function fetchZone4Tree(url) {
  const target = zone4Target(url);
  const response = await fetch(target.resultsUrl, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${target.resultsUrl}`);
  return { ...target, tree: zone4Tree(await response.text()) };
}

export async function fetchZone4Cx({ urls, raceId, seasonKey, date = null, map = {}, allowUnofficial = false, source = 'manual', fetchTree = fetchZone4Tree }) {
  const pages = [];
  for (const url of urls) {
    const { formatId, resultsUrl, tree, date: urlDate } = await fetchTree(url);
    pages.push({ resultsUrl, ...parseZone4Cx(tree, { formatId, map, dateKey: date, resultsUrl, allowUnofficial, urlDate }) });
  }
  return buildZone4CxDocument({ pages, raceId, seasonKey, sourceUrl: pages[0]?.resultsUrl, source });
}

/** Documento del worker desde `categoryKeys` del enlace: una lectura por oleada, solo grupos «Official». */
export async function fetchZone4Linked({ categoryKeys, raceId, seasonKey, fetchTree = fetchZone4Tree }) {
  const waves = new Map();
  for (const [key, category] of Object.entries(categoryKeys)) {
    const { resultsUrl, group } = zone4ParseKey(key);
    if (!waves.has(resultsUrl)) waves.set(resultsUrl, {});
    waves.get(resultsUrl)[group] = category;
  }
  const pages = [];
  for (const [resultsUrl, map] of waves) {
    const { formatId, tree, date } = await fetchTree(resultsUrl);
    // Cada oleada lleva su fecha en la URL; la manga de la categoría la comprueba el importador.
    pages.push({ resultsUrl, ...parseZone4Cx(tree, { formatId, map, dateKey: date, resultsUrl, urlDate: date }) });
  }
  return buildZone4CxDocument({ pages, raceId, seasonKey, sourceUrl: pages[0]?.resultsUrl, source: 'zone4' });
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['url', 'race-id', 'season-key']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

// «Nombre de grupo=CAT,Otro grupo=CAT».
export function zone4Map(text) {
  return Object.fromEntries(String(text || '').split(',').filter(Boolean).map(pair => {
    const index = pair.lastIndexOf('=');
    return [clean(pair.slice(0, index)), clean(pair.slice(index + 1)).toUpperCase()];
  }));
}

async function main() {
  const options = args(process.argv.slice(2));
  const document = await fetchZone4Cx({ urls: options.url.split(',').map(clean).filter(Boolean), raceId: options['race-id'],
    seasonKey: options['season-key'], date: options.date || null, map: zone4Map(options.map), allowUnofficial: options['allow-unofficial'] === 'true' });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, group: c.sourceGroup, status: c.evidence.zone4.status,
    rows: c.rows.length })), skipped: document.skipped, warnings: document.warnings }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
