// ════════════════════════════════════════════════════════════════════
// Drawer deslizante — paradigma único de edición del panel
// ────────────────────────────────────────────────────────────────────
// Sustituye el batiburrillo de editores inline / modales overlay / vista
// a pantalla completa por UN solo contenedor que entra desde la derecha,
// con dos niveles apilables (p.ej. equipo en nivel 1 → ficha de corredor
// en nivel 2). El contenido lo monta cada editor en el `body` del nivel.
//
// API:
//   const h = openDrawer({ title, level, wide, render, onClose });
//      title   string  — cabecera
//      level   1|2     — nivel de apilado (def. 1). El 2 va sobre el 1.
//      wide    boolean — drawer ancho (editores densos: jornada, dup-scan)
//      render  (bodyEl) => void  — monta el contenido en el body (vacío)
//      onClose ()       => void  — se llama al cerrar ese nivel
//   devuelve { level, body, setTitle(t), close() }
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

// Estado por nivel: { onClose } cuando está abierto, null cuando cerrado.
const _open = { 1: null, 2: null };
let _wired = false;
let _lastFocus = null;

function $(id) { return document.getElementById(id); }
function root() { return $('ccDrawerRoot'); }

function _anyOpen() { return !!(_open[1] || _open[2]); }

function _syncRoot() {
  const r = root();
  if (!r) return;
  const any = _anyOpen();
  r.classList.toggle('is-open', any);
  r.setAttribute('aria-hidden', any ? 'false' : 'true');
  // Bloquear scroll del fondo mientras haya un drawer abierto
  document.body.style.overflow = any ? 'hidden' : '';
  _syncInert();
}

// Neutralizar TODO lo que queda detrás del drawer (DOM-level, no solo el
// scrim): con `inert` el fondo no recibe pulsaciones, foco ni clicks. Evita
// el "click-through" táctil en móvil (al pulsar Guardar/Actualizar se activaba
// un botón de la agenda que quedaba detrás). Dos capas:
//   1) El fondo del panel (.panel-layout: rail + agenda + vistas) queda inert
//      mientras haya CUALQUIER nivel abierto.
//   2) El drawer de nivel 1 queda inert mientras el nivel 2 esté apilado encima.
// Los diálogos (.cc-dialog-root) cuelgan de <body>, fuera de .panel-layout, así
// que siguen siendo interactivos.
function _syncInert() {
  const bg = document.querySelector('.panel-layout');
  if (bg) bg.toggleAttribute('inert', _anyOpen());
  const d1 = $(LEVELS[1].drawer);
  if (d1) d1.toggleAttribute('inert', !!_open[2]);
}

function _wireOnce() {
  if (_wired) return;
  _wired = true;

  // Cerrar al pulsar el scrim → cierra el nivel más alto abierto
  $('ccDrawerScrim')?.addEventListener('click', () => closeDrawer());

  // Botón ✕ de cada nivel
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
export function openDrawer({ title = '', level = 1, wide = false, render, onClose } = {}) {
  _wireOnce();
  const cfg = LEVELS[level];
  if (!cfg) throw new Error(`drawer: nivel inválido ${level}`);

  // Guardar foco para restaurarlo al cerrar todo
  if (!_anyOpen()) _lastFocus = document.activeElement;

  const bodyEl = $(cfg.body);
  const titleEl = $(cfg.title);
  const drawerEl = $(cfg.drawer);

  // Si el nivel ya estaba abierto, ejecutar su onClose antes de reemplazar
  if (_open[level]?.onClose) {
    try { _open[level].onClose(); } catch (_) { /* noop */ }
  }

  // Variante ancha (editores densos): se reinicia en cada apertura
  drawerEl.classList.toggle('cc-drawer--wide', !!wide);

  if (titleEl) titleEl.textContent = title;
  bodyEl.innerHTML = '';
  bodyEl.scrollTop = 0;

  _open[level] = { onClose: onClose || null };
  drawerEl.classList.add('is-open');
  _syncRoot();

  if (typeof render === 'function') render(bodyEl);

  // Enfocar el primer control del drawer para accesibilidad/teclado
  requestAnimationFrame(() => {
    const focusable = bodyEl.querySelector(
      'input,select,textarea,button,[tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus({ preventScroll: true });
  });

  return {
    level,
    body: bodyEl,
    setTitle(t) { if (titleEl) titleEl.textContent = t; },
    close() { closeDrawer(level); },
  };
}

/**
 * Cierra un nivel concreto, o el más alto abierto si se omite.
 * Cerrar el nivel 1 arrastra el 2 (no tiene sentido dejarlo huérfano).
 */
export function closeDrawer(level) {
  if (level == null) level = _open[2] ? 2 : (_open[1] ? 1 : null);
  if (level == null) return;

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

  // Restaurar foco si ya no queda nada abierto
  if (!_anyOpen() && _lastFocus && typeof _lastFocus.focus === 'function') {
    _lastFocus.focus({ preventScroll: true });
    _lastFocus = null;
  }
}

export function isDrawerOpen() { return _anyOpen(); }
