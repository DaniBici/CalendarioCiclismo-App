import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {worldCupDropCaseCotejo} from '../../scripts/cx/cx-worldcup-drop-case.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/cx-cotejos/worldcup-drop-case-2019-20-mu.json',import.meta.url)));
const references=JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json',import.meta.url)));

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
});
