// ─────────────────────────────────────────────────────────────────
//  THEME — claro / oscuro
//  Carga antes de pintar la página (inline en <head>) para evitar flash
// ─────────────────────────────────────────────────────────────────

(function () {
  const KEY = 'cc-theme';
  const AUTO_KEY = 'cc-theme-auto';
  const MODES = ['light', 'dark', 'auto', 'system'];

  // Modos:
  //  · «light» / «dark»: elegido, se guarda en `cc-theme`.
  //  · «system»: sin elección (ninguna clave); sigue al sistema y el botón
  //    muestra su tema, el modo natural.
  //  · «auto»: vuelta al sistema tras haberlo contravenido; se guarda como
  //    marca en `cc-theme-auto` y el botón muestra su propio icono.
  // `cc-theme` solo contiene «light» o «dark» (o ausente): los scripts
  // inline de cada <head> siguen resolviendo el tema sin conocer «auto».
  function getMode() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return localStorage.getItem(AUTO_KEY) ? 'auto' : 'system';
  }

  function getPreferred() {
    const mode = getMode();
    return mode === 'light' || mode === 'dark' ? mode : systemTheme();
  }

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Colores de fondo base — deben coincidir con --bg de css/app.css
  // (:root oscuro / html.light claro).
  const BG = { dark: '#10141c', light: '#eef1f5' };

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

  function setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (mode === 'light' || mode === 'dark') {
      localStorage.setItem(KEY, mode);
      localStorage.removeItem(AUTO_KEY);
    } else {
      localStorage.removeItem(KEY);
      if (mode === 'auto') localStorage.setItem(AUTO_KEY, '1');
      else localStorage.removeItem(AUTO_KEY);
    }
    apply(getPreferred());
    updateButtons();
  }

  // Rotación del botón desde el modo natural del sistema: tema del sistema →
  // tema contrario → AUTO → tema del sistema. AUTO solo se alcanza tras
  // contravenir el modo natural. Un tema fijado igual al del sistema (de la
  // versión anterior del botón) cuenta como el modo natural.
  function nextMode(mode) {
    const system = systemTheme();
    const opposite = system === 'light' ? 'dark' : 'light';
    if (mode === opposite) return 'auto';
    if (mode === 'auto') return 'system';
    return opposite;
  }

  function toggle() {
    setMode(nextMode(getMode()));
  }

  const ICONS = {
    light: '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" fill="currentColor"/>',
    auto: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'
  };

  const LABELS = {
    es: {
      light: 'claro', dark: 'oscuro', auto: 'automático (sistema)',
      title: (cur, next) => `Tema: ${cur}. Pulsar para cambiar a ${next}`
    },
    en: {
      light: 'light', dark: 'dark', auto: 'auto (system)',
      title: (cur, next) => `Theme: ${cur}. Press to switch to ${next}`
    }
  };

  function updateButtons() {
    const isEN = window.location.pathname.startsWith('/en/') || window.location.pathname === '/en';
    const l = isEN ? LABELS.en : LABELS.es;
    const mode = getMode();
    // El icono muestra el modo al que se pasa al pulsar (sol estando en
    // oscuro); el título indica el modo actual y el siguiente. En «system»
    // el modo actual es el tema del sistema, el natural.
    const current = mode === 'system' ? systemTheme() : mode;
    const next = nextMode(mode);
    const target = next === 'system' ? systemTheme() : next;
    const icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">${ICONS[target]}</svg>`;
    const title = l.title(l[current], l[target]);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.innerHTML = icon;
      btn.title = title;
      btn.setAttribute('aria-label', title);
    });
  }

  // Aplicar inmediatamente al cargar
  apply(getPreferred());

  // Seguir el modo del sistema con la página abierta (p. ej. cambio
  // automático al anochecer) mientras el modo sea «system» o «auto».
  const systemQuery = window.matchMedia('(prefers-color-scheme: light)');
  systemQuery.addEventListener('change', () => {
    if (getMode() === 'light' || getMode() === 'dark') return;
    apply(getPreferred());
    updateButtons();
  });

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
