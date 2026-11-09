// Portada de resultados pintada en el servidor con el HTML y las lecturas del navegador
// (js/resultados-feed-html.js, js/services/result-feed-entries.js). Depende de la hora:
// se vuelve a pintar cada minuto y solo se publica si cambia.
//
// La página lleva la vista inicial y, en plantillas, las demás vistas: cambiar de pestaña
// no espera a la red. «Cargar más» lee los días de archivos por mes.
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clienteEstatico } from './cliente/cliente-estatico.js';
import { RESERVA_ANDROID } from './familia-portada.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const hoyLocal = (ahora = new Date()) => `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
const CX_VENTANA = 14;
const sumarDias = (clave, dias) => { const d = new Date(`${clave}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const mesDe = clave => clave.slice(0, 7);
const finDeMes = mes => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const firma = valor => createHash('sha1').update(JSON.stringify(valor)).digest('hex');
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function meses(desde, hasta) {
  const salida = [];
  let [a, m] = desde.split('-').map(Number);
  const [fa, fm] = hasta.split('-').map(Number);
  while (a < fa || (a === fa && m <= fm)) {
    salida.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { a++; m = 1; }
  }
  return salida;
}

// Último día con resultados hasta `hoy` (incluido); sin ninguno, `hoy`.
function ultimoDia(entradas, hoy) {
  let ultimo = '';
  for (const { date } of entradas) if (date && date <= hoy && date > ultimo) ultimo = date;
  return ultimo || hoy;
}

export async function crearFamiliaResultados({ lang, headerHtml, pie, huella }) {
  const { supabase } = await load('js/shared.js');
  const { fetchResultEntries } = await load('js/services/result-feed-entries.js');
  const H = await load('js/resultados-feed-html.js');
  const { cyclocrossHome } = await load('js/services/today-season.js');
  const { RESULTS_SEASON_START, initialResultsFromKey } = await load('js/services/result-feed-pagination.js');
  const { cxResultEntries } = await load('js/cx/results-feed.js');
  const { cxSeason } = await load('js/cx/presentation.js');
  const { cxListedInAgenda, cxTournamentRounds } = await load('js/services/cx-data.js');

  const isEn = lang === 'en';
  const locale = isEn ? 'en-GB' : 'es-ES';
  const base = isEn ? 'en/results' : 'resultados';
  const clave = `resultados-${lang}/feed`;
  // Entradas por mes: solo se recalculan los meses con clasificaciones o jornadas cambiadas.
  const porMes = new Map();

  async function entradasDe(datos, mes, hoy) {
    const sinFecha = datos.race_uci_stages.filter(fila => !fila.stageDate);
    const prefijo = `${mes}-`;
    const huellaMes = firma([
      datos.race_uci_stages.filter(fila => fila.stageDate?.startsWith(prefijo)),
      datos.race_days.filter(fila => fila.dateKey?.startsWith(prefijo)),
      sinFecha, datos.featured.filter(fila => fila.dateKey?.startsWith(prefijo)),
    ]);
    const previo = porMes.get(mes);
    if (previo?.huella === huellaMes) return previo.entradas;
    const fin = finDeMes(mes);
    const { entries } = await fetchResultEntries(`${mes}-01`, fin < hoy ? fin : hoy, isEn);
    porMes.set(mes, { huella: huellaMes, entradas: entries });
    return entries;
  }

  return async function componerResultados(item, activos) {
    const { feed, portada } = item.input;
    const hoy = hoyLocal();
    const original = { from: supabase.from, rpc: supabase.rpc };
    const cliente = clienteEstatico(async () => feed);
    supabase.from = cliente.from;
    supabase.rpc = cliente.rpc;
    const mesesFeed = meses(RESULTS_SEASON_START, hoy);
    const entradasPorMes = new Map();
    try {
      for (const mes of mesesFeed) entradasPorMes.set(mes, await entradasDe(feed, mes, hoy));
    } finally {
      supabase.from = original.from;
      supabase.rpc = original.rpc;
    }

    // Carretera: ventana inicial y, por mes, los días para «Cargar más». La
    // ventana cuenta 14 días desde el último día con resultados (como mucho,
    // hoy): un periodo sin carreras no deja la portada vacía.
    const todas = mesesFeed.toReversed().flatMap(mes => entradasPorMes.get(mes));
    const desde = initialResultsFromKey(ultimoDia(todas, hoy));
    const recientes = todas.filter(entrada => entrada.date >= desde);
    const hayMas = desde > RESULTS_SEASON_START;
    const panelLatest = (recientes.length ? H.feedDaysHtml(recientes, isEn, locale) : H.feedEmptyHtml(isEn))
      + (hayMas ? H.feedMoreHtml('feedMoreBtn', isEn) : '');

    // Ciclocross: la temporada en curso, leída como la agenda.
    const temporada = cxSeason();
    const destacadas = new Set(portada.featured.map(fila => fila.cxRaceId));
    const filasCx = portada.agenda.filter(race => race.seasonKey === temporada && cxListedInAgenda(race, lang)).map(race => ({ ...race, featured: destacadas.has(race.id) }));
    const rondas = cxTournamentRounds(portada.rondas.filter(race => race.seasonKey === temporada), temporada);
    const entradasCx = cxResultEntries(filasCx);
    const cxTab = cyclocrossHome(hoy);
    const cxDesde = sumarDias(ultimoDia(entradasCx, hoy), -(CX_VENTANA - 1));
    const visiblesCx = entradasCx.filter(entrada => entrada.date >= cxDesde);
    const panelCx = (visiblesCx.length ? H.cxDaysHtml(visiblesCx, rondas, isEn, locale) : H.cxEmptyHtml(entradasCx.length > 0, isEn))
      + (entradasCx.some(entrada => entrada.date < cxDesde) ? H.feedMoreHtml('cxMoreBtn', isEn) : '');

    const vistas = H.feedViews(cxTab);
    const inicial = vistas[0];
    const panelInicial = inicial === 'cx' ? panelCx : panelLatest;
    const pestañas = activa => H.feedTabsHtml({ cxTab, activeView: activa, pinned: false, isEn });
    const plantillas = [
      ...vistas.flatMap(vista => [false, true].map(fijada =>
        `<template data-pestanas="${vista}-${fijada ? 1 : 0}">${H.feedTabsHtml({ cxTab, activeView: vista, pinned: fijada, isEn })}</template>`)),
      ...(inicial === 'cx' ? [`<template data-panel="latest">${panelLatest}</template>`] : []),
    ].join('');
    // El ránking pesa más que el resto de la página: va aparte y se trae sin esperar a usarlo.
    const ranking = ['male', 'female'].map(genero => `<template data-panel="ranking-${genero}">${H.rankingBodyHtml(feed.uci_team_rankings, genero, isEn)}</template>`).join('');

    const contenido = `${H.feedHeroHtml(pestañas(inicial), isEn)}\n      <div id="resultsFeedPanel" data-view="${inicial}">${panelInicial}</div>`;
    const version = huella(contenido + plantillas + ranking);

    const archivos = { [`f/resultados-${lang}/ranking.html`]: ranking };
    for (const mes of mesesFeed) {
      const dias = new Map();
      for (const entrada of entradasPorMes.get(mes)) (dias.get(entrada.date) || dias.set(entrada.date, []).get(entrada.date)).push(entrada);
      archivos[`f/resultados-${lang}/dias/${mes}.html`] = [...dias].map(([dia, filas]) => `<template data-dk="${dia}">${H.feedDaysHtml(filas, isEn, locale)}</template>`).join('');
    }
    if (cxTab) {
      const dias = new Map();
      for (const entrada of entradasCx) (dias.get(entrada.date) || dias.set(entrada.date, []).get(entrada.date)).push(entrada);
      const porMesCx = new Map();
      for (const [dia, filas] of dias) {
        const mes = mesDe(dia);
        porMesCx.set(mes, `${porMesCx.get(mes) || ''}<template data-dk="${dia}">${H.cxDaysHtml(filas, rondas, isEn, locale)}</template>`);
      }
      for (const [mes, html] of porMesCx) archivos[`f/resultados-${lang}/cx/${mes}.html`] = html;
    }

    const shell = activos.resultados.paginas[lang];
    const head = shell.head.replace('</head>', `<style>#resultsContent[data-fijada] #resultsFeedPanel{visibility:hidden}@media(min-width:761px){#resultsContent:not([data-colocado]) #resultsFeedPanel{visibility:hidden}}</style><noscript><style>#resultsContent #resultsFeedPanel{visibility:visible!important}</style></noscript><meta name="cc:clave" content="${clave}"><meta name="cc:v" content="${version}"></head>`);
    const cabecera = `<header class="site-header" id="siteHeader">${headerHtml({ lang, hasBack: false, active: 'results' })}</header>`;
    const atributos = `id="resultsContent" data-publicada="${version}" data-hoy="${hoy}" data-lang="${lang}"`
      + ` data-desde="${desde}" data-cx-desde="${cxDesde}" data-cx-primera="${attr(entradasCx.at(-1)?.date || '')}"`
      + ` data-mas="${attr(isEn ? 'Load more results' : 'Cargar más resultados')}" data-cargando="${attr(isEn ? 'Loading…' : 'Cargando…')}"`
      + ` data-error="${attr(isEn ? 'Unable to load more results. Try again.' : 'No se pudieron cargar más resultados. Inténtalo de nuevo.')}"`;
    const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${cabecera}\n<main ${atributos}>${contenido}<script>${activos.resultados.prePintado}</script></main>\n`
      + `${plantillas}<script>ccMontarFijada()</script>\n${pie()}\n<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.resultados.isla}"></script>\n</body>\n</html>\n`;
    return { slug: 'feed', clave, version, pagina, raceId: null, dayId: 'feed', fragmento: null, datos: null, ruta: base, archivos, filas: recientes.length, filasCx: visiblesCx.length };
  };
}
