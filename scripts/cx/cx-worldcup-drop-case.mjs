import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx/standings.js';

const fixtureUrl=new URL('../../js/__tests__/fixtures/cx-cotejos/worldcup-drop-case-2019-20-mu.json',import.meta.url);
const oldScale=[60,50,45,40,35,30,28,26,24,22,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
const sources=[['2019-10-20',57742,193952],['2019-11-16',57743,193946],['2019-11-24',57744,193960],
  ['2019-12-22',57745,193956],['2019-12-26',57746,193954],['2020-01-19',57748,193966],['2020-01-26',57747,193970]];
const caseIdentities=[['MEIN Thomas','GBR',1999],['VANDEPUTTE Niels','BEL',2000]];
const riderId=(name,nation,yob)=>'offline-'+createHash('sha256').update(
  [name.normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase(),nation,yob].join('|')).digest('hex').slice(0,24);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=value=>/^[a-f0-9]{64}$/.test(value||'');
const fail=()=>{throw new Error('Manifiesto del caso de descartes incompatible o sin evidencia íntegra');};

function validate(fixture,policy) {
  if(fixture.scope!=='offline_official_dropped_places_case_only'||fixture.seasonKey!=='2019-20'||fixture.category!=='MU'
    ||!['all','retained'].includes(policy)||JSON.stringify(fixture.rules?.perRank)!==JSON.stringify(oldScale)
    ||fixture.rules?.heldRounds!==7||fixture.rules?.keepBest!==4||fixture.rules?.countPlacingsRanksTo!==30
    ||fixture.rules?.latestRoundPointsPolicy!=='lastHeldRound'||!/^\d{4}-\d{2}-\d{2}$/.test(fixture.checkedAt||'')
    ||!/^https:\/\/www\.ucicyclocrossworldcup\.com\//.test(fixture.rulesSourceUrl||'')
    ||fixture.rulesSourceUrl!==fixture.officialStandingsSourceUrl||!sha(fixture.officialStandingsSha256)
    ||JSON.stringify(fixture.resultColumns)!==JSON.stringify(['rank','bib','riderDisplay','nation','yearOfBirth','irm'])
    ||JSON.stringify(fixture.standingsColumns)!==JSON.stringify(['rank','riderDisplay','nation','yearOfBirth','points','roundCells'])
    ||fixture.rounds?.length!==7||fixture.officialCase?.length!==2)fail();
  const caseRanks=new Set();
  fixture.officialCase.forEach((row,index)=>{
    if(row.length!==6||JSON.stringify(row.slice(1,4))!==JSON.stringify(caseIdentities[index])
      ||!Number.isInteger(row[0])||row[0]<1||caseRanks.has(row[0])||!Number.isInteger(row[4])||row[4]<0
      ||row[5]?.length!==7||row[5].some(cell=>!/^(-|\d+(?: \(\d+\))?)$/.test(cell)))fail();
    caseRanks.add(row[0]);
  });
  fixture.rounds.forEach((round,index)=>{
    const [dateKey,competitionId,eventId]=sources[index],meta=round.dataRide;
    if(round.dateKey!==dateKey||meta?.competitionId!==competitionId||meta.eventId!==eventId
      ||meta.disciplineId!==3||meta.seasonId!==141||!Number.isInteger(meta.uciRaceId)||meta.uciRaceId<1
      ||round.sourceUrl!=='https://dataride.uci.ch/iframe/Results/'||!Number.isFinite(Date.parse(round.fetchedAt))
      ||!sha(round.normalizedDataRideSha256)||!Array.isArray(round.rows)||round.rows.length!==round.rowCount||!round.rowCount
      ||round.projectionSha256!==hash({dateKey:round.dateKey,dataRide:round.dataRide,rows:round.rows}))fail();
    const identities=new Set(),ranks=new Set();
    for(const row of round.rows){
      const [rank,bib,name,nation,yob,irm]=row;
      if(row.length!==6||typeof name!=='string'||!name.trim()||typeof bib!=='string'||!bib.trim()
        ||!/^[A-Z]{3}$/.test(nation)||!Number.isInteger(yob)||yob<1900||yob>2020
        ||rank!==null&&(!Number.isInteger(rank)||rank<1||ranks.has(rank))
        ||irm!==null&&!['LAP','DNF','DNS','DSQ','OTL'].includes(irm)
        ||rank===null&&irm===null||rank!==null&&['DNF','DNS','DSQ'].includes(irm))fail();
      const id=riderId(name,nation,yob);if(identities.has(id))fail();identities.add(id);
      if(rank!==null)ranks.add(rank);
    }
  });
}

// Hipótesis local para esta edición antigua: no activa referencias ni escribe fichas/resultados históricos.
export function worldCupDropCaseInput(fixture,policy='all') {
  validate(fixture,policy);
  const tournamentId='offline-worldcup-drop-2019-20-mu',riders=new Map();
  const rounds=fixture.rounds.map(round=>{
    const raceId='offline-round-'+round.dataRide.competitionId;
    return {race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:round.dateKey,editorialStatus:'published',isCancelled:false},
      manga:{category:'MU',dateKey:round.dateKey,resultsStatus:'official',resultsSourceUrl:round.sourceUrl},
      results:round.rows.map(([rank,bib,name,nation,yob,irm])=>{
        const id=riderId(name,nation,yob);riders.set(id,{id});
        return {raceId,category:'MU',rank,bib,riderDisplay:name,globalRiderId:id,irm};
      })};
  });
  const rule={mode:'points',perRank:[...oldScale],drops:{mode:'bestResults',byHeldRounds:[{exact:7,keep:4}]},
    rounds:{scope:'category',expected:7},tieBreakers:[{type:'countPlacings',ranksFrom:1,ranksTo:30,direction:'desc'},
      {type:'latestRoundPoints',direction:'desc'}],review:{sourceUrl:fixture.rulesSourceUrl,cotejoUrl:fixture.officialStandingsSourceUrl,
      droppedPlacingsPolicy:policy,pointsEligibilityPolicy:'awardedAtLeastOnce',latestRoundPointsPolicy:'lastHeldRound'}};
  return {tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:{version:1,status:'verified',
    edition:{seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt},sourceUrls:[fixture.rulesSourceUrl],categories:{MU:rule}}},
    category:'MU',riders:[...riders.values()],rounds};
}

