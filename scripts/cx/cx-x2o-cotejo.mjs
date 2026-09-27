import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx-standings.js';
import {cxDataRideDate} from '../results-fetchers/cx-dataride-results.mjs';

const categoryCodes = {ME:'31',WE:'32',MU:'33'};
const referencesUrl = new URL('../../docs/cc-cx-points-schemes.json', import.meta.url);
const dates = ['2025-11-01','2025-11-02','2025-11-16','2025-12-22','2025-12-29','2026-01-01','2026-02-08','2026-02-15'];
const rulesUrl = 'https://x2otrofee.be/wp-content/uploads/sites/133/2025/09/Reglement-X2O-Badkamers-trofee-veldrijden-2025-2026.pdf';
const id = uci => 'offline-' + createHash('sha256').update(uci).digest('hex').slice(0,24);
const firstLapRank = cell => Number(cell.match(/\((\d+)\)$/)?.[1]) || null;
function seconds(text) {
  if (!/^(?:\d+:)?\d+:\d{2}$/.test(text || '')) throw new Error('Tiempo oficial inválido');
  return text.split(':').reverse().reduce((total,part,index) => total + Number(part) * 60 ** index,0);
}
function source(value,context,key) {
  const suffix = key === 'cms' ? '/results/generic/uci/' + context + '/dh?key=cms'
    : '/results/table/search/' + context + '/' + key + '?srch=&fromRecord=0&pageSize=500';
  if (value?.url !== 'https://results.chronorace.be/api' + suffix || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) {
    throw new Error('Fuente oficial de cotejo no identificada');
  }
}

function identityAliases(fixture) {
  const aliases = fixture.identityAliases || [];
  if (!Array.isArray(aliases) || (aliases.length && fixture.identityMethod !== 'published_uci_ids_with_birth_date_confirmed_round_aliases_offline_only')) {
    throw new Error('Alias de identidad sin método declarado');
  }
  const seen = new Set();
  for (const alias of aliases) {
    const key = alias.context + ':' + alias.bib;
    const evidence = alias.evidence;
    if (fixture.category !== 'WE' || seen.has(key) || !/^\d{1,10}$/.test(alias.publishedIdentifier || '')
      || !/^\d{11}$/.test(alias.uciId || '') || !alias.name || alias.nation !== 'NED'
      || evidence?.method !== 'same_full_birth_date_name_nationality_in_two_independent_dataride_events'
      || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.birthDate || '') || Number.isNaN(Date.parse(evidence.birthDate))
      || new Date(evidence.birthDate).toISOString().slice(0,10) !== evidence.birthDate || evidence.projections?.length !== 2
      || fixture.unresolvedIdentities?.some(entry => entry.context === alias.context && entry.bib === alias.bib)) {
      throw new Error('Alias de identidad inválido o contradictorio');
    }
    seen.add(key);
    const contexts = new Set(), eventIds = new Set();
    let origin = false, licensed = false, birthDateRaw;
    for (const wrapper of evidence.projections) {
      const p = wrapper.projection, row = p?.row;
      const binding = fixture.unresolvedIdentityEvidence?.dataRideProjections?.find(entry => entry.projection.eventId === p?.eventId)?.projection;
      const round = fixture.rounds.find(round => round.context === p?.context);
      const original = round?.results.find(result => result[1] === row?.bib);
      const rawDate = /^\/Date\((\d+)\)\/$/.exec(row?.birthDateRaw || '');
      if (!p || createHash('sha256').update(JSON.stringify(p)).digest('hex') !== wrapper.projectionSha256
        || p.sourceUrl !== 'https://dataride.uci.ch/iframe/Results/' || p.disciplineId !== 3 || p.seasonId !== 455
        || p.category !== fixture.category || !Number.isSafeInteger(p.eventId) || p.eventId <= 0
        || !binding || binding.category !== p.category || cxDataRideDate(binding.dateKey) !== p.dateKey || binding.count !== p.rowCount
        || !binding.rows.some(previous => previous.rank === row?.rank && Number(previous.bib) === row?.bib
          && previous.name === row?.name && previous.resultValue === row?.resultValue)
        || contexts.has(p.context) || eventIds.has(p.eventId) || !round || p.dateKey !== round.dateKey
        || !Number.isInteger(p.rowCount) || p.rowCount < 1 || !original || !rawDate
        || row.name !== alias.name || original[3] !== alias.name || original[4] !== alias.nation
        || row.isoCode2 !== 'NL' || row.birthDate !== evidence.birthDate
        || !Number.isSafeInteger(Number(rawDate[1])) || Number.isNaN(new Date(Number(rawDate[1]) + 3 * 3600 * 1000).getTime())
        || new Date(Number(rawDate[1]) + 3 * 3600 * 1000).toISOString().slice(0,10) !== evidence.birthDate
        || original[0] !== row.rank || original[5] !== null || original[6] !== seconds(row.resultValue)
        || (birthDateRaw && birthDateRaw !== row.birthDateRaw)) {
        throw new Error('Alias de identidad sin evidencia independiente coincidente');
      }
      contexts.add(p.context); eventIds.add(p.eventId); birthDateRaw = row.birthDateRaw;
      if (p.context === alias.context && row.bib === alias.bib && original[2] === alias.publishedIdentifier) origin = true;
      else if (original[2] === alias.uciId) licensed = true;
    }
    if (!origin || !licensed) throw new Error('Alias de identidad sin fila original y licencia independiente');
  }
  return aliases;
}

