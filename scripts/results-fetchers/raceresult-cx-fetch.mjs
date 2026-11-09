#!/usr/bin/env node
/**
 * RACE|RESULT (my.raceresult.com) → documento de resultados CX (contrato de
 * cx-results-upsert.mjs). Cronometraje de pruebas norteamericanas como los
 * Campeonatos Panamericanos y el DCCX de Washington.
 *
 * El enlace de una carrera es la raíz del evento `https://my.raceresult.com/<id>/`
 * y `categoryKeys` asigna cada concurso (contest) a una categoría propia:
 * `{"26": "ME"}`, o `{"26/1": "ME"}` para fijar el día del selector. API pública:
 *   GET my.raceresult.com/<id>/results/config?lang=en → key, server, contests, Tab.Config.Lists
 *   GET <server>/<id>/results/list?key=…&listname=…&contest=<n>&r=all&l=0[&selectorResult=<día>]
 * De cada concurso se lee la lista de clasificación visible («Overall Results»,
 * nunca «Lap Report»). Las columnas se localizan por su rótulo en `list.Fields`
 * (Place, Bib, Name, Team, Time y, si existe, Gap); cada fila de `data` lleva
 * delante el dorsal interno y el ID de participante.
 *
 *   node scripts/results-fetchers/raceresult-cx-fetch.mjs --url https://my.raceresult.com/434035/ \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-07 \
 *     --map '21=MJ,22=WJ,23=MU,24=WU,25=WE,26=ME' [--out doc.json]
 *
 * La lista se publica en directo y sin marca de definitiva: cada categoría lleva
 * su huella (`sourceDigest`) y el número de inscritos todavía sin puesto ni
 * estado (`unfinished`) para que el worker publique solo la tabla que deja de
 * cambiar. Tiempo: el ganador lleva el absoluto («1:01:20») y el resto la
 * diferencia («+51», «+1:02»); «''» es el mismo tiempo que el anterior y
 * «-4 LAPS», vueltas perdidas (`irm=LAP` sin tiempo). Décimas truncadas al
 * segundo. La lista no publica nacionalidad, licencia UCI ni nacimiento: las
 * fichas se resuelven después por nombre.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { personCase } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const STATES = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', ABD: 'ABD' };
const COLUMNS = { place: /^(place|rank|pos\.?|position|pl\.?)$/i, bib: /^(bib|no\.?|#)$/i, name: /^name$/i, team: /^(team|club)$/i,
  time: /^time$/i, gap: /^(gap|diff\.?|behind)$/i };
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hms = total => `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}` : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const upper = text => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);

/** Cualquier URL o número de evento → raíz canónica, que es el `sourceUrl` del enlace. */
export function raceresultEventUrl(value) {
  const text = clean(value);
  if (/^[1-9]\d{3,9}$/.test(text)) return `https://my.raceresult.com/${text}/`;
  let parsed; try { parsed = new URL(text); } catch { parsed = null; }
  const match = parsed && /^\/([1-9]\d{3,9})(?:\/.*)?$/.exec(parsed.pathname);
  if (!parsed || parsed.protocol !== 'https:' || parsed.host !== 'my.raceresult.com' || !match) throw new Error(`URL RaceResult no reconocida: ${value}`);
  return `https://my.raceresult.com/${match[1]}/`;
}
export const raceresultEventId = url => /^https:\/\/my\.raceresult\.com\/(\d+)\/$/.exec(raceresultEventUrl(url))[1];

/** Clave de `categoryKeys`: concurso y, opcionalmente, día del selector («26», «26/2»). */
export function raceresultKey(value) {
  const match = /^([1-9]\d{0,3})(?:\/([1-9]\d{0,2}))?$/.exec(clean(value));
  if (!match) throw new Error(`Clave RaceResult inválida: ${value}`);
  return { key: match[0], contest: match[1], selector: match[2] || null };
}

/**
 * Categoría UCI que nombra un concurso («Elite Men», «U23 Women», «UCI Jr Men 17-18»),
 * o null para masters, categorías nacionales, escuelas y nombres no reconocidos.
 */
export function raceresultContestCategory(name) {
  const text = clean(name).toLowerCase();
  if (!text || /master|single|\bcat\b|cat ?\d|novice|non.?binary|\b\d{1,2} ?- ?\d{1,2}\b(?<!17 ?- ?18)|\d+\+/.test(text)) return null;
  const women = /\b(women|woman|female|ladies|femmes?|dames)\b/.test(text); const men = /\b(men|man|male|hommes?|heren)\b/.test(text);
  if (women === men) return null;
  const age = /\bu ?23\b|under ?23|espoir/.test(text) ? 'U' : /\bj(unio)?rs?\b|junior|17 ?- ?18/.test(text) ? 'J' : /\belite\b/.test(text) ? 'E' : null;
  return age ? `${women ? 'W' : 'M'}${age}` : null;
}

