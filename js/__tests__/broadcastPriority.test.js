import { describe, it, expect } from 'vitest';
import { broadcastLinkPriority, pickBadgeBroadcast } from '../broadcast-priority.js';

// Prioridad del enlace del badge de TV en directo:
//  -1) CyLTV embebible  0) YouTube  1) otras redes  2) RTVE.es  3) RTP1/CCMA/EITB  4) resto.
describe('broadcastLinkPriority', () => {
  it('el reproductor embebible de CyLTV tiene prioridad máxima en la web', () => {
    expect(broadcastLinkPriority('https://www.cyltvplay.es/player/uuid/la8bu/la-8-burgos')).toBe(-1);
  });

  it('YouTube es el tier 0', () => {
    expect(broadcastLinkPriority('https://www.youtube.com/watch?v=abc')).toBe(0);
    expect(broadcastLinkPriority('https://youtu.be/abc')).toBe(0);
  });

  it('otras redes sociales son tier 1', () => {
    expect(broadcastLinkPriority('https://www.facebook.com/uci/videos/123')).toBe(1);
    expect(broadcastLinkPriority('https://fb.watch/abc')).toBe(1);
    expect(broadcastLinkPriority('https://www.instagram.com/p/abc')).toBe(1);
    expect(broadcastLinkPriority('https://www.tiktok.com/@uci/live')).toBe(1);
    expect(broadcastLinkPriority('https://www.twitch.tv/uci')).toBe(1);
    expect(broadcastLinkPriority('https://kick.com/uci')).toBe(1);
    expect(broadcastLinkPriority('https://twitter.com/uci')).toBe(1);
    expect(broadcastLinkPriority('https://x.com/uci')).toBe(1);
    expect(broadcastLinkPriority('https://www.x.com/uci')).toBe(1);
  });

  it('RTVE.es es tier 2 (por delante del resto de cadenas españolas)', () => {
    expect(broadcastLinkPriority('https://www.rtve.es/play/videos/directo/teledeporte/')).toBe(2);
  });

  it('otras TV públicas en abierto (RTP1, CCMA/3Cat, EITB) son tier 3', () => {
    expect(broadcastLinkPriority('https://www.rtp.pt/play/direto/rtp1')).toBe(3);
    expect(broadcastLinkPriority('https://www.ccma.cat/3cat/directes/esport3/')).toBe(3);
    expect(broadcastLinkPriority('https://www.3cat.cat/3cat/directes/esport3/')).toBe(3);
    expect(broadcastLinkPriority('https://www.eitb.eus/es/directo/etb-1/')).toBe(3);
    expect(broadcastLinkPriority('https://www.eitb.tv/es/directo/')).toBe(3);
  });

  it('RTVE gana a CCMA y EITB cuando compiten (caso etapa 4)', () => {
    const rtve = broadcastLinkPriority('https://www.rtve.es/play/videos/directo/teledeporte/');
    const eitb = broadcastLinkPriority('https://www.eitb.eus/es/directo/etb-1/');
    const ccma = broadcastLinkPriority('https://www.ccma.cat/3cat/directes/esport3/');
    expect(rtve).toBeLessThan(eitb);
    expect(rtve).toBeLessThan(ccma);
  });

  it('RTP1 gana a Eurosport / HBO Max para la Volta a Portugal', () => {
    const rtp1 = broadcastLinkPriority('https://www.rtp.pt/play/direto/rtp1');
    expect(rtp1).toBeLessThan(broadcastLinkPriority('https://play.hbomax.com/sport/abc'));
    expect(rtp1).toBeLessThan(broadcastLinkPriority('https://www.hbomax.com/gb/en/sports/cycling'));
  });

  it('Eurosport / HBO Max / Max son "una cadena más" (tier 4)', () => {
    expect(broadcastLinkPriority('https://www.eurosport.es/ciclismo/')).toBe(4);
    expect(broadcastLinkPriority('https://www.hbomax.com/es/es')).toBe(4);
    expect(broadcastLinkPriority('https://play.max.com/show/abc')).toBe(4);
  });

  it('play.max.com NO se confunde con x.com (no es red social)', () => {
    // Caso límite: "max.com" contiene la subcadena "x.com".
    expect(broadcastLinkPriority('https://play.max.com/show/abc')).toBe(4);
  });

  it('cadena genérica sin URL conocida es tier 4', () => {
    expect(broadcastLinkPriority('https://www.france.tv/sport/cyclisme/')).toBe(4);
    expect(broadcastLinkPriority('')).toBe(4);
    expect(broadcastLinkPriority(null)).toBe(4);
    expect(broadcastLinkPriority(undefined)).toBe(4);
  });
});

