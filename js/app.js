import { initDaySwipe } from './components/day-swipe.js';
import { loadFeaturedRaces, todayRaceState, agendaTimeSignature } from './services/race-presentation.js';
// ─────────────────────────────────────────────────────────────────
//  APP PÚBLICA — index.html
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, setMeta, setMetaProperty, setCachedRace, initPhTooltip,
         filterBroadcastsByRegion, announce, agendaDateHtml }
         from './shared.js';
import { retireStaticText } from './static-text.js';
import { t, initI18n, getLocale, getLang } from './i18n.js';
initI18n(); // carga el diccionario EN en paralelo con los datos
import { buildInhouseResultsMatcher } from './services/races.js';
import { fetchAllRowsParallel } from './services/paged-query.js';
import { staleWhileRevalidate } from './services/local-cache.js';
import { openRaceDataModal, openResultsModal, openBroadcastTvModal, openYoutubeTvModal } from './race-data-modal.js';
import { initCintillo } from './cintillo.js';
import { patchHtml } from './dom-patch.js';
import { ACTIVE_RACE_COLUMNS, YEAR_NAV_COLUMNS, agendaPlaceholders, prepareAgendaDays,
         findNextDayWithRaces as nextDayWithRaces, findPrevDayWithRaces as prevDayWithRaces, addDaysKey } from './services/today-nav.js';
import { agendaCardHtml, dateBarHtml, emptyDayHtml } from './today-agenda-html.js';
import { sortAgenda } from './services/today-agenda-order.js';
import { cyclocrossLanding } from './services/today-season.js';
import { mountDisciplineSwitch } from './components/discipline-switch.js';
import { bindMenuButtons } from './components/menu-button.js';
import { bindFilterMenu } from './components/filter-menu.js';
import { scheduleTodayTips } from './components/today-tip.js';
import { bindSortMenu, loadSort, saveSort, ROAD_SORT_KEY } from './components/sort-menu.js';
import { ROAD_FILTER_GROUPS, ROAD_FILTERS_KEY, loadRoadFilters, roadFiltersActive, roadRaceMatches, femaleMarkCat, filterLabels } from './race-filters.js';

// ── Progress bar / elevation sparkline en cards de carrera en curso ─
let _progressCards = [];
let _progressTimer = null;

function _updateProgressCards() {
  if (document.hidden) return;
  const now = Date.now();
  _progressCards = _progressCards.filter(({ card, startMs, endMs, clipRect, hatch }) => {
    if (now >= endMs) {
      if (hatch) hatch.style.setProperty('--ep-progress', '100%');
      else if (clipRect) clipRect.setAttribute('width', '100');
      else card.style.removeProperty('--progress');
      return false;
    }
    const pct = Math.max(0, Math.min(100, Math.round((now - startMs) / (endMs - startMs) * 100)));
    // CRI/CRE: rayado del miniperfil (tiempo de la sesión).
    if (hatch) hatch.style.setProperty('--ep-progress', `${pct}%`);
    else if (clipRect) clipRect.setAttribute('width', `${pct}`);
    else card.style.setProperty('--progress', `${pct}%`);
    return true;
  });
  if (_progressCards.length === 0) {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }
}

// ── Render date bar ───────────────────────────────────────────────
const _urlDate = new URLSearchParams(window.location.search).get('date');
// `today` se recalcula bajo demanda (no es constante): un usuario que deja la
// pestaña abierta y cruza la medianoche LOCAL debe ver el día nuevo. Ver
// `todayKeyNow()` y el auto-avance de medianoche más abajo.
let today = toDateKey(new Date());
function todayKeyNow() { return toDateKey(new Date()); }
let currentDateKey = (_urlDate && /^\d{4}-\d{2}-\d{2}$/.test(_urlDate)) ? _urlDate : today;

