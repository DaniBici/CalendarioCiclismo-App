import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { databaseUrl, parseEnv } from '../db/env.mjs';
import { expiryWarning, hasTransactionControl, parseArgs, pickRows } from '../db/sql.mjs';
import { agentUrl, parseArgs as parseProvisionArgs, roleOfUrl, scramVerifier, upsertEnv } from '../db/provision-agent-role.mjs';

describe('scripts/db', () => {
  it('prefiere AGENT_DATABASE_URL y en el VPS usa DATABASE_URL', () => {
    expect(databaseUrl({ AGENT_DATABASE_URL: 'agente', DATABASE_URL: 'admin' })).toBe('agente');
    expect(databaseUrl({ DATABASE_URL: 'worker' })).toBe('worker');
    expect(databaseUrl({})).toBeUndefined();
  });

  it('avisa de la caducidad de la credencial con menos de 30 días', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    expect(expiryWarning(null, now)).toBeNull();
    expect(expiryWarning(new Date('2027-04-15T00:00:00Z'), now)).toBeNull();
    expect(expiryWarning(new Date('2027-03-28T00:00:00Z'), now)).toContain('caduca el 2027-03-28 (27 días)');
    expect(expiryWarning(new Date('2027-02-01T00:00:00Z'), now)).toContain('(0 días)');
  });

  it('lee .env con comillas, export y comentarios', () => {
    expect(parseEnv('# nota\nexport A=1\nB="dos"\nC=\'tres\'\nmal linea')).toEqual({ A: '1', B: 'dos', C: 'tres' });
  });

  it('interpreta opciones y consulta', () => {
    expect(parseArgs(['--read-only', '--all', 'SELECT 1'])).toEqual({ readOnly: true, rollback: false, all: true, file: null, query: 'SELECT 1' });
    expect(parseArgs(['--rollback', 'UPDATE x']).rollback).toBe(true);
    expect(parseArgs(['--file', 'a.sql']).file).toBe('a.sql');
    expect(() => parseArgs(['--otra'])).toThrow('Opción desconocida');
  });

  it('devuelve la última sentencia como execute_sql o todas con --all', () => {
    const results = [
      { command: 'BEGIN', rows: [] },
      { command: 'UPDATE', rowCount: 2, rows: [] },
      { command: 'SELECT', rows: [{ n: 1 }] },
    ];
    expect(pickRows(results, false)).toEqual([{ n: 1 }]);
    expect(pickRows(results, true)).toEqual([{ command: 'BEGIN', rowCount: undefined }, { command: 'UPDATE', rowCount: 2 }, [{ n: 1 }]]);
    expect(pickRows({ command: 'SELECT', rows: [] }, false)).toEqual([]);
    expect(pickRows({ command: 'DELETE', rowCount: 3, rows: [] }, false)).toEqual({ command: 'DELETE', rowCount: 3 });
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

  it('genera verificadores SCRAM-SHA-256 compatibles con RFC 7677', () => {
    const verifier = scramVerifier('pencil', { salt: Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64') });
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/);
    const serverKey = Buffer.from(verifier.split(':').at(-1), 'base64');
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    expect(createHmac('sha256', serverKey).update(authMessage).digest('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });

  it('deriva la URL de cc_agent para pooler y conexión directa', () => {
    const pooled = agentUrl('postgresql://postgres.abcdefghij:viejo@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require', 'nueva');
    expect(pooled).toBe('postgresql://cc_agent.abcdefghij:nueva@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require');
    expect(agentUrl('postgresql://postgres:x@db.abcdefghij.supabase.co:5432/postgres', 'n')).toBe('postgresql://cc_agent:n@db.abcdefghij.supabase.co:5432/postgres');
    expect(roleOfUrl(pooled)).toBe('cc_agent');
    expect(roleOfUrl('postgresql://postgres.abc:x@h/postgres')).toBe('postgres');
  });

  it('actualiza el .env conservando el resto de líneas', () => {
    expect(upsertEnv('# nota\nexport AGENT_DATABASE_URL=a\nDATABASE_URL=p\n', { AGENT_DATABASE_URL: 'b' }))
      .toBe('# nota\nAGENT_DATABASE_URL=b\nDATABASE_URL=p\n');
    expect(upsertEnv('DATABASE_URL=p\nR2_ACCESS_KEY=k\n', { AGENT_DATABASE_URL: 'b' }))
      .toBe('DATABASE_URL=p\nR2_ACCESS_KEY=k\nAGENT_DATABASE_URL=b\n');
    expect(upsertEnv('', { AGENT_DATABASE_URL: 'b' })).toBe('AGENT_DATABASE_URL=b\n');
  });

  it('valida las opciones de aprovisionamiento', () => {
    expect(parseProvisionArgs([])).toEqual({ validDays: 180 });
    expect(parseProvisionArgs(['--valid-days', '30'])).toEqual({ validDays: 30 });
    expect(() => parseProvisionArgs(['--sin-admin'])).toThrow('Opción desconocida');
    expect(() => parseProvisionArgs(['--valid-days', '0'])).toThrow('--valid-days');
    expect(() => parseProvisionArgs(['--x'])).toThrow('Opción desconocida');
  });
});
