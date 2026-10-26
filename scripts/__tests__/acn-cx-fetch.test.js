import { describe, expect, it } from 'vitest';
import { acnCategories, acnSeconds, acnSplitName, acnTarget, buildAcnCxDocument, parseAcnTable } from '../results-fetchers/acn-cx-fetch.mjs';

const columns = ['sR_Pos', 'sR_Nr', 'Name / Team', 'dI_sC_#NOC', 'sC_Laps', 'sR_Time', 'w10000_Temps']
  .map((Name, FieldIdx) => ({ Name, FieldIdx }));
const person = (name, license, team) => `<b>${name}</b><br/><font size="-2">${license} - ${team}</font>`;
const table = rows => ({ Version: 639273131549130105, TableDefinition: { Columns: columns }, Groups: [{ SlaveRows: rows }] });
const rows = [
  ['1.', 1, person('OSAER Emiel', '10074876708', 'STARBIKES - RIDLEY CT'), 'flags/bel.png', '6', '<b>37:21</b><br/>-', '37:21'],
  ['2.', 13, person('VAN DONGEN Stijn', '10113062473', 'JEGG - SKILL - DJR'), 'flags/ned.png', '6', '<b>37:25</b><br/>+0:04', '37:25'],
  ['3.', 9, person('LE Guilloux Lana', '10067508849', 'OLYMPIQUE CYCLISTE DE LOCMINÉ'), 'flags/fra.png', '6', '<b>1:02:03</b><br/>+24:42', '1:02:03'],
  ['4.', 43, person('NIESEN Ivo', '10045772765', 'CYCLING TEAM LIMBURG'), 'flags/ned.png', '4', '<b>-2 LAP</b><br/>', '22:40'],
  ['', 54, person('DE FEYTER Lander', '10111451364', 'GOLAZO YOUNG LIONS'), 'flags/bel.png', '4', '<b>DNF</b><br/>', '26:22'],
];

describe('ACN Timing CX', () => {
  it('reconoce el evento en el visor y en el listado clásico', () => {
    expect(acnTarget('https://www.acn-timing.com/?lng=EN#/events/2156533144205845/ctx/20261011_hg/cms/CRO'))
      .toEqual({ eventId: '2156533144205845', ctx: '20261011_hg' });
    expect(acnTarget('https://prod.chronorace.be/Classements/ListeRapports.aspx?eventId=2156533144205845'))
      .toEqual({ eventId: '2156533144205845', ctx: null });
    expect(() => acnTarget('https://example.com')).toThrow('no reconocida');
    expect(acnSeconds('37:21')).toBe(2241);
    expect(acnSeconds('1:02:03')).toBe(3723);
    expect(acnSeconds('DNF')).toBeNull();
  });

  it('parte apellido y nombre, también con partícula en mayúsculas', () => {
    expect(acnSplitName('OSAER Emiel')).toEqual({ firstName: 'Emiel', lastName: 'Osaer' });
    expect(acnSplitName('LE Guilloux Lana')).toEqual({ firstName: 'Lana', lastName: 'Le Guilloux' });
    expect(acnSplitName('VAN DEN BOGAARD Damy')).toEqual({ firstName: 'Damy', lastName: 'Van den Bogaard' });
  });

  it('convierte puestos, tiempos, vueltas perdidas, estados, licencia y bandera', () => {
    const parsed = parseAcnTable(table(rows));
    expect(parsed.map(row => [row.rank, row.rankText, row.timeSeconds, row.gapText, row.irm, row.isoCode2])).toEqual([
      [1, '1', '2241', null, null, 'BE'],
      [2, '2', '2245', '+0:04', null, 'NL'],
      [3, '3', '3723', '+24:42', null, 'FR'],
      [4, '4', null, '-2 LAP', 'LAP', 'NL'],
      [null, 'DNF', null, null, 'DNF', 'BE'],
    ]);
    expect(parsed[0]).toMatchObject({ bib: '1', firstName: 'Emiel', lastName: 'Osaer', teamName: 'STARBIKES - RIDLEY CT', uciLicenseId: '10074876708' });
    expect(parsed[2]).toMatchObject({ riderDisplay: 'Lana Le Guilloux' });
  });

  it('rechaza una diferencia que no corresponde al tiempo y puestos con huecos', () => {
    const wrongGap = rows.map(row => row.slice());
    wrongGap[1][5] = '<b>37:25</b><br/>+0:05';
    expect(() => parseAcnTable(table(wrongGap))).toThrow('no corresponde al tiempo');
    const gap = rows.map(row => row.slice());
    gap[3][0] = '5.';
    expect(() => parseAcnTable(table(gap))).toThrow('no consecutivos');
    const unknown = rows.map(row => row.slice());
    unknown[4][5] = '<b>XYZ</b><br/>';
    expect(() => parseAcnTable(table(unknown))).toThrow('estado ACN no reconocido');
  });

  it('asigna categorías por el grupo del árbol y descarta lo demás', () => {
    const result = (id, key) => ({ Id: id, Type: 'result', Route: JSON.stringify({ Route: 'events.genericresult', Params: { key } }), Childs: [] });
    const tree = { Name: 'ctx', Childs: [{ Id: 'CLAS', Type: 'Folder', Childs: [{ Id: 'CRO', Name: 'CRO', Type: 'Folder', Childs: [
      { Id: 'CG_34', Name: 'CROMJ', DisplayName: 'Men Junior', Type: 'Folder', Childs: [result('197998_34', 'RES34')] },
      { Id: 'CG_35', Name: 'CROWJ', DisplayName: 'Women Junior', Type: 'Folder', Childs: [result('197998_35', 'RES35')] },
      { Id: 'CG_40', Name: 'CROMS', DisplayName: 'Masters', Type: 'Folder', Childs: [result('197998_40', 'RES40')] },
    ] }] }] };
    const { found, skipped } = acnCategories(tree);
    expect(found.map(item => [item.category, item.key, item.groupId])).toEqual([['MJ', 'RES34', '197998_34'], ['WJ', 'RES35', '197998_35']]);
    expect(skipped).toEqual([{ key: 'RES40', name: 'Masters', reason: 'Grupo fuera de las categorías CX individuales' }]);
    expect(acnCategories(tree, { RES40: 'MU' }).found.map(item => item.category)).toEqual(['MJ', 'WJ', 'MU']);
  });

  it('emite el documento manual con la URL del visor por categoría', () => {
    const document = buildAcnCxDocument({ event: { EventId: 2156533144205845, Title: 'HG Cross - Dendermonde', Location: 'Dendermonde', Country: 'BEL' },
      ctx: '20261011_hg', raceId: 'race', seasonKey: '2026-27', dateKey: '2026-10-11', sourceUrl: 'https://example.test/acn',
      tables: [{ category: 'MJ', key: 'RES34', groupId: '197998_34', name: 'Men Junior', table: table(rows) },
        { category: 'WJ', key: 'RES35', groupId: '197998_35', name: 'Women Junior', table: table([]) }] });
    expect(document).toMatchObject({ schemaVersion: 1, source: 'manual', disciplineId: 3, raceId: 'race', seasonKey: '2026-27' });
    expect(document.categories).toHaveLength(1);
    expect(document.categories[0]).toMatchObject({ category: 'MJ', dateKey: '2026-10-11', evidence: {
      sourceUrl: 'https://www.acn-timing.com/?lng=EN#/events/2156533144205845/ctx/20261011_hg/generic/197998_34/home/RES34' } });
    expect(document.skipped).toEqual([{ category: 'WJ', key: 'RES35', reason: 'Clasificación sin filas' }]);
  });
});

