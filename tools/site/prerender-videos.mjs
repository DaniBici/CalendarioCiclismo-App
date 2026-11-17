#!/usr/bin/env node
// Paso de build «Prerender de vídeos» (docs/plans/videos-5-2.md, SEO de la
// sección Vídeos).
//
// Escribe en _site/videos/index.html y _site/en/videos/index.html la vista
// inicial que pinta js/videos-feed.js, con el mismo código
// (js/videos-feed-html.js, js/services/video-feed-entries.js y
// js/header-html.js) importado en Node con el entorno mínimo de navegador de
// prerender-jornadas.mjs:
//
// - el interior de <main id="videosContent">, con data-prerendered="<huella>":
//   título, conmutador y días de la vista inicial (Ciclocross en la temporada
//   CX, Carretera el resto), con las emisiones y los vídeos sin restricción y
//   los de los grupos ES y EUROPA; js/videos-feed.js conserva el DOM si su HTML
//   tiene la misma huella (js/html-fingerprint.js) y, si no, repinta con la
//   región del visitante y los datos vivos;
// - en el <head>, JSON-LD: CollectionPage con BreadcrumbList e ItemList de las
//   carreras con vídeos de las dos disciplinas (jornada con #videos o ficha CX
//   en su sección Vídeos);
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
//   node tools/site/prerender-videos.mjs <_site> [--scope off|es|all] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_VIDEOS (por defecto off); es: la página ES;
//   all: ES y EN.
// - Datos: por la API pública con SUPABASE_ANON_KEY: video_feed_days de los
//   últimos DAYS_BACK días y la temporada CX en curso con las columnas de la
//   agenda (CX_AGENDA_SELECT). En local, --data con un volcado
//   { roadDays, agenda, today, season }.
// - Vuelta atrás por página: sin plantilla reconocible o con un error al
//   pintar, la página queda como la fuente y se cuenta.
import { fork } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { CX_AGENDA_SELECT } from '../../js/services/cx-data.js';
import { headerOptions, installBrowserEnv, pageErrors, readDump, summarize } from './prerender-jornadas.mjs';
import { apiFetch } from './prerender-inscritos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const ORIGIN = 'https://calendariociclismo.app';
const SUPABASE_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const MIN_RATIO = 0.99;
// Ventana de lectura de carretera: la vista inicial son 14 días desde el último
// con vídeos; 60 cubren un parón sin carreras.
const DAYS_BACK = 60;
const MAX_ITEMS = 40;
const MAX_PAGE_BYTES = 256 * 1024;
// Región de la página estática: sin restricción y la audiencia principal.
const STATIC_GROUPS = new Set(['ALL', 'ES', 'EUROPA']);

const SCOPES = {
  off: { langs: [] },
  es: { langs: ['es'] },
  all: { langs: ['es', 'en'] },
};

const LANGS = {
  es: { dir: 'videos', home: '/', name: 'Calendario Ciclismo', section: 'Vídeos de ciclismo' },
  en: { dir: 'en/videos', home: '/en/', name: 'Calendario Ciclismo', section: 'Cycling videos' },
};

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_VIDEOS no admitido: «${scope}» (off, es o all)`);
  return scope;
}

// Fecha civil de España: la de la portada y Hoy.
export const madridDate = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const shiftKey = (key, days) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ── Datos ──────────────────────────────────────────────────────────────────
// video_feed_days devuelve un único JSON (la lista de jornadas): sin la
// paginación ni el recuento de apiFetch.
async function feedDays(key, fromKey, toKey, fetchImpl) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/video_feed_days?p_from=${fromKey}&p_to=${toKey}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (response.ok) {
      const days = await response.json();
      if (!Array.isArray(days)) throw new Error('video_feed_days sin lista');
      return days;
    }
    if (response.status < 500 || attempt === 3) throw new Error(`API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    await new Promise(done => setTimeout(done, attempt * 1000));
  }
}

async function loadApiData(key, { today, season }, fetchImpl = fetch) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los vídeos');
  const [roadDays, [agenda]] = await Promise.all([
    feedDays(key, shiftKey(today, -DAYS_BACK), today, fetchImpl),
    apiFetch([{ path: `cx_races?select=${CX_AGENDA_SELECT}&seasonKey=eq.${encodeURIComponent(season)}&editorialStatus=eq.published&order=dateKey.asc,id.asc` }],
      key, { fetchImpl }),
  ]);
  return { roadDays, agenda, today, season };
}

