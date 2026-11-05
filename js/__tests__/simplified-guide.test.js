import { describe, it, expect } from 'vitest';
import { buildSimplifiedGuide, hasSimplifiedGuide } from '../simplified-guide.js';

// Horas de paso publicadas: interpolación por km entre anclas y horas
// manuales de cima y pie; en CRI/CRE no se interpola.

const START = '2026-04-26T08:00:00.000Z'; // 10:00 CEST
const FINISH = '2026-04-26T14:20:00.000Z'; // 16:20 CEST (380 min después)

describe('buildSimplifiedGuide', () => {
  it('interpola linealmente por km un waypoint sin hora', () => {
    // Sprint a mitad de recorrido → mitad de tiempo (10:00 + 190min = 13:10)
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      summits: [],
      waypoints: [{ km: 50, name: 'Sprint', type: 'intermediate_sprint' }],
    });
    const sprint = rows.find(r => r.type === 'intermediate_sprint');
    expect(sprint).toBeTruthy();
    expect(sprint.isEstimated).toBe(true);
    // 08:00Z + 190min = 11:10Z
    expect(sprint.timeUtc).toBe('2026-04-26T11:10:00.000Z');
  });

  it('respeta la hora manual de una cima y la usa como ancla', () => {
    const summitTime = '2026-04-26T12:00:00.000Z';
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      summits: [{ km: 60, name: 'Puerto', category: '1', startKm: 50, timeUtc: summitTime }],
      waypoints: [],
    });
    const summit = rows.find(r => r.type === 'summit');
    expect(summit.timeUtc).toBe(summitTime);
    expect(summit.isEstimated).toBe(false);
    // El pie (km 50) se interpola entre salida (km0,08:00Z) y cima (km60,12:00Z)
    // → 08:00 + (50/60)*4h = 08:00 + 200min = 11:20Z
    const foot = rows.find(r => r.type === 'climb_foot');
    expect(foot.km).toBe(50);
    expect(foot.isEstimated).toBe(true);
    expect(foot.timeUtc).toBe('2026-04-26T11:20:00.000Z');
  });

  it('respeta footTimeUtc como hora real del pie (ancla, no estimada)', () => {
    const footTime = '2026-04-26T11:40:00.000Z';
    const summitTime = '2026-04-26T12:00:00.000Z';
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      summits: [{ km: 60, name: 'Puerto', category: '1', startKm: 50,
                  timeUtc: summitTime, footTimeUtc: footTime }],
      waypoints: [],
    });
    const foot = rows.find(r => r.type === 'climb_foot');
    // Usa la hora real del rutómetro, NO la interpolación (que daría 11:20Z)
    expect(foot.timeUtc).toBe(footTime);
    expect(foot.isEstimated).toBe(false);
    // La guía se activa porque el pie es una hora manual del rutómetro
    expect(hasSimplifiedGuide(rows)).toBe(true);
  });

  it('en CRI/CRE no interpola y solo muestra puntos intermedios manuales', () => {
    const splitTime = '2026-04-26T10:30:00.000Z';
    const rows = buildSimplifiedGuide({
      distanceKm: 40,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      primaryType: 'itt',
      waypoints: [
        { km: 20, name: 'Split', type: 'intermediate_split', timeUtc: splitTime },
        { km: 10, name: 'Sprint', type: 'intermediate_sprint' }, // oculto en CRI
        { km: 30, name: 'Otro split', type: 'intermediate_split' }, // sin hora → null
      ],
    });
    // El sprint no aparece en CRI
    expect(rows.find(r => r.type === 'intermediate_sprint')).toBeUndefined();
    const splitWithTime = rows.find(r => r.km === 20);
    expect(splitWithTime.timeUtc).toBe(splitTime);
    const splitNoTime = rows.find(r => r.km === 30);
    // No se interpola en CRI
    expect(splitNoTime.timeUtc).toBeNull();
    expect(splitNoTime.isEstimated).toBe(true);
  });
});
