#!/usr/bin/env node
// Paso de build «Prerender de carreras CX»
// (docs/plans/contenido-generado-build.md, «Carrera, inscritos y resultados CX»
// y «Torneo CX»).
//
// Escribe en las páginas de carrera CX de `_site` (/ciclocross/<slug>/, …/inscritos/,
// …/resultados/ y /en/cyclocross/<slugEn>/, …/startlist/, …/results/) la ficha
// que pinta js/cx-race.js, y en las de torneo (/ciclocross/torneos/<slug>/ y
// /en/cyclocross/series/<slug>/) el calendario que pinta js/ciclocross.js, con
// el mismo código (js/cx-race-html.js, js/cx-agenda-html.js y
// js/header-html.js) importado en Node con el entorno mínimo de navegador de
// prerender-jornadas.mjs:
//
// - ficha: el interior de <main id="cxRaceContent">, el esqueleto con la
//   sección de la URL y su columna lateral llenas, cada hueco con
//   data-prerendered="<huella>" (cxRacePrerenderedHtml); el <main> lleva además
//   data-cx-race-id. js/cx-race.js conserva cada hueco con la misma huella y
//   pinta el resto (js/html-fingerprint.js);
// - torneo: el interior de <main id="cxAgendaContent">, el esqueleto con las
//   secciones visibles si hay generales y la lista de pruebas, cada uno con la
//   huella de su versión sin estado de categorías ni insignias (las actualiza
//   refreshTiming() al cargar); el <main> lleva data-cx-tournament-id, y tras
//   él va el script en línea TOURNAMENT_SCRIPT;
// - la cabecera vacía <header id="siteHeader">: js/header.js la conserva.
//
// El <head> sigue siendo el de gen_og_pages.py.
//
//   node tools/site/prerender-cx.mjs <_site> [--scope off|es|all] [--data datos.json]
//
// - Ámbito: --scope o PRERENDER_CX (por defecto off: no hace nada); es: páginas
//   ES; all: ES y EN. Las páginas EN de carreras nacionales (aviso de público
//   hispanohablante) quedan fuera.
// - Datos: por la API pública con SUPABASE_ANON_KEY, con las lecturas de
//   js/cx-race.js en bloque para todas las carreras publicadas. En local,
//   --data con el volcado de prerender-cx.sql (scripts/db/sql.mjs --read-only).
// - Un proceso por idioma con su zona (TIME_ZONES): horas, región de la TV y
//   rótulo de zona como un visitante de esa zona. Directo, Revive y
//   «Oficial»/«Provisional» se calculan en el instante del build.
// - Vuelta atrás por página: sin datos, sin plantilla reconocible o con un
//   error al pintar, la página queda como la dejó gen_og_pages.py y se cuenta.
// - Falla (código 1) si genera menos del 99 % del ámbito o si una página
//   generada incumple validatePage().
import { fork } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CX_HOME, PRIMARY_NAV_ITEMS, STRINGS, headerHtml } from '../../js/header-html.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { CX_AGENDA_SELECT } from '../../js/services/cx-data.js';
import { cxSeasonBounds, cxSeasonMonths } from '../../js/cx/season.js';
import { headerOptions, installBrowserEnv, pageErrors, readDump, summarize } from './prerender-jornadas.mjs';
import { apiFetch, inFilter } from './prerender-inscritos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = fileURLToPath(import.meta.url);
const MIN_RATIO = 0.99;
const API_IN_CHUNK = 100;
// Ficha con la sección de la URL y el panel de la categoría visible
// (2026-10-29: mediana de 15,6 KB y máximo de 60 KB, la general de un torneo).
const MAX_PAGE_BYTES = 128 * 1024;

const SCOPES = {
  off: { langs: [] },
  es: { langs: ['es'] },
  all: { langs: ['es', 'en'] },
};

// Directorio de las fichas y sufijo de cada sección con página propia, como
// en gen_og_pages.py; zona del proceso de cada idioma.
const LANGS = {
  es: { dir: 'ciclocross', suffixes: { startlist: 'inscritos', results: 'resultados' }, tournaments: 'ciclocross/torneos' },
  en: { dir: 'en/cyclocross', suffixes: { startlist: 'startlist', results: 'results' }, tournaments: 'en/cyclocross/series' },
};
export const TIME_ZONES = { es: 'Europe/Madrid', en: 'Europe/London' };

