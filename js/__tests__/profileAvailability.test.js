import { describe, expect, it } from 'vitest';

import { hasRenderableElevationProfile } from '../profile-availability.js';

describe('hasRenderableElevationProfile', () => {
  it('no trata un perfil mínimo de D+ como perfil interactivo', () => {
    expect(hasRenderableElevationProfile({
      profileNotViewable: false,
      elevationProfile: { elevationGain: 742, points: [] },
    })).toBe(false);
  });

  it('admite un perfil visible con al menos dos puntos', () => {
    expect(hasRenderableElevationProfile({
      profileNotViewable: false,
      elevationProfile: { points: [{ km: 0, alt: 10 }, { km: 1, alt: 20 }] },
    })).toBe(true);
  });

  it('respeta el veto explícito de publicación', () => {
    expect(hasRenderableElevationProfile({
      profileNotViewable: true,
      elevationProfile: { points: [{ km: 0, alt: 10 }, { km: 1, alt: 20 }] },
    })).toBe(false);
  });
});
