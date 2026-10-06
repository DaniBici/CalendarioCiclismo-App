#!/usr/bin/env node
/**
 * Resultados oficiales del sistema Bornan de unos Juegos (p. ej. Santa Fe 2026).
 *
 * code: `<apiBase>|<champ>|<disc>|<eventKey>` (p. ej.
 * `https://back.results.santafe2026.org|JSUD2026|CRD|W.TT----------------`).
 * La fuente de verdad es el endpoint estructurado
 * `/s/{champ}/{lang}/{disc}/results/{unitKey}`, el mismo que muestra la web
 * oficial: cuando la unidad queda OFFICIAL (`Info.Status`) publica
 * `Competitors` con puesto, dorsal, NOC, tiempo, hueco e IRM. El índice
 * `/s/{champ}/{lang}/{disc}/reports/all` solo descubre la unidad y la clave;
 * el cuadro `Results` (C73T) se publica más tarde y queda como respaldo si el
 * endpoint estructurado no está disponible. Sin clasificación oficial el
 * fetcher emite cero etapas para que el cron mantenga el enlace pendiente.
 * La API responde gzip cuyo contenido puede ir doblemente comprimido y con los
 * bytes del deflate re-codificados a UTF-8; decodeJsonBuffer lo resuelve.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const DATE = arg('--date');
const OUT = arg('--out', '.');
const FIXTURE = arg('--fixture');
const USER_AGENT = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
const log = (message) => process.stderr.write(`${message}\n`);

export const ISO2 = {
  ARG: 'ar', ARU: 'ar', BOL: 'bo', BRA: 'br', CHI: 'cl', COL: 'co', CRC: 'cr', CUB: 'cu',
  DOM: 'do', ECU: 'ec', ESA: 'sv', GUA: 'gt', GUY: 'gy', HON: 'hn', MEX: 'mx', NCA: 'ni',
  PAN: 'pa', PAR: 'py', PER: 'pe', SUR: 'sr', URU: 'uy', VEN: 've', USA: 'us', CAN: 'ca',
  // NOC de Asia (Juegos Asiáticos): el código de tres letras es el del COI.
  AFG: 'af', BAN: 'bd', BHU: 'bt', BRN: 'bh', BRU: 'bn', CAM: 'kh', CHN: 'cn', HKG: 'hk',
  INA: 'id', IND: 'in', IRQ: 'iq', IRI: 'ir', JOR: 'jo', JPN: 'jp', KAZ: 'kz', KGZ: 'kg',
  KOR: 'kr', KSA: 'sa', KUW: 'kw', LAO: 'la', LBN: 'lb', MAC: 'mo', MAS: 'my', MDV: 'mv',
  MGL: 'mn', MYA: 'mm', NEP: 'np', OMA: 'om', PAK: 'pk', PHI: 'ph', PLE: 'ps', PRK: 'kp',
  QAT: 'qa', SGP: 'sg', SRI: 'lk', SYR: 'sy', THA: 'th', TJK: 'tj', TKM: 'tm', TLS: 'tl',
  TPE: 'tw', UAE: 'ae', UZB: 'uz', VIE: 'vn', YEM: 'ye',
};

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const IRM_CODES = 'DNF|DNS|DSQ|DQB|OTL';
const IRM_SET = new Set(IRM_CODES.split('|'));

export function parseCode(value) {
  const parts = String(value || '').split('|').map((part) => part.trim());
  if (parts.length !== 4 || !parts.every(Boolean)) {
    throw new Error('--code debe ser <apiBase>|<champ>|<disc>|<eventKey>');
  }
  const [apiBase, champ, disc, eventKey] = parts;
  if (!/^https:\/\//.test(apiBase)) throw new Error('apiBase debe ser una URL https');
  return { apiBase: apiBase.replace(/\/+$/, ''), champ, disc, eventKey };
}

export const suggestCompetitionId = (code) => {
  const parsed = typeof code === 'string' ? parseCode(code) : code;
  return -(fnv1a(`bornan:${parsed.apiBase}|${parsed.champ}|${parsed.disc}|${parsed.eventKey}`) % 200000);
};

export const synthEventId = (code) => {
  const parsed = typeof code === 'string' ? parseCode(code) : code;
  return -(Math.abs(suggestCompetitionId(parsed)) * 10000 + 1);
};

export function decodeJsonBuffer(buffer) {
  const candidates = new Set([buffer, Buffer.from(buffer.toString('utf8'), 'latin1')]);
  const bodies = [];
  for (const candidate of candidates) {
    bodies.push(candidate);
    for (const decompress of [zlib.gunzipSync, zlib.inflateSync, zlib.brotliDecompressSync]) {
      try { bodies.push(decompress(candidate)); } catch { /* formato distinto */ }
    }
  }
  let lastError = null;
  for (const body of bodies) {
    for (const attempt of [
      () => JSON.parse(body.toString('utf8')),
      () => JSON.parse(zlib.inflateSync(Buffer.from(body.toString('utf8'), 'latin1'))),
      () => JSON.parse(zlib.inflateRawSync(Buffer.from(body.toString('utf8'), 'latin1'))),
    ]) {
      try { return attempt(); } catch (error) { lastError = error; }
    }
  }
  throw lastError ?? new Error('respuesta ilegible');
}

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

