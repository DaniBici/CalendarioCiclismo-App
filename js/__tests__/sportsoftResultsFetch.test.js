import { describe, expect, it } from 'vitest';
import { classificationFromLive, classificationFromLivePoints, classificationFromOfficialStagePdf, classificationFromPage, classificationsFromOfficialAfterStagePdf, competitionsFromRaceHtml, officialPdfLinksFromHtml, rowsFromCompetitionHtml, suggestCompetitionId, synthRaceId }
  from '../../scripts/results-fetchers/sportsoft-results-fetch.mjs';

const page = `
  <a href="https://vysledky.sportsoft.cz/index.php/race/477/competition/4297"><div>GENERAL CLASSIFICATION</div><small>17.08.2025</small></a>
  <a href="https://vysledky.sportsoft.cz/index.php/race/477/competition/4293"><div>Stage 1</div><small>14.08.2025</small></a>
  <table id="results-table"><thead><tr>
    <th data-name="Ovl_Pos">Pos</th><th data-name="Name">Name</th><th data-name="RaceNo">No</th><th data-name="Club">Club</th>
    <th data-name="Time">Time</th><th data-name="Ovl_Behind">Behind</th><th data-name="KOM_Pos">KOM Pos</th><th data-name="KOM_Points">KOM Points</th>
    <th data-name="Sprint_Pos">Sprint Pos</th><th data-name="Sprint_Points">Sprint Points</th><th data-name="SecCat_Pos">U23 Pos</th>
  </tr></thead><tbody>
    <tr id="488823"><td>1</td><td>LAMPERTI <span>Luke</span></td><td>15</td><td>SOUDAL QUICK-STEP</td><td>3:52:59</td><td></td><td>2</td><td>12</td><td>1</td><td>25</td><td>0</td></tr>
    <tr id="488840"><td></td><td>FABBRO <span>Matteo</span></td><td>31</td><td>SOLUTION TECH</td><td>DNF</td><td></td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
  </tbody></table>`;

const officialPdfPage = `
  <h5 class="fw-bold text-uppercase">Official Results</h5>
  <a href="https://cdn.sportsoft.cz/stage1.pdf"><div>Stage 1</div></a>
  <a href="https://cdn.sportsoft.cz/after-stage1.pdf"><div>After Stage 1</div></a>
  <div class="race-selection">`;
const officialStagePdf = `
Czech Tour OFFICIAL RESULTS LIST
Stage 1
Rk. Bib Name UCI ID YOB Nat Team Time Gap
1. 24 SHEEHAN Riley 10023534305 2000 USA NSN 03:45:15 00:00:00
2. 16 TURNER Ben 10010947038 1999 GBR INEOS
3. 155 PAJUR Romet 10076501658 2004 EST BORA
4. 36 TURCONI Filippo 10031785163 2005 ITA BARDIANI 03:46:32 00:01:17
Race configuration`;
const afterStagePdf = `
Czech Tour GENERAL AFTER Stage 1
CLASSIFICATION
1. 24 SHEEHAN Riley 10023534305 03:45:05 00:00:00
\fCzech Tour POINTS AFTER Stage 1
CLASSIFICATION
1 24 SHEEHAN Riley 10023534305 25
\fCzech Tour MOUNTAIN AFTER Stage 1
CLASSIFICATION
1 4 REINDERINK Pepijn 10023143170 16
\fCzech Tour U23 AFTER Stage 1
CLASSIFICATION
1 155 PAJUR Romet 10076501658 03:45:11 00:00:00
\fCzech Tour CZECH AFTER Stage 1
CLASSIFICATION
\fCzech Tour GENERAL TEAMS AFTER Stage 1
CLASSIFICATION
1. TEAM A 11:15:45 00:00:00`;

