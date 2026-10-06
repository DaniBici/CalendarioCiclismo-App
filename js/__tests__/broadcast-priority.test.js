import { describe, it, expect } from 'vitest';
import { broadcastLinkPriority, hasReviveBroadcastsForDay, isReviveBroadcast, pickBadgeBroadcast, reviveBroadcastsForDay, shouldShowBroadcastNote } from '../broadcast-priority.js';

// Prioridad del enlace del badge de TV en directo:
//  -1) CyLTV embebible  0) YouTube  1) otras redes  2) RTVE.es  3) RTP1/CCMA/EITB  4) resto.
describe('broadcastLinkPriority', () => {
  it.each([
    [-1, ['https://www.cyltvplay.es/player/uuid/la8bu/la-8-burgos']],
    [0, ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc']],
    [1, ['https://www.facebook.com/uci/videos/123', 'https://fb.watch/abc', 'https://www.instagram.com/p/abc',
      'https://www.tiktok.com/@uci/live', 'https://www.twitch.tv/uci', 'https://kick.com/uci',
      'https://twitter.com/uci', 'https://x.com/uci', 'https://www.x.com/uci']],
    [2, ['https://www.rtve.es/play/videos/directo/teledeporte/']],
    [3, ['https://www.rtp.pt/play/direto/rtp1', 'https://www.ccma.cat/3cat/directes/esport3/',
      'https://www.3cat.cat/3cat/directes/esport3/', 'https://www.eitb.eus/es/directo/etb-1/', 'https://www.eitb.tv/es/directo/']],
    // play.max.com contiene la subcadena "x.com" y no es una red social.
    [4, ['https://www.eurosport.es/ciclismo/', 'https://www.hbomax.com/es/es', 'https://play.hbomax.com/sport/abc', 'https://play.max.com/show/abc',
      'https://www.france.tv/sport/cyclisme/', '', null, undefined]],
  ])('asigna el tier %i', (tier, urls) => {
    for (const url of urls) expect(broadcastLinkPriority(url)).toBe(tier);
  });
});

describe('isReviveBroadcast', () => {
  it('mantiene como Revive cualquier fuente declarada por los datos', () => {
    expect(isReviveBroadcast({
      channel: 'Pidcock Racing', url: 'https://video.example/race', showInRevive: true,
    })).toBe(true);
  });

  it('reconoce redes sociales con vídeo persistente sin marca manual', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc', 'https://fb.watch/abc',
      'https://www.instagram.com/reel/abc', 'https://www.tiktok.com/@race/video/1',
      'https://www.twitch.tv/videos/1', 'https://kick.com/race',
      'https://x.com/race/status/1',
    ]) {
      expect(isReviveBroadcast({ channel: 'Social', url })).toBe(true);
    }
  });

  it('reconoce un deep-link bajo demanda de ETB ON sin showInRevive', () => {
    expect(isReviveBroadcast({
      channel: 'ETB1', url: 'https://etbon.eus/m/txirrindularitza-itzulia-5-12345',
      showInRevive: false,
    })).toBe(true);
  });

  it('no convierte el hub lineal de ETB ON en Revive', () => {
    expect(isReviveBroadcast({ channel: 'ETB1', url: 'https://etbon.eus/ch/etb-1' })).toBe(false);
  });
});

describe('shouldShowBroadcastNote', () => {
  it('oculta cualquier nota con resultados y conserva la regla de Revive sin ellos', () => {
    expect(shouldShowBroadcastNote(true, false, false)).toBe(false);
    expect(shouldShowBroadcastNote(true, true, true)).toBe(false);
    expect(shouldShowBroadcastNote(false, false, false)).toBe(true);
    expect(shouldShowBroadcastNote(false, true, false)).toBe(false);
    expect(shouldShowBroadcastNote(false, true, true)).toBe(true);
  });
});

describe('reviveBroadcastsForDay', () => {
  it('en una cancelada conserva solo la selección editorial explícita', () => {
    const selected = { channel: 'Canal', url: 'https://video.example/selected', showInRevive: true };
    const automatic = { channel: 'Eurosport 1', url: 'https://eurosport.example/live', showInRevive: false };
    expect(reviveBroadcastsForDay([automatic, selected], true)).toEqual([selected]);
  });
});

describe('hasReviveBroadcastsForDay', () => {
  const replay = { channel: 'Eurosport 1', url: 'https://video.example/replay' };

  it('se activa con clasificaciones de la jornada sin esperar a la hora de meta', () => {
    expect(hasReviveBroadcastsForDay([replay], true, false)).toBe(true);
  });

  it('no se activa por una general del día anterior ni por una emisión sin enlace', () => {
    expect(hasReviveBroadcastsForDay([replay], false, false)).toBe(false);
    expect(hasReviveBroadcastsForDay([{ ...replay, url: null }], true, false)).toBe(false);
  });

  it('en una cancelada exige clasificaciones y una selección editorial', () => {
    expect(hasReviveBroadcastsForDay([replay], true, true)).toBe(false);
    expect(hasReviveBroadcastsForDay([{ ...replay, showInRevive: true }], true, true)).toBe(true);
    expect(hasReviveBroadcastsForDay([{ ...replay, showInRevive: true }], false, true)).toBe(false);
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
