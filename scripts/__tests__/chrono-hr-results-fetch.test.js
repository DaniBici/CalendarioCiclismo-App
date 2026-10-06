import { describe, expect, it } from 'vitest';
import {
  classificationFromHtml,
  classificationLinksFromStageHtml,
  fetchCompetition,
  finalClassificationStage,
  normalizeGap,
  parseCode,
  parseStageLabel,
  stagesFromIndexHtml,
  suggestCompetitionId,
} from '../results-fetchers/chronohr-results-fetch.mjs';

const code = '20251017_tour_de_serbie';
const indexHtml = `
<table>
  <tr><td>Stage</td><td>RESULT htm</td><td>RESULTS pdf</td></tr>
  <tr><td>1st-a</td><td><a href="srb-1.php">RESULT htm</a></td><td><a href="stage1.pdf">RESULTS pdf</a></td></tr>
  <tr><td>1st-b</td><td><a href="srb-2.php">RESULT htm</a></td><td><a href="stage2.pdf">RESULTS pdf</a></td></tr>
  <tr><td>2nd</td><td><a href="srb-3.php">RESULT htm</a></td><td><a href="stage3.pdf">RESULTS pdf</a></td></tr>
</table>`;

const stageIndexHtml = `
<table>
  <tr><td><a href="stage3.htm">Stage results</a></td></tr>
  <tr><td><a href="GC3.htm">General classification</a></td></tr>
  <tr><td><a href="kom3.htm">Sprint classification</a></td></tr>
  <tr><td><a href="communique3.htm">Communique</a></td></tr>
</table>`;

const stageHtml = `
<table>
  <tr><td>Tour de Serbie</td></tr>
  <tr><td>2nd Stage - Individual classification</td><td>Official results</td></tr>
  <tr><td>Pl</td><td>Bib</td><td>Name</td><td>Nat.</td><td>Team</td><td>Time</td><td>+/-</td></tr>
  <tr><td>1</td><td>11</td><td>Winner RIDER</td><td>SRB</td><td>Team A</td><td>2:28:31</td><td></td></tr>
  <tr><td>2</td><td>12</td><td>Same TIME</td><td>SRB</td><td>Team B</td><td>''</td><td></td></tr>
  <tr><td>3</td><td>13</td><td>Later RIDER</td><td>CRO</td><td>Team C</td><td>1:07</td><td></td></tr>
  <tr><td>4</td><td>14</td><td>Same GAP</td><td>CRO</td><td>Team C</td><td>''</td><td></td></tr>
  <tr><td>DNF</td><td>15</td><td>Abandon RIDER</td><td>BIH</td><td>Team D</td><td></td><td></td></tr>
</table>`;

const gcHtml = `
<table>
  <tr><td>2nd Stage - General individual classification</td></tr>
  <tr><td>Rk</td><td>Bib</td><td>Name</td><td>Nat.</td><td>Team</td><td>Time</td><td>Gap</td></tr>
  <tr><td>1</td><td>11</td><td>Winner RIDER</td><td>SRB</td><td>Team A</td><td>8:48:39</td><td></td></tr>
  <tr><td>2</td><td>12</td><td>Second RIDER</td><td>SRB</td><td>Team B</td><td>8:48:40</td><td>0:01</td></tr>
  <tr><td>3</td><td>13</td><td>Same GAP</td><td>CRO</td><td>Team C</td><td>''</td><td>''</td></tr>
</table>`;

const komHtml = `
<table>
  <tr><td>2nd Stage - General KOM individual classification</td></tr>
  <tr><td>Rk</td><td>Bib</td><td>Name</td><td>Nat.</td><td>Team</td><td>Pts</td></tr>
  <tr><td>1</td><td>31</td><td>Climber RIDER</td><td>CRO</td><td>Team X</td><td>12</td></tr>
  <tr><td>2</td><td>32</td><td>Other RIDER</td><td>BIH</td><td>Team Y</td><td>8</td></tr>
  <tr><td></td><td>33</td><td>Penalty RIDER</td><td>SRB</td><td>Team Z</td><td>-1</td></tr>
</table>`;

