// ─────────────────────────────────────────────────────────────────
//  HEADER — cabecera común a todas las páginas (web)
//  Fuente ÚNICA del header del sitio. Se monta sobre el placeholder
//  <header class="site-header" id="siteHeader"> que cada página incluye
//  justo tras <body>. El placeholder ya reserva los 56px (CSS .site-header),
//  así que no hay salto de layout: este módulo solo rellena su interior.
//
//  Timing (clave): se carga como <script type="module"> → se ejecuta tras
//  el parse del documento pero ANTES de DOMContentLoaded. Por eso el cableado
//  de theme.js (theme toggle, hamburguesa, dropdown, labels mes/año) y de
//  lang-switch.js, que se enganchan en DOMContentLoaded, encuentran el header
//  ya inyectado. El único cableado inmediato del repo es el botón "Apps"
//  (apps-modal.js corre como script clásico al pie y enlaza #navAppsBtn al
//  vuelo, cuando el header aún no existe), así que de ese botón se encarga
//  este módulo: lo enlaza a window.openAppsModal (ya definido para entonces).
//
//  Parámetros (atributos del placeholder):
//    data-back   → presente: muestra el botón "← Volver" (href = home).
//  El idioma (ES/EN) y la sección activa se deducen de location.pathname.
// ─────────────────────────────────────────────────────────────────

// Overlay de carga a pantalla completa: importarlo aquí lo activa en TODAS
// las páginas (también las generadas). Se auto-inicializa al cargarse.
import './page-loading.js';

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.25em"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.35em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

const SEARCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';

// Buscador ARCHIVADO (2026-07-17): el código de /buscar.html + js/buscar.js se
// conserva y la página sigue respondiendo por URL directa, pero no se ofrece
// desde ninguna superficie. Ponerlo a true revive lupa + entrada del menú.
const SEARCH_ENABLED = false;

const STRINGS = {
  es: {
    home: '/index.html',
    backLabel: 'Volver al calendario',
    logoAria: 'Calendario Ciclismo — Inicio',
    aboutHref: '/about.html', aboutText: 'Acerca de mí',
    openHref: '/abierto.html', openText: 'Datos abiertos',
    searchHref: '/buscar.html', searchTitle: 'Buscar',
    themeTitle: 'Cambiar tema',
    menuAria: 'Menú',
    viewsAria: 'Vistas',
    today:  { href: '/index.html',    text: 'Inicio' },
    results:{ href: '/resultados/',   text: 'Resultados' },
    calendar:{ href: '/calendario.html', text: 'Calendario' },
  },
  en: {
    home: '/en/',
    backLabel: 'Back to calendar',
    logoAria: 'Calendario Ciclismo — Home',
    aboutHref: '/en/about/', aboutText: 'About me',
    openHref: '/en/open/', openText: 'Open Data',
    searchHref: '/en/search/', searchTitle: 'Search',
    themeTitle: 'Change theme',
    menuAria: 'Menu',
    viewsAria: 'Views',
    today:  { href: '/en/',           text: 'Home' },
    results:{ href: '/en/results/',   text: 'Results' },
    calendar:{ href: '/en/calendar/', text: 'Calendar' },
  },
};

function detectLang() {
  const p = window.location.pathname;
  return (p.startsWith('/en/') || p === '/en') ? 'en' : 'es';
}

function detectActive() {
  const p = window.location.pathname;
  // Mes y Temporada se fusionaron en Calendario (2026-06-12); las rutas
  // antiguas siguen mapeando aquí mientras viven como shells de redirección.
  if (p.includes('/calendario') || p.includes('/en/calendar') ||
      p.includes('/mes') || p.includes('/en/month') ||
      p.includes('/temporada') || p.includes('/en/season')) return 'calendar';
  // El feed y las páginas de carrera de resultados comparten sección.
  if (p.startsWith('/resultados') || p.startsWith('/en/results')) return 'results';
  if (p === '/' || p === '/index.html' || p === '/en/' || p === '/en' || p === '/en/index.html') return 'today';
  return null;
}

function buildHeader(el) {
  const lang = el.dataset.lang || detectLang();
  const s = STRINGS[lang] || STRINGS.es;
  const hasBack = el.hasAttribute('data-back');
  const active = el.dataset.active || detectActive();
  const act = (k) => (active === k ? ' class="active"' : '');

  const backBtn = hasBack
    ? `<a class="back-btn" id="backBtn" href="${s.home}" aria-label="${s.backLabel}">←</a>`
    : '';

  el.innerHTML =
    '<div class="site-header__inner">' +
      backBtn +
      `<a class="site-logo" href="${s.home}" aria-label="${s.logoAria}">${LOGO_SVG}<span class="site-logo__text">Calendario Ciclismo</span></a>` +
      // Cluster de utilidades, SIEMPRE visible (clave en móvil): buscar (desktop) ·
      // Apps · idioma (slider, lo inyecta lang-switch.js) · tema · menú.
      '<div class="header-actions">' +
        (SEARCH_ENABLED
          ? `<a href="${s.searchHref}" class="nav-search-link" title="${s.searchTitle}">${SEARCH_SVG}</a>`
          : '') +
        '<button class="nav-apps-btn" id="navAppsBtn">Apps</button>' +
        `<button class="theme-toggle" title="${s.themeTitle}"></button>` +
        `<button class="nav-burger" id="navBurger" aria-label="${s.menuAria}" aria-expanded="false"><span></span><span></span><span></span></button>` +
      '</div>' +
      // Menú (dropdown en desktop / drawer en móvil): vistas de uso bajo + secciones.
      // Calendario (fusión Mes+Temporada, como en las apps 3.1) vive aquí,
      // no compite en la barra. El día es la home (logo).
      `<nav class="site-nav" id="siteNav" aria-label="${s.menuAria}">` +
        `<a href="${s.today.href}"${act('today')}>${s.today.text}</a>` +
        `<a href="${s.results.href}"${act('results')}>${s.results.text}</a>` +
        `<a href="${s.calendar.href}"${act('calendar')}>${s.calendar.text}</a>` +
        (SEARCH_ENABLED
          ? `<a href="${s.searchHref}" class="nav-menu-search">${s.searchTitle}</a>`
          : '') +
        `<a href="${s.aboutHref}">${s.aboutText}</a>` +
        `<a href="${s.openHref}">${s.openText}</a>` +
      '</nav>' +
    '</div>';

  // Botón "Apps": apps-modal.js (script clásico al pie) ya corrió y dejó
  // window.openAppsModal, pero no pudo enlazar el botón (aún no existía).
  const appsBtn = el.querySelector('#navAppsBtn');
  if (appsBtn && typeof window.openAppsModal === 'function') {
    appsBtn.addEventListener('click', window.openAppsModal);
  }
}

const _el = document.getElementById('siteHeader');
if (_el) buildHeader(_el);
