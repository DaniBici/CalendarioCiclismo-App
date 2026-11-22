// Filtros de Últimos resultados en la página publicada: la selección de Hoy y Calendario
// (js/race-filters.js; claves de localStorage por disciplina) sobre las filas ya pintadas, que
// llevan `data-level` y `data-genders` (js/resultados-feed-html.js). Lo usan el script previo al
// primer pintado (pre-pintado-resultados.js) y la isla (isla-resultados.js), que tras cada cambio
// del menú vuelve a leer la selección guardada.
import { filterFeedRows } from '../../../js/resultados-feed-layout.js';

const VISTAS = {
  latest: {
    clave: 'cc_road_filters', chincheta: 'cc_default_filter',
    grupos: [{ clave: 'level', atributo: 'data-level', valores: ['wt', 'pro', 'dev'] }, { clave: 'gender', atributo: 'data-genders', valores: ['male', 'female'] }],
  },
  cx: {
    clave: 'cc_cx_filters', chincheta: 'cc_cx_default_filter',
    grupos: [{ clave: 'level', atributo: 'data-level', valores: lang => (lang === 'en' ? ['big', 'uci'] : ['big', 'uci', 'national']) }],
  },
};

const leer = clave => { try { return localStorage.getItem(clave); } catch { return null; } };

/** Grupos con filtro de `vista` ('latest' o 'cx'); sin filtros, []. */
function activos(vista, lang) {
  const definicion = VISTAS[vista];
  if (!definicion) return [];
  let datos = null;
  try { datos = JSON.parse(leer(definicion.clave) || 'null'); } catch { datos = null; }
  if (!datos || typeof datos !== 'object') return [];
  return definicion.grupos.map(grupo => {
    const valores = typeof grupo.valores === 'function' ? grupo.valores(lang) : grupo.valores;
    const marcados = Array.isArray(datos[grupo.clave]) ? valores.filter(v => datos[grupo.clave].includes(v)) : [];
    return { atributo: grupo.atributo, marcados, completo: !marcados.length || marcados.length === valores.length };
  }).filter(grupo => !grupo.completo);
}

/** La chincheta de la 5.2.3 la convierte js/race-filters.js: hasta entonces, sin pintar. */
export const chinchetaPendiente = vista => Boolean(VISTAS[vista] && leer(VISTAS[vista].chincheta));

/**
 * Muestra «Filtros» de `vista` (el Ránking no lleva), lo marca si filtra y muestra las filas que
 * pasan, al menos 15 días (filterFeedRows); las de reserva para otros filtros quedan ocultas.
 */
export function aplicarFiltros(main, panel, vista) {
  const lang = main.dataset.lang;
  for (const slot of main.querySelectorAll('.feed-filter-slot')) slot.hidden = slot.dataset.filtros !== vista;
  if (!VISTAS[vista]) return;
  const grupos = activos(vista, lang);
  main.querySelector(`.feed-filter-slot[data-filtros="${vista}"] [data-menu-button]`)?.classList.toggle('agenda-filter-btn--active', grupos.length > 0);
  // Inicio de lo que se ve (al menos 15 días con filas que pasan): «Cargar más» sigue desde ahí.
  const desde = vista === 'cx' ? main.dataset.cxDesde : main.dataset.desde;
  const inicio = filterFeedRows(panel, fila => grupos.every(grupo => (fila.getAttribute(grupo.atributo) || '').split(' ').some(v => grupo.marcados.includes(v))), main.dataset.filtroVacio, desde);
  main.dataset[vista === 'cx' ? 'cxInicio' : 'inicio'] = inicio;
}
