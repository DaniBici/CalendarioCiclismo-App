import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareResultsImport } from '../data-preflight/results-preflight.mjs';
import { applyStartlistSql } from '../data-preflight/startlist-import.mjs';

const fixture = () => ({ ...JSON.parse(readFileSync('scripts/data-preflight/fixtures/results-normalization.json', 'utf8')), competitionId: -71301 });

describe('canal de importación completo', () => {
  it('distingue el contrato automático sin falsificar raceId ni recuentos', () => {
    const input = fixture(); delete input.raceId; delete input.stages[0].classifications[0].expectedRowCount;
    input.stages[0].classifications[0].eventId = 42;
    const { document, report } = prepareResultsImport(input, { expectedRaceId: 'eval-results', inputContract: 'fetcher' });
    expect(report.ok).toBe(true);
    expect(document.raceId).toBe('eval-results');
    expect(document.stages[0].classifications[0]).not.toHaveProperty('expectedRowCount');
    expect(prepareResultsImport(input, { expectedRaceId: 'eval-results' }).report.ok).toBe(false);
    input.raceId = 'otra-carrera';
    expect(prepareResultsImport(input, { expectedRaceId: 'eval-results', inputContract: 'fetcher' }).report.ok).toBe(false);
  });

  it('emite el volcado del documento validado y bloquea el que falla el preflight', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-pipeline-test-'));
    try {
      const path = join(dir, 'source.json');
      const doc = fixture(); writeFileSync(path, JSON.stringify(doc));
      const args = ['scripts/results-fetchers/results-upsert.mjs', '--in', path, '--race-id', 'eval-results', '--input-contract', 'manual', '--emit-sql', '-'];
      const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(valid.status, valid.stderr).toBe(0);
      doc.stages[0].classifications[0].expectedRowCount = 6;
      writeFileSync(path, JSON.stringify(doc));
      const blocked = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(blocked.status).not.toBe(0);
      expect(blocked.stdout).toBe('');
      expect(blocked.stderr).toContain('Preflight bloqueado');
    } finally { rmSync(dir, { recursive: true }); }
  });

  it('rechaza un importId que no es UUID', () => {
    expect(() => applyStartlistSql("'; delete from riders; --")).toThrow('UUID');
  });

  it('el CLI de startlist emite sin diagnóstico mezclado y rechaza modos ambiguos', () => {
    const base = ['scripts/data-preflight/startlist-import.mjs', '--in',
      'scripts/data-preflight/fixtures/startlist-extraction.json'];
    const direct = spawnSync(process.execPath, base, { encoding: 'utf8' });
    expect(direct.status, direct.stderr).toBe(0);
    expect(direct.stderr).toBe('');
    const timed = spawnSync(process.execPath, [...base, '--timed'], { encoding: 'utf8' });
    expect(timed.status, timed.stderr).toBe(0);
    expect(timed.stderr).toBe('');
    const ambiguous = spawnSync(process.execPath, [...base, '--timed', '--import-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], { encoding: 'utf8' });
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stdout).toBe('');
    const missingPdfArgs = spawnSync(process.execPath, ['scripts/data-preflight/startlist-import.mjs', '--pdf', 'lista.pdf'], { encoding: 'utf8' });
    expect(missingPdfArgs.status).not.toBe(0);
    expect(missingPdfArgs.stderr).toContain('--source-out');
  });
});
