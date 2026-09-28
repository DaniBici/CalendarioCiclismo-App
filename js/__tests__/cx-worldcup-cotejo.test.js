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
  it('el alias local une los resultados sin convertirse en una ficha de catálogo',()=>{
    const input=worldCupCotejoInput(fixture,references);
    expect(input.riders).toHaveLength(128);
    expect(input.riders.every(r=>r.id.startsWith('offline-')&&r.birthDate===undefined&&r.verified===undefined)).toBe(true);
    const names=input.rounds.flatMap(round=>round.results).filter(row=>row.riderDisplay.startsWith('BROWN'));
    expect(new Set(names.map(row=>row.globalRiderId)).size).toBe(1);
    expect(recomputeCxStandings(input).rows).toEqual([]);
  });
  it('detecta una general independiente alterada y no anuncia ambigüedad si ninguna política coincide',()=>{
    for(const edit of [f=>f.officialStandings[0][4]++,f=>f.officialStandings[0][5][0]='999 (1)',
      f=>[f.officialStandings[0][0],f.officialStandings[1][0]]=[2,1],f=>f.officialStandings.pop()]){
      const changed=structuredClone(fixture);edit(changed);
      const report=worldCupCotejo(changed,references);
      expect(report.droppedPlacingsPolicyConclusion).toBe('neither_candidate_matches');
      expect(report.candidates.every(c=>c.differences.length>0)).toBe(true);
    }
  });
  it('rechaza ámbitos ajenos al manifiesto y conserva hashes SHA-256 de las fuentes',()=>{
    expect(()=>worldCupCotejoInput({...fixture,category:'WE'},references)).toThrow('incompatible');
    expect(()=>worldCupCotejoInput({...fixture,scope:'production'},references)).toThrow('incompatible');
    expect(fixture.officialStandingsSha256).toMatch(/^[a-f0-9]{64}$/);
    for(const round of fixture.rounds)expect(round.reportSha256).toMatch(/^[a-f0-9]{64}$/);
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
  it('impide un cotejo íntegro si se altera la general o falta evidencia de nacimiento',()=>{
    const changed=structuredClone(derivedFixture);
    changed.officialStandings.find(r=>r[1]==='BENTVELD Leonie')[4]++;
    const report=worldCupCotejo(changed,references);
    expect(report.derivedCategoryMatches).toBe(false);
    expect(report.candidates[0].matchingTotals).toBe(21);
    expect(report.candidates[0].differences.some(d=>d.field==='points')).toBe(true);
    const incomplete=structuredClone(derivedFixture);delete incomplete.rounds[0].normalizedDataRideSha256;
    expect(()=>worldCupCotejoInput(incomplete,references)).toThrow('evidencia oficial');
    const input=worldCupCotejoInput(derivedFixture,references);delete input.riders[0].birthDate;
    expect(recomputeCxStandings(input)).toMatchObject({status:'needs_review',rows:[],issues:expect.arrayContaining([expect.objectContaining({code:'derived_age'})])});
    expect(()=>worldCupCotejoInput({...derivedFixture,seasonKey:'2026-27'},references)).toThrow('incompatible');
    expect(()=>worldCupCotejoInput({...derivedFixture,sourceCategory:'WU'},references)).toThrow('incompatible');
  });
});