describe('enlazador ACN CX', () => {
  const html = `<a href="https://prod.chronorace.be/Classements/ListeRapports.aspx?eventId=2156533144205845">Uitslagen</a>
    <a href="https://www.acn-timing.com/?lng=EN#/events/2152959731400316/ctx/20251004_exact/cms/CRO">Uitslagen</a>
    <a href="https://www.acn-timing.com/?lng=EN#/events/2152959731400316/ctx/20251004_exact/cms/CRO">Uitslagen</a>
    <a href="https://example.com/otro">Otro</a>`;
  it('extrae los eventos sin duplicados y la fecha del contexto', async () => {
    const { parseAcnEventLinks, acnContextDate } = await import('../results-fetchers/cx-acn-linker.mjs');
    expect(parseAcnEventLinks(html)).toEqual([
      { eventId: '2156533144205845', ctx: null },
      { eventId: '2152959731400316', ctx: '20251004_exact' },
    ]);
    expect(acnContextDate('20261011_hg')).toBe('2026-10-11');
    expect(acnContextDate('cms')).toBeNull();
  });
  it('empareja por país, fecha y lugar y descarta lo ambiguo', async () => {
    const { matchAcnEvent } = await import('../results-fetchers/cx-acn-linker.mjs');
    const race = { id: 'r', dateKey: '2026-10-11', countryCode: 'BE', venue: 'Dendermonde' };
    const event = { EventId: 1, StartDate: '2026-10-11T00:00:00', Country: 'BEL', Location: 'Dendermonde' };
    expect(matchAcnEvent(race, [event]).status).toBe('match');
    expect(matchAcnEvent(race, [{ ...event, Country: 'NED' }]).status).toBe('none');
    expect(matchAcnEvent({ ...race, countryCode: 'NL', venue: 'Heerde' }, [{ ...event, Country: 'NLD', Location: 'Heerde' }]).status).toBe('match');
    expect(matchAcnEvent(race, [{ ...event, StartDate: '2026-10-18T00:00:00' }]).status).toBe('none');
    expect(matchAcnEvent(race, [event, { ...event, EventId: 2 }]).status).toBe('ambiguous');
    expect(matchAcnEvent({ ...race, venue: null }, [event]).status).toBe('none');
  });
});
