import { describe, expect, it } from 'vitest';
import { agendaCardIsFeatured, agendaMetaState } from '../services/today-agenda-layout.js';

describe('estado lateral de las tarjetas de Hoy', () => {
  const times = { start: '13:15', finish: '17:30' };

  it('muestra la salida antes de comenzar y la meta aproximada durante la carrera', () => {
    expect(agendaMetaState('scheduled', times)).toEqual({ kind: 'schedule', label: 'Salida', value: '13:15', time: 'start' });
    expect(agendaMetaState('running', times)).toEqual({ kind: 'schedule', label: 'Meta', value: '~17:30', time: 'finish' });
  });

  it('usa Inicio/Final y Start/End en CRI y CRE', () => {
    expect(agendaMetaState('scheduled', { ...times, isTimeTrial: true })).toMatchObject({ label: 'Inicio', value: '13:15' });
    expect(agendaMetaState('running', { ...times, isTimeTrial: true })).toMatchObject({ label: 'Final', value: '~17:30' });
    expect(agendaMetaState('scheduled', { ...times, lang: 'en', isTimeTrial: true }).label).toBe('Start');
    expect(agendaMetaState('running', { ...times, lang: 'en', isTimeTrial: true }).label).toBe('End');
  });

  it('reserva estados distintos para la espera y para resultados/revive', () => {
    expect(agendaMetaState('waiting', times)).toEqual({ kind: 'waiting' });
    expect(agendaMetaState('results', times)).toEqual({ kind: 'actions' });
  });

  it('mantiene las etiquetas inglesas y no inventa horarios ausentes', () => {
    expect(agendaMetaState('scheduled', { ...times, lang: 'en' }).label).toBe('Start');
    expect(agendaMetaState('running', { ...times, lang: 'en' })).toMatchObject({ label: 'Finish', value: '~17:30' });
    expect(agendaMetaState('scheduled')).toEqual({ kind: 'none' });
    expect(agendaMetaState('running', { start: '13:15' })).toEqual({ kind: 'none' });
  });
});

describe('presentación de carreras destacadas en Hoy', () => {
  it('solo aplica el diseño destacado en el orden por categoría y lo restaura al volver', () => {
    expect(agendaCardIsFeatured('category', true)).toBe(true);
    expect(agendaCardIsFeatured('tvtime', true)).toBe(false);
    expect(agendaCardIsFeatured('finishtime', true)).toBe(false);
    expect(agendaCardIsFeatured('category', false)).toBe(false);
  });
});
