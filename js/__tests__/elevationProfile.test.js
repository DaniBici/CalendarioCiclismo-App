import { describe, expect, it } from 'vitest';
import { buildElevationProfileSVG } from '../elevation-profile.js';

const profile = {
  distance: 30,
  minElevation: 100,
  maxElevation: 500,
  points: [
    { km: 0, alt: 100 },
    { km: 10, alt: 250 },
    { km: 20, alt: 500 },
    { km: 30, alt: 250 },
  ],
};

describe('buildElevationProfileSVG', () => {
  it('dibuja los waypoints de ciudad como texto con línea, sin icono', () => {
    const { svg } = buildElevationProfileSVG({
      profile,
      waypoints: [{ km: 10, name: 'Punto de paso', type: 'town' }],
      width: 1200,
    });

    expect(svg).toContain('class="ep-waypoint"');
    expect(svg).toContain('Punto de paso</text>');
    expect(svg).toContain('stroke-dasharray="2,2"');
    expect(svg).not.toContain('class="ep-wp"');
    expect(svg).not.toContain('<circle');
  });

  it('omite los waypoints de ciudad del miniperfil solo iconos', () => {
    const { svg } = buildElevationProfileSVG({
      profile,
      waypoints: [{ km: 10, name: 'Punto de paso', type: 'town' }],
      width: 1200,
      iconsOnly: true,
    });

    expect(svg).not.toContain('ep-waypoint');
    expect(svg).not.toContain('Punto de paso');
  });

  it('oculta solo las localidades en móvil y mantiene los sprints', () => {
    const { svg } = buildElevationProfileSVG({
      profile,
      waypoints: [
        { km: 10, name: 'Punto de paso', type: 'town' },
        { km: 20, name: 'Sprint de prueba', type: 'intermediate_sprint' },
      ],
      width: 500,
    });

    expect(svg).not.toContain('ep-waypoint');
    expect(svg).not.toContain('Punto de paso');
    expect(svg).toContain('class="ep-sprint"');
  });
});
