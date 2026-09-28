import { describe, expect, it } from 'vitest';
import { mergeRaces, missingRaceIds, monthDateRange } from '../services/month-data.js';

describe('datos mensuales del calendario', () => {
  it('calcula el intervalo exacto de un mes bisiesto', () => {
    expect(monthDateRange(2028, 1)).toEqual({
      monthKey: '2028-02',
      startKey: '2028-02-01',
      endKey: '2028-02-29',
      lastDay: 29,
    });
  });

  it('solicita por ID los padres ausentes de las jornadas del mes', () => {
    const days = [
      { id: 'd1', raceId: 'tour' },
      { id: 'd2', raceId: 'tour' },
      { id: 'd3', raceId: 'renewi' },
      { id: 'd4', raceId: null },
    ];
    expect(missingRaceIds(days, [{ id: 'tour' }])).toEqual(['renewi']);
  });

  it('fusiona las carreras recuperadas sin duplicar IDs', () => {
    expect(mergeRaces(
      [{ id: 'tour', name: 'Tour' }],
      [{ id: 'tour', name: 'Tour de Francia' }, { id: 'renewi', name: 'Renewi Tour' }],
    )).toEqual([
      { id: 'tour', name: 'Tour de Francia' },
      { id: 'renewi', name: 'Renewi Tour' },
    ]);
  });
});