// Solo aplica el reglamento a puestos de cronometraje publicados. No usa diferencias de la general para obtener bonos.
export function x2oCotejoInput(fixture,references,{forfaitBonusesPolicy='discard'}={}) {
  if (fixture.version !== 1 || fixture.scope !== 'offline_official_cotejo_only' || fixture.seasonKey !== '2025-26'
    || !Object.hasOwn(categoryCodes,fixture.category)
    || !['same_published_uci_id_offline_only_no_catalogue_links','published_uci_ids_with_isolated_unresolved_identifiers_offline_only',
      'published_uci_ids_with_birth_date_confirmed_round_aliases_offline_only'].includes(fixture.identityMethod)
    || fixture.rulesSourceUrl !== rulesUrl || !/^[a-f0-9]{64}$/.test(fixture.rulesSourceSha256 || '')
    || fixture.rounds?.length !== 8 || fixture.standingsContext !== '20260215_x2o') throw new Error('Manifiesto X2O incompatible');
  const category = fixture.category, code = categoryCodes[category];
  const aliases = identityAliases(fixture);
  const unresolved = fixture.unresolvedIdentities || [];
  if (!Array.isArray(unresolved) || (unresolved.length && fixture.identityMethod !== 'published_uci_ids_with_isolated_unresolved_identifiers_offline_only')
    || unresolved.some((entry,index) => !/^\d{1,10}$/.test(entry.publishedIdentifier || '') || !entry.name
      || !Number.isInteger(entry.bib) || !fixture.rounds.some(round => round.context === entry.context)
      || unresolved.slice(0,index).some(other => other.context === entry.context && other.bib === entry.bib))) throw new Error('Identidad pendiente inválida');
  const usedUnresolved = new Set();
  source(fixture.standingsSource,fixture.standingsContext,'RNK'+code);
  if (fixture.officialStandings.length !== fixture.standingsSource.rowCount) throw new Error('General incompleta');
  const scheme = structuredClone(references.references.find(r => r.tournament === 'X2O Trofee').pointsScheme);
  // La hipótesis verified solo existe en memoria y no activa la referencia de edición.
  scheme.status = 'verified'; scheme.edition = {seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt.slice(0,10)};
  scheme.sourceUrls = [fixture.rulesSourceUrl]; scheme.categories = {[category]:scheme.categories[category]};
  scheme.categories[category].review = {sourceUrl:fixture.rulesSourceUrl,cotejoUrl:fixture.standingsSource.url,
    missingRoundBonuses:'none',forfaitBonusesPolicy};
  const tournamentId = 'offline-x2o-'+category.toLowerCase(), riders = new Map(), awards = [];
  const rounds = fixture.rounds.map((round,index) => {
    const context = round.dateKey.replaceAll('-','') + '_x2o';
    if (round.context !== context || round.dateKey !== dates[index]
      || !round.sourceTitle || round.firstLapSection !== round.winnerTimingSections - round.winnerLaps + 1
      || ![1,2].includes(round.firstLapSection)) throw new Error('Fecha o primera vuelta sin evidencia');
    source(round.cmsSource,context,'cms'); source(round.resultsSource,context,'RES'+code); source(round.bestLapSource,context,'BEST'+code);
    if (round.results.length !== round.resultsSource.rowCount || round.bestLaps.length !== round.bestLapSource.rowCount) throw new Error('Tabla de ronda incompleta');
    const byBib = new Map(), byUci = new Map(), resolvedIds = new Set();
    const identity = (uci,bib) => aliases.find(entry => entry.context === context && entry.bib === bib && entry.publishedIdentifier === uci)?.uciId
      || (unresolved.some(entry => entry.context === context && entry.bib === bib && entry.publishedIdentifier === uci)
        ? 'unresolved:'+context+':'+uci : uci);
    for (const row of round.results) {
      const [rank,bib,uci,name,,irm,finish,,laps,cell,timeText] = row;
      const pending = unresolved.find(entry => entry.context === context && entry.bib === bib);
      const alias = aliases.find(entry => entry.context === context && entry.bib === bib);
      if (pending && (pending.publishedIdentifier !== uci || pending.name !== name)) throw new Error('Identidad pendiente contradictoria');
      if (!Number.isInteger(bib) || (!/^\d{11}$/.test(uci || '') && !pending && !alias) || !name || byBib.has(bib) || byUci.has(uci)
        || resolvedIds.has(identity(uci,bib))
        || ![null,'DNF','DNS','LAP'].includes(irm) || irm && finish !== null
        || !irm && (!Number.isSafeInteger(finish) || finish <= 0 || seconds(timeText.split(' | ')[0]) !== finish)
        || ['DNF','DNS'].includes(irm) && rank !== null || irm === 'LAP' && !Number.isInteger(rank)
        || irm === 'DNS' && cell || firstLapRank(cell) && Number(laps) < 1) throw new Error('Fila de resultados inválida');
      if (pending) usedUnresolved.add(pending);
      resolvedIds.add(identity(uci,bib));
      byBib.set(bib,row); byUci.set(uci,row); riders.set(identity(uci,bib),{id:id(identity(uci,bib))});
    }
    const placed = round.results.filter(row => row[0] !== null).map(row => row[0]);
    if (placed.some((rank,index) => rank !== index+1)) throw new Error('Puestos incompletos');
    const sprint = [1,2,3].map(rank => {
      const matches = round.results.filter(row => firstLapRank(row[9]) === rank);
      if (matches.length !== 1) throw new Error('Sprint sin tres puestos oficiales únicos');
      return {rank,bib:matches[0][1],uci:matches[0][2],seconds:[15,10,5][rank-1]};
    });
    const bestBibs = new Set();
    for (const row of round.bestLaps) {
      if (!byBib.has(row[1]) || byBib.get(row[1])[2] !== row[2] || bestBibs.has(row[1])) throw new Error('Identidad de vuelta rápida contradictoria');
      bestBibs.add(row[1]);
    }
    const fast = [1,2,3].map(rank => {
      const matches = round.bestLaps.filter(row => row[0] === rank+'.');
      if (matches.length !== 1 || !/^#[1-9]\d*$/.test(matches[0][5]) || !/^(?:\d+:)?\d+:\d{2}\.\d{3}$/.test(matches[0][6])) {
        throw new Error('Vuelta rápida sin tres puestos oficiales únicos');
      }
      const row = matches[0];
      return {rank,bib:row[1],uci:row[2],lap:row[5],timeText:row[6],seconds:[15,10,5][rank-1]};
    });
    const totals = new Map();
    for (const award of [...sprint,...fast]) totals.set(award.bib,(totals.get(award.bib) || 0) + award.seconds);
    const bonusDifferences = [];
    for (const row of round.results) {
      if (row[7] !== null && seconds(row[7]) !== (totals.get(row[1]) || 0)) {
        bonusDifferences.push({bib:row[1],name:row[3],official:seconds(row[7]),calculated:totals.get(row[1]) || 0});
      }
      if (totals.has(row[1]) && row[7] === null) bonusDifferences.push({bib:row[1],name:row[3],official:null,calculated:totals.get(row[1])});
    }
    awards.push({round:index+1,name:round.name,sprint,fastestLap:fast,publishedBonuses:round.results.filter(row => row[7] !== null).length,
      aggregateSeconds:[...totals.values()].reduce((n,s) => n+s,0),differences:bonusDifferences});
    const raceId = 'offline-' + context;
    return {race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:round.dateKey,editorialStatus:'published',isCancelled:false},
      manga:{category,dateKey:round.dateKey,resultsStatus:'official',resultsSourceUrl:round.resultsSource.url,bonusSourceUrl:round.resultsSource.url},
      results:round.results.map(([rank,bib,uci,name,,irm,timeSeconds]) => ({raceId,category,rank,bib,riderDisplay:name,
        globalRiderId:id(identity(uci,bib)),irm,timeSeconds:timeSeconds === null ? null : String(timeSeconds),bonusSeconds:totals.get(bib) || 0}))};
  });
  if (usedUnresolved.size !== unresolved.length) throw new Error('Identidad pendiente sin fila de origen');
  return {input:{tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:scheme},category,riders:[...riders.values()],rounds},awards};
}

