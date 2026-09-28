import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareResultsImport } from '../data-preflight/results-preflight.mjs';
import { prepareStartlistSql, applyStartlistSql } from '../data-preflight/startlist-import.mjs';

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

  it('genera SQL solo del documento validado, sin artefacto normalizado intermedio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-pipeline-test-'));
    try {
      const path = join(dir, 'source.json');
      const doc = fixture(); writeFileSync(path, JSON.stringify(doc));
      const args = ['scripts/results-fetchers/results-upsert.mjs', '--in', path, '--race-id', 'eval-results', '--input-contract', 'manual', '--emit-sql', '-'];
      const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(valid.status, valid.stderr).toBe(0);
      expect(valid.stdout).toContain('4:32:54');
      expect(valid.stdout).not.toContain("4h 32'");
      doc.stages[0].classifications[0].expectedRowCount = 6;
      writeFileSync(path, JSON.stringify(doc));
      const blocked = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(blocked.status).not.toBe(0);
      expect(blocked.stdout).not.toContain('BEGIN;');
      expect(blocked.stderr).toContain('Preflight bloqueado');
    } finally { rmSync(dir, { recursive: true }); }
  });

  it('emite únicamente SQL transferible al MCP sin avisos de carga de módulos', () => {
    const result = spawnSync(process.execPath, ['scripts/data-preflight/startlist-import.mjs', '--in',
      'scripts/data-preflight/fixtures/startlist-extraction.json'], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^SELECT public\.prepare_startlist_import/);
    expect(result.stdout).toContain('firstName');
    expect(result.stdout).not.toContain('riderName');
  });

  it('escapa datos fuente al preparar SQL y aplica solo por importId', () => {
    const query = prepareStartlistSql({ raceId: 'test', expectedRiderCount: 1, teams: [{ teamName: "Club d'Azur", riders: [{ dorsal: 1, firstName: 'Évita', lastName: "D'Hoore", countryCode: 'be', birthDate: '1995-01-01' }] }] });
    expect(query).toContain("Club d''Azur");
    expect(query).toContain("D''Hoore");
    expect(query).toContain('birthDate');
    expect(() => applyStartlistSql("'; delete from riders; --")).toThrow('UUID');
    expect(applyStartlistSql('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { riders: { 1: { birthDate: '1995-02-01' } } })).toContain('apply_startlist_import');
  });

  it('mide el servidor sin mezclar diagnóstico con el SQL y rechaza modos ambiguos', () => {
    const args = ['scripts/data-preflight/startlist-import.mjs', '--in',
      'scripts/data-preflight/fixtures/startlist-extraction.json', '--timed'];
    const timed = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(timed.status, timed.stderr).toBe(0);
    expect(timed.stderr).toBe('');
    expect(timed.stdout).toMatch(/^WITH started AS MATERIALIZED/);
    expect(timed.stdout).toContain('AS server_ms');
    const ambiguous = spawnSync(process.execPath, [...args, '--import-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], { encoding: 'utf8' });
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stdout).toBe('');
    const missingPdfArgs = spawnSync(process.execPath, ['scripts/data-preflight/startlist-import.mjs', '--pdf', 'lista.pdf'], { encoding: 'utf8' });
    expect(missingPdfArgs.status).not.toBe(0);
    expect(missingPdfArgs.stderr).toContain('--source-out');
  });
});
