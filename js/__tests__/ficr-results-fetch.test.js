import { describe, expect, it } from 'vitest';
import {
  apiReader, arrivalRows, censusPublication, fetchCompetition, generalRows, mapTappe, parseCode, parseTime, ridersCensus,
} from '../../scripts/results-fetchers/ficr-results-fetch.mjs';

const finisher = (bib, time) => ({ ri_Numero: bib, Tempo: time, TempoDistacco: '' });
const out = (bib, state) => ({ fg_Numero: bib, fg_StatoFormattato: state });
const rider = (bib) => ({ co_Numero: bib });
const tappa = (n, date, type = 1, prologue = false) => ({ ta_Tappa: n, ta_Data: `${date}T00:00:00.000Z`, ta_TipoTappa: type, ta_Prologo: prologue, ta_Descrizione: `Tappa ${n}` });

describe('ficr-results-fetch', () => {
  it('valida el código año/equipo/carrera', () => {
    expect(parseCode('2026/102/10')).toMatchObject({ year: 2026, team: 102, race: 10 });
    expect(() => parseCode('2026/102')).toThrow();
  });

  it('lee los formatos de tiempo de llegada, contrarreloj y diferencia', () => {
    expect(parseTime("4:09'53")).toBe(1499300);
    expect(parseTime("11'09")).toBe(66900);
    expect(parseTime("1'10.99")).toBe(7099);
    expect(parseTime('26')).toBe(2600);
    expect(parseTime('1.28')).toBe(128);
    expect(parseTime('')).toBeNull();
    expect(() => parseTime('4:09')).toThrow();
  });

  it('da prioridad al estado de fuera de carrera y conserva el orden publicado', () => {
    const rows = arrivalRows({
      results: [finisher(5, "4:09'53"), finisher(11, "4:11'18"), finisher(7, "4:09'53"), finisher(9, "4:30'00")],
      fuorigara: [out(9, 'FTM'), out(3, 'NA'), out(2, 'NS')],
    });
    expect(rows.map((row) => [row.rank, row.bib, row.resultValue, row.irm])).toEqual([
      [1, '5', '4:09:53', null], [2, '11', '+1:25', null], [3, '7', '+00', null],
      [null, '2', null, 'DNS'], [null, '3', null, 'DNF'], [null, '9', null, 'OTL'],
    ]);
    expect(() => arrivalRows({ results: [finisher(1, "1'00")], fuorigara: [out(4, 'XX')] })).toThrow(/desconocido/);
  });

  it('trunca las centésimas de la contrarreloj al calcular diferencias', () => {
    const rows = arrivalRows({ results: [finisher(15, "1'10.99"), finisher(40, "1'12.27")], fuorigara: [] });
    expect(rows.map((row) => row.resultValue)).toEqual(['1:10', '+01']);
  });

  it('omite de las generales a los corredores fuera de carrera', () => {
    const payload = { classifiche: [
      { cr_Stato: 0, cr_Numero: 21, Tempo: "6:17'27", cr_Punti: 27 },
      { cr_Stato: 0, cr_Numero: 17, Tempo: "6:17'53", cr_Punti: 32 },
      { cr_Stato: 4, cr_Numero: 10, Tempo: '', cr_Punti: 0 },
    ] };
    expect(generalRows(payload, {}).map((row) => [row.rank, row.bib, row.resultValue])).toEqual([[1, '21', '6:17:27'], [2, '17', '+26']]);
  });

  it('numera el prólogo como etapa 0 y las tappe de una misma fecha como sectores', () => {
    expect(mapTappe([tappa(1, '2026-09-10', 2, true), tappa(2, '2026-09-11')]).map((t) => [t.stageNumber, t.sectorIndex, t.raceType]))
      .toEqual([[0, 0, 'ITT'], [1, 0, 'IRR']]);
    expect(mapTappe([tappa(1, '2026-07-18'), tappa(2, '2026-07-18', 2), tappa(3, '2026-07-19')]).map((t) => [t.stageNumber, t.sectorIndex]))
      .toEqual([[1, 0], [1, 1], [2, 0]]);
  });

  it('emite la clasificación de un día y rechaza una tappa de otra fecha', async () => {
    const api = {
      'descrizione/2026/102/10': [{ ga_Anno: 2026, ga_Descrizione: '98 IL  LOMBARDIA UNDER 23' }],
      'tappe/2026/102/10': [tappa(1, '2026-10-03')],
      'arrivi/2026/102/10/1': [{ rv_Rilevazione: 1, rv_TipoRilevazione: 3 }, { rv_Rilevazione: 6, rv_TipoRilevazione: 1 }],
      'results/2026/102/10/1/1/6/*': { results: [finisher(1, "4:00'00"), finisher(2, "4:00'05")], fuorigara: [out(3, 'NA')] },
      'riders/2026/102/10/*/N': [rider(1), rider(2), rider(3)],
    };
    const now = Date.parse('2026-10-03T15:00:00Z');
    const { stages } = await fetchCompetition('2026/102/10', { read: apiReader(api), oneDay: true, date: '2026-10-03', now });
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ stageNumber: null, isFinalClassification: true, dateKey: '2026-10-03' });
    expect(stages[0].classifications[0]).toMatchObject({ classKind: 'gc', scope: 'stage', rowCount: 3 });
    expect(stages[0].classifications[0].publication).toMatchObject({ provider: 'ficr', format: 'progressive',
      expectedVerified: true, expectedKind: 'bib', expectedIds: ['1', '2', '3'] });
    await expect(fetchCompetition('2026/102/10', { read: apiReader(api), oneDay: true, date: '2026-10-02', now })).rejects.toThrow(/jornada es el/);
    await expect(fetchCompetition('2026/102/10', { read: apiReader(api), oneDay: true, date: '2026-10-07', now })).rejects.toThrow(/jornada es el/);
    const before = await fetchCompetition('2026/102/10', { read: apiReader(api), oneDay: true, date: '2026-10-03', now: Date.parse('2026-10-02T12:00:00Z') });
    expect(before.stages).toEqual([]);
  });

  it('en un día admite la fecha de alta de FICR hasta tres días antes de la jornada', async () => {
    const api = {
      'descrizione/2026/102/13': [{ ga_Anno: 2026, ga_Descrizione: '79 COPPA Ugo Agostoni' }],
      'tappe/2026/102/13': [tappa(1, '2026-10-02')],
      'arrivi/2026/102/13/1': [{ rv_Rilevazione: 1, rv_TipoRilevazione: 1 }],
      'results/2026/102/13/1/1/1/*': { results: [finisher(4, "3:50'00")], fuorigara: [] },
      'riders/2026/102/13/*/N': [rider(4)],
    };
    const read = apiReader(api);
    const early = await fetchCompetition('2026/102/13', { read, oneDay: true, date: '2026-10-04', now: Date.parse('2026-10-03T15:00:00Z') });
    expect(early.stages).toEqual([]);
    const { stages } = await fetchCompetition('2026/102/13', { read, oneDay: true, date: '2026-10-04', now: Date.parse('2026-10-04T15:00:00Z') });
    expect(stages[0]).toMatchObject({ dateKey: '2026-10-04', isFinalClassification: true });
    await expect(fetchCompetition('2026/102/13', { read, stageDates: { 1: '2026-10-04' }, now: Date.parse('2026-10-04T15:00:00Z') }))
      .rejects.toThrow(/jornada es el/);
  });

  it('acredita el censo con la lista de FICR; la general descuenta los fuera de carrera', () => {
    const census = ridersCensus([rider(1), rider(2), rider(3), rider(4)]);
    const arrival = arrivalRows({ results: [finisher(1, "4:00'00"), finisher(2, "4:00'05")], fuorigara: [out(3, 'NA'), out(4, 'NS')] });
    expect(censusPublication(census, { arrival, basis: 'b' }).expectedIds).toEqual(['1', '2', '3', '4']);
    expect(censusPublication(census, { excluded: ['3', '4'], basis: 'b' }).expectedIds).toEqual(['1', '2']);
    // Un dorsal de la llegada ausente de la lista invalida el censo.
    expect(censusPublication(census, { arrival: [...arrival, { bib: '9' }], basis: 'b' })).toBeNull();
    expect(ridersCensus([rider(1), rider(1)])).toBeNull();
  });
});
