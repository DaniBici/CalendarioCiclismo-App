import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx/standings.js';

const fixtureUrl=new URL('../../js/__tests__/fixtures/cx-cotejos/worldcup-2025-26-mj.json',import.meta.url);
const derivedFixtureUrl=new URL('../../js/__tests__/fixtures/cx-cotejos/worldcup-2025-26-wu.json',import.meta.url);
const referencesUrl=new URL('../../docs/cc-cx-points-schemes.json',import.meta.url);
function identity(fixture,name,nation,yob) {
  for(const alias of fixture.offlineAliases)if(name===alias.from&&nation===alias.nation&&yob===alias.yearOfBirth)name=alias.to;
  return [name.toLowerCase().replaceAll('ß','ss').normalize('NFKD').replace(/\p{Mark}/gu,''),nation,yob].join('|');
}
const riderId=(fixture,name,nation,yob)=>'offline-'+createHash('sha256').update(identity(fixture,name,nation,yob)).digest('hex').slice(0,24);

// Las opciones son hipótesis de cotejo. No crea fichas ni guarda un esquema verified.
export function worldCupCotejoInput(fixture,references,review={}) {
  const derived=fixture.category==='WU',category=fixture.category,sourceCategory=derived?'WE':category;
  if(fixture.scope!=='offline_official_cotejo_only'||!['MJ','WU'].includes(category)
    ||derived&&(fixture.seasonKey!=='2025-26'||fixture.sourceCategory!=='WE'||fixture.officialStandingsScope!=='published_we_standings_filtered_by_regulation_age_19_22'))throw new Error('Manifiesto de cotejo incompatible');
  const scheme=structuredClone(references.references.find(r=>r.tournament==='Copa del Mundo').pointsScheme);
  scheme.status='verified';scheme.edition={seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt};scheme.sourceUrls=[fixture.rulesSourceUrl];
  scheme.categories={[category]:scheme.categories[category]};scheme.categories[category].review={sourceUrl:fixture.rulesSourceUrl,cotejoUrl:fixture.officialStandingsSourceUrl,
    droppedPlacingsPolicy:'all',...(derived?{derivedCategory:true}:{}),...review};
  const tournamentId='offline-worldcup-'+category.toLowerCase(),riders=new Map();
  const rounds=fixture.rounds.map(round=>{
    const raceId='offline-round-'+round.reportId;
    return {race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:round.dateKey,editorialStatus:'published',isCancelled:false},
      manga:{category:sourceCategory,dateKey:round.dateKey,resultsStatus:'official',resultsSourceUrl:round.sourceUrl},
      results:round.rows.map(([rank,bib,name,nation,yob,irm,birthDate])=>{
        const id=riderId(fixture,name,nation,yob);
        if(derived){
          if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate||'')||Number(birthDate.slice(0,4))!==yob
            ||!/^https:\/\//.test(round.birthDateSourceUrl||'')||round.dataRide?.disciplineId!==3
            ||!round.dataRide.eventId||!round.dataRide.uciRaceId||!round.dataRide.competitionId||round.dataRide.seasonId!==455
            ||!/^[a-f0-9]{64}$/.test(round.normalizedDataRideSha256||''))throw new Error('Nacimiento sin evidencia oficial de cotejo');
          if(riders.has(id)&&riders.get(id).birthDate!==birthDate)throw new Error('Nacimientos contradictorios en el cotejo');
          riders.set(id,{id,birthDate,verified:true});
        }else riders.set(id,{id});
        return {raceId,category:sourceCategory,rank,bib,riderDisplay:name,globalRiderId:id,irm};
      })};
  });
  return {tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:scheme},category,riders:[...riders.values()],rounds};
}

