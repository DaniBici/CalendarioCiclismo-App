import { describe, expect, it } from 'vitest';
import { matchCxCompetition, nameSignal, parseDataRideEpoch } from '../../scripts/results-fetchers/cx-live-linker.mjs';

const NOW = new Date('2026-10-17T12:00:00Z');

function race(over = {}) {
  return { id: 'r1', name: 'Copa del Mundo de Cyclocross', nameEn: null, abbrev: null, class: 'CDM',
    countryCode: 'FR', seasonKey: '2026-27', dateKey: '2026-10-17', endDateKey: null, ...over };
}
function competition(over = {}) {
  return { CompetitionId: 900, StartDate: '/Date(1792224000000)/', EndDate: '/Date(1792224000000)/',
    CompetitionName: 'Coupe du Monde de Cyclocross', CountryIsoCode2: 'FR', ClassCode: 'CDM', ...over };
}

describe('parseDataRideEpoch', () => {
  it('interpreta fechas ASP.NET con o sin zona', () => {
    expect(parseDataRideEpoch('/Date(1792288800000)/')).toBe(1792288800000);
    expect(parseDataRideEpoch('/Date(1792288800000+0100)/')).toBe(1792288800000);
    expect(Number.isNaN(parseDataRideEpoch('17 Oct 2026'))).toBe(true);
  });
});

describe('matchCxCompetition', () => {
  it('enlaza por país, clase fuerte y fecha solapada', () => {
    const result = matchCxCompetition(race(), [competition()], { now: NOW });
    expect(result.status).toBe('match');
    expect(result.competition.CompetitionId).toBe(900);
  });
  it('rechaza otro país o otra clase UCI', () => {
    expect(matchCxCompetition(race(), [competition({ CountryIsoCode2: 'BE' })], { now: NOW }).status).toBe('none');
    expect(matchCxCompetition(race(), [competition({ ClassCode: 'C1' })], { now: NOW }).status).toBe('none');
  });
  it('exige señal nominal en clases C y la acepta sin acentos', () => {
    const lower = race({ name: 'Cross Internacional Elorrio', nameEn: null, class: 'C2', countryCode: 'ES' });
    expect(matchCxCompetition(lower, [competition({ CompetitionName: 'Gaztapiko Txirrindulari Liga', ClassCode: 'C2', CountryIsoCode2: 'ES' })], { now: NOW }).status).toBe('none');
    const elorrio = race({ name: 'Elórrío', class: 'C2', countryCode: 'ES' });
    expect(matchCxCompetition(elorrio, [competition({ CompetitionName: 'Elorrio', ClassCode: 'C2', CountryIsoCode2: 'ES' })], { now: NOW }).status).toBe('match');
  });
  it('no considera señal las coincidencias de paradas', () => {
    const weak = race({ name: 'Campeonato Nacional', class: 'C1', countryCode: 'ES' });
    const result = matchCxCompetition(weak, [competition({ CompetitionName: 'National Cyclo-cross Championships', ClassCode: 'C1', CountryIsoCode2: 'ES' })], { now: NOW });
    expect(result.status).toBe('none');
  });
  it('marca ambigüedad con dos candidatos válidos', () => {
    const result = matchCxCompetition(race({ class: 'C2', name: 'Nommay', nameEn: 'Nommay' }),
      [competition({ CompetitionId: 901, CompetitionName: 'Nommay', ClassCode: 'C2' }),
        competition({ CompetitionId: 902, CompetitionName: 'Nommay Cross', ClassCode: 'C2' })], { now: NOW });
    expect(result.status).toBe('ambiguous');
  });
  it('limita la ventana al día con margen de un día', () => {
    expect(matchCxCompetition(race({ dateKey: '2026-10-19' }), [competition()], { now: NOW }).status).toBe('none');
    expect(matchCxCompetition(race({ dateKey: '2026-10-18' }), [competition()], { now: NOW }).status).toBe('match');
  });
  it('descarta competiciones con fecha no parseable', () => {
    expect(matchCxCompetition(race(), [competition({ StartDate: 'invalid', EndDate: null })], { now: NOW }).status).toBe('none');
  });
});

describe('nameSignal', () => {
  it('ignora stopwords y compara tokens significativos', () => {
    expect(nameSignal({ name: 'Cyclocross internacional de Namur' }, 'GP Osteffe')).toBe(false);
    expect(nameSignal({ name: 'Cyclocross internacional de Namur' }, 'Citadelcross Namur')).toBe(true);
    expect(nameSignal({ name: 'Dun & Brad Street' }, 'D&B')).toBe(false);
  });
});
