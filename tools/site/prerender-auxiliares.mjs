#!/usr/bin/env node
// Paso de build «Prerender de perfiles, mapas y órdenes de salida»
// (docs/plans/contenido-generado-build.md, fase 3).
//
// Escribe en las páginas ES de `_site` /perfil/<slug>/, /mapa/<slug>/ y
// /orden-salida/<slug>/ el contenido que pintan js/perfil-pub.js,
// js/mapa-pub.js y js/orden-salida.js, con el mismo código
// (js/perfil-mapa-html.js, js/orden-salida-html.js y js/header-html.js)
// importado en Node con el entorno mínimo de navegador y el núcleo de página
// de prerender-jornadas.mjs:
//
// - el interior del <main> de cada tipo, con data-prerendered="<huella>": la
//   página conserva el DOM si su HTML tiene la misma huella
//   (js/html-fingerprint.js) y solo monta lo interactivo (perfil, mapa,
//   filtros del orden de salida);
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-auxiliares.mjs <_site> [--scope off|es|<tipos>] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_AUXILIARES (por defecto off: no hace nada); es:
//   perfil, mapa y orden de salida; o una lista de tipos separados por comas
//   (perfil, mapa, orden). Solo páginas ES: las EN llevan horas y repintan en
//   cualquier zona distinta de la del build.
// - Datos: del volcado compartido del build (PAGES_DATA, site_data.py) si
//   algún generador lo leyó: jornadas, carreras, documentos y guías y, si su
//   manifiesto las incluye, las filas del orden de salida y los equipos de la
//   lista (ORDEN de site_data.py). Lo que falte, por la API pública con
//   SUPABASE_ANON_KEY y las mismas consultas. En local, --data con el volcado
//   de prerender-auxiliares.sql.
// - Un proceso con TZ=Europe/Madrid: horas de Madrid, como un visitante
//   peninsular (las páginas usan la zona del visitante).
// - Vuelta atrás por página: sin datos, sin plantilla reconocible o con un
//   error al pintar, la página queda como la dejó gen_og_pages.py y se cuenta.
// - Falla (código 1) si genera menos del 99 % de las páginas de algún tipo o
//   si una página generada incumple validatePage().
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { MAPA_DAY_COLUMNS, MAPA_SIBLING_COLUMNS, PERFIL_DAY_COLUMNS, PERFIL_SIBLING_COLUMNS, STAGE_PAGE_RACE_COLUMNS,
  firstTechnicalGuide, sortStagePageSiblings } from '../../js/services/races.js';
import { TEAM_COLUMNS, TEAM_SEASON_COLUMNS } from '../../js/team-appearance.js';
import { composePage, groupBy, headerOptions, installBrowserEnv, pageDayId, pageErrors, pageFiles, readDump,
  scheduleErrors } from './prerender-jornadas.mjs';
import { apiFetch, inFilter } from './prerender-inscritos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const TIME_ZONE = 'Europe/Madrid';
const MIN_RATIO = 0.99;
const API_IN_CHUNK = 100;

// Por tipo: directorio de las páginas ES, contenedor y tamaño máximo sin
// comprimir (2026-10-22: perfil, máximo de 26 KB; mapa, 22 KB; orden de
// salida, 98 KB con 184 corredores).
export const TYPES = {
  perfil: { dir: 'perfil', container: 'perfilEtapaContent', maxBytes: 64 * 1024 },
  mapa: { dir: 'mapa', container: 'mapaEtapaContent', maxBytes: 64 * 1024 },
  orden: { dir: 'orden-salida', container: 'startOrderContent', maxBytes: 128 * 1024 },
};

/** Tipos del ámbito, en el orden de TYPES: [] con off. Como auxiliares_types() de site_data.py. */
export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (scope === 'off') return [];
  if (scope === 'es') return Object.keys(TYPES);
  const types = scope.split(',').map(type => type.trim()).filter(Boolean);
  if (!types.length || types.some(type => !Object.hasOwn(TYPES, type))) {
    throw new Error(`PRERENDER_AUXILIARES no admitido: «${scope}» (off, es o tipos separados por comas: perfil, mapa, orden)`);
  }
  return Object.keys(TYPES).filter(type => types.includes(type));
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que las páginas, en bloque y con el mismo orden: desempate
// por id en la base de datos (su colación, en_US, no es la de JavaScript; aquí
// no se reordena) y agrupación conservando el orden de llegada. Las del orden
// de salida son las de ORDEN en tools/site/site_data.py.
const BASE_QUERIES = {
  days: 'race_days?select=*&editorialStatus=eq.published&order=id.asc',
  races: 'races?select=*&order=id.asc',
  assets: 'assets?select=*&order=id.asc',
  guides: 'assets?select=*,race_days!inner(raceId,dateKey)&type=eq.technicalGuide&order=id.asc',
};
const ORDEN_ENTRIES = filter => `start_order_entries_resolved?select=*&${filter}&order=sortOrder.asc,id.asc`;
const ORDEN_TEAMS = (filter, year) => (year == null
  ? `startlist_teams?select=raceId,teamId,team:teams(${TEAM_COLUMNS})&${filter}&order=id.asc`
  : `startlist_teams?select=raceId,teamId,team:teams(${TEAM_COLUMNS},team_seasons(${TEAM_SEASON_COLUMNS}))&${filter}&team.team_seasons.year=eq.${year}&order=id.asc`);

