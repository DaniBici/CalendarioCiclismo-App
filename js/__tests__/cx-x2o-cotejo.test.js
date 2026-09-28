import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {x2oCotejo,x2oCotejoInput} from '../../scripts/cx/cx-x2o-cotejo.mjs';

const load = (category='ME') => JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/x2o-2025-26-'+category.toLowerCase()+'.json',import.meta.url),'utf8'));
const references = JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url),'utf8'));
const isolatedWe = () => {
  const fixture = load('WE');
  fixture.identityMethod = 'published_uci_ids_with_isolated_unresolved_identifiers_offline_only';
  fixture.unresolvedIdentities = [{context:'20251116_x2o',bib:35,publishedIdentifier:'16071',name:'WORST Annemarie'}];
  delete fixture.identityAliases;
  return fixture;
};
const rehashProjection = wrapper => {
  wrapper.projectionSha256 = createHash('sha256').update(JSON.stringify(wrapper.projection)).digest('hex');
};

describe('Cotejo oficial X2O ME 2025–26',() => {
  it('conserva las diferencias reales de general aunque todos los bonos coincidan',() => {
    const fixture = load(), before = JSON.stringify(references), report = x2oCotejo(fixture,references,{forfaitBonusesPolicy:'retain'});
    expect(report).toMatchObject({bonusesMatch:true,matchingTotals:110,matchingCells:887,officialTotals:111,
      officialCells:888,rankedRows:58,matchingRanks:55,timeTotalsAndCellsMatch:false,generalMatches:false,status:'needs_review'});
    expect(report.excludedByRegulationButPresentInOfficialRanking).toHaveLength(53);
    expect(report.differences).toContainEqual(expect.objectContaining({name:'MEEUSEN Tom',round:3,official:'1:06:13',
      calculated:expect.objectContaining({timeSeconds:'3968',forfait:true})}));
    expect(JSON.stringify(references)).toBe(before);
  });
  it('separa sprint y vuelta rápida y conserva el bono del posterior DNF',() => {
    const {input,awards} = x2oCotejoInput(load(),references);
    expect(awards[2].sprint).toContainEqual(expect.objectContaining({bib:34,rank:3,seconds:5}));
    expect(input.rounds[2].results.find(row => row.bib === 34)).toMatchObject({irm:'DNF',timeSeconds:null,bonusSeconds:5});
    expect(awards.every(round => round.aggregateSeconds === 60 && !round.differences.length)).toBe(true);
    expect(awards[7].sprint.map(row => row.bib)).toEqual([1,3,2]);
  });
  it('detecta un bono publicado incompatible sin alterar el esperado de general',() => {
    const fixture = load(); fixture.rounds[0].results[0][7] = '0:20';
    const report = x2oCotejo(fixture,references);
    expect(report.bonusesMatch).toBe(false);
    expect(report.awards[0].differences).toContainEqual(expect.objectContaining({bib:1,official:20,calculated:25}));
    expect(report.generalMatches).toBe(false);
  });
  it('no acepta un sprint ambiguo ni premios incompletos o de la vuelta inicial',() => {
    const duplicate = load(); duplicate.rounds[0].results[0][9] = '9:36 (3) | +0:01 (1)';
    expect(() => x2oCotejoInput(duplicate,references)).toThrow('Sprint');
    const missing = load(); missing.rounds[0].bestLaps[0][0] = '4.';
    expect(() => x2oCotejoInput(missing,references)).toThrow('Vuelta rápida');
    const initial = load(); initial.rounds[0].bestLaps[0][5] = '#0';
    expect(() => x2oCotejoInput(initial,references)).toThrow('Vuelta rápida');
  });
  it('impide convertir tiempos parciales de LAP/DNF/DNS en tiempos de meta',() => {
    for (const state of ['LAP','DNF','DNS']) {
      const fixture = load(), row = fixture.rounds.flatMap(round => round.results).find(row => row[5] === state);
      row[6] = 0;
      expect(() => x2oCotejoInput(fixture,references)).toThrow('Fila de resultados');
    }
  });
  it('detecta una general alterada y una identidad o edición de fuente incompatible',() => {
    const fixture = load(); fixture.officialStandings[0][4]++;
    const report = x2oCotejo(fixture,references);
    expect(report.matchingTotals).toBe(110);
    expect(report.differences).toContainEqual(expect.objectContaining({name:'NIEUWENHUIS Joris',field:'totalSeconds'}));
    const rider = load(); rider.rounds[0].bestLaps[0][2] = '10000000000';
    expect(() => x2oCotejoInput(rider,references)).toThrow('Identidad');
    const date = load(); date.rounds[0].dateKey = '2024-11-01';
    expect(() => x2oCotejoInput(date,references)).toThrow('Fecha');
  });
});

