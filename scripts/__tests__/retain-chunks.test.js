import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INDEX_FILE, planRetention, retainChunks } from '../../tools/site/retain_chunks.mjs';

const NOW = Date.parse('2026-10-29T18:30:00Z');
const DAY = 86_400_000;
const iso = ms => new Date(ms).toISOString();

describe('chunks que conservar', () => {
  it('vigentes fuera, retirados con su fecha, caducados y nombres no válidos fuera', () => {
    const published = {
      'chunk-VIGENTE.js': null,
      'chunk-RECIEN.js': null,
      'chunk-AYER.js': iso(NOW - DAY),
      'chunk-VIEJO.js': iso(NOW - 8 * DAY),
      '../fuera.js': null,
    };
    const { retain, expired } = planRetention(published, ['chunk-VIGENTE.js'], NOW, 7);
    expect(retain).toEqual([
      { name: 'chunk-RECIEN.js', retiredAt: iso(NOW) },
      { name: 'chunk-AYER.js', retiredAt: iso(NOW - DAY) },
    ]);
    expect(expired).toEqual(['chunk-VIEJO.js']);
  });

  it('un chunk retirado que vuelve a ser vigente no se retiene', () => {
    expect(planRetention({ 'chunk-A.js': iso(NOW - DAY) }, ['chunk-A.js'], NOW).retain).toEqual([]);
  });
});

describe('sitio con chunks retenidos', () => {
  let site;
  const setup = () => {
    site = mkdtempSync(join(tmpdir(), 'retain-'));
    mkdirSync(join(site, 'js', 'chunks'), { recursive: true });
    writeFileSync(join(site, 'js', 'chunks', 'chunk-NUEVO.js'), 'export{}');
    return site;
  };
  const response = (status, body) => new Response(body, { status });
  const index = () => JSON.parse(readFileSync(join(site, 'js', 'chunks', INDEX_FILE), 'utf8')).chunks;
  afterEach(() => rmSync(site, { recursive: true, force: true }));

  it('descarga los retirados del sitio publicado y los registra', async () => {
    setup();
    const published = { chunks: { 'chunk-NUEVO.js': null, 'chunk-ANTES.js': null, 'chunk-ROTO.js': null } };
    const fetchImpl = async url => {
      if (url.includes(INDEX_FILE)) return response(200, JSON.stringify(published));
      if (url.endsWith('/chunk-ANTES.js')) return response(200, 'import"./chunk-X.js?v=1"');
      return response(404, '');
    };
    const warnings = [];
    const summary = await retainChunks(site, { live: 'https://x', now: NOW, fetchImpl, warn: w => warnings.push(w) });
    expect(summary).toMatchObject({ current: 1, retained: 1, expired: 0, failed: 1 });
    expect(readFileSync(join(site, 'js', 'chunks', 'chunk-ANTES.js'), 'utf8')).toBe('import"./chunk-X.js?v=1"');
    expect(index()).toEqual({ 'chunk-ANTES.js': iso(NOW), 'chunk-NUEVO.js': null });
    expect(warnings).toHaveLength(1);
  });

  it('sin índice publicado o sin red, solo los vigentes', async () => {
    for (const fetchImpl of [async () => response(404, ''), async () => { throw new Error('sin red'); }]) {
      setup();
      const summary = await retainChunks(site, { live: 'https://x', now: NOW, fetchImpl, warn: () => {} });
      expect(summary).toMatchObject({ current: 1, retained: 0 });
      expect(index()).toEqual({ 'chunk-NUEVO.js': null });
      expect(readdirSync(join(site, 'js', 'chunks')).sort()).toEqual([INDEX_FILE, 'chunk-NUEVO.js'].sort());
      rmSync(site, { recursive: true, force: true });
    }
  });
});