function buildDateBar() {
  const bar = document.getElementById('dateBar');
  document.getElementById('agendaDate').innerHTML = agendaDateHtml(currentDateKey);
  bar.innerHTML = dateBarHtml(currentDateKey, today);

  // Centrar el día activo en el scroll
  requestAnimationFrame(() => {
    const pillsInner = bar.querySelector('.date-bar__pills');
    const activePill = pillsInner?.querySelector('.date-pill.active');
    if (activePill) {
      const innerRect = pillsInner.getBoundingClientRect();
      const pillRect  = activePill.getBoundingClientRect();
      pillsInner.scrollLeft += (pillRect.left - innerRect.left) - (innerRect.width / 2) + (pillRect.width / 2);
    }
  });
}

// Botones de la barra, delegados: la barra se repinta en cada cambio de día.
function initDateBarEvents() {
  document.getElementById('dateBar').addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.dk) { loadDay(button.dataset.dk); return; }
    if (button.classList.contains('date-today-btn')) { currentDateKey = today; buildDateBar(); loadDay(today); return; }
    if (button.dataset.direction === 'prev') {
      const prev = findPrevDayWithRaces(currentDateKey, _agendaFilters);
      if (prev) { loadDay(prev); return; }
      const [y, m, d] = currentDateKey.split('-').map(Number);
      loadDay(toDateKey(new Date(y, m - 1, d - 1)));
      return;
    }
    if (button.dataset.direction === 'next') {
      const next = nextNavigableDay(currentDateKey);
      if (next) loadDay(next);
    }
  });
}

// URL del día sin recargar. Con la home cedida a Ciclocross
// (services/today-season.js) y Carretera sin fijar, `/` sin fecha pinta
// Ciclocross: el día de hoy de carretera conserva `?date=`.
function syncDayUrl(dateKey) {
  const newUrl = dateKey === today && !cyclocrossLanding(today)
    ? window.location.pathname
    : `${window.location.pathname}?date=${dateKey}`;
  history.replaceState(null, '', newUrl);
}

