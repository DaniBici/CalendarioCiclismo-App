import { describe, expect, it } from 'vitest';
import { readCalendarMonth, readCalendarView, writeCalendarParams } from '../calendario-query.js';

const qs = s => new URLSearchParams(s);

describe('parámetros de /calendario/ por idioma', () => {
  it('lee la vista en castellano y en inglés', () => {
    expect(readCalendarView(qs('vista=temporada'))).toBe('temporada');
    expect(readCalendarView(qs('view=season'))).toBe('temporada');
    expect(readCalendarView(qs('view=month'))).toBe('mes');
    expect(readCalendarView(qs('vista=season'))).toBe(null);
    expect(readCalendarView(qs(''))).toBe(null);
  });

  it('lee el mes con cualquiera de los dos nombres y valida el formato', () => {
    expect(readCalendarMonth(qs('mes=2027-01'))).toBe('2027-01');
    expect(readCalendarMonth(qs('month=2027-05'))).toBe('2027-05');
    expect(readCalendarMonth(qs('mes=2027-13'))).toBe(null);
    expect(readCalendarMonth(qs('month=5'))).toBe(null);
  });

  it('escribe los nombres del idioma y retira los del otro', () => {
    const en = writeCalendarParams(qs('vista=temporada&mes=2027-01&cat=WT'), 'en', { view: 'temporada' });
    expect(en.toString()).toBe('cat=WT&view=season&month=2027-01');
    const es = writeCalendarParams(qs('view=month&month=2027-05'), 'es', { view: 'mes' });
    expect(es.toString()).toBe('vista=mes&mes=2027-05');
  });

  it('sustituye o elimina el mes según el argumento', () => {
    expect(writeCalendarParams(qs('mes=2027-01'), 'en', { view: 'mes', month: '2027-02' }).toString())
      .toBe('view=month&month=2027-02');
    expect(writeCalendarParams(qs('mes=2027-01'), 'es', { view: 'temporada', month: null }).toString())
      .toBe('vista=temporada');
  });
});
