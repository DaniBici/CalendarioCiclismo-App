import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chronoraceBonusMap, chronoraceContext, chronoraceReportKeys, chronoraceTableUrl, parseChronoraceBonuses } from '../results-fetchers/chronorace-cx-bonuses.mjs';

// Informe real de la élite masculina del Koppenbergcross 01-11-2026 (20261101_x2o, RES31 y BEST31).
const read = name => JSON.parse(readFileSync(new URL(`./fixtures/chronorace-koppenbergcross-2026-me-${name}.json`, import.meta.url), 'utf8'));
const report = () => ({ results: read('res'), bestLap: read('best') });
const bonusField = table => table.TableDefinition.Columns.find(column => column.Name === 'sR_Bonif').FieldIdx;
const rowOf = (table, name) => table.Groups[0].SlaveRows.find(row => String(row[2]).includes(name));

describe('informe de bonos de Chronorace', () => {
  it('reconstruye los seis premios, también el de quien abandona después', () => {
    const parsed = parseChronoraceBonuses(report());
    expect(parsed).toMatchObject({ complete: true, total: 60, winner: { bib: '1', name: 'NYS Thibau', license: '10065004835' } });
    expect(parsed.awards.map(({ name, seconds, sprint, lap }) => [name, seconds, sprint ?? null, lap ?? null])).toEqual([
      ['VAN DE PUTTE Victor', 15, 1, null],
      ['NYS Thibau', 15, 2, 3],
      ['VANTHOURENHOUT Michael', 20, 3, 1],
      ['KUYPERS Gerben', 10, null, 2],
    ]);
  });
  it('espera mientras Bonif no reparte los 60 segundos de la ronda', () => {
    const { results, bestLap } = report();
    rowOf(results, 'KUYPERS')[bonusField(results)] = null;
    expect(parseChronoraceBonuses({ results, bestLap })).toMatchObject({ complete: false, total: 50, awards: [] });
  });
  it('rechaza un Bonif que no coincide con los premios', () => {
    const swapped = report();
    rowOf(swapped.results, 'KUYPERS')[bonusField(swapped.results)] = '0:05';
    rowOf(swapped.results, 'RONHAAR')[bonusField(swapped.results)] = '0:05';
    expect(() => parseChronoraceBonuses(swapped)).toThrow(/no coincide con los premios: KUYPERS Gerben 5, RONHAAR Pim 5/);
    const excess = report();
    rowOf(excess.results, 'RONHAAR')[bonusField(excess.results)] = '0:05';
    expect(() => parseChronoraceBonuses(excess)).toThrow(/suma 65 segundos/);
  });
  it('asigna el bono a la fila vigente por licencia, perfil o nombre y deja 0 en las demás', () => {
    const parsed = parseChronoraceBonuses(report());
    const rows = [
      { id: '10', rank: 1, riderDisplay: 'Thibau Nys', uciLicenseId: '10065004835' },
      { id: '11', rank: 2, riderDisplay: 'Michael Vanthourenhout', uciProfileId: Number('10007155651'.slice(2, 9)) },
      { id: '12', rank: 3, riderDisplay: 'Gerben Kuypers' },
      { id: '13', rank: null, irm: 'DNF', riderDisplay: 'Victor Van de Putte', uciLicenseId: '10064985940' },
      { id: '14', rank: 4, riderDisplay: 'Pim Ronhaar' },
    ];
    expect(chronoraceBonusMap(parsed, rows)).toEqual({ 10: 15, 11: 20, 12: 10, 13: 15, 14: 0 });
    expect(() => chronoraceBonusMap(parsed, rows.filter(row => row.id !== '12'))).toThrow(/Premiado sin fila.*KUYPERS/);
    expect(() => chronoraceBonusMap(parsed, rows.map(row => row.id === '10' ? { ...row, rank: 2 } : row))).toThrow(/ganador del informe/);
  });
  it('localiza las tablas de la categoría en el árbol del informe', () => {
    const found = [{ category: 'ME', key: 'RES31' }, { category: 'ME', key: 'RNK31' }, { category: 'ME', key: 'BEST31' }, { category: 'ME', key: 'API31' }, { category: 'MJ', key: 'RES34' }];
    expect(chronoraceReportKeys(found, 'ME')).toEqual({ results: 'RES31', bestLap: 'BEST31' });
    expect(chronoraceReportKeys(found, 'MJ')).toBeNull();
    expect(chronoraceContext('2026-11-15', 'x2o')).toBe('20261115_x2o');
    expect(chronoraceTableUrl('20261101_x2o', 'RES31')).toBe('https://results.chronorace.be/api/results/table/search/20261101_x2o/RES31?srch=&fromRecord=0&pageSize=1000');
  });
});
