#!/usr/bin/env node
// Calendario oficial UCI de carretera. No consulta DataRide ni escribe en BD:
// descarga el calendario y las fichas, normaliza las competiciones y emite un
// manifiesto y, opcionalmente, el SQL idempotente del alta de fichas.
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

export const UCI_ROAD_CALENDAR_URL = 'https://www.uci.org/calendar/road';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Categoría de la ficha UCI a `races`: género y edad.
const CATEGORY_GENDER = {
  'Men Elite': 'male',
  'Women Elite': 'female',
  'Men Under 23': 'male',
  'Women Under 23': 'female',
  'Men Junior': 'male',
  'Women Junior': 'female',
};
const CATEGORY_AGE = {
  'Men Elite': 'elite',
  'Women Elite': 'elite',
  'Men Under 23': 'u23',
  'Women Under 23': 'u23',
  'Men Junior': 'junior',
  'Women Junior': 'junior',
};

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
  CRT: { excluded: 'unsupported_class' },
  CRTP: { excluded: 'unsupported_class' },
};

export function roadYear(year) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < 2000 || value > 2100) throw new Error('Año inválido; usar YYYY.');
  return value;
}

export function roadClass(text) {
  const code = String(text || '').split(' - ')[0].trim();
  const entry = ROAD_CLASSES[code];
  if (!entry) return { code, excluded: 'unknown_class' };
  return { code, ...entry };
}

export function uciCivilDate(text) {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(String(text).trim());
  if (!m || !MONTHS.includes(m[2])) throw new Error(`Fecha UCI no reconocida: ${text}`);
  const year = Number(m[3]), month = MONTHS.indexOf(m[2]) + 1, day = Number(m[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`Fecha UCI inválida: ${text}`);
  }
  return date.toISOString().slice(0, 10);
}

const monthOf = text => MONTHS.indexOf(String(text).trim().split(' ')[1]);
const yearOf = text => Number(String(text).trim().slice(-4));

// «03 Oct 2026», «27 Sep - 04 Oct 2026» o «28 Dec 2026 - 02 Jan 2027». El tramo
// final lleva el año; el inicial lo lleva solo si cruza de año y, si falta, se
// deduce del mes.
export function uciDateRange(text) {
  const parts = String(text || '').split(' - ').map(part => part.trim());
  if (parts.length === 1) {
    const date = uciCivilDate(parts[0]);
    return { startDate: date, endDate: date };
  }
  if (parts.length !== 2) throw new Error(`Rango de fechas UCI no reconocido: ${text}`);
  const endDate = uciCivilDate(parts[1]);
  const endYear = yearOf(parts[1]);
  const startYear = monthOf(parts[0]) > monthOf(parts[1]) ? endYear - 1 : endYear;
  const startDate = uciCivilDate(/ \d{4}$/.test(parts[0]) ? parts[0] : `${parts[0]} ${startYear}`);
  if (startDate > endDate) throw new Error(`Rango de fechas UCI invertido: ${text}`);
  return { startDate, endDate };
}

function decodeAttribute(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' }[entity.toLowerCase()];
  });
}

export function uciCompetitionProps(html) {
  for (const match of String(html).matchAll(/data-props="([^"]+)"/g)) {
    let props;
    try { props = JSON.parse(decodeAttribute(match[1])); } catch { continue; }
    if (props.competitionDetails && props.schedule) return props;
  }
  throw new Error('La ficha UCI no contiene competición y programa reconocibles.');
}

export function flattenUciCalendar(response, year) {
  const target = roadYear(year);
  if (!Array.isArray(response?.items)) throw new Error('Respuesta del calendario UCI inválida.');
  const entries = [];
  for (const month of response.items) {
    if (!Array.isArray(month.items)) throw new Error('Mes del calendario sin días.');
    for (const day of month.items) {
      if (!Array.isArray(day.items)) throw new Error('Día del calendario sin pruebas.');
      for (const item of day.items) {
        const path = item.detailsLink?.url;
        const m = /^\/competition-details\/(\d{4})\/ROA\/(\d+)$/.exec(path || '');
        if (!m) throw new Error(`Prueba UCI inesperada: ${path || item.name}`);
        if (Number(m[1]) !== target) continue;
        entries.push({ ...item, uciCalendarId: Number(m[2]), calendarSourceUrl: `https://www.uci.org${path}` });
      }
    }
  }
  return entries;
}

