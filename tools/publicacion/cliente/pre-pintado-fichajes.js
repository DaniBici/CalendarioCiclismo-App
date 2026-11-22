// Portada del mercado, antes del primer pintado: los filtros recordados del feed
// (TRANSFER_FILTERS_KEY y FILTER_GROUPS de js/fichajes-html.js). Cada columna trae, ocultas, las
// filas que mostraría cualquier combinación de filtros, con su valor en `data-gender`,
// `data-division` y `data-day`; aquí se muestran las que pasan, con el corte de feedCut()
// (FEED_MAX_DAYS fechas o FEED_MAX_ITEMS movimientos): la lista es ya la que pinta el JS.
const GRUPOS = { gender: ['male', 'female'], division: ['world', 'pro'] };

const feed = document.getElementById('trFeed');
let datos = null;
try { datos = JSON.parse(localStorage.getItem('cc_transfer_filters') || 'null'); } catch { datos = null; }
if (feed && datos && typeof datos === 'object') {
  const filtrados = Object.entries(GRUPOS)
    .map(([clave, valores]) => ({ clave, valores, marcados: valores.filter(v => Array.isArray(datos[clave]) && datos[clave].includes(v)) }))
    .filter(grupo => grupo.marcados.length && grupo.marcados.length < grupo.valores.length);
  if (filtrados.length) {
    document.getElementById('trFiltersBtn')?.classList.add('tr-div-btn--active');
    const maxDias = Number(feed.dataset.maxDays);
    const maxFilas = Number(feed.dataset.maxItems);
    for (const columna of feed.querySelectorAll('.tr-feed-column')) {
      const lista = columna.querySelector(':scope > .tr-feed-list');
      if (!lista) continue;
      let dias = 0;
      let filas = 0;
      let ultimo = null;
      let completo = false;
      for (const fila of lista.querySelectorAll(':scope > .tr-row')) {
        const pasa = filtrados.every(grupo => grupo.marcados.includes(fila.getAttribute(`data-${grupo.clave}`) || ''));
        const dia = fila.dataset.day;
        const nuevo = dia !== ultimo;
        if (pasa && !completo && ((nuevo && dias >= maxDias) || filas >= maxFilas)) completo = true;
        fila.hidden = !pasa || completo;
        if (fila.hidden) continue;
        if (nuevo) { ultimo = dia; dias++; }
        filas++;
      }
      for (const cabecera of lista.querySelectorAll(':scope > .tr-feed-day')) {
        let siguiente = cabecera.nextElementSibling;
        let visible = false;
        while (siguiente && !siguiente.classList.contains('tr-feed-day')) {
          if (!siguiente.hidden) { visible = true; break; }
          siguiente = siguiente.nextElementSibling;
        }
        cabecera.hidden = !visible;
      }
      lista.hidden = filas === 0;
      const vacio = columna.querySelector(':scope > .tr-empty');
      if (vacio) vacio.hidden = filas > 0;
    }
  }
}