describe('CH:RO:NO — HTML oficial', () => {
  it('valida el código y deriva un competitionId sintético estable', () => {
    expect(parseCode(code)).toBe(code);
    expect(suggestCompetitionId(code)).toBe(-13852);   // ancla del ID guardado
    expect(() => parseCode('tour_de_serbie')).toThrow('YYYYMMDD_slug');
  });

  it('interpreta prólogos y dobles sectores desde la etiqueta deportiva', () => {
    expect(parseStageLabel('Prologue')).toEqual({ stageNumber: 0, sectorIndex: 0 });
    expect(parseStageLabel('1st-a')).toEqual({ stageNumber: 1, sectorIndex: 0 });
    expect(parseStageLabel('1st-b')).toEqual({ stageNumber: 1, sectorIndex: 1 });
    expect(stagesFromIndexHtml(indexHtml, code)).toMatchObject([
      {
        stageNumber: 1,
        sectorIndex: 0,
        stageLabel: '1st-a',
        sourcePdfUrl: `https://chrono.hr/races/${code}/stage1.pdf`,
      },
      { stageNumber: 1, sectorIndex: 1, stageLabel: '1st-b' },
      { stageNumber: 2, sectorIndex: 0, stageLabel: '2nd' },
    ]);
  });

  it('descubre clasificaciones sin presuponer los nombres de archivo', () => {
    const links = classificationLinksFromStageHtml(stageIndexHtml, code);
    expect(links.map((link) => link.classKind)).toEqual(['stage', 'gc', 'kom']);
    expect(links[0].url).toBe(`https://chrono.hr/races-raw/${code}/stage3.htm`);
  });

  it('extrae tiempos repetidos, diferencias e IRM de la llegada', () => {
    const stage = stagesFromIndexHtml(indexHtml, code)[2];
    const link = classificationLinksFromStageHtml(stageIndexHtml, code)[0];
    const classification = classificationFromHtml(code, stage, link, stageHtml);
    expect(classification).toMatchObject({ classKind: 'stage', scope: 'stage', rowCount: 5 });
    expect(classification.rows[0]).toMatchObject({ rank: 1, bib: '11', timeText: '2:28:31', gapText: null });
    expect(classification.rows[1]).toMatchObject({ rank: 2, bib: '12', gapText: '+0' });
    expect(classification.rows[2]).toMatchObject({ rank: 3, bib: '13', gapText: '+1:07' });
    expect(classification.rows[3]).toMatchObject({ rank: 4, bib: '14', gapText: '+1:07' });
    expect(classification.rows[4]).toMatchObject({ rank: null, rankText: 'DNF', bib: '15', irm: 'DNF' });
    expect(normalizeGap('0:00:11')).toBe('+11');
  });

  it('acepta dittos de Excel con espaciado corrupto tras las comillas', () => {
    const excelDittoHtml = stageHtml.replaceAll("<td>''</td>", "<td>'' ��</td>");
    const stage = stagesFromIndexHtml(indexHtml, code)[2];
    const link = classificationLinksFromStageHtml(stageIndexHtml, code)[0];
    const classification = classificationFromHtml(code, stage, link, excelDittoHtml);
    expect(classification.rows.slice(0, 4).map((row) => row.resultValue)).toEqual([
      '2:28:31', '+0', '+1:07', '+1:07',
    ]);
    expect(classification.rows.at(-1)).toMatchObject({ rankText: 'DNF', irm: 'DNF' });
  });

  it('limpia el relleno corrupto de las cabeceras Excel', () => {
    const pointsWithExcelHeaders = `
      <table>
        <tr><td>1st Stage - Points classification</td></tr>
        <tr><td>Rk �</td><td>� Bib</td><td>Name</td><td>Nat.</td><td>Team</td><td>Pts</td></tr>
        <tr><td>1</td><td>56</td><td>Jeen DE JONG</td><td>NED</td><td>Team A</td><td>8</td></tr>
      </table>`;
    const stage = stagesFromIndexHtml(indexHtml, code)[2];
    const link = { classKind: 'points', scope: 'overall', isTeamEvent: false, url: 'https://chrono.hr/races-raw/points.htm' };
    expect(classificationFromHtml(code, stage, link, pointsWithExcelHeaders)).toMatchObject({
      classKind: 'points',
      rowCount: 1,
      rows: [{ rank: 1, bib: '56', points: 8 }],
    });
  });

  it('distingue la general y corrige el enlace Sprint mediante el título KOM', () => {
    const stage = stagesFromIndexHtml(indexHtml, code)[2];
    const links = classificationLinksFromStageHtml(stageIndexHtml, code);
    const gc = classificationFromHtml(code, stage, links[1], gcHtml);
    const kom = classificationFromHtml(code, stage, links[2], komHtml);
    expect(gc.rows.map((row) => row.resultValue)).toEqual(['8:48:39', '+1', '+1']);
    expect(kom).toMatchObject({ classKind: 'kom', scope: 'overall', rowCount: 2 });
    expect(kom.rows.map((row) => row.points)).toEqual([12, 8]);
  });

  it('emite la jornada pedida y una pseudo-etapa final con IDs distintos', async () => {
    const pages = { 'srb-3.php': stageIndexHtml, 'stage3.htm': stageHtml, 'GC3.htm': gcHtml, 'kom3.htm': komHtml };
    const readHtml = async (url) => url.endsWith(`/${code}`) ? indexHtml : pages[new URL(url).pathname.split('/').pop()];
    const output = await fetchCompetition({ code, competitionId: -123, onlyStage: 2, totalStages: 2, includeFinal: true, readHtml });
    expect(output).toMatchObject({ source: 'chronohr', chronoHrCode: code, competitionId: -123 });
    expect(output.stages.map((stage) => stage.stageNumber)).toEqual([2, null]);
    expect(output.stages[1].classifications.map((classification) => classification.classKind)).toEqual(['gc', 'kom']);
    expect(output.stages[1].classifications[0].eventId).not.toBe(output.stages[0].classifications[1].eventId);
  });

  it('no crea una final sin cuadros generales', () => {
    const empty = finalClassificationStage(code, { stageNumber: 2, sectorIndex: 0, sourcePdfUrl: null, classifications: [] });
    expect(empty).toBeNull();
  });
});
