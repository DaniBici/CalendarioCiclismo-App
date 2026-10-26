// ─────────────────────────────────────────────────────────────────
//  HEADER — cabecera común a todas las páginas (web)
//  Fuente ÚNICA del header del sitio. Se monta sobre el placeholder
//  <header class="site-header" id="siteHeader"> que cada página incluye
//  justo tras <body>. El placeholder ya reserva los 56px (CSS .site-header),
//  así que no hay salto de layout: este módulo solo rellena su interior.
//
//  Timing (clave): se carga como <script type="module"> → se ejecuta tras
//  el parse del documento pero ANTES de DOMContentLoaded. Por eso el cableado
//  de lang-switch.js, que se engancha en DOMContentLoaded, encuentra el header
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
import { STRINGS, BACK_ICON, BACK_PLACEHOLDER, PRIMARY_ICONS, CX_HOME, headerHtml } from './header-html.js';

function detectLang() {
  const p = window.location.pathname;
  return (p.startsWith('/en/') || p === '/en') ? 'en' : 'es';
}

function detectActive() {
  const p = window.location.pathname;
  if (p.startsWith('/ciclocross') || p.startsWith('/en/cyclocross')) return CX_HOME ? 'today' : 'cyclocross';
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

// Destinos secundarios en el pie: tras el copyright, en la misma fila que
// Calendario iCal y Gestión de cookies (js/cookie-consent.js la completa).
function buildFooterNav(s) {
  const footer = document.querySelector('.site-footer');
  if (!footer || footer.querySelector('.footer-link--about')) return;
  let actions = footer.querySelector('.site-footer__actions');
  if (!actions) {
    actions = document.createElement('p');
    actions.className = 'site-footer__actions';
    footer.appendChild(actions);
  }
  actions.insertAdjacentHTML('afterbegin',
    `<a class="footer-link footer-link--icon footer-link--about" href="${s.aboutHref}">${PRIMARY_ICONS.about}<span>${s.aboutText}</span></a>` +
    `<a class="footer-link footer-link--icon" href="${s.openHref}">${PRIMARY_ICONS.open}<span>${s.openText}</span></a>`);
}

function buildHeader(el) {
  const lang = el.dataset.lang || detectLang();
  const s = STRINGS[lang] || STRINGS.es;
  const hasBack = el.hasAttribute('data-back');
  const active = el.dataset.active || detectActive();

  // Página generada en el build con la cabecera ya escrita: se conserva.
  if (!el.querySelector('.site-header__inner')) el.innerHTML = headerHtml({ lang, hasBack, active });
  // Las barras fijas de cada página se colocan bajo la cabecera solo cuando
  // esta es fija (escritorio y tableta); en móvil se desplaza con la página.
  const measureHeader = new ResizeObserver(() => {
    const sticky = getComputedStyle(el).position === 'sticky';
    document.documentElement.style.setProperty('--site-header-h', `${sticky ? el.getBoundingClientRect().height : 0}px`);
  });
  measureHeader.observe(el);
  buildFooterNav(s);

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
  if (!cfg) { inner.insertAdjacentHTML('afterbegin', BACK_PLACEHOLDER); return; }
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
  node.innerHTML = BACK_ICON;
  inner.insertBefore(node, inner.firstChild);
};

const _el = document.getElementById('siteHeader');
if (_el) buildHeader(_el);
