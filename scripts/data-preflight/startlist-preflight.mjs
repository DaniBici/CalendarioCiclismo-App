#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOLUTION_ACTIONS = new Set(['exact', 'candidate', 'unresolved', 'create']);
const EXTRACTION_RIDER_FIELDS = [
  'firstName', 'lastName', 'countryCode', 'globalRiderId',
  'candidateCount', 'resolutionAction', 'created',
];
const EXTRACTION_TEAM_FIELDS = ['teamId', 'sortOrder', 'isDev', 'isConfirmed'];

function clean(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function fold(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .toLocaleLowerCase('es');
}

function normalizeBib(value) {
  const text = clean(value);
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

function titleSegment(segment) {
  if (!segment) return segment;
  if (/[a-záéíóúüñøłßæœ]/u.test(segment) && /[A-ZÁÉÍÓÚÜÑØŁẞÆŒ]/u.test(segment)) return segment;
  const chars = [...segment.toLocaleLowerCase('es')];
  if (!chars.length) return segment;
  return chars[0].toLocaleUpperCase('es') + chars.slice(1).join('');
}

export function normalizePersonName(value) {
  return clean(value)
    .split(' ')
    .map((token) => token.split(/([-'])/).map((part) => part === '-' || part === "'" ? part : titleSegment(part)).join(''))
    .join(' ');
}

/**
 * Contrato de revisión manual. No convierte el orden ni el casing del nombre:
 * en esta fase el documento es una transcripción de la fuente, no una decisión
 * de identidad. El resultado contiene exclusivamente los campos importables
 * por el editor de inscritos.
 */
export function normalizeStartlistExtraction(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  return {
    ...(document.raceId != null ? { raceId: clean(document.raceId) } : {}),
    ...(document.expectedRiderCount != null ? { expectedRiderCount: Number(document.expectedRiderCount) } : {}),
    teams: Array.isArray(document.teams) ? document.teams.map((team) => {
      const sourceTeam = record(team);
      return {
        teamName: clean(sourceTeam.teamName ?? sourceTeam.name),
        riders: Array.isArray(sourceTeam.riders) ? sourceTeam.riders.map((rider) => {
          const sourceRider = record(rider);
          return {
            dorsal: normalizeBib(sourceRider.dorsal),
            riderName: clean(sourceRider.riderName ?? sourceRider.name),
          };
        }) : sourceTeam.riders,
      };
    }) : document.teams,
  };
}

export function normalizeStartlistDraft(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  return {
    ...document,
    ...(document.raceId != null ? { raceId: clean(document.raceId) } : {}),
    ...(document.expectedRiderCount != null ? { expectedRiderCount: Number(document.expectedRiderCount) } : {}),
    teams: Array.isArray(document.teams) ? document.teams.map((team, teamIndex) => ({
      ...team,
      name: clean(team.name ?? team.teamName),
      ...(team.teamName != null ? { teamName: clean(team.teamName) } : {}),
      sortOrder: team.sortOrder == null || clean(team.sortOrder) === '' ? teamIndex : Number(team.sortOrder),
      riders: Array.isArray(team.riders) ? team.riders.map((rider) => ({
        ...rider,
        dorsal: normalizeBib(rider.dorsal),
        firstName: normalizePersonName(rider.firstName),
        lastName: normalizePersonName(rider.lastName),
        ...(rider.countryCode != null ? { countryCode: clean(rider.countryCode).toLocaleLowerCase('en') } : {}),
        ...(rider.resolutionAction != null ? { resolutionAction: clean(rider.resolutionAction).toLocaleLowerCase('en') } : {}),
        ...(rider.candidateCount != null ? { candidateCount: Number(rider.candidateCount) } : {}),
        ...(rider.globalRiderId != null ? { globalRiderId: clean(rider.globalRiderId) || null } : {}),
      })) : team.riders,
    })) : document.teams,
  };
}

function issue(list, code, path, message) {
  list.push({ code, path, message });
}

function extractionHasField(value, field) {
  return value && typeof value === 'object' && Object.hasOwn(value, field);
}

export function validateStartlistExtraction(document) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeStartlistExtraction(document);

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    issue(errors, 'INVALID_DOCUMENT', '$', 'La entrada debe ser un objeto JSON.');
    return { ok: false, errors, warnings, summary: { teams: 0, riders: 0, phase: 'extract' }, normalized };
  }
  if (!Array.isArray(normalized.teams) || normalized.teams.length === 0) {
    issue(errors, 'MISSING_TEAMS', '$.teams', 'La extracción debe contener al menos un equipo.');
    return { ok: false, errors, warnings, summary: { teams: 0, riders: 0, phase: 'extract' }, normalized };
  }
  if (!clean(normalized.raceId)) {
    issue(errors, 'MISSING_RACE_ID', '$.raceId', 'Falta el identificador de la carrera.');
  }

  const seenTeams = new Map();
  const seenBibs = new Map();
  let riderCount = 0;

  normalized.teams.forEach((team, teamIndex) => {
    const teamPath = `$.teams[${teamIndex}]`;
    const sourceTeam = document.teams?.[teamIndex];
    const name = clean(team.teamName);
    if (!name) issue(errors, 'MISSING_TEAM_NAME', `${teamPath}.teamName`, 'Falta el nombre del equipo.');
    const teamKey = fold(name);
    if (teamKey && seenTeams.has(teamKey)) {
      issue(errors, 'DUPLICATE_TEAM', `${teamPath}.teamName`, `Equipo duplicado; primera aparición en ${seenTeams.get(teamKey)}.`);
    } else if (teamKey) {
      seenTeams.set(teamKey, `${teamPath}.teamName`);
    }
    for (const field of EXTRACTION_TEAM_FIELDS) {
      if (extractionHasField(sourceTeam, field)) {
        issue(errors, 'EXTRACTION_CONTAINS_ENRICHMENT', `${teamPath}.${field}`, `La extracción no admite ${field}; las reasignaciones se hacen en el editor.`);
      }
    }
    if (!Array.isArray(team.riders) || team.riders.length === 0) {
      issue(errors, 'MISSING_RIDERS', `${teamPath}.riders`, 'El equipo no contiene corredores.');
      return;
    }
    team.riders.forEach((rider, riderIndex) => {
      riderCount += 1;
      const riderPath = `${teamPath}.riders[${riderIndex}]`;
      const sourceRider = sourceTeam?.riders?.[riderIndex];
      const bib = clean(rider.dorsal);
      if (!/^\d+$/.test(bib) || bib === '0') {
        issue(errors, 'INVALID_BIB', `${riderPath}.dorsal`, 'El dorsal debe ser un entero positivo.');
      } else if (seenBibs.has(bib)) {
        issue(errors, 'DUPLICATE_BIB', `${riderPath}.dorsal`, `Dorsal duplicado; primera aparición en ${seenBibs.get(bib)}.`);
      } else {
        seenBibs.set(bib, `${riderPath}.dorsal`);
      }
      if (!clean(rider.riderName)) {
        issue(errors, 'MISSING_RIDER_NAME', `${riderPath}.riderName`, 'Falta el nombre completo del corredor.');
      }
      for (const field of EXTRACTION_RIDER_FIELDS) {
        if (extractionHasField(sourceRider, field)) {
          issue(errors, 'EXTRACTION_CONTAINS_ENRICHMENT', `${riderPath}.${field}`, `La extracción no admite ${field}; no se resuelve identidad en esta fase.`);
        }
      }
    });
  });

  const expected = Number(normalized.expectedRiderCount);
  if (!Number.isInteger(expected) || expected < 1) {
    issue(errors, 'INVALID_EXPECTED_RIDER_COUNT', '$.expectedRiderCount', 'expectedRiderCount debe ser un entero positivo tomado de la fuente.');
  } else if (expected !== riderCount) {
    issue(errors, 'RIDER_COUNT_MISMATCH', '$.expectedRiderCount', `El documento declara ${expected} corredores y contiene ${riderCount}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { teams: normalized.teams.length, riders: riderCount, phase: 'extract' },
    normalized,
  };
}

export function validateStartlistDraft(document, {
  phase = 'draft',
  allowCreateRiders = false,
  allowUnresolvedRiders = phase !== 'apply',
} = {}) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeStartlistDraft(document);

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    issue(errors, 'INVALID_DOCUMENT', '$', 'La entrada debe ser un objeto JSON.');
    return { ok: false, errors, warnings, summary: { teams: 0, riders: 0 }, normalized };
  }
  if (!Array.isArray(normalized.teams) || normalized.teams.length === 0) {
    issue(errors, 'MISSING_TEAMS', '$.teams', 'La startlist debe contener al menos un equipo.');
    return { ok: false, errors, warnings, summary: { teams: 0, riders: 0 }, normalized };
  }
  if (!clean(normalized.raceId)) {
    issue(errors, 'MISSING_RACE_ID', '$.raceId', 'Falta el identificador de la carrera.');
  }

  const seenTeams = new Map();
  const seenTeamOrders = new Map();
  const seenBibs = new Map();
  const seenGlobalRiderIds = new Map();
  let riderCount = 0;
  let unresolvedCount = 0;
  let createCount = 0;

  normalized.teams.forEach((team, teamIndex) => {
    const teamPath = `$.teams[${teamIndex}]`;
    const name = clean(team.name ?? team.teamName);
    if (!name) issue(errors, 'MISSING_TEAM_NAME', `${teamPath}.name`, 'Falta el nombre del equipo.');
    const teamKey = fold(name);
    if (teamKey && seenTeams.has(teamKey)) {
      issue(errors, 'DUPLICATE_TEAM', `${teamPath}.name`, `Equipo duplicado; primera aparición en ${seenTeams.get(teamKey)}.`);
    } else if (teamKey) {
      seenTeams.set(teamKey, `${teamPath}.name`);
    }
    if ('isDev' in team) issue(errors, 'RETIRED_ISDEV', `${teamPath}.isDev`, 'La columna isDev está retirada y debe omitirse.');
    if (!Number.isInteger(team.sortOrder) || team.sortOrder < 0) {
      issue(errors, 'INVALID_TEAM_ORDER', `${teamPath}.sortOrder`, 'sortOrder debe ser un entero no negativo.');
    } else if (seenTeamOrders.has(team.sortOrder)) {
      issue(errors, 'DUPLICATE_TEAM_ORDER', `${teamPath}.sortOrder`, `sortOrder duplicado; primera aparición en ${seenTeamOrders.get(team.sortOrder)}.`);
    } else {
      seenTeamOrders.set(team.sortOrder, `${teamPath}.sortOrder`);
    }
    if (!Array.isArray(team.riders) || team.riders.length === 0) {
      issue(errors, 'MISSING_RIDERS', `${teamPath}.riders`, 'El equipo no contiene corredores.');
      return;
    }

    team.riders.forEach((rider, riderIndex) => {
      riderCount += 1;
      const riderPath = `${teamPath}.riders[${riderIndex}]`;
      const bib = clean(rider.dorsal);
      if (!/^\d+$/.test(bib) || bib === '0') {
        issue(errors, 'INVALID_BIB', `${riderPath}.dorsal`, 'El dorsal debe ser un entero positivo.');
      } else if (seenBibs.has(bib)) {
        issue(errors, 'DUPLICATE_BIB', `${riderPath}.dorsal`, `Dorsal duplicado; primera aparición en ${seenBibs.get(bib)}.`);
      } else {
        seenBibs.set(bib, `${riderPath}.dorsal`);
      }

      for (const field of ['firstName', 'lastName']) {
        const value = clean(rider[field]);
        if (!value) issue(errors, 'MISSING_RIDER_NAME', `${riderPath}.${field}`, `Falta ${field}.`);
      }

      const country = clean(rider.countryCode);
      if (!country) {
        const target = phase === 'apply' ? errors : warnings;
        issue(target, 'MISSING_COUNTRY', `${riderPath}.countryCode`, 'Falta el país ISO-2 del corredor.');
      } else if (!/^[a-z]{2}$/.test(country)) {
        issue(errors, 'INVALID_COUNTRY', `${riderPath}.countryCode`, 'countryCode debe ser ISO-2 en minúscula.');
      }

      const action = clean(rider.resolutionAction).toLocaleLowerCase('en') || (rider.globalRiderId ? 'exact' : 'unresolved');
      if (!clean(rider.resolutionAction)) {
        const target = phase === 'apply' ? errors : warnings;
        issue(target, 'MISSING_RESOLUTION_ACTION', `${riderPath}.resolutionAction`, 'Debe declararse la decisión de identidad: exact, candidate, unresolved o create.');
      }
      if (!RESOLUTION_ACTIONS.has(action)) {
        issue(errors, 'INVALID_RESOLUTION_ACTION', `${riderPath}.resolutionAction`, `Acción no admitida: ${action}.`);
      }
      const candidateCount = Number(rider.candidateCount);
      if (!Number.isInteger(candidateCount) || candidateCount < 0) {
        issue(errors, 'INVALID_CANDIDATE_COUNT', `${riderPath}.candidateCount`, 'candidateCount debe ser un entero no negativo.');
      }
      if (action === 'candidate' && candidateCount < 1) {
        issue(errors, 'CANDIDATE_WITHOUT_CANDIDATES', `${riderPath}.candidateCount`, 'La acción candidate exige al menos un candidato revisado.');
      }
      if (action === 'create' || rider.created === true) {
        createCount += 1;
        if (!allowCreateRiders) {
          issue(errors, 'UNAUTHORIZED_RIDER_CREATION', rider.created === true ? `${riderPath}.created` : `${riderPath}.resolutionAction`, 'La creación de fichas requiere autorización externa explícita.');
        }
        if (candidateCount > 0) {
          issue(errors, 'CREATE_WITH_CANDIDATES', `${riderPath}.candidateCount`, 'No se puede crear una ficha mientras existan candidatos razonables.');
        }
      }
      if (action === 'unresolved') {
        unresolvedCount += 1;
        const target = allowUnresolvedRiders ? warnings : errors;
        issue(target, 'UNRESOLVED_RIDER', `${riderPath}.resolutionAction`, 'El corredor sigue sin resolución de identidad.');
      }
      if (action === 'unresolved' && clean(rider.globalRiderId)) {
        issue(errors, 'UNRESOLVED_WITH_GLOBAL_RIDER_ID', `${riderPath}.globalRiderId`, 'Una identidad unresolved no puede traer globalRiderId.');
      }
      if ((action === 'exact' || action === 'candidate') && !clean(rider.globalRiderId)) {
        issue(errors, 'MISSING_GLOBAL_RIDER_ID', `${riderPath}.globalRiderId`, 'La resolución declarada exige globalRiderId.');
      }
      if (action === 'create' && clean(rider.globalRiderId)) {
        issue(errors, 'CREATE_WITH_GLOBAL_RIDER_ID', `${riderPath}.globalRiderId`, 'Una ficha marcada para creación no puede traer globalRiderId existente.');
      }
      const globalRiderId = clean(rider.globalRiderId);
      if (globalRiderId) {
        if (seenGlobalRiderIds.has(globalRiderId)) {
          issue(errors, 'DUPLICATE_GLOBAL_RIDER_ID', `${riderPath}.globalRiderId`, `Ficha global duplicada; primera aparición en ${seenGlobalRiderIds.get(globalRiderId)}.`);
        } else {
          seenGlobalRiderIds.set(globalRiderId, `${riderPath}.globalRiderId`);
        }
      }
    });
  });

  const expected = Number(normalized.expectedRiderCount);
  if (!Number.isInteger(expected) || expected < 1) {
    issue(errors, 'INVALID_EXPECTED_RIDER_COUNT', '$.expectedRiderCount', 'expectedRiderCount debe ser un entero positivo tomado de la fuente.');
  } else if (expected !== riderCount) {
    issue(errors, 'RIDER_COUNT_MISMATCH', '$.expectedRiderCount', `El documento declara ${expected} corredores y contiene ${riderCount}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      teams: normalized.teams.length,
      riders: riderCount,
      unresolvedRiders: unresolvedCount,
      requestedCreations: createCount,
      phase,
      allowCreateRiders,
    },
    normalized,
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
  if (!input) {
    process.stderr.write('Uso: node startlist-preflight.mjs --in <json> [--phase extract|draft|apply] [--allow-create-riders] [--normalized-out <json>]\n');
    process.exitCode = 2;
    return;
  }
  const phase = arg('phase') || 'draft';
  if (!['extract', 'draft', 'apply'].includes(phase)) {
    process.stderr.write('--phase debe ser extract, draft o apply\n');
    process.exitCode = 2;
    return;
  }
  const document = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const report = phase === 'extract'
    ? validateStartlistExtraction(document)
    : validateStartlistDraft(document, {
        phase,
        allowCreateRiders: hasFlag('allow-create-riders'),
        allowUnresolvedRiders: phase !== 'apply',
      });
  const normalizedOut = arg('normalized-out');
  if (normalizedOut && report.ok) writeFileSync(resolve(normalizedOut), `${JSON.stringify(report.normalized, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, normalized: undefined, normalizedWritten: !!normalizedOut && report.ok }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) main();
