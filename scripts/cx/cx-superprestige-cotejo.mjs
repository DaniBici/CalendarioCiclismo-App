import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx-standings.js';

const referencesUrl=new URL('../../docs/cc-cx-points-schemes.json',import.meta.url);
const norm=name=>name.toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu,'').trim().split(/\s+/).sort().join(' ');
function identity(fixture,name,nation) {
  const alias=fixture.offlineAliases.find(a=>a.from===name&&a.nation===nation);
  return norm(alias?.to||name)+'|'+nation;
}
const riderId=(fixture,name,nation)=>'offline-'+createHash('sha256').update(identity(fixture,name,nation)).digest('hex').slice(0,24);
const source=value=>/^https:\/\//.test(value||'');
const hash=value=>/^[a-f0-9]{64}$/.test(value||'');

function validate(fixture) {
  if(fixture.schemaVersion!==1||fixture.scope!=='offline_official_cotejo_only'||fixture.seasonKey!=='2025-26'
    ||!['ME','WE'].includes(fixture.category)||!source(fixture.rulesSourceUrl)||!Array.isArray(fixture.offlineAliases)
    ||JSON.stringify(fixture.roundColumns)!==JSON.stringify(['rank','bib','name','nation','irm'])
    ||fixture.rounds?.length!==8||!source(fixture.standings?.sourceUrl)||!hash(fixture.standings?.sha256)
    ||!fixture.standings.rows?.length)throw new Error('Manifiesto de cotejo incompatible');
  for(const alias of fixture.offlineAliases)if(!alias.from||!alias.to||!alias.nation||!alias.reason
    ||!source(alias.evidence?.sourceUrl)||!hash(alias.evidence?.sha256)||!alias.evidence.uciId)throw new Error('Alias local sin evidencia');
  let previousDate='';
  for(const round of fixture.rounds) {
    if(round.category!==fixture.category||!source(round.url)||!hash(round.sha256)
      ||!/^\d{4}-\d{2}-\d{2}$/.test(round.dateKey)||round.dateKey<=previousDate
      ||!round.rows?.length||round.rows.length!==round.participants)throw new Error('Informe de ronda incompleto');
    previousDate=round.dateKey;
    const bibs=new Set(),identities=new Set();let placed=0,dnf=0,dns=0;
    for(const row of round.rows) {
      const [rank,bib,name,nation,irm]=row;
      if(row.length!==5||!/^\d+$/.test(bib||'')||!name?.trim()||!/^[A-Z]{3}$/.test(nation||'')
        ||bibs.has(bib)||identities.has(identity(fixture,name,nation))
        ||rank!=null&&(!Number.isInteger(rank)||rank!==++placed||!['LAP',null].includes(irm))
        ||rank==null&&!['DNF','DNS','DSQ'].includes(irm))throw new Error('Dorsal, identidad, puesto o estado de ronda inválido');
      bibs.add(bib);identities.add(identity(fixture,name,nation));
      dnf+=irm==='DNF'?1:0;dns+=irm==='DNS'?1:0;
    }
    if(dnf!==round.dnf||dns!==round.dns)throw new Error('Recuento DNF/DNS distinto del informe');
  }
  const seen=new Set();
  for(const row of fixture.standings.rows) {
    const id=identity(fixture,row.name,row.nation);
    if(!row.name?.trim()||!/^[A-Z]{3}$/.test(row.nation||'')||seen.has(id)
      ||!Number.isInteger(row.points)||row.points<0||row.roundPoints?.length!==8
      ||row.roundPoints.some(p=>!Number.isInteger(p)||p<0)
      ||row.publishedRank!=null&&(!Number.isInteger(row.publishedRank)||row.publishedRank<1||row.publishedRank>fixture.standings.rows.length))throw new Error('General oficial inválida');
    seen.add(id);
  }
}

