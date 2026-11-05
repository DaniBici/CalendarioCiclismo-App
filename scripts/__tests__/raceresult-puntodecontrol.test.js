import { describe, it, expect } from 'vitest';
import {
  parseClock, formatGap, stageFolder, stageListNames, locateColumns, mapListRows, assessStage, ittComplete, bibsInRace,
  teamListName, POINTS_LISTS, locatePointsColumns, locateTeamColumns, mapPointsRows, mapTeamRows, unknownBibs,
  pointsBelongToStage, deriveYouthRows, parseGapSeconds,
} from '../results-fetchers/raceresult-puntodecontrol.mjs';

// Plantilla verificada contra la Vuelta Ciclista del Uruguay Femenina 2026
// (race|result 432634), con la simulación que el cronometrador publicó la víspera.
const STAGE_FIELDS = ['BIB', 'ID', 'if([E2]="";[ClasifEtapa1];[E2])', 'UCIID', 'FIRSTNAME', 'NATION.FLAG', 'Categoria', 'CLUB',
  'if([E1]="";[CortesEtapa1])', 'BonificaEtapa1', 'BonifVolEtapa1', 'MultaEtapa1', 'if([E2]="";[TTEtapa1];[E2])'];
const PROLOGUE_FIELDS = ['BIB', 'ID', 'if([E1]="";[ClasifPrologo];[E1])', 'FIRSTNAME', 'NATION.FLAG', 'Categoria', 'CLUB',
  'if([E1]="";[TTPrologo];[E1])'];
const GC_FIELDS = ['BIB', 'ID', 'ClasGenDesEtapa1', 'FIRSTNAME', 'Categoria', 'CLUB', 'GeneralDespuesEtapa1',
  'GapTimeTop(2;2;"--";"+hh:mm:ss")'];

const stageRow = (bib, rank, cortes, tt = cortes) =>
  [String(bib), '1', String(rank), '10000000000', `APELLIDO${bib} Nombre`, '[img:/graphics/flags/UY.svg]', 'WOMEN Elite', 'Club', cortes, '', '', '', tt];

describe('stageListNames — una lista por jornada y su general', () => {
  const lists = ['PROLOGO|Prologo', 'ETAPA 1|Etapa1', 'ETAPA 1|GeneralEtapa1', 'ETAPA 2|Etapa2'];

  it('el prólogo es su propia general', () => {
    expect(stageListNames(lists, 0)).toEqual({ stage: 'PROLOGO|Prologo', gc: 'PROLOGO|Prologo' });
  });

  it('no confunde la etapa 1 con su general ni con la etapa 11', () => {
    expect(stageListNames([...lists, 'ETAPA 11|Etapa11'], 1)).toEqual({ stage: 'ETAPA 1|Etapa1', gc: 'ETAPA 1|GeneralEtapa1' });
    expect(stageListNames(lists, 2)).toEqual({ stage: 'ETAPA 2|Etapa2', gc: null });
  });

  it('una CRI sin número usa las listas de la crono y su orden de salida', () => {
    const crono = ['1PROLOGO|Prologo', '2ETAPA 1|Etapa1', '3CRONO|OrdenCrono', '3CRONO|Contrareloj', '3CRONO|GeneralCrono'];
    expect(stageListNames(crono, 2, { itt: true })).toEqual({
      stage: '3CRONO|Contrareloj', gc: '3CRONO|GeneralCrono', startOrder: '3CRONO|OrdenCrono',
    });
    expect(stageListNames(crono, 2)).toEqual({ stage: null, gc: null });
  });

  it('el rótulo oficial de la llegada prevalece sobre el número interno de la carpeta', () => {
    // Pestaña publicada el 01-11-2026: la etapa 3 vive en la carpeta "4ETAPA 2".
    const defs = [
      { Name: '1PROLOGO|Prologo', ShowAs: 'Prologo' },
      { Name: '2ETAPA 1|Etapa1', ShowAs: 'Etapa 1' },
      { Name: '3CRONO|Contrareloj', ShowAs: 'Contrareloj (Etapa 2)' },
      { Name: '4ETAPA 2|Etapa2', ShowAs: 'Etapa 3' },
      { Name: '4ETAPA 2|GeneralEtapa2', ShowAs: 'General Final' },
      { Name: '4ETAPA 2|GenEquiposEtapa2', ShowAs: 'General por Equipos' },
    ];
    const names = defs.map((def) => def.Name);
    expect(stageListNames(names, 3, { folder: stageFolder(defs, 3) })).toEqual({ stage: '4ETAPA 2|Etapa2', gc: '4ETAPA 2|GeneralEtapa2' });
    expect(teamListName(names, 3, stageFolder(defs, 3))).toBe('4ETAPA 2|GenEquiposEtapa2');
    expect(stageListNames(names, 2, { itt: true, folder: stageFolder(defs, 2) })).toEqual({ stage: '3CRONO|Contrareloj', gc: null, startOrder: null });
  });
});

