// ─────────────────────────────────────────────────────────────────
//  Hueco de logotipo de carrera (sin DOM: lo usan también los constructores
//  del publicador). Una carrera sin logo, o con un logo que no carga, muestra
//  la marca de la cabecera en gris tenue sobre el relleno neutro, del mismo
//  tamaño que el logo: filas y cabeceras no cambian de forma. Nunca en los
//  Campeonatos Nacionales. Concepto de Alejandro Monteagudo con la estética
//  actual; estilo en css/app.css (.logo-ph). Apps: LogoPlaceholder.
// ─────────────────────────────────────────────────────────────────

// Atributo onerror de los <img> de logo: el <img> roto se sustituye por el
// hueco con sus mismas clases de tamaño.
export const LOGO_ONERROR = `onerror="this.onerror=null;var s=document.createElement('span');s.className=this.className+' logo-ph';s.setAttribute('aria-hidden','true');this.replaceWith(s)"`;

// Hueco para una carrera sin logo; `cls` es la clase de tamaño del logo.
export function logoPlaceholderHtml(cls) {
  return `<span class="${cls} logo-ph" aria-hidden="true"></span>`;
}
