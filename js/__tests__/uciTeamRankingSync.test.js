import { describe, expect, it } from 'vitest';
import { snapshotIsCurrent } from '../../scripts/results-fetchers/uci-team-ranking-sync.mjs';

describe('snapshotIsCurrent', () => {
  const rows = [
    { gender: 'male', rankingDate: '2026-08-25' },
    { gender: 'female', rankingDate: '2026-08-25' },
  ];

  it('evita reescribir cuando ambos rankings ya tienen la fecha publicada', () => {
    expect(snapshotIsCurrent(rows, new Map([
      ['male', '2026-08-25'],
      ['female', '2026-08-25'],
    ]))).toBe(true);
  });

  it('actualiza si uno de los dos rankings cambió', () => {
    expect(snapshotIsCurrent(rows, new Map([
      ['male', '2026-08-25'],
      ['female', '2026-08-18'],
    ]))).toBe(false);
  });
});

