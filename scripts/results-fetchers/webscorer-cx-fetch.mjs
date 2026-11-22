#!/usr/bin/env node
/**
 * Webscorer (webscorer.com, cronometraje con chip RFID de organizadores de
 * Norteamérica: Mountain Events en la serie North Carolina Cyclo-Cross y su
 * North Carolina Grand Prix) → documento de resultados CX (contrato de
 * cx-results-upsert.mjs, `source=manual`).
 *
 * Una carrera de Webscorer es una oleada: `webscorer.com/racedetails?raceid=<id>`
 * sirve en el HTML la tabla completa de todas las categorías de la oleada
 * (Place, Bib, Name + Affiliation, Category, Age, Gender, tiempos por vuelta,
 * Finish time, Laps/Difference). El título de la página lleva la fecha local con
 * su zona y el estado de la clasificación («Final results» cuando el
 * cronometrador la cierra); es la única marca de clasificación definitiva.
 *
 *   node scripts/results-fetchers/webscorer-cx-fetch.mjs --url <oleada1>,<oleada2> \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-21 \
 *     --map 'Elite Men Pro/CX1/CX2/CX3|M=ME,Elite Women|F=WE' [--allow-live true] [--out doc.json]
 *
 * `--url` admite URL `race?raceid=<id>`, `racedetails?raceid=<id>` o el ID
 * desnudo. Sin `--map` solo lista las categorías de las oleadas, con su sexo y
 * número de filas, para construirlo. `--list-account <id de cuenta>` lista las
 * carreras (oleadas) publicadas por una cuenta de Webscorer, por ejemplo
 * `3812` (North Carolina Cyclocross), con las más recientes primero.
 *
 * Clave del mapa: «<categoría>» o «<categoría>|M» / «<categoría>|F». El sexo es
 * necesario cuando la categoría de Webscorer mezcla ambos (en la oleada de la
 * Race 9 de la NCCX, una mujer corre en «Elite Men Pro/CX1/CX2/CX3»).
 *
 * Puestos: Webscorer numera por oleada, así que cada categoría se renumera por
 * su orden. Quien completa menos vueltas que el ganador lleva «-n lap(s)» como
 * tiempo: es `irm=LAP` con `gapText=-n LAP` y sin tiempo. DNF, DNS y DSQ no
 * llevan puesto. Los tiempos y las diferencias se truncan al segundo; la
 * diferencia de cada llegada se comprueba contra su tiempo.
 *
 * La tabla no publica nacionalidad, licencia UCI ni nacimiento. La afiliación
 * («NC - Foothills Cycling») trae el estado o la provincia de la licencia: un
 * estado de EE. UU. da `US` y una provincia de Canadá `CA`, siempre marcado como
 * inferido para que una ficha verificada con el mismo nombre aporte la suya. Un
 * extranjero sin estado queda sin nacionalidad y la ingesta no crea su ficha.
 * Sin dorsal de licencia UCI, la identidad se resuelve por nombre.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { personCase } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));
const STATES = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ' };
const PARTICLES = new Set(['de', 'del', 'della', 'di', 'da', 'dos', 'das', 'van', 'von', 'der', 'den', 'la', 'le', 'du', 'ter', 'ten']);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code.toLowerCase()] ?? match);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cellText = value => clean(decode(String(value ?? '').replace(/<[^>]+>/g, ' ')));
const upper = token => /\p{Lu}/u.test(token) && !/\p{Ll}/u.test(token);
const fold = value => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hms = total => `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}` : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const gapOf = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/** ID de carrera de Webscorer a partir de una URL `race?raceid=`, `racedetails?raceid=` o el número. */
export function webscorerRaceId(value) {
  const text = clean(value);
  if (/^\d{3,9}$/.test(text)) return text;
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`URL Webscorer no reconocida: ${value}`); }
  const id = parsed.searchParams.get('raceid');
  if (parsed.protocol !== 'https:' || !['webscorer.com', 'www.webscorer.com'].includes(parsed.host)
    || !/^\/(?:race|racedetails)$/i.test(parsed.pathname) || !/^\d{3,9}$/.test(id || '')) throw new Error(`URL Webscorer no reconocida: ${value}`);
  return id;
}
export const webscorerResultsUrl = id => `https://www.webscorer.com/racedetails?raceid=${webscorerRaceId(id)}`;

