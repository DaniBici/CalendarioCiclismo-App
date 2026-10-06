import { describe, it, expect } from 'vitest';
import { isChampTodayFilterActive, isChampWeekFilterLock,
         champWeekHoyDefault, championshipMatchesCategoryFilter,
         CAMP, compareChampionships,
         championshipCountryIndex,
         isU23Championship, isFemaleChampionship } from '../campeonatos-config.js';

// Las fechas se expresan respecto a CAMP para que las pruebas sigan válidas
// al actualizar la configuración de la temporada.
const shiftDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ── Filtro "Hoy" de la rejilla de campeonatos ──────────────────────

describe('isChampTodayFilterActive', () => {
  it('activo de TODAY_FILTER_START a RANGE_END, ambos inclusive', () => {
    expect(isChampTodayFilterActive(CAMP.TODAY_FILTER_START)).toBe(true);
    expect(isChampTodayFilterActive(CAMP.RANGE_END)).toBe(true);
  });

  it('inactivo en los primeros días de la semana y después de RANGE_END', () => {
    expect(CAMP.RANGE_START < CAMP.TODAY_FILTER_START).toBe(true);
    expect(isChampTodayFilterActive(CAMP.RANGE_START)).toBe(false);
    expect(isChampTodayFilterActive(shiftDays(CAMP.TODAY_FILTER_START, -1))).toBe(false);
    expect(isChampTodayFilterActive(shiftDays(CAMP.RANGE_END, 1))).toBe(false);
  });
});

// ── Bloqueo de filtros de la vista "Hoy" en la semana de campeonatos ──

describe('isChampWeekFilterLock (semana completa)', () => {
  it('activo de RANGE_START a RANGE_END, ambos inclusive', () => {
    expect(isChampWeekFilterLock(CAMP.RANGE_START)).toBe(true);
    expect(isChampWeekFilterLock(CAMP.RANGE_END)).toBe(true);
  });

  it('inactivo fuera de la semana', () => {
    expect(isChampWeekFilterLock(shiftDays(CAMP.RANGE_START, -1))).toBe(false);
    expect(isChampWeekFilterLock(shiftDays(CAMP.RANGE_END, 1))).toBe(false);
  });

  it('el default es Masculino salvo los dos últimos días, que es Todas', () => {
    const lastTwo = CAMP.DATES.slice(-2);
    for (const dateKey of CAMP.DATES) {
      expect(champWeekHoyDefault(dateKey)).toBe(lastTwo.includes(dateKey) ? 'all' : 'male');
    }
  });
});

// ── Orden interno de la categoría CN en Hoy/Mes ─────────────────────

const cn = (name, gender, cc, primaryType = null) =>
  ({ race: { name, gender, countryCode: cc, uciCategory: 'CN' }, rd: { primaryType } });

describe('compareChampionships', () => {
  it('null cuando alguna no es CN (no aplica el orden)', () => {
    const a = cn('Campeonato de España Línea', 'male', 'ES');
    const b = { race: { name: 'Tour', uciCategory: '2.UWT', countryCode: 'FR' }, rd: {} };
    expect(compareChampionships(a.race, a.rd, b.race, b.rd)).toBeNull();
  });

  it('ordena por país, toda la línea antes que la CRI y élite masc < élite fem < sub23 masc < sub23 fem', () => {
    const items = [
      cn('Campionato Italiano Linea Élite', 'male', 'IT'),
      cn('Campeonato de España CRI Élite Masculino', 'male', 'ES', 'itt'),
      cn('Championnat de France Ligne Élite Homme', 'male', 'FR'),
      cn('Campeonato de España Línea sub-23 Femenino', 'female', 'ES'),
      cn('Campeonato de España Línea Élite Femenino', 'female', 'ES'),
      cn('Campeonato de España Línea sub-23 Masculino', 'male', 'ES'),
      cn('Campeonato de España Línea Élite Masculino', 'male', 'ES'),
    ];
    items.sort((a, b) => compareChampionships(a.race, a.rd, b.race, b.rd) ?? 0);
    expect(items.map(i => i.race.name)).toEqual([
      'Campeonato de España Línea Élite Masculino',
      'Campeonato de España Línea Élite Femenino',
      'Campeonato de España Línea sub-23 Masculino',
      'Campeonato de España Línea sub-23 Femenino',
      'Campeonato de España CRI Élite Masculino',
      'Championnat de France Ligne Élite Homme',
      'Campionato Italiano Linea Élite',
    ]);
  });
});

describe('championshipCountryIndex', () => {
  it('países ausentes van al final', () => {
    expect(championshipCountryIndex('ES')).toBe(0);
    expect(championshipCountryIndex('ZZ')).toBe(CAMP.COUNTRY_ORDER.length);
    expect(championshipCountryIndex(null)).toBe(CAMP.COUNTRY_ORDER.length);
  });
});

// ── Clasificación de CN para filtros Pro/Masc/Fem ───────────────────

const cnRace = (name, gender = null) => ({ uciCategory: 'CN', name, gender });

describe('isU23Championship', () => {
  it('detecta sub23 / U23 en el nombre, solo en CN', () => {
    expect(isU23Championship(cnRace('Campeonato de España Línea sub-23 Masculino'))).toBe(true);
    expect(isU23Championship(cnRace('Campeonato de España CRI U23 Femenino'))).toBe(true);
    expect(isU23Championship(cnRace('Campeonato de España Línea Élite Masculino'))).toBe(false);
    expect(isU23Championship({ uciCategory: '2.2U', name: 'Tour sub-23' })).toBe(false);
  });
});

describe('isFemaleChampionship', () => {
  it('femenino por nombre o por gender cuando el nombre no dice masculino', () => {
    expect(isFemaleChampionship(cnRace('Campeonato de España Línea Femenino'))).toBe(true);
    expect(isFemaleChampionship(cnRace('Championnat de France', 'female'))).toBe(true);
  });
  it('masculino por nombre aunque gender sea female, y por defecto', () => {
    expect(isFemaleChampionship(cnRace('Campeonato Masculino', 'female'))).toBe(false);
    expect(isFemaleChampionship(cnRace('Campeonato de España Élite', 'male'))).toBe(false);
  });
});

describe('championshipMatchesCategoryFilter', () => {
  it('élite en Pro y en su género; sub23 y WT/WWT fuera', () => {
    const passes = (race) => ['pro', 'male', 'female', 'uwt', 'wwt']
      .filter(cat => championshipMatchesCategoryFilter(race, cat));
    expect(passes(cnRace('Campeonato de España Línea Élite Masculino', 'male'))).toEqual(['pro', 'male']);
    expect(passes(cnRace('Campeonato de España Línea Élite Femenino', 'female'))).toEqual(['pro', 'female']);
    expect(passes(cnRace('Campeonato de España Línea sub-23 Masculino', 'male'))).toEqual([]);
  });
});
