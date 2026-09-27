import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx-standings.js';

const categories={ME:'ELITE-SUB23',WE:'FEM ELITE-SUB23',MJ:'JUNIOR',WJ:'FEM JUNIOR'};
const dates=['2025-10-05','2025-10-12','2025-11-01','2025-11-02','2025-11-16','2025-11-23','2025-12-06','2025-12-07'];
const norm=name=>name.toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu,'').replaceAll(',',' ').trim().split(/\s+/).sort().join(' ');
const id=name=>'offline-'+createHash('sha256').update(norm(name)).digest('hex').slice(0,24);
const evidence=(url,hash)=>/^https:\/\//.test(url||'')&&/^[a-f0-9]{64}$/.test(hash||'');

function validate(fixture,category) {
  if(fixture.schemaVersion!==1||fixture.scope!=='offline_full_rounds_cotejo_not_edition_activation'
    ||fixture.seasonKey!=='2025-26'||!categories[category]
    ||!evidence(fixture.rulesSourceUrl,fixture.rulesSha256)||!evidence(fixture.calendarSourceUrl,fixture.calendarHtmlSha256)
    ||JSON.stringify(fixture.roundColumns)!==JSON.stringify(['rank','bib','name','irm','sourcePosition'])
    ||fixture.rounds?.length!==8||fixture.offlineAliases?.length!==0||!Array.isArray(fixture.sourceDiscrepancies)
    ||fixture.standingsRoundTitles?.length!==8||new Set(fixture.standingsRoundTitles).size!==8)throw new Error('Manifiesto de temporada incompatible');
  for(const [index,round] of fixture.rounds.entries()) {
    const source=round.categories?.find(row=>row.category===category);
    if(round.dateKey!==dates[index]||round.roundColumn!==index+1||!round.name?.trim()
      ||round.officialRoundTitle!==fixture.standingsRoundTitles[index]
      ||round.categories?.length!==4||new Set(round.categories.map(c=>c.category)).size!==4
      ||!source||source.officialCompetitionCategory!==categories[category]||!source.rows?.length
      ||!['pdf','html'].includes(source.format)||!evidence(source.sourceUrl,source.sha256))throw new Error('Ronda incompleta o sin fuente');
    const bibs=new Set(),names=new Set();let placed=0,dnf=0,dns=0;
    for(const row of source.rows) {
      const [rank,bib,name,irm,sourcePosition]=row;
      if(row.length!==5||!/^\d+$/.test(bib||'')||!name?.trim()||bibs.has(bib)||names.has(norm(name))
        ||rank!=null&&(!Number.isInteger(rank)||rank!==++placed||![null,'LAP'].includes(irm)||sourcePosition!==rank)
        ||rank==null&&(!['DNF','DNS'].includes(irm)||!(sourcePosition===irm||Number.isInteger(sourcePosition)&&sourcePosition>0)))throw new Error('Puesto, dorsal, nombre o estado inválido');
      bibs.add(bib);names.add(norm(name));dnf+=irm==='DNF'?1:0;dns+=irm==='DNS'?1:0;
    }
    if(placed!==source.enumeratedCounts?.placed||dnf!==source.enumeratedCounts?.dnf||dns!==source.enumeratedCounts?.dns
      ||source.sourceSummary?.Clasificados!=null&&source.sourceSummary.Clasificados!==placed
      ||source.sourceSummary?.DNF!=null&&source.sourceSummary.DNF!==dnf
      ||source.sourceSummary?.DNS!=null&&source.sourceSummary.DNS<dns)throw new Error('Recuento distinto de la clasificación');
  }
  for(const discrepancy of fixture.sourceDiscrepancies) {
    const source=fixture.rounds[discrepancy.roundColumn-1]?.categories?.find(row=>row.category===discrepancy.category);
    const row=source?.rows.find(row=>norm(row[2])===norm(discrepancy.name));
    if(!row||row[0]!==null||row[3]!==discrepancy.roundState
      ||!evidence(discrepancy.evidence?.sourceUrl,discrepancy.evidence?.sha256)
      ||source.enumeratedCounts.placed!==discrepancy.evidence.placedRows
      ||source.enumeratedCounts.dnf!==discrepancy.evidence.dnfRows)throw new Error('Discrepancia sin contraste independiente');
  }
  const source=fixture.categories?.find(row=>row.category===category),names=new Set(),ranks=new Set();
  if(!source?.standings?.length||source.officialCompetitionCategory!==categories[category]
    ||!evidence(source.standingsSourceUrl,source.standingsHtmlSha256))throw new Error('General sin fuente');
  for(const row of source.standings) {
    if(!row.name?.trim()||names.has(norm(row.name))||!Number.isInteger(row.points)||row.points<0
      ||!Number.isInteger(row.publishedGeneralRank)||row.publishedGeneralRank<1||ranks.has(row.publishedGeneralRank)
      ||row.roundPoints?.length!==8||row.roundPoints.some(point=>point!==null&&(!Number.isInteger(point)||point<0)))throw new Error('General oficial inválida');
    names.add(norm(row.name));ranks.add(row.publishedGeneralRank);
  }
}

