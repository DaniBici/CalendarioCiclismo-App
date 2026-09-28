import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildStage, eventsListUrl, fetchCompetition, mapGeneralRows, mapTimingRows, parseCode,
  raceTypeFor, stageNumberFor, suggestCompetitionId,
} from '../results-fetchers/evodata-results-fetch.mjs';

describe('EvoData CIS — resultados públicos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('consulta la llegada con el concurso publicado para la segunda etapa', async () => {
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      let data;
      if (url.endsWith('/apptoken')) data = { status: 'OK', token: 'test' };
      else if (url.includes('/getEventById/')) data = { subEvents: [
        { eventId: 107904, order: 1, date: '2026-09-03' },
        { eventId: 107905, order: 2, date: '2026-09-04' },
      ] };
      else if (url.includes('/getRacesByEventId/')) data = [{ eventId: 107905, raceId: 100000002, raceTypeId: 12 }];
      else if (url.includes('/getJerseysByEventId/')) data = [];
      else if (url.includes('/getResults/')) data = body.raceId === 100000002
        ? { status: 'OK', tot: 1, times: [{ position: 1, bib: '44', order: 13429773, gap: '0' }] }
        : { status: 'KO', tot: 0 };
      else throw new Error(`Petición inesperada: ${url}`);
      return { ok: true, json: async () => data };
    }));
    const stages = await fetchCompetition('103006', { onlyStage: 2, totalStages: 4, delay: 0 });
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ stageNumber: 2, dateKey: '2026-09-04' });
    expect(stages[0].classifications[0].rows[0]).toMatchObject({ bib: '44', rank: 1, timeText: '3:43:49' });
    expect(requests.filter(({ url }) => url.includes('/getResults/')).map(({ body }) => body.raceId)).toEqual([100000002]);
  });

  it('valida el evento padre y genera identificadores estables', () => {
    expect(parseCode('107849')).toBe('107849');
    expect(() => parseCode('tour-avenir')).toThrow('eventId padre numérico');
    expect(eventsListUrl('107849')).toBe('https://cis.evodata.it/eventsList/107849');
    expect(suggestCompetitionId('107849')).toBeLessThan(0);
  });

  it('mapea gaps asignados en línea y diferencias cronometradas en contrarreloj', () => {
    const source = [
      { position: 1, bib: '92', order: 11_127_755, gap: '0' },
      { position: 2, bib: '23', order: 11_129_042, gap: '2000' },
      { position: 3, bib: '106', order: 11_129_328, gap: '-' },
      { position: 4, bib: '112', order: 11_132_755, gap: '1000' },
    ];
    expect(mapTimingRows(source)).toEqual([
      expect.objectContaining({ rank: 1, bib: '92', timeText: '3:05:27' }),
      expect.objectContaining({ rank: 2, bib: '23', gapText: '+02' }),
      expect.objectContaining({ rank: 3, bib: '106', gapText: '+02' }),
      expect.objectContaining({ rank: 4, bib: '112', gapText: '+05' }),
    ]);
    expect(mapTimingRows(source, { timeTrial: true })).toEqual([
      expect.objectContaining({ rank: 1, timeText: '3:05:27' }),
      expect.objectContaining({ rank: 2, gapText: '+01' }),
      expect.objectContaining({ rank: 3, gapText: '+01' }),
      expect.objectContaining({ rank: 4, gapText: '+05' }),
    ]);
  });

  it('mapea tiempo, puntos y equipos sin propagar identidad textual individual', () => {
    const timed = mapGeneralRows([
      { position: 1, bib: '92', timeResult: 49_259_000, timeGap: 0, firstName: 'Niels' },
      { position: 2, bib: '133', timeResult: 49_288_000, timeGap: 29_000, firstName: 'Kasper' },
    ], { timed: true });
    expect(timed[0]).toMatchObject({ bib: '92', timeText: '13:40:59' });
    expect(timed[1]).toMatchObject({ bib: '133', gapText: '+29' });
    expect(timed[0]).not.toHaveProperty('riderDisplay');

    const points = mapGeneralRows([{ position: 1, bib: '126', pointsResult: 52 }], { points: true });
    expect(points[0]).toMatchObject({ points: 52, resultValue: '52' });
    const teams = mapGeneralRows([{ position: 1, team: 'DEVELOPMENT TEAM PICNIC POSTNL', timeResult: 147_885_000 }], { timed: true, teams: true });
    expect(teams[0]).toMatchObject({ bib: null, riderDisplay: 'DEVELOPMENT TEAM PICNIC POSTNL', timeText: '41:04:45' });
    const wcc = mapGeneralRows([{ position: 1, team: 'CENTRE MONDIAL DU CYCLISME', timeResult: 147_885_000 }], { timed: true, teams: true });
    expect(wcc[0]).toMatchObject({ riderDisplay: 'WCC Team', teamName: 'WCC Team' });
    const aliases = mapGeneralRows([
      { position: 1, team: 'UAE TEAM EMIRATES ADNOC', timeResult: 147_885_000 },
      { position: 2, team: 'CANADA', timeGap: 10_000 },
    ], { timed: true, teams: true });
    expect(aliases[0]).toMatchObject({ riderDisplay: 'UAE Team Emirates Gen-Z', teamName: 'UAE Team Emirates Gen-Z' });
    expect(aliases[1]).toMatchObject({ riderDisplay: 'Canada', teamName: 'Canada' });
  });

  it('descubre número y tipo de jornada', () => {
    expect(stageNumberFor({ order: 5, name: 'Stage 5' })).toBe(5);
    expect(stageNumberFor({ name: 'Étape 3' })).toBe(3);
    expect(raceTypeFor({ eventType: 2 }, [])).toBe('ITT');
    expect(raceTypeFor({ eventType: 1 }, [{ raceTypeId: 12 }])).toBe('IRR');
  });

  it('separa las generales finales de la última etapa', () => {
    const subEvent = { eventId: 107856, order: 7, eventType: 1, name: 'Stage 7', date: '2026-08-26T00:00:00.000Z' };
    const payload = {
      races: [{ raceTypeId: 12 }],
      timing: { status: 'OK', times: [{ position: 1, bib: '11', order: 10_000_000, gap: '0' }] },
      jerseys: [
        { jerseyId: 1, type: 1 },
        { jerseyId: 2, type: 2 },
        { jerseyId: 9, type: 11 },
      ],
      generals: {
        1: { status: 'OK', results: [{ position: 1, bib: '11', timeResult: 70_000_000, timeGap: 0 }] },
        2: { status: 'OK', results: [{ position: 1, bib: '11', pointsResult: 100 }] },
        9: { status: 'OK', results: [{ position: 1, team: 'FRANCE', timeResult: 210_000_000, timeGap: 0 }] },
      },
    };
    const stages = buildStage('107849', subEvent, payload, { totalStages: 7 });
    expect(stages).toHaveLength(2);
    expect(stages[0].classifications.map((item) => item.classKind)).toEqual(['stage']);
    expect(stages[1]).toMatchObject({ stageNumber: null, isFinalClassification: true });
    expect(stages[1].classifications.map((item) => item.classKind)).toEqual(['gc', 'points', 'teams']);
    expect(stages[1].classifications.every((item) => item.scope === 'stage')).toBe(true);
  });

  it('publica una carrera de un día como clásica y sin número de etapa', () => {
    const subEvent = { eventId: 108062, order: 1, eventType: 1, name: 'GIRO DI CAMPANIA', date: '2026-09-20' };
    const payload = {
      races: [{ raceTypeId: 12 }],
      timing: { status: 'OK', tot: 2, times: [
        { position: 1, bib: '105', order: 15_708_000, gap: '0' },
        { position: 2, bib: '75', order: 15_708_000, gap: '-' },
      ] },
      jerseys: [{ jerseyId: 1, type: 1 }, { jerseyId: 2, type: 2 }],
      generals: {
        1: { status: 'OK', tot: 1, results: [{ position: 1, bib: '105', timeResult: 15_708_000, timeGap: 0 }] },
        2: { status: 'OK', tot: 1, results: [{ position: 1, bib: '105', pointsResult: 100 }] },
      },
    };
    const stages = buildStage('108094', subEvent, payload, { totalStages: 1, oneDay: true });
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ stageNumber: null, isFinalClassification: true, raceType: null });
    expect(stages[0].classifications).toHaveLength(1);
    expect(stages[0].classifications[0]).toMatchObject({
      classKind: 'gc', scope: 'stage', eventName: 'General Classification', rowCount: 2,
    });
  });

  it('conserva las diferencias cronometradas de una CRI de un día', () => {
    const stages = buildStage('108094',
      { eventId: 108063, order: 1, eventType: 2, name: 'Time Trial', date: '2026-09-20' },
      { races: [{ raceTypeId: 13 }], timing: { status: 'OK', times: [
        { position: 1, bib: '1', order: 3_600_000, gap: '0' },
        { position: 2, bib: '2', order: 3_609_000, gap: '-' },
      ] } },
      { oneDay: true });
    expect(stages[0].raceType).toBeNull();
    expect(stages[0].classifications[0].rows[1]).toMatchObject({ gapText: '+09' });
  });
});