export function x2oCotejo(fixture,references,options) {
  const {input,awards} = x2oCotejoInput(fixture,references,options);
  const calculation = recomputeCxStandings(input), differences = [], expected = new Map();
  const names = new Map(input.rounds.flatMap(round => round.results.map(row => [row.globalRiderId,row.riderDisplay])));
  for (const [rank,uci,name,,total,cells] of fixture.officialStandings) {
    if (!/^\d{11}$/.test(uci || '') || expected.has(id(uci)) || cells.length !== 8 || !Number.isInteger(rank) || !Number.isSafeInteger(total)) throw new Error('General inválida');
    expected.set(id(uci),{rank,name,total,cells});
  }
  let matchingTotals = 0, matchingCells = 0, matchingRanks = 0;
  for (const entry of calculation.breakdown) {
    const official = expected.get(entry.globalRiderId);
    if (!official) { differences.push({field:'extraIdentity',name:names.get(entry.globalRiderId)}); continue; }
    const total = entry.rounds.reduce((n,r) => n + BigInt(r.timeSeconds),0n).toString();
    if (total === String(official.total)) matchingTotals++;
    else differences.push({name:official.name,field:'totalSeconds',official:official.total,calculated:total});
    entry.rounds.forEach((round,index) => {
      const text = official.cells[index], match = text.match(/^((?:\d+:)?\d+:\d{2})(?: \((\d+)\))?$/);
      const same = text === '-' ? round.missing : match && String(seconds(match[1])) === round.timeSeconds
        && (match[2] ? Number(match[2]) === round.sourceRank : round.forfait);
      if (same) matchingCells++; else differences.push({name:official.name,round:index+1,field:'roundCell',official:text,
        calculated:{timeSeconds:round.timeSeconds,rank:round.sourceRank,forfait:round.forfait,missing:round.missing}});
    });
  }
  for (const row of calculation.rows) {
    const official = expected.get(row.globalRiderId);
    if (official?.rank === row.rank && String(official.total) === row.timeSeconds) matchingRanks++;
    else differences.push({name:row.riderDisplay,field:'rank',official:official?.rank,calculated:row.rank,
      officialTimeSeconds:official?.total,calculatedTimeSeconds:row.timeSeconds});
  }
  for (const [rider,official] of expected) if (!calculation.breakdown.some(entry => entry.globalRiderId === rider)) differences.push({name:official.name,field:'missingIdentity'});
  const excluded = calculation.breakdown.filter(entry => !entry.eligible).map(entry => ({name:expected.get(entry.globalRiderId)?.name || names.get(entry.globalRiderId),officialRank:expected.get(entry.globalRiderId)?.rank}));
  if (calculation.rows.length !== expected.size) differences.push({field:'rowCount',official:expected.size,calculated:calculation.rows.length});
  const bonusesMatch = awards.every(round => !round.differences.length && round.aggregateSeconds === 60);
  const timeTotalsAndCellsMatch = matchingTotals === expected.size && matchingCells === expected.size*8
    && !differences.some(d => !['rowCount','rank'].includes(d.field));
  const unresolvedSourceIdentities = fixture.unresolvedIdentities || [];
  const generalMatches = !unresolvedSourceIdentities.length && bonusesMatch && timeTotalsAndCellsMatch && calculation.status === 'ready'
    && calculation.rows.length === expected.size && matchingRanks === expected.size && !differences.length;
  return {scope:'offline_only_not_edition_activation',engineVersion:calculation.engineVersion,seasonKey:fixture.seasonKey,category:fixture.category,
    forfaitBonusesPolicy:input.tournament.pointsScheme.categories[fixture.category].review.forfaitBonusesPolicy,
    status:generalMatches ? 'matched' : 'needs_review',calculationStatus:calculation.status,issues:calculation.issues,
    roundRows:fixture.rounds.map(r => r.results.length),officialTotals:expected.size,officialCells:expected.size*8,
    checkedTotals:calculation.breakdown.length,matchingTotals,matchingCells,matchingRanks,rankedRows:calculation.rows.length,
    bonusesMatch,timeTotalsAndCellsMatch,generalMatches,unresolvedSourceIdentities,
    resolvedSourceAliases:(fixture.identityAliases || []).map(({context,bib,publishedIdentifier,uciId,name}) => ({context,bib,publishedIdentifier,uciId,name})),
    awards,excludedByRegulationButPresentInOfficialRanking:excluded,differences};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const category = process.argv[2] || 'ME';
  if (!Object.hasOwn(categoryCodes,category)) throw new Error('Categoría X2O incompatible');
  const fixtureUrl = new URL('../../docs/cx-cotejos/x2o-2025-26-'+category.toLowerCase()+'.json',import.meta.url);
  const report = x2oCotejo(JSON.parse(readFileSync(fixtureUrl,'utf8')),JSON.parse(readFileSync(referencesUrl,'utf8')));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if (!report.generalMatches) process.exitCode = 2;
}