export function parseScope(value) {
  const scope = String(value ?? 'off').trim() || 'off';
  if (!Object.hasOwn(SCOPES, scope)) throw new Error(`PRERENDER_CX no admitido: «${scope}» (off, es o all)`);
  return scope;
}

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismas lecturas que js/cx-race.js (mismas columnas, filtros y orden: `id`,
// o `category` en el estado de las generales), en bloque: las de cada carrera
// por tramos de API_IN_CHUNK carreras y las del torneo para las temporadas de
// las carreras. Las rondas y las carreras de cada torneo salen de las carreras
// publicadas (cxSeasonRounds y la consulta del torneo leen esas mismas filas).
const RACES_QUERY = 'cx_races?select=*,cx_race_categories(*),cx_tournaments(*)&editorialStatus=eq.published&order=id.asc';
const TEAMS_QUERY = 'cx_teams?select=id,name,nameAliases,uciCode,colorHex,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts&order=id.asc';
// Por lectura: columna de la carrera y consulta. Los documentos llevan además
// cxRaceId para repartirlos; se retira antes de pintar.
const RACE_QUERIES = {
  broadcasts: ['raceId', filter => `cx_broadcasts?select=*&${filter}&order=id.asc`],
  videos: ['raceId', filter => `cx_videos?select=*&${filter}&order=id.asc`],
  inscritos: ['raceId', filter => `cx_startlist_riders?select=*&${filter}&order=id.asc`],
  results: ['raceId', filter => `cx_results?select=*&${filter}&order=id.asc`],
  assets: ['cxRaceId', filter => `assets?select=id,type,url,cxRaceId&${filter}&order=id.asc`],
};
const SEASON_QUERIES = {
  states: filter => `cx_standings_state?select=*&${filter}&order=category.asc,tournamentId.asc`,
  standings: filter => `cx_tournament_standings?select=*&${filter}&order=id.asc`,
};
// Página de torneo: metadatos (cxTournamentMetadata), destacadas y las pruebas
// de cada temporada con las columnas de la agenda (cxSeasonRows).
const TOURNAMENTS_QUERY = 'cx_tournaments?select=id,name,nameEn,slug,seasonKey,logoUrl,pointsScheme&order=id.asc';
const FEATURED_QUERY = 'cx_race_featured?select=cxRaceId&order=cxRaceId.asc';
const agendaQuery = season => {
  const { first, last } = cxSeasonBounds(season);
  return `cx_races?select=${CX_AGENDA_SELECT}&seasonKey=eq.${encodeURIComponent(season)}&editorialStatus=eq.published`
    + `&dateKey=gte.${first}&dateKey=lte.${last}&order=dateKey.asc,id.asc`;
};

const chunked = values => Array.from({ length: Math.ceil(values.length / API_IN_CHUNK) },
  (_, at) => values.slice(at * API_IN_CHUNK, (at + 1) * API_IN_CHUNK));

async function loadApiData(key, fetchImpl = fetch) {
  if (!key) throw new Error('Falta SUPABASE_ANON_KEY para leer los datos de ciclocross');
  const [races, teams, tournaments, featured] = await apiFetch([{ path: RACES_QUERY }, { path: TEAMS_QUERY },
    { path: TOURNAMENTS_QUERY }, { path: FEATURED_QUERY }], key, { fetchImpl });
  const ids = races.map(race => race.id);
  const seasons = [...new Set([...races, ...tournaments].map(row => row.seasonKey).filter(Boolean))].sort();
  const parts = [
    ...Object.entries(RACE_QUERIES).flatMap(([name, [column, query]]) =>
      chunked(ids).map(chunk => ({ name, path: query(inFilter(column, chunk)) }))),
    ...Object.entries(SEASON_QUERIES).map(([name, query]) => ({ name, path: query(inFilter('seasonKey', seasons)) })),
    ...seasons.map(season => ({ name: 'agenda', path: agendaQuery(season) })),
  ];
  const data = { races, teams, tournaments, featured, broadcasts: [], videos: [], inscritos: [], results: [], assets: [], states: [], standings: [], agenda: [] };
  (await apiFetch(parts, key, { fetchImpl })).forEach((rows, at) => { data[parts[at].name].push(...rows); });
  return data;
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

/**
 * Índices por carrera y por torneo y temporada. `rounds(seasonKey)`: rondas de
 * la temporada (cxTournamentRounds) con las carreras dentro de sus límites,
 * como cxSeasonRounds.
 */
export function buildIndex(data, { cxTournamentRounds, cxSeasonBounds }) {
  const roundsBySeason = new Map();
  const tournamentKey = row => (row.tournamentId ? `${row.tournamentId}|${row.seasonKey}` : null);
  return {
    races: new Map(data.races.map(race => [race.id, race])),
    teams: data.teams,
    broadcasts: groupBy(data.broadcasts, 'raceId'),
    videos: groupBy(data.videos, 'raceId'),
    inscritos: groupBy(data.inscritos, 'raceId'),
    results: groupBy(data.results, 'raceId'),
    assets: groupBy(data.assets.map(({ cxRaceId, ...asset }) => ({ ...asset, raceId: cxRaceId })), 'raceId'),
    states: groupBy(data.states, tournamentKey),
    standings: groupBy(data.standings, tournamentKey),
    tournamentRaces: groupBy(data.races, 'tournamentId'),
    tournaments: new Map((data.tournaments || []).map(tournament => [tournament.id, { ...tournament, countryCode: null }])),
    // Pruebas de la agenda por temporada, con la marca de destacada (cxMarkFeatured).
    agenda: (() => {
      const featured = new Set((data.featured || []).map(row => row.cxRaceId));
      return groupBy((data.agenda || []).map(race => ({ ...race, featured: featured.has(race.id) })), 'seasonKey');
    })(),
    rounds(seasonKey) {
      if (!roundsBySeason.has(seasonKey)) {
        let rounds = null;
        try {
          const { first, last } = cxSeasonBounds(seasonKey);
          rounds = cxTournamentRounds(data.races.filter(race => race.seasonKey === seasonKey
            && race.dateKey >= first && race.dateKey <= last), seasonKey);
        } catch { /* temporada inválida: sin rondas, como el navegador ante un error */ }
        roundsBySeason.set(seasonKey, rounds);
      }
      return roundsBySeason.get(seasonKey);
    },
  };
}

/** Lecturas de la ficha de `raceId` en la forma de js/cx-race.js, o null sin la carrera. */
export function raceInputs(index, raceId) {
  const race = index.races.get(raceId);
  if (!race) return null;
  const tournament = race.cx_tournaments;
  const key = tournament ? `${tournament.id}|${race.seasonKey}` : null;
  const own = name => index[name].get(raceId) || [];
  return {
    race,
    rows: {
      broadcasts: own('broadcasts'), videos: own('videos'), inscritos: own('inscritos'), results: own('results'),
      teamRows: index.teams, rounds: index.rounds(race.seasonKey),
      docAssets: own('assets').map(({ raceId: _raceId, ...asset }) => asset),
      states: key ? index.states.get(key) || [] : [],
      standings: key ? index.standings.get(key) || [] : [],
      tournamentRaceRows: tournament ? (index.tournamentRaces.get(tournament.id) || [])
        .map(({ id, name, nameEn, slug, slugEn, class: raceClass, countryCode }) => ({ id, name, nameEn, slug, slugEn, class: raceClass, countryCode })) : [],
    },
  };
}

// ── Página ─────────────────────────────────────────────────────────────────
const HEADER = /<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/;
const MAIN_OPEN = /<main id="cxRaceContent"([^>]*)>/;
const RACE_ID = /data-cx-race-id="([^"]+)"/;
const OWN_ATTRS = /\s(?:data-prerendered|data-cx-race-id)="[^"]*"/g;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Id de la carrera de la página: el del <main> (pasada anterior) o el de la cabecera de gen_og_pages.py. */
export function pageRaceId(source) {
  const main = MAIN_OPEN.exec(source);
  if (!main) return null;
  return RACE_ID.exec(main[1])?.[1] || RACE_ID.exec(source.slice(main.index, source.indexOf('</main>', main.index)))?.[1] || null;
}

