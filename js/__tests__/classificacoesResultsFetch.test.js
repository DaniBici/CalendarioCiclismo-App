import { describe, expect, it } from 'vitest';
import { applyPdfSummaryIrms, classify, classificationsFromStageHtml, fnv1a, provisionalClassificationsFromHtml, rowsFromPayload, stageNumber, stagePdfUrlFromHtml, stagesFromRaceHtml, suggestCompetitionId, summaryIrmsFromPdfText } from '../../scripts/results-fetchers/classificacoes-results-fetch.mjs';
import { extractRidersForNameResolve } from '../../scripts/results-fetchers/uci-results-upsert.mjs';

describe('Classificações.net', () => {
  it('descubre etapas sin fijar sus identificadores', () => {
    const stages = stagesFromRaceHtml(`<tr onclick="location.href='/modalidades/ciclismo/volta/1757'"><td>Prólogo</td></tr><tr onclick="location.href='/modalidades/ciclismo/volta/1758'"><td>1ª Etapa</td></tr><select name="stageSelect"><option value="/modalidades/ciclismo/volta/1759">2ª Etapa</option></select>`);
    expect(stages.map((s) => [s.stageNumber, s.stageId])).toEqual([[0, 1757], [1, 1758], [2, 1759]]);
    expect(stageNumber('6ª Etapa')).toBe(6);
  });

  it('genera un identificador sintético estable por slug, sin colisionar con DataRide', () => {
    expect(suggestCompetitionId('86-volta-a-portugal-continente')).toBeLessThan(0);
    expect(suggestCompetitionId('86-volta-a-portugal-continente')).toBe(suggestCompetitionId('86-volta-a-portugal-continente'));
    expect(fnv1a('classificacoes:a')).not.toBe(fnv1a('classificacoes:b'));
  });

  it('conserva la etapa y las cinco generales, no las clasificaciones secundarias de etapa', () => {
    const html = `<select name="stageLinkUpa"><option value="/x/results/1">Classificação Individual na Etapa</option><option value="/x/results/2">Geral Pontos</option><option value="/x/results/3">Classificação das Metas Volantes</option><option value="/x/results/4">Classificação Por Pontos Na Etapa</option><option value="/x/results/5">Classificação do Prémio da Montanha - Alto da Serra</option></select>`;
    const options = classificationsFromStageHtml(html);
    expect(options.map((x) => classify(x.label)?.classKind || null)).toEqual(['stage', 'points', null, null, null]);
  });

  it('normaliza filas, tiempos, gaps e IRM del JSON DataTables', () => {
    const rows = rowsFromPayload({ aaData: [
      ['1', '22', 'AUS20010414', '---', 'GILMORE Brady', 'Elite', 'ICA', '4:31:58', '---'],
      ['2', '126', 'ESP19991118', '---', 'ROTA RUS Raul', 'Elite', 'RPB', '4:32:07', 'a 9'],
      ['DNF', '7', '', '---', 'GUERIN Alexis', 'Elite', 'ATI', 'DNF', ''],
    ] });
    expect(rows[0]).toMatchObject({ rank: 1, bib: '22', timeText: '4:31:58' });
    expect(rows[1]).toMatchObject({ rank: 2, timeText: '4:32:07', gapText: null });
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF' });
  });

  it('ordena las filas por puesto cuando el DataTable las entrega desordenadas', () => {
    const rows = rowsFromPayload({ aaData: [
      ['3', '3', 'RIDER Tres', 'T', '7:03'],
      ['1', '1', 'RIDER Uno', 'T', '7:01'],
      ['2', '2', 'RIDER Dos', 'T', '7:02'],
    ] });
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('reconoce los formatos compactos de generales y clasificaciones por equipos', () => {
    const points = rowsFromPayload({ aaData: [['1', '11', 'LEITÃO Iúri', 'CJR', '70']] });
    expect(points[0]).toMatchObject({ bib: '11', riderDisplay: 'LEITÃO Iúri', points: 70, resultValue: '70' });

    const youth = rowsFromPayload({ aaData: [['1', '121', 'LOPES Lucas', 'RPB', '25:19:45']] });
    expect(youth[0]).toMatchObject({ bib: '121', timeText: '25:19:45', gapText: null });

    const teams = rowsFromPayload({ aaData: [['1', 'ATI', 'ATI - ANICOLOR/TIEN 21', '75:57:48', '---']] }, { isTeamEvent: true });
    expect(teams[0]).toMatchObject({ bib: null, riderDisplay: 'ATI - ANICOLOR/TIEN 21', teamName: 'ATI - ANICOLOR/TIEN 21', timeText: '75:57:48' });
  });

  it('usa el resumen HTML provisional cuando todavía no hay DataTable, conserva M.T. y omite secundarias de etapa', () => {
    const table = (label, rows) => `<tr><td><p><strong><span>${label}</span></strong></p><table>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table></td></tr>`;
    const html = `<div id="results"><table>
      ${table('INDIVIDUAL NA ETAPA', [
        ['1', '14', 'PERICAS Adria*', 'UAD', '3:48:32'],
        ['2', '1', 'NYCH Artem', 'ACR', 'm.t.'],
        ['3', '7', 'GUERIN Alexis', 'ACR', 'm.t.'],
        ['4', '72', 'SILVA Pedro', 'BOA', 'a 28'],
        ['5', '32', 'MURGUIALDAY Jokin', 'EUS', 'm.t.'],
      ])}
      ${table('GERAL INDIVIDUAL', [['1', '7', 'GUERIN Alexis', 'ACR', '23:29:45'], ['2', '1', 'NYCH Artem', 'ACR', 'a 47']])}
      ${table('PONTOS NA ETAPA', [['1', '14', 'PERICAS Adria*', 'UAD', '25']])}
      ${table('GERAL PONTOS', [['1', '13', 'OLIVEIRA Rui', 'UAD', '74']])}
      ${table('GERAL MONTANHAS', [['1', '7', 'GUERIN Alexis', 'ACR', '48']])}
      ${table('GERAL JUVENTUDE', [['1', '14', 'PERICAS Adria*', 'UAD']])}
      ${table('EQUIPAS NA ETAPA', [['1', '1', 'ANICOLOR/CAMPICARN', 'ACR', '11:29:02']])}
      ${table('GERAL EQUIPAS', [['1', '1', 'ANICOLOR/CAMPICARN', 'ACR', '70:35:34']])}
    </table></div>`;
    const classifications = provisionalClassificationsFromHtml(html, '87-volta-a-portugal-jogos-santa-casa', 7);
    expect(classifications.map((classification) => `${classification.scope}/${classification.classKind}`)).toEqual([
      'stage/stage', 'stage/gc', 'overall/points', 'overall/kom', 'overall/youth', 'overall/teams',
    ]);
    const stage = classifications[0];
    expect(stage.eventId).toBe(-1961080700);
    expect(stage.winnerName).toBe('PERICAS Adria');
    expect(stage.rows.map((row) => row.gapText)).toEqual([null, '+0', '+0', '+28', '+28']);
    expect(classifications.at(-1).rows[0]).toMatchObject({ bib: null, riderDisplay: 'ACR - ANICOLOR/CAMPICARN', timeText: '70:35:34' });
  });

  it('lee las incidencias del libro PDF, pisa clasificadas y añade dorsales ausentes del DataTable', () => {
    const html = '<a href="/download/3571/abc">Classificações 1ª Etapa - Volta</a><a href="/download/3572/def">Resumo Classificações</a>';
    expect(stagePdfUrlFromHtml(html)).toBe('https://www.classificacoes.net/download/3571/abc');
    const irms = summaryIrmsFromPdfText(`RESUMO DA ETAPA\nALINHARAM 118 corredores\nDESISTIRAM 26, 154, 164\nFORA DE CONTROLO 96\nNÃO ALINHARAM 84`);
    expect([...irms.entries()]).toEqual([['26', 'DNF'], ['154', 'DNF'], ['164', 'DNF'], ['96', 'OTL'], ['84', 'DNS']]);

    const rows = applyPdfSummaryIrms(rowsFromPayload({ aaData: [
      ['1', '1', '', '', 'LÍDER Uno', '', 'AAA', '3:39:08', ''],
      ['118', '96', '', '', 'KEOGH Cian', '', 'APS', '4:02:01', 'a 22:53'],
    ] }), irms);
    expect(rows).toMatchObject([
      { bib: '1', rank: 1 },
      { bib: '96', rank: null, rankText: 'OTL', irm: 'OTL', timeText: null },
      { bib: '26', rank: null, rankText: 'DNF', riderDisplay: 'Sin identificar' },
      { bib: '154', rank: null, rankText: 'DNF' },
      { bib: '164', rank: null, rankText: 'DNF' },
      { bib: '84', rank: null, rankText: 'DNS' },
    ]);
  });

  it('no manda el fallback de una IRM sin nombre a la resolución nominal', () => {
    const riders = extractRidersForNameResolve({ stages: [{ classifications: [{
      eventId: -1,
      rows: [
        { bib: '26', riderDisplay: 'Sin identificar', irm: 'DNF' },
        { bib: '27', riderDisplay: 'RIDER Real' },
      ],
    }] }] });
    expect(riders).toEqual([expect.objectContaining({ bib: '27', display: 'RIDER Real' })]);
  });
});
