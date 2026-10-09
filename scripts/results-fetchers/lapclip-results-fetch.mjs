#!/usr/bin/env node
/**
 * Clasificación de carreras de un día en circuito cronometradas por Matrix
 * Sports (LAPCLIP, `matrix-sports.jp/lap/result.php?evt=<evento>&ctg=<categoría>`),
 * p. ej. la Oita Urban Classic.
 *
 * LAPCLIP publica en directo, por transpondedor, vueltas y tiempo con milésimas
 * de cada corredor, ordenados por vueltas y tiempo. No publica estados: el
 * corredor que no completa todas las vueltas es un abandono y el que no completa
 * ninguna, sin puesto, no tomó la salida. Contrastado con DataRide en la Oita
 * Urban Classic 2025: mismo orden, DNF y DNS.
 *
 * LAPCLIP no indica el total de vueltas; lo aporta el código. La clasificación
 * se emite cuando el primero completa todas las vueltas. El tiempo oficial se
 * reconstruye con la regla de grupo: un corredor a menos de un segundo del
 * anterior recibe su tiempo; los tiempos se truncan a segundos. Los abandonos y
 * no salidos se emiten pasado un margen desde la llegada estimada del ganador,
 * cuando ya no queda nadie en carrera.
 *
 * Vueltas por etapas (p. ej. el Tour de Kyushu): el evento agrupa una categoría
 * por etapa titulada `STAGE <n> …`, sin fecha en el título. La llegada se marca
 * `FINISH` y los tiempos llevan centésimas. Quien registra algún paso sin llegar
 * es abandono; quien no registra ninguno no distingue abandono de no salida en
 * una etapa en línea y se omite. Contrastado con DataRide en el Tour de Kyushu
 * 2024 y 2025: mismo orden y tiempos salvo decisiones posteriores del jurado.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
export { suggestCompetitionId } from './pdf-results-ids.mjs';

const BASE = 'https://matrix-sports.jp/lap';
const FINAL_SLOT = 99;   // mismo hueco que el placeholder manual de un día del panel
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// Diferencia máxima con el anterior para recibir su tiempo (regla de grupo).
const GROUP_GAP_MS = 1000;
// Margen desde la llegada estimada del ganador para dar por cerrada la carrera.
export const CLOSE_MARGIN_MIN = 20;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; calendariociclismo.app results sync; +https://calendariociclismo.app)';
const log = (value) => process.stderr.write(`${value}\n`);

/**
 * lapclipCode: `<evento>/<categoría>/<vueltas>` en circuito (261004_oita/200/13)
 * o `<evento>` terminado en el año en una vuelta por etapas (tdk2026).
 */
export function parseCode(code) {
  const stages = String(code || '').trim().match(/^[A-Za-z][A-Za-z0-9_-]*?(20\d{2})$/);
  if (stages) return { event: stages[0], year: Number(stages[1]), category: null, laps: null, stages: true };
  const match = String(code || '').trim().match(/^((\d{2})(\d{2})(\d{2})_[A-Za-z0-9_-]+)\/([0-9]{3}(?:-[0-9]+)?)\/([1-9][0-9]{0,2})$/);
  if (!match) throw new Error(`lapclipCode no válido: ${code}`);
  return { event: match[1], year: 2000 + Number(match[2]), category: match[5], laps: Number(match[6]), stages: false };
}

/**
 * Fecha de la categoría: el título empieza por `[M/D]`. El evento agrupa todo
 * el festival y su prefijo es la fecha del día principal, no la de cada prueba.
 */
