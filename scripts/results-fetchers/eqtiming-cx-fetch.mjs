#!/usr/bin/env node
/**
 * EQ Timing (live.eqtiming.com) → documento de resultados CX (contrato de
 * cx-results-upsert.mjs). Cronometrador de las pruebas noruegas y nórdicas
 * (Campeonato de Noruega, NorgesCup, Norway Cross).
 *
 * El enlace de una carrera es la página del evento `https://live.eqtiming.com/<id>`
 * y `categoryKeys` asigna cada clase del evento (`Klasse.Navn`) a una categoría
 * propia: `{"M Senior Elite": "ME", "K Senior Elite": "WE", "M Junior Elite": "MJ",
 * "K Junior Elite": "WJ"}`. API pública sin autenticación:
 *   GET /api/Event/<id>                                  → clases, mangas (Etapper) y fecha
 *   GET /api/Result/Class/<id>/<manga>/<clase>?count=999&station=0&round=0
 *                                                        → clasificación final de la clase
 *   GET /api/Startlist/<id>/<manga>?count=999&classes=<clase>  → inscritos de la clase
 * Sin `round=0` el API devuelve la clasificación tras la primera vuelta, no la
 * final: en una carrera por vueltas (`ErRundeRitt`) `round=0` ordena por vueltas
 * completadas y tiempo. Una manga agrupa varias clases (en el Campeonato de
 * Noruega, K Senior Elite y K Junior Elite salen juntas) y una clase puede figurar
 * en varias mangas del evento; solo una de ellas lleva resultados.
 *
 *   node scripts/results-fetchers/eqtiming-cx-fetch.mjs --url https://live.eqtiming.com/83954 \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-14 \
 *     --map 'M Senior Elite=ME,K Senior Elite=WE,M Junior Elite=MJ,K Junior Elite=WJ' [--out doc.json]
 *
 * La clasificación se publica en directo y sin marca de definitiva: cada categoría
 * lleva su huella (`sourceDigest`), las vueltas del líder frente a las previstas en
 * su manga (`leaderLaps`, `plannedLaps`) y los inscritos todavía sin fila de
 * resultado (`unfinished`) para que el worker publique solo la tabla que deja de
 * cambiar. Puesto: orden de la API, con las vueltas perdidas respecto del líder
 * como `irm=LAP` (`-n LAP`, sin tiempo). Tiempos truncados al segundo.
 *
 * Datos de corredor por fila: nombre y apellido separados, ISO-2, año de nacimiento
 * (`birthYear`, sin día ni mes) y UCI ID de 11 dígitos (`uciLicenseId`, del bloque
 * `Lisens`), que resuelve la ficha antes que el nombre.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { personCase } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const API = 'https://live.eqtiming.com/api';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const STATES = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', EX: 'DSQ', OTL: 'OTL', HD: 'OTL', ABD: 'ABD' };
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = text => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
const nameCase = value => { const text = clean(value); return upper(text) ? personCase(text) : text; };
const list = value => Array.isArray(value) ? value : Object.values(value || {});
const hms = total => `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}` : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/** Cualquier URL o número de evento → página canónica, que es el `sourceUrl` del enlace. */
export function eqtimingEventUrl(value) {
  const text = clean(value);
  if (/^[1-9]\d{4,9}$/.test(text)) return `https://live.eqtiming.com/${text}`;
  let parsed; try { parsed = new URL(text); } catch { parsed = null; }
  const match = parsed && /^\/([1-9]\d{4,9})\/?$/.exec(parsed.pathname);
  if (!parsed || parsed.protocol !== 'https:' || parsed.host !== 'live.eqtiming.com' || !match) throw new Error(`URL EQ Timing no reconocida: ${value}`);
  return `https://live.eqtiming.com/${match[1]}`;
}
export const eqtimingEventId = url => /^https:\/\/live\.eqtiming\.com\/(\d+)$/.exec(eqtimingEventUrl(url))[1];

/** Clave de `categoryKeys`: nombre de la clase tal como lo publica el evento («M Senior Elite»). */
export function eqtimingClassKey(value) {
  const key = clean(value);
  if (!key || key.length > 60) throw new Error(`Clase EQ Timing inválida: ${value}`);
  return key;
}