export function slugBase(text) {
  return String(text || '')
    .normalize('NFD').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Competición UCI normalizada. `manual` marca lo que no se puede volcar sin
// decisión editorial: campeonatos y competiciones con varias categorías o
// géneros en una sola ficha.
export function normalizeRoadCompetition(entry, props, { year, countryCode }) {
  const target = roadYear(year);
  const details = props.competitionDetails;
  if (!details?.name || !Array.isArray(props.schedule?.items)) throw new Error('Ficha UCI sin nombre o programa.');
  const klass = roadClass(details.competitionClass);
  const categories = [];
  for (const day of props.schedule.items) {
    const dateKey = uciCivilDate(day.date);
    for (const race of day.races || []) {
      categories.push({ category: race.category || null, ageCategory: CATEGORY_AGE[race.category] || null, raceType: race.raceType || null, dateKey });
    }
  }
  // El listado trae el rango completo; la ficha de una vuelta por etapas solo
  // programa el primer día. El programa queda como respaldo.
  const { startDate, endDate } = entry.dates
    ? uciDateRange(entry.dates)
    : (categories.length ? dateRangeFromDays(props.schedule.items) : uciDateRange(details.dates));
  if (!startDate.startsWith(`${target}-`)) {
    // El calendario UCI del año N incluye pruebas de octubre–diciembre de N-1.
    // La web archiva por año de inicio: se descartan y se conservan en su edición.
    return { excludedCompetition: { uciCalendarId: entry.uciCalendarId, name: details.name, classCode: klass.code, reason: 'outside_year', startDate, countryCode: countryCode(entry.country)?.toUpperCase() || null } };
  }
  const genders = [...new Set(categories.map(c => CATEGORY_GENDER[c.category]).filter(Boolean))];
  const gender = genders.length === 1 ? genders[0] : null;
  const manualReasons = [];
  if (klass.excluded) manualReasons.push(klass.excluded);
  if (klass.championship) manualReasons.push('championship');
  if (!genders.length) manualReasons.push('unknown_category');
  if (genders.length > 1) manualReasons.push('multi_gender');
  if (categories.length && new Set(categories.map(c => c.category)).size > 1) manualReasons.push('multi_category');
  const raceFormat = klass.uciCategory === 'WC' || klass.uciCategory === 'CC'
    ? (startDate === endDate ? 'one_day' : 'stage_race')
    : (klass.code?.[0] === '2' ? 'stage_race' : 'one_day');
  const country = countryCode(entry.country);
  const name = details.name;
  const base = {
    uciCalendarId: entry.uciCalendarId,
    calendarSourceUrl: entry.calendarSourceUrl,
    name,
    nameEn: name,
    originalName: name,
    uciCategory: klass.uciCategory || null,
    classCode: klass.code,
    gender,
    raceFormat,
    countryCode: country ? country.toUpperCase() : null,
    startDate,
    endDate,
    year: target,
    venue: details.venue || entry.venue || null,
    websiteUrl: /^https?:\/\//i.test(details.website?.url || '') ? details.website.url : null,
    slug: `${slugBase(name) || 'carrera'}-${target}`,
    slugEn: `${slugBase(name) || 'race'}-${target}`,
    categories,
  };
  const manual = manualReasons.length > 0;
  if (klass.excluded) {
    return { excludedCompetition: { uciCalendarId: entry.uciCalendarId, name, classCode: klass.code, reason: klass.excluded, startDate, countryCode: base.countryCode } };
  }
  // `races` no distingue la categoría de edad: las fichas solo junior quedan fuera.
  if (categories.length && categories.every(c => c.ageCategory === 'junior')) {
    return { excludedCompetition: { uciCalendarId: entry.uciCalendarId, name, classCode: klass.code, reason: 'junior', startDate, countryCode: base.countryCode } };
  }
  return { race: base, manual, manualReasons, categories };
}

function dateRangeFromDays(days) {
  const keys = days.map(day => uciCivilDate(day.date)).sort();
  return { startDate: keys[0], endDate: keys.at(-1) };
}

export async function collectUciRoadCalendar({ year, fetcher = fetch, countryCode, concurrency = 4, onProgress = () => {} }) {
  const target = roadYear(year);
  if (typeof countryCode !== 'function') throw new Error('Falta conversor ISO3 a ISO2.');
  const headers = { 'User-Agent': 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)' };
  const endpoints = ['upcoming', 'past'].map(kind => `https://www.uci.org/api/calendar/${kind}?discipline=ROA&year=${target}`);
  const catalogs = await Promise.all(endpoints.map(async url => {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Calendario UCI: HTTP ${response.status}`);
    return flattenUciCalendar(await response.json(), target);
  }));
  const unique = new Map();
  for (const entry of catalogs.flat()) {
    const previous = unique.get(entry.uciCalendarId);
    if (previous && previous.name !== entry.name) throw new Error(`Nombres incompatibles en calendario UCI: ${entry.uciCalendarId}`);
    unique.set(entry.uciCalendarId, entry);
  }
  if (!unique.size) throw new Error('Calendario UCI vacío: no se genera una importación vacía.');
  const entries = [...unique.values()].sort((a, b) => a.uciCalendarId - b.uciCalendarId);
  const races = [], manual = [], exclusions = [], errors = [];
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency, entries.length)) }, async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        const response = await fetcher(entry.calendarSourceUrl, { headers, signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const normalized = normalizeRoadCompetition(entry, uciCompetitionProps(await response.text()), { year: target, countryCode });
        if (normalized.excludedCompetition) exclusions.push(normalized.excludedCompetition);
        else if (normalized.manual) manual.push({ ...normalized.race, manualReasons: normalized.manualReasons });
        else races.push(normalized.race);
      } catch (error) { errors.push({ uciCalendarId: entry.uciCalendarId, name: entry.name, error: error.message }); }
      onProgress({ completed: ++completed, total: entries.length });
    }
  }));
  if (errors.length) throw new Error(`Importación incompleta; ${errors.length} fichas requieren revisión: ${JSON.stringify(errors)}`);
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
    version: 1,
    source: 'uci_web_calendar_road',
    sourceUrl: UCI_ROAD_CALENDAR_URL,
    year: target,
    checkedAt: new Date().toISOString(),
    sourceUrls: endpoints,
    summary: {
      listedCompetitions: entries.length,
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
// «Under 23» o, en `races`, Copa de Naciones (sub-23; no hay junior) y nombres
// con la marca sub-23.
const U23_NAME = /\b(u23|under 23|sub ?23|espoirs|beloften)\b/;

export function raceAge({ classCode, uciCategory, categories, name, nameEn } = {}) {
  const code = String(classCode || uciCategory || '');
  if (/U$/.test(code) || /Ncup$/.test(code)) return 'u23';
  if ((categories || []).some(c => /Under 23/.test(c.category || ''))) return 'u23';
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
    if (completed % 25 === 0 || completed === total) console.log(`Fichas UCI: ${completed}/${total}`);
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
