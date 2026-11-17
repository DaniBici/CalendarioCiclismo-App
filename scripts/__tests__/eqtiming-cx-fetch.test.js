import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEqtimingCxDocument, eqtimingClassKey, eqtimingEventId, eqtimingEventUrl, eqtimingLicenseId, fetchEqtimingClasses,
  parseEqtimingRows } from '../results-fetchers/eqtiming-cx-fetch.mjs';

// NC 1 Sykkelkross 2026 (evento 84082, Lillehammer, 03-10-2026, terminado) y Campeonato de Noruega (83954, antes de la salida).
const NC1 = JSON.parse(readFileSync(new URL('./fixtures/eqtiming-cx-nc1-lillehammer-2026.json', import.meta.url), 'utf8'));
const NM = JSON.parse(readFileSync(new URL('./fixtures/eqtiming-cx-nm-noruega-2026.json', import.meta.url), 'utf8'));
const EVENT = 'https://live.eqtiming.com/84082';
const MAP = { 'M Elite': 'ME', 'K Elite': 'WE', 'M Junior': 'MJ', 'K Junior': 'WJ' };

function fakeFetch(fixture) {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const path = url.replace('https://live.eqtiming.com/api/', '');
    let body;
    if (path.startsWith('Event/')) body = fixture.event;
    else if (path.startsWith('Result/Class/')) { const [, , , stage, cls] = path.split('?')[0].split('/'); body = fixture.results?.[`${stage}/${cls}`] || { TotalItems: 0, ItemCount: 0, Items: [] }; }
    else { const [, , stage] = path.split('?')[0].split('/'); const cls = /classes=(\d+)/.exec(path)[1]; body = fixture.startlist?.[`${stage}/${cls}`] || { TotalItems: 0, Items: [] }; }
    return { ok: true, status: 200, json: async () => body };
  };
  return { urls, fetchImpl };
}
const read = async (fixture = NC1) => { const fake = fakeFetch(fixture); return { fake, fetched: await fetchEqtimingClasses(EVENT, Object.keys(MAP), { fetchImpl: fake.fetchImpl }) }; };
const document = fetched => buildEqtimingCxDocument({ ...fetched, map: MAP, raceId: 'race-1', seasonKey: '2026-27', dateKey: '2026-10-03', source: 'eqtiming' });

