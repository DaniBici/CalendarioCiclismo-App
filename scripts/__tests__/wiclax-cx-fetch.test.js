import { describe, expect, it } from 'vitest';
import { parseWiclaxCx, wiclaxFileUrl, wiclaxSeconds } from '../results-fetchers/wiclax-cx-fetch.mjs';

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

  it('rechaza un archivo de otra fecha', () => {
    expect(() => parseWiclaxCx(xml, { map: { 'FEM ELITE': 'WE' }, dateKey: '2026-10-05' })).toThrow('Fecha del archivo');
  });
});
