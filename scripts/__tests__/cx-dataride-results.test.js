import { describe, expect, it } from 'vitest';
import { classifyCxRace, createCxDataRideClient, cxDataRideDate, cxDataRideSeconds, cxNaturalRiderDisplay, fetchCxCompetition, normalizeCxDataRideRows } from '../results-fetchers/cx-dataride-results.mjs';

const race = (id, category = 'Men Elite', type = 'CRO-IND') => ({ Id: id, CategoryCode: category, RaceName: category,
  RaceTypeCode: type, DisciplineCode: 'CRO', Date: '12 Sep 2026' });
const sourceRow = (id, rank, value, extras = {}) => ({ ResultId: id, Rank: String(rank), RankNumber: rank,
  DisplayName: `PRUEBA Corredor ${id}`, Bib: `0${id}`, ResultValue: value, IsoCode2: 'ES', PointPcR: 123, ...extras });
const response = (data, status = 200) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status });

describe('mangas CX y normalización DataRide', () => {
  it('resuelve las seis categorías en el padre y excluye relevo, máster y carretera', () => {
    const names = ['Men Elite', 'Women Elite', 'Men Under 23', 'Women Under 23', 'Men Junior', 'Women Junior'];
    expect(names.map((name, index) => classifyCxRace(race(index + 1, name)).category)).toEqual(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
    expect(classifyCxRace(race(1, 'Mixed Elite', 'CRO-TR')).category).toBeNull();
    expect(classifyCxRace(race(1, 'Men Masters')).category).toBeNull();
    expect(classifyCxRace({ ...race(1), DisciplineCode: 'ROA' }).category).toBeNull();
    expect(classifyCxRace({ ...race(1), RaceName: 'Women Elite' }).category).toBeNull();
  });
  it('usa fecha textual civil, rechaza centinelas y no crea una salida desde StartDate', () => {
    expect(cxDataRideDate('29 Feb 2028')).toBe('2028-02-29');
    expect(cxDataRideDate('2026-09-12')).toBe('2026-09-12');
    expect(cxDataRideDate('29 Feb 2027')).toBeNull(); expect(cxDataRideDate('/Date(123456)/')).toBeNull();
    expect(cxDataRideDate('01 Jan 0001')).toBe('0001-01-01'); // El guard de temporada del upsert lo excluye.
  });
  it('conserva absolutos, dorsales textuales, diferencias y NULL en bonos; ignora PointPcR', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:00'), sourceRow(2, 2, '1:00:15'), sourceRow(3, 3, '+120')]);
    expect(rows.map(row => [row.timeText, row.gapText, row.timeSeconds])).toEqual([
      ['1:00:00', null, '3600'], ['1:00:15', '+15', '3615'], [null, '+120', '3720'],
    ]);
    expect(rows.every(row => row.points === null && row.bonusPoints === 0 && row.bonusSeconds === null)).toBe(true);
    expect(rows[0].bib).toBe('01'); expect(rows[0].isoCode2).toBe('ES');
  });
  it('mantiene el formato de reloj al cruzar la hora desde un ganador con hora cero', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '00:58:10'), sourceRow(2, 2, '01:01:19'),
      sourceRow(3, 3, '01:02:00'), sourceRow(4, 4, '-1 LAP', { Irm: 'LAP' })]);
    expect(rows.map(row => row.timeSeconds)).toEqual(['3490', '3679', '3720', null]);
    expect(rows[1].gapText).toBe('+189');
  });
  it('acredita H:MM:SS con un ganador de más de una hora (Quimper ME 2026)', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '01:03:03'), sourceRow(2, 2, '01:03:15'),
      sourceRow(3, 3, '01:07:57'), sourceRow(4, 30, '-1 LAP', { Irm: 'LAP' })]);
    expect(rows.map(row => [row.timeSeconds, row.gapText])).toEqual([['3783', null], ['3795', '+12'], ['4077', '+294'], [null, '-1 LAP']]);
    const exact = normalizeCxDataRideRows([sourceRow(1, 1, '01:03:00'), sourceRow(2, 2, '01:04:00')]);
    expect(exact.map(row => row.timeSeconds)).toEqual(['3780', '3840']);
  });
  it('conserva el dialecto MM:SS:ff sin redondear fracciones ni usar un DNF para elegir formato', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '45:10:00'), sourceRow(2, 2, '46:12:00'),
      sourceRow(3, 3, '46:12:50'), sourceRow(4, null, '00:50:00', { Rank: 'DNF', Irm: 'DNF' })]);
    expect(rows.map(row => row.timeSeconds)).toEqual(['2710', '2772', null, null]);
    expect(rows[1].gapText).toBe('+62');
  });
  it('parte el DisplayName «APELLIDO Nombre» de DataRide CX para identidad de ficha', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:00'),
      sourceRow(2, 2, '1:00:10', { DisplayName: 'VAN DE HOEF Alanna' }),
      sourceRow(3, null, 'DNF', { Rank: 'DNF', Irm: 'DNF', DisplayName: 'NASH' }),
      sourceRow(4, 4, '1:00:20', { DisplayName: 'GARCÍA-LÓPEZ José Manuel' }),
      sourceRow(5, 5, '1:00:30', { DisplayName: 'BAŽANT Kryštof' }),
      sourceRow(6, 6, '1:00:40', { DisplayName: 'BAŽANTOVÁ Anežka' })]);
    expect(rows[0]).toMatchObject({ lastName: 'Prueba', firstName: 'Corredor 1' });
    expect(rows[1]).toMatchObject({ lastName: 'Van de Hoef', firstName: 'Alanna' });
    expect(rows[2]).toMatchObject({ firstName: null, lastName: null, riderDisplay: 'NASH' });
    expect(rows[3]).toMatchObject({ lastName: 'García-López', firstName: 'José Manuel' });
    expect(rows[4]).toMatchObject({ lastName: 'Bažant', firstName: 'Kryštof', riderDisplay: 'Kryštof Bažant' });
    expect(rows[5]).toMatchObject({ lastName: 'Bažantová', firstName: 'Anežka', riderDisplay: 'Anežka Bažantová' });
    expect(rows[1].riderDisplay).toBe('Alanna Van de Hoef');
    expect(rows[3].riderDisplay).toBe('José Manuel García-López');
  });
  it('forma el display en orden natural usando las partes separadas', () => {
    expect(cxNaturalRiderDisplay('GARRY', 'MILLBURN', 'MILLBURN Garry')).toBe('Garry Millburn');
    expect(cxNaturalRiderDisplay(null, null, 'MILLBURN Garry')).toBe('MILLBURN Garry');
  });
  it('preserva IRM y vueltas perdidas, sin convertir LAP en DNF ni tiempo real', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:00'), sourceRow(2, 20, '-1 LAP', { Irm: 'LAP' }),
      sourceRow(3, null, 'DNF', { Rank: 'DNF', Irm: 'DNF' }), sourceRow(4, 21, '-2 LAPS'),
      sourceRow(5, null, '0:45:00', { Rank: 'DNF', Irm: 'DNF' })]);
    expect(rows[1]).toMatchObject({ rank: 20, irm: 'LAP', gapText: '-1 LAP', timeSeconds: null });
    expect(rows[2]).toMatchObject({ rank: null, irm: 'DNF', timeSeconds: null });
    expect(rows[3]).toMatchObject({ rank: 21, irm: 'LAP', timeSeconds: null });
    expect(rows[4]).toMatchObject({ timeText: '0:45:00', timeSeconds: null });
  });
  it('retira la posición de listado de un DNF/DNS publicado con Rank numérico (Blue Ridge 2026)', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:26'), sourceRow(2, 25, '-4', { Irm: 'LAP' }),
      sourceRow(3, 26, null, { Irm: 'DNF' }), sourceRow(4, 27, 'DNS')]);
    expect(rows[1]).toMatchObject({ rank: 25, rankText: '25', irm: 'LAP', gapText: '-4 LAP' });
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', timeSeconds: null, sourceSortOrder: 2 });
    expect(rows[3]).toMatchObject({ rank: null, rankText: 'DNS', irm: 'DNS', timeSeconds: null });
  });
  it('no reinterpreta un absoluto inferior al ganador ni redondea centésimas', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:00'), sourceRow(2, 2, '00:00:07'), sourceRow(3, 3, '1:00:15.52')]);
    expect(rows[1].sourceConflict).toMatch(/inferior/); expect(rows[1].timeText).toBe('00:00:07');
    expect(rows[2]).toMatchObject({ timeText: '1:00:15.52', timeSeconds: null });
  });
  it('guarda los déficits numéricos como vueltas solo cuando la fuente acredita LAP', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '00:58:10'),
      sourceRow(2, 27, '-2', { Irm: 'LAP' }), sourceRow(3, 29, '-3', { Irm: 'lap' }),
      sourceRow(4, 35, '-5', { Irm: 'LAP' }), sourceRow(5, 36, '-2'),
      sourceRow(6, null, '-2', { Rank: 'DNF', Irm: 'DNF' }),
      sourceRow(7, 37, '-2.5', { Irm: 'LAP' }), sourceRow(8, 38, '0', { Irm: 'LAP' }),
      sourceRow(9, 40, '2', { Irm: 'LAP' }), sourceRow(10, 41, '3', { Irm: 'LAP' }),
      sourceRow(11, 43, '- 2', { Irm: 'LAP' }), sourceRow(12, 44, "'-1'", { Irm: 'LAP' }),
      sourceRow(13, 45, '@ 3 LAPS'), sourceRow(14, 46, '@ 3 LAPS', { Irm: 'LAP' }),
      sourceRow(15, 47, '1:02:28', { Irm: 'LAP' })]);
    expect(rows.slice(1, 4).map(row => [row.rank, row.irm, row.gapText, row.timeText, row.timeSeconds])).toEqual([
      [27, 'LAP', '-2 LAP', null, null], [29, 'LAP', '-3 LAP', null, null], [35, 'LAP', '-5 LAP', null, null],
    ]);
    expect(rows.slice(4).map(row => [row.irm, row.gapText, row.timeText, row.timeSeconds])).toEqual([
      [null, null, '-2', null], ['DNF', null, '-2', null], ['LAP', null, '-2.5', null], ['LAP', null, '0', null],
      ['LAP', '-2 LAP', null, null], ['LAP', '-3 LAP', null, null],
      ['LAP', '-2 LAP', null, null], ['LAP', '-1 LAP', null, null],
      ['LAP', '@ 3 LAPS', null, null], ['LAP', '@ 3 LAPS', null, null],
      ['LAP', null, '1:02:28', null],
    ]);
  });
  it('usa RankNumber cuando falta Rank y conserva un conflicto de puestos', () => {
    const rows = normalizeCxDataRideRows([sourceRow(1, 1, '1:00:00', { Rank: '' }), sourceRow(2, 2, '1:00:10', { Rank: '3' })]);
    expect(rows[0].rank).toBe(1); expect(rows[1].sourceConflict).toMatch(/discrepan/);
  });
  it('no inventa tiempo/puesto para filas vacías ni un corredor Race Cancelled', () => {
    expect(normalizeCxDataRideRows([{ DisplayName: 'Race Cancelled' }])).toEqual([]);
    expect(normalizeCxDataRideRows([sourceRow(1, null, '', { Rank: '' })])[0]).toMatchObject({ rank: null, timeSeconds: null, bonusSeconds: null });
  });
  it('parsea segundos como BIGINT y rechaza formatos/valores no representables', () => {
    expect(cxDataRideSeconds('2501999792983:36:33')).toBe('9007199254740993');
    expect(cxDataRideSeconds('+1:00:01', { gap: true })).toBe('3601');
    for (const text of ['1:60:00', '1:00:61', '1:00:00.5', '-1 LAP', '123']) expect(cxDataRideSeconds(text)).toBeNull();
    expect(cxDataRideSeconds('999999999999999999999:00:00')).toBeNull();
  });
});

