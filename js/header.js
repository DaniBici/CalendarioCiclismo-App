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
import { STRINGS, PRIMARY_ICONS, CX_HOME, headerHtml, PRIMARY_NAV_ITEMS, footerBrandHtml } from './header-html.js';
import { headerBack } from './header-back.js';

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

// Pie del rediseño, montado sobre el de cada página (que conserva su línea de
// copyright): marca, secciones y «Más» (Acerca de mí, Datos abiertos, Calendario
// iCal, Apoyar, Apps y Privacidad en todas las páginas, y Gestión de cookies, que
// js/cookie-consent.js añade a esa misma lista antes o después) y, abajo,
// autoría y firma del rediseño.
function buildFooterNav(s) {
  const footer = document.querySelector('.site-footer');
  if (!footer || footer.querySelector('.site-footer__top')) return;
  let actions = footer.querySelector('.site-footer__actions');
  if (!actions) {
    actions = document.createElement('p');
    actions.className = 'site-footer__actions';
  }
  actions.insertAdjacentHTML('afterbegin',
    `<a class="footer-link footer-link--icon footer-link--about" href="${s.aboutHref}">${PRIMARY_ICONS.about}<span>${s.aboutText}</span></a>` +
    `<a class="footer-link footer-link--icon" href="${s.openHref}">${PRIMARY_ICONS.open}<span>${s.openText}</span></a>` +
    `<a class="footer-link footer-link--icon" href="${s.icalHref}">${PRIMARY_ICONS.calendar}<span>${s.icalText}</span></a>` +
    `<a class="footer-link footer-link--icon" href="${s.supportHref}" target="_blank" rel="noopener">${PRIMARY_ICONS.support}<span>${s.supportText}</span></a>` +
    `<button class="footer-link footer-link--icon footer-link--apps" type="button">${PRIMARY_ICONS.apps}<span>${s.appsText}</span></button>` +
    `<a class="footer-link footer-link--icon" href="${s.privacyHref}">${PRIMARY_ICONS.privacy}<span>${s.privacyText}</span></a>`);
  // apps-modal.js (script clásico) deja window.openAppsModal; se consulta al pulsar.
  actions.querySelector('.footer-link--apps').addEventListener('click', () => {
    if (typeof window.openAppsModal === 'function') window.openAppsModal();
  });
  const copyright = footer.querySelector(':scope > p:not(.site-footer__actions)');
  const sections = PRIMARY_NAV_ITEMS.map(key =>
    `<li><a class="footer-link" href="${s[key].href}">${s[key].text}</a></li>`).join('');

  const top = document.createElement('div');
  top.className = 'site-footer__top';
  top.innerHTML = footerBrandHtml(s) +
    `<nav class="site-footer__col" aria-label="${s.footerSections}"><p class="site-footer__heading" aria-hidden="true">${s.footerSections}</p><ul class="site-footer__list">${sections}</ul></nav>` +
    `<div class="site-footer__col"><p class="site-footer__heading">${s.footerMore}</p></div>`;
  top.lastElementChild.append(actions);

  const bottom = document.createElement('div');
  bottom.className = 'site-footer__bottom';
  if (copyright) {
    copyright.classList.add('site-footer__legal');
    // El dueño en Bebas Neue (la tipografía de su web) y, tras él, la firma del
    // rediseño en Style Script. Privacidad pasa a la columna «Más».
    const owner = copyright.querySelector('a[href*="danisanchez"]');
    if (owner) {
      owner.classList.add('site-footer__owner');
      owner.insertAdjacentHTML('afterend',
        ` · ${s.designText} <a class="site-footer__signature" href="https://x.com/ZipiZapismo" target="_blank" rel="noopener">Alejandro Monteagudo Niella</a>`);
    }
    const privacy = copyright.querySelector('a[href*="privacidad"], a[href*="privacy"]');
    if (privacy) {
      const sep = privacy.previousSibling;
      if (sep && sep.nodeType === 3) sep.textContent = sep.textContent.replace(/\s*-\s*$/, '');
      privacy.remove();
    }
    bottom.append(copyright);
  }
  footer.replaceChildren(top, bottom);

  // Alto del pie para colocarlo siempre bajo el pliegue (css/app.css).
  const measure = () => document.documentElement.style.setProperty('--site-footer-h', `${footer.offsetHeight}px`);
  new ResizeObserver(measure).observe(footer);
  measure();
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
window.ccHeaderBack = cfg => headerBack(cfg, detectLang());

const _el = document.getElementById('siteHeader');
if (_el) buildHeader(_el);