// ── Cargar jornadas de un día ─────────────────────────────────────
// Jornada con su carrera, emisiones, assets y filas de resultados propios.
const DAY_SELECT = '*,race:races(*,race_uci_stages(raceId,raceDayId,stageNumber)),broadcasts(*),assets(id,raceDayId,type,url),race_day_videos(id,kind,title,titleEn,channel,url,embeddable,country,sortOrder,raceDayId)';
let dayRequest = 0;
let dayLoading = false;
// Un día sin carreras que pasen el filtro salta siempre al siguiente día que
// las tenga; el estado vacío solo aparece si no hay ninguno.
async function loadDay(dateKey, { refresh = false } = {}) {
  const request = ++dayRequest;
  dayLoading = true;
  clearInterval(_progressTimer);
  _progressTimer = null;
  _progressCards = [];
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  currentDateKey = dateKey;
  buildDateBar();

  syncDayUrl(dateKey);

  const list  = document.getElementById('raceList');

  // Actualizar document.title ya, sin esperar a Firestore
  updateSeoDay(dateKey, []);

  // ── Modo Campeonatos: la vista Hoy NO se transforma y las carreras de
  // Campeonatos Nacionales (uciCategory='CN') se muestran como cualquier otra
  // carrera del día (tarjetas normales). La rejilla país×prueba sigue accesible
  // aparte, pero no sustituye ni oculta nada en Hoy.

  // El texto estático (visible sin JS) se retira al pintar la lista; su <h1>
  // queda delante como título de la página (js/static-text.js).
  retireStaticText(list.querySelector('.static-prerender'), title => list.before(title));

  // El día anterior sigue a la vista hasta que llega el nuevo; sin él, el marcador de carga.
  if (!refresh && !list.querySelector('.race-card')) list.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.stages')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

  try {
    // Estas lecturas no dependen de las jornadas del día: iniciarlas ya evita
    // esperas en serie antes del primer render de la agenda.
    const currentYear = parseInt(dateKey.slice(0, 4));
    const yearRacesPromise = ensureYearRacesCached(currentYear);
    const activeRacesPromise = fetchActiveRaces(dateKey);
    const featuredPromise = loadFeaturedRaces(supabase, [dateKey]);
    featuredPromise.catch(() => {}); // el error se propaga en el `await` de abajo
    // Jornadas con su carrera, emisiones, assets y filas de resultados propios
    // embebidos: una sola lectura en lugar de dos oleadas en serie. El filtro
    // de `race_uci_stages` acota solo las filas embebidas.
    const { data: rdData, error: dayError } = await supabase.from('race_days').select(DAY_SELECT)
      .eq('dateKey', dateKey).eq('editorialStatus', 'published')
      .eq('race.race_uci_stages.keepForWeb', true).gt('race.race_uci_stages.rowCount', 0)
      .order('sortOrder', { referencedTable: 'broadcasts', ascending: true });

    if (dayError) throw dayError;
    if (request !== dayRequest) return;

    const featured = await featuredPromise;
    if (request !== dayRequest) return;
    const { raceDays, races, bcastRows, assetRows, raceIds, rdIds } = prepareAgendaDays(rdData, { dateKey, featured, filterBroadcasts: filterBroadcastsByRegion });
    races.forEach(race => setCachedRace(race.id, race));

    _dayProbe = {
      dateKey, raceIds, rdIds, days: raceDays,
      signature: daySignature(raceDays, bcastRows, assetRows, rd => rd._hasInhouse),
      timeSignature: agendaTimeSignature(raceDays),
    };

    // ⚠️ NO vaciar la lista aquí: por debajo quedan awaits (ensureYearRacesCached,
    // loadPlaceholders) que NO mutan el DOM. Si se limpia antes, el overlay de
    // carga (js/page-loading.js) ve el contenedor sin marcador .loading y sin
    // mutaciones durante SETTLE_MS → se desvanece sobre una lista VACÍA y las
    // cards aparecen después, con la página ya destapada. El marcador se
    // conserva hasta el instante en que hay algo que pintar.

    // Las carreras del año solo hacen falta para saltar a otro día cuando este
    // queda vacío (la navegación manual las lee al pulsar): la agenda no espera.
    // Placeholders: carreras en curso sin jornada publicada ese día.
    const placeholders = await loadPlaceholders(dateKey, raceDays, activeRacesPromise);
    if (request !== dayRequest) return;
    const dayItems = [...raceDays, ...placeholders.map(ph => ({ _placeholder: true, _race: ph, _phRace: ph }))];

    if (dayItems.length === 0) {
      await yearRacesPromise;
      if (request !== dayRequest) return;
      // Siguiente día con carreras que pasen el filtro activo: se salta siempre.
      const nextDateBtn = findNextDayWithRaces(dateKey, _agendaFilters);
      if (nextDateBtn) {
        loadDay(nextDateBtn);
        return;
      }
      showEmptyDay(list, t('today.noRaces'), null);
      return;
    }

    const allItems = sortAgenda(applyAgendaFilters(dayItems), _agendaSort);

    updateSeoDay(dateKey, raceDays);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

    if (allItems.length === 0) {
      await yearRacesPromise;
      if (request !== dayRequest) return;
      const nextFilteredDate = findNextDayWithRaces(dateKey, _agendaFilters);
      if (nextFilteredDate) {
        loadDay(nextFilteredDate);
        return;
      }
      showEmptyDay(list, t('today.noRacesFilter'), nextFilteredDate);
      return;
    }

    renderAgendaItems(allItems);
    // La lista se sustituye sin recargar: sin región activa, quien usa lector
    // pulsa un filtro o cambia de día y no recibe confirmación (WCAG 4.1.3).
    _announceDay(allItems.length, dateKey);

  } catch (err) {
    if (request !== dayRequest) return;
    console.error(err);
    list.querySelector('.day-load-error')?.remove();
    const error=document.createElement('div'); error.className='empty-state day-load-error'; error.setAttribute('role','status');
    error.innerHTML=`<p>${getLang()==='en'?'Connection error.':'Error de conexión.'}</p><button type="button" class="btn btn--ghost">${getLang()==='en'?'Retry':'Reintentar'}</button>`;
    error.querySelector('button').onclick=()=>loadDay(dateKey,{refresh});
    if(!refresh) list.replaceChildren(error);
    else list.prepend(error);
  } finally { if(request===dayRequest) dayLoading=false; }

}


