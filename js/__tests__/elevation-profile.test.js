import { describe, expect, it } from 'vitest';
import { buildElevationProfileSVG, profileThemeColor, mergeCoincidentProfileAnnotations } from '../stage/elevation-profile.js';

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
  it('fusiona solo el puerto y la bonificación del mismo km exacto en un marcador doble', () => {
    const summit = { km: 20, name: 'Puerto de prueba', category: '2' };
    const bonus = { km: 20, name: 'Bonificación', type: 'bonus_sprint' };
    const nearby = { km: 20.1, name: 'Sprint próximo', type: 'intermediate_sprint' };
    const annotations = mergeCoincidentProfileAnnotations([summit], [bonus, nearby]);

    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toMatchObject({
      kind: 'summit',
      km: 20,
      secondaryKind: 'bonus_sprint',
      secondaryItem: bonus,
    });
    expect(annotations[1]).toMatchObject({ kind: 'intermediate_sprint', km: 20.1 });

    const { svg } = buildElevationProfileSVG({ profile, summits: [summit], waypoints: [bonus], width: 500 });
    expect(svg).toContain('class="ep-summit" data-combined-marker="true"');
    expect(svg).toContain('fill="#c53030"');
    expect(svg).toContain('fill="#f9ab00"');
    expect(svg).not.toContain('class="ep-sprint"');
  });

  it('añade la meta como segundo icono de una cima o waypoint final', () => {
    const summit = { km: 30, name: 'Alto de meta', category: '1' };
    const summitAnnotations = mergeCoincidentProfileAnnotations([summit], [], 30);
    expect(summitAnnotations).toHaveLength(1);
    expect(summitAnnotations[0]).toMatchObject({
      kind: 'summit',
      secondaryKind: 'finish',
      secondaryItem: null,
    });

    const bonus = { km: 30, name: 'Sprint de meta', type: 'bonus_sprint' };
    const waypointAnnotations = mergeCoincidentProfileAnnotations([], [bonus], 30);
    expect(waypointAnnotations).toHaveLength(1);
    expect(waypointAnnotations[0]).toMatchObject({
      kind: 'bonus_sprint',
      secondaryKind: 'finish',
    });

    const { svg } = buildElevationProfileSVG({ profile, summits: [summit], width: 500 });
    expect(svg).toContain('class="ep-summit" data-combined-marker="true"');
    expect(svg).toContain('fill="#c53030"');
    expect(svg).toContain('fill="#e63d3d"');
  });

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
  it('oculta en móvil todos los nombres de puntos y conserva sus marcadores', () => {
    const names = ['Salida muy larga', 'Meta muy larga', 'Puerto muy largo', 'Sprint muy largo'];
    const { svg } = buildElevationProfileSVG({
      profile,
      width: 760,
      startLocation: names[0],
      finishLocation: names[1],
      summits: [{ km: 20, name: names[2], category: '2' }],
      waypoints: [{ km: 10, name: names[3], type: 'intermediate_sprint' }],
    });

    for (const name of names) expect(svg).not.toContain(name);
    for (const marker of ['ep-start', 'ep-finish', 'ep-summit', 'ep-sprint']) expect(svg).toContain(marker);
  });
  it('mantiene dentro del SVG los nombres de salida, meta y anotaciones', () => {
    const { svg } = buildElevationProfileSVG({
      profile,
      width: 900,
      startLocation: 'Una salida con un nombre extremadamente largo que debe ajustarse al espacio disponible',
      finishLocation: 'Una meta con un nombre extremadamente largo que debe ajustarse al espacio disponible',
      summits: [{ km: 30, name: 'Un puerto con un nombre extremadamente largo que debe ajustarse al gráfico', category: '1' }],
      waypoints: [{ km: 0, name: 'Una localidad con un nombre extremadamente largo que debe ajustarse al gráfico', type: 'town' }],
    });

    expect(svg).toContain('overflow:hidden');
    expect(svg).toMatch(/class="ep-point-name" x="68"[^>]*text-anchor="start"/);
    expect(svg).toMatch(/class="ep-point-name" x="870"[^>]*text-anchor="end"/);
    expect(svg).toContain('…');
  });
  it('permite ocultar nombres conservando símbolos y ejes en Resultados', () => {
    const options = { profile, width:1200, startLocation:'Salida de prueba', finishLocation:'Meta de prueba',
      summits:[{km:20,name:'Puerto de prueba',category:'2'}],
      waypoints:[{km:10,name:'Sprint de prueba',type:'intermediate_sprint'},{km:15,name:'Ciudad de prueba',type:'town'}] };
    const { svg } = buildElevationProfileSVG({...options,hidePointNames:true});
    for (const name of ['Salida de prueba','Meta de prueba','Puerto de prueba','Sprint de prueba','Ciudad de prueba']) expect(svg).not.toContain(name);
    for (const marker of ['ep-start','ep-finish','ep-summit','ep-sprint']) expect(svg).toContain(marker);
    expect(svg).toContain('altitud (m)');
    expect(buildElevationProfileSVG(options).svg).toContain('Puerto de prueba');
  });

  it('oculta las anotaciones de un perfil denso pero conserva salida y meta', () => {
    const summits = Array.from({ length:13 }, (_, index) => ({
      km:index + 2,
      name:`Cota repetida ${index + 1}`,
      category:'M',
    }));
    const { svg } = buildElevationProfileSVG({
      profile,
      width:900,
      startLocation:'Salida visible',
      finishLocation:'Meta visible',
      summits,
    });

    for (const summit of summits) expect(svg).not.toContain(summit.name);
    expect(svg.match(/class="ep-summit"/g)).toHaveLength(13);
    expect(svg).toContain('Salida visible');
    expect(svg).toContain('Meta visible');
    expect(svg).toContain('altitud (m)');
  });

  it('mantiene las etiquetas cuando la densidad todavía es legible', () => {
    const summits = Array.from({ length:12 }, (_, index) => ({
      km:index + 2,
      name:`Cota ${index + 1}`,
      category:'M',
    }));
    const { svg } = buildElevationProfileSVG({ profile, width:900, summits });

    expect(svg).toContain('Cota 1');
    expect(svg).toContain('Cota 12');
  });

});