describe('SportSoft Timing', () => {
  it('descubre etapas y general sin depender de sus ids variables', () => {
    expect(competitionsFromRaceHtml(page)).toEqual([
      { raceCode: '477', competitionCode: '4297', stageNumber: null, label: 'GENERAL CLASSIFICATION' },
      { raceCode: '477', competitionCode: '4293', stageNumber: 1, label: 'Stage 1' },
    ]);
  });

  it('mapea la tabla semánticamente, conserva tiempos y detecta IRM', () => {
    const rows = rowsFromCompetitionHtml(page);
    const stage = classificationFromPage('477', 1, rows, { classKind: 'stage', scope: 'stage', eventName: 'Stage', rankKey: 'Ovl_Pos', withTime: true });
    expect(stage.rows[0]).toMatchObject({ rank: 1, bib: '15', riderDisplay: 'LAMPERTI Luke', timeText: '3:52:59', gapText: null });
    expect(stage.rows[1]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', bib: '31' });
  });

  it('emite puntos como contador y mantiene ids sintéticos estables', () => {
    const rows = rowsFromCompetitionHtml(page);
    const points = classificationFromPage('477', 1, rows, { classKind: 'points', scope: 'overall', eventName: 'Points', rankKey: 'Sprint_Pos', pointsKey: 'Sprint_Points' });
    expect(points.rows[0]).toMatchObject({ rank: 1, points: 25, timeText: null, gapText: null });
    expect(suggestCompetitionId('477')).toBeLessThan(0);
    expect(synthRaceId('477', 1)).not.toBe(synthRaceId('477', 2));
  });

  it('ordena las clasificaciones secundarias del archivo por su puesto oficial', () => {
    const mountain = classificationFromPage('986', 2, [
      { KOM_Pos: '4', KOM_Points: '8', RaceNo: '11', Name: 'AUGUST Andrew' },
      { KOM_Pos: '1', KOM_Points: '22', RaceNo: '166', Name: 'SCHURAN Michal' },
      { KOM_Pos: '2', KOM_Points: '16', RaceNo: '4', Name: 'REINDERINK Pepijn' },
      { KOM_Pos: '0', KOM_Points: '0', RaceNo: '22', Name: 'BLACKMORE Joseph', Time: 'DNF' },
    ], { classKind: 'kom', scope: 'overall', eventName: 'Mountains', rankKey: 'KOM_Pos', pointsKey: 'KOM_Points' });

    expect(mountain.rows.map((row) => [row.rank, row.bib, row.points])).toEqual([
      [1, '166', 22], [2, '4', 16], [4, '11', 8],
    ]);
  });

  it('conserva IRM solo en la etapa y los excluye de las acumuladas', () => {
    const source = [
      { Ovl_Pos: '1', RaceNo: '11', Name: 'AUGUST Andrew', Time: '3:37:28' },
      { Ovl_Pos: '', RaceNo: '22', Name: 'BLACKMORE Joseph', Time: 'DNF' },
      { Ovl_Pos: '', RaceNo: '153', Name: 'FIETZKE Paul', Time: 'DNS' },
    ];
    const stage = classificationFromPage('986', 2, source, { classKind: 'stage', scope: 'stage', eventName: 'Stage', rankKey: 'Ovl_Pos', withTime: true });
    const general = classificationFromPage('986', 2, source, { classKind: 'gc', scope: 'stage', eventName: 'General', rankKey: 'Ovl_Pos', withTime: true });

    expect(stage.rows.map((row) => [row.bib, row.irm])).toEqual([
      ['11', null], ['22', 'DNF'], ['153', 'DNS'],
    ]);
    expect(general.rows.map((row) => [row.bib, row.irm])).toEqual([['11', null]]);
  });

  it('descarta el puesto técnico 1000 de SportSoft en la general', () => {
    const general = classificationFromPage('986', 3, [
      { Ovl_Pos: '1', RaceNo: '11', Name: 'AUGUST Andrew', Time: '10:00:00' },
      { Ovl_Pos: '1000', RaceNo: '22', Name: 'BLACKMORE Joseph', Time: '' },
      { Ovl_Pos: '2', RaceNo: '63', Name: 'FANCELLU Alessandro', Time: '10:00:20' },
    ], { classKind: 'gc', scope: 'stage', eventName: 'General', rankKey: 'Ovl_Pos', withTime: true });

    expect(general.rows.map((row) => row.bib)).toEqual(['11', '63']);
  });

  it('descarta el puesto técnico 1000 también en la lectura live de etapa', () => {
    const stage = classificationFromLive('986', 3, [
      { Ovl_Pos: 1, RaceNo: '11', Name: 'AUGUST Andrew', Time: '3:00:00', FinishStatus: 'OK' },
      { Ovl_Pos: 1000, RaceNo: '22', Name: 'BLACKMORE Joseph', Time: '', FinishStatus: 'OK' },
      { Ovl_Pos: 2, RaceNo: '63', Name: 'FANCELLU Alessandro', Time: '3:00:20', FinishStatus: 'OK' },
    ]);

    expect(stage.rows.map((row) => row.bib)).toEqual(['11', '63']);
  });

  it('descubre el PDF oficial de etapa separado del libro posterior', () => {
    expect(officialPdfLinksFromHtml(officialPdfPage)).toEqual([
      { stageNumber: 1, kind: 'stage', href: 'https://cdn.sportsoft.cz/stage1.pdf' },
      { stageNumber: 1, kind: 'after-stage', href: 'https://cdn.sportsoft.cz/after-stage1.pdf' },
    ]);
  });

  it('prioriza el PDF oficial y propaga m.t. dentro de cada grupo', () => {
    const source = [
      { Ovl_Pos: 1, RaceNo: '24', Name: 'SHEEHAN Riley', Club: 'NSN', Time: '3:45:15' },
      { Ovl_Pos: 2, RaceNo: '16', Name: 'TURNER Ben', Club: 'INEOS', Time: '3:45:15' },
      { Ovl_Pos: 3, RaceNo: '155', Name: 'PAJUR Romet', Club: 'BORA', Time: '3:45:15' },
      { Ovl_Pos: 4, RaceNo: '36', Name: 'TURCONI Filippo', Club: 'BARDIANI', Time: '3:46:32' },
    ];
    const stage = classificationFromOfficialStagePdf('986', 1, officialStagePdf, source);
    expect(stage.rows.map((row) => [row.bib, row.timeText, row.gapText])).toEqual([
      ['24', '3:45:15', null], ['16', null, '+0'], ['155', null, '+0'], ['36', null, '+1:17'],
    ]);
  });

  it('prioriza el libro posterior para general, puntos, montaña, jóvenes y equipos', () => {
    const source = [
      { RaceNo: '24', Name: 'SHEEHAN Riley', Club: 'NSN' },
      { RaceNo: '4', Name: 'REINDERINK Pepijn', Club: 'SOUDAL' },
      { RaceNo: '155', Name: 'PAJUR Romet', Club: 'BORA' },
    ];
    const classes = classificationsFromOfficialAfterStagePdf('986', 1, afterStagePdf, source);
    expect(classes.map((classification) => [classification.classKind, classification.rowCount])).toEqual([
      ['gc', 1], ['points', 1], ['kom', 1], ['youth', 1], ['teams', 1],
    ]);
    expect(classes[1].rows[0]).toMatchObject({ bib: '24', points: 25, timeText: '25' });
    expect(classes[2].rows[0]).toMatchObject({ bib: '4', points: 16, timeText: '16' });
    expect(classes[4].rows[0]).toMatchObject({ teamName: 'TEAM A', timeText: '11:15:45' });
  });

  it('agrupa décimas del live sin aplicar bonificaciones de la general', () => {
    const stage = classificationFromLive('986', 1, [
      { Ovl_Pos: 1, RaceNo: '24', Name: 'SHEEHAN Riley', Club: 'NSN', Time: '3:45:15.4' },
      { Ovl_Pos: 2, RaceNo: '16', Name: 'TURNER Ben', Club: 'INEOS', Time: '3:45:15.5', Ovl_Behind: '+0.1' },
      { Ovl_Pos: 3, RaceNo: '155', Name: 'PAJUR Romet', Club: 'BORA', Time: '3:45:15.7', Ovl_Behind: '+0.3' },
      { Ovl_Pos: 4, RaceNo: '36', Name: 'TURCONI Filippo', Club: 'BARDIANI', Time: '3:45:17.0', Ovl_Behind: '+1.5' },
    ]);
    expect(stage.rows.map((r) => [r.timeText, r.gapText])).toEqual([
      ['3:45:15', null], [null, '+0'], [null, '+0'], [null, '+2'],
    ]);
  });

  it('agrupa diferencias live inferiores a un segundo cuando la general ya es acumulada', () => {
    const stage = classificationFromLive('986', 2, [
      { Ovl_Pos: 1, RaceNo: '1', Name: 'A One', Time: '4:00:00.2' },
      { Ovl_Pos: 2, RaceNo: '2', Name: 'B Two', Time: '4:00:00.9' },
      { Ovl_Pos: 3, RaceNo: '3', Name: 'C Three', Time: '4:00:02.1' },
      { Ovl_Pos: 4, RaceNo: '4', Name: 'D Four', Time: '4:01:17.2' },
    ]);
    expect(stage.rows.map((r) => [r.timeText, r.gapText])).toEqual([
      ['4:00:00', null], [null, '+0'], [null, '+2'], [null, '+1:17'],
    ]);
  });

  it('excluye corredores aún en puntos intermedios del resultado live', () => {
    const stage = classificationFromLive('986', 2, [
      { Ovl_Pos: 1, RaceNo: '11', Name: 'AUGUST Andrew', Time: '3:37:28', SplitName: 'Finish', FinishStatus: 'OK' },
      { Ovl_Pos: 2, RaceNo: '63', Name: 'FANCELLU Alessandro', Time: '3:37:30', SplitName: 'Finish', FinishStatus: 'OK' },
      { Ovl_Pos: 1, RaceNo: '112', Name: 'BAIS Mattia', Time: '2:37:09', SplitName: '114,6 km', FinishStatus: 'STD' },
      { Ovl_Pos: 2, RaceNo: '3', Name: 'GELDERS Gil', Time: '2:39:37', SplitName: '114,6 km', FinishStatus: 'RUN' },
      { Ovl_Pos: null, RaceNo: '22', Name: 'BLACKMORE Joseph', Time: '2:42:36', SplitName: '114,6 km', FinishStatus: 'DNF' },
    ]);

    expect(stage.rows.map((row) => [row.bib, row.rank, row.irm])).toEqual([
      ['11', 1, null], ['63', 2, null], ['22', null, 'DNF'],
    ]);
  });

  it('deriva montaña y puntos acumulados desde las columnas live', () => {
    const source = [
      { Ovl_Pos: 97, RaceNo: '166', Name: 'SCHURAN Michal', Club: 'UNITED', KOMPoints: 22, SprintPoints: 10, FinishStatus: 'OK' },
      { Ovl_Pos: 78, RaceNo: '4', Name: 'REINDERINK Pepijn', Club: 'SOUDAL', KOMPoints: 16, SprintPoints: 6, FinishStatus: 'OK' },
      { Ovl_Pos: 3, RaceNo: '86', Name: 'POZZOVIVO Domenico', Club: 'SOLUTION', KOMPoints: 4, SprintPoints: 16, FinishStatus: 'OK' },
      { Ovl_Pos: 74, RaceNo: '3', Name: 'GELDERS Gil', Club: 'SOUDAL', KOMPoints: 4, SprintPoints: 4, FinishStatus: 'OK' },
      { Ovl_Pos: 1, RaceNo: '11', Name: 'AUGUST Andrew', Club: 'INEOS', KOMPoints: 8, SprintPoints: 25, FinishStatus: 'OK' },
      { Ovl_Pos: 2, RaceNo: '63', Name: 'FANCELLU Alessandro', KOMPoints: '', SprintPoints: 20, FinishStatus: 'STD' },
      { Ovl_Pos: null, RaceNo: '22', Name: 'BLACKMORE Joseph', KOMPoints: 12, SprintPoints: 12, FinishStatus: 'DNF' },
    ];
    const mountain = classificationFromLivePoints('986', 2, source, {
      classKind: 'kom', eventName: 'Overall Mountains Classification', livePointsKey: 'KOMPoints',
    });
    const points = classificationFromLivePoints('986', 2, source, {
      classKind: 'points', eventName: 'Overall Points Classification', livePointsKey: 'SprintPoints',
    });

    expect(mountain.rows.map((row) => [row.rank, row.bib, row.points])).toEqual([
      [1, '166', 22], [2, '4', 16], [3, '11', 8], [4, '86', 4], [5, '3', 4],
    ]);
    expect(points.rows.map((row) => [row.rank, row.bib, row.points])).toEqual([
      [1, '11', 25], [2, '86', 16], [3, '166', 10], [4, '4', 6], [5, '3', 4],
    ]);
  });
});