/**
 * Página con la cabecera y la ficha generadas, o null si la plantilla no tiene
 * la cabecera y el <main> esperados. Sustituye también lo que escribió una
 * pasada anterior.
 */
export function composePage(source, { raceId, headerInner, html, fingerprint }) {
  const header = HEADER.exec(source);
  const main = MAIN_OPEN.exec(source);
  if (!header || !main || header.index > main.index) return null;
  const close = source.indexOf('</main>', main.index + main[0].length);
  if (close < 0) return null;
  return source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, main.index)
    + `<main id="cxRaceContent"${main[1].replace(OWN_ATTRS, '')} data-cx-race-id="${attr(raceId)}" data-prerendered="${attr(fingerprint)}">\n${html}\n`
    + source.slice(close);
}

/**
 * Comprobaciones de una página generada; devuelve los errores. `navHrefs`:
 * enlaces de vistas de la cabecera; `section`: sección de la URL, que debe ir
 * llena; `rows`: filas de tabla del panel de la categoría visible.
 */
export function validatePage(page, { navHrefs, section, rows }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES });
  const main = page.slice(page.search(MAIN_OPEN), page.indexOf('</main>'));
  // Sin marcadores de la capa de carga (js/page-loading.js) ni bloque de gen_og_pages.py.
  if (/class="(?:loading|static-prerender|prerender-loading)[ "]/.test(main)) errors.push('marcador de carga o bloque estático en <main>');
  if (!new RegExp(`data-cx-section="${section}"(?: hidden)? data-prerendered="`).test(main)) errors.push(`sección ${section} sin contenido generado`);
  const painted = main.match(/<tr class="so-row"/g)?.length || 0;
  if (painted !== rows) errors.push(`${painted} filas pintadas de ${rows}`);
  return errors;
}