// Hipótesis de cálculo limitada al cotejo offline de las categorías oficiales RFEC.
export function copaEspanaSeasonCotejoInput(fixture,reference,category) {
  validate(fixture,category);
  const source=fixture.categories.find(row=>row.category===category);
  const scheme=structuredClone(reference.references.find(row=>row.tournament==='Copa de España')?.pointsScheme);
  if(!scheme?.categories?.[category])throw new Error('Referencia de categoría ausente');
  scheme.status='verified';scheme.edition={seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt};scheme.sourceUrls=[fixture.rulesSourceUrl];
  scheme.categories={[category]:scheme.categories[category]};
  scheme.categories[category].review={sourceUrl:fixture.rulesSourceUrl,cotejoUrl:source.standingsSourceUrl,pointsEligibilityPolicy:'awardedAtLeastOnce'};
  const tournamentId='offline-copa-espana-season-'+category,riders=new Map();
  const rounds=fixture.rounds.map((round,index)=>{
    const source=round.categories.find(row=>row.category===category),raceId=tournamentId+'-'+(index+1);
    return {race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:round.dateKey,editorialStatus:'published'},
      manga:{category,dateKey:round.dateKey,resultsStatus:'official',resultsSourceUrl:source.sourceUrl,
        resultsEvidence:{rankScope:'officialCategory',categoryClassificationSourceUrl:source.sourceUrl}},
      results:source.rows.map(([rank,bib,name,irm])=>{
        const globalRiderId=id(name);riders.set(globalRiderId,{id:globalRiderId});
        return {raceId,category,rank,bib,riderDisplay:name,globalRiderId,irm};
      })};
  });
  return {tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:scheme},category,riders:[...riders.values()],rounds};
}

