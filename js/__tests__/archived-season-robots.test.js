import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const shared = read('shared.js');
const body = shared.match(/export function isArchivedSeason\(year\) \{([\s\S]*?)\n\}/)[1];
const isArchivedSeason = new Function('year', body);

describe('noindex de las temporadas 2020-2025', () => {
  it('acota el archivo a las temporadas 2020-2025', () => {
    for (const year of [2020, 2023, 2025, '2024']) expect(isArchivedSeason(year)).toBe(true);
    for (const year of [2019, 2026, 2027, null, undefined, '']) expect(isArchivedSeason(year)).toBe(false);
  });

  it('coincide con el generador de páginas estáticas', () => {
    const python = readFileSync(new URL('../../tools/site/archived_seasons.py', import.meta.url), 'utf8');
    expect(python).toContain('ARCHIVED_SEASONS = range(2020, 2026)');
    expect(shared).toContain("isArchivedSeason(race?.year) ? 'noindex, follow' : ROBOTS_INDEX");
  });

  it.each(['competicion.js', 'jornada.js', 'inscritos.js', 'orden-salida.js',
    'perfil-pub.js', 'mapa-pub.js', 'resultados.js'])('%s aplica el robots de la carrera', (name) => {
    expect(read(name)).toContain('setRaceRobots(race);');
  });
});
