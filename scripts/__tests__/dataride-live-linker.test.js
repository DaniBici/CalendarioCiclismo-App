import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  dataRideDay,
  matchTodayRace,
  normalizeClass,
} from '../results-fetchers/dataride-live-linker.mjs';
import { shouldPollLiveLinks } from '../results-fetchers/results-vps-runner.mjs';

const race = {
  name: 'Ronde van de Achterhoek',
  nameEn: 'Tour of the Achterhoek',
  startDate: '2026-08-30',
  endDate: '2026-08-30',
  uciCategory: '1.2',
  gender: 'male',
  countryCode: 'nl',
};

const competition = {
  CompetitionId: 79999,
  CompetitionName: 'Ronde van de Achterhoek',
  ClassCode: '1.2',
  CountryIsoCode2: 'NL',
  StartDate: '2026-08-30',
  EndDate: '2026-08-30',
};

describe('enlace live con DataRide', () => {
  it('enlaza el equivalente actual de la Ronde por nombre, clase, país y fecha', () => {
    const result = matchTodayRace(race, [competition]);

    expect(result.status).toBe('unique');
    expect(result.candidate).toMatchObject({
      competitionId: 79999,
      classMatch: true,
      nameSim: 1,
    });
  });

  it('no enlaza una coincidencia basada solo en fecha, país y clase', () => {
    const result = matchTodayRace(race, [{
      ...competition,
      CompetitionId: 80000,
      CompetitionName: 'Other Dutch Race',
    }]);

    expect(result.status).toBe('ambiguous');
  });

  it('rechaza juniors aunque compartan los demás metadatos', () => {
    const result = matchTodayRace(race, [{
      ...competition,
      CompetitionId: 80001,
      CompetitionName: 'Ronde van de Achterhoek Junior',
    }]);

    expect(result.status).toBe('none');
  });

  it('normaliza fechas DataRide serializadas y categorías', () => {
    const millis = Date.UTC(2026, 7, 30);
    expect(dataRideDay(`/Date(${millis})/`)).toBe(millis);
    expect(normalizeClass(' 1.2 ')).toBe('1.2');
  });
});

describe('cadencia del sondeo live en el VPS', () => {
  it('sondea cada cinco minutos sin convertir el timer en una descarga universal', () => {
    expect(shouldPollLiveLinks(new Date('2026-08-30T12:10:00Z'))).toBe(true);
    expect(shouldPollLiveLinks(new Date('2026-08-30T12:11:00Z'))).toBe(false);
  });

  it('rechaza intervalos inválidos', () => {
    expect(shouldPollLiveLinks(new Date('2026-08-30T12:10:00Z'), 0)).toBe(false);
  });
});

describe('activación de enlaces live', () => {
  it('procesa todas las jornadas enlazadas sin un override de apagado', () => {
    const source = readFileSync(
      new URL('../results-fetchers/dataride-live-linker.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('resultsAutoSyncEnabled !== false');
    expect(source).not.toContain('desactiva el volcado inmediato');
  });

  it('mantiene abierta doce horas la captación predeterminada', () => {
    const source = readFileSync(
      new URL('../results-fetchers/dataride-live-linker.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain("'live-today', -15, 720");
    expect(source).not.toContain("'live-today', -15, 180");
  });
});