function showEmptyDay(list, message, nextDateKey) {
  list.innerHTML = emptyDayHtml(message, nextDateKey);
  announce(message);
}

// ── SEO del cintillo "Hoy" — EVERGREEN ────────────────────────────
// title/description/canonical fijos para todas las vistas de día.
//
// Decisión (2026-06-03): las páginas de día (`/?date=YYYY-MM-DD`) NO compiten en Google con
// contenido propio por fecha. Title y description son fijos e idénticos a la home, y TODAS
// canonicalizan a la home de su idioma (`/` o `/en/`). Así Google consolida `/`, `/?date=hoy`,
// `/?date=mañana`… como una sola página evergreen en vez de N casi-duplicadas. El SEO por fecha
// era contraproducente:
//   1. El valor real está en las páginas de jornada (`jornada.html`), que conservan su SEO propio.
//   2. El renderer de Googlebot arrastra ICU sin datos de locale completos, así que
//      `toLocaleDateString('es-ES', …)` caía a inglés ("Monday, 1 June 2026") en el snippet.
//   3. El auto-avance (≥2h) movía `dateKey` sin referer, reescribiendo el snippet a un día ajeno.
//
// `raceDays` ya no se usa (se mantiene en la firma por compatibilidad con los call sites).
//
// `js/app.js` lo comparten la home ES (`/index.html`, `lang="es"`) y la EN (`/en/index.html`,
// `lang="en"`), así que title/description/canonical se eligen por idioma para ser espejo exacto
// del HTML estático de cada una. La home EN canonicaliza a `/en/`, la ES a `/`.
function updateSeoDay(dateKey, raceDays) {
  const isEn = getLang() === 'en';

  // Valores evergreen — espejo exacto del HTML estático (`index.html` / `en/index.html`).
  // Se reescriben explícitamente por si una navegación previa en la misma sesión los tocó.
  // Título EN propio: con el mismo título que la home ES, Google agrupaba /en/ con /.
  const title = isEn ? 'Pro Cycling Races Today: Schedule, TV and Streaming - Calendario Ciclismo App' : 'Calendario Ciclismo App: calendario ciclista con horarios, TV y recorridos';
  const description = isEn
    ? 'All professional cycling races with schedule, route, profile, standings and how to watch on TV and streaming.'
    : 'Calendario de ciclismo profesional: todas las carreras con horarios, recorrido, perfil, clasificaciones y cómo ver por TV y streaming. Una idea de Dani Sánchez.';

  document.title = title;
  setMeta('description', description);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);

  // Canonical y og:url SIEMPRE → home limpia del idioma (`/` o `/en/`), nunca `/?date=…`.
  const origin = CONFIG.webOrigin || window.location.origin;
  const canonicalUrl = isEn ? origin + '/en/' : origin + '/';
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;
  setMetaProperty('og:url', canonicalUrl);
}

// ── Placeholders — carreras con fechas pero sin jornadas publicadas ──

function fetchActiveRaces(dateKey) {
  const currentYear = parseInt(dateKey.slice(0, 4));
  return Promise.resolve(supabase.from('races').select(ACTIVE_RACE_COLUMNS)
    .eq('year', currentYear).lte('startDate', dateKey).gte('endDate', dateKey));
}

async function loadPlaceholders(dateKey, existingRaceDays, racesPromise = fetchActiveRaces(dateKey)) {
  const { data: racesData } = await racesPromise;
  return agendaPlaceholders(racesData, existingRaceDays, dateKey);
}

