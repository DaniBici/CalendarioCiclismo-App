import { describe, it, expect } from 'vitest';
import { isChampTodayFilterActive, isChampWeekFilterLock,
         CHAMP_WEEK_HOY_FILTERS, champWeekHoyDefault,
         CAMP, compareChampionships,
         championshipCountryIndex, championshipSlotRank, isChampionshipRace,
         isU23Championship, isFemaleChampionship } from '../campeonatos-config.js';

// ── Filtro "Hoy" de la rejilla de campeonatos (rango 24–28 jun) ──────

describe('isChampTodayFilterActive', () => {
  it('activo dentro del rango (24–28 jun, ambos inclusive)', () => {
    expect(isChampTodayFilterActive('2026-06-24')).toBe(true);
    expect(isChampTodayFilterActive('2026-06-26')).toBe(true);
    expect(isChampTodayFilterActive('2026-06-28')).toBe(true);
  });

  it('inactivo en los dos primeros días de campeonatos (22, 23)', () => {
    expect(isChampTodayFilterActive('2026-06-22')).toBe(false);
    expect(isChampTodayFilterActive('2026-06-23')).toBe(false);
  });

  it('inactivo después del 28 de junio', () => {
    expect(isChampTodayFilterActive('2026-06-29')).toBe(false);
    expect(isChampTodayFilterActive('2026-07-01')).toBe(false);
  });

  it('el inicio del filtro es el 24 y el fin coincide con RANGE_END', () => {
    expect(CAMP.TODAY_FILTER_START).toBe('2026-06-24');
    expect(CAMP.RANGE_END).toBe('2026-06-28');
  });
});

// ── Bloqueo de filtros de la vista "Hoy" en la semana de campeonatos ──

