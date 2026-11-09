import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFotofinissCxDocument, fetchFotofinissGroups, fotofinissName, fotofinissResultsUrl, fotofinissSeconds, parseFotofinissGroups,
  parseFotofinissRows } from '../results-fetchers/fotofiniss-cx-fetch.mjs';

const html = readFileSync(new URL('./fixtures/fotofiniss-lc-cx-2026-grupas.html', import.meta.url), 'utf8');
const RESULTS = 'https://fotofiniss.lv/sacensibas/latvijas-cempionats-velokrosa-cx-2026/rezultati';

describe('fotofiniss CX', () => {
  it('normaliza la URL del evento, los nombres y los tiempos', () => {
    expect(fotofinissResultsUrl(`${RESULTS}/pa-grupam-det`)).toBe(RESULTS);
    expect(fotofinissResultsUrl('https://www.fotofiniss.lv/sacensibas/latvijas-cempionats-velokrosa-cx-2026')).toBe(RESULTS);
    expect(() => fotofinissResultsUrl('http://fotofiniss.lv/sacensibas/x/rezultati')).toThrow('no reconocida');
    expect(() => fotofinissResultsUrl('https://example.com/sacensibas/x/rezultati')).toThrow('no reconocida');
    expect(fotofinissName('Evelīna ERMANE-MARČENKO')).toEqual({ firstName: 'Evelīna', lastName: 'Ermane-Marčenko' });
    expect(fotofinissName('Oskars Pauls ŠTRAUHMANIS')).toEqual({ firstName: 'Oskars Pauls', lastName: 'Štrauhmanis' });
    expect(['0:45:24.1', '45:24.9', '1:02:03', 'DNF'].map(fotofinissSeconds)).toEqual([2724, 2724, 3723, null]);
  });

  it('lee cada grupo de edad con dorsal, club, vueltas y pasos', () => {
    const groups = parseFotofinissGroups(html);
    expect(groups.map(group => [group.label, group.distance, group.rows.length])).toEqual([
      ['W16', '11 km', 3], ['M16', '11 km', 11], ['W18', '11 km', 4], ['WE/U23/W19-39', '11 km', 2]]);
    expect(groups[3].rows[0]).toMatchObject({ bib: '17', groupPos: '1', name: 'Evelīna ERMANE-MARČENKO', team: 'Orbea NextGen Racing Team',
      laps: '5', time: '0:45:24.1' });
    expect(groups[3].rows[0].splits.at(-1)).toEqual({ elapsed: '0:45:24', lap: '0:10:05' });
  });

  it('clasifica por vueltas: menos vueltas que el ganador del grupo es LAP sin tiempo, y el DNF sin puesto', () => {
    const groups = parseFotofinissGroups(html);
    const wj = parseFotofinissRows(groups[2].rows, { defaultCountry: 'LV' });
    expect(wj.rows.map(row => [row.bib, row.rank, row.irm, row.timeText, row.timeSeconds, row.gapText])).toEqual([
      ['19', 1, null, '48:33', '2913', null],
      ['20', 2, 'LAP', null, null, '-1 LAP'],
      ['22', 3, 'LAP', null, null, '-1 LAP'],
      ['21', 4, 'LAP', null, null, '-1 LAP'],
    ]);
    expect(wj.rows[3]).toMatchObject({ firstName: 'Samanta', lastName: 'Roziņa', teamName: 'ĶEKAVAS NSS', isoCode2: 'LV', isoCode2Inferred: true });
    expect(wj).toMatchObject({ leaderLaps: 5, maxLapSeconds: 708 });
    const m16 = parseFotofinissRows(groups[1].rows);
    expect(m16.rows.at(-1)).toMatchObject({ bib: '25', rank: null, irm: 'DNF', rankText: 'DNF', timeSeconds: null, isoCode2: null });
    expect(m16.rows[1]).toMatchObject({ rank: 2, timeText: '40:10', gapText: '+1:46' });
    expect(() => parseFotofinissRows([groups[1].rows[1], groups[1].rows[0]])).toThrow('no posterior');
  });

  it('documenta solo los grupos de categoryKeys y acredita el enlace', () => {
    const groups = parseFotofinissGroups(html);
    const doc = buildFotofinissCxDocument({ resultsUrl: RESULTS, groups, map: { 'we/u23/w19-39': 'WE', W18: 'WJ', 'ME/U23/M19-39': 'ME' },
      raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-07', source: 'fotofiniss' });
    expect(doc.categories.map(c => [c.category, c.sourceGroup, c.rows.length, c.evidence.fotofiniss])).toEqual([
      ['WE', 'WE/U23/W19-39', 2, { sourceUrl: RESULTS, group: 'WE/U23/W19-39' }],
      ['WJ', 'W18', 4, { sourceUrl: RESULTS, group: 'W18' }],
    ]);
    expect(doc.categories[0].evidence.sourceUrl).toBe(`${RESULTS}/pa-grupam-det`);
    expect(doc.categories[0].sourceDigest).toMatch(/^[0-9a-f]{40}$/);
    expect(doc.skipped).toEqual([{ category: 'ME', reason: 'Grupo «ME/U23/M19-39» aún sin publicar en fotofiniss' }]);
    expect(() => buildFotofinissCxDocument({ resultsUrl: RESULTS, groups, map: { W18: 'WJ', W16: 'WJ' } })).toThrow('varios grupos');
  });

  it('descarga la lista por grupos del evento', async () => {
    const urls = [];
    const fetched = await fetchFotofinissGroups(`${RESULTS}/pa-distancem`, { fetchImpl: async url => { urls.push(url); return { ok: true, text: async () => html }; } });
    expect(urls).toEqual([`${RESULTS}/pa-grupam-det`]);
    expect(fetched.resultsUrl).toBe(RESULTS);
    expect(fetched.groups).toHaveLength(4);
  });
});