let _cachedYear = null;
let _yearRacesRequest = null;
/**
 * Carga y cachea todas las carreras del año para navegación filter-aware.
 * Paginado: las carreras de un año se acercan al tope de filas por respuesta
 * de PostgREST. La copia local permite resolver la navegación sin esperar a
 * la red.
 */
async function ensureYearRacesCached(year) {
  if (_cachedYear === year && _cachedYearRaces.length) return;
  if (_yearRacesRequest?.year === year) return _yearRacesRequest.promise;
  const apply = races => {
    _cachedYearRaces = races || [];
    _cachedYear = year;
  };
  // Con copia local, `apply` ya se ha ejecutado al volver de la llamada y la
  // navegación no espera a la revalidación.
  const revalidation = staleWhileRevalidate(`year-nav:${year}`,
    () => fetchAllRowsParallel(() => supabase.from('races').select(YEAR_NAV_COLUMNS).eq('year', year).order('id')),
    apply);
  revalidation.catch(() => {});
  const promise = (_cachedYear === year ? Promise.resolve() : revalidation.then(() => {}, () => {}))
    .finally(() => { if (_yearRacesRequest?.promise === promise) _yearRacesRequest = null; });
  _yearRacesRequest = { year, promise };
  return promise;
}

// Oyentes de las tarjetas, delegados en la lista: sirven sobre lo pintado aquí, lo actualizado al
// refrescar y lo publicado por página.
let _agendaById = new Map();

function renderAgendaItems(items) {
  const list = document.getElementById('raceList');
  if (!list) return;
  clearInterval(_progressTimer);
  _progressTimer = null;
  _agendaById = new Map(items.filter(item => !item._placeholder).map(item => [item.id, item]));
  patchHtml(list, items.map(item => agendaCardHtml(item, { agendaCat: femaleMarkCat(_agendaFilters), agendaSort: _agendaSort })).join(''));
  _progressCards = [...list.querySelectorAll('.race-card[data-progress-start]')].map(card => ({
    card,
    startMs: Number(card.dataset.progressStart),
    endMs: Number(card.dataset.progressEnd),
    clipRect: card.querySelector('.race-card__elevation rect'),
    hatch: card.querySelector('.race-card__ep-hatch'),
  }));
  if (_progressCards.length > 0) {
    _progressTimer = setInterval(_updateProgressCards, 60_000);
  }
}

function activateCard(card, event) {
  if (card.dataset.href) {
    sessionStorage.removeItem('cc_nav');
    window.location.href = card.dataset.href;
    return;
  }
  const rd = _agendaById.get(card.dataset.key);
  if (!rd || !('modal' in card.dataset)) return;
  if (event?.target?.closest?.('a.badge, .race-card__overview-btn')) return;
  openRaceDataModal(rd, rd._race || {});
}

function initAgendaCardEvents() {
  const list = document.getElementById('raceList');
  // Menú Resumen / Revive de la tarjeta terminada (js/components/menu-button.js).
  bindMenuButtons(document);
  // En captura: los enlaces de los badges paran la propagación en línea.
  list.addEventListener('click', e => {
    const rd = _agendaById.get(e.target.closest?.('.race-card')?.dataset.key);
    if (!rd) return;
    const race = rd._race || {};
    const tv = e.target.closest('.badge--tv-link[data-tv-embed]');
    if (tv) {
      e.preventDefault();
      e.stopPropagation();
      openBroadcastTvModal(rd, race, tv.href);
      return;
    }
    if (e.target.closest('.badge--results')) {
      e.stopPropagation();
      openResultsModal(rd, race);
      return;
    }
    // Opción del menú Resumen / Revive: YouTube en el modal de TV; el resto, pestaña nueva.
    const item = e.target.closest('.menu-popover__item');
    if (item) {
      e.stopPropagation();
      if (item.dataset.yt) {
        e.preventDefault();
        openYoutubeTvModal(rd, race, item.dataset.yt);
      }
      return;
    }
    const revive = e.target.closest('.badge--revive[data-yt]');
    if (revive) {
      e.preventDefault();
      e.stopPropagation();
      openYoutubeTvModal(rd, race, revive.dataset.yt);
    }
  }, true);
  list.addEventListener('click', e => {
    const card = e.target.closest?.('.race-card[role]');
    if (card) activateCard(card, e);
  });
  list.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target.closest?.('.race-card[role]');
    if (!card) return;
    // Enter/Espacio dentro de un badge o enlace anidado es cosa suya.
    if (e.target !== card && e.target.closest('a, button')) return;
    e.preventDefault();
    activateCard(card, e);
  });
}

