import { describe, expect, it } from 'vitest';
import { readCache, staleWhileRevalidate, writeCache } from '../services/local-cache.js';

function memoryStorage(limit = Infinity) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      const used = [...map.entries()].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), 0);
      if (used + value.length > limit) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
    removeItem: key => map.delete(key),
    map,
  };
}

describe('caché local', () => {
  it('distingue copias frescas y caducadas', () => {
    const storage = memoryStorage();
    writeCache('mes:2026-06', [1, 2], { now: 1000, storage });
    expect(readCache('mes:2026-06', { maxAgeMs: 500, now: 1200, storage })).toEqual({ data: [1, 2], savedAt: 1000, fresh: true });
    expect(readCache('mes:2026-06', { maxAgeMs: 500, now: 2000, storage }).fresh).toBe(false);
    expect(readCache('mes:2026-06', { maxAgeMs: 500, staleLimitMs: 5000, now: 7000, storage })).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('descarta copias de otra versión de esquema al liberar espacio', () => {
    const storage = memoryStorage(400);
    storage.setItem('cc-cache:v0:antigua', 'x'.repeat(300));
    storage.setItem('cc-theme', 'dark');
    expect(writeCache('nueva', 'y'.repeat(200), { storage })).toBe(true);
    expect(storage.getItem('cc-cache:v0:antigua')).toBeNull();
    expect(storage.getItem('cc-theme')).toBe('dark');
  });

  it('rechaza entradas que superan el tamaño máximo', () => {
    const storage = memoryStorage();
    expect(writeCache('grande', 'z'.repeat(100), { maxBytes: 50, storage })).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('pinta la copia y solo repinta si la red trae datos distintos', async () => {
    const storage = memoryStorage();
    writeCache('fichajes', [{ id: 1 }], { storage });
    const calls = [];
    await staleWhileRevalidate('fichajes', async () => [{ id: 1 }], (data, meta) => {
      data.forEach(row => { row._painted = true; });
      calls.push(meta.fromCache);
    }, { storage });
    expect(calls).toEqual([true]);
    await staleWhileRevalidate('fichajes', async () => [{ id: 2 }], (_data, meta) => calls.push(meta.fromCache), { storage });
    expect(calls).toEqual([true, true, false]);
  });

  it('conserva la copia si la red falla', async () => {
    const storage = memoryStorage();
    writeCache('temporada', ['copia'], { storage });
    await expect(staleWhileRevalidate('temporada', () => Promise.reject(new Error('red')), () => {}, { storage })).resolves.toEqual(['copia']);
    await expect(staleWhileRevalidate('otra', () => Promise.reject(new Error('red')), () => {}, { storage })).rejects.toThrow('red');
  });
});
