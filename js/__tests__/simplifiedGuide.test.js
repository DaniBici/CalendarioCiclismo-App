import { describe, it, expect } from 'vitest';
import { buildSimplifiedGuide, hasSimplifiedGuide } from '../simplified-guide.js';

// Vectores de prueba COMPARTIDOS con las suites de iOS y Android
// (SimplifiedGuideServiceTests / SimplifiedGuideTest). Si cambian aquí,
// actualizar también allí para mantener la paridad.

const START = '2026-04-26T08:00:00.000Z'; // 10:00 CEST
const FINISH = '2026-04-26T14:20:00.000Z'; // 16:20 CEST (380 min después)

describe('buildSimplifiedGuide', () => {
  it('inserta salida y llegada como anclas en los extremos', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      summits: [],
      waypoints: [],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('start');
    expect(rows[0].km).toBe(0);
    expect(rows[0].kmToGo).toBe(100);
    expect(rows[0].isEstimated).toBe(false);
    expect(rows[1].type).toBe('finish');
    expect(rows[1].km).toBe(100);
    expect(rows[1].kmToGo).toBe(0);
  });

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

  it('ordena por km con el pie del puerto antes de la cima', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      summits: [{ km: 60, name: 'A', startKm: 50 }],
      waypoints: [{ km: 30, name: 'Sprint', type: 'intermediate_sprint' }],
    });
    const types = rows.map(r => r.type);
    expect(types).toEqual(['start', 'intermediate_sprint', 'climb_foot', 'summit', 'finish']);
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

  it('sin distancia no calcula kmToGo y omite la llegada', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: null,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      waypoints: [{ km: 20, name: 'Sprint', type: 'intermediate_sprint' }],
    });
    expect(rows.find(r => r.type === 'finish')).toBeUndefined();
    expect(rows.every(r => r.kmToGo === null)).toBe(true);
  });

  it('sin ninguna hora deja los puntos sin timeUtc', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      summits: [{ km: 50, name: 'A', startKm: 40 }],
    });
    expect(rows.every(r => r.timeUtc == null)).toBe(true);
    expect(rows.every(r => r.isEstimated)).toBe(true);
  });

  it('excluye waypoints kom y sprints en pruebas de ruta muestran split oculto', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100,
      neutralStartTimeUtc: START,
      estimatedFinishTimeUtc: FINISH,
      waypoints: [
        { km: 10, type: 'kom' },
        { km: 20, type: 'intermediate_split' }, // oculto en ruta
        { km: 30, type: 'cobblestone', name: 'Pavé' },
      ],
    });
    expect(rows.find(r => r.type === 'kom')).toBeUndefined();
    expect(rows.find(r => r.type === 'intermediate_split')).toBeUndefined();
    expect(rows.find(r => r.type === 'cobblestone')).toBeTruthy();
  });
});

describe('hasSimplifiedGuide (opt-in: requiere ≥1 hora manual)', () => {
  it('false si solo hay salida y llegada', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100, neutralStartTimeUtc: START, estimatedFinishTimeUtc: FINISH,
    });
    expect(hasSimplifiedGuide(rows)).toBe(false);
  });

  it('false con puntos intermedios SIN hora manual (solo interpolados)', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100, neutralStartTimeUtc: START, estimatedFinishTimeUtc: FINISH,
      waypoints: [{ km: 50, type: 'intermediate_sprint' }],
    });
    expect(hasSimplifiedGuide(rows)).toBe(false);
  });

  it('true cuando al menos un punto intermedio tiene hora manual del rutómetro', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100, neutralStartTimeUtc: START, estimatedFinishTimeUtc: FINISH,
      waypoints: [{ km: 50, type: 'intermediate_sprint', timeUtc: '2026-04-26T11:00:00.000Z' }],
    });
    expect(hasSimplifiedGuide(rows)).toBe(true);
  });

  it('false sin ninguna hora', () => {
    const rows = buildSimplifiedGuide({
      distanceKm: 100, summits: [{ km: 50, startKm: 40 }],
    });
    expect(hasSimplifiedGuide(rows)).toBe(false);
  });
});
