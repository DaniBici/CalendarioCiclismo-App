#!/usr/bin/env node
/**
 * smartweb (plataforma de inscripciones de la RFEC y las federaciones
 * autonómicas: rfec.com, fccv.es, fgalegaciclismo.es, ciclismoasturiano.es,
 * fedciclismocyl.com, fmciclismo.com…) → documento de resultados CX (contrato
 * de cx-results-upsert.mjs).
 *
 * La página `inscripciones/clasificacion/<prueba>` lista las clasificaciones
 * publicadas en dos selectores: el cronometraje de la federación
 * (`categorias_cronofec`, páginas `mostrar_categorias_cronofec_clasificacion`)
 * y el archivo que suben los árbitros (`categorias`, páginas
 * `mostrar_categorias_clasificacion_fichero`). Los identificadores de cada
 * selector no son intercambiables entre variantes, y el archivo sustituye
 * después al cronometraje: se prefiere el archivo y, sin él, el cronometraje.
 * El rótulo «Clasificación definitiva» es fijo y no indica estado.
 *
 *   node scripts/results-fetchers/smartweb-cx-fetch.mjs --url <clasificacion/<prueba>> \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-10-25 \
 *     --map 'ELITE-SUB23=ME,FEM ELITE-SUB23=WE,JUNIOR=MJ,FEM JUNIOR=WJ' [--out doc.json]
 *
 * La tabla no publica nacionalidad, licencia UCI ni nacimiento. La columna
 * «C.A Participante» («Comunidad Autónoma Participante» en la FCCV y la Vasca)
 * es la comunidad autónoma de la licencia: con un código
 * autonómico la fila lleva `ES` (licencia española en una NAC de España). Los
 * puestos se renumeran dentro de la categoría (las listas filtradas de una
 * manga conjunta dejan huecos) y las filas con puesto 0 y sin tiempo se omiten.
 * No resuelve fichas ni equipos: el documento conserva la grafía de la fuente
 * para la normalización posterior.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { personCase } from './cx-dataride-results.mjs';
import { resolveCxResultIdentity } from '../../js/cx/result-identity.js';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const HEADER = ['POS.', 'DORSAL', 'NOMBRE', 'APELLIDOS', 'CLUB\\EQUIPO', 'C.A PARTICIPANTE', 'TIEMPO'];
// Grafías equivalentes de una columna de `HEADER` según la federación.
const HEADER_ALIASES = { 'COMUNIDAD AUTÓNOMA PARTICIPANTE': 'C.A PARTICIPANTE' };
const VARIANTS = { fichero: 'mostrar_categorias_clasificacion_fichero', cronofec: 'mostrar_categorias_cronofec_clasificacion' };
const SELECTS = { showCategoriasFicheros: 'fichero', showCategorias_cronofec: 'cronofec' };
// Comunidades autónomas de la licencia (incluidas las variantes de cada federación).
const REGIONS = new Set(['AND', 'ARA', 'AST', 'BAL', 'IBA', 'CAN', 'CNR', 'CAT', 'CLM', 'CYL', 'CEU', 'EUS', 'EXT', 'GAL', 'MAD',
  'MEL', 'MUR', 'NAV', 'RIO', 'VLC']);
const NO_TEAM = new Set(['INDEPENDIENTE', 'INDIVIDUAL']);
// Abreviaturas de nombre de pila en las licencias («FCO. JOSE», «JOSE Mª»).
const GIVEN_NAMES = { 'FCO.': 'FRANCISCO', FCO: 'FRANCISCO', 'FDO.': 'FERNANDO', FDO: 'FERNANDO', 'MA.': 'MARIA', 'Mª': 'MARIA', 'M.ª': 'MARIA' };
const givenName = value => clean(value).split(' ').map(token => GIVEN_NAMES[token.toUpperCase()] || token).join(' ');
const STATES = [[/^(ret|retirado|abandono|ab|dnf)\.?$/i, 'DNF'], [/^(desc|descalificado|dsq)\.?$/i, 'DSQ'], [/^(no sale|n\.?s\.?|dns)$/i, 'DNS']];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code.toLowerCase()] ?? match);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cellText = value => clean(decode(value.replace(/<[^>]+>/g, ' ')));
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/** Rótulo de clasificación normalizado: clave de `categoryKeys` («ELITE - SUB-23» de la FCCV → «ELITE-SUB23»). */
export const smartwebLabel = value => clean(value).toUpperCase().replace(/ ?- ?/g, '-').replace(/\bSUB-(\d+)\b/g, 'SUB$1');

