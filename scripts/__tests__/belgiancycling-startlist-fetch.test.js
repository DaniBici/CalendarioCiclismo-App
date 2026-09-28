import { describe, expect, it } from 'vitest';
import {
  parseStartlistXml,
  splitName,
  startlistPdfUrl,
} from '../results-fetchers/belgiancycling-startlist-fetch.mjs';
import {
  applyVariantResolutions,
  buildNormalizedDocument,
  resolveTeamIds,
} from '../results-fetchers/belgiancycling-startlists-sync.mjs';

const word = (x, y, text) => `<word xMin="${x}.000000" yMin="${y}.000000" xMax="${x + 50}.000000" yMax="${y + 9}.000000">${text}</word>`;

// Una columna Belgian Cycling: cabecera del bloque (nombre de equipo), línea
// PL/DS del director y corredores precedidos por dorsal. `plY` ancla la geometría.
function columnXml(x, plY, teamName, riders) {
  const parts = [];
  for (const [index, chunk] of teamName.split(' ').entries()) parts.push(word(x + index * 30, plY - 10, chunk));
  parts.push(word(x, plY, 'PL/DS'), word(x + 30, plY, 'DIRECTOR'));
  let y = plY + 15;
  for (const rider of riders) {
    for (const [index, chunk] of rider.line.split(' ').entries()) parts.push(word(x + index * 28, y, chunk));
    if (rider.continuation) { y += 12; parts.push(word(x + 28, y, rider.continuation)); }
    y += 12;
  }
  return parts.join('\n');
}

function startlistXml({ date = '20/09/2026', count = 10, columns, xs = [36, 200, 364, 528, 692], extra = '', title = 'DEELNEMERSLIJST' }) {
  const header = [
    word(36, 20, 'GOOIKSE PIJL'), word(200, 20, 'Roosdaal-Gooik'),
    word(36, 30, date), word(90, 30, '195,8'), word(110, 30, 'Km.'),
    word(36, 40, String(count)), word(52, 40, 'Deeln./Part.'),
    word(250, 40, title), word(320, 40, '-'), word(328, 40, title === 'DEELNEMERSLIJST' ? 'LISTE' : 'ENGAGEMENTS'), word(352, 40, 'DES'), word(372, 40, title === 'DEELNEMERSLIJST' ? 'PARTANTS' : 'ENGAGES'),
    word(600, 40, 'Cat.:'), word(620, 40, 'ME'), word(630, 40, '1.1'),
  ].join('\n');
  const footer = [
    word(36, 780, 'Last'), word(50, 780, 'Update:'), word(80, 780, '15:30'),
    word(500, 780, 'www.results.belgiancycling.be'),
  ].join('\n');
  const body = columns
    .map((column, index) => columnXml(xs[index], 110, column.teamName, column.riders))
    .join('\n');
  return `<layout><page width="842" height="595">${header}\n${body}\n${extra}\n${footer}</page></layout>`;
}

const standardColumns = [
  { teamName: 'NSN CYCLING TEAM', riders: [{ line: '1 KOGUT Oded' }, { line: '2 SAGIV Guy' }] },
  { teamName: 'RED BULL - BORA - HANSGROHE', riders: [{ line: '61 MEEUS Jordi' }, { line: '62 VAN DEN BROEK Axel' }] },
  { teamName: 'TEAM FLANDERS - BALOISE', riders: [{ line: '111 DEMAN Brem' }, { line: '112 VANHOOF Elo' }] },
  { teamName: 'COLOR CODE-ALU CENTER', riders: [{ line: '161 MELOTTE' , continuation: 'Matteo' }, { line: '162 WALPOT Emiel' }] },
  { teamName: 'AARCO', riders: [{ line: '201 HANNES Victor' }, { line: '202 HANNES Kamiel' }] },
];