/** Tiempo de meta «1:01:26.9», «48:24.5», «0:48.2» → décimas de segundo; otro texto → null. */
export function webscorerTenths(value) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d))?\d*$/.exec(clean(value));
  return match ? ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 10 + Number(match[4] || 0) : null;
}
/** Diferencia «+0:03.2», «+1:44.6», «+1:02:03.4» → décimas; «-» y otro texto → null. */
export function webscorerGapTenths(value) {
  const match = /^\+\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d))?\d*$/.exec(clean(value));
  return match ? ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 10 + Number(match[4] || 0) : null;
}

/** «Nate Morse» → nombre y apellido; el apellido es el último token con las partículas que lo preceden. */
export function webscorerName(value) {
  const tokens = clean(value).split(' ').filter(Boolean);
  if (tokens.length < 2) throw new Error(`Nombre «${value}» sin apellido`);
  let index = tokens.length - 1;
  while (index > 1 && PARTICLES.has(tokens[index - 1].toLowerCase())) index--;
  const first = tokens.slice(0, index).join(' '); const last = tokens.slice(index).join(' ');
  const fix = text => upper(text) ? personCase(text) : text;
  return { firstName: fix(first), lastName: fix(last) };
}

/** «NC - Foothills Cycling», «NC», «Foothills Cycling» → estado, equipo y nacionalidad inferida. */
export function webscorerAffiliation(value) {
  const text = clean(value);
  const match = /^([A-Z]{2})(?:\s+-\s+(.*))?$/.exec(text);
  const region = match && (US_STATES.has(match[1]) || CA_PROVINCES.has(match[1])) ? match[1] : null;
  const team = region ? clean(match[2]) : text;
  return { region, teamName: team || null, country: region ? (US_STATES.has(region) ? 'US' : 'CA') : null };
}

