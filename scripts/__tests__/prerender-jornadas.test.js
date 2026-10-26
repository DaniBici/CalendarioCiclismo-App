import { describe, expect, it } from 'vitest';
import { STAGE_SIBLING_COLUMNS } from '../../js/services/races.js';
import { apiRows, buildIndex, inScope, jornadaInputs, parseScope, prerenderPage, summarize, validatePage } from '../../tools/site/prerender-jornadas.mjs';

const race = (id, extra = {}) => ({ id, raceFormat: 'stage_race', colorHex: '#123456', ...extra });
const day = (id, raceId, dateKey, extra = {}) => ({ id, raceId, dateKey, stageNumber: null, neutralStartTimeUtc: null, ...extra });
const page = id => `<html><head><meta name="cc:race-day-id" content="${id}"></head><body>`
  + '<header class="site-header" id="siteHeader" data-back></header><main id="jornadaContent">bloque</main></body></html>';
const NAV = ['/', '/resultados/'];
const header = hrefs => hrefs.map(href => `<a class="primary-nav__main" href="${href}">x</a>`).join('');
const stubRender = () => ({ html: '<div>contenido</div>', headerInner: header(NAV) });

describe('ámbito del interruptor', () => {
  it('acepta off, 2027, es y all; sin valor, off', () => {
    expect(parseScope(undefined)).toBe('off');
    expect(parseScope(' es ')).toBe('es');
    expect(parseScope('2027')).toBe('2027');
    expect(() => parseScope('2026')).toThrow(/no admitido/);
  });

  it('2027: jornadas de ese año en ES y EN; es: solo ES; all: ambos idiomas', () => {
    const d2027 = { dateKey: '2027-01-19' };
    const d2026 = { dateKey: '2026-12-31' };
    expect(inScope('2027', 'es', d2027)).toBe(true);
    expect(inScope('2027', 'en', d2027)).toBe(true);
    expect(inScope('2027', 'es', d2026)).toBe(false);
    expect(inScope('es', 'es', d2026)).toBe(true);
    expect(inScope('es', 'en', d2026)).toBe(false);
    expect(inScope('all', 'en', d2026)).toBe(true);
    expect(inScope('off', 'es', d2027)).toBe(false);
  });
});

describe('índices del prerender', () => {
  it('ordena las etapas hermanas y propaga el doble sector a la jornada', () => {
    const index = buildIndex({
      races: [race('r')],
      days: [
        day('s2', 'r', '2027-01-21', { stageNumber: 2, description: 'larga' }),
        day('s3b', 'r', '2027-01-22', { stageNumber: 3, neutralStartTimeUtc: '2027-01-22T14:00:00+00:00' }),
        day('s1', 'r', '2027-01-20', { stageNumber: 1 }),
        day('s3a', 'r', '2027-01-22', { stageNumber: 3, neutralStartTimeUtc: '2027-01-22T08:00:00+00:00' }),
      ],
    });
    const input = jornadaInputs(index, 's3b');
    expect(input.siblings.map(sibling => sibling.id)).toEqual(['s1', 's2', 's3a', 's3b']);
    expect(input.siblings.map(sibling => sibling._stageSuffix)).toEqual([undefined, undefined, 'A', 'B']);
    expect(input.rd._stageSuffix).toBe('B');
    // Solo las columnas que lee el navegador.
    expect(Object.keys(input.siblings[1]).sort()).toEqual(STAGE_SIBLING_COLUMNS.split(',').sort());
  });

  it('una carrera de un día no lleva etapas hermanas', () => {
    const index = buildIndex({ races: [race('r', { raceFormat: 'one_day' })], days: [day('d', 'r', '2027-03-01')] });
    expect(jornadaInputs(index, 'd').siblings).toEqual([]);
  });

  it('emisiones por sortOrder; en empate, el orden de llegada', () => {
    const index = buildIndex({
      races: [race('r')], days: [day('d', 'r', '2027-01-20')],
      broadcasts: [
        { id: 'b', raceDayId: 'd', sortOrder: 2 },
        { id: 'C', raceDayId: 'd', sortOrder: 1 },
        { id: 'a', raceDayId: 'd', sortOrder: null },
        { id: 'A', raceDayId: 'd', sortOrder: 1 },
      ],
    });
    expect(jornadaInputs(index, 'd').broadcasts.map(row => row.id)).toEqual(['C', 'A', 'b', 'a']);
  });

  it('guía técnica de la competición: la de la jornada más temprana, sin la jornada embebida', () => {
    const index = buildIndex({
      races: [race('r')], days: [day('d', 'r', '2027-01-21')],
      guides: [
        { id: 'g2', type: 'technicalGuide', race_days: { raceId: 'r', dateKey: '2027-01-21' } },
        { id: 'g1', type: 'technicalGuide', race_days: { raceId: 'r', dateKey: '2027-01-19' } },
        { id: 'g0', type: 'technicalGuide', race_days: { raceId: 'r', dateKey: '2027-01-19' } },
        { id: 'otra', type: 'technicalGuide', race_days: { raceId: 'x', dateKey: '2027-01-01' } },
      ],
    });
    expect(jornadaInputs(index, 'd').guide).toEqual({ id: 'g1', type: 'technicalGuide' });
  });
});

