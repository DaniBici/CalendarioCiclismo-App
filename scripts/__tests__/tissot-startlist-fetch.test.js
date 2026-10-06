import { describe, it, expect } from 'vitest';
import {
  splitDisplayName, startTimeOf, buildStartOrder, buildTeamStartOrder, normalizeTeams,
} from '../results-fetchers/tissot-startlist-fetch.mjs';
import {
  titleCase, buildNormalizedDocument, resolveContext,
} from '../results-fetchers/tissot-startlists-sync.mjs';

// Formas verificadas contra el Mundial de Kigali 2025 (crdwch2025) y el Tour de
// Suiza 2026 (tds2026). Contrato de endpoints en TISSOT-TIMING-API.md.

describe('splitDisplayName — "APELLIDO Nombre" con partículas', () => {
  it('separa el apellido en mayúsculas del nombre', () => {
    expect(splitDisplayName('EVENEPOEL Remco')).toEqual({ firstName: 'Remco', lastName: 'EVENEPOEL' });
    expect(splitDisplayName('PIDCOCK Thomas')).toEqual({ firstName: 'Thomas', lastName: 'PIDCOCK' });
  });
  it('absorbe partículas intercaladas en el apellido', () => {
    expect(splitDisplayName('van WILDER Ilan')).toEqual({ firstName: 'Ilan', lastName: 'van WILDER' });
    expect(splitDisplayName('DE LA CRUZ David')).toEqual({ firstName: 'David', lastName: 'DE LA CRUZ' });
  });
  it('sin token en mayúsculas, no inventa apellido', () => {
    expect(splitDisplayName('Remco Evenepoel')).toEqual({ firstName: 'Remco Evenepoel', lastName: '' });
  });
});

describe('startTimeOf / buildStartOrder — orden de salida de una CRI', () => {
  it('solo acepta horas HH:MM[:SS]', () => {
    expect(startTimeOf({ value: '14:57:00' })).toBe('14:57:00');
    expect(startTimeOf({ value: '14:57' })).toBe('14:57');
    expect(startTimeOf({ value: '' })).toBeNull();
    expect(startTimeOf({ value: '+0:17' })).toBeNull(); // un gap no es hora de salida
    expect(startTimeOf({ value: '1:25:26' })).toBe('1:25:26'); // también H:MM:SS local
  });
  it('ordena por rank y descarta filas sin hora (línea)', () => {
    const rows = [
      { rank: 2, value: '14:58:00', rider: { bib: 84, name: 'ORN-KRISTOFF Felix' } },
      { rank: 0, value: '', rider: { bib: 1, name: 'POGAČAR Tadej' } },
      { rank: 1, value: '14:57:00', rider: { bib: 191, name: 'BRENNER Marco' } },
    ];
    expect(buildStartOrder(rows)).toEqual([
      { order: 1, bib: 191, startTime: '14:57:00', displayName: 'BRENNER Marco' },
      { order: 2, bib: 84, startTime: '14:58:00', displayName: 'ORN-KRISTOFF Felix' },
    ]);
  });
});

describe('normalizeTeams — /teams de un Mundial', () => {
  it('descarta miembros sin dorsal y conserva nación y UCI ID', () => {
    const teams = normalizeTeams([{ name: 'BELGIUM', nation: 'BEL', members: [
      { bib: 1, name: 'EVENEPOEL Remco', nation: 'BEL', uciRiderId: '10058736615' },
      { bib: 0, name: 'Sin dorsal', nation: 'BEL', uciRiderId: 'x' },
    ] }]);
    expect(teams).toEqual([{ tissotName: 'BELGIUM', nation: 'BEL', riders: [
      { bib: 1, displayName: 'EVENEPOEL Remco', nation: 'BEL', uciRiderId: '10058736615' },
    ] }]);
  });
});

describe('titleCase', () => {
  it('normaliza nombres en mayúsculas de Tissot', () => {
    expect(titleCase('BELGIUM')).toBe('Belgium');
    expect(titleCase('UNITED STATES')).toBe('United States');
    expect(titleCase('GUINEA-BISSAU')).toBe('Guinea-Bissau');
  });
});

