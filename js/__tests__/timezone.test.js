import { describe, expect, it } from 'vitest';
import { madridDateKey, madridTimeToTimestamp, zonedTimeToTimestamp } from '../services/timezone.js';

describe('zonedTimeToTimestamp', () => {
  it('convierte la hora de verano de Madrid a UTC', () => {
    expect(madridTimeToTimestamp('2026-08-21', '15:45')).toBe('2026-08-21T13:45:00.000Z');
  });

  it('convierte la hora de invierno de Madrid a UTC', () => {
    expect(madridTimeToTimestamp('2026-01-21', '15:45')).toBe('2026-01-21T14:45:00.000Z');
  });

  it('conserva la fecha civil de una hora posterior a medianoche', () => {
    expect(madridTimeToTimestamp('2026-08-21', '00:30')).toBe('2026-08-20T22:30:00.000Z');
  });

  it('admite otras zonas IANA y rechaza datos incompletos', () => {
    expect(zonedTimeToTimestamp('2026-08-21', '15:45', 'UTC')).toBe('2026-08-21T15:45:00.000Z');
    expect(zonedTimeToTimestamp('', '15:45', 'Europe/Madrid')).toBeNull();
  });

  it('usa la fecha civil española del instante de meta', () => {
    expect(madridDateKey('2026-08-21T23:30:00Z')).toBe('2026-08-22');
  });
});
