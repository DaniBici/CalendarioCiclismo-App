import { describe, expect, it } from 'vitest';
import { clampToTodaySeason, isWithinTodaySeason, todaySeasonLastDay } from '../services/today-season.js';

// Las fechas se derivan de la configuración vigente para no fallar al cambiar
// de temporada.
const years = Array.from({ length: 100 }, (_, index) => 2000 + index);
const configuredYear = years.find(year => todaySeasonLastDay(`${year}-01-01`));
const openYear = years.find(year => !todaySeasonLastDay(`${year}-01-01`));

describe('límite de temporada de Hoy', () => {
  it.skipIf(!configuredYear)('lleva al último día del año cualquier fecha posterior y la marca como no navegable', () => {
    const today = `${configuredYear}-01-02`;
    const lastDay = todaySeasonLastDay(today);
    expect(lastDay.startsWith(`${configuredYear}-`)).toBe(true);
    expect(todaySeasonLastDay(`${configuredYear}-12-31`)).toBe(lastDay);
    expect(clampToTodaySeason(`${configuredYear}-12-31`, today)).toBe(lastDay);
    expect(clampToTodaySeason(lastDay, today)).toBe(lastDay);
    expect(clampToTodaySeason(`${configuredYear}-01-03`, today)).toBe(`${configuredYear}-01-03`);
    expect(isWithinTodaySeason(lastDay, today)).toBe(true);
    expect(isWithinTodaySeason(`${configuredYear}-12-31`, today)).toBe(false);
  });

  it('no limita un año sin cierre configurado', () => {
    const today = `${openYear}-01-02`;
    expect(todaySeasonLastDay(today)).toBeNull();
    expect(clampToTodaySeason(`${openYear}-12-30`, today)).toBe(`${openYear}-12-30`);
    expect(isWithinTodaySeason(`${openYear}-12-30`, today)).toBe(true);
  });
});
