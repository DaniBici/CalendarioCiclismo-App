import { describe, expect, it } from 'vitest';
import { argsForManualRequest } from '../../scripts/results-fetchers/uci-results-vps-runner.mjs';

describe('argsForManualRequest', () => {
  it('fuerza todo lo de hoy para la acción global', () => {
    expect(argsForManualRequest({ race_id: null, stage_number: null, ignore_window: true }))
      .toEqual(['--scope', 'today', '--ignore-window']);
  });

  it('limita una solicitud dirigida a su carrera', () => {
    expect(argsForManualRequest({ race_id: 'race-1', stage_number: null }))
      .toEqual(['--race-id', 'race-1']);
  });

  it('conserva el prólogo como etapa cero', () => {
    expect(argsForManualRequest({ race_id: 'race-1', stage_number: 0 }))
      .toEqual(['--race-id', 'race-1', '--stage', '0']);
  });
});

