#!/usr/bin/env node
// Paso de build «Prerender de fichajes»
// (docs/plans/contenido-generado-build.md, «Fichajes»).
//
// Escribe en _site/fichajes/index.html y _site/en/transfers/index.html la
// portada del mercado (feed y equipos WT) que pinta js/fichajes.js, con el
// mismo código (js/fichajes-html.js y js/header-html.js) importado en Node con
// el entorno mínimo de navegador de prerender-jornadas.mjs:
//
// - el interior de <main id="fichajesMain">: <div id="transfersContent"> con
//   data-prerendered="<huella>" y marketHomeHtml(), en lugar del bloque
//   estático, el marcador de carga y el contenedor vacío de la fuente;
//   js/fichajes.js conserva el DOM si su HTML tiene la misma huella
//   (js/html-fingerprint.js) y, si no, repinta con los datos vivos;
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de la fuente (fichajes/index.html,
// en/transfers/index.html).
//
//   node tools/site/prerender-fichajes.mjs <_site> [--scope off|es|all] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_FICHAJES (por defecto off: no hace nada); es:
//   la página ES; all: ES y EN.
// - Datos: por la API pública con SUPABASE_ANON_KEY, con las lecturas de
//   fetchMarket() de js/fichajes.js (temporadas del mercado y en curso,
//   movimientos, fichas y equipos fuera de ambas temporadas). En local, --data
//   con el volcado de prerender-fichajes.sql (scripts/db/sql.mjs --read-only).
// - La portada no depende de la zona, la región ni la hora (fechas del feed
//   con tablas fijas): un proceso por idioma (el idioma se fija al cargar
//   js/i18n.js), sin zona propia.
// - Vuelta atrás por página: sin plantilla reconocible o con un error al
//   pintar, la página queda como la fuente y se cuenta.
// - Falla (código 1) si genera menos del 99 % del ámbito o si una página
//   generada incumple validatePage().
import { fork } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { headerOptions, installBrowserEnv, pageErrors, readDump, summarize } from './prerender-jornadas.mjs';
import { apiFetch, inFilter } from './prerender-inscritos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const MIN_RATIO = 0.99;
const API_IN_CHUNK = 100;
// La página del 2026-10-29 (feed de 60 fichajes y 60 renovaciones, 18 equipos
// WT) ocupa 74 KB; el feed tiene tope de filas.
const MAX_PAGE_BYTES = 128 * 1024;

const SCOPES = {
  off: { langs: [] },
  es: { langs: ['es'] },
  all: { langs: ['es', 'en'] },
};

// Página de cada idioma (fuente manual copiada a _site).
const LANGS = {
  es: { dir: 'fichajes' },
  en: { dir: 'en/transfers' },
};

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_FICHAJES no admitido: «${scope}» (off, es o all)`);
  return scope;
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que fetchMarket() (js/fichajes.js): mismas columnas,
// filtros y orden, con desempate por id en las paginadas. Las fichas y los
// equipos fuera de ambas temporadas, por tramos de API_IN_CHUNK ids.
const columns = list => list.replace(/\s+/g, '');

const chunked = values => Array.from({ length: Math.ceil(values.length / API_IN_CHUNK) },
  (_, at) => values.slice(at * API_IN_CHUNK, (at + 1) * API_IN_CHUNK));

// `market`: el módulo js/fichajes-html.js, importado con el entorno de
// navegador instalado (js/shared.js lo necesita al cargarse).
async function loadApiData(market, key, fetchImpl = fetch) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de fichajes');
  const { SEASON, PREV_SEASON, SEASON_COLUMNS, PREV_SEASON_COLUMNS, RIDER_COLUMNS } = market;
  const queries = {
    seasons: `team_seasons?select=${columns(SEASON_COLUMNS)}&year=eq.${SEASON}&order=teamId.asc,id.asc`,
    prevSeasons: `team_seasons?select=${columns(PREV_SEASON_COLUMNS)}&year=eq.${PREV_SEASON}&order=teamId.asc,id.asc`,
    transfers: `rider_transfers?select=*&season=eq.${SEASON}&order=announcedAt.desc,createdAt.desc,id.asc`,
  };
  const byId = {
    men: filter => `riders_men?select=${columns(RIDER_COLUMNS)}&${filter}&order=id.asc`,
    women: filter => `riders_women?select=${columns(RIDER_COLUMNS)}&${filter}&order=id.asc`,
    extraTeams: filter => `teams?select=id,name&${filter}&order=id.asc`,
  };
  const names = Object.keys(queries);
  const rows = await apiFetch(names.map(name => ({ path: queries[name] })), key, { fetchImpl });
  const data = { ...Object.fromEntries(names.map((name, at) => [name, rows[at]])), men: [], women: [], extraTeams: [] };
  const ids = {
    men: market.marketRiderIds(data.transfers, 'male'),
    women: market.marketRiderIds(data.transfers, 'female'),
    extraTeams: market.marketExtraTeamIds(data.seasons, data.prevSeasons, data.transfers),
  };
  const parts = Object.entries(ids).flatMap(([name, values]) =>
    chunked(values).map(chunk => ({ name, path: byId[name](inFilter('id', chunk)) })));
  (await apiFetch(parts, key, { fetchImpl })).forEach((found, at) => { data[parts[at].name].push(...found); });
  return data;
}

// ── Página ─────────────────────────────────────────────────────────────────
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const MAIN_OPEN = /<main\b([^>]*\sid="fichajesMain"[^>]*)>/;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Página con la cabecera y la portada generadas, o null si la plantilla no
 * tiene la cabecera y el <main id="fichajesMain"> esperados. Sustituye todo
 * el interior del <main>, también lo que escribió una pasada anterior.
 */
export function composePage(source, { headerInner, html, fingerprint }) {
  const header = HEADER.exec(source);
  const main = MAIN_OPEN.exec(source);
  if (!header || !main || header.index > main.index) return null;
  const mainEnd = main.index + main[0].length;
  const close = source.indexOf('</main>', mainEnd);
  if (close < 0) return null;
  return source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, mainEnd)
    + `\n    <div id="transfersContent" data-prerendered="${attr(fingerprint)}">${html}</div>\n  `
    + source.slice(close);
}

/**
 * Comprobaciones de una página generada; devuelve los errores. `navHrefs`:
 * enlaces de vistas de la cabecera (js/header-html.js); `teams`: equipos de la
 * división inicial; `feed`: si hay fichajes o renovaciones que mostrar.
 */
export function validatePage(page, { navHrefs, teams, feed }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES });
  const main = page.slice(page.search(MAIN_OPEN), page.indexOf('</main>'));
  // Sin marcadores de la capa de carga (js/page-loading.js) ni bloque estático.
  if (/class="(?:loading|static-prerender)[ "]/.test(main)) errors.push('marcador de carga o bloque estático en <main>');
  const cards = main.match(/<button class="tr-team-card"/g)?.length || 0;
  if (!teams || cards !== teams) errors.push(`${cards} equipos pintados de ${teams}`);
  if (feed && !main.includes('class="tr-feed-day"')) errors.push('feed sin movimientos');
  return errors;
}

/**
 * Resultado de una página: { status: 'fallback', reason } si queda como está;
 * { status: 'ok', page, errors } si se generó. `render(header)` devuelve
 * { html, headerInner, teams, feed }.
 */
export function prerenderPage(source, { lang, render, navHrefs, fingerprint }) {
  let rendered;
  try {
    // Sin data-active, la vista activa que deduce js/header.js de la ruta.
    const header = headerOptions(source, lang);
    rendered = render({ ...header, active: header.active || 'transfers' });
  } catch (error) {
    return { status: 'fallback', reason: `error: ${error.message}` };
  }
  const page = composePage(source, { ...rendered, fingerprint: fingerprint(rendered.html) });
  if (!page) return { status: 'fallback', reason: 'plantilla' };
  return { status: 'ok', page, errors: validatePage(page, { navHrefs, teams: rendered.teams, feed: rendered.feed }) };
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
async function runLanguage(lang, site, data) {
  const started = performance.now();
  const { dir } = LANGS[lang];
  // Módulos que leen el entorno al cargarse (idioma, cliente de datos):
  // después de installBrowserEnv.
  installBrowserEnv(lang, dir);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { attachRiders, buildMarket, confirmedFeed, divisionTeams, marketHomeHtml } = await load('js/fichajes-html.js');
  await initI18n();
  const imported = performance.now();
  const result = { lang, scope: 1, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  const file = join(site, dir, 'index.html');
  const name = relative(site, file);
  if (!existsSync(file)) {
    result.fallbacks.push(`${name}: sin página`);
    return result;
  }
  const market = buildMarket({ ...data, transfers: attachRiders(data.transfers, data.men, data.women) });
  const render = header => ({
    html: marketHomeHtml(market),
    headerInner: headerHtml(header),
    teams: divisionTeams(market, 'WT').length,
    feed: confirmedFeed(market).length > 0,
  });
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  const source = readFileSync(file, 'utf8');
  const outcome = prerenderPage(source, { lang, render, navHrefs, fingerprint: htmlFingerprint });
  if (outcome.status === 'fallback') {
    result.fallbacks.push(`${name}: ${outcome.reason}`);
  } else {
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

function forkLanguage(lang, site, data) {
  return new Promise((done, fail) => {
    const child = fork(SCRIPT, ['--worker', lang, site], { serialization: 'advanced' });
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
      const result = await runLanguage(options.worker, site, data);
      process.send(result, () => process.exit(0));
    });
    return 0;
  }
  if (!site) throw new Error('Uso: prerender-fichajes.mjs <_site> [--scope off|es|all] [--data datos.json]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_FICHAJES);
  if (scope === 'off') {
    console.log('Prerender de fichajes desactivado (PRERENDER_FICHAJES=off)');
    return 0;
  }
  const started = performance.now();
  let data;
  if (options.data) {
    data = readDump(options.data);
  } else {
    // El entorno de navegador sustituye fetch (solo admite el diccionario EN):
    // la lectura usa el original.
    const fetchImpl = globalThis.fetch;
    installBrowserEnv('es', LANGS.es.dir);
    const market = await import(pathToFileURL(join(ROOT, 'js/fichajes-html.js')).href);
    data = await loadApiData(market, process.env.SUPABASE_ANON_KEY, fetchImpl);
  }
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), data)));
  const total = summarize(results);
  for (const result of results) {
    const kb = ((result.bytes[0] || 0) / 1024).toFixed(1);
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.written} reescritas), `
      + `importación ${seconds(result.importMs || 0)}, pintado ${seconds(result.renderMs || 0)}, ${kb} KB`);
  }
  for (const fallback of total.fallbacks) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de fichajes (${scope}): ${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), `
    + `${total.fallbacks.length} con vuelta atrás; ${data.transfers.length} movimientos, ${data.seasons.length} equipos; `
    + `datos ${seconds(loaded - started)}, total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de fichajes: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < MIN_RATIO) console.log(`::error::Prerender de fichajes: ${total.generated} de ${total.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de fichajes: ${error.message}`);
    process.exitCode = 1;
  });
}
