import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildStage, eventsListUrl, fetchCompetition, jornadasOf, mapGeneralRows, mapRelayRows, mapStartListIrm, mapTimingRows,
  parseCode, pendingRelayTeams, pendingTimeTrialRiders, raceTypeFor, relayRacesOf, stageNumberFor, suggestCompetitionId,
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
    expect(suggestCompetitionId('107849')).toBe(-129258);   // ancla del ID guardado
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
      ] }, startList: [{ bib: '1', status: 0 }, { bib: '2', status: 0 }] },
      { oneDay: true });
    expect(stages[0].raceType).toBeNull();
    expect(stages[0].classifications[0].rows[1]).toMatchObject({ gapText: '+09' });
  });

  it('no publica una CRI de un día hasta que el último corredor llega o abandona', () => {
    const subEvent = { eventId: 108121, order: 1, eventType: -1, name: 'MEN UNDER23 TIME TRIAL', date: '2026-10-07' };
    const times = [
      { position: 1, bib: '1', order: 2_100_000, gap: '0', createdAt: '2026-10-07T11:00:00Z' },
      { position: 2, bib: '2', order: 2_130_000, gap: '30000', createdAt: '2026-10-07T11:02:00Z' },
    ];
    const rider = (bib, extra = {}) => ({ bib, status: 0, started: true, starting: true, finished: true, ...extra });
    const build = (startList, now = '2026-10-07T11:05:00Z') => buildStage('108121', subEvent,
      { races: [{ raceTypeId: 13 }], timing: { status: 'OK', tot: 2, times }, startList },
      { oneDay: true, now: Date.parse(now) });
    const onCourse = [rider('1'), rider('2'), rider('3', { finished: false })];

    expect(build(null)).toEqual([]);
    expect(build(onCourse)).toEqual([]);
    const [closed] = build([rider('1'), rider('2'), rider('3', { status: 1, finished: false })])[0].classifications;
    expect(closed.rows.map(({ bib, irm }) => [bib, irm])).toEqual([['1', null], ['2', null], ['3', 'DNF']]);
    // Completa de golpe: se publica como oficial, no como llegada progresiva.
    expect(closed.publication).toEqual({ provider: 'evodata', format: 'fixed', sourceStatus: 'official' });
    // Sin estado codificado, el abandono se deriva tras 20 minutos sin llegadas.
    expect(build(onCourse, '2026-10-07T11:30:00Z')[0].classifications[0].rows.at(-1)).toMatchObject({ bib: '3', irm: 'DNF' });
    // Un corredor retirado de la salida (starting=false) no bloquea.
    expect(build([rider('1'), rider('2'), rider('4', { started: false, starting: false, finished: false })])).toHaveLength(1);
    expect(pendingTimeTrialRiders(onCourse, [{ bib: '1' }, { bib: '2' }])).toEqual(['3']);
  });

  it('completa los abandonos de una carrera de un día con la lista de salida', () => {
    const startList = [
      { bib: '4', status: 0 }, { bib: '33', status: 0 }, { bib: '1', status: 1 },
      { bib: '78', status: 3 }, { bib: '42', status: 9 }, { bib: '50', status: 7 }, { bib: '33', status: 1 },
    ];
    const timing = { status: 'OK', tot: 2, times: [
      { position: 1, bib: '4', order: 15_397_613, gap: '0' },
      { position: 2, bib: '33', order: 15_397_613, gap: '-' },
    ] };
    const subEvent = { eventId: 108115, order: 1, eventType: 1, name: 'Men Elite Road Race', date: '2026-10-04' };
    const [stage] = buildStage('108115', subEvent, { races: [{ raceTypeId: 12 }], timing, startList }, { oneDay: true });
    const classification = stage.classifications[0];
    expect(classification.rows.map(({ bib, rank, irm }) => [bib, rank, irm])).toEqual([
      ['4', 1, null], ['33', 2, null], ['1', null, 'DNF'], ['78', null, 'DNS'], ['42', null, 'OTL'],
    ]);
    expect(classification).toMatchObject({ rowCount: 5, expectedRowCount: 5 });

    const stageRace = buildStage('103006', { ...subEvent, order: 2 }, { races: [{ raceTypeId: 12 }], timing, startList }, { totalStages: 4 });
    expect(stageRace[0].classifications[0].rows).toHaveLength(2);
    expect(mapStartListIrm(null)).toEqual([]);
  });

  it('deriva DNF y DNS de las banderas de salida cuando el estado no está codificado', () => {
    const startList = [
      { bib: '4', status: 0, started: true, starting: true, finished: true },
      { bib: '16', status: 0, started: true, starting: false, finished: false },
      { bib: '91', status: 0, started: false, starting: true, finished: false },
      { bib: '52', status: 0, started: false, starting: false, finished: false },
      { bib: '60', status: 0, started: true, starting: true, finished: true },
    ];
    const timing = { status: 'OK', tot: 1, times: [
      { position: 1, bib: '4', order: 14_008_973, gap: '0', createdAt: '2026-10-05T14:29:32.153Z' },
    ] };
    const subEvent = { eventId: 102151, order: 0, eventType: -1, name: 'COPPA BERNOCCHI', date: '2026-10-05' };
    const build = (now) => buildStage('102151', subEvent, { races: [{ raceTypeId: 12 }], timing, startList },
      { oneDay: true, now: Date.parse(now) })[0].classifications[0].rows.map(({ bib, irm }) => [bib, irm]);
    // Con la llegada abierta, quien no ha llegado puede seguir en carrera.
    expect(build('2026-10-05T14:40:00Z')).toEqual([['4', null]]);
    expect(build('2026-10-05T15:00:00Z')).toEqual([['4', null], ['16', 'DNF'], ['91', 'DNS']]);
    // Sin salidas registradas no se distingue DNS de DNF.
    expect(mapStartListIrm(startList.map((rider) => ({ ...rider, started: false })), [], { arrivalClosed: true })).toEqual([]);
  });

  it('trata un evento autónomo UEC como su única jornada', () => {
    const event = { eventId: 107119, parentEventId: 0, eventType: -1, name: 'UEC ITT', date: '2026-06-12T00:00:00.000Z', subEvents: [] };
    expect(jornadasOf(event, '107119')).toEqual([
      { eventId: 107119, order: 1, eventType: -1, name: 'UEC ITT', date: '2026-06-12T00:00:00.000Z' },
    ]);
    expect(jornadasOf({ ...event, parentEventId: 107000 }, '107119')).toEqual([]);
    expect(jornadasOf({ ...event, eventId: 107120 }, '107119')).toEqual([]);
    expect(jornadasOf(null, '107119')).toEqual([]);
  });

  describe('relevo mixto UEC', () => {
    const races = [
      { eventId: 108117, raceId: 100000001, name: 'Elite Mixed Relay', distance: 44, raceTypeId: 13 },
      { eventId: 108117, raceId: 100000002, name: 'Singoli M', distance: 0, raceTypeId: 0 },
      { eventId: 108117, raceId: 100000003, name: 'Singoli F', distance: 0, raceTypeId: 0 },
    ];
    const rider = (bib, teamName) => ({ bib: String(bib), teamName, firstName: 'X', lastName: 'Y' });
    const men = [rider(1, 'Italy'), rider(2, 'Italy'), rider(3, 'Italy'), rider(11, 'France'), rider(12, 'France'), rider(13, 'France')];
    const women = [rider(4, 'Italy'), rider(5, 'Italy'), rider(6, 'Italy'), rider(14, 'France'), rider(15, 'France'), rider(16, 'France')];
    const teams = [
      { position: 2, bib: '2', teamName: 'France', lastName: 'France', order: 3_100_400, gap: '8000' },
      { position: 1, bib: '1', teamName: 'Italy', lastName: 'Italy', order: 3_092_900, gap: '0' },
    ];

    it('reconoce el concurso de selecciones y los concursos individuales', () => {
      expect(relayRacesOf(races)).toMatchObject({ timed: { raceId: 100000001 }, members: [{ raceId: 100000002 }, { raceId: 100000003 }] });
      expect(relayRacesOf(races.slice(0, 1))).toBeNull();
      expect(relayRacesOf([...races, { raceId: 100000004, name: 'Open', distance: 44, raceTypeId: 12 }])).toBeNull();
    });

    it('expande cada selección con el tiempo del equipo en su primer dorsal', () => {
      const rows = mapRelayRows(teams, [...men, ...women]);
      expect(rows).toHaveLength(12);
      expect(rows.slice(0, 6).map((row) => [row.bib, row.rank, row.timeText])).toEqual([
        ['1', 1, '51:32'], ['2', null, null], ['3', null, null], ['4', null, null], ['5', null, null], ['6', null, null],
      ]);
      expect(rows[6]).toMatchObject({ bib: '11', rank: 2, timeText: '51:40', resultValue: '51:40', gapText: null, teamName: 'France' });
      expect(() => mapRelayRows(teams, men.slice(0, 3))).toThrow('sin corredores para la selección France');
    });

    it('usa los tiempos individuales cuando los concursos individuales los publican', () => {
      const individual = [
        { position: 1, bib: '1', order: 1_530_000 }, { position: 2, bib: '2', order: 1_531_000 },
        { position: 1, bib: '5', order: 3_092_900 }, { position: 2, bib: '4', order: 3_095_000 },
      ];
      const rows = mapRelayRows(teams, [...men, ...women], individual).slice(0, 6);
      expect(rows.map((row) => [row.bib, row.rank, row.timeText])).toEqual([
        ['5', 1, '51:32'], ['1', null, '25:30'], ['2', null, '25:31'], ['3', null, null], ['4', null, '51:35'], ['6', null, null],
      ]);
    });

    const teamStart = (bib, name, extra = {}) => ({ bib: String(bib), teamName: name, lastName: name, status: 0, started: true, finished: true, starting: true, ...extra });
    const startTeams = [teamStart(1, 'Italy'), teamStart(2, 'France')];

    it('mantiene el relevo pendiente mientras alguna selección siga en carrera', () => {
      expect(pendingRelayTeams(startTeams, teams)).toEqual([]);
      expect(pendingRelayTeams([...startTeams, teamStart(3, 'Poland', { finished: false })], teams)).toEqual(['Poland']);
      expect(pendingRelayTeams([...startTeams, teamStart(3, 'Poland', { status: 1, finished: false })], teams)).toEqual([]);
      expect(pendingRelayTeams([...startTeams, teamStart(3, 'Poland', { starting: false })], teams)).toEqual([]);
      expect(pendingRelayTeams(null, teams)).toBeNull();
      const payload = { timing: { tot: 2, times: teams }, relayMembers: [...men, ...women], relayTimes: [] };
      const subEvent = { eventId: 108117, date: '2026-10-06T00:00:00.000Z' };
      expect(buildStage('108117', subEvent, { ...payload, relayTeams: [...startTeams, teamStart(3, 'Poland', { finished: false })] })).toEqual([]);
      expect(buildStage('108117', subEvent, { ...payload, relayTeams: null })).toEqual([]);
      expect(buildStage('108117', subEvent, { ...payload, relayTeams: startTeams })).toHaveLength(1);
    });

    it('publica el relevo como clasificación final CRE de un día', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        let data;
        if (url.endsWith('/apptoken')) data = { status: 'OK', token: 'test' };
        else if (url.includes('/getEventById/')) data = { eventId: 108117, parentEventId: 0, eventType: -1, date: '2026-10-06T00:00:00.000Z', subEvents: [] };
        else if (url.includes('/getRacesByEventId/')) data = races;
        else if (url.includes('/getJerseysByEventId/')) data = [];
        else if (url.includes('/getStartList')) data = { status: 'OK', startList: body.raceId === 100000001 ? startTeams : body.raceId === 100000002 ? men : women };
        else if (url.includes('/getResults/')) data = body.raceId === 100000001
          ? { status: 'OK', tot: 2, times: teams }
          : { status: 'KO', msg: 'No times found', tot: 0 };
        else throw new Error(`Petición inesperada: ${url}`);
        return { ok: true, json: async () => data };
      }));
      const [stage, ...rest] = await fetchCompetition('108117', { delay: 0, oneDay: true });
      expect(rest).toEqual([]);
      expect(stage).toMatchObject({ stageNumber: null, isFinalClassification: true, raceType: 'TTT', dateKey: '2026-10-06' });
      expect(stage.classifications).toHaveLength(1);
      expect(stage.classifications[0]).toMatchObject({ classKind: 'gc', scope: 'stage', isTeamEvent: false, rowCount: 12, expectedRowCount: 12 });
    });
  });
});
