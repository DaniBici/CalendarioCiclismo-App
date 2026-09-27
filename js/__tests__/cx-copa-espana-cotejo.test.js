import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {copaEspanaCotejo,copaEspanaCotejoInput,copaEspanaDataRideMapping} from '../../scripts/cx/cx-copa-espana-cotejo.mjs';
import {recomputeCxStandings} from '../cx-standings.js';

const fixture=JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/copa-espana-alcobendas-2025.json',import.meta.url)));
const reference=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));
const rehash=cat=>{cat.projectionSha256=createHash('sha256').update(JSON.stringify({dataRide:cat.dataRide,rows:cat.rows})).digest('hex');};

describe('Copa de España, Alcobendas 2025, puestos oficiales y columna independiente RFEC',()=>{
  it('compara cuatro categorías sin acreditar una general completa ni sanciones particulares',()=>{
    const before=JSON.stringify({fixture,reference});
    for(const category of ['ME','WE','MJ','WJ'])expect(copaEspanaCotejo(fixture,reference,category)).toMatchObject({category,
      status:'partial',calculationStatus:'ready',issues:[],expectedRewardedRows:15,matchingPoints:15,roundPointsMatch:true,
      fullSeasonGeneralMatches:false,sanctionCotejoMatches:false,differences:[]});
    expect(JSON.stringify({fixture,reference})).toBe(before);
    expect(reference.references.find(row=>row.tournament==='Copa de España').pointsScheme.status).toBe('reference_requires_edition_review');
    expect(fixture.categories.map(row=>row.summary.DNS)).toEqual([6,1,3,1]);
  });
  it('conserva los puestos Élite–Sub23 de RFEC y exige evidencia de categoría',()=>{
    const input=copaEspanaCotejoInput(fixture,reference,'ME'),calculation=recomputeCxStandings(input);
    expect(calculation.rows.find(row=>row.riderDisplay==='MIRA BONASTRE Raul')).toMatchObject({rank:2,points:'20'});
    const female=recomputeCxStandings(copaEspanaCotejoInput(fixture,reference,'WE'));
    expect(female.rows.find(row=>row.riderDisplay==='LOPEZ BURGOS Ana')).toMatchObject({rank:4,points:'14'});
    expect(input.riders.every(row=>row.id.startsWith('offline-')&&row.birthDate===undefined)).toBe(true);
    delete input.rounds[0].manga.resultsEvidence;
    expect(recomputeCxStandings(input)).toMatchObject({status:'needs_review',rows:[],issues:expect.arrayContaining([
      expect.objectContaining({message:'Falta la clasificación oficial de categoría; no usar el puesto de la manga agrupada'})])});
  });
  it('detecta una celda, identidad o pertenencia cambiada en la general independiente',()=>{
    for(const edit of [f=>f.categories[0].standings[0].roundPoints[4]++,f=>f.categories[0].standings[0].name='Otro nombre',
      f=>f.categories[0].standings.splice(0,1)]) {
      const changed=structuredClone(fixture);edit(changed);
      const report=copaEspanaCotejo(changed,reference,'ME');
      expect(report.roundPointsMatch).toBe(false);
      expect(report.fullSeasonGeneralMatches).toBe(false);
    }
    const changed=structuredClone(fixture);changed.categories[0].standings.pop();
    // Esta fila no ganó puntos en P5 y no interviene en el cotejo de esta ronda.
    expect(copaEspanaCotejo(changed,reference,'ME')).toMatchObject({roundPointsMatch:true,fullSeasonGeneralMatches:false});
  });
  it('rechaza rondas incompletas, categorías ajenas y ausencia de fuentes',()=>{
    for(const edit of [f=>f.categories[0].rows.pop(),f=>f.categories[0].rows[1][1]=f.categories[0].rows[0][1],
      f=>f.categories[0].roundSha256=null,f=>f.categories[0].roundColumn=1,
      f=>f.categories[0].officialCompetitionCategory='SUB23',f=>f.scope='production',f=>f.seasonKey='2026-27']) {
      const changed=structuredClone(fixture);edit(changed);
      expect(()=>copaEspanaCotejoInput(changed,reference,'ME')).toThrow();
    }
    expect(()=>copaEspanaCotejoInput(fixture,reference,'MU')).toThrow();
  });
  it('contrasta las categorías agrupadas ME/WE con DataRide sin renumerar ni añadir DNS al PDF',()=>{
    const before=JSON.stringify(fixture),me=copaEspanaCotejo(fixture,reference,'ME'),we=copaEspanaCotejo(fixture,reference,'WE');
    expect(me.dataRideOfficialCategoryMapping).toMatchObject({status:'matched',officialCategoryMappingMatches:true,
      officialRows:38,dataRideRows:40,matchedRows:38,matchedS23Rows:20,matchedClassifiedS23Rows:19,
      publishedDnsSummary:6,unidentifiedDnsFromSummary:4,differences:[]});
    expect(we.dataRideOfficialCategoryMapping).toMatchObject({status:'matched',officialCategoryMappingMatches:true,
      officialRows:23,dataRideRows:24,matchedRows:23,matchedS23Rows:13,matchedClassifiedS23Rows:12,
      publishedDnsSummary:1,unidentifiedDnsFromSummary:0,differences:[]});
    expect(me.dataRideOfficialCategoryMapping.additionalNamedDns.map(row=>row.bib)).toEqual(['20','39']);
    expect(we.dataRideOfficialCategoryMapping.additionalNamedDns.map(row=>row.bib)).toEqual(['404']);
    expect(copaEspanaCotejo(fixture,reference,'MJ').dataRideOfficialCategoryMapping.status).toBe('not_applicable_grouped_case_only');
    expect(JSON.stringify(fixture)).toBe(before);
    expect(copaEspanaCotejoInput(fixture,reference,'ME').rounds[0].results).toHaveLength(38);
  });
  it('detecta un puesto o una edad que convierta artificialmente el grupo en una clasificación separada',()=>{
    for(const edit of [cat=>{[cat.rows[1][0],cat.rows[2][0]]=[3,2];},cat=>{cat.rows[1][4]='2003-01-10';}]){
      const changed=structuredClone(fixture),cat=changed.dataRideEvidence.categories[0];edit(cat);rehash(cat);
      const report=copaEspanaCotejo(changed,reference,'ME');
      expect(report.roundPointsMatch).toBe(true); // La columna RFEC sigue siendo independiente.
      expect(report.dataRideOfficialCategoryMapping).toMatchObject({status:'needs_review',officialCategoryMappingMatches:false});
      expect(report.fullSeasonGeneralMatches).toBe(false);
    }
  });
  it('impide aceptar eventos falsos, fuentes incompletas, nacimientos imposibles y una manga MU añadida',()=>{
    for(const edit of [f=>f.dataRideEvidence.categories[0].rows[0][0]=2,
      f=>{f.dataRideEvidence.categories[0].dataRide.eventId++;rehash(f.dataRideEvidence.categories[0]);},
      f=>f.dataRideEvidence.availableCategories.push('MU'),f=>f.dataRideEvidence.excludedRaceCount=1,
      f=>delete f.dataRideEvidence.normalizedDataRideSha256,f=>f.dataRideEvidence.seasonId=472,
      f=>{f.dataRideEvidence.categories[0].rows[1][4]='2004-02-30';rehash(f.dataRideEvidence.categories[0]);}]){
      const changed=structuredClone(fixture);edit(changed);
      expect(()=>copaEspanaDataRideMapping(changed,'ME')).toThrow('evidencia íntegra');
    }
    const missing=structuredClone(fixture);delete missing.dataRideEvidence;
    expect(copaEspanaDataRideMapping(missing,'ME')).toEqual({status:'missing',officialCategoryMappingMatches:false});
  });
});