export function worldCupDropCaseCotejo(fixture) {
  validate(fixture,'all');
  const ids=new Set(caseIdentities.map(identity=>riderId(...identity)));
  const expected=new Map(fixture.officialCase.map(([rank,name,nation,yob,points,cells])=>[riderId(name,nation,yob),{rank,name,points,cells}]));
  const sourceOrder=[...expected.values()].sort((a,b)=>a.rank-b.rank).map(row=>row.name);
  const candidates=['all','retained'].map(policy=>{
    const fullInput=worldCupDropCaseInput(fixture,policy),full=recomputeCxStandings(fullInput);
    // Se compara solo el orden relativo de los dos corredores; no se asignan los puestos globales 4/5.
    // Los puestos originales de las rondas (incluidos 9/10 descartados) se conservan sin renumerar.
    const input={...fullInput,riders:fullInput.riders.filter(row=>ids.has(row.id)),
      rounds:fullInput.rounds.map(round=>({...round,results:round.results.filter(row=>ids.has(row.globalRiderId))}))};
    const calculation=recomputeCxStandings(input),differences=[];
    let matchingTotals=0,matchingCells=0;
    for(const entry of calculation.breakdown){
      const official=expected.get(entry.globalRiderId);
      const total=entry.rounds.filter(round=>round.retained).reduce((n,round)=>n+BigInt(round.points),0n).toString();
      if(total===String(official.points))matchingTotals++;
      else differences.push({name:official.name,field:'points',official:official.points,calculated:total});
      entry.rounds.forEach((round,index)=>{
        const cell=official.cells[index],match=cell.match(/^(\d+)(?: \((\d+)\))?$/);
        if(cell==='-'?round.missing:match&&!round.missing&&round.points===match[1]
          &&(!match[2]||round.sourceRank===Number(match[2])))matchingCells++;
        else differences.push({name:official.name,round:index+1,official:cell,
          calculated:{points:round.points,sourceRank:round.sourceRank,missing:round.missing}});
      });
    }
    const calculatedOrder=calculation.rows.map(row=>expected.get(row.globalRiderId).name);
    const caseOrderMatches=JSON.stringify(calculatedOrder)===JSON.stringify(sourceOrder);
    if(!caseOrderMatches)differences.push({field:'relativeOrder',official:sourceOrder,calculated:calculatedOrder});
    return {candidateDroppedPlacingsPolicy:policy,engineVersion:calculation.engineVersion,status:calculation.status,issues:calculation.issues,
      completeRoundInput:{status:full.status,unresolvedTies:full.issues.filter(issue=>issue.code==='unresolved_tie').length,
        identities:fullInput.riders.length,rankedRows:full.rows.length},
      checkedTotals:calculation.breakdown.length,matchingTotals,matchingCells,caseOrderMatches,calculatedOrder,differences};
  });
  const matching=candidates.filter(c=>c.status==='ready'&&!c.differences.length&&c.checkedTotals===2&&c.matchingTotals===2&&c.matchingCells===14);
  return {scope:'offline_case_only_not_full_general_or_edition_activation',comparisonScope:'two_rider_relative_order_only',
    engineVersion:candidates[0].engineVersion,seasonKey:fixture.seasonKey,category:fixture.category,officialStandingsSourceUrl:fixture.officialStandingsSourceUrl,
    roundRows:fixture.rounds.map(round=>round.rows.length),publishedCaseRanks:fixture.officialCase.map(row=>({name:row[1],rank:row[0]})),
    expectedTotals:2,expectedCells:14,candidates,droppedPlacingsPolicyConclusion:matching.length===1
      ?'only_'+matching[0].candidateDroppedPlacingsPolicy+'_case_matches':matching.length===2?'inconclusive_both_cases_match':'neither_case_matches'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const report=worldCupDropCaseCotejo(JSON.parse(readFileSync(fixtureUrl,'utf8')));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.droppedPlacingsPolicyConclusion!=='only_all_case_matches')process.exitCode=2;
}
