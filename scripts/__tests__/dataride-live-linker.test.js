import { describe, expect, it } from 'vitest';
import {
  dataRideDay,
  matchTodayRace,
  normalizeClass,
} from '../results-fetchers/dataride-live-linker.mjs';

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
    // Medianoche CEST del 30 de agosto = 22:00 UTC del 29.
    const cestMidnight = Date.UTC(2026, 7, 29, 22);
    expect(dataRideDay(`/Date(${cestMidnight})/`)).toBe(Date.UTC(2026, 7, 30));
    expect(normalizeClass(' 1.2 ')).toBe('1.2');
  });
});
