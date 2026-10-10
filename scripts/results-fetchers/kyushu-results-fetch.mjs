#!/usr/bin/env node
/**
 * Tour de Kyushu — comunicados oficiales en PDF con LAPCLIP como provisional.
 *
 * El organizador publica en sus noticias un aviso por etapa («STAGE <n> … –
 * リザルトのお知らせ» / «– Results») que enlaza el comunicado de los comisarios:
 * llegada, general individual (con bonificaciones y jóvenes en la columna Y),
 * puntos, montaña y equipos, de etapa y generales. El aviso llega entre una y
 * cuatro horas después de la meta y no siempre se publica (etapa 1 de 2025).
 *
 * Mientras no hay comunicado de la etapa, se emite la llegada provisional de
 * LAPCLIP (lapclip-results-fetch.mjs) con las mismas claves: el comunicado la
 * sustituye en cuanto aparece. Cada clasificación declara su procedencia.
 *
 * Descubrimiento, en este orden y sin inferir nombres de archivo:
 * 1. Mapa de noticias de WordPress (fecha de modificación de cada aviso) →
 *    título del aviso → PDF enlazado en `uploads/<año>/`.
 * 2. Páginas de resultados del organizador (`/results/<sede>/`, `/en/results-en/
 *    <sede>/`), que enlazan los comunicados de `assets/pdf/communique/`. Las
 *    páginas se localizan por los mapas del sitio, sin fijar el slug: cualquier
 *    página con «result» en la ruta o modificada desde el día de la etapa, más
 *    los enlaces a otras páginas de resultados que ellas contengan. Cada PDF
 *    se asigna a la etapa por su contenido (etapa, edición y fecha).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
import { buildStage, classify, fetchRows } from './lapclip-results-fetch.mjs';
export { suggestCompetitionId } from './pdf-results-ids.mjs';

const SITE = 'https://tourdekyushu.asia';
export const NEWS_SITEMAPS = [`${SITE}/wp-sitemap-posts-news-1.xml`, `${SITE}/en/wp-sitemap-posts-news-1.xml`];
const UA = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
export const SITEMAP_INDEX = `${SITE}/wp-sitemap.xml`;
// Mapas que no listan páginas con comunicados (las noticias se leen aparte).
const SKIPPED_SITEMAPS = /wp-sitemap-(?:users|taxonomies|posts-news|posts-teams)/;
const MAX_PAGES = 40;
const FINAL_SLOT = 99;
const log = (message) => process.stderr.write(`${message}\n`);
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const clean = (value) => String(value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const decodeHtml = (value) => clean(String(value ?? '').replace(/<[^>]+>/g, ' ')
  .replace(/&#8211;|&#8212;/g, '–').replace(/&amp;|&#038;/gi, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'"));

/** Avisos del mapa de noticias modificados desde `since` (YYYY-MM-DD). */
export function sitemapEntries(xml, since) {
  return [...String(xml).matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((match) => ({ url: match[1], lastmod: match[2] || '' }))
    .filter((entry) => entry.lastmod.slice(0, 10) >= since);
}

/** PDF de resultados de la etapa si el aviso lo es: título «STAGE n … Results / リザルト». */
export function resultsPdfFromPost(html, stageNumber, year) {
  const title = decodeHtml(String(html).match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const stage = Number(title.match(/\bSTAGE\s*(\d+)(?!\d)/i)?.[1]);
  if (stage !== stageNumber || !/リザルト|成績|\bResults?\b/i.test(title)) return null;
  const links = [...new Set([...String(html).matchAll(/href=["']([^"']+\/uploads\/(\d{4})\/\d{2}\/[^"']+\.pdf)["']/gi)]
    .filter((match) => Number(match[2]) === year).map((match) => match[1]))];
  if (links.length > 1) throw new Error(`el aviso «${title}» enlaza ${links.length} PDF`);
  return links[0] ? { title, url: links[0] } : null;
}

// ── tiempos ─────────────────────────────────────────────────────────────────
/** Segundos de `2:36'06"`, `8'36"`, `0"` o `0:00'59"`; null si no es un tiempo. */
export function seconds(value) {
  const match = clean(value).match(/^(?:(?:(\d+):)?(\d{1,2})')?(\d{1,2})"$/);
  if (!match) return null;
  return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60 + Number(match[3]);
}

const absolute = (total) => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

function gap(total) {
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = String(total % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : m ? `+${m}:${s}` : `+${s}`;
}

/** Filas con tiempo absoluto: el primero lleva el tiempo, el resto la diferencia. */
function timedRows(entries) {
  const winner = entries[0]?.total;
  return entries.map((entry, index) => {
    const rank = index + 1;
    if (entry.rank !== rank) throw new Error(`puesto ${entry.rank} fuera de orden (se esperaba ${rank})`);
    if (entry.total < winner) throw new Error(`puesto ${rank}: tiempo menor que el del primero`);
    if (entry.behind != null && entry.behind !== entry.total - winner) {
      throw new Error(`puesto ${rank}: la diferencia publicada no cuadra con el tiempo`);
    }
    const value = rank === 1 ? absolute(entry.total) : gap(entry.total - winner);
    return { rank, rankText: String(rank), bib: entry.bib, ...(entry.identity || {}), resultValue: value,
      timeText: rank === 1 ? value : null, gapText: rank === 1 ? null : value, points: null, irm: null };
  });
}

// ── secciones del comunicado ────────────────────────────────────────────────
function section(text, start, end) {
  const from = text.search(start);
  if (from < 0) return null;
  const tail = text.slice(from);
  const to = end ? tail.slice(1).search(end) : -1;
  return to < 0 ? tail : tail.slice(0, to + 1);
}

const lines = (block) => String(block || '').split(/\r?\n/);
const TIME = String.raw`(?:\d+:)?\d{1,2}'\d{2}"|\d{1,2}"`;

/**
 * Fila de corredor: puesto, dorsal, ID UCI, «APELLIDO Nombre / 名前 (PAÍS)» y
 * código de equipo. Un nombre largo continúa en la línea siguiente y entonces
 * la primera no lleva el país: el equipo es el primer código de tres
 * caracteres fuera de paréntesis tras el nombre japonés.
 */
export function riderLine(line) {
  const match = String(line).match(/^\s*(\d+)\s+(\d+)\s+(\d{11})\s+(.+?)\s+\/\s+(.*)$/);
  if (!match) return null;
  const team = match[5].match(/(?:^|\s)([A-Z][A-Z0-9]{2})(?=\s)/);
  if (!team) throw new Error(`dorsal ${match[2]}: fila sin código de equipo`);
  return { rank: Number(match[1]), bib: String(Number(match[2])), uciId: match[3], name: clean(match[4]),
    team: team[1], rest: match[5].slice(team.index + team[0].length) };
}

/** Identidad del corredor: nombre latino, ID UCI y equipo. */
const identity = (rider, teams) => ({ riderDisplay: rider.name, uciId: rider.uciId, teamName: teams.get(rider.team) || rider.team });

function stageRows(block, teams) {
  const finishers = [], others = [];
  for (const line of lines(block)) {
    const rider = riderLine(line);
    if (rider) {
      const times = rider.rest.match(new RegExp(`(${TIME})\\s+(${TIME})(?:\\s+\\d+)?\\s*$`));
      if (!times) throw new Error(`etapa: fila sin tiempo, dorsal ${rider.bib}`);
      finishers.push({ rank: rider.rank, bib: rider.bib, total: seconds(times[1]), behind: seconds(times[2]), identity: identity(rider, teams) });
      continue;
    }
    const irm = line.match(/^\s*(DNF|DNS|OTL|DSQ|HD)\s+(\d+)\s+\d{11}\b/);
    if (irm) {
      const code = irm[1] === 'HD' ? 'OTL' : irm[1];
      others.push({ rank: null, rankText: code, bib: String(Number(irm[2])), resultValue: null, timeText: null, gapText: null, points: null, irm: code });
    }
  }
  return [...timedRows(finishers), ...others];
}

/** General individual y jóvenes (columna Y: puesto entre los jóvenes). */
function generalRows(block, teams) {
  const general = [], youth = [];
  for (const line of lines(block)) {
    const rider = riderLine(line);
    if (!rider) continue;
    const cols = rider.rest.match(new RegExp(`\\(\\d+\\)\\s+(?:${TIME})\\s+.*?(${TIME})\\s+(${TIME})(?:\\s+(\\d+))?\\s*$`));
    if (!cols) throw new Error(`general: fila sin total, dorsal ${rider.bib}`);
    const entry = { rank: rider.rank, bib: rider.bib, total: seconds(cols[1]), behind: seconds(cols[2]), identity: identity(rider, teams) };
    general.push(entry);
    if (cols[3]) youth.push({ ...entry, rank: Number(cols[3]), behind: null });
  }
  return { general: timedRows(general), youth: timedRows(youth.sort((a, b) => a.rank - b.rank)) };
}

function pointsRows(block, label) {
  const rows = [];
  for (const line of lines(block)) {
    // El ID UCI de la montaña general sale recortado a diez cifras.
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+\d{9,11}\s+\S.*?\s(\d+)\s*$/);
    if (!match) continue;
    const rank = Number(match[1]), points = Number(match[3]);
    if (rank !== rows.length + 1) throw new Error(`${label}: puesto ${rank} fuera de orden`);
    rows.push({ rank, rankText: String(rank), bib: String(Number(match[2])), resultValue: String(points), timeText: String(points), gapText: null, points, irm: null });
  }
  return rows;
}

/** Equipos de la general por equipos: código y nombre latino. */
function teamRows(block) {
  const entries = [];
  for (const line of lines(block)) {
    const match = line.match(new RegExp(`^\\s*(\\d+)\\s+([A-Z0-9]{3})\\s+(.+?)\\s+/\\s.*?(${TIME})\\s+(${TIME})(?:\\s+(${TIME}))?\\s*$`));
    if (!match) continue;
    entries.push({ rank: Number(match[1]), code: match[2], name: clean(match[3]), total: seconds(match[5]), behind: match[6] ? seconds(match[6]) : 0 });
  }
  return entries;
}

function classification(competitionId, slot, classKind, scope, eventName, rows, isTeamEvent = false) {
  if (!rows.length || rows[0].rank !== 1) throw new Error(`${eventName}: sin ganador`);
  const ids = rows.map((row) => isTeamEvent ? row.teamName : row.bib);
  if (new Set(ids).size !== ids.length) throw new Error(`${eventName}: filas duplicadas`);
  return { eventId: synthEventId(competitionId, slot, classKind), classKind, scope, eventName, isTeamEvent,
    ...(isTeamEvent ? { winnerName: rows[0].teamName } : {}), rowCount: rows.length, rows,
    publication: { provider: 'kyushu', format: 'pdf' } };
}

/** Fecha del comunicado («13 Oct 2025») en YYYY-MM-DD. */
function communiqueDate(text) {
  const match = String(text).match(/COMMUNIQUE No\.[\d-]+\s+(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})/);
  const month = match && MONTHS[match[2].toUpperCase()];
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

export function parsePdf(text, { year, stageNumber, competitionId, expectedDate = null, totalStages = null, sourcePdfUrl = null }) {
  if (!new RegExp(`Tour de Kyushu ${year}`, 'i').test(text)) throw new Error(`el PDF no es del Tour de Kyushu ${year}`);
  const stages = [...text.matchAll(/Stage Results Stage (\d+)|After Stage (\d+)/g)].map((match) => Number(match[1] || match[2]));
  const wrong = stages.find((value) => value !== stageNumber);
  if (!stages.length || wrong != null) throw new Error(`el PDF corresponde a la etapa ${wrong ?? '?'}, no a la ${stageNumber}`);
  const date = communiqueDate(text);
  if (!date) throw new Error('el PDF no contiene la fecha del comunicado');
  if (expectedDate && date !== expectedDate) throw new Error(`el comunicado es del ${date} y la etapa del ${expectedDate}`);

  const teamsBlock = section(text, /General Team Time Classification/, /Panel of Commissaires/);
  const teamEntries = teamRows(teamsBlock);
  const teams = new Map(teamEntries.map((team) => [team.code, `${team.code} - ${team.name}`]));
  const stageBlock = section(text, /Stage Results Stage \d+/, /General Individual Time Classification/);
  const gcBlock = section(text, /General Individual Time Classification/, /Points Classification/);
  const pointsBlock = section(text, /General Individual Points Classification/, /Panel of Commissaires/);
  const komBlock = section(text, /General KOM Classification/, /Panel of Commissaires/);
  if (!stageBlock || !gcBlock) throw new Error('el PDF no contiene llegada y general');

  const { general, youth } = generalRows(gcBlock, teams);
  const classifications = [
    classification(competitionId, stageNumber, 'stage', 'stage', 'Stage Classification', stageRows(stageBlock, teams)),
    classification(competitionId, stageNumber, 'gc', 'stage', 'General Classification', general),
  ];
  if (pointsBlock) classifications.push(classification(competitionId, stageNumber, 'points', 'overall', 'Overall Points Classification', pointsRows(pointsBlock, 'puntos')));
  if (komBlock) classifications.push(classification(competitionId, stageNumber, 'kom', 'overall', 'Overall Mountains Classification', pointsRows(komBlock, 'montaña')));
  if (youth.length) classifications.push(classification(competitionId, stageNumber, 'youth', 'overall', 'Overall Youth Classification', youth));
  if (teamEntries.length) {
    const rows = timedRows(teamEntries).map((row, index) => ({ ...row, bib: null, teamName: teams.get(teamEntries[index].code), riderDisplay: teams.get(teamEntries[index].code) }));
    classifications.push(classification(competitionId, stageNumber, 'teams', 'overall', 'Overall Teams Classification', rows, true));
  }

  const stage = { uciRaceId: synthRaceId(competitionId, stageNumber), stageNumber, stageName: `Stage ${stageNumber}`, dateKey: date,
    raceType: null, isFinalClassification: false, sourcePdfUrl, classifications };
  const final = totalStages != null && stageNumber === totalStages
    ? { uciRaceId: synthRaceId(competitionId, FINAL_SLOT), stageNumber: null, stageName: 'Final Classification', dateKey: date,
        raceType: null, isFinalClassification: true, sourcePdfUrl,
        classifications: classifications.filter((item) => item.classKind !== 'stage')
          .map((item) => ({ ...item, scope: 'stage', eventId: synthEventId(competitionId, FINAL_SLOT, item.classKind) })) }
    : null;
  return { stage, final };
}

// ── red ─────────────────────────────────────────────────────────────────────
async function fetchNoCache(url, type = 'text') {
  const target = new URL(url);
  target.searchParams.set('_', String(Date.now()));
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return type === 'arrayBuffer' ? response.arrayBuffer() : response.text();
}

async function pdfToText(url) {
  const dir = mkdtempSync(join(tmpdir(), 'kyushu-results-'));
  const file = join(dir, 'results.pdf');
  try {
    writeFileSync(file, Buffer.from(await fetchNoCache(url, 'arrayBuffer')));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Comunicado de la etapa entre los avisos modificados desde el día de la etapa
 * (la fecha local del mapa). La versión japonesa se publica antes; la inglesa
 * solo se consulta si aquella aún no lo tiene.
 */
export async function findResultsPdf({ stageNumber, year, stageDate, fetchText = fetchNoCache }) {
  for (const sitemap of NEWS_SITEMAPS) {
    const found = new Map();
    for (const entry of sitemapEntries(await fetchText(sitemap), stageDate)) {
      const hit = resultsPdfFromPost(await fetchText(entry.url), stageNumber, year);
      if (hit) found.set(hit.url, hit);
    }
    if (found.size > 1) throw new Error(`la etapa ${stageNumber} tiene ${found.size} comunicados distintos: ${[...found.keys()].join(', ')}`);
    if (found.size) return [...found.values()][0];
  }
  return null;
}

// ── páginas de resultados con comunicados en la carpeta del tema ────────────
/** Direcciones de un índice de mapas del sitio (`<sitemap><loc>`). */
export function sitemapLocs(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

/**
 * Páginas candidatas de un mapa del sitio: las que llevan «result» en la ruta
 * (sea cual sea el slug de la sede) y las modificadas desde `since`. El mapa del
 * organizador lista todas las páginas publicadas, también las que no enlaza
 * ningún índice.
 */
export function resultPages(entries, since) {
  const urls = entries.filter((entry) => {
    try { return /result/i.test(new URL(entry.url).pathname) || (entry.lastmod || '').slice(0, 10) >= since; } catch { return false; }
  }).map((entry) => entry.url);
  return [...new Set(urls)];
}

const hrefs = (html, base) => [...String(html).matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((match) => {
  try { return new URL(match[1].replace(/&(?:amp|#038);/g, '&'), base); } catch { return null; }
}).filter(Boolean);

/** PDF de la carpeta `assets/pdf/communique/` enlazados desde una página. */
export function communiqueLinks(html, base) {
  const urls = hrefs(html, base)
    .filter((url) => /\.pdf$/i.test(url.pathname) && /\/assets\/pdf\/communique\//i.test(url.pathname))
    .map((url) => { url.search = ''; return url.href; });
  return [...new Set(urls)];
}

/** Otras páginas del mismo sitio con «result» en la ruta (sin ficheros). */
export function resultPageLinks(html, base) {
  const host = new URL(base).host;
  const urls = hrefs(html, base)
    .filter((url) => url.host === host && /result/i.test(url.pathname) && !/\.[a-z0-9]{2,5}$/i.test(url.pathname))
    .map((url) => { url.search = ''; return url.href; });
  return [...new Set(urls)];
}

/** Edición, etapas y fecha que declara un comunicado; null si no es del Tour de Kyushu del año. */
export function communiqueStage(text, year) {
  if (!new RegExp(`Tour de Kyushu ${year}`, 'i').test(text)) return null;
  const stages = [...new Set([...String(text).matchAll(/Stage Results Stage (\d+)|After Stage (\d+)/g)].map((match) => Number(match[1] || match[2])))];
  return { stages, date: communiqueDate(text) };
}

// Secciones que `parsePdf` toma de un único bloque; repetidas en dos PDF son ambiguas.
const SECTIONS = [/Stage Results Stage \d+/, /General Individual Time Classification/, /General Individual Points Classification/,
  /General KOM Classification/, /General Team Time Classification/];

/** Une los PDF de una etapa (uno completo o repartidos por clasificación) en un texto. */
export function combineCommuniques(docs) {
  for (const section of SECTIONS) {
    const holders = docs.filter((doc) => section.test(doc.text));
    if (holders.length > 1) throw new Error(`«${section.source}» figura en ${holders.length} comunicados: ${holders.map((doc) => doc.url).join(', ')}`);
  }
  const ordered = [...docs].sort((a, b) => Number(SECTIONS[0].test(b.text)) - Number(SECTIONS[0].test(a.text)));
  return { urls: ordered.map((doc) => doc.url), text: ordered.map((doc) => doc.text).join('\n') };
}

/**
 * Comunicados de la etapa publicados en las páginas de resultados. Recorre las
 * páginas candidatas del mapa del sitio y, un nivel más, las páginas de
 * resultados que enlacen; descarta los PDF de otra etapa, edición o fecha.
 */
export async function findCommuniques({ stageNumber, year, stageDate, fetchText = fetchNoCache, readPdf = pdfToText }) {
  const entries = [];
  for (const sitemap of sitemapLocs(await fetchText(SITEMAP_INDEX)).filter((url) => !SKIPPED_SITEMAPS.test(url))) {
    try { entries.push(...sitemapEntries(await fetchText(sitemap), '')); } catch (error) { log(`⚠ ${sitemap}: ${error.message}`); }
  }
  const queue = resultPages(entries, stageDate);
  const seen = new Set(queue);
  const pdfs = new Set();
  for (let index = 0; index < queue.length && index < MAX_PAGES; index += 1) {
    let html;
    try { html = await fetchText(queue[index]); } catch (error) { log(`⚠ ${queue[index]}: ${error.message}`); continue; }
    for (const url of communiqueLinks(html, queue[index])) pdfs.add(url);
    for (const link of resultPageLinks(html, queue[index])) {
      if (!seen.has(link)) { seen.add(link); queue.push(link); }
    }
  }
  const docs = [];
  for (const url of pdfs) {
    const text = await readPdf(url);
    const info = communiqueStage(text, year);
    if (info && info.stages.length === 1 && info.stages[0] === stageNumber && info.date === stageDate) docs.push({ url, text });
  }
  log(`etapa ${stageNumber}: ${Math.min(queue.length, MAX_PAGES)} páginas de resultados, ${pdfs.size} PDF de comunicados, ${docs.length} de la etapa`);
  return docs.length ? combineCommuniques(docs) : null;
}

/**
 * Comunicado oficial de la etapa: primero el aviso de las noticias y, si no
 * existe, las páginas de resultados. Un fallo de consulta de una vía no impide
 * la otra ni la llegada provisional de LAPCLIP; un comunicado encontrado en las
 * noticias e ilegible sí detiene el volcado.
 */
export async function findOfficialResults({ fetchText = fetchNoCache, readPdf = pdfToText, ...target }) {
  const attempt = async (label, run) => {
    try { return await run(); } catch (error) {
      log(`⚠ etapa ${target.stageNumber}: ${label} no disponibles (${error.message})`);
      return null;
    }
  };
  const post = await attempt('noticias del organizador', () => findResultsPdf({ ...target, fetchText }));
  if (post) return { urls: [post.url], text: await readPdf(post.url) };
  return attempt('páginas de resultados del organizador', () => findCommuniques({ ...target, fetchText, readPdf }));
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
  const raceId = arg('--race-id');
  if (argv.includes('--suggest-id')) {
    if (!raceId) throw new Error('--suggest-id requiere --race-id');
    process.stdout.write(`${suggestCompetitionId(raceId)}\n`); return;
  }
  const year = Number(arg('--year'));
  const competitionId = Number(arg('--competition-id'));
  if (!(year >= 2000)) throw new Error('falta --year');
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo');
  const stageDates = arg('--stage-dates') ? JSON.parse(arg('--stage-dates')) : {};
  const stageNumber = arg('--stage') ? Number(arg('--stage'))
    : Number(Object.keys(stageDates).find((key) => stageDates[key] === arg('--date')));
  if (!(stageNumber > 0)) throw new Error('falta --stage o una --date presente en --stage-dates');
  const stageDate = stageDates[String(stageNumber)] || arg('--date');
  if (!stageDate) throw new Error(`sin fecha para la etapa ${stageNumber}`);
  const totalStages = arg('--total-stages') ? Number(arg('--total-stages')) : null;
  const lapclipCode = arg('--lapclip-code', `tdk${year}`);
  // --fixture: { "pdfText": "<texto de pdftotext -layout>", "pdfUrl": "<url>" } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;

  const stages = [];
  const official = fixture ? (fixture.pdfText ? { urls: [fixture.pdfUrl || 'fixture.pdf'], text: fixture.pdfText } : null)
    : await findOfficialResults({ stageNumber, year, stageDate });
  if (official) {
    const parsed = parsePdf(official.text,
      { year, stageNumber, competitionId, expectedDate: stageDate, totalStages, sourcePdfUrl: official.urls[0] });
    log(`✓ etapa ${stageNumber}: comunicado oficial ${official.urls.join(' + ')} (${parsed.stage.classifications.map((c) => `${c.classKind}/${c.scope}:${c.rowCount}`).join(' ')})`);
    stages.push(parsed.stage);
    if (parsed.final) stages.push(parsed.final);
  } else {
    // Sin comunicado: llegada provisional de LAPCLIP con las mismas claves.
    const { title, rows } = await fetchRows(lapclipCode, { stageNumber });
    const verdict = classify(rows, { dateKey: stageDate, startUtc: arg('--start-utc'), neutralStartUtc: arg('--neutral-start-utc') });
    log(`${verdict.rows.length ? '✓' : '∅'} etapa ${stageNumber}: sin comunicado; LAPCLIP ${lapclipCode} (${title}): ${verdict.reason}`);
    if (verdict.rows.length) {
      const stage = buildStage(verdict.rows, { competitionId, dateKey: stageDate, stageNumber });
      stage.classifications = stage.classifications.map((item) => ({ ...item, publication: { provider: 'lapclip', format: 'progressive' } }));
      stages.push(stage);
    }
  }

  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: 'kyushu', fetchedAt: new Date().toISOString(), stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
}
