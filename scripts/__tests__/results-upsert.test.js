import { describe, it, expect } from 'vitest';
import {
  compactResultRowsSql,
  hasPublishableResults,
  shouldPublishFinalClassification,
} from '../results-fetchers/results-upsert.mjs';

describe('shouldPublishFinalClassification — carreras de un día en DataRide', () => {
  it('acepta una Final Classification única cuando no hay etapa no-final en el payload', () => {
    expect(shouldPublishFinalClassification(false, false)).toBe(true);
  });
});

describe('hasPublishableResults — guardia de retirada de carreras inválidas', () => {
  it('rechaza una respuesta DNS-only de DataRide', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'gc',
          scope: 'stage',
          rows: [{ rank: null, rankText: 'DNS', irm: 'DNS' }],
        }],
      }],
    })).toBe(false);
  });

  it('conserva una carrera cuyo payload sí contiene una llegada válida', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'stage',
          scope: 'stage',
          rows: [{ rank: 1, bib: '7', irm: null }],
        }],
      }],
    })).toBe(true);
  });
});

describe('compactResultRowsSql', () => {
  const fila = (i) => ({
    resultRow: true,
    params: ['ru_-1', 'R1', -1, i + 1, String(i + 1), String(10 + i), null, null,
      i ? '+05' : '1:00:00', i ? null : '1:00:00', i ? '+05' : null, null, null, i,
      null, null, null, null],
  });

  it('rechaza filas de clasificaciones distintas', () => {
    const otra = fila(1);
    otra.params[0] = 'ru_-2';
    expect(() => compactResultRowsSql([fila(0), otra])).toThrow('una sola clasificación');
  });
});
