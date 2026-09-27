import { describe, expect, it } from 'vitest';
import {
  documentMatchesStage,
  mapRows,
  normalizeGap,
  normalizeTime,
  stagesFromDocuments,
  startlistPublication,
  suggestCompetitionId,
} from '../../scripts/results-fetchers/maneffic-results-fetch.mjs';

const code = '2026/ROA/NED_78380';
const row = (rank, bib, result, gap = '') => ({
  rank, bib, name: `RIDER, ${bib}`, name2: `Rider ${bib}`, teamCode: 'TST',
  teamName: 'TEST TEAM', nationality: 'NED', result, gap,
});

describe('censo independiente para la oficialidad', () => {
  const result = document('Stage 4 - Schijndel', 'Result', [row(1, 32, '4:00:00')], '2026-09-05 16:42:13');
  const startlist = {
    eventName: result.eventName, raceName: result.raceName, documentName: 'Startlist',
    generated: '2026-09-04 20:31:31', riders: [{ bib: 32 }, { bib: 105 }],
  };

  it('conserva como esperado un dorsal que todavía falta en la llegada', () => {
    const publication = startlistPublication(startlist, result, code, 4);
    expect(publication).toMatchObject({ provider: 'maneffic', format: 'progressive', expectedVerified: true, expectedKind: 'bib', expectedIds: ['32', '105'] });
    expect(publication.expectedBasis).toContain('/stage4/startlist.json');
  });

  it.each([
    { raceName: 'Stage 3 - Otra jornada' },
    { eventName: 'Otra carrera 2026' },
    { documentName: 'Provisional Startlist' },
    { generated: '2025-09-04 20:00:00' },
    { generated: '2026-09-03 20:00:00' },
    { generated: '2026-09-06 20:00:00' },
    { riders: [{ bib: 32 }, { bib: 32 }] },
    { riders: [{ bib: 0 }] },
    { riders: [] },
  ])('no acredita un censo incompatible: %j', patch => {
    expect(startlistPublication({ ...startlist, ...patch }, result, code, 4)).toBeNull();
  });

  it('aplica el censo a etapa y general, incluida la final, sin reducirlo a los recibidos', () => {
    const documents = {
      'stage4/startlist.json': startlist,
      'stage4/result.json': result,
      'classifications/classification_general.json': { ...result, resultName: 'General' },
      'classifications/classification_points.json': { ...result, resultName: 'Points', resultData: [row(1, 32, '12')] },
    };
    for (const totalStages of [4, 5]) {
      const stages = stagesFromDocuments(documents, { code, onlyStage: 4, totalStages, expectedDate: '2026-09-05' });
      const classes = stages.flatMap(stage => stage.classifications);
      for (const kind of ['stage', 'gc']) expect(classes.find(cl => cl.classKind === kind).publication.expectedIds).toEqual(['32', '105']);
      expect(classes.find(cl => cl.classKind === 'points').publication).toBeUndefined();
    }
  });
});
const document = (raceName, resultName, resultData, generated = '2026-09-02 18:00:00') => ({
  eventName: 'ZLM Tour 2026', raceName, resultName, generated, resultRemark: '', resultData,
});

describe('identidad Maneffic', () => {
  it('genera el competitionId estable del ZLM Tour 2026', () => {
    expect(suggestCompetitionId(code)).toBe(-180408);
  });

  it('normaliza tiempos y diferencias del JSON público', () => {
    expect(normalizeTime('04:11:49')).toBe('4:11:49');
    expect(normalizeTime('20:26.00')).toBe('20:26.00');
    expect(normalizeGap(' + 0')).toBe('+0');
    expect(normalizeGap('+0:07')).toBe('+0:07');
  });
});

describe('protección contra documentos de prueba', () => {
  const testResult = document('Stage 1 - Time Trial Kapelle', 'Result', [row(1, 11, '20:26.00')], '2026-08-26 11:24:21');

  it('rechaza un resultado generado antes de la fecha real de la etapa', () => {
    expect(documentMatchesStage(testResult, 1, '2026-09-02')).toBe(false);
  });

  it('acepta la misma jornada cuando la fecha de generación coincide', () => {
    expect(documentMatchesStage({ ...testResult, generated: '2026-09-02 18:10:00' }, 1, '2026-09-02')).toBe(true);
  });
});

