import { describe, expect, it } from 'vitest';
import {
  normalizeStartlistSource,
  normalizePersonName,
  saveEnrichedStartlist,
  hasAssignedStartlistDorsals,
  loadCompleteStartlistCatalog,
  orderStartlistTeamsForSave,
  selectUpcomingStartlistRaces,
} from '../startlist/import.js';

const source = () => ({ raceId: 'vuelta-2026', expectedRiderCount: 1, sourceUrl: 'https://official.test/list',
  teams: [{ teamName: 'Equipo Uno', teamId: 'equipo-uno', riders: [{ dorsal: '001', firstName: 'ANA', lastName: 'GARCÍA',
    countryCode: 'ES', birthDate: '2000-02-29', globalRiderId: 'ana-garcia', uciProfileId: '123', sourceUrl: 'https://official.test/rider' }] }] });

describe('importación enriquecida compartida con el panel', () => {
  it('conserva la información de identidad, fecha y fuente sin fabricar metadatos', () => {
    const parsed = normalizeStartlistSource(source());
    expect(parsed).toMatchObject({ raceId: 'vuelta-2026', sourceUrl: 'https://official.test/list', expectedRiderCount: 1 });
    expect(parsed.teams[0]).toMatchObject({ teamId: 'equipo-uno', riders: [{ dorsal: 1, firstName: 'Ana', lastName: 'García',
      countryCode: 'es', birthDate: '2000-02-29', globalRiderId: 'ana-garcia', uciProfileId: '123', sourceUrl: 'https://official.test/rider' }] });
    expect(normalizePersonName("  anna   VAN-DER-breggen ")).toBe('Anna Van-Der-Breggen');
    const missing = source(); delete missing.teams[0].riders[0].birthDate;
    expect(normalizeStartlistSource(missing).teams[0].riders[0]).not.toHaveProperty('birthDate');
  });

  it('conserva equipos provisionales aunque todavía no tengan corredores', () => {
    const provisional = source();
    provisional.teams.push({ teamName: 'Equipo pendiente', isConfirmed: false, riders: [] });

    expect(normalizeStartlistSource(provisional).teams[1]).toEqual({
      teamName: 'Equipo pendiente',
      isConfirmed: false,
      riders: [],
    });
  });

  it('rechaza el contrato mínimo y los recuentos sin contrastar', () => {
    const minimal = source(); minimal.teams[0].riders = [{ dorsal: '1', riderName: 'Ana GARCÍA' }];
    expect(() => normalizeStartlistSource(minimal)).toThrow();
    const noCount = source(); delete noCount.expectedRiderCount;
    expect(() => normalizeStartlistSource(noCount)).toThrow();
    const duplicate = source(); duplicate.teams[0].riders.push({ ...duplicate.teams[0].riders[0], dorsal: 1 });
    expect(() => normalizeStartlistSource(duplicate)).toThrow('duplicado');
  });

  it('admite varios corredores sin dorsal y conserva sus identificadores de fila', () => {
    const withoutBibs = {
      raceId: 'mundial-2026',
      expectedRiderCount: 2,
      teams: [{
        teamName: 'Austria',
        riders: [
          { rowKey: 'row-1', startlistRiderId: 'sl-1', dorsal: '', firstName: 'Felix', lastName: 'Gall' },
          { rowKey: 'row-2', startlistRiderId: 'sl-2', dorsal: 0, firstName: 'Patrick', lastName: 'Konrad' },
        ],
      }],
    };

    expect(normalizeStartlistSource(withoutBibs).teams[0].riders).toEqual([
      expect.objectContaining({ rowKey: 'row-1', startlistRiderId: 'sl-1', dorsal: 0 }),
      expect.objectContaining({ rowKey: 'row-2', startlistRiderId: 'sl-2', dorsal: 0 }),
    ]);
  });

  it('conserva el orden manual sin dorsales y ordena por dorsal cuando existen', () => {
    const manual = [
      { teamName: 'Norway', riders: [{ dorsal: '' }] },
      { teamName: 'Austria', riders: [{ dorsal: 0 }] },
    ];
    expect(hasAssignedStartlistDorsals(manual)).toBe(false);
    expect(orderStartlistTeamsForSave(manual).map(team => team.teamName)).toEqual(['Norway', 'Austria']);

    const numbered = [
      { teamName: 'Norway', riders: [{ dorsal: 21 }] },
      { teamName: 'Austria', riders: [{ dorsal: 1 }] },
      { teamName: 'Canada', riders: [{ dorsal: '' }] },
    ];
    expect(hasAssignedStartlistDorsals(numbered)).toBe(true);
    expect(orderStartlistTeamsForSave(numbered).map(team => team.teamName)).toEqual(['Austria', 'Norway', 'Canada']);
  });

  it('prepara y aplica en dos llamadas, con el mismo documento validado', async () => {
    const calls = [];
    const rpc = async (name, args) => { calls.push({ name, args }); return { data: name === 'prepare_startlist_import'
      ? { importId: 'job', ready: true, status: 'prepared' } : { status: 'applied', riders: 1 } }; };
    const result = await saveEnrichedStartlist(rpc, source(), false);
    expect(result.report.status).toBe('applied');
    expect(calls.map(c => c.name)).toEqual(['prepare_startlist_import', 'apply_startlist_import']);
    expect(calls[0].args.p_document).toEqual(normalizeStartlistSource(source()));
    expect(calls[1].args).toEqual({ p_import_id: 'job' });
  });

  it('conserva el identificador antes de aplicar y reintenta sin repetir la preparación', async () => {
    let saved;
    const names = [];
    const rpc = async name => {
      names.push(name);
      if (name === 'prepare_startlist_import') return { data: { importId: 'job', ready: true } };
      if (names.length === 2) throw Error('Respuesta perdida');
      return { data: { status: 'applied', alreadyApplied: true } };
    };
    await expect(saveEnrichedStartlist(rpc, source(), false, null, p => { saved = p; })).rejects.toThrow('Respuesta perdida');
    const result = await saveEnrichedStartlist(rpc, source(), false, saved);
    expect(names).toEqual(['prepare_startlist_import', 'apply_startlist_import', 'apply_startlist_import']);
    expect(result.report.alreadyApplied).toBe(true);
  });

  it('devuelve excepciones sin aplicar y vuelve a preparar después de editar', async () => {
    const calls = [];
    const rpc = async (name, args) => { calls.push(args); return { data: { importId: 'job', ready: false, status: 'prepared', issues: [{ code: 'MISSING_BIRTH_DATE' }] } }; };
    const first = await saveEnrichedStartlist(rpc, source(), false);
    expect(calls).toHaveLength(1);
    expect(first.report.issues).toHaveLength(1);
    const edited = source(); edited.teams[0].riders[0].birthDate = '2001-01-01';
    await saveEnrichedStartlist(rpc, edited, false, first.prepared);
    expect(calls[1].p_document.teams[0].riders[0].birthDate).toBe('2001-01-01');
  });

  it('ofrece desde hoy y ordena las carreras por fecha de inicio ascendente', () => {
    const races = [
      { id: 'sin-fecha', name: 'Sin fecha' },
      { id: 'ayer', name: 'Ayer', startDate: '2026-08-21' },
      { id: 'pasado-b', name: 'B', startDate: '2026-08-24' },
      { id: 'hoy', name: 'Hoy', startDate: '2026-08-22' },
      { id: 'manana', name: 'Mañana', startDate: '2026-08-23' },
      { id: 'pasado-a', name: 'A', startDate: '2026-08-24' },
    ];

    expect(selectUpcomingStartlistRaces(races, '2026-08-22').map(race => race.id)).toEqual([
      'hoy',
      'manana',
      'pasado-a',
      'pasado-b',
    ]);
  });
});


describe('catálogos completos del panel', () => {
  it('recupera equipos y alias posteriores al límite de PostgREST', async () => {
    const rows = Array.from({ length: 1755 }, (_, id) => ({ id: String(id) }));
    const pages = [];
    const result = await loadCompleteStartlistCatalog(async (from, to, count) => {
      pages.push([from, to, count]);
      return { data: rows.slice(from, to + 1), count: count ? rows.length : null };
    });
    expect(result).toEqual(rows);
    expect(pages).toEqual([[0, 999, true], [1000, 1999, false]]);
  });

  it('no presenta un catálogo parcial como evidencia de ausencia', async () => {
    const first = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
    await expect(loadCompleteStartlistCatalog(async from => from === 0
      ? { data: first, count: 1001 } : { error: Error('red') })).rejects.toThrow('red');
    await expect(loadCompleteStartlistCatalog(async from => from === 0
      ? { data: first, count: 1001 } : { data: [first[0]] })).rejects.toThrow('catálogo cambió');
  });
});
