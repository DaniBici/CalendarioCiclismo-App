// Portada y agenda de Ciclocross: filtros y orden recordados sobre la lista publicada, antes del
// primer pintado (cliente/filtros-guardados.js). Va en línea, tras la agenda. En inglés no existe
// «Nacional»: esas pruebas no se publican (cxHiddenClasses).
import { aplicarFiltrosGuardados } from './filtros-guardados.js';

const lista = document.getElementById('cxAgendaList');
if (lista) {
  const { espera, motivo } = aplicarFiltrosGuardados({
    lista, clave: 'cc_cx_filters', chincheta: 'cc_cx_default_filter', claveOrden: 'cc_cx_sort',
    boton: document.getElementById('cxAgendaFilterBtn'), botonOrden: document.getElementById('cxAgendaSortBtn'),
    grupos: [{ clave: 'level', atributo: 'data-level', valores: document.documentElement.lang === 'en' ? ['big', 'uci'] : ['big', 'uci', 'national'] }],
  });
  // Un día sin pruebas que pasen el filtro (o la chincheta por convertir): el JS abre otro día y
  // repinta la barra de fechas, que también espera.
  if (espera && (motivo === 'vacia' || motivo === 'chincheta')) {
    for (const nodo of [document.getElementById('cxDateBar'), document.querySelector('#cxAgendaFilters .agenda-date')]) {
      if (nodo) nodo.style.visibility = 'hidden';
    }
  }
}
