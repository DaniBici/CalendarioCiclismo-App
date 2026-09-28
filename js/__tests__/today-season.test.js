import { describe, expect, it } from 'vitest';
import { clampToTodaySeason, isWithinTodaySeason, todaySeasonLastDay } from '../services/today-season.js';

describe('límite de temporada de Hoy', () => {
  it('fija el 18 de octubre como último día de 2026', () => {
    expect(todaySeasonLastDay('2026-09-27')).toBe('2026-10-18');
    expect(todaySeasonLastDay('2026-12-31')).toBe('2026-10-18');
  });

  it('lleva al último día cualquier fecha posterior del mismo año', () => {
    expect(clampToTodaySeason('2026-10-19', '2026-09-27')).toBe('2026-10-18');
    expect(clampToTodaySeason('2026-11-02', '2026-11-02')).toBe('2026-10-18');
    expect(clampToTodaySeason('2026-10-18', '2026-10-19')).toBe('2026-10-18');
    expect(clampToTodaySeason('2026-10-09', '2026-10-19')).toBe('2026-10-09');
  });

  it('no limita un año sin cierre configurado', () => {
    expect(todaySeasonLastDay('2027-01-02')).toBeNull();
    expect(clampToTodaySeason('2027-10-30', '2027-01-02')).toBe('2027-10-30');
    expect(isWithinTodaySeason('2027-10-30', '2027-01-02')).toBe(true);
  });

  it('marca como no navegables los días tras el cierre', () => {
    expect(isWithinTodaySeason('2026-10-18', '2026-10-01')).toBe(true);
    expect(isWithinTodaySeason('2026-10-19', '2026-10-01')).toBe(false);
  });
});
