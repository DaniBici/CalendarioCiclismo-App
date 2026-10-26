import { describe, expect, it } from 'vitest';
import { PERFIL_DAY_COLUMNS, PERFIL_SIBLING_COLUMNS, STAGE_PAGE_RACE_COLUMNS } from '../../js/services/races.js';
import { TYPES, buildIndex, ordenScope, pageInputs, parseScope, prerenderPage, summarize, validatePage } from '../../tools/site/prerender-auxiliares.mjs';
import { composePage } from '../../tools/site/prerender-jornadas.mjs';

const NAV = ['/', '/resultados/'];
const header = hrefs => `<header class="site-header" id="siteHeader" data-back>${hrefs.map(href => `<a class="primary-nav__main" href="${href}">x</a>`).join('')}</header>`;
const page = (id, container) => `<html><head><meta name="cc:race-day-id" content="${id}"></head><body>`
  + `<header class="site-header" id="siteHeader" data-back></header><main id="${container}" class="pfe-wrap">bloque</main></body></html>`;
const day = (id, raceId, extra = {}) => ({ id, raceId, dateKey: '2026-09-20', stageNumber: null, slug: id, extraColumn: 'x', ...extra });
const race = (id, extra = {}) => ({ id, raceFormat: 'stage_race', year: 2026, privateNote: 'x', ...extra });

describe('ámbito del interruptor', () => {
  it('off, es (los tres tipos) o una lista de tipos en el orden de TYPES', () => {
    expect(parseScope(undefined)).toEqual([]);
    expect(parseScope(' off ')).toEqual([]);
    expect(parseScope('es')).toEqual(['perfil', 'mapa', 'orden']);
    expect(parseScope('orden, perfil')).toEqual(['perfil', 'orden']);
    expect(() => parseScope('all')).toThrow(/no admitido/);
    expect(() => parseScope('perfil,inscritos')).toThrow(/no admitido/);
  });
});

describe('lecturas del orden de salida', () => {
  it('jornadas con orden importado y sus carreras por año, sin año al final del recorrido', () => {
    const days = [day('d1', 'r1', { startOrderImportedAt: 't' }), day('d2', 'r2'), day('d3', 'r3', { startOrderImportedAt: 't' }),
      day('d4', 'r1', { startOrderImportedAt: 't' }), day('d5', null, { startOrderImportedAt: 't' })];
    const { dayIds, byYear } = ordenScope(days, [race('r1'), race('r2'), race('r3', { year: null })]);
    expect(dayIds).toEqual(['d1', 'd3', 'd4', 'd5']);
    expect([...byYear]).toEqual([[2026, ['r1']], [null, ['r3']]]);
  });
});

describe('datos de cada página', () => {
  const index = buildIndex({
    races: [race('r'), race('uno', { raceFormat: 'one_day' })],
    days: [
      day('s2', 'r', { stageNumber: 2, elevationProfile: {}, routeGpxUrl: 'https://x/2.gpx', neutralStartTimeUtc: 'a' }),
      day('s1b', 'r', { stageNumber: 1, dateKey: '2026-09-19' }),
      day('s1a', 'r', { stageNumber: 1, dateKey: '2026-09-19' }),
      day('s0', 'r', { stageNumber: null, dateKey: '2026-09-18' }),
      day('nv', 'r', { stageNumber: 3, profileNotViewable: true }),
      day('u', 'uno', { startOrderImportedAt: 't' }),
    ],
    assets: [{ id: 'a2', raceDayId: 's2', type: 'map' }, { id: 'a1', raceDayId: 's2', type: 'profile' }],
    guides: [
      { id: 'g2', type: 'technicalGuide', race_days: { raceId: 'r', dateKey: '2026-09-20' } },
      { id: 'g1', type: 'technicalGuide', race_days: { raceId: 'r', dateKey: '2026-09-18' } },
    ],
    orden_entries: [{ id: 'e2', raceDayId: 'u', sortOrder: 1 }, { id: 'x', raceDayId: 's2', sortOrder: 1 }, { id: 'e1', raceDayId: 'u', sortOrder: 2 }],
    orden_teams: [{ raceId: 'uno', teamId: 't1' }, { raceId: 'r', teamId: 't2' }],
  });

  it('perfil: solo las columnas que lee la página y hermanas por etapa y fecha, con empate por llegada', () => {
    const input = pageInputs('perfil', index, 's2');
    expect(Object.keys(input.rd).sort()).toEqual(PERFIL_DAY_COLUMNS.split(',').sort());
    expect(Object.keys(input.race).sort()).toEqual(STAGE_PAGE_RACE_COLUMNS.split(',').sort());
    expect(input.siblings.map(sibling => sibling.id)).toEqual(['s0', 's1b', 's1a', 's2', 'nv']);
    expect(Object.keys(input.siblings[0]).sort()).toEqual(PERFIL_SIBLING_COLUMNS.split(',').sort());
    expect(input.assets.map(asset => asset.id)).toEqual(['a2', 'a1']);
    expect(input.guide).toEqual({ id: 'g1', type: 'technicalGuide' });
  });

  it('carrera de un día sin hermanas; orden de salida con sus filas en orden de llegada y los equipos de la carrera', () => {
    expect(pageInputs('perfil', index, 'u').siblings).toEqual([]);
    const input = pageInputs('orden', index, 'u');
    expect(input.entries.map(entry => entry.id)).toEqual(['e2', 'e1']);
    expect(input.startlistRows).toEqual([{ raceId: 'uno', teamId: 't1' }]);
    expect(input.rd.extraColumn).toBe('x');
  });

  it('avisos en lugar del contenido: perfil no visible, jornada sin mapa, sin filas de orden', () => {
    expect(pageInputs('perfil', index, 'nv').notice).toBe('profile.notAvailable');
    expect(pageInputs('mapa', index, 's1a').notice).toBe('map.notAvailable');
    expect(pageInputs('mapa', index, 's2').notice).toBeUndefined();
    expect(pageInputs('orden', index, 's1a').notice).toBe('orden');
    expect(pageInputs('orden', index, 'desconocida')).toEqual({ reason: 'sin datos' });
  });
});

