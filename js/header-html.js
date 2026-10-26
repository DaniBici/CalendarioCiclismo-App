// ─────────────────────────────────────────────────────────────────
//  HEADER — marcado de la cabecera, sin DOM
//  Lo usa js/header.js (montaje en el navegador) y lo usará el paso de build
//  que escribe la cabecera en las páginas generadas, que así coinciden.
// ─────────────────────────────────────────────────────────────────
import { cyclocrossHome } from './services/today-season.js';

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.25em"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.35em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

// Flecha de volver con el mismo trazo que los iconos del menú.
export const BACK_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
// El hueco de la flecha existe siempre (invisible en Hoy): en tableta y
// escritorio la marca y el menú no cambian de posición al pasar de una sección
// a otra. En móvil el hueco no ocupa espacio (css/app.css) y la marca solo se
// desplaza cuando hay flecha.
export const BACK_PLACEHOLDER = '<span class="back-btn back-btn--placeholder" id="backBtn" aria-hidden="true"></span>';

export const PRIMARY_ICONS = {
  // Mismo vector que la pestaña Hoy de Android: Icons.Filled.CalendarToday.
  today: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 16H5V9h14v11ZM7 11h5v5H7Z"/></svg>',
  results: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  transfers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/></svg>',
  // Monograma CX exclusivo del submenú; misma geometría que ic_cyclocross.xml
  // (Android) y CyclocrossEmblem (iOS).
  cyclocross: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M 9.5 8 C 6.5 5.8 2 7.4 2 12 C 2 16.6 6.5 18.2 9.5 16"/><path d="M 13.5 7.5 L 21.5 16.5 M 21.5 7.5 L 13.5 16.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>',
  apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
};

export const STRINGS = {
  es: {
    home: '/',
    backLabel: 'Volver al calendario',
    logoAria: 'Calendario Ciclismo - Inicio',
    aboutHref: '/about/', aboutText: 'Acerca de mí',
    openHref: '/abierto/', openText: 'Datos abiertos',
    supportHref: 'https://ko-fi.com/calendariociclismo', supportText: 'Apoyar',
    appsText: 'Apps', appsLabel: 'Abrir opciones de apps',
    viewsAria: 'Vistas',
    skipText: 'Saltar al contenido',
    today:  { href: '/',              text: 'Hoy' },
    results:{ href: '/resultados/',   text: 'Resultados' },
    transfers:{ href: '/fichajes/',   text: 'Fichajes' },
    cyclocross:{ href: '/ciclocross/', text: 'Ciclocross' },
    calendar:{ href: '/calendario/', text: 'Calendario' },
  },
  en: {
    home: '/en/',
    backLabel: 'Back to calendar',
    logoAria: 'Calendario Ciclismo - Home',
    aboutHref: '/en/about/', aboutText: 'About me',
    openHref: '/en/open/', openText: 'Open Data',
    supportHref: 'https://ko-fi.com/calendariociclismo', supportText: 'Support',
    appsText: 'Apps', appsLabel: 'Open app options',
    viewsAria: 'Views',
    skipText: 'Skip to content',
    today:  { href: '/en/',           text: 'Home' },
    results:{ href: '/en/results/',   text: 'Results' },
    transfers:{ href: '/en/transfers/', text: 'Transfers' },
    cyclocross:{ href: '/en/cyclocross/', text: 'Cyclocross' },
    calendar:{ href: '/en/calendar/', text: 'Calendar' },
  },
};

// Tras el cierre de la temporada de carretera la home es Ciclocross
// (services/today-season.js): Hoy abre la agenda de Ciclocross, que alterna
// con Hoy de carretera, y sustituye a Ciclocross en el menú.
const _now = new Date();
export const CX_HOME = cyclocrossHome(`${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`);

// Cinco destinos fijos (cuatro con la home cedida a Ciclocross, en la que
// Hoy alberga Ciclocross y carretera): en escritorio comparten fila con la
// marca y las acciones; en móvil forman la barra inferior, sin
// desplazamiento. «Acerca de mí» y «Datos abiertos» viven en el pie.
export const PRIMARY_NAV_ITEMS = CX_HOME
  ? ['today', 'results', 'transfers', 'calendar']
  : ['today', 'results', 'transfers', 'cyclocross', 'calendar'];

// Selector ES/EN escrito con la cabecera (también en el HTML generado en el
// build): montarlo al cargar desplazaba la cabecera. js/lang-switch.js solo le
// añade el comportamiento; el idioma activo es el de la página.
function langSwitcherHtml(lang) {
  const button = (code, title) =>
    `<button class="lang-btn${lang === code ? ' lang-btn--active' : ''}" data-lang="${code}" title="${title}">${code.toUpperCase()}</button>`;
  return `<div id="langSwitcher" class="lang-switcher" data-active="${lang}"><span class="lang-knob" aria-hidden="true"></span>` +
    `${button('es', 'Español')}${button('en', 'English')}</div>`;
}

/** Interior de <header id="siteHeader">: enlace de salto, marca, vistas y acciones. */
export function headerHtml({ lang = 'es', hasBack = false, active = null } = {}) {
  const s = STRINGS[lang] || STRINGS.es;
  const backBtn = hasBack
    ? `<a class="back-btn" id="backBtn" href="${s.home}" aria-label="${s.backLabel}">${BACK_ICON}</a>`
    : BACK_PLACEHOLDER;
  const primaryNav = `<nav class="primary-nav" aria-label="${s.viewsAria}"><div class="primary-nav__inner">` +
    PRIMARY_NAV_ITEMS.map(key => {
      const item = s[key];
      return `<a class="primary-nav__main${active === key ? ' active' : ''}" href="${item.href}"${active === key ? ' aria-current="page"' : ''}><span class="primary-nav__icon">${PRIMARY_ICONS[key]}</span><span>${item.text}</span></a>`;
    }).join('') +
    '</div></nav>';
  // Primer elemento enfocable del documento: evita repetir cabecera,
  // navegación y filtros en cada página (WCAG 2.4.1).
  return `<a class="skip-link" id="skipLink" href="#main">${s.skipText}</a>` +
    '<div class="site-header__inner">' +
      backBtn +
      `<a class="site-logo" href="${s.home}" aria-label="${s.logoAria}">${LOGO_SVG}<span class="site-logo__text">Calendario Ciclismo</span></a>` +
      primaryNav +
      // Cluster de utilidades, SIEMPRE visible: Apps · apoyar · idioma.
      '<div class="header-actions">' +
        `<button class="nav-apps-btn" id="navAppsBtn" type="button" aria-label="${s.appsLabel}"><span class="header-action-icon">${PRIMARY_ICONS.apps}</span><span>${s.appsText}</span></button>` +
        '<span class="header-actions__divider" aria-hidden="true"></span>' +
        `<a class="header-support-link" href="${s.supportHref}" aria-label="${s.supportText}" target="_blank" rel="noopener"><span class="header-action-icon">${PRIMARY_ICONS.support}</span><span>${s.supportText}</span></a>` +
        langSwitcherHtml(lang === 'en' ? 'en' : 'es') +
      '</div>' +
    '</div>';
}
