#!/usr/bin/env node
/**
 * Clasificación de carreras de un día cronometradas por mika:timing
 * (`<host>.mikatiming.com/<edición>/?pid=list&event=<evento>`), p. ej. el
 * Sparkassen Münsterland Giro.
 *
 * El listado HTML publica puesto, dorsal y tiempo de meta de los llegados; no
 * publica abandonos. La ficha de un corredor añade la hora del día de cada paso.
 *
 * El cronometrador carga una simulación con la startlist real antes de la
 * carrera (Münsterland Giro 2026: clasificación completa la víspera). El
 * fetcher solo emite la clasificación si es fidedigna: la hora de llegada del
 * último clasificado ya ha pasado y la salida que se deduce de la llegada del
 * ganador (hora del día − tiempo de carrera) coincide con la salida programada
 * de la jornada. Una llegada futura emite cero etapas (resultado aún no
 * publicado); una salida incoherente es un error y nunca se publica.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
export { suggestCompetitionId } from './pdf-results-ids.mjs';

const FINAL_SLOT = 99;   // mismo hueco que el placeholder manual de un día del panel
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const IRM = new Set(['DNF', 'DNS', 'OTL', 'DSQ']);
// Margen de la salida deducida frente a la programada: antes de la salida
// neutralizada no se puede salir; el retraso admitido cubre esperas en la salida.
export const START_EARLY_TOLERANCE_MIN = 20;
export const START_LATE_TOLERANCE_MIN = 45;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; calendariociclismo.app results sync; +https://calendariociclismo.app)';
const log = (value) => process.stderr.write(`${value}\n`);

/** mikatimingCode: `<host>/<ruta de edición>/<evento>`; p. ej. muensterland-giro.r.mikatiming.com/2026/P200_9TGOTQ702E5. */
export function parseCode(code) {
  const match = String(code || '').trim()
    .match(/^((?:[a-z0-9-]+\.)+mikatiming\.(?:com|de))((?:\/[A-Za-z0-9_-]+)*)\/([A-Za-z0-9_]+)$/);
  if (!match) throw new Error(`mikatimingCode no válido: ${code}`);
  return { host: match[1], path: `${match[2]}/`, event: match[3] };
}

export function listUrl(code, page = 1) {
  const { host, path, event } = parseCode(code);
  const params = new URLSearchParams({ pid: 'list', event, num_results: String(PAGE_SIZE), search_sort: 'place_all',
    lang: 'EN_CAP', page: String(page) });
  return `https://${host}${path}?${params}`;
}

// La página de inicio contiene el selector de eventos de la edición. El listado
// no lo incluye y, con un evento inexistente, mezcla todos los eventos.
export function startUrl(code) {
  const { host, path } = parseCode(code);
  return `https://${host}${path}?pid=start&lang=EN_CAP`;
}

export function assertEventOffered(html, event) {
  if (!String(html).includes(`<option value="${event}"`)) throw new Error(`la edición no ofrece el evento ${event}`);
}

export function detailUrl(code, idp) {
  const { host, path, event } = parseCode(code);
  return `https://${host}${path}?${new URLSearchParams({ content: 'detail', idp, event, lang: 'EN_CAP' })}`;
}

const decode = (value) => String(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&ndash;/g, '–')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, ' ').trim();

