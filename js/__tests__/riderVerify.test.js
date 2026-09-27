import { describe, expect, it } from 'vitest';
import { parseRider } from '../../scripts/uci-catalog/source.mjs';
import { summarizeRider, verifyRiders } from '../../scripts/data-preflight/rider-verify.mjs';

const riderPage = data => {
  const props = JSON.stringify({
    details: { givenName: data.givenName, familyName: data.familyName, dob: data.dob, nationality: data.nationality, location: data.location },
    history: { teams: data.history || [] },
  }).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<div data-component="RiderDetailsModule" data-props="${props}"></div>`;
};

const parsed = () => ({
  givenName: 'Kurt Dylan', familyName: 'PROCTOR-PARKER', birthDate: '2004-12-12', nationality: 'AUS',
  headerTeam: 'ROOJAI RIDING', history: [
    { teamName: 'ROOJAI RIDING', teamCode: 'ROO', countryCode: 'AUS', url: '/team-details/26001', year: '2026' },
    { teamName: 'MTB CLUB', teamCode: 'MTB', countryCode: 'AUS', format: 'XC', year: '2026' },
    { teamName: 'OLD TEAM', teamCode: 'OLD', countryCode: 'AUS', url: '/team-details/11001', year: '2024' },
  ],
});

const entry = expectValues => ({ dorsal: '35', uciProfileId: '97496', expect: expectValues });
const page = sha => ({ sha256: sha });

describe('verificador de identidades por lote', () => {
  it('clasifica verified con contraste de nacimiento y nacionalidad ISO-2 e ISO-3', () => {
    const ok = summarizeRider(entry({ birthDate: '2004-12-12', countryCode: 'au' }), parsed(), page('sha-1'), { year: 2026 });
    expect(ok).toMatchObject({ dorsal: '35', uciProfileId: '97496', status: 'verified', birthDate: '2004-12-12',
      countryCode: 'au', team: { teamName: 'ROOJAI RIDING', teamCode: 'ROO' }, evidenceSha256: 'sha-1', checks: { birthDate: true, countryCode: true } });
    const iso3 = summarizeRider(entry({ countryCode: 'AUS' }), parsed(), page('sha-2'), { year: 2026 });
    expect(iso3.status).toBe('verified');
    const mismatched = summarizeRider(entry({ birthDate: '1999-01-01' }), parsed(), page('sha-3'), { year: 2026 });
    expect(mismatched.status).toBe('mismatch');
    expect(mismatched.checks).toEqual({ birthDate: false });
    const wrongCountry = summarizeRider(entry({ countryCode: 'es' }), parsed(), page('sha-4'), { year: 2026 });
    expect(wrongCountry.checks).toEqual({ countryCode: false });
  });

  it('excluye equipos de formato no ruta del año y omite el equipo sin año', () => {
    const year = summarizeRider(entry({}), parsed(), page('sha-5'), { year: '2026' });
    expect(year.team).toEqual({ teamName: 'ROOJAI RIDING', teamCode: 'ROO' });
    const absent = summarizeRider(entry({}), parsed(), page('sha-6'), { year: 2025 });
    expect(absent.team).toBeNull();
    const noYear = summarizeRider(entry({}), parsed(), page('sha-7'), {});
    expect(noYear.team).toBeNull();
    expect(noYear).not.toHaveProperty('checks');
  });

  it('consulta la ficha por corredor y marca missing-id y not-found sin interrumpir el lote', async () => {
    const pages = {
      '/rider-details/1': riderPage({ givenName: 'Ali', familyName: 'LABIB', dob: '21.09.2002', nationality: 'IRI',
        history: [{ teamName: 'TIANYOUDE', teamCode: 'TYD', countryCode: 'CHN', url: '/team-details/25001', year: '2026' }] }),
    };
    const collector = { get: async path => {
      if (!pages[path]) throw new Error(path.endsWith('/3') ? 'uci_denied_403' : 'uci_http_404');
      return { text: pages[path], sha256: `sha-${path}` };
    } };
    const results = await verifyRiders([
      { dorsal: '176', uciProfileId: '1', expect: { birthDate: '2002-09-21', countryCode: 'ir' } },
      { dorsal: '12' },
      { dorsal: '13', uciProfileId: '2' },
    ], { collector, year: 2026 });
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ dorsal: '176', status: 'verified', birthDate: '2002-09-21', countryCode: 'ir',
      team: { teamName: 'TIANYOUDE' }, checks: { birthDate: true, countryCode: true } });
    expect(results[1]).toMatchObject({ dorsal: '12', uciProfileId: null, status: 'missing-id' });
    expect(results[2]).toMatchObject({ dorsal: '13', uciProfileId: '2', status: 'not-found' });
  });

  it('propaga el fallo duro con los resultados parciales acumulados', async () => {
    const collector = { get: async path => {
      if (path.endsWith('/7')) throw new Error('uci_rate_limited');
      return { text: riderPage({ givenName: 'Ana', familyName: 'GARCIA', dob: '01.02.2000', nationality: 'ESP' }), sha256: 'sha-x' };
    } };
    await expect(verifyRiders([{ dorsal: '1', uciProfileId: '7' }, { dorsal: '2', uciProfileId: '8' }], { collector }))
      .rejects.toMatchObject({ message: 'uci_rate_limited', results: [] });
    expect(() => parseRider('sin modulo')).toThrow('missing_rider_module');
  });
});
