#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const inputPath = resolve(arg('input', 'output/estudio-dataride-2020-2025-corregido-20260907-final/registro-operativo-carreras.json'));
const outputDir = resolve(arg('out', `${dirname(inputPath)}/aplicacion-carreras-20260907`));
const chunkSize = Number(arg('chunk-size', '150'));
const seasons = new Map([[2020, 145], [2021, 150], [2022, 159], [2023, 414], [2024, 432], [2025, 444]]);

if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500) {
  throw new Error('--chunk-size debe ser un entero entre 1 y 500');
}

const source = JSON.parse(readFileSync(inputPath, 'utf8'));
const sourceHash = createHash('sha256').update(readFileSync(inputPath)).digest('hex');
const allowedStates = new Set(['ready', 'needs_logo']);
const forbiddenTokens = ['HIST-LICENSE-9208'];
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const deterministicUuid = (value) => {
  const hex = hash(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
};
const orderedDayUuid = (value, sectorIndex) => {
  const base = deterministicUuid(value);
  const prefix = Math.max(0, Number(sectorIndex) || 0).toString(16).padStart(8, '0');
  return `${prefix}${base.slice(8)}`;
};
const slugify = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’']/g, '').replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 150) || 'carrera';
const withoutTerminalYear = (value) => clean(value).replace(/-20\d{2}$/, '');
const suffixForDay = (day, english = false) => {
  if (day.stageNumber == null) return '';
  if (day.stageNumber === 0) return english ? 'prologue' : 'prologo';
  const sector = day.sectorIndex == null ? '' : String.fromCharCode(97 + Number(day.sectorIndex));
  return `${english ? 'stage' : 'etapa'}-${day.stageNumber}${sector}`;
};
// La dimensión de la prueba interna prevalece sobre el nombre paraguas de la
// competición: un CN «Junior/U23» puede contener pruebas U23 que sí entran.
const isJuniorRecord = (record) => record.inferred?.age === 'junior'
  || record.expected?.age === 'junior';
const normalizeSectors = (days) => {
  const groups = new Map();
  for (const day of days) {
    const key = `${day.dateKey}|${day.stageNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  }
  return days.map((day) => {
    if (day.sectorIndex != null) return day;
    const peers = groups.get(`${day.dateKey}|${day.stageNumber}`);
    if (day.stageNumber == null || peers.length === 1) return day;
    const explicit = /stage\s+\d+[.](\d+)\b/i.exec(clean(day.stageName));
    if (explicit) return { ...day, sectorIndex: Number(explicit[1]) - 1, sectorResolution: 'stage-name-decimal' };
    const ordered = [...peers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    return { ...day, sectorIndex: ordered.indexOf(day), sectorResolution: 'source-order-same-day' };
  });
};

if (!Array.isArray(source.records) || source.records.length !== source.summary?.total) {
  throw new Error('El registro operativo no tiene la cardinalidad declarada');
}
const serialized = JSON.stringify(source);
for (const token of forbiddenTokens) {
  if (serialized.includes(token)) throw new Error(`El registro contiene el identificador excluido ${token}`);
}

const juniorExcluded = source.records.filter((record) => allowedStates.has(record.state) && isJuniorRecord(record));
const candidates = source.records.filter((record) => allowedStates.has(record.state) && !isJuniorRecord(record));
const pending = source.records.filter((record) => record.state === 'pending');
if (candidates.length + juniorExcluded.length !== source.summary.ready + source.summary.needs_logo || pending.length !== source.summary.pending) {
  throw new Error('La partición ready/needs_logo/pending no coincide con el resumen');
}

const provisional = candidates.map((record) => {
  const key = `${record.competitionId}|${record.uciRaceId}`;
  const newSeries = record.sourceKind === 'new_series';
  const age = record.inferred?.age || record.expected?.age || null;
  const disciplineType = record.inferred?.type || null;
  const rawName = newSeries ? clean(record.officialRaceName || record.competitionName) : clean(record.templateName);
  const rawNameEn = newSeries ? rawName : clean(record.templateNameEn || record.templateName);
  const baseSlug = newSeries ? slugify(rawName) : withoutTerminalYear(record.templateSlug);
  const baseSlugEn = newSeries ? slugify(rawNameEn) : withoutTerminalYear(record.templateSlugEn || record.templateSlug);
  return {
    sourceKind: record.sourceKind,
    sourceState: record.state,
    sourceReason: record.reason,
    sourceKey: key,
    raceId: deterministicUuid(`historical-race|${key}`),
    seriesId: newSeries ? deterministicUuid(`historical-series|${record.identityKey}|${record.inferred?.gender}|${age}|${disciplineType}`) : null,
    identityKey: record.identityKey || null,
    templateRaceId: record.templateRaceId || null,
    year: record.year,
    seasonId: seasons.get(Number(record.year)),
    competitionId: Number(record.competitionId),
    uciRaceId: Number(record.uciRaceId || 0),
    name: rawName,
    nameEn: rawNameEn,
    originalName: clean(record.officialRaceName || record.competitionName || rawName),
    baseSlug,
    baseSlugEn,
    countryCode: clean(record.countryCode).toUpperCase() || null,
    uciCategory: clean(record.uciCategory) || null,
    gender: record.inferred?.gender || record.expected?.gender || null,
    age,
    disciplineType,
    startDate: record.startDate,
    endDate: record.endDate,
    raceFormat: record.days.length === 1 && record.days[0].stageNumber == null ? 'one_day' : 'stage_race',
    days: normalizeSectors(record.days),
  };
});

const duplicateSlugKeys = new Set();
for (const field of ['baseSlug', 'baseSlugEn']) {
  const counts = new Map();
  for (const record of provisional) {
    const key = `${record[field]}-${record.year}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) if (count > 1) duplicateSlugKeys.add(`${field}|${key}`);
}

const prepared = provisional.map((record) => {
  const disambiguator = hash(record.sourceKey).slice(0, 8);
  const raceSlug = `${record.baseSlug}${duplicateSlugKeys.has(`baseSlug|${record.baseSlug}-${record.year}`) ? `-${disambiguator}` : ''}-${record.year}`;
  const raceSlugEn = `${record.baseSlugEn}${duplicateSlugKeys.has(`baseSlugEn|${record.baseSlugEn}-${record.year}`) ? `-${disambiguator}` : ''}-${record.year}`;
  const days = record.days.map((day, index) => {
    const esSuffix = suffixForDay(day, false);
    const enSuffix = suffixForDay(day, true);
    return {
      id: orderedDayUuid(`historical-race-day|${record.sourceKey}|${day.uciRaceId}|${day.stageNumber}|${day.sectorIndex}`, day.sectorIndex),
      uciRaceId: Number(day.uciRaceId),
      dateKey: day.dateKey,
      stageNumber: day.stageNumber,
      sectorIndex: day.sectorIndex,
      slug: esSuffix ? `${raceSlug}-${esSuffix}` : raceSlug,
      slugEn: enSuffix ? `${raceSlugEn}-${enSuffix}` : raceSlugEn,
      startLocation: clean(day.startLocation) || null,
      finishLocation: clean(day.finishLocation) || null,
      primaryType: day.primaryType || null,
      sourceIndex: day.sourceIndex ?? index,
    };
  });
  return { ...record, raceSlug, raceSlugEn, days };
});
const obsoleteSeriesIds = [...new Set(prepared
  .filter((record) => record.sourceKind === 'new_series')
  .map((record) => deterministicUuid(`historical-series|${record.identityKey}`)))].sort();

const unique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} duplicado: ${value}`);
    seen.add(value);
  }
};
unique(prepared.map((record) => record.sourceKey), 'enlace');
unique(prepared.map((record) => record.raceId), 'raceId');
unique(prepared.map((record) => record.raceSlug), 'slug');
unique(prepared.map((record) => record.raceSlugEn), 'slugEn');
unique(prepared.flatMap((record) => record.days.map((day) => day.id)), 'raceDayId');
unique(prepared.flatMap((record) => record.days.map((day) => day.slugEn)), 'raceDaySlugEn');

for (const record of prepared) {
  if (!record.seasonId || !record.year || !record.name || !record.nameEn || !record.gender || !record.uciCategory || !record.days.length) {
    throw new Error(`Registro incompleto tras preparación: ${record.sourceKey}`);
  }
  if (record.days.some((day) => !day.uciRaceId || !day.dateKey)) {
    throw new Error(`Jornada incompleta tras preparación: ${record.sourceKey}`);
  }
}

mkdirSync(outputDir, { recursive: true });
for (const file of readdirSync(outputDir)) {
  if (/^lote-20(?:2[0-5])-\d+[.]json$/.test(file)) unlinkSync(resolve(outputDir, file));
}
const chunks = [];
for (const year of [...seasons.keys()]) {
  const rows = prepared.filter((record) => Number(record.year) === year);
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const part = Math.floor(offset / chunkSize) + 1;
    const file = `lote-${year}-${String(part).padStart(2, '0')}.json`;
    const payload = rows.slice(offset, offset + chunkSize);
    writeFileSync(resolve(outputDir, file), `${JSON.stringify(payload)}\n`);
    chunks.push({ file, year, records: payload.length, days: payload.reduce((sum, row) => sum + row.days.length, 0) });
  }
}

const pendingManifest = pending.map((record) => ({
  year: record.year,
  competitionId: record.competitionId,
  uciRaceId: record.uciRaceId,
  competitionName: record.competitionName,
  sourceKind: record.sourceKind,
  templateRaceId: record.templateRaceId || null,
  reason: record.reason,
  evidence: record.evidence,
  days: record.days,
}));
writeFileSync(resolve(outputDir, 'pendientes-no-aplicar.json'), `${JSON.stringify(pendingManifest, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'junior-no-aplicar.json'), `${JSON.stringify(juniorExcluded, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'series-obsoletas-generadas-por-reintento.json'), `${JSON.stringify(obsoleteSeriesIds, null, 2)}\n`);

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: basename(inputPath),
  sourceHash,
  scope: '2020-2025',
  operation: 'historical-results-only-race-creation',
  logoPolicy: {
    sourceMarkedRecords: source.summary.needs_logo,
    persistedNullRecords: prepared.filter((record) => record.sourceState === 'needs_logo').length,
    excludedJuniorRecords: juniorExcluded.length,
    action: 'persist-null',
    field: 'races.logoUrl',
    reason: 'El campo admite NULL; no existe recurso oficial verificado y no se genera ni copia un identificador gráfico.',
  },
  pendingPolicy: {
    affectedRecords: pending.length,
    action: 'exclude',
    file: 'pendientes-no-aplicar.json',
  },
  juniorPolicy: {
    affectedRecords: juniorExcluded.length,
    affectedDays: juniorExcluded.reduce((sum, record) => sum + record.days.length, 0),
    action: 'exclude',
    rule: 'Las pruebas MJ y WJ no entran en calendario.',
    file: 'junior-no-aplicar.json',
  },
  exclusions: forbiddenTokens,
  cleanup: {
    candidateSeriesIds: obsoleteSeriesIds.length,
    action: 'delete-only-if-unreferenced',
    file: 'series-obsoletas-generadas-por-reintento.json',
  },
  totals: {
    records: prepared.length,
    ready: prepared.filter((record) => record.sourceState === 'ready').length,
    needsLogo: prepared.filter((record) => record.sourceState === 'needs_logo').length,
    pending: pending.length,
    excludedJunior: juniorExcluded.length,
    excludedJuniorDays: juniorExcluded.reduce((sum, record) => sum + record.days.length, 0),
    days: prepared.reduce((sum, record) => sum + record.days.length, 0),
    newSeries: new Set(prepared.filter((record) => record.sourceKind === 'new_series').map((record) => record.seriesId)).size,
    chunks: chunks.length,
  },
  chunks,
};
writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputDir, ...manifest.totals, sourceHash })}\n`);