describe('locateColumns — por expresión, no por posición', () => {
  it('en ruta toma los cortes (sin bonificaciones) como tiempo de etapa', () => {
    expect(locateColumns(STAGE_FIELDS, 'stage')).toEqual({ rank: 2, bib: 0, name: 4, team: 7, time: 8 });
  });

  it('el prólogo solo publica el tiempo final', () => {
    expect(locateColumns(PROLOGUE_FIELDS, 'stage')).toEqual({ rank: 2, bib: 0, name: 3, team: 6, time: 7 });
  });

  it('la general usa el acumulado tras la etapa', () => {
    expect(locateColumns(GC_FIELDS, 'gc')).toEqual({ rank: 2, bib: 0, name: 3, team: 5, time: 6 });
  });

  it('falla si la plantilla pierde una columna', () => {
    expect(() => locateColumns(STAGE_FIELDS.filter((f) => f !== 'CLUB'), 'stage')).toThrow(/team/);
  });
});

describe('mapListRows — ganador absoluto, diferencias y estados', () => {
  const cols = locateColumns(STAGE_FIELDS, 'stage');

  it('el ganador lleva su tiempo y el resto la diferencia con él', () => {
    const rows = mapListRows([
      stageRow(54, 1, '02:02:08', '02:01:58'),
      stageRow(96, 2, '02:02:08'),
      stageRow(82, 3, '02:03:09'),
    ], cols);
    expect(rows.map((r) => [r.rank, r.bib, r.resultValue, r.timeText, r.gapText])).toEqual([
      [1, '54', '2:02:08', '2:02:08', null],
      [2, '96', '+0', null, '+0'],
      [3, '82', '+1:01', null, '+1:01'],
    ]);
  });

  it('trunca las centésimas del prólogo', () => {
    expect(parseClock('00:07:27,38')).toBe(447);
    expect(formatGap(3723)).toBe('+1:02:03');
  });

  it('el estado sustituye al puesto: IRM sin puesto ni tiempo', () => {
    const rows = mapListRows([stageRow(54, 1, '02:02:08'), stageRow(96, 'AB', 'AB'), stageRow(31, 'FT', 'FT')], cols);
    expect(rows.find((r) => r.bib === '96')).toMatchObject({ rank: null, irm: 'DNF', resultValue: null });
    expect(rows.find((r) => r.bib === '31')).toMatchObject({ rank: null, irm: 'OTL', resultValue: null });
  });

  it('rechaza dorsales duplicados y tiempos que no crecen con el puesto', () => {
    expect(() => mapListRows([stageRow(54, 1, '02:02:08'), stageRow(54, 2, '02:03:00')], cols)).toThrow(/duplicados/);
    expect(() => mapListRows([stageRow(54, 1, '02:02:08'), stageRow(96, 2, '02:01:00')], cols)).toThrow(/menos tiempo/);
  });
});

describe('assessStage — la simulación previa no se publica', () => {
  const stage1 = { distanceKm: 85.1, startUtc: '2026-10-30T13:00:00Z', neutralStartUtc: '2026-10-30T12:55:00Z' };

  it('descarta un prólogo de 1,2 km en 7 minutos (simulación)', () => {
    const verdict = assessStage({ winnerSecs: 447, distanceKm: 1.2, startUtc: '2026-10-29T19:00:00Z', now: Date.parse('2026-10-29T21:00:00Z') });
    expect(verdict.status).toBe('invalid');
  });

  it('espera mientras el ganador no ha podido llegar desde la salida', () => {
    expect(assessStage({ ...stage1, winnerSecs: 7328, now: Date.parse('2026-10-29T06:00:00Z') }).status).toBe('pending');
    expect(assessStage({ ...stage1, winnerSecs: 7328, now: Date.parse('2026-10-30T14:00:00Z') }).status).toBe('pending');
  });

  it('publica una llegada verosímil tras la salida programada', () => {
    expect(assessStage({ ...stage1, winnerSecs: 7328, now: Date.parse('2026-10-30T15:10:00Z') }).status).toBe('ok');
  });

  it('sin horario solo admite jornadas ya pasadas', () => {
    const base = { winnerSecs: 7328, distanceKm: 85.1, dateKey: '2026-10-30', timeZone: 'America/Montevideo' };
    expect(assessStage({ ...base, now: Date.parse('2026-10-30T20:00:00Z') }).status).toBe('invalid');
    expect(assessStage({ ...base, now: Date.parse('2026-10-31T12:00:00Z') }).status).toBe('ok');
  });
});

describe('ittComplete — la CRI espera a todas las corredoras en carrera', () => {
  it('cuenta puestos y estados; los abandonos previos no se esperan', () => {
    const gc = [{ bib: '1', rank: 1 }, { bib: '2', rank: 2 }, { bib: '3', rank: null, irm: 'DNF' }];
    const expected = bibsInRace(gc);
    expect(ittComplete([{ bib: '1', rank: 1 }], expected)).toEqual({ ready: false, missing: ['2'] });
    expect(ittComplete([{ bib: '1', rank: 1 }, { bib: '2', rank: null, irm: 'DNS' }], expected).ready).toBe(true);
  });
});

