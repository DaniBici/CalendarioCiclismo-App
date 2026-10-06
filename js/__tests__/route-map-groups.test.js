import { describe, expect, it } from 'vitest';
import { groupRepeatedPoints } from '../route-map.js';

// Posiciones de prueba: Garbí (tres pasos a ~100 m) y otra cima a 20 km.
const AT = {
  41.1: [39.6950, -0.3520], 116.6: [39.6958, -0.3530], 144.2: [39.6955, -0.3510],
  80: [39.8700, -0.4800],
  59.6: [39.7180, -0.3400], 135.1: [39.7182, -0.3402], 163.4: [39.7181, -0.3401],
};
const locate = s => ({ ll: AT[s.km], altRaw: s.alt });

describe('groupRepeatedPoints', () => {
  it('une los pasos por la misma cima con la categoría más dura y la altitud mayor', () => {
    const groups = groupRepeatedPoints([
      { name: 'Alto del Garbí', km: 41.1, category: '2', alt: 588 },
      { name: 'Alto del Garbí', km: 116.6, category: '1', alt: 580 },
      { name: 'alto del garbí ', km: 144.2, category: '1', alt: 593 },
    ], locate);
    expect(groups).toHaveLength(1);
    expect(groups[0].passes.map(s => s.km)).toEqual([41.1, 116.6, 144.2]);
    expect(groups[0].top.km).toBe(116.6);
    expect(groups[0].altRaw).toBe(593);
    expect(groups[0].ll).toEqual(AT[41.1]);
  });

  it('separa cimas distintas por nombre o por distancia', () => {
    const groups = groupRepeatedPoints([
      { name: 'Alto del Garbí', km: 41.1 },
      { name: 'Otra cima', km: 116.6 },
      { name: 'Alto del Garbí', km: 80 },
      { name: 'Alto del Garbí', km: null },
    ], locate);
    expect(groups.map(g => g.passes.map(s => s.km))).toEqual([[41.1], [116.6], [80]]);
    expect(groups[0].altRaw).toBeNull();
  });

  it('une los sprints del mismo tipo por el mismo lugar', () => {
    const groups = groupRepeatedPoints([
      { type: 'intermediate_sprint', name: 'Estivella', km: 59.6 },
      { type: 'intermediate_sprint', name: 'Estivella', km: 135.1 },
      { type: 'bonus_sprint', name: 'Estivella', km: 135.1 },
    ], locate, { keyOf: w => `${w.type}|${w.name}` });
    expect(groups.map(g => g.passes.map(s => s.km))).toEqual([[59.6, 135.1], [135.1]]);
  });

  it('no une nunca el punto de meta con otros pasos', () => {
    const groups = groupRepeatedPoints([
      { type: 'intermediate_sprint', name: 'Estivella', km: 59.6 },
      { type: 'intermediate_sprint', name: 'Estivella', km: 163.4 },
      { type: 'intermediate_sprint', name: 'Estivella', km: 135.1 },
    ], locate, { keyOf: w => `${w.type}|${w.name}`, finishKm: 163.4 });
    expect(groups.map(g => g.passes.map(s => s.km))).toEqual([[59.6, 135.1], [163.4]]);
  });
});