const stripHundredths = (value) => String(value).replace(/\.(\d{2})$/, '');
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const rankedRowPattern = /^\s{0,40}(\d{1,3})\s+(\d{1,3})\s+(\S.*?)\s{2,}([A-Z]{3})\s{2,}(.+?)\s*$/;
const irmRowPattern = new RegExp(`^\\s{0,40}(\\d{1,3})\\s+(\\S.*?)\\s{2,}([A-Z]{3})\\s{2,}(${IRM_CODES})\\s*$`);
const summaryPattern = /^\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m;
// Acepta M:SS.cc y H:MM:SS.cc (carretera en línea); las centésimas son opcionales.
const timePattern = /\d{1,2}:(?:\d{2}:)?\d{2}(?:\.\d{2})?/g;

export function parseRow(line) {
  const text = String(line);
  const ranked = text.match(rankedRowPattern);
  if (ranked) {
    const [, rankText, bib, riderDisplay, noc, tail] = ranked;
    const behindMatch = tail.match(/\+[\d:.]+/);
    const withoutBehind = behindMatch ? tail.slice(0, behindMatch.index) : tail;
    const times = [...withoutBehind.matchAll(timePattern)];
    if (!times.length) return null;
    const timeText = stripHundredths(times[times.length - 1][0]);
    const gapText = behindMatch ? stripHundredths(behindMatch[0]) : null;
    return {
      rank: Number(rankText),
      rankText,
      bib,
      riderDisplay: clean(riderDisplay),
      isoCode2: ISO2[noc] ?? null,
      timeText,
      gapText,
      resultValue: gapText ?? timeText,
      irm: null,
    };
  }
  const irm = text.match(irmRowPattern);
  if (irm) {
    const [, bib, riderDisplay, noc, code] = irm;
    return {
      rank: null,
      rankText: code,
      bib,
      riderDisplay: clean(riderDisplay),
      isoCode2: ISO2[noc] ?? null,
      timeText: null,
      gapText: null,
      resultValue: null,
      irm: code,
    };
  }
  return null;
}

