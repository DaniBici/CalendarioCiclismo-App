#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const studyDir = resolve(arg('study', 'output/estudio-dataride-2020-2025-corregido-20260907-final'));
const outputPath = resolve(arg('out', `${studyDir}/registro-operativo-carreras.json`));
const matches = JSON.parse(readFileSync(`${studyDir}/coincidencias-2026-ediciones.json`, 'utf8'));
const unmatched = JSON.parse(readFileSync(`${studyDir}/series-no-presentes-en-2026.json`, 'utf8'));
const topology = JSON.parse(readFileSync(`${studyDir}/races-dataride.json`, 'utf8'));
const topologyByCompetition = new Map(topology.map((record) => [Number(record.competitionId), record]));

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const folded = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const dotnetDate = (value) => {
  const match = /\/Date\((-?\d+)\)\//.exec(String(value ?? ''));
  if (!match) return null;
  return new Date(Number(match[1]) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
};
const textDate = (value) => {
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(clean(value));
  return match && months[match[2].toLowerCase()] ? `${match[3]}-${months[match[2].toLowerCase()]}-${match[1].padStart(2, '0')}` : null;
};
const raceDate = (race) => textDate(race.Date) || dotnetDate(race.StartDate) || dotnetDate(race.MandatoryDate);
const isFinal = (name) => /final (classification|result)/i.test(clean(name));
const dimensions = (value) => {
  const text = folded(value);
  const gender = /\b(women|woman|womens|ladies|female|femmes|femme|dames|donna|donne|femenina|feminino|mujeres|we|wu23|wj)\b/.test(text) ? 'female'
    : /\b(men|mens|male|masculino|masculine|hombres|me|mu23|mj)\b/.test(text) ? 'male' : null;
  const age = /\b(junior|juniors|junioren|juniores|mj|wj)\b/.test(text) ? 'junior'
    : /\b(u23|under 23|sub23|espoirs|mu23|wu23)\b/.test(text) ? 'u23'
      : /\belite\b/.test(text) ? 'elite' : null;
  const type = /\b(itt|cri|individual time trial)\b/.test(text) ? 'itt'
    : /\b(ttt|cre|team time trial)\b/.test(text) ? 'ttt'
      : /\b(irr|rr|road race)\b/.test(text) ? 'rr' : null;
  return { gender, age, type };
};
const expectedAge = (race) => /\b(u23|under 23|sub23)\b/i.test(`${race.name} ${race.nameEn}`) || /[12]\.2u/i.test(race.category) ? 'u23' : 'elite';
const inferredDimensions = (races) => {
  const values = races.map((race) => dimensions(`${race.CategoryCode} ${race.RaceName} ${race.RaceTypeCode}`));
  const one = (key) => {
    const unique = [...new Set(values.map((value) => value[key]).filter(Boolean))];
    return unique.length === 1 ? unique[0] : unique.length > 1 ? 'conflict' : null;
  };
  return { gender: one('gender'), age: one('age'), type: one('type') };
};
function stageRows(races, competition) {
  let actual = races.filter((race) => !isFinal(race.RaceName));
  // En las pruebas de un día DataRide denomina con frecuencia la única entrada
  // «Final Result». Es la prueba real, no la pseudoetapa final de una vuelta.
  if (!actual.length && races.length === 1) actual = races;
  if (!actual.length) return { error: 'topología sin jornadas reales', days: [] };
  const parsed = actual.map((race, index) => {
    const name = clean(race.RaceName);
    const stageMatch = /stage\s+(\d+)\s*([a-z])?/i.exec(name);
    const prologue = /prologue/i.test(name);
    const stageNumber = stageMatch ? Number(stageMatch[1]) : prologue ? 0 : actual.length === 1 ? null : null;
    const sectorIndex = stageMatch?.[2] ? stageMatch[2].toUpperCase().charCodeAt(0) - 65 : null;
    const dateKey = raceDate(race);
    const type = dimensions(`${race.RaceTypeCode} ${name}`).type;
    return {
      uciRaceId: Number(race.Id), stageNumber, sectorIndex, stageName: name || null,
      dateKey, raceType: clean(race.RaceTypeCode) || null,
      startLocation: clean(race.StartLocation) || null,
      finishLocation: clean(race.EndLocation) || null,
      primaryType: type === 'itt' ? 'itt' : type === 'ttt' ? 'ttt' : null,
      sourceIndex: index,
    };
  });
  if (parsed.some((day) => !day.dateKey)) return { error: 'jornada sin fecha verificable en Races/', days: parsed };
  if (parsed.length > 1 && parsed.some((day) => day.stageNumber == null)) return { error: 'vuelta con numeración de jornadas ambigua', days: parsed };
  const outside = parsed.some((day) => day.dateKey < competition.startDate || day.dateKey > competition.endDate);
  if (outside) return { error: 'fecha de jornada fuera del intervalo de competición', days: parsed };
  return { error: null, days: parsed };
}

const records = [];
const acceptedReviewEvidence = new Set(['exact', 'curated-alias', 'distinctive-tokens', 'containment-review']);
function addExistingSeriesRecord(ours, decision, competition, nominalYear) {
  const eventYear = Number(String(competition.startDate || '').slice(0, 4)) || nominalYear;
  const topo = topologyByCompetition.get(Number(competition.competitionId));
  const allRaces = topo?.races || [];
  const expected = { gender: ours.gender, age: expectedAge(ours) };
  let selectedRaces = allRaces;
  let uciRaceId = 0;
  if (competition.classCode === 'CN') {
    const internal = competition.internalCandidates || [];
    if (internal.length === 1) {
      uciRaceId = Number(internal[0].raceId);
      selectedRaces = allRaces.filter((race) => Number(race.Id) === uciRaceId);
    } else selectedRaces = [];
  }
  const inferred = inferredDimensions(selectedRaces);
  const conflicts = (inferred.gender && inferred.gender !== 'conflict' && inferred.gender !== expected.gender)
    || (inferred.age && inferred.age !== 'conflict' && inferred.age !== expected.age)
    || inferred.gender === 'conflict' || inferred.age === 'conflict';
  const reviewAccepted = decision.status === 'unique_review' && acceptedReviewEvidence.has(competition.evidence);
  const ambiguousResolvedByDimensions = decision.status === 'ambiguous'
    && competition.verified === true && !conflicts && Boolean(inferred.gender && inferred.age);
  const stagePlan = stageRows(selectedRaces, competition);
  const state = topo?.error ? 'pending' : !selectedRaces.length ? 'pending' : conflicts ? 'pending'
    : stagePlan.error ? 'pending' : (decision.status === 'unique_supported' || reviewAccepted || ambiguousResolvedByDimensions) ? 'ready' : 'pending';
  const reason = topo?.error || (!selectedRaces.length ? 'prueba interna no resuelta' : null)
    || (conflicts ? 'dimensiones internas incompatibles' : null) || stagePlan.error
    || (state === 'pending' ? `evidencia nominal pendiente: ${competition.evidence}` : null);
  records.push({
    sourceKind: 'existing_series', state, reason, year: eventYear, templateRaceId: ours.id,
    templateSlug: ours.slug, templateName: ours.name, templateNameEn: ours.nameEn,
    competitionId: Number(competition.competitionId), uciRaceId,
    competitionName: competition.name, countryCode: competition.country,
    uciCategory: competition.classCode, startDate: competition.startDate, endDate: competition.endDate,
    expected, inferred, evidence: { status: decision.status, method: competition.evidence, verified: competition.verified === true },
    days: stagePlan.days,
  });
}

for (const match of matches) {
  for (const [yearText, decision] of Object.entries(match.editionsByYear)) {
    if (!['unique_supported', 'unique_review', 'ambiguous'].includes(decision.status)) continue;
    for (const competition of decision.candidates) addExistingSeriesRecord(match.our, decision, competition, Number(yearText));
  }
}

const championshipClasses = new Set(['CN', 'CC', 'CM', 'JO']);
for (const group of unmatched) {
  for (const competition of group.competitions) {
    const topo = topologyByCompetition.get(Number(competition.competitionId));
    const allRaces = topo?.races || [];
    const races = allRaces.filter((race) => !isFinal(race.RaceName));
    if (championshipClasses.has(competition.classCode)) {
      for (const race of races) {
        const inferred = dimensions(`${race.CategoryCode} ${race.RaceName} ${race.RaceTypeCode}`);
        if (inferred.age === 'junior') continue;
        const dateKey = raceDate(race);
        const identityKey = `${group.groupKey}|${inferred.gender || 'unknown'}|${inferred.age || 'unknown'}|${inferred.type || 'unknown'}`;
        records.push({
          sourceKind: 'new_series', state: inferred.gender && inferred.age && inferred.type && dateKey ? 'needs_logo' : 'pending',
          reason: inferred.gender && inferred.age && inferred.type && dateKey ? 'logo oficial o identificador gráfico pendiente' : 'dimensiones internas incompletas',
          identityKey, year: Number(String(dateKey || competition.startDate).slice(0, 4)), competitionId: Number(competition.competitionId), uciRaceId: Number(race.Id),
          competitionName: competition.name, officialRaceName: clean(race.RaceName), countryCode: competition.country,
          uciCategory: competition.classCode, startDate: dateKey || competition.startDate, endDate: dateKey || competition.endDate,
          inferred, evidence: { status: group.status, method: 'DataRide competition + internal race' },
          days: dateKey ? [{ uciRaceId: Number(race.Id), stageNumber: null, sectorIndex: null, stageName: clean(race.RaceName), dateKey, raceType: clean(race.RaceTypeCode) || null, startLocation: clean(race.StartLocation) || null, finishLocation: clean(race.EndLocation) || null, primaryType: inferred.type === 'itt' ? 'itt' : inferred.type === 'ttt' ? 'ttt' : null }] : [],
        });
      }
      if (!races.length) records.push({ sourceKind: 'new_series', state: 'pending', reason: topo?.error || 'competición sin pruebas internas', identityKey: group.groupKey, year: Number(String(competition.startDate).slice(0, 4)) || Number(competition.year), competitionId: Number(competition.competitionId), uciRaceId: 0, competitionName: competition.name, countryCode: competition.country, uciCategory: competition.classCode, inferred: {}, evidence: { status: group.status }, days: [] });
    } else {
      const inferred = inferredDimensions(allRaces);
      const stagePlan = stageRows(allRaces, competition);
      const categoryValid = competition.classCode && competition.classCode !== 'N/A';
      const readyDimensions = inferred.gender && inferred.gender !== 'conflict' && inferred.age && inferred.age !== 'conflict';
      records.push({
        sourceKind: 'new_series', state: readyDimensions && categoryValid && !stagePlan.error ? 'needs_logo' : 'pending',
        reason: readyDimensions && categoryValid && !stagePlan.error ? 'logo oficial o identificador gráfico pendiente'
          : stagePlan.error || (!categoryValid ? 'categoría UCI no determinada' : 'sexo o edad no determinados'),
        identityKey: group.groupKey, year: Number(String(competition.startDate).slice(0, 4)) || Number(competition.year), competitionId: Number(competition.competitionId), uciRaceId: 0,
        competitionName: competition.name, officialRaceName: competition.name, countryCode: competition.country,
        uciCategory: competition.classCode, startDate: competition.startDate, endDate: competition.endDate,
        inferred, evidence: { status: group.status, method: 'DataRide competition + race topology' }, days: stagePlan.days,
      });
    }
  }
}

const duplicateKeys = new Map();
for (const record of records) {
  const key = `${record.competitionId}|${record.uciRaceId}`;
  if (!duplicateKeys.has(key)) duplicateKeys.set(key, []);
  duplicateKeys.get(key).push(record);
}
for (const duplicate of duplicateKeys.values()) {
  if (duplicate.length < 2) continue;
  const ready = duplicate.filter((record) => record.state === 'ready' || record.state === 'needs_logo');
  if (ready.length < 2) continue;
  for (const record of ready) {
    record.state = 'pending';
    record.reason = 'colisión de enlace DataRide entre identidades';
  }
}

const summary = records.reduce((result, record) => {
  result.total += 1;
  result[record.state] = (result[record.state] || 0) + 1;
  result.days += record.days.length;
  return result;
}, { total: 0, ready: 0, needs_logo: 0, pending: 0, days: 0 });
const output = {
  version: 1, generatedAt: new Date().toISOString(), sourceSnapshot: studyDir,
  topologyCoverage: { expected: topology.length, failed: topology.filter((record) => record.error).length, empty: topology.filter((record) => !record.error && record.races.length === 0).length },
  summary, records,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, ...summary, topologyCoverage: output.topologyCoverage })}\n`);
