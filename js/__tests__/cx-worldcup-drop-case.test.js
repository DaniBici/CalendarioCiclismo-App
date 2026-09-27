import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {worldCupDropCaseCotejo,worldCupDropCaseInput} from '../../scripts/cx/cx-worldcup-drop-case.mjs';

const fixture=JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/worldcup-drop-case-2019-20-mu.json',import.meta.url)));
const references=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));
function rehash(round){round.projectionSha256=createHash('sha256').update(JSON.stringify(
  {dateKey:round.dateKey,dataRide:round.dataRide,rows:round.rows})).digest('hex');}

describe('caso oficial de puestos descartados, Copa del Mundo MU 2019–20',()=>{
  it('distingue el orden relativo sin presentar una general completa ni activar otra edición',()=>{
    const before=JSON.stringify({fixture,references}),report=worldCupDropCaseCotejo(fixture);
    expect(report).toMatchObject({scope:'offline_case_only_not_full_general_or_edition_activation',
      comparisonScope:'two_rider_relative_order_only',engineVersion:3,seasonKey:'2019-20',category:'MU',
      roundRows:[45,42,44,56,61,48,49],expectedTotals:2,expectedCells:14,droppedPlacingsPolicyConclusion:'only_all_case_matches',
      publishedCaseRanks:[{name:'MEIN Thomas',rank:4},{name:'VANDEPUTTE Niels',rank:5}]});
    const [all,retained]=report.candidates;
    for(const candidate of report.candidates)expect(candidate).toMatchObject({status:'ready',issues:[],checkedTotals:2,
      matchingTotals:2,matchingCells:14,completeRoundInput:{status:'needs_review',unresolvedTies:3,identities:106,rankedRows:0}});
    expect(all).toMatchObject({caseOrderMatches:true,calculatedOrder:['MEIN Thomas','VANDEPUTTE Niels'],differences:[]});
    expect(retained).toMatchObject({caseOrderMatches:false,calculatedOrder:['VANDEPUTTE Niels','MEIN Thomas']});
    expect(retained.differences).toEqual([{field:'relativeOrder',official:all.calculatedOrder,calculated:retained.calculatedOrder}]);
    expect(JSON.stringify({fixture,references})).toBe(before);
    expect(references.references.find(r=>r.tournament==='Copa del Mundo').pointsScheme.status).toBe('reference_requires_edition_review');
  });
  it('conserva tablas completas, puestos originales, DNF y ausencias independientes del esperado',()=>{
    const input=worldCupDropCaseInput(fixture);
    expect(input.rounds.flatMap(round=>round.results)).toHaveLength(345);
    expect(input.riders.every(row=>row.id.startsWith('offline-')&&row.birthDate===undefined&&row.verified===undefined)).toBe(true);
    const bern=input.rounds[0].results.filter(row=>/^(MEIN Thomas|VANDEPUTTE Niels)$/.test(row.riderDisplay));
    expect(bern.map(row=>row.rank)).toEqual([9,10]);
    expect(input.rounds[3].results.find(row=>row.riderDisplay==='MEIN Thomas')).toMatchObject({rank:null,irm:'DNF'});
    expect(input.rounds[1].results.some(row=>row.riderDisplay==='VANDEPUTTE Niels')).toBe(false);
    const changed=structuredClone(fixture);changed.officialCase[0][4]++;
    expect(worldCupDropCaseInput(changed)).toEqual(input);
    expect(input.tournament.pointsScheme.categories.MU.perRank).toHaveLength(30);
  });
  it('detecta alteraciones de totales/celdas generales y de puestos en las tablas de ronda',()=>{
    for(const edit of [f=>f.officialCase[0][4]++,f=>f.officialCase[0][5][0]='999 (9)',f=>{
      const bern=f.rounds[0];const mein=bern.rows.find(row=>row[2]==='MEIN Thomas'),vandeputte=bern.rows.find(row=>row[2]==='VANDEPUTTE Niels');
      [mein[0],vandeputte[0]]=[vandeputte[0],mein[0]];rehash(bern);
    }]){
      const changed=structuredClone(fixture);edit(changed);
      expect(worldCupDropCaseCotejo(changed).droppedPlacingsPolicyConclusion).toBe('neither_case_matches');
    }
    const swapped=structuredClone(fixture);[swapped.officialCase[0][0],swapped.officialCase[1][0]]=[5,4];
    expect(worldCupDropCaseCotejo(swapped).droppedPlacingsPolicyConclusion).toBe('only_retained_case_matches');
  });
  it('rechaza otra edición, escala, ámbito, categoría y fuentes incompletas o alteradas',()=>{
    for(const edit of [f=>f.seasonKey='2026-27',f=>f.category='MJ',f=>f.scope='production',f=>f.rules.perRank[0]=40,
      f=>f.rounds.pop(),f=>f.officialCase.pop(),f=>f.rounds[0].rows[0][0]=2,f=>f.rounds[0].dataRide.seasonId=472,
      f=>f.rounds[0].dataRide.eventId++,f=>f.rounds[4].dateKey='2018-12-26',f=>delete f.rounds[0].normalizedDataRideSha256]){
      const changed=structuredClone(fixture);edit(changed);
      expect(()=>worldCupDropCaseInput(changed)).toThrow('incompatible');
    }
    expect(()=>worldCupDropCaseInput(fixture,'unknown')).toThrow('incompatible');
  });
});
