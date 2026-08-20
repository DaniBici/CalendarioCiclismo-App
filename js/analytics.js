// ─────────────────────────────────────────────────────────────────
//  Google Analytics (gtag.js)
//  Carga el script de GA4 usando el ID configurado en config.js.
//  Se incluye en todas las páginas públicas justo después de config.js.
//  Respeta la elección de cookies del usuario (cookie-consent.js).
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

  function loadGA() {
    // Evitar doble carga
    if (window.__gaLoaded) return;
    window.__gaLoaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    // send_page_view: false — cada página/SPA dispara su propio page_view manualmente
    // para que la ruta registrada sea la específica (ej: /jornada/slug/) y no el .html genérico.
    gtag('config', id, { send_page_view: false });

    // Fallback para páginas estáticas (buscar, etc.) que no gestionan el page_view por su cuenta.
    // Las SPAs establecen window.__spaDrivenAnalytics = true en su init() y cancelan este fallback.
    window.addEventListener('load', function () {
      if (!window.__spaDrivenAnalytics) {
        gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
      }
    });
  }

  // Si el consentimiento ya fue dado (localStorage), cargar directamente
  if (window.__cookieConsent === 'accepted') {
    loadGA();
    return;
  }

  // Si fue rechazado, no cargar
  if (window.__cookieConsent === 'rejected') return;

  // Si está pendiente (banner visible), exponer función para que el banner la llame
  window.__loadAnalytics = loadGA;
})();
