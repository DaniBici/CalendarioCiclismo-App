import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {worldCupCotejo,worldCupCotejoInput} from '../../scripts/cx/cx-worldcup-cotejo.mjs';
import {recomputeCxStandings} from '../cx/standings.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/worldcup-2025-26-mj.json',import.meta.url)));
const derivedFixture=JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/worldcup-2025-26-wu.json',import.meta.url)));
const references=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));

describe('cotejo oficial offline Copa del Mundo MJ 2025–26',()=>{
  it('reproduce general y celdas independientes con dos políticas, sin decidir descartes',()=>{
    const before=JSON.stringify({fixture,references}),report=worldCupCotejo(fixture,references);
    expect(report).toMatchObject({engineVersion:3,identities:128,roundRows:[65,39,78,77,39,55],expectedTotals:48,expectedCells:288,
      baseline:{status:'needs_review',unresolvedTies:85},droppedPlacingsPolicyConclusion:'inconclusive_both_candidates_match'});
    for(const candidate of report.candidates)expect(candidate).toMatchObject({status:'ready',issues:[],checkedTotals:48,matchingCells:288,rankedRows:48,differences:[]});
    expect(JSON.stringify({fixture,references})).toBe(before);
    expect(fixture.scope).toBe('offline_official_cotejo_only');
    expect(references.references.find(r=>r.tournament==='Copa del Mundo').pointsScheme.status).toBe('reference_requires_edition_review');
  });
});

describe('cotejo offline WU derivada de WE, Copa del Mundo 2025–26',()=>{
  it('conserva una celda oficial contradictoria aunque totales y orden coincidan',()=>{
    const before=JSON.stringify({derivedFixture,references}),report=worldCupCotejo(derivedFixture,references);
    expect(report).toMatchObject({engineVersion:3,category:'WU',sourceCategory:'WE',identities:153,
      roundRows:[56,46,29,50,81,71,68,89,64,65,61,72],officialSourceRows:63,expectedTotals:22,expectedCells:264,
      derivedCategoryMatches:false,droppedPlacingsPolicyConclusion:'not_applicable_no_drops'});
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({status:'ready',issues:[],checkedTotals:22,matchingTotals:22,matchingRanks:22,matchingCells:263,rankedRows:22});
    expect(report.candidates[0].differences).toEqual([{name:'SARKISOV Katherine',round:8,official:'0 (56)',calculated:{points:'0',rank:55,missing:false}}]);
    expect(JSON.stringify({derivedFixture,references})).toBe(before);
  });
  it('usa nacimientos completos y puestos WE, excluye juveniles y mayores de 22, sin crear mangas WU',()=>{
    const input=worldCupCotejoInput(derivedFixture,references,{pointsEligibilityPolicy:'awardedAtLeastOnce',latestRoundPointsPolicy:'backwardsUntilDifferent'});
    expect(input.riders.every(r=>r.id.startsWith('offline-')&&r.verified===true&&/^\d{4}-\d{2}-\d{2}$/.test(r.birthDate))).toBe(true);
    expect(input.rounds.every(r=>r.manga.category==='WE'&&r.results.every(row=>row.category==='WE'))).toBe(true);
    const calculation=recomputeCxStandings(input);
    expect(calculation.rows[0]).toMatchObject({rank:1,riderDisplay:'BENTVELD Leonie',points:'203'});
    expect(calculation.rows.some(r=>/PELLIZOTTI|ZEMANOVÁ|PIETERSE|AZZETTI|BIANCHI/.test(r.riderDisplay))).toBe(false);
    const bentveld=calculation.breakdown.find(r=>r.globalRiderId===calculation.rows[0].globalRiderId);
    expect(bentveld.rounds[0]).toMatchObject({sourceRank:4,points:'22'});
    expect(derivedFixture.rounds.reduce((n,r)=>n+r.lapStatesFromPdfMissingInDataRide,0)).toBe(127);
  });
});
