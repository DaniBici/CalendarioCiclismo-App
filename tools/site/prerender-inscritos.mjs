#!/usr/bin/env node
// Paso de build «Prerender de inscritos»
// (docs/informes/estudio-prerender-paginas-20261021.md, prioridad 1).
//
// Escribe en las páginas de inscritos de `_site` (/inscritos/<slug>/ y
// /en/startlist/<slugEn>/) el contenido que pinta js/inscritos.js, con el mismo
// código (js/inscritos-html.js, js/startlist/data.js y js/header-html.js)
// importado en Node con un entorno mínimo de navegador, como
// prerender-jornadas.mjs:
//
// - el interior de <main id="inscritosContent"> (EN: startlistContent), con
//   data-prerendered="<huella>": js/inscritos.js conserva el DOM si su HTML
//   tiene la misma huella (js/html-fingerprint.js);
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-inscritos.mjs <_site> [--scope off|es|all|listas] [--data datos.json] [--since AAAA-MM-DD]
//
// - Ámbito: --scope o PRERENDER_INSCRITOS (por defecto off: no hace nada); es:
//   páginas ES; all: ES y EN. Las dos, de las carreras con lista que terminan
//   (o empiezan, sin fecha de fin) desde hace WINDOW_DAYS días (UTC) o después;
//   --since fija otro primer día en local. listas: ES y EN de todas las
//   carreras con lista.
// - Datos: en CI, el volcado compartido del build (PAGES_DATA, site_data.py)
//   si algún generador lo leyó con el mismo ámbito; si no, en bloque por la API
//   pública con SUPABASE_ANON_KEY. En local, --data con el volcado de
//   prerender-inscritos.sql (scripts/db/sql.mjs --read-only).
// - La lista no depende de la zona ni de la región: un proceso por idioma (el
//   idioma se fija al cargar js/i18n.js), sin zona propia.
// - Vuelta atrás por página: sin datos, sin plantilla reconocible o con un
//   error al pintar, la página queda como la dejó gen_og_pages.py y se cuenta.
// - Falla (código 1) si genera menos del 99 % del ámbito o si una página
//   generada incumple validatePage().
import { fork } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { firstTechnicalGuide } from '../../js/services/races.js';
import { readDump, summarize } from './prerender-jornadas.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const SUPABASE_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const ORIGIN = 'https://calendariociclismo.app';
const API_PAGE = 1000;
// Peticiones simultáneas a la API, como site_data.py.
const API_WORKERS = 8;
// Identificadores por petición en los filtros `in.(…)` (longitud de la URL).
const API_IN_CHUNK = 100;
// Como INSCRITOS_WINDOW_DAYS de site_data.py.
const WINDOW_DAYS = 7;
const MIN_RATIO = 0.99;
// Una lista de ~180 corredores ocupa ~70 KB con el marcado de inscritos-html.js.
const MAX_PAGE_BYTES = 128 * 1024;

// Idiomas y si el ámbito es la ventana de WINDOW_DAYS días (si no, todas las
// carreras con lista).
const SCOPES = {
  off: { langs: [] },
  es: { langs: ['es'], window: true },
  all: { langs: ['es', 'en'], window: true },
  listas: { langs: ['es', 'en'], window: false },
};

