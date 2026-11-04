import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));

import { buildStageList, raceSideStageList } from '../shared.js';

const stages = [
  { id: 'a', stageNumber: 1, startLocation: 'Chongzuo', finishLocation: 'Chongzuo' },
  { id: 'b', stageNumber: 2, startLocation: 'Chongzuo', finishLocation: 'Jingxi' },
  { id: 'c', stageNumber: 3, startLocation: 'Jingxi', finishLocation: 'Bama' },
];
const url = rd => `/jornada/etapa-${rd.stageNumber}/`;

describe('lista de etapas de la columna lateral', () => {
  it('no se pinta con una sola etapa o ninguna', () => {
    expect(buildStageList([], 'a', url, '/competicion/x/')).toBe('');
    expect(buildStageList([stages[0]], 'a', url, '/competicion/x/')).toBe('');
  });

  it('enlaza cada etapa con su URL y añade el enlace a la carrera', () => {
    const html = buildStageList(stages, 'b', url, '/competicion/x/');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs).toEqual(['/jornada/etapa-1/', '/jornada/etapa-2/', '/jornada/etapa-3/', '/competicion/x/']);
    expect(html).toContain('<nav class="stage-list"');
    expect(html).toContain('Chongzuo › Jingxi');
  });

  it('marca solo la etapa actual con aria-current', () => {
    const html = buildStageList(stages, 'c', url, '/competicion/x/');
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(html).toMatch(/href="\/jornada\/etapa-3\/" aria-current="page"/);
  });
});

describe('etapas desactivadas', () => {
  it('se pintan como span con aria-disabled y sin enlace', () => {
    const html = buildStageList([stages[0], { ...stages[1], _disabled: true }, stages[2]], 'a', url, '/competicion/x/');
    expect(html).toContain('<span class="stage-list__item stage-list__item--disabled" aria-disabled="true"><span class="stage-list__n">');
    expect([...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])).toEqual(['/jornada/etapa-1/', '/jornada/etapa-3/', '/competicion/x/']);
  });
});

describe('fila «Clasificación general final»', () => {
  const race = { id: 7, slug: 'vuelta-x-2026', raceFormat: 'stage_race' };
  const days = stages.map(s => ({ ...s, dateKey: `2026-05-0${s.stageNumber}` }));
  const gcRow = html => html.match(/<(?:a|span) class="stage-list__item stage-list__gc[^>]*>/)?.[0];

  it('gcFinal true: enlace a la página final de la carrera', () => {
    const row = gcRow(raceSideStageList(race, days, { gcFinal: true, gcCurrent: true }));
    expect(row).toMatch(/^<a .*href="\/resultados\/vuelta-x-2026\/" aria-current="page"/);
    expect(row).not.toContain('disabled');
  });

  it('gcFinal false: desactivada y sin comprobación', () => {
    const row = gcRow(raceSideStageList(race, days, { gcFinal: false }));
    expect(row).toMatch(/^<span .*stage-list__item--disabled" aria-disabled="true"/);
    expect(row).not.toContain('data-gc-final-check');
  });

  it('gcFinal null: desactivada y marcada para comprobarla en el navegador', () => {
    const row = gcRow(raceSideStageList(race, days));
    expect(row).toMatch(/^<span .*stage-list__item--disabled" aria-disabled="true" data-gc-final-check data-race-id="7" data-gc-href="\/resultados\/vuelta-x-2026\/"/);
  });
});
