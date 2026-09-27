#!/usr/bin/env node
/**
 * Inscritos de unos Juegos servidos por el sistema Bornan (p. ej. Juegos
 * Asiáticos 2026). Dos modos sobre el mismo despliegue:
 *
 *   --mode provisional  Lee la API de inscritos (`entries`) por NOC y devuelve
 *                       los participantes del evento sin dorsal. Es lo que hay
 *                       desde el anuncio de las selecciones.
 *   --mode official     Lee el PDF «Start List» (C51R/C51T) de la unidad, que
 *                       fija dorsales y, en CRI, la hora de salida. Marca la
 *                       lista como definitiva.
 *
 * code: `<apiBase>|<champ>|<disc>|<eventKey>` (p. ej.
 * `https://back.results.asiangames2026.org|AG2026|CRD|W.TT----------------`).
 * Salida: `<out>/<race-id>.json` con `{ raceId, eventKey, mode, sourceUrl,
 * riders: [{ bib, firstName, lastName, nation, birthDate, uciProfileId,
 * startTime }] }`. Código 3 si la fuente todavía no publica nada.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeJsonBuffer, parseCode, reportsIndexUrl } from './bornan-results-fetch.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const RACE_ID = arg('--race-id');
const OUT = arg('--out', '.');
const MODE = arg('--mode', 'provisional');
const FIXTURE = arg('--fixture');
const USER_AGENT = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
const log = (message) => process.stderr.write(`${message}\n`);

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const DATE_HEADER = /\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\s+([A-Z]{3})\s+(20\d{2})\b/;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      Origin: new URL(url).origin.replace('back.', 'results.'),
      Referer: `${new URL(url).origin.replace('back.', 'results.')}/`,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return decodeJsonBuffer(Buffer.from(await response.arrayBuffer()));
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// La fuente publica el apellido en mayúsculas («AL HAYAT», «QUANG»). Se
// normaliza a la forma del catálogo sin tocar los nombres ya capitalizados.
export const properCase = (value) => {
  const text = clean(value);
  if (!text) return text;
  return text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, separator, letter) => separator + letter.toUpperCase());
};

const nameCase = (value) => {
  const text = clean(value);
  return text && text === text.toUpperCase() ? properCase(text) : text;
};

// El UCI ID de 11 dígitos («100 952 285 20») guarda en los dígitos 3–9 el
// uciProfileId del catálogo (952285). Devuelve null si no encaja.
export function uciProfileFromIfId(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return String(Number(digits.slice(2, 9)));
}

const splitName = (participant) => {
  const given = nameCase(participant.GivenName);
  const family = properCase(participant.FamilyName);
  if (given && family) return { firstName: given, lastName: family };
  const parts = clean(participant.Name).split(' ');
  if (parts.length < 2) return { firstName: properCase(participant.Name), lastName: properCase(participant.Name) };
  return { firstName: parts.slice(1).join(' '), lastName: properCase(parts[0]) };
};

export function entriesListUrl({ apiBase, champ, disc }) {
  return `${apiBase}/s/${champ}/en/${disc}/entries/list`;
}

export function entriesOrgUrl({ apiBase, champ, disc }, org) {
  return `${apiBase}/s/${champ}/en/${disc}/entries/org/${encodeURIComponent(org)}`;
}

export function collectEntries({ list, orgPayloads, eventKey }) {
  const riders = [];
  for (const org of list?.orgs ?? []) {
    const payload = orgPayloads.get(org.Key);
    for (const event of payload?.Events ?? []) {
      if (event.EvKey !== eventKey) continue;
      for (const participant of event.Partics ?? []) {
        const { firstName, lastName } = splitName(participant);
        riders.push({
          reg: clean(participant.Reg) || null,
          bib: null,
          firstName,
          lastName,
          nation: org.Key,
          birthDate: clean(participant.BirthDateRaw) || null,
          uciProfileId: uciProfileFromIfId(participant.IFId),
          startTime: null,
        });
      }
    }
  }
  const unique = new Map(riders.map((rider) => [`${rider.lastName}|${rider.firstName}|${rider.nation}`, rider]));
  return [...unique.values()];
}

const nameTokens = (value) => new Set(
  clean(value).toLocaleLowerCase('en').normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean),
);

// La API de entries conserva nombre y apellido separados. El PDF C51T los
// imprime en una sola columna, con el apellido delante, y puede contener
// apellidos compuestos. Solo sustituimos la partición del PDF cuando todos los
// tokens de la entrada estructurada están presentes en esa misma fila; así no
// imponemos una inscripción antigua sobre un reemplazo que ya figure solo en el
// Start List definitivo.
export function mergeStructuredIdentity(startListRiders, entryRiders) {
  const byNationBirth = new Map();
  for (const rider of entryRiders ?? []) {
    const key = `${rider.nation}|${rider.birthDate}`;
    const current = byNationBirth.get(key) ?? [];
    current.push(rider);
    byNationBirth.set(key, current);
  }
  return startListRiders.map((rider) => {
    const matches = byNationBirth.get(`${rider.nation}|${rider.birthDate}`) ?? [];
    if (matches.length !== 1) return rider;
    const candidate = matches[0];
    const sourceTokens = nameTokens(`${rider.firstName} ${rider.lastName}`);
    const candidateTokens = nameTokens(`${candidate.firstName} ${candidate.lastName}`);
    if (![...candidateTokens].every((token) => sourceTokens.has(token))) return rider;
    return {
      ...rider,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      ...(candidate.uciProfileId ? { uciProfileId: candidate.uciProfileId } : {}),
    };
  });
}

export function findStartListReport(payload, eventKey) {
  const event = (payload?.Events ?? []).find((entry) => entry.Key === eventKey);
  if (!event) return null;
  for (const phase of event.Phases ?? []) {
    for (const unit of phase.Units ?? []) {
      const reports = (unit.Reports ?? []).filter((report) => report.Desc === 'Start List');
      if (!reports.length) continue;
      reports.sort((left, right) => (right.Version - left.Version) || (right.Revision - left.Revision));
      return { unit, report: reports[0] };
    }
  }
  return null;
}

// C51T añade el número del grupo solo en la primera fila de cada bloque. Sin
// ese campo opcional, el parser interpreta el grupo como dorsal y cada bloque
// posterior genera dorsales duplicados (1, 2, 3...).
const startListRow = /^\s*(?:\d{1,2}\s+)?(?:(\d{1,2}:\d{2}(?::\d{2})?)\s+)?(\d{1,3})\s+(\S.*?)\s{2,}([A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})\b/;

const allUpperNameToken = (value) => /\p{L}/u.test(value) && value === value.toLocaleUpperCase('en');

export function parseStartListText(text, { expectedDate = null, expectedEventToken = null } = {}) {
  const source = String(text);
  if (!/Start List\b/.test(source) && !/Lista de Salida\b/.test(source)) {
    throw new Error('el PDF no contiene una lista de salida Bornan reconocible');
  }
  const dateMatch = source.match(DATE_HEADER);
  if (!dateMatch) throw new Error('el PDF no contiene fecha');
  const dateKey = `${dateMatch[3]}-${MONTHS[dateMatch[2]]}-${String(dateMatch[1]).padStart(2, '0')}`;
  if (expectedDate && dateKey !== expectedDate) throw new Error(`el PDF es de ${dateKey}, no de ${expectedDate}`);
  if (expectedEventToken && !source.includes(expectedEventToken)) throw new Error('el informe no corresponde a la unidad esperada');

  const riders = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(startListRow);
    if (!match) continue;
    const [, startTime, bib, name, nation, dob] = match;
    const [, day, month, year] = dob.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
    const birthDate = `${year}-${MONTHS[month]}-${String(day).padStart(2, '0')}`;
    const parts = clean(name).split(' ');
    const family = [];
    while (parts.length > 1 && allUpperNameToken(parts[0])) family.push(parts.shift());
    if (!family.length) family.push(parts.shift());
    riders.push({
      bib: Number(bib),
      firstName: nameCase(parts.join(' ')),
      lastName: properCase(family.join(' ')),
      nation,
      birthDate,
      uciProfileId: null,
      startTime: startTime || null,
    });
  }
  if (!riders.length) throw new Error('la lista de salida no contiene corredores');
  const bibs = riders.map((rider) => rider.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('la lista de salida contiene dorsales duplicados');
  return { dateKey, riders };
}

async function pdfToText(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'bornan-sl-'));
  const file = join(dir, 'start.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchProvisional(parsed, date) {
  const list = await fetchJson(entriesListUrl(parsed));
  const orgPayloads = new Map();
  for (const org of list?.orgs ?? []) {
    orgPayloads.set(org.Key, await fetchJson(entriesOrgUrl(parsed, org.Key)));
  }
  const riders = collectEntries({ list, orgPayloads, eventKey: parsed.eventKey });
  if (!riders.length) return null;
  return { dateKey: date, riders, sourceUrl: entriesListUrl(parsed) };
}

async function fetchOfficial(parsed, date) {
  const index = await fetchJson(reportsIndexUrl(parsed));
  const found = findStartListReport(index, parsed.eventKey);
  if (!found) return null;
  const eventToken = parsed.eventKey.replace(/\./g, '');
  const text = await pdfToText(found.report.URL);
  const { riders } = parseStartListText(text, { expectedDate: date, expectedEventToken: eventToken });
  // El PDF fija dorsal y hora. La API de entries solo completa la identidad
  // cuando el nombre coincide por tokens, para corregir apellidos compuestos
  // sin reemplazar altas/reemplazos exclusivos del PDF.
  let enriched = riders;
  try {
    const entries = await fetchProvisional(parsed, date);
    enriched = mergeStructuredIdentity(riders, entries?.riders ?? []);
  } catch (error) {
    log(`Bornan ${parsed.eventKey}: no se pudo enriquecer la identidad desde entries (${error.message})`);
  }
  return { dateKey: date, riders: enriched, sourceUrl: found.report.URL };
}

async function main() {
  const parsed = parseCode(CODE);
  if (!RACE_ID) throw new Error('Falta --race-id');
  if (!['provisional', 'official'].includes(MODE)) throw new Error('--mode debe ser provisional u official');

  let result = null;
  if (FIXTURE) {
    const { riders } = parseStartListText(readFileSync(resolve(FIXTURE), 'utf8'));
    result = { dateKey: arg('--date'), riders, sourceUrl: FIXTURE };
  } else if (MODE === 'official') {
    result = await fetchOfficial(parsed, arg('--date'));
  } else {
    result = await fetchProvisional(parsed, arg('--date'));
  }

  const output = {
    raceId: RACE_ID,
    eventKey: parsed.eventKey,
    mode: MODE,
    source: 'bornan',
    fetchedAt: new Date().toISOString(),
    riders: result?.riders ?? [],
    sourceUrl: result?.sourceUrl ?? null,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${RACE_ID}.json`), JSON.stringify(output, null, 2));
  if (!result) {
    log(`Bornan ${parsed.eventKey}: la fuente todavía no publica ${MODE === 'official' ? 'la lista de salida' : 'inscritos'}`);
    process.exit(3);
  }
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
