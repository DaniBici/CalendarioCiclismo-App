#!/usr/bin/env node
// Paso de build «Prerender de jornadas» (docs/plans/fase-3-jornadas-estaticas.md).
//
// Escribe en las páginas de jornada de `_site` (/jornada/<slug>/ y
// /en/stage/<slug>/) el contenido que pinta js/jornada.js, con el mismo código
// (js/jornada-html.js y js/header-html.js) importado en Node con un entorno
// mínimo de navegador:
//
// - el interior de <main id="jornadaContent">, con data-prerendered="<huella>"
//   y --card-color: js/jornada.js conserva el DOM si su HTML tiene la misma
//   huella (js/html-fingerprint.js);
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-jornadas.mjs <_site> [--scope off|2027|es|all] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_JORNADAS (por defecto off: no hace nada).
//   2027: jornadas con dateKey de 2027, ES y EN; es: todas las ES; all: ES y EN.
// - Datos: en CI, el volcado compartido del build (PAGES_DATA, site_data.py)
//   si algún generador lo leyó; si no, en bloque por la API pública con
//   SUPABASE_ANON_KEY. En local, --data con el volcado de
//   prerender-jornadas.sql (scripts/db/sql.mjs --read-only).
// - Cada idioma se pinta en un proceso con su zona horaria: ES en
//   Europe/Madrid (horas y emisiones de España, como un visitante peninsular);
//   EN en Etc/GMT (horas en GMT con la etiqueta escrita y solo las emisiones
//   globales visibles; el resto, tras «Todas»).
// - Vuelta atrás por página: sin datos, sin plantilla reconocible o con un
//   error al pintar, la página queda como la dejó gen_og_pages.py y se cuenta.
// - Falla (código 1) si genera menos del 99 % del ámbito o si una página
//   generada incumple validatePage().
import { fork } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { STAGE_SIBLING_COLUMNS, buildInhouseResultsMatcher, firstTechnicalGuide, stageSiblings } from '../../js/services/races.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const SUPABASE_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const ORIGIN = 'https://calendariociclismo.app';
const API_PAGE = 1000;
const MIN_RATIO = 0.99;
const MAX_PAGE_BYTES = 64 * 1024;

const SCOPES = {
  off: { langs: [] },
  2027: { langs: ['es', 'en'], year: '2027' },
  es: { langs: ['es'] },
  all: { langs: ['es', 'en'] },
};

