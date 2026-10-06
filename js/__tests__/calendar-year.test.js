import { describe, expect, it } from 'vitest';
import { hasCalendarForYear } from '../services/races.js';

describe('iCal sin años históricos', () => {
  it('conserva el actual y futuros y rechaza años desconocidos', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    for (const year of [2020, 2025, null, undefined, '2026']) {
      expect(hasCalendarForYear(year, now)).toBe(false);
    }
    expect(hasCalendarForYear(2026, now)).toBe(true);
    expect(hasCalendarForYear(2027, now)).toBe(true);
  });
  it('cambia al año nuevo en UTC, independientemente del offset', () => {
    expect(hasCalendarForYear(2026, new Date('2027-01-01T00:30:00+01:00'))).toBe(true);
    expect(hasCalendarForYear(2026, new Date('2026-12-31T19:00:00-05:00'))).toBe(false);
  });
});