// Página de torneo generada (con data-prerendered en su <main>): con
// ?view=general, la lista espera oculta bajo la capa de carga
// (js/page-loading.js) hasta que js/ciclocross.js abre la general; si no, la
// página baja al primer día de hoy en adelante, adonde la llevará
// js/ciclocross.js al cargar, sin salto posterior. El desplazamiento espera al
// final del análisis del HTML (antes, el documento aún es corto y lo recorta);
// la cortina de js/theme.js lo oculta hasta que corren los módulos. Fija antes
// las alturas del margen de desplazamiento como js/header.js (cabecera fija) y
// js/ciclocross.js (cabecera del torneo).
export const TOURNAMENT_SCRIPT = '<script id="cxTournamentPrerender">!function(){var r=document.getElementById(\'cxAgendaContent\'),'
  + 'l=document.getElementById(\'cxAgendaList\');if(!r||!l||!r.hasAttribute(\'data-prerendered\'))return;'
  + 'if(new URLSearchParams(location.search).get(\'view\')===\'general\'){var m=document.createElement(\'div\');'
  + 'm.className=\'loading\';m.setAttribute(\'data-cx-view-loading\',\'\');l.hidden=true;l.before(m);return}'
  + 'document.addEventListener(\'readystatechange\',function go(){if(document.readyState===\'loading\')return;'
  + 'document.removeEventListener(\'readystatechange\',go);'
  + 'var d=new Date(),k=d.getFullYear()+\'-\'+String(d.getMonth()+1).padStart(2,\'0\')+\'-\'+String(d.getDate()).padStart(2,\'0\'),'
  + 'days=l.querySelectorAll(\'[data-date]\');for(var i=0;i<days.length;i++)if(days[i].getAttribute(\'data-date\')>=k){'
  + 'var h=r.querySelector(\'.cx-agenda-sticky\'),s=document.getElementById(\'siteHeader\');'
  + 'if(s)document.documentElement.style.setProperty(\'--site-header-h\',(getComputedStyle(s).position===\'sticky\'?s.getBoundingClientRect().height:0)+\'px\');'
  + 'if(h)r.style.setProperty(\'--cx-agenda-nav-h\',h.offsetHeight+\'px\');'
  + 'days[i].scrollIntoView({block:\'start\',behavior:\'instant\'});break}})}()</script>';
