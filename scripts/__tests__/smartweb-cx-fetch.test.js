import { describe, expect, it } from 'vitest';
import { buildSmartwebCxDocument, parseSmartwebIndex, parseSmartwebRows, parseSmartwebTable, resolveSmartwebIdentities, selectSmartwebOptions,
  smartwebCategoryUrl, smartwebIndexUrl } from '../results-fetchers/smartweb-cx-fetch.mjs';

const INDEX_URL = 'https://fccv.es/index.php/smartweb/inscripciones/clasificacion/35300';
const select = (id, fn, options) => `<select name="${id}" id="${id}" class="form-control" onchange="${fn}()">
  <option value="0">Seleccione clasificación</option>${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
const index = (...selects) => `<html><script>var endDate = "October 11, 2026 08:45:00";</script>${selects.join('')}</html>`;
const table = (rows, region = 'C.A Participante') => `<table><thead><tr class="cabecera-tabla"><th>Pos.</th><th>Dorsal</th><th>Nombre</th><th>Apellidos</th><th>Club\\Equipo</th>
  <th>${region}</th><th>Tiempo</th></tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const source = (pos, time, over = {}) => ({ pos: String(pos), bib: String(pos + 10), firstName: 'MARC', lastName: `MONCHO SIGNES ${pos}`,
  team: 'JORGE CANET-EL RALL', region: 'VLC', time, ...over });
const MAP = { 'ELITE-SUB23': 'ME', 'FEM JUNIOR': 'WJ', 'JUNIOR FEM.': 'WJ' };