describe('contraste del color de perfil', () => {
  it('aclara colores oscuros hasta superar 4.5:1 sobre la tarjeta oscura', () => {
    const luminance = rgb => rgb.reduce((sum, c, i) => sum +
      (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i], 0);
    for (const color of ['#000000', '#171568', '#003300', '#800000']) {
      const result = profileThemeColor(color);
      const mix = Number(result.match(/calc\(([\d.]+)%/)[1]) / 100;
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
      const corrected = rgb.map(c => c + (1 - c) * mix);
      expect((luminance(corrected) + 0.05) / (luminance([30/255, 38/255, 50/255]) + 0.05)).toBeGreaterThan(4.5);
      expect(result).toContain('var(--profile-dark-correction, 1)');
    }
  });

  it('corrige colores claros sin cambiar la geometría', () => {
    expect(profileThemeColor('#ffff00')).toContain('black calc(');
    expect(profileThemeColor('#fff')).toContain('--profile-light-correction, 0');
    expect(profileThemeColor(null)).toBe('var(--accent)');
    const dark = buildElevationProfileSVG({ profile, color: '#171568' }).svg;
    const light = buildElevationProfileSVG({ profile, color: '#ffff00' }).svg;
    expect([...dark.matchAll(/ d="([^"]+)"/g)].map(m => m[1]))
      .toEqual([...light.matchAll(/ d="([^"]+)"/g)].map(m => m[1]));
    expect(dark).toContain('stroke-width="2" stroke-linejoin="round"');
    expect(dark).toContain('fill-opacity="0.42"');
  });
});


it('oscurece colores luminosos hasta superar 4.5:1 en la tarjeta clara', () => {
  const luminance = rgb => rgb.reduce((sum, c, i) => sum +
    (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i], 0);
  for (const color of ['#ffffff', '#ffff00', '#00ff00', '#ffaaaa']) {
    const result = profileThemeColor(color);
    const mix = Number(result.match(/black calc\(([\d.]+)%/)[1]) / 100;
    const corrected = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255 * (1 - mix));
    expect((luminance([250/255, 251/255, 252/255]) + 0.05) / (luminance(corrected) + 0.05)).toBeGreaterThan(4.5);
  }
});
