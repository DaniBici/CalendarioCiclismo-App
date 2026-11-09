// Antes del primer pintado: alto de los filtros, vuelta desde una carrera, desplazamiento
// al día de hoy y lo que no coincide con la versión publicada (otra vista, filtro o año):
// entonces la lista se oculta hasta que el JS completo la pinta. Va en línea, tras la lista.
import { readCalendarMonth, readCalendarView } from '../../../js/calendario-query.js';

const lista = document.getElementById('temporadaContent');
const filtros = document.getElementById('temporadaFilters');
const parametros = new URLSearchParams(location.search);
const leer = (almacen, clave) => { try { return almacen.getItem(clave); } catch { return null; } };

const vista = readCalendarView(parametros) || (readCalendarMonth(parametros) ? 'mes' : null) || leer(localStorage, 'cc-cal-subview');
const fijado = leer(localStorage, lista.dataset.pinClave);
const pendiente = vista === 'mes' || parametros.has('year') || parametros.has('cat') || readCalendarMonth(parametros) || (fijado && fijado !== 'all');
document.documentElement.style.setProperty('--temporada-filters-h', `${filtros.offsetHeight}px`);

if (pendiente) {
  lista.dataset.pendiente = '';
  if (vista === 'mes') {
    filtros.hidden = true;
    lista.hidden = true;
    document.getElementById('mesBar').hidden = false;
    document.getElementById('mesContent').hidden = false;
  }
} else {
  let nav = {};
  try { nav = JSON.parse(leer(sessionStorage, 'cc_nav') || '{}'); } catch { /* Sin estado. */ }
  if (nav.from === 'temporada') {
    for (const id of nav.expanded || []) {
      const boton = lista.querySelector(`.t-race--challenge[data-cgid="${CSS.escape(id)}"]`);
      if (boton) {
        boton.setAttribute('aria-expanded', 'true');
        document.getElementById(boton.getAttribute('aria-controls')).hidden = false;
      }
    }
  }
  if (typeof nav.scrollY === 'number' && nav.from === 'temporada') {
    scrollTo({ top: nav.scrollY, behavior: 'instant' });
    const { scrollY: _usado, ...resto } = nav;
    try { sessionStorage.setItem('cc_nav', JSON.stringify(resto)); } catch { /* Sin almacenamiento. */ }
  } else if (Number(lista.dataset.anio) === new Date().getFullYear()) {
    const hoy = new Date().toISOString().slice(0, 10);
    const fila = [...lista.querySelectorAll('[data-sortkey]')].find(nodo => (nodo.dataset.endkey || nodo.dataset.sortkey) >= hoy);
    if (fila) {
      const cabecera = document.querySelector('.site-header')?.offsetHeight || 0;
      const titulo = lista.querySelector('.temporada-month__title')?.offsetHeight || 0;
      scrollTo({ top: fila.getBoundingClientRect().top + scrollY - cabecera - filtros.offsetHeight - titulo - (innerWidth < 600 ? 4 : 8), behavior: 'instant' });
    }
  }
}