describe('vuelta atrás por página', () => {
  const index = buildIndex({
    races: [race('r')],
    days: [day('d27', 'r', '2027-01-20'), day('d26', 'r', '2026-05-01'), day('huerfana', 'sin-carrera', '2027-01-20')],
  });
  const options = { lang: 'es', scope: '2027', index, render: stubRender, navHrefs: NAV, fingerprint: () => 'f' };

  it('genera la página de una jornada del ámbito', () => {
    const outcome = prerenderPage(page('d27'), options);
    expect(outcome.status).toBe('ok');
    expect(outcome.errors).toEqual([]);
  });

  it('deja fuera las páginas sin jornada o de otro año', () => {
    expect(prerenderPage(page('d26'), options).status).toBe('out');
    expect(prerenderPage('<main id="jornadaContent"></main>', options).status).toBe('out');
    expect(prerenderPage(page('desconocida'), options).status).toBe('out');
  });

  it('sin datos, sin plantilla o con un error de pintado, la página queda como está', () => {
    expect(prerenderPage(page('huerfana'), options)).toEqual({ status: 'fallback', reason: 'sin datos' });
    expect(prerenderPage(page('desconocida'), { ...options, scope: 'es' })).toEqual({ status: 'fallback', reason: 'sin datos' });
    expect(prerenderPage(page('d27').replace('<main id="jornadaContent">', '<main>'), options))
      .toEqual({ status: 'fallback', reason: 'plantilla' });
    const failing = { ...options, render: () => { throw new Error('sin perfil'); } };
    expect(prerenderPage(page('d27'), failing)).toEqual({ status: 'fallback', reason: 'error: sin perfil' });
  });
});

describe('validación de las páginas generadas', () => {
  const rd = { neutralStartTimeUtc: '2027-01-20T10:00:00+00:00' };
  const valid = `<header class="site-header" id="siteHeader">${header(NAV)}</header><time datetime="x">`;

  it('acepta una página completa', () => {
    expect(validatePage(valid, { rd, navHrefs: NAV })).toEqual([]);
  });

  it('rechaza enlaces con undefined o null', () => {
    expect(validatePage(`${valid}<a href="undefined/inscritos/x/">`, { rd, navHrefs: NAV })).toHaveLength(1);
    expect(validatePage(`${valid}<a href="/perfil/?id=null">`, { rd, navHrefs: NAV })).toHaveLength(1);
    expect(validatePage(`${valid}<a href="/jornada/trofeo-nullarbor/">`, { rd, navHrefs: NAV })).toEqual([]);
  });

  it('exige los enlaces de vistas de la cabecera', () => {
    const partial = `<header class="site-header" id="siteHeader">${header(['/'])}</header><time datetime="x">`;
    expect(validatePage(partial, { rd, navHrefs: NAV })).toHaveLength(1);
  });

  it('exige <time datetime> si la jornada tiene horario y no está cancelada', () => {
    const untimed = valid.replace('<time datetime="x">', '');
    expect(validatePage(untimed, { rd, navHrefs: NAV })).toHaveLength(1);
    expect(validatePage(untimed, { rd: { ...rd, isCancelledDay: true }, navHrefs: NAV })).toEqual([]);
    expect(validatePage(untimed, { rd: {}, navHrefs: NAV })).toEqual([]);
  });

  it('limita el tamaño a 64 KB', () => {
    expect(validatePage(valid + 'x'.repeat(64 * 1024), { rd, navHrefs: NAV })).toHaveLength(1);
  });
});

describe('proporción mínima del ámbito', () => {
  const result = (scope, generated, errors = []) => ({ scope, generated, fallbacks: [], errors });

  it('falla por debajo del 99 % o con páginas inválidas', () => {
    expect(summarize([result(60, 60), result(40, 39)]).ok).toBe(true);
    expect(summarize([result(60, 59), result(40, 39)]).ok).toBe(false);
    expect(summarize([result(10, 10, ['x'])]).ok).toBe(false);
    expect(summarize([result(0, 0)]).ok).toBe(true);
  });
});

describe('lectura por API', () => {
  it('pagina de 1.000 en 1.000 en orden por id hasta una página corta', async () => {
    const requests = [];
    const fetchImpl = async (url, { headers }) => {
      requests.push([url, headers.Range]);
      const size = requests.length === 1 ? 1000 : 5;
      return { ok: true, json: async () => Array.from({ length: size }, (_, at) => ({ id: at })) };
    };
    const rows = await apiRows('broadcasts?select=*', 'clave', fetchImpl);
    expect(rows).toHaveLength(1005);
    expect(requests.map(([, range]) => range)).toEqual(['0-999', '1000-1999']);
    expect(requests[0][0]).toMatch(/broadcasts\?select=\*&order=id\.asc$/);
  });
});
