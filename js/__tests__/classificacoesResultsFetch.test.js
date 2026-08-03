import { describe, expect, it } from 'vitest';
import { classify, classificationsFromStageHtml, fnv1a, rowsFromPayload, stageNumber, stagesFromRaceHtml, suggestCompetitionId } from '../../scripts/results-fetchers/classificacoes-results-fetch.mjs';

describe('Classificações.net', () => {
  it('descubre etapas sin fijar sus identificadores', () => {
    const stages = stagesFromRaceHtml(`<tr onclick="location.href='/modalidades/ciclismo/volta/1757'"><td>Prólogo</td></tr><tr onclick="location.href='/modalidades/ciclismo/volta/1758'"><td>1ª Etapa</td></tr>`);
    expect(stages.map((s) => [s.stageNumber, s.stageId])).toEqual([[0, 1757], [1, 1758]]);
    expect(stageNumber('6ª Etapa')).toBe(6);
  });

  it('genera un identificador sintético estable por slug, sin colisionar con DataRide', () => {
    expect(suggestCompetitionId('86-volta-a-portugal-continente')).toBeLessThan(0);
    expect(suggestCompetitionId('86-volta-a-portugal-continente')).toBe(suggestCompetitionId('86-volta-a-portugal-continente'));
    expect(fnv1a('classificacoes:a')).not.toBe(fnv1a('classificacoes:b'));
  });

  it('conserva solo las seis clasificaciones que entienden web y apps', () => {
    const html = `<select name="stageLinkUpa"><option value="/x/results/1">Classificação Individual na Etapa</option><option value="/x/results/2">Geral Pontos</option><option value="/x/results/3">Classificação das Metas Volantes</option></select>`;
    const options = classificationsFromStageHtml(html);
    expect(options.map((x) => classify(x.label)?.classKind || null)).toEqual(['stage', 'points', null]);
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

  it('reconoce los formatos compactos de generales y clasificaciones por equipos', () => {
    const points = rowsFromPayload({ aaData: [['1', '11', 'LEITÃO Iúri', 'CJR', '70']] });
    expect(points[0]).toMatchObject({ bib: '11', riderDisplay: 'LEITÃO Iúri', points: 70, resultValue: '70' });

    const youth = rowsFromPayload({ aaData: [['1', '121', 'LOPES Lucas', 'RPB', '25:19:45']] });
    expect(youth[0]).toMatchObject({ bib: '121', timeText: '25:19:45', gapText: null });

    const teams = rowsFromPayload({ aaData: [['1', 'ATI', 'ATI - ANICOLOR/TIEN 21', '75:57:48', '---']] }, { isTeamEvent: true });
    expect(teams[0]).toMatchObject({ bib: null, riderDisplay: 'ATI - ANICOLOR/TIEN 21', teamName: 'ATI - ANICOLOR/TIEN 21', timeText: '75:57:48' });
  });
});
