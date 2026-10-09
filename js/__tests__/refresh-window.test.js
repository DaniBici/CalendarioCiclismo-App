import { describe, expect, it } from 'vitest';
import { isNearToday } from '../services/refresh-window.js';

const now = new Date(2026, 9, 7, 12);

describe('ventana de refresco', () => {
  it('incluye la víspera, el día y el día siguiente de una jornada', () => {
    expect(isNearToday('2026-10-08', undefined, { now })).toBe(true);
    expect(isNearToday('2026-10-07', undefined, { now })).toBe(true);
    expect(isNearToday('2026-10-06', undefined, { now })).toBe(true);
    expect(isNearToday('2026-10-05', undefined, { now })).toBe(false);
    expect(isNearToday('2026-10-09', undefined, { now })).toBe(false);
  });

  it('cubre todos los días de una carrera por etapas', () => {
    expect(isNearToday('2026-10-01', '2026-10-12', { now })).toBe(true);
    expect(isNearToday('2026-09-20', '2026-10-05', { now })).toBe(false);
  });

  it('no abre ventana sin fecha', () => {
    expect(isNearToday(null, undefined, { now })).toBe(false);
  });
});
