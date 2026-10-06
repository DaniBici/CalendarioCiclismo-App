import { describe, expect, it } from 'vitest';
import {
  operationSourceCatalog,
  operationRunStatus,
  selectOperationHistory,
} from '../services/operations-monitor.js';

describe('lógica del monitor de operaciones', () => {
  it('marca como caducadas las automatizaciones frecuentes', () => {
    const now = Date.parse('2026-09-09T06:00:00Z');
    expect(operationRunStatus('results', { status: 'success', startedAt: '2026-09-09T05:56:00Z' }, null, now)).toBe('stale');
    expect(operationRunStatus('broadcasts', { status: 'success', startedAt: '2026-09-09T05:30:00Z' }, null, now)).toBe('success');
    expect(operationRunStatus('results', { status: 'running', startedAt: '2026-09-09T05:00:00Z' }, null, now)).toBe('stale');
    expect(operationRunStatus('cx_results', { status: 'noop', startedAt: '2026-09-09T05:56:00Z' }, null, now)).toBe('stale');
  });

  it('conserva representación de todos los trabajos en el historial', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, id) => ({ id, job: 'results' })),
      { id: 10, job: 'broadcasts' },
      { id: 11, job: 'uci_team_ranking' },
      { id: 12, job: 'uci_catalog' },
    ];
    expect(selectOperationHistory(runs).map((run) => run.job)).toEqual([
      'results', 'results', 'results', 'broadcasts', 'uci_team_ranking', 'uci_catalog',
    ]);
  });

  it('añade fuentes nuevas que ya aparecen en los datos del monitor', () => {
    expect(operationSourceCatalog(
      [{ id: 'rtve', label: 'RTVE' }],
      [{ source: 'rtve' }, { source: 'rai' }, { source: 'new_source' }],
    )).toEqual([
      { id: 'rtve', label: 'RTVE' },
      { id: 'rai', label: 'Rai' },
      { id: 'new_source', label: 'New Source' },
    ]);
  });
});
