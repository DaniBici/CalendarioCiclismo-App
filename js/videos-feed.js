// ─────────────────────────────────────────────────────────────────
//  VÍDEOS — /videos/ y /en/videos/ (docs/plans/videos-5-2.md, fase 5)
//
//  Vídeos de jornadas de carretera y de pruebas de ciclocross por día, en
//  orden cronológico inverso, con la estructura de Últimos resultados y el
//  conmutador Ciclocross / Carretera de Resultados: Ciclocross primero mientras
//  la home es Ciclocross (salvo Carretera fijada con su chincheta), Carretera el
//  resto del año. Cada vista tiene su ventana de 14 días anclada a su último
//  día con vídeos y «Cargar más vídeos» hasta RESULTS_SEASON_START (carretera,
//  por la red; ciclocross, de la temporada en memoria). Sondeo de 60 s con
//  marca de agua de race_day_videos y de race_uci_stages (una clasificación
//  nueva convierte la emisión) y recarga completa cada CX_FULL_REFRESH_MS para
//  las emisiones, sin updatedAt, y la temporada CX.
// ─────────────────────────────────────────────────────────────────
import { supabase, setMetaProperty, filterBroadcastsByRegion, esc } from './shared.js';
import { getLang, t, initI18n } from './i18n.js';
import { filtersActive, bindFilterMenu } from './components/filter-menu.js';
import { bindMenuButtons } from './components/menu-button.js';
import { patchHtml } from './dom-patch.js';
import { ROAD_FILTER_GROUPS, ROAD_FILTERS_KEY, CX_FILTERS_KEY, cxFilterGroups, loadRoadFilters, loadCxFilters, roadRaceMatches, cxRaceMatches, filterLabels } from './race-filters.js';
import { fetchRoadVideoDays, roadVideoEntries, cxVideoEntries, videoFeedDays, latestVideoDate } from './services/video-feed-entries.js';
import { videoDaysHtml, videosEmptyHtml, videosHeroHtml, videosMoreHtml, videosSwitchHtml, videosFilterSlotHtml } from './videos-feed-html.js';
import { bindVideoCards } from './stage/videos-panel.js';
import { cxSeasonRows, cxSeasonRounds, cxListedInAgenda } from './services/cx-data.js';
import { cxSeason } from './cx/presentation.js';
import { CX_FULL_REFRESH_MS } from './cx/results-feed.js';
import { cyclocrossHome, roadPinned, setRoadPinned } from './services/today-season.js';
import { RESULTS_SEASON_START, initialResultsFromKey } from './services/result-feed-pagination.js';
import { htmlFingerprint } from './html-fingerprint.js';

