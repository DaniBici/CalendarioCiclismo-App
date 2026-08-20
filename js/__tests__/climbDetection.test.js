import { describe, it, expect } from 'vitest';
import { detectClimb, computeClimbStats } from '../climb-detection.js';

// Genera un perfil sintético con segmentos rectos entre los puntos pasados.
// Los puntos ya son explícitos, así que sólo encadenamos {km, alt}.
function profile(...pts) {
  return pts.map(([km, alt]) => ({ km, alt }));
}

describe('detectClimb', () => {
  it('detecta una subida limpia desde el valle hasta la cima', () => {
    // Inicio plano en valle (200 m) → 10 km al 6 % hasta cima 800 m
    const pts = profile(
      [0,   200],
      [5,   200],
      [10,  200],
      [15,  500],
      [20,  800],
    );
    const r = detectClimb(pts, 20);
    expect(r).not.toBeNull();
    expect(r.startKm).toBe(10);
    expect(r.lengthKm).toBe(10);
    expect(r.avgGradient).toBeCloseTo(6, 1);
  });

  it('no extiende el puerto a través de una bajada importante intermedia', () => {
    // Tres "puertos": valle a 200, sube a 600, baja a 300, sube a 800 (cima)
    // El puerto de la cima debe arrancar en el valle 300 (km 30), no en el 200 inicial.
    const pts = profile(
      [0,   200],
      [10,  600],   // primera cima
      [20,  300],   // valle intermedio
      [30,  300],   // arranque del puerto final
      [40,  800],   // cima
    );
    const r = detectClimb(pts, 40);
    expect(r).not.toBeNull();
    expect(r.startKm).toBe(30);
    expect(r.lengthKm).toBe(10);
    expect(r.avgGradient).toBeCloseTo(5, 1);
  });

  it('tolera pequeños descansos (<30 m) sin cortar el puerto', () => {
    // 0 → 200 m de altura, con un mini-flat de 20 m en el medio
    const pts = profile(
      [0,    100],
      [5,    300],
      [10,   285],   // pequeño descansillo de 15 m, dentro de tolerancia
      [15,   500],
    );
    const r = detectClimb(pts, 15);
    expect(r).not.toBeNull();
    expect(r.startKm).toBe(0);
    expect(r.lengthKm).toBe(15);
  });

  it('descarta puertos demasiado cortos', () => {
    const pts = profile(
      [0,   500],
      [0.2, 510],
      [0.3, 520],
    );
    const r = detectClimb(pts, 0.3);
    expect(r).toBeNull();
  });

  it('descarta tramos con pendiente media < 2 %', () => {
    // 5 km al 1 % → 50 m de desnivel. No es puerto.
    const pts = profile(
      [0,   100],
      [5,   150],
    );
    const r = detectClimb(pts, 5);
    expect(r).toBeNull();
  });

  it('limita la longitud al máximo permitido (50 km)', () => {
    // Ascenso muy largo y suave de 80 km al 3 %
    const pts = [];
    for (let km = 0; km <= 80; km += 2) {
      pts.push({ km, alt: 100 + km * 30 });
    }
    const r = detectClimb(pts, 80);
    expect(r).not.toBeNull();
    expect(r.lengthKm).toBeLessThanOrEqual(50);
  });

  it('no absorbe un valle suave previo al puerto', () => {
    // Valle a baja pendiente (~1 %) durante 10 km y luego puerto serio del 8 %
    // hasta la cima. El detector debe arrancar en el inicio del puerto serio,
    // no al principio del falso valle.
    const pts = [];
    for (let km = 0; km <= 10; km += 1) pts.push({ km, alt: 200 + km * 10 });   // 1 %
    for (let km = 11; km <= 20; km += 1) pts.push({ km, alt: 300 + (km - 10) * 80 }); // 8 %
    const r = detectClimb(pts, 20);
    expect(r).not.toBeNull();
    expect(r.startKm).toBeGreaterThanOrEqual(9);
    expect(r.startKm).toBeLessThanOrEqual(11);
    expect(r.avgGradient).toBeGreaterThan(6);
  });

  it('detecta puertos largos suaves con el pase permisivo', () => {
    // Subida continua de 14 km al ~2.3 % (puerto cat-3 suave). El pase
    // estricto la rechazaría por pendiente local < 3 %, pero el permisivo
    // la captura entera.
    const pts = [];
    for (let km = 0; km <= 14; km += 0.5) {
      pts.push({ km, alt: 426 + km * 22 });
    }
    const r = detectClimb(pts, 14);
    expect(r).not.toBeNull();
    expect(r.startKm).toBe(0);
    expect(r.lengthKm).toBe(14);
    expect(r.avgGradient).toBeCloseTo(2.2, 1);
  });

  it('soporta cima entre dos puntos del perfil (interpola)', () => {
    const pts = profile(
      [0,    100],
      [5,    400],
      [10,   700],
    );
    const r = detectClimb(pts, 7.5);
    expect(r).not.toBeNull();
    expect(r.startKm).toBe(0);
    expect(r.lengthKm).toBe(7.5);
  });

  it('devuelve null si los datos son incompletos', () => {
    expect(detectClimb(null, 10)).toBeNull();
    expect(detectClimb([{ km: 0, alt: 0 }], 0)).toBeNull();
    expect(detectClimb(profile([0, 100], [10, 500]), null)).toBeNull();
    expect(detectClimb(profile([0, 100], [10, 500]), 999)).toBeNull();
  });
});

describe('computeClimbStats', () => {
  it('calcula longitud y pendiente para startKm dado', () => {
    const pts = profile([0, 200], [10, 200], [20, 800]);
    const r = computeClimbStats(pts, 10, 20);
    expect(r.lengthKm).toBe(10);
    expect(r.avgGradient).toBeCloseTo(6, 1);
  });

  it('respeta override de altitud de la cima si se pasa', () => {
    const pts = profile([0, 200], [10, 200], [20, 700]);
    const r = computeClimbStats(pts, 10, 20, 800);
    expect(r.avgGradient).toBeCloseTo(6, 1);
  });

  it('devuelve null si startKm >= summitKm', () => {
    const pts = profile([0, 100], [10, 500]);
    expect(computeClimbStats(pts, 10, 5)).toBeNull();
    expect(computeClimbStats(pts, 5, 5)).toBeNull();
  });
});