// «3 carreras · lunes, 12 de agosto» tras repintar la lista.
function _announceDay(n, dateKey) {
  const races = n === 1 ? t('today.races_one', { n }) : t('today.races_other', { n });
  const date = dateKey
    ? new Date(dateKey + 'T12:00:00').toLocaleDateString(getLocale(),
        { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  announce(t('today.racesFor', { n: races, date }));
}


// ── Estado de filtros de agenda ───────────────────────────────────
// Menú «Filtros» (js/race-filters.js): nivel (WorldTour, Profesional, .2) y
// género, recordados y compartidos con Mes y Temporada.
let _agendaFilters = loadRoadFilters();
let _agendaSort    = loadSort(ROAD_SORT_KEY); // orden recordado: 'category' | 'tvtime' | 'finishtime'
window._icalYear   = new Date().getFullYear();
// ── Caché de carreras del año para navegación filter-aware ───────
let _cachedYearRaces = [];
const findNextDayWithRaces = (afterDateKey, filters) => nextDayWithRaces(afterDateKey, filters, _cachedYearRaces);
const findPrevDayWithRaces = (beforeDateKey, filters) => prevDayWithRaces(beforeDateKey, filters, _cachedYearRaces);

/** Destino de «día siguiente»: el próximo día con carreras del filtro o, si no
 *  lo hay, el día contiguo. */
function nextNavigableDay(fromKey) {
  return findNextDayWithRaces(fromKey, _agendaFilters) || addDaysKey(fromKey, 1);
}

const AGENDA_FILTER_MENU = { idPrefix: 'agendaFilter', activeClass: 'agenda-filter-btn--active' };

function initAgendaFilters() {
  const slot = document.getElementById('agendaFilterSlot');
  if (slot) {
    const menu = bindFilterMenu(slot, {
      ...AGENDA_FILTER_MENU,
      groups: ROAD_FILTER_GROUPS,
      clearLabel: filterLabels().clearLabel,
      storageKey: ROAD_FILTERS_KEY,
      getFilters: () => _agendaFilters,
      setFilters: filters => { _agendaFilters = filters; },
      patch: patchHtml,
      onChange: () => loadDay(currentDateKey),
    });
    menu.render();
  }

  const sortSlot = document.getElementById('agendaSortSlot');
  if (sortSlot) bindSortMenu(sortSlot, {
    idPrefix: 'agendaSort',
    getCurrent: () => _agendaSort,
    onChange: mode => { _agendaSort = mode; saveSort(ROAD_SORT_KEY, mode); loadDay(currentDateKey); },
  }).render();
  scheduleTodayTips(document.getElementById('agendaFilterBtn'), document.getElementById('agendaSortBtn'), 'road');

}

// Filtros activos. Misma lógica que la navegación entre días
// (roadRaceMatches), de modo que un día con carreras nunca queda vacío.
function applyAgendaFilters(items) {
  if (!roadFiltersActive(_agendaFilters)) return items;
  return items.filter(item => roadRaceMatches(item._race || {}, _agendaFilters));
}

// ── Tooltip zona horaria en badge--time ──────────────────────────
(function() {
  const raceList = document.getElementById('raceList');
  if (!raceList) return;
  let tip = null;
  function getTip() {
    if (!tip) { tip = document.createElement('div'); tip.id = 'tz-tip'; document.body.appendChild(tip); }
    return tip;
  }
  raceList.addEventListener('mouseover', e => {
    if (window.innerWidth < 600) return;
    const badge = e.target.closest('.badge--time-user');
    if (!badge) return;
    const t = getTip();
    t.textContent = badge.dataset.tztip;
    t.style.cssText = 'position:fixed;background:var(--tooltip-bg,#222);color:var(--tooltip-color,#fff);padding:4px 8px;border-radius:4px;font-size:.75rem;pointer-events:none;z-index:9999;white-space:nowrap;display:block';
  });
  raceList.addEventListener('mousemove', e => {
    if (!tip || tip.style.display === 'none') return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY + 14) + 'px';
  });
  raceList.addEventListener('mouseout', e => {
    const badge = e.target.closest('.badge--time-user');
    if (badge && !badge.contains(e.relatedTarget)) {
      if (tip) tip.style.display = 'none';
    }
  });
})();

// ── Guardar estado de navegación al clicar hamburguesa de carrera ─
document.getElementById('raceList')?.addEventListener('click', e => {
  if (e.target.closest('.race-card__overview-btn')) {
    sessionStorage.setItem('cc_nav', JSON.stringify({ from: 'dia', date: currentDateKey }));
  }
});

// El cintillo «Hoy» (today_highlights) vive ahora en ./cintillo.js (initCintillo).

// ── Swipe horizontal para cambiar de día (móvil) ──────────────────
// Mismo destino que las flechas ◀▶: findNext/PrevDayWithRaces con fallback a
// ±1 día (js/components/day-swipe.js).
function initTodaySwipe() {
  initDaySwipe({
    list: document.getElementById('raceList'),
    dateBar: document.getElementById('dateBar'),
    target: forward => forward
      ? nextNavigableDay(currentDateKey)
      : (findPrevDayWithRaces(currentDateKey, _agendaFilters) || addDaysKey(currentDateKey, -1)),
    load: loadDay,
  });
}

// ── Init ──────────────────────────────────────────────────────────
initAgendaFilters();
initDateBarEvents();
initAgendaCardEvents();
initCintillo();
initTodaySwipe();
initPhTooltip();
window.loadDay = loadDay;
initI18n().then(() => {
  // Aplicar traducciones a elementos data-i18n del HTML estático
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.getAttribute('data-i18n'));
    if (typeof val === 'string') el.textContent = val;
  });
  // El conmutador CX / Ruta abre la franja de filtros todo el año (Ciclocross
  // vive dentro de Hoy). Su chincheta fija Carretera como vista de `/` mientras
  // la home es Ciclocross: el día de hoy pierde o recupera `?date=`.
  mountDisciplineSwitch(document.querySelector('#agendaFilters .agenda-filters__inner'),
    'road', today, () => syncDayUrl(currentDateKey));
  buildDateBar();
  loadDay(currentDateKey);
});

