#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IRM_MAP = new Map([
  ['DNF', 'DNF'], ['ABD', 'DNF'], ['AB', 'DNF'], ['ABANDON', 'DNF'], ['ABANDONO', 'DNF'], ['RIT', 'DNF'], ['RITIRATO', 'DNF'],
  ['DNS', 'DNS'], ['NP', 'DNS'], ['NON PARTANT', 'DNS'], ['NON PARTITI', 'DNS'],
  ['OTL', 'OTL'], ['HD', 'OTL'], ['HORS DELAI', 'OTL'], ['FUORI TEMPO MASSIMO', 'OTL'],
  ['DSQ', 'DSQ'], ['EXP', 'DSQ'], ['SQ', 'DSQ'], ['SQUALIFICATO', 'DSQ'],
]);
const IRM_CODES = new Set(['DNF', 'DNS', 'OTL', 'DSQ']);
const TIME_KINDS = new Set(['stage', 'gc', 'youth', 'teams']);
const POINT_KINDS = new Set(['points', 'kom']);
const CLASSIFICATIONS = new Set(['stage/stage', 'gc/stage', 'points/overall', 'kom/overall', 'youth/overall', 'teams/overall']);

function clean(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function nullable(value) {
  const text = clean(value);
  return text === '' ? null : text;
}

function normalizeResultIdentity(source) {
  const bib = normalizeBib(source.bib) ?? normalizeBib(source.dorsal);
  const {
    dorsal, position, pos, value, time, gap, status,
    ...internal
  } = source;
  return {
    ...internal,
    // El dorsal es la identidad de una fila individual. `dorsal` se admite como
    // alias de entrada para que una transcripción manual no tenga que conocer
    // el nombre interno de la columna.
    bib,
    riderDisplay: nullable(source.riderDisplay),
    firstName: nullable(source.firstName),
    lastName: nullable(source.lastName),
    teamName: nullable(source.teamName),
    isoCode2: source.isoCode2 == null ? null : clean(source.isoCode2).toLocaleLowerCase('en'),
  };
}

function normalizeBib(value) {
  const text = clean(value).replace(/^#\s*/, '');
  return text || null;
}

function stripDiacritics(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function irmCode(...values) {
  for (const value of values) {
    const key = stripDiacritics(value).replace(/[.]/g, '').toLocaleUpperCase('fr');
    if (IRM_MAP.has(key)) return IRM_MAP.get(key);
    if (IRM_CODES.has(key)) return key;
  }
  return null;
}

export function isSameTimeMarker(value) {
  const marker = stripDiacritics(value).replace(/\s+/g, '').toLocaleLowerCase('es');
  return /^(m\.?t\.?|s\.?t\.?|''|idem|=)$/.test(marker);
}

export function normalizeAbsoluteTime(value) {
  let text = clean(value).replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!text) return null;
  text = text.replace(/^\+\s*/, '').trim();
  let match = text.match(/^(\d+)\s*h(?:\s*|\s+)(\d{1,2})\s*(?:['m:]|min\.?)\s*(\d{1,2})(?:\s*(?:"|s|sec\.?)\s*(?:[.,]?\d+)?)?$/i);
  if (match) return formatAbsoluteTime(match[1], match[2], match[3]);
  match = text.match(/^(\d+)\s*(?:['m]|min\.?)\s*(\d{1,2})(?:\s*(?:"|s|sec\.?)\s*(?:[.,]?\d+)?)?$/i);
  if (match) return formatAbsoluteTime(0, match[1], match[2]);
  match = text.match(/^(\d+)(?::|\.)(\d{1,2})(?::|\.)(\d{1,2})(?:[.,]\d+)?$/);
  if (match) return formatAbsoluteTime(match[1], match[2], match[3]);
  match = text.match(/^(\d+)(?::|\.)(\d{1,2})(?:[.,]\d+)?$/);
  if (match) return formatAbsoluteTime(0, match[1], match[2]);
  return null;
}

function formatAbsoluteTime(hours, minutes, seconds) {
  const h = Number(hours), m = Number(minutes), s = Number(seconds);
  if (!Number.isInteger(h) || !Number.isInteger(m) || !Number.isInteger(s) || m > 59 || s > 59) return null;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function timeToSeconds(value) {
  const normalized = normalizeAbsoluteTime(value);
  if (!normalized) return null;
  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

export function secondsToGap(value) {
  if (!Number.isInteger(value) || value < 0) return null;
  if (value < 60) return `+${String(value).padStart(2, '0')}`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return hours > 0
    ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `+${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function normalizeGap(value) {
  let text = clean(value).replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!text || isSameTimeMarker(text)) return null;
  text = stripDiacritics(text)
    .replace(/^(?:a|à)\s+/i, '')
    .replace(/^\+\s*/, '')
    .replace(/\s*(?:seg(?:\.|undos?)?)$/i, '')
    .trim();
  let match = text.match(/^(\d+)\s*h(?:\s*|\s+)(\d{1,2})\s*(?:['m:]|min\.?)\s*(\d{1,2})(?:\s*(?:"|s|sec\.?)\s*(?:[.,]?\d+)?)?$/i);
  if (match) return secondsToGap(timePartsToSeconds(match[1], match[2], match[3]));
  match = text.match(/^(\d+)\s*(?:['m]|min\.?)\s*(\d{1,2})(?:\s*(?:"|s|sec\.?)\s*(?:[.,]?\d+)?)?$/i);
  if (match) return secondsToGap(timePartsToSeconds(0, match[1], match[2]));
  match = text.match(/^(\d+)(?::|\.)(\d{1,2})(?::|\.)(\d{1,2})(?:[.,]\d+)?$/);
  if (match) return secondsToGap(timePartsToSeconds(match[1], match[2], match[3]));
  match = text.match(/^(\d+)(?::|\.)(\d{1,2})(?:[.,]\d+)?$/);
  if (match) return secondsToGap(timePartsToSeconds(0, match[1], match[2]));
  match = text.match(/^(\d+)(?:\s*"+)?(?:[-.,]?\d+)?$/);
  if (match) return secondsToGap(Number(match[1]));
  return null;
}

function timePartsToSeconds(hours, minutes, seconds) {
  const h = Number(hours), m = Number(minutes), s = Number(seconds);
  if (!Number.isInteger(h) || !Number.isInteger(m) || !Number.isInteger(s) || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

export function gapToSeconds(value) {
  const normalized = normalizeGap(value);
  if (!normalized) return null;
  const parts = normalized.slice(1).split(':').map(Number);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function normalizeRank(value) {
  const match = clean(value).match(/^(\d+)\.?$/);
  return match ? Number(match[1]) : null;
}

function sourceValue(source, ...keys) {
  for (const key of keys) {
    if (source[key] != null && clean(source[key]) !== '') return source[key];
  }
  return null;
}

function normalizeTimeClassificationRows(rows, { emptyMeansDitto = false, isTeamEvent = false, raceType = null } = {}) {
  const winnerRow = rows.find((row) => normalizeRank(sourceValue(row, 'rank', 'position', 'pos', 'rankText')) === 1);
  const winnerSeconds = timeToSeconds(sourceValue(winnerRow ?? {}, 'timeText', 'time', 'resultValue', 'value'));
  let lastGap = '+00';
  return rows.map((source, index) => {
    const row = normalizeResultIdentity(source);
    const irm = irmCode(row.irm, row.status, source.rankText, source.position, source.value, source.timeText, source.time, source.gapText, source.gap);
    if (irm) {
      return {
        ...row,
        rank: null,
        rankText: irm,
        timeText: null,
        gapText: null,
        resultValue: null,
        irm,
      };
    }
    const rank = normalizeRank(sourceValue(source, 'rank', 'position', 'pos', 'rankText'));
    row.rank = rank;
    row.rankText = rank == null ? null : String(rank);
    row.irm = null;

    if (rank === 1) {
      row.timeText = normalizeAbsoluteTime(sourceValue(source, 'timeText', 'time', 'resultValue', 'value'));
      row.gapText = null;
      row.resultValue = row.timeText;
      return row;
    }

    if (raceType === 'TTT' && isTeamEvent === false && rank == null) {
      row.timeText = null;
      row.gapText = null;
      row.resultValue = null;
      return row;
    }

    const gapSource = sourceValue(source, 'gapText', 'gap', 'resultValue', 'value');
    const absoluteSource = sourceValue(source, 'timeText', 'time');
    let gap = null;
    if (isSameTimeMarker(gapSource) || isSameTimeMarker(absoluteSource)) {
      gap = lastGap;
    } else if (clean(gapSource)) {
      gap = normalizeGap(gapSource);
    } else if (emptyMeansDitto && index > 0) {
      gap = lastGap;
    } else {
      const absolute = timeToSeconds(absoluteSource);
      if (winnerSeconds != null && absolute != null && absolute >= winnerSeconds) gap = secondsToGap(absolute - winnerSeconds);
    }
    if (gap) lastGap = gap;
    row.timeText = null;
    row.gapText = gap;
    row.resultValue = gap;
    return row;
  });
}

function normalizePointsRows(rows) {
  return rows.map((source) => {
    const row = normalizeResultIdentity(source);
    const irm = irmCode(row.irm, row.status, source.rankText, source.position, source.value);
    if (irm) return {
      ...row,
      rank: null,
      rankText: irm,
      timeText: null,
      gapText: null,
      resultValue: null,
      points: null,
      irm,
    };
    const rank = normalizeRank(sourceValue(source, 'rank', 'position', 'pos', 'rankText'));
    const rawPoints = sourceValue(source, 'points', 'resultValue', 'value', 'timeText', 'time');
    const pointsText = clean(rawPoints).replace(',', '.').replace(/\s*pts?\.?$/i, '');
    const points = pointsText === '' ? null : Number(pointsText);
    const value = Number.isFinite(points) ? points : null;
    return {
      ...row,
      rank,
      rankText: rank == null ? null : String(rank),
      points: value,
      resultValue: value == null ? null : String(value),
      timeText: value == null ? null : String(value),
      gapText: null,
      irm: null,
    };
  });
}

export function normalizeResultsDocument(document, { emptyMeansDitto = false } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  return {
    ...document,
    stages: Array.isArray(document.stages) ? document.stages.map((stage) => ({
      ...stage,
      classifications: Array.isArray(stage.classifications) ? stage.classifications.map((classification) => {
        const kind = clean(classification.classKind);
        const rows = Array.isArray(classification.rows) ? classification.rows : [];
        const normalizedRows = POINT_KINDS.has(kind)
          ? normalizePointsRows(rows)
          : normalizeTimeClassificationRows(rows, {
              emptyMeansDitto,
              isTeamEvent: !!classification.isTeamEvent,
              raceType: stage.raceType,
            });
        const winner = normalizedRows.find((row) => row.rank === 1);
        return {
          ...classification,
          classKind: kind,
          scope: clean(classification.scope),
          rowCount: normalizedRows.length,
          winnerName: (classification.isTeamEvent ? winner?.teamName : winner?.riderDisplay) ?? classification.winnerName ?? null,
          rows: normalizedRows,
        };
      }) : stage.classifications,
    })) : document.stages,
  };
}

function issue(list, code, path, message) {
  list.push({ code, path, message });
}

function isGapFormat(value) {
  return /^\+(?:\d{2}|\d+:\d{2}|\d+:\d{2}:\d{2})$/.test(clean(value));
}

function readStartlistBibs(document) {
  if (Array.isArray(document)) return new Set(document.map(clean).filter(Boolean));
  const bibs = [];
  for (const team of document?.teams ?? []) for (const rider of team?.riders ?? []) bibs.push(clean(rider.dorsal));
  return new Set(bibs.filter(Boolean));
}

export function validateResultsDocument(document, {
  startlistBibs = null,
  startlistRaceId = null,
  expectedRaceId = null,
  minimumBibMatchRate = 0.9,
  allowNonMonotonicGaps = false,
  allowBibless = false,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    issue(errors, 'INVALID_DOCUMENT', '$', 'La entrada debe ser un objeto JSON.');
    return { ok: false, errors, warnings, summary: { stages: 0, classifications: 0, rows: 0 } };
  }
  if (!Array.isArray(document.stages) || document.stages.length === 0) {
    issue(errors, 'MISSING_STAGES', '$.stages', 'El documento no contiene etapas.');
    return { ok: false, errors, warnings, summary: { stages: 0, classifications: 0, rows: 0 } };
  }
  const raceId = clean(document.raceId);
  if (!raceId) {
    issue(errors, 'MISSING_RACE_ID', '$.raceId', 'Falta el identificador de la carrera.');
  }
  if (expectedRaceId != null && raceId !== clean(expectedRaceId)) {
    issue(errors, 'RACE_ID_MISMATCH', '$.raceId', `raceId=${raceId || '<vacío>'}; esperado=${clean(expectedRaceId)}.`);
  }
  if (startlistRaceId != null && raceId !== clean(startlistRaceId)) {
    issue(errors, 'STARTLIST_RACE_ID_MISMATCH', '$.raceId', `La startlist pertenece a ${clean(startlistRaceId)}, no a ${raceId || '<vacío>'}.`);
  }

  const eventIds = new Set();
  let classificationCount = 0;
  let rowCount = 0;

  document.stages.forEach((stage, stageIndex) => {
    const stagePath = `$.stages[${stageIndex}]`;
    if (!(stage.stageNumber == null || Number.isInteger(stage.stageNumber))) {
      issue(errors, 'INVALID_STAGE_NUMBER', `${stagePath}.stageNumber`, 'stageNumber debe ser entero o null.');
    }
    if (!Array.isArray(stage.classifications) || stage.classifications.length === 0) {
      issue(errors, 'MISSING_CLASSIFICATIONS', `${stagePath}.classifications`, 'La etapa no contiene clasificaciones.');
      return;
    }

    stage.classifications.forEach((classification, classIndex) => {
      classificationCount += 1;
      const classPath = `${stagePath}.classifications[${classIndex}]`;
      const pair = `${classification.classKind}/${classification.scope}`;
      if (!CLASSIFICATIONS.has(pair)) issue(errors, 'INVALID_CLASSIFICATION', classPath, `Clasificación no admitida: ${pair}.`);
      if (!clean(classification.eventName)) issue(errors, 'MISSING_EVENT_NAME', `${classPath}.eventName`, 'Falta eventName.');
      if (typeof classification.isTeamEvent !== 'boolean') issue(errors, 'INVALID_TEAM_EVENT_FLAG', `${classPath}.isTeamEvent`, 'isTeamEvent debe ser booleano.');
      if ((classification.classKind === 'teams') !== (classification.isTeamEvent === true)) {
        issue(errors, 'TEAM_EVENT_CLASS_MISMATCH', `${classPath}.isTeamEvent`, 'isTeamEvent=true corresponde exclusivamente a classKind=teams.');
      }
      if (!Number.isInteger(classification.eventId) || classification.eventId >= 0 || Math.abs(classification.eventId) > 2147483647) {
        issue(errors, 'INVALID_EVENT_ID', `${classPath}.eventId`, 'eventId debe ser un entero int4 negativo y determinista.');
      } else if (eventIds.has(classification.eventId)) {
        issue(errors, 'DUPLICATE_EVENT_ID', `${classPath}.eventId`, 'eventId duplicado dentro del documento.');
      } else eventIds.add(classification.eventId);

      const rows = classification.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        issue(errors, 'MISSING_ROWS', `${classPath}.rows`, 'La clasificación no contiene filas.');
        return;
      }
      rowCount += rows.length;
      if (classification.rowCount !== rows.length) {
        issue(errors, 'ROW_COUNT_MISMATCH', `${classPath}.rowCount`, `rowCount=${classification.rowCount}; rows.length=${rows.length}.`);
      }
      if (!Number.isInteger(classification.expectedRowCount) || classification.expectedRowCount < 1) {
        issue(errors, 'INVALID_EXPECTED_ROW_COUNT', `${classPath}.expectedRowCount`, 'expectedRowCount debe ser un entero positivo tomado de la fuente.');
      } else if (classification.expectedRowCount !== rows.length) {
        issue(errors, 'EXPECTED_ROW_COUNT_MISMATCH', `${classPath}.expectedRowCount`, `La fuente declara ${classification.expectedRowCount} filas y el documento contiene ${rows.length}.`);
      }

      const seenBibs = new Set();
      let irmStarted = false;
      let lastRank = 0;
      let lastGap = -1;
      let lastPoints = Number.POSITIVE_INFINITY;
      let matchedBibs = 0;
      let comparableBibs = 0;
      let currentTttTeam = null;

      rows.forEach((row, rowIndex) => {
        const rowPath = `${classPath}.rows[${rowIndex}]`;
        const irm = row.irm == null ? null : clean(row.irm).toUpperCase();
        const bib = row.bib == null ? null : clean(row.bib);
        const display = clean(classification.isTeamEvent ? row.teamName : row.riderDisplay);
        if (classification.isTeamEvent && !display) {
          issue(errors, 'MISSING_RESULT_NAME', classification.isTeamEvent ? `${rowPath}.teamName` : `${rowPath}.riderDisplay`, 'Falta el nombre visible de la fila.');
        }
        if (!classification.isTeamEvent && !bib && !allowBibless) {
          issue(errors, 'MISSING_BIB', `${rowPath}.bib`, 'Las clasificaciones individuales requieren dorsal para resolver al corredor contra la startlist.');
        } else if (bib && !/^[1-9]\d*$/.test(bib)) {
          issue(errors, 'INVALID_BIB', `${rowPath}.bib`, 'El dorsal debe ser un entero positivo.');
        } else if (bib) {
          if (seenBibs.has(bib)) issue(errors, 'DUPLICATE_BIB', `${rowPath}.bib`, `Dorsal duplicado: ${bib}.`);
          seenBibs.add(bib);
          if (startlistBibs instanceof Set && startlistBibs.size > 0) {
            comparableBibs += 1;
            if (startlistBibs.has(bib)) matchedBibs += 1;
          }
        } else if (startlistBibs instanceof Set && startlistBibs.size > 0 && !classification.isTeamEvent) {
          comparableBibs += 1;
        }
        if (row.isoCode2 != null && !/^[a-z]{2}$/.test(clean(row.isoCode2))) {
          issue(errors, 'INVALID_COUNTRY', `${rowPath}.isoCode2`, 'isoCode2 debe ser ISO-2 en minúscula.');
        }

        if (irm) {
          irmStarted = true;
          if (!IRM_CODES.has(irm)) issue(errors, 'INVALID_IRM', `${rowPath}.irm`, `Código IRM no admitido: ${irm}.`);
          if (row.rank != null || clean(row.rankText) !== irm || row.timeText != null || row.gapText != null || row.resultValue != null) {
            issue(errors, 'INVALID_IRM_ROW', rowPath, 'Una fila IRM debe ir sin rank, tiempo ni gap y con rankText=irm.');
          }
          return;
        }
        if (irmStarted) issue(errors, 'CLASSIFIED_AFTER_IRM', rowPath, 'No puede haber clasificados después de una fila IRM.');

        if (stage.raceType === 'TTT' && !classification.isTeamEvent && row.rank == null) {
          if (row.timeText != null || row.gapText != null || row.resultValue != null) issue(errors, 'INVALID_TTT_COMPANION', rowPath, 'Los compañeros de CRE deben ir sin rank, tiempo, gap ni resultValue.');
          const teamName = clean(row.teamName);
          if (!currentTttTeam || !teamName || teamName !== currentTttTeam) {
            issue(errors, 'INVALID_TTT_TEAM_SEQUENCE', `${rowPath}.teamName`, 'Un compañero de CRE debe seguir al líder de su mismo equipo.');
          }
          return;
        }

        if (!Number.isInteger(row.rank) || row.rank <= 0 || clean(row.rankText) !== String(row.rank)) {
          issue(errors, 'INVALID_RANK', rowPath, 'rank debe ser entero positivo y coincidir con rankText.');
        } else {
          if (row.rank <= lastRank) issue(errors, 'NON_MONOTONIC_RANK', `${rowPath}.rank`, 'Los puestos deben conservar el orden ascendente del documento.');
          lastRank = row.rank;
        }
        if (stage.raceType === 'TTT' && !classification.isTeamEvent) {
          currentTttTeam = clean(row.teamName);
          if (!currentTttTeam) issue(errors, 'MISSING_TTT_TEAM', `${rowPath}.teamName`, 'El líder de cada equipo en una CRE debe identificar teamName.');
        }

        if (POINT_KINDS.has(classification.classKind)) {
          if (!Number.isFinite(row.points) || String(row.points) !== clean(row.resultValue) || clean(row.timeText) !== clean(row.resultValue) || row.gapText != null) {
            issue(errors, 'INVALID_POINTS_ROW', rowPath, 'points, resultValue y timeText deben contener el mismo valor.');
          }
          if (Number.isFinite(row.points) && row.points > lastPoints) issue(errors, 'NON_MONOTONIC_POINTS', `${rowPath}.points`, 'Los puntos deben ir en orden no creciente.');
          if (Number.isFinite(row.points)) lastPoints = row.points;
          return;
        }

        if (TIME_KINDS.has(classification.classKind)) {
          if (row.rank === 1) {
            if (!normalizeAbsoluteTime(row.timeText) || row.gapText != null || clean(row.resultValue) !== clean(row.timeText)) issue(errors, 'INVALID_WINNER_TIME', rowPath, 'El ganador debe llevar tiempo absoluto, el mismo resultValue y gap null.');
          } else {
            if (row.timeText != null) issue(errors, 'NON_WINNER_ABSOLUTE_TIME', `${rowPath}.timeText`, 'Solo el ganador puede llevar tiempo absoluto.');
            if (!isGapFormat(row.gapText)) issue(errors, 'INVALID_GAP', `${rowPath}.gapText`, 'gapText debe usar +SS, +M:SS o +H:MM:SS.');
            if (clean(row.resultValue) !== clean(row.gapText)) issue(errors, 'RESULT_VALUE_GAP_MISMATCH', `${rowPath}.resultValue`, 'resultValue debe coincidir con gapText.');
            const gap = gapToSeconds(row.gapText);
            if (gap != null && gap < lastGap) {
              issue(
                allowNonMonotonicGaps ? warnings : errors,
                allowNonMonotonicGaps ? 'NON_MONOTONIC_GAP_ASSIGNED_TIME' : 'NON_MONOTONIC_GAP',
                `${rowPath}.gapText`,
                allowNonMonotonicGaps
                  ? 'Gap no monótono conservado tras verificar en la fuente un tiempo asignado reglamentariamente.'
                  : 'Los gaps deben ser monótonos.',
              );
            }
            if (gap != null) lastGap = gap;
          }
        }
      });

      const winner = rows.find((row) => row.rank === 1);
      if (!winner) issue(errors, 'MISSING_WINNER', classPath, 'La clasificación no contiene ganador.');
      const winnerDisplay = winner && clean(classification.isTeamEvent ? winner.teamName : winner.riderDisplay);
      if (winnerDisplay && clean(classification.winnerName) !== winnerDisplay) {
        issue(errors, 'WINNER_NAME_MISMATCH', `${classPath}.winnerName`, 'winnerName no coincide con la fila rank=1.');
      }
      if (comparableBibs > 0) {
        const rate = matchedBibs / comparableBibs;
        if (rate < minimumBibMatchRate) {
          issue(errors, 'LOW_STARTLIST_MATCH', classPath, `Coincidencia de dorsales ${(rate * 100).toFixed(1)}%; mínimo ${(minimumBibMatchRate * 100).toFixed(1)}%.`);
        }
      }
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { stages: document.stages.length, classifications: classificationCount, rows: rowCount },
  };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function main() {
  const input = arg('in');
  const expectedRaceId = arg('race-id');
  if (!input || !expectedRaceId) {
    process.stderr.write('Uso: node results-preflight.mjs --in <json> --race-id <id> [--startlist <json>] [--empty-means-ditto] [--allow-nonmonotonic-gaps] [--allow-bibless] [--normalized-out <json>]\n');
    process.exitCode = 2;
    return;
  }
  const source = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const normalized = normalizeResultsDocument(source, { emptyMeansDitto: hasFlag('empty-means-ditto') });
  const startlistPath = arg('startlist');
  const startlist = startlistPath ? JSON.parse(readFileSync(resolve(startlistPath), 'utf8')) : null;
  const startlistBibs = startlist ? readStartlistBibs(startlist) : null;
  const report = validateResultsDocument(normalized, {
    startlistBibs,
    startlistRaceId: startlist?.raceId ?? null,
    expectedRaceId,
    allowNonMonotonicGaps: hasFlag('allow-nonmonotonic-gaps'),
    allowBibless: hasFlag('allow-bibless'),
  });
  const normalizedOut = arg('normalized-out');
  if (normalizedOut && report.ok) writeFileSync(resolve(normalizedOut), `${JSON.stringify(normalized, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, normalizedWritten: !!normalizedOut && report.ok }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) main();