const TOURNAMENT_MAIN = /<main id="cxAgendaContent"([^>]*)>/;
const TOURNAMENT_ID = /data-cx-tournament-id="([^"]+)"/;
const TOURNAMENT_ATTRS = /\s(?:data-prerendered|data-cx-tournament-id)="[^"]*"/g;
const OWN_SCRIPT = /<script id="cxTournamentPrerender">[\s\S]*?<\/script>/;

/** Id del torneo de la página: el del <main> (pasada anterior) o el de la cabecera de gen_og_pages.py. */
export function pageTournamentId(source) {
  const main = TOURNAMENT_MAIN.exec(source);
  if (!main) return null;
  return TOURNAMENT_ID.exec(main[1])?.[1] || TOURNAMENT_ID.exec(source.slice(main.index, source.indexOf('</main>', main.index)))?.[1] || null;
}

/**
 * Página de torneo con la cabecera, el calendario y el script en línea
 * generados, o null si la plantilla no tiene la cabecera y el <main>
 * esperados. Sustituye también lo que escribió una pasada anterior.
 */
export function composeTournamentPage(source, { tournamentId, headerInner, html, fingerprint }) {
  const header = HEADER.exec(source);
  const main = TOURNAMENT_MAIN.exec(source);
  if (!header || !main || header.index > main.index) return null;
  const close = source.indexOf('</main>', main.index + main[0].length);
  if (close < 0) return null;
  const rest = source.slice(close + '</main>'.length).replace(OWN_SCRIPT, '');
  return source.slice(0, header.index)
    + `<header class="site-header" id="siteHeader"${header[1]}>${headerInner}</header>`
    + source.slice(header.index + header[0].length, main.index)
    + `<main id="cxAgendaContent"${main[1].replace(TOURNAMENT_ATTRS, '')} data-cx-tournament-id="${attr(tournamentId)}" data-prerendered="${attr(fingerprint)}">\n${html}\n</main>`
    + `\n${TOURNAMENT_SCRIPT}` + rest;
}

/** Comprobaciones de una página de torneo generada: `cards`, tarjetas de la lista. */
export function validateTournamentPage(page, { navHrefs, cards }) {
  const errors = pageErrors(page, { navHrefs, maxBytes: MAX_PAGE_BYTES });
  const main = page.slice(page.search(TOURNAMENT_MAIN), page.indexOf('</main>'));
  if (/class="(?:loading|static-prerender|prerender-loading)[ "]/.test(main)) errors.push('marcador de carga o bloque estático en <main>');
  if (!/<div id="cxAgendaList" data-prerendered="/.test(main)) errors.push('lista sin contenido generado');
  const painted = main.match(/<article class="race-card race-card--cx/g)?.length || 0;
  if (painted !== cards) errors.push(`${painted} tarjetas pintadas de ${cards}`);
  return errors;
}

// ── Proceso por idioma ─────────────────────────────────────────────────────
/** Páginas de ficha del idioma: raíz de cada carrera y sus secciones con página propia. */
function pageFiles(site, lang) {
  const { dir, suffixes } = LANGS[lang];
  const base = join(site, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => ['', ...Object.values(suffixes)].map(suffix => join(base, entry.name, suffix, 'index.html')))
    .filter(file => existsSync(file))
    .sort();
}

/** Páginas de torneo del idioma. */
function tournamentFiles(site, lang) {
  const base = join(site, LANGS[lang].tournaments);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => join(base, entry.name, 'index.html'))
    .filter(file => existsSync(file))
    .sort();
}

// Día local de hoy en la zona del proceso, como today() de js/ciclocross.js.
const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Calendario del torneo: { html, fingerprint, cards } con el esqueleto y la
 * lista, o null sin el torneo. `agendaHtml`: js/cx-agenda-html.js.
 */