describe('buildNormalizedDocument — prioridad de resolución de equipo', () => {
  const doc = { raceId: 'r1', sourceUrl: 'u', riders: [
    { bib: 1, firstName: 'Remco', lastName: 'EVENEPOEL', nation: 'BEL', uciRiderId: '100', teamHint: 'BELGIUM' },
    { bib: 2, firstName: 'Sin', lastName: 'FICHA', nation: 'BEL', uciRiderId: '999', teamHint: 'BELGIUM' },
    { bib: 3, firstName: 'X', lastName: 'Y', nation: 'CZE', uciRiderId: '300', teamHint: 'CZECHIA' },
    { bib: 4, firstName: 'Nuevo', lastName: 'PAIS', nation: 'XXX', uciRiderId: null, teamHint: null },
  ] };
  const ctx = {
    gender: 'male',
    riderByUci: new Map([
      ['100', { id: 'g1', firstName: 'Remco', lastName: 'Evenepoel', countryCode: 'be', gender: 'male', uciProfileId: '1234' }],
      ['300', { id: 'g3', firstName: 'X', lastName: 'Y', countryCode: 'cz', gender: 'male' }],
    ]),
    teamByGlobalId: new Map([['g1', { teamName: 'Belgium', teamId: 't_be' }]]),
    teamByCountry: new Map([['cz', { teamName: 'Czech Republic', teamId: 't_cz' }]]),
  };

  it('prioriza ficha→equipo existente, luego país, luego pista de Tissot', () => {
    const out = buildNormalizedDocument(doc, ctx);
    expect(out.expectedRiderCount).toBe(4);
    const byName = new Map(out.teams.map((t) => [t.teamName, t]));
    expect(byName.get('Belgium').teamId).toBe('t_be');
    expect(byName.get('Belgium').riders.find((r) => r.dorsal === 1)).toMatchObject({
      globalRiderId: 'g1', firstName: 'Remco', lastName: 'Evenepoel', countryCode: 'be', uciProfileId: '1234',
    });
    // Dorsal 2 no tiene ficha: cae a la pista de Tissot ("BELGIUM" → "Belgium").
    expect(byName.get('Belgium').riders.find((r) => r.dorsal === 2)).toMatchObject({ globalRiderId: null });
    // Dorsal 3 resuelto por país → selección canónica Czech Republic, no "Czechia".
    expect(byName.get('Czech Republic')).toBeTruthy();
    expect(byName.get('Czech Republic').riders[0]).toMatchObject({ globalRiderId: 'g3', countryCode: 'cz' });
    // Dorsal 4 sin ficha ni país: equipo de respaldo con el nombre de Tissot.
    expect(out.teams.some((t) => t.riders.some((r) => r.dorsal === 4))).toBe(true);
  });
});

describe('buildNormalizedDocument — relevo mixto (ambos sexos en la misma selección)', () => {
  // El relevo mixto de Tissot (/teams) trae 3 hombres + 3 mujeres por selección
  // sin campo de género: se resuelve la ficha por UCI ID en riders_men/women y se
  // marca riderGender. La selección reutiliza el teamId nacional ya existente.
  const doc = { raceId: 'cre', sourceUrl: 'u', gender: null, riders: [
    { bib: 1, firstName: 'Michael', lastName: 'MATTHEWS', nation: 'AUS', uciRiderId: 'm1', teamHint: 'AUSTRALIA' },
    { bib: 4, firstName: 'Amanda', lastName: 'SPRATT', nation: 'AUS', uciRiderId: 'w1', teamHint: 'AUSTRALIA' },
  ] };
  const ctx = {
    gender: null,
    riderByUci: new Map([
      ['m1', { id: 'g-m', firstName: 'Michael', lastName: 'Matthews', countryCode: 'au', gender: 'male' }],
      ['w1', { id: 'g-w', firstName: 'Amanda', lastName: 'Spratt', countryCode: 'au', gender: 'female' }],
    ]),
    teamByGlobalId: new Map([
      ['g-m', { teamName: 'Australia', teamId: 'team_ntm_australia' }],
      ['g-w', { teamName: 'Australia', teamId: 'team_ntm_australia' }],
    ]),
    teamByCountry: new Map(),
  };

  it('agrupa ambos sexos en la misma selección y marca riderGender', () => {
    const out = buildNormalizedDocument(doc, ctx);
    expect(out.teams).toHaveLength(1);
    expect(out.teams[0]).toMatchObject({ teamName: 'Australia', teamId: 'team_ntm_australia' });
    const byBib = new Map(out.teams[0].riders.map((r) => [r.dorsal, r]));
    expect(byBib.get(1).riderGender).toBe('male');
    expect(byBib.get(4).riderGender).toBe('female');
  });
});