// Directorio y slug de la página de cada carrera, como en gen_og_pages.py.
const LANGS = {
  es: { dir: 'inscritos', slug: race => race.slug },
  en: { dir: 'en/startlist', slug: race => race.slugEn },
};

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_INSCRITOS no admitido: «${scope}» (off, es, all o listas)`);
  return scope;
}

/** Primer día (AAAA-MM-DD, UTC) del ámbito: hoy menos WINDOW_DAYS. */
export function scopeSince(now = new Date()) {
  return new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
}

/** Si la carrera termina (o empieza, sin fecha de fin) en `since` o después; sin `since`, todas. */
export function inWindow(race, since) {
  if (since == null) return true;
  const end = race?.endDate || race?.startDate;
  return !!end && end >= since;
}

/**
 * Carreras con lista (equipos en startlist_counts) que entran en la ventana,
 * en el orden de `races`. Como inscritos_race_ids() de site_data.py.
 */
export function listedRaces(races, counts, since) {
  const listed = new Set(counts.filter(row => (row.teams || 0) > 0).map(row => row.raceId));
  return races.filter(race => listed.has(race.id) && inWindow(race, since));
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que js/inscritos.js y js/startlist/data.js, en bloque para
// las carreras del ámbito y con el mismo orden: desempate por id en la base de
// datos (su colación, en_US, no es la de JavaScript; aquí no se reordena) y
// agrupación por carrera conservando el orden de llegada. Las tres primeras y
// las filas de abandono son las de INSCRITOS de tools/site/site_data.py, que
// las lee en el volcado compartido; jornadas, jornada de un día y guías salen
// allí de race_days, assets y guides.
const INSCRITOS_QUERIES = {
  teams: filter => `startlist_teams?select=*,team:teams(*,team_seasons(*))&${filter}&order=sortOrder.asc,id.asc`,
  riders: filter => `startlist_riders_resolved?select=*&teamId=not.is.null&${filter}&order=dorsal.asc,id.asc`,
  stages: filter => `race_uci_stages?select=id,raceId,stageNumber,rowCount&classKind=eq.stage&${filter}&order=id.asc`,
};
const RESULTS_QUERY = filter => `race_uci_results?select=globalRiderId,irm,stageRef&globalRiderId=not.is.null&irm=not.is.null&${filter}&order=id.asc`;
const DAYS_QUERY = filter => `race_days?select=raceId,dateKey,isRestDay&editorialStatus=eq.published&${filter}&order=dateKey.asc,id.asc`;
const ONE_DAY_QUERY = filter => `race_days?select=*,assets(*)&editorialStatus=eq.published&assets.order=id.asc&${filter}&order=dateKey.asc,id.asc`;
const GUIDES_QUERY = filter => `assets?select=*,race_days!inner(raceId,dateKey)&type=eq.technicalGuide&${filter}&order=id.asc`;

/** Una página de `path`: { rows, total } (total con count=exact; si no, null). */
async function apiPage(path, key, offset, { count = false, rpc = false, fetchImpl }) {
  const headers = {
    apikey: key, Authorization: `Bearer ${key}`,
    'Range-Unit': 'items', Range: `${offset}-${offset + API_PAGE - 1}`,
    ...(count ? { Prefer: 'count=exact' } : {}),
    ...(rpc ? { 'Content-Type': 'application/json' } : {}),
  };
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/${path}`, rpc ? { method: 'POST', headers, body: '{}' } : { headers });
      if (response.ok) {
        const total = /\/(\d+)$/.exec(response.headers?.get('content-range') || '')?.[1];
        return { rows: await response.json(), total: total == null ? null : Number(total) };
      }
      const error = new Error(`API ${response.status}: ${(await response.text()).slice(0, 300)}`);
      if (response.status < 500 || attempt === 3) throw error;
    } catch (error) {
      if (attempt === 3 || /^API 4/.test(error.message)) throw error;
    }
    await new Promise(done => setTimeout(done, attempt * 1000));
  }
}

