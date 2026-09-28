// ════════════════════════════════════════════════════════════════════
// Vistas de edición a todo el ancho de la columna derecha del panel
// ────────────────────────────────────────────────────────────────────
// Conserva dos niveles de navegación (equipo → ficha de corredor).
// Cada nivel ocupa toda la columna; al volver se recuperan el formulario,
// el desplazamiento y el foco de la vista anterior.
// En móvil la edición ocupa la pantalla completa y oculta también el rail.
//
// API:
//   const h = openDrawer({ title, level, render, onClose });
//      title   string  — cabecera
//      level   1|2     — nivel de apilado (def. 1). El 2 va sobre el 1.
//      render  (bodyEl) => void  — monta el contenido en el body (vacío)
//      onClose ()       => void  — se llama al cerrar ese nivel
//   devuelve { level, body, isCurrent(), setTitle(t), close() }
//   El handle solo modifica o cierra su propia instancia, nunca la sustituta.
//
//   closeDrawer(level?) — cierra el nivel dado, o el más alto abierto si
//                         se omite. Cerrar el nivel 1 cierra todo.
//   isDrawerOpen()      — ¿hay algún nivel abierto?
//
// El host markup vive en panel/app.html (#ccDrawerRoot, #ccDrawer1/2).
// ════════════════════════════════════════════════════════════════════

const LEVELS = {
  1: { drawer: 'ccDrawer1', body: 'ccDrawer1Body', title: 'ccDrawer1Title', close: 'ccDrawer1Close' },
  2: { drawer: 'ccDrawer2', body: 'ccDrawer2Body', title: 'ccDrawer2Title', close: 'ccDrawer2Close' },
};

// Estado por nivel: callback de cierre y elemento al que devolver el foco.
const _open = { 1: null, 2: null };
let _wired = false;
let _bodyOverflow = null;
let _mobileViewport = null;

function $(id) { return document.getElementById(id); }
function root() { return $('ccDrawerRoot'); }

function _anyOpen() { return !!(_open[1] || _open[2]); }

function _syncRoot() {
  const r = root();
  if (!r) return;
  const any = _anyOpen();
  r.classList.toggle('is-open', any);
  r.setAttribute('aria-hidden', any ? 'false' : 'true');
  // Conservar el desplazamiento del listado mientras se edita.
  if (any && _bodyOverflow === null) _bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = any ? 'hidden' : (_bodyOverflow ?? '');
  if (!any) _bodyOverflow = null;

  // El rail sigue disponible en escritorio. En móvil también queda cubierto.
  document.querySelectorAll('.panel-layout > :not(.panel-rail)').forEach(el => {
    el.toggleAttribute('inert', any);
  });
  document.querySelector('.panel-rail')?.toggleAttribute('inert', any && _mobileViewport.matches);
  for (const level of [1, 2]) {
    const drawer = $(LEVELS[level].drawer);
    const active = !!_open[level] && (level === 2 || !_open[2]);
    drawer?.toggleAttribute('inert', !active);
    drawer?.setAttribute('aria-hidden', active ? 'false' : 'true');
  }
}

function _wireOnce() {
  if (_wired) return;
  _wired = true;
  _mobileViewport = window.matchMedia('(max-width: 768px)');
  _mobileViewport.addEventListener('change', _syncRoot);

  // Volver a la vista anterior desde cualquiera de los dos niveles.
  for (const lvl of [1, 2]) {
    $(LEVELS[lvl].close)?.addEventListener('click', () => closeDrawer(lvl));
  }

  // Esc cierra el nivel más alto abierto
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _anyOpen()) {
      e.stopPropagation();
      closeDrawer();
    }
  });
}

/**
 * Abre (o reusa) un nivel del drawer y monta contenido en su body.
 */
export function openDrawer({ title = '', level = 1, render, onClose } = {}) {
  _wireOnce();
  const cfg = LEVELS[level];
  if (!cfg) throw new Error(`drawer: nivel inválido ${level}`);

  // Sustituir el nivel principal descarta también cualquier ficha dependiente.
  if (level === 1 && _open[2]) closeDrawer(2);
  const returnFocus = _open[level]?.returnFocus || document.activeElement;

  const bodyEl = $(cfg.body);
  const titleEl = $(cfg.title);
  const drawerEl = $(cfg.drawer);

  // Si el nivel ya estaba abierto, ejecutar su onClose antes de reemplazar
  if (_open[level]?.onClose) {
    try { _open[level].onClose(); } catch (_) { /* noop */ }
  }

  const previousTitle = level === 2 && _open[1]
    ? $(LEVELS[1].title)?.textContent
    : document.querySelector('.rail-item.active[data-tab] .rail-item__label')?.textContent;
  $(cfg.close)?.setAttribute('aria-label', previousTitle ? `Volver a ${previousTitle.trim()}` : 'Volver');

  if (titleEl) titleEl.textContent = title;
  bodyEl.innerHTML = '';
  bodyEl.scrollTop = 0;

  const state = { onClose: onClose || null, returnFocus };
  _open[level] = state;
  drawerEl.classList.add('is-open');
  _syncRoot();

  if (typeof render === 'function') render(bodyEl);

  // Anunciar la pantalla sin abrir el teclado del móvil al entrar.
  requestAnimationFrame(() => {
    if (_open[level] === state && (level === 2 || !_open[2])) {
      titleEl?.focus({ preventScroll: true });
    }
  });

  return {
    level,
    body: bodyEl,
    isCurrent() { return _open[level] === state; },
    setTitle(t) { if (_open[level] === state && titleEl) titleEl.textContent = t; },
    close() { if (_open[level] === state) closeDrawer(level); },
  };
}

/**
 * Cierra un nivel concreto, o el más alto abierto si se omite.
 * Cerrar el nivel 1 arrastra el 2 (no tiene sentido dejarlo huérfano).
 */
export function closeDrawer(level) {
  if (level == null) level = _open[2] ? 2 : (_open[1] ? 1 : null);
  if (level == null || (level === 1 ? !_anyOpen() : !_open[level])) return;
  const returnFocus = (_open[level] || _open[2]).returnFocus;

  const closeLevel = (lvl) => {
    const st = _open[lvl];
    if (!st) return;
    _open[lvl] = null;
    $(LEVELS[lvl].drawer)?.classList.remove('is-open');
    const bodyEl = $(LEVELS[lvl].body);
    if (bodyEl) bodyEl.innerHTML = '';
    if (st.onClose) { try { st.onClose(); } catch (_) { /* noop */ } }
  };

  if (level === 1) {
    // Cerrar todo, de arriba a abajo
    closeLevel(2);
    closeLevel(1);
  } else {
    closeLevel(2);
  }

  _syncRoot();

  // Volver a una ficha conserva el foco y el scroll del formulario padre.
  // Si su control ya no existe (p. ej. tras un guardado), usar su cabecera.
  const fallback = _open[1] ? $(LEVELS[1].title) : document.querySelector('.rail-item.active[data-tab]');
  const target = returnFocus?.isConnected && !returnFocus.closest('[inert]') ? returnFocus : fallback;
  target?.focus({ preventScroll: true });
}

/** @public Lo consultan las pruebas del ciclo de vida del drawer. */
export function isDrawerOpen() { return _anyOpen(); }
