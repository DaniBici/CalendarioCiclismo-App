#!/usr/bin/env node
/**
 * Resultados oficiales de Belgian Cycling (KBWB/RLVB).
 *
 * Cada prueba conserva una URL estable `YYYY/CODE-U.pdf`. Antes de publicar el
 * resultado, esa URL contiene un PDF marcador de una página; el fetcher lo
 * reconoce y emite cero etapas para que el cron mantenga el enlace pendiente.
 * El PDF definitivo contiene una clasificación de un día con dorsal, UCI ID,
 * equipo, tiempo/diferencia y bloques DNS/DNF/OTL/DSQ.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const DATE = arg('--date');
const OUT = arg('--out', '.');
const FIXTURE = arg('--fixture');
const BASE = 'https://uitslagen.kbwb-rlvb.com/uitslagen';
const log = (message) => process.stderr.write(`${message}\n`);

const ISO2 = {
  ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be', BRA: 'br', CAN: 'ca', CHI: 'cl', COL: 'co',
  CRO: 'hr', CYP: 'cy', CZE: 'cz', DEN: 'dk', ECU: 'ec', ERI: 'er', ESP: 'es', EST: 'ee',
  FIN: 'fi', FRA: 'fr', GBR: 'gb', GER: 'de', GRE: 'gr', HUN: 'hu', IRL: 'ie', ISR: 'il',
  ITA: 'it', JPN: 'jp', KAZ: 'kz', LAT: 'lv', LTU: 'lt', LUX: 'lu', NED: 'nl', NOR: 'no',
  NZL: 'nz', POL: 'pl', POR: 'pt', ROU: 'ro', RSA: 'za', SLO: 'si', SRB: 'rs', SUI: 'ch',
  SVK: 'sk', SWE: 'se', UKR: 'ua', URU: 'uy', USA: 'us', VEN: 've',
};

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
export const suggestCompetitionId = (code) => -(fnv1a(`belgiancycling:${parseCode(code)}`) % 200000);
export const synthRaceId = (code) => -(Math.abs(suggestCompetitionId(code)) * 100 + 1);
export const synthEventId = (code) => -(Math.abs(suggestCompetitionId(code)) * 10000 + 1);

export function parseCode(value) {
  const code = String(value || '').trim();
  if (!/^20\d{5,6}$/.test(code)) throw new Error('--code debe ser el identificador numérico Belgian Cycling (7 u 8 dígitos)');
  return code;
}

export const resultPdfUrl = (code) => {
  const parsed = parseCode(code);
  return `${BASE}/${parsed.slice(0, 4)}/${parsed}-U.pdf`;
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const compactUciId = (value) => clean(value).replace(/\s/g, '');
const placeholderPattern = /Info nog niet beschikbaar|Les informations pas encore disponible|Information not yet available/i;
export const isPlaceholder = (text) => placeholderPattern.test(String(text || ''));

function normalizedDate(text) {
  const match = String(text).match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function normalizeTime(value) {
  const match = clean(value).match(/^(\d+):(\d{2}):(\d{2})$/);
  return match ? `${Number(match[1])}:${match[2]}:${match[3]}` : null;
}

function timeToGap(value) {
  const match = clean(value).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (seconds < 60) return `+${String(seconds).padStart(2, '0')}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `+${minutes}:${String(remainder).padStart(2, '0')}`;
}

// `pdftotext -layout` puede pegar el IOC al UCI ID (SWE100...) cuando la
// columna queda estrecha. El UCI ID es el ancla estable para recuperar la fila.
const rowPattern = /^\s*(?:(\d+)\s+)?(\d+)\s+([A-Z*\-]{3})\s*((?:\d{3}\s*){3}\d{2})\s+(.+?)\s{2,}([A-Z0-9]{2,4})\s{2,}(.+?)(?:\s{2,}(\d+:\d{2}:\d{2}))?\s*$/;

export function parseResultRow(line, irm = null) {
  const match = String(line).match(rowPattern);
  if (!match) return null;
  const [, rankText, bib, ioc, uciId, riderDisplay, teamCode, teamName, resultTime] = match;
  if (!rankText && !irm) return null;
  if (rankText && !resultTime) return null;
  if (irm && (rankText || resultTime)) return null;
  const base = {
    rank: rankText ? Number(rankText) : null,
    rankText: rankText || irm,
    bib,
    riderDisplay: clean(riderDisplay),
    teamName: clean(teamName),
    teamCode,
    uciId: compactUciId(uciId),
    isoCode2: ISO2[ioc] ?? null,
    points: null,
    irm,
  };
  if (irm) return { ...base, resultValue: null, timeText: null, gapText: null };
  if (base.rank === 1) {
    const timeText = normalizeTime(resultTime);
    return { ...base, resultValue: timeText, timeText, gapText: null };
  }
  const gapText = timeToGap(resultTime);
  return { ...base, resultValue: gapText, timeText: null, gapText };
}

const irmHeader = (line) => {
  const text = clean(line).toLocaleUpperCase('fr');
  if (/^(DNS|NON PARTANTS|NIET VERTROKKEN)\b/.test(text)) return 'DNS';
  if (/^(DNF|ABANDONS|ABANDONN?S|OPGAVES)\b/.test(text)) return 'DNF';
  if (/^(OTL|HORS DELAI|BUITEN TIJD)\b/.test(text)) return 'OTL';
  if (/^(DSQ|DISQUALIF|GEDISKWALIFICEERD)\b/.test(text)) return 'DSQ';
  return null;
};

export function parsePdfText(code, text, expectedDate = null) {
  const parsedCode = parseCode(code);
  if (isPlaceholder(text)) return null;
  if (!/UITSLAG\s*-\s*RESULTAT\s*-\s*RESULT/i.test(text)) throw new Error('el PDF no contiene una clasificación Belgian Cycling reconocible');

  const dateKey = normalizedDate(text);
  if (!dateKey) throw new Error('el PDF no contiene fecha');
  if (dateKey.slice(0, 4) !== parsedCode.slice(0, 4)) throw new Error(`el PDF es de ${dateKey.slice(0, 4)}, no de ${parsedCode.slice(0, 4)}`);
  if (expectedDate && dateKey !== expectedDate) throw new Error(`el PDF es de ${dateKey}, no de ${expectedDate}`);

  // `Deelnemers` cuenta a quienes tomaron la salida. Los DNS se publican en la
  // misma clasificación, pero no entran en ese total; se suman tras extraerlos.
  const starters = Number(String(text).match(/Deelnemers\s*:\s*(\d+)/i)?.[1] || 0) || null;
  let currentIrm = null;
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const nextIrm = irmHeader(line);
    if (nextIrm) { currentIrm = nextIrm; continue; }
    const row = parseResultRow(line, currentIrm);
    if (row) rows.push(row);
  }

  const ranked = rows.filter((row) => row.rank != null);
  const dnsCount = rows.filter((row) => row.irm === 'DNS').length;
  const expectedRowCount = starters == null ? null : starters + dnsCount;
  if (!ranked.length || ranked[0].rank !== 1) throw new Error('la clasificación no contiene ganador');
  if (ranked.some((row, index) => row.rank !== index + 1)) throw new Error('la clasificación contiene rangos incompletos');
  const bibs = rows.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('la clasificación contiene dorsales duplicados');
  if (expectedRowCount != null && rows.length !== expectedRowCount) {
    throw new Error(`se extrajeron ${rows.length} filas, pero el PDF declara ${expectedRowCount} participantes`);
  }

  const eventId = synthEventId(parsedCode);
  return {
    uciRaceId: synthRaceId(parsedCode),
    stageNumber: null,
    dateKey,
    raceType: 'IRR',
    isFinalClassification: false,
    eventName: 'Race Classification',
    sourcePdfUrl: resultPdfUrl(parsedCode),
    classifications: [{
      eventId,
      classKind: 'gc',
      scope: 'stage',
      eventName: 'Race Classification',
      isTeamEvent: false,
      winnerName: ranked[0].riderDisplay,
      rowCount: rows.length,
      expectedRowCount,
      rows,
    }],
  };
}

async function pdfToText(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: {
      'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'belgiancycling-'));
  const file = join(dir, 'result.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const text = FIXTURE ? readFileSync(resolve(FIXTURE), 'utf8') : await pdfToText(resultPdfUrl(code));
  const stage = parsePdfText(code, text, DATE);
  const output = {
    competitionId: COMPETITION_ID,
    disciplineId: 10,
    source: 'belgiancycling',
    belgianCyclingCode: code,
    fetchedAt: new Date().toISOString(),
    stages: stage ? [stage] : [],
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!stage) log(`Belgian Cycling ${code}: PDF marcador, resultado aún no publicado`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