describe('smartweb CX', () => {
  it('normaliza la URL de la prueba al índice de clasificaciones', () => {
    expect(smartwebIndexUrl('https://fccv.es/index.php/smartweb/inscripciones/prueba/35255-XIII-CICLOCROSS-DE-AIACOR')).toBe('https://fccv.es/index.php/smartweb/inscripciones/clasificacion/35255');
    expect(smartwebIndexUrl('https://ciclismoasturiano.es/index.php/smartweb/inscripciones/mostrar_categorias_cronofec_clasificacion/283632/34889-IV-CICLOCROSS'))
      .toBe('https://ciclismoasturiano.es/index.php/smartweb/inscripciones/clasificacion/34889');
    expect(() => smartwebIndexUrl('http://fccv.es/index.php/smartweb/inscripciones/clasificacion/35255')).toThrow();
    expect(smartwebCategoryUrl(INDEX_URL, 'cronofec', '283930')).toBe('https://fccv.es/index.php/smartweb/inscripciones/mostrar_categorias_cronofec_clasificacion/283930/35300');
  });
  it('lee la fecha y las dos variantes y prefiere el archivo de los árbitros', () => {
    const parsed = parseSmartwebIndex(index(select('categorias_cronofec', 'showCategorias_cronofec', [['283930', 'ELITE-SUB23'], ['283937', 'FEM  JUNIOR']]),
      select('categorias', 'showCategoriasFicheros', [['221914', 'ELITE-SUB23'], ['221916', 'FEM JUNIOR']])));
    expect(parsed.dateKey).toBe('2026-10-11');
    expect(selectSmartwebOptions(parsed, MAP).selected).toEqual([
      { category: 'ME', variant: 'fichero', id: '221914', label: 'ELITE-SUB23' }, { category: 'WJ', variant: 'fichero', id: '221916', label: 'FEM JUNIOR' }]);
    const cronofec = parseSmartwebIndex(index(select('categorias_cronofec', 'showCategorias_cronofec', [['283930', 'ELITE-SUB23']])));
    expect(selectSmartwebOptions(cronofec, MAP)).toMatchObject({ selected: [{ category: 'ME', variant: 'cronofec' }], skipped: [{ category: 'WJ' }] });
    const fccv = parseSmartwebIndex(index(select('categorias_cronofec', 'showCategorias_cronofec', [['285956', 'ELITE - SUB-23']])));
    expect(selectSmartwebOptions(fccv, MAP).selected).toMatchObject([{ category: 'ME', id: '285956', label: 'ELITE-SUB23' }]);
    const ambiguous = parseSmartwebIndex(index(select('categorias', 'showCategoriasFicheros', [['1', 'FEM JUNIOR'], ['2', 'JUNIOR FEM.']])));
    expect(selectSmartwebOptions(ambiguous, MAP).invalid).toMatchObject([{ category: 'WJ' }]);
  });
  it('convierte llegadas, doblados, estados y filas sin puesto', () => {
    const { rows, omitted, warnings } = parseSmartwebRows([source(1, '00:53:21.787', { team: 'INDEPENDIENTE', region: '' }), source(2, '00:53:46.361'),
      source(4, '00:53:46.900'), source(5, 'Vta. perdida'), source(6, '3 vtas. perdidas'), source(0, '-'), source(0, 'Ret.')]);
    expect(rows.map(row => [row.rank, row.irm, row.timeSeconds, row.gapText])).toEqual([
      [1, null, '3201', null], [2, null, '3226', '+0:25'], [3, null, '3226', '+0:25'], [4, 'LAP', null, '-1 LAP'], [5, 'LAP', null, '-3 LAP'], [null, 'DNF', null, null]]);
    expect(rows[0]).toMatchObject({ firstName: 'Marc', lastName: 'Moncho Signes 1', riderDisplay: 'Marc Moncho Signes 1', teamName: null, isoCode2: null });
    expect(rows[1]).toMatchObject({ teamName: 'JORGE CANET-EL RALL', isoCode2: 'ES' });
    expect(omitted).toHaveLength(1);
    expect(warnings).toMatchObject([{ reason: expect.stringContaining('renumera') }]);
  });
  it('rechaza clasificaciones incoherentes', () => {
    expect(() => parseSmartwebRows([source(1, 'Vta. perdida')])).toThrow(/ganador/);
    expect(() => parseSmartwebRows([source(1, '00:50:00'), source(2, '00:49:00')])).toThrow(/inferior/);
    expect(() => parseSmartwebRows([source(1, '00:50:00'), source(2, 'Vta. perdida'), source(3, '00:59:00')])).toThrow(/doblados/);
    expect(() => parseSmartwebRows([source(1, '00:50:00'), source(2, 'Descanso')])).toThrow(/no reconocido/);
    expect(() => parseSmartwebTable('<table><tr><th>Pos.</th><th>Nombre</th></tr></table>')).toThrow(/Cabecera/);
  });
  it('acepta la cabecera «Comunidad Autónoma Participante» y el estado en el puesto (FCCV, Vasca)', () => {
    const sourceRows = parseSmartwebTable(table([['1', '64', 'MARC', 'MONCHO SIGNES', 'JORGE CANET-EL RALL', 'VLC', '00:56:39.000'],
      ['DNF', '70', 'IKER', 'ZUBIZARRETA', 'BAQUE', 'EUS', '-']], 'Comunidad Autónoma Participante'));
    expect(sourceRows[1]).toMatchObject({ pos: 'DNF', region: 'EUS', time: '-' });
    expect(parseSmartwebRows(sourceRows).rows.map(row => [row.rank, row.irm])).toEqual([[1, null], [null, 'DNF']]);
  });
  it('separa clasificaciones vacías e inválidas y acredita el enlace', () => {
    const parsed = parseSmartwebIndex(index(select('categorias', 'showCategoriasFicheros', [['1', 'ELITE-SUB23'], ['2', 'FEM JUNIOR']])));
    const pages = { 'fichero:1': table([['1', '64', 'MARC', 'MONCHO SIGNES', 'JORGE CANET-EL RALL', 'VLC', '00:56:39.000']]), 'fichero:2': table([]) };
    const document = buildSmartwebCxDocument({ indexUrl: INDEX_URL, index: parsed, pages, map: MAP, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-10-11', source: 'smartweb' });
    expect(document.categories).toMatchObject([{ category: 'ME', evidence: { sourceUrl: smartwebCategoryUrl(INDEX_URL, 'fichero', '1'),
      smartweb: { sourceUrl: INDEX_URL, label: 'ELITE-SUB23', variant: 'fichero', categoryId: '1' } } }]);
    expect(document.skipped).toMatchObject([{ category: 'WJ' }]);
    expect(() => buildSmartwebCxDocument({ indexUrl: INDEX_URL, index: parsed, pages, map: MAP, raceId: 'r', seasonKey: '2026-27', dateKey: '2026-10-12' })).toThrow(/no del/);
  });
  it('enlaza por nombre las filas sin nacionalidad propia y desarrolla abreviaturas', () => {
    const { rows } = parseSmartwebRows([source(1, '00:50:00', { firstName: 'FCO. JOSE', lastName: 'GERICO GOMEZ' }),
      source(2, '00:51:00', { firstName: 'TENLEY', lastName: 'GETSCHMAN', region: 'AST' }), source(3, '00:52:00', { firstName: 'LUCA', lastName: 'HARTER', region: '' })]);
    expect(rows[0].firstName).toBe('Francisco Jose');
    const riders = { men: [
      { id: 'gerico', firstName: 'Francisco José', lastName: 'Gericó', otherNames: 'Francisco José Gericó Gómez', nationality: 'ES', verified: true },
      { id: 'getschman', firstName: 'Tenley', lastName: 'Getschman', nationality: 'US', verified: true },
      { id: 'harter', firstName: 'Luca', lastName: 'Harter', nationality: 'DE', verified: true }], women: [] };
    const document = resolveSmartwebIdentities({ categories: [{ category: 'ME', rows }] }, riders);
    expect(document.categories[0].rows.map(row => [row.globalRiderId, row.isoCode2])).toEqual([['gerico', 'ES'], ['getschman', 'US'], ['harter', 'DE']]);
  });
});
