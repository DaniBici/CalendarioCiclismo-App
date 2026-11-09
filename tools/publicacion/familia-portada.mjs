// Portada y agenda de ciclocross pintadas en el servidor, con las funciones que usa
// js/ciclocross.js. Dependen de la hora: el HTML corresponde al día de la zona del
// proceso y se vuelve a pintar cada minuto. Solo se publica si cambia.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clienteEstatico } from './cliente/cliente-estatico.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const hoyLocal = (ahora = new Date()) => `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
export const RESERVA_ANDROID = '<script>!function(){try{if(/Android/i.test(navigator.userAgent)&&!localStorage.getItem(\'cc_android_banner_dismissed\'))document.documentElement.classList.add(\'cc-android-banner-pending\')}catch(e){}}()</script>';

/**
 * Cintillo de `ambitos` con el código de hoy sobre un elemento mínimo y los datos publicados: el
 * HTML es su primera entrada; el navegador lo monta después para rotar.
 */
export async function crearCintillo() {
  const { supabase } = await load('js/shared.js');
  const { initCintillo } = await load('js/cintillo.js');
  return async function cintillo(datos, ambitos) {
    const area = { innerHTML: '', addEventListener() {} };
    const flecha = { disabled: false, addEventListener() {} };
    const elemento = {
      hidden: true, html: '',
      set innerHTML(valor) { this.html = valor; },
      get innerHTML() { return this.html; },
      querySelector: selector => (selector === '.giro-text-area' ? area : flecha),
      addEventListener() {}, contains: () => false,
    };
    const documento = globalThis.document;
    const original = { getElementById: documento.getElementById, hidden: documento.hidden, from: supabase.from };
    documento.getElementById = id => (id === 'giroCountdown' ? elemento : null);
    documento.hidden = true;
    supabase.from = clienteEstatico(async () => datos).from;
    try {
      await initCintillo(ambitos);
    } finally {
      documento.getElementById = original.getElementById;
      documento.hidden = original.hidden;
      supabase.from = original.from;
    }
    if (elemento.hidden) return '';
    return elemento.html
      .replace('<div class="giro-text-area"></div>', `<div class="giro-text-area">${area.innerHTML}</div>`)
      .replace(/data-direction="prev"/, 'data-direction="prev" disabled');
  };
}

