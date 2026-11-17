// Acordeón de vídeos de la jornada y de la columna de clasificaciones
// (docs/plans/videos-5-2.md, D10). El reproductor se crea al abrir una fila,
// sin reproducción automática (decisión de Dani, 2026-11-11; el modal de TV sí
// arranca solo), y se retira al plegarla, para que el vídeo deje de sonar. Abrir una fila pliega la abierta:
// <details name> lo hace en los navegadores que lo admiten y este oyente, en el
// resto. El primero nace abierto con su reproductor y el «toggle» inicial no lo
// recrea. Un panel que el usuario ha tocado lleva data-touched: la jornada no
// lo repinta mientras tanto.
// Sin dependencias: lo carga también la isla de la jornada del publicador.

// Mismos atributos que videoFrameHtml() de js/stage/videos-html.js.
function videoFrame(src, title) {
  const frame = document.createElement('iframe');
  frame.className = 'video-frame';
  frame.src = src;
  frame.title = title;
  frame.loading = 'lazy';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allowFullscreen = true;
  return frame;
}

const PLATFORMS = [
  [/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)rtve\.es$/, 'rtve_play'],
  [/(^|\.)(etbon\.eus|eitb\.eus)$/, 'etb_on'],
  [/(^|\.)raiplay\.it$/, 'raiplay'],
  [/(^|\.)rtbf\.be$/, 'auvio'],
  [/(^|\.)cyltvplay\.es$/, 'cyltv'],
  [/(^|\.)ndr\.de$/, 'ndr'],
];
function platformOf(url) {
  let host = '';
  try { host = new URL(url, location.href).hostname.toLowerCase(); } catch { return 'other'; }
  return PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] || 'other';
}

// Apertura de un vídeo: mismo evento y parámetros en web y apps
// (docs/memory/analytics.md).
function trackOpen(kind, url) {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'video_open', { platform: platformOf(url), video_kind: kind || 'other' });
}

const bound = new WeakSet();

export function bindStageVideos(root) {
  if (!root || bound.has(root)) return;
  bound.add(root);
  root.addEventListener('click', event => {
    const link = event.target.closest?.('.video-row--external .video-link');
    if (link) trackOpen(link.closest('.video-row')?.dataset.kind, link.href);
  });
  root.addEventListener('toggle', event => {
    const fold = event.target;
    if (!fold?.classList?.contains('video-fold')) return;
    const body = fold.querySelector('.video-fold__body');
    if (!body) return;
    const frame = body.querySelector('iframe');
    if (fold.open) {
      root.querySelectorAll('details.video-fold[open]').forEach(other => { if (other !== fold) other.open = false; });
      if (frame || !fold.dataset.src) return;
      body.replaceChildren(videoFrame(fold.dataset.src, fold.dataset.title || ''));
      trackOpen(fold.dataset.kind, fold.dataset.src);
    } else if (frame) {
      body.replaceChildren();
    } else {
      return;
    }
    fold.closest('.video-panel')?.setAttribute('data-touched', '');
  }, true);
}

/**
 * Vídeos de la columna de clasificaciones: oculta las filas de un grupo
 * regional que el visitante no ve (`visible(country)`) y la sección si no
 * queda ninguna. Si la fila abierta queda oculta, abre la primera visible
 * insertable, sin arrancarla. Misma regla en cliente/pre-pintado-carrera.js.
 */
export function applyVideoRegion(root, visible) {
  root?.querySelectorAll('.res-videos').forEach(section => {
    const rows = [...section.querySelectorAll('.video-list > :is(.video-fold, .video-row)')];
    rows.forEach(row => { row.hidden = !!row.dataset.country && !visible(row.dataset.country); });
    section.hidden = rows.every(row => row.hidden);
    const folds = rows.filter(row => row.classList.contains('video-fold'));
    folds.filter(fold => fold.hidden && fold.open).forEach(fold => {
      fold.querySelector('.video-fold__body')?.replaceChildren();
      fold.open = false;
    });
    const first = folds.find(fold => !fold.hidden);
    if (first && !folds.some(fold => fold.open)) {
      first.querySelector('.video-fold__body')?.replaceChildren(videoFrame(first.dataset.src, first.dataset.title || ''));
      first.open = true;
    }
  });
}

/**
 * Tarjetas de la sección Vídeos (<details class="video-card">): al
 * desplegarse, abren su primer vídeo insertable con el reproductor, sin
 * arrancarlo; al plegarse, retiran sus reproductores para que dejen de sonar.
 * Una sola tarjeta abierta (<details name> y, sin él, este oyente).
 */
const boundCards = new WeakSet();

export function bindVideoCards(root) {
  if (!root || boundCards.has(root)) return;
  boundCards.add(root);
  bindStageVideos(root);
  root.addEventListener('toggle', event => {
    const card = event.target;
    if (card?.classList?.contains('video-card')) {
      if (card.open) {
        root.querySelectorAll('details.video-card[open]').forEach(other => { if (other !== card) other.open = false; });
        const first = card.querySelector('details.video-fold:not([hidden])');
        if (first && !card.querySelector('details.video-fold[open]')) {
          first.querySelector('.video-fold__body')?.replaceChildren(videoFrame(first.dataset.src, first.dataset.title || ''));
          first.open = true;
        }
      } else {
        card.querySelectorAll('details.video-fold').forEach(fold => {
          fold.querySelector('.video-fold__body')?.replaceChildren();
          fold.open = false;
        });
      }
    }
  }, true);
}

/** Con #videos en la dirección, lleva el panel a la vista cuando lo pinta el navegador. */
export function revealStageVideos(root) {
  if (location.hash !== '#videos') return;
  root?.querySelector('#videos')?.scrollIntoView({ block: 'start' });
}
