// Isla de perfil, mapa y orden de salida: el HTML ya está completo. El gráfico y el mapa se
// montan con los datos publicados de la página; sin lecturas de Supabase.
import { patchHtml } from '../../../js/dom-patch.js';
import { cabeceraFija, seguirVersion, visorDocumentos, volver, vistaDePagina } from './comun.js';

cabeceraFija();
visorDocumentos();
const main = document.querySelector('main[data-clave]');
const { tipo, clave } = main.dataset;
const datosPagina = () => (datos ||= fetch(`/d/${clave}.json`, { cache: 'no-cache' }).then(respuesta => respuesta.json()));
let datos = null;

// Perfil y mapa vuelven siempre a su jornada; el orden de salida, a la página de procedencia.
if (tipo === 'orden') volver(main.dataset.volver);
else {
  const boton = document.getElementById('backBtn');
  if (boton) boton.href = main.dataset.volver;
}

function montar() {
  if (main.dataset.aviso === '1') return;
  if (tipo === 'perfil') {
    const host = document.getElementById('pfeProfile');
    if (host) Promise.all([import('./perfil-carrera.js'), datosPagina()]).then(([{ montar: dibujar }, pagina]) => dibujar(host, pagina, { points: true, conZona: true }));
  } else if (tipo === 'mapa') {
    const host = document.getElementById('ccRouteMapWrap');
    if (host) Promise.all([import('./mapa.js'), datosPagina()]).then(([{ montar: dibujar }, pagina]) => dibujar(host, pagina));
  } else {
    const host = document.getElementById('soProfile');
    if (!host) return;
    const observador = new IntersectionObserver(entradas => {
      if (!entradas.some(entrada => entrada.isIntersecting)) return;
      observador.disconnect();
      Promise.all([import('./perfil-carrera.js'), datosPagina()]).then(([{ montar: dibujar }, pagina]) => dibujar(host, pagina, { hidePointNames: true }));
    }, { rootMargin: '400px' });
    observador.observe(host);
  }
}
montar();

// Filtros del orden de salida.
main.addEventListener('click', evento => {
  const boton = evento.target.closest('#soFilters .tcat-btn');
  if (!boton) return;
  for (const otro of main.querySelectorAll('#soFilters .tcat-btn')) {
    const activo = otro === boton;
    otro.classList.toggle('tcat-btn--active', activo);
    otro.setAttribute('aria-pressed', String(activo));
  }
  const tabla = main.querySelector('.so-table-wrap');
  tabla.classList.remove('so-filter--tt', 'so-filter--gc');
  if (boton.dataset.filter !== 'all') tabla.classList.add(`so-filter--${boton.dataset.filter}`);
});

// Pestaña abierta: una versión nueva se aplica sobre lo que hay y se vuelve a montar lo interactivo.
seguirVersion(clave, () => true, nuevo => {
  const nuevoMain = nuevo.querySelector('main[data-clave]');
  datos = null;
  patchHtml(main, nuevoMain.innerHTML);
  montar();
});
vistaDePagina();
