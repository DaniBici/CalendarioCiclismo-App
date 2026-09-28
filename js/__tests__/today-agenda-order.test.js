import { describe, expect, it } from 'vitest';
import { sortAgenda } from '../services/today-agenda-order.js';
import { categoryRank } from '../services/race-order.js';

const day = (name, uciCategory, extra = {}) => ({
  _race: { name, uciCategory, gender: 'male', countryCode: 'FR', ...extra.race },
  elevationProfile: extra.profile ? { points: [[0, 0], [1, 1]], distance: 100 } : null,
  neutralStartTimeUtc: extra.start || null,
  ...extra.day,
});
const names = items => items.map(item => item._race.name);

describe('orden de la agenda de Hoy', () => {
  // Domingo 11-10-2026: la París-Tours no debe quedar detrás de una 2.1 por
  // tener esta miniperfil.
  const parisTours = [
    day('Tour de Kyushu', '2.1', { profile: true, start: '2026-10-11T01:00:00Z', race: { countryCode: 'JP' } }),
    day('Tour de la Isla de Chongming', '2.WWT', { race: { gender: 'female', countryCode: 'CN' } }),
    day('París-Tours', '1.Pro'),
    day('Hong Kong Cyclothon', '1.1', { start: '2026-10-11T01:45:00Z', race: { countryCode: 'HK' } }),
    day('Vuelta a Venezuela', '2.2', { race: { countryCode: 'VE' } }),
    day('París-Tours sub23', '1.2U'),
    { _placeholder: true, _race: { name: 'Campeonato del Caribe', uciCategory: '1.2', gender: 'male' } },
  ];

  it('ordena por categoría sin dar prioridad al miniperfil', () => {
    expect(names(sortAgenda(parisTours))).toEqual([
      'Tour de la Isla de Chongming', 'París-Tours', 'Tour de Kyushu', 'Hong Kong Cyclothon',
      'Vuelta a Venezuela', 'París-Tours sub23', 'Campeonato del Caribe',
    ]);
  });

  it('antepone las destacadas solo en el orden por categoría', () => {
    const items = parisTours.map(item => item._race.name === 'París-Tours' ? { ...item, _featured: true } : item);
    expect(names(sortAgenda(items))[0]).toBe('París-Tours');
    expect(names(sortAgenda(items, 'finishtime'))[0]).toBe('Tour de la Isla de Chongming');
  });

  it('mantiene al final una destacada cancelada', () => {
    const items = [day('Cancelada', '1.UWT', { race: { isCancelled: true }, day: { _featured: true } }), day('Normal', '1.2')];
    expect(names(sortAgenda(items))).toEqual(['Normal', 'Cancelada']);
  });

  it('ordena por hora de TV y desempata por categoría', () => {
    const items = [
      day('Sin TV', '1.UWT'),
      day('TV tarde', '1.2', { day: { _broadcasts: [{ startTimeUtc: '2026-10-11T14:00:00Z' }] } }),
      day('TV pronto', '1.1', { day: { _broadcasts: [{ startTimeUtc: '2026-10-11T12:00:00Z' }] } }),
    ];
    expect(names(sortAgenda(items, 'tvtime'))).toEqual(['TV pronto', 'TV tarde', 'Sin TV']);
  });
});

describe('tabla única de categoría', () => {
  it('aplica las excepciones de grandes vueltas, Porvenir, Asia y continentales', () => {
    expect(categoryRank('2.UWT', 'Tour de Francia')).toBe(0.2);
    expect(categoryRank('2.2U', 'Tour del Porvenir')).toBe(8.5);
    expect(categoryRank('2.1', 'Tour of Azerbaijan', 'AZ')).toBe(10.5);
    expect(categoryRank('1.1', 'Japan Cup', 'JP')).toBe(9);
    expect(categoryRank('CC', 'Campeonato Panamericano')).toBe(14.5);
    expect(categoryRank('CC', 'Campeonato de Europa')).toBe(2);
  });
});