export function worldCupCotejo(fixture,references) {
  const derived=fixture.category==='WU';
  // El esperado procede de la general WE independiente, no de totales del motor.
  const officialRows=derived?fixture.officialStandings.filter(row=>{const age=2026-row[3];return age>=19&&age<=22;}):fixture.officialStandings;
  const official=new Map(officialRows.map(([sourceRank,name,nation,yob,points,cells],index)=>[riderId(fixture,name,nation,yob),{rank:derived?index+1:sourceRank,sourceRank,name,points,cells}]));
  const baselineInput=worldCupCotejoInput(fixture,references),baseline=recomputeCxStandings(baselineInput);
  const candidates=(derived?['all']:['all','retained']).map(policy=>{
    const input=worldCupCotejoInput(fixture,references,{droppedPlacingsPolicy:policy,pointsEligibilityPolicy:'awardedAtLeastOnce',latestRoundPointsPolicy:'backwardsUntilDifferent'});
    const calculation=recomputeCxStandings(input),differences=[];let matchingCells=0,checkedTotals=0,matchingTotals=0,matchingRanks=0;
    for(const entry of calculation.breakdown) {
      const expected=official.get(entry.globalRiderId);if(!expected)continue;
      checkedTotals++;
      const total=entry.rounds.filter(r=>r.retained).reduce((n,r)=>n+BigInt(r.points),0n).toString();
      if(total!==String(expected.points))differences.push({name:expected.name,field:'points',official:String(expected.points),calculated:total});
      else matchingTotals++;
      entry.rounds.forEach((round,index)=>{
        const cell=expected.cells[index],match=cell.match(/^(\d+)(?: \((\d+)\))?$/);
        const same=cell==='-'?round.missing:match&&round.points===match[1]&&(!match[2]||round.sourceRank===Number(match[2]))&&!round.missing;
        if(same)matchingCells++;else differences.push({name:expected.name,round:index+1,official:cell,calculated:{points:round.points,rank:round.sourceRank,missing:round.missing}});
      });
    }
    for(const row of calculation.rows) {
      const expected=official.get(row.globalRiderId);
      if(!expected||row.rank!==expected.rank||row.points!==String(expected.points))differences.push({name:row.riderDisplay,field:'rank',official:expected?.rank,calculated:row.rank});
      else matchingRanks++;
    }
    if(calculation.rows.length!==official.size)differences.push({field:'rowCount',official:official.size,calculated:calculation.rows.length});
    return {candidateDroppedPlacingsPolicy:policy,status:calculation.status,issues:calculation.issues,checkedTotals,matchingTotals,matchingRanks,matchingCells,rankedRows:calculation.rows.length,differences};
  });
  const expectedTotals=official.size,expectedCells=expectedTotals*fixture.rounds.length;
  const matchingPolicies=candidates.filter(candidate=>candidate.status==='ready'&&!candidate.differences.length
    &&candidate.checkedTotals===expectedTotals&&candidate.matchingCells===expectedCells).map(candidate=>candidate.candidateDroppedPlacingsPolicy);
  const conclusion=derived?'not_applicable_no_drops':matchingPolicies.length===2?'inconclusive_both_candidates_match'
    :matchingPolicies.length===1?'only_'+matchingPolicies[0]+'_candidate_matches':'neither_candidate_matches';
  return {scope:'offline_only_not_edition_activation',engineVersion:baseline.engineVersion,seasonKey:fixture.seasonKey,category:fixture.category,
    officialStandingsSourceUrl:fixture.officialStandingsSourceUrl,roundRows:fixture.rounds.map(r=>r.rows.length),identities:baselineInput.riders.length,
    ...(derived?{sourceCategory:'WE',officialStandingsScope:fixture.officialStandingsScope,officialSourceRows:fixture.officialStandings.length,
      derivedCategoryMatches:matchingPolicies.length===1}:{}),
    baseline:{status:baseline.status,unresolvedTies:baseline.issues.filter(i=>i.code==='unresolved_tie').length},candidates,
    expectedTotals,expectedCells,droppedPlacingsPolicyConclusion:conclusion};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const category=process.argv[2]||'MJ';
  if(!['MJ','WU'].includes(category))throw new Error('Categoría de cotejo no disponible');
  const report=worldCupCotejo(JSON.parse(readFileSync(category==='WU'?derivedFixtureUrl:fixtureUrl,'utf8')),JSON.parse(readFileSync(referencesUrl,'utf8')));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.candidates.some(candidate=>candidate.status!=='ready'||candidate.differences.length||candidate.checkedTotals!==report.expectedTotals||candidate.matchingCells!==report.expectedCells))process.exitCode=2;
}
