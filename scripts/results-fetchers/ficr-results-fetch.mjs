#!/usr/bin/env node
/**
 * Resultados de FICR (Federazione Italiana Cronometristi) en ciclismo.ficr.it.
 *
 * La web pública consume una API JSON (`apiciclismo.ficr.it/CIC/…`) indexada
 * por año, código de equipo cronometrador y número de carrera
 * (`ficrCode = <año>/<equipo>/<carrera>`, p. ej. 2026/102/10). Cada carrera
 * tiene una o varias `tappe`; cada tappa, sus puntos de cronometraje (`arrivi`),
 * de los que el de tipo 1 es la llegada.
 *
 * - Llegada: `results/<año>/<equipo>/<carrera>/<tappa>/<tipo>/<llegada>/*`
 *   devuelve los llegados en orden (dorsal y tiempo absoluto) y `fuorigara`,
 *   los corredores fuera de carrera con su estado (NA, NS, FTM, EX). Un
 *   corredor fuera de control figura también entre los llegados: el estado
 *   prevalece y no recibe puesto.
 * - Generales de una vuelta: `filterclass` enumera las clasificaciones de la
 *   tappa y `standings` las publica en orden.
 *
 * La llegada se completa a medida que entran corredores; el cron relee la
 * fuente dentro de la ventana. Una tappa de fecha futura no emite filas.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

const API = 'https://apiciclismo.ficr.it/CIC';
const WEB = 'https://ciclismo.ficr.it/#/CIC';
const USER_AGENT = 'Mozilla/5.0 (compatible; calendariociclismo.app results sync; +https://calendariociclismo.app)';
const TIME_ZONE = 'Europe/Rome';
export const RESULTS_SOURCE = 'ficr';
const log = (value) => process.stderr.write(`${value}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// Estados de `fuorigara` y de las generales (`cr_StatoFormattato`).
// NA = non arrivato, NS = non partito, FTM = fuori tempo massimo, EX = escluso.
const IRM = { NA: 'DNF', RIT: 'DNF', NS: 'DNS', NP: 'DNS', FTM: 'OTL', EX: 'DSQ', SQ: 'DSQ', DSQ: 'DSQ' };
// Tipos de tappa: 1 en línea, 2 contrarreloj individual.
const RACE_TYPES = { 1: 'IRR', 2: 'ITT' };
const ARRIVAL_POINT = 1;

// Generales publicadas por FICR que tienen equivalente en la web. Las de tappa,
// intergiro, sprint, TV o combinada se omiten.
const GENERALS = [
  { pattern: /^classifica generale$/i, classKind: 'gc', scope: 'stage', eventName: 'General Classification' },
  { pattern: /^classifica a punti generale$/i, classKind: 'points', scope: 'overall', eventName: 'Points Classification', points: true },
  { pattern: /^classifica generale gpm$/i, classKind: 'kom', scope: 'overall', eventName: 'Mountain Classification', points: true },
  { pattern: /^classifica (?:generale )?giovani$/i, classKind: 'youth', scope: 'overall', eventName: 'Youth Classification' },
  { pattern: /^classifica a squadre generale$/i, classKind: 'teams', scope: 'overall', eventName: 'Teams Classification', teams: true },
];

/** ficrCode: `<año>/<equipo>/<carrera>`. */
export function parseCode(value) {
  const match = clean(value).match(/^(20\d{2})\/([1-9]\d{0,3})\/([1-9]\d{0,5})$/);
  if (!match) throw new Error(`ficrCode no válido: ${value} (formato <año>/<equipo>/<carrera>)`);
  return { year: Number(match[1]), team: Number(match[2]), race: Number(match[3]), code: `${match[1]}/${match[2]}/${match[3]}` };
}

const negativeId = (seed, modulo = 2_000_000_000) => -(fnv1a(seed) % modulo || 1);
export const suggestCompetitionId = (code) => negativeId(`ficr:${parseCode(code).code}`, 200_000);
export const synthRaceId = (code, tappa, final = false) => negativeId(`ficr:${parseCode(code).code}:race:${final ? 'final' : tappa}`);
export const synthEventId = (code, tappa, kind, scope, final = false) =>
  negativeId(`ficr:${parseCode(code).code}:event:${final ? 'final' : tappa}:${kind}:${scope}`);

export function pageUrl(code, description) {
  const { year, team, race } = parseCode(code);
  return `${WEB}/risultati/${encodeURIComponent(description || 'gara')}/${year}/${team}/${race}`;
}

