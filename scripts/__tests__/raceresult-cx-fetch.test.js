import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRaceresultCxDocument, fetchRaceresultContests, parseRaceresultList, parseRaceresultRows, raceresultContestCategory, raceresultEventUrl,
  raceresultKey, raceresultName, raceresultResultsList, raceresultSeconds } from '../results-fetchers/raceresult-cx-fetch.mjs';

// Campeonatos Panamericanos 08-11-2025 (evento 370461, terminado) y 07-11-2026 (434035, lista de salida antes de la carrera).
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/raceresult-panam-${name}.json`, import.meta.url), 'utf8'));
const EVENT_2025 = 'https://my.raceresult.com/370461/';

function fakeFetch(config, lists) {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const contest = /contest=(\d+)/.exec(url)?.[1];
    return { ok: true, json: async () => url.includes('/results/config') ? config : lists[contest] };
  };
  return { urls, fetchImpl };
}

describe('RaceResult CX', () => {
  it('normaliza el evento, las claves, los nombres, los tiempos y la categoría de cada concurso', () => {
    expect(raceresultEventUrl('https://my.raceresult.com/370461/results#24_9A1B2C')).toBe(EVENT_2025);
    expect(raceresultEventUrl('370461')).toBe(EVENT_2025);
    expect(() => raceresultEventUrl('http://my.raceresult.com/370461/')).toThrow('no reconocida');
    expect(() => raceresultEventUrl('https://example.com/370461/')).toThrow('no reconocida');
    expect(raceresultKey('26/2')).toEqual({ key: '26/2', contest: '26', selector: '2' });
    expect(() => raceresultKey('ME')).toThrow('inválida');
    expect(raceresultName('VAN KEMPEN, Jules')).toEqual({ firstName: 'Jules', lastName: 'Van Kempen' });
    expect(raceresultName('BELZILE, Émilien')).toEqual({ firstName: 'Émilien', lastName: 'Belzile' });
    expect(['1:01:20', '43:21', '43:21.9', '+03', '+1:02', "''", '-4 LAPS'].map(raceresultSeconds)).toEqual([3680, 2601, 2601, 3, 62, null, null]);
    expect(['Elite Men', 'U23 Women', 'Junior Men', 'UCI Jr Women 17-18', 'JR Men 13-14', 'Master Men 40+', 'Men Cat 2/3/4', 'Singlespeed Women']
      .map(raceresultContestCategory)).toEqual(['ME', 'WU', 'MJ', 'WJ', null, null, null, null]);
  });

  it('elige la lista de clasificación visible del concurso, nunca la de vueltas', () => {
    expect(raceresultResultsList(fixture('2025-config'), '24')).toBe('03: Online Results|Overall Results');
    expect(raceresultResultsList(fixture('2026-config'), '26')).toBe('03: Stage Result Lists|Overall Results {no points}');
  });

  it('localiza las columnas por rótulo en los dos formatos de lista', () => {
    const final = parseRaceresultList(fixture('2025-mj'));
    expect(final.rows).toHaveLength(51);
    expect(final.rows[3]).toEqual({ id: '150', place: '4', bib: '118', name: 'REID, Kian', team: 'Bear National CX', time: "''", gap: '' });
    const start = parseRaceresultList(fixture('2026-mj-salida'));
    expect(start.headline).toBe('Results Day 1 Junior Men');
    expect(start.selectors).toEqual([{ id: '1', label: 'Day 1' }, { id: '2', label: 'Day 2' }]);
    expect(start.rows[0]).toMatchObject({ place: '', bib: '101', name: 'SCHOLNICK, Noah', time: '', gap: '--' });
  });

  it('clasifica: diferencias sobre el ganador, mismo tiempo, doblados sin tiempo y estados sin puesto', () => {
    const mj = parseRaceresultRows(parseRaceresultList(fixture('2025-mj')).rows);
    expect(mj.unfinished).toBe(0);
    expect(mj.rows.slice(0, 5).map(row => [row.bib, row.rank, row.timeText, row.timeSeconds, row.gapText])).toEqual([
      ['102', 1, '43:21', '2601', null], ['101', 2, '43:24', '2604', '+0:03'], ['104', 3, '43:25', '2605', '+0:04'],
      ['118', 4, '43:25', '2605', '+0:04'], ['106', 5, '43:57', '2637', '+0:36']]);
    expect(mj.rows.filter(row => row.irm).map(row => [row.bib, row.irm, row.rank])).toEqual([
      ['105', 'DNF', null], ['120', 'DNF', null], ['132', 'DNF', null], ['134', 'DNS', null], ['135', 'DNS', null], ['138', 'DNS', null]]);
    const me = parseRaceresultRows(parseRaceresultList(fixture('2025-me')).rows);
    expect(me.rows[0]).toMatchObject({ bib: '1', rank: 1, firstName: 'Andrew', lastName: 'Strohmeyer', teamName: 'CXD TREK BIKES', timeText: '1:01:20', isoCode2: null });
    expect(me.rows.find(row => row.bib === '22')).toMatchObject({ rank: 25, irm: 'LAP', gapText: '-6 LAP', timeSeconds: null });
    const start = parseRaceresultRows(parseRaceresultList(fixture('2026-mj-salida')).rows);
    expect(start).toMatchObject({ rows: [], unfinished: 36 });
    const rows = parseRaceresultList(fixture('2025-mj')).rows;
    expect(() => parseRaceresultRows([rows[0], rows[2], rows[1]])).toThrow('no posterior');
    expect(() => parseRaceresultRows([rows[1]])).toThrow('no reconocido');
    expect(() => parseRaceresultRows([rows[0], { ...rows[1], time: 'abc' }])).toThrow('no reconocido');
  });

  it('documenta los concursos de categoryKeys, acredita el enlace y rechaza un concurso de otra categoría', async () => {
    const { urls, fetchImpl } = fakeFetch(fixture('2025-config'), { 24: fixture('2025-me'), 19: fixture('2025-mj') });
    const fetched = await fetchRaceresultContests('https://my.raceresult.com/370461/results', ['24', '19'], { fetchImpl });
    expect(urls[0]).toBe('https://my.raceresult.com/370461/results/config?lang=en');
    expect(urls[1]).toMatch(/^https:\/\/my1\.raceresult\.com\/370461\/results\/list\?key=[0-9a-f]+&listname=03%3A%20Online%20Results%7COverall%20Results&page=results&contest=24&r=all&l=0$/);
    const doc = buildRaceresultCxDocument({ ...fetched, map: { 24: 'ME', 19: 'WJ' }, raceId: 'r', seasonKey: '2025-26', dateKey: '2025-11-08', source: 'raceresult' });
    expect(doc.categories.map(c => [c.category, c.sourceContestName, c.rows.length, c.unfinished, c.evidence])).toEqual([
      ['ME', 'Elite Men', 27, 0, { sourceUrl: `${EVENT_2025}#24`, raceresult: { sourceUrl: EVENT_2025, contest: '24' } }]]);
    expect(doc.categories[0].sourceDigest).toMatch(/^[0-9a-f]{40}$/);
    expect(doc.invalid).toEqual([{ category: 'WJ', reason: 'Concurso 19 «Junior Men» no corresponde a WJ' }]);
  });

  it('una lista de salida sin clasificados queda pendiente', async () => {
    const { fetchImpl } = fakeFetch(fixture('2026-config'), { 21: fixture('2026-mj-salida') });
    const fetched = await fetchRaceresultContests('https://my.raceresult.com/434035/', ['21'], { fetchImpl });
    const doc = buildRaceresultCxDocument({ ...fetched, map: { 21: 'MJ' }, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-07', source: 'raceresult' });
    expect(fetched.eventOver).toBe(false);
    expect(doc.categories).toEqual([]);
    expect(doc.skipped).toEqual([{ category: 'MJ', reason: 'Concurso «Junior Men» aún sin clasificados en RaceResult' }]);
  });
});
