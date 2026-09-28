import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {copaEspanaSeasonCotejo,copaEspanaSeasonCotejoInput} from '../../scripts/cx/cx-copa-espana-season-cotejo.mjs';
import {recomputeCxStandings} from '../cx/standings.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/copa-espana-2025.json',import.meta.url)));
const reference=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));

describe('Copa de España 2025, ocho rondas independientes y general RFEC',()=>{
  it('coteja todos los totales y celdas explícitas de ME, WE y MJ sin ocultar empates',()=>{
    const before=JSON.stringify({fixture,reference});
    for(const [category,totals,cells,unspecified] of [['ME',51,183,225],['WE',39,152,160],['MJ',50,212,188]]) {
      const report=copaEspanaSeasonCotejo(fixture,reference,category);
      expect(report).toMatchObject({category,status:'needs_review',calculationStatus:'needs_review',expectedTotals:totals,
        checkedTotals:totals,matchingTotals:totals,expectedKnownCells:cells,matchingKnownCells:cells,unspecifiedCells:unspecified,
        checkedRanks:0,matchingRanks:0,pointsAndKnownCellsMatch:true,fullSeasonGeneralMatches:false,
        sanctionCotejoMatches:false,separateDataRideCategoriesCotejoMatches:false,differences:[]});
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.issues.every(issue=>issue.code==='unresolved_tie')).toBe(true);
      expect(report.roundRows).toHaveLength(8);
    }
    expect(JSON.stringify({fixture,reference})).toBe(before);
    expect(reference.references.find(row=>row.tournament==='Copa de España').pointsScheme.status).toBe('reference_requires_edition_review');
  });
  it('conserva el DNF de Vilouta y la contradicción independiente de dos puntos RFEC',()=>{
    const report=copaEspanaSeasonCotejo(fixture,reference,'WJ');
    expect(report).toMatchObject({expectedTotals:35,matchingTotals:34,expectedKnownCells:139,matchingKnownCells:138,
      pointsAndKnownCellsMatch:false,fullSeasonGeneralMatches:false,status:'needs_review',differences:[
        {name:'VILOUTA RODRIGUEZ, CARLA',field:'points',official:'2',calculated:'0'},
        {name:'VILOUTA RODRIGUEZ, CARLA',field:'roundPoints',round:2,official:'2',calculated:'0'},
        {name:'VILOUTA RODRIGUEZ, CARLA',field:'eligibility',official:true,calculated:false}]});
    const input=copaEspanaSeasonCotejoInput(fixture,reference,'WJ');
    expect(input.rounds[1].results.find(row=>row.riderDisplay.includes('VILOUTA'))).toMatchObject({rank:null,irm:'DNF'});
    expect(report.sourceDiscrepancies[0].evidence).toMatchObject({placedRows:13,dnfRows:1,dnfBib:'14'});
    // La posición ordinal del listado no permite transformar una retirada en puesto 14.
    const changed=structuredClone(fixture),source=changed.rounds[1].categories.find(row=>row.category==='WJ');
    const row=source.rows.find(row=>row[2].includes('VILOUTA'));row[0]=14;row[3]=null;
    source.enumeratedCounts={placed:14,dnf:0,dns:0};
    expect(()=>copaEspanaSeasonCotejoInput(changed,reference,'WJ')).toThrow('Discrepancia sin contraste independiente');
  });
  it('no convierte vacíos RFEC en puntos cero ni les atribuye DNS',()=>{
    const changed=structuredClone(fixture),row=changed.categories[0].standings.find(row=>row.roundPoints.includes(0));
    row.roundPoints[row.roundPoints.indexOf(0)]=null;
    expect(copaEspanaSeasonCotejo(changed,reference,'ME')).toMatchObject({pointsAndKnownCellsMatch:true,
      expectedKnownCells:182,matchingKnownCells:182,unspecifiedCells:226,fullSeasonGeneralMatches:false});
    const award=structuredClone(fixture);award.categories[0].standings[0].roundPoints[0]=null;
    expect(copaEspanaSeasonCotejo(award,reference,'ME')).toMatchObject({pointsAndKnownCellsMatch:false,
      differences:expect.arrayContaining([expect.objectContaining({field:'awardWithoutPublishedCell',round:1})])});
    expect(copaEspanaSeasonCotejo(fixture,reference,'ME').dnsRowsNotEnumerated).toEqual([0,null,null,0,6,null,2,7]);
  });
  it('detecta cambios de puntos, identidad o pertenencia de la general completa',()=>{
    for(const edit of [f=>f.categories[0].standings[0].points++,f=>f.categories[0].standings[0].roundPoints[0]++,
      f=>f.categories[0].standings[0].name='Otro corredor',f=>f.categories[0].standings.pop()]) {
      const changed=structuredClone(fixture);edit(changed);
      expect(copaEspanaSeasonCotejo(changed,reference,'ME')).toMatchObject({pointsAndKnownCellsMatch:false,fullSeasonGeneralMatches:false});
    }
    const changed=structuredClone(fixture),rows=changed.rounds[0].categories[0].rows;
    [rows[0][2],rows[1][2]]=[rows[1][2],rows[0][2]];
    expect(copaEspanaSeasonCotejo(changed,reference,'ME').pointsAndKnownCellsMatch).toBe(false);
  });
  it('rechaza fuentes, categorías, fechas, estados, duplicados y rondas incompletas',()=>{
    for(const edit of [f=>f.rounds.pop(),f=>f.rounds[0].dateKey='2025-10-06',f=>f.rounds[1].roundColumn=1,
      f=>f.rounds[0].officialRoundTitle='Otra prueba',
      f=>f.rounds[0].categories[0].sha256=null,f=>f.calendarHtmlSha256=null,f=>f.rounds[0].categories[0].rows.pop(),
      f=>f.rounds[0].categories[0].rows[1][1]=f.rounds[0].categories[0].rows[0][1],
      f=>f.rounds[0].categories[0].rows[1][0]=1,f=>f.categories[0].officialCompetitionCategory='SUB23',
      f=>f.scope='production',f=>f.seasonKey='2026-27',f=>f.offlineAliases.push({from:'foo',to:'bar'}),
      f=>f.sourceDiscrepancies[0].evidence.sha256=null]) {
      const changed=structuredClone(fixture);edit(changed);
      expect(()=>copaEspanaSeasonCotejoInput(changed,reference,'ME')).toThrow();
    }
    expect(()=>copaEspanaSeasonCotejoInput(fixture,reference,'MU')).toThrow();
    const input=copaEspanaSeasonCotejoInput(fixture,reference,'ME');
    expect(input.riders.every(row=>row.id.startsWith('offline-')&&row.birthDate===undefined)).toBe(true);
    delete input.rounds[0].manga.resultsEvidence;
    expect(recomputeCxStandings(input)).toMatchObject({status:'needs_review',issues:expect.arrayContaining([
      expect.objectContaining({message:'Falta la clasificación oficial de categoría; no usar el puesto de la manga agrupada'})])});
  });
});
