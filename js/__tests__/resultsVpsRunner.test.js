import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

describe('separación del proceso histórico', () => {
  it('mantiene el watcher actual fuera del backlog histórico', () => {
    const source = readFileSync(
      new URL('../../scripts/results-fetchers/results-vps-runner.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("'--scope', 'backlog'");
  });

  it('fija el backlog histórico a 2020–2025', () => {
    const runner = readFileSync(
      new URL('../../scripts/results-fetchers/results-historical-vps-runner.mjs', import.meta.url),
      'utf8',
    );
    const cron = readFileSync(
      new URL('../../scripts/results-fetchers/results-cron.mjs', import.meta.url),
      'utf8',
    );
    expect(runner).toContain("'--historical'");
    expect(runner).toContain("'--limit', '1'");
    expect(cron).toContain("r.year BETWEEN 2020 AND 2025");
    expect(cron).toContain("'--require-resolved-identities'");
    expect(cron).toContain("'--identity-pending-log'");
    expect(cron).toContain('pendingHistoricalRaceIds');
  });

  it('mantiene un registro persistente para la revisión manual de identidades', () => {
    const unit = readFileSync(
      new URL('../../deploy/results-vps/cc-results-historical.service', import.meta.url),
      'utf8',
    );
    expect(unit).toContain('StateDirectory=cc-results-historical');
    expect(unit).toContain('HISTORICAL_IDENTITY_PENDING_LOG=/var/lib/cc-results-historical/pending-identities.jsonl');
  });
});
