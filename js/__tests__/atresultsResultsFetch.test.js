import { describe, expect, it } from 'vitest';
import { parseCode, parsePdf, stagePdfUrl, suggestCompetitionId } from '../../scripts/results-fetchers/atresults-results-fetch.mjs';

const pair = (left, right) => `${left.padEnd(71)}${right}`;
const header = pair(' PLACE NO      SURNAME, NAME                   TEAM   POINTS BONUSES', 'PLACE NO    SURNAME, NAME                    TEAM     POINTS');

function fixture({ year = 2026, stage = 1, date = 'Sunday, 27 September 2026', gap = '00:04' } = {}) {
  return `                         RESULTS
          PETRONAS LE TOUR DE LANGKAWI ${year}
                    ${date}
                   RESULTS OF
                 STAGE ${stage}
                 SHAH ALAM - KAMPAR
             TIMING & RESULTS PROCESSING by AT RESULTS SERVICE
\f STAGE ${stage} - SHAH ALAM - KAMPAR
 STAGE INDIVIDUAL CLASSIFICATION
 PLACE NO     UCI ID                SURNAME, NAME                     NAT   TEAM     TIME          GAP BONUSES        PENALTY
   1    3     10007744220           MALUCELLI Matteo                  ITA   XAT    2:00:22                  10
   2    24    10077852281           BLIKRA Erlend                     NOR   UXM    2:00:22        00:00     06
   3    31    10009817693           DE KLEIJN Arvid                   NED   TUD    2:00:26        ${gap}     04
 OUT OF RACE
  DNF 203    10109124576              LEE Hosam                                      KOR     KSP
 NOTE: DSQ - Disqualified , DNF - Did Not Finish , DNS - Did Not Start, OTL - Out of Time Limit
 No of Starters : 4
 No of Riders Not Starting: 0
 No of Riders Finished : 3
 STAGE BEST ASIAN RIDER
   1    111   10004874232           SALEH Mohd Harrif                 MAS   TSG         2:00:22
INDIVIDUAL GENERAL CLASSIFICATION BY TIME (PETRONAS GREEN JERSEY )
PLACE         NO    UCI ID          SURNAME, NAME                     NAT   TEAM      TIME           GAP
     1 ▲0     3     10007744220     MALUCELLI Matteo                  ITA   XAT    2:00:12
     2 ▼1     24    10077852281     BLIKRA Erlend                     NOR   UXM    2:00:16         00:04
     3 ▲0     31    10009817693     DE KLEIJN Arvid                   NED   TUD    2:00:22         00:10
BEST ASIAN RIDER (RAKAN MUDA WHITE JERSEY )
     1 ▲0     113   10015977395     ROSLI Muhammad Nur Aiman          MAS   TSG    2:00:15
TEAM GENERAL CLASSIFICATION BY TIME
PLACE           TEAM                                              TIME                   GAP
     1 ▲0       TEAM PICNIC POSTNL                          TPP          6:01:06
     2 ▲0       UNO-X MOBILITY                              UXM          6:01:10       00:04
BEST ASIAN TEAM
     1 ▲0       TERENGGANU CYCLING TEAM                     TSG          6:01:06
 BEST SPRINTERS' CLASSIFICATION (KBS ORANGE JERSEY )
 STAGE                                                                 OVERALL
${header}

${pair(' INTERMEDIATE SPRINT', '  1    3    MALUCELLI Matteo                 XAT         15')}
${pair('     1    113 ROSLI M                          TSG        3       03', '  2    24   BLIKRA Erlend                    UXM         12')}
     4     86 PEÑALVER ANIORTE M                PTV        7
 BEST CLIMBERS' CLASSIFICATON - KOM (BUBBLES O2 POLKA DOT JERSEY )
 STAGE                                                         OVERALL
${header}
${pair(' KOM', '  1   161 CARMAN Ben                         STG          2')}
    1    161 CARMAN B                          STG        2
START LIST
  1 GATE Aaron Murray                   31 + 00:00:10
`;
}

const parse = (text, options = {}) => parsePdf(2026, 1, text, { competitionId: -123, ...options });

describe('atresults-results-fetch', () => {
  it('interpreta llegada, general, puntos, montaña y equipos del dossier', () => {
    const { stage, final } = parse(fixture(), { expectedDate: '2026-09-27', totalStages: 8 });
    expect(final).toBeNull();
    expect(stage.dateKey).toBe('2026-09-27');
    const byKind = Object.fromEntries(stage.classifications.map((cl) => [cl.classKind, cl]));
    expect(Object.keys(byKind)).toEqual(['stage', 'gc', 'points', 'kom', 'teams']);
    expect(byKind.stage.rows.map((r) => [r.rankText, r.bib, r.resultValue])).toEqual([
      ['1', '3', '2:00:22'], ['2', '24', '+00'], ['3', '31', '+04'], ['DNF', '203', null]]);
    expect(byKind.stage.expectedRowCount).toBe(4);
    expect(byKind.gc.rows.map((r) => r.bib)).toEqual(['3', '24', '31']);
    expect(byKind.points.rows.map((r) => [r.bib, r.points])).toEqual([['3', 15], ['24', 12]]);
    expect(byKind.kom.rows.map((r) => [r.bib, r.points])).toEqual([['161', 2]]);
    expect(byKind.teams.rows.map((r) => [r.teamName, r.resultValue])).toEqual([['TEAM PICNIC POSTNL', '6:01:06'], ['UNO-X MOBILITY', '+04']]);
    expect(byKind.teams.isTeamEvent).toBe(true);
  });

  it('añade las clasificaciones finales en la última etapa', () => {
    const { final } = parse(fixture(), { totalStages: 1 });
    expect(final.isFinalClassification).toBe(true);
    expect(final.classifications.map((cl) => cl.classKind)).toEqual(['gc', 'points', 'kom', 'teams']);
    expect(final.classifications.every((cl) => cl.scope === 'stage')).toBe(true);
  });

  it('rechaza otra edición, otra etapa u otra fecha', () => {
    expect(() => parse(fixture({ year: 2025, date: 'Sunday, 28 September 2025' }))).toThrow(/otra edición/);
    expect(() => parse(fixture({ stage: 2 }))).toThrow(/etapa 2/);
    expect(() => parse(fixture(), { expectedDate: '2026-09-28' })).toThrow(/esperada 2026-09-28/);
  });

  it('rechaza una diferencia que no cuadra con el tiempo', () => {
    expect(() => parse(fixture({ gap: '00:05' }))).toThrow(/incoherentes/);
  });

  it('construye la URL del dossier desde carpeta y prefijo', () => {
    expect(parseCode('26ltdl/26LTDL')).toEqual({ folder: '26ltdl', prefix: '26LTDL' });
    expect(parseCode('25PLTDL')).toEqual({ folder: '25PLTDL', prefix: '25PLTDL' });
    expect(() => parseCode('../x')).toThrow();
    expect(stagePdfUrl('26ltdl/26LTDL', 3)).toBe('https://atresult.synology.me/PDF/26ltdl/26LTDL%20Results%20Stage%203.pdf');
    expect(suggestCompetitionId('7TS8g3lC3gzRic1FrrOV')).toBeLessThan(0);
  });
});