describe('Belgian Cycling — lista de inscritos (PDF -D)', () => {
  it('deriva la URL estable de la lista', () => {
    expect(startlistPdfUrl('2026279')).toBe('https://uitslagen.kbwb-rlvb.com/uitslagen/2026/2026279-D.pdf');
  });

  it('reconoce el marcador previo a la publicación', () => {
    const xml = `<page>${word(36, 100, 'Info')} ${word(60, 100, 'nog')} ${word(80, 100, 'niet')} ${word(110, 100, 'beschikbaar')}</page>`;
    expect(parseStartlistXml('2026277', xml, '2026-09-19')).toBeNull();
  });

  it('extrae la marca de versión Last Update como evidencia horaria local', () => {
    const stage = parseStartlistXml('2026279', startlistXml({
      columns: standardColumns,
      extra: `${word(36, 760, 'Last')} ${word(50, 760, 'Update:')} ${word(80, 760, '18/09/2026')} ${word(120, 760, '11:16')}`,
    }), '2026-09-20');
    expect(stage.lastUpdate).toEqual({ dateKey: '2026-09-18', time: '11:16', zone: 'Europe/Brussels' });
    expect(stage.provisional).toBe(false);
    expect(stage.signature).toMatch(/^P\|/);
  });

  it('ingesta el Engagements como lista provisional con dorsal 0', () => {
    const columns = standardColumns.map((column) => ({
      teamName: column.teamName,
      riders: column.riders.map((r) => ({ line: `${r.line}${r.continuation ? ` ${r.continuation}` : ''}`.replace(/^\d+\s+/, '') })),
    }));
    const stage = parseStartlistXml('2026277', startlistXml({ columns, count: 10, title: 'INSCHRIJVINGEN' }), '2026-09-19');
    const riders = stage.teams.flatMap((t) => t.riders);
    expect(stage.provisional).toBe(true);
    expect(stage.signature).toMatch(/^E\|/);
    expect(riders).toHaveLength(10);
    expect(riders.every((r) => r.dorsal === 0)).toBe(true);
    expect(riders.every((r) => r.firstName && r.lastName)).toBe(true);
    expect(stage.teams[0].teamName).toBe('NSN CYCLING TEAM');
  });

  it('exige que el Engagements cuadre con su recuento si lo declara', () => {
    const columns = standardColumns.map((column) => ({
      teamName: column.teamName,
      riders: column.riders.map((r) => ({ line: `${r.line}${r.continuation ? ` ${r.continuation}` : ''}`.replace(/^\d+\s+/, '') })),
    }));
    expect(() => parseStartlistXml('2026277', startlistXml({ columns, count: 11, title: 'INSCHRIJVINGEN' }), '2026-09-19'))
      .toThrow('declara 11');
  });

  it('separa las 5 columnas de equipos y reparte los corredores por dorsal', () => {
    const stage = parseStartlistXml('2026279', startlistXml({ columns: standardColumns }), '2026-09-20');
    expect(stage.expectedRiderCount).toBe(10);
    expect(stage.teams).toHaveLength(5);
    expect(stage.teams[0]).toMatchObject({ teamName: 'NSN CYCLING TEAM' });
    expect(stage.teams[0].riders[0]).toMatchObject({ dorsal: 1, lastName: 'KOGUT', firstName: 'Oded' });
    expect(stage.teams[1].riders[1]).toMatchObject({ dorsal: 62, lastName: 'VAN DEN BROEK', firstName: 'Axel' });
    expect(stage.teams[3].riders[0]).toMatchObject({ dorsal: 161, lastName: 'MELOTTE', firstName: 'Matteo' });
    expect(stage.dateKey).toBe('2026-09-20');
  });

  it('admite retículas de 4 columnas como la de Gooikse', () => {
    const fourColumns = standardColumns.slice(0, 4);
    const riders = 4 * 2;
    const xml = startlistXml({ columns: fourColumns, count: riders, xs: [22, 164, 306, 449] });
    const stage = parseStartlistXml('2026279', xml, '2026-09-20');
    expect(stage.teams).toHaveLength(4);
    expect(stage.teams.flatMap((t) => t.riders)).toHaveLength(riders);
  });

  it('rechaza un recuento inconsistente, dorsales duplicados y otra edición', () => {
    expect(() => parseStartlistXml('2026279', startlistXml({ columns: standardColumns, count: 11 }), '2026-09-20'))
      .toThrow('declara 11');
    const duplicated = JSON.parse(JSON.stringify(standardColumns));
    duplicated[4].riders[1].line = '1 HANNES Kamiel';
    expect(() => parseStartlistXml('2026279', startlistXml({ columns: duplicated }), '2026-09-20'))
      .toThrow('duplicados o no positivos');
    expect(() => parseStartlistXml('2026279', startlistXml({ columns: standardColumns, date: '20/09/2025' }), '2026-09-20'))
      .toThrow('es de 2025');
  });

  it('normaliza una errata de un día en la fecha impresa', () => {
    const stage = parseStartlistXml('2026279', startlistXml({ columns: standardColumns }), '2026-09-21');
    expect(stage.dateKey).toBe('2026-09-21');
    expect(() => parseStartlistXml('2026279', startlistXml({ columns: standardColumns }), '2026-09-22'))
      .toThrow('no de 2026-09-22');
  });

  it('repite los apellidos compuestos en mayúsculas y exige nombre propio', () => {
    expect(splitName('VAN DEN BROEK Axel')).toEqual({ lastName: 'VAN DEN BROEK', firstName: 'Axel' });
    expect(() => splitName('WÆRENSKJOLD')).toThrow('No se separa el nombre');
  });

  describe('resolución previa del carril de inscritos', () => {
    const catalog = [
      { id: 'hobbs-noah', f: 'Noah', l: 'Hobbs', o: null, b: '2004-07-23', c: 'gb', u: '10081552631', ff: 'noah', fl: 'hobbs' },
      { id: 'fox-matthew', f: 'Matthew', l: 'Fox', o: null, b: '2002-09-28', c: 'au', u: null, ff: 'matthew', fl: 'fox' },
      { id: 'etxeberria-haimar', f: 'Haimar', l: 'Etxeberria', o: null, b: '2003-09-08', c: 'es', u: null, ff: 'haimar', fl: 'etxeberria' },
      { id: 'etxeberria-ansalas-h', f: 'H.', l: 'Etxeberria Ansalas', o: null, b: null, c: null, u: null, ff: 'h', fl: 'etxeberria ansalas' },
      { id: 'graff-william', f: 'William', l: 'Graff', o: null, b: '2003-02-11', c: 'be', u: null, ff: 'william', fl: 'graff' },
    ];
    const tokenFolds = new Map([
      ['Alfred Bruce Noah', 'alfred bruce noah'],
      ['Haimar', 'haimar'],
      ['Noah', 'noah'],
      ['William', 'william'],
      ['Rui Filipe', 'rui filipe'],
      ['António', 'antonio'],
      ['Juan Sebasti', 'juan sebasti'],
    ]);
    const lastNameFolds = new Map([
      ['Hobbs', 'hobbs'], ['Fox', 'fox'], ['ETXEBERRIA ANSALAS', 'etxeberria ansalas'],
      ['GRAFF', 'graff'], ['TOMAS MORGADO', 'tomas morgado'], ['ALVES OLIVEIRA', 'alves oliveira'],
      ['VANDENBROEKE', 'vandenbroeke'], ['MOLANO BENAVIDES', 'molano benavides'],
    ]);
    const catalogAmbiguous = [...catalog,
      { id: 'hobbs-otro', f: 'Noah', l: 'Hobbs', o: null, b: '1995-01-01', c: 'gb', u: null, ff: 'noah', fl: 'hobbs' }];

    it('resuelve la variante nominal con un único candidato verificado', () => {
      const document = { teams: [{ teamName: 'EF', riders: [{ dorsal: 41, firstName: 'Alfred Bruce Noah', lastName: 'Hobbs' }] }] };
      const { resolved, matched } = applyVariantResolutions(document, catalog, tokenFolds, lastNameFolds);
      expect(resolved).toBe(1);
      expect(matched.get('0|0')).toMatchObject({ id: 'hobbs-noah' });
      const rider = document.teams[0].riders[0];
      expect(rider).toMatchObject({ globalRiderId: 'hobbs-noah', countryCode: 'gb', birthDate: '2004-07-23', uciProfileId: '10081552631' });
    });

    it('no cruza apellidos distintos aunque el nombre de pila coincida', () => {
      const document = { teams: [{ teamName: 'COLOR CODE', riders: [
        { dorsal: 71, firstName: 'William', lastName: 'VANDENBROEKE' },
        { dorsal: 163, firstName: 'William', lastName: 'GRAFF' },
      ] }] };
      const { resolved, matched } = applyVariantResolutions(document, catalog, tokenFolds, lastNameFolds);
      expect(resolved).toBe(1);
      expect(document.teams[0].riders[0].globalRiderId).toBeUndefined();
      expect(document.teams[0].riders[1].globalRiderId).toBe('graff-william');
      expect(matched.get('0|1').id).toBe('graff-william');
    });

    it('descarta el candidato sin verificación y exige candidato único', () => {
      const document = { teams: [{ teamName: 'EF', riders: [
        { dorsal: 63, firstName: 'Haimar', lastName: 'ETXEBERRIA ANSALAS' },
        { dorsal: 41, firstName: 'Noah', lastName: 'Hobbs' },
      ] }] };
      const { resolved } = applyVariantResolutions(document, catalogAmbiguous, tokenFolds, lastNameFolds);
      expect(resolved).toBe(1);
      expect(document.teams[0].riders[0].globalRiderId).toBe('etxeberria-haimar');
      expect(document.teams[0].riders[1].globalRiderId).toBeUndefined();
    });

    it('resuelve apellidos compuestos UCI con la ficha como sufijo o como stub', () => {
      const catalogWide = [...catalog,
        { id: 'morgado-antonio', f: 'António', l: 'Morgado', o: null, b: '2004-01-28', c: 'pt', u: '442797', ff: 'antonio', fl: 'morgado' },
        { id: 'alves-oliveira-r', f: 'R.', l: 'Alves Oliveira', o: null, b: null, c: null, u: null, ff: 'r', fl: 'alves oliveira' },
        { id: 'oliveira-rui', f: 'Rui', l: 'Oliveira', o: null, b: '1996-09-05', c: 'pt', u: '91911', ff: 'rui', fl: 'oliveira' }];
      const document = { teams: [{ teamName: 'UAE', riders: [
        { dorsal: 122, firstName: 'Rui Filipe', lastName: 'ALVES OLIVEIRA' },
        { dorsal: 126, firstName: 'António', lastName: 'TOMAS MORGADO' },
      ] }] };
      expect(applyVariantResolutions(document, catalogWide, tokenFolds, lastNameFolds).resolved).toBe(2);
      expect(document.teams[0].riders[0].globalRiderId).toBe('oliveira-rui');
      expect(document.teams[0].riders[1].globalRiderId).toBe('morgado-antonio');
    });

    it('resuelve el nombre recortado por el margen vía prefijo del último token', () => {
      const catalogWide = [...catalog,
        { id: 'molano-sebastian', f: 'Sebastián', l: 'Molano', o: null, b: '1994-11-04', c: 'co', u: '89712', ff: 'sebastian', fl: 'molano' }];
      const document = { teams: [{ teamName: 'UAE', riders: [
        { dorsal: 125, firstName: 'Juan Sebasti', lastName: 'MOLANO BENAVIDES' },
      ] }] };
      expect(applyVariantResolutions(document, catalogWide, tokenFolds, lastNameFolds).resolved).toBe(1);
      expect(document.teams[0].riders[0].globalRiderId).toBe('molano-sebastian');
    });

    it('enlaza el equipo solo con mayoría estricta de plantillas actuales', () => {
      const document = { teams: [
        { teamName: 'EF', riders: [
          { dorsal: 41, firstName: 'Alfred Bruce Noah', lastName: 'Hobbs' },
          { dorsal: 42, firstName: 'Richard', lastName: 'Carapaz' },
          { dorsal: 43, firstName: 'Odd', lastName: 'Rider' },
        ] },
        { teamName: 'EMPATE', riders: [
          { dorsal: 51, firstName: 'A', lastName: 'Uno' },
          { dorsal: 52, firstName: 'B', lastName: 'Dos' },
        ] },
      ] };
      const matched = new Map([
        ['0|0', { ct: 'team_ef' }], ['0|1', { ct: 'team_ef' }], ['0|2', { ct: 'team_otro' }],
        ['1|0', { ct: 'team_x' }], ['1|1', { ct: 'team_y' }],
      ]);
      expect(resolveTeamIds(document, matched, new Map(), [])).toBe(1);
      expect(document.teams[0].teamId).toBe('team_ef');
      expect(document.teams[1].teamId).toBeUndefined();
    });

    it('desempata por nombre del bloque descartando la gemela histórica', () => {
      const document = { teams: [{ teamName: 'XDS ASTANA TEAM', riders: [
        { dorsal: 101, firstName: 'Max', lastName: 'Kanter' },
        { dorsal: 102, firstName: 'Arjen', lastName: 'Livyns' },
      ] }] };
      const matched = new Map([
        ['0|0', { ct: 'team_devo_astana' }], ['0|1', { ct: 'team_otro' }],
      ]);
      const teamFolds = new Map([['XDS ASTANA TEAM', 'xds astana team']]);
      const teamsCatalog = [
        { id: 'team_xds', fn: 'xds astana team' },
        { id: 'uci-hist-male-2025-20251', fn: 'xds astana team' },
        { id: 'team_devo_astana', fn: 'xds astana development team' },
      ];
      expect(resolveTeamIds(document, matched, teamFolds, teamsCatalog)).toBe(1);
      expect(document.teams[0].teamId).toBe('team_xds');
    });

    it('normaliza el documento con los campos resueltos', () => {
      const doc = {
        raceId: 'r1', expectedRiderCount: 1, sourceUrl: 'https://x',
        teams: [{ teamName: 'EF', teamId: 'team_ef', riders: [{ dorsal: 41, firstName: 'Noah', lastName: 'Hobbs', globalRiderId: 'hobbs-noah', countryCode: 'gb', birthDate: '2004-07-23' }] }],
      };
      expect(buildNormalizedDocument(doc)).toEqual({
        raceId: 'r1', expectedRiderCount: 1, sourceUrl: 'https://x',
        teams: [{ teamName: 'EF', teamId: 'team_ef', riders: [{ dorsal: 41, firstName: 'Noah', lastName: 'Hobbs', globalRiderId: 'hobbs-noah', countryCode: 'gb', birthDate: '2004-07-23' }] }],
      });
    });
  });
});