export async function crearFamiliaPortada({ lang, t, headerHtml, pie, huella }) {
  const { agendaDateHtml, filterBroadcastsByRegion } = await load('js/shared.js');
  const { getLocale } = await load('js/i18n.js');
  const { cxAgendaCardHtml } = await load('js/cx-agenda-html.js');
  const { cxEsc: esc, cxSortDayRaces, cxSeason } = await load('js/cx/presentation.js');
  const { cxClampDay, cxRaceDays, cxAdjacentRaceDay, cxStepDay, cxDateStrip } = await load('js/cx/today.js');
  const { cxListedInAgenda, cxTournamentRounds } = await load('js/services/cx-data.js');
  const { disciplineSwitchHtml } = await load('js/components/discipline-switch.js');
  const { cyclocrossHome } = await load('js/services/today-season.js');
  const { CX_HOME } = await load('js/header-html.js');
  const cintillo = await crearCintillo();

  const CATEGORIAS = ['all', 'big', 'pro', 'spain'];

  function boton({ kind, label, contenido = '', selected = false, isToday = false, visible = true, direction, disabled = false, dk = null }) {
    const clase = kind === 'arrow' ? 'date-week-arrow cc-scroll-arrow' : kind === 'today' ? `date-today-btn${visible ? ' date-today-btn--visible' : ''}` : `date-pill${selected ? ' active' : ''}${isToday ? ' is-today' : ''}`;
    const interior = kind === 'arrow' ? `<span aria-hidden="true">${direction === 'prev' ? '‹' : '›'}</span>` : contenido || esc(label);
    return `<button type="button" class="${clase}" aria-label="${esc(label)}"${kind === 'arrow' ? ` data-direction="${direction}"` : ''}${selected ? ' aria-current="date"' : ''}${disabled ? ' disabled' : ''}${dk ? ` data-dk="${dk}"` : ''}>${interior}</button>`;
  }

  function barraFechas(dia, dias, season, hoy) {
    const locale = getLocale();
    const hoyAgenda = cxClampDay(hoy, season);
    const largo = key => new Date(`${key}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    const pastillas = cxDateStrip(dia, season).map(key => {
      const fecha = new Date(`${key}T12:00:00`);
      let semana = fecha.toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '');
      semana = semana.charAt(0).toUpperCase() + semana.slice(1);
      return boton({ kind: 'pill', label: largo(key), selected: key === dia, isToday: key === hoy, dk: key,
        contenido: `<span class="date-pill__wd" aria-hidden="true">${esc(semana)}</span><span class="date-pill__num" aria-hidden="true">${fecha.toLocaleDateString(locale, { day: 'numeric' })}</span>` });
    }).join('');
    return `<div class="date-bar__left">${boton({ kind: 'arrow', direction: 'prev', label: t('today.prevDayLabel'), disabled: !cxStepDay(dias, dia, -1, season) })}${boton({ kind: 'today', visible: dia !== hoyAgenda, label: t('today.todayBtn') })}</div>`
      + `<div class="date-bar__pills-wrap"><div class="date-bar__pills">${pastillas}</div></div>`
      + `<div class="date-bar__right">${boton({ kind: 'arrow', direction: 'next', label: t('today.nextDayLabel'), disabled: !cxStepDay(dias, dia, 1, season) })}</div>`;
  }

  // Las mismas franjas que filterBarHtml() de js/ciclocross.js, con «Todas» activo.
  function barraFiltros(dia, hoy) {
    const orden = `<div class="agenda-filter-divider"></div><div class="agenda-sort-wrap"><select class="agenda-sort-select" id="cxAgendaSortSelect" aria-label="${esc(t('sort.label'))}"><option value="" disabled selected>${esc(t('sort.label'))}</option>${['category', 'tvtime', 'finishtime'].map(key => `<option value="${key}">${esc(t(`sort.${key}`))}</option>`).join('')}</select></div>`;
    const categoria = `<div class="agenda-cat-wrap"><span class="agenda-cat-wrap__label" aria-hidden="true">${esc(t('filter.category'))}</span><select class="agenda-cat-select" id="cxAgendaCatSelect" aria-label="${esc(t('filter.category'))}"><option value="" disabled selected>${esc(t('filter.category'))}</option>${CATEGORIAS.map(key => `<option value="${key}">${esc(t(`cx.filter.${key}`))}</option>`).join('')}</select></div>`;
    const chips = CATEGORIAS.map(key => `<button type="button" aria-pressed="${key === 'all'}" class="tcat-btn${key === 'all' ? ' tcat-btn--active' : ''}" data-cat="${key}"><span class="btn-label-full">${esc(t(`cx.filter.${key}`))}</span><span class="btn-label-short">${esc(t(`cx.filter.${key}`))}</span></button>`).join('');
    return `<section class="agenda-filters" id="cxAgendaFilters" aria-label="${esc(t('cx.title'))}"><div class="agenda-filters__inner">${cyclocrossHome(hoy) ? disciplineSwitchHtml('cyclocross', hoy) : ''}<span class="agenda-date">${agendaDateHtml(dia)}</span><div class="agenda-filter-cats" id="cxAgendaFilterCats">${chips}</div>${categoria}${orden}</div></section>`;
  }

  return async function componerPortada(item, activos) {
    const { destino, input } = item;
    const home = destino === 'home';
    const hoy = hoyLocal();
    // Fuera de la temporada de ciclocross, / lo publica la familia de Hoy de carretera.
    if (home && !cyclocrossHome(hoy)) return [];
    const season = cxSeason();
    const destacadas = new Set(input.featured.map(fila => fila.cxRaceId));
    const filas = input.agenda.filter(race => race.seasonKey === season && cxListedInAgenda(race, lang)).map(race => ({ ...race, featured: destacadas.has(race.id) }));
    const rondas = cxTournamentRounds(input.rondas.filter(race => race.seasonKey === season), season);
    const dias = cxRaceDays(filas);
    const carrerasDe = dia => cxSortDayRaces(filas, dia, 'category', race => filterBroadcastsByRegion(race.cx_broadcasts || []));
    let dia = cxClampDay(hoy, season);
    let carreras = carrerasDe(dia);
    while (!carreras.length) {
      const siguiente = cxAdjacentRaceDay(dias, dia, 1, season);
      if (!siguiente) break;
      dia = siguiente;
      carreras = carrerasDe(dia);
    }
    const tarjetas = carreras.map(race => cxAgendaCardHtml(race, dia, { rounds: rondas })).join('');
    const titulo = home ? `<h2 class="sr-only">${t('cx.title')}</h2>` : `<h1 class="sr-only">${t('cx.title')}</h1>`;
    const contenido = `<div class="cx-agenda-sticky">${titulo}<div class="date-bar" id="cxDateBar">${barraFechas(dia, dias, season, hoy)}</div>${barraFiltros(dia, hoy)}</div><p id="cxAgendaError" role="alert"></p><div id="cxAgendaList" class="cx-day-list">${tarjetas}</div>`;
    const franja = await cintillo({ ...input, cx_races: filas }, cyclocrossHome(hoy) ? ['cx', 'road'] : 'cx');
    const shell = activos.portada.paginas[`${lang}-${destino}`];
    const clave = `portada-${lang}/${destino}`;
    const version = huella(contenido + franja);
    const head = shell.head.replace('</head>', `<meta name="cc:clave" content="${clave}"><meta name="cc:v" content="${version}"></head>`);
    const cabecera = `<header class="site-header" id="siteHeader">${headerHtml({ lang, hasBack: false, active: home || CX_HOME ? 'today' : 'cyclocross' }).replace('href="#main"', 'href="#cxAgendaContent"')}</header>`;
    const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${cabecera}\n<div id="giroCountdown" class="giro-countdown"${franja ? '' : ' hidden'}>${franja}</div>\n${home ? shell.h1 : ''}`
      + `<main id="cxAgendaContent" tabindex="-1"${home ? ' data-cx-home=""' : ''} data-publicada="${version}">${contenido}</main>\n${pie()}\n`
      + `<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.portada.isla}"></script>\n</body>\n</html>\n`;
    return {
      slug: destino, clave, version, pagina, raceId: null, dayId: destino, fragmento: null, datos: null,
      ruta: home ? (lang === 'en' ? 'en' : '') : (lang === 'en' ? 'en/cyclocross' : 'ciclocross'),
      dia, tarjetas: carreras.length,
    };
  };
}
