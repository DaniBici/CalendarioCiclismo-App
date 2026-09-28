import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recomputeCxStandings} from '../../js/cx/standings.js';

const norm=name=>name.toLowerCase().normalize('NFKD').replace(/\p{Mark}/gu,'').replaceAll(',',' ').trim().split(/\s+/).sort().join(' ');
const id=name=>'offline-'+createHash('sha256').update(norm(name)).digest('hex').slice(0,24);
const categories={ME:'ELITE-SUB23',WE:'FEM ELITE-SUB23',MJ:'JUNIOR',WJ:'FEM JUNIOR'};
const evidence=(url,hash)=>/^https:\/\//.test(url||'')&&/^[a-f0-9]{64}$/.test(hash||'');

// Correspondencia de fuentes de una sola ronda; no combina fichas ni separa puestos por edad.
export function copaEspanaDataRideMapping(fixture,category) {
  if(!['ME','WE'].includes(category))return {status:'not_applicable_grouped_case_only',officialCategoryMappingMatches:false};
  const proof=fixture.dataRideEvidence;
  if(!proof)return {status:'missing',officialCategoryMappingMatches:false};
  const source=fixture.categories?.find(row=>row.category===category),cat=proof.categories?.find(row=>row.category===category);
  const meta=cat?.dataRide,fail=()=>{throw new Error('Correspondencia DataRide agrupada sin evidencia íntegra');};
  if(fixture.seasonKey!=='2025-26'||fixture.dateKey!=='2025-11-16'||proof.scope!=='offline_alcobendas_grouped_categories_only'
    ||proof.disciplineId!==3||proof.competitionId!==75840||proof.seasonId!==455||proof.excludedRaceCount!==0
    ||!Number.isFinite(Date.parse(proof.fetchedAt))||proof.sourceUrl!=='https://dataride.uci.ch/iframe/Results/'
    ||!evidence(proof.sourceUrl,proof.normalizedDataRideSha256)
    ||JSON.stringify(proof.availableCategories?.slice().sort())!==JSON.stringify(['ME','MJ','WE','WJ'])
    ||JSON.stringify(proof.resultColumns)!==JSON.stringify(['rank','bib','name','isoCode2','birthDate','irm'])
    ||JSON.stringify(proof.categories?.map(row=>row.category).sort())!==JSON.stringify(['ME','WE'])||!source||!cat?.rows?.length
    ||meta?.disciplineId!==3||meta.competitionId!==75840||meta.seasonId!==455
    ||meta.uciRaceId!==(category==='ME'?244239:244241)||meta.eventId!==(category==='ME'?352472:352474)
    ||cat.projectionSha256!==createHash('sha256').update(JSON.stringify({dataRide:cat.dataRide,rows:cat.rows})).digest('hex'))fail();
  const byBib=new Map(),names=new Set(),ranks=new Set();
  for(const row of cat.rows){
    const [rank,bib,name,isoCode2,birthDate,irm]=row;
    if(row.length!==6||!/^\d+$/.test(bib||'')||!name?.trim()||isoCode2!=='ES'||byBib.has(bib)||names.has(norm(name))
      ||!/^\d{4}-\d{2}-\d{2}$/.test(birthDate||'')||!Number.isFinite(Date.parse(birthDate+'T00:00:00Z'))
      ||new Date(birthDate+'T00:00:00Z').toISOString().slice(0,10)!==birthDate
      ||rank!==null&&(!Number.isInteger(rank)||rank<1||ranks.has(rank)||![null,'LAP'].includes(irm))
      ||rank===null&&!['DNF','DNS'].includes(irm))fail();
    byBib.set(bib,row);names.add(norm(name));if(rank!==null)ranks.add(rank);
  }
  const differences=[],officialBibs=new Set(source.rows.map(row=>row[1]));
  let matchedRows=0,matchedS23Rows=0,matchedClassifiedS23Rows=0;
  for(const [rank,bib,name,nation,license,irm] of source.rows){
    const actual=byBib.get(bib),age=actual?2026-Number(actual[4].slice(0,4)):null;
    const licenseFromSource=age>=23?'ELT':age>=19?'S23':null;
    if(!actual||actual[0]!==rank||norm(actual[2])!==norm(name)||nation!=='ESP'||actual[5]!==irm||licenseFromSource!==license){
      differences.push({bib,official:{rank,name,license,irm},dataRide:actual||null});continue;
    }
    matchedRows++;if(license==='S23'){matchedS23Rows++;if(rank!==null)matchedClassifiedS23Rows++;}
  }
  const additionalRows=cat.rows.filter(row=>!officialBibs.has(row[1]));
  for(const row of additionalRows)if(row[5]!=='DNS')differences.push({field:'additionalNonDnsRow',dataRide:row});
  const additionalNamedDns=additionalRows.filter(row=>row[5]==='DNS').map(row=>({bib:row[1],name:row[2]}));
  if(additionalNamedDns.length>source.summary.DNS)differences.push({field:'dnsCount',officialSummary:source.summary.DNS,additionalDataRide:additionalNamedDns.length});
  const matches=matchedRows===source.rows.length&&!differences.length;
  return {scope:proof.scope,status:matches?'matched':'needs_review',officialCategoryMappingMatches:matches,
    sourceCategory:category,officialCompetitionCategory:source.officialCompetitionCategory,officialRows:source.rows.length,
    dataRideRows:cat.rows.length,matchedRows,matchedS23Rows,matchedClassifiedS23Rows,additionalNamedDns,
    publishedDnsSummary:source.summary.DNS,unidentifiedDnsFromSummary:Math.max(0,source.summary.DNS-additionalNamedDns.length),differences};
}