const MORE_DAYS = 7;
function shiftKey(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
// Semana anterior a `fromKey`, sin pasar del principio de la temporada.
function olderWindow(fromKey) {
  if (fromKey <= RESULTS_SEASON_START) return null;
  const start = shiftKey(fromKey, -MORE_DAYS);
  return { fromKey: start < RESULTS_SEASON_START ? RESULTS_SEASON_START : start, toKey: shiftKey(fromKey, -1) };
}

const toDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Marca de agua del sondeo: últimas escrituras de vídeos y de clasificaciones,
// y el número de vídeos (una baja no mueve updatedAt).
async function watermark() {
  const [videos, stages, count] = await Promise.all([
    supabase.from('race_day_videos').select('updatedAt').order('updatedAt', { ascending: false }).limit(1),
    supabase.from('race_uci_stages').select('updatedAt').eq('keepForWeb', true).gt('rowCount', 0).order('updatedAt', { ascending: false }).limit(1),
    supabase.from('race_day_videos').select('id', { count: 'exact', head: true }),
  ]);
  if (videos.error) throw videos.error;
  if (stages.error) throw stages.error;
  return JSON.stringify([videos.data?.[0]?.updatedAt || null, stages.data?.[0]?.updatedAt || null, count.count ?? null]);
}

const LOADING = text => `<div class="loading" role="status" aria-live="polite"><p class="loading__text">${esc(text)}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

async function init() {
  window.__spaDrivenAnalytics = true;
  await initI18n();
  const isEn = getLang() === 'en';
  const locale = isEn ? 'en-GB' : 'es-ES';
  const content = document.getElementById('videosContent');
  const todayKey = toDateKey(new Date());

  const title = isEn ? 'Cycling videos - Calendario Ciclismo' : 'Vídeos de ciclismo - Calendario Ciclismo App';
  document.title = title;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: title });
  setMetaProperty('og:title', title);

  let view = cyclocrossHome(todayKey) && !roadPinned() ? 'cx' : 'road';
  // Vista inicial pintada en el build (tools/site/prerender-videos.mjs): se
  // conserva sin capa de carga y, si los datos vivos dan el mismo HTML, sin
  // repintar.
  let prerendered = content.dataset.prerendered || null;
  const from = { road: null, cx: null };
  let roadDays = [];
  let cxRaces = [];
  let cxRounds = null;
  let mark = null;
  let loadedAt = 0;
  let busy = false;

  // Filtros de carreras: la misma selección de Hoy, Calendario y Resultados
  // (js/race-filters.js), por disciplina.
  const cxGroups = cxFilterGroups();
  let roadFilters = loadRoadFilters();
  let cxFilters = loadCxFilters(cxGroups);
  const FILTER_MENUS = {
    road: { idPrefix: 'videosRoadFilter', groups: ROAD_FILTER_GROUPS, storageKey: ROAD_FILTERS_KEY, get: () => roadFilters, set: filters => { roadFilters = filters; } },
    cx: { idPrefix: 'videosCxFilter', groups: cxGroups, storageKey: CX_FILTERS_KEY, get: () => cxFilters, set: filters => { cxFilters = filters; } },
  };
  const FILTER_ACTIVE_CLASS = 'agenda-filter-btn--active';
  const filterSlotHtml = () => videosFilterSlotHtml(view, FILTER_MENUS[view].get());
  const filteredEmptyHtml = () => `<div class="startlist-empty">${esc(t('filter.resultsEmpty'))}</div>`;

  const cxEntries = () => cxVideoEntries(cxRaces, filterBroadcastsByRegion);
  const roadEntries = days => roadVideoEntries(days, filterBroadcastsByRegion);
  const visibleEntries = (entries, which) => entries.filter(entry => which === 'cx'
    ? cxRaceMatches(entry.race, cxFilters, cxGroups) : roadRaceMatches(entry.race, roadFilters));
  const filtersOn = which => which === 'cx' ? filtersActive(cxGroups, cxFilters) : filtersActive(ROAD_FILTER_GROUPS, roadFilters);

  function render({ panelOnly = false } = {}) {
    const days = view === 'cx'
      ? videoFeedDays([], visibleEntries(cxEntries(), 'cx'), { fromKey: from.cx, toKey: todayKey })
      : videoFeedDays(visibleEntries(roadEntries(roadDays), 'road'), [], { fromKey: from.road, toKey: todayKey });
    let body = days.length ? videoDaysHtml(days, { isEn, locale, rounds: cxRounds })
      : filtersOn(view) ? filteredEmptyHtml() : videosEmptyHtml(isEn, view === 'cx');
    if (from[view] > RESULTS_SEASON_START) body += videosMoreHtml(isEn);
    // Con la cabecera ya pintada, un filtro solo cambia el panel: su menú sigue abierto.
    const panel = content.querySelector('#videosFeedPanel');
    if (panelOnly && panel && panel.dataset.view === view) {
      panel.innerHTML = body;
      content.querySelector('#videosMoreBtn')?.addEventListener('click', loadMore);
      return;
    }
    const html = `${videosHeroHtml(videosSwitchHtml({ view, pinned: roadPinned(), isEn }), filterSlotHtml())}<div id="videosFeedPanel" data-view="${view}">${body}</div>`;
    if (!prerendered || htmlFingerprint(html) !== prerendered) content.innerHTML = html;
    prerendered = null;
    delete content.dataset.prerendered;
    content.querySelector('#videosMoreBtn')?.addEventListener('click', loadMore);
  }

  bindMenuButtons();
  for (const [which, menu] of Object.entries(FILTER_MENUS)) {
    bindFilterMenu(content, {
      idPrefix: menu.idPrefix, groups: menu.groups, storageKey: menu.storageKey, activeClass: FILTER_ACTIVE_CLASS,
      clearLabel: filterLabels().clearLabel, getFilters: menu.get, setFilters: menu.set, patch: patchHtml,
      onChange: () => { if (view === which) render({ panelOnly: true }); },
    });
  }

  // Conmutador y chincheta, delegados: el contenido se repinta entero.
  content.addEventListener('click', event => {
    // La vista pintada en el build no cambia hasta tener los datos.
    if (!loadedAt) return;
    if (event.target.closest('button.discipline-switch__pin')) {
      setRoadPinned(!roadPinned());
      content.querySelector('.feed-view-switch').outerHTML = videosSwitchHtml({ view, pinned: roadPinned(), isEn });
      content.querySelector('button.discipline-switch__pin')?.focus();
      return;
    }
    const option = event.target.closest('[data-videos-view]');
    if (!option || option.dataset.videosView === view) return;
    view = option.dataset.videosView;
    render();
    content.querySelector(`[data-videos-view="${view}"]`)?.focus();
  });
  bindVideoCards(content);

  async function loadCx() {
    const season = cxSeason();
    const [rows, rounds] = await Promise.all([cxSeasonRows(supabase, season), cxSeasonRounds(supabase, season).catch(() => null)]);
    cxRaces = rows.filter(race => cxListedInAgenda(race, isEn ? 'en' : 'es'));
    cxRounds = rounds;
  }

  async function loadAll() {
    mark = await watermark().catch(() => null);
    const [anchor] = await Promise.all([fetchRoadVideoDays(supabase, null, todayKey), loadCx()]);
    from.road ??= initialResultsFromKey(latestVideoDate(anchor, [], todayKey) || todayKey);
    from.cx ??= initialResultsFromKey(latestVideoDate([], cxEntries(), todayKey) || todayKey);
    roadDays = await fetchRoadVideoDays(supabase, from.road, todayKey);
    loadedAt = Date.now();
  }

  // Días anteriores de la vista activa, añadidos al final sin repintar lo que
  // ya se ve (el desplazamiento no se mueve). Retrocede hasta encontrar algún
  // día con carreras o llegar al principio de la temporada.
  async function loadMore(event) {
    const button = event.currentTarget;
    const wrap = button.closest('.feed-more-wrap');
    const panelView = view;
    button.disabled = true;
    try {
      let days = [];
      while (!days.length) {
        const slot = olderWindow(from[panelView]);
        if (!slot) break;
        const { fromKey } = slot;
        if (panelView === 'road') {
          const older = await fetchRoadVideoDays(supabase, fromKey, slot.toKey);
          roadDays = [...roadDays, ...older];
          days = videoFeedDays(visibleEntries(roadEntries(older), 'road'), [], { fromKey, toKey: slot.toKey });
        } else {
          days = videoFeedDays([], visibleEntries(cxEntries(), 'cx'), { fromKey, toKey: slot.toKey });
        }
        from[panelView] = fromKey;
      }
      if (view !== panelView) return;
      if (days.length) wrap.insertAdjacentHTML('beforebegin', videoDaysHtml(days, { isEn, locale, rounds: cxRounds }));
      if (from[panelView] > RESULTS_SEASON_START) button.disabled = false;
      else wrap.remove();
    } catch (error) {
      console.error('[videos] cargar más', error);
      button.disabled = false;
    }
  }

  async function refresh() {
    // Una tarjeta abierta no se repinta: su vídeo seguiría sonando o se perdería.
    if (document.hidden || busy || content.querySelector('details.video-card[open]')) return;
    busy = true;
    try {
      const next = await watermark();
      if (next === mark && Date.now() - loadedAt < CX_FULL_REFRESH_MS) return;
      await loadAll();
      const y = scrollY;
      render();
      scrollTo(0, y);
    } catch (error) {
      console.error('[videos] sondeo', error);
    } finally {
      busy = false;
    }
  }

  if (!prerendered) content.innerHTML = `${videosHeroHtml(videosSwitchHtml({ view, pinned: roadPinned(), isEn }))}${LOADING(isEn ? 'Loading videos' : 'Cargando vídeos')}`;
  try {
    await loadAll();
    render();
  } catch (error) {
    console.error('[videos]', error);
    // Sin red, la vista del build se conserva.
    if (!prerendered) content.innerHTML = `${videosHeroHtml()}<div class="startlist-empty">${isEn ? 'Videos could not be loaded.' : 'No se han podido cargar los vídeos.'}</div>`;
  }
  const timer = setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', refresh);
  addEventListener('pagehide', () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); }, { once: true });
}

init();
