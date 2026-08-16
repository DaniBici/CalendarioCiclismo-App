import { describe, expect, it } from 'vitest';
import { classificationsFromPages, gapOf, rankingUrls, rowsFromRankingHtml, stageUrl, timeOf } from '../../scripts/results-fetchers/aso-results-fetch.mjs';

const URL = 'https://www.arctic-race-of-norway.com/en/rankings';
const TABLE = `<table><tbody><tr><td>1</td><td><span data-class="flag--ita"></span><a>GIOVANNI LONARDI</a></td><td>103</td><td>TEAM POLTI VISITMALTA</td><td>04h 05&#039; 23&#039;&#039;</td><td>-</td></tr><tr><td>2</td><td>JASON TESSON</td><td>76</td><td>TOTALENERGIES</td><td>04h 05&#039; 23&#039;&#039;</td><td>+ 00&#039; 04&#039;&#039;</td></tr></tbody></table>`;

describe('A.S.O. Rankings', () => {
  it('descubre endpoints efímeros de cada clasificación', () => {
    const urls = rankingUrls('<button data-tabs-ajax="/en/ajax/ranking/1/ite/abc123/subtab">', URL);
    expect(urls.get('ite')).toBe('https://www.arctic-race-of-norway.com/en/ajax/ranking/1/ite/abc123/subtab');
  });
  it('deriva la URL de cada etapa sin etiquetar la página actual con otra jornada', () => {
    expect(stageUrl(URL, 1)).toBe(URL);
    expect(stageUrl(URL, 2)).toBe('https://www.arctic-race-of-norway.com/en/rankings/stage-2');
    expect(stageUrl('https://www.arctic-race-of-norway.com/en/rankings/stage-3', 4)).toBe('https://www.arctic-race-of-norway.com/en/rankings/stage-4');
  });
  it('normaliza tiempos y filas de la tabla oficial', () => {
    expect(timeOf("04h 05' 23''")).toBe('4:05:23');
    expect(gapOf("+ 00' 04''")).toBe('+4');
    expect(rowsFromRankingHtml(TABLE)).toMatchObject([{ rank: 1, bib: '103', riderDisplay: 'GIOVANNI LONARDI', timeText: '4:05:23' }, { rank: 2, gapText: '+4' }]);
  });
  it('solo emite una clasificación con ganador válido', () => {
    const classifications = classificationsFromPages(URL, 1, new Map([['ite', TABLE]]));
    expect(classifications).toMatchObject([{ classKind: 'stage', scope: 'stage', rowCount: 2, winnerName: 'GIOVANNI LONARDI' }]);
  });
  it('toma los puntos de su celda aunque haya una columna final vacía', () => {
    const html = TABLE.replace('04h 05&#039; 23&#039;&#039;</td><td>-', '25 PTS</td><td>-');
    expect(rowsFromRankingHtml(html, { points: true })[0]).toMatchObject({ resultValue: '25', timeText: '25', points: 25 });
  });
});
