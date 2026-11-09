// Isla de las páginas de resultados por carrera: el HTML ya está completo. Cambia de
// clasificación con un archivo publicado, filtra por equipo sobre el DOM, monta el perfil al
// verlo y comprueba la versión mientras la carrera está en curso. Sin lecturas de Supabase.
import { applyTeamFilter, bindTttGroups } from '../../../js/results/team-filter.js';
import { limitScrollToStickyStart } from '../../../js/results/dom.js';
import { installScrollRail } from '../../../js/scroll-rail.js';
import { patchHtml } from '../../../js/dom-patch.js';
import { cabeceraFija, seguirVersion, visorDocumentos, volver, vistaDePagina } from './comun.js';

const main = document.getElementById('resultsContent');
const isEn = main.dataset.lang === 'en';
const clave = document.querySelector('meta[name="cc:clave"]').content;
let filtroEquipo = '';

cabeceraFija();
visorDocumentos();
// Vuelta: a la página de procedencia de otro apartado o al índice de resultados.
volver(isEn ? '/en/results/' : '/resultados/', isEn ? 'All results' : 'Todos los resultados');

function montarInterfaz() {
  main.querySelectorAll('.res-tabs__scroll, #resStages').forEach(shell => installScrollRail(shell));
  const tabla = document.getElementById('resTableWrap');
  if (tabla) bindTttGroups(tabla);
}
montarInterfaz();

const aplicarFiltro = () => {
  const tabla = document.getElementById('resTableWrap');
  if (!tabla) return;
  applyTeamFilter(tabla, filtroEquipo, { isEn, onClear: () => {
    filtroEquipo = '';
    const selector = document.getElementById('resTeamFilter');
    if (selector) selector.value = '';
    aplicarFiltro();
  } });
};
document.getElementById('resTeamFilterSlot')?.addEventListener('change', evento => {
  const selector = evento.target.closest('#resTeamFilter');
  if (!selector) return;
  filtroEquipo = selector.value;
  aplicarFiltro();
});

// Clasificaciones de la página.
let clases = null;
function cargarClases() {
  if (!main.dataset.clases) return Promise.resolve(null);
  clases ||= fetch(main.dataset.clases, { cache: 'no-cache' }).then(respuesta => {
    if (!respuesta.ok) throw new Error(`Clasificaciones: ${respuesta.status}`);
    return respuesta.text();
  }).then(html => {
    const caja = document.createElement('template');
    caja.innerHTML = html;
    return caja;
  }).catch(error => { clases = null; throw error; });
  return clases;
}
const huecoHtml = (plantilla, nombre) => plantilla.content.querySelector(`template[data-hueco="${nombre}"]`)?.innerHTML ?? '';
const inicial = {};
for (const [nombre, id] of [['status', 'resStatusSlot'], ['filter', 'resTeamFilterSlot'], ['publication', 'resPublication'], ['table', 'resTableWrap']]) inicial[nombre] = document.getElementById(id)?.innerHTML ?? '';
const claseInicial = main.querySelector('#resTabs .res-tab--active')?.dataset.class ?? null;

function pintarHuecos(partes) {
  const poner = (id, html) => { const nodo = document.getElementById(id); if (nodo) nodo.innerHTML = html; };
  poner('resStatusSlot', partes.status);
  poner('resTeamFilterSlot', partes.filter);
  poner('resPublication', partes.publication);
  poner('resTableWrap', partes.table);
  const selector = document.getElementById('resTeamFilter');
  if (selector && filtroEquipo) {
    if (![...selector.options].some(opcion => opcion.value === filtroEquipo)) selector.add(new Option(filtroEquipo, filtroEquipo));
    selector.value = filtroEquipo;
  }
  aplicarFiltro();
}

async function mostrarClase(tipo) {
  const barra = main.querySelector('.res-tabs-bar');
  let partes = tipo === claseInicial ? inicial : null;
  if (!partes) {
    const caja = await cargarClases();
    const plantilla = caja?.content.querySelector(`template[data-clase="${CSS.escape(tipo)}"]`);
    if (!plantilla) return false;
    partes = { status: huecoHtml(plantilla, 'status'), filter: huecoHtml(plantilla, 'filter'), publication: huecoHtml(plantilla, 'publication'), table: huecoHtml(plantilla, 'table') };
  }
  main.querySelectorAll('#resTabs .res-tab').forEach(boton => {
    const activa = boton.dataset.class === tipo;
    boton.classList.toggle('res-tab--active', activa);
    boton.setAttribute('aria-pressed', String(activa));
    if (activa) boton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  pintarHuecos(partes);
  limitScrollToStickyStart(barra);
  return true;
}

main.querySelector('#resTabs')?.addEventListener('click', evento => {
  const boton = evento.target.closest('[data-class]');
  if (!boton) return;
  history.replaceState(null, '', `${location.pathname}#${boton.dataset.class}`);
  mostrarClase(boton.dataset.class);
});
const pedida = location.hash.slice(1);
if (pedida && pedida !== claseInicial && main.querySelector(`#resTabs [data-class="${CSS.escape(pedida)}"]`)) mostrarClase(pedida);

// Perfil: se monta al acercarse a la pantalla, con los datos publicados de la jornada.
const perfil = document.getElementById('resProfile');
if (perfil && main.dataset.perfil) {
  const observador = new IntersectionObserver(entradas => {
    if (!entradas.some(entrada => entrada.isIntersecting)) return;
    observador.disconnect();
    Promise.all([import('./perfil-carrera.js'), fetch(main.dataset.perfil, { cache: 'no-cache' }).then(respuesta => respuesta.json())])
      .then(([{ montar }, datos]) => montar(perfil, datos))
      .catch(error => console.error('[resultados] perfil', error));
  }, { rootMargin: '400px' });
  observador.observe(perfil);
}

// Versión nueva, mientras la carrera está en curso: página y clasificaciones.
seguirVersion(clave, () => main.dataset.sondeo === '1', async documento => {
  const nuevo = documento.getElementById('resultsContent');
  const tipo = main.querySelector('#resTabs .res-tab--active')?.dataset.class ?? null;
  patchHtml(main, nuevo.innerHTML);
  for (const atributo of ['clases', 'sondeo', 'perfil']) main.dataset[atributo] = nuevo.dataset[atributo] ?? '';
  clases = null;
  for (const [nombre, id] of [['status', 'resStatusSlot'], ['filter', 'resTeamFilterSlot'], ['publication', 'resPublication'], ['table', 'resTableWrap']]) inicial[nombre] = document.getElementById(id)?.innerHTML ?? '';
  if (tipo && tipo !== (nuevo.querySelector('#resTabs .res-tab--active')?.dataset.class ?? null)) await mostrarClase(tipo);
  else aplicarFiltro();
});
vistaDePagina();
