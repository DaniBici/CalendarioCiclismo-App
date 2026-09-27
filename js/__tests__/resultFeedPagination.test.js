import { describe, expect, it } from 'vitest';
import {
  initialResultsFromKey,
  previousResultsWindow,
} from '../services/result-feed-pagination.js';

describe('paginación de Últimos Resultados', () => {
  it('mantiene catorce días en la carga inicial', () => {
    expect(initialResultsFromKey('2026-09-05')).toBe('2026-08-23');
  });

  it('solicita solo los tres días inmediatamente anteriores', () => {
    expect(previousResultsWindow('2026-08-23')).toEqual({
      fromKey: '2026-08-20',
      toKey: '2026-08-22',
    });
  });

  it('respeta el inicio de temporada', () => {
    expect(previousResultsWindow('2026-01-03')).toEqual({
      fromKey: '2026-01-01',
      toKey: '2026-01-02',
    });
    expect(previousResultsWindow('2026-01-01')).toBeNull();
  });
});