// Hipótesis offline: no activa un reglamento ni crea identidades de catálogo.
export function superprestigeCotejoInput(fixture,references,{pointsEligibilityPolicy='awardedAtLeastOnce'}={}) {
  validate(fixture);
  const category=fixture.category,reference=references.references.find(r=>r.tournament==='Superprestige');
  if(!reference)throw new Error('Referencia Superprestige ausente');
  const scheme=structuredClone(reference.pointsScheme);
  scheme.status='verified';scheme.edition={seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt};scheme.sourceUrls=[fixture.rulesSourceUrl];
  scheme.categories={[category]:scheme.categories[category]};
  scheme.categories[category].review={sourceUrl:fixture.rulesSourceUrl,cotejoUrl:fixture.standings.sourceUrl,pointsEligibilityPolicy};
  const tournamentId='offline-superprestige-'+category.toLowerCase(),riders=new Map();
  const rounds=fixture.rounds.map((round,index)=>{
    const raceId=tournamentId+'-'+(index+1);
    return {race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:round.dateKey,editorialStatus:'published',isCancelled:false},
      manga:{category,dateKey:round.dateKey,resultsStatus:'official',resultsSourceUrl:round.url},
      results:round.rows.map(([rank,bib,name,nation,irm])=>{
        const id=riderId(fixture,name,nation);riders.set(id,{id});
        return {raceId,category,rank,bib,riderDisplay:name,globalRiderId:id,irm};
      })};
  });
  return {tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:scheme},category,riders:[...riders.values()],rounds};
}

// Intervalos individuales según el reglamento. Las etiquetas impresas y los huecos del PDF no se reinterpretan.
function printedRanksAudit(fixture,input,calculation) {
  const rule=input.tournament.pointsScheme.categories[fixture.category];
  const expectedTies=[{type:'starts',direction:'desc',excludeIrm:['DNS']},{type:'wins',direction:'desc'},
    {type:'lastHeldRoundRank',direction:'asc'}];
  if(rule.mode!=='points'||rule.drops.mode!=='none'
    ||JSON.stringify(rule.perRank)!==JSON.stringify(Array.from({length:15},(_,i)=>15-i))
    ||JSON.stringify(rule.tieBreakers)!==JSON.stringify(expectedTies)
    ||calculation.breakdown.length!==input.riders.length) {
    return {status:'unavailable',reason:'Reglamento o desglose incompatible con la auditoría Superprestige',rows:[]};
  }
  const rawByRider=new Map();
  for(const round of input.rounds)for(const row of round.results) {
    rawByRider.set(row.globalRiderId,[...(rawByRider.get(row.globalRiderId)||[]),row]);
  }
  const entries=calculation.breakdown.filter(entry=>entry.eligible).map(entry=>{
    const raw=rawByRider.get(entry.globalRiderId)||[];
    return {globalRiderId:entry.globalRiderId,
      points:entry.rounds.reduce((total,round)=>total+BigInt(round.points)+BigInt(round.bonusPoints),0n),
      starts:raw.filter(row=>row.irm!=='DNS').length,wins:raw.filter(row=>row.rank===1).length,
      lastRank:entry.rounds.at(-1).sourceRank};
  });
  const compare=(a,b)=>a.points!==b.points?(a.points>b.points?-1:1)
    :b.starts-a.starts||b.wins-a.wins||((a.lastRank??Infinity)===(b.lastRank??Infinity)?0
      :(a.lastRank??Infinity)<(b.lastRank??Infinity)?-1:1);
  const rows=fixture.standings.rows.map((expected,index)=>{
    const entry=entries.find(row=>row.globalRiderId===riderId(fixture,expected.name,expected.nation));
    const source={name:expected.name,sourcePosition:index+1,printedRank:expected.publishedRank};
    if(!entry)return {...source,calculatedRange:null,keys:null,comparison:'missing_participant'};
    const minimum=1+entries.filter(other=>compare(other,entry)<0).length;
    const maximum=minimum+entries.filter(other=>compare(other,entry)===0).length-1;
    return {...source,calculatedRange:{minimum,maximum},
      keys:{points:entry.points.toString(),starts:entry.starts,wins:entry.wins,lastHeldRoundRank:entry.lastRank},
      comparison:expected.publishedRank===null?'blank_printed_rank'
        :expected.publishedRank<minimum||expected.publishedRank>maximum?'outside_individual_rank_range'
          :minimum!==maximum?'unresolved_individual_rank':'matching_unambiguous_printed_rank'};
  });
  const count=comparison=>rows.filter(row=>row.comparison===comparison).length;
  const blankPrintedRanks=count('blank_printed_rank'),outsideIndividualRankRange=count('outside_individual_rank_range');
  const unresolvedIndividualRanks=count('unresolved_individual_rank'),missingParticipants=count('missing_participant');
  return {scope:'offline_rank_label_interpretation_only_not_publication',
    interpretationHypothesis:'printed_label_is_individual_rank_requires_organizer_confirmation',
    status:blankPrintedRanks||outsideIndividualRankRange||unresolvedIndividualRanks||missingParticipants
      ?'requires_source_rank_interpretation':'matching_unambiguous_printed_labels',
    eligibleParticipants:entries.length,sourceRows:rows.length,printedRanks:fixture.standings.rows.filter(row=>row.publishedRank!==null).length,
    matchingUnambiguousPrintedRanks:count('matching_unambiguous_printed_rank'),blankPrintedRanks,
    outsideIndividualRankRange,unresolvedIndividualRanks,missingParticipants,rows};
}

