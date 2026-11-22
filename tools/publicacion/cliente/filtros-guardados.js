// Filtros y orden recordados (js/race-filters.js y js/components/sort-menu.js) sobre la lista
// publicada, antes del primer pintado: se retiran las tarjetas que no pasan el filtro, que llevan
// su valor en `data-level` y `data-genders`. Cuando el JS va a pintar otra lista (orden guardado,
// chincheta de la 5.2.3, día sin carreras filtradas o `esperarSi`), la lista se oculta hasta que
// el JS la pinta. Lo usan cliente/pre-pintado-hoy.js y cliente/pre-pintado-portada.js.
// Devuelve los grupos con filtro (`activos`) y si la lista espera al JS (`espera`), con su
// `motivo`: 'chincheta', 'orden', 'nombres' o 'vacia' (el día se queda sin tarjetas).

const leer = clave => { try { return localStorage.getItem(clave); } catch { return null; } };

/**
 * `grupos`: [{ clave, atributo, valores }], con las opciones del menú. Devuelve los grupos con
 * filtro activo, como loadFilters() y filtersActive() de js/components/filter-menu.js.
 */
function gruposActivos(guardado, grupos) {
  let datos = null;
  try { datos = JSON.parse(guardado || 'null'); } catch { datos = null; }
  if (!datos || typeof datos !== 'object') return [];
  return grupos.map(grupo => {
    const marcados = Array.isArray(datos[grupo.clave]) ? grupo.valores.filter(v => datos[grupo.clave].includes(v)) : [];
    return { ...grupo, marcados };
  }).filter(grupo => grupo.marcados.length && grupo.marcados.length < grupo.valores.length);
}

// Rótulos de js/i18n.js e i18n/en.json (sort.*): el botón «Ordenar» llega con «Cat. UCI».
const ORDEN = {
  es: { label: 'Ordenar', tvtime: 'Hora TV', finishtime: 'Hora de meta' },
  en: { label: 'Sort', tvtime: 'TV Time', finishtime: 'Finish Time' },
};

function rotularOrden(botonOrden, orden) {
  const textos = ORDEN[document.documentElement.lang === 'en' ? 'en' : 'es'];
  const span = botonOrden?.querySelector('span');
  if (!span || !textos[orden] || orden === 'label') return;
  span.textContent = textos[orden];
  botonOrden.setAttribute('aria-label', `${textos.label}: ${textos[orden]}`);
}

export function aplicarFiltrosGuardados({ lista, clave, chincheta, claveOrden, grupos, boton, botonOrden, esperarSi }) {
  const activos = gruposActivos(leer(clave), grupos);
  const ocultar = motivo => { lista.style.visibility = 'hidden'; return { activos, espera: true, motivo }; };
  const orden = leer(claveOrden);
  if (orden) rotularOrden(botonOrden, orden);
  if (activos.length && boton) boton.classList.add('agenda-filter-btn--active');
  // La chincheta antigua la convierte el JS; un orden distinto del de categoría cambia la lista.
  if (leer(chincheta)) return ocultar('chincheta');
  if (orden) return ocultar('orden');
  if (!activos.length) return { activos, espera: false };
  if (esperarSi?.(activos)) return ocultar('nombres');
  const tarjetas = [...lista.querySelectorAll('[data-level]')];
  for (const tarjeta of tarjetas) {
    const pasa = activos.every(grupo => (tarjeta.getAttribute(grupo.atributo) || '').split(' ').some(v => grupo.marcados.includes(v)));
    if (!pasa) tarjeta.remove();
  }
  // Sin tarjetas el JS pinta el aviso de día sin carreras con filtro o salta a otro día.
  if (tarjetas.length && !lista.querySelector('[data-level]')) return ocultar('vacia');
  return { activos, espera: false };
}
