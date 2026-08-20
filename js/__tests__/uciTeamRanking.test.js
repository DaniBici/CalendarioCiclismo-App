import { describe, expect, it } from 'vitest';
import {
  decorateUciRanking,
  formatUciRankingUpdated,
  UciRankingTier,
  uciRankingRuleText,
} from '../uci-team-ranking.js';

function row(rank, teamCategory, gender = 'male') {
  return {
    rank,
    teamCategory,
    gender,
    displayName: `Team ${rank}`,
    rankingDate: '2026-07-28',
  };
}

describe('decorateUciRanking', () => {
  it('presenta la actualización con el mismo patrón en castellano e inglés', () => {
    expect(formatUciRankingUpdated('2026-07-28'))
      .toBe('Actualizado: martes, 28 de julio de 2026');
    expect(formatUciRankingUpdated('2026-07-28', true))
      .toBe('Updated: Tuesday, 28 July 2026');
  });

  it('cuenta ProTeams, no posiciones absolutas, para las invitaciones masculinas', () => {
    const rows = [
      row(1, 'WT'),
      row(8, 'PT'),
      row(9, 'WT'),
      row(15, 'PT'),
      row(18, 'PT'),
      row(21, 'PT'),
      row(22, 'PT'),
      row(23, 'CT'),
    ];
    const decorated = decorateUciRanking(rows, 'male');
    const pt = decorated.filter((item) => item.teamCategory === 'PT');

    expect(pt.map((item) => item.invitationTier)).toEqual([
      UciRankingTier.ALL_WORLD_TOUR,
      UciRankingTier.ALL_WORLD_TOUR,
      UciRankingTier.ALL_WORLD_TOUR,
      UciRankingTier.PRO_SERIES,
      UciRankingTier.PRO_SERIES,
    ]);
    expect(uciRankingRuleText(pt[0])).toContain('y a todas las pruebas UCI ProSeries');
  });

  it('marca únicamente a los ProTeam fuera del top-30', () => {
    const decorated = decorateUciRanking([
      row(30, 'PT'),
      row(31, 'PT'),
      row(40, 'CT'),
    ], 'male');

    expect(decorated.map((item) => item.grandTourExcluded)).toEqual([false, true, false]);
    expect(uciRankingRuleText(decorated[1])).toContain('Fuera del top-30');
    expect(uciRankingRuleText(decorated[1])).toContain('2027');
    expect(uciRankingRuleText(decorated[0])).toContain('2027');
  });

  it('aplica el top-2 a los Women’s ProTeams', () => {
    const decorated = decorateUciRanking([
      row(1, 'WWT', 'female'),
      row(12, 'PRW', 'female'),
      row(15, 'PRW', 'female'),
      row(16, 'PRW', 'female'),
    ], 'female');

    expect(decorated.map((item) => item.invitationTier)).toEqual([
      UciRankingTier.WORLD_TOUR,
      UciRankingTier.WOMENS_WORLD_TOUR,
      UciRankingTier.WOMENS_WORLD_TOUR,
      UciRankingTier.STANDARD,
    ]);
    expect(uciRankingRuleText(decorated[1])).not.toContain('ProSeries');
  });
});