describe('Cotejo oficial X2O WE/MU 2025–26',() => {
  it('reproduce todos los tiempos ME/MU al descartar bonos en forfaits sin resolver elegibilidad ni orden',() => {
    for (const [category,totals,cells,ranks,ranked] of [['ME',111,888,56,58],['MU',189,1512,98,100]]) {
      const report = x2oCotejo(load(category),references);
      expect(report).toMatchObject({category,forfaitBonusesPolicy:'discard',bonusesMatch:true,
        matchingTotals:totals,matchingCells:cells,matchingRanks:ranks,rankedRows:ranked,
        timeTotalsAndCellsMatch:true,generalMatches:false,status:'needs_review'});
      expect(report.differences.every(d => ['rank','rowCount'].includes(d.field))).toBe(true);
      expect(report.excludedByRegulationButPresentInOfficialRanking).toHaveLength(totals-ranked);
    }
  });
  it('coteja los bonos sub23 y conserva los dos forfaits DNF y el empate discrepantes',() => {
    const report = x2oCotejo(load('MU'),references,{forfaitBonusesPolicy:'retain'});
    expect(report).toMatchObject({category:'MU',bonusesMatch:true,officialTotals:189,officialCells:1512,
      matchingTotals:187,matchingCells:1510,rankedRows:100,matchingRanks:96,generalMatches:false});
    expect(report.excludedByRegulationButPresentInOfficialRanking).toHaveLength(89);
    expect(report.differences).toContainEqual(expect.objectContaining({name:'CORSUS Yordi',round:3,official:'55:27',
      calculated:expect.objectContaining({timeSeconds:'3322',forfait:true})}));
    expect(report.differences).toContainEqual(expect.objectContaining({name:'HAVERDINGS David',round:7,official:'58:26',
      calculated:expect.objectContaining({timeSeconds:'3501',forfait:true})}));
    expect(report.differences).toContainEqual(expect.objectContaining({name:'LIENERT Patrik',field:'rank',official:35,calculated:36}));
  });
  it('coteja los bonos femeninos sin unir un identificador de perfil por nombre',() => {
    const fixture = isolatedWe(), {input} = x2oCotejoInput(fixture,references), report = x2oCotejo(fixture,references);
    const hamme = input.rounds[2].results.find(row => row.bib === 35);
    const lille = input.rounds[6].results.find(row => row.bib === 15);
    expect(hamme.riderDisplay).toBe(lille.riderDisplay);
    expect(hamme.globalRiderId).not.toBe(lille.globalRiderId);
    expect(report).toMatchObject({category:'WE',bonusesMatch:true,officialTotals:181,matchingTotals:180,
      matchingCells:1447,generalMatches:false,status:'needs_review'});
    expect(report.unresolvedSourceIdentities).toEqual([{context:'20251116_x2o',bib:35,publishedIdentifier:'16071',name:'WORST Annemarie'}]);
    expect(report.differences).toContainEqual({field:'extraIdentity',name:'WORST Annemarie'});
  });
  it('rechaza fuentes de otra categoría y excepciones de identidad no declaradas, contradictorias o sin fila',() => {
    const source = load('MU'); source.rounds[0].resultsSource.url = load().rounds[0].resultsSource.url;
    expect(() => x2oCotejoInput(source,references)).toThrow('Fuente oficial');
    const missing = isolatedWe(); delete missing.unresolvedIdentities;
    expect(() => x2oCotejoInput(missing,references)).toThrow('Fila de resultados');
    const wrong = isolatedWe(); wrong.unresolvedIdentities[0].name = 'Otra corredora';
    expect(() => x2oCotejoInput(wrong,references)).toThrow('Identidad pendiente contradictoria');
    const unused = isolatedWe(); unused.unresolvedIdentities.push({...unused.unresolvedIdentities[0],bib:99});
    expect(() => x2oCotejoInput(unused,references)).toThrow('Identidad pendiente sin fila');
  });
  it('resuelve el alias femenino solo con nacimiento completo y eventos independientes, conservando hechos y diferencias de orden',() => {
    const fixture = load('WE'), before = JSON.stringify(fixture), {input} = x2oCotejoInput(fixture,references);
    const hamme = input.rounds[2].results.find(row => row.bib === 35), lille = input.rounds[6].results.find(row => row.bib === 15);
    expect(hamme.globalRiderId).toBe(lille.globalRiderId);
    expect(fixture.rounds[2].results.find(row => row[1] === 35)[2]).toBe('16071');
    expect(input.riders).toHaveLength(181);
    const report = x2oCotejo(fixture,references);
    expect(report).toMatchObject({matchingTotals:181,matchingCells:1448,matchingRanks:83,rankedRows:88,
      timeTotalsAndCellsMatch:true,generalMatches:false,status:'needs_review',unresolvedSourceIdentities:[]});
    expect(report.resolvedSourceAliases).toHaveLength(1);
    expect(report.excludedByRegulationButPresentInOfficialRanking).toHaveLength(93);
    expect(report.differences.every(d => ['rank','rowCount'].includes(d.field))).toBe(true);
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it('rechaza un alias por nombre sin nacimiento coincidente, con evento falso, sin licencia independiente o con hash alterado',() => {
    for (const change of ['birthDate','eventId','licence','hash']) {
      const fixture = load('WE'), alias = fixture.identityAliases[0], wrapper = alias.evidence.projections[0];
      if (change === 'birthDate') wrapper.projection.row.birthDate = '1995-12-18';
      if (change === 'eventId') wrapper.projection.eventId = 999999;
      if (change === 'licence') alias.uciId = '10000000000';
      if (change !== 'hash') rehashProjection(wrapper);
      else wrapper.projection.row.birthDateRaw = '/Date(819327600001)/';
      expect(() => x2oCotejoInput(fixture,references)).toThrow('Alias de identidad');
    }
    const conflict = load('WE'); conflict.unresolvedIdentities = isolatedWe().unresolvedIdentities;
    expect(() => x2oCotejoInput(conflict,references)).toThrow('Alias de identidad');
    const duplicate = load('WE'); duplicate.rounds[2].results.find(row => row[1] !== 35)[2] = duplicate.identityAliases[0].uciId;
    expect(() => x2oCotejoInput(duplicate,references)).toThrow('Fila de resultados');
  });
});
