// Lo que comparten las islas de todas las páginas publicadas, sin dependencias de datos.
export function cabeceraFija() {
  const raiz = document.documentElement;
  const cabecera = document.getElementById('siteHeader');
  new ResizeObserver(() => {
    const fija = getComputedStyle(cabecera).position === 'sticky';
    raiz.style.setProperty('--site-header-h', `${fija ? cabecera.getBoundingClientRect().height : 0}px`);
  }).observe(cabecera);
  document.getElementById('navAppsBtn')?.addEventListener('click', evento => window.openAppsModal?.(evento));
}

/** Flecha de volver: a la página de procedencia en este sitio o a `destino`. */
export function volver(destino, etiqueta = null) {
  const boton = document.getElementById('backBtn');
  if (!boton) return;
  let procedencia = '';
  try {
    const url = new URL(document.referrer, location.href);
    if (document.referrer && url.origin === location.origin && url.pathname !== location.pathname) procedencia = document.referrer;
  } catch { /* Sin referente válido. */ }
  if (procedencia) {
    boton.href = procedencia;
    boton.addEventListener('click', evento => { evento.preventDefault(); history.back(); });
  } else if (destino) {
    boton.href = destino;
    if (etiqueta) boton.setAttribute('aria-label', etiqueta);
  }
}

/** Documentos propios (data-asset-viewer): en escritorio, el visor de js/shared.js al primer uso. */
export function visorDocumentos() {
  let cargado = false;
  document.addEventListener('click', evento => {
    const enlace = evento.target.closest?.('a[data-asset-viewer]');
    if (cargado || !enlace || innerWidth < 768 || evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    import('../../../js/shared.js').then(() => { cargado = true; enlace.click(); });
  });
}

/** Mientras `activo()`, comprueba la versión publicada y avisa con el documento nuevo. */
export function seguirVersion(clave, activo, alCambiar) {
  const meta = document.querySelector('meta[name="cc:v"]');
  let ocupado = false;
  const comprobar = async () => {
    if (document.hidden || ocupado || !activo()) return;
    ocupado = true;
    try {
      const respuesta = await fetch(`/v/${clave}.txt`, { cache: 'no-cache' });
      if (!respuesta.ok) return;
      const version = (await respuesta.text()).trim();
      if (version === meta.content) return;
      const pagina = await fetch(location.pathname, { cache: 'no-cache' });
      if (!pagina.ok) return;
      await alCambiar(new DOMParser().parseFromString(await pagina.text(), 'text/html'));
      meta.content = version;
    } catch { /* Sin red: se conserva lo visible hasta la siguiente comprobación. */ } finally {
      ocupado = false;
    }
  };
  setInterval(comprobar, 60_000);
  document.addEventListener('visibilitychange', comprobar);
}

/**
 * Versión de un archivo de datos leído: la de su v/<clave>.txt, los 12 primeros caracteres del SHA-1
 * (tools/publicacion/publicacion.mjs). Sin crypto.subtle queda sin calcular.
 */
export async function versionDe(bytes) {
  if (!crypto.subtle) return undefined;
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return Array.from(resumen, octeto => octeto.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** Al terminar de cargar y quedar libre la página. */
export function alReposar(accion) {
  const lanzar = () => (window.requestIdleCallback || (hecho => setTimeout(hecho, 300)))(accion, { timeout: 2000 });
  if (document.readyState === 'complete') lanzar();
  else addEventListener('load', lanzar, { once: true });
}

export function vistaDePagina() {
  if (window.gtag) window.gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
}
