import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isFinalStageDump,
  stageFilterArgs,
} from '../results-fetchers/results-cron.mjs';

const source = readFileSync(
  new URL('../results-fetchers/results-cron.mjs', import.meta.url),
  'utf8',
);

// Regresión (2026-08-21, Baltic Chain Tour): 1A y 1B comparten stageNumber=1.
// El volcado dirigido resolvía scheduledDate con una subconsulta escalar sin
// agregado y PostgreSQL abortaba al recibir las dos jornadas.
describe('volcado dirigido de una doble jornada', () => {
  it('reduce a una fecha las jornadas que comparten stageNumber', () => {
    expect(source).toContain('SELECT min(d2."dateKey") FROM race_days d2');
    expect(source).not.toContain('SELECT d2."dateKey" FROM race_days d2');
  });

  it('prioriza el stageNumber solicitado sobre la jornada del día', () => {
    expect(source).toContain('d2."stageNumber" = COALESCE($2::int, ${LIVE_STAGE_SUBSELECT})');
    expect(source).toContain('[ONE_RACE, ONE_STAGE, ONE_SECTOR_INDEX]');
  });
});

describe('timer — aislamiento de dobles sectores', () => {
  it('pasa etapa y sector exactos al upsert', () => {
    expect(stageFilterArgs(3, 0, false)).toEqual([
      '--only-stage', '3', '--only-sector-index', '0',
    ]);
    expect(stageFilterArgs(3, 1, false)).toEqual([
      '--only-stage', '3', '--only-sector-index', '1',
    ]);
  });

  it('solo el último sector incorpora la clasificación final', () => {
    expect(isFinalStageDump(3, 3, false, false)).toBe(false);
    expect(isFinalStageDump(3, 3, false, true)).toBe(true);
    expect(stageFilterArgs(3, 1, true)).toEqual([
      '--only-stage', '3', '--only-sector-index', '1', '--include-final',
    ]);
  });

  it('la consulta calcula el sector y la última jornada, no solo la etapa máxima', () => {
    expect(source).toContain('AS "scheduledSectorIndex"');
    expect(source).toContain('AS "scheduledIsLastRaceDay"');
    expect(source).not.toContain('const IS_LAST_STAGE =');
  });
});