/** UCI ID de 11 dígitos del bloque `Lisens` («100 195 527 56»); null si falta o no es válido. */
export function eqtimingLicenseId(licenses) {
  const entries = list(licenses);
  for (const type of ['UCI ID', 'UCI ID MANUEL']) {
    for (const entry of entries) {
      if (clean(entry?.Type).toUpperCase() !== type) continue;
      const digits = String(entry?.Kode ?? '').replace(/\s+/g, '');
      if (/^\d{11}$/.test(digits)) return digits;
    }
  }
  return null;
}

/**
 * Filas de una clase (orden del API) → filas del contrato CX. Lanza si la
 * clasificación no es coherente: puestos que no crecen, más vueltas que el líder,
 * un clasificado tras un estado o tras un doblado, tiempos que bajan en la misma
 * vuelta, sexo distinto del de la categoría o un estado desconocido.
 */
export function parseEqtimingRows(items, category) {
  const male = category.startsWith('M');
  const rows = []; const warnings = [];
  let leaderLaps = null; let winnerSeconds = null; let plannedLaps = null; let heat = null;
  let lastLaps = Infinity; let lastSeconds = null; let lastApiRank = 0; let rank = 0; let state = null;
  for (const [sourceRow, item] of items.entries()) {
    const entry = item?.Deltaker; const person = entry?.Utover;
    const firstName = nameCase(person?.Fornavn); const lastName = nameCase(person?.Etternavn);
    if (!firstName || !lastName) throw new Error(`Fila ${sourceRow + 1}: nombre «${clean(person?.Fornavn)} ${clean(person?.Etternavn)}» sin apellido`);
    if (person.Kjonn && (clean(person.Kjonn).toLowerCase() === 'm') !== male) throw new Error(`Fila ${sourceRow + 1}: ${firstName} ${lastName} no corresponde al sexo de ${category}`);
    const iso = clean(person?.Land?.ISO2).toUpperCase();
    const year = Number(person?.Aar);
    const base = { bib: /^\d+$/.test(clean(entry?.Startnummer)) ? clean(entry.Startnummer) : null, riderDisplay: `${firstName} ${lastName}`, firstName, lastName,
      sourceName: `${clean(person.Fornavn)} ${clean(person.Etternavn)}`, teamName: clean(person?.Team?.Navn) || clean(entry?.Klubbnavn || person?.Klubbnavn || person?.Klubb?.Navn) || null,
      isoCode2: /^[A-Z]{2}$/.test(iso) ? iso : null, uciLicenseId: eqtimingLicenseId(entry?.Lisens),
      birthYear: Number.isInteger(year) && year >= 1900 && year <= new Date().getUTCFullYear() ? year : null, bonusSeconds: null, sourceSortOrder: sourceRow };
    const status = clean(item.StatusTekst).toUpperCase();
    if (status !== 'TIME') {
      if (!STATES[status]) throw new Error(`Fila ${sourceRow + 1}: estado «${clean(item.StatusTekst)}» no reconocido`);
      state = STATES[status];
      rows.push({ ...base, rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null });
      continue;
    }
    if (state) throw new Error(`Fila ${sourceRow + 1}: clasificado tras un ${state}`);
    const laps = Number(item.Rundenummer); const milliseconds = Number(item.AkkumulertTid);
    if (!Number.isInteger(laps) || laps < 1) throw new Error(`Fila ${sourceRow + 1}: vueltas «${item.Rundenummer}» no válidas`);
    if (!Number.isFinite(milliseconds) || milliseconds < 1000) throw new Error(`Fila ${sourceRow + 1}: tiempo «${item.AkkumulertTid}» no válido`);
    const seconds = Math.floor(milliseconds / 1000);
    const apiRank = Number(item.Plassering?.Klasse);
    if (!Number.isInteger(apiRank) || apiRank <= lastApiRank) throw new Error(`Fila ${sourceRow + 1}: puesto ${item.Plassering?.Klasse} no posterior a ${lastApiRank}`);
    lastApiRank = apiRank; rank++;
    if (apiRank !== rank) warnings.push({ sourceRow, reason: `Puesto ${apiRank} de la fuente en el lugar ${rank}: se renumera dentro de la categoría` });
    if (rank === 1) {
      leaderLaps = laps; winnerSeconds = seconds; plannedLaps = Number(entry?.Pulje?.Runder) || null; heat = clean(entry?.Pulje?.Navn) || null;
    } else {
      if (laps > leaderLaps) throw new Error(`Fila ${sourceRow + 1}: ${laps} vueltas, más que el ganador (${leaderLaps})`);
      if (laps > lastLaps) throw new Error(`Fila ${sourceRow + 1}: ${laps} vueltas tras ${lastLaps}`);
      if (laps === lastLaps && seconds < lastSeconds) throw new Error(`Fila ${sourceRow + 1}: tiempo inferior al anterior en la misma vuelta`);
    }
    lastLaps = laps; lastSeconds = seconds;
    if (laps < leaderLaps) {
      rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${leaderLaps - laps} LAP`, timeText: null, timeSeconds: null });
    } else {
      rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText: hms(seconds), timeSeconds: String(seconds), gapText: rank === 1 ? null : gap(seconds - winnerSeconds) });
    }
  }
  return { rows, warnings, leaderLaps, plannedLaps, winnerSeconds, heat };
}

/** Huella de una clase: cambia con cada paso por meta, cada estado y cada corrección. */
export const eqtimingDigest = (items, entered = []) => createHash('sha1').update(JSON.stringify([
  items.map(item => [item?.Deltaker?.Startnummer, item?.StatusTekst, item?.Rundenummer, item?.AkkumulertTid, item?.Plassering?.Klasse]),
  [...entered].sort()])).digest('hex');

/**
 * Clases leídas → documento. `map`: `{ clase: categoría }`. Una clase sin
 * resultados queda en `skipped`; una incoherente, con fecha distinta o repartida
 * en varias mangas, en `invalid`, sin afectar a las demás. Con `source:
 * 'eqtiming'` cada categoría acredita el enlace (`evidence.eqtiming`).
 */
export function buildEqtimingCxDocument({ eventUrl, eventName = null, eventDate = null, classes, map, raceId, seasonKey, dateKey, source = 'manual' }) {
  const categories = []; const skipped = []; const invalid = []; const warnings = []; const seen = new Set();
  for (const [rawKey, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (seen.has(category)) throw new Error(`Categoría ${category} asignada a varias clases`);
    seen.add(category);
    const key = eqtimingClassKey(rawKey);
    const read = classes.find(item => item.key === key);
    if (!read) { skipped.push({ category, reason: `Clase «${key}» no consultada` }); continue; }
    if (read.error) { invalid.push({ category, reason: `Clase «${key}»: ${read.error}` }); continue; }
    if (eventDate && eventDate !== dateKey) { invalid.push({ category, reason: `Evento EQ Timing del ${eventDate}, no del ${dateKey}` }); continue; }
    const withResults = read.stages.filter(stage => stage.items.length);
    if (!withResults.length) { skipped.push({ category, reason: `Clase «${key}» aún sin resultados en EQ Timing` }); continue; }
    if (withResults.length > 1) { invalid.push({ category, reason: `Clase «${key}» con resultados en varias mangas (${withResults.map(stage => stage.stageId).join(', ')})` }); continue; }
    const [stage] = withResults;
    let parsed;
    try { parsed = parseEqtimingRows(stage.items, category); } catch (error) { invalid.push({ category, reason: `Clase «${key}»: ${error.message}` }); continue; }
    if (!parsed.rows.some(row => row.rank != null)) { skipped.push({ category, reason: `Clase «${key}» aún sin clasificados en EQ Timing` }); continue; }
    warnings.push(...parsed.warnings.map(item => ({ category, ...item })));
    const resultBibs = new Set(stage.items.map(item => clean(item?.Deltaker?.Startnummer)));
    const missing = stage.entered.filter(bib => !resultBibs.has(bib));
    categories.push({ category, dateKey, sourceClass: key, sourceClassId: read.classId, sourceStage: stage.stageId, sourceHeat: parsed.heat,
      plannedLaps: parsed.plannedLaps, leaderLaps: parsed.leaderLaps, finished: parsed.plannedLaps != null && parsed.leaderLaps >= parsed.plannedLaps,
      winnerSeconds: parsed.winnerSeconds, unfinished: missing.length, sourceDigest: eqtimingDigest(stage.items, stage.entered),
      evidence: { sourceUrl: `${eventUrl}#dashboard`, ...(source === 'eqtiming' ? { eqtiming: { sourceUrl: eventUrl, class: key } } : {}) },
      rows: parsed.rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: eventUrl, timer: 'EQ Timing', eventName }, categories, skipped, invalid, warnings };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url.replace(API, '')}`);
  return response.json();
}

/**
 * Lee las clases de `classNames`. Descubre la topología en cada ejecución: el
 * organizador reparte las clases entre mangas y puede cambiarlas. Una clase que
 * falla queda con `error` sin detener las demás; los inscritos solo se consultan
 * cuando la clase ya tiene resultados.
 */
export async function fetchEqtimingClasses(url, classNames, { fetchImpl = fetch } = {}) {
  const eventUrl = eqtimingEventUrl(url); const eventId = eqtimingEventId(eventUrl);
  const event = await getJson(`${API}/Event/${eventId}`, fetchImpl);
  if (String(event?.UID) !== eventId || !event.Klasser || !event.Etapper) throw new Error('Evento EQ Timing sin identificador, clases o mangas reconocibles');
  if (event.Publiseres === false) throw new Error('Evento EQ Timing no publicado');
  const available = list(event.Klasser).map(item => ({ id: String(item.UID), name: clean(item.Navn) }));
  const stages = list(event.Etapper).filter(item => item?.UID && !item.GjemFraLive);
  const classes = [];
  for (const raw of classNames) {
    const key = eqtimingClassKey(raw);
    const found = available.filter(item => item.name === key);
    if (found.length !== 1) { classes.push({ key, error: found.length ? 'nombre repetido en el evento' : 'no existe en el evento' }); continue; }
    const classId = found[0].id;
    try {
      const own = stages.filter(stage => Object.keys(stage.Klasser || {}).includes(classId));
      if (!own.length) throw new Error('no figura en ninguna manga');
      const read = [];
      for (const stage of own) {
        const results = await getJson(`${API}/Result/Class/${eventId}/${stage.UID}/${classId}?count=999&station=0&round=0`, fetchImpl);
        const items = list(results?.Items);
        if (Number(results?.TotalItems) !== items.length) throw new Error(`manga ${stage.UID}: ${items.length} filas de ${results?.TotalItems}`);
        let entered = [];
        if (items.length) {
          const startlist = await getJson(`${API}/Startlist/${eventId}/${stage.UID}?count=999&classes=${classId}`, fetchImpl);
          entered = list(startlist?.Items).filter(item => String(item?.Klasse?.UID) === classId).map(item => clean(item.Startnummer));
        }
        read.push({ stageId: String(stage.UID), items, entered });
      }
      classes.push({ key, classId, stages: read });
    } catch (error) { classes.push({ key, classId, error: error.message }); }
  }
  return { eventUrl, eventName: clean(event.Navn) || null, eventDate: String(event.Dato || '').slice(0, 10) || null, timezone: clean(event.TidsSone) || null, classes };
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
  const map = Object.fromEntries(options.map.split(',').map(pair => { const at = pair.lastIndexOf('='); return [clean(pair.slice(0, at)), clean(pair.slice(at + 1))]; }));
  const fetched = await fetchEqtimingClasses(options.url, Object.keys(map));
  const document = buildEqtimingCxDocument({ ...fetched, map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ eventName: fetched.eventName, eventDate: fetched.eventDate, categories: document.categories.map(c => ({ category: c.category, class: c.sourceClass,
    rows: c.rows.length, leaderLaps: c.leaderLaps, plannedLaps: c.plannedLaps, finished: c.finished, unfinished: c.unfinished })), skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