/**
 * URL de la prueba (ficha, inscritos o clasificación, con o sin slug) → índice
 * de clasificaciones canónico, que es el `sourceUrl` del enlace.
 */
export function smartwebIndexUrl(url) {
  const parsed = new URL(url);
  const match = /^\/(?:index\.php\/)?(?:[a-z]{2}\/)?smartweb\/inscripciones\/[a-z_]+\/(?:\d+\/)?([1-9]\d*)(?:-[^/]*)?\/?$/.exec(parsed.pathname);
  if (parsed.protocol !== 'https:' || !match) throw new Error(`URL smartweb no reconocida: ${url}`);
  return `https://${parsed.host}/index.php/smartweb/inscripciones/clasificacion/${match[1]}`;
}
const pruebaOf = indexUrl => /\/clasificacion\/(\d+)$/.exec(indexUrl)[1];
export const smartwebCategoryUrl = (indexUrl, variant, categoryId) =>
  indexUrl.replace(/\/clasificacion\/(\d+)$/, `/${VARIANTS[variant]}/${categoryId}/$1`);

/** Índice → fecha de la prueba (cuenta atrás de la página) y opciones de cada selector. */
export function parseSmartwebIndex(html) {
  const countdown = /var endDate = "([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(html);
  const month = countdown ? MONTHS.indexOf(countdown[1].toLowerCase()) + 1 : 0;
  const dateKey = month ? `${countdown[3]}-${String(month).padStart(2, '0')}-${countdown[2].padStart(2, '0')}` : null;
  const options = [];
  for (const [, attributes, body] of html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
    const variant = SELECTS[/onchange="\s*([A-Za-z_]+)\(/.exec(attributes)?.[1]];
    if (!variant) continue;
    for (const [, id, label] of body.matchAll(/<option value="([1-9]\d*)"[^>]*>([^<]*)/g)) {
      options.push({ variant, id, label: smartwebLabel(decode(label)) });
    }
  }
  return { dateKey, options };
}

/** Tabla de una clasificación → filas de la fuente; sin filas, lista vacía (aún sin publicar). */
export function parseSmartwebTable(html) {
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0];
  if (!table) throw new Error('Página smartweb sin tabla de clasificación');
  const header = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cellText(cell).toUpperCase())
    .map(cell => HEADER_ALIASES[cell] || cell);
  if (JSON.stringify(header) !== JSON.stringify(HEADER)) throw new Error(`Cabecera smartweb inesperada: ${header.join(' | ')}`);
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cellText(cell)))
    .filter(cells => cells.length)
    .map((cells, index) => {
      if (cells.length !== HEADER.length) throw new Error(`Fila ${index + 1}: ${cells.length} columnas`);
      const [pos, bib, firstName, lastName, team, region, time] = cells;
      return { pos, bib, firstName, lastName, team, region, time };
    });
}

