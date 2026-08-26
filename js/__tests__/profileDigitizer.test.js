import { describe, expect, it } from 'vitest';
import {
  buildDigitizedElevationProfile,
  buildProfileAssetDownloadRequest,
  repeatControlPointRegion,
} from '../profile-digitizer.js';

const controls = [
  { id: 1, x: 0.10, y: 0.70 },
  { id: 2, x: 0.35, y: 0.80 },
  { id: 3, x: 0.65, y: 0.20 },
  { id: 4, x: 0.90, y: 0.55 },
];

describe('buildProfileAssetDownloadRequest', () => {
  it('separa en caché los perfiles de etapas distintas', () => {
    const proxy = 'https://example.supabase.co/functions/v1/r2-upload';
    const stage1 = buildProfileAssetDownloadRequest(
      proxy,
      'https://assets.calendariociclismo.app/races/la-vuelta/2026/stage-1/profile.pdf',
    );
    const stage2 = buildProfileAssetDownloadRequest(
      proxy,
      'https://assets.calendariociclismo.app/races/la-vuelta/2026/stage-2/profile.pdf',
    );

    expect(stage1.filename).toBe('races/la-vuelta/2026/stage-1/profile.pdf');
    expect(stage2.filename).toBe('races/la-vuelta/2026/stage-2/profile.pdf');
    expect(stage1.url).not.toBe(stage2.url);
    expect(new URL(stage2.url).searchParams.get('asset')).toBe(stage2.filename);
  });
});

describe('buildDigitizedElevationProfile', () => {
  it('calibra puntos interiores y genera el contrato de elevationProfile', () => {
    const profile = buildDigitizedElevationProfile({
      controlPoints: controls,
      distanceKm: 175.4,
      lowReference: { pointId: 2, altitude: 200 },
      highReference: { pointId: 3, altitude: 1400 },
    });

    expect(profile.distance).toBe(175.4);
    expect(profile.points).toHaveLength(350);
    expect(profile.points[0].km).toBe(0);
    expect(profile.points.at(-1).km).toBe(175.4);
    expect(profile.minElevation).toBe(200);
    expect(profile.maxElevation).toBe(1400);
    expect(Number.isInteger(profile.elevationGain)).toBe(true);
    expect(Number.isInteger(profile.elevationLoss)).toBe(true);
    expect(profile.points.every(point => Number.isInteger(point.alt))).toBe(true);
  });

  it('conserva los puntos de control durante el remuestreo', () => {
    const profile = buildDigitizedElevationProfile({
      controlPoints: controls,
      distanceKm: 100,
      lowReference: { pointId: 2, altitude: 100 },
      highReference: { pointId: 3, altitude: 1000 },
      targetPointCount: 10,
    });

    expect(profile.points).toContainEqual({ km: 31.25, alt: 100 });
    expect(profile.points).toContainEqual({ km: 68.75, alt: 1000 });
  });

  it('rechaza referencias verticales incoherentes', () => {
    expect(() => buildDigitizedElevationProfile({
      controlPoints: controls,
      distanceKm: 100,
      lowReference: { pointId: 3, altitude: 100 },
      highReference: { pointId: 2, altitude: 1000 },
    })).toThrow(/visualmente por debajo/);
  });

  it('rechaza una distancia vacía o no positiva', () => {
    expect(() => buildDigitizedElevationProfile({
      controlPoints: controls,
      distanceKm: 0,
      lowReference: { pointId: 2, altitude: 100 },
      highReference: { pointId: 3, altitude: 1000 },
    })).toThrow(/mayor que 0/);
  });
});

describe('repeatControlPointRegion', () => {
  it('repite el perfil completo el número total de vueltas indicado', () => {
    const result = repeatControlPointRegion({
      controlPoints: [
        { id: 1, x: 0.1, y: 0.7 },
        { id: 2, x: 0.5, y: 0.2 },
        { id: 3, x: 0.9, y: 0.71 },
      ],
      startPointId: 1,
      endPointId: 3,
      lapCount: 3,
      nextId: 4,
    });

    expect(result.points).toHaveLength(7);
    expect(result.points[0].x).toBeCloseTo(0.1);
    expect(result.points.at(-1).x).toBeCloseTo(0.9);
    expect(result.points.filter(point => point.y === 0.2)).toHaveLength(3);
  });

  it('conserva prefijo y sufijo al repetir solo una región', () => {
    const result = repeatControlPointRegion({
      controlPoints: [
        { id: 1, x: 0.1, y: 0.8 },
        { id: 2, x: 0.3, y: 0.6 },
        { id: 3, x: 0.5, y: 0.2 },
        { id: 4, x: 0.7, y: 0.61 },
        { id: 5, x: 0.9, y: 0.4 },
      ],
      startPointId: 2,
      endPointId: 4,
      lapCount: 2,
      nextId: 6,
    });

    expect(result.points[0]).toMatchObject({ id: 1, y: 0.8 });
    expect(result.points.at(-1)).toMatchObject({ id: 5, y: 0.4 });
    expect(result.points.filter(point => point.y === 0.2)).toHaveLength(2);
    expect(result.points.every((point, index, points) => index === 0 || point.x > points[index - 1].x)).toBe(true);
  });

  it('rechaza una vuelta cuyos extremos no representan el mismo nivel', () => {
    expect(() => repeatControlPointRegion({
      controlPoints: controls,
      startPointId: 1,
      endPointId: 4,
      lapCount: 2,
    })).toThrow(/altitud similar/);
  });
});
