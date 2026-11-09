// Isla del calendario: la lista ya está completa y las filas ya llevan sus enlaces. Aquí
// solo lo que no necesita datos: mes, grupos, modal y avisos. Al primer filtro, otro año o
// la vista Mes se carga el JS completo con los datos de la temporada.
import { initPhTooltip } from '../../../js/ph-tooltip.js';

const raiz = document.documentElement;
const cabecera = document.getElementById('siteHeader');
new ResizeObserver(() => {
  const fija = getComputedStyle(cabecera).position === 'sticky';
  raiz.style.setProperty('--site-header-h', `${fija ? cabecera.getBoundingClientRect().height : 0}px`);
}).observe(cabecera);
document.getElementById('navAppsBtn')?.addEventListener('click', event => window.openAppsModal?.(event));
initPhTooltip();

const lista = document.getElementById('temporadaContent');
const filtros = document.getElementById('temporadaFilters');
const anio = lista.dataset.anio;
let completo = null;
let cargadoCompleto = false;

function cargarCompleto() {
  if (completo) return completo;
  const lista_ = new Promise(listo => addEventListener('cc-temporada-lista', listo, { once: true }));
  completo = import('./calendario-completo.js').then(() => lista_).then(() => { cargadoCompleto = true; });
  return completo;
}

// El primer uso se repite cuando el JS completo ya escucha.
function alPrimerUso(nodo, tipo, repetir) {
  nodo?.addEventListener(tipo, evento => {
    if (cargadoCompleto) return;
    repetir(evento);
  });
}
const botonesCategoria = filtros.querySelectorAll('#filterCats .tcat-btn');
for (const boton of botonesCategoria) {
  alPrimerUso(boton, 'click', evento => {
    evento.preventDefault();
    for (const otro of botonesCategoria) {
      otro.classList.toggle('tcat-btn--active', otro === boton);
      otro.setAttribute('aria-pressed', String(otro === boton));
    }
    cargarCompleto().then(() => { cargadoCompleto = true; boton.click(); });
  });
}
for (const id of ['filterYear', 'filterCountry']) {
  const selector = document.getElementById(id);
  alPrimerUso(selector, 'change', () => {
    const valor = selector.value;
    cargarCompleto().then(() => {
      selector.value = valor;
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
for (const boton of document.querySelectorAll('[data-cal-switch]')) {
  alPrimerUso(boton, 'click', () => { cargarCompleto().then(() => boton.click()); });
}

// Mes: lleva al bloque, como js/temporada.js.
document.getElementById('filterMonth').addEventListener('change', function () {
  if (cargadoCompleto || !this.value) return;
  const bloque = document.getElementById(`mes-${anio}-${this.value}`);
  if (bloque) {
    const top = bloque.getBoundingClientRect().top + scrollY - cabecera.offsetHeight - filtros.offsetHeight - 8;
    scrollTo({ top, behavior: 'smooth' });
  }
  this.value = '';
});

lista.addEventListener('click', evento => {
  const objetivo = evento.target;
  const modal = objetivo.closest('.t-race--modal');
  if (modal) {
    const id = modal.dataset.rdid;
    Promise.all([import('../../../js/race-data-modal.js'), fetch(`/d/modal/${id}.json`, { cache: 'no-cache' }).then(respuesta => respuesta.json())]).then(([{ openRaceDataModal }, datos]) => {
      globalThis.__ccDatosEstaticos = datos;
      openRaceDataModal(id, datos.races[0]);
    });
    return;
  }
  if (cargadoCompleto) return;
  const grupo = objetivo.closest('.t-race--challenge');
  if (grupo) {
    const abierto = grupo.getAttribute('aria-expanded') !== 'true';
    grupo.setAttribute('aria-expanded', String(abierto));
    document.getElementById(grupo.getAttribute('aria-controls')).hidden = !abierto;
    return;
  }
  if (objetivo.closest('.t-race')) {
    try {
      sessionStorage.setItem('cc_nav', JSON.stringify({
        from: 'temporada', year: Number(anio), cat: 'all', scrollY: Math.round(scrollY),
        expanded: [...lista.querySelectorAll('.t-race--challenge[aria-expanded="true"]')].map(nodo => nodo.dataset.cgid),
      }));
    } catch { /* Sin almacenamiento. */ }
  }
});

// Lo que no coincide con la versión publicada se pinta ya.
if (lista.dataset.pendiente != null) cargarCompleto();
if (window.gtag) window.gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
