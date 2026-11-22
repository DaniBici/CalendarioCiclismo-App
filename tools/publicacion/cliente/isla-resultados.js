// Isla de la portada de resultados: el HTML ya está completo. Cambia de vista con las
// plantillas de la página, trae días anteriores de los archivos por mes y comprueba si
// hay una versión nueva. Sin lecturas de Supabase.
import { bindRankingRows, packCxDays, packFeaturedEntries } from '../../../js/resultados-feed-layout.js';
import { RESULTS_SEASON_START, previousResultsWindow } from '../../../js/services/result-feed-pagination.js';
import { roadPinned, setRoadPinned } from '../../../js/services/today-season.js';
import { patchHtml } from '../../../js/dom-patch.js';
import { initI18n } from '../../../js/i18n.js';
import { bindFilterMenu } from '../../../js/components/filter-menu.js';
import { bindMenuButtons } from '../../../js/components/menu-button.js';
import { scheduleResultsTip } from '../../../js/components/today-tip.js';
import { ROAD_FILTER_GROUPS, ROAD_FILTERS_KEY, CX_FILTERS_KEY, cxFilterGroups, loadRoadFilters, loadCxFilters, filterLabels } from '../../../js/race-filters.js';
import { aplicarFiltros } from './filtros-resultados.js';

