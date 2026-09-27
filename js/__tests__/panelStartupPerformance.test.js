import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(fileURLToPath(new URL('../panel.js', import.meta.url)), 'utf8');

describe('carga inicial del catálogo de carreras en el panel', () => {
  it('limita el arranque a la temporada de la agenda y usa una sola página amplia', () => {
    expect(panelSource).toContain('await ensureRaceYearLoaded(raceYearFromDateKey())');
    expect(panelSource).toContain(".eq('year', normalizedYear)");
    expect(panelSource).toContain(".order('id'), 2000");
  });

  it('carga otras temporadas al navegar sin recuperar todo el histórico al iniciar', () => {
    expect(panelSource).toContain('ensureRaceYearLoaded(raceYearFromDateKey(dateKey))');
    expect(panelSource).toContain('await ensureRaceYearLoaded(_racesYear)');
    expect(panelSource).toContain('async function ensureAllRacesLoaded()');

    const loadRaces = panelSource.slice(
      panelSource.indexOf('async function loadRaces()'),
      panelSource.indexOf('// Actualiza allRaces en memoria'),
    );
    expect(loadRaces).not.toContain(".from('races')");
    expect(loadRaces).not.toContain('ensureAllRacesLoaded');
  });

  it('conserva los accesos directos a jornadas e inscritos históricos', () => {
    expect(panelSource).toContain('await ensureRaceYearLoaded(raceYearFromDateKey(currentDateKey))');
    expect(panelSource).toContain('await ensureRaceLoadedById(_startlist)');
  });
});