// ── Página ─────────────────────────────────────────────────────────────────
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const MAIN_OPEN = /<main\b([^>]*\sid="videosContent"[^>]*)>/;
const LD = /\s*<script type="application\/ld\+json" data-videos>[\s\S]*?<\/script>/;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Página con la cabecera, el contenido y el JSON-LD generados, o null si la
 * plantilla no tiene la cabecera y el <main id="videosContent"> esperados.
 * Sustituye lo que escribió una pasada anterior.
 */
export function composePage(source, { headerInner, html, fingerprint, ld }) {
  const header = HEADER.exec(source);
  const main = MAIN_OPEN.exec(source);
  if (!header || !main || header.index > main.index || !source.includes('</head>')) return null;
  const mainEnd = main.index + main[0].length;
  const close = source.indexOf('</main>', mainEnd);
  if (close < 0) return null;
  const mainAttrs = main[1].replace(/\sdata-prerendered="[^"]*"/, '');
  const page = source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, main.index)
    + `<main${mainAttrs} data-prerendered="${attr(fingerprint)}">${html}\n  `
    + source.slice(close);
  return page.replace(LD, '').replace('</head>', `  <script type="application/ld+json" data-videos>${jsonLd(ld)}</script>\n</head>`);
}

/** Comprobaciones de una página generada; devuelve los errores. */
export function validatePage(page, { navHrefs, cards }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES });
  const main = page.slice(page.search(MAIN_OPEN), page.indexOf('</main>'));
  if (/class="loading[ "]/.test(main)) errors.push('marcador de carga en <main>');
  const painted = main.match(/class="video-card[ "]/g)?.length || 0;
  if (painted !== cards) errors.push(`${painted} tarjetas pintadas de ${cards}`);
  if (!/<script type="application\/ld\+json" data-videos>/.test(page)) errors.push('sin JSON-LD');
  return errors;
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
async function runLanguage(lang, site, data) {
  const started = performance.now();
  const { dir, home, name: siteName, section } = LANGS[lang];
  installBrowserEnv(lang, dir);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { jornadaUrl } = await load('js/shared.js');
  const { roadVideoEntries, cxVideoEntries, videoFeedDays, latestVideoDate } = await load('js/services/video-feed-entries.js');
  const H = await load('js/videos-feed-html.js');
  const { cyclocrossHome } = await load('js/services/today-season.js');
  const { RESULTS_SEASON_START, initialResultsFromKey } = await load('js/services/result-feed-pagination.js');
  const { cxListedInAgenda, cxTournamentRounds } = await load('js/services/cx-data.js');
  const { cxRacePageUrl } = await load('js/cx/presentation.js');
  await initI18n();
  const imported = performance.now();
  const result = { lang, scope: 1, generated: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  const file = join(site, dir, 'index.html');
  const fileName = relative(site, file);
  if (!existsSync(file)) {
    result.fallbacks.push(`${fileName}: sin página`);
    return result;
  }

  const isEn = lang === 'en';
  const locale = isEn ? 'en-GB' : 'es-ES';
  const { today, season } = data;
  const filter = rows => (rows || []).filter(row => !row.country || STATIC_GROUPS.has(row.country));
  const cxRaces = data.agenda.filter(race => cxListedInAgenda(race, lang));
  const rounds = cxTournamentRounds(data.agenda, season);
  const road = roadVideoEntries(data.roadDays, filter);
  const cx = cxVideoEntries(cxRaces, filter);
  const from = {
    road: initialResultsFromKey(latestVideoDate(data.roadDays, [], today) || today),
    cx: initialResultsFromKey(latestVideoDate([], cx, today) || today),
  };
  const view = cyclocrossHome(today) ? 'cx' : 'road';
  const daysOf = key => (key === 'cx'
    ? videoFeedDays([], cx, { fromKey: from.cx, toKey: today })
    : videoFeedDays(road, [], { fromKey: from.road, toKey: today }));
  const days = daysOf(view);

  const render = header => {
    let body = days.length ? H.videoDaysHtml(days, { isEn, locale, rounds }) : H.videosEmptyHtml(isEn, view === 'cx');
    if (from[view] > RESULTS_SEASON_START) body += H.videosMoreHtml(isEn);
    const html = `${H.videosHeroHtml(H.videosSwitchHtml({ view, pinned: false, isEn }))}<div id="videosFeedPanel" data-view="${view}">${body}</div>`;
    // Carreras de las dos disciplinas, de la más reciente a la más antigua; una
    // prueba CX de varios días, una vez. En carretera, con la etapa.
    const stageLabel = rd => (rd.stageNumber == null || rd.stageNumber === '' ? ''
      : Number(rd.stageNumber) === 0 ? (isEn ? 'Prologue' : 'Prólogo') : `${isEn ? 'Stage' : 'Etapa'} ${rd.stageNumber}${rd.stageSuffix || ''}`);
    const seen = new Set();
    const items = ['cx', 'road'].flatMap(key => daysOf(key).flatMap(day => day.entries))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(entry => {
        const path = entry.discipline === 'cx' ? cxRacePageUrl(entry.race, lang, 'videos') : `${jornadaUrl(entry.rd)}#videos`;
        const raceName = isEn ? (entry.race.nameEn || entry.race.name) : entry.race.name;
        const stage = entry.discipline === 'road' && entry.race.raceFormat !== 'one_day' ? stageLabel(entry.rd) : '';
        return { url: new URL(path, ORIGIN).href, name: stage ? `${raceName} · ${stage}` : raceName };
      })
      .filter(item => !seen.has(item.url) && seen.add(item.url))
      .slice(0, MAX_ITEMS)
      .map((item, index) => ({ '@type': 'ListItem', position: index + 1, ...item }));
    const pageUrl = `${ORIGIN}/${dir}/`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: section,
      url: pageUrl,
      inLanguage: lang,
      description: isEn
        ? 'Cycling videos by day: full broadcasts, highlights and final kilometres of stages, one-day races and cyclocross.'
        : 'Vídeos de ciclismo por día: emisiones completas, resúmenes y últimos kilómetros de etapas, clásicas y pruebas de ciclocross.',
      isPartOf: { '@type': 'WebSite', name: siteName, url: `${ORIGIN}${home}` },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: siteName, item: `${ORIGIN}${home}` },
          { '@type': 'ListItem', position: 2, name: section, item: pageUrl },
        ],
      },
      mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items },
    };
    return { html, headerInner: headerHtml(header), ld, cards: days.reduce((sum, day) => sum + day.entries.length, 0) };
  };

  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  const source = readFileSync(file, 'utf8');
  let rendered;
  try {
    const header = headerOptions(source, lang);
    rendered = render({ ...header, active: header.active || 'videos' });
  } catch (error) {
    result.fallbacks.push(`${fileName}: error: ${error.message}`);
    return result;
  }
  const page = composePage(source, { ...rendered, fingerprint: htmlFingerprint(rendered.html) });
  if (!page) {
    result.fallbacks.push(`${fileName}: plantilla`);
    return result;
  }
  result.generated++;
  result.bytes.push(Buffer.byteLength(page));
  result.errors.push(...validatePage(page, { navHrefs, cards: rendered.cards }).map(error => `${fileName}: ${error}`));
  if (page !== source) {
    writeFileSync(file, page);
    result.written++;
  }
  result.cards = rendered.cards;
  result.view = view;
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
  if (!site) throw new Error('Uso: prerender-videos.mjs <_site> [--scope off|es|all] [--data datos.json]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_VIDEOS);
  if (scope === 'off') {
    console.log('Prerender de vídeos desactivado (PRERENDER_VIDEOS=off)');
    return 0;
  }
  const started = performance.now();
  let data;
  if (options.data) {
    data = readDump(options.data);
  } else {
    // El entorno de navegador sustituye fetch: la lectura usa el original.
    const fetchImpl = globalThis.fetch;
    installBrowserEnv('es', LANGS.es.dir);
    const { cxSeason } = await import(pathToFileURL(join(ROOT, 'js/cx/presentation.js')).href);
    const today = madridDate();
    data = await loadApiData(process.env.SUPABASE_ANON_KEY, { today, season: cxSeason() }, fetchImpl);
  }
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), data)));
  const total = summarize(results);
  for (const result of results) {
    const kb = ((result.bytes[0] || 0) / 1024).toFixed(1);
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.written} reescritas), vista ${result.view}, `
      + `${result.cards} tarjetas, importación ${seconds(result.importMs || 0)}, pintado ${seconds(result.renderMs || 0)}, ${kb} KB`);
  }
  for (const fallback of total.fallbacks) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de vídeos (${scope}): ${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), `
    + `${total.fallbacks.length} con vuelta atrás; ${data.roadDays.length} jornadas, ${data.agenda.length} pruebas CX; `
    + `datos ${seconds(loaded - started)}, total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de vídeos: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < MIN_RATIO) console.log(`::error::Prerender de vídeos: ${total.generated} de ${total.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de vídeos: ${error.message}`);
    process.exitCode = 1;
  });
}