export function parsePdfText(text, { expectedDate = null, expectedEventToken = null } = {}) {
  // El cuadro oficial puede publicarse solo en inglés («Results») o bilingüe
  // con español («Resultados»); cualquiera de las dos cabeceras lo identifica.
  if (!/\bResults\b/.test(String(text)) && !/\bResultados\b/.test(String(text))) {
    throw new Error('el PDF no contiene un cuadro de resultados Bornan reconocible');
  }
  const dateMatch = String(text).match(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\s+([A-Z]{3})\s+(20\d{2})\b/);
  if (!dateMatch) throw new Error('el PDF no contiene fecha');
  const dateKey = `${dateMatch[3]}-${MONTHS[dateMatch[2]]}-${String(dateMatch[1]).padStart(2, '0')}`;
  if (expectedDate && dateKey !== expectedDate) throw new Error(`el PDF es de ${dateKey}, no de ${expectedDate}`);
  if (expectedEventToken && !String(text).includes(expectedEventToken)) {
    throw new Error('el informe no corresponde a la unidad esperada');
  }

  const summary = String(text).match(summaryPattern);
  const declared = summary
    ? { entries: Number(summary[1]), ranked: Number(summary[3]), DNF: Number(summary[4]), DSQ: Number(summary[5]), DQB: Number(summary[6]), DNS: Number(summary[7]) }
    : null;

  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked[0].rank !== 1) throw new Error('la clasificación no contiene ganador');
  if (ranked.some((row, index) => row.rank !== index + 1)) throw new Error('la clasificación contiene rangos incompletos');
  const bibs = rows.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('la clasificación contiene dorsales duplicados');
  if (declared) {
    if (ranked.length !== declared.ranked) {
      throw new Error(`se extrajeron ${ranked.length} clasificados, pero el PDF declara ${declared.ranked}`);
    }
    for (const code of ['DNF', 'DSQ', 'DQB', 'DNS']) {
      const count = rows.filter((row) => row.irm === code).length;
      if (count !== declared[code]) {
        throw new Error(`se extrajeron ${count} ${code}, pero el PDF declara ${declared[code]}`);
      }
    }
  }

  return {
    stageNumber: null,
    dateKey,
    raceType: 'IRR',
    isFinalClassification: false,
    eventName: 'Results',
    classifications: [{
      classKind: 'gc',
      scope: 'stage',
      eventName: 'Results',
      isTeamEvent: false,
      winnerName: ranked[0].riderDisplay,
      rowCount: rows.length,
      expectedRowCount: declared ? declared.entries : null,
      rows,
    }],
  };
}

export function reportsIndexUrl({ apiBase, champ, disc }) {
  return `${apiBase}/s/${champ}/en/${disc}/reports/all`;
}

export function resultsUrl({ apiBase, champ, disc }, unitKey) {
  return `${apiBase}/s/${champ}/en/${disc}/results/${unitKey}`;
}

export function findEventUnit(payload, eventKey, expectedDate = null) {
  const event = (payload?.Events ?? []).find((entry) => entry.Key === eventKey);
  const units = (event?.Phases ?? []).flatMap((phase) => phase.Units ?? []);
  if (!units.length) return null;
  if (expectedDate) {
    const dated = units.find((unit) => String(unit.DateTimeRaw || '').slice(0, 10) === expectedDate);
    if (dated) return dated;
  }
  return units[0];
}

// El endpoint estructurado publica una fila por participante con Rk (puesto),
// Result (tiempo), Diff (hueco) e IRM. Los no clasificados llegan con Rk vacío
// y un código IRM; una fila sin puesto ni código es una anomalía que se rechaza.
export function parseUnitResults(payload, { expectedDate = null, expectedEventKey = null } = {}) {
  const info = payload?.Info;
  if (!info) throw new Error('la respuesta no contiene una unidad Bornan');
  if (String(info.Status || '').toUpperCase() !== 'OFFICIAL') {
    throw new Error(`la unidad no está OFFICIAL (${info.Status || 'sin estado'})`);
  }
  if (expectedEventKey && info.Event !== expectedEventKey) {
    throw new Error('el informe no corresponde a la unidad esperada');
  }
  const dateKey = String(info.DateTimeRaw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('la unidad no contiene fecha');
  if (expectedDate && dateKey !== expectedDate) throw new Error(`la unidad es de ${dateKey}, no de ${expectedDate}`);

  const competitors = payload?.Competitors ?? [];
  if (!competitors.length) throw new Error('la clasificación no contiene participantes');
  const rows = [];
  for (const competitor of competitors) {
    const bib = clean(competitor.Bib);
    if (!bib) throw new Error('la clasificación contiene una fila sin dorsal');
    const rankValue = Number(competitor.Rk);
    const rank = Number.isInteger(rankValue) && rankValue > 0 ? rankValue : null;
    const irmCode = clean(competitor.IRM).toUpperCase();
    const irm = IRM_SET.has(irmCode) ? irmCode : null;
    if (rank == null && !irm) throw new Error(`la fila ${bib} no tiene puesto ni IRM`);
    const timeText = rank == null ? null : stripHundredths(clean(competitor.Result)) || null;
    const gapText = rank == null ? null : stripHundredths(clean(competitor.Diff)) || null;
    rows.push({
      rank,
      rankText: rank == null ? irm : String(rank),
      bib,
      riderDisplay: clean(competitor.Name) || clean(competitor.NameS),
      isoCode2: ISO2[clean(competitor.Org)] ?? null,
      timeText,
      gapText,
      resultValue: gapText ?? timeText,
      irm,
    });
  }

  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked[0].rank !== 1) throw new Error('la clasificación no contiene ganador');
  if (ranked.some((row, index) => row.rank !== index + 1)) throw new Error('la clasificación contiene rangos incompletos');
  const bibs = rows.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('la clasificación contiene dorsales duplicados');

  return {
    stageNumber: null,
    dateKey,
    raceType: 'IRR',
    isFinalClassification: false,
    eventName: 'Results',
    classifications: [{
      classKind: 'gc',
      scope: 'stage',
      eventName: 'Results',
      isTeamEvent: false,
      winnerName: ranked[0].riderDisplay,
      rowCount: rows.length,
      expectedRowCount: competitors.length,
      rows,
    }],
  };
}

