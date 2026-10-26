import { htmlFingerprint } from '../html-fingerprint.js';

// Comparar el HTML generado, no el DOM serializado: filtros y desplegables
// modifican el DOM y deben conservarse cuando la siguiente consulta no cambia nada.
const renderedHtml = new WeakMap();

// Contenido escrito en el build (tools/site/prerender-resultados.mjs): el
// hueco lleva data-prerendered con la huella de su HTML y, si la tabla va
// recortada, data-rows con sus filas. La primera actualización conserva el DOM
// si el HTML del navegador tiene la misma huella (con `rows`: la de esas
// primeras filas, y añade las demás al final del <tbody>). Las marcas se
// retiran en cualquier caso.
function adoptPrerendered(element, html, rows) {
  const fingerprint = element.dataset?.prerendered;
  if (fingerprint == null) return false;
  const limit = Number(element.dataset.rows);
  delete element.dataset.prerendered;
  delete element.dataset.rows;
  if (!limit) return fingerprint === htmlFingerprint(html);
  if (!rows || fingerprint !== htmlFingerprint(rows.head + rows.list.slice(0, limit).join('') + rows.tail)) return false;
  const body = element.querySelector('tbody');
  if (!body) return false;
  body.insertAdjacentHTML('beforeend', rows.list.slice(limit).join(''));
  return true;
}

/**
 * Pinta `html` en `element` salvo que sea el último que se pintó (false) o
 * el contenido generado en el build con la misma huella (true, sin tocar el
 * DOM). `rows` ({ head, list, tail }): la tabla por filas, para el contenido
 * generado con las primeras.
 */
export function updateResultsHtml(element, html, rows = null) {
  if (renderedHtml.get(element) === html) return false;
  if (!adoptPrerendered(element, html, rows)) element.innerHTML = html;
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