// Selección del broadcast al que enlaza el badge: una emisión ya en directo gana a
// una que aún no ha empezado, aunque esta sea de mayor tier.
describe('pickBadgeBroadcast', () => {
  // segundos epoch de una marca ISO; nowSec fijado por cada test para determinismo.
  const startSeconds = ts => (ts == null ? null : new Date(ts).getTime() / 1000);
  const NOW = new Date('2026-07-07T12:00:00Z').getTime() / 1000;

  // Caso Tour de Francia E4: Eurosport (tier 3) YA en directo, RTVE (tier 2) empieza
  // más tarde. El enlace debe ir a Eurosport (lo accesible AHORA), no a RTVE.
  const eurosport = { url: 'https://www.eurosport.es/ciclismo/', startTimeUtc: '2026-07-07T11:00:00Z', sortOrder: 1 };
  const rtve = { url: 'https://www.rtve.es/play/directo/', startTimeUtc: '2026-07-07T14:30:00Z', sortOrder: 0 };

  it('una emisión EN DIRECTO gana a una de mayor tier que aún no ha empezado', () => {
    expect(pickBadgeBroadcast([rtve, eurosport], startSeconds, NOW)).toBe(eurosport);
  });

  it('sin ninguna en directo, manda el tier (comportamiento previo)', () => {
    const early = new Date('2026-07-07T09:00:00Z').getTime() / 1000; // nada ha empezado
    expect(pickBadgeBroadcast([rtve, eurosport], startSeconds, early)).toBe(rtve);
  });

  it('con AMBAS en directo, manda el tier (RTVE por delante de Eurosport)', () => {
    const late = new Date('2026-07-07T15:00:00Z').getTime() / 1000; // ambas emitiendo
    expect(pickBadgeBroadcast([rtve, eurosport], startSeconds, late)).toBe(rtve);
  });

  it('CyLTV gana a RTVE si ambas emisiones están en directo', () => {
    const cyltv = { url: 'https://www.cyltvplay.es/player/uuid/la8bu/la-8-burgos', startTimeUtc: '2026-07-07T11:00:00Z', sortOrder: 2 };
    const rtveLive = { ...rtve, startTimeUtc: '2026-07-07T11:00:00Z' };
    expect(pickBadgeBroadcast([rtveLive, cyltv], startSeconds, NOW)).toBe(cyltv);
  });

  it('una emisión sin hora NO cuenta como en directo (solo cuenta en el fallback por tier)', () => {
    const yt = { url: 'https://youtube.com/watch', startTimeUtc: null, sortOrder: 2 };
    // Eurosport en directo debe ganar a un YouTube sin hora (no accesible con certeza aún).
    expect(pickBadgeBroadcast([yt, eurosport], startSeconds, NOW)).toBe(eurosport);
  });

  it('ignora broadcasts sin URL y devuelve null si no queda ninguno', () => {
    expect(pickBadgeBroadcast([{ url: null, startTimeUtc: '2026-07-07T10:00:00Z' }], startSeconds, NOW)).toBe(null);
    expect(pickBadgeBroadcast([], startSeconds, NOW)).toBe(null);
    expect(pickBadgeBroadcast(null, startSeconds, NOW)).toBe(null);
  });
});
