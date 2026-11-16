import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  competitionNameKey,
  dataRideCategoryCodes,
  dataRideDateKey,
  matchDataRideCompetition,
  resolveByCalendarId,
  usesCalendarIdLink,
} from '../results-fetchers/uci-directory-link.mjs';

// Registros reales del directorio de competiciones UCI y de DataRide (11-11-2026).
const { sources } = JSON.parse(readFileSync(new URL('./fixtures/uci-directory-dataride-2026.json', import.meta.url), 'utf8'));
const directoryItem = (v1Code) => sources.directory.find((item) => item.v1Code === v1Code);
const directory = new Map(sources.directory.map((item) => [Number(item.v1Code.slice(4)), item]));
const categoriesOf = async (competitionId) => dataRideCategoryCodes(sources.dataRideRaces[competitionId]);

describe('enlace por uciCalendarId con DataRide', () => {
  it('lee la medianoche local de DataRide como día civil', () => {
    expect(dataRideDateKey('/Date(1792188000000)/')).toBe('2026-10-17');
    expect(dataRideDateKey('17 Oct 2026')).toBeNull();
    expect(competitionNameKey('Veenendaal - Veenendaal')).toBe(competitionNameKey('Veenendaal-Veenendaal'));
    expect(competitionNameKey('Dalej na Połnoc')).toBe('dalejnapolnoc');
  });

  it('distingue los dos días de VeloCX por el nombre exacto', async () => {
    const day1 = await resolveByCalendarId({ uciCalendarId: 79107 }, { directory, competitions: sources.dataRideCx2027 });
    const day2 = await resolveByCalendarId({ uciCalendarId: 79118 }, { directory, competitions: sources.dataRideCx2027 });
    expect(day1).toMatchObject({ status: 'match', rule: 'name', competition: { CompetitionId: 78543 } });
    expect(day2).toMatchObject({ status: 'match', rule: 'name', competition: { CompetitionId: 78550 } });
  });

  it('no enlaza el Day 1 si DataRide solo lista el Day 2', async () => {
    const onlyDay2 = sources.dataRideCx2027.filter((competition) => competition.CompetitionId === 78550);
    const result = await resolveByCalendarId({ uciCalendarId: 79107 }, { directory, competitions: onlyDay2 });
    expect(result.status).toBe('none');
  });

  it('desempata las versiones de Chrono des Nations por categoría', async () => {
    const expected = { D2CP78473: 77869, D2CP78475: 77870, D2CP78476: 77871, D2CP78477: 77872, D2CP78474: 77539 };
    for (const [v1Code, competitionId] of Object.entries(expected)) {
      const result = await matchDataRideCompetition(directoryItem(v1Code), sources.dataRideRoad2026, { categoriesOf });
      expect(result.status, v1Code).toBe('match');
      expect(result.competition.CompetitionId, v1Code).toBe(competitionId);
    }
    const unresolved = await matchDataRideCompetition(directoryItem('D2CP78476'), sources.dataRideRoad2026);
    expect(unresolved.status).toBe('ambiguous');
  });

  it('acepta el país por nombre cuando los códigos difieren (SGP frente a SIN)', async () => {
    const singapore = sources.directory.find((item) => item.countryCode === 'SGP');
    const result = await matchDataRideCompetition(singapore, sources.dataRideRoad2026);
    expect(result).toMatchObject({ status: 'match', competition: { CountryIsoCode3: 'SIN' } });
  });

  it('rechaza una carrera de otro género que la competición del directorio', async () => {
    const result = await resolveByCalendarId({ uciCalendarId: 78476 }, { directory, competitions: sources.dataRideRoad2026, categoriesOf, gender: 'male' });
    expect(result).toMatchObject({ status: 'none', incoherent: true });
  });

  it('deja los campeonatos de carretera fuera de la vía determinista', () => {
    expect(usesCalendarIdLink({ uciCalendarId: 79742, uciCategory: 'WC' })).toBe(false);
    expect(usesCalendarIdLink({ uciCalendarId: 80001, uciCategory: 'CN' })).toBe(false);
    expect(usesCalendarIdLink({ uciCalendarId: 78473, uciCategory: '1.1' })).toBe(true);
    expect(usesCalendarIdLink({ uciCalendarId: null, uciCategory: '1.1' })).toBe(false);
  });
});
