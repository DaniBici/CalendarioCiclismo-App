import { describe, expect, it } from 'vitest';
import {
  RESULTADOS_MAX_READS, candidateRaces, fillSlots, localClient, madridDay, parseScope, raceData, racesToRead, requestedFromPath,
  rotationDays, validatePage,
} from '../../tools/site/prerender-resultados.mjs';

const NAV = ['/', '/resultados/'];
const header = `<header class="site-header" id="siteHeader" data-back>${NAV.map(href => `<a class="primary-nav__main" href="${href}">x</a>`).join('')}</header>`;
const rows = count => Array.from({ length: count }, (_, at) => `<tr class="so-row" data-team="E"><td>${at + 1}</td></tr>`).join('');

describe('ámbito', () => {
  it('acepta off y es; sin valor, off', () => {
    expect(parseScope(undefined)).toBe('off');
    expect(parseScope(' es ')).toBe('es');
    expect(() => parseScope('all')).toThrow(/no admitido/);
  });

  it('candidatas: con clasificaciones, con año no archivado y fuera de la ventana de sondeo', () => {
    const now = new Date(2026, 9, 22, 12);
    const races = [
      { id: 'r1', year: 2026, startDate: '2026-10-10', endDate: '2026-10-15' },
      { id: 'r2', year: 2026, startDate: '2026-10-19', endDate: '2026-10-21' },
      { id: 'r3', year: 2025, startDate: '2025-05-01', endDate: '2025-05-02' },
      { id: 'r4', year: null, startDate: '2026-05-01', endDate: '2026-05-02' },
      { id: 'r5', year: 2026, startDate: '2026-05-01', endDate: '2026-05-02' },
    ];
    const stages = ['r1', 'r2', 'r3', 'r4'].map(raceId => ({ raceId }));
    expect(candidateRaces(races, stages, now)).toEqual(['r1']);
  });

  it('lecturas por prioridad y con el corte en el máximo', () => {
    const races = new Map([
      ['viejo', { endDate: '2026-03-01' }], ['nuevo', { startDate: '2026-10-01', endDate: '2026-10-05' }],
      ['sin-fin', { startDate: '2026-09-01' }], ['sin-fechas', {}], ['al-dia', { endDate: '2026-10-10' }],
      ['rotada', { endDate: '2026-10-12' }], ['mas-rotada', { endDate: '2026-01-01' }], ['otra-firma', { endDate: '2026-06-01' }],
    ]);
    const candidates = [...races.keys()];
    const sigs = Object.fromEntries(candidates.map(id => [id, `s-${id}`]));
    const daysAgo = days => new Date(Date.UTC(2026, 9, 22) - days * 86400000).toISOString().slice(0, 10);
    const cache = {
      'al-dia': { sig: 's-al-dia', fetched: daysAgo(3) },
      rotada: { sig: 's-rotada', fetched: daysAgo(rotationDays('rotada')) },
      'mas-rotada': { sig: 's-mas-rotada', fetched: daysAgo(50) },
      'otra-firma': { sig: 'antigua', fetched: daysAgo(1) },
    };
    const all = ['nuevo', 'sin-fin', 'otra-firma', 'viejo', 'sin-fechas', 'mas-rotada', 'rotada'];
    expect(racesToRead(candidates, sigs, cache, '2026-10-22', races)).toEqual({ read: all, pending: [] });
    expect(racesToRead(candidates, sigs, cache, '2026-10-22', races, 2)).toEqual({ read: all.slice(0, 2), pending: all.slice(2) });
    expect(racesToRead(candidates, sigs, cache, '2026-10-22', races, 0)).toEqual({ read: [], pending: all });
    expect(racesToRead(candidates, sigs, {}, '2026-10-22', races, RESULTADOS_MAX_READS).read)
      .toEqual(['rotada', 'al-dia', 'nuevo', 'sin-fin', 'otra-firma', 'viejo', 'mas-rotada', 'sin-fechas']);
  });

  it('día de Madrid', () => {
    expect(madridDay(new Date('2026-10-21T22:30:00Z'))).toBe('2026-10-22');
    expect(madridDay(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
  });

  it('clave pedida por la ruta, como js/resultados.js', () => {
    expect(requestedFromPath(undefined)).toEqual({ requestedKey: undefined, requestedStage: undefined, stageSuffixParam: '' });
    expect(requestedFromPath('prologo')).toEqual({ requestedKey: '0', requestedStage: 0, stageSuffixParam: '' });
    expect(requestedFromPath('etapa-3a')).toEqual({ requestedKey: '3A', requestedStage: 3, stageSuffixParam: 'A' });
    expect(requestedFromPath('etapa-12')).toEqual({ requestedKey: '12', requestedStage: 12, stageSuffixParam: '' });
  });
});

describe('página generada', () => {
  const skeleton = '<div class="res-tabs__status" id="resStatusSlot"></div><div class="res-tabs__filter" id="resTeamFilterSlot"></div>'
    + '<div class="res-publication" id="resPublication" aria-live="polite"></div><div class="res-table-wrap" id="resTableWrap"></div>';

  it('rellena cada hueco con su huella y la tabla recortada con data-rows, sin interpretar «$»', () => {
    const html = fillSlots(skeleton, {
      status: { html: '' }, filter: null, publication: { html: '<p>Oficial $& $1</p>' }, table: { html: `<table><tbody>${rows(2)}</tbody></table>`, rows: 20 },
    }, value => `h${value.length}`);
    expect(html).toContain('<div class="res-tabs__status" id="resStatusSlot" data-prerendered="h0"></div>');
    expect(html).toContain('<div class="res-tabs__filter" id="resTeamFilterSlot"></div>');
    expect(html).toContain('id="resPublication" aria-live="polite" data-prerendered="h20"><p>Oficial $& $1</p></div>');
    expect(html).toContain('id="resTableWrap" data-prerendered="h');
    expect(html).toContain('data-rows="20"><table>');
    expect(() => fillSlots('<main></main>', { table: { html: '' } }, String)).toThrow(/hueco table/);
  });

  it('valida enlaces, cabecera, filas de la tabla y tamaño', () => {
    const page = `${header}<main><div id="resTableWrap"><table><tbody>${rows(20)}</tbody></table></div><aside><table>${rows(1)}</table></aside></main>`;
    expect(validatePage(page, { rows: 20, navHrefs: NAV })).toEqual([]);
    expect(validatePage(page, { rows: 19, navHrefs: NAV })).toEqual(['20 filas en la tabla de 19']);
    expect(validatePage(`${header}<div id="resTableWrap"><div class="res-cancelled-note"></div></div>`, { rows: 0, navHrefs: NAV })).toEqual([]);
    const bad = validatePage(`<header class="site-header" id="siteHeader"></header><a href="/resultados/undefined/">x</a>`, { rows: 0, navHrefs: NAV });
    expect(bad).toEqual(['href con undefined o null: /resultados/undefined/', 'enlaces de vistas de la cabecera: ninguno (esperados / /resultados/)']);
    expect(validatePage(`${header}${'x'.repeat(48 * 1024)}`, { rows: 0, navHrefs: NAV })[0]).toMatch(/bytes \(máximo 49152\)/);
  });
});

describe('datos', () => {
  it('cliente local: select, in y eq con las filas leídas', async () => {
    const client = localClient({ riders_men: [{ id: 'a', firstName: 'A', currentTeamId: 't' }, { id: 'b', firstName: 'B' }],
      team_seasons: [{ teamId: 't', year: 2026, name: 'T26' }, { teamId: 't', year: 2025, name: 'T25' }] });
    expect(await client.from('riders_men').select('id, firstName').in('id', ['b', 'x', 'b'])).toEqual({ data: [{ id: 'b', firstName: 'B' }], error: null });
    expect((await client.from('team_seasons').select('teamId,name').in('teamId', ['t']).eq('year', 2026)).data).toEqual([{ teamId: 't', name: 'T26' }]);
    expect((await client.from('teams').select('id').in('id', ['t'])).data).toEqual([]);
  });

  it('por carrera: filas por sortOrder con el desempate de llegada y la parte del catálogo que pueden pedir', () => {
    const index = { races: new Map([['r1', { id: 'r1', year: 2026 }]]), stagesByRace: new Map([['r1', [{ id: 's1' }, { id: 's2' }]]]) };
    const data = raceData({
      resultados_riders: [{ raceId: 'r1', dorsal: 1 }, { raceId: 'r2', dorsal: 2 }],
      resultados_teams: [{ id: 'st', raceId: 'r1', teamId: 't1' }],
      resultados_results: [
        { stageRef: 's1', sortOrder: 2, globalRiderId: 'g1' }, { stageRef: 's1', sortOrder: 1, globalRiderId: 'g2', teamId: 't3' },
        { stageRef: 's1', sortOrder: 1, globalRiderId: null }, { stageRef: 's9', sortOrder: 0 },
      ],
      resultados_riders_men: [{ id: 'g1', currentTeamId: 't2' }, { id: 'g9' }],
      resultados_riders_women: [{ id: 'g2', currentTeamId: null }],
      resultados_team_list: [{ id: 't2' }, { id: 't3' }, { id: 't4' }],
      resultados_team_seasons: [{ teamId: 't2', year: 2026 }, { teamId: 't2', year: 2025 }, { teamId: 't4', year: 2026 }],
    }, ['r1'], index).get('r1');
    expect(data.riders).toEqual([{ dorsal: 1 }]);
    expect(data.teams).toEqual([{ id: 'st', teamId: 't1' }]);
    expect(data.results.s1.map(row => [row.sortOrder, row.globalRiderId])).toEqual([[1, 'g2'], [1, null], [2, 'g1']]);
    expect(data.results.s2).toEqual([]);
    expect(data.catalog.riders_men).toEqual([{ id: 'g1', currentTeamId: 't2' }]);
    expect(data.catalog.riders_women).toEqual([{ id: 'g2', currentTeamId: null }]);
    expect(data.catalog.teams.map(team => team.id).sort()).toEqual(['t2', 't3']);
    expect(data.catalog.team_seasons).toEqual([{ teamId: 't2', year: 2026 }]);
  });
});
