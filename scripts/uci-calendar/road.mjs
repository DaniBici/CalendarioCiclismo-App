#!/usr/bin/env node
// Calendario oficial UCI de carretera. No consulta DataRide ni escribe en BD:
// lee el directorio de competiciones UCI (uci-competition.tech.uci.ch),
// normaliza las competiciones y emite un manifiesto y, opcionalmente, el SQL
// idempotente del alta de fichas.
//
//   node scripts/uci-calendar/road.mjs --year 2027 --races races.json \
//     --out manifiesto.json --sql alta.sql
//
// `--races` es un volcado JSON de `races` (una fila por edición) para resolver
// el enlace de series y detectar lo ya cargado. El SQL requiere la columna
// `races."uciCalendarId"` (migración `races_uci_calendar_id`).
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UCI_CATEGORY, UCI_COMPETITION_DIRECTORY_URL, getUciCompetition, listUciCompetitions, mapLimited,
  organizerWebsite, uciCalendarIdOf, uciDates,
} from '../../supabase/functions/_shared/uci-competition-api.mjs';

// Clases del calendario UCI de carretera. `excluded` nombra el motivo de
// descarte; el resto se traduce a `races."uciCategory"`.
export const ROAD_CLASSES = {
  '1.UWT': { excluded: 'worldtour' },
  '2.UWT': { excluded: 'worldtour' },
  '1.WWT': { excluded: 'worldtour' },
  '2.WWT': { excluded: 'worldtour' },
  CN: { excluded: 'national_championship' },
  CM: { uciCategory: 'WC', championship: true },
  CC: { uciCategory: 'CC', championship: true },
  '1.Pro': { uciCategory: '1.Pro' },
  '2.Pro': { uciCategory: '2.Pro' },
  '1.1': { uciCategory: '1.1' },
  '2.1': { uciCategory: '2.1' },
  '1.2': { uciCategory: '1.2' },
  '2.2': { uciCategory: '2.2' },
  '1.2U': { uciCategory: '1.2U' },
  '2.2U': { uciCategory: '2.2U' },
  '1.Ncup': { excluded: 'unsupported_class' },
  '2.Ncup': { excluded: 'unsupported_class' },
  '1.2S': { excluded: 'unsupported_class' },
  JC: { excluded: 'unsupported_class' },
  JR: { excluded: 'unsupported_class' },
  JOJ: { excluded: 'unsupported_class' },
  CRT: { excluded: 'unsupported_class' },
  CRTP: { excluded: 'unsupported_class' },
};

export function roadYear(year) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < 2000 || value > 2100) throw new Error('Año inválido; usar YYYY.');
  return value;
}

export function roadClass(code) {
  const key = String(code || '').trim();
  const entry = ROAD_CLASSES[key];
  if (!entry) return { code: key, excluded: 'unknown_class' };
  return { code: key, ...entry };
}