describe('EQ Timing CX', () => {
  it('normaliza el evento, la clase y el UCI ID del bloque Lisens', () => {
    expect(eqtimingEventUrl('https://live.eqtiming.com/83954#dashboard')).toBe('https://live.eqtiming.com/83954');
    expect(eqtimingEventUrl('83954')).toBe('https://live.eqtiming.com/83954');
    expect(eqtimingEventId('https://live.eqtiming.com/83954/')).toBe('83954');
    expect(() => eqtimingEventUrl('http://live.eqtiming.com/83954')).toThrow('no reconocida');
    expect(() => eqtimingEventUrl('https://example.com/83954')).toThrow('no reconocida');
    expect(eqtimingClassKey('  M Senior   Elite ')).toBe('M Senior Elite');
    expect(() => eqtimingClassKey('  ')).toThrow('inválida');
    expect(eqtimingLicenseId({ 1: { Type: 'UCI ID', Kode: '100 195 527 56' }, 11: { Type: 'EMITAGID', Kode: '3649605' } })).toBe('10019552756');
    expect(eqtimingLicenseId({ 2: { Type: 'UCI ID MANUEL', Kode: '10061437760' } })).toBe('10061437760');
    expect(eqtimingLicenseId({ 1: { Type: 'UCI ID', Kode: '100 195 527' } })).toBeNull();
    expect(eqtimingLicenseId(null)).toBeNull();
  });

  it('pide la clasificación final (round=0) de cada clase en cada manga que la contiene', async () => {
    const { fake, fetched } = await read();
    const results = fake.urls.filter(url => url.includes('/Result/Class/'));
    expect(results.every(url => url.endsWith('?count=999&station=0&round=0'))).toBe(true);
    // K Junior figura en dos mangas del evento: solo la primera lleva resultados.
    expect(results.filter(url => url.includes('/1310293?'))).toHaveLength(2);
    expect(fetched).toMatchObject({ eventUrl: EVENT, eventName: 'NC 1 Sykkelkross 2026', eventDate: '2026-10-03', timezone: 'Europe/Oslo' });
  });

  it('separa por clase una manga conjunta y calcula vueltas perdidas y estados', async () => {
    const { fetched } = await read();
    const doc = document(fetched);
    expect(doc).toMatchObject({ source: 'eqtiming', disciplineId: 3, skipped: [], invalid: [], warnings: [] });
    const by = Object.fromEntries(doc.categories.map(item => [item.category, item]));
    expect(Object.keys(by)).toEqual(['ME', 'WE', 'MJ', 'WJ']);
    expect(by.ME.rows.map(row => [row.rank, row.irm, row.timeText, row.gapText])).toEqual([
      [1, null, '1:00:43', null], [2, null, '1:01:23', '+0:40'], [3, null, '1:03:23', '+2:40'], [4, null, '1:03:30', '+2:47'], [5, null, '1:15:10', '+14:27'],
      [6, 'LAP', null, '-1 LAP'], [7, 'LAP', null, '-1 LAP'], [null, 'DNF', null, null]]);
    expect(by.ME).toMatchObject({ leaderLaps: 11, plannedLaps: 11, finished: true, unfinished: 0, sourceStage: '340872', evidence: { eqtiming: { sourceUrl: EVENT, class: 'M Elite' } } });
    // WE y WJ comparten manga (Heat 3, 7 vueltas): cada clase se ordena por separado.
    expect(by.WE.rows.map(row => [row.rank, row.irm, row.bib])).toEqual([[1, null, '53'], [2, null, '50'], [3, 'LAP', '52'], [null, 'DNS', '48']]);
    expect(by.WJ.rows.map(row => [row.rank, row.timeText, row.gapText])).toEqual([[1, '48:54', null], [2, '50:47', '+1:53']]);
    expect(by.WE.sourceHeat).toBe(by.WJ.sourceHeat);
    expect(by.MJ.rows.filter(row => row.irm === 'LAP')).toHaveLength(2);
    expect(by.ME.sourceDigest).toMatch(/^[0-9a-f]{40}$/);
    expect(new Set(doc.categories.map(item => item.sourceDigest)).size).toBe(4);
  });

  it('lleva en cada fila los datos del corredor: nombre, país, año de nacimiento y UCI ID', async () => {
    const { fetched } = await read();
    const [laforce, , , molund] = document(fetched).categories[0].rows;
    expect(laforce).toMatchObject({ bib: '69', firstName: 'Aksel', lastName: 'Laforce', riderDisplay: 'Aksel Laforce', isoCode2: 'NO', birthYear: 2006,
      uciLicenseId: '10061437760', bonusSeconds: null });
    expect(molund).toMatchObject({ firstName: 'Sebastian', lastName: 'Molund', uciLicenseId: '10170792833', teamName: 'Lillehammer CK' });
    const all = document(fetched).categories.flatMap(item => item.rows);
    expect(all.every(row => /^\d{11}$/.test(row.uciLicenseId) && row.birthYear > 1900 && row.isoCode2 === 'NO')).toBe(true);
  });

  it('cuenta los inscritos sin fila de resultado y cambia la huella con cada corrección', async () => {
    const withMissing = structuredClone(NC1);
    withMissing.startlist['340872/1310298'].Items.push({ Startnummer: 99, Klasse: { UID: 1310298, Navn: 'M Elite' }, Status: { Navn: 'Registrert' } });
    const base = document((await read()).fetched).categories[0];
    const extra = document((await read(withMissing)).fetched).categories[0];
    expect(base.unfinished).toBe(0);
    expect(extra.unfinished).toBe(1);
    expect(extra.sourceDigest).not.toBe(base.sourceDigest);
    const edited = structuredClone(NC1);
    edited.results['340872/1310298'].Items[1].AkkumulertTid += 1000;
    expect(document((await read(edited)).fetched).categories[0].sourceDigest).not.toBe(base.sourceDigest);
  });

  it('antes de la salida las clases quedan sin resultados y no generan categoría', async () => {
    const fake = fakeFetch(NM);
    const fetched = await fetchEqtimingClasses('https://live.eqtiming.com/83954', ['M Senior Elite', 'K Senior Elite', 'M Junior Elite', 'K Junior Elite', 'M Veterano'],
      { fetchImpl: fake.fetchImpl });
    const doc = buildEqtimingCxDocument({ ...fetched, map: { 'M Senior Elite': 'ME', 'K Senior Elite': 'WE', 'M Junior Elite': 'MJ', 'K Junior Elite': 'WJ', 'M Veterano': 'MU' },
      raceId: 'race-1', seasonKey: '2026-27', dateKey: '2026-11-14', source: 'eqtiming' });
    expect(doc.categories).toEqual([]);
    expect(doc.skipped.map(item => item.category)).toEqual(['ME', 'WE', 'MJ', 'WJ']);
    expect(doc.invalid).toEqual([{ category: 'MU', reason: 'Clase «M Veterano»: no existe en el evento' }]);
    // Las cuatro clases del Campeonato de Noruega comparten manga y no se piden inscritos sin resultados.
    expect(fake.urls.filter(url => url.includes('/Startlist/'))).toEqual([]);
    expect(fetched.eventDate).toBe('2026-11-14');
  });

  it('rechaza una clasificación incoherente sin afectar a las demás clases', async () => {
    const { fetched } = await read();
    const ranked = structuredClone(fetched);
    const me = ranked.classes.find(item => item.key === 'M Elite').stages[0].items;
    me[3].Rundenummer = 12; // más vueltas que el ganador
    const doc = document(ranked);
    expect(doc.invalid).toEqual([{ category: 'ME', reason: 'Clase «M Elite»: Fila 4: 12 vueltas, más que el ganador (11)' }]);
    expect(doc.categories.map(item => item.category)).toEqual(['WE', 'MJ', 'WJ']);
    expect(() => parseEqtimingRows([...me.slice(7), me[0]], 'ME')).toThrow('clasificado tras un DNF');
    const unknown = structuredClone(me); unknown[2].StatusTekst = 'RARE';
    expect(() => parseEqtimingRows(unknown, 'ME')).toThrow('estado «RARE» no reconocido');
    expect(() => parseEqtimingRows(me, 'WE')).toThrow('no corresponde al sexo');
    const wrongDay = buildEqtimingCxDocument({ ...fetched, map: MAP, raceId: 'race-1', seasonKey: '2026-27', dateKey: '2026-10-04' });
    expect(wrongDay.categories).toEqual([]);
    expect(wrongDay.invalid).toHaveLength(4);
  });

  it('descarta una clase con resultados en dos mangas', async () => {
    const split = structuredClone(NC1);
    split.results['342108/1310293'] = split.results['340869/1310293'];
    const doc = document((await read(split)).fetched);
    expect(doc.invalid).toEqual([{ category: 'WJ', reason: 'Clase «K Junior» con resultados en varias mangas (340869, 342108)' }]);
  });
});
