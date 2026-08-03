import { describe, expect, it } from 'vitest';
import { decodeJsString, htmlFromResponse, parseCode, rowsFromHtml, suggestCompetitionId }
  from '../../scripts/results-fetchers/infocity-results-fetch.mjs';

describe('InfoCity — respuesta JavaScript', () => {
  it('extrae y desescapa la tabla asignada a cnt', () => {
    const script = "cnt = '<table><tr><td>1.</td><td>KOWALSKI Jan</td><td>11</td><td>Equipo &amp; Uno</td><td>03:15:00</td></tr></table>';";
    expect(rowsFromHtml(htmlFromResponse(script))[0].teamName).toBe('Equipo & Uno');
    expect(decodeJsString("Jan\\'s")).toBe("Jan's");
  });

  it('normaliza filas de etapa, dorsal, tiempo y abandono', () => {
    const html = `<table>
      <tr><th>Pos.</th><th>Rider</th></tr>
      <tr><td>1.</td><td>KOWALSKI Jan</td><td>11</td><td>Equipo Uno</td><td>03:15:00</td></tr>
      <tr><td>2</td><td>NOWAK Piotr</td><td>12</td><td>Equipo Dos</td><td>+0:04</td></tr>
      <tr><td>DNF</td><td>WIŚNIEWSKI Adam</td><td>13</td><td>Equipo Tres</td><td>DNF</td></tr>
    </table>`;
    const [winner, second, dnf] = rowsFromHtml(html);
    expect(winner).toMatchObject({ rank: 1, bib: '11', timeText: '3:15:00', gapText: null });
    expect(second).toMatchObject({ rank: 2, bib: '12', timeText: null, gapText: '+0:04' });
    expect(dnf).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', bib: '13' });
  });

  it('trata las clasificaciones por puntos como contadores y no tiempos', () => {
    const [row] = rowsFromHtml('<table><tr><td>1</td><td>KOWALSKI Jan</td><td>11</td><td>Equipo</td><td>42</td></tr></table>', { isPoints: true });
    expect(row).toMatchObject({ rank: 1, points: 42, timeText: null, gapText: null });
  });

  it('valida el código estable del proveedor', () => {
    expect(parseCode('21:21:141')).toEqual({ race: 21, test: 21, firstCed: 141 });
    expect(() => parseCode('21:141')).toThrow('race:test:ced-etapa-1');
    expect(suggestCompetitionId('21:21:141')).toBeLessThan(0);
  });
});
