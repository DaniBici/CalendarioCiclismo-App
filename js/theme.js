// ─────────────────────────────────────────────────────────────────
//  THEME — claro / oscuro
//  Carga antes de pintar la página (inline en <head>) para evitar flash
// ─────────────────────────────────────────────────────────────────

(function () {
  const KEY = 'cc-theme';

  function getPreferred() {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Colores de fondo base — deben coincidir con --bg de css/app.css
  // (:root oscuro / html.light claro).
  const BG = { dark: '#111318', light: '#ffffff' };

  function apply(theme) {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark',  theme === 'dark');
    // Pintar el fondo inline YA, sin esperar a que app.css descargue: este
    // script corre síncrono en <head> antes que la hoja de estilos, así que
    // sin esto el primer paint (sobre todo navegando a una página cuyo CSS
    // no está en caché) muestra el blanco por defecto del navegador → flash.
    // color-scheme además tiñe el lienzo nativo del navegador.
    root.style.backgroundColor = BG[theme] || BG.dark;
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  }

  function toggle() {
    const current = localStorage.getItem(KEY) || getPreferred();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
    updateButtons();
  }

  function updateButtons() {
    const isDark = !document.documentElement.classList.contains('light');
    const isEN = window.location.pathname.startsWith('/en/') || window.location.pathname === '/en';
    const labels = isEN ? {
      light: 'Switch to light mode',
      dark: 'Switch to dark mode'
    } : {
      light: 'Cambiar a modo claro',
      dark: 'Cambiar a modo oscuro'
    };
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.innerHTML = isDark ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" fill="currentColor"/></svg>`;
      btn.title = isDark ? labels.light : labels.dark;
    });
  }

  // Aplicar inmediatamente al cargar
  apply(getPreferred());

  // Cortina anti-flash de la pantalla de carga: este script corre síncrono
  // ANTES del primer paint, pero js/page-loading.js (módulo, vía header.js)
  // solo corre tras el parse → sin cortina el contenido se ve 1-2 décimas.
  // La clase pinta un ::before a pantalla completa (css/app.css) que
  // page-loading.js retira al montar el overlay (o si la página no tiene
  // marcador de carga); failsafe CSS a los 5 s por si header.js no llega.
  // El panel tiene su propio shell sin header.js → fuera.
  if (!window.location.pathname.startsWith('/panel')) {
    document.documentElement.classList.add('cc-booting');
  }

  // Exponer para uso externo
  window.themeToggle = toggle;
  window.themeUpdateButtons = updateButtons;

  // Bind en DOMContentLoaded (los botones aún no existen al ejecutarse este script)
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', toggle);
    });
    updateButtons();
  });
})();

// ── Hover bandera regional → bandera nacional ──────────────────
(function () {
  const FLAG_BASE = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';
  const REGIONAL  = ['es-ct', 'es-pv'];
  const PARENT    = 'es';

  document.addEventListener('mouseover', e => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const code = REGIONAL.find(r => img.src.includes('/' + r + '.svg'));
    if (!code) return;
    img.dataset.originalSrc = img.src;
    img.src = FLAG_BASE + PARENT + '.svg';
  });

  document.addEventListener('mouseout', e => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.originalSrc) return;
    if (!REGIONAL.some(r => img.dataset.originalSrc.includes('/' + r + '.svg'))) return;
    img.src = img.dataset.originalSrc;
    delete img.dataset.originalSrc;
  });

  // Móvil: toggle al pulsar
  document.addEventListener('click', e => {
    if (window.innerWidth >= 600) return;
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const isRegional = REGIONAL.some(r => img.src.includes('/' + r + '.svg'));
    const isParent   = img.src.includes('/' + PARENT + '.svg') && img.dataset.regionalSrc;
    if (isRegional) {
      img.dataset.regionalSrc = img.src;
      img.src = FLAG_BASE + PARENT + '.svg';
      e.stopPropagation();
    } else if (isParent) {
      img.src = img.dataset.regionalSrc;
      delete img.dataset.regionalSrc;
      e.stopPropagation();
    }
  });
})();