// ── Auto-avance de medianoche ─────────────────────────────────────
// El día por defecto es SIEMPRE la fecha local del usuario (su zona horaria).
// Si deja la pestaña abierta y cruza la medianoche local, debe pasar solo al
// día nuevo — pero SOLO si está viendo "hoy" (no si navegó a otro día a mano).
// Se comprueba al recuperar el foco/visibilidad y en un latido de 60 s; sin
// timers de medianoche exactos.
function _maybeAdvanceToNewLocalDay() {
  const nowKey = todayKeyNow();
  if (nowKey === today) return;            // sigue siendo el mismo día local
  const wasOnToday = currentDateKey === today;
  today = nowKey;                          // actualizar la referencia de "hoy"
  if (!wasOnToday) { buildDateBar(); return; } // respetar navegación manual
  currentDateKey = today;
  buildDateBar();
  loadDay(currentDateKey);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _maybeAdvanceToNewLocalDay();
});
window.addEventListener('focus', _maybeAdvanceToNewLocalDay);
setInterval(_maybeAdvanceToNewLocalDay, 60_000);

// ── Refresco de Hoy ───────────────────────────────────────────────
// Mientras quede alguna jornada sin terminar (todayRaceState), una lectura
// ligera de jornadas, emisiones, assets y resultados propios decide si hace
// falta recargar el día completo (perfiles incluidos).
let _dayProbe = null;
const PROBE_DAY_COLUMNS = 'id,raceId,stageNumber,raceStatus,isCancelledDay,isRestDay,neutralStartTimeUtc,estimatedFinishTimeUtc,realStartTimeUtc,tvStatus,updatedAt';
const PROBE_BROADCAST_COLUMNS = 'id,raceDayId,channel,startTimeUtc,url,country,embeddable,sortOrder';