/**
 * Tiempo FICR en centésimas: `4:09'53`, `1:52'46`, `11'09`, `1'10.99`, `26`, `1.28`.
 * Devuelve null para un valor vacío.
 */
export function parseTime(value) {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^(?:(\d+):)?(?:(\d{1,2})')?(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match || (match[1] != null && match[2] == null)) throw new Error(`tiempo FICR no reconocido: «${value}»`);
  const [, hours = '0', minutes = '0', seconds, fraction = ''] = match;
  if (Number(seconds) > 59 || (match[1] != null && Number(minutes) > 59)) throw new Error(`tiempo FICR no reconocido: «${value}»`);
  const hundredths = fraction ? Math.floor(Number(fraction.padEnd(3, '0')) / 10) : 0;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 100 + hundredths;
}

function timeText(hundredths) {
  const total = Math.floor(hundredths / 100);
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function gapText(hundredths) {
  const total = Math.floor(hundredths / 100);
  if (total < 60) return `+${String(total).padStart(2, '0')}`;
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = String(total % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : `+${m}:${s}`;
}

const bibOf = (value) => {
  const bib = Number(value);
  if (!Number.isInteger(bib) || bib <= 0) throw new Error(`dorsal no válido: ${value}`);
  return String(bib);
};

function irmOf(status, bib) {
  const irm = IRM[clean(status).toUpperCase()];
  if (!irm) throw new Error(`dorsal ${bib}: estado FICR desconocido «${status}»`);
  return irm;
}

/**
 * Filas con puesto y tiempo; la primera lleva el tiempo absoluto y el resto la
 * diferencia. En una llegada el orden publicado manda: el corredor que recibe el
 * tiempo de su grupo por una caída en los últimos kilómetros figura detrás con un
 * tiempo menor (Giro del Veneto 2026, 1.ª etapa). En una general el tiempo crece.
 */
function timedRows(entries, { ordered = true } = {}) {
  let previous = -1;
  const winner = entries[0]?.time;
  return entries.map((entry, index) => {
    if (entry.time == null) throw new Error(`${entry.label} sin tiempo en el puesto ${index + 1}`);
    if (entry.time < (ordered ? previous : winner)) throw new Error(`tiempo menor que el del puesto anterior: ${entry.label}`);
    previous = entry.time;
    const rank = index + 1;
    const base = { rank, rankText: String(rank), bib: entry.bib, ...(entry.team ? { riderDisplay: entry.team, teamName: entry.team } : {}), points: null, irm: null };
    if (index === 0) {
      const absolute = timeText(entry.time);
      return { ...base, resultValue: absolute, timeText: absolute, gapText: null };
    }
    const gap = gapText(entry.time - winner);
    return { ...base, resultValue: gap, timeText: null, gapText: gap };
  });
}

/** Llegada de una tappa: orden de los llegados y estados de `fuorigara`. */
export function arrivalRows(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const outOfRace = Array.isArray(payload?.fuorigara) ? payload.fuorigara : [];
  const irmByBib = new Map();
  for (const row of outOfRace) {
    const bib = bibOf(row.fg_Numero);
    if (irmByBib.has(bib)) throw new Error(`dorsal ${bib} repetido fuera de carrera`);
    irmByBib.set(bib, irmOf(row.fg_StatoFormattato, bib));
  }
  const seen = new Set();
  const finishers = [];
  for (const row of results) {
    const bib = bibOf(row.ri_Numero);
    if (seen.has(bib)) throw new Error(`dorsal ${bib} repetido en la llegada`);
    seen.add(bib);
    if (irmByBib.has(bib)) continue;
    finishers.push({ bib, time: parseTime(row.Tempo), label: `dorsal ${bib}` });
  }
  if (!finishers.length) return [];
  const irmRows = [...irmByBib].sort(([a], [b]) => Number(a) - Number(b))
    .map(([bib, irm]) => ({ rank: null, rankText: irm, bib, resultValue: null, timeText: null, gapText: null, points: null, irm }));
  return [...timedRows(finishers, { ordered: false }), ...irmRows];
}

/** Filas de una general (`standings`); excluye a los corredores fuera de carrera. */
export function generalRows(payload, spec) {
  const rows = (Array.isArray(payload?.classifiche) ? payload.classifiche : []).filter((row) => Number(row.cr_Stato) === 0);
  if (spec.points) {
    let previous = Infinity;
    return rows.map((row, index) => {
      const points = Number(row.cr_Punti);
      const bib = bibOf(row.cr_Numero);
      if (!Number.isFinite(points)) throw new Error(`dorsal ${bib}: puntos no válidos`);
      if (points > previous) throw new Error(`puntos mayores que los del puesto anterior: dorsal ${bib}`);
      previous = points;
      return { rank: index + 1, rankText: String(index + 1), bib, resultValue: String(points), timeText: String(points), gapText: null, points, irm: null };
    });
  }
  return timedRows(rows.map((row) => {
    if (spec.teams) {
      const team = clean(row.sq_Descrizione);
      if (!team) throw new Error('clasificación por equipos sin nombre de equipo');
      return { bib: null, team, time: parseTime(row.Tempo), label: team };
    }
    const bib = bibOf(row.cr_Numero);
    return { bib, time: parseTime(row.Tempo), label: `dorsal ${bib}` };
  }));
}

/**
 * Asigna etapa y sector a cada tappa: cada fecha distinta es una etapa (el
 * prólogo, la 0) y las tappe de una misma fecha son sectores (0=A, 1=B…).
 */
export function mapTappe(tappe) {
  const sorted = [...tappe].sort((a, b) => Number(a.ta_Tappa) - Number(b.ta_Tappa));
  const base = sorted[0]?.ta_Prologo ? 0 : 1;
  const dates = [];
  return sorted.map((tappa) => {
    const dateKey = clean(tappa.ta_Data).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`tappa ${tappa.ta_Tappa} sin fecha`);
    if (dates.length && dateKey < dates.at(-1)) throw new Error(`tappa ${tappa.ta_Tappa} anterior a la precedente`);
    if (dates.at(-1) !== dateKey) dates.push(dateKey);
    const sectorIndex = sorted.filter((other) => clean(other.ta_Data).slice(0, 10) === dateKey && Number(other.ta_Tappa) < Number(tappa.ta_Tappa)).length;
    const raceType = RACE_TYPES[Number(tappa.ta_TipoTappa)];
    if (!raceType) throw new Error(`tappa ${tappa.ta_Tappa}: tipo ${tappa.ta_TipoTappa} no soportado`);
    return { tappa: Number(tappa.ta_Tappa), type: Number(tappa.ta_TipoTappa), dateKey, stageNumber: base + dates.length - 1,
      sectorIndex, raceType, name: clean(tappa.ta_Descrizione) };
  });
}

export function arrivalPoint(points, tappa) {
  const arrivals = (Array.isArray(points) ? points : []).filter((point) => Number(point.rv_TipoRilevazione) === ARRIVAL_POINT);
  if (!arrivals.length) throw new Error(`tappa ${tappa}: sin punto de llegada`);
  return Number(arrivals.at(-1).rv_Rilevazione);
}

/**
 * En una carrera de un día FICR puede conservar como fecha de la tappa la del
 * alta de la carrera. Se admite una fecha anterior a la jornada en hasta
 * PROVISIONAL_DATE_DAYS días; una posterior o más lejana es un error.
 */
const PROVISIONAL_DATE_DAYS = 3;
export function provisionalDate(ficrDate, expected) {
  const days = (Date.parse(`${expected}T00:00:00Z`) - Date.parse(`${ficrDate}T00:00:00Z`)) / 86_400_000;
  return days > 0 && days <= PROVISIONAL_DATE_DAYS;
}

const localToday = (now = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

async function getJson(path) {
  const response = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(30000), headers: {
    'User-Agent': USER_AGENT, Accept: 'application/json', 'Cache-Control': 'no-cache',
  } });
  if (!response.ok) throw new Error(`FICR HTTP ${response.status} en ${path}`);
  const body = await response.json();
  if (Number(body?.code) !== 200 || body?.status !== true) throw new Error(`FICR respuesta no válida en ${path}: ${clean(body?.message)}`);
  return body.data;
}

/** Lector de la API; con fixture, `{ "<ruta sin caché>": data }`. */
export function apiReader(fixture = null, delay = 0) {
  return async (path) => {
    const key = path.replace(/^mpcache-\d+\/get\//, '');
    if (fixture) {
      if (!(key in fixture)) throw new Error(`fixture sin ${key}`);
      return fixture[key];
    }
    if (delay > 0) await sleep(delay);
    return getJson(path);
  };
}

function classification(code, tappa, spec, rows, final = false, publication = null) {
  const scope = final ? 'stage' : spec.scope;
  return { eventId: synthEventId(code, tappa, spec.classKind, scope, final), classKind: spec.classKind, scope,
    eventName: spec.eventName, isTeamEvent: !!spec.teams, rowCount: rows.length, rows, ...(publication ? { publication } : {}) };
}

/**
 * Dorsales de la lista de corredores de FICR. El cronometrador retira de ella a
 * los no salidos (Il Lombardia sub23 2026: 169 inscritos, 161 en la lista tras la
 * salida), por lo que acredita el censo de la primera tappa: su llegada y su
 * `fuorigara` la cubren exactamente. En tappe posteriores FICR puede omitir a un
 * corredor retirado sin estado (Le Fiumane 2026, etapas 3 y 4): ahí no se declara
 * censo y rige la estabilidad.
 */
export function ridersCensus(riders) {
  const ids = (Array.isArray(riders) ? riders : []).map((rider) => String(rider?.co_Numero ?? ''));
  if (!ids.length || ids.some((bib) => !/^[1-9]\d*$/.test(bib)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/**
 * Censo independiente de una clasificación de la primera tappa: la lista de
 * FICR (en la general, sin los fuera de carrera de la tappa). Sin censo
 * coherente con la llegada no se declara ninguno.
 */
export function censusPublication(census, { excluded = [], arrival = [], basis }) {
  if (!census) return null;
  const out = new Set(excluded);
  const ids = census.filter((bib) => !out.has(bib));
  const known = new Set(ids);
  if (!ids.length || arrival.some((row) => !known.has(row.bib))) return null;
  return { provider: RESULTS_SOURCE, format: 'progressive', expectedVerified: true, expectedKind: 'bib',
    expectedIds: ids, expectedBasis: basis };
}

export async function fetchCompetition(rawCode, { read, onlyStage = null, totalStages = null, oneDay = false, date = null,
  stageDates = null, now = Date.now() } = {}) {
  const { year, team, race, code } = parseCode(rawCode);
  const id = `${year}/${team}/${race}`;
  const [description] = await read(`mpcache-30/get/descrizione/${id}`);
  if (!description || Number(description.ga_Anno) !== year) throw new Error(`FICR ${code}: carrera inexistente o de otro año`);
  const sourceUrl = pageUrl(code, String(description.ga_Descrizione ?? '').trim());
  const tappe = mapTappe(await read(`mpcache-30/get/tappe/${id}`));
  if (!tappe.length) throw new Error(`FICR ${code}: sin tappe`);
  if (oneDay && tappe.length !== 1) throw new Error(`FICR ${code}: ${tappe.length} tappe en una carrera de un día`);
  const lastStage = Math.max(...tappe.map((tappa) => tappa.stageNumber));
  if (!oneDay && totalStages != null && lastStage !== Number(totalStages)) {
    throw new Error(`FICR ${code}: última etapa ${lastStage}, la carrera tiene ${totalStages}`);
  }
  const today = localToday(now);
  const stages = [];
  const ridersPath = `mpcache-30/get/riders/${id}/*/N`;
  let census;
  const readCensus = async () => (census === undefined ? (census = ridersCensus(await read(ridersPath))) : census);
  for (const tappa of tappe) {
    if (!oneDay && onlyStage != null && tappa.stageNumber !== Number(onlyStage)) continue;
    const expected = oneDay ? date : stageDates?.[String(tappa.stageNumber)];
    if (expected && expected !== tappa.dateKey) {
      if (!oneDay || !provisionalDate(tappa.dateKey, expected)) {
        throw new Error(`FICR ${code}: tappa ${tappa.tappa} el ${tappa.dateKey}, la jornada es el ${expected}`);
      }
      log(`⚠ tappa ${tappa.tappa}: FICR la fecha el ${tappa.dateKey}; se usa la de la jornada (${expected})`);
      tappa.dateKey = expected;
    }
    if (tappa.dateKey > today) { log(`∅ tappa ${tappa.tappa} (${tappa.dateKey}): fecha futura`); continue; }

    const point = arrivalPoint(await read(`mpcache-10/get/arrivi/${id}/${tappa.tappa}`), tappa.tappa);
    const rows = arrivalRows(await read(`mpcache-10/get/results/${id}/${tappa.tappa}/${tappa.type}/${point}/*`));
    if (!rows.length) { log(`∅ tappa ${tappa.tappa}: sin llegados`); continue; }
    let stageCensus = null, gcCensus = null;
    if (tappa.tappa === tappe[0].tappa) {
      const basis = `${API}/${ridersPath}`;
      stageCensus = censusPublication(await readCensus(), { arrival: rows, basis });
      gcCensus = censusPublication(census, { excluded: rows.filter((row) => row.irm).map((row) => row.bib), basis });
      if (!stageCensus) log(`⚠ tappa ${tappa.tappa}: la lista de corredores no acredita el censo de la llegada`);
    }
    const finished = rows.filter((row) => row.rank != null).length;
    log(`✓ tappa ${tappa.tappa} (${tappa.dateKey}): ${finished} llegados, ${rows.length - finished} fuera de carrera`);
    const common = { dateKey: tappa.dateKey, sourcePdfUrl: sourceUrl };
    const stageSpec = oneDay
      ? { classKind: 'gc', scope: 'stage', eventName: 'General Classification' }
      : { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' };
    const stageClassification = classification(code, tappa.tappa, stageSpec, rows, false, stageCensus);
    if (oneDay) {
      stages.push({ uciRaceId: synthRaceId(code, tappa.tappa), stageNumber: null, stageName: 'Final Classification',
        isFinalClassification: true, raceType: null, ...common, classifications: [stageClassification] });
      continue;
    }

    const generals = [];
    for (const entry of await read(`mpcache-30/get/filterclass/${id}/${tappa.tappa}`)) {
      const spec = GENERALS.find((candidate) => candidate.pattern.test(clean(entry.cl_Descrizione)));
      if (!spec || generals.some((general) => general.spec === spec)) continue;
      const payload = await read(`mpcache-10/get/standings/${id}/${tappa.tappa}/${entry.rc_Rilevazione}/${entry.rc_Classifica}/*`);
      // Una general ilegible no bloquea la llegada de la etapa: se omite y se avisa.
      try {
        const general = generalRows(payload, spec);
        if (general.length) generals.push({ spec, rows: general });
      } catch (error) {
        log(`⚠ tappa ${tappa.tappa}, ${clean(entry.cl_Descrizione)}: ${error.message}`);
      }
    }
    const isLast = tappa.stageNumber === lastStage && tappa.tappa === tappe.at(-1).tappa;
    stages.push({ uciRaceId: synthRaceId(code, tappa.tappa), stageNumber: tappa.stageNumber,
      ...(tappa.sectorIndex ? { sectorIndex: tappa.sectorIndex } : {}),
      stageName: tappa.name || `Stage ${tappa.stageNumber}`, isFinalClassification: false, raceType: tappa.raceType, ...common,
      classifications: isLast ? [stageClassification]
        : [stageClassification, ...generals.map(({ spec, rows: general }) => classification(code, tappa.tappa, spec, general, false,
          spec.classKind === 'gc' ? gcCensus : null))] });
    if (isLast && generals.length) {
      stages.push({ uciRaceId: synthRaceId(code, tappa.tappa, true), stageNumber: null, stageName: 'Final Classification',
        isFinalClassification: true, raceType: null, ...common,
        classifications: generals.map(({ spec, rows: general }) => classification(code, tappa.tappa, spec, general, true,
          spec.classKind === 'gc' ? gcCensus : null)) });
    }
  }
  return { description: clean(description.ga_Descrizione), sourceUrl, stages };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
  const code = parseCode(arg('--code')).code;
  if (argv.includes('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  const competitionId = Number(arg('--competition-id'));
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo (o usa --suggest-id)');
  const delay = Number(arg('--delay', '200'));
  if (!Number.isFinite(delay) || delay < 0) throw new Error('--delay debe ser un número no negativo');
  // --fixture: JSON { "now": "<ISO>", "api": { "<ruta sin mpcache-N/get/>": data } } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const result = await fetchCompetition(code, {
    read: apiReader(fixture?.api ?? null, delay),
    onlyStage: arg('--stage') == null ? null : Number(arg('--stage')),
    totalStages: arg('--total-stages') == null ? null : Number(arg('--total-stages')),
    oneDay: argv.includes('--one-day'),
    date: arg('--date'),
    stageDates: arg('--stage-dates') ? JSON.parse(arg('--stage-dates')) : null,
    now: fixture?.now ? Date.parse(fixture.now) : Date.now(),
  });
  const raceId = arg('--race-id');
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: RESULTS_SOURCE, ficrCode: code,
    sourceUrl: result.sourceUrl, fetchedAt: new Date().toISOString(), stages: result.stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
  if (argv.includes('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
