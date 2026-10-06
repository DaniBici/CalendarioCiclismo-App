import { describe, it, expect } from 'vitest';
import {
  compactResultRowsSql,
  hasPublishableResults,
  linkTeamResultRowsSql,
  shouldPublishFinalClassification,
} from '../results-fetchers/results-upsert.mjs';

describe('shouldPublishFinalClassification — carreras de un día en DataRide', () => {
  it('acepta una Final Classification única cuando no hay etapa no-final en el payload', () => {
    expect(shouldPublishFinalClassification(false, false)).toBe(true);
  });
});

describe('hasPublishableResults — guardia de retirada de carreras inválidas', () => {
  it('rechaza una respuesta DNS-only de DataRide', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'gc',
          scope: 'stage',
          rows: [{ rank: null, rankText: 'DNS', irm: 'DNS' }],
        }],
      }],
    })).toBe(false);
  });

  it('conserva una carrera cuyo payload sí contiene una llegada válida', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'stage',
          scope: 'stage',
          rows: [{ rank: 1, bib: '7', irm: null }],
        }],
      }],
    })).toBe(true);
  });
});

// REGRESIÓN (2026-09-27): --emit-sql generaba un INSERT por fila (~250 KB por
// carrera) y el conector MCP no lo admitía de forma práctica.
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

// El comportamiento del enlace se prueba contra la base de datos en
// scripts/data-preflight/tests/team-link.sql.
describe('linkTeamResultRowsSql', () => {
  it('escapa el identificador de carrera que llega por parámetro', () => {
    expect(linkTeamResultRowsSql("o'brien")).toContain("'o''brien'");
  });
});
