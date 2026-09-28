import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readPanel = file => readFileSync(fileURLToPath(new URL(`../panel/${file}`, import.meta.url)), 'utf8');
const agendaSource = readPanel('agenda.js');
const racesViewSource = readPanel('races-view.js');
const mainSource = readPanel('main.js');

describe('carga inicial del catálogo de carreras en el panel', () => {
  it('limita el arranque a la temporada de la agenda y usa una sola página amplia', () => {
    expect(agendaSource).toContain('await ensureRaceYearLoaded(raceYearFromDateKey())');
    expect(agendaSource).toContain(".eq('year', normalizedYear)");
    expect(agendaSource).toContain(".order('id'), 2000");
  });

  it('carga otras temporadas al navegar sin recuperar todo el histórico al iniciar', () => {
    expect(agendaSource).toContain('ensureRaceYearLoaded(raceYearFromDateKey(dateKey))');
    expect(racesViewSource).toContain('await ensureRaceYearLoaded(_racesYear)');
    expect(agendaSource).toContain('async function ensureAllRacesLoaded()');

    const loadRaces = agendaSource.slice(
      agendaSource.indexOf('async function loadRaces()'),
      agendaSource.indexOf('// Actualiza allRaces en memoria'),
    );
    expect(loadRaces).not.toContain(".from('races')");
    expect(loadRaces).not.toContain('ensureAllRacesLoaded');
  });

  it('conserva los accesos directos a jornadas e inscritos históricos', () => {
    expect(mainSource).toContain('await ensureRaceYearLoaded(raceYearFromDateKey(panelState.currentDateKey))');
    expect(mainSource).toContain('await ensureRaceLoadedById(_startlist)');
  });
});
