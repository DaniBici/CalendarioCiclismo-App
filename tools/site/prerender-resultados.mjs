#!/usr/bin/env node
// Paso de build «Prerender de resultados»
// (docs/plans/contenido-generado-build.md, fase 2).
//
// Escribe en las páginas de resultados ES de `_site` (/resultados/<slug>/ y
// /resultados/<slug>/<etapa>/) el contenido que pinta js/resultados.js, con el
// mismo código (js/resultados-html.js y js/header-html.js) importado en Node
// con un entorno mínimo de navegador, como prerender-jornadas.mjs:
//
// - el interior de <main id="resultsContent">, con data-prerendered="<huella>"
//   del esqueleto; cada hueco (estado, filtro, aviso de publicación y tabla)
//   lleva la suya (js/results/dom.js) y la tabla, sus ROW_LIMIT primeras filas
//   (data-rows): el navegador conserva lo que coincide y añade el resto;
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-resultados.mjs <_site> [--scope off|es] [--data datos.json] [--cache <dir>] [--max-reads <n>]
//
// - Ámbito: --scope o PRERENDER_RESULTADOS (por defecto off: no hace nada);
//   es: páginas ES cerradas, es decir, con todas las clasificaciones de la
//   página oficiales y sin actualización en curso, de una carrera fuera de la
//   ventana de sondeo (isNearToday, día de Madrid) y de una temporada con año
//   no archivada. Esas páginas ya no sondean: la actualización automática no
//   se ve afectada. Quedan fuera las CRE (tabla con todos los corredores).
// - Datos: del volcado compartido del build (PAGES_DATA, lecturas RESULTADOS
//   de site_data.py: clasificaciones de todas las carreras y, de las que no
//   están en la caché, inscritos, equipos y filas). Una carrera sin datos ni
//   en el volcado ni en la caché se lee por la API. Sin volcado: con caché, se
//   escriben las páginas guardadas (en un refresco, PAGES_REFRESH, las firmas
//   se comparan por la API y se leen las carreras que cambiaron); sin caché,
//   todo por la API. En local,
//   --data con el volcado de prerender-resultados.sql.
// - Relleno progresivo: como mucho RESULTADOS_MAX_READS carreras leídas por
//   build (--max-reads), sumando el volcado y la API, con la prioridad de
//   site_data.resultados_needing (racesToRead). Las páginas de las carreras
//   que quedan sin datos (pendientes de relleno) se dejan como las escribió
//   gen_og_pages.py, fuera del ámbito de la validación, y se leen en los
//   builds siguientes.
// - Caché entre builds (--cache o RESULTADOS_CACHE): los datos de cada
//   carrera con su firma (site_data.resultados_signature) y el HTML de cada
//   página con su clave (código, firma y datos baratos de la página). Una
//   página con la misma clave no se vuelve a pintar.
// - Un proceso con TZ=Europe/Madrid: horas de Madrid, como un visitante
//   peninsular (js/resultados.js usa la zona del visitante).
// - Vuelta atrás por página: sin datos, sin plantilla reconocible o con un
//   error al pintar, la página queda como la dejó gen_og_pages.py y se cuenta.
// - Falla (código 1) si genera menos del 99 % del ámbito (sin las páginas
//   pendientes de relleno) o si una página generada incumple validatePage().
//   Con GITHUB_OUTPUT, escribe `cache=changed` si hay que guardar la caché.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { firstTechnicalGuide } from '../../js/services/races.js';
import { isNearToday } from '../../js/services/refresh-window.js';
import { readDump } from './prerender-jornadas.mjs';
import { apiFetch, inFilter } from './prerender-inscritos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const ORIGIN = 'https://calendariociclismo.app';
const TIME_ZONE = 'Europe/Madrid';
const MIN_RATIO = 0.99;
// Filas de la tabla escritas en el HTML: más que el alto de la pantalla del
// móvil; el navegador añade el resto.
export const ROW_LIMIT = 20;
// Con 20 filas, la página más grande ronda 39 KB.
const MAX_PAGE_BYTES = 48 * 1024;
// Formato de la caché (ficheros y manifiesto). Cambiarlo la descarta.
const CACHE_FORMAT = 1;
// Versión de los datos de la firma: RESULTADOS_CACHE_CONTRACT de site_data.py.
const SIGNATURE_CONTRACT = 1;
// Carreras leídas por build como máximo: RESULTADOS_MAX_READS de site_data.py.
export const RESULTADOS_MAX_READS = 150;
// RESULTADOS_ROTATION_DAYS de site_data.py.
const ROTATION_DAYS = 28;
const DAY_MS = 86400000;
const API_IN_CHUNK = 100;

