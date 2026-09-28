import { describe, expect, it } from 'vitest';
import {
  irmDescription,
  irmLabel,
  isAbandonIrm,
  isNonWinnerIrm,
} from '../results/uci-irm.js';

describe('IRM DF y NR', () => {
  it.each([
    ['DF', 'Finalizó sin puesto definido', 'Did finish; rank not defined'],
    ['NR', 'Sin resultado', 'No result'],
  ])('%s conserva su código y tiene descripción localizada', (code, es, en) => {
    expect(irmLabel(code, 'es')).toBe(code);
    expect(irmLabel(code, 'en')).toBe(code);
    expect(irmDescription(code, 'es')).toBe(es);
    expect(irmDescription(code, 'en')).toBe(en);
  });

  it.each(['DF', 'NR'])('%s no es abandono pero tampoco determina ganador', (code) => {
    expect(isAbandonIrm(code)).toBe(false);
    expect(isNonWinnerIrm(code)).toBe(true);
  });
});