export function findResultReport(payload, eventKey) {
  const event = (payload?.Events ?? []).find((entry) => entry.Key === eventKey);
  if (!event) return null;
  for (const phase of event.Phases ?? []) {
    for (const unit of phase.Units ?? []) {
      const reports = (unit.Reports ?? []).filter((report) => report.Desc === 'Results');
      if (!reports.length) continue;
      reports.sort((left, right) => (right.Version - left.Version) || (right.Revision - left.Revision));
      return { unit, report: reports[0] };
    }
  }
  return null;
}

async function pdfToText(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'bornan-'));
  const file = join(dir, 'result.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const parsedCode = parseCode(CODE);
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(parsedCode)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');

  let stage = null;
  let sourcePdfUrl = null;
  if (FIXTURE) {
    stage = parsePdfText(readFileSync(resolve(FIXTURE), 'utf8'), { expectedDate: DATE });
  } else {
    const payload = await fetchJson(reportsIndexUrl(parsedCode));
    const found = findResultReport(payload, parsedCode.eventKey);
    const unit = findEventUnit(payload, parsedCode.eventKey, DATE);
    let structured = null;
    if (unit) {
      try {
        structured = await fetchJson(resultsUrl(parsedCode, unit.Key));
      } catch (error) {
        log(`Bornan ${parsedCode.eventKey}: endpoint de resultados no disponible (${error.message})`);
      }
    }
    if (structured && String(structured?.Info?.Status || '').toUpperCase() === 'OFFICIAL') {
      stage = parseUnitResults(structured, { expectedDate: DATE, expectedEventKey: parsedCode.eventKey });
      stage.sourcePdfUrl = found?.report?.URL ?? resultsUrl(parsedCode, unit.Key);
    } else if (found) {
      sourcePdfUrl = found.report.URL;
      const eventToken = parsedCode.eventKey.replace(/\./g, '');
      const text = await pdfToText(sourcePdfUrl);
      stage = parsePdfText(text, { expectedDate: DATE, expectedEventToken: eventToken });
      stage.sourcePdfUrl = sourcePdfUrl;
    } else {
      log(`Bornan ${parsedCode.eventKey}: sin clasificación oficial todavía`);
    }
    if (stage) {
      stage.classifications = stage.classifications.map((classification) => ({
        ...classification,
        eventId: synthEventId(parsedCode),
      }));
    }
  }

  const output = {
    competitionId: COMPETITION_ID,
    disciplineId: 10,
    source: 'bornan',
    bornanCode: CODE,
    fetchedAt: new Date().toISOString(),
    stages: stage ? [stage] : [],
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
