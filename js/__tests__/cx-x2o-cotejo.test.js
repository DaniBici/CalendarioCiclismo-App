import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {x2oCotejo,x2oCotejoInput} from '../../scripts/cx/cx-x2o-cotejo.mjs';

const load = (category='ME') => JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/x2o-2025-26-'+category.toLowerCase()+'.json',import.meta.url),'utf8'));
const references = JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url),'utf8'));

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
});
