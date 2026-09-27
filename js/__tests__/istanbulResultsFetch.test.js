import { describe, expect, it } from 'vitest';
import {
  parsePdf,
  pdfLinksFromHtml,
  suggestCompetitionId,
  synthEventId,
} from '../../scripts/results-fetchers/istanbul-results-fetch.mjs';

const pdfText = `
TOUR OF ISTANBUL
1st Stage classification                                      3/09/2026
1 46 Baptiste VADIC TOTALENERGIES 10069096720 FRA 2002 3:58:35 - -10s
2 31 Alexandre BALMER SOLUTION TECH NIPPO RALI 10016568287 SUI 2000 3:58:35 - -6s
Withdrawals (1)
DNF 71 Ahmet ÖRKEN SPOR TOTO 10007508790 TUR 1993 Withdrawal

General classification after stage 1 - MEN ELITE              3/09/2026
1 46 Baptiste VADIC TOTALENERGIES FRA 10069096720 2002 3:58:25 - -10s
2 31 Alexandre BALMER SOLUTION TECH NIPPO RALI SUI 10016568287 2000 3:58:29 +0:04 -6s

Team classification - Stage 1                                 3/09/2026
Stage
1. TOTALENERGIES                                      11:55:59 -
2. ASTANA DEVELOPMENT TEAM                            11:56:05 +0:06
3. KONYA BÜYÜKŞEHİR BELEDİYE SPOR                     11:58:06 +2:07
4. MUĞLA BÜYÜKŞEHİR BELEDİYESİ SK                     11:58:10 +2:11
5. TEAM VINO–NORTH QAZAQSTAN R.                       12:07:50 +11:51
General classification
1. TOTALENERGIES                                      11:55:59 -
2. ASTANA DEVELOPMENT TEAM                            11:56:05 +0:06
3. KONYA BÜYÜKŞEHİR BELEDİYE SPOR                     11:58:06 +2:07
4. MUĞLA BÜYÜKŞEHİR BELEDİYESİ SK                     11:58:10 +2:11
5. TEAM VINO–NORTH QAZAQSTAN R.                       12:07:50 +11:51

Points classification - Stage 1                              3/09/2026
Sprint 1
1 123 Alder YERGESHOV (VNQ) 3 pts
GENERAL TOTAL
1 46 Baptiste VADIC (TEN) 5 pts
2 31 Alexandre BALMER (TFT) 4 pts

Climbing classification - Stage 1                            3/09/2026
Climbing 1 (CAT-3)
1 74 Mustafa TEKİN (STC) 3 pts
GENERAL TOTAL
1 74 Mustafa TEKİN (STC) 3 pts
2 136 Daniyal MATTHEWS (TPC) 2 pts

Youth classification - Stage 1                               3/09/2026
Stage classification
1 62 Artem FOFONOV (XAD) 3:58:35
2 61 Mattia NEGRENTE (XAD) 3:58:45
General classification
1 62 Artem FOFONOV (XAD) 3:58:31
2 61 Mattia NEGRENTE (XAD) 3:58:45

Jerseys - Stage 1
`;

describe('Tour of Istanbul — PDF oficial', () => {
  it('descubre solo los PDF del año solicitado y conserva el ID del placeholder', () => {
    const html = `<a href="/storage/2026/09/one.pdf">Stage 1 Results</a>
      <a href="/storage/2025/09/old.pdf">Stage 1 Results</a><button>Stage 2 Results</button>`;
    expect([...pdfLinksFromHtml(html, 2026)]).toEqual([
      [1, 'https://tourofistanbul.com.tr/storage/2026/09/one.pdf'],
    ]);
    expect(suggestCompetitionId('ldKWUzwFIAvr5aslWDqx')).toBe(-149222);
    expect(synthEventId(-149222, 1, 'stage')).toBe(-1492220100);
  });

  it('extrae las seis clasificaciones, los abandonos y los valores acumulados', () => {
    const { stage, final } = parsePdf(2026, 1, pdfText, {
      competitionId: -149222,
      expectedDate: '2026-09-03',
      totalStages: 4,
      sourcePdfUrl: 'https://tourofistanbul.com.tr/stage-1.pdf',
    });
    expect(stage).toMatchObject({ stageNumber: 1, dateKey: '2026-09-03', sourcePdfUrl: 'https://tourofistanbul.com.tr/stage-1.pdf' });
    expect(stage.classifications.map((item) => [item.classKind, item.rowCount])).toEqual([
      ['stage', 3], ['gc', 2], ['points', 2], ['kom', 2], ['youth', 2], ['teams', 5],
    ]);
    expect(stage.classifications[0].rows[1]).toMatchObject({ bib: '31', gapText: '+00' });
    expect(stage.classifications[0].rows[2]).toMatchObject({ bib: '71', irm: 'DNF', rank: null });
    expect(stage.classifications[1].rows[1]).toMatchObject({ bib: '31', gapText: '+04' });
    expect(stage.classifications[2].rows[0]).toMatchObject({ bib: '46', points: 5, resultValue: '5' });
    expect(stage.classifications[4].rows[1]).toMatchObject({ bib: '61', gapText: '+14' });
    expect(stage.classifications[5].rows[1]).toMatchObject({ teamName: 'ASTANA DEVELOPMENT TEAM', gapText: '+06' });
    expect(stage.classifications[5].rows.slice(2).map((row) => row.teamName)).toEqual([
      'Konya Büyükşehir',
      'Mugla BB',
      'Team Vino - North Qazaqstan Region',
    ]);
    expect(final).toBeNull();
  });

  it('rechaza un PDF de otra etapa, fecha o año', () => {
    expect(() => parsePdf(2026, 2, pdfText, { competitionId: -149222 })).toThrow('etapa 1');
    expect(() => parsePdf(2026, 1, pdfText, { competitionId: -149222, expectedDate: '2026-09-04' })).toThrow('no de 2026-09-04');
    expect(() => parsePdf(2025, 1, pdfText, { competitionId: -149222 })).toThrow('no de 2025');
  });

  it('admite llegada sin ordinal y valida la etapa mediante la general del dossier', () => {
    const stageTwo = pdfText.replace('1st Stage classification', 'Stage classification')
      .replaceAll('stage 1', 'stage 2').replaceAll('Stage 1', 'Stage 2').replaceAll('3/09/2026', '4/09/2026');
    const { stage } = parsePdf(2026, 2, stageTwo, { competitionId: -149222, expectedDate: '2026-09-04' });
    expect(stage.classifications.map((item) => item.rowCount)).toEqual([3, 2, 2, 2, 2, 5]);
    expect(() => parsePdf(2026, 1, stageTwo, { competitionId: -149222 })).toThrow('etapa 2');
    expect(() => parsePdf(2026, 1, pdfText.replace('after stage 1', 'after stage 2'), { competitionId: -149222 })).toThrow('etapa 2');
  });
});