describe('resolveContext — catálogo y dorsal contrastado', () => {
  const sandra = { dorsal: 54, id: 'alonso-sandra', firstName: 'Sandra', lastName: 'Alonso',
    otherNames: 'Sandra Alonso Domínguez', countryCode: 'es', uciProfileId: '111544',
    uciLicenseId: null, gender: 'female', aliases: ['alonso-dominguez-sandra'] };
  const source = { bib: 54, firstName: 'Sandra', lastName: 'ALONSO DOMINGUEZ',
    nation: 'ESP', uciRiderId: '10009637737', teamHint: 'SPAIN' };
  async function context(roster = [sandra], licenseRows = []) {
    const calls = [];
    const client = { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('join lateral')) return { rows: roster };
      if (sql.includes('public.startlist_teams')) return { rows: [{ g: sandra.id, c: 'es', n: 'Spain', t: 'esp' }] };
      return { rows: sql.includes('riders_women') ? licenseRows : [] };
    } };
    return { ctx: await resolveContext(client, 'relay', null, [source.uciRiderId]), calls };
  }
  const rowFor = (ctx, rider = source) => buildNormalizedDocument({ riders: [rider] }, ctx).teams[0].riders[0];
  it('consulta nationality y licencia, y conserva el perfil corto mediante la identidad de la lista', async () => {
    const { ctx, calls } = await context();
    const catalogueQueries = calls.filter(c => !c.sql.includes('join'));
    expect(catalogueQueries).toHaveLength(2);
    for (const call of catalogueQueries) {
      expect(call.sql).toContain('nationality');
      expect(call.sql).toContain('where "uciLicenseId" = any($1)');
      expect(call.sql).not.toContain('"countryCode"');
    }
    expect(rowFor(ctx)).toMatchObject({ globalRiderId: 'alonso-sandra', lastName: 'Alonso',
      riderGender: 'female', countryCode: 'es', uciProfileId: '111544' });
  });
  it('no reutiliza un dorsal sustituido, de otro país o con licencia incompatible', async () => {
    const { ctx } = await context();
    for (const rider of [{ ...source, firstName: 'Otra' }, { ...source, nation: 'FRA' }]) {
      expect(rowFor(ctx, rider)).toMatchObject({ globalRiderId: null, uciProfileId: null });
    }
    const incompatible = await context([{ ...sandra, uciLicenseId: '10000000000' }]);
    expect(rowFor(incompatible.ctx).globalRiderId).toBeNull();
  });
  it('mantiene sin resolver un dorsal con dos identidades compatibles', async () => {
    const { ctx } = await context([sandra, { ...sandra, id: 'another', gender: 'male' }]);
    expect(rowFor(ctx)).toMatchObject({ globalRiderId: null, uciProfileId: null });
  });
  it('resuelve una licencia aunque no exista todavía en la lista y no la copia como perfil UCI', async () => {
    const { ctx } = await context([], [{ u: source.uciRiderId, p: '111544', id: sandra.id, f: 'Sandra', l: 'Alonso', c: 'es' }]);
    expect(rowFor(ctx)).toMatchObject({ globalRiderId: sandra.id, uciProfileId: '111544', riderGender: 'female' });
  });
});

describe('buildTeamStartOrder — CRE por equipos', () => {
  const rows = [
    { rank: 1, value: '13:45:00', team: { name: 'BENIN' } },
    { rank: 2, value: '13:49:00', team: { name: 'UGANDA' } },
    { rank: 0, value: '', rider: { bib: 1, name: 'POGAČAR Tadej' } },
    { rank: 3, value: '', rider: { bib: 2, name: 'X' } },
  ];
  it('emite order/teamName/startTime solo de filas de equipo', () => {
    expect(buildTeamStartOrder(rows)).toEqual([
      { order: 1, teamName: 'BENIN', startTime: '13:45:00' },
      { order: 2, teamName: 'UGANDA', startTime: '13:49:00' },
    ]);
  });
});