// «00:53:21.787», «1:00:17» → segundos enteros (sin centésimas); otro texto → null.
export function smartwebSeconds(value) {
  const match = /^(\d+):(\d{2}):(\d{2})(?:[.,]\d+)?$/.exec(clean(value));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
// «Vta. perdida» → 1, «3 vtas. perdidas» → 3; otro texto → null.
export function smartwebLapsDown(value) {
  const match = /^(\d+)?\s*vtas?\.?\s+perdidas?$/i.exec(clean(value));
  return match ? Number(match[1] || 1) : null;
}

/**
 * Filas de la fuente → filas del contrato CX. `omitted` recoge las filas con
 * puesto 0 y sin tiempo («-»), que smartweb no califica como abandono ni no
 * presentado. Lanza si la clasificación no es coherente (sin ganador con
 * tiempo, tiempos decrecientes, doblados antes de llegadas, estado desconocido).
 */
export function parseSmartwebRows(sourceRows) {
  const rows = []; const omitted = []; const warnings = [];
  let lastPos = 0; let lastTime = 0; let lastDown = 0;
  for (const [sourceRow, item] of sourceRows.entries()) {
    const pos = /^\d+$/.test(item.pos) ? Number(item.pos) : null;
    const firstName = item.firstName ? personCase(givenName(item.firstName)) : null;
    const lastName = item.lastName ? personCase(item.lastName) : null;
    const region = item.region.toUpperCase();
    const base = { bib: item.bib || null, riderDisplay: clean(`${firstName || ''} ${lastName || ''}`) || null, firstName, lastName,
      sourceName: clean(`${item.lastName} ${item.firstName}`), teamName: NO_TEAM.has(item.team.toUpperCase()) ? null : item.team || null,
      isoCode2: REGIONS.has(region) ? 'ES' : null, sourceRegion: region || null, isoCode2Inferred: REGIONS.has(region), bonusSeconds: null, sourceSortOrder: sourceRow };
    // El estado figura en el tiempo o, en la FCCV, en el puesto («DNF» con tiempo «-»).
    const state = STATES.find(([pattern]) => pattern.test(item.time) || pattern.test(item.pos))?.[1];
    if (state) { rows.push({ ...base, rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null }); continue; }
    if (pos === 0 && ['', '-'].includes(item.time)) { omitted.push({ bib: base.bib, riderDisplay: base.riderDisplay, reason: 'Puesto 0 sin tiempo ni estado' }); continue; }
    if (!pos) throw new Error(`Fila ${sourceRow + 1}: puesto «${item.pos}» con tiempo «${item.time}»`);
    if (pos <= lastPos) throw new Error(`Fila ${sourceRow + 1}: puesto ${pos} no posterior a ${lastPos}`);
    if (pos !== lastPos + 1) warnings.push({ sourceRow, reason: `Puesto ${pos} tras ${lastPos}: se renumera dentro de la categoría` });
    lastPos = pos;
    const rank = rows.filter(row => row.rank != null).length + 1;
    const down = smartwebLapsDown(item.time);
    if (down != null) {
      if (rank === 1) throw new Error('La clasificación smartweb no tiene ganador con tiempo');
      if (down < lastDown) throw new Error(`Fila ${sourceRow + 1}: ${down} vueltas perdidas tras ${lastDown}`);
      lastDown = down;
      rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${down} LAP`, timeText: null, timeSeconds: null }); continue;
    }
    const time = smartwebSeconds(item.time);
    if (time == null || time <= 0) throw new Error(`Fila ${sourceRow + 1}: tiempo «${item.time}» no reconocido`);
    if (lastDown) throw new Error(`Fila ${sourceRow + 1}: llegada con tiempo tras corredores doblados`);
    if (time < lastTime) throw new Error(`Fila ${sourceRow + 1}: tiempo ${item.time} inferior al anterior`);
    lastTime = time;
    const winner = rank === 1 ? time : Number(rows.find(row => row.rank === 1).timeSeconds);
    rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText: hms(time), timeSeconds: String(time), gapText: rank === 1 ? null : gap(time - winner) });
  }
  if (!rows.some(row => row.rank === 1)) throw new Error('La clasificación smartweb no tiene ganador con tiempo');
  return { rows, omitted, warnings };
}

/**
 * La tabla no da nacionalidad: `ES` por la licencia autonómica es solo el valor
 * por defecto. Una fila sin nacionalidad propia que coincide por nombre con una
 * única ficha verificada (cualquier nacionalidad) se enlaza a ella y toma su
 * nacionalidad; así un extranjero con licencia española no queda sin ficha ni
 * se crea otra con `ES`. `riders`: `{ men, women }` del contexto CX.
 */
export function resolveSmartwebIdentities(document, riders) {
  for (const manga of document.categories) {
    const pool = riders?.[manga.category.startsWith('M') ? 'men' : 'women'] || [];
    for (const row of manga.rows) {
      if (row.globalRiderId || row.isoCode2 && !row.isoCode2Inferred) continue;
      const resolved = resolveCxResultIdentity({ ...row, isoCode2: null }, pool);
      const rider = resolved.id && pool.find(item => item.id === resolved.id);
      if (!rider) continue;
      row.globalRiderId = rider.id;
      row.isoCode2 = rider.nationality || row.isoCode2;
    }
  }
  return document;
}

/** Huella de las filas publicadas: cambia con cualquier corrección de la tabla. */
export const smartwebDigest = sourceRows => createHash('sha1').update(JSON.stringify(sourceRows)).digest('hex');

/**
 * Elige la clasificación de cada categoría de `map` ({rótulo: categoría}): el
 * archivo de los árbitros si está, si no el cronometraje. Dos rótulos de la
 * misma categoría publicados a la vez en la variante elegida son ambiguos.
 */
export function selectSmartwebOptions(index, map) {
  const byCategory = new Map();
  for (const [label, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(smartwebLabel(label));
  }
  const selected = []; const skipped = []; const invalid = [];
  for (const [category, labels] of byCategory) {
    const found = index.options.filter(option => labels.includes(option.label));
    const variant = found.some(option => option.variant === 'fichero') ? 'fichero' : 'cronofec';
    const chosen = found.filter(option => option.variant === variant);
    if (!chosen.length) skipped.push({ category, reason: 'Clasificación aún sin publicar en smartweb' });
    else if (chosen.length > 1) invalid.push({ category, reason: `Varias clasificaciones publicadas para la categoría: ${chosen.map(option => option.label).join(', ')}` });
    else selected.push({ category, ...chosen[0] });
  }
  return { selected, skipped, invalid };
}

/**
 * `pages`: `{ "<variante>:<id>": html }` de las opciones elegidas. Una
 * clasificación vacía queda en `skipped`; una incoherente, en `invalid`, sin
 * afectar a las demás. Con `source: 'smartweb'` cada categoría acredita el
 * enlace (`evidence.smartweb`).
 */
export function buildSmartwebCxDocument({ indexUrl, index, pages, map, raceId, seasonKey, dateKey, source = 'manual' }) {
  if (dateKey && index.dateKey && index.dateKey !== dateKey) throw new Error(`Prueba smartweb del ${index.dateKey}, no del ${dateKey}`);
  const { selected, skipped, invalid } = selectSmartwebOptions(index, map);
  const categories = []; const omitted = []; const warnings = [];
  for (const option of selected) {
    const html = pages[`${option.variant}:${option.id}`];
    if (html == null) throw new Error(`Falta la página ${option.variant}:${option.id}`);
    let parsed; let sourceRows;
    try {
      sourceRows = parseSmartwebTable(html);
      if (!sourceRows.length) { skipped.push({ category: option.category, reason: 'Clasificación aún sin filas en smartweb' }); continue; }
      parsed = parseSmartwebRows(sourceRows);
    } catch (error) { invalid.push({ category: option.category, reason: `${option.label}: ${error.message}` }); continue; }
    const sourceUrl = smartwebCategoryUrl(indexUrl, option.variant, option.id);
    omitted.push(...parsed.omitted.map(item => ({ category: option.category, ...item })));
    warnings.push(...parsed.warnings.map(item => ({ category: option.category, ...item })));
    categories.push({ category: option.category, dateKey: dateKey || index.dateKey, sourceGroup: option.label, sourceVariant: option.variant,
      sourceDigest: smartwebDigest(sourceRows),
      evidence: { sourceUrl, ...(source === 'smartweb' ? { smartweb: { sourceUrl: indexUrl, label: option.label, variant: option.variant, categoryId: option.id } } : {}) },
      rows: parsed.rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: indexUrl, timer: 'smartweb', federation: new URL(indexUrl).host, pruebaId: pruebaOf(indexUrl) },
    categories, skipped, invalid, omitted, warnings };
}

async function text(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

/** Índice y páginas de las clasificaciones de `map` publicadas en la prueba. */
export async function fetchSmartwebRace(url, map, { fetchImpl = fetch } = {}) {
  const indexUrl = smartwebIndexUrl(url);
  const index = parseSmartwebIndex(await text(indexUrl, fetchImpl));
  const pages = {};
  for (const option of selectSmartwebOptions(index, map).selected) {
    pages[`${option.variant}:${option.id}`] = await text(smartwebCategoryUrl(indexUrl, option.variant, option.id), fetchImpl);
  }
  return { indexUrl, index, pages };
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
  const fetched = await fetchSmartwebRace(options.url, map);
  const document = buildSmartwebCxDocument({ ...fetched, map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, variant: c.sourceVariant, rows: c.rows.length })),
    skipped: document.skipped, invalid: document.invalid, omitted: document.omitted.length }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