export function categoryDate(title, year) {
  const match = String(title).match(/^\[(\d{1,2})\/(\d{1,2})\]/);
  if (!match) throw new Error(`la categoría no indica su fecha: «${title}»`);
  return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

export function resultUrl(event, category = null) {
  return `${BASE}/result.php?${new URLSearchParams({ evt: event, ...(category ? { ctg: category } : {}) })}`;
}

export function pageUrl(event, category, page) {
  return `${BASE}/nextresults.php?${new URLSearchParams({ evt: event, ctg: category, page: String(page) })}`;
}

const decode = (value) => String(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** Título de la categoría activa; con una categoría inexistente la página no marca ninguna. */
export function activeCategory(html, code) {
  const { event, category } = parseCode(code);
  const href = `result.php?evt=${event}&amp;ctg=${category}`;
  const match = String(html).match(new RegExp(`<a href="(?:${escapeRe(href)}|${escapeRe(href.replace('&amp;', '&'))})" class="active">([^<]*)</a>`));
  if (!match) throw new Error(`el evento ${event} no ofrece la categoría ${category}`);
  return decode(match[1]);
}

/** Categoría de la etapa: el menú del evento titula cada una `STAGE <n> …`. */
export function stageCategory(html, event, stageNumber) {
  const links = [...String(html).matchAll(/<a href="result\.php\?evt=([^&"]+)&(?:amp;)?ctg=([^"&]+)"(?: class="active")?>([^<]*)<\/a>/g)]
    .filter((match) => match[1] === event)
    .map((match) => ({ category: match[2], title: decode(match[3]) }));
  const found = links.filter((link) => Number(link.title.match(/^STAGE\s*(\d+)(?!\d)/i)?.[1]) === stageNumber);
  if (found.length !== 1) throw new Error(`el evento ${event} ofrece ${found.length} categorías para la etapa ${stageNumber}`);
  return found[0];
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Milisegundos de `H:MM:SS.mmm` o `H:MM:SS.cc`; null en `-:--:--.---`. */
export function parseLapTime(value) {
  const text = String(value).trim();
  if (/^-:--:--(\.-+)?$/.test(text)) return null;
  const match = text.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2,3})$/);
  if (!match) throw new Error(`tiempo no válido «${text}»`);
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, '0'));
}

/**
 * Filas del listado: puesto publicado, dorsal, vueltas, llegada y tiempo
 * acumulado. La marca de vueltas es `N周`, `N/M周` o `FINISH`; sin ningún paso,
 * la fila la omite.
 */
export function parseRows(html) {
  const rows = [];
  const blocks = String(html).split(/<a href="#" class="result"/).slice(1);
  for (const block of blocks) {
    const spans = [...block.matchAll(/<span class="nwb?">([\s\S]*?)<\/span>/g)].map((match) => decode(match[1]));
    if (spans.length !== 5 && spans.length !== 6) throw new Error(`fila incompleta: ${decode(block).slice(0, 80)}`);
    const [place, bibText, name] = spans;
    const [lapsText, time] = spans.length === 6 ? spans.slice(3) : [null, spans[3]];
    const bib = bibText.match(/^No\.(\d+)$/)?.[1];
    if (!bib) throw new Error(`fila sin dorsal: ${bibText}`);
    const finish = lapsText === 'FINISH';
    const laps = finish ? null : lapsText == null ? 0 : lapsText.match(/^(\d+)(?:\/\d+)?周$/)?.[1];
    if (laps === undefined) throw new Error(`dorsal ${bib}: vueltas no válidas «${lapsText}»`);
    const rank = place.match(/^(\d+)位$/)?.[1];
    if (!rank && place !== '-') throw new Error(`dorsal ${bib}: puesto no reconocido «${place}»`);
    const ms = parseLapTime(time);
    if (finish && ms == null) throw new Error(`dorsal ${bib}: llegada sin tiempo`);
    rows.push({ place: rank ? Number(rank) : null, bib: String(Number(bib)), name, laps: laps == null ? null : Number(laps), finish, ms });
  }
  return rows;
}

