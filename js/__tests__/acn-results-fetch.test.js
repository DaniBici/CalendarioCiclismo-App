import { describe, expect, it } from 'vitest';
import {
  acnMillis, acnReader, acnRelayRows, acnRows, fetchClassification, parseCode, QUIET_MS, RELAY_IDLE_MS,
} from '../../scripts/results-fetchers/acn-results-fetch.mjs';

const CODE = '2156365640493136/20261021_cac/ITTRES2';
const ticks = (ms) => String(BigInt(ms) * 10000n + 621355968000000000n);
const HOUR = 3_600_000;
// Medianoche del 21-10-2026 en Nairobi (UTC+3).
const DAY_START = Date.parse('2026-10-20T21:00:00Z');

const ittColumns = [
  { Name: 'sR_Pos', FieldIdx: 0 }, { Name: 'sI_Nr', FieldIdx: 1 }, { Name: 'Name / UCI Id', FieldIdx: 2 },
  { Name: 't_sR_Start', FieldIdx: 3 }, { Name: 'sBR_Time', FieldIdx: 4 }, { Name: 'sR_Gap', FieldIdx: 5 },
];
const itt = (version, rows) => ({ Version: ticks(version), TableDefinition: { Columns: ittColumns }, Groups: [{ SlaveRows: rows }] });
const roadTable = (version, rows) => ({ Version: ticks(version), Groups: [{ SlaveRows: rows }], TableDefinition: { Columns: [
  { Name: 'sR_Pos', FieldIdx: 0 }, { Name: 'sI_Nr', FieldIdx: 1 }, { Name: 'Name / Team', FieldIdx: 2 }, { Name: 'sRB_Time / Gap', FieldIdx: 3 },
] } });
const tree = { Childs: [{ Type: 'Folder', DisplayName: 'ITT', Childs: [{ Type: 'Folder', DisplayName: 'Women Elite - 20.4km', Childs: [
  { Type: 'result', Id: '196908_2', Route: JSON.stringify({ Params: { key: 'ITTRES2' } }) },
] }] }] };
const event = { EventId: 2156365640493136, StartDate: '2026-10-20T00:00:00', EndDate: '2026-10-25T00:00:00' };

