import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  apiFetch, buildIndex, inFilter, inWindow, inscritosInputs, listedRaces, parseScope, prerenderPage, scopeSince,
  sharedDataDir, stageChunks, validatePage,
} from '../../tools/site/prerender-inscritos.mjs';

const race = (id, extra = {}) => ({ id, raceFormat: 'stage_race', endDate: '2026-10-18', ...extra });
const page = id => `<html><head><meta name="cc:race-id" content="${id}"></head><body>`
  + '<header class="site-header" id="siteHeader" data-back></header><main id="inscritosContent">bloque</main></body></html>';
const NAV = ['/', '/resultados/'];
const header = hrefs => hrefs.map(href => `<a class="primary-nav__main" href="${href}">x</a>`).join('');
const rider = '<div class="startlist-rider"><span class="startlist-rider__dorsal">1</span></div>';
const stubRender = () => ({ html: `<div class="startlist-grid">${rider}</div>`, headerInner: header(NAV), riders: 1 });

describe('ámbito', () => {
  it('acepta off, es, all y listas; sin valor, off', () => {
    expect(parseScope(undefined)).toBe('off');
    expect(parseScope(' all ')).toBe('all');
    expect(parseScope('listas')).toBe('listas');
    expect(() => parseScope('2027')).toThrow(/no admitido/);
  });

  it('carreras que terminan (o empiezan, sin fin) desde hace 7 días en UTC; sin día, todas', () => {
    expect(scopeSince(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-14');
    expect(inWindow({ endDate: '2026-10-14' }, '2026-10-14')).toBe(true);
    expect(inWindow({ endDate: '2026-10-13', startDate: '2026-10-20' }, '2026-10-14')).toBe(false);
    expect(inWindow({ endDate: null, startDate: '2026-10-20' }, '2026-10-14')).toBe(true);
    expect(inWindow({}, '2026-10-14')).toBe(false);
    expect(inWindow({}, null)).toBe(true);
  });

  it('solo las carreras con equipos en startlist_counts, en el orden de races', () => {
    const races = [race('r1'), race('r2', { endDate: '2026-09-01' }), race('r3')];
    const counts = [{ raceId: 'r3', teams: 2 }, { raceId: 'r2', teams: 1 }, { raceId: 'r1', teams: 0, riders: 5 }];
    expect(listedRaces(races, counts, '2026-10-14').map(({ id }) => id)).toEqual(['r3']);
    expect(listedRaces(races, counts, null).map(({ id }) => id)).toEqual(['r2', 'r3']);
  });
});

describe('índices del prerender', () => {
  const index = buildIndex({
    races: [race('r1'), race('r2', { raceFormat: 'one_day', endDate: null, startDate: '2026-10-20' }), race('r3', { endDate: '2026-09-01' })],
    teams: [{ id: 'a', raceId: 'r1' }, { id: 'b', raceId: 'r2' }],
    riders: [{ id: 'x', raceId: 'r1' }],
    stages: [{ id: 's1', raceId: 'r1', rowCount: 5 }],
    results: [{ globalRiderId: 'g1', irm: 'DNS', stageRef: 's1' }],
    oneDays: [
      { id: 'd1', raceId: 'r2', dateKey: '2026-10-20', assets: [{ id: 'as1', type: 'profile' }] },
      { id: 'd2', raceId: 'r2', dateKey: '2026-10-21', assets: [] },
    ],
    guides: [{ id: 'g', type: 'technicalGuide', race_days: { raceId: 'r1', dateKey: '2026-10-13' } }],
  }, '2026-10-14');

  it('agrupa por carrera las filas y los abandonos de sus etapas', () => {
    const input = inscritosInputs(index, 'r1');
    expect(input.rows.teamRows).toEqual([{ id: 'a', raceId: 'r1' }]);
    expect(input.rows.riders).toEqual([{ id: 'x', raceId: 'r1' }]);
    expect(input.rows.outRows).toHaveLength(1);
    expect(input.oneDayRd).toBeNull();
    expect(input.guide).toEqual({ id: 'g', type: 'technicalGuide' });
  });

  it('un día: la primera jornada publicada, con sus documentos aparte', () => {
    const input = inscritosInputs(index, 'r2');
    expect(input.oneDayRd).toEqual({ id: 'd1', raceId: 'r2', dateKey: '2026-10-20' });
    expect(input.oneDayAssets).toEqual([{ id: 'as1', type: 'profile' }]);
  });

  it('fuera de la ventana no hay entrada', () => {
    expect(inscritosInputs(index, 'r3')).toBeNull();
  });
});

describe('vuelta atrás por página', () => {
  const index = buildIndex({ races: [race('r1')] }, '2026-10-14');
  const options = { lang: 'es', scope: 'all', index, render: stubRender, navHrefs: NAV, fingerprint: () => 'f' };

  it('genera la página de una carrera del ámbito y conserva el id del <main>', () => {
    const outcome = prerenderPage(page('r1'), options);
    expect(outcome.status).toBe('ok');
    expect(outcome.errors).toEqual([]);
    expect(outcome.page).toContain('<main id="inscritosContent" data-prerendered="f">');
  });

  it('deja fuera otras carreras y los idiomas sin activar', () => {
    expect(prerenderPage(page('otra'), options).status).toBe('out');
    expect(prerenderPage(page('r1'), { ...options, lang: 'en', scope: 'es' }).status).toBe('out');
  });

  it('sin equipos, sin plantilla o con un error de pintado, la página queda como está', () => {
    expect(prerenderPage(page('r1'), { ...options, render: () => null })).toEqual({ status: 'fallback', reason: 'sin equipos' });
    expect(prerenderPage(page('r1').replace('<main id="inscritosContent">', '<main>'), options))
      .toEqual({ status: 'fallback', reason: 'plantilla' });
    const failing = { ...options, render: () => { throw new Error('sin datos'); } };
    expect(prerenderPage(page('r1'), failing)).toEqual({ status: 'fallback', reason: 'error: sin datos' });
  });
});

describe('validación de las páginas generadas', () => {
  const valid = `<header class="site-header" id="siteHeader">${header(NAV)}</header>${rider}`;

  it('acepta una página completa y exige todos los corredores', () => {
    expect(validatePage(valid, { riders: 1, navHrefs: NAV })).toEqual([]);
    expect(validatePage(valid.replace('startlist-rider"', 'startlist-rider startlist-rider--out"'), { riders: 1, navHrefs: NAV })).toEqual([]);
    expect(validatePage(valid, { riders: 2, navHrefs: NAV })).toHaveLength(1);
  });

  it('rechaza enlaces con undefined o null y la cabecera sin sus vistas', () => {
    expect(validatePage(`${valid}<img src="https://x/flags/undefined">`, { riders: 1, navHrefs: NAV })).toHaveLength(1);
    expect(validatePage(valid.replace(header(NAV), header(['/'])), { riders: 1, navHrefs: NAV })).toHaveLength(1);
  });

  it('limita el tamaño a 128 KB', () => {
    expect(validatePage(valid + 'x'.repeat(128 * 1024), { riders: 1, navHrefs: NAV })).toHaveLength(1);
  });
});

describe('lectura por API', () => {
  // PostgREST mínimo: `rows` por ruta, páginas según Range y total con count=exact.
  const server = tables => {
    const requests = [];
    const fetchImpl = async (url, { headers, method = 'GET' }) => {
      const path = decodeURIComponent(new URL(url).pathname.split('/rest/v1/')[1]);
      const [start, end] = headers.Range.split('-').map(Number);
      requests.push([method, path, headers.Range, headers.Prefer || null]);
      const rows = tables[path] || [];
      const page = rows.slice(start, end + 1);
      const range = headers.Prefer === 'count=exact' ? `${start}-${start + page.length - 1}/${rows.length}` : null;
      return { ok: true, headers: { get: name => (name === 'content-range' ? range : null) }, json: async () => page };
    };
    return { fetchImpl, requests };
  };
  const ids = count => Array.from({ length: count }, (_, at) => ({ id: at }));

  it('pide el total con la primera página y el resto a la vez; las RPC, página a página', async () => {
    const { fetchImpl, requests } = server({ races: ids(2500), 'rpc/startlist_counts': ids(1000) });
    const [races, counts] = await apiFetch([{ path: 'races' }, { path: 'rpc/startlist_counts', rpc: true }], 'clave', { fetchImpl });
    expect(races).toEqual(ids(2500));
    expect(counts).toHaveLength(1000);
    expect(requests.filter(([, path]) => path === 'races')).toEqual([
      ['GET', 'races', '0-999', 'count=exact'], ['GET', 'races', '1000-1999', null], ['GET', 'races', '2000-2999', null],
    ]);
    expect(requests.filter(([, path]) => path !== 'races')).toEqual([
      ['POST', 'rpc/startlist_counts', '0-999', null], ['POST', 'rpc/startlist_counts', '1000-1999', null],
    ]);
  });

  it('falla si las páginas no suman el total', async () => {
    const { fetchImpl } = server({ races: ids(1500) });
    const short = async (url, init) => {
      const response = await fetchImpl(url, init);
      return init.headers.Range === '1000-1999' ? { ...response, json: async () => [] } : response;
    };
    await expect(apiFetch([{ path: 'races' }], 'clave', { fetchImpl: short })).rejects.toThrow(/0 de 1500|1000 de 1500/);
  });

  it('filtros in con comillas y abandonos en tramos que no parten una carrera', () => {
    expect(inFilter('raceId', ['a', 'b"c'])).toBe('raceId=in.(%22a%22,%22b%5C%22c%22)');
    const url = new URL(`https://x/rest/v1/t?${inFilter('stageRef', ['r#-1#stage', 'a&b'])}&order=id.asc`);
    expect(url.hash).toBe('');
    expect(url.searchParams.get('stageRef')).toBe('in.("r#-1#stage","a&b")');
    const stages = [
      ...Array.from({ length: 60 }, (_, at) => ({ id: `a${at}`, raceId: 'a', rowCount: 1 })),
      { id: 'b0', raceId: 'b', rowCount: 0 },
      ...Array.from({ length: 50 }, (_, at) => ({ id: `c${at}`, raceId: 'c', rowCount: 3 })),
      { id: 'a60', raceId: 'a', rowCount: 2 },
    ];
    const chunks = stageChunks(stages);
    expect(chunks.map(chunk => chunk.length)).toEqual([61, 50]);
    expect(chunks[0].at(-1)).toBe('a60');
  });
});

describe('volcado compartido', () => {
  const manifest = inscritos => {
    const dir = mkdtempSync(join(tmpdir(), 'inscritos-'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(inscritos === undefined ? {} : { inscritos }));
    return dir;
  };

  it('se usa si sus listas cubren el ámbito; si no, la API', () => {
    const cases = [
      [{ since: null }, '2026-10-14', true], [{ since: null }, null, true],
      [{ since: '2026-10-14' }, '2026-10-15', true], [{ since: '2026-10-14' }, '2026-10-14', true],
      [{ since: '2026-10-15' }, '2026-10-14', false], [{ since: '2026-10-14' }, null, false], [undefined, '2026-10-14', false],
    ];
    for (const [inscritos, since, used] of cases) {
      const dir = manifest(inscritos);
      expect(sharedDataDir(dir, since)).toBe(used ? dir : null);
      rmSync(dir, { recursive: true });
    }
    expect(sharedDataDir(undefined, null)).toBeNull();
  });
});
