import { describe, expect, it } from 'vitest';
import { extractYouTubeId, getBroadcastEmbed, isCyltvPlayerUrl, isNdrPlayerUrl } from '../broadcast-embed.js';

describe('getBroadcastEmbed', () => {
  it('genera el embed privado de YouTube', () => {
    const url = 'https://www.youtube.com/watch?v=abcdefghijk';
    expect(extractYouTubeId(url)).toBe('abcdefghijk');
    expect(getBroadcastEmbed(url)).toMatchObject({
      provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1',
      externalUrl: url,
    });
  });

  it('permite exclusivamente el player HTTPS de CyLTV', () => {
    const url = 'https://www.cyltvplay.es/player/uuid/la8bu/la-8-burgos';
    expect(isCyltvPlayerUrl(url)).toBe(true);
    expect(getBroadcastEmbed(url)).toMatchObject({
      provider: 'cyltv',
      src: url,
      externalLabel: 'CyLTV',
    });
    expect(isCyltvPlayerUrl('http://www.cyltvplay.es/player/uuid')).toBe(false);
    expect(isCyltvPlayerUrl('https://evil.example/player/uuid')).toBe(false);
    expect(isCyltvPlayerUrl('https://www.cyltvplay.es/not-a-player/uuid')).toBe(false);
  });

  it('permite el reproductor standalone HTTPS de NDR', () => {
    const url = 'https://www.ndr.de/sport/mehr_sport/eventlivestream-432~player.html';
    expect(isNdrPlayerUrl(url)).toBe(true);
    expect(getBroadcastEmbed(url)).toMatchObject({
      provider: 'ndr',
      src: url,
      externalLabel: 'NDR',
    });
    expect(isNdrPlayerUrl('https://www.ndr.de/sport/mehr_sport/eventlivestream-432.html')).toBe(false);
    expect(isNdrPlayerUrl('https://evil.example/eventlivestream-432~player.html')).toBe(false);
  });

  it('respeta un embed deshabilitado y rechaza proveedores no permitidos', () => {
    expect(getBroadcastEmbed('https://www.youtube.com/watch?v=abcdefghijk', false)).toBe(null);
    expect(getBroadcastEmbed('https://example.com/live')).toBe(null);
  });

  it('no extrae un ID falso de un parámetro v= fuera de YouTube', () => {
    // Caso real: Tour de Gatineau 2026, Facebook Live con ID de 16 dígitos.
    // La regex sin validar host tomaba los primeros 11 chars como ID de YouTube.
    const url = 'https://www.facebook.com/watch/live/?ref=watch_permalink&v=1387931809525547';
    expect(extractYouTubeId(url)).toBe(null);
    expect(getBroadcastEmbed(url)).toBe(null);
    expect(extractYouTubeId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(extractYouTubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(extractYouTubeId('https://www.youtube.com/live/abcdefghijk')).toBe('abcdefghijk');
    expect(extractYouTubeId('https://fakeyoutube.com/watch?v=abcdefghijk')).toBe(null);
    expect(extractYouTubeId('https://example.com/?v=abcdefghijk')).toBe(null);
    expect(extractYouTubeId('no es una url')).toBe(null);
  });
});
