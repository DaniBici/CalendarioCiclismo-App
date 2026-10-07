import { describe, expect, it } from 'vitest';
import { profileSegmentStats } from '../stage/profile-segment.js';

const points = [{ km: 0, alt: 100 }, { km: 10, alt: 600 }, { km: 20, alt: 300 }, { km: 30, alt: 500 }];
const interpolateAlt = km => {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (km >= a.km && km <= b.km) return a.alt + (km - a.km) / (b.km - a.km) * (b.alt - a.alt);
  }
  return points[points.length - 1].alt;
};

describe('profileSegmentStats', () => {
  it('acumula subidas y bajadas con extremos interpolados', () => {
    const stats = profileSegmentStats(points, 5, 25, interpolateAlt);
    expect(stats.distance).toBe(20);
    expect(stats.startAlt).toBe(350);
    expect(stats.endAlt).toBe(400);
    expect(stats.ascent).toBe(350);
    expect(stats.descent).toBe(300);
    expect(stats.gradient).toBeCloseTo(0.25);
  });

  it('admite el tramo marcado de derecha a izquierda', () => {
    expect(profileSegmentStats(points, 25, 5, interpolateAlt).from).toBe(5);
  });

  it('descarta un tramo sin longitud', () => {
    expect(profileSegmentStats(points, 12, 12, interpolateAlt)).toBeNull();
  });
});
