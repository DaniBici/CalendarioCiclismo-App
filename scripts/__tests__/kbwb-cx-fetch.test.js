import { describe, expect, it } from 'vitest';
import { buildKbwbCxDocument, parseKbwbLines, parseKbwbUciCode } from '../results-fetchers/kbwb-cx-fetch.mjs';

const line = (place, over = {}) => ({ place, state: 'finished', number_of_laps: 0, chrono_in_seconds: 2217 + (place - 1) * 10,
  deficit_chrono_in_seconds: (place - 1) * 10, team: 'TEAM X', person: { first_name: 'Giel', last_name: `LEJEUNE${place}`, uci_code: 'BEL20080623' }, ...over });

describe('KBWB CX', () => {
  it('lee nacionalidad y nacimiento del código UCI', () => {
    expect(parseKbwbUciCode('BEL20080623')).toEqual({ noc: 'BEL', isoCode2: 'BE', birthDate: '2008-06-23' });
    expect(parseKbwbUciCode('NED20081332')).toMatchObject({ isoCode2: 'NL', birthDate: null });
    expect(parseKbwbUciCode('')).toEqual({ noc: null, isoCode2: null, birthDate: null });
  });
  it('convierte llegadas, vueltas perdidas y retirados', () => {
    const rows = parseKbwbLines([
      line(3, { chrono_in_seconds: 0, deficit_chrono_in_seconds: -2217, number_of_laps: 1 }),
      line(1), line(2, { person: { first_name: 'Jari', last_name: 'VAN LEE', uci_code: 'FRA20080402' } }),
      line(4, { state: 'did_not_finish', number_of_laps: 99, chrono_in_seconds: 0, deficit_chrono_in_seconds: 0 }),
    ]);
    expect(rows.map(row => [row.rank, row.irm, row.timeSeconds, row.gapText])).toEqual([
      [1, null, '2217', null], [2, null, '2227', '+0:10'], [3, 'LAP', null, '-1 LAP'], [null, 'DNF', null, null]]);
    expect(rows[1]).toMatchObject({ firstName: 'Jari', lastName: 'Van Lee', riderDisplay: 'Jari Van Lee', isoCode2: 'FR', birthDate: '2008-04-02' });
  });
  it('rechaza diferencias incoherentes y puestos no consecutivos', () => {
    expect(() => parseKbwbLines([line(1), line(2, { deficit_chrono_in_seconds: 12 })])).toThrow(/diferencia/);
    expect(() => parseKbwbLines([line(1), line(3, { deficit_chrono_in_seconds: 20 })])).toThrow(/consecutivos/);
    expect(() => parseKbwbLines([line(1, { state: 'unknown' })])).toThrow();
  });
  it('separa pruebas sin publicar e inválidas y acredita la clave', () => {
    const details = (id, result) => ({ id, date: '2026-10-25', result, city: 'TELENET SUPERPRESTIGE OVERIJSE' });
    const document = buildKbwbCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-10-25', source: 'kbwb', races: [
      { key: '1', category: 'MJ', details: details(1, 1), results: [{ name: 'MJ', race_result_lines: [line(1), line(2)] }] },
      { key: '2', category: 'WJ', details: details(2, 0), results: [] },
      { key: '3', category: 'ME', details: details(3, 1), results: [{ race_result_lines: [line(2)] }] }] });
    expect(document.categories).toMatchObject([{ category: 'MJ', evidence: { kbwb: { raceId: '1' } } }]);
    expect(document.skipped).toMatchObject([{ category: 'WJ' }]);
    expect(document.invalid).toMatchObject([{ category: 'ME' }]);
    expect(() => buildKbwbCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-10-26', races: [
      { key: '1', category: 'MJ', details: details(1, 1), results: [] }] })).toThrow(/no del/);
  });
});
