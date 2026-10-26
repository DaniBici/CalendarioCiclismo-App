// ─────────────────────────────────────────────────────────────────
//  THEME — claro / oscuro, según el dispositivo
//  Carga antes de pintar la página (inline en <head>) para evitar flash
// ─────────────────────────────────────────────────────────────────

(function () {
  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Colores de fondo base — deben coincidir con --bg de css/app.css
  // (:root oscuro / html.light claro).
  const BG = { dark: '#0b0c0f', light: '#eef1f5' };

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

  // Aplicar inmediatamente al cargar
  apply(systemTheme());

  // Seguir el tema del sistema con la página abierta (p. ej. cambio
  // automático al anochecer).
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => apply(systemTheme()));

  // Claves del antiguo selector de tema: ya no se leen.
  try {
    localStorage.removeItem('cc-theme');
    localStorage.removeItem('cc-theme-auto');
  } catch {}

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
})();

// ── Hover bandera regional → bandera nacional ──────────────────
(function () {
  const FLAG_BASE = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';
  const REGIONAL  = ['es-an', 'es-ar', 'es-as', 'es-cb', 'es-ce', 'es-cl', 'es-cm', 'es-cn',
                     'es-ct', 'es-ex', 'es-ga', 'es-ib', 'es-mc', 'es-md', 'es-ml', 'es-nc',
                     'es-pv', 'es-ri', 'es-vc'];
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
