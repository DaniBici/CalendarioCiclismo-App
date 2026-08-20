// ─────────────────────────────────────────────────────────────────
//  Prioridad del enlace del badge de TV en directo (Hoy / Competición)
//
//  Decide a qué emisión enlaza el badge de TV cuando hay varias. Orden:
//   -1) reproductor embebible de CyLTV
//    0) YouTube
//    1) otras redes sociales (Facebook, Instagram, X/Twitter, TikTok, Twitch, Kick)
//    2) RTVE.es (la pública estatal, por delante del resto de cadenas españolas)
//    3) otras TV públicas en abierto: RTP1, CCMA (TV3 / Esport3 / 3Cat), EITB (ETB)
//    4) resto de cadenas
//
//  Eurosport / HBO Max / Max son "una cadena más" (tier 4, sin trato
//  especial). Módulo puro y con dependencias locales puras para poder testearse en Node.
//  La excepción CyLTV es propia de la web porque abre el reproductor inline.
//  El resto de tiers tiene espejo en iOS Swift y Android Kotlin.
// ─────────────────────────────────────────────────────────────────

import { isCyltvPlayerUrl } from './broadcast-embed.js';

const _YT = /youtube\.com|youtu\.be/i;
// Nota: `x.com` se ancla con `//` o `.` delante para no capturar `play.max.com`.
const _OTHER_SOCIAL = /facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitch\.tv|kick\.com|twitter\.com|(?:\/\/|\.)x\.com/i;
// RTVE (rtve.es) = pública estatal; va por delante del resto de cadenas españolas.
const _RTVE = /rtve\.es/i;
// Otras TV públicas en abierto: RTP1 (rtp.pt), CCMA / 3Cat (ccma.cat, 3cat.cat) y EITB (eitb.eus/tv).
const _OTHER_PUBLIC_TV = /rtp\.pt|ccma\.cat|3cat\.cat|eitb\./i;

export function broadcastLinkPriority(url) {
  const u = url || '';
  if (isCyltvPlayerUrl(u)) return -1;
  if (_YT.test(u)) return 0;
  if (_OTHER_SOCIAL.test(u)) return 1;
  if (_RTVE.test(u)) return 2;
  if (_OTHER_PUBLIC_TV.test(u)) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────────────────
//  Selección del broadcast al que enlaza el badge de TV en directo.
//
//  Una emisión YA EN DIRECTO (su hora de inicio ya pasó) gana SIEMPRE a una que
//  aún no ha empezado, aunque esta última sea de mayor tier. Así, si Eurosport
//  (tier 3) ya emite pero RTVE (tier 2) todavía no, el badge enlaza a Eurosport
//  (lo accesible AHORA), no a RTVE. Entre emisiones del mismo estado (todas en
//  directo, o todas por empezar) manda el tier (`broadcastLinkPriority`) y, a
//  igualdad de tier, el `sortOrder` del admin. Sin ninguna en directo se conserva
//  el tier puro sobre todas (comportamiento pre-fix). Espejo en iOS/Android.
//
//  `broadcasts`: array con `{ url, startTimeUtc, sortOrder }`. `startSeconds(ts)`
//  convierte la marca de tiempo a segundos epoch (o null). `nowSec` = ahora en
//  segundos. Devuelve el broadcast elegido (con `.url`) o null.
export function pickBadgeBroadcast(broadcasts, startSeconds, nowSec) {
  const isLive = b => { const s = startSeconds(b.startTimeUtc); return s != null && s <= nowSec; };
  return (broadcasts || [])
    .filter(b => b.url)
    .sort((a, b) => {
      const aLive = isLive(a) ? 0 : 1;
      const bLive = isLive(b) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const aPri = broadcastLinkPriority(a.url);
      const bPri = broadcastLinkPriority(b.url);
      if (aPri !== bPri) return aPri - bPri;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    })[0] || null;
}
