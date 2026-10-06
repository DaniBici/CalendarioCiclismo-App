import { describe, expect, it } from 'vitest';
import { argsForManualRequest,runnerOptions } from '../../scripts/results-fetchers/results-vps-runner.mjs';

describe('argsForManualRequest', () => {
  it('conserva carretera por defecto y limita dry-run a CX, sin aceptar flags de etapas',()=>{
    expect(runnerOptions()).toEqual({discipline:'10',dryRun:false});
    expect(runnerOptions(['--discipline','3','--dry-run'])).toEqual({discipline:'3',dryRun:true});
    for(const args of [['--dry-run'],['--discipline','4'],['--discipline'],['--discipline','3','--stage','1'],['--discipline','3','--discipline','10']])expect(()=>runnerOptions(args)).toThrow();
  });
  it('fuerza todo lo de hoy para la acción global', () => {
    expect(argsForManualRequest({ race_id: null, stage_number: null, ignore_window: true }))
      .toEqual(['--scope', 'today', '--ignore-window']);
  });

  it('limita una solicitud dirigida a su carrera', () => {
    expect(argsForManualRequest({ race_id: 'race-1', stage_number: null }))
      .toEqual(['--race-id', 'race-1', '--require-result']);
  });

  it('conserva el prólogo como etapa cero', () => {
    expect(argsForManualRequest({ race_id: 'race-1', stage_number: 0 }))
      .toEqual(['--race-id', 'race-1', '--stage', '0', '--require-result']);
  });
});
