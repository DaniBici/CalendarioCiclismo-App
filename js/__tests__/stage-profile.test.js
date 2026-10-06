import { describe, expect, it } from 'vitest';
import { hasStageKeyPoints } from '../stage/key-points.js';

describe('hasStageKeyPoints', () => {
  it('muestra el panel solo si existe al menos un waypoint o summit', () => {
    expect(hasStageKeyPoints({ profileWaypoints: [], profileSummits: [] })).toBe(false);
    expect(hasStageKeyPoints({ profileWaypoints: [], profileSummits: [{ km: 75 }] })).toBe(true);
  });
});
