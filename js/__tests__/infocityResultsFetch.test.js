import { describe, expect, it } from 'vitest';
import { classificationFromRows, decodeJsString, endpoint, htmlFromResponse, parseCode, rowsFromHtml, rowsFromResponse, suggestCompetitionId, synthRaceId }
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

  it('lee la tabla JavaScript real de InfoCity y busca el IRM en la columna de tiempo', () => {
    const script = `hed="STAGE RESULTS";
      var ra = new Array();
      ra[0] = Array('1.','<img src="/img/flagi/pl.gif" />KOWALSKI Jan','11','Equipo Uno','','03:15:00','&nbsp;','&nbsp;');
      ra[1] = Array('','SENECHAL Florian','12','APT','','DNF','&nbsp;','&nbsp;');
      cnt=buildTable('', ra, ca);`;
    const [winner, dnf] = rowsFromResponse(script);
    expect(winner).toMatchObject({ rank: 1, bib: '11', riderDisplay: 'KOWALSKI Jan', teamName: 'Equipo Uno', timeText: '3:15:00' });
    expect(dnf).toMatchObject({ rank: null, bib: '12', irm: 'DNF', rankText: 'DNF' });
  });

  it('normaliza los tiempos con unidades que publica InfoCity', () => {
    const script = `
      ra[0] = Array('1','MILAN Jonathan','64','LTK','- 10s','03h 05\\' 37\\'\\'','20p','&nbsp;');
      ra[1] = Array('2','MAGNIER Paul','114','SOQ','- 6s','+ 00\\' 04\\'\\'','19p','&nbsp;');`;
    const [winner, second] = rowsFromResponse(script);
    expect(winner).toMatchObject({ timeText: '3:05:37', gapText: null });
    expect(second).toMatchObject({ timeText: null, gapText: '+0:04' });
  });

  it('lee el tiempo de una CRI aunque InfoCity quite la columna de bonificación', () => {
    const script = `hed="INDIVIDUAL TIME TRIAL";
      ra[0] = Array('1','KÜNG Stefan','194','TUD','14\\' 25\\'\\'','&nbsp;','07\\' 53\\'\\'');
      ra[1] = Array('2','FISHER-BLACK Finn','102','RBH','+ 00\\' 04\\'\\'','&nbsp;','07\\' 48\\'\\'');
      ra[2] = Array('','BOGUSŁAWSKI Marceli','201','POL','DNS','&nbsp;','');`;
    const [winner, second, dns] = rowsFromResponse(script);
    expect(winner).toMatchObject({ rank: 1, bib: '194', timeText: '0:14:25', gapText: null });
    expect(second).toMatchObject({ rank: 2, bib: '102', timeText: null, gapText: '+0:04' });
    expect(dns).toMatchObject({ rank: null, bib: '201', irm: 'DNS' });
  });

  it('lee el tiempo absoluto de la general y las tablas de puntos y equipos', () => {
    const gc = `
      ra[0] = Array('1','MILAN Jonathan','64','LTK','05h 04\\' 01\\'\\'','&nbsp;');
      ra[1] = Array('2','MALECKI Kamil','187','PQT','05h 04\\' 03\\'\\'','+ 00\\' 02\\'\\'');`;
    expect(rowsFromResponse(gc, { useAbsoluteTime: true })[0]).toMatchObject({ timeText: '5:04:01' });
    expect(rowsFromResponse(gc, { useAbsoluteTime: true })[1]).toMatchObject({ timeText: '5:04:03', gapText: '+0:02' });

    const points = `ra[0] = Array('1','MILAN Jonathan','64','LTK','20');`;
    expect(rowsFromResponse(points, { isPoints: true })[0]).toMatchObject({ points: 20 });

    const teams = `
      ra[0] = Array('1','NETCOMPANY INEOS','NCI','15h 12\\' 33\\'\\'','&nbsp;');
      ra[1] = Array('2','RED BULL-BORA-HANSGROHE','RBH','15h 12\\' 33\\'\\'','+ 00\\' 00\\'\\'');`;
    expect(rowsFromResponse(teams, { isTeamEvent: true })[0]).toMatchObject({
      riderDisplay: 'NETCOMPANY INEOS', teamName: 'NETCOMPANY INEOS', timeText: '15:12:33',
    });
    expect(rowsFromResponse(teams, { isTeamEvent: true })[1]).toMatchObject({
      riderDisplay: 'RED BULL-BORA-HANSGROHE', timeText: '15:12:33', gapText: '+0:00',
    });
    const teamRows = rowsFromResponse(teams, { isTeamEvent: true });
    expect(classificationFromRows('21:21:141', 2, {
      classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true,
    }, teamRows)).toMatchObject({ isTeamEvent: true, rowCount: 2, winnerName: 'NETCOMPANY INEOS' });
  });

  it('trata las clasificaciones por puntos como contadores y no tiempos', () => {
    const [row] = rowsFromHtml('<table><tr><td>1</td><td>KOWALSKI Jan</td><td>11</td><td>Equipo</td><td>42</td></tr></table>', { isPoints: true });
    expect(row).toMatchObject({ rank: 1, points: 42, timeText: null, gapText: null });
  });

  it('valida el código estable del proveedor', () => {
    expect(parseCode('21:21:141')).toEqual({ race: 21, test: 21, firstCed: 141 });
    expect(() => parseCode('21:141')).toThrow('race:test:ced-etapa-1');
    expect(suggestCompetitionId('21:21:141')).toBeLessThan(0);
    expect(synthRaceId('21:21:141', 2)).toBeLessThan(0);
    expect(synthRaceId('21:21:141', 2)).not.toBe(synthRaceId('21:21:141', 3));
  });

  it('consulta las generales en el checkpoint de su propia etapa', () => {
    const url = endpoint({ race: 21, test: 21, ced: 143 }, { typ: 'GENE', kl: 'I' });
    expect(url).toContain('ced=143');
    expect(url).toContain('ed=143');
  });
});
