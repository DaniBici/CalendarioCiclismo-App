import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {superprestigeCotejo,superprestigeCotejoInput} from '../../scripts/cx/cx-superprestige-cotejo.mjs';

const load=category=>JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/superprestige-2025-26-'+category+'.json',import.meta.url)));
const me=load('me'),we=load('we');
const references=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));

describe('Superprestige 2025–26, cotejo independiente offline',()=>{
  it('compara todos los puntos sin presentar empates pendientes como una general verificada',()=>{
    const before=JSON.stringify({me,we,references});
    for(const [fixture,expected] of [[me,{expectedTotals:38,expectedCells:304,states:{dnf:41,dns:1},identities:222}],
      [we,{expectedTotals:51,expectedCells:408,states:{dnf:16,dns:3},identities:164}]]) {
      const report=superprestigeCotejo(fixture,references);
      expect(report).toMatchObject({...expected,status:'needs_review',calculationStatus:'needs_review',pointsAndCellsMatch:true,generalMatches:false,
        checkedTotals:expected.expectedTotals,matchingTotals:expected.expectedTotals,matchingCells:expected.expectedCells,checkedRanks:0,differences:[]});
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.issues.every(issue=>issue.code==='unresolved_tie'&&issue.names.length===2)).toBe(true);
      expect(report.unspecifiedPublishedRanks.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify({me,we,references})).toBe(before);
    expect(references.references.find(r=>r.tournament==='Superprestige').pointsScheme.status).toBe('reference_requires_edition_review');
    expect(superprestigeCotejo(we,references).sourceDiscrepancies[0]).toMatchObject({htmlSummary:[92,92],independentFinalPdf:[91,91]});
  });
  it('conserva LAP con puesto y DNF/DNS sin puesto; el alias con informe UEC solo genera hashes locales',()=>{
    const input=superprestigeCotejoInput(we,references);
    expect(input.riders.every(r=>r.id.startsWith('offline-')&&r.birthDate===undefined&&r.verified===undefined)).toBe(true);
    const rows=input.rounds.flatMap(r=>r.results);
    expect(rows.filter(r=>r.irm==='DNF')).toHaveLength(16);
    expect(rows.filter(r=>r.irm==='DNS')).toHaveLength(3);
    expect(rows.filter(r=>['DNF','DNS'].includes(r.irm)).every(r=>r.rank===null)).toBe(true);
    expect(rows.some(r=>r.irm==='LAP'&&r.rank>0)).toBe(true);
    expect(new Set(rows.filter(r=>r.riderDisplay==='HLADÍKOVÁ Kateina').map(r=>r.globalRiderId)).size).toBe(1);
    const missingAlias=structuredClone(we);missingAlias.offlineAliases=[];
    const report=superprestigeCotejo(missingAlias,references);
    expect(report.pointsAndCellsMatch).toBe(false);
    expect(report.differences).toContainEqual({name:'Katerina Hladikova',field:'missingParticipant'});
  });
  it('detecta una general alterada aunque los empates ya impidan publicar filas',()=>{
    for(const edit of [f=>f.standings.rows[0].points++,f=>f.standings.rows[0].roundPoints[0]++,f=>f.standings.rows.pop(),
      f=>f.standings.rows[0].name='Nombre distinto']) {
      const changed=structuredClone(me);edit(changed);
      const report=superprestigeCotejo(changed,references);
      expect(report.pointsAndCellsMatch).toBe(false);
      expect(report.generalMatches).toBe(false);
      expect(report.differences.length).toBeGreaterThan(0);
    }
  });
  it('contrasta todas las etiquetas impresas aun cuando un empate impide publicar la general',()=>{
    const before=JSON.stringify({me,we});
    for(const [fixture,counts] of [[me,{sourceRows:38,eligibleParticipants:38,printedRanks:27,
      matchingUnambiguousPrintedRanks:22,blankPrintedRanks:11,outsideIndividualRankRange:4,unresolvedIndividualRanks:1}],
      [we,{sourceRows:51,eligibleParticipants:51,printedRanks:29,
        matchingUnambiguousPrintedRanks:23,blankPrintedRanks:22,outsideIndividualRankRange:5,unresolvedIndividualRanks:1}]]) {
      const report=superprestigeCotejo(fixture,references),audit=report.printedRanksAudit;
      expect(audit).toMatchObject({...counts,status:'requires_source_rank_interpretation',missingParticipants:0,
        interpretationHypothesis:'printed_label_is_individual_rank_requires_organizer_confirmation'});
      expect(audit.rows.map(row=>[row.sourcePosition,row.printedRank])).toEqual(
        fixture.standings.rows.map((row,i)=>[i+1,row.publishedRank]));
      expect(report).toMatchObject({generalMatches:false,checkedRanks:0,pointsAndCellsMatch:true});
    }
    const rows=superprestigeCotejo(me,references).printedRanksAudit.rows;
    expect(rows.find(row=>row.name==='Pim Ronhaar')).toMatchObject({printedRank:17,
      calculatedRange:{minimum:18,maximum:18},comparison:'outside_individual_rank_range'});
    expect(rows.find(row=>row.name==='Michael Boros')).toMatchObject({printedRank:34,
      calculatedRange:{minimum:34,maximum:35},comparison:'unresolved_individual_rank'});
    expect(rows.find(row=>row.name==='Tibor Del Grosso')).toMatchObject({printedRank:null,sourcePosition:12,
      calculatedRange:{minimum:12,maximum:12},comparison:'blank_printed_rank'});
    expect(JSON.stringify({me,we})).toBe(before);
  });
  it('detecta una etiqueta alterada sin confundirla con los puntos o rellenar las celdas vacías',()=>{
    const changed=structuredClone(me);changed.standings.rows[0].publishedRank=2;
    const report=superprestigeCotejo(changed,references);
    expect(report).toMatchObject({pointsAndCellsMatch:true,generalMatches:false,
      printedRanksAudit:{outsideIndividualRankRange:5,matchingUnambiguousPrintedRanks:21,blankPrintedRanks:11}});
    expect(report.printedRanksAudit.rows[0]).toMatchObject({printedRank:2,
      calculatedRange:{minimum:1,maximum:1},comparison:'outside_individual_rank_range'});
  });
  it('cuenta un abandono como salida y excluye un DNS al auditar participaciones',()=>{
    for(const [state,starts] of [['DNF',3],['DNS',2]]) {
      const changed=structuredClone(me),round=changed.rounds.at(-1);
      round.rows.push([null,'999','DEL GROSSO Tibor','NED',state]);
      round.participants++;round[state.toLowerCase()]++;
      const report=superprestigeCotejo(changed,references);
      expect(report.pointsAndCellsMatch).toBe(true);
      expect(report.printedRanksAudit.rows.find(row=>row.name==='Tibor Del Grosso')).toMatchObject({
        printedRank:null,keys:{starts,wins:2,lastHeldRoundRank:null},comparison:'blank_printed_rank'});
    }
  });
  it('conserva la población calculada si falta una fila esperada y no aplica otra escala o desempate',()=>{
    const changed=structuredClone(me);changed.standings.rows.pop();
    expect(superprestigeCotejo(changed,references)).toMatchObject({pointsAndCellsMatch:false,generalMatches:false,
      printedRanksAudit:{sourceRows:37,eligibleParticipants:38}});
    for(const edit of [rule=>rule.tieBreakers.reverse(),rule=>{rule.perRank[0]=16;}]) {
      const altered=structuredClone(references),rule=altered.references.find(r=>r.tournament==='Superprestige').pointsScheme.categories.ME;
      edit(rule);
      expect(superprestigeCotejo(me,altered)).toMatchObject({generalMatches:false,
        printedRanksAudit:{status:'unavailable',rows:[]}});
    }
  });
  it('rechaza filas omitidas, repetidas, estados incompatibles y ámbitos sin evidencia',()=>{
    for(const edit of [f=>f.rounds[0].rows.pop(),f=>f.rounds[0].rows[1][1]=f.rounds[0].rows[0][1],
      f=>f.rounds[0].rows[0][4]='DNF',f=>f.rounds[0].rows.find(r=>r[4]==='DNF')[4]='DNS',
      f=>f.rounds[0].sha256=null,f=>f.rounds[0].category='WE',f=>f.rounds.pop(),
      f=>f.seasonKey='2026-27',f=>f.scope='production',f=>f.standings.rows[0].roundPoints.pop()]) {
      const changed=structuredClone(me);edit(changed);
      expect(()=>superprestigeCotejoInput(changed,references)).toThrow();
    }
    const changed=structuredClone(we);delete changed.offlineAliases[0].evidence.sha256;
    expect(()=>superprestigeCotejoInput(changed,references)).toThrow('Alias local sin evidencia');
  });
});
