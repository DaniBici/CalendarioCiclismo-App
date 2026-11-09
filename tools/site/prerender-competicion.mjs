#!/usr/bin/env node
// Paso de build «Prerender de competiciones»
// (docs/plans/contenido-generado-build.md, «Competición»).
//
// Escribe en las páginas de competición de `_site` (/competicion/<slug>/ y
// /en/race/<slugEn>/) la página que pinta js/competicion.js (cabecera,
// botones y tarjetas de jornada), con el mismo código (js/competicion-html.js y
// js/header-html.js) importado en Node con el entorno mínimo de navegador de
// prerender-jornadas.mjs:
//
// - el interior de <main id="competicionContent">, con
//   data-prerendered="<huella>": la huella es la de la página sin las piezas de
//   cada tarjeta que dependen del momento, de la zona o de la región (horario,
//   insignias, resultados, miniperfil, aviso), que el build escribe con su valor
//   del momento y js/competicion.js repinta al conservar la página
//   (js/html-fingerprint.js);
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-competicion.mjs <_site> [--scope off|es|all] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_COMPETICION (por defecto off: no hace nada);
//   es: páginas ES; all: ES y EN.
// - Datos: los del prerender de jornadas (carreras, jornadas publicadas,
//   emisiones, documentos y clasificaciones propias): del volcado compartido
//   (PAGES_DATA, site_data.py) si algún generador lo leyó; si no, por la API
//   pública con SUPABASE_ANON_KEY. En local, --data con el volcado de
//   prerender-jornadas.sql.
// - Un proceso por idioma con la zona de prerender-jornadas.mjs (ES
//   Europe/Madrid, EN Etc/GMT): región de la TV y horas de las piezas del
//   momento como un visitante de esa zona.
// - Vuelta atrás por página: sin la carrera, sin plantilla reconocible o con
//   un error al pintar, la página queda como la dejó gen_og_pages.py.
// - Falla (código 1) si genera menos del 99 % del ámbito o si una página
//   generada incumple validatePage().
import { fork } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { buildInhouseResultsMatcher } from '../../js/services/races.js';
import { composePage, groupBy, headerOptions, installBrowserEnv, loadApiData, pageErrors, readDump, readSharedData,
  sharedDataDir, summarize } from './prerender-jornadas.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
// Una vuelta de 21 etapas sin miniperfil en el HTML (lo pinta el navegador en
// su banda reservada) ronda los 40 KB.
const MAX_PAGE_BYTES = 128 * 1024;

const SCOPES = {
  off: { langs: [] },
  es: { langs: ['es'] },
  all: { langs: ['es', 'en'] },
};

// Directorio de las páginas y zona del proceso de cada idioma, como en
// prerender-jornadas.mjs.
const LANGS = {
  es: { dir: 'competicion', timeZone: 'Europe/Madrid' },
  en: { dir: 'en/race', timeZone: 'Etc/GMT' },
};

