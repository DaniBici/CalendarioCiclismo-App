import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWebscorerCxDocument, fetchWebscorerPages, parseWebscorerAccount, parseWebscorerPage, parseWebscorerRows, webscorerAffiliation, webscorerGroups,
  webscorerName, webscorerRaceId, webscorerResultsUrl, webscorerTenths } from '../results-fetchers/webscorer-cx-fetch.mjs';

const html = readFileSync(new URL('./fixtures/webscorer-nccx-2026-race9-wave-340.html', import.meta.url), 'utf8');
const URL_ = 'https://www.webscorer.com/racedetails?raceid=455420';
const page = () => ({ ...parseWebscorerPage(html), raceId: '455420', url: URL_ });
const ELITE = 'Elite Men Pro/CX1/CX2/CX3';

describe('Webscorer CX', () => {
  it('normaliza ID, URL, nombres, afiliación y tiempos', () => {
    expect(webscorerRaceId('https://www.webscorer.com/race?raceid=455420')).toBe('455420');
    expect(webscorerRaceId('455420')).toBe('455420');
    expect(webscorerResultsUrl('455420')).toBe(URL_);
    expect(() => webscorerRaceId('https://example.com/race?raceid=455420')).toThrow('no reconocida');
    expect(() => webscorerRaceId('http://www.webscorer.com/race?raceid=455420')).toThrow('no reconocida');
    expect(webscorerName('Nate Morse')).toEqual({ firstName: 'Nate', lastName: 'Morse' });
    expect(webscorerName('John Paul Amalong')).toEqual({ firstName: 'John Paul', lastName: 'Amalong' });
    expect(webscorerName('Tim van der Berg')).toEqual({ firstName: 'Tim', lastName: 'van der Berg' });
    expect(() => webscorerName('Madonna')).toThrow('sin apellido');
    expect(webscorerAffiliation('NC - Foothills Cycling')).toEqual({ region: 'NC', teamName: 'Foothills Cycling', country: 'US' });
    expect(webscorerAffiliation('ON - Toronto Hustle')).toEqual({ region: 'ON', teamName: 'Toronto Hustle', country: 'CA' });
    expect(webscorerAffiliation('NC')).toEqual({ region: 'NC', teamName: null, country: 'US' });
    expect(webscorerAffiliation('Team Belgium')).toEqual({ region: null, teamName: 'Team Belgium', country: null });
    expect(['1:01:26.9', '48:24.5', '0:48.2', '-1 lap', 'DNF'].map(webscorerTenths)).toEqual([36869, 29045, 482, null, null]);
  });

  it('lee la oleada con fecha, estado definitivo y una fila por corredor', () => {
    const parsed = page();
    expect(parsed).toMatchObject({ name: 'NCCX 2026 Race 9 3:40 Wave', date: { dateKey: '2026-11-15', gmt: '-5' }, state: 'Final results', waveLeaderLaps: 7 });
    expect(parsed.rows).toHaveLength(16);
    expect(parsed.rows[1]).toMatchObject({ place: '2', bib: '17', name: 'Nate Morse', affiliation: 'SC - Lima One Capital', category: ELITE,
      gender: 'M', time: '1:01:30.1', laps: '7', gap: '+0:03.2' });
    expect(parsed.rows[0].lapRaceTimes.slice(0, 7)).toEqual(['8:42.7', '17:32.0', '26:26.7', '35:24.9', '44:02.0', '52:47.7', '1:01:26.9']);
    expect(webscorerGroups([parsed]).map(group => [group.category, group.gender, group.rows])).toEqual([[ELITE, 'M', 8], ['Men CX3/CX4', 'M', 7], [ELITE, 'F', 1]]);
  });

  it('clasifica por vueltas del líder de la categoría y separa el sexo dentro de una misma categoría', () => {
    const doc = buildWebscorerCxDocument({ pages: [page()], raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-15',
      map: { [`${ELITE}|M`]: 'ME', [`${ELITE}|F`]: 'WE', 'men cx3/cx4': 'MU' } });
    const [me, we, mu] = doc.categories;
    expect(me.rows.map(row => [row.bib, row.rank, row.irm, row.timeText, row.timeSeconds, row.gapText])).toEqual([
      ['33', 1, null, '1:01:26', '3686', null], ['17', 2, null, '1:01:30', '3690', '+0:03'], ['34', 3, null, '1:03:11', '3791', '+1:44'],
      ['2', 4, null, '1:04:51', '3891', '+3:24'], ['32', 5, null, '1:05:06', '3906', '+3:39'],
      ['19', 6, 'LAP', null, null, '-1 LAP'], ['13', 7, 'LAP', null, null, '-1 LAP'], ['23', 8, 'LAP', null, null, '-1 LAP']]);
    expect(me.rows[1]).toMatchObject({ firstName: 'Nate', lastName: 'Morse', teamName: 'Lima One Capital', isoCode2: 'US', isoCode2Inferred: true, sourceRegion: 'SC' });
    expect(me.rows[5].teamName).toBeNull();
    expect(we.rows).toMatchObject([{ bib: '16', rank: null, rankText: 'DNF', irm: 'DNF', timeSeconds: null }]);
    // El ganador de la categoría corta figura como «-2 laps» frente al líder de la oleada: su tiempo es el acumulado de su última vuelta.
    expect(mu.rows.map(row => [row.bib, row.rank, row.irm, row.timeText, row.gapText])).toEqual([
      ['171', 1, null, '48:24', null], ['164', 2, null, '50:19', '+1:55'], ['154', 3, null, '50:24', '+1:59'], ['153', 4, null, '51:34', '+3:09'],
      ['156', 5, 'LAP', null, '-1 LAP'], ['165', 6, 'LAP', null, '-3 LAP'], ['163', null, 'DNF', null, null]]);
    expect(me).toMatchObject({ resultsState: 'Final results', leaderLaps: 7, evidence: { sourceUrl: URL_, webscorer: { raceId: '455420', group: `${ELITE}|M` } } });
    expect(me.sourceDigest).toMatch(/^[0-9a-f]{40}$/);
  });

  it('descarta lo que no es definitivo, de otra fecha o incoherente sin afectar al resto', () => {
    const live = { ...page(), state: 'Live results' };
    const base = { raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-15', map: { [`${ELITE}|M`]: 'ME' } };
    expect(buildWebscorerCxDocument({ ...base, pages: [live] }).skipped[0].reason).toContain('sin «Final results»');
    expect(buildWebscorerCxDocument({ ...base, pages: [live], allowLive: true }).categories).toHaveLength(1);
    expect(buildWebscorerCxDocument({ ...base, pages: [page()], dateKey: '2026-11-22' }).invalid[0].reason).toContain('2026-11-15');
    expect(buildWebscorerCxDocument({ ...base, pages: [page()], map: { 'Elite Women': 'WE' } }).skipped).toEqual([{ category: 'WE', reason: '«Elite Women» aún sin filas en Webscorer' }]);
    const rows = page().rows.filter(row => row.category === ELITE && row.gender === 'M');
    expect(() => parseWebscorerRows([rows[1], rows[0]], { waveLeaderLaps: 7 })).toThrow('no posterior');
    expect(() => parseWebscorerRows([rows[0], { ...rows[1], gap: '+0:09.9' }], { waveLeaderLaps: 7 })).toThrow('no corresponde');
    expect(() => parseWebscorerRows([rows[0], { ...rows[5], time: '-2 laps' }], { waveLeaderLaps: 7 })).toThrow('no cuadran');
    expect(() => buildWebscorerCxDocument({ ...base, pages: [page()], map: { [`${ELITE}|M`]: 'ME', [`${ELITE}`]: 'ME' } })).toThrow('varias claves');
  });

  it('descarga las oleadas y lista las carreras de una cuenta', async () => {
    const seen = [];
    const pages = await fetchWebscorerPages(['https://www.webscorer.com/race?raceid=455420'], { fetchImpl: async (url, init) => { seen.push([url, init.headers['User-Agent']]); return { ok: true, text: async () => html }; } });
    expect(seen).toEqual([[URL_, expect.stringContaining('calendariociclismo-bot')]]);
    expect(pages[0]).toMatchObject({ raceId: '455420', url: URL_, state: 'Final results' });
    await expect(fetchWebscorerPages(['455420'], { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('HTTP 503');
    expect(parseWebscorerAccount(`<a href="/race?raceid=455420"></a><a href="/race?raceid=455420">NCCX 2026 Race 9 3:40 Wave</a><a href="/race?raceid=455413">NCCX 2026 Race 9 2:40 Wave</a>`))
      .toEqual([{ raceId: '455420', name: 'NCCX 2026 Race 9 3:40 Wave' }, { raceId: '455413', name: 'NCCX 2026 Race 9 2:40 Wave' }]);
  });
});
