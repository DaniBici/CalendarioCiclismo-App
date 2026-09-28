// Comparar el HTML generado, no el DOM serializado: filtros y desplegables
// modifican el DOM y deben conservarse cuando la siguiente consulta no cambia nada.
const renderedHtml = new WeakMap();

export function updateResultsHtml(element, html) {
  if (renderedHtml.get(element) === html) return false;
  element.innerHTML = html;
  renderedHtml.set(element, html);
  return true;
}

// Posición de scroll en la que un bloque sticky empieza a fijarse: su borde
// superior en el flujo del documento menos su `top`. Se mide sin sticky en la
// misma tarea, sin pintar el estado intermedio.
function stickyStartScroll(sticky) {
  const stickyTop = parseFloat(getComputedStyle(sticky).top) || 0;
  const position = sticky.style.position;
  sticky.style.position = 'static';
  const flowTop = sticky.getBoundingClientRect().top + window.scrollY;
  sticky.style.position = position;
  return Math.max(0, Math.round(flowTop - stickyTop));
}

// Al cambiar de clasificación, la página no queda más abajo del punto en que
// se fija el bloque sticky; por encima de ese punto no se desplaza.
export function limitScrollToStickyStart(sticky) {
  if (!sticky) return;
  const target = stickyStartScroll(sticky);
  if (window.scrollY > target) window.scrollTo({ top: target, behavior: 'instant' });
}
