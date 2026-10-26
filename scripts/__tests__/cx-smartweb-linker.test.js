import { describe, expect, it } from 'vitest';
import { planSmartwebLink } from '../results-fetchers/cx-smartweb-linker.mjs';

const race = (over = {}) => ({ id: 'r1', dateKey: '2026-10-25', endDateKey: null,
  websiteUrl: 'https://ciclismoasturiano.es/index.php/smartweb/inscripciones/prueba/35019-I-CICLOCROSS-CANGAS-DEL-NARCEA', ...over });

describe('planSmartwebLink', () => {
  it('enlaza el índice de la prueba con los rótulos de las categorías propias', () => {
    expect(planSmartwebLink(race(), ['ME', 'WE', 'MJ', 'WJ', 'MU'], null)).toEqual({ status: 'fetch',
      sourceUrl: 'https://ciclismoasturiano.es/index.php/smartweb/inscripciones/clasificacion/35019' });
    expect(planSmartwebLink(race(), ['ME', 'WE', 'MJ', 'WJ', 'MU'], { dateKey: '2026-10-25', options: [] })).toEqual({ status: 'link',
      sourceUrl: 'https://ciclismoasturiano.es/index.php/smartweb/inscripciones/clasificacion/35019',
      categoryKeys: { 'ELITE-SUB23': 'ME', 'FEM ELITE-SUB23': 'WE', JUNIOR: 'MJ', 'FEM JUNIOR': 'WJ', SUB23: 'MU' } });
  });
  it('omite webs ajenas a smartweb y pruebas de otra fecha', () => {
    expect(planSmartwebLink(race({ websiteUrl: 'https://www.ciclisme.cat/cursa/ciclocros/cx-manlleu' }), ['ME'], null).status).toBe('skip');
    expect(planSmartwebLink(race(), ['ME'], { dateKey: '2025-10-26', options: [] }).reason).toContain('2025-10-26');
    expect(planSmartwebLink(race(), ['ME'], { dateKey: null, options: [] }).status).toBe('skip');
  });
});