export function slugBase(text) {
  return String(text || '')
    .normalize('NFD').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Competición del directorio UCI normalizada. `manual` marca lo que no se
// puede volcar sin decisión editorial: campeonatos y competiciones con varias
// categorías o géneros en una sola ficha.
export function normalizeRoadCompetition(item, { year, countryCode }) {
  const target = roadYear(year);
  const uciCalendarId = uciCalendarIdOf(item);
  if (!uciCalendarId) throw new Error(`Competición UCI sin ID de calendario (v1Code): ${item?.name}`);
  const name = String(item.name || '').trim();
  if (!name) throw new Error(`Competición UCI sin nombre: ${uciCalendarId}`);
  if (!Number.isInteger(item.seasonYear)) throw new Error(`Competición UCI sin temporada: ${name}`);
  const klass = roadClass(item.classCode);
  const { startDate, endDate } = uciDates(item, name);
  const country = countryCode(item.countryCode);
  const iso = country ? country.toUpperCase() : null;
  const excluded = reason => ({ excludedCompetition: { uciCalendarId, name, classCode: klass.code, reason, startDate, countryCode: iso } });
  // El filtro de fechas solapa el año civil: las pruebas que empezaron el año
  // anterior se conservan en su edición.
  if (!startDate.startsWith(`${target}-`)) return excluded('outside_year');
  if (klass.excluded) return excluded(klass.excluded);
  const categories = (item.categoryCodes || []).map(code => ({
    category: code, gender: UCI_CATEGORY[code]?.gender || null, ageCategory: UCI_CATEGORY[code]?.age || null,
  }));
  // `races` no distingue la categoría de edad: las fichas solo junior quedan fuera.
  if (categories.length && categories.every(c => c.ageCategory === 'junior')) return excluded('junior');
  const genders = [...new Set(categories.map(c => c.gender).filter(Boolean))];
  const manualReasons = [];
  if (klass.championship) manualReasons.push('championship');
  if (!genders.length) manualReasons.push('unknown_category');
  if (genders.length > 1) manualReasons.push('multi_gender');
  if (categories.length > 1) manualReasons.push('multi_category');
  const raceFormat = klass.championship
    ? (startDate === endDate ? 'one_day' : 'stage_race')
    : (klass.code[0] === '2' ? 'stage_race' : 'one_day');
  const race = {
    uciCalendarId,
    uciCompetitionId: item.id,
    calendarSourceUrl: `https://www.uci.org/competition-details/${item.seasonYear}/ROA/${uciCalendarId}`,
    name,
    nameEn: name,
    originalName: name,
    uciCategory: klass.uciCategory,
    classCode: klass.code,
    gender: genders.length === 1 ? genders[0] : null,
    raceFormat,
    countryCode: iso,
    startDate,
    endDate,
    year: target,
    venue: String(item.venue || '').trim() || null,
    websiteUrl: organizerWebsite(item.website),
    slug: `${slugBase(name) || 'carrera'}-${target}`,
    slugEn: `${slugBase(name) || 'race'}-${target}`,
    categories,
    raceTypes: (item.raceTypes || []).map(type => type.code).filter(Boolean),
  };
  return { race, manual: manualReasons.length > 0, manualReasons };
}

// Programa de una competición: una carrera por etapa o por categoría y tipo.
// Sirve para desdoblar a mano campeonatos y fichas con varias categorías.
export function uciProgramme(detail) {
  if (!Array.isArray(detail?.races)) throw new Error('Ficha del directorio UCI sin carreras.');
  return detail.races.map(race => ({
    name: race.name || null, category: race.categoryCode || null, raceType: race.raceTypeCode || null,
    classCode: race.classCode || null, ...uciDates(race, race.name),
  })).sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.category).localeCompare(String(b.category)));
}

export async function collectUciRoadCalendar({ year, fetcher = fetch, countryCode, concurrency = 4, onProgress = () => {} }) {
  const target = roadYear(year);
  if (typeof countryCode !== 'function') throw new Error('Falta conversor ISO3 a ISO2.');
  // El año civil completo, sin filtrar por temporada: incluye las pruebas de
  // octubre–diciembre que la UCI asigna a la temporada siguiente.
  const { items, url } = await listUciCompetitions({ fetcher, query: { disciplineCode: 'ROA', dateFrom: `${target}-01-01`, dateTo: `${target}-12-31` } });
  if (!items.length) throw new Error('Calendario UCI vacío: no se genera una importación vacía.');
  const errors = [], byCalendarId = new Map();
  for (const item of items) {
    const id = uciCalendarIdOf(item);
    if (!id) errors.push({ uciCompetitionId: item.id, name: item.name, error: 'Sin ID de calendario (v1Code)' });
    else if (byCalendarId.has(id)) errors.push({ uciCalendarId: id, name: item.name, error: 'ID de calendario repetido' });
    else byCalendarId.set(id, item);
  }
  const races = [], manual = [], exclusions = [];
  for (const [uciCalendarId, item] of [...byCalendarId].sort(([a], [b]) => a - b)) {
    try {
      const normalized = normalizeRoadCompetition(item, { year: target, countryCode });
      if (normalized.excludedCompetition) exclusions.push(normalized.excludedCompetition);
      else if (normalized.manual) manual.push({ ...normalized.race, manualReasons: normalized.manualReasons });
      else races.push(normalized.race);
    } catch (error) { errors.push({ uciCalendarId, name: item.name, error: error.message }); }
  }
  const programmes = await mapLimited(manual, async race => uciProgramme(await getUciCompetition({ fetcher, id: race.uciCompetitionId })), { concurrency, onProgress });
  manual.forEach((race, index) => { race.programme = programmes.results[index] ?? null; });
  errors.push(...programmes.errors.map(({ item, error }) => ({ uciCalendarId: item.uciCalendarId, name: item.name, error })));
  if (errors.length) throw new Error(`Importación incompleta; ${errors.length} competiciones requieren revisión: ${JSON.stringify(errors)}`);
  const slugCount = { slug: new Map(), slugEn: new Map() };
  const uniqueSlugs = item => {
    for (const field of ['slug', 'slugEn']) {
      const n = (slugCount[field].get(item[field]) || 0) + 1;
      slugCount[field].set(item[field], n);
      if (n > 1) item[field] = `${item[field]}-${n}`;
    }
  };
  races.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.uciCalendarId - b.uciCalendarId);
  races.forEach(uniqueSlugs);
  manual.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.uciCalendarId - b.uciCalendarId);
  manual.forEach(uniqueSlugs);
  return {
    version: 2,
    source: 'uci_competition_directory_road',
    sourceUrl: UCI_COMPETITION_DIRECTORY_URL,
    year: target,
    checkedAt: new Date().toISOString(),
    sourceUrls: [url],
    summary: {
      listedCompetitions: byCalendarId.size,
      races: races.length,
      manual: manual.length,
      excludedCompetitions: exclusions.length,
    },
    races,
    manual,
    exclusions,
  };
}

