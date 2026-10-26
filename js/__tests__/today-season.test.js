import { describe, expect, it, vi } from 'vitest';
import { cyclocrossHome, cyclocrossLanding, seasonCalendarYear, setRoadPinned } from '../services/today-season.js';

// Las fechas se derivan de la configuración vigente para no fallar al cambiar
// de temporada.
const years = Array.from({ length: 100 }, (_, index) => 2000 + index);
const configuredYear = years.find(year => cyclocrossHome(`${year}-12-31`));

describe('home de Ciclocross tras el cierre de la temporada de carretera', () => {
  it.skipIf(!configuredYear)('abre Temporada en el año siguiente mientras la home es Ciclocross', () => {
    expect(seasonCalendarYear(`${configuredYear}-01-02`)).toBe(configuredYear);
    expect(seasonCalendarYear(`${configuredYear}-12-31`)).toBe(configuredYear + 1);
  });
});

describe('Carretera fijada con la chincheta', () => {
  it.skipIf(!configuredYear)('devuelve `/` a Hoy de carretera y quitarla lo devuelve a Ciclocross', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    });
    try {
      const day = `${configuredYear}-12-31`;
      expect(cyclocrossLanding(day)).toBe(true);
      setRoadPinned(true);
      expect(cyclocrossLanding(day)).toBe(false);
      expect(cyclocrossLanding(`${configuredYear}-01-02`)).toBe(false);
      setRoadPinned(false);
      expect(cyclocrossLanding(day)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