/** Ejecuta tareas asíncronas con un máximo de `size` a la vez. */
function limiter(size) {
  let active = 0;
  const waiting = [];
  return async task => {
    while (active >= size) await new Promise(done => waiting.push(done));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * Filas de cada consulta de `queries` ({ path, rpc }), como site_data.fetch():
 * la primera página pide el total y el resto se piden a la vez, con
 * API_WORKERS peticiones como máximo; sin total (RPC), página a página.
 */
export async function apiFetch(queries, key, { fetchImpl = fetch, workers = API_WORKERS } = {}) {
  const limit = limiter(workers);
  const page = (path, offset, options) => limit(() => apiPage(path, key, offset, { ...options, fetchImpl }));
  return Promise.all(queries.map(async ({ path, rpc = false }) => {
    const first = await page(path, 0, { count: !rpc, rpc });
    const pages = [first.rows];
    if (first.total != null) {
      const offsets = [];
      for (let offset = API_PAGE; offset < first.total; offset += API_PAGE) offsets.push(offset);
      for (const next of await Promise.all(offsets.map(offset => page(path, offset, {})))) pages.push(next.rows);
    } else {
      while (pages.at(-1).length === API_PAGE) pages.push((await page(path, pages.length * API_PAGE, { rpc })).rows);
    }
    const rows = pages.flat();
    if (first.total != null && rows.length !== first.total) {
      throw new Error(`API: ${rows.length} de ${first.total} filas en ${path.split('?')[0]}`);
    }
    return rows;
  }));
}

/**
 * Filtro PostgREST `column=in.(…)` con los valores entre comillas y
 * codificados, como in_filter() de site_data.py: un `#` o un `&` en un id
 * (race_uci_stages) cortaría la URL.
 */
export function inFilter(column, values) {
  const items = values.map(value => `"${String(value).replace(/["\\]/g, '\\$&')}"`).join(',');
  return `${column}=in.(${encodeURIComponent(items).replaceAll('%2C', ',')})`;
}

const chunked = values => Array.from({ length: Math.ceil(values.length / API_IN_CHUNK) },
  (_, at) => values.slice(at * API_IN_CHUNK, (at + 1) * API_IN_CHUNK));

/**
 * Etapas con filas (rowCount > 0) en tramos de hasta API_IN_CHUNK sin partir
 * una carrera: las filas de abandono de cada carrera llegan en una sola
 * consulta, ordenadas por id como en el navegador. Como
 * inscritos_stage_chunks() de site_data.py.
 */
export function stageChunks(stages) {
  const byRace = new Map();
  for (const stage of stages) {
    if ((stage.rowCount || 0) <= 0) continue;
    if (!byRace.has(stage.raceId)) byRace.set(stage.raceId, []);
    byRace.get(stage.raceId).push(stage.id);
  }
  const chunks = [];
  for (const ids of byRace.values()) {
    if (!chunks.length || chunks.at(-1).length + ids.length > API_IN_CHUNK) chunks.push([]);
    chunks.at(-1).push(...ids);
  }
  return chunks;
}

async function loadApiData(since, key, fetchImpl = fetch) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de inscritos');
  const options = { fetchImpl };
  const [allRaces, counts] = await apiFetch([{ path: 'races?select=*&order=id.asc' }, { path: 'rpc/startlist_counts', rpc: true }], key, options);
  const races = listedRaces(allRaces, counts, since);
  const ids = races.map(race => race.id);
  const oneDayIds = races.filter(race => race.raceFormat === 'one_day').map(race => race.id);
  const parts = [];
  const add = (name, column, values, query) => {
    for (const chunk of chunked(values)) parts.push({ name, path: query(inFilter(column, chunk)) });
  };
  for (const [name, query] of Object.entries(INSCRITOS_QUERIES)) add(name, 'raceId', ids, query);
  add('days', 'raceId', ids, DAYS_QUERY);
  add('oneDays', 'raceId', oneDayIds, ONE_DAY_QUERY);
  add('guides', 'race_days.raceId', ids, GUIDES_QUERY);
  const data = { races, teams: [], riders: [], days: [], stages: [], oneDays: [], guides: [] };
  (await apiFetch(parts, key, options)).forEach((rows, at) => { data[parts[at].name] = data[parts[at].name].concat(rows); });
  const results = await apiFetch(stageChunks(data.stages).map(chunk => ({ path: RESULTS_QUERY(inFilter('stageRef', chunk)) })), key, options);
  return { ...data, results: results.flat() };
}

/** Jornadas en el orden `dateKey.asc,id.asc` de PostgREST a partir del orden por id (NULL al final). */
function byDateKey(days) {
  return [...days].sort((a, b) => (a.dateKey == null) - (b.dateKey == null)
    || (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/**
 * Volcado compartido del build (tools/site/site_data.py, `PAGES_DATA`): las
 * mismas filas y el mismo orden por carrera que loadApiData(). Equipos,
 * corredores, etapas y abandonos son los de su ámbito (inscritos_*); jornadas,
 * documentos y guías se filtran de race_days, assets y guides.
 */
export function readSharedData(dir, since) {
  const read = name => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const races = listedRaces(read('races'), read('startlist_counts'), since);
  const ids = new Set(races.map(race => race.id));
  const oneDayIds = new Set(races.filter(race => race.raceFormat === 'one_day').map(race => race.id));
  const raceDays = byDateKey(read('race_days').filter(day => ids.has(day.raceId)));
  const assetsByDay = groupBy(read('assets'), 'raceDayId');
  return {
    races,
    teams: read('inscritos_teams'),
    riders: read('inscritos_riders'),
    days: raceDays.map(({ raceId, dateKey, isRestDay }) => ({ raceId, dateKey, isRestDay })),
    stages: read('inscritos_stages'),
    results: read('inscritos_results'),
    oneDays: raceDays.filter(day => oneDayIds.has(day.raceId)).map(day => ({ ...day, assets: assetsByDay.get(day.id) || [] })),
    guides: read('guides').filter(guide => ids.has(guide.race_days?.raceId)),
  };
}

/**
 * Directorio del volcado compartido si sus lecturas de inscritos cubren el
 * ámbito: todas las carreras con lista (since null) o desde un día igual o
 * anterior a `since`. Si no (volcado ausente, fallido o leído con otro
 * PRERENDER_INSCRITOS), null: los datos se leen por la API.
 */
export function sharedDataDir(dir, since) {
  const file = dir ? join(dir, 'manifest.json') : null;
  if (!file || !existsSync(file)) return null;
  const covered = JSON.parse(readFileSync(file, 'utf8')).inscritos;
  return covered && (covered.since == null || (since != null && covered.since <= since)) ? dir : null;
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

/** Índices por carrera de las carreras de la ventana desde `since` (sin `since`, todas). */
export function buildIndex(data, since) {
  const rows = name => data[name] || [];
  const stageRace = new Map(rows('stages').map(stage => [stage.id, stage.raceId]));
  const oneDayByRace = new Map();
  for (const day of rows('oneDays')) if (!oneDayByRace.has(day.raceId)) oneDayByRace.set(day.raceId, day);
  const guideByRace = new Map();
  for (const [raceId, guides] of groupBy(rows('guides'), row => row.race_days?.raceId)) {
    guideByRace.set(raceId, firstTechnicalGuide(guides));
  }
  return {
    races: new Map(rows('races').filter(race => inWindow(race, since)).map(race => [race.id, race])),
    teamsByRace: groupBy(rows('teams'), 'raceId'),
    ridersByRace: groupBy(rows('riders'), 'raceId'),
    daysByRace: groupBy(rows('days'), 'raceId'),
    stagesByRace: groupBy(rows('stages'), 'raceId'),
    resultsByRace: groupBy(rows('results'), row => stageRace.get(row.stageRef)),
    oneDayByRace,
    guideByRace,
  };
}

/**
 * Argumentos de prepareStartlistData() e inscritosHtml() para la carrera
 * `raceId`, o null si no está en el ámbito. `rows` lleva las filas de
 * loadStartlistData; la jornada de un día va sin sus documentos, aparte.
 */
export function inscritosInputs(index, raceId) {
  const race = index.races.get(raceId);
  if (!race) return null;
  const { assets: oneDayAssets = [], ...oneDayRd } = index.oneDayByRace.get(raceId) || {};
  return {
    race,
    rows: {
      raceDays: index.daysByRace.get(raceId) || [],
      teamRows: index.teamsByRace.get(raceId) || [],
      uciStages: index.stagesByRace.get(raceId) || [],
      riders: index.ridersByRace.get(raceId) || [],
      outRows: index.resultsByRace.get(raceId) || [],
    },
    oneDayRd: race.raceFormat === 'one_day' && oneDayRd.id ? oneDayRd : null,
    oneDayAssets,
    guide: index.guideByRace.get(raceId) || null,
  };
}

// ── Página ─────────────────────────────────────────────────────────────────
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const MAIN_OPEN = /<main id="(inscritosContent|startlistContent)"([^>]*)>/;
const RACE_META = /<meta name="cc:race-id" content="([^"]+)">/;
const OWN_ATTRS = /\sdata-prerendered="[^"]*"/g;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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
    + `<main id="${main[1]}"${main[2].replace(OWN_ATTRS, '')} data-prerendered="${attr(fingerprint)}">\n${html}\n`
    + source.slice(close);
}

/** Atributos de la cabecera vacía: data-back y, si los hay, data-lang y data-active. */
function headerOptions(source, lang) {
  const attrs = HEADER.exec(source)?.[1] || '';
  const value = name => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  return { lang: value('data-lang') || lang, hasBack: /\sdata-back(?=[\s=>]|$)/.test(attrs), active: value('data-active') || null };
}

const BAD_URL = /(?:^|[/?=&#])(?:undefined|null)(?:[/?#&]|$)/;

/**
 * Comprobaciones de una página generada; devuelve los errores. `navHrefs`:
 * enlaces de vistas que debe llevar la cabecera (js/header-html.js); `riders`:
 * corredores de la lista, que deben salir todos.
 */
export function validatePage(page, { riders, navHrefs }) {
  const errors = [];
  for (const [, name, value] of page.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (BAD_URL.test(value)) errors.push(`${name} con undefined o null: ${value}`);
  }
  const header = HEADER.exec(page)?.[0] || '';
  const navLinks = [...header.matchAll(/<a class="primary-nav__main[^"]*" href="([^"]*)"/g)].map(match => match[1]);
  if (navLinks.join(' ') !== navHrefs.join(' ')) {
    errors.push(`enlaces de vistas de la cabecera: ${navLinks.join(' ') || 'ninguno'} (esperados ${navHrefs.join(' ')})`);
  }
  const painted = page.match(/<div class="startlist-rider[ "]/g)?.length || 0;
  if (painted !== riders) errors.push(`${painted} corredores pintados de ${riders}`);
  const bytes = Buffer.byteLength(page);
  if (bytes >= MAX_PAGE_BYTES) errors.push(`${bytes} bytes (máximo ${MAX_PAGE_BYTES})`);
  return errors;
}

/**
 * Resultado de una página: { status: 'out' } fuera del ámbito o sin carrera;
 * { status: 'fallback', reason } si queda como está; { status: 'ok', page,
 * errors } si se generó. `render(input, header)` devuelve { html,
 * headerInner, riders }.
 */
export function prerenderPage(source, { lang, scope, index, render, navHrefs, fingerprint }) {
  const raceId = RACE_META.exec(source)?.[1];
  if (!raceId || !SCOPES[scope].langs.includes(lang)) return { status: 'out' };
  const input = inscritosInputs(index, raceId);
  if (!input) return { status: 'out' };
  let rendered;
  try {
    rendered = render(input, headerOptions(source, lang));
  } catch (error) {
    return { status: 'fallback', reason: `error: ${error.message}` };
  }
  if (!rendered) return { status: 'fallback', reason: 'sin equipos' };
  const page = composePage(source, { ...rendered, fingerprint: fingerprint(rendered.html) });
  if (!page) return { status: 'fallback', reason: 'plantilla' };
  return { status: 'ok', page, errors: validatePage(page, { riders: rendered.riders, navHrefs }) };
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
function defineGlobals(values) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

// Entorno mínimo para importar los módulos públicos: mismos CONFIG y dominio
// EN que el js/config.js de CI; sin red (solo el diccionario EN local). Copia
// del de prerender-jornadas.mjs con la ruta de la página de inscritos.
function installBrowserEnv(lang) {
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
    location: new URL(`${ORIGIN}/${LANGS[lang].dir}/`),
    document: {
      documentElement: { ...element(), lang }, head: element(), body: element(), createElement: element,
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
    fetch: async url => {
      const path = String(url).split('?')[0];
      if (path !== '/i18n/en.json') throw new Error(`Petición no permitida en el prerender: ${url}`);
      return { ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) };
    },
  });
  defineGlobals({ window: globalThis });
}

/**
 * Páginas de las carreras del ámbito: solo esas, sin recorrer las ~1.600 del
 * idioma. La página se identifica después por su cc:race-id.
 */
function pageFiles(site, lang, races) {
  const { dir, slug } = LANGS[lang];
  return [...races.values()].map(slug).filter(Boolean)
    .map(name => join(site, dir, name, 'index.html'))
    .filter(file => existsSync(file))
    .sort();
}

async function runLanguage(lang, site, scope, since, data) {
  const started = performance.now();
  // Módulos que leen el entorno al cargarse (idioma, cliente de datos):
  // después de installBrowserEnv.
  installBrowserEnv(lang);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { withRaceTechnicalGuide } = await load('js/shared.js');
  const { prepareStartlistData } = await load('js/startlist/data.js');
  const { inscritosHtml } = await load('js/inscritos-html.js');
  await initI18n();
  const imported = performance.now();
  const index = buildIndex(data, since);
  const render = (input, header) => {
    const prepared = prepareStartlistData(input.race, input.rows);
    if (!prepared) return null;
    return {
      html: inscritosHtml(input.race, prepared, {
        oneDayRd: input.oneDayRd, assets: withRaceTechnicalGuide(input.oneDayAssets, input.guide),
      }),
      headerInner: headerHtml(header),
      riders: prepared.totalRiders,
    };
  };
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  const result = { lang, pages: 0, scope: 0, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  for (const file of pageFiles(site, lang, index.races)) {
    result.pages++;
    const source = readFileSync(file, 'utf8');
    const name = relative(site, file);
    const outcome = prerenderPage(source, { lang, scope, index, render, navHrefs, fingerprint: htmlFingerprint });
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
  result.importMs = Math.round(imported - started);
  result.renderMs = Math.round(performance.now() - imported);
  return result;
}

function forkLanguage(lang, site, scope, since, data) {
  return new Promise((done, fail) => {
    const child = fork(SCRIPT, ['--worker', lang, site, '--scope', scope, ...(since ? ['--since', since] : [])], { serialization: 'advanced' });
    let result = null;
    child.on('message', message => { result = message; });
    child.on('error', fail);
    child.on('exit', code => (code === 0 && result ? done(result) : fail(new Error(`El proceso ${lang} terminó con código ${code}`))));
    child.send(data);
  });
}

// ── Línea de órdenes ───────────────────────────────────────────────────────
// Opciones con valor (--worker <idioma>, --scope, --data, --since) y la ruta del sitio.
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
  if (options.worker) {
    process.once('message', async data => {
      const result = await runLanguage(options.worker, site, parseScope(options.scope), options.since ?? null, data);
      process.send(result, () => process.exit(0));
    });
    return 0;
  }
  if (!site) throw new Error('Uso: prerender-inscritos.mjs <_site> [--scope off|es|all|listas] [--data datos.json] [--since AAAA-MM-DD]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_INSCRITOS);
  if (scope === 'off') {
    console.log('Prerender de inscritos desactivado (PRERENDER_INSCRITOS=off)');
    return 0;
  }
  if (options.since && !SCOPES[scope].window) throw new Error(`--since no se aplica al ámbito ${scope}`);
  const since = SCOPES[scope].window ? options.since || scopeSince() : null;
  if (since != null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since no admitido: «${since}» (AAAA-MM-DD)`);
  const started = performance.now();
  const shared = options.data ? null : sharedDataDir(process.env.PAGES_DATA, since);
  const data = options.data ? readDump(options.data)
    : shared ? readSharedData(shared, since) : await loadApiData(since, process.env.SUPABASE_ANON_KEY);
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), scope, since, data)));
  const total = summarize(results);
  for (const result of results) {
    const sizes = result.bytes.sort((a, b) => a - b);
    const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
    const mb = (sizes.reduce((sum, bytes) => sum + bytes, 0) / 1048576).toFixed(1);
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.written} reescritas, ${result.pages} páginas), `
      + `importación ${seconds(result.importMs)}, pintado ${seconds(result.renderMs)}, `
      + `mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, máximo ${kb(sizes.at(-1))}, total ${mb} MB`);
  }
  for (const fallback of total.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de inscritos (${scope}, ${since ? `desde ${since}` : 'todas las carreras con lista'}): `
    + `${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), ${total.fallbacks.length} con vuelta atrás; `
    + `datos${shared ? ' (volcado compartido)' : ''} ${seconds(loaded - started)}, total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de inscritos: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < MIN_RATIO) console.log(`::error::Prerender de inscritos: ${total.generated} de ${total.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de inscritos: ${error.message}`);
    process.exitCode = 1;
  });
}
