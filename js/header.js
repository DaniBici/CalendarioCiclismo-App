// ─────────────────────────────────────────────────────────────────
//  HEADER — cabecera común a todas las páginas (web)
//  Fuente ÚNICA del header del sitio. Se monta sobre el placeholder
//  <header class="site-header" id="siteHeader"> que cada página incluye
//  justo tras <body>. El placeholder ya reserva los 56px (CSS .site-header),
//  así que no hay salto de layout: este módulo solo rellena su interior.
//
//  Timing (clave): se carga como <script type="module"> → se ejecuta tras
//  el parse del documento pero ANTES de DOMContentLoaded. Por eso el cableado
//  de theme.js (theme toggle) y de
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

const PRIMARY_ICONS = {
  // Mismo vector que la pestaña Hoy de Android: Icons.Filled.CalendarToday.
  today: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 16H5V9h14v11ZM7 11h5v5H7Z"/></svg>',
  results: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  transfers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>',
  apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
};

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
    supportHref: 'https://ko-fi.com/calendariociclismo', supportText: 'Apoyar',
    appsText: 'Apps', appsLabel: 'Abrir opciones de apps',
    searchHref: '/buscar.html', searchTitle: 'Buscar',
    themeTitle: 'Cambiar tema',
    viewsAria: 'Vistas',
    skipText: 'Saltar al contenido',
    today:  { href: '/index.html',    text: 'Hoy' },
    results:{ href: '/resultados/',   text: 'Resultados' },
    transfers:{ href: '/fichajes/',   text: 'Fichajes' },
    calendar:{ href: '/calendario.html', text: 'Calendario' },
  },
  en: {
    home: '/en/',
    backLabel: 'Back to calendar',
    logoAria: 'Calendario Ciclismo — Home',
    aboutHref: '/en/about/', aboutText: 'About me',
    openHref: '/en/open/', openText: 'Open Data',
    supportHref: 'https://ko-fi.com/calendariociclismo', supportText: 'Support',
    appsText: 'Apps', appsLabel: 'Open app options',
    searchHref: '/en/search/', searchTitle: 'Search',
    themeTitle: 'Change theme',
    viewsAria: 'Views',
    skipText: 'Skip to content',
    today:  { href: '/en/',           text: 'Home' },
    results:{ href: '/en/results/',   text: 'Results' },
    transfers:{ href: '/en/transfers/', text: 'Transfers' },
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
  if (p.startsWith('/fichajes') || p.startsWith('/en/transfers')) return 'transfers';
  if (p === '/' || p === '/index.html' || p === '/en/' || p === '/en' || p === '/en/index.html') return 'today';
  return null;
}

// El <main> de cada página lleva su propio id (o ninguno), así que en vez de
// imponer id="main" en las ~30 plantillas apuntamos el enlace al que haya.
// tabindex="-1" es imprescindible: sin él el salto mueve el scroll pero no el
// foco, y el teclado seguiría en la cabecera.
function ensureSkipTarget() {
  const link = document.getElementById('skipLink');
  const main = document.querySelector('main');
  if (!link || !main) return;
  if (!main.id) main.id = 'main';
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  link.setAttribute('href', '#' + main.id);
}