const LANGS = {
  es: { dir: 'jornada', timeZone: 'Europe/Madrid', timeZoneLabel: null },
  en: { dir: 'en/stage', timeZone: 'Etc/GMT', timeZoneLabel: 'GMT' },
};

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_JORNADAS no admitido: «${scope}» (off, 2027, es o all)`);
  return scope;
}

/** Si la jornada `day` ({ dateKey }) de la página en `lang` entra en el ámbito. */
export function inScope(scope, lang, day) {
  const { langs, year } = SCOPES[scope];
  if (!langs.includes(lang)) return false;
  return !year || String(day?.dateKey || '').startsWith(`${year}-`);
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que js/jornada.js, en bloque: la jornada con su carrera,
// emisiones, documentos, guía técnica de la competición, etapas hermanas y
// clasificaciones propias. Las filas llegan ordenadas por id en la base de
// datos, como las que pide el navegador; la colación de `id` (en_US) no es la
// de JavaScript, así que el orden de llegada no se rehace aquí.
function apiQueries(scope) {
  const year = SCOPES[scope].year;
  const days = 'race_days?select=*&editorialStatus=eq.published'
    + (year ? `&dateKey=gte.${year}-01-01&dateKey=lte.${year}-12-31` : '');
  return {
    days,
    siblings: `race_days?select=${STAGE_SIBLING_COLUMNS}&editorialStatus=eq.published`,
    races: 'races?select=*',
    broadcasts: 'broadcasts?select=*',
    assets: 'assets?select=*',
    guides: 'assets?select=*,race_days!inner(raceId,dateKey)&type=eq.technicalGuide',
    uci: 'race_uci_stages?select=raceId,raceDayId,stageNumber&keepForWeb=eq.true&rowCount=gt.0',
  };
}

async function apiRequest(url, key, offset, fetchImpl) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Range-Unit': 'items', Range: `${offset}-${offset + API_PAGE - 1}`,
      } });
      if (response.ok) return await response.json();
      const error = new Error(`API ${response.status}: ${(await response.text()).slice(0, 300)}`);
      if (response.status < 500 || attempt === 3) throw error;
    } catch (error) {
      if (attempt === 3 || /^API 4/.test(error.message)) throw error;
    }
    await new Promise(done => setTimeout(done, attempt * 1000));
  }
}

/** Filas de `path` paginadas de 1.000 en 1.000 (una página corta es el final). */
export async function apiRows(path, key, fetchImpl = fetch) {
  const url = `${SUPABASE_URL}/rest/v1/${path}&order=id.asc`;
  const rows = [];
  for (let offset = 0; ; offset += API_PAGE) {
    const page = await apiRequest(url, key, offset, fetchImpl);
    rows.push(...page);
    if (page.length < API_PAGE) return rows;
  }
}

async function loadApiData(scope, key, fetchImpl = fetch) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de las jornadas');
  const entries = Object.entries(apiQueries(scope));
  const results = await Promise.all(entries.map(([, path]) => apiRows(path, key, fetchImpl)));
  return Object.fromEntries(entries.map(([name], at) => [name, results[at]]));
}

/** Volcado de prerender-jornadas.sql: la fila única de sql.mjs. */
export function readDump(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

/**
 * Volcado compartido del build (tools/site/site_data.py, `PAGES_DATA`): las
 * mismas filas y el mismo orden por id que las lecturas de apiQueries(). Las
 * jornadas son todas las publicadas; el ámbito por año lo aplica inScope().
 */
export function readSharedData(dir) {
  const read = name => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const uci = read('race_uci_stages')
    .filter(row => row.keepForWeb === true && row.rowCount > 0)
    .map(({ raceId, raceDayId, stageNumber }) => ({ raceId, raceDayId, stageNumber }));
  return { days: read('race_days'), races: read('races'), broadcasts: read('broadcasts'),
    assets: read('assets'), guides: read('guides'), uci };
}

function sharedDataDir() {
  const dir = process.env.PAGES_DATA;
  return dir && existsSync(join(dir, 'manifest.json')) ? dir : null;
}

const sortOrderOf = row => (row.sortOrder ?? Infinity);

export function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key];
    if (value == null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

function pick(row, columns) {
  return Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
}

/**
 * Índices por jornada y carrera. `data.siblings` (columnas de
 * STAGE_SIBLING_COLUMNS de todas las jornadas publicadas) falta en el volcado
 * local, cuyo `days` ya incluye todas las publicadas.
 */
export function buildIndex(data) {
  const rows = name => data[name] || [];
  const columns = STAGE_SIBLING_COLUMNS.split(',');
  const published = (data.siblings || rows('days')).map(row => pick(row, columns));
  // Orden estable: con el mismo sortOrder, el de llegada (id), como en el navegador.
  const broadcasts = [...rows('broadcasts')].sort((a, b) =>
    sortOrderOf(a) === sortOrderOf(b) ? 0 : sortOrderOf(a) < sortOrderOf(b) ? -1 : 1);
  const publishedByRace = groupBy(published, 'raceId');
  const siblingsByRace = new Map();
  const guideByRace = new Map();
  for (const [raceId, guides] of groupBy(rows('guides'), row => row.race_days?.raceId)) {
    guideByRace.set(raceId, firstTechnicalGuide(guides));
  }
  return {
    days: new Map(rows('days').map(day => [day.id, day])),
    published: new Map(published.map(day => [day.id, day])),
    races: new Map(rows('races').map(race => [race.id, race])),
    broadcastsByDay: groupBy(broadcasts, 'raceDayId'),
    assetsByDay: groupBy(rows('assets'), 'raceDayId'),
    uciByRace: groupBy(rows('uci'), 'raceId'),
    guideByRace,
    // Copias por carrera: stageSiblings marca los dobles sectores en ellas.
    siblingsOf(raceId) {
      if (!siblingsByRace.has(raceId)) {
        siblingsByRace.set(raceId, stageSiblings((publishedByRace.get(raceId) || []).map(day => ({ ...day }))));
      }
      return siblingsByRace.get(raceId);
    },
  };
}

/** Argumentos de jornadaHtml() para la jornada `dayId`, o null si faltan datos. */
export function jornadaInputs(index, dayId) {
  const day = index.days.get(dayId);
  const race = day?.raceId ? index.races.get(day.raceId) : null;
  if (!day || !race) return null;
  const rd = { ...day };
  const siblings = race.raceFormat !== 'one_day' ? index.siblingsOf(race.id) : [];
  const match = siblings.find(sibling => sibling.id === rd.id);
  if (match?._stageSuffix) rd._stageSuffix = match._stageSuffix;
  return {
    rd, race, siblings,
    broadcasts: index.broadcastsByDay.get(dayId) || [],
    assets: index.assetsByDay.get(dayId) || [],
    guide: index.guideByRace.get(race.id) || null,
    uci: index.uciByRace.get(race.id) || [],
    hasStartlist: !!race.startlistImportedAt,
  };
}

// ── Página ─────────────────────────────────────────────────────────────────
// Núcleo común con prerender-auxiliares.mjs: composición de la cabecera y del
// <main>, opciones de la cabecera y comprobaciones de toda página generada.
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const DAY_META = /<meta name="cc:race-day-id" content="([^"]+)">/;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Id de la jornada de la página (`cc:race-day-id`), o null. */
export function pageDayId(source) {
  return DAY_META.exec(source)?.[1] || null;
}

/**
 * Página con la cabecera y el interior de <main id="`container`"> generados,
 * o null si la plantilla no tiene la cabecera y el <main> esperados. El <main>
 * lleva data-prerendered con la huella y, con `style`, ese estilo en línea en
 * lugar del suyo. Sustituye también lo que escribió una pasada anterior.
 */
export function composePage(source, { container, headerInner, html, fingerprint, style = null }) {
  const header = HEADER.exec(source);
  const main = new RegExp(`<main id="${container}"([^>]*)>`).exec(source);
  if (!header || !main || header.index > main.index) return null;
  const mainEnd = main.index + main[0].length;
  const close = source.indexOf('</main>', mainEnd);
  if (close < 0) return null;
  const mainAttrs = main[1].replace(style == null ? /\sdata-prerendered="[^"]*"/g : /\s(?:data-prerendered|style)="[^"]*"/g, '');
  return source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, main.index)
    + `<main id="${container}"${mainAttrs} data-prerendered="${attr(fingerprint)}"${style == null ? '' : ` style="${attr(style)}"`}>\n${html}\n`
    + source.slice(close);
}

/** Atributos de la cabecera vacía: data-back y, si los hay, data-lang y data-active. */
export function headerOptions(source, lang) {
  const attrs = HEADER.exec(source)?.[1] || '';
  const value = name => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  return { lang: value('data-lang') || lang, hasBack: /\sdata-back(?=[\s=>]|$)/.test(attrs), active: value('data-active') || null };
}

const BAD_URL = /(?:^|[/?=&#])(?:undefined|null)(?:[/?#&]|$)/;

/**
 * Comprobaciones comunes de una página generada; devuelve los errores: ningún
 * href ni src con undefined o null, la cabecera con los enlaces de vistas
 * `navHrefs` (js/header-html.js) y menos de `maxBytes` sin comprimir.
 */
export function pageErrors(page, { navHrefs, maxBytes }) {
  const errors = [];
  for (const [, name, value] of page.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (BAD_URL.test(value)) errors.push(`${name} con undefined o null: ${value}`);
  }
  const header = HEADER.exec(page)?.[0] || '';
  const navLinks = [...header.matchAll(/<a class="primary-nav__main[^"]*" href="([^"]*)"/g)].map(match => match[1]);
  if (navLinks.join(' ') !== navHrefs.join(' ')) {
    errors.push(`enlaces de vistas de la cabecera: ${navLinks.join(' ') || 'ninguno'} (esperados ${navHrefs.join(' ')})`);
  }
  const bytes = Buffer.byteLength(page);
  if (bytes >= maxBytes) errors.push(`${bytes} bytes (máximo ${maxBytes})`);
  return errors;
}

/** Jornada con horario y sin cancelar: la página lleva algún <time datetime>. */
export function scheduleErrors(page, rd) {
  return !rd.isCancelledDay && (rd.neutralStartTimeUtc || rd.estimatedFinishTimeUtc) && !page.includes('<time datetime="')
    ? ['jornada con horario sin <time datetime>'] : [];
}

/**
 * Comprobaciones de una página de jornada generada; devuelve los errores.
 * `navHrefs`: enlaces de vistas que debe llevar la cabecera (js/header-html.js).
 */
export function validatePage(page, { rd, navHrefs }) {
  return [...pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES }), ...scheduleErrors(page, rd)];
}

/**
 * Resultado de una página: { status: 'out' } fuera del ámbito o sin jornada;
 * { status: 'fallback', reason } si queda como está; { status: 'ok', page,
 * errors } si se generó. `render(input)` devuelve { html, headerInner }.
 */
export function prerenderPage(source, { lang, scope, index, render, navHrefs, fingerprint }) {
  const dayId = pageDayId(source);
  if (!dayId || !SCOPES[scope].langs.includes(lang)) return { status: 'out' };
  // Sin la jornada entre las publicadas, su año se desconoce: cuenta como
  // vuelta atrás salvo en un ámbito por año.
  const ref = index.published.get(dayId) || index.days.get(dayId);
  if (ref ? !inScope(scope, lang, ref) : SCOPES[scope].year) return { status: 'out' };
  const input = jornadaInputs(index, dayId);
  if (!input) return { status: 'fallback', reason: 'sin datos' };
  let rendered;
  try {
    rendered = render(input, headerOptions(source, lang));
  } catch (error) {
    return { status: 'fallback', reason: `error: ${error.message}` };
  }
  const page = composePage(source, { ...rendered, container: 'jornadaContent', fingerprint: fingerprint(rendered.html),
    style: `--card-color:${input.race.colorHex || '#888'}` });
  if (!page) return { status: 'fallback', reason: 'plantilla' };
  return { status: 'ok', page, errors: validatePage(page, { rd: input.rd, navHrefs }) };
}

/** Resumen de los procesos por idioma; `ok` false si no llega al 99 %. */
export function summarize(results) {
  const total = { scope: 0, generated: 0, fallbacks: [], errors: [] };
  for (const result of results) {
    total.scope += result.scope;
    total.generated += result.generated;
    total.fallbacks.push(...result.fallbacks);
    total.errors.push(...result.errors);
  }
  total.ratio = total.scope ? total.generated / total.scope : 1;
  total.ok = total.ratio >= MIN_RATIO && !total.errors.length;
  return total;
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
function defineGlobals(values) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

// Entorno mínimo para importar los módulos públicos: mismos CONFIG y dominio
// EN que el js/config.js de CI; sin red (solo el diccionario EN local).
// `dir`: directorio de las páginas, la ruta de `location`.
export function installBrowserEnv(lang, dir = LANGS[lang].dir) {
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
    location: new URL(`${ORIGIN}/${dir}/`),
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

/** index.html de cada subdirectorio de `dir` en el sitio, en orden. */
export function pageFiles(site, dir) {
  const base = join(site, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(base, entry.name, 'index.html'))
    .filter(file => existsSync(file))
    .sort();
}

async function runLanguage(lang, site, scope, data) {
  const started = performance.now();
  // Módulos que leen el entorno al cargarse (idioma, región, cliente de
  // datos): después de installBrowserEnv. Los importados arriba no lo leen;
  // la cabecera sí depende de la fecha local, ya en la zona del proceso.
  installBrowserEnv(lang);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { filterBroadcastsByRegion, withRaceTechnicalGuide } = await load('js/shared.js');
  const { jornadaHtml } = await load('js/jornada-html.js');
  await initI18n();
  const imported = performance.now();
  const index = buildIndex(data);
  const { timeZoneLabel } = LANGS[lang];
  const render = (input, header) => ({
    html: jornadaHtml(input.rd, input.race, filterBroadcastsByRegion(input.broadcasts),
      withRaceTechnicalGuide(input.assets, input.guide), input.siblings, input.hasStartlist,
      input.broadcasts, buildInhouseResultsMatcher(input.uci), { timeZoneLabel }).html,
    headerInner: headerHtml(header),
  });
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  const result = { lang, pages: 0, scope: 0, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  for (const file of pageFiles(site, LANGS[lang].dir)) {
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

function forkLanguage(lang, site, scope, data) {
  return new Promise((done, fail) => {
    const child = fork(SCRIPT, ['--worker', lang, site, '--scope', scope], {
      env: { ...process.env, TZ: LANGS[lang].timeZone },
      serialization: 'advanced',
    });
    let result = null;
    child.on('message', message => { result = message; });
    child.on('error', fail);
    child.on('exit', code => (code === 0 && result ? done(result) : fail(new Error(`El proceso ${lang} terminó con código ${code}`))));
    child.send(data);
  });
}

// ── Línea de órdenes ───────────────────────────────────────────────────────
// Opciones con valor (--worker <idioma>, --scope, --data) y la ruta del sitio.
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
      const result = await runLanguage(options.worker, site, parseScope(options.scope), data);
      process.send(result, () => process.exit(0));
    });
    return 0;
  }
  if (!site) throw new Error('Uso: prerender-jornadas.mjs <_site> [--scope off|2027|es|all] [--data datos.json]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_JORNADAS);
  if (scope === 'off') {
    console.log('Prerender de jornadas desactivado (PRERENDER_JORNADAS=off)');
    return 0;
  }
  const started = performance.now();
  const shared = options.data ? null : sharedDataDir();
  const data = options.data ? readDump(options.data)
    : shared ? readSharedData(shared) : await loadApiData(scope, process.env.SUPABASE_ANON_KEY);
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), scope, data)));
  const total = summarize(results);
  for (const result of results) {
    const sizes = result.bytes.sort((a, b) => a - b);
    const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.written} reescritas, ${result.pages} páginas), `
      + `importación ${seconds(result.importMs)}, pintado ${seconds(result.renderMs)}, `
      + `mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, máximo ${kb(sizes.at(-1))}`);
  }
  for (const fallback of total.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de jornadas (${scope}): ${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), `
    + `${total.fallbacks.length} con vuelta atrás; datos${shared ? ' (volcado compartido)' : ''} ${seconds(loaded - started)}, total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de jornadas: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < MIN_RATIO) console.log(`::error::Prerender de jornadas: ${total.generated} de ${total.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de jornadas: ${error.message}`);
    process.exitCode = 1;
  });
}