export function superprestigeCotejo(fixture,references) {
  const input=superprestigeCotejoInput(fixture,references),calculation=recomputeCxStandings(input);
  const names=new Map(input.rounds.flatMap(round=>round.results.map(row=>[row.globalRiderId,row.riderDisplay])));
  const official=new Map(fixture.standings.rows.map(row=>[riderId(fixture,row.name,row.nation),row]));
  const entries=new Map(calculation.breakdown.map(row=>[row.globalRiderId,row]));
  const differences=[];let checkedTotals=0,matchingTotals=0,matchingCells=0,matchingRanks=0;
  for(const [id,expected] of official) {
    const entry=entries.get(id);
    if(!entry){differences.push({name:expected.name,field:'missingParticipant'});continue;}
    checkedTotals++;
    const points=entry.rounds.reduce((n,r)=>n+BigInt(r.points)+BigInt(r.bonusPoints),0n).toString();
    if(points===String(expected.points))matchingTotals++;
    else differences.push({name:expected.name,field:'points',official:String(expected.points),calculated:points});
    entry.rounds.forEach((round,index)=>{
      if(round.points===String(expected.roundPoints[index]))matchingCells++;
      else differences.push({name:expected.name,round:index+1,official:String(expected.roundPoints[index]),calculated:round.points});
    });
    if(!entry.eligible)differences.push({name:expected.name,field:'eligibility',official:true,calculated:false});
  }
  for(const entry of calculation.breakdown)if(entry.eligible&&!official.has(entry.globalRiderId))differences.push({field:'extraEligibleParticipant',globalRiderId:entry.globalRiderId});
  for(const row of calculation.rows) {
    const expected=official.get(row.globalRiderId);
    if(expected?.publishedRank==null)continue;
    if(row.rank===expected.publishedRank)matchingRanks++;
    else differences.push({name:expected.name,field:'rank',official:expected.publishedRank,calculated:row.rank});
  }
  const expectedTotals=official.size,expectedCells=expectedTotals*8;
  const unspecifiedPublishedRanks=fixture.standings.rows.filter(row=>row.publishedRank==null).map(row=>row.name);
  const pointsAndCellsMatch=checkedTotals===expectedTotals&&matchingTotals===expectedTotals&&matchingCells===expectedCells
    &&!differences.some(d=>d.field!=='rank');
  const generalMatches=pointsAndCellsMatch&&calculation.status==='ready'&&!differences.length
    &&calculation.rows.length===expectedTotals&&!unspecifiedPublishedRanks.length;
  return {scope:'offline_only_not_edition_activation',seasonKey:fixture.seasonKey,category:fixture.category,engineVersion:calculation.engineVersion,
    status:generalMatches?'matched':'needs_review',pointsEligibilityHypothesis:'awardedAtLeastOnce',
    officialStandingsSourceUrl:fixture.standings.sourceUrl,roundRows:fixture.rounds.map(r=>r.rows.length),identities:input.riders.length,
    states:{dnf:fixture.rounds.reduce((n,r)=>n+r.dnf,0),dns:fixture.rounds.reduce((n,r)=>n+r.dns,0)},
    calculationStatus:calculation.status,issues:calculation.issues.map(issue=>({...issue,
      ...(issue.globalRiderIds?{names:issue.globalRiderIds.map(id=>names.get(id))}:{})})),expectedTotals,expectedCells,checkedTotals,matchingTotals,matchingCells,
    checkedRanks:calculation.rows.filter(row=>official.get(row.globalRiderId)?.publishedRank!=null).length,matchingRanks,
    unspecifiedPublishedRanks,printedRanksAudit:printedRanksAudit(fixture,input,calculation),pointsAndCellsMatch,generalMatches,differences,
    sourceDiscrepancies:fixture.sourceDiscrepancies||[]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const category=process.argv[2]||'ME';
  if(!['ME','WE'].includes(category))throw new Error('Categoría de cotejo no disponible');
  const fixture=JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/superprestige-2025-26-'+category.toLowerCase()+'.json',import.meta.url),'utf8'));
  const report=superprestigeCotejo(fixture,JSON.parse(readFileSync(referencesUrl,'utf8')));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.generalMatches)process.exitCode=2;
}
