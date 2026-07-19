import { describe, it, expect } from 'vitest';
import { annotateDoubleSectors } from '../services/races.js';

// ── annotateDoubleSectors ──────────────────────────────────────────

function makeRaceDay(overrides = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    raceId: overrides.raceId ?? 'race-1',
    dateKey: overrides.dateKey ?? '2026-07-01',
    stageNumber: overrides.stageNumber ?? 1,
    isRestDay: overrides.isRestDay ?? false,
    isCancelledDay: overrides.isCancelledDay ?? false,
    neutralStartTimeUtc: overrides.neutralStartTimeUtc ?? null,
    ...overrides,
  };
}

describe('annotateDoubleSectors', () => {
  it('no asigna sufijo si no hay duplicados', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1 }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-02', stageNumber: 2 }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._stageSuffix).toBeUndefined();
    expect(days[1]._stageSuffix).toBeUndefined();
  });

  it('asigna A y B a doble sector del mismo día', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T08:00:00Z' }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T13:00:00Z' }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._stageSuffix).toBe('A');
    expect(days[1]._stageSuffix).toBe('B');
  });

  it('ordena A/B por hora de salida ascendente', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T13:00:00Z' }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T08:00:00Z' }),
    ];
    annotateDoubleSectors(days);
    const sufixes = days.map(d => d._stageSuffix);
    expect(sufixes).toContain('A');
    expect(sufixes).toContain('B');
    const aIdx = days.findIndex(d => d._stageSuffix === 'A');
    expect(days[aIdx].neutralStartTimeUtc).toBe('2026-07-01T08:00:00Z');
  });

  it('no asigna sufijo a días de descanso', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, isRestDay: true }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1 }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._stageSuffix).toBeUndefined();
    expect(days[1]._stageSuffix).toBeUndefined();
  });

  it('no asigna sufijo a etapas canceladas', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 3, isCancelledDay: true }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 3 }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._stageSuffix).toBeUndefined();
    expect(days[1]._stageSuffix).toBeUndefined();
  });

  it('no mezcla dobles sectores de carreras distintas', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1 }),
      makeRaceDay({ raceId: 'r2', dateKey: '2026-07-01', stageNumber: 1 }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._stageSuffix).toBeUndefined();
    expect(days[1]._stageSuffix).toBeUndefined();
  });

  it('calcula _fcStageNumber correctamente en carrera simple', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1 }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-02', stageNumber: 2 }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-03', stageNumber: 3 }),
    ];
    annotateDoubleSectors(days);
    expect(days[0]._fcStageNumber).toBe(1);
    expect(days[1]._fcStageNumber).toBe(2);
    expect(days[2]._fcStageNumber).toBe(3);
  });

  it('calcula _fcStageNumber contando cada sector como etapa en doble sector', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T08:00:00Z' }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1, neutralStartTimeUtc: '2026-07-01T13:00:00Z' }),
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-02', stageNumber: 2 }),
    ];
    annotateDoubleSectors(days);
    const fcNums = days.map(d => d._fcStageNumber).sort((a, b) => a - b);
    expect(fcNums).toEqual([1, 2, 3]);
  });

  it('no asigna _fcStageNumber con skipFcNumbers=true', () => {
    const days = [
      makeRaceDay({ raceId: 'r1', dateKey: '2026-07-01', stageNumber: 1 }),
    ];
    annotateDoubleSectors(days, { skipFcNumbers: true });
    expect(days[0]._fcStageNumber).toBeUndefined();
  });
});

// ── sectorSuffixMap / resultStageEntryKey / parseResultStageKey ─────
import { sectorSuffixMap, resultStageEntryKey, parseResultStageKey } from '../services/races.js';

describe('sectorSuffixMap', () => {
  it('no marca sectores en carrera sin dobles sectores', () => {
    const days = [
      { id: 'd1', stageNumber: 1, dateKey: '2026-07-01', neutralStartTimeUtc: '2026-07-01T09:00:00Z' },
      { id: 'd2', stageNumber: 2, dateKey: '2026-07-02', neutralStartTimeUtc: '2026-07-02T09:00:00Z' },
    ];
    const { suffixByDayId, sectoredNums } = sectorSuffixMap(days);
    expect(sectoredNums.size).toBe(0);
    expect(suffixByDayId.size).toBe(0);
  });

  it('asigna A/B por hora de salida al doble sector (mismo stageNumber)', () => {
    // Baloise Ladies Tour: etapa 3 partida en 3A (mañana) y 3B (tarde).
    const days = [
      { id: 'd3b', stageNumber: 3, dateKey: '2026-07-13', neutralStartTimeUtc: '2026-07-13T15:00:00Z' },
      { id: 'd3a', stageNumber: 3, dateKey: '2026-07-13', neutralStartTimeUtc: '2026-07-13T09:00:00Z' },
    ];
    const { suffixByDayId, sectoredNums } = sectorSuffixMap(days);
    expect(sectoredNums.has(3)).toBe(true);
    expect(suffixByDayId.get('d3a')).toBe('A');   // más temprano = A
    expect(suffixByDayId.get('d3b')).toBe('B');
  });

  it('un sector cancelado sigue recibiendo sufijo', () => {
    const days = [
      { id: 'd3a', stageNumber: 3, dateKey: '2026-07-13', neutralStartTimeUtc: '2026-07-13T09:00:00Z' },
      { id: 'd3b', stageNumber: 3, dateKey: '2026-07-13', neutralStartTimeUtc: '2026-07-13T15:00:00Z', isCancelledDay: true },
    ];
    const { suffixByDayId, sectoredNums } = sectorSuffixMap(days);
    expect(sectoredNums.has(3)).toBe(true);
    expect(suffixByDayId.get('d3a')).toBe('A');
    expect(suffixByDayId.get('d3b')).toBe('B');
  });
});

describe('resultStageEntryKey', () => {
  const suffixByDayId = new Map([['d3a', 'A'], ['d3b', 'B']]);
  const sectoredNums = new Set([3]);

  it('final → "final"', () => {
    expect(resultStageEntryKey(null, null, suffixByDayId, sectoredNums)).toBe('final');
  });
  it('etapa normal → número pelado', () => {
    expect(resultStageEntryKey(2, 'd2', suffixByDayId, sectoredNums)).toBe('2');
  });
  it('sector con raceDayId conocido → número + sufijo', () => {
    expect(resultStageEntryKey(3, 'd3a', suffixByDayId, sectoredNums)).toBe('3A');
    expect(resultStageEntryKey(3, 'd3b', suffixByDayId, sectoredNums)).toBe('3B');
  });
  it('sector sin raceDayId (volcado antes de crear jornada) → número pelado', () => {
    expect(resultStageEntryKey(3, null, suffixByDayId, sectoredNums)).toBe('3');
  });
});

describe('parseResultStageKey', () => {
  it('descompone claves', () => {
    expect(parseResultStageKey('final')).toEqual({ stageNumber: null, suffix: '' });
    expect(parseResultStageKey('3')).toEqual({ stageNumber: 3, suffix: '' });
    expect(parseResultStageKey('3A')).toEqual({ stageNumber: 3, suffix: 'A' });
    expect(parseResultStageKey('0')).toEqual({ stageNumber: 0, suffix: '' });
  });
});
