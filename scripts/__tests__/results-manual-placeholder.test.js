import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizeResultsDocument,
  validateResultsDocument,
} from '../data-preflight/results-preflight.mjs';
import { compactResultRowsSql } from '../results-fetchers/results-upsert.mjs';
import { MANUAL_OBSERVATION_PROVIDERS } from '../results-fetchers/result-publication.mjs';

// REGRESIÓN (2026-09-27): placeholders manuales en Mentougou, Poyang y Langkawi.
// - La general final manual se guardaba con points/kom/teams en 'overall' y la
//   oficial de UCI (scope 'stage') no la sustituía: quedaban duplicadas.
// - El placeholder de Langkawi registró lastSyncedAt y el cron dejó de consultar
//   atresults por considerar la jornada cubierta.
// - --emit-sql generaba un INSERT por fila (~250 KB por carrera) y el conector MCP
//   no lo admitía de forma práctica.

const clasificacion = (classKind, scope, rows) => ({
  eventId: -9990101, classKind, scope, eventName: classKind, isTeamEvent: classKind === 'teams',
  rowCount: rows.length, expectedRowCount: rows.length, rows,
});

describe('general final manual', () => {
  const documento = {
    raceId: 'R1',
    competitionId: -999,
    stages: [
      { stageNumber: 3, isFinalClassification: false,
        classifications: [{ ...clasificacion('points', 'overall', [{ rank: 1, bib: 1, value: '20 pts' }]), eventId: -9990302 }] },
      { stageNumber: null, isFinalClassification: true,
        classifications: [
          { ...clasificacion('points', 'overall', [{ rank: 1, bib: 1, value: '20 pts' }]), eventId: -9999952 },
          { ...clasificacion('teams', 'overall', [{ rank: 1, teamName: 'Equipo', value: '10:00:00' }]), eventId: -9999955 },
        ] },
    ],
  };

  it('normaliza todas las finales a scope stage y conserva overall en las etapas', () => {
    const normalizado = normalizeResultsDocument(documento);
    expect(normalizado.stages[0].classifications[0].scope).toBe('overall');
    expect(normalizado.stages[1].classifications.map((cl) => cl.scope)).toEqual(['stage', 'stage']);
  });

  it('valida las finales normalizadas', () => {
    const report = validateResultsDocument(normalizeResultsDocument(documento), { expectedRaceId: 'R1' });
    expect(report.errors.filter((e) => e.code === 'INVALID_CLASSIFICATION')).toEqual([]);
  });
});

describe('placeholder manual y ventana automática', () => {
  const cron = readFileSync('scripts/results-fetchers/results-cron.mjs', 'utf8');

  it('trata como manuales las observaciones sin fuente declarada', () => {
    expect(MANUAL_OBSERVATION_PROVIDERS).toEqual(expect.arrayContaining(['pdf', 'sportstiming', 'unknown']));
  });

  it('solo cierra la jornada con una adquisición automática', () => {
    expect(cron).toMatch(/AND \$\{AUTOMATIC_ACQUISITION\}\s+AND rr\.rank = 1/g);
    expect(cron.match(/AND \$\{AUTOMATIC_ACQUISITION\}/g)).toHaveLength(2);
    expect(cron).toContain('p.provider IN (${sqlStringList(MANUAL_OBSERVATION_PROVIDERS)})');
  });

  it('--dry-run no registra la consulta en race_days', () => {
    expect(cron).toContain('if (targets.length && !DRY) {');
  });
});

describe('compactResultRowsSql', () => {
  const fila = (i, extra = {}) => ({
    resultRow: true,
    params: ['ru_-1', 'R1', -1, i + 1, String(i + 1), String(10 + i), null, null,
      i ? '+05' : '1:00:00', i ? null : '1:00:00', i ? '+05' : null, null, null, i,
      extra.team ?? null, null, null, null],
  });

  it('emite constantes como literales y el resto como arrays por columna', () => {
    const sql = compactResultRowsSql([fila(0, { team: 'Caja "Rural" O\'Neil' }), fila(1, { team: 'A,B' }), fila(2)]);
    expect(sql).toContain("SELECT 'ru_-1'::text,'R1'::text,-1::int,u.c1,u.c2,u.c3,NULL::text,NULL,NULL::text");
    expect(sql).toContain("'{10,11,12}'::text[]");
    expect(sql).toContain("'{1:00:00,NULL,NULL}'::text[]");
    expect(sql).toContain(`'{"Caja \\"Rural\\" O''Neil","A,B",NULL}'::text[]`);
    expect(sql).toContain("s.id='ru_-1' AND s.\"lockedAt\" IS NOT NULL");
    expect(sql).toContain("h.id='ru_-1'");
  });

  it('rechaza filas de clasificaciones distintas', () => {
    const otra = fila(1);
    otra.params[0] = 'ru_-2';
    expect(() => compactResultRowsSql([fila(0), otra])).toThrow('una sola clasificación');
  });
});