export function tournamentPage(index, tournamentId, { agendaHtml, cxTournamentGeneralCategories, fingerprint, todayKey }) {
  const tournament = index.tournaments.get(tournamentId);
  if (!tournament) return null;
  const season = tournament.seasonKey;
  const rows = index.agenda.get(season) || [];
  const list = agendaHtml.cxTournamentDays(tournament.id, rows, cxSeasonMonths(season));
  const card = { rounds: index.rounds(season) };
  const neutral = agendaHtml.cxTournamentListHtml(tournament, list, { ...card, dynamic: false });
  const key = `${tournament.id}|${season}`;
  const standingsVisible = agendaHtml.cxTournamentStandingCategories(tournament).length > 0
    && cxTournamentGeneralCategories(index.standings.get(key) || [], index.states.get(key) || []).length > 0;
  const html = agendaHtml.cxTournamentSkeletonHtml(tournament, { standingsVisible,
    list: { inner: agendaHtml.cxTournamentListHtml(tournament, list, { ...card, dynamic: true, todayKey }), prerendered: fingerprint(neutral) } });
  const cards = list.ownRows.length && !list.tournamentRows.length ? 0 : list.days.reduce((sum, day) => sum + day.races.length, 0);
  return { html, fingerprint: fingerprint(agendaHtml.cxTournamentSkeletonHtml(tournament)), cards };
}

