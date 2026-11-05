// ─────────────────────────────────────────────────────────────────
//  Hueco de logotipo de carrera (sin DOM: lo usan los constructores de
//  página del prerender). Una carrera sin logo, o con un logo que no carga,
//  muestra la marca de la web apagada sobre el tinte del tema, del mismo
//  tamaño que tendría el logo: las filas y cabeceras no cambian de forma.
//  Estilo en css/app.css (.logo-ph).
// ─────────────────────────────────────────────────────────────────

// GIF transparente de 1 px: el <img> roto conserva su caja y su clase y el
// CSS pinta el hueco encima, sin el icono de imagen rota del navegador.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Atributo onerror de los <img> de logo.
export const LOGO_ONERROR = `onerror="this.onerror=null;this.src='${BLANK}';this.classList.add('logo-ph')"`;

// Hueco para una carrera sin logo; `cls` es la clase de tamaño del logo.
export function logoPlaceholderHtml(cls) {
  return `<span class="${cls} logo-ph" aria-hidden="true"></span>`;
}