export function seconds(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`tiempo inválido: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const timeText = (value) => {
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function gapText(value) {
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = String(value % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : m ? `+${m}:${s}` : `+${s}`;
}

/** Filas de una página del listado: puesto (o IRM), dorsal, tiempo de meta e idp de la ficha. */
const listItems = (html) => String(html).split(/<li class="[^"]*\blist-group-item\b[^"]*\brow\b[^"]*">/).slice(1);

export function parseListPage(html, event) {
  const items = listItems(html);
  const rows = [];
  for (const item of items) {
    const block = item.split(/<\/li>/)[0];
    if (/list-group-header/.test(block)) continue;
    const place = decode(block.match(/type-place[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const idp = block.match(/[?&;]idp=([A-Z0-9]+)/)?.[1] ?? null;
    const linkEvent = block.match(/[?&;]event=([A-Za-z0-9_]+)/)?.[1] ?? null;
    const name = decode(block.match(/type-fullname[^>]*>([\s\S]*?)<\/h4>/)?.[1] ?? '');
    const bibField = block.match(/list-label">\s*(?:Bib Number|Startnummer)\s*<\/div>([\s\S]*?)<\/div>/)?.[1];
    const timeField = block.match(/type-time[^"]*"><div[^>]*list-label">[^<]*<\/div>([\s\S]*?)<\/div>/)?.[1];
    const bib = decode(bibField ?? '');
    const time = decode(timeField ?? '');
    if (!idp && !bib) continue;
    if (linkEvent && linkEvent !== event) throw new Error(`fila de otro evento (${linkEvent}), dorsal ${bib || '?'}`);
    if (!/^\d+$/.test(bib)) throw new Error(`fila sin dorsal numérico: ${name || idp}`);
    const irm = place.toUpperCase();
    if (/^\d+$/.test(place)) {
      if (!/^\d{1,3}:\d{2}:\d{2}$/.test(time)) throw new Error(`dorsal ${bib}: tiempo de meta no válido «${time}»`);
      rows.push({ rank: Number(place), bib: String(Number(bib)), finishSeconds: seconds(time), idp, name });
    } else if (IRM.has(irm)) {
      rows.push({ rank: null, irm, bib: String(Number(bib)), finishSeconds: null, idp, name });
    } else if (!/\d/.test(time)) {
      // Sin puesto ni tiempo: inscrito sin llegada y sin estado publicado.
      continue;
    } else {
      throw new Error(`dorsal ${bib}: puesto no reconocido «${place}»`);
    }
  }
  return rows;
}

/** Hora del día y tiempo de carrera de la llegada en la ficha del corredor. */
export function parseDetailFinish(html) {
  // El cuadro de resultado repite la clase de la llegada sin hora del día: se
  // toma la fila de la tabla de pasos, la única con columna time_day.
  const row = [...String(html).matchAll(/<tr class="[^"]*\bf-time_finish_brutto\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1]).find((cells) => /<td class="time_day"/.test(cells));
  if (!row) throw new Error('la ficha no publica la llegada');
  const timeOfDay = decode(row.match(/<td class="time_day"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
  const raceTime = decode(row.match(/<td class="time"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timeOfDay) || !/^\d{1,3}:\d{2}:\d{2}$/.test(raceTime)) {
    throw new Error(`llegada sin hora del día o tiempo («${timeOfDay}», «${raceTime}»)`);
  }
  return { timeOfDay, raceSeconds: seconds(raceTime) };
}

/** Instante UTC de una hora local `HH:MM:SS` de `dateKey` en `timeZone`. */
export function zonedInstant(dateKey, timeOfDay, timeZone) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi, s] = timeOfDay.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/**
 * Decide si la clasificación publicada corresponde a la carrera real.
 * Devuelve { status: 'ok' | 'pending' | 'invalid', reason }.
 */
export function assessAuthenticity({ dateKey, timeZone, winnerFinish, lastFinishSeconds, startUtc = null, neutralStartUtc = null, now = Date.now() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return { status: 'invalid', reason: 'falta la fecha de la jornada' };
  const winnerAt = zonedInstant(dateKey, winnerFinish.timeOfDay, timeZone);
  const derivedStart = winnerAt - winnerFinish.raceSeconds * 1000;
  const lastAt = derivedStart + lastFinishSeconds * 1000;
  const iso = (ms) => new Date(ms).toISOString();
  if (lastAt > now + CLOCK_SKEW_MS) {
    return { status: 'pending', reason: `la última llegada publicada (${iso(lastAt)}) es posterior al momento actual: simulación o carrera en curso` };
  }
  const scheduled = [neutralStartUtc, startUtc].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!scheduled.length) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    return dateKey < today
      ? { status: 'ok', reason: 'jornada pasada sin horario de salida' }
      : { status: 'invalid', reason: 'la jornada no tiene horario de salida para validar la clasificación del día' };
  }
  const earliest = Math.min(...scheduled) - START_EARLY_TOLERANCE_MIN * 60000;
  const latest = Math.max(...scheduled) + START_LATE_TOLERANCE_MIN * 60000;
  if (derivedStart < earliest || derivedStart > latest) {
    return { status: 'invalid', reason: `la salida deducida (${iso(derivedStart)}) no coincide con la programada (${scheduled.map(iso).join(' / ')}): datos de prueba o de otra carrera` };
  }
  return { status: 'ok', reason: `salida deducida ${iso(derivedStart)}` };
}

/** Clasificación de un día a partir de las filas del listado. */
export function buildStage(rows, { competitionId, dateKey }) {
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked[0].rank !== 1) throw new Error('la clasificación no contiene ganador');
  ranked.forEach((row, index) => {
    if (index && row.rank !== index + 1 && row.rank !== ranked[index - 1].rank) throw new Error(`puestos incompletos junto al ${row.rank}`);
    if (index && row.finishSeconds < ranked[index - 1].finishSeconds) throw new Error(`tiempo menor que el del puesto anterior, dorsal ${row.bib}`);
  });
  const bibs = rows.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('dorsales duplicados');
  const base = ranked[0].finishSeconds;
  const out = rows.map((row) => {
    if (row.rank == null) return { rank: null, rankText: row.irm, bib: row.bib, resultValue: null, timeText: null, gapText: null, points: null, irm: row.irm };
    if (row.rank === 1 && row.finishSeconds === base) {
      const absolute = timeText(base);
      return { rank: row.rank, rankText: String(row.rank), bib: row.bib, resultValue: absolute, timeText: absolute, gapText: null, points: null, irm: null };
    }
    const gap = gapText(row.finishSeconds - base);
    return { rank: row.rank, rankText: String(row.rank), bib: row.bib, resultValue: gap, timeText: null, gapText: gap, points: null, irm: null };
  });
  return {
    uciRaceId: synthRaceId(competitionId, FINAL_SLOT), stageNumber: null, dateKey, raceType: 'IRR',
    isFinalClassification: false, eventName: 'Race Classification',
    classifications: [{
      eventId: synthEventId(competitionId, FINAL_SLOT, 'gc'), classKind: 'gc', scope: 'stage',
      eventName: 'Race Classification', isTeamEvent: false, rowCount: out.length, rows: out,
    }],
  };
}

async function fetchHtml(url) {
  const target = new URL(url);
  target.searchParams.set('_', String(Date.now()));
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), headers: {
    'User-Agent': USER_AGENT, Accept: 'text/html', 'Cache-Control': 'no-cache', Pragma: 'no-cache',
  } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

export async function fetchRows(code, { fetchPage = fetchHtml } = {}) {
  const { event } = parseCode(code);
  assertEventOffered(await fetchPage(startUrl(code)), event);
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchPage(listUrl(code, page));
    rows.push(...parseListPage(html, event));
    // Se pagina por elementos del listado: las filas sin llegada no se emiten.
    if (listItems(html).length < PAGE_SIZE) return rows;
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
  parseCode(code);
  const competitionId = Number(arg('--competition-id'));
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo');
  const dateKey = arg('--date');
  const timeZone = arg('--timezone') || 'Europe/Berlin';
  // --fixture: JSON { "start": "<html inicio>", "pages": ["<html página 1>", …], "detail": "<html ficha del ganador>", "now": "<ISO>" } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const rows = fixture
    ? await fetchRows(code, { fetchPage: async (url) => {
      const params = new URL(url).searchParams;
      return params.get('pid') === 'start' ? fixture.start : fixture.pages[Number(params.get('page')) - 1] ?? '';
    } })
    : await fetchRows(code);
  const stages = [];
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length) {
    log(`∅ ${code}: sin llegadas publicadas`);
  } else {
    const winner = ranked[0];
    if (!winner.idp) throw new Error('el ganador no enlaza su ficha');
    const winnerFinish = parseDetailFinish(fixture ? fixture.detail : await fetchHtml(detailUrl(code, winner.idp)));
    if (winnerFinish.raceSeconds !== winner.finishSeconds) throw new Error('la ficha del ganador no coincide con el listado');
    const verdict = assessAuthenticity({ dateKey, timeZone, winnerFinish, lastFinishSeconds: ranked.at(-1).finishSeconds,
      startUtc: arg('--start-utc'), neutralStartUtc: arg('--neutral-start-utc'), now: fixture?.now ? Date.parse(fixture.now) : Date.now() });
    if (verdict.status === 'invalid') throw new Error(`clasificación no fidedigna: ${verdict.reason}`);
    if (verdict.status === 'pending') log(`∅ ${code}: ${verdict.reason}`);
    else {
      log(`✓ ${code}: ${ranked.length} llegados, ${verdict.reason}`);
      stages.push(buildStage(rows, { competitionId, dateKey }));
    }
  }
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: 'mikatiming', mikatimingCode: code,
    fetchedAt: new Date().toISOString(), stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
