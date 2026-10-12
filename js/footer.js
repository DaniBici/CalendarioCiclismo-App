// ─────────────────────────────────────────────────────────────────
//  FOOTER — pie común a todas las páginas (web)
//  Fuente ÚNICA del pie del sitio. header.js lo monta sobre el
//  <footer class="site-footer"> que cada página (y el generador de páginas
//  de jornada) ya incluye: su contenido estático queda como respaldo sin JS
//  y este módulo lo sustituye. Así el pie es idéntico en todas las páginas
//  sin editar cada plantilla.
//
//  Estructura: columna propia con el logo a la izquierda, tres columnas de
//  destinos (Secciones, Apps, Proyecto) y una barra inferior con la autoría a
//  la izquierda y el legal a la derecha. En móvil la columna Secciones se
//  oculta: la barra inferior fija ya ofrece los mismos destinos.
//
//  El botón «Gestión de cookies» lo completa js/cookie-consent.js en
//  [data-footer-cookies] (el modal vive allí).
// ─────────────────────────────────────────────────────────────────

import { seasonCalendarYear } from './services/today-season.js';

// Temporada del mercado de fichajes: la misma que SEASON en js/fichajes.js.
const MARKET_SEASON = 2027;

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.calendariociclismo.android';

// Mismos vectores que el modal de apps (js/apps-modal.js).
const APPLE_ICON = '<svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
const ANDROID_ICON = '<svg viewBox="0 0 576 512" fill="currentColor" aria-hidden="true"><path d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55"/></svg>';

const COPY = {
  es: {
    tagline: 'Ciclismo profesional de carretera y ciclocross masculino y femenino: calendario, horarios, recorridos, TV y streaming, inscritos, resultados y fichajes. Gratis y sin publicidad.',
    sections: 'Secciones',
    apps: 'Apps',
    project: 'Proyecto',
    labels: (year) => ({
      results: 'Últimos resultados',
      transfers: `Mercado fichajes ${MARKET_SEASON}`,
      calendar: `Calendario ${year}`,
    }),
    appStoreUrl: 'https://apps.apple.com/es/app/calendario-ciclismo/id6761902611',
    appStoreAria: 'Descargar en App Store (iPhone y iPad)',
    playAria: 'Descargar en Google Play (Android)',
    appsInfoHref: '/apps/', appsInfoText: 'Sobre las apps',
    icalHref: '/suscripcion/', icalText: 'Calendario iCal',
    credit: 'Ideado y editado por',
    privacyHref: '/privacidad.html', privacyText: 'Privacidad',
  },
  en: {
    tagline: 'Professional road and cyclocross cycling, men and women: calendar, schedules, routes, TV and streaming, start lists, results and transfers. Free and ad-free.',
    sections: 'Sections',
    apps: 'Apps',
    project: 'Project',
    labels: (year) => ({
      results: 'Latest results',
      transfers: `Transfer market ${MARKET_SEASON}`,
      calendar: `Calendar ${year}`,
    }),
    appStoreUrl: 'https://apps.apple.com/app/id6761902611',
    appStoreAria: 'Download on the App Store (iPhone and iPad)',
    playAria: 'Get it on Google Play (Android)',
    appsInfoHref: '/en/apps/', appsInfoText: 'About the apps',
    icalHref: '/en/subscription/', icalText: 'iCal calendar',
    credit: 'Created and edited by',
    privacyHref: '/en/privacy/', privacyText: 'Privacy',
  },
};

function list(items) {
  return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
}

// lang        'es' | 'en'
// s           cadenas de la cabecera (destinos principales, Acerca de, Datos
//             abiertos y Apoyar), para no duplicarlas aquí.
// sectionKeys claves de s en el orden de la barra principal.
// logoSvg     iconos de la marca, los mismos de la cabecera.
export function buildFooter(lang, s, sectionKeys, logoSvg) {
  const footer = document.querySelector('footer.site-footer');
  if (!footer || footer.dataset.footerReady) return;
  const c = COPY[lang] || COPY.es;

  // Mismo año por defecto que la pestaña Calendario (cambia al cerrar la
  // temporada de carretera, igual que el orden de sectionKeys en header.js).
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const labels = c.labels(seasonCalendarYear(todayKey));
  const sections = list(sectionKeys.map(key =>
    `<a href="${s[key].href}">${labels[key] || s[key].text}</a>`));

  const apps = list([
    `<a href="${c.appStoreUrl}" target="_blank" rel="noopener" aria-label="${c.appStoreAria}">${APPLE_ICON}<span>App Store</span></a>`,
    `<a href="${PLAY_STORE_URL}" target="_blank" rel="noopener" aria-label="${c.playAria}">${ANDROID_ICON}<span>Google Play</span></a>`,
    `<a href="${c.appsInfoHref}">${c.appsInfoText}</a>`,
  ]);

  const project = list([
    `<a href="${s.aboutHref}">${s.aboutText}</a>`,
    `<a href="${s.openHref}">${s.openText}</a>`,
    `<a href="${c.icalHref}">${c.icalText}</a>`,
    `<a href="${s.supportHref}" target="_blank" rel="noopener">${s.supportText}</a>`,
  ]);

  footer.dataset.footerReady = '1';
  footer.innerHTML =
    '<div class="site-footer__grid">' +
      '<div class="site-footer__brand">' +
        `<a class="site-footer__logo" href="${s.home}" aria-label="${s.logoAria}">${logoSvg}<span class="site-footer__logo-text">Calendario Ciclismo</span></a>` +
        `<p class="site-footer__tagline">${c.tagline}</p>` +
      '</div>' +
      `<nav class="site-footer__col site-footer__col--sections" aria-label="${c.sections}"><p class="site-footer__title">${c.sections}</p>${sections}</nav>` +
      `<nav class="site-footer__col" aria-label="${c.apps}"><p class="site-footer__title">${c.apps}</p>${apps}</nav>` +
      `<nav class="site-footer__col" aria-label="${c.project}"><p class="site-footer__title">${c.project}</p>${project}</nav>` +
    '</div>' +
    '<div class="site-footer__bar">' +
      `<p class="site-footer__credit">&copy; ${new Date().getFullYear()} Calendario Ciclismo - ${c.credit} <a href="https://danisanchez.info" target="_blank" rel="noopener">Dani&nbsp;S&aacute;nchez</a></p>` +
      '<p class="site-footer__legal">' +
        `<a href="${c.privacyHref}">${c.privacyText}</a>` +
        '<span data-footer-cookies></span>' +
      '</p>' +
    '</div>';
}
