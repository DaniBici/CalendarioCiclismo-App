import { describe, expect, it } from 'vitest';
import { cyclocrossHome, seasonCalendarYear } from '../services/today-season.js';

// Las fechas se derivan de la configuración vigente para no fallar al cambiar
// de temporada.
const years = Array.from({ length: 100 }, (_, index) => 2000 + index);
const configuredYear = years.find(year => cyclocrossHome(`${year}-12-31`));
const openYear = years.find(year => !cyclocrossHome(`${year}-12-31`));

describe('home de Ciclocross tras el cierre de la temporada de carretera', () => {
  it.skipIf(!configuredYear)('cede la home desde el día siguiente al cierre hasta el 31 de diciembre', () => {
    const days = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(configuredYear, 0, 1 + index)).toISOString().slice(0, 10))
      .filter(day => day.startsWith(`${configuredYear}-`));
    const first = days.find(cyclocrossHome);
    expect(first > `${configuredYear}-01-01`).toBe(true);
    expect(days.filter(day => day >= first).every(cyclocrossHome)).toBe(true);
    expect(days.filter(day => day < first).some(cyclocrossHome)).toBe(false);
    expect(cyclocrossHome(`${configuredYear + 1}-01-01`)).toBe(false);
  });

  it.skipIf(!configuredYear)('abre Temporada en el año siguiente mientras la home es Ciclocross', () => {
    expect(seasonCalendarYear(`${configuredYear}-01-02`)).toBe(configuredYear);
    expect(seasonCalendarYear(`${configuredYear}-12-31`)).toBe(configuredYear + 1);
  });

  it('no cede la home en un año sin cierre configurado', () => {
    expect(cyclocrossHome(`${openYear}-12-31`)).toBe(false);
  });
});