function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_COMPETICION no admitido: «${scope}» (off, es o all)`);
  return scope;
}

// ── Datos ──────────────────────────────────────────────────────────────────
/** Índices por carrera: jornadas publicadas (por id), emisiones y documentos por jornada y clasificaciones propias. */
export function buildIndex(data) {
  return {
    races: new Map((data.races || []).map(race => [race.id, race])),
    daysByRace: groupBy(data.days || [], 'raceId'),
    broadcastsByDay: groupBy(data.broadcasts || [], 'raceDayId'),
    assetsByDay: groupBy(data.assets || [], 'raceDayId'),
    uciByRace: groupBy(data.uci || [], 'raceId'),
  };
}

/**
 * Jornadas de la carrera como las prepara js/competicion.js: ordenadas, con
 * las emisiones visibles en la región (`filterBroadcastsByRegion`), documentos,
 * clasificaciones propias y dobles sectores. null sin la carrera.
 */
export function competitionInputs(index, raceId, { filterBroadcastsByRegion, annotateDoubleSectors, sortCompetitionDays }) {
  const race = index.races.get(raceId);
  if (!race) return null;
  const matcher = buildInhouseResultsMatcher(index.uciByRace.get(raceId) || []);
  const days = sortCompetitionDays((index.daysByRace.get(raceId) || []).map(day => ({ ...day })));
  for (const rd of days) {
    const all = index.broadcastsByDay.get(rd.id) || [];
    rd._broadcasts = filterBroadcastsByRegion(all);
    rd._tvBlocked = all.length > 0 && rd._broadcasts.length === 0;
    rd._assets = index.assetsByDay.get(rd.id) || [];
    // loadInhouseStageSet de js/race-data-modal.js: una jornada cancelada no tiene trofeo.
    rd._hasInhouse = !rd.isCancelledDay && matcher.has(rd);
  }
  annotateDoubleSectors(days);
  return { race, days };
}

// ── Página ─────────────────────────────────────────────────────────────────
export const RACE_META = /<meta name="cc:race-id" content="([^"]+)">/;
const MAIN_OPEN = /<main id="competicionContent"[^>]*>/;

/**
 * Comprobaciones de una página generada; devuelve los errores. `cards`:
 * jornadas de la carrera, una tarjeta cada una.
 */
function validatePage(page, { navHrefs, cards }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES });
  const start = page.search(MAIN_OPEN);
  const main = page.slice(start, page.indexOf('</main>', start));
  if (/class="(?:loading|static-prerender|prerender-loading)[ "]/.test(main)) errors.push('marcador de carga o bloque estático en <main>');
  const painted = main.match(/<div class="race-card[ "]/g)?.length || 0;
  if (painted !== cards) errors.push(`${painted} tarjetas pintadas de ${cards}`);
  return errors;
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
function pageFiles(site, dir) {
  const base = join(site, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => join(base, entry.name, 'index.html'))
    .filter(file => existsSync(file))
    .sort();
}

async function runLanguage(lang, site, data) {
  const started = performance.now();
  installBrowserEnv(lang, LANGS[lang].dir);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { filterBroadcastsByRegion, countryFlag, stageLabel, raceName } = await load('js/shared.js');
  const { annotateDoubleSectors } = await load('js/services/races.js');
  const { competitionPageHtml, sortCompetitionDays } = await load('js/competicion-html.js');
  await initI18n();
  const imported = performance.now();
  const index = buildIndex(data);
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  const helpers = { filterBroadcastsByRegion, annotateDoubleSectors, sortCompetitionDays };
  const result = { lang, pages: 0, scope: 0, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  for (const file of pageFiles(site, LANGS[lang].dir)) {
    result.pages++;
    const source = readFileSync(file, 'utf8');
    const name = relative(site, file);
    const raceId = RACE_META.exec(source)?.[1];
    if (!raceId) continue;
    result.scope++;
    let page, cards;
    try {
      const input = competitionInputs(index, raceId, helpers);
      if (!input) {
        result.fallbacks.push(`${name}: sin datos`);
        continue;
      }
      const { race, days } = input;
      const options = { race, flag: countryFlag(race.countryCode), tooltipName: raceName(race) };
      const card = rd => ({ ...options, title: stageLabel(rd.stageNumber, rd._stageSuffix) });
      const neutral = competitionPageHtml(race, days, card, { dynamic: false });
      page = composePage(source, {
        container: 'competicionContent', headerInner: headerHtml(headerOptions(source, lang)),
        html: competitionPageHtml(race, days, card, { dynamic: true }), fingerprint: htmlFingerprint(neutral),
      });
      cards = days.length;
    } catch (error) {
      result.fallbacks.push(`${name}: error: ${error.message}`);
      continue;
    }
    if (!page) {
      result.fallbacks.push(`${name}: plantilla`);
      continue;
    }
    result.generated++;
    result.bytes.push(Buffer.byteLength(page));
    result.errors.push(...validatePage(page, { navHrefs, cards }).map(error => `${name}: ${error}`));
    if (page !== source) {
      writeFileSync(file, page);
      result.written++;
    }
  }
  result.importMs = Math.round(imported - started);
  result.renderMs = Math.round(performance.now() - imported);
  return result;
}

function forkLanguage(lang, site, data) {
  return new Promise((done, fail) => {
    const child = fork(SCRIPT, ['--worker', lang, site], { serialization: 'advanced', env: { ...process.env, TZ: LANGS[lang].timeZone } });
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
  if (!site) throw new Error('Uso: prerender-competicion.mjs <_site> [--scope off|es|all] [--data datos.json]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_COMPETICION);
  if (scope === 'off') {
    console.log('Prerender de competiciones desactivado (PRERENDER_COMPETICION=off)');
    return 0;
  }
  const started = performance.now();
  const shared = options.data ? null : sharedDataDir();
  const data = options.data ? readDump(options.data)
    : shared ? readSharedData(shared) : await loadApiData('all', process.env.SUPABASE_ANON_KEY);
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), data)));
  const total = summarize(results);
  for (const result of results) {
    const sizes = result.bytes.sort((a, b) => a - b);
    const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
    const mb = (sizes.reduce((sum, bytes) => sum + bytes, 0) / 1048576).toFixed(1);
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.written} reescritas, ${result.pages} páginas), `
      + `importación ${seconds(result.importMs || 0)}, pintado ${seconds(result.renderMs || 0)}, `
      + `mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, máximo ${kb(sizes.at(-1))}, total ${mb} MB`);
  }
  for (const fallback of total.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de competiciones (${scope}): ${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), `
    + `${total.fallbacks.length} con vuelta atrás; datos${shared ? ' (volcado compartido)' : ''} ${seconds(loaded - started)}, `
    + `total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de competiciones: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < 0.99) console.log(`::error::Prerender de competiciones: ${total.generated} de ${total.scope} generadas (mínimo 99 %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de competiciones: ${error.message}`);
    process.exitCode = 1;
  });
}