// Usa la categoría de competición RFEC publicada, sin renumerar por licencia.
export function copaEspanaCotejoInput(fixture,reference,category) {
  const source=fixture.categories?.find(row=>row.category===category);
  if(fixture.schemaVersion!==1||fixture.scope!=='offline_single_round_points_not_full_season_cotejo'
    ||fixture.seasonKey!=='2025-26'||fixture.dateKey!=='2025-11-16'
    ||!evidence(fixture.rulesSourceUrl,fixture.rulesSha256)||!source
    ||source.officialCompetitionCategory!==categories[category]||source.roundColumn!==5
    ||!evidence(source.roundSourceUrl,source.roundSha256)||!evidence(source.standingsSourceUrl,source.standingsHtmlSha256)
    ||!source.standings?.length||!source.rows?.length)throw new Error('Manifiesto de cotejo incompatible');
  const bibs=new Set(),names=new Set();let placed=0,dnf=0;
  for(const [rank,bib,name,nation,license,irm] of source.rows) {
    if(!/^\d+$/.test(bib||'')||!name?.trim()||nation!=='ESP'||!['ELT','S23','Jun'].includes(license)
      ||bibs.has(bib)||names.has(norm(name))||rank!=null&&(rank!==++placed||![null,'LAP'].includes(irm))
      ||rank==null&&irm!=='DNF')throw new Error('Fila de clasificación incompleta o repetida');
    bibs.add(bib);names.add(norm(name));dnf+=irm==='DNF'?1:0;
  }
  if(placed<15||placed!==source.summary.Clasificados||dnf!==source.summary.DNF)throw new Error('Recuento distinto del PDF');
  names.clear();
  for(const row of source.standings) {
    if(!row.name?.trim()||names.has(norm(row.name))||row.roundPoints?.length!==8
      ||row.roundPoints.some(point=>point!==null&&(!Number.isInteger(point)||point<0)))throw new Error('Columna RFEC inválida');
    names.add(norm(row.name));
  }
  const scheme=structuredClone(reference.references.find(row=>row.tournament==='Copa de España').pointsScheme);
  scheme.status='verified';scheme.edition={seasonKey:fixture.seasonKey,reviewedAt:fixture.checkedAt};scheme.sourceUrls=[fixture.rulesSourceUrl];
  scheme.categories={[category]:scheme.categories[category]};
  scheme.categories[category].review={sourceUrl:fixture.rulesSourceUrl,cotejoUrl:source.standingsSourceUrl,pointsEligibilityPolicy:'awardedAtLeastOnce'};
  const tournamentId='offline-copa-espana-'+category,raceId=tournamentId+'-alcobendas';
  const results=source.rows.map(([rank,bib,name,_nation,_license,irm])=>({raceId,category,rank,bib,riderDisplay:name,globalRiderId:id(name),irm}));
  return {tournament:{id:tournamentId,seasonKey:fixture.seasonKey,pointsScheme:scheme},category,riders:results.map(row=>({id:row.globalRiderId})),
    rounds:[{race:{id:raceId,tournamentId,seasonKey:fixture.seasonKey,dateKey:fixture.dateKey,editorialStatus:'published'},
      manga:{category,dateKey:fixture.dateKey,resultsStatus:'official',resultsSourceUrl:source.roundSourceUrl,
        resultsEvidence:{rankScope:'officialCategory',categoryClassificationSourceUrl:source.roundSourceUrl}},results}]};
}

export function copaEspanaCotejo(fixture,reference,category) {
  const input=copaEspanaCotejoInput(fixture,reference,category),calculation=recomputeCxStandings(input);
  const source=fixture.categories.find(row=>row.category===category),column=source.roundColumn-1;
  const expected=new Map(source.standings.filter(row=>row.roundPoints[column]>0).map(row=>[id(row.name),row]));
  const calculated=new Map(calculation.rows.map(row=>[row.globalRiderId,row])),differences=[];let matchingPoints=0;
  for(const [key,row] of expected) {
    const actual=calculated.get(key),points=String(row.roundPoints[column]);
    if(actual?.points===points)matchingPoints++;
    else differences.push({name:row.name,official:points,calculated:actual?.points??null});
  }
  for(const [key,row] of calculated)if(!expected.has(key))differences.push({name:row.riderDisplay,field:'extraParticipant',points:row.points});
  const roundPointsMatch=calculation.status==='ready'&&expected.size===15&&matchingPoints===15&&!differences.length;
  return {scope:fixture.scope,category,officialCompetitionCategory:source.officialCompetitionCategory,engineVersion:calculation.engineVersion,
    status:roundPointsMatch?'partial':'needs_review',calculationStatus:calculation.status,issues:calculation.issues,
    roundRows:source.rows.length,expectedRewardedRows:expected.size,matchingPoints,roundPointsMatch,
    fullSeasonGeneralMatches:false,sanctionCotejoMatches:false,dataRideOfficialCategoryMapping:copaEspanaDataRideMapping(fixture,category),dnsRowsNotPublished:source.summary.DNS,
    officialStandingsSourceUrl:source.standingsSourceUrl,roundColumn:source.roundColumn,differences,limitations:fixture.limitations};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const fixture=JSON.parse(readFileSync(new URL('../../js/__tests__/fixtures/cx-cotejos/copa-espana-alcobendas-2025.json',import.meta.url),'utf8'));
  const reference=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url),'utf8'));
  process.stdout.write(JSON.stringify(Object.keys(categories).map(category=>copaEspanaCotejo(fixture,reference,category)),null,2)+'\n');
  process.exitCode=2; // Este alcance parcial nunca acredita el cierre íntegro de F5.
}