describe('cliente DataRide CX paginado', () => {
  it('verifica la edición y la pertenencia antes de consultar las mangas; comparte el catálogo sin escribir calendario', async () => {
    const requests=[];
    const client=createCxDataRideClient({delayMs:0,fetchImpl:async(url,options={})=>{
      requests.push({url,options});
      if(url.endsWith('uci.ch/'))return response('');
      if(url.includes('GetDisciplineSeasons/'))return response([{Id:472,Year:2027}]);
      if(url.endsWith('Competitions/'))return response({total:1,data:[{CompetitionId:100}]});
      if(url.endsWith('Races/'))return response({total:2,data:[race(10),race(11,'Women Elite')]});
      if(url.endsWith('Events/'))return response([{EventId:20,EventName:'General Classification'}]);
      return response({total:1,data:[sourceRow(1,1,'1:00:00')]});
    }});
    const doc=await fetchCxCompetition({competitionId:100,seasonId:472,categories:['ME'],client});
    expect(doc.seasonKey).toBe('2026-27');expect(doc.categories.map(c=>c.category)).toEqual(['ME']);
    expect(requests.filter(r=>r.url.endsWith('Events/')).map(r=>r.options.body.get('raceId'))).toEqual(['10']);
    await expect(fetchCxCompetition({competitionId:101,seasonId:472,client})).rejects.toThrow(/pertenece/);
    await expect(fetchCxCompetition({competitionId:100,seasonId:455,client})).rejects.toThrow(/inexistente/);
    expect(requests.filter(r=>r.url.endsWith('Competitions/'))).toHaveLength(1);
    expect(requests.filter(r=>r.url.includes('GetDisciplineSeasons/'))).toHaveLength(1);
    const catalog=requests.find(r=>r.url.endsWith('Competitions/'));
    expect(catalog.options.body.get('filter[filters][2][value]')).toBe('472');
    expect(catalog.options.body.get('disciplineId')).toBe('3');
    expect(catalog.options.body.get('sort[0][field]')).toBe('StartDate');
    expect(requests.filter(r=>r.url.endsWith('Races/'))).toHaveLength(1);
  });
  it('rechaza temporadas de forma desconocida sin consultar competiciones', async () => {
    for(const invalid of [response('<html>'),response([{Id:472,Year:'2027'}]),response({data:[]}),response([],503)]){
      const client=createCxDataRideClient({delayMs:0,fetchImpl:async()=>invalid});
      await expect(fetchCxCompetition({competitionId:100,seasonId:472,client})).rejects.toThrow();
    }
  });
  it('obtiene más de 300 filas, mantiene disciplineId=3 y no expone la cookie', async () => {
    const requests = []; const all = Array.from({ length: 501 }, (_, index) => ({ ResultId: index + 1 }));
    const client = createCxDataRideClient({ delayMs: 0, fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('uci.ch/')) return new Response('', { headers: { 'set-cookie': 'session=temporary; Path=/' } });
      const skip = Number(options.body.get('skip')); const take = Number(options.body.get('take'));
      return response({ total: 501, data: all.slice(skip, skip + take) });
    } });
    const rows = await client.pages('Results/', { eventId: '10', disciplineId: '10' }, 'ResultId');
    expect(rows).toHaveLength(501); expect(requests.slice(1).map(item => item.options.body.get('skip'))).toEqual(['0', '200', '400']);
    expect(requests.slice(1).every(item => item.options.body.get('disciplineId') === '3')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('temporary'); expect(requests.slice(1).every(item => !item.options.headers.Cookie)).toBe(true);
  });
  it('mantiene la cookie solo en memoria para Events y valida su array', async () => {
    let eventsRequest;
    const client = createCxDataRideClient({ delayMs: 0, fetchImpl: async (url, options) => {
      if (url.endsWith('uci.ch/')) return new Response('', { headers: { 'set-cookie': 'session=temporary; Path=/' } });
      eventsRequest = options; return response([]);
    } });
    expect(await client.events(1)).toEqual([]); expect(eventsRequest.headers.Cookie).toBe('session=temporary');
    const bad = createCxDataRideClient({ delayMs: 0, fetchImpl: async url => url.endsWith('uci.ch/') ? response('') : response({ data: [] }) });
    await expect(bad.events(1)).rejects.toThrow(/array/);
  });
  it('rechaza HTML con 200, HTTP erróneo, página vacía, total variable e IDs repetidos', async () => {
    for (const replies of [
      [response('<html>error</html>')], [response({}, 503)], [response({ total: 1, data: [] })],
      [response({ total: 2, data: [{ Id: 1 }] }), response({ total: 3, data: [{ Id: 2 }] })],
      [response({ total: 2, data: [{ Id: 1 }] }), response({ total: 2, data: [{ Id: 1 }] })],
    ]) {
      const client = createCxDataRideClient({ delayMs: 0, pageSize: 1, fetchImpl: async url => url.endsWith('uci.ch/') ? response('') : replies.shift() });
      await expect(client.pages('Races/', {}, 'Id')).rejects.toThrow();
    }
  });
  it('recorre el padre de cada categoría aunque los IDs del evento sean cero y no crea WU', async () => {
    const client = { pages: async path => path === 'Races/' ? [race(10), race(11, 'Women Elite'), race(12, 'Mixed Elite', 'CRO-TR')]
      : [sourceRow(1, 1, '1:00:00')], events: async () => [{ EventId: 20, EventName: 'General Classification', IsTeamEvent: false, RaceId: 0, CompetitionId: 0 }] };
    const doc = await fetchCxCompetition({ competitionId: 100, client });
    expect(doc.categories.map(item => item.category)).toEqual(['ME', 'WE']);
    expect(doc.categories[0]).toMatchObject({ uciRaceId: 10, eventId: 20, publicationHint: 'unverified_results' });
    expect(doc.exclusions[0].reason).toMatch(/Relevo/); expect(doc.categories[0].evidence.inputSource).toBe('dataride');
  });
  it('distingue filas de inscritos vacías de resultados y exige correspondencia de Race ID', async () => {
    const client = { pages: async path => path === 'Races/' ? [race(10)] : [sourceRow(1, null, '', { Rank: '' })],
      events: async () => [{ EventId: 20, EventName: 'General Classification' }] };
    expect((await fetchCxCompetition({ competitionId: 100, client })).categories[0].publicationHint).toBe('not_published');
    await expect(fetchCxCompetition({ competitionId: 100, uciRaceId: 99, client })).rejects.toThrow(/pertenece/);
  });
});
