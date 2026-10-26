import { describe, expect, it } from 'vitest';
import {
  MAX_DISPATCHES,
  QUIET_MS,
  coverDecision,
  pageDecision,
  publishedStartlist,
  readsResults,
  snapshotChanges,
} from '../pages-refresh/plan.mjs';

const NOW = Date.parse('2026-10-23T16:00:00Z');
const run = (minutesAgo, status = 'completed', conclusion = 'success', extra = {}) => ({
  created_at: new Date(NOW - minutesAgo * 60_000).toISOString(), status, conclusion, ...extra,
});

describe('snapshotChanges', () => {
  it('clasifica los cambios e ignora lo que aparece por primera vez', () => {
    const previous = {
      inscritos: { a: true, b: false, c: true }, orden: { d1: 't1', d2: 't2' },
      perfiles: { d1: 'p1', d2: 'p2' }, resultados: { r1: 's1', r2: 's2' }, jornadas: ['x'],
    };
    const current = {
      inscritos: { a: false, b: false, n: true }, orden: { d1: 't1', d2: 't3', d3: 't4' },
      perfiles: { d1: 'p1', d2: 'p9', d3: 'p3' }, resultados: { r1: 's9', r3: 's3' }, jornadas: ['x', 'y'],
    };
    expect(snapshotChanges(previous, current)).toEqual({
      inscritos: ['a'],
      jornadas: ['y'],
      refresh: ['inscritos c: sin lista', 'orden d2', 'orden d3', 'perfil d2'],
      resultados: ['r1'],
    });
  });
});

describe('coverDecision', () => {
  const pending = { changedAt: NOW - 5 * 60_000, dispatches: 0 };

  it('un build correcto creado después del cambio lo cubre', () => {
    expect(coverDecision(pending, [run(3)], NOW)).toBe('covered');
  });

  it('espera a un build posterior en curso y al periodo de calma', () => {
    expect(coverDecision(pending, [run(3, 'in_progress', null)], NOW)).toBe('wait');
    expect(coverDecision({ changedAt: NOW - QUIET_MS + 1, dispatches: 0 }, [], NOW)).toBe('wait');
  });

  it('lanza si solo hay builds anteriores o fallidos y abandona tras el máximo', () => {
    expect(coverDecision(pending, [run(10), run(3, 'completed', 'failure')], NOW)).toBe('dispatch');
    expect(coverDecision({ ...pending, dispatches: MAX_DISPATCHES }, [], NOW)).toBe('abandon');
  });

  it('los resultados solo los cubren un refresco o un build completo', () => {
    const push = run(3, 'completed', 'success', { event: 'push', display_title: 'Construir y desplegar el sitio' });
    const stage = run(3, 'completed', 'success', { event: 'workflow_dispatch', display_title: 'stage-incremental' });
    const cron = run(3, 'completed', 'success', { event: 'schedule', display_title: 'Construir y desplegar el sitio' });
    const refresh = run(3, 'completed', 'success', { event: 'workflow_dispatch', display_title: 'prerender-refresh' });
    expect(coverDecision(pending, [push, stage], NOW, readsResults)).toBe('dispatch');
    expect(coverDecision(pending, [cron], NOW, readsResults)).toBe('covered');
    expect(coverDecision(pending, [refresh], NOW, readsResults)).toBe('covered');
  });
});

describe('pageDecision', () => {
  const pages = {
    '/jornada/b/': { slug: 'b', seenAt: NOW - 10 * 60_000, dispatches: 0 },
    '/inscritos/r/': { slug: 'r-etapa-1', seenAt: NOW - 6 * 60_000, dispatches: 1 },
    '/jornada/a/': { slug: 'a', seenAt: NOW - 5 * 60_000, dispatches: MAX_DISPATCHES },
  };

  it('agrupa el lote en un incremental y abandona tras el máximo', () => {
    expect(pageDecision(pages, [run(20)], NOW)).toEqual({
      dispatch: ['/inscritos/r/', '/jornada/b/'], slugs: ['b', 'r-etapa-1'], abandon: ['/jornada/a/'],
    });
    expect(pageDecision({ ...pages, '/jornada/c/': { slug: 'c', seenAt: NOW - 1000, dispatches: 0 } }, [], NOW).slugs)
      .toEqual([]);
  });

  it('espera a un build en curso creado después del primer cambio', () => {
    expect(pageDecision(pages, [run(4, 'queued', null)], NOW).slugs).toEqual([]);
  });
});

describe('publishedStartlist', () => {
  it('lee el título y el aviso de la página generada', () => {
    const page = (title, body) => `<title>${title}</title><main data-prerendered="1">${body}</main>`;
    expect(publishedStartlist(page('Carrera: lista provisional de inscritos', '<span class="startlist-disclaimer--provisional">')))
      .toEqual({ title: true, body: true });
    expect(publishedStartlist(page('Carrera: lista provisional de inscritos', ''))).toEqual({ title: true, body: false });
    expect(publishedStartlist('<title>Carrera</title><main></main>')).toBeNull();
  });
});