describe('mapeo de resultados Maneffic', () => {
  it('conserva dorsal, ganador, diferencias e IRM', () => {
    const rows = mapRows([
      row(1, 11, '03:15:28'), row(2, 73, '03:15:28', ' + 0'), row(0, 5, 'DNF'),
    ], { timed: true });
    expect(rows[0]).toMatchObject({ rank: 1, bib: '11', timeText: '3:15:28', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '73', timeText: null, gapText: '+0' });
    expect(rows[2]).toMatchObject({ rank: null, bib: '5', irm: 'DNF', rankText: 'DNF' });
  });

  it('emite las filas de equipos sin dorsal', () => {
    const rows = mapRows([{ rank: 1, bib: 0, teamName: 'TEAM PICNIC POSTNL', result: '06:30:56' }], { timed: true, teamRows: true });
    expect(rows[0]).toMatchObject({ bib: null, riderDisplay: 'TEAM PICNIC POSTNL', teamName: 'TEAM PICNIC POSTNL' });
  });
});

describe('topología por etapas', () => {
  it('publica etapa y generales acumuladas en una jornada intermedia', () => {
    const documents = {
      'stage2/result.json': document('Stage 2 - Westkapelle - Heinkenszand', 'Result', [row(1, 34, '03:15:28')], '2026-09-03 16:10:00'),
      'stage2/result_young.json': document('Stage 2 - Westkapelle - Heinkenszand', 'Result young rider', [row(1, 5, '03:15:32')], '2026-09-03 16:11:00'),
      'stage2/result_teams.json': document('Stage 2 - Westkapelle - Heinkenszand', 'Team result', [{ rank: 1, bib: 0, teamName: 'TEST TEAM', result: '06:30:56' }], '2026-09-03 16:12:00'),
      'classifications/classification_general.json': document('Stage 2 - Westkapelle - Heinkenszand', 'Individual General Classification', [row(1, 34, '3:15:15')], '2026-09-03 16:13:00'),
      'classifications/classification_points.json': document('Stage 2 - Westkapelle - Heinkenszand', 'Points General Classification', [row(1, 34, '20')], '2026-09-03 16:14:00'),
    };
    const [stage] = stagesFromDocuments(documents, { code, onlyStage: 2, totalStages: 5, expectedDate: '2026-09-03' });
    expect(stage.stageNumber).toBe(2);
    expect(stage.classifications.map((item) => [item.classKind, item.scope])).toEqual([
      ['stage', 'stage'], ['youth', 'stage'], ['teams', 'stage'], ['gc', 'stage'], ['points', 'overall'],
    ]);
  });

  it('mueve las generales a la pseudo-etapa final en la última jornada', () => {
    const documents = {
      'stage5/result.json': document('Stage 5 - Waalwijk - Waalwijk', 'Result', [row(1, 11, '04:00:00')], '2026-09-06 16:10:00'),
      'classifications/classification_general.json': document('Stage 5 - Waalwijk - Waalwijk', 'Individual General Classification', [row(1, 11, '18:00:00')], '2026-09-06 16:11:00'),
      'classifications/classification_points.json': document('Stage 5 - Waalwijk - Waalwijk', 'Points General Classification', [row(1, 11, '80')], '2026-09-06 16:12:00'),
    };
    const stages = stagesFromDocuments(documents, { code, onlyStage: 5, totalStages: 5, expectedDate: '2026-09-06' });
    expect(stages).toHaveLength(2);
    expect(stages[0].classifications.map((item) => item.classKind)).toEqual(['stage']);
    expect(stages[1]).toMatchObject({ stageNumber: null, isFinalClassification: true });
    expect(stages[1].classifications.map((item) => [item.classKind, item.scope])).toEqual([
      ['gc', 'stage'], ['points', 'stage'],
    ]);
  });
});