describe('isChampWeekFilterLock (22–28 jun, ventana completa)', () => {
  it('activo en toda la semana, incluidos el 22 y el 23', () => {
    expect(isChampWeekFilterLock('2026-06-22')).toBe(true);
    expect(isChampWeekFilterLock('2026-06-23')).toBe(true);
    expect(isChampWeekFilterLock('2026-06-25')).toBe(true);
    expect(isChampWeekFilterLock('2026-06-28')).toBe(true);
  });

  it('inactivo fuera de la semana', () => {
    expect(isChampWeekFilterLock('2026-06-21')).toBe(false);
    expect(isChampWeekFilterLock('2026-06-29')).toBe(false);
    expect(isChampWeekFilterLock('2026-07-01')).toBe(false);
  });

  it('cubre los dos días que isChampTodayFilterActive deja fuera (22, 23)', () => {
    // La ventana de bloqueo arranca el 22; el filtro "Hoy" de la rejilla, el 24.
    expect(isChampWeekFilterLock('2026-06-22')).toBe(true);
    expect(isChampTodayFilterActive('2026-06-22')).toBe(false);
  });

  it('los filtros visibles son Todas/Pro/Masc/Fem', () => {
    expect(CHAMP_WEEK_HOY_FILTERS).toEqual(['all', 'pro', 'male', 'female']);
    expect(CHAMP_WEEK_HOY_FILTERS).not.toContain('uwt');
    expect(CHAMP_WEEK_HOY_FILTERS).not.toContain('wwt');
  });

  it('el default es Masculino salvo el 27 y 28 de junio, que es Todas', () => {
    expect(champWeekHoyDefault('2026-06-22')).toBe('male');
    expect(champWeekHoyDefault('2026-06-25')).toBe('male');
    expect(champWeekHoyDefault('2026-06-26')).toBe('male');
    expect(champWeekHoyDefault('2026-06-27')).toBe('all');
    expect(champWeekHoyDefault('2026-06-28')).toBe('all');
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

  it('ordena por país según COUNTRY_ORDER (ES < FR < IT)', () => {
    const es = cn('Campeonato de España Línea Élite Masc', 'male', 'ES');
    const fr = cn('Championnat de France Ligne Élite Homme', 'male', 'FR');
    expect(compareChampionships(es.race, es.rd, fr.race, fr.rd)).toBeLessThan(0);
    const it = cn('Campionato Italiano Linea Élite', 'male', 'IT');
    expect(compareChampionships(fr.race, fr.rd, it.race, it.rd)).toBeLessThan(0);
  });

  it('dentro de un país: TODA la línea antes que TODA la CRI', () => {
    const lineaFem = cn('Campeonato de España Línea Élite Femenino', 'female', 'ES');
    const criMasc  = cn('Campeonato de España CRI Élite Masculino', 'male', 'ES', 'itt');
    // línea fem va antes que cri masc aunque masc<fem en género
    expect(compareChampionships(lineaFem.race, lineaFem.rd, criMasc.race, criMasc.rd)).toBeLessThan(0);
  });

  it('dentro de un bloque (línea): elite masc < elite fem < sub23 masc < sub23 fem', () => {
    const a = cn('Campeonato de España Línea Élite Masculino', 'male', 'ES');
    const b = cn('Campeonato de España Línea Élite Femenino', 'female', 'ES');
    const c = cn('Campeonato de España Línea sub-23 Masculino', 'male', 'ES');
    const d = cn('Campeonato de España Línea sub-23 Femenino', 'female', 'ES');
    expect(compareChampionships(a.race, a.rd, b.race, b.rd)).toBeLessThan(0);
    expect(compareChampionships(b.race, b.rd, c.race, c.rd)).toBeLessThan(0);
    expect(compareChampionships(c.race, c.rd, d.race, d.rd)).toBeLessThan(0);
  });

  it('orden completo de un mix tras sort', () => {
    const items = [
      cn('Campeonato de España CRI Élite Masculino', 'male', 'ES', 'itt'),
      cn('Championnat de France Ligne Élite Homme', 'male', 'FR'),
      cn('Campeonato de España Línea Élite Femenino', 'female', 'ES'),
      cn('Campeonato de España Línea Élite Masculino', 'male', 'ES'),
    ];
    items.sort((a, b) => compareChampionships(a.race, a.rd, b.race, b.rd) ?? 0);
    expect(items.map(i => i.race.name)).toEqual([
      'Campeonato de España Línea Élite Masculino',
      'Campeonato de España Línea Élite Femenino',
      'Campeonato de España CRI Élite Masculino',
      'Championnat de France Ligne Élite Homme',
    ]);
  });
});

describe('championshipCountryIndex / slotRank', () => {
  it('países ausentes van al final', () => {
    expect(championshipCountryIndex('ES')).toBe(0);
    expect(championshipCountryIndex('ZZ')).toBe(CAMP.COUNTRY_ORDER.length);
    expect(championshipCountryIndex(null)).toBe(CAMP.COUNTRY_ORDER.length);
  });

  it('línea siempre rank menor que cri', () => {
    const lineaFem = championshipSlotRank({ name: 'Línea Élite Femenino', gender: 'female' }, {});
    const criMasc  = championshipSlotRank({ name: 'CRI Élite Masculino', gender: 'male' }, { primaryType: 'itt' });
    expect(lineaFem).toBeLessThan(criMasc);
  });

  it('isChampionshipRace por uciCategory', () => {
    expect(isChampionshipRace({ uciCategory: 'CN' })).toBe(true);
    expect(isChampionshipRace({ uciCategory: '2.UWT' })).toBe(false);
  });
});

// ── Clasificación de CN para filtros Pro/Masc/Fem ───────────────────

const cnRace = (name, gender = null) => ({ uciCategory: 'CN', name, gender });

describe('isU23Championship', () => {
  it('detecta sub23 / U23 en el nombre', () => {
    expect(isU23Championship(cnRace('Campeonato de España Línea sub-23 Masculino'))).toBe(true);
    expect(isU23Championship(cnRace('Campeonato de España CRI U23 Femenino'))).toBe(true);
  });
  it('élite no es sub23', () => {
    expect(isU23Championship(cnRace('Campeonato de España Línea Élite Masculino'))).toBe(false);
  });
  it('solo aplica a CN (no a otras categorías)', () => {
    expect(isU23Championship({ uciCategory: '2.2U', name: 'Tour sub-23' })).toBe(false);
  });
});

describe('isFemaleChampionship', () => {
  it('femenino por nombre', () => {
    expect(isFemaleChampionship(cnRace('Campeonato de España Línea Femenino'))).toBe(true);
  });
  it('femenino por gender cuando el nombre no dice masculino', () => {
    expect(isFemaleChampionship(cnRace('Championnat de France', 'female'))).toBe(true);
  });
  it('masculino por nombre aunque gender sea female (defensa)', () => {
    expect(isFemaleChampionship(cnRace('Campeonato Masculino', 'female'))).toBe(false);
  });
  it('masculino por defecto', () => {
    expect(isFemaleChampionship(cnRace('Campeonato de España Élite', 'male'))).toBe(false);
  });
});

// Réplica de la decisión de filtro Pro/Masc/Fem aplicada a CN en app.js,
// para fijar el contrato esperado (élite sí, sub23 no; género respetado).
function cnPassesFilter(race, cat) {
  if (isU23Championship(race)) return false;
  if (cat === 'pro')    return true;
  if (cat === 'male')   return !isFemaleChampionship(race);
  if (cat === 'female') return isFemaleChampionship(race);
  return false; // uwt/wwt
}

describe('CN en filtros Pro/Masc/Fem (contrato)', () => {
  const eliteM = cnRace('Campeonato de España Línea Élite Masculino', 'male');
  const eliteF = cnRace('Campeonato de España Línea Élite Femenino', 'female');
  const u23M   = cnRace('Campeonato de España Línea sub-23 Masculino', 'male');
  const u23F   = cnRace('Campeonato de España CRI sub-23 Femenino', 'female');

  it('Pro: élite masc y fem sí; sub23 no', () => {
    expect(cnPassesFilter(eliteM, 'pro')).toBe(true);
    expect(cnPassesFilter(eliteF, 'pro')).toBe(true);
    expect(cnPassesFilter(u23M, 'pro')).toBe(false);
    expect(cnPassesFilter(u23F, 'pro')).toBe(false);
  });

  it('Masc: solo élite masc', () => {
    expect(cnPassesFilter(eliteM, 'male')).toBe(true);
    expect(cnPassesFilter(eliteF, 'male')).toBe(false);
    expect(cnPassesFilter(u23M, 'male')).toBe(false);
  });

  it('Fem: solo élite fem', () => {
    expect(cnPassesFilter(eliteF, 'female')).toBe(true);
    expect(cnPassesFilter(eliteM, 'female')).toBe(false);
    expect(cnPassesFilter(u23F, 'female')).toBe(false);
  });

  it('uwt/wwt no aceptan CN', () => {
    expect(cnPassesFilter(eliteM, 'uwt')).toBe(false);
    expect(cnPassesFilter(eliteF, 'wwt')).toBe(false);
  });
});
