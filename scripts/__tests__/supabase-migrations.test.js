import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Convención de nombres de supabase/migrations/. Procedimiento en
// docs/runbooks/migraciones.md.
const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const entries = readdirSync(dir);
const migrations = entries.filter(name => name.endsWith('.sql'));

// Versiones repetidas heredadas; congeladas: no se admite ninguna nueva.
const LEGACY_DUPLICATES = new Set(['038', '040', '041', '042', '087', '20260912190000', '20260918210000']);
const LAST_LEGACY_NUMBER = 135;

const versionOf = name => name.split('_', 1)[0];

function timestampToDate(version) {
  const [y, mo, d, h, mi, s] = version.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/).slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s;
  return valid ? date : null;
}

describe('supabase/migrations', () => {
  it('solo contiene migraciones SQL y el registro de migraciones sin archivo', () => {
    expect(entries.filter(name => !name.endsWith('.sql'))).toEqual(['MIGRACIONES-SIN-ARCHIVO.md']);
  });

  it('nombra cada archivo como <versión>_<nombre>.sql en minúsculas', () => {
    expect(migrations.filter(name => !/^\d+_[a-z0-9_]+\.sql$/.test(name))).toEqual([]);
  });

  it('usa la versión de 14 dígitos del registro salvo en la numeración heredada', () => {
    const invalid = migrations.filter(name => {
      const version = versionOf(name);
      if (version.length === 14) return timestampToDate(version) === null;
      return !(version.length === 3 && Number(version) <= LAST_LEGACY_NUMBER);
    });
    expect(invalid).toEqual([]);
  });

  it('no registra versiones futuras', () => {
    const limit = Date.now() + 24 * 60 * 60 * 1000;
    const future = migrations.filter(name => {
      const version = versionOf(name);
      return version.length === 14 && timestampToDate(version)?.getTime() > limit;
    });
    expect(future).toEqual([]);
  });

  it('no repite versiones fuera de las heredadas', () => {
    const seen = new Map();
    for (const name of migrations) {
      const version = versionOf(name);
      seen.set(version, [...(seen.get(version) ?? []), name]);
    }
    const duplicated = [...seen].filter(([version, names]) => names.length > 1 && !LEGACY_DUPLICATES.has(version));
    expect(duplicated).toEqual([]);
  });
});
