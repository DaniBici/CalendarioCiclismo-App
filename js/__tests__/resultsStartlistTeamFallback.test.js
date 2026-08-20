import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../resultados.js', import.meta.url), 'utf8');

describe('equipo de startlist en resultados manuales', () => {
  it('indexa la startlist también por globalRiderId', () => {
    expect(source).toContain('const byStartlistRider = new Map()');
    expect(source).toContain('byStartlistRider.set(r.globalRiderId, snapshot)');
  });

  it('resuelve primero por dorsal y después por el corredor enlazado', () => {
    expect(source).toContain('const startlistRiderForResult = (row) => {');
    expect(source).toContain('byDorsal.get(dorsal)');
    expect(source).toContain('byStartlistRider.get(row.globalRiderId)');
  });

  it('usa el snapshot de startlist al pintar y filtrar clasificaciones', () => {
    expect(source.match(/startlistRiderForResult\(r\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
