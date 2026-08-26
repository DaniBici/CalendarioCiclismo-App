import { describe, expect, it } from 'vitest';
import {
  endpoint, mapRows, officialPdfUrl, parseCode, parseStageIdentity, RESULTS_SOURCE,
  stagesFromPayload, suggestCompetitionId,
} from '../../scripts/results-fetchers/timing-results-fetch.mjs';

describe('timing.ee — resultados públicos', () => {
  it('valida el event y construye URLs e identificadores estables', () => {
    expect(parseCode('133')).toBe('133');
    expect(() => parseCode('baltic')).toThrow('event numérico');
    expect(endpoint('133')).toBe('https://timing.ee/_000/club/live_results_data.php?event=133');
    expect(officialPdfUrl('133', '735')).toContain('event=133&distance_id=735');
    expect(suggestCompetitionId('133')).toBe(-139680);
    expect(RESULTS_SOURCE).toBe('timing.ee');
  });

  it('reconoce sectores y excluye filas de preparación sin correspondencia', () => {
    expect(parseStageIdentity('Stage 1A TALSI - KULDIGA')).toEqual({ stageNumber: 1, sectorIndex: 0 });
    expect(parseStageIdentity('Stage 1B KULDIGA - KULDIGA')).toEqual({ stageNumber: 1, sectorIndex: 1 });
    expect(parseStageIdentity('2nd stage TARTU GP')).toEqual({ stageNumber: 2, sectorIndex: null });
    expect(parseStageIdentity('Prologue')).toEqual({ stageNumber: 0, sectorIndex: null });

    const rows = mapRows([
      { koht: '1', bib: '*11', nimi: 'Rait ÄRM', klubi: 'ENERGUS', country_code: 'EST', aeg: '1:04.869', aeg_voi_kaotus: '1:04', db_match: '1' },
      { koht: '2', bib: '12', nimi: 'Rider Stale', aeg: '1:05', db_match: '0' },
    ], { timed: true, stageTimes: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '11', riderDisplay: 'Rait ÄRM', timeText: '1:04.869', nationality: 'EST' });
  });

  it('emite una clasificación parcial e ignora las filas todavía sin puesto', () => {
    const payload = {
      ok: true,
      groups: [{
        distance_id: '737', distance_name: 'Stage 2 Kuremaa – Ülenurme', distance_date: '2026-08-22',
        rows: [
          { koht: '1', bib: '*14', nimi: 'Lauri TAMM', aeg: '3:59:19', aeg_voi_kaotus: '3:59:19', db_match: '1' },
          { koht: '2', bib: '12', nimi: 'Norman VAHTRA', aeg: '3:59:20', aeg_voi_kaotus: '+1', db_match: '1' },
          { koht: '', bib: '*13', nimi: 'Romet PAJUR', aeg: '', aeg_voi_kaotus: '', db_match: '1' },
        ],
      }],
      classifications: [],
    };

    const stages = stagesFromPayload(payload, { code: '133', onlyStage: 2 });
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ stageNumber: 2, classificationCount: 1 });
    expect(stages[0].classifications[0].rows).toHaveLength(2);
    expect(stages[0].classifications[0].rows[0]).toMatchObject({ rank: 1, bib: '14', riderDisplay: 'Lauri TAMM' });
  });

  it('emite sectores, clasificaciones acumuladas y final con PDF oficial', () => {
    const rider = (rank, name, time, gap = time, club = 'ENERGUS', code = 'ENT') => ({ koht: String(rank), arvestuse_koht: String(rank), bib: String(rank), nimi: name, klubi: club, klubi_lyhend: code, aeg: time, aeg_voi_kaotus: gap, db_match: '1' });
    const payload = {
      ok: true,
      groups: [
        { distance_id: '735', distance_name: 'Stage 1A', distance_date: '2026-08-21', rows: [
          rider(1, 'Rait ÄRM', '0:15:55'), rider(2, 'Martin PLUTO', '0:15:58'),
          rider(3, 'Romet PAJUR', '0:16:03', '0:16:03', 'ESTONIA', 'NTE'),
          rider(4, 'Lauri TAMM', '0:16:05', '0:16:05', 'ESTONIA', 'NTE'),
        ] },
        { distance_id: '738', distance_name: 'Stage 3', distance_date: '2026-08-23', rows: [rider(1, 'Martin PLUTO', '3:30:00')] },
        { distance_id: 'overall', distance_name: 'General classification', rows: [] },
      ],
      classifications: [
        { distance_id: '735', type: 'team', scope: 'stage', rows: [
          { arvestuse_koht: '1', klubi: 'ENT ENERGUS', klubi_lyhend: 'ENT', aeg: '0:16:00', aeg_voi_kaotus: '0:16:00' },
          { arvestuse_koht: '2', klubi: 'NTE ESTONIA', klubi_lyhend: 'NTE', aeg: '0:16:06', aeg_voi_kaotus: '+6' },
        ] },
        { distance_id: '738', type: 'overall_ranking', scope: 'overall', rows: [rider(1, 'Martin PLUTO', '8:00:00')] },
        { distance_id: '738', type: 'team', scope: 'overall', rows: [{ arvestuse_koht: '1', klubi: 'ENT ENERGUS', aeg: '24:00:00', aeg_voi_kaotus: '24:00:00', db_match: '1' }] },
      ],
    };
    const stages = stagesFromPayload(payload, { code: '133', totalStages: 3 });
    expect(stages).toHaveLength(3);
    expect(stages[0]).toMatchObject({ stageNumber: 1, sectorIndex: 0, raceType: 'TTT', sourcePdfUrl: officialPdfUrl('133', '735') });
    expect(stages[0].classifications[0]).toMatchObject({ classKind: 'stage', isTeamEvent: false, winnerName: 'ENERGUS' });
    expect(stages[0].classifications[0].rows.map((row) => row.rank)).toEqual([1, null, 2, null]);
    expect(stages[0].classifications[0].rows.map((row) => row.timeText)).toEqual(['0:16:00', '0:15:58', '0:16:06', '0:16:05']);
    expect(stages[0].classifications[0].rows.map((row) => row.resultValue)).toEqual(['0:15:55', '0:15:58', '0:16:03', '0:16:05']);
    expect(stages[1].classifications.map((item) => item.classKind)).toEqual(['stage']);
    expect(stages[2]).toMatchObject({ stageNumber: null, isFinalClassification: true, sourcePdfUrl: officialPdfUrl('133') });
    expect(stages[2].classifications.map((item) => item.classKind)).toEqual(['gc', 'teams']);
    expect(stages[2].classifications[1].rows[0].riderDisplay).toBe('ENERGUS');
  });
});