const chunked = values => Array.from({ length: Math.ceil(values.length / API_IN_CHUNK) },
  (_, at) => values.slice(at * API_IN_CHUNK, (at + 1) * API_IN_CHUNK));

/**
 * Jornadas con orden de salida importado, en el orden de `days`, y sus
 * carreras por año (Map año → carreras, en orden de aparición). Como
 * orden_scope() de site_data.py.
 */
export function ordenScope(days, races) {
  const years = new Map(races.map(race => [race.id, race.year ?? null]));
  const dayIds = [];
  const byYear = new Map();
  const seen = new Set();
  for (const day of days) {
    if (!day.startOrderImportedAt) continue;
    dayIds.push(day.id);
    if (!day.raceId || seen.has(day.raceId)) continue;
    seen.add(day.raceId);
    const year = years.get(day.raceId) ?? null;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(day.raceId);
  }
  return { dayIds, byYear };
}

/** Filas del orden de salida y equipos de la lista por la API, con las consultas de site_data.py. */
async function loadApiOrden({ days, races }, key) {
  const { dayIds, byYear } = ordenScope(days, races);
  const years = [...byYear.keys()].sort((a, b) => (a == null) - (b == null) || (a ?? 0) - (b ?? 0));
  const parts = [
    ...chunked(dayIds).map(chunk => ({ name: 'entries', path: ORDEN_ENTRIES(inFilter('raceDayId', chunk)) })),
    ...years.flatMap(year => chunked(byYear.get(year)).map(chunk => ({ name: 'teams', path: ORDEN_TEAMS(inFilter('raceId', chunk), year) }))),
  ];
  const data = { entries: [], teams: [] };
  (await apiFetch(parts, key)).forEach((rows, at) => { data[parts[at].name] = data[parts[at].name].concat(rows); });
  return data;
}

/**
 * Datos de los tipos `types`: del volcado compartido si existe (el orden de
 * salida, si su manifiesto lo cubre) y, lo que falte, por la API. `origin`
 * resume la procedencia para el log.
 */
async function loadData(types, { file, shared, key }) {
  if (file) return { data: readDump(file), origin: 'volcado local' };
  const needsOrden = types.includes('orden');
  let base;
  let orden = null;
  let origin;
  if (shared) {
    const read = name => JSON.parse(readFileSync(join(shared, `${name}.json`), 'utf8'));
    base = { days: read('race_days'), races: read('races'), assets: read('assets'), guides: read('guides') };
    const covered = JSON.parse(readFileSync(join(shared, 'manifest.json'), 'utf8')).auxiliares?.orden;
    if (needsOrden && covered) orden = { entries: read('orden_entries'), teams: read('orden_teams') };
    origin = needsOrden && !covered ? 'volcado compartido; orden de salida por la API' : 'volcado compartido';
  } else {
    if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de perfiles, mapas y órdenes de salida');
    const entries = Object.entries(BASE_QUERIES);
    const rows = await apiFetch(entries.map(([, path]) => ({ path })), key);
    base = Object.fromEntries(entries.map(([name], at) => [name, rows[at]]));
    origin = 'API';
  }
  if (needsOrden && !orden) {
    if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer el orden de salida');
    orden = await loadApiOrden(base, key);
  }
  return { data: { ...base, ...(orden ? { orden_entries: orden.entries, orden_teams: orden.teams } : {}) }, origin };
}

function sharedDataDir() {
  const dir = process.env.PAGES_DATA;
  return dir && existsSync(join(dir, 'manifest.json')) ? dir : null;
}

const pick = (row, columns) => Object.fromEntries(columns.split(',').map(column => [column, row[column] ?? null]));

/** Índices por jornada y carrera de los datos (volcado o API). */
export function buildIndex(data) {
  const rows = name => data[name] || [];
  const guideByRace = new Map();
  for (const [raceId, guides] of groupBy(rows('guides'), row => row.race_days?.raceId)) {
    guideByRace.set(raceId, firstTechnicalGuide(guides));
  }
  return {
    days: new Map(rows('days').map(day => [day.id, day])),
    races: new Map(rows('races').map(race => [race.id, race])),
    daysByRace: groupBy(rows('days'), 'raceId'),
    assetsByDay: groupBy(rows('assets'), 'raceDayId'),
    guideByRace,
    entriesByDay: groupBy(rows('orden_entries'), 'raceDayId'),
    teamsByRace: groupBy(rows('orden_teams'), 'raceId'),
  };
}

