// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Alcance de las secciones disponibles
// ─────────────────────────────────────────────────────────────────
//
// Alcance reducido: Resultados (la vista Agenda, limitada a las clasificaciones
// de carretera), Fichajes, Métricas y Notificaciones (carretera y ciclocross en
// un solo formulario). El resto de vistas, el área de ciclocross y las pestañas de
// edición de la jornada quedan ocultos sin retirar su código.
// Restauración en docs/memory/panel-alcance.md:
//   · para todos: DEFAULT_SCOPE = 'full';
//   · en un navegador: abrir el panel con ?alcance=completo (se vuelve con
//     ?alcance=reducido). La elección se guarda en localStorage.

const DEFAULT_SCOPE = 'reduced';
const STORAGE_KEY = 'panel_scope';
const URL_SCOPES = { completo: 'full', reducido: 'reduced' };
// Vistas del alcance reducido, en el orden del rail. La primera es la vista
// inicial cuando el hash no selecciona otra.
export const REDUCED_RAIL_ORDER = ['analytics', 'fichajes', 'notifications', 'agenda'];
const REDUCED_TABS = new Set(REDUCED_RAIL_ORDER);

function resolveScope() {
  const requested = URL_SCOPES[new URLSearchParams(location.search).get('alcance')];
  try {
    if (requested === DEFAULT_SCOPE) localStorage.removeItem(STORAGE_KEY);
    else if (requested) localStorage.setItem(STORAGE_KEY, requested);
    return requested || localStorage.getItem(STORAGE_KEY) || DEFAULT_SCOPE;
  } catch (_) {
    return requested || DEFAULT_SCOPE;
  }
}

export const panelScopeReduced = resolveScope() !== 'full';

export const isPanelTabEnabled = tab => !panelScopeReduced || REDUCED_TABS.has(tab);

// Única pestaña del editor de jornada en alcance reducido; la Agenda, que solo
// da acceso a ella, se rotula como Resultados.
export const REDUCED_EDITOR_TAB = 'resultados';
export const AGENDA_LABEL = panelScopeReduced ? 'Resultados' : 'Agenda';
