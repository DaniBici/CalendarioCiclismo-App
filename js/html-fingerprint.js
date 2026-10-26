// Huella del HTML generado (FNV-1a de 32 bits). Las páginas generadas en el
// build la llevan en data-prerendered; el navegador conserva el DOM si su
// propio HTML tiene la misma huella.
export function htmlFingerprint(html) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

// Pinta `html` en `el` salvo que el contenido generado en el build tenga su
// misma huella: entonces conserva el DOM (sin repintar ni mover el LCP). La
// marca se retira en ambos casos. Devuelve true si se conservó.
export function applyPrerenderedHtml(el, html) {
  const keep = el.dataset.prerendered === htmlFingerprint(html);
  delete el.dataset.prerendered;
  if (!keep) el.innerHTML = html;
  return keep;
}