function daySignature(days, broadcasts, assets, hasInhouse) {
  const pick = (row, columns) => columns.split(',').map(column => row[column] ?? null);
  return JSON.stringify([
    days.map(rd => [...pick(rd, PROBE_DAY_COLUMNS), !!hasInhouse(rd)]).sort(),
    broadcasts.map(row => pick(row, PROBE_BROADCAST_COLUMNS)).sort(),
    assets.map(row => [row.id, row.raceDayId, row.type, row.url]).sort(),
  ]);
}

async function dayChanged(probe) {
  const [days, broadcasts, assets, stages] = await Promise.all([
    supabase.from('race_days').select(PROBE_DAY_COLUMNS).eq('dateKey', probe.dateKey).eq('editorialStatus', 'published'),
    probe.rdIds.length ? supabase.from('broadcasts').select(PROBE_BROADCAST_COLUMNS).in('raceDayId', probe.rdIds) : Promise.resolve({ data: [] }),
    probe.rdIds.length ? supabase.from('assets').select('id,raceDayId,type,url').in('raceDayId', probe.rdIds) : Promise.resolve({ data: [] }),
    probe.raceIds.length
      ? supabase.from('race_uci_stages').select('raceId,raceDayId,stageNumber').eq('keepForWeb', true).gt('rowCount', 0).in('raceId', probe.raceIds)
      : Promise.resolve({ data: [] }),
  ]);
  const failed = [days, broadcasts, assets, stages].find(result => result.error);
  if (failed) throw failed.error;
  const matcher = buildInhouseResultsMatcher(stages.data || []);
  return daySignature(days.data || [], broadcasts.data || [], assets.data || [],
    rd => !rd.isCancelledDay && matcher.has(rd)) !== probe.signature;
}

let dayProbing = false;
const refreshToday = async () => {
  if (document.hidden || dayLoading || dayProbing || currentDateKey !== toDateKey(new Date())) return;
  const probe = _dayProbe;
  if (!probe || probe.dateKey !== currentDateKey) return;
  if (!probe.days.some(rd => ['scheduled', 'running', 'waiting'].includes(todayRaceState(rd)))) return;
  dayProbing = true;
  try {
    // Los badges dependen de la hora (TV → En directo, Live texto): un umbral
    // cruzado obliga a repintar aunque los datos no hayan cambiado.
    const timeChanged = agendaTimeSignature(probe.days) !== probe.timeSignature;
    if ((timeChanged || await dayChanged(probe)) && currentDateKey === probe.dateKey) loadDay(currentDateKey, { refresh: true });
  } catch { /* Sin red: se conserva la agenda visible hasta la siguiente lectura. */ }
  finally { dayProbing = false; }
};
const dayRefreshTimer=setInterval(refreshToday,60000);
document.addEventListener('visibilitychange',refreshToday);
window.addEventListener('pagehide',()=> { clearInterval(dayRefreshTimer); document.removeEventListener('visibilitychange',refreshToday); },{once:true});
