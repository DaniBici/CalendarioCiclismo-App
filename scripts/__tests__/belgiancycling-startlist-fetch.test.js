import { describe, expect, it } from 'vitest';
import {
  parseStartlistXml,
  splitName,
} from '../results-fetchers/belgiancycling-startlist-fetch.mjs';

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

  it('lee las fechas impresas sin cero inicial en días y meses de una cifra', () => {
    const stage = parseStartlistXml('2026295', startlistXml({
      columns: standardColumns,
      date: '6/9/2026',
      extra: `${word(36, 760, 'Last')} ${word(50, 760, 'Update:')} ${word(80, 760, '5/9/2026')} ${word(120, 760, '16:53')}`,
    }), '2026-09-06');
    expect(stage.dateKey).toBe('2026-09-06');
    expect(stage.lastUpdate).toEqual({ dateKey: '2026-09-05', time: '16:53', zone: 'Europe/Brussels' });
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
});