// «1:01:20», «43:21», «43:21.4», «+03», «+1:02» → segundos enteros (décimas truncadas); otro texto → null.
export function raceresultSeconds(value) {
  const match = /^\+?(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})(?:[.,]\d+)?$/.exec(clean(value));
  if (!match) return null;
  const [h, m] = match[2] == null ? [0, Number(match[1] || 0)] : [Number(match[1]), Number(match[2])];
  return h * 3600 + m * 60 + Number(match[3]);
}
const isGap = value => /^\+/.test(clean(value)) && raceresultSeconds(value) != null;
const isAbsolute = value => !/^\+/.test(clean(value)) && /:/.test(clean(value)) && raceresultSeconds(value) != null;
const sameTime = value => /^(''|"|s\.?\s?t\.?|=)$/i.test(clean(value));
const lapsBehind = value => { const match = /^-\s?(\d+)\s*laps?$/i.exec(clean(value)); return match ? Number(match[1]) : null; };
const empty = value => /^(|-+|—)$/.test(clean(value));

/** «VAN KEMPEN, Jules» → nombre y apellido; el apellido en mayúsculas sostenidas se normaliza. */
export function raceresultName(value) {
  const match = /^([^,]+),\s*(.+)$/.exec(clean(value));
  if (!match) return { firstName: null, lastName: null };
  const last = clean(match[1]); const first = clean(match[2]);
  return { firstName: upper(first) ? personCase(first) : first, lastName: upper(last) ? personCase(last) : last };
}

/** Lista de RaceResult → filas con rótulo de columna. Lanza si faltan columnas o no cuadran. */
export function parseRaceresultList(json) {
  if (json?.error) throw new Error(`RaceResult responde «${clean(json.error)}»`);
  const fields = json?.list?.Fields; const dataFields = json?.DataFields;
  if (!Array.isArray(fields) || !Array.isArray(dataFields)) throw new Error('Lista RaceResult sin Fields ni DataFields');
  if (dataFields.length !== fields.length + 2 || fields.some((field, index) => field.Expression !== dataFields[index + 2])) {
    throw new Error(`Columnas RaceResult inesperadas: ${dataFields.join(' | ')}`);
  }
  const index = {};
  for (const [name, pattern] of Object.entries(COLUMNS)) {
    const found = fields.map((field, position) => pattern.test(clean(field.Label)) ? position + 2 : -1).filter(position => position >= 0);
    if (found.length > 1) throw new Error(`Columna RaceResult «${name}» repetida`);
    if (found.length) index[name] = found[0];
  }
  for (const name of ['place', 'bib', 'name', 'time']) if (index[name] == null) throw new Error(`Lista RaceResult sin columna «${name}»: ${fields.map(field => field.Label).join(' | ')}`);
  const flat = data => Array.isArray(data) ? data : Object.values(data || {}).flatMap(flat);
  const rows = flat(json.data).map(cells => ({ id: clean(cells[1]), place: clean(cells[index.place]).replace(/\.$/, ''), bib: clean(cells[index.bib]),
    name: clean(cells[index.name]), team: index.team != null ? clean(cells[index.team]) : '', time: clean(cells[index.time]),
    gap: index.gap != null ? clean(cells[index.gap]) : '' }));
  return { headline: clean(json.list.HeadLine2), selectors: (json.list.SelectorResults || []).map(item => ({ id: String(item.ResultID), label: clean(item.ShowAs) })), rows };
}

/**
 * Filas de un concurso → filas del contrato CX. Las filas sin puesto ni estado
 * (aún en carrera o sin salida marcada) quedan fuera y se cuentan en `unfinished`.
 * Lanza si la clasificación no es coherente: puestos que no crecen, tiempos que
 * bajan, un clasificado tras un estado o tras un doblado, o texto desconocido.
 */
export function parseRaceresultRows(sourceRows) {
  const rows = []; const warnings = []; let unfinished = 0;
  let winnerSeconds = null; let lastSeconds = null; let lastPlace = 0; let lastLaps = 0;
  for (const [sourceRow, item] of sourceRows.entries()) {
    if (empty(item.place)) { unfinished++; continue; }
    const { firstName, lastName } = raceresultName(item.name);
    if (!firstName || !lastName) throw new Error(`Fila ${sourceRow + 1}: nombre «${item.name}» sin apellido`);
    const base = { bib: /^\d+$/.test(item.bib) ? item.bib : null, riderDisplay: `${firstName} ${lastName}`, firstName, lastName,
      sourceName: item.name, teamName: item.team || null, isoCode2: null, bonusSeconds: null, sourceSortOrder: sourceRow };
    const state = STATES[item.place.toUpperCase()];
    if (state) { rows.push({ ...base, rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null }); continue; }
    if (!/^\d+$/.test(item.place)) throw new Error(`Fila ${sourceRow + 1}: puesto «${item.place}» no reconocido`);
    if (rows.some(row => row.irm && row.irm !== 'LAP')) throw new Error(`Fila ${sourceRow + 1}: clasificado tras un ${rows.find(row => row.irm && row.irm !== 'LAP').irm}`);
    const place = Number(item.place);
    if (place <= lastPlace) throw new Error(`Fila ${sourceRow + 1}: puesto ${place} no posterior a ${lastPlace}`);
    const rank = rows.filter(row => row.rank != null).length + 1;
    if (place !== rank) warnings.push({ sourceRow, reason: `Puesto ${place} de la fuente en el lugar ${rank}: se renumera dentro de la categoría` });
    lastPlace = place;
    const laps = lapsBehind(item.time) ?? lapsBehind(item.gap);
    if (laps != null) {
      if (rank === 1) throw new Error('Fila 1: el ganador figura con vueltas perdidas');
      if (laps < lastLaps) throw new Error(`Fila ${sourceRow + 1}: ${laps} vueltas perdidas tras ${lastLaps}`);
      lastLaps = laps;
      rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${laps} LAP`, timeText: null, timeSeconds: null });
      continue;
    }
    if (lastLaps) throw new Error(`Fila ${sourceRow + 1}: clasificado con tiempo tras un doblado`);
    const absolute = isAbsolute(item.time) ? raceresultSeconds(item.time) : null;
    const behind = isGap(item.gap) ? raceresultSeconds(item.gap) : isGap(item.time) ? raceresultSeconds(item.time) : null;
    let seconds;
    if (rank === 1) seconds = absolute;
    else if (absolute != null) {
      if (behind != null && Math.abs(absolute - winnerSeconds - behind) > 1) throw new Error(`Fila ${sourceRow + 1}: tiempo ${item.time} y diferencia ${item.gap} no cuadran`);
      seconds = absolute;
    } else if (behind != null) seconds = winnerSeconds + behind;
    else if (sameTime(item.time) || sameTime(item.gap)) seconds = lastSeconds;
    if (seconds == null || seconds <= 0) throw new Error(`Fila ${sourceRow + 1}: tiempo «${item.time}»${item.gap ? ` / «${item.gap}»` : ''} no reconocido`);
    if (lastSeconds != null && seconds < lastSeconds) throw new Error(`Fila ${sourceRow + 1}: tiempo inferior al anterior`);
    if (rank === 1) winnerSeconds = seconds;
    lastSeconds = seconds;
    rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText: hms(seconds), timeSeconds: String(seconds),
      gapText: rank === 1 ? null : gap(seconds - winnerSeconds) });
  }
  return { rows, warnings, unfinished, winnerSeconds };
}

/** Huella de una lista: cambia con cada llegada y con cualquier corrección. */
export const raceresultDigest = sourceRows => createHash('sha1').update(JSON.stringify(sourceRows)).digest('hex');

/** Lista de clasificación visible de un concurso en la configuración del evento. */
export function raceresultResultsList(config, contest) {
  const lists = (config?.Tab?.Config?.Lists || config?.TabConfig?.Lists || []).filter(list => list.Mode !== 'hidden'
    && !/lap report/i.test(`${list.Name} ${list.ShowAs}`) && /results/i.test(`${list.ShowAs} ${list.Name}`));
  const own = lists.filter(list => String(list.Contest) === String(contest));
  const found = own.length ? own : lists.filter(list => String(list.Contest) === '0');
  const names = [...new Set(found.map(list => list.Name))];
  if (names.length !== 1) throw new Error(names.length ? `Varias listas de clasificación para el concurso ${contest}: ${names.join(' | ')}` : `Sin lista de clasificación visible para el concurso ${contest}`);
  return names[0];
}

/**
 * Concursos leídos → documento. `map`: `{ concurso[/día]: categoría }`. Un concurso
 * sin clasificados queda en `skipped`; uno incoherente o cuyo nombre no es la
 * categoría asignada, en `invalid`, sin afectar a los demás. Con
 * `source: 'raceresult'` cada categoría acredita el enlace (`evidence.raceresult`).
 */
export function buildRaceresultCxDocument({ eventUrl, eventName = null, contests, map, raceId, seasonKey, dateKey, source = 'manual' }) {
  const categories = []; const skipped = []; const invalid = []; const warnings = []; const seen = new Set();
  for (const [rawKey, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (seen.has(category)) throw new Error(`Categoría ${category} asignada a varios concursos`);
    seen.add(category);
    const { key } = raceresultKey(rawKey);
    const read = contests.find(item => item.key === key);
    if (!read) { skipped.push({ category, reason: `Concurso ${key} no consultado` }); continue; }
    if (read.error) { invalid.push({ category, reason: `Concurso ${key}: ${read.error}` }); continue; }
    const named = raceresultContestCategory(read.contestName);
    if (named !== category) { invalid.push({ category, reason: `Concurso ${key} «${read.contestName}» no corresponde a ${category}` }); continue; }
    let parsed;
    try { parsed = parseRaceresultRows(read.rows); } catch (error) { invalid.push({ category, reason: `${read.contestName}: ${error.message}` }); continue; }
    if (!parsed.rows.some(row => row.rank != null)) { skipped.push({ category, reason: `Concurso «${read.contestName}» aún sin clasificados en RaceResult` }); continue; }
    warnings.push(...parsed.warnings.map(item => ({ category, ...item })));
    categories.push({ category, dateKey, sourceContest: key, sourceContestName: read.contestName, sourceList: read.listName, sourceSelector: read.selector,
      sourceHeadline: read.headline, sourceDigest: raceresultDigest(read.rows), unfinished: parsed.unfinished,
      evidence: { sourceUrl: `${eventUrl}#${key.split('/')[0]}`, ...(source === 'raceresult' ? { raceresult: { sourceUrl: eventUrl, contest: key } } : {}) },
      rows: parsed.rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: eventUrl, timer: 'RACE|RESULT', eventName }, categories, skipped, invalid, warnings };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url.replace(/key=[^&]+/, 'key=…')}`);
  return response.json();
}

/**
 * Lee los concursos de `keys` («26», «26/2»). Sin día fijado se usa la lista por
 * defecto; si sale vacía y el selector ofrece días, el único día con inscritos.
 * Un concurso que falla queda con `error` sin detener los demás.
 */
export async function fetchRaceresultContests(url, keys, { fetchImpl = fetch } = {}) {
  const eventUrl = raceresultEventUrl(url); const eventId = raceresultEventId(eventUrl);
  const config = await getJson(`https://my.raceresult.com/${eventId}/results/config?lang=en`, fetchImpl);
  if (!config?.key || !/^my\d*\.raceresult\.com$/.test(config.server || '')) throw new Error('Configuración RaceResult sin clave ni servidor reconocido');
  const listUrl = (listName, contest, selector) => `https://${config.server}/${eventId}/results/list?key=${encodeURIComponent(config.key)}`
    + `&listname=${encodeURIComponent(listName)}&page=results&contest=${contest}&r=all&l=0${selector ? `&selectorResult=${selector}` : ''}`;
  const contests = [];
  for (const raw of keys) {
    const { key, contest, selector } = raceresultKey(raw);
    const contestName = clean(config.contests?.[contest]);
    try {
      if (!contestName) throw new Error('no existe en el evento');
      const listName = raceresultResultsList(config, contest);
      let list = parseRaceresultList(await getJson(listUrl(listName, contest, selector), fetchImpl)); let used = selector;
      if (!selector && !list.rows.length && list.selectors.length) {
        const filled = [];
        for (const option of list.selectors) {
          const candidate = parseRaceresultList(await getJson(listUrl(listName, contest, option.id), fetchImpl));
          if (candidate.rows.length) filled.push({ option, candidate });
        }
        if (filled.length > 1) throw new Error(`inscritos en varios días del selector (${filled.map(item => item.option.label).join(', ')}); fijar el día en la clave`);
        if (filled.length) { list = filled[0].candidate; used = filled[0].option.id; }
      }
      contests.push({ key, contest, selector: used, contestName, listName, headline: list.headline, rows: list.rows });
    } catch (error) {
      contests.push({ key, contest, selector, contestName, error: error.message });
    }
  }
  return { eventUrl, eventName: clean(config.eventname) || null, eventOver: !!config.EventOver, contests };
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['url', 'race-id', 'season-key', 'date', 'map']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  const map = Object.fromEntries(options.map.split(',').map(pair => pair.split('=').map(clean)));
  const fetched = await fetchRaceresultContests(options.url, Object.keys(map));
  const document = buildRaceresultCxDocument({ ...fetched, map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ eventOver: fetched.eventOver, categories: document.categories.map(c => ({ category: c.category, contest: c.sourceContestName,
    rows: c.rows.length, unfinished: c.unfinished })), skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
