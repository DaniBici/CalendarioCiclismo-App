// ─────────────────────────────────────────────────────────────────
//  HOME — index.html y en/index.html
//  Hoy de carretera (js/app.js) o, tras el cierre de la temporada de carretera
//  (services/today-season.js), la agenda de Ciclocross (js/ciclocross.js) en
//  la misma URL, salvo con Carretera fijada en el conmutador. Título,
//  canonical y texto estático de la home no cambian. Las URLs de días de
//  carretera (`?date=`) abren siempre Hoy.
// ─────────────────────────────────────────────────────────────────
import { cyclocrossLanding } from './services/today-season.js';

const now = new Date();
const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Hojas de la página de Ciclocross, cargadas antes de pintar la agenda. Con
// `new URL` el build les añade la versión del sitio (tools/site/version_assets.py).
const CX_STYLESHEETS = [
  new URL('../css/resultados.css', import.meta.url),
  new URL('../css/calendario.css', import.meta.url),
  new URL('../css/ciclocross.css', import.meta.url),
];

async function mountCyclocross() {
  await Promise.all(CX_STYLESHEETS.map(href => new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = link.onerror = resolve;
    document.head.append(link);
  })));
  document.querySelector('.hoy-sticky')?.remove();
  const list = document.getElementById('raceList');
  const main = document.createElement('main');
  main.id = 'cxAgendaContent';
  main.dataset.cxHome = '';
  // El texto estático de la home se conserva fuera del contenedor que se repinta.
  const prerender = list.querySelector('.static-prerender');
  main.append(...list.querySelectorAll('.loading'));
  list.replaceWith(main);
  if (prerender) main.after(prerender);
  await import('./ciclocross.js');
}

// La agenda sustituye a #raceList, el contenedor que vigila la pantalla de
// carga (js/page-loading.js): se le pasa el montaje, que termina con el primer
// día pintado (ciclocross.js resuelve tras su apertura).
if (cyclocrossLanding(todayKey) && !new URLSearchParams(location.search).has('date')) {
  const mounted = mountCyclocross();
  window.ccPageLoading?.waitFor(mounted);
  await mounted;
} else await import('./app.js');
