import { describe, expect, it } from 'vitest';
import { databaseUrl } from '../db/env.mjs';
import { checkMigrationSql } from '../db/apply-migration.mjs';
import { hasTransactionControl } from '../db/sql.mjs';
import { upsertEnv } from '../db/provision-agent-role.mjs';

describe('scripts/db', () => {
  it('prefiere AGENT_DATABASE_URL y en el VPS usa DATABASE_URL', () => {
    expect(databaseUrl({ AGENT_DATABASE_URL: 'agente', DATABASE_URL: 'admin' })).toBe('agente');
    expect(databaseUrl({ DATABASE_URL: 'worker' })).toBe('worker');
    expect(databaseUrl({})).toBeUndefined();
  });

  it('detecta control de transacción fuera de cuerpos de función y cadenas', () => {
    expect(hasTransactionControl('BEGIN;\nDELETE FROM x;\nCOMMIT;')).toBe(true);
    expect(hasTransactionControl('select 1; commit')).toBe(true);
    expect(hasTransactionControl('START TRANSACTION; select 1')).toBe(true);
    expect(hasTransactionControl('DO $$ BEGIN PERFORM 1; END $$;')).toBe(false);
    expect(hasTransactionControl('CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $f$\nBEGIN\n RETURN 1;\nEND\n$f$;')).toBe(false);
    expect(hasTransactionControl("select 'commit; begin' as t -- commit")).toBe(false);
    expect(hasTransactionControl('select "begin" from t')).toBe(false);
  });

  it('rechaza migraciones con control de transacción propio', () => {
    expect(() => checkMigrationSql('BEGIN;\nUPDATE teams SET name = 1;\nCOMMIT;\n')).toThrow('control de transacción');
    expect(() => checkMigrationSql('-- fusión\nstart transaction;\nDELETE FROM x;')).toThrow('control de transacción');
    expect(() => checkMigrationSql('DO $$ BEGIN PERFORM 1; END $$;\nALTER TABLE x ADD COLUMN y int; -- sin COMMIT')).not.toThrow();
    expect(() => checkMigrationSql('  \n')).toThrow('vacía');
  });

  it('actualiza el .env conservando el resto de líneas', () => {
    expect(upsertEnv('# nota\nexport AGENT_DATABASE_URL=a\nDATABASE_URL=p\n', { AGENT_DATABASE_URL: 'b' }))
      .toBe('# nota\nAGENT_DATABASE_URL=b\nDATABASE_URL=p\n');
    expect(upsertEnv('DATABASE_URL=p\nR2_ACCESS_KEY=k\n', { AGENT_DATABASE_URL: 'b' }))
      .toBe('DATABASE_URL=p\nR2_ACCESS_KEY=k\nAGENT_DATABASE_URL=b\n');
    expect(upsertEnv('', { AGENT_DATABASE_URL: 'b' })).toBe('AGENT_DATABASE_URL=b\n');
  });
});