describe('acn-results-fetch', () => {
  it('valida el código evento/ctx/clave y lee tiempos con milésimas', () => {
    expect(parseCode(CODE)).toMatchObject({ eventId: '2156365640493136', ctx: '20261021_cac', key: 'ITTRES2' });
    expect(() => parseCode('2156365640493136/ITTRES2')).toThrow();
    expect(acnMillis('47:27.169')).toBe(2847169);
    expect(acnMillis('+1:06.793')).toBe(66793);
    expect(acnMillis('3:53:06')).toBe(13986000);
    expect(acnMillis('0:00:05')).toBe(5000);
    expect(acnMillis('-')).toBeNull();
    expect(() => acnMillis('DNF')).toThrow();
  });

  it('CRI en curso: omite los DNF que aún pueden salir o llegar y trunca las diferencias', () => {
    const now = DAY_START + 13 * HOUR;
    const table = itt(now - 60_000, [
      ['1.', 'n°167', 'A', 11 * HOUR, '31:02.742', '-'],
      ['2.', 'n°158', 'B', 11.5 * HOUR, '31:04.288', '+0:01.546'],
      ['DNF', 'n°159', 'C', 12.9 * HOUR, null, '-'],
      ['DNS', 'n°165', 'D', null, null, '-'],
    ]);
    const { rows, pending } = acnRows(table, { now, startAt: (ms) => DAY_START + ms });
    expect(rows.map((row) => [row.rankText, row.bib, row.resultValue])).toEqual([['1', '167', '31:02'], ['2', '158', '+01'], ['DNS', '165', null]]);
    expect(pending.map((row) => row.bib)).toEqual(['159']);
  });

  it('CRI terminada: el DNF es definitivo con la tabla estable y el plazo de llegada vencido', () => {
    const now = DAY_START + 15 * HOUR;
    const rows = [['1.', 'n°167', 'A', 11 * HOUR, '31:02.742', '-'], ['DNF', 'n°159', 'C', 12 * HOUR, null, '-']];
    expect(acnRows(itt(now - QUIET_MS + 1, rows), { now, startAt: (ms) => DAY_START + ms }).pending).toHaveLength(1);
    const closed = acnRows(itt(now - QUIET_MS, rows), { now, startAt: (ms) => DAY_START + ms });
    expect(closed.pending).toEqual([]);
    expect(closed.rows.at(-1)).toMatchObject({ bib: '159', irm: 'DNF', rank: null });
  });

  it('rechaza una diferencia publicada que no corresponde al tiempo', () => {
    const table = itt(DAY_START, [['1.', 'n°1', 'A', 0, '31:02.742', '-'], ['2.', 'n°2', 'B', 0, '31:04.288', '+0:05.000']]);
    expect(() => acnRows(table, { now: DAY_START })).toThrow(/no corresponde/);
  });

  it('línea: tiempo del ganador y celda vacía como la diferencia anterior', () => {
    const table = roadTable(DAY_START, [['1.', 18, 'A', '3:53:06'], ['2.', 89, 'B', ''], ['3.', 81, 'C', '0:00:05'], ['4.', 7, 'D', '']]);
    expect(acnRows(table, { now: DAY_START }).rows.map((row) => row.resultValue)).toEqual(['3:53:06', '+00', '+05', '+05']);
  });

  it('filtra una línea conjunta por categoría y renumera respecto a su primer clasificado', () => {
    expect(parseCode('2156365640493136/20261021_cac/IRRES11/elite')).toMatchObject({ key: 'IRRES11', category: 'elite' });
    expect(() => parseCode('2156365640493136/20261021_cac/IRRES11/junior')).toThrow();
    const u23 = (name) => `<b>${name}</b> *<br/><small>10119286237 - ERITREA</small>`;
    const elite = (name) => `<b>${name}</b><br/><small>10131804691 - ERITREA</small>`;
    const table = roadTable(DAY_START, [
      ['1.', 89, u23('HABTOM Hiyab'), '3:53:06'], ['2.', 18, elite('MISGINA Meron'), ''],
      ['3.', 81, u23('SAÏZONOU Glorad'), '0:00:05'], ['4.', 7, elite('ARAÚJO Bruno'), '0:01:20'],
      ['DNF', 2, elite('AMARI Hamza'), ''], ['DNF', 75, u23('DIEGO Albano'), ''],
    ]);
    const now = DAY_START + QUIET_MS;
    expect(acnRows(table, { now, category: 'elite' }).rows.map((row) => [row.rankText, row.bib, row.resultValue]))
      .toEqual([['1', '18', '3:53:06'], ['2', '7', '+1:20'], ['DNF', '2', null]]);
    expect(acnRows(table, { now, category: 'u23' }).rows.map((row) => [row.rankText, row.bib, row.resultValue]))
      .toEqual([['1', '89', '3:53:06'], ['2', '81', '+05'], ['DNF', '75', null]]);
    const unnamed = roadTable(DAY_START, [['1.', 89, null, '3:53:06']]);
    expect(() => acnRows(unnamed, { now, category: 'elite' })).toThrow(/sin nombre/);
    const unnamedOut = roadTable(DAY_START, [['1.', 18, elite('MISGINA Meron'), '3:53:06'], ['OTL', 29, null, '']]);
    const parsed = acnRows(unnamedOut, { now, category: 'elite' });
    expect(parsed.rows.map((row) => row.bib)).toEqual(['18']);
    expect(parsed.pending).toEqual([{ bib: '29', reason: 'fila sin nombre: categoría desconocida' }]);
  });

  it('relevo mixto: una fila por selección con tiempo absoluto y sin publicar en curso', async () => {
    const team = (name, riders) => `<b>${name}</b><br/><small size=-1>${riders.map(([bib, rider, cat]) => `${bib} - ${rider} (${cat})`).join('<br/>')}`;
    const relayTable = (version, rows) => ({ Version: ticks(version), Groups: [{ SlaveRows: rows }], TableDefinition: { Columns: [
      { Name: 'sR_Pos', FieldIdx: 0 }, { Name: 'Team / Riders', FieldIdx: 1 }, { Name: 'w500_sR_gMen_Total / Avg', FieldIdx: 2 },
      { Name: 'w500_sR_gWomen_Total / Avg', FieldIdx: 3 }, { Name: 'sR_Time / Gap', FieldIdx: 4 }, { Name: 'w600_sR_Avg', FieldIdx: 5 },
    ] } });
    const algeria = team('ALGERIA (ALG)', [[1, 'MIMOUNI Oussama', 'ME'], [141, 'HOUILI Nesrine', 'WE'], [2, 'AMARI Hamza', 'ME']]);
    const southAfrica = team('SOUTH AFRICA (RSA)', [[49, 'BASSON Gustav', 'ME'], [161, 'YOUNG Lucy', 'WE']]);
    const kenya = team('KENYA (KEN)', [[33, 'KIMANI Evan', 'ME'], [154, 'KAMONYA Dinna', 'WE']]);
    const rows = [
      ['2.', algeria, null, null, '<b>36:17.534</b><br/>+0:53.422', null],
      ['1.', southAfrica, null, null, '<b>35:24.112</b><br/>-', null],
      [null, kenya, null, null, null, null],
    ];
    const now = DAY_START + 12 * HOUR;
    const running = acnRelayRows(relayTable(now - QUIET_MS, rows), { now });
    expect(running.pending).toEqual([{ team: 'Kenya', reason: 'en carrera' }]);
    const abandoned = ['DNF', kenya, '13:30.179 (5)<br/>-', '-<br/>-', null, null];
    const done = acnRelayRows(relayTable(now - QUIET_MS, [...rows.slice(0, 2), abandoned]), { now });
    expect(done.pending).toEqual([]);
    // Entre tandas, ACN marca DNS a la selección que aún no ha salido.
    const waiting = ['DNS', kenya, '-<br/>-', '-<br/>-', null, null];
    expect(acnRelayRows(relayTable(now - QUIET_MS, [...rows.slice(0, 2), waiting]), { now }).pending)
      .toEqual([{ team: 'Kenya', reason: 'sin salida registrada' }]);
    expect(acnRelayRows(relayTable(now - RELAY_IDLE_MS, [...rows.slice(0, 2), waiting]), { now }).pending).toEqual([]);
    expect(done.rows.map((row) => [row.rankText, row.bib, row.teamName, row.resultValue])).toEqual([
      ['1', '49', 'South Africa', '35:24'], [null, '161', 'South Africa', null],
      ['2', '1', 'Algeria', '36:17'], [null, '2', 'Algeria', null], [null, '141', 'Algeria', null],
      ['DNF', '33', 'Kenya', null], [null, '154', 'Kenya', null],
    ]);
    const read = (table) => acnReader({ event, tree: { Childs: [{ Type: 'result', Id: '198042_50', Route: JSON.stringify({ Params: { key: 'TTTR50' } }) }] },
      tables: { TTTR50: table } });
    const options = { date: '2026-10-21', timeZone: 'Africa/Nairobi' };
    const relayCode = '2156365640493136/20261021_cac/TTTR50';
    expect((await fetchClassification(relayCode, { ...options, read: read(relayTable(now - QUIET_MS, rows)), now })).stages).toEqual([]);
    const closed = await fetchClassification(relayCode, { ...options, now,
      read: read(relayTable(now - QUIET_MS, [...rows.slice(0, 2), abandoned])) });
    expect(closed.stages[0]).toMatchObject({ raceType: 'TTT', isFinalClassification: true });
  });

  it('no publica una CRI hasta que todos los corredores tienen llegada o estado definitivo', async () => {
    const read = (table) => acnReader({ event, tree, tables: { ITTRES2: table } });
    const options = { date: '2026-10-21', timeZone: 'Africa/Nairobi' };
    const rows = [['1.', 'n°167', 'A', 11 * HOUR, '31:02.742', '-'], ['DNF', 'n°159', 'C', 12.9 * HOUR, null, '-']];
    const now = DAY_START + 13 * HOUR;
    const running = await fetchClassification(CODE, { ...options, read: read(itt(now - QUIET_MS, rows)), now });
    expect(running.stages).toEqual([]);
    const later = now + HOUR;
    const closed = await fetchClassification(CODE, { ...options, read: read(itt(later - QUIET_MS, rows)), now: later });
    expect(closed.stages[0].classifications[0].rows.map((row) => row.rankText)).toEqual(['1', 'DNF']);
  });

  it('no publica tablas de otra sesión ni ganadores que no pueden haber llegado', async () => {
    const read = (table) => acnReader({ event, tree, tables: { ITTRES2: table } });
    const rows = [['1.', 'n°167', 'A', 11 * HOUR, '31:02.742', '-']];
    const options = { date: '2026-10-21', timeZone: 'Africa/Nairobi' };
    const stale = await fetchClassification(CODE, { ...options, read: read(itt(DAY_START - HOUR, rows)), now: DAY_START + 15 * HOUR });
    expect(stale.stages).toEqual([]);
    const early = await fetchClassification(CODE, { ...options, read: read(itt(DAY_START + HOUR, rows)), now: DAY_START + 11 * HOUR });
    expect(early.stages).toEqual([]);
    const done = await fetchClassification(CODE, { ...options, read: read(itt(DAY_START + 12 * HOUR, rows)), now: DAY_START + 15 * HOUR });
    expect(done.stages[0]).toMatchObject({ stageNumber: null, isFinalClassification: true, dateKey: '2026-10-21' });
    expect(done.stages[0].classifications[0]).toMatchObject({ classKind: 'gc', scope: 'stage', publication: { provider: 'acn', format: 'progressive' } });
    expect(done.sourceUrl).toContain('/generic/196908_2/home/ITTRES2');
  });
});
