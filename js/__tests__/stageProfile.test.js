import { describe, expect, it } from 'vitest';
import { hasStageKeyPoints } from '../stage-key-points.js';

describe('hasStageKeyPoints', () => {
  it('oculta el panel si la jornada no tiene waypoints ni summits', () => {
    expect(hasStageKeyPoints({})).toBe(false);
    expect(hasStageKeyPoints({ profileWaypoints: [], profileSummits: [] })).toBe(false);
  });

  it('muestra el panel si existe al menos un waypoint o summit', () => {
    expect(hasStageKeyPoints({ profileWaypoints: [{ km: 50 }], profileSummits: [] })).toBe(true);
    expect(hasStageKeyPoints({ profileWaypoints: [], profileSummits: [{ km: 75 }] })).toBe(true);
  });
});