const SCOPES = { off: false, es: true };

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_RESULTADOS no admitido: «${scope}» (off o es)`);
  return scope;
}

const archived = year => Number.isInteger(Number(year)) && Number(year) >= 2020 && Number(year) <= 2025;

// ── Carreras candidatas y firma (como site_data.py) ─────────────────────────
/** resultados_candidates() de site_data.py: carreras con clasificaciones, con año no archivado y fuera de la ventana. */
export function candidateRaces(races, stages, now = new Date()) {
  const withStages = new Set(stages.map(stage => stage.raceId));
  return races.filter(race => withStages.has(race.id) && race.year != null && !archived(race.year)
    && !isNearToday(race.startDate, race.endDate, { now })).map(race => race.id);
}

// Valores con el formato de Python (str()), para la misma firma que site_data.py.
const py = value => (value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value));

/** resultados_signature() de site_data.py. */
export function raceSignature(race, stages) {
  const lines = [`${SIGNATURE_CONTRACT}|${race.id}|${py(race.year)}|${py(race.startlistImportedAt)}`,
    ...stages.map(stage => `${stage.id}|${py(stage.updatedAt)}|${py(stage.rowCount)}|${py(stage.publicationStatus)}|${py(stage.updating)}`)];
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/** Día de Madrid (AAAA-MM-DD), como site_data.madrid_today(). */
export const madridDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const isoDay = value => /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ''))?.[0] ?? null;

/** resultados_rotation() de site_data.py. */
export const rotationDays = raceId => ROTATION_DAYS + parseInt(createHash('sha1').update(String(raceId)).digest('hex').slice(0, 4), 16) % 14;

/**
 * resultados_needing() de site_data.py: { read, pending } con las candidatas
 * que leer en este build y las pendientes de relleno, por prioridad y con el
 * corte en `limit`. Primero las que no tienen datos en `cachedRaces` (las
 * `races` del manifiesto de la caché) o han cambiado de firma, de la carrera
 * más reciente a la más antigua (fin o, sin él, inicio; sin fechas, al final);
 * después, las leídas hace al menos su rotación, de la lectura más antigua a
 * la más reciente. A igualdad, el orden de `candidates`. `today`: día de
 * Madrid; `raceById`: Map de las carreras.
 */
export function racesToRead(candidates, sigs, cachedRaces, today, raceById, limit = RESULTADOS_MAX_READS) {
  const missing = [];
  const rotated = [];
  for (const raceId of candidates) {
    const entry = Object.hasOwn(cachedRaces, raceId) ? cachedRaces[raceId] || {} : {};
    const fetched = isoDay(entry.fetched);
    if (entry.sig !== sigs[raceId] || !fetched) missing.push(raceId);
    else if ((Date.parse(today) - Date.parse(fetched)) / DAY_MS >= rotationDays(raceId)) rotated.push({ raceId, fetched });
  }
  const ends = new Map(missing.map(raceId => {
    const race = raceById.get(raceId);
    return [raceId, isoDay(race?.endDate || race?.startDate)];
  }));
  missing.sort((a, b) => (ends.get(a) == null) - (ends.get(b) == null) || compare(ends.get(b) ?? '', ends.get(a) ?? ''));
  rotated.sort((a, b) => compare(a.fetched, b.fetched));
  const ordered = [...missing, ...rotated.map(item => item.raceId)];
  return { read: ordered.slice(0, limit), pending: ordered.slice(limit) };
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que js/resultados.js, en bloque y con el mismo orden:
// desempate por id en la base de datos (su colación, en_US, no es la de
// JavaScript; aquí solo se reordena por columnas numéricas o fechas, con
// ordenación estable sobre el orden por id). Las consultas son las de
// RESULTADOS en site_data.py, que las lee en el volcado compartido.
const TEAM_COLUMNS = 'id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle,teamKind,selectionScope,countryCode,selectionCode';
const SEASON_COLUMNS = 'teamId,name,category,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts';
const BASE_QUERIES = {
  races: 'races?select=*&order=id.asc',
  race_days: 'race_days?select=*&editorialStatus=eq.published&order=id.asc',
  assets: 'assets?select=*&order=id.asc',
  guides: 'assets?select=*,race_days!inner(raceId,dateKey)&type=eq.technicalGuide&order=id.asc',
  resultados_stages: 'race_uci_stages?select=*&keepForWeb=eq.true&rowCount=gt.0&order=id.asc',
  resultados_classifications: 'race_classifications?select=*&order=raceId.asc,classKind.asc',
};
const RACE_QUERIES = {
  resultados_riders: filter => `startlist_riders_resolved?select=raceId,dorsal,firstName,lastName,countryCode,teamId,globalRiderId&${filter}&order=id.asc`,
  resultados_teams: (filter, year) => `startlist_teams?select=id,raceId,teamId,teamName,team:teams(${TEAM_COLUMNS},team_seasons(${SEASON_COLUMNS}))&${filter}&team.team_seasons.year=eq.${year}&order=id.asc`,
  resultados_results: filter => `race_uci_results?select=stageRef,rank,rankText,bib,riderDisplay,globalRiderId,teamId,resultValue,timeText,gapText,points,uciPoints,irm,sortOrder&${filter}&order=id.asc`,
};
const CATALOG_QUERIES = {
  resultados_riders_men: 'riders_men?select=id,firstName,lastName,nationality,currentTeamId&order=id.asc',
  resultados_riders_women: 'riders_women?select=id,firstName,lastName,nationality,currentTeamId&order=id.asc',
  resultados_team_list: `teams?select=${TEAM_COLUMNS}&order=id.asc`,
  resultados_team_seasons: years => `team_seasons?select=year,${SEASON_COLUMNS}&year=in.(${years.join(',')})&order=id.asc`,
};
const VOLCADO_TABLES = [...Object.keys(BASE_QUERIES), ...Object.keys(RACE_QUERIES), ...Object.keys(CATALOG_QUERIES)];

const chunked = values => Array.from({ length: Math.ceil(values.length / API_IN_CHUNK) },
  (_, at) => values.slice(at * API_IN_CHUNK, (at + 1) * API_IN_CHUNK));

/**
 * Lecturas por la API de las carreras `raceIds`, con las mismas consultas que
 * site_data.py: inscritos, equipos por año de la carrera, filas de sus
 * clasificaciones y el catálogo de fichas y equipos.
 */
async function loadApiRaces(raceIds, { races, stages }, key) {
  if (!raceIds.length) return {};
  const raceById = new Map(races.map(race => [race.id, race]));
  const parts = [];
  const add = (name, path) => parts.push({ name, path });
  for (const chunk of chunked(raceIds)) add('resultados_riders', RACE_QUERIES.resultados_riders(inFilter('raceId', chunk)));
  const byYear = groupBy(raceIds.map(id => raceById.get(id)), 'year');
  const years = [...byYear.keys()].sort((a, b) => a - b);
  for (const year of years) {
    for (const chunk of chunked(byYear.get(year).map(race => race.id))) add('resultados_teams', RACE_QUERIES.resultados_teams(inFilter('raceId', chunk), year));
  }
  const wanted = new Set(raceIds);
  const stageIds = stages.filter(stage => wanted.has(stage.raceId)).map(stage => stage.id);
  for (const chunk of chunked(stageIds)) add('resultados_results', RACE_QUERIES.resultados_results(inFilter('stageRef', chunk)));
  add('resultados_riders_men', CATALOG_QUERIES.resultados_riders_men);
  add('resultados_riders_women', CATALOG_QUERIES.resultados_riders_women);
  add('resultados_team_list', CATALOG_QUERIES.resultados_team_list);
  add('resultados_team_seasons', CATALOG_QUERIES.resultados_team_seasons(years));
  const tables = Object.fromEntries(Object.keys({ ...RACE_QUERIES, ...CATALOG_QUERIES }).map(name => [name, []]));
  (await apiFetch(parts, key)).forEach((rows, at) => { tables[parts[at].name] = tables[parts[at].name].concat(rows); });
  return tables;
}

/**
 * Sin volcado, por la API: tablas baratas y las candidatas que no cubre
 * `cachedRaces` (todas sin caché), hasta `limit`.
 */
async function loadApiData(key, now, limit, cachedRaces = {}) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de resultados');
  const names = Object.keys(BASE_QUERIES);
  const base = Object.fromEntries((await apiFetch(names.map(name => ({ path: BASE_QUERIES[name] })), key)).map((rows, at) => [names[at], rows]));
  const state = stateFor(base, cachedRaces, now, limit);
  return { tables: { ...base, ...(await loadApiRaces(state.read, { races: base.races, stages: base.resultados_stages }, key)) }, state };
}

/**
 * Estado de las lecturas cuando no lo da el volcado, como el manifiesto de
 * site_data.py: firmas de las candidatas, las que se leen (las que no cubre
 * `cachedRaces`, por prioridad y hasta `limit`) y las pendientes de relleno.
 */
function stateFor(tables, cachedRaces, now, limit) {
  const stagesByRace = groupBy(tables.resultados_stages, 'raceId');
  const raceById = new Map(tables.races.map(race => [race.id, race]));
  const candidates = candidateRaces(tables.races, tables.resultados_stages, now);
  const sigs = Object.fromEntries(candidates.map(id => [id, raceSignature(raceById.get(id), stagesByRace.get(id))]));
  return { sigs, ...racesToRead(candidates, sigs, cachedRaces, madridDay(now), raceById, limit) };
}

/** Volcado compartido con las lecturas de resultados, o null. */
export function sharedData(dir) {
  const file = dir ? join(dir, 'manifest.json') : null;
  if (!file || !existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file, 'utf8')).resultados;
  if (!state?.sigs) return null;
  const tables = Object.fromEntries(VOLCADO_TABLES.map(name => [name, JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))]));
  return { tables, state };
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key];
    if (value == null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

const without = (row, column) => { const { [column]: _omit, ...rest } = row; return rest; };
const nullsLast = (a, b) => (a == null) - (b == null);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// race_days: dateKey asc, neutralStartTimeUtc asc con NULL primero (como el
// navegador) y, a igualdad, el orden por id.
const DAY_COLUMNS = ['id', 'stageNumber', 'dateKey', 'isCancelledDay', 'isRestDay', 'neutralStartTimeUtc'];
function raceDaysOrder(a, b) {
  return nullsLast(a.dateKey, b.dateKey) || compare(a.dateKey, b.dateKey)
    || (b.neutralStartTimeUtc == null) - (a.neutralStartTimeUtc == null)
    || compare(a.neutralStartTimeUtc ?? '', b.neutralStartTimeUtc ?? '');
}
const bySortOrder = (a, b) => nullsLast(a.sortOrder, b.sortOrder) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

/** Índices de las tablas baratas (carreras, jornadas, clasificaciones, documentos). */
export function buildIndex(tables) {
  const rows = name => tables[name] || [];
  const stagesByRace = groupBy(rows('resultados_stages'), 'raceId');
  for (const stages of stagesByRace.values()) stages.sort((a, b) => nullsLast(a.stageNumber, b.stageNumber) || (a.stageNumber ?? 0) - (b.stageNumber ?? 0));
  const daysByRace = new Map();
  for (const [raceId, days] of groupBy(rows('race_days'), 'raceId')) {
    daysByRace.set(raceId, days.map(day => Object.fromEntries(DAY_COLUMNS.map(column => [column, day[column] ?? null]))).sort(raceDaysOrder));
  }
  const guideByRace = new Map();
  for (const [raceId, guides] of groupBy(rows('guides'), row => row.race_days?.raceId)) guideByRace.set(raceId, firstTechnicalGuide(guides));
  return {
    races: new Map(rows('races').map(race => [race.id, race])),
    days: new Map(rows('race_days').map(day => [day.id, day])),
    stagesByRace,
    daysByRace,
    classificationsByRace: groupBy(rows('resultados_classifications'), 'raceId'),
    assetsByDay: groupBy(rows('assets'), 'raceDayId'),
    guideByRace,
  };
}

/**
 * Datos de cada carrera de `raceIds` a partir de las tablas leídas: inscritos,
 * equipos, filas de sus clasificaciones (por sortOrder) y la parte del
 * catálogo que usa el HTML: fichas de los corredores que no casan con la
 * lista (por dorsal o globalRiderId, como createResultsResolver), equipos de
 * esas fichas y de las filas, y sus temporadas del año de la carrera.
 */
export function raceData(tables, raceIds, index) {
  const ridersByRace = groupBy(tables.resultados_riders || [], 'raceId');
  const teamsByRace = groupBy(tables.resultados_teams || [], 'raceId');
  const resultsByStage = groupBy(tables.resultados_results || [], 'stageRef');
  const men = new Map((tables.resultados_riders_men || []).map(row => [row.id, row]));
  const women = new Map((tables.resultados_riders_women || []).map(row => [row.id, row]));
  const teams = new Map((tables.resultados_team_list || []).map(row => [row.id, row]));
  const seasons = groupBy(tables.resultados_team_seasons || [], 'teamId');
  const data = new Map();
  for (const raceId of raceIds) {
    const race = index.races.get(raceId);
    const results = {};
    for (const stage of index.stagesByRace.get(raceId) || []) {
      results[stage.id] = (resultsByStage.get(stage.id) || []).map(row => without(row, 'stageRef')).sort(bySortOrder);
    }
    const rows = Object.values(results).flat();
    const riders = (ridersByRace.get(raceId) || []).map(row => without(row, 'raceId'));
    const dorsals = new Set(riders.map(row => row.dorsal).filter(dorsal => dorsal != null));
    const listed = new Set(riders.map(row => row.globalRiderId).filter(Boolean));
    const resolved = row => (row.bib != null && /^\d+$/.test(String(row.bib)) && dorsals.has(Number(row.bib))) || listed.has(row.globalRiderId);
    const riderIds = [...new Set(rows.filter(row => !resolved(row)).map(row => row.globalRiderId).filter(Boolean))];
    const catalog = { riders_men: riderIds.map(id => men.get(id)).filter(Boolean), riders_women: riderIds.map(id => women.get(id)).filter(Boolean) };
    const teamIds = [...new Set([...rows.map(row => row.teamId), ...catalog.riders_men.concat(catalog.riders_women).map(row => row.currentTeamId)].filter(Boolean))];
    catalog.teams = teamIds.map(id => teams.get(id)).filter(Boolean);
    catalog.team_seasons = teamIds.flatMap(id => (seasons.get(id) || []).filter(season => season.year === race?.year));
    data.set(raceId, {
      riders,
      teams: (teamsByRace.get(raceId) || []).map(row => without(row, 'raceId')),
      results,
      catalog,
    });
  }
  return data;
}

/**
 * Cliente de Supabase local para enrichRiders, enrichOverrideTeams y
 * teamsForSeason: from(tabla).select(columnas).in(col, valores).eq(col, valor)
 * con las filas leídas (ya filtradas por RLS como la clave anónima).
 */
export function localClient(tables) {
  // Índices por columna, creados al primer `in` sobre ella (id, teamId).
  const indexes = new Map();
  const indexed = (table, column) => {
    const key = `${table}.${column}`;
    if (!indexes.has(key)) indexes.set(key, groupBy(tables[table] || [], column));
    return indexes.get(key);
  };
  return {
    from(table) {
      const filters = [];
      let columns = null;
      let candidates = null;
      const query = {
        select(list) { columns = list.split(',').map(column => column.trim()); return query; },
        in(column, values) {
          const index = indexed(table, column);
          candidates = [...new Set(values)].flatMap(value => index.get(value) || []);
          return query;
        },
        eq(column, value) { filters.push(row => row[column] === value); return query; },
        then(resolve, reject) {
          try {
            const data = (candidates ?? tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
              .map(row => (columns ? Object.fromEntries(columns.map(column => [column, row[column] ?? null])) : { ...row }));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return query;
    },
  };
}

// ── Caché entre builds ─────────────────────────────────────────────────────
// Columnas de las filas de resultados (las de js/resultados.js): en la caché,
// cada fila es la lista de sus valores.
const RESULT_COLUMNS = ['rank', 'rankText', 'bib', 'riderDisplay', 'globalRiderId', 'teamId', 'resultValue', 'timeText',
  'gapText', 'points', 'uciPoints', 'irm', 'sortOrder'];
const packData = data => ({ ...data, results: Object.fromEntries(Object.entries(data.results)
  .map(([stageRef, rows]) => [stageRef, rows.map(row => RESULT_COLUMNS.map(column => row[column] ?? null))])) });
const unpackData = data => ({ ...data, results: Object.fromEntries(Object.entries(data.results)
  .map(([stageRef, rows]) => [stageRef, rows.map(values => Object.fromEntries(RESULT_COLUMNS.map((column, at) => [column, values[at]])))])) });

// <dir>/manifest.json: { format, races: { raceId: { sig, fetched } }, pages:
// { ruta: { key, race, rows, fingerprint } } }. site_data.py lee `races` para
// decidir qué carreras leer. <dir>/data/<raceId>.json: datos de la carrera
// (raceData). <dir>/pages/<raceId>.json: { ruta: HTML del <main> }.
function loadCache(dir) {
  const file = dir ? join(dir, 'manifest.json') : null;
  const manifest = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const usable = manifest?.format === CACHE_FORMAT;
  const pages = new Map();
  const data = new Map();
  return {
    dir,
    present: usable,
    races: usable ? manifest.races || {} : {},
    pages: usable ? manifest.pages || {} : {},
    data(raceId) {
      if (!data.has(raceId)) {
        const path = join(dir, 'data', `${raceId}.json`);
        data.set(raceId, usable && existsSync(path) ? unpackData(JSON.parse(readFileSync(path, 'utf8'))) : null);
      }
      return data.get(raceId);
    },
    fragment(raceId, page) {
      if (!pages.has(raceId)) {
        const path = join(dir, 'pages', `${raceId}.json`);
        pages.set(raceId, usable && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
      }
      return pages.get(raceId)[page] ?? null;
    },
  };
}

/** Ficheros del código que produce el HTML de la página (grafo de imports). */
function codeVersion() {
  const seen = new Set();
  const pending = [join(ROOT, 'js/resultados-html.js'), SCRIPT];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) pending.push(resolve(dirname(file), match[1]));
  }
  const hash = createHash('sha1');
  for (const file of [...seen].sort()) hash.update(`${relative(ROOT, file)}\0`).update(readFileSync(file)).update('\0');
  return hash.digest('hex').slice(0, 16);
}

// ── Página ─────────────────────────────────────────────────────────────────
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const MAIN_OPEN = /<main id="resultsContent"([^>]*)>/;
const RACE_META = /<meta name="cc:race-id" content="([^"]+)">/;
const OWN_ATTRS = /\sdata-prerendered="[^"]*"/g;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Clave pedida por la ruta, como js/resultados.js: sin segmento, la última con datos. */
export function requestedFromPath(segment) {
  if (!segment) return { requestedKey: undefined, requestedStage: undefined, stageSuffixParam: '' };
  if (/^(prologo|prologue)$/i.test(segment)) return { requestedKey: '0', requestedStage: 0, stageSuffixParam: '' };
  const match = segment.match(/(?:etapa|stage)-(\d+)([a-z])?/i);
  if (!match) return { requestedKey: undefined, requestedStage: undefined, stageSuffixParam: '' };
  const suffix = (match[2] || '').toUpperCase();
  return { requestedKey: `${Number(match[1])}${suffix}`, requestedStage: Number(match[1]), stageSuffixParam: suffix };
}

// Huecos del esqueleto (resultsPageHtml) que se rellenan con su contenido y
// su huella.
const SLOTS = {
  status: '<div class="res-tabs__status" id="resStatusSlot"></div>',
  filter: '<div class="res-tabs__filter" id="resTeamFilterSlot"></div>',
  publication: '<div class="res-publication" id="resPublication" aria-live="polite"></div>',
  table: '<div class="res-table-wrap" id="resTableWrap"></div>',
  metrics: '<dl></dl>',
};

/**
 * Esqueleto con los huecos rellenos: cada uno con la huella de su HTML y la
 * tabla recortada, con data-rows.
 */
export function fillSlots(skeleton, slots, fingerprint) {
  let html = skeleton;
  for (const [name, content] of Object.entries(slots)) {
    if (content == null) continue;
    const empty = SLOTS[name];
    const at = html.indexOf(empty);
    if (at < 0) throw new Error(`hueco ${name} ausente`);
    const rows = content.rows ? ` data-rows="${content.rows}"` : '';
    const close = empty.slice(empty.lastIndexOf('</'));
    html = html.slice(0, at) + `${empty.slice(0, -close.length - 1)} data-prerendered="${attr(fingerprint(content.html))}"${rows}>${content.html}${close}`
      + html.slice(at + empty.length);
  }
  return html;
}

/**
 * Página con la cabecera y el contenido generados, o null si la plantilla no
 * tiene la cabecera y el <main> esperados. Sustituye también lo que escribió
 * una pasada anterior.
 */
function composePage(source, { headerInner, html, fingerprint }) {
  const header = HEADER.exec(source);
  const main = MAIN_OPEN.exec(source);
  if (!header || !main || header.index > main.index) return null;
  const mainEnd = main.index + main[0].length;
  const close = source.indexOf('</main>', mainEnd);
  if (close < 0) return null;
  return source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, main.index)
    + `<main id="resultsContent"${main[1].replace(OWN_ATTRS, '')} data-prerendered="${attr(fingerprint)}">\n${html}\n`
    + source.slice(close);
}

/** Atributos de la cabecera vacía: data-back y, si los hay, data-lang y data-active. */
function headerOptions(source) {
  const attrs = HEADER.exec(source)?.[1] || '';
  const value = name => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  return { lang: value('data-lang') || 'es', hasBack: /\sdata-back(?=[\s=>]|$)/.test(attrs), active: value('data-active') || null };
}

const BAD_URL = /(?:^|[/?=&#])(?:undefined|null)(?:[/?#&]|$)/;

/**
 * Comprobaciones de una página generada; devuelve los errores. `navHrefs`:
 * enlaces de vistas que debe llevar la cabecera (js/header-html.js); `rows`:
 * filas de la tabla escritas.
 */
export function validatePage(page, { rows, navHrefs }) {
  const errors = [];
  for (const [, name, value] of page.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (BAD_URL.test(value)) errors.push(`${name} con undefined o null: ${value}`);
  }
  const header = HEADER.exec(page)?.[0] || '';
  const navLinks = [...header.matchAll(/<a class="primary-nav__main[^"]*" href="([^"]*)"/g)].map(match => match[1]);
  if (navLinks.join(' ') !== navHrefs.join(' ')) {
    errors.push(`enlaces de vistas de la cabecera: ${navLinks.join(' ') || 'ninguno'} (esperados ${navHrefs.join(' ')})`);
  }
  // Filas de la primera tabla tras el hueco de la tabla (sin tabla: avisos).
  const start = page.indexOf('id="resTableWrap"');
  const close = start < 0 ? -1 : page.indexOf('</table>', start);
  const painted = close < 0 ? 0 : page.slice(start, close).match(/<tr class="so-row[ "]/g)?.length || 0;
  if (painted !== rows) errors.push(`${painted} filas en la tabla de ${rows}`);
  const bytes = Buffer.byteLength(page);
  if (bytes >= MAX_PAGE_BYTES) errors.push(`${bytes} bytes (máximo ${MAX_PAGE_BYTES})`);
  return errors;
}

// ── Pintado ────────────────────────────────────────────────────────────────
function defineGlobals(values) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

// Entorno mínimo para importar los módulos públicos: mismos CONFIG y dominio
// EN que el js/config.js de CI; sin red. Copia del de prerender-jornadas.mjs
// con la ruta de la página de resultados.
function installBrowserEnv() {
  const storage = () => {
    const values = new Map();
    return { getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  };
  const element = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  });
  class Observer { observe() {} disconnect() {} }
  defineGlobals({
    CONFIG: { basePath: '', webOrigin: ORIGIN, enDomain: '' },
    EN_DOMAIN: '',
    SUPABASE_URL: 'https://prerender.invalid',
    SUPABASE_ANON_KEY: 'prerender',
    localStorage: storage(),
    sessionStorage: storage(),
    location: new URL(`${ORIGIN}/resultados/`),
    document: {
      documentElement: { ...element(), lang: 'es' }, head: element(), body: element(), createElement: element,
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    MutationObserver: Observer,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    fetch: async url => { throw new Error(`Petición no permitida en el prerender: ${url}`); },
  });
  defineGlobals({ window: globalThis });
}

/** Páginas ES de resultados: /resultados/<slug>/ y /resultados/<slug>/<etapa>/. */
function pageFiles(site) {
  const base = join(site, 'resultados');
  if (!existsSync(base)) return [];
  const files = [];
  for (const race of readdirSync(base, { withFileTypes: true })) {
    if (!race.isDirectory()) continue;
    const dir = join(base, race.name);
    if (existsSync(join(dir, 'index.html'))) files.push(join(dir, 'index.html'));
    for (const stage of readdirSync(dir, { withFileTypes: true })) {
      if (stage.isDirectory() && existsSync(join(dir, stage.name, 'index.html'))) files.push(join(dir, stage.name, 'index.html'));
    }
  }
  return files.sort();
}

/**
 * Página del ámbito: { race, stages, active, inputs } o { out: motivo }.
 * `inputs`: los datos baratos de la página, que entran en su clave.
 */
function scopePage(html, index, source, file, site, now) {
  const raceId = RACE_META.exec(source)?.[1];
  const race = raceId ? index.races.get(raceId) : null;
  if (!race) return { out: 'sin carrera' };
  if (race.year == null || archived(race.year)) return { out: 'temporada archivada o sin año' };
  if (isNearToday(race.startDate, race.endDate, { now })) return { out: 'en ventana de sondeo' };
  const segment = relative(join(site, 'resultados'), dirname(file)).split(sep)[1];
  const requested = requestedFromPath(segment);
  const stagesAll = index.stagesByRace.get(raceId) || [];
  const allRaceDays = index.daysByRace.get(raceId) || [];
  const stages = html.resultsStages({ stagesAll, allRaceDays, ...requested });
  if (stages.missing) return { out: 'sin clasificación' };
  const classificationConfig = index.classificationsByRace.get(raceId) || [];
  const active = html.resultsActive(stages, { stagesAll, classificationConfig, allRaceDays });
  if (active.activeStages.some(row => !row._cancelledStage && (row.publicationStatus !== 'official' || row.updating))) return { out: 'sin cerrar' };
  const contextDay = active.contextDayId ? index.days.get(active.contextDayId) || null : null;
  const inputs = { segment: segment || '', race, stagesAll, allRaceDays, classificationConfig, contextDay,
    assets: active.contextDayId ? index.assetsByDay.get(active.contextDayId) || [] : [], guide: index.guideByRace.get(raceId) || null };
  return { race, stages, active, inputs };
}

/** HTML del <main> de una página cerrada: esqueleto con sus huecos. */
async function renderPage(html, env, { race, stages, active, inputs }, data) {
  const { activeClass, raceDayId, activeStages } = active;
  const { contextDay } = inputs;
  const raceDay = raceDayId ? contextDay : null;
  const contextAssets = env.withRaceTechnicalGuide(inputs.assets, inputs.guide);
  const actionAssets = raceDayId ? contextAssets : env.withRaceTechnicalGuide([], inputs.guide);
  const isOneDay = race.raceFormat === 'one_day';
  const resolver = html.createResultsResolver({ race, slRiders: data.riders, slTeamsRows: data.teams });

  // El navegador no toca el hueco del filtro con la etapa cancelada ni sin
  // filas: sin contenido ni huella.
  let table;
  let rows = 0;
  let filter = null;
  if (activeClass._cancelledStage) {
    table = { html: html.cancelledNoticeHtml(false) };
  } else {
    const list = data.results[activeClass.id];
    if (!list) return { missing: true };
    if (!list.length) {
      table = { html: html.emptyClassificationHtml(false) };
    } else {
      const client = localClient(data.catalog);
      await html.enrichRiders(client, resolver, list.map(row => row.globalRiderId).filter(Boolean), env.now);
      await html.enrichOverrideTeams(client, resolver, list.map(row => row.teamId).filter(Boolean));
      const classification = html.classificationHtml(list, activeClass, { race, raceDay, isOneDay, resolver, lang: 'es' });
      if (classification.ttt) return { out: 'CRE' };
      const limit = classification.rows.length > ROW_LIMIT ? ROW_LIMIT : null;
      rows = limit ?? classification.rows.length;
      table = { html: html.classificationTableHtml(classification, rows), rows: limit };
      filter = html.teamFilterHtml(classification, '', false);
    }
  }
  const skeleton = html.resultsPageHtml({
    race, stages, active, raceDay, contextDay, contextAssets, actionAssets,
    canonBase: '/resultados/', canonSlug: race.slug, isEn: false,
  });
  const hasTabs = activeStages.length > 1;
  const bar = hasTabs || !(activeClass.classKind === 'teams' || activeClass.isTeamEvent);
  const publication = html.publicationHtml(activeClass, { configByKind: active.configByKind, isOneDay, inBar: bar && !hasTabs, isEn: false, timeZone: TIME_ZONE, now: env.now.getTime() });
  const slots = {
    status: bar ? { html: publication.status } : null,
    filter: bar && filter != null ? { html: filter } : null,
    publication: { html: publication.publication },
    table,
    metrics: contextDay ? { html: env.stageMetricsHtml(contextDay) } : null,
  };
  return { html: fillSlots(skeleton, slots, htmlFingerprint), fingerprint: htmlFingerprint(skeleton), rows };
}

/**
 * Recorre las páginas ES: compone desde la caché las que tienen la misma
 * clave y pinta el resto con los datos del volcado, de la caché o de la API.
 * `source`: { tables, state, readRaces? } (null: solo caché); `state.pending`,
 * las carreras pendientes de relleno; `readRaces`, las tablas de otras
 * carreras sin datos (por defecto, por la API). `limit`: carreras leídas por
 * build como máximo.
 */
async function run(site, { source, cache, key, now, limit }) {
  const started = performance.now();
  installBrowserEnv();
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { withRaceTechnicalGuide } = await load('js/shared.js');
  const { stageMetricsHtml } = await load('js/stage/context.js');
  const html = await load('js/resultados-html.js');
  await initI18n();
  const env = { withRaceTechnicalGuide, stageMetricsHtml, now };
  const navHrefs = PRIMARY_NAV_ITEMS.map(name => STRINGS.es[name].href);
  const result = { pages: 0, scope: 0, generated: 0, rendered: 0, cached: 0, written: 0, apiRaces: 0,
    pending: 0, pendingRaces: 0, fallbacks: [], errors: [], bytes: [], out: {} };
  const skip = reason => { result.out[reason] = (result.out[reason] || 0) + 1; };
  const files = pageFiles(site);
  const write = (file, name, source, page, rows) => {
    result.generated++;
    result.bytes.push(Buffer.byteLength(page));
    result.errors.push(...validatePage(page, { rows, navHrefs }).map(error => `${name}: ${error}`));
    if (page !== source) {
      writeFileSync(file, page);
      result.written++;
    }
  };

  // Sin volcado: las páginas guardadas en la caché, tal cual.
  if (!source) {
    for (const file of files) {
      result.pages++;
      const name = relative(site, file);
      const entry = cache.pages[name];
      if (!entry) { skip('fuera de la caché'); continue; }
      result.scope++;
      const pageSource = readFileSync(file, 'utf8');
      const fragment = cache.fragment(entry.race, name);
      const page = fragment == null ? null : composePage(pageSource, { html: fragment, fingerprint: entry.fingerprint, headerInner: headerHtml(headerOptions(pageSource)) });
      if (!page || RACE_META.exec(pageSource)?.[1] !== entry.race) { result.fallbacks.push(`${name}: caché`); continue; }
      result.cached++;
      write(file, name, pageSource, page, entry.rows);
    }
    return { ...result, ms: performance.now() - started, cache: null };
  }

  const index = buildIndex(source.tables);
  const { sigs, read, pending: deferred = [] } = source.state;
  const code = codeVersion();
  const year = new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric' }).format(now);
  const fresh = raceData(source.tables, read, index);
  const pageKey = (sig, inputs) => createHash('sha1').update(`${CACHE_FORMAT}|${code}|${sig}|${year}|${JSON.stringify(inputs)}`).digest('hex').slice(0, 20);
  // Datos de una carrera: los leídos en este build o los de la caché con su misma firma.
  const dataOf = raceId => fresh.get(raceId) ?? (cache.races[raceId]?.sig === sigs[raceId] ? cache.data(raceId) : null);
  // Si traen las filas de la clasificación que muestra la página.
  const covers = (data, { activeClass }) => !!data && (activeClass._cancelledStage || Object.hasOwn(data.results, activeClass.id));
  // Clasificaciones que muestran las páginas del ámbito, por carrera: la
  // caché solo guarda sus filas.
  const used = new Map();

  const pending = [];
  const pages = {};
  const fragments = new Map();
  for (const file of files) {
    result.pages++;
    const name = relative(site, file);
    const pageSource = readFileSync(file, 'utf8');
    const scoped = scopePage(html, index, pageSource, file, site, now);
    if (scoped.out) { skip(scoped.out); continue; }
    const raceId = scoped.race.id;
    if (!sigs[raceId]) { skip('fuera de las candidatas'); continue; }
    result.scope++;
    if (!used.has(raceId)) used.set(raceId, new Set());
    used.get(raceId).add(scoped.active.activeClass.id);
    const pageKeyValue = pageKey(sigs[raceId], scoped.inputs);
    const entry = cache.pages[name];
    const fragment = entry?.key === pageKeyValue && entry.race === raceId ? cache.fragment(raceId, name) : null;
    const job = { file, name, pageSource, scoped, key: pageKeyValue };
    if (fragment != null) {
      job.rendered = { html: fragment, fingerprint: entry.fingerprint, rows: entry.rows };
      result.cached++;
    } else if (!covers(dataOf(raceId), scoped.active)) {
      job.needsApi = true;
    }
    pending.push(job);
  }

  // Carreras sin datos ni en el volcado ni en la caché. Las pendientes de
  // relleno del volcado siguen pendientes; el resto (caché de otro formato,
  // clasificación de la página que la caché no guardó…), por la API hasta
  // completar el máximo de lecturas, de la más reciente a la más antigua.
  const waiting = new Set(deferred);
  const missing = [...new Set(pending.filter(job => job.needsApi).map(job => job.scoped.race.id))].filter(raceId => !waiting.has(raceId));
  const extra = racesToRead(missing, sigs, {}, madridDay(now), index.races, Math.max(0, limit - read.length));
  for (const raceId of extra.pending) waiting.add(raceId);
  if (extra.read.length) {
    const tables = await (source.readRaces
      ? source.readRaces(extra.read)
      : loadApiRaces(extra.read, { races: source.tables.races, stages: source.tables.resultados_stages }, key));
    for (const [raceId, data] of raceData(tables, extra.read, index)) fresh.set(raceId, data);
    result.apiRaces = extra.read.length;
  }
  const pendingRaces = new Set();

  for (const job of pending) {
    const { file, name, pageSource, scoped } = job;
    if (job.needsApi && waiting.has(scoped.race.id)) {
      result.scope--;
      result.pending++;
      pendingRaces.add(scoped.race.id);
      continue;
    }
    let rendered = job.rendered;
    if (!rendered) {
      const data = dataOf(scoped.race.id);
      try {
        rendered = covers(data, scoped.active) ? await renderPage(html, env, scoped, data) : { missing: true };
      } catch (error) {
        result.fallbacks.push(`${name}: error: ${error.message}`);
        continue;
      }
      if (rendered.out) { result.scope--; skip(rendered.out); continue; }
      if (rendered.missing) { result.fallbacks.push(`${name}: sin datos`); continue; }
      result.rendered++;
    }
    const page = composePage(pageSource, { ...rendered, headerInner: headerHtml(headerOptions(pageSource)) });
    if (!page) { result.fallbacks.push(`${name}: plantilla`); continue; }
    write(file, name, pageSource, page, rendered.rows);
    pages[name] = { key: job.key, race: scoped.race.id, rows: rendered.rows, fingerprint: rendered.fingerprint };
    if (!fragments.has(scoped.race.id)) fragments.set(scoped.race.id, {});
    fragments.get(scoped.race.id)[name] = rendered.html;
  }

  // Caché nueva: datos de las candidatas (los leídos hoy, con su fecha y solo
  // las filas de las clasificaciones que muestran sus páginas; los guardados
  // con la misma firma, tal cual) y las páginas generadas.
  const races = {};
  for (const raceId of Object.keys(sigs)) {
    if (fresh.has(raceId)) {
      races[raceId] = { sig: sigs[raceId], fetched: madridDay(now) };
      const data = fresh.get(raceId);
      const shown = used.get(raceId) || new Set();
      data.results = Object.fromEntries(Object.entries(data.results).filter(([stageRef]) => shown.has(stageRef)));
    } else if (cache.races[raceId]?.sig === sigs[raceId]) {
      races[raceId] = cache.races[raceId];
    }
  }
  result.pendingRaces = pendingRaces.size;
  return { ...result, ms: performance.now() - started, cache: { races, pages, fresh, fragments } };
}

/** Escribe la caché nueva; devuelve si cambió algo. */
function saveCache(dir, next) {
  const manifest = { format: CACHE_FORMAT, races: next.races, pages: next.pages };
  const manifestFile = join(dir, 'manifest.json');
  const text = JSON.stringify(manifest);
  let changed = !existsSync(manifestFile) || readFileSync(manifestFile, 'utf8') !== text;
  for (const sub of ['data', 'pages']) mkdirSync(join(dir, sub), { recursive: true });
  for (const [raceId, data] of next.fresh) {
    if (!next.races[raceId]) continue;
    writeFileSync(join(dir, 'data', `${raceId}.json`), JSON.stringify(packData(data)));
    changed = true;
  }
  const keepData = new Set(Object.keys(next.races));
  for (const file of readdirSync(join(dir, 'data'))) {
    if (!keepData.has(file.replace(/\.json$/, ''))) { rmSync(join(dir, 'data', file)); changed = true; }
  }
  const byRace = new Map();
  for (const [name, entry] of Object.entries(next.pages)) {
    if (!byRace.has(entry.race)) byRace.set(entry.race, {});
    byRace.get(entry.race)[name] = next.fragments.get(entry.race)?.[name] ?? null;
  }
  for (const [raceId, fragments] of byRace) {
    const text = JSON.stringify(fragments);
    const file = join(dir, 'pages', `${raceId}.json`);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { writeFileSync(file, text); changed = true; }
  }
  for (const file of readdirSync(join(dir, 'pages'))) {
    if (!byRace.has(file.replace(/\.json$/, ''))) { rmSync(join(dir, 'pages', file)); changed = true; }
  }
  if (changed) writeFileSync(manifestFile, text);
  return changed;
}

// ── Línea de órdenes ───────────────────────────────────────────────────────
// Opciones con valor (--scope, --data, --cache, --max-reads) y la ruta del sitio.
function parseArgs(argv) {
  const args = { site: null, options: {} };
  for (let at = 0; at < argv.length; at++) {
    if (argv[at].startsWith('--')) args.options[argv[at].slice(2)] = argv[++at] ?? null;
    else args.site ??= argv[at];
  }
  return args;
}

const seconds = ms => `${(ms / 1000).toFixed(2)} s`;

async function main(argv) {
  const { site, options } = parseArgs(argv);
  if (!site) throw new Error('Uso: prerender-resultados.mjs <_site> [--scope off|es] [--data datos.json] [--cache <dir>] [--max-reads <n>]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_RESULTADOS);
  const limit = Number(options['max-reads'] ?? RESULTADOS_MAX_READS);
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`--max-reads no admitido: «${options['max-reads']}»`);
  if (scope === 'off') {
    console.log('Prerender de resultados desactivado (PRERENDER_RESULTADOS=off)');
    return 0;
  }
  // Horas y día de Madrid en todo el proceso (isNearToday, «Salida
  // neutralizada»): se relanza con la zona si hace falta.
  if (process.env.TZ !== TIME_ZONE) {
    const child = spawnSync(process.execPath, [...process.execArgv, SCRIPT, ...argv], { stdio: 'inherit', env: { ...process.env, TZ: TIME_ZONE } });
    return child.status ?? 1;
  }
  const started = performance.now();
  const now = new Date();
  const cacheDir = options.cache ?? process.env.RESULTADOS_CACHE ?? null;
  const cache = loadCache(cacheDir);
  const key = process.env.SUPABASE_ANON_KEY;
  let source;
  let origin;
  if (options.data) {
    // Como el volcado del build frente a la caché; las demás carreras sin
    // datos salen del mismo volcado en lugar de la API.
    const tables = readDump(options.data);
    source = { tables, state: stateFor(tables, cache.races, now, limit), readRaces: async () => tables };
    origin = '--data';
  } else {
    // Un dispatch de refresco (PAGES_REFRESH) sin volcado compara las firmas
    // por la API y lee las carreras corregidas; un push usa la caché tal cual.
    source = sharedData(process.env.PAGES_DATA);
    origin = 'volcado compartido';
    const refresh = process.env.PAGES_REFRESH === 'true';
    if (!source && cache.present && !refresh) origin = 'caché, sin volcado';
    else if (!source) {
      source = await loadApiData(key, now, limit, cache.present ? cache.races : {});
      origin = cache.present ? 'API y caché' : 'API';
    }
  }
  const loaded = performance.now();
  const result = await run(resolve(site), { source, cache, key, now, limit });
  const ratio = result.scope ? result.generated / result.scope : 1;
  const ok = ratio >= MIN_RATIO && !result.errors.length;
  let changed = false;
  if (ok && result.cache && cacheDir) changed = saveCache(cacheDir, result.cache);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `cache=${changed ? 'changed' : 'unchanged'}\n`);

  const sizes = result.bytes.sort((a, b) => a - b);
  const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
  const mb = (sizes.reduce((sum, bytes) => sum + bytes, 0) / 1048576).toFixed(1);
  console.log(`  es: ${result.generated}/${result.scope} generadas (${result.rendered} pintadas, ${result.cached} desde la caché, `
    + `${result.written} reescritas, ${result.pages} páginas), mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, `
    + `máximo ${kb(sizes.at(-1))}, total ${mb} MB`
    + `${result.apiRaces ? `; ${result.apiRaces} carreras leídas ${source?.readRaces ? 'aparte del volcado' : 'por la API'}` : ''}`
    + `${result.pending ? `; ${result.pendingRaces} carreras pendientes de relleno` : ''}`);
  console.log(`  Fuera del ámbito: ${Object.entries(result.out).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'ninguna'}`);
  for (const fallback of result.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de resultados (${scope}): ${result.generated}/${result.scope} (${(ratio * 100).toFixed(1)} %), `
    + `${result.fallbacks.length} con vuelta atrás, pendientes de relleno: ${result.pending}; datos (${origin}) ${seconds(loaded - started)}, `
    + `páginas ${seconds(result.ms)}, caché ${changed ? 'actualizada' : 'sin cambios'}, total ${seconds(performance.now() - started)}`);
  if (result.errors.length) console.log(`::error::Prerender de resultados: ${result.errors.length} páginas inválidas: ${result.errors.slice(0, 10).join(' | ')}`);
  if (ratio < MIN_RATIO) console.log(`::error::Prerender de resultados: ${result.generated} de ${result.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de resultados: ${error.message}`);
    process.exitCode = 1;
  });
}
