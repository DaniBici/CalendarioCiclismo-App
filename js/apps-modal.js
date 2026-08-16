// ── Modal Apps — iOS y Android ────────────────────────────────────
(function () {
  var IOS_URL     = 'https://apps.apple.com/app/id6761902611';
  var ANDROID_URL = 'https://play.google.com/store/apps/details?id=app.calendariociclismo.android';
  var isEN        = window.location.pathname.startsWith('/en/') ||
                    (typeof window.EN_DOMAIN !== 'undefined' && window.EN_DOMAIN && window.location.hostname === window.EN_DOMAIN);

  var CALENDAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.25em"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  var BIKE_SVG    = '<svg xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.4em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

  var APPLE_SVG   = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor" width="26" height="26" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
  var ANDROID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" fill="currentColor" width="26" height="26" aria-hidden="true"><path d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55"/></svg>';

  var _overlay = null;

  function _getOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.className = 'rd-modal-overlay';
    _overlay.id = 'apps-modal-overlay';
    _overlay.innerHTML =
      '<div class="rd-modal" role="dialog" aria-modal="true" aria-label="' + (isEN ? 'Apps' : 'Aplicaciones') + '">' +
        '<div class="rd-modal__bar">' +
          '<div class="apps-modal__header-logo">' +
            CALENDAR_SVG + BIKE_SVG +
            '<span class="apps-modal__header-name">Calendario Ciclismo</span>' +
          '</div>' +
          '<button class="rd-modal__close" id="appsModalClose" aria-label="' + (isEN ? 'Close' : 'Cerrar') + '">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="rd-modal__body">' +
          '<div class="apps-modal__tagline">' + (isEN ? 'Enjoy the most integrated experience and exclusive features with our free apps:' : 'Disfruta la experiencia más integrada y funciones exclusivas con nuestras apps gratuitas:') + '</div>' +
          '<div class="apps-modal__platforms">' +
            '<div class="apps-modal__card apps-modal__card--ios">' +
              '<div class="apps-modal__platform-icon">' + APPLE_SVG + '</div>' +
              '<div class="apps-modal__platform-info">' +
                '<span class="apps-modal__platform-name">iOS</span>' +
                '<span class="apps-modal__platform-sub">App Store</span>' +
              '</div>' +
              '<a href="' + IOS_URL + '" target="_blank" rel="noopener" class="apps-modal__dl-badge">' + (isEN ? 'Download' : 'Descargar') + '</a>' +
            '</div>' +
            '<div class="apps-modal__card apps-modal__card--android">' +
              '<div class="apps-modal__platform-icon">' + ANDROID_SVG + '</div>' +
              '<div class="apps-modal__platform-info">' +
                '<span class="apps-modal__platform-name">Android</span>' +
                '<span class="apps-modal__platform-sub">Google Play</span>' +
              '</div>' +
              '<a href="' + ANDROID_URL + '" target="_blank" rel="noopener" class="apps-modal__dl-badge">' + (isEN ? 'Download' : 'Descargar') + '</a>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="apps-modal__continue" id="appsModalContinue" hidden>' +
            (isEN ? 'Continue on the web' : 'Seguir navegando en la web') +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_overlay);
    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) _close();
    });
    document.getElementById('appsModalClose').addEventListener('click', _close);
    document.getElementById('appsModalContinue').addEventListener('click', _close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _overlay && _overlay.classList.contains('rd-modal--open')) _close();
    });
    return _overlay;
  }

  var POPUP_KEY  = 'cc_apps_popup_dismissed';
  var _autoMode  = false;

  // Devuelve el foco al elemento que abrió el diálogo y suelta la trampa.
  var _releaseFocus = null;

  function _close() {
    if (!_overlay) return;
    _overlay.classList.remove('rd-modal--open');
    document.body.style.overflow = '';
    if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
    // Si el modal se abrió automáticamente (4ª página), cualquier cierre
    // —botón ✕, clic fuera, Escape o "Seguir en la web"— lo silencia para
    // siempre (hasta que el usuario borre cookies/caché).
    if (_autoMode) {
      _autoMode = false;
      try { localStorage.setItem(POPUP_KEY, '1'); } catch (e) {}
    }
  }

  // opts.auto = true → variante automática con pie "Seguir navegando en la web".
  function openAppsModal(opts) {
    _autoMode = !!(opts && opts.auto);
    var ov = _getOverlay();
    var cont = document.getElementById('appsModalContinue');
    if (cont) cont.hidden = !_autoMode;
    ov.classList.add('rd-modal--open');
    document.body.style.overflow = 'hidden';
    // Sin esto el foco se queda detrás del diálogo: con teclado el modal
    // automático de la 4ª página aparece sin que se note (WCAG 2.4.3).
    var dialog = ov.querySelector('.rd-modal') || ov;
    if (typeof window.ccTrapFocus === 'function') {
      _releaseFocus = window.ccTrapFocus(dialog);
    }
    // Abierto sin que el usuario lo pidiera: se anuncia, además de recibir
    // el foco, para que no aparezca en silencio (WCAG 3.2.5).
    if (_autoMode && typeof window.ccAnnounce === 'function') {
      window.ccAnnounce(isEN ? 'Apps dialog opened' : 'Se ha abierto el diálogo de apps');
    }
  }

  var btn = document.getElementById('navAppsBtn');
  if (btn) btn.addEventListener('click', function () { openAppsModal(); });

  window.openAppsModal = openAppsModal;

  // ── Android Smart Banner ──────────────────────────────────────
  var BANNER_KEY = 'cc_android_banner_dismissed';
  var isAndroid  = /Android/i.test(navigator.userAgent);
  var _bannerShown = false;

  if (isAndroid && !localStorage.getItem(BANNER_KEY)) {
    _bannerShown = true;
    var label  = 'Calendario Ciclismo';
    var subtext = isEN ? 'Free · Google Play' : 'Gratis · Google Play';
    var btnTxt  = isEN ? 'Get' : 'Obtener';

    var banner = document.createElement('div');
    banner.className = 'android-app-banner';
    banner.id = 'androidAppBanner';
    banner.innerHTML =
      '<button class="android-app-banner__close" id="androidBannerClose" aria-label="' + (isEN ? 'Close' : 'Cerrar') + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
        '</svg>' +
      '</button>' +
      '<div class="android-app-banner__icon">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" fill="currentColor" width="36" height="36" aria-hidden="true"><path d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55"/></svg>' +
      '</div>' +
      '<div class="android-app-banner__info">' +
        '<div class="android-app-banner__name">' + label + '</div>' +
        '<div class="android-app-banner__sub">' + subtext + '</div>' +
      '</div>' +
      '<a href="' + ANDROID_URL + '" target="_blank" rel="noopener" class="android-app-banner__btn">' + btnTxt + '</a>';

    var header = document.querySelector('.site-header');
    if (header) {
      header.parentNode.insertBefore(banner, header);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
    // Retirar el hueco reservado pre-paint (body::before) EN EL MISMO frame en
    // que se inserta el banner real: el banner ocupa ese mismo alto → 0 CLS.
    document.documentElement.classList.remove('cc-android-banner-pending');

    document.getElementById('androidBannerClose').addEventListener('click', function () {
      banner.remove();
      localStorage.setItem(BANNER_KEY, '1');
    });
  }

  // ── Popup automático a la 4ª página vista (solo móvil) ────────────
  // Cuenta cargas de página reales en localStorage. El primer acceso cuenta
  // como página 1; en la 4ª carga se ofrece el modal de apps con un pie para
  // seguir en la web. Pulsar ese pie (o cerrar el modal) lo silencia para
  // siempre, hasta que el usuario borre cookies/caché.
  var PAGEVIEWS_KEY = 'cc_pageviews_count';
  var POPUP_THRESHOLD = 4;
  var _isMobile = window.innerWidth <= 768;

  try {
    var n = parseInt(localStorage.getItem(PAGEVIEWS_KEY) || '0', 10);
    if (!(n >= 0)) n = 0;   // saneo de valores corruptos
    n += 1;
    localStorage.setItem(PAGEVIEWS_KEY, String(n));

    if (_isMobile &&
        !_bannerShown &&                                // no apilar con el smart banner
        !localStorage.getItem(POPUP_KEY) &&             // no silenciado
        n >= POPUP_THRESHOLD) {
      openAppsModal({ auto: true });
    }
  } catch (e) {}
})();
