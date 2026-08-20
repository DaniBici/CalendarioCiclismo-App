// ─────────────────────────────────────────────────────────────────
//  lang-switch.js — Selector de idioma ES/EN + auto-redirect
//  Cargado como <script> al final del <body> en todas las páginas raíz.
// ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // EN_DOMAIN se lee de CONFIG (inyectada por config.js) o de window.EN_DOMAIN como fallback
  const EN_DOMAIN = (typeof CONFIG !== 'undefined' && CONFIG.enDomain)
    || (typeof window.EN_DOMAIN !== 'undefined' && window.EN_DOMAIN)
    || null;

  function getLang() {
    try { return localStorage.getItem('cc_lang'); } catch { return null; }
  }
  function setLang(lang) {
    try { localStorage.setItem('cc_lang', lang); } catch {}
  }

  function isEnHost() {
    return EN_DOMAIN && window.location.hostname === EN_DOMAIN;
  }

  function currentLang() {
    if (isEnHost()) return 'en';
    if (window.location.pathname.startsWith('/en/') || window.location.pathname === '/en') return 'en';
    return 'es';
  }

  // ── Auto-redirect (solo en raíz '/', una vez, sin elección previa) ──
  function maybeAutoRedirect() {
    const stored = getLang();
    if (stored) return; // ya eligió, no redirigir
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') return;
    const lang = navigator.language || navigator.userLanguage || '';
    if (!lang.toLowerCase().startsWith('en')) return;

    setLang('en');
    const enBase = EN_DOMAIN ? `https://${EN_DOMAIN}/` : '/en/';
    window.location.replace(enBase + window.location.search);
  }

  // ── Leer hreflang del DOM (escrito por la SPA tras cargar datos) ──
  function hreflangUrl(lang) {
    const el = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    return el ? el.href : null;
  }

  // ── Preservar query params actuales (p.ej. ?date=) al cruzar dominios ──
  // Los hreflang estáticos de las páginas raíz no incluyen el filtro de fecha,
  // así que mergeamos los params actuales sin sobrescribir los que ya trae el destino.
  function mergeSearch(targetUrlStr) {
    try {
      const targetUrl = new URL(targetUrlStr, window.location.origin);
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.forEach((value, key) => {
        if (!targetUrl.searchParams.has(key)) {
          targetUrl.searchParams.set(key, value);
        }
      });
      return targetUrl.toString();
    } catch {
      return targetUrlStr;
    }
  }

  // ── Construir URL en el idioma de destino ──────────────────────
  function buildTargetUrl(targetLang) {
    const path = window.location.pathname;

    if (targetLang === 'en') {
      // ES → EN
      if (isEnHost()) return window.location.href; // ya en EN

      // Si hay dominio EN dedicado, reescribe calendariociclismo.app/en/... → dominioEN/...
      // Sin dominio (EN_DOMAIN vacío) devuelve la URL /en/ intacta.
      function toEnDomain(url) {
        if (!EN_DOMAIN) return url;
        try {
          const u = new URL(url);
          const cleanPath = u.pathname.replace(/^\/en(?=\/|$)/, '') || '/';
          return `https://${EN_DOMAIN}${cleanPath}${u.search}`;
        } catch { return url; }
      }

      // Mapeo de rutas estáticas conocidas
      const staticMap = {
        '/':             '/en/',
        '/index.html':   '/en/',
        '/calendario.html': '/en/calendar/',
        '/mes.html':     '/en/calendar/',
        '/temporada.html': '/en/calendar/',
        '/about.html':   '/en/about/',
        '/abierto.html': '/en/open/',
        '/apoyar/':      '/en/support/',
        '/buscar.html':  '/en/search/',
        '/resultados/':  '/en/results/',
        '/fichajes/':    '/en/transfers/',
        '/privacidad.html': '/en/privacy/',
        '/suscripcion/': '/en/subscription/',
        '/campeonatos-nacionales-2026.html': '/en/2026-national-championships/',
      };
      if (staticMap[path]) return toEnDomain(window.location.origin + staticMap[path] + window.location.search);

      // Para rutas dinámicas: leer hreflang="en" escrito por la SPA al cargar datos
      if (path.startsWith('/jornada/') || path.startsWith('/competicion/') || path.startsWith('/inscritos/') || path.startsWith('/orden-salida/') || path.startsWith('/resultados/')) {
        const enUrl = hreflangUrl('en');
        if (enUrl) return toEnDomain(mergeSearch(enUrl));
      }

      // perfil/ y mapa/ (incluidos los shells .html del fallback de 404) →
      // intentar hreflang="en" que la SPA escribió al cargar; si no hay
      // equivalente EN → raíz EN.
      if (path.startsWith('/perfil/') || path.startsWith('/mapa/')
          || path === '/perfil.html' || path === '/mapa.html') {
        const enUrl = hreflangUrl('en');
        if (enUrl) return toEnDomain(mergeSearch(enUrl));
        return EN_DOMAIN ? `https://${EN_DOMAIN}/` : window.location.origin + '/en/';
      }

      // Fallback: raíz EN
      if (EN_DOMAIN) return `https://${EN_DOMAIN}/`;
      return window.location.origin + '/en/';
    } else {
      // EN → ES
      if (!isEnHost() && !path.startsWith('/en/')) return window.location.href; // ya en ES

      // Si estamos en el dominio inglés, intentar hreflang="es" primero
      if (isEnHost()) {
        const esUrl = hreflangUrl('es');
        if (esUrl) return mergeSearch(esUrl);

        const appBase = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin)
          ? CONFIG.webOrigin
          : 'https://calendariociclismo.app';

        // Mapear rutas limpias del dominio EN dedicado a sus equivalentes en ES
        const cleanPathMap = {
          '/':              '/',
          '/calendar/':     '/calendario.html',
          '/month/':        '/calendario.html',
          '/season/':       '/calendario.html',
          '/about/':        '/about.html',
          '/open/':         '/abierto.html',
          '/support/':      '/apoyar/',
          '/search/':       '/buscar.html',
          '/results/':      '/resultados/',
          '/transfers/':    '/fichajes/',
          '/privacy/':      '/privacidad.html',
          '/subscription/': '/suscripcion/',
          '/beta/':         '/betaandroid.html',
          '/2026-national-championships/': '/campeonatos-nacionales-2026.html',
        };
        return appBase + (cleanPathMap[path] || '/') + window.location.search;
      }

      // Para rutas dinámicas EN: leer hreflang="es" del DOM (presente en páginas pre-renderizadas)
      if (path.startsWith('/en/stage/') || path.startsWith('/en/race/') || path.startsWith('/en/startlist/') || path.startsWith('/en/results/') || path.startsWith('/en/profile/') || path.startsWith('/en/route-map/')) {
        const esUrl = hreflangUrl('es');
        if (esUrl) return mergeSearch(esUrl);
      }

      // Reescribir rutas /en/* → ES equivalente
      const qs = window.location.search;
      if (path === '/en/' || path === '/en') return '/' + qs;
      if (path.startsWith('/en/calendar/')) return '/calendario.html' + qs;
      if (path.startsWith('/en/month/')) return '/calendario.html' + qs;
      if (path.startsWith('/en/season/')) return '/calendario.html' + qs;
      if (path.startsWith('/en/about/')) return '/about.html' + qs;
      if (path.startsWith('/en/open/')) return '/abierto.html' + qs;
      if (path.startsWith('/en/support/')) return '/apoyar/' + qs;
      if (path.startsWith('/en/search/')) return '/buscar.html' + qs;
      if (path.startsWith('/en/results/')) return '/resultados/' + qs;
      if (path.startsWith('/en/transfers/')) return '/fichajes/' + qs;
      if (path.startsWith('/en/privacy/')) return '/privacidad.html' + qs;
      if (path.startsWith('/en/subscription/')) return '/suscripcion/' + qs;
      if (path.startsWith('/en/2026-national-championships/')) return '/campeonatos-nacionales-2026.html' + qs;

      return '/';
    }
  }

  // ── Renderizar el selector (slider ES↔EN) en la barra ─────────
  function makeSwitcher(id) {
    const lang = currentLang();
    const switcher = document.createElement('div');
    switcher.id = id;
    switcher.className = 'lang-switcher';
    switcher.dataset.active = lang; // posiciona el knob deslizante vía CSS
    switcher.innerHTML = `
      <span class="lang-knob" aria-hidden="true"></span>
      <button class="lang-btn${lang === 'es' ? ' lang-btn--active' : ''}" data-lang="es" title="Español">ES</button>
      <button class="lang-btn${lang === 'en' ? ' lang-btn--active' : ''}" data-lang="en" title="English">EN</button>
    `;
    switcher.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (!btn) return;
      const target = btn.dataset.lang;
      if (target === currentLang()) return;
      switcher.dataset.active = target; // desliza el knob antes de navegar
      setLang(target);
      window.location.href = buildTargetUrl(target);
    });
    return switcher;
  }

  function renderLangSwitcher() {
    // Único selector, siempre visible, en el cluster de utilidades del header
    // (antes del botón de tema).
    const actions = document.querySelector('.header-actions');
    if (actions && !document.getElementById('langSwitcher')) {
      const sw = makeSwitcher('langSwitcher');
      const theme = actions.querySelector('.theme-toggle');
      if (theme) actions.insertBefore(sw, theme);
      else actions.appendChild(sw);
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  maybeAutoRedirect();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderLangSwitcher);
  } else {
    renderLangSwitcher();
  }
})();