// ── Enlace de series y detección de lo pendiente ────────────────────────────

export function foldName(text) {
  return String(text || '')
    .normalize('NFD').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Categoría de edad de una edición: sufijo U de la clase, categoría UCI
// MU/WU o, en `races`, Copa de Naciones (sub-23; no hay junior) y nombres
// con la marca sub-23.
const U23_NAME = /\b(u23|under 23|sub ?23|espoirs|beloften)\b/;

export function raceAge({ classCode, uciCategory, categories, name, nameEn } = {}) {
  const code = String(classCode || uciCategory || '');
  if (/U$/.test(code) || /Ncup$/.test(code)) return 'u23';
  if ((categories || []).some(c => c.ageCategory === 'u23')) return 'u23';
  if (U23_NAME.test(foldName(name)) || U23_NAME.test(foldName(nameEn))) return 'u23';
  return 'elite';
}

// Prefijo ISO: la BD mezcla mayúsculas, minúsculas y subdivisiones (`ES-PV`).
export const countryKey = code => String(code || '').slice(0, 2).toUpperCase() || null;

const withoutYear = slug => String(slug || '').replace(/-\d{4}$/, '').replace(/-/g, ' ');

// Distancia en días entre dos fechas sin contar el año.
function seasonGap(a, b) {
  if (!a || !b) return null;
  const doy = date => (Date.UTC(2001, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - Date.UTC(2001, 0, 1)) / 86400000;
  const d = Math.abs(doy(a) - doy(b));
  return Math.min(d, 365 - d);
}

const formatOf = code => /^[12]\./.test(code || '') ? code[0] : null;

// Palabras genéricas de los nombres de carrera, ordinales y números de edición:
// fuera del núcleo distintivo que compara el cotejo laxo.
const GENERIC = new Set(`a al and b by d de del della delle dell der des di do du e el en et i il in l la le les na
  of p pb s san the und van het y g gp gran grand grande grote premi premio prijs prix tr trofeo trophee trophy
  coppa cup classic classica classique clasica circuit course criterium race road cycling ciclista ciclismo
  international internacional internazionale memorial tour giro vuelta volta ronde ruta route rund rundt city citta
  women ladies femenina femmes feminine men elite u23 sub espoirs beloften`.split(/\s+/));

const core = name => new Set(name.split(' ').filter(t => t && !GENERIC.has(t) && !/^\d+$/.test(t)).map(t => t.slice(0, 5)));

function setScore(a, b, minSize) {
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const jac = shared / (a.size + b.size - shared);
  const min = Math.min(a.size, b.size);
  return { score: Math.max(jac, min >= minSize && shared === min ? 0.8 : 0), shared };
}

// Índice de ediciones con serie, por género. Cada edición aporta todos sus
// nombres (castellano, inglés, original y slugs): desde 2026 `name` va en
// castellano y el nombre UCI solo coincide con `nameEn` u `originalName`.
export function buildSeriesIndex(rows = []) {
  const pools = new Map();
  for (const row of rows || []) {
    if (!row.raceSeriesId || row.uciCategory === 'CN') continue;
    const names = [...new Set([row.name, row.nameEn, row.originalName, withoutYear(row.slug), withoutYear(row.slugEn)].map(foldName).filter(Boolean))];
    if (!names.length) continue;
    const key = row.gender || '';
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push({
      raceSeriesId: row.raceSeriesId, slug: row.slug, name: row.nameEn || row.name, year: Number(row.year),
      age: raceAge(row), format: formatOf(row.uciCategory), countryCode: countryKey(row.countryCode), startDate: row.startDate || null,
      names: names.map(name => ({ name, tokens: new Set(name.split(' ')), core: core(name) })),
    });
  }
  return { pools };
}

// Nombre: igualdad, Jaccard de tokens o inclusión de un nombre de al menos dos
// tokens en el otro («Clásica Jaén» ⊂ «Clásica Jaén Paraíso Interior»).
// Núcleo: lo mismo sin palabras genéricas y con raíces de cinco letras
// («G.P. Emilia» = «GP Emilia», «Małopolski» ≈ «Malopolska»).
function compareNames(variants, row) {
  let name = 0, nucleus = 0, shared = 0;
  for (const v of variants) {
    for (const n of row.names) {
      if (n.name === v.name) return { name: 1, nucleus: 1, shared: n.core.size };
      name = Math.max(name, setScore(v.tokens, n.tokens, 2).score);
      const c = setScore(v.core, n.core, 1);
      nucleus = Math.max(nucleus, c.score);
      shared = Math.max(shared, c.shared);
    }
  }
  return { name, nucleus, shared };
}

// Enlace con la serie de una edición anterior del mismo género. El nombre
// basta por encima de `threshold`; por debajo, el núcleo distintivo del nombre
// solo cuenta con el mismo país, formato y época del año. A igualdad, gana la
// serie con la edición más reciente (la del año anterior, si existe). La
// categoría de edad (sufijo U, «Under 23») separa elite y sub-23; si ninguna
// edición de la misma edad encaja, se admite la otra como `fuzzy` con
// `ageMismatch` (la clase cambia entre años: Trofeo Piva 1.2U → 1.2).
export function matchSeries(index, race, { threshold = 0.72 } = {}) {
  const year = Number(race.year) || Infinity;
  const pool = index.pools?.get(race.gender || '') || [];
  const variants = [...new Set([race.originalName, race.nameEn, race.name].map(foldName).filter(Boolean))]
    .map(name => ({ name, tokens: new Set(name.split(' ')), core: core(name) }));
  const age = raceAge(race);
  const format = formatOf(race.classCode || race.uciCategory);
  const country = countryKey(race.countryCode);
  const best = { same: null, other: null };
  for (const row of pool) {
    if (!(row.year < year)) continue;
    const { name, nucleus, shared } = compareNames(variants, row);
    const sameCountry = !!country && row.countryCode === country;
    const sameFormat = !format || !row.format || format === row.format;
    const gap = seasonGap(race.startDate, row.startDate);
    const close = gap !== null && gap <= 31;
    const lastYear = row.year === year - 1;
    if (name < 1 && ((row.countryCode && country && !sameCountry) || !sameFormat)) continue;
    const loose = sameCountry && close && (nucleus >= 0.5 || (lastYear && gap <= 7 && shared >= 1));
    if (name < threshold && !loose) continue;
    const score = Math.max(name, loose ? Math.min(nucleus, 0.75) : 0);
    const recency = lastYear ? 0.2 : row.year === year - 2 ? 0.1 : 0;
    const total = score + (sameCountry ? 0.1 : 0) + (close ? 0.1 : 0) + recency;
    const slot = row.age === age ? 'same' : 'other';
    const current = best[slot];
    if (!current || total > current.total || (total === current.total && row.year > current.row.year)) best[slot] = { row, score, total };
  }
  const hit = best.same || best.other;
  if (!hit) return { raceSeriesId: null, confidence: 'new', matchedName: null };
  const { row, score } = hit;
  return {
    raceSeriesId: row.raceSeriesId,
    confidence: score === 1 && row.year === year - 1 && best.same ? 'exact' : 'fuzzy',
    matchedName: row.name, matchedSlug: row.slug, matchedYear: row.year, score: Number(score.toFixed(3)),
    ...(best.same ? {} : { ageMismatch: true }),
  };
}

export function pendingRaces(manifest, loadedCalendarIds) {
  const loaded = new Set((loadedCalendarIds || []).map(String));
  return manifest.races.filter(race => !loaded.has(String(race.uciCalendarId)));
}

// ── SQL idempotente ─────────────────────────────────────────────────────────

const sqlText = value => value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`;

// `slug` y `slugEn` tienen índice único propio (`races_slug_key`,
// `races_slugEn_key`); cada uno se desambigua frente a los ya cargados.
export function roadDumpSql({ manifest, seriesIndex, loadedSlugs = [], loadedSlugsEn = [] }) {
  const taken = { slug: new Set((loadedSlugs || []).filter(Boolean)), slugEn: new Set((loadedSlugsEn || []).filter(Boolean)) };
  const free = (field, base) => {
    let value = base, n = 1;
    while (taken[field].has(value)) value = `${base}-${++n}`;
    taken[field].add(value);
    return value;
  };
  const series = new Map();
  const lines = [];
  const rows = [];
  for (const race of manifest.races || []) {
    const slug = free('slug', race.slug);
    const slugEn = free('slugEn', race.slugEn || race.slug);
    const { raceSeriesId, confidence, ...match } = matchSeries(seriesIndex, race);
    const seriesId = raceSeriesId || `uci-${race.year}-${race.uciCalendarId}`;
    if (!raceSeriesId) series.set(seriesId, race);
    rows.push({ ...race, slug, slugEn, raceSeriesId: seriesId, seriesMatch: confidence, ...match });
  }
  for (const [id, race] of series) {
    lines.push(`insert into race_series (id,"canonicalName",gender) values (${sqlText(id)},${sqlText(race.name)},${sqlText(race.gender)}) on conflict (id) do nothing;`);
  }
  for (const row of rows) {
    lines.push([
      'insert into races (id,name,"nameEn","originalName",slug,"slugEn","uciCategory",gender,"raceFormat","countryCode","startDate","endDate",year,"raceSeriesId","uciCalendarId") values (',
      `${sqlText(`uci-${row.year}-${row.uciCalendarId}`)},${sqlText(row.name)},${sqlText(row.nameEn)},${sqlText(row.originalName)},${sqlText(row.slug)},${sqlText(row.slugEn)},`,
      `${sqlText(row.uciCategory)},${sqlText(row.gender)},${sqlText(row.raceFormat)},${sqlText(row.countryCode)},${sqlText(row.startDate)},${sqlText(row.endDate)},${row.year},${sqlText(row.raceSeriesId)},${sqlText(row.uciCalendarId)})`,
      'on conflict ("uciCalendarId") do nothing;',
    ].join(''));
  }
  return { sql: lines.join('\n') + (lines.length ? '\n' : ''), rows };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!path) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const year = roadYear(value('--year') || new Date().toISOString().slice(0, 4));
  const { countryCode } = await import('../uci-catalog/countries.mjs');
  const manifest = await collectUciRoadCalendar({ year, countryCode, onProgress: ({ completed, total }) => {
    if (completed % 10 === 0 || completed === total) console.log(`Programas UCI de fichas manuales: ${completed}/${total}`);
  } });
  const racesDump = readJson(value('--races'), null) || [];
  const seriesIndex = buildSeriesIndex(racesDump);
  const loadedIds = racesDump.filter(row => Number(row.year) === year).map(row => row.uciCalendarId).filter(Boolean);
  const pending = pendingRaces(manifest, loadedIds);
  const { sql, rows } = roadDumpSql({
    manifest: { ...manifest, races: pending }, seriesIndex,
    loadedSlugs: racesDump.map(row => row.slug), loadedSlugsEn: racesDump.map(row => row.slugEn),
  });
  // Revisión del enlace de series de lo pendiente: `exact`, `fuzzy` o `new`.
  manifest.seriesMatches = rows.map(row => ({
    uciCalendarId: row.uciCalendarId, name: row.name, slug: row.slug, slugEn: row.slugEn, raceSeriesId: row.raceSeriesId,
    seriesMatch: row.seriesMatch, matchedName: row.matchedName ?? null, matchedSlug: row.matchedSlug ?? null,
    matchedYear: row.matchedYear ?? null, score: row.score ?? null, ...(row.ageMismatch ? { ageMismatch: true } : {}),
  }));
  const count = confidence => rows.filter(row => row.seriesMatch === confidence).length;
  const report = {
    ...manifest.summary,
    year,
    loaded: loadedIds.length,
    pending: pending.length,
    pendingExactSeries: count('exact'),
    pendingFuzzySeries: count('fuzzy'),
    pendingNewSeries: count('new'),
  };
  const out = value('--out');
  if (out) writeFileSync(resolve(out), `${JSON.stringify(manifest, null, 2)}\n`);
  const sqlOut = value('--sql');
  if (sqlOut) {
    writeFileSync(resolve(sqlOut), sql);
    report.sqlRaces = rows.length;
  }
  console.log(JSON.stringify(out || sqlOut ? { ...report, file: out ? resolve(out) : undefined, sql: sqlOut ? resolve(sqlOut) : undefined } : report));
}

// Compara rutas reales: en macOS `/var` y `/private/var` apuntan al mismo sitio
// y `import.meta.url` puede no coincidir con `process.argv[1]`.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (invokedDirectly()) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