export function copaEspanaSeasonCotejo(fixture,reference,category) {
  const input=copaEspanaSeasonCotejoInput(fixture,reference,category),calculation=recomputeCxStandings(input);
  const source=fixture.categories.find(row=>row.category===category),official=new Map(source.standings.map(row=>[id(row.name),row]));
  const entries=new Map(calculation.breakdown.map(row=>[row.globalRiderId,row]));
  const names=new Map(input.rounds.flatMap(round=>round.results.map(row=>[row.globalRiderId,row.riderDisplay])));
  const differences=[];let checkedTotals=0,matchingTotals=0,checkedKnownCells=0,matchingKnownCells=0,unspecifiedCells=0,matchingRanks=0;
  for(const [key,row] of official) {
    const entry=entries.get(key);
    if(!entry){differences.push({name:row.name,field:'missingParticipant'});continue;}
    checkedTotals++;
    const points=entry.rounds.reduce((n,r)=>n+BigInt(r.points)+BigInt(r.bonusPoints),0n).toString();
    if(points===String(row.points))matchingTotals++;
    else differences.push({name:row.name,field:'points',official:String(row.points),calculated:points});
    entry.rounds.forEach((round,index)=>{
      const expected=row.roundPoints[index];
      if(expected===null) {
        unspecifiedCells++;
        // NULL no se transforma en cero; un premio calculado sin celda publicada sí es una diferencia.
        if(BigInt(round.points)+BigInt(round.bonusPoints)!==0n)differences.push({name:row.name,field:'awardWithoutPublishedCell',round:index+1,calculated:round.points});
        return;
      }
      checkedKnownCells++;
      if(round.points===String(expected))matchingKnownCells++;
      else differences.push({name:row.name,field:'roundPoints',round:index+1,official:String(expected),calculated:round.points});
    });
    if(!entry.eligible)differences.push({name:row.name,field:'eligibility',official:true,calculated:false});
  }
  for(const entry of calculation.breakdown)if(entry.eligible&&!official.has(entry.globalRiderId))differences.push({field:'extraEligibleParticipant',globalRiderId:entry.globalRiderId});
  for(const row of calculation.rows) {
    const expected=official.get(row.globalRiderId);
    if(!expected)continue;
    if(row.rank===expected.publishedGeneralRank)matchingRanks++;
    else differences.push({name:expected.name,field:'rank',official:expected.publishedGeneralRank,calculated:row.rank});
  }
  const expectedKnownCells=source.standings.reduce((n,r)=>n+r.roundPoints.filter(p=>p!==null).length,0);
  const pointsAndKnownCellsMatch=checkedTotals===official.size&&matchingTotals===official.size
    &&checkedKnownCells===expectedKnownCells&&matchingKnownCells===expectedKnownCells&&!differences.some(d=>d.field!=='rank');
  const fullSeasonGeneralMatches=pointsAndKnownCellsMatch&&calculation.status==='ready'
    &&calculation.rows.length===official.size&&matchingRanks===official.size&&!differences.length;
  return {scope:fixture.scope,category,officialCompetitionCategory:source.officialCompetitionCategory,engineVersion:calculation.engineVersion,
    status:fullSeasonGeneralMatches?'matched':'needs_review',pointsEligibilityHypothesis:'awardedAtLeastOnce',
    calculationStatus:calculation.status,issues:calculation.issues.map(issue=>({...issue,
      ...(issue.globalRiderIds?{names:issue.globalRiderIds.map(key=>names.get(key))}:{})})),
    roundRows:input.rounds.map(round=>round.results.length),identities:input.riders.length,
    expectedTotals:official.size,checkedTotals,matchingTotals,expectedKnownCells,checkedKnownCells,matchingKnownCells,unspecifiedCells,
    checkedRanks:calculation.rows.filter(row=>official.has(row.globalRiderId)).length,matchingRanks,pointsAndKnownCellsMatch,fullSeasonGeneralMatches,
    sanctionCotejoMatches:false,separateDataRideCategoriesCotejoMatches:false,
    dnsRowsNotEnumerated:fixture.rounds.map(round=>{
      const source=round.categories.find(row=>row.category===category);
      return source.sourceSummary.DNS==null?null:source.sourceSummary.DNS-source.enumeratedCounts.dns;
    }),officialStandingsSourceUrl:source.standingsSourceUrl,differences,
    sourceDiscrepancies:fixture.sourceDiscrepancies?.filter(row=>row.category===category)||[],limitations:fixture.limitations};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const fixture=JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/copa-espana-2025.json',import.meta.url),'utf8'));
  const reference=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url),'utf8'));
  const reports=Object.keys(categories).map(category=>copaEspanaSeasonCotejo(fixture,reference,category));
  process.stdout.write(JSON.stringify(reports,null,2)+'\n');
  if(reports.some(report=>!report.fullSeasonGeneralMatches||!report.sanctionCotejoMatches||!report.separateDataRideCategoriesCotejoMatches))process.exitCode=2;
}
