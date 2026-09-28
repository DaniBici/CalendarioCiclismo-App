import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePdf, pdfLinksFromHtml, suggestCompetitionId, RESULTS_PAGE } from '../results-fetchers/southbohemia-results-fetch.mjs';

const title = 'TOUR OF SOUTH BOHEMIA 2026';
function fixture(stage = 1, date = '03.09.2026') {
  const heading = (code) => `${title}\n${code}${stage} ${code === 'E' ? '' : 'po '}${stage}. etapa / after ${stage}th Stage\nDatum / Date: ${date}`;
  return `${title}\nSL0 Com.no.: 1/\nDatum / Date: 03.09.2026\f
${heading('E')}
1 51 EST 2000 10000000001 Rider One TEAM ONE AAA 4:39:10 0:00:00 0:00:10
2 1 CZE 1993 10000000002 Rider Two TEAM TWO BBB 4:39:35 0:00:25 0:00:00
3 13 HUN 2006 10000000003 * Rider Three
TEAM THREE CCC 4:39:10 0:00:00 0:00:06
4 103 CZE 2004 10000000004 * Rider Four TEAM FOUR DDD 4:39:15 0:00:05 0:00:00
2 CZE 2005 10000000005 * Rider Five TEAM TWO BBB DNF 0:00:00
počet závodíků / num. of riders: 5
Jury communiqué: riders credited with main peloton time.
${heading('A')}
1 51 EST 2000 10000000001 Rider One TEAM ONE AAA 4:39:00 0:00:00
2 13 HUN 2006 10000000003 * Rider Three TEAM THREE CCC 4:39:04 0:00:04
3 103 CZE 2004 10000000004 * Rider Four TEAM FOUR DDD 4:39:15 0:00:15
4 1 CZE 1993 10000000002 Rider Two TEAM TWO BBB 4:39:35 0:00:35
2 CZE 2005 10000000005 * Rider Five TEAM TWO BBB DNF
počet závodíků / num. of riders: 5
Jersey holders: 13 white (best U23 rider)
Jersey wearers: 103 white (best U23 rider)
${heading('P')}
INDIVIDUAL POINT CLASSIFICATION
1 51 EST 2000 10000000001 Rider One TEAM ONE 25 5 30
2 13 HUN 2006 10000000003 * Rider Three TEAM THREE 7 7 14
CLIMBING COMPETITION
1 13 HUN 2006 10000000003 * Rider Three TEAM THREE 5 5 2 12
2 51 EST 2000 10000000001 Rider One TEAM ONE 3 3
${heading('G')}
SOUTĚŽ DRUŽSTEV / TEAM COMPETITION
1 AAA TEAM ONE EST 2 13:57:30 51, 52, 53 13:57:30 0:00:00
2 CCC TEAM THREE HUN 1 13:57:30 13, 14, 15 13:57:40 0:00:10
${heading('R')}
Ignored individual results by team
`;
}
const options = { competitionId: -137619, expectedDate: '2026-09-03', totalStages: 4, sourcePdfUrl: 'https://www.okolojiznichcech.cz/uploads/soubory/stage1.pdf' };
const parse = (text = fixture(), opts = options) => parsePdf(2026, 1, text, opts);

