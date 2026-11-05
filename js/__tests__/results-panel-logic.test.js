import { describe, expect, it } from 'vitest';
import {
  isFinalStageRaceDay,
  manualResultClassificationRow,
  shouldMirrorFinalClassification,
  startlistRosterCandidates,
  uniqueStartlistSurnameMatch,
} from '../results/panel-logic.js';

describe('clasificaciones manuales por jornada y sector', () => {
  const sectors = [
    { id: '1a', raceId: 'flanders', stageNumber: 1 },
    { id: '1b', raceId: 'flanders', stageNumber: 1 },
  ];

  it('el alta manual crea dos sectores con identificadores distintos y rechaza el duplicado', () => {
    const a = manualResultClassificationRow(sectors[0], [], 'stage', false, sectors, 'Etapa');
    const b = manualResultClassificationRow(sectors[1], [a], 'stage', false, sectors, 'Etapa');
    expect(a.raceDayId).toBe('1a');
    expect(b.raceDayId).toBe('1b');
    expect(a.stageNumber).toBe(b.stageNumber);
    expect(a.id).not.toBe(b.id);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventId).toBeLessThan(0);
    expect(b.eventId).toBeLessThan(0);
    expect(() => manualResultClassificationRow(sectors[1], [a, b], 'stage', false, sectors, 'Etapa'))
      .toThrow('Ya existe una clasificación «Etapa»');
  });
});

const race = { raceFormat: 'stage_race' };
const days = [
  { id: 'e1', dateKey: '2026-08-20', stageNumber: 1 },
  { id: 'descanso', dateKey: '2026-08-21', stageNumber: null, isRestDay: true },
  { id: 'e2', dateKey: '2026-08-22', stageNumber: 2 },
];

describe('última jornada de una vuelta por etapas', () => {
  it('solo marca la última etapa disputable', () => {
    expect(isFinalStageRaceDay(days[0], race, days)).toBe(false);
    expect(isFinalStageRaceDay(days[2], race, days)).toBe(true);
  });

  it('excluye carreras de un día y jornadas canceladas', () => {
    expect(isFinalStageRaceDay(days[2], { raceFormat: 'one_day' }, days)).toBe(false);
    expect(isFinalStageRaceDay({ ...days[2], isCancelledDay: true }, race, days)).toBe(false);
  });

  it('en una doble jornada solo considera final el último sector', () => {
    const sectors = [
      { id: '3a', dateKey: '2026-08-22', stageNumber: 3, neutralStartTimeUtc: '2026-08-22T08:00:00Z' },
      { id: '3b', dateKey: '2026-08-22', stageNumber: 3, neutralStartTimeUtc: '2026-08-22T13:00:00Z' },
    ];
    expect(isFinalStageRaceDay(sectors[0], race, sectors)).toBe(false);
    expect(isFinalStageRaceDay(sectors[1], race, sectors)).toBe(true);
  });
});

describe('pseudo-clasificación final automática', () => {
  it('se genera para cualquier acumulada de la última etapa, pero no para Etapa', () => {
    expect(shouldMirrorFinalClassification({ classKind: 'points' }, true)).toBe(true);
    expect(shouldMirrorFinalClassification({ classKind: 'gc' }, true)).toBe(true);
    expect(shouldMirrorFinalClassification({ classKind: 'stage' }, true)).toBe(false);
    expect(shouldMirrorFinalClassification({ classKind: 'points' }, false)).toBe(false);
  });
});

describe('autoasociación por apellido en resultados', () => {
  const riders = [
    { dorsal: 12, lastName: 'García Cortina', name: 'Iván García Cortina' },
    { dorsal: 31, lastName: 'Van Aert', name: 'Wout van Aert' },
    { dorsal: 47, lastName: 'Martínez', name: 'Daniel Martínez' },
    { dorsal: 91, lastName: 'Martinez', name: 'Lenny Martinez' },
    { dorsal: 126, firstName: 'Tim', lastName: 'van Dijke', name: 'Tim van Dijke' },
    { dorsal: 76, firstName: 'Marijn', lastName: 'van den Berg', name: 'Marijn van den Berg' },
    { dorsal: 214, firstName: 'Tomáš', lastName: 'Kopecký', name: 'Tomáš Kopecký' },
  ];

  it('reconoce apellidos completos sin distinguir mayúsculas ni tildes', () => {
    expect(uniqueStartlistSurnameMatch('  GARCIA CORTINA ', riders)?.dorsal).toBe(12);
    expect(uniqueStartlistSurnameMatch('van-aert', riders)?.dorsal).toBe(31);
  });

  it('filtra la plantilla por apellido parcial y usa el nombre para desambiguar', () => {
    const roster = [
      { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court-Pienaar' },
      { id: 'julie-martin', firstName: 'Julie', lastName: 'Martin' },
      { id: 'julie-le-roux', firstName: 'Julie', lastName: 'Le Roux' },
    ];
    const ids = (last, first) => startlistRosterCandidates(last, first, roster).map(rider => rider.id);
    expect(ids('le court-pienaar', '')).toEqual(['kim-le-court']);
    expect(ids('le', '')).toEqual(['kim-le-court', 'julie-le-roux']);
    expect(ids('le', 'Kim')).toEqual(['kim-le-court']);
    expect(ids('', 'Julie')).toEqual(['julie-martin', 'julie-le-roux']);
    expect(ids('Le Court', 'Julie')).toEqual([]);
    expect(ids('', '')).toEqual([]);
  });

  it('reconoce nombres completos aunque la fuente invierta el orden o pierda diacríticos', () => {
    expect(uniqueStartlistSurnameMatch('VAN DIJKE Tim', riders)?.dorsal).toBe(126);
    expect(uniqueStartlistSurnameMatch('VAN DEN BERG Marijn', riders)?.dorsal).toBe(76);
    expect(uniqueStartlistSurnameMatch('KOPECKY Tomas', riders)?.dorsal).toBe(214);
  });

  it('no asocia coincidencias ambiguas ni parciales', () => {
    expect(uniqueStartlistSurnameMatch('Martínez', riders)).toBeNull();
    expect(uniqueStartlistSurnameMatch('García', riders)).toBeNull();
  });
});