describe('página', () => {
  const index = buildIndex({ races: [race('r')], days: [day('d', 'r', { routeGpxUrl: 'https://x/a.gpx' })] });
  const render = () => ({ html: '<div>contenido</div><div class="cc-map-wrap" id="ccRouteMapWrap"></div>', headerInner: header(NAV) });
  const options = { type: 'mapa', index, render, navHrefs: NAV, fingerprint: () => 'f' };

  it('escribe el contenedor del tipo conservando sus atributos y la cabecera', () => {
    const outcome = prerenderPage(page('d', 'mapaEtapaContent'), options);
    expect(outcome.status).toBe('ok');
    expect(outcome.errors).toEqual([]);
    expect(outcome.page).toContain('<main id="mapaEtapaContent" class="pfe-wrap" data-prerendered="f">');
    expect(outcome.page).not.toContain('bloque');
  });

  it('sin jornada fuera; sin datos, plantilla o error, la página queda como está', () => {
    expect(prerenderPage('<main id="mapaEtapaContent"></main>', options).status).toBe('out');
    expect(prerenderPage(page('otra', 'mapaEtapaContent'), options)).toEqual({ status: 'fallback', reason: 'sin datos' });
    expect(prerenderPage(page('d', 'perfilEtapaContent'), options)).toEqual({ status: 'fallback', reason: 'plantilla' });
    const failing = { ...options, render: () => { throw new Error('sin carrera'); } };
    expect(prerenderPage(page('d', 'mapaEtapaContent'), failing)).toEqual({ status: 'fallback', reason: 'error: sin carrera' });
  });

  it('una segunda pasada sustituye la marca y conserva el estilo propio de jornadas', () => {
    const once = composePage(page('d', 'mapaEtapaContent'), { container: 'mapaEtapaContent', headerInner: 'h', html: 'a', fingerprint: '1' });
    const twice = composePage(once, { container: 'mapaEtapaContent', headerInner: 'h', html: 'b', fingerprint: '2' });
    expect(twice.match(/data-prerendered/g)).toHaveLength(1);
    expect(twice).toContain('data-prerendered="2"');
    const styled = composePage(page('d', 'jornadaContent').replace('class="pfe-wrap"', 'style="--x:1"'),
      { container: 'jornadaContent', headerInner: 'h', html: 'a', fingerprint: '1', style: '--card-color:#123' });
    expect(styled).toContain('<main id="jornadaContent" data-prerendered="1" style="--card-color:#123">');
  });
});

describe('validación por tipo', () => {
  const head = header(NAV);
  const rd = { neutralStartTimeUtc: '2026-09-20T10:00:00+00:00' };

  it('perfil y mapa con horario exigen <time datetime>; el mapa, su contenedor', () => {
    expect(validatePage(`${head}<time datetime="x">`, { type: 'perfil', rd, navHrefs: NAV })).toEqual([]);
    expect(validatePage(head, { type: 'perfil', rd, navHrefs: NAV })).toHaveLength(1);
    expect(validatePage(`${head}<time datetime="x">`, { type: 'mapa', rd, navHrefs: NAV })).toEqual(['sin contenedor del mapa']);
  });

  it('orden de salida: tantas filas como entradas', () => {
    const rows = '<tr class="so-row"><td>1</td></tr><tr class="so-row" data-is-tt="1"><td>2</td></tr>';
    expect(validatePage(head + rows, { type: 'orden', rd, rows: 2, navHrefs: NAV })).toEqual([]);
    expect(validatePage(head + rows, { type: 'orden', rd, rows: 3, navHrefs: NAV })).toEqual(['2 filas pintadas de 3']);
  });

  it('un aviso solo pasa las comprobaciones comunes; el tamaño máximo es el del tipo', () => {
    expect(validatePage(head, { type: 'mapa', rd, navHrefs: NAV, notice: true })).toEqual([]);
    expect(validatePage(`${head}<a href="/perfil/null/">`, { type: 'perfil', rd, navHrefs: NAV, notice: true })).toHaveLength(1);
    const big = head + 'x'.repeat(TYPES.perfil.maxBytes);
    expect(validatePage(big, { type: 'perfil', rd, navHrefs: NAV, notice: true })).toHaveLength(1);
    expect(validatePage(big, { type: 'orden', rd, navHrefs: NAV, notice: true })).toEqual([]);
  });
});

describe('proporción mínima por tipo', () => {
  const result = (type, scope, generated, errors = []) => ({ type, scope, generated, errors });

  it('falla si un tipo baja del 99 % aunque el total lo supere, o con páginas inválidas', () => {
    expect(summarize([result('perfil', 990, 990), result('orden', 102, 101)]).ok).toBe(true);
    const low = summarize([result('perfil', 990, 990), result('orden', 102, 100)]);
    expect(low.ok).toBe(false);
    expect(low.failing.map(item => item.type)).toEqual(['orden']);
    expect(summarize([result('mapa', 0, 0, ['x'])]).ok).toBe(false);
  });
});
