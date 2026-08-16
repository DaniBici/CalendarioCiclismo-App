import { describe, expect, it } from 'vitest';
import { eventEndpoint, parseCode, resultEndpoint, rowsFromResult, stageNumberFor, suggestCompetitionId } from '../../scripts/results-fetchers/eqtiming-results-fetch.mjs';

describe('EQ Timing — API pública', () => {
  it('valida el id estable y construye endpoints', () => {
    expect(parseCode('83198')).toBe('83198');
    expect(() => parseCode('arctic-2026')).toThrow('eventId numérico');
    expect(eventEndpoint('83198')).toBe('https://live.eqtiming.com/api/Event/83198');
    expect(resultEndpoint('83198', 338349)).toContain('/Result/Total/83198/338349?count=999&station=0');
    expect(suggestCompetitionId('83198')).toBeLessThan(0);
  });
  it('normaliza filas JSON, tiempos y abandonos', () => {
    const [winner, second, dnf] = rowsFromResult({ Items: [
      { Plassering: { Total: 1 }, Tid: { Formatert: '03:15:00', StatusTekst: 'TIME' }, Deltaker: { Startnummer: '11', Utover: { NavnFormatert: 'KOWALSKI Jan', Land: { ISO3: 'POL' } }, Klubb: { Navn: 'Equipo Uno' } } },
      { Plassering: { Total: 2 }, Tid: { Formatert: '03:15:04', StatusTekst: 'TIME' }, Diff: { TotalFormatert: '+ 00:04' }, Deltaker: { Startnummer: '12', Utover: { NavnFormatert: 'NOWAK Piotr' } } },
      { StatusTekst: 'DNF', Deltaker: { Startnummer: '13', Utover: { NavnFormatert: 'WIŚNIEWSKI Adam' } } },
    ] });
    expect(winner).toMatchObject({ rank: 1, bib: '11', timeText: '3:15:00', nationality: 'POL', teamName: 'Equipo Uno' });
    expect(second).toMatchObject({ rank: 2, timeText: '3:15:04', gapText: '+0:04' });
    expect(dnf).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', bib: '13' });
  });
  it('conserva el número publicado de etapa y tiene fallback por orden', () => { expect(stageNumberFor({ Nummer: 3 }, 0)).toBe(3); expect(stageNumberFor({ Nummer: 0 }, 2)).toBe(3); });
});
