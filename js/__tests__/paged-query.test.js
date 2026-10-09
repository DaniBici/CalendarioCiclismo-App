import { describe, expect, it } from 'vitest';
import { fetchAllRows, fetchAllRowsParallel, fetchByIds } from '../services/paged-query.js';

// Tabla simulada con el tope por respuesta de PostgREST.
function table(total, cap = 1000) {
  const rows = Array.from({ length: total }, (_, id) => ({ id }));
  const ranges = [];
  const query = () => ({
    range(from, to) {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
    },
  });
  return { query, ranges };
}

describe('paginación de consultas', () => {
  it('recorre todas las páginas en serie', async () => {
    const { query } = table(1221);
    expect((await fetchAllRows(query)).map(row => row.id)).toEqual([...Array(1221).keys()]);
  });

  it('resuelve en un lote las consultas que caben en él', async () => {
    const { query, ranges } = table(1221);
    const rows = await fetchAllRowsParallel(query, 500, 3);
    expect(rows).toHaveLength(1221);
    expect(rows.at(-1).id).toBe(1220);
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('continúa con otro lote cuando todas las páginas llegan llenas', async () => {
    const { query, ranges } = table(1500);
    const rows = await fetchAllRowsParallel(query, 500, 3);
    expect(rows).toHaveLength(1500);
    expect(ranges).toHaveLength(6);
  });

  it('propaga el error de cualquier página', async () => {
    const query = () => ({ range: () => Promise.resolve({ data: null, error: new Error('fallo') }) });
    await expect(fetchAllRowsParallel(query)).rejects.toThrow('fallo');
  });

  it('pide por identificadores en trozos de cien y conserva el orden', async () => {
    const requested = [];
    const client = {
      from: () => ({
        select: () => ({
          in: (_field, ids) => {
            requested.push(ids.length);
            const builder = { order: () => builder, range: () => Promise.resolve({ data: ids.map(id => ({ id })), error: null }) };
            return builder;
          },
        }),
      }),
    };
    const ids = Array.from({ length: 250 }, (_, i) => `r${i}`);
    const rows = await fetchByIds(client, 'races', 'id', 'id', [...ids, null, 'r0']);
    expect(requested).toEqual([100, 100, 50]);
    expect(rows.map(row => row.id)).toEqual(ids);
  });
});
