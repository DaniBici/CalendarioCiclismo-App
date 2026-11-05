// Actualiza un DOM ya pintado con un HTML nuevo sin sustituirlo: conserva los
// nodos que no cambian (imágenes cargadas, foco, desplazamiento, oyentes) y
// toca solo los atributos, textos e hijos que difieren.
//
// Los hijos se emparejan por clave (`data-key`, o `id`) y, sin clave, por
// etiqueta en el orden del documento. Las filas de una lista que cambia con
// los datos (movimientos, clasificaciones, carreras) llevan `data-key` estable:
// así una fila nueva se inserta sin rehacer las demás y una fila movida se
// traslada con su nodo. Un elemento con clave sin pareja ocupa el siguiente de
// su etiqueta sin clave: un HTML anterior a las claves (páginas generadas en
// builds previos) se actualiza por posición en lugar de rehacerse.
//
// Sirve para repintar contenido generado en el build cuyo HTML ya no coincide
// con los datos vivos (`applyPrerenderedHtml` de js/html-fingerprint.js) y para
// refrescar datos sobre lo ya pintado. `enter(node)` recibe cada elemento con
// clave insertado en una lista que ya tenía elementos con clave (un primer
// pintado no anima); `slideIn` lo hace entrar sin salto.
//
// De los controles de formulario solo se actualizan los atributos: el valor
// escrito o el marcado por el visitante se conservan.

function keyOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node.getAttribute('data-key') || node.id || null : null;
}

/** Actualiza los hijos de `el` con los de `html`. */
export function patchHtml(el, html, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const entered = [];
  patchList(el, template.content, options, entered);
  if (options.enter) entered.forEach(options.enter);
}

function patchList(target, source, options, entered) {
  const byKey = new Map();
  for (let node = target.firstChild; node; node = node.nextSibling) {
    const key = keyOf(node);
    if (key) byKey.set(key, node);
  }
  const animate = byKey.size > 0;
  const kept = new Set();
  let cursor = target.firstChild;
  for (const next of Array.from(source.childNodes)) {
    const key = keyOf(next);
    const old = key ? byKey.get(key) : null;
    let match = old && old.nodeName === next.nodeName && !kept.has(old) ? old : null;
    for (let node = cursor; !match && node; node = node.nextSibling) {
      if (!kept.has(node) && !keyOf(node) && node.nodeName === next.nodeName) match = node;
    }
    if (match) {
      if (match !== cursor) target.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      patchNode(match, next, options, entered);
    } else {
      target.insertBefore(next, cursor);
      match = next;
      if (key && animate) entered.push(next);
    }
    kept.add(match);
  }
  for (let node = target.firstChild; node;) {
    const following = node.nextSibling;
    if (!kept.has(node)) node.remove();
    node = following;
  }
}

function patchNode(old, next, options, entered) {
  if (old.isEqualNode(next)) return;
  if (old.nodeType !== Node.ELEMENT_NODE) {
    old.nodeValue = next.nodeValue;
    return;
  }
  for (const attr of Array.from(next.attributes)) {
    if (old.getAttributeNS(attr.namespaceURI, attr.localName) === attr.value) continue;
    if (attr.namespaceURI) old.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    else old.setAttribute(attr.name, attr.value);
  }
  for (const attr of Array.from(old.attributes)) {
    if (!next.hasAttributeNS(attr.namespaceURI, attr.localName)) old.removeAttributeNS(attr.namespaceURI, attr.localName);
  }
  patchList(old, next, options, entered);
}

/** Hace crecer `node` desde alto 0 (sin animación con movimiento reducido). */
export function slideIn(node) {
  if (!(node instanceof HTMLElement) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const height = node.offsetHeight;
  if (!height) return;
  const style = getComputedStyle(node);
  node.style.overflow = 'hidden';
  const animation = node.animate([
    { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
    { height: `${height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, opacity: 1 },
  ], { duration: 200, easing: 'ease-out' });
  animation.onfinish = animation.oncancel = () => node.style.removeProperty('overflow');
}