const COMPROBACION_MS = 60_000;
const CX_VENTANA = 14;
const sumarDias = (clave, dias) => { const d = new Date(`${clave}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };

const raiz = document.documentElement;
const cabecera = document.getElementById('siteHeader');
new ResizeObserver(() => {
  const fija = getComputedStyle(cabecera).position === 'sticky';
  raiz.style.setProperty('--site-header-h', `${fija ? cabecera.getBoundingClientRect().height : 0}px`);
}).observe(cabecera);
document.getElementById('navAppsBtn')?.addEventListener('click', event => window.openAppsModal?.(event));

const main = document.getElementById('resultsContent');
const panel = document.getElementById('resultsFeedPanel');
const clave = document.querySelector('meta[name="cc:clave"]').content;
const metaVersion = document.querySelector('meta[name="cc:v"]');
const lang = main.dataset.lang;

let vista = panel.dataset.view;
let genero = 'male';
let desde = main.dataset.desde;
let cxDesde = main.dataset.cxDesde;
// Lo pintado de cada vista al salir de ella: conserva los días ya cargados.
const guardadas = new Map();
const archivos = new Map();

// El ránking se trae aparte: sin esperar a usarlo, para que cambiar de pestaña sea inmediato.
let ranking = null;
function cargarRanking() {
  ranking ||= fetch(`/f/resultados-${lang}/ranking.html`, { cache: 'no-cache' }).then(respuesta => {
    if (!respuesta.ok) throw new Error(`Ránking: ${respuesta.status}`);
    return respuesta.text();
  }).then(html => {
    document.querySelectorAll('template[data-panel^="ranking-"]').forEach(nodo => nodo.remove());
    document.querySelector('.site-footer').insertAdjacentHTML('beforebegin', html);
  }).catch(error => { ranking = null; throw error; });
  return ranking;
}
const alReposar = window.requestIdleCallback || (hecho => setTimeout(hecho, 1500));
addEventListener('load', () => alReposar(() => cargarRanking().catch(() => {})), { once: true });

const plantilla = selector => document.querySelector(`template[${selector}]`);
const panelDe = nombre => plantilla(`data-panel="${nombre}"`)?.content.cloneNode(true) ?? null;

function colocar() {
  aplicarFiltros(main, panel, vista);
  if (vista === 'latest') packFeaturedEntries(main);
  else if (vista === 'cx') packCxDays(main);
}

function pintarPestanas() {
  const actual = main.querySelector('.feed-hero > .feed-view-switch, .feed-hero > .feed-view-tabs');
  const nueva = plantilla(`data-pestanas="${vista}-${roadPinned() ? 1 : 0}"`);
  if (actual && nueva) actual.replaceWith(nueva.content.cloneNode(true));
}

function mostrar(nombre) {
  if (nombre === vista) return;
  const fragmento = document.createDocumentFragment();
  fragmento.append(...panel.childNodes);
  guardadas.set(vista, fragmento);
  vista = nombre;
  panel.dataset.view = nombre;
  pintarPestanas();
  aplicarFiltros(main, panel, nombre);
  if (nombre === 'ranking') {
    // Lo anterior sigue a la vista si el ránking aún no ha llegado.
    panel.append(fragmento.cloneNode(true));
    cargarRanking().then(() => {
      if (vista !== 'ranking') return;
      panel.replaceChildren(panelDe(`ranking-${genero}`));
      bindRankingRows(panel);
    }).catch(() => {});
    return;
  }
  panel.replaceChildren(guardadas.get(nombre) ?? panelDe(nombre) ?? '');
  colocar();
}

// Días de `carpeta` entre dos fechas, del más reciente al más antiguo.
async function diasEntre(carpeta, inicio, fin) {
  const claves = [];
  for (let mes = fin.slice(0, 7); mes >= inicio.slice(0, 7);) {
    claves.push(mes);
    const [a, m] = mes.split('-').map(Number);
    mes = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  }
  const dias = [];
  for (const mes of claves) {
    const ruta = `/f/resultados-${lang}/${carpeta}/${mes}.html`;
    if (!archivos.has(ruta)) {
      const respuesta = await fetch(ruta, { cache: 'no-cache' });
      if (!respuesta.ok && respuesta.status !== 404) throw new Error(`${ruta}: ${respuesta.status}`);
      const contenedor = document.createElement('template');
      contenedor.innerHTML = respuesta.ok ? await respuesta.text() : '';
      archivos.set(ruta, contenedor);
    }
    for (const dia of archivos.get(ruta).content.querySelectorAll('template[data-dk]')) {
      if (dia.dataset.dk >= inicio && dia.dataset.dk <= fin) dias.push(dia);
    }
  }
  return dias.sort((a, b) => b.dataset.dk.localeCompare(a.dataset.dk));
}

// Días leídos de los archivos por mes. El panel puede traer ya, de reserva, días de ese tramo con
// solo algunas filas (las de otros filtros): se sustituyen por el día completo, en su sitio.
function insertarDias(boton, dias) {
  const envoltura = boton.closest('.feed-more-wrap');
  for (const dia of dias) {
    const dk = dia.dataset.dk;
    panel.querySelectorAll(`.feed-day[data-dk="${dk}"]`).forEach(nodo => nodo.remove());
    const contenido = dia.content.cloneNode(true);
    for (const bloque of contenido.querySelectorAll('.feed-day')) bloque.dataset.anterior = '';
    const anterior = [...panel.querySelectorAll(':scope > .feed-day[data-dk]')].find(nodo => nodo.dataset.dk < dk);
    (anterior || envoltura).before(contenido);
  }
}

async function cargarMas(boton, siguiente) {
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  boton.textContent = main.dataset.cargando;
  const envoltura = boton.closest('.feed-more-wrap');
  envoltura.querySelector('.res-update-note')?.remove();
  try {
    await siguiente();
  } catch (error) {
    console.error('[resultados] cargar más', error);
    const nota = document.createElement('div');
    nota.className = 'res-update-note';
    nota.setAttribute('role', 'status');
    nota.textContent = main.dataset.error;
    envoltura.append(nota);
  } finally {
    boton.disabled = false;
    boton.setAttribute('aria-busy', 'false');
    boton.textContent = main.dataset.mas;
  }
}

// «Cargar más» sigue desde el inicio de lo que se ve, que con filtros puede ser anterior a la
// ventana (al menos 15 días con resultados; cliente/filtros-resultados.js).
const masCarretera = boton => cargarMas(boton, async () => {
  const tramo = previousResultsWindow(main.dataset.inicio || desde);
  if (!tramo) return;
  insertarDias(boton, await diasEntre('dias', tramo.fromKey, tramo.toKey));
  desde = tramo.fromKey;
  main.dataset.desde = desde;
  if (desde <= RESULTS_SEASON_START) boton.closest('.feed-more-wrap').remove();
  colocar();
});

const masCiclocross = boton => cargarMas(boton, async () => {
  const visible = main.dataset.cxInicio || cxDesde;
  const inicio = sumarDias(visible, -CX_VENTANA);
  const dias = await diasEntre('cx', inicio, sumarDias(visible, -1));
  if (dias.length) panel.querySelector(':scope > .startlist-empty')?.remove();
  insertarDias(boton, dias);
  cxDesde = inicio;
  main.dataset.cxDesde = cxDesde;
  if (cxDesde <= main.dataset.cxPrimera) boton.closest('.feed-more-wrap').remove();
  colocar();
});

main.addEventListener('click', evento => {
  const objetivo = evento.target;
  if (objetivo.closest('button.discipline-switch__pin')) {
    setRoadPinned(!roadPinned());
    pintarPestanas();
    (main.querySelector('button.discipline-switch__pin') || main.querySelector('[data-results-view="latest"]'))?.focus();
    return;
  }
  const pestana = objetivo.closest('[data-results-view]');
  if (pestana) { mostrar(pestana.dataset.resultsView); return; }
  const botonGenero = objetivo.closest('[data-ranking-gender]');
  if (botonGenero) {
    genero = botonGenero.dataset.rankingGender;
    panel.replaceChildren(panelDe(`ranking-${genero}`));
    bindRankingRows(panel);
    return;
  }
  const mas = objetivo.closest('#feedMoreBtn');
  if (mas) { masCarretera(mas); return; }
  const masCx = objetivo.closest('#cxMoreBtn');
  if (masCx) masCiclocross(masCx);
});

// Versión nueva: plantillas nuevas y la vista visible parcheada, con los días ya cargados.
let comprobando = false;
async function comprobar() {
  if (document.hidden || comprobando) return;
  comprobando = true;
  try {
    const respuesta = await fetch(`/v/${clave}.txt`, { cache: 'no-cache' });
    if (!respuesta.ok) return;
    const version = (await respuesta.text()).trim();
    if (version === metaVersion.content) return;
    const pagina = await fetch(location.pathname, { cache: 'no-cache' });
    if (!pagina.ok) return;
    ranking = null;
    await cargarRanking();
    const nuevo = new DOMParser().parseFromString(await pagina.text(), 'text/html');
    const nuevoMain = nuevo.getElementById('resultsContent');
    const nuevoPanel = nuevo.getElementById('resultsFeedPanel');
    const mismoDia = nuevoMain.dataset.hoy === main.dataset.hoy;
    document.querySelectorAll('template[data-panel]:not([data-panel^="ranking-"]),template[data-pestanas]').forEach(nodo => nodo.remove());
    const pie = document.querySelector('.site-footer');
    nuevo.querySelectorAll('template[data-panel],template[data-pestanas]').forEach(nodo => pie.before(document.adoptNode(nodo)));
    if (nuevoPanel.dataset.view !== vista) {
      const inicial = document.createElement('template');
      inicial.dataset.panel = nuevoPanel.dataset.view;
      inicial.innerHTML = nuevoPanel.innerHTML;
      pie.before(inicial);
    }
    // La vista inicial llega en el panel de la página; las demás, en sus plantillas.
    const contenidoDe = nombre => {
      if (nombre === nuevoPanel.dataset.view) return nuevoPanel.innerHTML;
      const fuente = plantilla(`data-panel="${nombre === 'ranking' ? `ranking-${genero}` : nombre}"`);
      if (!fuente) return '';
      const caja = document.createElement('div');
      caja.append(fuente.content.cloneNode(true));
      return caja.innerHTML;
    };
    const anterioresNodos = mismoDia ? [...panel.querySelectorAll(':scope > [data-anterior]')] : [];
    // Un día ya leído entero que el panel nuevo trae de reserva (solo con algunas filas) se queda
    // con la versión entera.
    const leidos = new Set(anterioresNodos.map(nodo => nodo.dataset.dk));
    const caja = document.createElement('template');
    caja.innerHTML = contenidoDe(vista);
    caja.content.querySelectorAll('.feed-day[data-dk]').forEach(nodo => { if (leidos.has(nodo.dataset.dk)) nodo.remove(); });
    const html = caja.innerHTML;
    const anteriores = anterioresNodos.map(nodo => nodo.outerHTML).join('');
    const corte = html.lastIndexOf('<div class="feed-more-wrap">');
    const conAnteriores = corte < 0 ? html + anteriores : html.slice(0, corte) + anteriores + html.slice(corte);
    guardadas.clear();
    patchHtml(panel, conAnteriores);
    // Días de reserva más antiguos que los ya leídos: cada día, en su sitio.
    const envoltura = panel.querySelector(':scope > .feed-more-wrap');
    [...panel.querySelectorAll(':scope > .feed-day[data-dk]')].sort((a, b) => b.dataset.dk.localeCompare(a.dataset.dk))
      .forEach(nodo => (envoltura ? envoltura.before(nodo) : panel.append(nodo)));
    if (!mismoDia) { desde = nuevoMain.dataset.desde; cxDesde = nuevoMain.dataset.cxDesde; }
    for (const atributo of ['publicada', 'hoy', 'desde', 'cxDesde', 'cxPrimera']) main.dataset[atributo] = nuevoMain.dataset[atributo];
    metaVersion.content = version;
    archivos.clear();
    if (vista === 'ranking') bindRankingRows(panel);
    colocar();
  } catch { /* Sin red: se conserva lo visible hasta la siguiente comprobación. */ } finally {
    comprobando = false;
  }
}

let marco = 0;
const recolocar = () => { cancelAnimationFrame(marco); marco = requestAnimationFrame(colocar); };
addEventListener('resize', recolocar);
document.fonts?.ready.then(recolocar);
setInterval(comprobar, COMPROBACION_MS);
document.addEventListener('visibilitychange', comprobar);
// «Filtros»: la selección de Hoy y Calendario, que el menú guarda; las filas se filtran
// leyéndola de nuevo (cliente/filtros-resultados.js). Las etiquetas en inglés esperan a su
// diccionario.
initI18n().then(() => {
  const cxGrupos = cxFilterGroups(lang);
  const menus = [
    { idPrefix: 'resultsRoadFilter', groups: ROAD_FILTER_GROUPS, storageKey: ROAD_FILTERS_KEY, filtros: loadRoadFilters() },
    { idPrefix: 'resultsCxFilter', groups: cxGrupos, storageKey: CX_FILTERS_KEY, filtros: loadCxFilters(cxGrupos) },
  ];
  bindMenuButtons();
  for (const menu of menus) {
    bindFilterMenu(main, {
      idPrefix: menu.idPrefix, groups: menu.groups, storageKey: menu.storageKey, activeClass: 'agenda-filter-btn--active',
      clearLabel: filterLabels().clearLabel, getFilters: () => menu.filtros, setFilters: filtros => { menu.filtros = filtros; }, patch: patchHtml,
      onChange: colocar,
    }).render();
  }
  // La chincheta de la 5.2.3 ya está convertida: la lista se pinta con su selección.
  panel.style.visibility = '';
  colocar();
  scheduleResultsTip(main.querySelector('.feed-filter-slot:not([hidden]) [data-menu-button]'));
});

if (window.gtag) window.gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