const timeText = (seconds) => {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function gapText(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = String(seconds % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : m ? `+${m}:${s}` : `+${s}`;
}

/**
 * Estado de la carrera según el listado. `laps` null: etapa en línea, terminada
 * por la marca FINISH.
 * Devuelve { status: 'empty' | 'racing' | 'finished', finishers, others, winnerMs }.
 */
export function assessRows(rows, laps = null) {
  const bibs = rows.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('dorsales duplicados');
  if (!rows.some((row) => row.finish || row.laps > 0)) return { status: 'empty', finishers: [], others: rows };
  const done = (row) => row.finish || (laps != null && row.laps === laps);
  const leader = rows[0];
  if (laps != null && rows.some((row) => row.laps > laps)) throw new Error(`hay corredores con más de ${laps} vueltas: revisar el código`);
  if (!done(leader)) return { status: 'racing', finishers: [], others: rows, leaderLaps: leader.laps };
  const finishers = rows.filter(done);
  if (rows.slice(0, finishers.length).some((row) => !done(row))) throw new Error('el listado no ordena primero a los que completan todas las vueltas');
  finishers.forEach((row, index) => {
    if (row.ms == null) throw new Error(`dorsal ${row.bib}: llegada sin tiempo`);
    if (index && row.ms < finishers[index - 1].ms) throw new Error(`dorsal ${row.bib}: tiempo menor que el del anterior`);
  });
  return { status: 'finished', finishers, others: rows.slice(finishers.length), winnerMs: finishers[0].ms };
}

/** Puesto y tiempo oficiales de los llegados, con regla de grupo y truncado a segundos. */
export function finisherRows(finishers) {
  let groupSeconds = null;
  const winnerSeconds = Math.floor(finishers[0].ms / 1000);
  return finishers.map((row, index) => {
    if (!index || row.ms - finishers[index - 1].ms >= GROUP_GAP_MS) groupSeconds = Math.floor(row.ms / 1000);
    const rank = index + 1;
    if (!index) {
      const absolute = timeText(groupSeconds);
      return { rank, rankText: String(rank), bib: row.bib, resultValue: absolute, timeText: absolute, gapText: null, points: null, irm: null };
    }
    const gap = gapText(groupSeconds - winnerSeconds);
    return { rank, rankText: String(rank), bib: row.bib, resultValue: gap, timeText: null, gapText: gap, points: null, irm: null };
  });
}

/**
 * DNF a quien completó alguna vuelta; DNS a quien no completó ninguna. En una
 * etapa en línea, DNF a quien registró algún paso; sin paso, la fila se omite.
 */
export function nonFinisherRows(others, { stages = false } = {}) {
  return others.flatMap((row) => {
    if (stages && !(row.laps > 0 || row.ms != null)) return [];
    const irm = stages || row.laps > 0 ? 'DNF' : 'DNS';
    return { rank: null, rankText: irm, bib: row.bib, resultValue: null, timeText: null, gapText: null, points: null, irm };
  });
}

/**
 * Momento estimado de la llegada del ganador: salida real o neutralizada de la
 * jornada más su tiempo. Sin horario, null.
 */
export function winnerFinishAt({ winnerMs, startUtc = null, neutralStartUtc = null }) {
  const start = [startUtc, neutralStartUtc].map((value) => Date.parse(value)).find(Number.isFinite);
  return start == null ? null : start + winnerMs;
}

export function buildStage(rows, { competitionId, dateKey, stageNumber = null }) {
  if (stageNumber != null) {
    return {
      uciRaceId: synthRaceId(competitionId, stageNumber), stageNumber, stageName: `Stage ${stageNumber}`, dateKey,
      raceType: null, isFinalClassification: false,
      classifications: [{
        eventId: synthEventId(competitionId, stageNumber, 'stage'), classKind: 'stage', scope: 'stage',
        eventName: 'Stage Classification', isTeamEvent: false, rowCount: rows.length, rows,
      }],
    };
  }
  return {
    uciRaceId: synthRaceId(competitionId, FINAL_SLOT), stageNumber: null, dateKey, raceType: 'IRR',
    isFinalClassification: false, eventName: 'Race Classification',
    classifications: [{
      eventId: synthEventId(competitionId, FINAL_SLOT, 'gc'), classKind: 'gc', scope: 'stage',
      eventName: 'Race Classification', isTeamEvent: false, rowCount: rows.length, rows,
    }],
  };
}

/**
 * Decide qué se publica. Devuelve { rows, reason }; rows vacío si aún no hay
 * clasificación publicable.
 */
export function classify(rows, { laps = null, dateKey, startUtc = null, neutralStartUtc = null, now = Date.now() }) {
  const state = assessRows(rows, laps);
  if (state.status === 'empty') return { rows: [], reason: 'sin pasos registrados' };
  if (state.status === 'racing') {
    return { rows: [], reason: laps == null ? 'carrera en curso: sin llegados' : `carrera en curso: el primero lleva ${state.leaderLaps}/${laps} vueltas` };
  }
  const finishAt = winnerFinishAt({ winnerMs: state.winnerMs, startUtc, neutralStartUtc });
  if (finishAt != null && finishAt > now + CLOCK_SKEW_MS) {
    throw new Error(`la llegada estimada del ganador (${new Date(finishAt).toISOString()}) es futura: datos de prueba o de otra carrera`);
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const closed = finishAt != null ? now >= finishAt + CLOSE_MARGIN_MIN * 60000 : dateKey < today;
  const out = finisherRows(state.finishers);
  if (!closed) return { rows: out, reason: `${out.length} llegados; abandonos pendientes de cierre` };
  return { rows: [...out, ...nonFinisherRows(state.others, { stages: laps == null })], reason: `${out.length} llegados, ${state.others.length} sin completar: carrera cerrada` };
}

async function fetchHtml(url, { notFound = false } = {}) {
  const target = new URL(url);
  target.searchParams.set('_', String(Date.now()));
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), headers: {
    'User-Agent': USER_AGENT, Accept: 'text/html', 'Cache-Control': 'no-cache', Pragma: 'no-cache',
  } });
  // nextresults.php responde 404 mientras la categoría no tiene pasos.
  if (notFound && response.status === 404) return '';
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

export async function fetchRows(code, { stageNumber = null, fetchPage = fetchHtml } = {}) {
  const { event, category: fixed, stages } = parseCode(code);
  if (stages && stageNumber == null) throw new Error(`falta la etapa para ${code}`);
  const { category, title } = stages
    ? stageCategory(await fetchPage(resultUrl(event)), event, stageNumber)
    : { category: fixed, title: activeCategory(await fetchPage(resultUrl(event, fixed)), code) };
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageRows = parseRows(await fetchPage(pageUrl(event, category, page), { notFound: true }));
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return { title, category, rows };
  }
  throw new Error(`más de ${MAX_PAGES} páginas`);
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (key, fallback = null) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
  const raceId = arg('--race-id');
  if (argv.includes('--suggest-id')) {
    if (!raceId) throw new Error('falta --race-id');
    process.stdout.write(`${suggestCompetitionId(raceId)}\n`); return;
  }
  const code = arg('--code');
  const { year, laps, stages: stageRace } = parseCode(code);
  // Vuelta por etapas: --stage o, en su defecto, la etapa de --date según --stage-dates.
  const stageDates = arg('--stage-dates') ? JSON.parse(arg('--stage-dates')) : {};
  const stageNumber = !stageRace ? null : arg('--stage') ? Number(arg('--stage'))
    : Number(Object.keys(stageDates).find((key) => stageDates[key] === arg('--date')));
  if (stageRace && !(stageNumber > 0)) throw new Error(`${code}: falta --stage o una --date presente en --stage-dates`);
  const competitionId = Number(arg('--competition-id'));
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo');
  // --fixture: JSON { "result": "<html result.php>", "pages": ["<html página 1>", …], "now": "<ISO>" } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const { title, rows } = fixture
    ? await fetchRows(code, { stageNumber, fetchPage: async (url) => {
      const params = new URL(url).searchParams;
      return params.has('page') ? fixture.pages[Number(params.get('page')) - 1] ?? '' : fixture.result;
    } })
    : await fetchRows(code, { stageNumber });
  // En etapas el título no lleva fecha: la fija el calendario de la carrera.
  const date = stageRace ? stageDates[String(stageNumber)] || arg('--date') : categoryDate(title, year);
  if (!date) throw new Error(`${code}: sin fecha para la etapa ${stageNumber}`);
  const dateKey = arg('--date') || date;
  if (dateKey !== date) throw new Error(`la categoría ${code} es del ${date} y la jornada es el ${dateKey}`);
  if (Number(dateKey.slice(0, 4)) !== year) throw new Error(`el evento ${code} es de ${year} y la jornada es el ${dateKey}`);
  const verdict = classify(rows, { laps, dateKey, startUtc: arg('--start-utc'), neutralStartUtc: arg('--neutral-start-utc'),
    now: fixture?.now ? Date.parse(fixture.now) : Date.now() });
  const stages = [];
  if (verdict.rows.length) {
    log(`✓ ${code} (${title}): ${verdict.reason}`);
    stages.push(buildStage(verdict.rows, { competitionId, dateKey, stageNumber }));
  } else {
    log(`∅ ${code} (${title}): ${verdict.reason}`);
  }
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: 'lapclip', lapclipCode: code,
    fetchedAt: new Date().toISOString(), stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
