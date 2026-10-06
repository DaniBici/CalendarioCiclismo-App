import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlan, noDeleteRowKeys } from '../results-fetchers/results-upsert.mjs';

// Carga sin borrado (--no-delete) para el conector MCP. Las filas guardadas se
// reconcilian por clave; un contrato cuya clave no identifica cada fila no se
// puede cargar sin borrar y se rechaza al generar, antes de llegar a la base.
// El comportamiento contra la base (reutilización de la gemela, abortos) se
// comprueba con `sql.mjs --rollback` sobre el SQL emitido.

const fila = (bib, rank, extra = {}) => ({ bib, rank, rankText: rank == null ? 'DNF' : String(rank), ...extra });

describe('claves de fila de la carga sin borrado', () => {
  it('identifica por dorsal y, sin dorsal, por puesto', () => {
    expect(noDeleteRowKeys([fila('42', 1), fila('14', null, { irm: 'DNF' }), fila(null, 3, { teamName: 'Equipo' })]).keys)
      .toEqual(['b:42', 'b:14', 'r:3']);
  });

  it('trata el dorsal vacío como ausente', () => {
    expect(noDeleteRowKeys([fila('', 2)]).keys).toEqual(['r:2']);
  });

  // Un ganador tecleado en el panel sin dorsal se completa por puesto en lugar
  // de abortar, salvo que el puesto no identifique una sola fila del contrato.
  it('ofrece el puesto como respaldo solo a filas con dorsal y puesto exclusivo', () => {
    const { fallbacks } = noDeleteRowKeys([
      fila('42', 1), fila('7', 2), fila('9', 2), fila('14', null, { irm: 'DNF' }), fila(null, 3, { teamName: 'Equipo' }),
    ]);
    expect(fallbacks).toEqual(['r:1', null, null, null, null]);
  });

  it('rechaza un dorsal repetido', () => {
    expect(() => noDeleteRowKeys([fila('42', 1), fila('42', 2)], 'stage/stage')).toThrow('repite el dorsal 42');
  });

  it('rechaza dos filas sin dorsal con el mismo puesto', () => {
    expect(() => noDeleteRowKeys([fila(null, 1), fila(null, 1)])).toThrow('repite el puesto sin dorsal 1');
  });

  it('rechaza una fila sin dorsal ni puesto', () => {
    expect(() => noDeleteRowKeys([fila('7', 1), fila(null, null, { irm: 'DNF' })])).toThrow('la fila 2');
  });
});

describe('plan sin borrado', () => {
  const datos = (rows) => ({
    competitionId: -135992,
    stages: [{
      stageNumber: 1,
      classifications: [{ eventId: -1359920101, classKind: 'stage', scope: 'stage', rowCount: rows.length, rows }],
    }],
  });

  it('cuelga las filas de la cabecera resuelta en la base, no del eventId entrante', () => {
    const { plan } = buildPlan(datos([fila('11', 1), fila('12', 2)]), null, null, null, null, null, { noDelete: true });
    const filas = plan.filter((st) => st.resultRow);
    expect(filas).toHaveLength(2);
    expect(filas.every((st) => st.targetSql)).toBe(true);
  });

  it('no admite un contrato que solo se cargaría borrando', () => {
    expect(() => buildPlan(datos([fila('11', 1), fila('11', 2)]), null, null, null, null, null, { noDelete: true }))
      .toThrow('requiere la carga con borrado');
  });

  it('el CLI genera la variante sin borrado y la rechaza junto a --apply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-sin-borrado-test-'));
    try {
      const path = join(dir, 'contrato.json');
      const doc = JSON.parse(readFileSync('scripts/data-preflight/fixtures/results-normalization.json', 'utf8'));
      writeFileSync(path, JSON.stringify({ ...doc, competitionId: -71301 }));
      const args = ['scripts/results-fetchers/results-upsert.mjs', '--in', path, '--race-id', 'eval-results',
        '--input-contract', 'manual', '--no-delete'];
      const sql = spawnSync(process.execPath, [...args, '--emit-sql', '-'], { encoding: 'utf8' });
      expect(sql.status, sql.stderr).toBe(0);
      const apply = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' });
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain('solo se admite en modo SQL');
    } finally { rmSync(dir, { recursive: true }); }
  });
});
