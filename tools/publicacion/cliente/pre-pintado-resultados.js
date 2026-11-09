// Antes del primer pintado: la colocación en dos columnas, que depende de la altura
// medida, y Carretera si está fijada, que se monta en cuanto llegan sus plantillas. Va en
// línea, tras el panel.
import { packCxDays, packFeaturedEntries } from '../../../js/resultados-feed-layout.js';

const panel = document.getElementById('resultsFeedPanel');
const raiz = document.getElementById('resultsContent');
try {
  if (panel.dataset.view === 'cx' && localStorage.getItem('cc_default_discipline') === 'road') raiz.dataset.fijada = '1';
} catch { /* Almacenamiento no disponible. */ }
const colocar = () => {
  packFeaturedEntries(raiz);
  packCxDays(raiz);
  raiz.dataset.colocado = '';
};
if (!raiz.dataset.fijada) colocar();
window.ccMontarFijada = () => {
  if (!raiz.dataset.fijada) return;
  const inicial = document.createElement('template');
  inicial.dataset.panel = panel.dataset.view;
  inicial.innerHTML = panel.innerHTML;
  document.body.append(inicial);
  panel.replaceChildren(document.querySelector('template[data-panel="latest"]').content.cloneNode(true));
  panel.dataset.view = 'latest';
  raiz.querySelector('.feed-hero > .feed-view-switch')?.replaceWith(document.querySelector('template[data-pestanas="latest-1"]').content.cloneNode(true));
  delete raiz.dataset.fijada;
  colocar();
};