async function runLanguage(lang, site, data) {
  const started = performance.now();
  installBrowserEnv(lang, LANGS[lang].dir);
  const load = file => import(pathToFileURL(join(ROOT, file)).href);
  const { initI18n } = await load('js/i18n.js');
  const { cxTournamentRounds } = await load('js/services/cx-data.js');
  const { cxTournamentGeneralCategories } = await load('js/cx/presentation.js');
  const html = await load('js/cx-race-html.js');
  const agendaHtml = await load('js/cx-agenda-html.js');
  await initI18n();
  const imported = performance.now();
  const index = buildIndex(data, { cxTournamentRounds, cxSeasonBounds });
  const at = new Date();
  const navHrefs = PRIMARY_NAV_ITEMS.map(key => STRINGS[lang][key].href);
  // Vista activa que deduce js/header.js de la ruta de ciclocross.
  const active = CX_HOME ? 'today' : 'cyclocross';
  const result = { lang, pages: 0, scope: 0, generated: 0, tournaments: 0, written: 0, fallbacks: [], errors: [], bytes: [] };
  // Un modelo por carrera para sus tres páginas (raíz, inscritos y resultados).
  const models = new Map();
  for (const file of pageFiles(site, lang)) {
    result.pages++;
    const source = readFileSync(file, 'utf8');
    const name = relative(site, file);
    const raceId = pageRaceId(source);
    // Sin id: aviso de público hispanohablante (EN de una carrera nacional).
    if (!raceId) continue;
    result.scope++;
    const input = raceInputs(index, raceId);
    if (!input) {
      result.fallbacks.push(`${name}: sin datos`);
      continue;
    }
    let outcome;
    try {
      if (!models.has(raceId)) models.set(raceId, html.cxRaceModel(input.race, input.rows, { at }));
      const model = models.get(raceId);
      const pathname = `/${relative(site, dirname(file)).split('\\').join('/')}/`;
      const sel = html.cxRaceSelection(model, { pathname });
      const rendered = html.cxRacePrerenderedHtml(model, sel, htmlFingerprint);
      const header = headerOptions(source, lang);
      const page = composePage(source, { raceId, headerInner: headerHtml({ ...header, active: header.active || active }), ...rendered });
      outcome = page ? { page, sel, model } : null;
    } catch (error) {
      result.fallbacks.push(`${name}: error: ${error.message}`);
      continue;
    }
    if (!outcome) {
      result.fallbacks.push(`${name}: plantilla`);
      continue;
    }
    const { page, sel, model } = outcome;
    // Filas del panel de la categoría visible, el único que se escribe.
    const code = sel.selected.category;
    const rows = sel.page === 'results' ? (model.publishedCategories.includes(code) ? model.results.filter(row => row.category === code).length : 0)
      : sel.page === 'startlist' ? model.inscritos.filter(row => row.category === code).length
        : sel.page === 'general' ? model.standings.filter(row => row.category === code).length : 0;
    result.generated++;
    result.bytes.push(Buffer.byteLength(page));
    result.errors.push(...validatePage(page, { navHrefs, section: sel.page, rows }).map(error => `${name}: ${error}`));
    if (page !== source) {
      writeFileSync(file, page);
      result.written++;
    }
  }
  const todayKey = localToday(at);
  for (const file of tournamentFiles(site, lang)) {
    result.pages++;
    const source = readFileSync(file, 'utf8');
    const name = relative(site, file);
    const tournamentId = pageTournamentId(source);
    if (!tournamentId) continue;
    result.scope++;
    let rendered;
    try {
      rendered = tournamentPage(index, tournamentId, { agendaHtml, cxTournamentGeneralCategories, fingerprint: htmlFingerprint, todayKey });
    } catch (error) {
      result.fallbacks.push(`${name}: error: ${error.message}`);
      continue;
    }
    if (!rendered) {
      result.fallbacks.push(`${name}: sin datos`);
      continue;
    }
    const header = headerOptions(source, lang);
    const page = composeTournamentPage(source, { tournamentId, headerInner: headerHtml({ ...header, active: header.active || active }), ...rendered });
    if (!page) {
      result.fallbacks.push(`${name}: plantilla`);
      continue;
    }
    result.generated++;
    result.tournaments++;
    result.bytes.push(Buffer.byteLength(page));
    result.errors.push(...validateTournamentPage(page, { navHrefs, cards: rendered.cards }).map(error => `${name}: ${error}`));
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
    const child = fork(SCRIPT, ['--worker', lang, site], { serialization: 'advanced', env: { ...process.env, TZ: TIME_ZONES[lang] } });
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
  if (!site) throw new Error('Uso: prerender-cx.mjs <_site> [--scope off|es|all] [--data datos.json]');
  const scope = parseScope(options.scope ?? process.env.PRERENDER_CX);
  if (scope === 'off') {
    console.log('Prerender de carreras CX desactivado (PRERENDER_CX=off)');
    return 0;
  }
  const started = performance.now();
  const data = options.data ? readDump(options.data) : await loadApiData(process.env.SUPABASE_ANON_KEY);
  const loaded = performance.now();
  const results = await Promise.all(SCOPES[scope].langs.map(lang => forkLanguage(lang, resolve(site), data)));
  const total = summarize(results);
  for (const result of results) {
    const sizes = result.bytes.sort((a, b) => a - b);
    const kb = bytes => `${((bytes || 0) / 1024).toFixed(1)} KB`;
    const mb = (sizes.reduce((sum, bytes) => sum + bytes, 0) / 1048576).toFixed(1);
    console.log(`  ${result.lang}: ${result.generated}/${result.scope} generadas (${result.tournaments} de torneo, ${result.written} reescritas, ${result.pages} páginas), `
      + `importación ${seconds(result.importMs || 0)}, pintado ${seconds(result.renderMs || 0)}, `
      + `mediana ${kb(sizes[Math.floor(sizes.length / 2)])}, máximo ${kb(sizes.at(-1))}, total ${mb} MB`);
  }
  for (const fallback of total.fallbacks.slice(0, 20)) console.log(`  Vuelta atrás: ${fallback}`);
  console.log(`Prerender de carreras CX (${scope}): ${total.generated}/${total.scope} (${(total.ratio * 100).toFixed(1)} %), `
    + `${total.fallbacks.length} con vuelta atrás; ${data.races.length} carreras; `
    + `datos ${seconds(loaded - started)}, total ${seconds(performance.now() - started)}`);
  if (total.errors.length) console.log(`::error::Prerender de carreras CX: ${total.errors.length} páginas inválidas: ${total.errors.slice(0, 10).join(' | ')}`);
  if (total.ratio < MIN_RATIO) console.log(`::error::Prerender de carreras CX: ${total.generated} de ${total.scope} generadas (mínimo ${MIN_RATIO * 100} %)`);
  return total.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { if (code) process.exitCode = code; }, error => {
    console.log(`::error::Prerender de carreras CX: ${error.message}`);
    process.exitCode = 1;
  });
}
