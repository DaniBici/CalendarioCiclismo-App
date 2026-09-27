#!/usr/bin/env node
/** Resultados JSON públicos de Maneffic Timing & Results (timing-results.com).
 *
 * El código persistido es el directorio estable bajo raceDataUploads, por ejemplo
 * `2026/ROA/NED_78380`. Cada etapa publica result.json y, de forma opcional,
 * result_young.json y result_teams.json. Las generales viven en
 * classifications/. El cron pasa la fecha esperada de la jornada: es un guard
 * obligatorio en producción porque el cronometrador puede dejar datos de prueba
 * en esas URLs antes de la carrera.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const EXPECTED_DATE = arg('--expected-date');
const STAGE_DATES_JSON = arg('--stage-dates');
const FIXTURE_DIR = arg('--fixture-dir');
const BASE = 'https://www.timing-results.com/raceDataUploads';
const FINAL_SLOT = 'final';
export const RESULTS_SOURCE = 'maneffic';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const IRM = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL', AB: 'DNF', ABD: 'DNF' };
const CLASS_INDEX = { stage: 1, gc: 2, points: 3, kom: 4, youth: 5, teams: 6 };

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function parseCode(value) {
  const code = clean(value).replace(/^\/+|\/+$/g, '');
  if (!/^20\d{2}\/[A-Z0-9_-]+\/[A-Z0-9_-]+$/.test(code)) {
    throw new Error('--code debe ser el directorio YYYY/DISCIPLINA/EVENTO de timing-results.com');
  }
  return code;
}

export const suggestCompetitionId = (code) => -(fnv1a(`maneffic:${parseCode(code)}`) % 200000 || 1);
export const endpoint = (code, path) => `${BASE}/${parseCode(code)}/${String(path).replace(/^\/+/, '')}`;
export const synthRaceId = (code, slot) => -(fnv1a(`maneffic:${parseCode(code)}:race:${slot}`) % 2000000000 || 1);
export const synthEventId = (code, slot, classKind, scope) =>
  -(fnv1a(`maneffic:${parseCode(code)}:event:${slot}:${classKind}:${scope}:${CLASS_INDEX[classKind] || 9}`) % 2000000000 || 1);

export function normalizeTime(value) {
  const raw = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  return parts.length === 3 ? `${Number(parts[0])}:${parts[1]}:${parts[2]}` : raw;
}

export function normalizeGap(value) {
  const raw = clean(value).replace(/\s/g, '').replace(',', '.').replace(/^\+/, '');
  if (!/^\d+(?::\d{2}){0,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  parts[0] = String(Number(parts[0]));
  return `+${parts.join(':')}`;
}

export function generatedDate(document) {
  const match = clean(document?.generated).match(/^(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

export function stageNumberFromName(value) {
  const match = clean(value).match(/\bstage\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function documentMatchesStage(document, stageNumber, expectedDate = null) {
  if (!document || !Array.isArray(document.resultData)) return false;
  const namedStage = stageNumberFromName(document.raceName);
  if (namedStage != null && namedStage !== Number(stageNumber)) return false;
  if (expectedDate && generatedDate(document) !== expectedDate) return false;
  return true;
}

// Censo independiente de las filas de llegada: la lista de salida de esa etapa.
// Puede publicarse la víspera. No confundirla con la lista inicial de la carrera,
// que conserva bajas y dorsales sustituidos y puede impedir el cierre del cuadro.
export function startlistPublication(document, resultDocument, code, stageNumber) {
  const date = generatedDate(document);
  const resultDate = generatedDate(resultDocument);
  if (!Array.isArray(document?.riders) || !document.riders.length
    || clean(document.documentName).toLowerCase() !== 'startlist'
    || !clean(document.eventName) || clean(document.eventName) !== clean(resultDocument?.eventName)
    || stageNumberFromName(document.raceName) !== stageNumber
    || stageNumberFromName(resultDocument?.raceName) !== stageNumber
    || !date || !resultDate || date.slice(0, 4) !== parseCode(code).slice(0, 4)
    || date > resultDate || Date.parse(resultDate) - Date.parse(date) > 86400000) return null;
  const ids = document.riders.map(rider => clean(rider.bib));
  if (ids.some(bib => !/^[1-9]\d*$/.test(bib)) || new Set(ids).size !== ids.length) return null;
  return {
    provider: RESULTS_SOURCE, format: 'progressive',
    expectedVerified: true, expectedKind: 'bib', expectedIds: ids,
    expectedBasis: endpoint(code, `stage${stageNumber}/startlist.json`),
  };
}

export function mapRows(sourceRows, { timed = false, points = false, teamRows = false } = {}) {
  const rows = [];
  for (const item of Array.isArray(sourceRows) ? sourceRows : []) {
    const rawResult = clean(item?.result);
    const status = rawResult.toUpperCase();
    const irm = IRM[status] || ((!Number(item?.rank) || Number(item.rank) < 1) && /^[A-Z]{2,4}$/.test(status) ? status : null);
    const rank = Number.isInteger(Number(item?.rank)) && Number(item.rank) > 0 ? Number(item.rank) : null;
    if (!rank && !irm) continue;
    const bib = teamRows ? null : (/^\d+$/.test(clean(item?.bib)) && Number(item.bib) > 0 ? clean(item.bib) : null);
    const riderDisplay = teamRows ? clean(item?.teamName) : (clean(item?.name2) || clean(item?.name));
    if (!riderDisplay) continue;
    const absolute = normalizeTime(rawResult);
    const gap = normalizeGap(item?.gap);
    const pointValue = points && /^-?\d+(?:\.\d+)?$/.test(rawResult) ? Number(rawResult) : null;
    rows.push({
      rank,
      rankText: rank ? String(rank) : irm,
      bib,
      riderDisplay,
      teamName: clean(item?.teamName) || (teamRows ? riderDisplay : null),
      nationality: teamRows ? null : (clean(item?.nationality) || null),
      resultValue: irm ? null : (points && pointValue != null ? String(pointValue) : (rank === 1 ? absolute : (gap || absolute))),
      timeText: irm || !timed || rank !== 1 ? null : absolute,
      gapText: irm || !timed || rank === 1 ? null : gap,
      points: pointValue,
      irm,
    });
  }
  return rows;
}

function classification(code, slot, document, spec, { final = false } = {}) {
  const rows = mapRows(document?.resultData, spec);
  const winner = rows.find((row) => row.rank === 1 && !row.irm);
  if (!winner) return null;
  const scope = final ? 'stage' : spec.scope;
  const finalNames = {
    gc: 'General Classification', points: 'Points Classification', youth: 'Youth Classification',
    teams: 'Teams Classification',
  };
  return {
    eventId: synthEventId(code, slot, spec.classKind, scope),
    classKind: spec.classKind,
    scope,
    eventName: final ? finalNames[spec.classKind] : spec.eventName,
    isTeamEvent: !!spec.teamRows,
    winnerName: winner.riderDisplay,
    rowCount: rows.length,
    rows,
  };
}

const STAGE_SPECS = [
  ['result.json', { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification', timed: true }],
  ['result_young.json', { classKind: 'youth', scope: 'stage', eventName: 'Stage Youth Classification', timed: true }],
  ['result_teams.json', { classKind: 'teams', scope: 'stage', eventName: 'Stage Teams Classification', timed: true, teamRows: true }],
];

const OVERALL_SPECS = [
  ['classifications/classification_general.json', { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification', timed: true }],
  ['classifications/classification_points.json', { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', points: true }],
  ['classifications/classification_youth.json', { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification', timed: true }],
  ['classifications/classification_team.json', { classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', timed: true, teamRows: true }],
];

export function stagesFromDocuments(documents, { code, onlyStage = null, totalStages, expectedDate = null, stageDates = null } = {}) {
  const eventCode = parseCode(code);
  const count = Number(totalStages);
  if (!Number.isInteger(count) || count < 1) throw new Error('--total-stages debe ser un entero positivo');
  const stages = [];
  const stageNumbers = onlyStage == null ? Array.from({ length: count }, (_, index) => index + 1) : [Number(onlyStage)];

  for (const stageNumber of stageNumbers) {
    if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > count) continue;
    const expectedStageDate = expectedDate || stageDates?.[String(stageNumber)] || null;
    const mainDocument = documents[`stage${stageNumber}/result.json`];
    if (!documentMatchesStage(mainDocument, stageNumber, expectedStageDate)) continue;
    const publication = startlistPublication(documents[`stage${stageNumber}/startlist.json`], mainDocument, eventCode, stageNumber);
    const classifications = [];
    for (const [suffix, spec] of STAGE_SPECS) {
      const document = documents[`stage${stageNumber}/${suffix}`];
      if (!documentMatchesStage(document, stageNumber, expectedStageDate)) continue;
      const built = classification(eventCode, stageNumber, document, spec);
      if (built && publication && spec.classKind === 'stage') built.publication = publication;
      if (built) classifications.push(built);
    }
    if (!classifications.some((item) => item.classKind === 'stage')) continue;

    const cumulative = [];
    for (const [path, spec] of OVERALL_SPECS) {
      const document = documents[path];
      if (!documentMatchesStage(document, stageNumber, expectedStageDate)) continue;
      const built = classification(eventCode, stageNumber, document, spec);
      if (built && publication && spec.classKind === 'gc') built.publication = publication;
      if (built) cumulative.push({ document, spec, built });
    }
    const isLast = stageNumber === count;
    if (!isLast) classifications.push(...cumulative.map((item) => item.built));
    const dateKey = expectedStageDate || generatedDate(mainDocument);
    stages.push({
      uciRaceId: synthRaceId(eventCode, stageNumber),
      stageNumber,
      stageName: clean(mainDocument.raceName) || `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey,
      raceType: /\b(time trial|itt|tijdrit)\b/i.test(clean(mainDocument.raceName)) ? 'ITT' : null,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    if (isLast && cumulative.length) {
      const finals = cumulative
        .map(({ document, spec }) => {
          const built = classification(eventCode, FINAL_SLOT, document, spec, { final: true });
          if (built && publication && spec.classKind === 'gc') built.publication = publication;
          return built;
        })
        .filter(Boolean);
      if (finals.length) {
        stages.push({
          uciRaceId: synthRaceId(eventCode, FINAL_SLOT),
          stageNumber: null,
          stageName: 'Final Classification',
          isFinalClassification: true,
          dateKey,
          raceType: null,
          startLocation: null,
          classificationCount: finals.length,
          classifications: finals,
        });
      }
    }
  }
  return stages;
}

async function fetchJsonOptional(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  // Los archivos aún no subidos redirigen a una página HTML con HTTP 200.
  if (!/application\/json/i.test(response.headers.get('content-type') || '')) return null;
  return response.json();
}

async function loadDocuments(code, stageNumbers) {
  const paths = new Set();
  for (const stageNumber of stageNumbers) {
    paths.add(`stage${stageNumber}/startlist.json`);
    for (const [suffix] of STAGE_SPECS) paths.add(`stage${stageNumber}/${suffix}`);
  }
  for (const [path] of OVERALL_SPECS) paths.add(path);
  const documents = {};
  for (const path of paths) {
    if (FIXTURE_DIR) {
      try { documents[path] = JSON.parse(readFileSync(resolve(FIXTURE_DIR, path), 'utf8')); } catch { documents[path] = null; }
    } else {
      documents[path] = await fetchJsonOptional(endpoint(code, path));
    }
  }
  return documents;
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) { process.stdout.write(`${suggestCompetitionId(code)}\n`); return; }
  if (!Number.isInteger(COMPETITION_ID) || COMPETITION_ID >= 0) throw new Error('Falta --competition-id negativo (o usa --suggest-id)');
  if (!Number.isInteger(TOTAL_STAGES) || TOTAL_STAGES < 1) throw new Error('Falta --total-stages');
  if (ONLY_STAGE != null && (!Number.isInteger(ONLY_STAGE) || ONLY_STAGE < 1 || ONLY_STAGE > TOTAL_STAGES)) throw new Error('--stage fuera de rango');
  if (EXPECTED_DATE && !/^20\d{2}-\d{2}-\d{2}$/.test(EXPECTED_DATE)) throw new Error('--expected-date debe ser YYYY-MM-DD');
  let stageDates = null;
  if (STAGE_DATES_JSON) {
    stageDates = JSON.parse(STAGE_DATES_JSON);
    if (!stageDates || Array.isArray(stageDates) || Object.values(stageDates).some((date) => !/^20\d{2}-\d{2}-\d{2}$/.test(String(date)))) {
      throw new Error('--stage-dates debe ser un objeto JSON {"etapa":"YYYY-MM-DD"}');
    }
  }
  if (!EXPECTED_DATE && !stageDates) throw new Error('Falta --expected-date o --stage-dates para bloquear datos de prueba');
  const stageNumbers = ONLY_STAGE == null ? Array.from({ length: TOTAL_STAGES }, (_, index) => index + 1) : [ONLY_STAGE];
  const documents = await loadDocuments(code, stageNumbers);
  const stages = stagesFromDocuments(documents, {
    code, onlyStage: ONLY_STAGE, totalStages: TOTAL_STAGES,
    expectedDate: EXPECTED_DATE, stageDates,
  });
  const output = {
    competitionId: COMPETITION_ID,
    disciplineId: 10,
    source: RESULTS_SOURCE,
    manefficCode: code,
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`FATAL: ${error.stack || error.message}\n`); process.exit(1); });
}
