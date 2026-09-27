import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractRidersForNameResolve, nameResolveWithStartlistAuthoritySql } from '../../scripts/results-fetchers/results-upsert.mjs';
import { pendingIdentityDetails } from '../../scripts/results-fetchers/historical-identity-log.mjs';

describe('identidades de pruebas con dorsales reutilizados', () => {
  it('conserva personas diferentes con el mismo dorsal y deduplica las repeticiones de una persona', () => {
    const rows = [
      { bib: '1', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa', isoCode2: 'es' },
      { bib: '1', riderDisplay: 'BETA Bea', firstName: 'Bea', lastName: 'Beta', isoCode2: 'fr' },
    ];
    const data = { stages: [{ classifications: [
      { eventId: 10, rows: [rows[0]] }, { eventId: 20, rows: [rows[1]] },
      { eventId: 30, rows: [rows[0]] },
    ] }] };
    const extracted = extractRidersForNameResolve(data, null, { includeBib: true });
    expect(extracted).toHaveLength(2);
    expect(extracted.map(r => r.eventIds)).toEqual([[10, 30], [20]]);
  });
  it('conserva la licencia UCI separada del identificador de perfil', () => {
    const data = { stages: [{ classifications: [{ eventId: 10, rows: [{
      bib: '7', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa',
      isoCode2: 'es', uciId: '10012345678',
    }] }] }] };
    expect(extractRidersForNameResolve(data, null, { includeBib: true })[0].uciLicenseId)
      .toBe('10012345678');
  });

  it('conserva el identificador de perfil UCI para el cruce histórico', () => {
    const data = { stages: [{ classifications: [{ eventId: 10, rows: [{
      bib: '7', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa',
      isoCode2: 'es', uciProfileId: '428096',
    }] }] }] };
    expect(extractRidersForNameResolve(data, null, { includeBib: true })[0].uciProfileId)
      .toBe('428096');
  });
});

describe('resolución histórica protegida', () => {
  const migration = readFileSync(new URL(
    '../../supabase/migrations/20260907200000_harden_historical_result_identity.sql',
    import.meta.url,
  ), 'utf8');
  const upsert = readFileSync(new URL(
    '../../scripts/results-fetchers/results-upsert.mjs',
    import.meta.url,
  ), 'utf8');

  it('prioriza identificadores UCI y nombres alternativos del catálogo', () => {
    expect(migration).toContain('"uciProfileId"=v_profile');
    expect(migration).toContain('"uciLicenseId"=v_license');
    expect(migration).toContain('compute_identity_key("firstName","otherNames")=v_ikey');
  });

  it('impide crear cuando queda un candidato nominal o biográfico', () => {
    expect(migration).toContain('cardinality(v_name_cands)>0');
    expect(migration).toContain('cardinality(v_subset_cands)>0');
    expect(migration).toContain('cardinality(v_birth_cands)>0');
  });

  it('revierte el volcado histórico si queda alguna identidad sin resolver', () => {
    expect(upsert).toContain('public.resolve_historical_uci_results_by_name');
    expect(upsert).toContain('Identidades históricas ambiguas o incompletas');
  });

  it('genera un expediente suficiente para la revisión asistida', () => {
    const details = pendingIdentityDetails([{
      eventId: 10, bib: '7', riderDisplay: 'ALFA Ana', sourceTeamName: 'Equipo A',
      sourceUciProfileId: null, sourceUciLicense: null,
    }], [{
      eventIds: [10], bib: '7', display: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa',
      birthDate: '2000-01-02', countryCode: 'es', teamName: 'Equipo A',
    }]);
    expect(details).toEqual([expect.objectContaining({
      display: 'ALFA Ana', birthDate: '2000-01-02', countryCode: 'ES',
      reason: 'no_unique_safe_match', eventIds: [10],
    })]);
  });
});

describe('autoridad de identidad de la startlist oficial', () => {
  const sql = nameResolveWithStartlistAuthoritySql(
    'race_x',
    'male',
    '[{"bib":"15","display":"BJERG M."}]',
  );

  it('no activa el fallback por las filas sin corredor de clasificaciones de equipos', () => {
    expect(sql).toContain('JOIN public.race_uci_stages s ON s.id=r."stageRef"');
    expect(sql).toContain('s."isTeamEvent"=false');
  });

  it('no activa el fallback nominal para una fila individual que ya tiene dorsal', () => {
    expect(sql).toContain("AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$')");
  });

  it('permite que DataRide resuelva filas con dorsal al sembrar la startlist', () => {
    const dataRideSql = nameResolveWithStartlistAuthoritySql(
      'race_x',
      'male',
      '[{"bib":"15","display":"BJERG M."}]',
      { includeBib: true },
    );

    expect(dataRideSql).not.toContain("AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$')");
    expect(dataRideSql).toContain('r."globalRiderId" IS NULL');
  });

  it('permite resolver filas con dorsal sin activar ninguna siembra de startlist', () => {
    const resultsOnlySql = nameResolveWithStartlistAuthoritySql(
      'race_x',
      'male',
      '[{"bib":"15","display":"BJERG M."}]',
      { includeBib: true },
    );

    expect(resultsOnlySql).not.toContain('resolve_uci_startlist');
    expect(resultsOnlySql).toContain('resolve_uci_results_by_name');
  });

  it('reaplica el enlace por dorsal después del fallback por nombre', () => {
    const fallback = sql.indexOf('resolve_uci_results_by_name');
    const authoritative = sql.lastIndexOf('resolve_uci_results(');

    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(authoritative).toBeGreaterThan(fallback);
  });

  it('resuelve decisiones históricas antes y después de la identidad nominal', () => {
    const firstHistorical = sql.indexOf('resolve_historical_result_participations');
    const fallback = sql.indexOf('resolve_uci_results_by_name');
    const lastHistorical = sql.lastIndexOf('resolve_historical_result_participations');
    expect(firstHistorical).toBeLessThan(fallback);
    expect(lastHistorical).toBeGreaterThan(fallback);
  });
});