/**
 * Argumentos del HTML de la página `type` de la jornada `dayId`, o
 * { reason } si la página queda como está. La jornada y la carrera llevan las
 * columnas que lee la página; los documentos van sin la guía técnica
 * (`guide`), que añade withRaceTechnicalGuide. `notice`: la página muestra el
 * aviso que pinta el navegador en ese caso (perfil no visible, jornada sin
 * mapa o sin filas de orden de salida).
 */
export function pageInputs(type, index, dayId) {
  const row = index.days.get(dayId);
  if (!row) return { reason: 'sin datos' };
  const raceRow = row.raceId ? index.races.get(row.raceId) ?? null : null;
  const guide = raceRow ? index.guideByRace.get(raceRow.id) || null : null;
  const assets = index.assetsByDay.get(dayId) || [];
  if (type === 'orden') {
    const entries = index.entriesByDay.get(dayId) || [];
    if (!entries.length) return { rd: row, notice: 'orden' };
    return { rd: row, race: raceRow, entries, startlistRows: index.teamsByRace.get(row.raceId) || [], assets, guide };
  }
  const perfil = type === 'perfil';
  const rd = pick(row, perfil ? PERFIL_DAY_COLUMNS : MAPA_DAY_COLUMNS);
  if (perfil && rd.profileNotViewable) return { rd, notice: 'profile.notAvailable' };
  if (!perfil && !rd.routeGpxUrl) return { rd, notice: 'map.notAvailable' };
  const race = raceRow ? pick(raceRow, STAGE_PAGE_RACE_COLUMNS) : null;
  const siblings = rd.raceId && race?.raceFormat !== 'one_day'
    ? sortStagePageSiblings((index.daysByRace.get(rd.raceId) || []).map(day => pick(day, perfil ? PERFIL_SIBLING_COLUMNS : MAPA_SIBLING_COLUMNS)))
    : [];
  return { rd, race, siblings, assets, guide };
}

// ── Página ─────────────────────────────────────────────────────────────────
/**
 * Comprobaciones de una página generada; devuelve los errores. Comunes
 * (pageErrors: enlaces, cabecera con `navHrefs` y tamaño del tipo) y, salvo
 * en una página con aviso (`notice`), por tipo: horario con <time datetime>
 * en perfil y mapa, contenedor del mapa y tantas filas como entradas tiene el
 * orden de salida (`rows`).
 */
export function validatePage(page, { type, rd, rows, navHrefs, notice = false }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: TYPES[type].maxBytes });
  if (notice) return errors;
  if (type !== 'orden') errors.push(...scheduleErrors(page, rd));
  if (type === 'mapa' && !page.includes('<div class="cc-map-wrap" id="ccRouteMapWrap"></div>')) errors.push('sin contenedor del mapa');
  if (type === 'orden') {
    const painted = page.match(/<tr class="so-row"/g)?.length || 0;
    if (painted !== rows) errors.push(`${painted} filas pintadas de ${rows}`);
  }
  return errors;
}

/**
 * Resultado de una página: { status: 'out' } sin jornada; { status:
 * 'fallback', reason } si queda como está; { status: 'ok', page, errors } si
 * se generó. `render(type, input, header)` devuelve { html, headerInner, rows }.
 */
export function prerenderPage(source, { type, index, render, navHrefs, fingerprint }) {
  const dayId = pageDayId(source);
  if (!dayId) return { status: 'out' };
  const input = pageInputs(type, index, dayId);
  if (input.reason) return { status: 'fallback', reason: input.reason };
  let rendered;
  try {
    rendered = render(type, input, headerOptions(source, 'es'));
  } catch (error) {
    return { status: 'fallback', reason: `error: ${error.message}` };
  }
  const page = composePage(source, { ...rendered, container: TYPES[type].container, fingerprint: fingerprint(rendered.html) });
  if (!page) return { status: 'fallback', reason: 'plantilla' };
  return { status: 'ok', page, errors: validatePage(page, { type, rd: input.rd, rows: rendered.rows, navHrefs, notice: !!input.notice }) };
}

/** Resumen por tipo; `ok` false si algún tipo no llega al 99 % o hay páginas inválidas. */
export function summarize(results) {
  const failing = results.filter(result => (result.scope ? result.generated / result.scope : 1) < MIN_RATIO);
  return { failing, ok: !failing.length && !results.some(result => result.errors.length) };
}

