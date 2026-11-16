import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWiclaxCx, wiclaxCountry, wiclaxFileUrl, wiclaxSeconds } from '../results-fetchers/wiclax-cx-fetch.mjs';

// Lunca Timisului CX (Timișoara, 14-11-2026), cronometraje de Linia de Sosire: solo los recorridos UCI.
const timisoara = readFileSync(new URL('./fixtures/wiclax-cx-lunca-timisului-2026.clax', import.meta.url), 'utf8');
const timisoaraMap = { 'CX MEN ELITE': 'ME', 'CX MEN U23': 'ME', 'CX WOMEN ELITE': 'WE', 'CX WOMEN U23': 'WE', 'CX MEN JUNIOR': 'MJ', 'CX WOMEN JUNIOR': 'WJ' };

const xml = `<?xml version="1.0"?><Epreuve nom="CX" dt1="2026-10-04">
<Etapes><Etape finito="1," /></Etapes>
<Engages>
<E d="1" n="PEREZ LOPEZ Ana" c="CLUB A" a="2000" na="ESP" x="F" p="FEM ELITE" />
<E d="2" n="MARTIN Lea" c="INDEPENDIENTE" a="2001" na="FRA" x="F" p="FEM ELITE" />
<E d="3" n="GARCIA RUIZ Eva" c="CLUB B" a="2002" na="ESP" x="F" p="FEM ELITE" />
<E d="4" n="SMITH Jane" c="CLUB C" a="1999" na="USA" x="F" p="FEM ELITE" />
<E d="5" n="ROSSI Bea" c="CLUB D" a="1998" na="ITA" x="F" p="FEM ELITE" />
<E d="9" n="DIAZ Pedro" c="CLUB E" a="1990" na="ESP" x="M" p="ELITE" />
</Engages>
<Resultats>
<R d="2" t="00h40'25" b="11h40'25,900" to="5" />
<R d="1" t="00h40'00" b="11h40'00,100" to="5" />
<R d="3" t="00h40'25" b="11h40'25,200" to="5" />
<R d="4" t="00h35'00" b="11h35'00,000" to="4" />
<R d="5" t="Abandono" to="2" />
</Resultats>
<Parcours><Pcs nom="FEM ELITE" /><Pcs nom="ELITE" /></Parcours></Epreuve>`;

describe('Wiclax CX', () => {
  it('convierte la URL del visor G-Live en la del archivo', () => {
    expect(wiclaxFileUrl('https://becrono.es/G-Live/g-live.html?f=/resultados26/CX/a.clax'))
      .toBe('https://becrono.es/resultados26/CX/a.clax');
    expect(wiclaxSeconds("00h45'44,082")).toBeCloseTo(2744.082);
    expect(wiclaxSeconds('Abandono')).toBeNull();
  });

  it('convierte nacionalidades IOC, gentilicios y países en castellano a ISO-2', () => {
    expect(['ESP', 'Española', 'Alemania', 'Estados Unidos', 'Honduras', 'ES', '', 'Marte'].map(wiclaxCountry))
      .toEqual(['ES', 'ES', 'DE', 'US', 'HN', 'ES', null, null]);
  });

  it('ordena por vueltas y paso por meta, con vueltas perdidas y abandonos', () => {
    const doc = parseWiclaxCx(xml, { map: { 'FEM ELITE': 'WE', ELITE: 'ME' }, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-10-04' });
    const [we] = doc.categories;
    expect(we.rows.map(row => [row.bib, row.rankText, row.timeSeconds, row.gapText, row.irm])).toEqual([
      ['1', '1', '2400', null, null],
      ['3', '2', '2425', '+0:25', null],
      ['2', '3', '2425', '+0:25', null],
      ['4', '4', null, '-1 LAP', 'LAP'],
      ['5', 'DNF', null, null, 'DNF'],
    ]);
    expect(we.rows[0]).toMatchObject({ firstName: 'Ana', lastName: 'Perez Lopez', isoCode2: 'ES', teamName: 'CLUB A' });
    expect(doc.skipped).toEqual([{ course: 'ELITE', category: 'ME', reason: 'Recorrido sin terminar en el cronometraje' }]);
  });

  it('convierte países en inglés a ISO-2', () => {
    expect(['Slovakia', 'Czech Republic', 'Macedonia', 'United States of America', 'France', 'Hungary', 'Romania']
      .map(wiclaxCountry)).toEqual(['SK', 'CZ', 'MK', 'US', 'FR', 'HU', 'RO']);
  });

  it('une Elite y U23 con la misma salida en una clasificación y lee el dialecto de Linia de Sosire', () => {
    const doc = parseWiclaxCx(timisoara, { map: timisoaraMap, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-14' });
    expect(doc.categories.map(c => [c.category, c.sourceCourse, c.rows.length])).toEqual([
      ['ME', 'CX MEN ELITE + CX MEN U23', 16], ['WE', 'CX WOMEN ELITE + CX WOMEN U23', 8], ['MJ', 'CX MEN JUNIOR', 8], ['WJ', 'CX WOMEN JUNIOR', 3]]);
    expect(doc.skipped).toEqual([]);
    const me = doc.categories[0].rows;
    // Takács (U23) gana la manga conjunta; Malnasi (Elite) queda 9.º; dos corredores pierden una vuelta; «Withdrawal» es DNF.
    expect(me.slice(0, 3).map(row => [row.rank, row.bib, row.timeSeconds, row.gapText])).toEqual([[1, '37', '3586', null], [2, '40', '3677', '+1:31'], [3, '36', '3692', '+1:46']]);
    expect(me[8]).toMatchObject({ rank: 9, bib: '27', timeSeconds: '3860', gapText: '+4:34', uciLicenseId: '10056601605', isoCode2: 'RO' });
    expect(me.slice(13).map(row => [row.rank, row.bib, row.irm, row.gapText])).toEqual([[14, '39', 'LAP', '-1 LAP'], [15, '30', 'LAP', '-1 LAP'], [null, '23', 'DNF', null]]);
    expect(me.find(row => row.bib === '36')).toMatchObject({ isoCode2: 'US', birthYear: '2005' });
    expect(doc.categories[3].rows.find(row => row.bib === '21').isoCode2).toBe('MK');
  });

  it('espera a todos los recorridos de una categoría conjunta', () => {
    const partial = timisoara.replace('finito="1,1,1,1,1,1,1,1"', 'finito="1,1,1,1,1,1,0,1"');
    const doc = parseWiclaxCx(partial, { map: timisoaraMap, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-14' });
    expect(doc.categories.map(c => c.category)).toEqual(['WE', 'MJ', 'WJ']);
    expect(doc.skipped).toEqual([{ course: 'CX MEN U23', category: 'ME', reason: 'Recorrido sin terminar en el cronometraje' }]);
  });

  it('rechaza un archivo de otra fecha', () => {
    expect(() => parseWiclaxCx(xml, { map: { 'FEM ELITE': 'WE' }, dateKey: '2026-10-05' })).toThrow('Fecha del archivo');
  });
});