describe('clasificaciones anexas — equipos y generales por puntos', () => {
  const POINTS_FIELDS = ['BIB', 'ID', 'AUTORANK', 'FIRSTNAME', 'NATION.FLAG', 'CLUB', 'GeneralRegularidad'];
  const TEAM_FIELDS = ['BIB', 'ID', 'TS1011.RANK', 'CLUB', 'EquipGenPrologo', 'GapTimeTop(1001;1001;"--";"+hh:mm:ss")'];
  const pointsRow = (bib, rank, points) => [String(bib), '1', String(rank), `APELLIDO${bib} Nombre`, '', 'Club', String(points)];
  const teamRow = (rank, team, time) => ['61', '34', String(rank), team, time, ''];

  it('la general por equipos se busca por jornada', () => {
    const lists = ['1PROLOGO|GenEquiposPrologo', '2ETAPA 1|GenEquiposEtapa1', '2ETAPA 11|GenEquiposEtapa11'];
    expect(teamListName(lists, 0)).toBe('1PROLOGO|GenEquiposPrologo');
    expect(teamListName(lists, 1)).toBe('2ETAPA 1|GenEquiposEtapa1');
    expect(teamListName(lists, 2)).toBeNull();
  });

  it('puntos: conserva el orden de los empates y rechaza totales que suben', () => {
    const regularidad = POINTS_LISTS.find((def) => def.classKind === 'points');
    const cols = locatePointsColumns(POINTS_FIELDS, regularidad.value);
    const rows = mapPointsRows([pointsRow(64, 2, 19), pointsRow(21, 1, 19), pointsRow(11, 3, 14)], cols);
    expect(rows.map((r) => [r.rank, r.bib, r.resultValue])).toEqual([[1, '21', '19'], [2, '64', '19'], [3, '11', '14']]);
    expect(() => mapPointsRows([pointsRow(21, 1, 10), pointsRow(64, 2, 12)], cols)).toThrow(/más puntos/);
    expect(() => mapPointsRows([pointsRow(21, 2, 10)], cols)).toThrow(/puesto 1/);
  });

  it('equipos: filas sin dorsal, ganador absoluto y diferencias', () => {
    const rows = mapTeamRows([teamRow(1, 'Armonía Cycles', '00:04:33'), teamRow(2, 'Team Damico CCN', '00:04:34')], locateTeamColumns(TEAM_FIELDS));
    expect(rows.map((r) => [r.rank, r.bib, r.teamName, r.resultValue])).toEqual([[1, null, 'Armonía Cycles', '4:33'], [2, null, 'Team Damico CCN', '+1']]);
  });

  it('detecta dorsales ajenos a la carrera', () => {
    expect(unknownBibs([{ bib: '21' }, { bib: '999' }], new Set(['21', '64']))).toEqual(['999']);
  });

  it('el acumulado deja de pertenecer a una jornada el día de la siguiente', () => {
    const stages = { 0: { dateKey: '2026-10-29' }, 1: { dateKey: '2026-10-30' }, 2: { dateKey: '2026-10-31' } };
    const at = (iso) => Date.parse(iso);
    expect(pointsBelongToStage(stages, 1, 'America/Montevideo', at('2026-10-30T20:00:00Z'))).toBe(true);
    // 21:00 en Montevideo del 30: todavía no es el día de la etapa 2.
    expect(pointsBelongToStage(stages, 1, 'America/Montevideo', at('2026-10-31T00:30:00Z'))).toBe(true);
    expect(pointsBelongToStage(stages, 1, 'America/Montevideo', at('2026-10-31T12:00:00Z'))).toBe(false);
    expect(pointsBelongToStage(stages, 0, 'America/Montevideo', at('2026-10-30T20:00:00Z'))).toBe(false);
  });
});

describe('deriveYouthRows — jóvenes desde la general', () => {
  const gc = [
    { rank: 1, bib: '21', timeText: '2:46:04', gapText: null, irm: null },
    { rank: 2, bib: '64', timeText: null, gapText: '+2', irm: null },
    { rank: 14, bib: '12', timeText: null, gapText: '+3:01', irm: null },
    { rank: null, bib: '43', timeText: null, gapText: null, irm: 'DNF' },
  ];

  it('renumera y mide la diferencia con la mejor elegible', () => {
    const rows = deriveYouthRows(gc, ['64', '12', '43']);
    expect(rows.map((r) => [r.rank, r.bib, r.resultValue, r.irm])).toEqual([
      [1, '64', '2:46:06', null], [2, '12', '+2:59', null], [null, '43', undefined, 'DNF'],
    ]);
  });

  it('sin dorsales elegibles no emite nada', () => {
    expect(deriveYouthRows(gc, [])).toEqual([]);
  });

  it('lee diferencias de segundos, minutos y horas', () => {
    expect([parseGapSeconds('+0'), parseGapSeconds('+28'), parseGapSeconds('+1:15'), parseGapSeconds('+1:02:03')]).toEqual([0, 28, 75, 3723]);
  });
});
