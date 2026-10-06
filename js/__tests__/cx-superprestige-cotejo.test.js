import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {superprestigeCotejo,superprestigeCotejoInput} from '../../scripts/cx/cx-superprestige-cotejo.mjs';

const load=category=>JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/superprestige-2025-26-'+category+'.json',import.meta.url)));
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
});
