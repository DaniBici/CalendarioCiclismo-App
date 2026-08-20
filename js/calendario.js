// ─────────────────────────────────────────────────────────────────
//  CALENDARIO — calendario.html (+ EN /en/calendar/)
//  Fusión de las antiguas vistas Mes y Temporada en una sola página con
//  toggle, espejo del CalendarScreen de las apps 3.1 (Android
//  ui/calendar/CalendarScreen.kt): subvista persistida (localStorage
//  cc-cal-subview ≙ DataStore calendarSubview) y deep-link ?vista=mes|temporada.
//
//  Cada subvista se importa de forma diferida al activarse:
//   · temporada → js/temporada.js (se auto-inicializa al importarse, igual
//     que cuando era página propia; sus IDs #temporadaFilters/#temporadaContent
//     viven en esta página).
//   · mes → js/calendario-mes.js (agenda mensual, port del MonthScreen de
//     las apps; la rejilla antigua de mes.html se retiró el 2026-06-12).
//
//  Overlay de carga (js/page-loading.js): el marcador .loading estático es
//  hijo directo de #calMain, de modo que el observer cubre las dos subvistas;
//  aquí se inyecta el .loading de la subvista activa ANTES de retirar el
//  estático para que no haya hueco sin marcador.
// ─────────────────────────────────────────────────────────────────

const SUBVIEW_KEY = 'cc-cal-subview';
const VALID = new Set(['mes', 'temporada']);

const LOADING_HTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text"></p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

let _seasonLoaded = false;
let _mesLoaded = false;
let _current = null;

function resolveInitialSubview() {
  const p = new URLSearchParams(location.search);
  const fromUrl = p.get('vista');
  if (VALID.has(fromUrl)) return fromUrl;
  // URLs legacy de mes.html redirigidas con ?month=YYYY-MM
  if (/^\d{4}-\d{2}$/.test(p.get('month') || '')) return 'mes';
  const stored = localStorage.getItem(SUBVIEW_KEY);
  if (VALID.has(stored)) return stored;
  // Por defecto Mes (decisión Dani 2026-06-12): es la vista "qué se corre
  // estos días"; Temporada queda a un toggle para la panorámica del año.
  return 'mes';
}

function setHidden(view, hidden) {
  const ids = view === 'mes'
    ? ['mesBar', 'mesContent']
    : ['temporadaFilters', 'temporadaContent'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden;
  });
}

function resetCanonical() {
  // La subvista mes reescribe el canonical por mes; al volver a temporada
  // se restaura el canónico de la página.
  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) || window.location.origin;
  const canonEl = document.querySelector('link[rel="canonical"]');
  if (canonEl) canonEl.href = origin + location.pathname;
}

async function activate(view, { first = false } = {}) {
  if (_current === view) return;
  _current = view;
  try { localStorage.setItem(SUBVIEW_KEY, view); } catch (_) {}
  setHidden(view === 'mes' ? 'temporada' : 'mes', true);
  setHidden(view, false);

  if (!first) {
    const qs = new URLSearchParams(location.search);
    qs.set('vista', view);
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  }

  if (view === 'temporada') {
    if (!_seasonLoaded) {
      _seasonLoaded = true;
      const content = document.getElementById('temporadaContent');
      content.innerHTML = LOADING_HTML;
      removeStaticLoading();
      await import('./temporada.js'); // se auto-inicializa y renderiza
    } else {
      resetCanonical();
    }
  } else {
    if (!_mesLoaded) {
      _mesLoaded = true;
      const content = document.getElementById('mesContent');
      content.innerHTML = LOADING_HTML;
      removeStaticLoading();
      const mod = await import('./calendario-mes.js');
      await mod.initMesView();
    } else {
      const mod = await import('./calendario-mes.js');
      await mod.initMesView(); // re-render (estado conservado en el módulo)
    }
  }
}

function removeStaticLoading() {
  // El .static-prerender también es marcador del overlay de carga
  // (page-loading.js MARKER_SEL) y aquí es hijo permanente de #calMain:
  // hay que retirarlo o el overlay nunca cierra por observer. El .loading
  // de la subvista ya está inyectado, así que no queda hueco sin marcador.
  document.getElementById('calStaticLoading')?.remove();
  document.querySelector('#calMain .static-prerender')?.remove();
}

// Toggle (botón en cada barra de filtros, como el action del TopAppBar en apps)
document.querySelectorAll('[data-cal-switch]').forEach(btn => {
  btn.addEventListener('click', () => activate(btn.dataset.calSwitch));
});

activate(resolveInitialSubview(), { first: true });
