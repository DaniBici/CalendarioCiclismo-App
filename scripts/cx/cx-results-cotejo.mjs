import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {cxDataRideDate, cxDataRideSeconds} from '../results-fetchers/cx-dataride-results.mjs';

const fixtureUrl = new URL('../../docs/cx-cotejos/waaslandcross-2025-26-me.json', import.meta.url);
const categories = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const states = new Set(['DNF', 'DNS', 'DSQ', 'OTL', 'ABD']);
const lapText = value => typeof value === 'string' && /^-?\d+\s+LAPS?$/i.test(value.trim())
  ? value.trim().toUpperCase().replace(/\s+/g, ' ').replace(/LAPS$/, 'LAP') : null;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const validRank = value => value === null || positiveId(value);
const nullableText = value => value === null || typeof value === 'string';
const httpsUrl = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

// Cotejo de hechos publicados. No descarga, enlaza fichas, cambia estados ni escribe en BD.
export function cxResultsCotejo(fixture) {
  const official = fixture?.official, normalized = fixture?.normalizedDataRide;
  if (fixture?.scope !== 'offline_official_cotejo_only' || fixture.schemaVersion !== 1
    || !categories.has(fixture.category) || cxDataRideDate(fixture.dateKey) !== fixture.dateKey
    || !httpsUrl(official?.sourceUrl) || !httpsUrl(official?.organizerUrl)
    || !/^[a-f0-9]{64}$/.test(fixture.originalOfficialFactsSha256 || '')
    || !/^[a-f0-9]{64}$/.test(fixture.originalNormalizedDataRideSha256 || '')
    || normalized?.source !== 'dataride' || normalized.schemaVersion !== 1 || normalized.disciplineId !== 3
    || !positiveId(normalized.competitionId) || !positiveId(normalized.seasonId)
    || !Array.isArray(official.rows) || !official.rows.length || !Array.isArray(normalized.categories)) {
    throw new Error('Manifiesto de cotejo incompatible');
  }
  const mangas = normalized.categories.filter(manga => manga.category === fixture.category);
  if (mangas.length !== 1 || mangas[0].dateKey !== fixture.dateKey
    || !positiveId(mangas[0].eventId) || !positiveId(mangas[0].uciRaceId) || !Array.isArray(mangas[0].rows)) {
    throw new Error('Categoría, fecha o evento de cotejo incompatible');
  }
  const rows = mangas[0].rows, expectedByBib = new Map(), receivedByBib = new Map(), differences = [];
  const addToIndex = (index, bib, row) => index.set(bib, [...(index.get(bib) || []), row]);
  for (const row of official.rows) {
    if (!Array.isArray(row) || row.length !== 4 || !validRank(row[0]) || typeof row[1] !== 'string' || !row[1].trim()
      || typeof row[2] !== 'string' || !row[2].trim() || typeof row[3] !== 'string'
      || cxDataRideSeconds(row[3]) === null && !lapText(row[3]) && !states.has(row[3])) {
      throw new Error('Fila oficial de cotejo inválida o valor no reconocido');
    }
    addToIndex(expectedByBib, row[1], row);
  }
  const unlistedDns = official.coverage === 'named_rows_with_unlisted_dns' ? official.summary?.unlistedDns : null;
  if (official.coverage != null && (official.coverage !== 'named_rows_with_unlisted_dns'
    || !Number.isSafeInteger(unlistedDns) || unlistedDns < 1
    || official.summary.namedParticipants !== official.rows.length
    || official.summary.classified !== official.rows.filter(row => row[0] !== null).length
    || official.summary.dnf !== official.rows.filter(row => row[3] === 'DNF').length
    || official.summary.classified + official.summary.dnf !== official.summary.namedParticipants)) {
    throw new Error('Cobertura de la clasificación oficial incompatible');
  }
  for (const row of rows) {
    if (!row || !validRank(row.rank) || typeof row.bib !== 'string' || !row.bib.trim()
      || typeof row.riderDisplay !== 'string' || !row.riderDisplay.trim()
      || !['timeText', 'timeSeconds', 'gapText', 'irm', 'sourceConflict'].every(field => nullableText(row[field]))) {
      throw new Error('Fila DataRide de cotejo inválida');
    }
    addToIndex(receivedByBib, row.bib, row);
  }
  for (const [bib, entries] of expectedByBib) if (entries.length !== 1) differences.push({bib, field: 'duplicateBib', source: 'official', count: entries.length});
  for (const [bib, entries] of receivedByBib) {
    if (entries.length !== 1) differences.push({bib, field: 'duplicateBib', source: 'dataride', count: entries.length});
    if (!expectedByBib.has(bib)) differences.push({bib, field: 'unexpectedBib'});
  }
  const absoluteTimes = official.rows.filter(row => cxDataRideSeconds(row[3]) !== null).length;
  const lapStates = official.rows.filter(row => lapText(row[3]) !== null).length;
  const otherStates = official.rows.length - absoluteTimes - lapStates;
  let matchingIdentities = 0, matchingAbsoluteTimes = 0, matchingLapStates = 0, matchingOtherStates = 0;
  for (const [bib, expected] of expectedByBib) {
    if (expected.length !== 1) continue;
    const [rank, , name, value] = expected[0], received = receivedByBib.get(bib);
    if (!received) { differences.push({bib, field: 'missingBib'}); continue; }
    if (received.length !== 1) continue;
    const row = received[0], seconds = cxDataRideSeconds(value), lap = lapText(value);
    if (row.rank === rank && row.riderDisplay === name) matchingIdentities++;
    else differences.push({bib, field: 'identityOrRank', official: {rank, name}, dataride: {rank: row.rank, name: row.riderDisplay}});
    if (row.sourceConflict !== null) differences.push({bib, field: 'sourceConflict', value: row.sourceConflict});
    if (seconds !== null) {
      if (row.timeSeconds === seconds && row.irm === null) matchingAbsoluteTimes++;
      else differences.push({bib, name, field: 'absoluteTime', official: value, officialSeconds: seconds,
        dataride: row.timeText, datarideSeconds: row.timeSeconds, datarideIrm: row.irm});
    } else if (lap) {
      if (row.irm === 'LAP' && row.timeSeconds === null && row.timeText === null && lapText(row.gapText) === lap) matchingLapStates++;
      else differences.push({bib, field: 'lapState', official: value,
        dataride: {irm: row.irm, gapText: row.gapText, timeSeconds: row.timeSeconds, timeText: row.timeText}});
    } else {
      if (row.irm === value && row.timeSeconds === null && (row.timeText === null || row.timeText === value) && row.gapText === null) matchingOtherStates++;
      else differences.push({bib, field: 'nonFinishState', official: value,
        dataride: {irm: row.irm, timeSeconds: row.timeSeconds, timeText: row.timeText, gapText: row.gapText}});
    }
  }
  if (rows.length !== official.rows.length) differences.push({field: 'rowCount', official: official.rows.length, dataride: rows.length});
  const additionalRows = rows.filter(row => !expectedByBib.has(row.bib));
  const additionalDns = additionalRows.filter(row => row.irm === 'DNS' && row.rank === null
    && row.timeSeconds === null && (row.timeText === null || row.timeText === 'DNS')
    && row.gapText === null && row.sourceConflict === null);
  const dnsBibs = new Set(additionalDns.map(row => row.bib));
  const sourceCoverage = unlistedDns === null ? null : {
    scope: official.coverage, officialUnlistedDns: unlistedDns,
    dataRideOnlyDns: additionalDns.map(row => ({bib: row.bib, name: row.riderDisplay})),
    dnsCountDifference: unlistedDns - additionalDns.length, officialDnsIdentitiesMatched: false,
    namedClassificationMatches: matchingIdentities === official.rows.length
      && matchingAbsoluteTimes === absoluteTimes && matchingLapStates === lapStates && matchingOtherStates === otherStates
      && additionalRows.length === additionalDns.length && additionalDns.length <= unlistedDns
      && differences.every(entry => entry.field === 'rowCount' || entry.field === 'unexpectedBib' && dnsBibs.has(entry.bib)),
    allEntrantsMatches: false,
  };
  return {scope: 'offline_only_not_publication', status: differences.length || unlistedDns !== null ? 'needs_review' : 'matching',
    category: fixture.category, dateKey: fixture.dateKey, officialSourceUrl: official.sourceUrl,
    competitionId: normalized.competitionId, eventId: mangas[0].eventId,
    officialRows: official.rows.length, datarideRows: rows.length, matchingIdentities,
    absoluteTimes, matchingAbsoluteTimes, lapStates, matchingLapStates, otherStates, matchingOtherStates, sourceCoverage, differences};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = cxResultsCotejo(JSON.parse(readFileSync(process.argv[2] || fixtureUrl, 'utf8')));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.status === 'matching' ? 0 : 2;
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
