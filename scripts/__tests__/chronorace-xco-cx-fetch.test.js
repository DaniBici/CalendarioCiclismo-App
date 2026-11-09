import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildChronoraceXcoDocument, chronoraceXcoCategories, chronoraceXcoContext, parseChronoraceXco } from '../results-fetchers/chronorace-xco-cx-fetch.mjs';

// Directo real del Campeonato de Europa UEC 2025 en Middelkerke (20251108_uec), sin las series por vuelta
// que el lector no usa. Puestos, tiempos y estados coinciden con los PDF oficiales de Chronorace.
const read = name => JSON.parse(readFileSync(new URL(`./fixtures/chronorace-xco-uec-2025-${name}.json`, import.meta.url), 'utf8'));
const manga = name => { const { overview, registration } = read(name); return { overview, registration }; };
const copy = value => JSON.parse(JSON.stringify(value));

describe('Chronorace, visor UCI xco', () => {
  it('reconoce el contexto en el visor y suelto', () => {
    expect(chronoraceXcoContext('https://prod.chronorace.be/angular/results.html#/uci/event/20261107_uec')).toBe('20261107_uec');
    expect(chronoraceXcoContext('https://prod.chronorace.be/angular/results.html#/uci/event/20251108_uec/CRO/CG21/xco/ME/ov')).toBe('20251108_uec');
    expect(chronoraceXcoContext('20261107_uec')).toBe('20261107_uec');
    expect(() => chronoraceXcoContext('https://example.com')).toThrow('no reconocido');
  });

  it('localiza las seis mangas con su ruta del visor y el PDF de resultados', () => {
    const found = chronoraceXcoCategories(read('tree'));
    expect(found.map(item => [item.category, item.path.join('/')])).toEqual([
      ['ME', 'CRO/CG21'], ['WE', 'CRO/CG22'], ['MU', 'CRO/CG23'], ['MJ', 'CRO/CG24'], ['WU', 'CRO/CG25'], ['WJ', 'CRO/CG26'],
    ]);
    expect(found[0].resultsPdfUrl).toBe('https://chronorace.blob.core.windows.net/webresources/20251108_uec/midd_cro_crome_results.pdf');
  });

  it('convierte puestos, tiempos truncados, retirados por el 80 % y estados', () => {
    const { rows, renumbered } = parseChronoraceXco(manga('me'));
    expect(renumbered).toEqual([]);
    expect(rows).toHaveLength(27);
    expect(rows.slice(0, 3).map(row => [row.rank, row.bib, row.timeText, row.timeSeconds, row.gapText])).toEqual([
      [1, '2', '0:58:40', '3520', null], [2, '1', '0:58:40', '3520', '+0:00'], [3, '8', '0:58:43', '3523', '+0:03'],
    ]);
    expect(rows[0]).toMatchObject({ firstName: 'Toon', lastName: 'Aerts', riderDisplay: 'Toon Aerts', isoCode2: 'BE', nationalityCode: 'BEL',
      uciLicenseId: '10007586087', teamName: null });
    expect(rows[13]).toMatchObject({ rank: 14, timeText: '1:00:17', gapText: '+1:37' });
    expect(rows[25]).toMatchObject({ rank: 26, bib: '27', irm: 'LAP', gapText: '-5 LAP', timeSeconds: null, isoCode2: 'LT' });
    expect(rows[26]).toMatchObject({ rank: null, rankText: 'DNS', irm: 'DNS', bib: '24' });
  });

  it('cierra el hueco de una descalificada como el PDF oficial', () => {
    const { rows, renumbered } = parseChronoraceXco(manga('wj'));
    expect(rows.slice(2, 5).map(row => [row.rank, row.bib, row.lastName, row.gapText])).toEqual([
      [3, '8', 'Azzetti', '+0:52'], [4, '19', 'Pichon', '+1:12'], [5, '2', 'Huber', '+1:18'],
    ]);
    expect(renumbered).toHaveLength(36);
    expect(renumbered[0]).toEqual({ bib: '19', sourceRank: 5, rank: 4 });
    expect(rows.filter(row => row.irm).map(row => [row.bib, row.irm])).toEqual([['26', 'DNF'], ['10', 'DSQ']]);
  });

  it('rechaza huecos sin descalificación, estados desconocidos y diferencias incoherentes', () => {
    const noDsq = copy(manga('wj'));
    noDsq.overview.OverviewData = noDsq.overview.OverviewData.filter(item => item.Status !== 'DSQ');
    expect(() => parseChronoraceXco(noDsq)).toThrow('no consecutivos');
    const unknown = copy(manga('me'));
    unknown.overview.OverviewData[26].Status = 'XYZ';
    expect(() => parseChronoraceXco(unknown)).toThrow('estado de Chronorace no reconocido');
    const wrongGap = copy(manga('me'));
    wrongGap.overview.OverviewData[2].LapDetails.at(-1).GapWithLeader = 4000;
    expect(() => parseChronoraceXco(wrongGap)).toThrow('no corresponde al tiempo');
  });

  it('emite solo mangas terminadas, con la fecha civil de la zona de la carrera', () => {
    const [me, , , , , wj] = chronoraceXcoCategories(read('tree'));
    const running = copy(manga('wj'));
    running.overview.Status = 'Running';
    const input = { ctx: '20251108_uec', eventName: 'UEC', raceId: 'race', seasonKey: '2025-26', timezone: 'Europe/Brussels',
      sourceUrl: 'https://prod.chronorace.be/angular/results.html#/uci/event/20251108_uec' };
    const document = buildChronoraceXcoDocument({ ...input, mangas: [{ ...me, ...manga('me') }, { ...wj, ...running }] });
    expect(document.categories.map(item => [item.category, item.dateKey, item.rows.length])).toEqual([['ME', '2025-11-09', 27]]);
    expect(document.categories[0].evidence.sourceUrl).toBe('https://prod.chronorace.be/angular/results.html#/uci/event/20251108_uec/CRO/CG21/xco/ME/ov');
    expect(document.skipped).toEqual([{ category: 'WJ', reason: 'Manga sin terminar en Chronorace (Running)' }]);
    const otherDay = buildChronoraceXcoDocument({ ...input, date: '2025-11-08', mangas: [{ ...me, ...manga('me') }] });
    expect(otherDay.categories).toEqual([]);
    expect(otherDay.skipped).toEqual([{ category: 'ME', reason: 'Manga del 2025-11-09' }]);
  });
});
