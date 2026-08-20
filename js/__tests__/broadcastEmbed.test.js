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
});
