import { describe, expect, it } from 'vitest';
import { nameResolveWithStartlistAuthoritySql } from '../../scripts/results-fetchers/uci-results-upsert.mjs';

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

  it('reaplica el enlace por dorsal después del fallback por nombre', () => {
    const fallback = sql.indexOf('resolve_uci_results_by_name');
    const authoritative = sql.lastIndexOf('resolve_uci_results(');

    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(authoritative).toBeGreaterThan(fallback);
  });
});