async function run(site, types, data) {
  const started = performance.now();
  // Módulos que leen el entorno al cargarse (idioma, cliente de datos):
  // después de installBrowserEnv. Los importados arriba no lo leen.
  installBrowserEnv('es', TYPES[types[0]].dir);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { withRaceTechnicalGuide } = await load('js/shared.js');
  const { perfilHtml, mapaHtml, stagePageNoticeHtml } = await load('js/perfil-mapa-html.js');
  const { ordenSalidaEmptyHtml, ordenSalidaHtml } = await load('js/orden-salida-html.js');
  await initI18n();
  const imported = performance.now();
  const index = buildIndex(data);
  const render = (type, input, header) => {
    const assets = input.notice ? null : withRaceTechnicalGuide(input.assets, input.guide);
    const html = input.notice ? (type === 'orden' ? ordenSalidaEmptyHtml() : stagePageNoticeHtml(input.notice))
      : type === 'perfil' ? perfilHtml({ ...input, assets })
      : type === 'mapa' ? mapaHtml({ ...input, assets })
        : ordenSalidaHtml({ ...input, assets, userTz: TIME_ZONE }).html;
    return { html, headerInner: headerHtml(header), rows: input.entries?.length };
  };
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS.es[key].href);
  const results = [];
  for (const type of types) {
    const result = { type, pages: 0, scope: 0, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
    const typeStarted = performance.now();
    for (const file of pageFiles(site, TYPES[type].dir)) {
      result.pages++;
      const source = readFileSync(file, 'utf8');
      const name = relative(site, file);
      const outcome = prerenderPage(source, { type, index, render, navHrefs, fingerprint: htmlFingerprint });
      if (outcome.status === 'out') continue;
      result.scope++;
      if (outcome.status === 'fallback') {
        result.fallbacks.push(`${name}: ${outcome.reason}`);
        continue;
      }
      result.generated++;
      result.bytes.push(Buffer.byteLength(outcome.page));
      result.errors.push(...outcome.errors.map(error => `${name}: ${error}`));
      if (outcome.page !== source) {
        writeFileSync(file, outcome.page);
        result.written++;
      }
    }
    result.ms = performance.now() - typeStarted;
    results.push(result);
  }
  return { results, importMs: imported - started };
}

// ── Línea de órdenes ───────────────────────────────────────────────────────
// Opciones con valor (--scope, --data) y la ruta del sitio.
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
  if (!site) throw new Error('Uso: prerender-auxiliares.mjs <_site> [--scope off|es|perfil,mapa,orden] [--data datos.json]');
  const types = parseScope(options.scope ?? process.env.PRERENDER_AUXILIARES);
  if (!types.length) {
    console.log('Prerender de perfiles, mapas y órdenes de salida desactivado (PRERENDER_AUXILIARES=off)');
    return 0;
  }
  // Horas de Madrid en todo el proceso: se relanza con la zona si hace falta.
  if (process.env.TZ !== TIME_ZONE) {
    const child = spawnSync(process.execPath, [...process.execArgv, SCRIPT, ...argv], { stdio: 'inherit', env: { ...process.env, TZ: TIME_ZONE } });
    return child.status ?? 1;
  }
  const started = performance.now();
  const shared = options.data ? null : sharedDataDir();
  const { data, origin } = await loadData(types, { file: options.data, shared, key: process.env.SUPABASE_ANON_KEY });
  const loaded = performance.now();
  const { results, importMs } = await run(resolve(site), types, data);
  const total = summarize(results);
  const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
  for (const result of results) {
    const sizes = result.bytes.sort((a, b) => a - b);
    const mb = (sizes.reduce((sum, bytes) => sum + bytes, 0) / 1048576).toFixed(1);
    console.log(`  ${result.type}: ${result.generated}/${result.scope} generadas (${result.written} reescritas, ${result.pages} páginas), `
      + `pintado ${seconds(result.ms)}, mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, máximo ${kb(sizes.at(-1))}, total ${mb} MB`);
    for (const fallback of result.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  }
  const generated = results.reduce((sum, result) => sum + result.generated, 0);
  const scope = results.reduce((sum, result) => sum + result.scope, 0);
  console.log(`Prerender de perfiles, mapas y órdenes de salida (${types.join(', ')}): ${generated}/${scope}, `
    + `${scope - generated} con vuelta atrás; datos (${origin}) ${seconds(loaded - started)}, `
    + `importación ${seconds(importMs)}, total ${seconds(performance.now() - started)}`);
  const errors = results.flatMap(result => result.errors);
  if (errors.length) console.log(`::error::Prerender de perfiles, mapas y órdenes de salida: ${errors.length} páginas inválidas: ${errors.slice(0, 10).join(' | ')}`);
  for (const result of total.failing) {
    console.log(`::error::Prerender de ${result.type}: ${result.generated} de ${result.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  }
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de perfiles, mapas y órdenes de salida: ${error.message}`);
    process.exitCode = 1;
  });
}
