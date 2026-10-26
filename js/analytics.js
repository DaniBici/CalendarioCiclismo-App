// ─────────────────────────────────────────────────────────────────
//  Google Analytics (gtag.js)
//  Carga GA4 con el ID de config.js solo con la analítica aceptada en
//  js/cookie-consent.js (window.ccConsent y evento 'cc-consent'). Sin
//  elección o con rechazo no se pide nada a Google y se borran las cookies
//  _ga que queden. Consent Mode: almacenamiento de analítica concedido y todo
//  uso publicitario denegado, sin Google Signals.
//  Se incluye en todas las páginas públicas justo después de cookie-consent.js.
// ─────────────────────────────────────────────────────────────────

// Normaliza la URL para GA: /index.html → / (consolida las dos entradas en una sola)
window.gaLocation = function () {
  return window.location.href.replace(/\/index\.html(?=\?|#|$)/, '/');
};

(function () {
  var id = typeof CONFIG !== 'undefined' && CONFIG.gaId;
  if (!id || id === 'G-XXXXXXXXXX') return; // no cargar sin ID real

  // No trackear visitas del admin: si hay sesión Supabase activa, salir
  if (localStorage.getItem('sb-bcecwlkynpgovnzhbpah-auth-token')) return;

  var consent = window.ccConsent;
  if (!consent) return; // sin aviso de cookies no hay consentimiento posible

  var DISABLE = 'ga-disable-' + id;
  var started = false, loader = null;
  window[DISABLE] = true;

  // Solo cookies de Analytics, en el host y en cada dominio padre (GA las
  // escribe por defecto en el dominio registrable, .calendariociclismo.app).
  function eraseCookies() {
    try {
      var names = document.cookie.split(';')
        .map(function (c) { return c.trim().split('=')[0]; })
        .filter(function (n) { return /^(_ga(_|$)|_gid$|_gat(_|$))/.test(n); });
      if (!names.length) return;
      var labels = window.location.hostname.split('.');
      var domains = [''];
      for (var i = 0; i < labels.length - 1; i++) {
        var d = labels.slice(i).join('.');
        domains.push(d, '.' + d);
      }
      names.forEach(function (name) {
        domains.forEach(function (domain) {
          document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '');
        });
      });
    } catch (e) { /* cookies bloqueadas: ga-disable sigue activo */ }
  }

  function pageView() {
    window.gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
  }

  // late: la aceptación llega con la página ya cargada. Los page_view que la
  // página intentó antes se perdieron (sin window.gtag), así que se envía uno.
  function start(late) {
    if (started) return;
    started = true;
    window[DISABLE] = false;

    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    gtag('set', { allow_google_signals: false, allow_ad_personalization_signals: false });
    gtag('js', new Date());
    // send_page_view: false — cada página/SPA dispara su propio page_view manualmente
    // para que la ruta registrada sea la específica (ej: /jornada/slug/) y no el .html genérico.
    // Las cookies no sobreviven a la elección: cada carga fija su caducidad en
    // la de la aceptación (180 días desde que se dio).
    gtag('config', id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: Math.max(1, Math.floor((consent.expiresAt() - Date.now()) / 1000)),
      cookie_flags: 'SameSite=Lax;Secure'
    });

    loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(loader);

    if (late) {
      pageView();
      return;
    }
    // Fallback para páginas estáticas (buscar, etc.) que no gestionan el page_view por su cuenta.
    // Las SPAs establecen window.__spaDrivenAnalytics = true en su init() y cancelan este fallback.
    window.addEventListener('load', function () {
      if (!window.__spaDrivenAnalytics) pageView();
    });
  }

  // Retirada: corta los envíos, vacía la cola, borra las cookies y recarga
  // para descargar gtag.js y sus listeners. Si el rechazo no pudo guardarse,
  // no se recarga (la página nueva volvería a leer la aceptación anterior).
  function stop() {
    window[DISABLE] = true;
    if (Array.isArray(window.dataLayer)) window.dataLayer.length = 0;
    if (loader) loader.remove();
    eraseCookies();
    if (consent.saved()) window.location.reload();
  }

  window.addEventListener('cc-consent', function (e) {
    if (e.detail === 'accepted') start(true);
    else if (started) stop();
    else eraseCookies();
  });

  if (consent.get() === 'accepted') start(false);
  else eraseCookies();
})();
