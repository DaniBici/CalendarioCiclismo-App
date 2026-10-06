import { describe, expect, it } from 'vitest';
import { isAbandonIrm, isNonWinnerIrm } from '../results/uci-irm.js';

describe('IRM DF y NR', () => {
  it('no es abandono pero tampoco determina ganador', () => {
    expect(isAbandonIrm('DF')).toBe(false);
    expect(isNonWinnerIrm('DF')).toBe(true);
  });
});