describe('dossiers oficiales de South Bohemia', () => {
  it('descubre encabezados romanos y numéricos, sin inferir rutas ni heredar otros bloques', () => {
    const html = `<h2>Výsledky I. etapa</h2><a href="./uploads/soubory/one.pdf">PDF</a>
      <h2>Výsledky II. etapa</h2><a href="/uploads/soubory/two.pdf">PDF</a>
      <h2>Výsledky III. etapa</h2><a href="https://elsewhere.test/three.pdf">PDF</a>
      <h2>Výsledky 4. etapa</h2><a href="/uploads/soubory/four.pdf">PDF</a>
      <h2>Start list</h2><a href="/uploads/soubory/startlist.pdf">PDF</a>`;
    expect([...pdfLinksFromHtml(html)]).toEqual([[1, new URL('/uploads/soubory/one.pdf', RESULTS_PAGE).href],
      [2, new URL('/uploads/soubory/two.pdf', RESULTS_PAGE).href], [4, new URL('/uploads/soubory/four.pdf', RESULTS_PAGE).href]]);
    expect(suggestCompetitionId('6tRqZpDqy9QQbbebEip1')).toBe(-137619);
  });

  it('rechaza dos revisiones distintas bajo la misma etapa', () => {
    expect(() => pdfLinksFromHtml('<h2>Výsledky I. etapa</h2><a href="/uploads/soubory/a.pdf">A</a><a href="/uploads/soubory/b.pdf">B</a>')).toThrow('varios dossiers');
  });

  it('no trata una página de error como resultados todavía sin publicar', () => {
    expect(() => pdfLinksFromHtml('<h1>Service unavailable</h1>')).toThrow('página oficial');
    expect([...pdfLinksFromHtml('<h1>Výsledky</h1>')]).toEqual([]);
  });

  it('conserva orden de llegada, tiempos de jurado, líneas partidas y abandonos', () => {
    const { stage, final } = parse();
    expect(stage).toMatchObject({ stageNumber: 1, dateKey: '2026-09-03', sourcePdfUrl: options.sourcePdfUrl });
    expect(stage.classifications.map((c) => [c.classKind, c.rowCount])).toEqual([
      ['stage', 5], ['gc', 5], ['points', 2], ['kom', 2], ['youth', 3], ['teams', 2],
    ]);
    expect(stage.classifications[0].rows.map((r) => [r.bib, r.resultValue])).toEqual([
      ['51', '4:39:10'], ['1', '+25'], ['13', '+00'], ['103', '+05'], ['2', null],
    ]);
    expect(stage.classifications[0].rows.at(-1)).toMatchObject({ rank: null, irm: 'DNF' });
    expect(stage.classifications[1].rows[3]).toMatchObject({ bib: '1', rank: 4, gapText: '+35' });
    expect(final).toBeNull();
  });

  it('usa puntos acumulados y jóvenes de la general, no el portador sustituto', () => {
    const c = parse().stage.classifications;
    expect(c[2].rows[0]).toMatchObject({ points: 30 });
    expect(c[3].rows[0]).toMatchObject({ points: 12 });
    expect(c[4].rows[0]).toMatchObject({ bib: '13', timeText: '4:39:04' });
    expect(c[4].rows[1]).toMatchObject({ bib: '103', gapText: '+11' });
    expect(c[4].rows[2]).toMatchObject({ bib: '2', irm: 'DNF' });
    expect(c[5].rows[1]).toMatchObject({ teamName: 'TEAM THREE', gapText: '+10' });
    for (const classification of c.filter((cl) => !cl.isTeamEvent)) {
      expect(classification).not.toHaveProperty('winnerName');
      for (const row of classification.rows) {
        expect(row).not.toHaveProperty('riderDisplay');
        expect(row).not.toHaveProperty('teamName');
        expect(row).not.toHaveProperty('birthYear');
      }
    }
  });

  it('la fecha de la salida original no se confunde con la etapa final', () => {
    const { stage, final } = parsePdf(2026, 4, fixture(4, '06.09.2026'), { ...options, expectedDate: '2026-09-06' });
    expect(stage.dateKey).toBe('2026-09-06');
    expect(final).toMatchObject({ stageNumber: null, isFinalClassification: true });
    expect(final.classifications).toHaveLength(5);
    expect(new Set([...stage.classifications, ...final.classifications].map((c) => c.eventId)).size).toBe(11);
  });

  it.each([
    [() => fixture().replace(title, 'TOUR OF SOUTH BOHEMIA 2025'), 'otra carrera o año'],
    [() => fixture().replace('E1 1.', 'E2 2.'), 'etapa 2'],
    [() => fixture().replace('A1 po 1.', 'A2 po 2.'), 'etapa 2'],
    [() => fixture().replaceAll('03.09.2026', '04.09.2026'), 'fecha'],
    [() => fixture().replace('num. of riders: 5', 'num. of riders: 6'), 'se publican 6'],
    [() => fixture().replace('3 13 HUN', '4 13 HUN'), 'puestos incompletos'],
    [() => fixture().replace('2 1 CZE', '2 51 CZE'), 'duplicados'],
    [() => fixture().replace('4:39:35 0:00:25', '4:39:35 0:00:24'), 'incoherentes'],
    [() => fixture().replace('4:39:35 0:00:25', '4:39:35,25 0:00:25'), 'precisión fraccional'],
    [() => fixture().replaceAll('10000000003 *', '10000000003 '), 'criterio U23'],
    [() => fixture().replace('CLIMBING COMPETITION', 'OTHER'), 'acumulados'],
    [() => fixture().replace('G1 po 1.', 'X1 po 1.'), 'falta cuadro G1'],
  ])('rechaza documentos incompletos o incompatibles (%#)', (text, error) => {
    expect(() => parse(text())).toThrow(error);
  });

  it('el CLI filtra una etapa, emite ausencia sin inventar PDF y admite el upsert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'southbohemia-test-'));
    try {
      const input = join(dir, 'fixture.json');
      writeFileSync(input, JSON.stringify({ html: '<h2>Výsledky I. etapa</h2><a href="/uploads/soubory/one.pdf">PDF</a>',
        pdfTextByUrl: { 'https://www.okolojiznichcech.cz/uploads/soubory/one.pdf': fixture() } }));
      const args = ['scripts/results-fetchers/southbohemia-results-fetch.mjs', '--fixture', input, '--year', '2026', '--competition-id', '-137619', '--out', dir, '--total-stages', '4'];
      execFileSync(process.execPath, [...args, '--stage', '1']);
      const resultFile = join(dir, '-137619.json');
      expect(JSON.parse(readFileSync(resultFile, 'utf8')).stages).toHaveLength(1);
      execFileSync(process.execPath, ['scripts/results-fetchers/results-upsert.mjs', '--in', resultFile, '--race-id', 'synthetic-test', '--source', 'southbohemia', '--emit-sql', join(dir, 'upsert.sql')]);
      expect(readFileSync(join(dir, 'upsert.sql'), 'utf8')).toContain("'southbohemia'");
      execFileSync(process.execPath, [...args, '--stage', '2'], { stdio: 'pipe' });
      expect(JSON.parse(readFileSync(resultFile, 'utf8')).stages).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