/** Fecha local y estado de la clasificación: «Sunday, November 15, 2026 3:39 PM (GMT-5) - Final results». */
export function webscorerRaceDate(text) {
  const match = /([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) \(GMT([+-]\d{1,2}(?::\d{2})?)\)/.exec(text);
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (month < 0) return null;
  return { dateKey: `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`,
    time: `${String(Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[5]}`, gmt: match[7] };
}

/** Página `racedetails` → `{ name, waveLeaderLaps, date, state, updated, rows }` con las celdas de la fuente. */
export function parseWebscorerPage(html) {
  const name = cellText((/<h1 class="race-name">([\s\S]*?)<\/h1>/.exec(html) || [])[1]);
  const dateLine = (/<p class="race-date">([\s\S]*?)<\/p>/.exec(html) || [])[1] || '';
  const table = /<table[^>]*id="RaceTable"[\s\S]*?<\/table>/.exec(html);
  if (!name || !table) throw new Error('Página Webscorer sin nombre de carrera o sin tabla de resultados');
  const header = [...table[0].matchAll(/<th[^>]*class="([^"]*)"/g)].map(([, cls]) => cls.trim());
  for (const cls of ['place', 'bibnumber', 'name', 'category', 'gender', 'time', 'difference']) {
    if (!header.includes(cls)) throw new Error(`Cabecera Webscorer sin la columna «${cls}»`);
  }
  const rows = [...table[0].matchAll(/<tr class="rowBg-mod\d">([\s\S]*?)<\/tr>/g)].map(([, row], index) => {
    const cell = cls => (new RegExp(`<td[^>]*class=['"]${cls}['"][^>]*>([\\s\\S]*?)</td>`).exec(row) || [])[1];
    const runner = cell('r-racername');
    if (runner === undefined) throw new Error(`Fila ${index + 1}: sin celda de nombre`);
    const affiliation = (/<span class='team-name'>([\s\S]*?)<\/span>/.exec(runner) || [])[1];
    const lapRaceTimes = [...row.matchAll(/<li class='lap-race-time-rank'>([^<]*)<span>/g)].map(([, time]) => clean(time));
    return { place: cellText(cell('r-place')), bib: cellText(cell('r-bibnumber')), name: cellText(runner.replace(/<span class='team-name'>[\s\S]*?<\/span>/, '')),
      affiliation: cellText(affiliation), category: cellText(cell('r-category')), age: cellText(cell('r-age')), gender: cellText(cell('r-gender')),
      time: cellText(cell('r-finish-time')), laps: cellText((/sel-L[^>]*>([^<]*)</.exec(cell('r-difference') || '') || [])[1]),
      gap: cellText((/sel-D[^>]*>([\s\S]*?)<\/span><span class='sel_ddDiffCol sel-P/.exec(cell('r-difference') || '') || [])[1]), lapRaceTimes };
  });
  const waveLeaderLaps = Math.max(0, ...rows.filter(row => /^\d+$/.test(row.place)).map(row => Number(row.laps) || 0)) || null;
  return { name, waveLeaderLaps, date: webscorerRaceDate(dateLine), state: cellText((/id="CPH1_lbResultsState">([\s\S]*?)<\/span>/.exec(html) || [])[1]) || null,
    updated: cellText((/Updated:<\/td>\s*<td>([\s\S]*?)<\/td>/.exec(html) || [])[1]) || null, rows };
}

/**
 * Filas de una categoría → filas del contrato CX. `waveLeaderLaps` son las
 * vueltas del líder de la oleada: Webscorer escribe «-n lap» frente a él, no
 * frente al ganador de cada categoría (en una oleada con categorías de distinta
 * duración, el ganador de una categoría corta aparece como «-2 laps»; su tiempo
 * es el acumulado de su última vuelta en la tabla de pasos). Lanza si la
 * clasificación no es coherente: puestos no crecientes, vueltas que aumentan,
 * tiempos que bajan con las mismas vueltas, vueltas perdidas que no cuadran con
 * las del líder, diferencia que no corresponde al tiempo (solo en la categoría
 * del líder de la oleada, donde la tabla la calcula frente al mismo ganador) o
 * un estado desconocido.
 */
export function parseWebscorerRows(sourceRows, { waveLeaderLaps = null } = {}) {
  const rows = []; let leaderLaps = null; let winnerTenths = null; let lastPlace = 0; let lastLaps = Infinity; let lastTenths = 0;
  const checkGap = sourceRows[0]?.place === '1';
  for (const [sourceRow, item] of sourceRows.entries()) {
    const label = `Fila ${sourceRow + 1} (${item.name})`;
    const { firstName, lastName } = webscorerName(item.name);
    const { region, teamName, country } = webscorerAffiliation(item.affiliation);
    const base = { bib: /^\d+$/.test(item.bib) ? item.bib : null, riderDisplay: `${firstName} ${lastName}`, firstName, lastName, sourceName: item.name,
      teamName, sourceRegion: region, isoCode2: country, isoCode2Inferred: !!country, bonusSeconds: null, sourceSortOrder: sourceRow };
    const state = STATES[item.time.toUpperCase()];
    if (state) { rows.push({ ...base, rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null }); continue; }
    if (rows.some(row => row.irm && row.irm !== 'LAP')) throw new Error(`${label}: clasificado tras un ${rows.find(row => row.irm && row.irm !== 'LAP').irm}`);
    const place = /^\d+$/.test(item.place) ? Number(item.place) : null;
    const laps = /^\d+$/.test(item.laps) ? Number(item.laps) : null;
    if (!place || !laps) throw new Error(`${label}: puesto «${item.place}» o vueltas «${item.laps}» no reconocidos`);
    if (place <= lastPlace) throw new Error(`${label}: puesto ${place} no posterior a ${lastPlace}`);
    if (laps > lastLaps) throw new Error(`${label}: ${laps} vueltas tras ${lastLaps}`);
    lastPlace = place;
    const waveLaps = waveLeaderLaps ?? laps;
    const lost = /^-\s*(\d+)\s+laps?$/i.exec(item.time);
    if (lost ? waveLaps - laps !== Number(lost[1]) : laps !== waveLaps) throw new Error(`${label}: tiempo «${item.time}» y ${laps} vueltas no cuadran con las ${waveLaps} del líder de la oleada`);
    const tenths = webscorerTenths(lost ? item.lapRaceTimes?.[laps - 1] : item.time);
    if (tenths == null || tenths <= 0) throw new Error(`${label}: sin tiempo reconocible (${lost ? `paso de la vuelta ${laps}` : item.time})`);
    const rank = rows.filter(row => row.rank != null).length + 1;
    if (rank === 1) { leaderLaps = laps; winnerTenths = tenths; }
    if (laps < leaderLaps) {
      lastLaps = laps; lastTenths = 0;
      rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${leaderLaps - laps} LAP`, timeText: null, timeSeconds: null, laps });
      continue;
    }
    if (laps < lastLaps) lastTenths = 0;
    if (tenths < lastTenths) throw new Error(`${label}: tiempo ${item.time} inferior al anterior con las mismas vueltas`);
    lastLaps = laps; lastTenths = tenths;
    if (rank > 1 && checkGap) {
      const gap = webscorerGapTenths(item.gap);
      if (gap == null || Math.abs(gap - (tenths - winnerTenths)) > 2) throw new Error(`${label}: diferencia «${item.gap}» no corresponde al tiempo ${item.time}`);
    }
    rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText: hms(Math.floor(tenths / 10)), timeSeconds: String(Math.floor(tenths / 10)),
      gapText: rank === 1 ? null : gapOf(Math.floor((tenths - winnerTenths) / 10)), laps });
  }
  return { rows, leaderLaps };
}

/** Huella de una categoría: cambia con cualquier paso por meta o corrección. */
export const webscorerDigest = sourceRows => createHash('sha1').update(JSON.stringify(sourceRows)).digest('hex');

/** Clave del mapa «<categoría>|<sexo>» → `{ category, gender }` normalizados. */
export function webscorerKey(key) {
  const [category, gender = null, ...rest] = String(key).split('|').map(clean);
  if (!category || rest.length || (gender && !['M', 'F'].includes(gender.toUpperCase()))) throw new Error(`Clave Webscorer inválida: ${key}`);
  return { category: fold(category), gender: gender ? gender.toUpperCase() : null, label: gender ? `${category}|${gender.toUpperCase()}` : category };
}

/**
 * Páginas leídas → documento. `map`: `{ «categoría|sexo»: categoría CX }`. Una
 * categoría ausente, sin filas, de una oleada sin «Final results» (salvo
 * `allowLive`) o de otra fecha queda en `skipped`/`invalid` sin afectar a las demás.
 */
export function buildWebscorerCxDocument({ pages, map, raceId, seasonKey, dateKey, allowLive = false }) {
  const categories = []; const skipped = []; const invalid = []; const seen = new Set();
  for (const [key, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (seen.has(category)) throw new Error(`Categoría ${category} asignada a varias claves`);
    seen.add(category);
    const wanted = webscorerKey(key);
    const found = pages.map(page => ({ page, rows: page.rows.filter(row => fold(row.category) === wanted.category && (!wanted.gender || row.gender.toUpperCase() === wanted.gender)) }))
      .filter(item => item.rows.length);
    if (!found.length) { skipped.push({ category, reason: `«${wanted.label}» aún sin filas en Webscorer` }); continue; }
    if (found.length > 1) { invalid.push({ category, reason: `«${wanted.label}» presente en ${found.length} oleadas` }); continue; }
    const { page, rows: sourceRows } = found[0];
    if (!page.date || page.date.dateKey !== dateKey) { invalid.push({ category, reason: `Oleada «${page.name}» fechada ${page.date?.dateKey ?? 'sin fecha'}, no ${dateKey}` }); continue; }
    const final = /^final results?$/i.test(page.state || '');
    if (!final && !allowLive) { skipped.push({ category, reason: `Oleada «${page.name}» sin «Final results» (estado: ${page.state ?? 'desconocido'})` }); continue; }
    let parsed;
    try { parsed = parseWebscorerRows(sourceRows, { waveLeaderLaps: page.waveLeaderLaps }); } catch (error) { invalid.push({ category, reason: `${wanted.label}: ${error.message}` }); continue; }
    categories.push({ category, dateKey, sourceGroup: wanted.label, sourceWave: page.name, resultsState: page.state, sourceDigest: webscorerDigest(sourceRows),
      leaderLaps: parsed.leaderLaps, evidence: { sourceUrl: page.url, webscorer: { raceId: page.raceId, wave: page.name, state: page.state, updated: page.updated, group: wanted.label } },
      rows: parsed.rows });
  }
  return { schemaVersion: 1, source: 'manual', disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: pages[0]?.url ?? null, timer: 'Webscorer', waves: pages.map(page => ({ url: page.url, name: page.name, state: page.state, updated: page.updated })) },
    categories, skipped, invalid, warnings: [] };
}

/** Resumen de las categorías de las oleadas, para construir el `--map`. */
export function webscorerGroups(pages) {
  const groups = new Map();
  for (const page of pages) for (const row of page.rows) {
    const key = `${row.category}|${row.gender}`; const entry = groups.get(key) || { category: row.category, gender: row.gender, wave: page.name, state: page.state, rows: 0 };
    entry.rows++; groups.set(key, entry);
  }
  return [...groups.values()];
}

/** Carreras (oleadas) de una cuenta de Webscorer, las más recientes primero. */
export function parseWebscorerAccount(html) {
  const seen = new Set();
  return [...html.matchAll(/<a [^>]*href="\/?(?:https:\/\/www\.webscorer\.com\/)?race\?raceid=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, id, label]) => ({ raceId: id, name: cellText(label) })).filter(item => item.name && !seen.has(item.raceId) && seen.add(item.raceId));
}

async function get(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

/** Lee las oleadas indicadas. */
export async function fetchWebscorerPages(urls, { fetchImpl = fetch } = {}) {
  const pages = [];
  for (const value of urls) {
    const raceId = webscorerRaceId(value); const url = webscorerResultsUrl(raceId);
    pages.push({ ...parseWebscorerPage(await get(url, fetchImpl)), raceId, url });
  }
  return pages;
}

export async function fetchWebscorerAccount(accountId, { fetchImpl = fetch } = {}) {
  if (!/^\d{1,9}$/.test(String(accountId))) throw new Error(`Cuenta Webscorer inválida: ${accountId}`);
  return parseWebscorerAccount(await get(`https://www.webscorer.com/${accountId}`, fetchImpl));
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  if (out['list-account']) return out;
  for (const key of ['url', ...(out.map ? ['race-id', 'season-key', 'date'] : [])]) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options['list-account']) {
    for (const item of (await fetchWebscorerAccount(options['list-account'])).slice(0, 40)) process.stdout.write(`${item.raceId}\t${item.name}\n`);
    return;
  }
  const pages = await fetchWebscorerPages(options.url.split(',').map(clean).filter(Boolean));
  if (!options.map) {
    for (const group of webscorerGroups(pages)) process.stdout.write(`${group.category}|${group.gender}\t${group.rows} filas\t${group.wave}\t${group.state ?? 'sin estado'}\n`);
    return;
  }
  const map = Object.fromEntries(options.map.split(',').map(pair => { const at = pair.lastIndexOf('='); return [clean(pair.slice(0, at)), clean(pair.slice(at + 1))]; }));
  const document = buildWebscorerCxDocument({ pages, map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date,
    allowLive: options['allow-live'] === 'true' });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, group: c.sourceGroup, state: c.resultsState, rows: c.rows.length })),
    skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