function buildHeader(el) {
  const lang = el.dataset.lang || detectLang();
  const s = STRINGS[lang] || STRINGS.es;
  const hasBack = el.hasAttribute('data-back');
  const active = el.dataset.active || detectActive();
  const act = (k) => (active === k ? ' class="active" aria-current="page"' : '');

  const backBtn = hasBack
    ? `<a class="back-btn" id="backBtn" href="${s.home}" aria-label="${s.backLabel}">←</a>`
    : '';

  el.innerHTML =
    // Primer elemento enfocable del documento: evita repetir cabecera,
    // navegación y filtros en cada página (WCAG 2.4.1). El destino lo
    // resuelve ensureSkipTarget() sobre el <main> real, que en cada
    // página lleva su propio id (o ninguno).
    `<a class="skip-link" id="skipLink" href="#main">${s.skipText}</a>` +
    '<div class="site-header__inner">' +
      backBtn +
      `<a class="site-logo" href="${s.home}" aria-label="${s.logoAria}">${LOGO_SVG}<span class="site-logo__text">Calendario Ciclismo</span></a>` +
      // Cluster de utilidades, SIEMPRE visible: buscar (desktop) · apoyar · Apps ·
      // idioma (slider, lo inyecta lang-switch.js) · tema.
      '<div class="header-actions">' +
        (SEARCH_ENABLED
          ? `<a href="${s.searchHref}" class="nav-search-link" title="${s.searchTitle}">${SEARCH_SVG}</a>`
          : '') +
        `<a class="header-support-link" href="${s.supportHref}" target="_blank" rel="noopener"><span class="header-action-icon">${PRIMARY_ICONS.support}</span><span>${s.supportText}</span></a>` +
        '<span class="header-actions__divider" aria-hidden="true"></span>' +
        `<button class="nav-apps-btn" id="navAppsBtn" type="button" aria-label="${s.appsLabel}"><span class="header-action-icon">${PRIMARY_ICONS.apps}</span><span>${s.appsText}</span></button>` +
        `<button class="theme-toggle" title="${s.themeTitle}"></button>` +
      '</div>' +
    '</div>';

  const primaryItems = ['today', 'results', 'transfers', 'calendar'];
  const primaryNav = `<nav class="primary-nav" aria-label="${s.viewsAria}"><div class="primary-nav__inner">` +
    primaryItems.map(key => {
      const item = s[key];
      return `<a class="primary-nav__main" href="${item.href}"${act(key)}><span class="primary-nav__icon">${PRIMARY_ICONS[key]}</span><span>${item.text}</span></a>`;
    }).join('') +
    '<span class="primary-nav__divider" aria-hidden="true"></span>' +
    `<a class="primary-nav__secondary" href="${s.aboutHref}"><span class="primary-nav__icon">${PRIMARY_ICONS.about}</span><span>${s.aboutText}</span></a>` +
    `<a class="primary-nav__secondary" href="${s.openHref}"><span class="primary-nav__icon">${PRIMARY_ICONS.open}</span><span>${s.openText}</span></a>` +
    `</div><button class="primary-nav__prev" type="button" aria-label="${lang === 'en' ? 'Show previous sections' : 'Mostrar secciones anteriores'}" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><button class="primary-nav__more" type="button" aria-label="${lang === 'en' ? 'Show more sections' : 'Mostrar más secciones'}" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></nav>`;
  el.insertAdjacentHTML('afterend', primaryNav);

  const moreButton = document.querySelector('.primary-nav__more');
  const prevButton = document.querySelector('.primary-nav__prev');
  const primaryInner = document.querySelector('.primary-nav__inner');
  const syncMoreButton = () => {
    if (!moreButton || !prevButton || !primaryInner) return;
    prevButton.hidden = primaryInner.scrollLeft <= 1;
    moreButton.hidden = primaryInner.scrollLeft + primaryInner.clientWidth >= primaryInner.scrollWidth - 2;
  };
  moreButton?.addEventListener('click', () => {
    if (!primaryInner) return;
    primaryInner.scrollTo({ left: primaryInner.scrollWidth, behavior: 'smooth' });
  });
  prevButton?.addEventListener('click', () => {
    if (!primaryInner) return;
    primaryInner.scrollTo({ left: 0, behavior: 'smooth' });
  });
  primaryInner?.addEventListener('scroll', syncMoreButton, { passive: true });
  window.addEventListener('resize', syncMoreButton, { passive: true });
  requestAnimationFrame(syncMoreButton);

  ensureSkipTarget();

  // Botón "Apps": apps-modal.js (script clásico al pie) ya corrió y dejó
  // window.openAppsModal, pero no pudo enlazar el botón (aún no existía).
  const appsBtn = el.querySelector('#navAppsBtn');
  if (appsBtn && typeof window.openAppsModal === 'function') {
    appsBtn.addEventListener('click', window.openAppsModal);
  }
}

// API para que una página controle el botón "← Volver" del header EN RUNTIME,
// en su posición (a la izquierda del logo). El CSS .site-header__inner:has(.back-btn)
// reajusta el layout solo según esté o no el botón. Usos:
//   ccHeaderBack({ href })    → enlace (recarga/navega). P. ej. resultados → feed.
//   ccHeaderBack({ onClick }) → botón que ejecuta JS sin navegar (vuelve a una
//                               vista interna, como la ficha de equipo de Fichajes).
//   ccHeaderBack(null)        → oculta el botón.
// Pensada para páginas SPA que cambian de vista sin recargar; el header se
// construye una vez, así que este control es la vía para un "volver" dinámico.
window.ccHeaderBack = function ccHeaderBack(cfg) {
  const header = document.getElementById('siteHeader');
  const inner = header && header.querySelector('.site-header__inner');
  if (!inner) return;
  const lang = header.dataset.lang || detectLang();
  const s = STRINGS[lang] || STRINGS.es;
  const existing = inner.querySelector('#backBtn');
  if (existing) existing.remove();
  if (!cfg) return;
  const label = cfg.label || s.backLabel;
  let node;
  if (cfg.onClick) {
    node = document.createElement('button');
    node.type = 'button';
    node.addEventListener('click', cfg.onClick);
  } else {
    node = document.createElement('a');
    node.href = cfg.href || s.home;
  }
  node.className = 'back-btn';
  node.id = 'backBtn';
  node.setAttribute('aria-label', label);
  node.textContent = '←';
  inner.insertBefore(node, inner.firstChild);
};

const _el = document.getElementById('siteHeader');
if (_el) buildHeader(_el);
