// ─────────────────────────────────────────────────────────────────
//  ÚLTIMOS RESULTADOS — motor compartido de filas de resultados
//
//  Consumidor: renderResultsFeed(content), las páginas de Últimos resultados
//  (results/feed-pages.js: /resultados/, /resultados/ciclocross/ y el ránking
//  UCI; lo monta resultados.js): cronología inversa agrupada por fecha +
//  "Cargar más" de 14 en 14 días. Cambiar de vista pone su URL sin recargar.
//
//  Reglas de las filas (espec Dani 2026-06-11):
//   · Etapas de vueltas y pruebas de un día (estas SIN etiqueta) + las
//     GENERALES FINALES de las vueltas, pegadas a su carrera y POR DELANTE
//     de la etapa correspondiente.
//   · Dentro de cada día, el MISMO orden canónico que las cards de Hoy
//     (grandes vueltas → nivel pro → género → categoría UCI → hora → nombre).
//   · Card con el tinte del color de la carrera (como las cards de Hoy; las
//     generales, ligeramente más fuerte): nombre / "Etapa X" en negrita +
//     etapa · km · desnivel + badge de tipo solo para contrarrelojes / ganador en negrita con
//     nombre canónico de la ficha (fallback al winnerName crudo; CRE → crudo).
//   · stageDate puede venir NULL (volcados PDF, migración 090) → la fecha se
//     resuelve por raceDayId→race_days.dateKey o por las fechas de la carrera.
//   · El feed solo publica clasificaciones propias.
// ─────────────────────────────────────────────────────────────────

import { fetchResultEntries as fetchEntries } from './services/result-feed-entries.js';
import { cxDaysHtml, cxEmptyHtml, feedDaysHtml, feedEmptyHtml, feedHeroHtml, feedMoreHtml, feedTabsHtml, feedViews, rankingBodyHtml } from './resultados-feed-html.js';
import { bindRankingRows, packCxDays, packFeaturedEntries } from './resultados-feed-layout.js';
import { resolveCxWinnerTeams } from './services/result-feed-context.js';
import { supabase, esc, setMeta, setMetaProperty } from './shared.js';
import { feedPageFromPath, feedPageMeta, feedPagePath, pageGender, pageView, viewPage } from './results/feed-pages.js';
import { uciRankingSeasonYear } from './results/uci-team-ranking.js';
import { getLang, t } from './i18n.js';
import { filterMenuHtml, filtersActive, bindFilterMenu } from './components/filter-menu.js';
import { bindMenuButtons } from './components/menu-button.js';
import { scheduleResultsTip } from './components/today-tip.js';
import { patchHtml } from './dom-patch.js';
import { ROAD_FILTER_GROUPS, ROAD_FILTERS_KEY, CX_FILTERS_KEY, cxFilterGroups, loadRoadFilters, loadCxFilters, roadRaceMatches, cxRaceMatches, filterLabels } from './race-filters.js';
import { cyclocrossHome, roadPinned, setRoadPinned, seasonCalendarYear } from './services/today-season.js';
import { cxSeasonRows, cxSeasonRounds, cxListedInAgenda } from './services/cx-data.js';
import { cxSeason } from './cx/presentation.js';
import { cxResultEntries, cxFeedNeedsReload, CX_FULL_REFRESH_MS } from './cx/results-feed.js';
import {
  RESULTS_SEASON_START,
  initialResultsFromKey,
  previousResultsWindow,
  RESULTS_MIN_DAYS,
  resultDayCount,
  resultsStartKey,
  fillResultsWindow,
} from './services/result-feed-pagination.js';

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Última modificación de una clasificación del feed posterior a la marca de
// agua, o null. Una fila basta para decidir si se recarga el feed completo.
async function latestResultChange(watermark) {
  const { data, error } = await supabase.from('race_uci_stages').select('updatedAt')
    .eq('keepForWeb', true).gt('rowCount', 0).in('classKind', ['stage', 'gc'])
    .gt('updatedAt', watermark).order('updatedAt', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.updatedAt || null;
}

// Última importación de resultados de ciclocross (cx_race_categories). La
// escribe cx_replace_results en cada categoría, también en las correcciones.
async function latestCxImport() {
  const { data, error } = await supabase.from('cx_race_categories').select('resultsImportedAt')
    .not('resultsImportedAt', 'is', null).order('resultsImportedAt', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.resultsImportedAt || null;
}

// Indicador de carga con iconos y puntos, el mismo de Hoy, Calendario y
// Ciclocross: el cambio de pestaña descarga la temporada y tarda.
const LOADING_ICONS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const loadingHtml = text => `<div class="loading" role="status" aria-live="polite"><div class="loading__icons">${LOADING_ICONS}</div><p class="loading__text">${esc(text)}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

// ── Índice /resultados/ · /en/results/ ─────────────────────────────
export function renderResultsFeed(content) {
  const _isEn = getLang() === 'en';
  const locale = _isEn ? 'en-GB' : 'es-ES';
  const todayKey = toDateKey(new Date());
  let fromKey = initialResultsFromKey(todayKey);
  // Pestaña Ciclocross, primera, mientras la home es Ciclocross (del cierre de
  // la temporada de carretera al 31 de diciembre; services/today-season.js).
  // En ese periodo las tres vistas forman el conmutador de Hoy y Carretera
  // abre por defecto si está fijada con su chincheta.
  const cxTab = cyclocrossHome(todayKey);
  const lang = _isEn ? 'en' : 'es';
  // Página de la URL. La portada (/resultados/) abre en la primera vista:
  // Ciclocross mientras la home es Ciclocross, salvo con Carretera fijada.
  let page = feedPageFromPath(location.pathname) || 'latest';
  const views = feedViews(cxTab || page === 'cx');
  let activeView = page === 'latest' ? (cxTab && roadPinned() ? 'latest' : views[0]) : pageView(page);
  let rankingGender = pageGender(page);
  let feedEntries = null;
  let rankingRows = null;

  // ── SEO: título, descripción, canonical y hreflang de la página ──
  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : location.origin;
  const pageMeta = () => feedPageMeta(page, lang, {
    cxSeason: cxSeason(),
    rankingSeason: rankingRows?.length ? uciRankingSeasonYear(rankingRows.find(row => row.gender === 'male') || rankingRows[0]) : seasonCalendarYear(todayKey),
  });
  function applyPageMeta() {
    const meta = pageMeta();
    document.title = meta.title;
    setMeta('description', meta.description);
    setMetaProperty('og:title', meta.title);
    setMetaProperty('og:description', meta.description);
    setMetaProperty('og:url', origin + feedPagePath(page, lang));
    let canonEl = document.querySelector('link[rel="canonical"]');
    if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
    canonEl.href = origin + feedPagePath(page, lang);
    for (const [hreflang, target] of [['es', 'es'], ['en', 'en'], ['x-default', 'es']]) {
      document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`)?.setAttribute('href', origin + feedPagePath(page, target));
    }
    const h1 = content.querySelector('.feed-hero > h1');
    if (h1) h1.textContent = meta.h1;
  }
  applyPageMeta();
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });

  // Cambio de vista sin recarga: URL de la vista y su <head>. La portada puede
  // mostrar Ciclocross o Carretera; el historial guarda la vista.
  function goToPage(next) {
    const changed = next !== page;
    page = next;
    const state = { view: activeView, gender: rankingGender };
    const previous = history.state;
    if (changed || previous?.view !== activeView || previous?.gender !== rankingGender) history.pushState(state, '', feedPagePath(next, lang));
    applyPageMeta();
    if (changed && window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  }
  history.replaceState({ view: activeView, gender: rankingGender }, '', location.href);
  const opensElsewhere = event => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  const tabsHtml = () => feedTabsHtml({ views, activeView, pinnable: cxTab, pinned: roadPinned(), isEn: _isEn });

  // Filtros de carreras: la misma selección de Hoy y Calendario (js/race-filters.js),
  // por disciplina. El Ránking UCI no lleva filtros.
  const cxGroups = cxFilterGroups();
  let roadFilters = loadRoadFilters();
  let cxFilters = loadCxFilters(cxGroups);
  const FILTER_MENUS = {
    latest: { idPrefix: 'resultsRoadFilter', groups: ROAD_FILTER_GROUPS, storageKey: ROAD_FILTERS_KEY, get: () => roadFilters, set: filters => { roadFilters = filters; } },
    cx: { idPrefix: 'resultsCxFilter', groups: cxGroups, storageKey: CX_FILTERS_KEY, get: () => cxFilters, set: filters => { cxFilters = filters; } },
  };
  const FILTER_ACTIVE_CLASS = 'agenda-filter-btn--active';
  const filterSlotHtml = () => {
    const menu = FILTER_MENUS[activeView];
    if (!menu) return '';
    return `<div class="agenda-filter-slot feed-filter-slot">${filterMenuHtml(menu.groups, menu.get(), { idPrefix: menu.idPrefix, activeClass: FILTER_ACTIVE_CLASS, ...filterLabels(), buttonClass: 'agenda-filter-btn' })}</div>`;
  };
  const roadVisible = entries => entries.filter(entry => roadRaceMatches(entry.race, roadFilters));
  const cxVisible = entries => entries.filter(entry => cxRaceMatches(entry.race, cxFilters, cxGroups));
  const filteredEmptyHtml = () => `<div class="startlist-empty">${esc(t('filter.resultsEmpty'))}</div>`;

  const shell = body => `${feedHeroHtml(tabsHtml() + filterSlotHtml(), pageMeta().h1)}
      <div id="resultsFeedPanel">${body}</div>`;
  // Con la cabecera de la vista ya pintada solo cambia el panel: un filtro no
  // cierra su menú ni mueve la burbuja.
  function paint(body) {
    const panel = content.querySelector('#resultsFeedPanel');
    if (panel && content.dataset.view === activeView) {
      panel.innerHTML = body;
      return;
    }
    content.innerHTML = shell(body);
    content.dataset.view = activeView;
    bindViewTabs();
    scheduleResultsTip(content.querySelector('.feed-filter-slot [data-menu-button]'));
  }
  bindMenuButtons();
  for (const [view, menu] of Object.entries(FILTER_MENUS)) {
    bindFilterMenu(content, {
      idPrefix: menu.idPrefix, groups: menu.groups, storageKey: menu.storageKey, activeClass: FILTER_ACTIVE_CLASS,
      clearLabel: filterLabels().clearLabel, getFilters: menu.get, setFilters: menu.set, patch: patchHtml,
      onChange: () => {
        if (activeView !== view) return;
        if (view === 'latest' && feedEntries) refilterFeed();
        // Equipos de los ganadores que el filtro deja a la vista, antes de pintar.
        if (view === 'cx' && cxEntries) loadCxTeams().catch(() => false).then(() => { if (activeView === 'cx') renderCx(cxEntries); });
      },
    });
  }

  function bindViewTabs() {
    content.querySelector('.feed-view-switch')?.addEventListener('click', (event) => {
      if (!event.target.closest('button.discipline-switch__pin')) return;
      setRoadPinned(!roadPinned());
      content.querySelector('.feed-view-switch').outerHTML = tabsHtml();
      bindViewTabs();
      (content.querySelector('button.discipline-switch__pin') || content.querySelector('[data-results-view="latest"]'))?.focus();
    });
    content.querySelectorAll('[data-results-view]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        showView(button.dataset.resultsView);
        goToPage(viewPage(activeView, rankingGender));
      });
    });
  }

  function showView(next) {
    if (next === activeView) return;
    activeView = next;
    if (activeView === 'ranking') {
      renderRankingOrLoad();
    } else if (activeView === 'cx') {
      // Se pinta lo cargado y se sondea enseguida, como al volver a la
      // pestaña: no se espera al siguiente ciclo de 60 s.
      if (cxEntries) { renderCx(cxEntries); refreshCx(); } else loadCx();
    } else if (feedEntries) {
      renderFeed(feedEntries);
      refreshFeed();
    } else {
      loadFeed();
    }
  }

  window.addEventListener('popstate', ({ state }) => {
    const next = feedPageFromPath(location.pathname);
    if (!next || !content.isConnected) return;
    page = next;
    const gender = state?.gender || pageGender(next);
    const view = state?.view || pageView(next);
    if (view === 'ranking' && activeView === 'ranking' && gender !== rankingGender) {
      rankingGender = gender;
      if (rankingRows) renderRanking(rankingRows);
    } else {
      rankingGender = gender;
      showView(view);
    }
    applyPageMeta();
  });

  function renderFeed(entries) {
    const visible = roadVisible(entries);
    let html = visible.length ? feedDaysHtml(visible, _isEn, locale)
      : entries.length && filtersActive(ROAD_FILTER_GROUPS, roadFilters) ? filteredEmptyHtml() : feedEmptyHtml(_isEn);
    if (fromKey > RESULTS_SEASON_START) html += feedMoreHtml('feedMoreBtn', _isEn);
    paint(html);
    packFeaturedEntries(content);

    const moreBtn = content.querySelector('#feedMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', loadMoreFeed);
    }
  }

  let feedRequest=0, feedLoading=false, moreLoading=false, feedWatermark=null, pendingWatermark=null, feedProbing=false;
  // La ventana inicial cuenta 14 días desde el último día con resultados (como
  // mucho, hoy), no desde hoy: un periodo sin carreras no deja la lista vacía.
  let windowAnchored=false;

  async function anchorFeedWindow(today) {
    if (windowAnchored) return;
    const { data, error } = await supabase.from('race_uci_stages').select('stageDate')
      .eq('keepForWeb', true).gt('rowCount', 0).in('classKind', ['stage', 'gc'])
      .lte('stageDate', today).order('stageDate', { ascending: false }).limit(1);
    // Si la consulta falla, la ventana cuenta desde hoy y la siguiente carga lo reintenta.
    if (error) return;
    windowAnchored = true;
    const last = data?.[0]?.stageDate;
    if (!last) return;
    // Nunca acorta la ventana (el ancla es como mucho hoy).
    const anchored = initialResultsFromKey(last < today ? last : today);
    if (anchored < fromKey) fromKey = anchored;
  }

  // Con menos de RESULTS_MIN_DAYS días que pasen los filtros, lo cargado se
  // amplía hacia atrás por tramos (fillResultsWindow). Devuelve las entradas
  // ampliadas, o null si otra carga más reciente la sustituye.
  const roadDays = entries => resultDayCount(roadVisible(entries).map(e => e.date));
  async function fillMinDays(entries, request) {
    let loaded = entries;
    for (let range = fillResultsWindow(fromKey); range && roadDays(loaded) < RESULTS_MIN_DAYS; range = fillResultsWindow(fromKey)) {
      const { entries: older } = await fetchEntries(range.fromKey, range.toKey, _isEn);
      if (request !== feedRequest) return null;
      loaded = [...loaded, ...older];
      fromKey = range.fromKey;
    }
    return loaded;
  }

  // Cambio de filtro: si faltan días, se cargan antes de pintar.
  async function refilterFeed() {
    if (roadDays(feedEntries) >= RESULTS_MIN_DAYS || !fillResultsWindow(fromKey)) { renderFeed(feedEntries); return; }
    const request = ++feedRequest;
    feedLoading = true;
    paint(loadingHtml(_isEn ? 'Loading results' : 'Cargando resultados'));
    try {
      const loaded = await fillMinDays(feedEntries, request);
      if (!loaded) return;
      feedEntries = loaded;
    } catch (error) {
      console.error('[resultados-feed] filtros', error);
    } finally {
      if (request === feedRequest) {
        feedLoading = false;
        if (activeView === 'latest') renderFeed(feedEntries);
      }
    }
  }

  function setMoreButtonLoading(loading) {
    const button = content.querySelector('#feedMoreBtn');
    if (!button) return;
    button.disabled = loading;
    button.setAttribute('aria-busy', String(loading));
    button.textContent = loading
      ? (_isEn ? 'Loading…' : 'Cargando…')
      : (_isEn ? 'Load more results' : 'Cargar más resultados');
  }

  async function loadMoreFeed() {
    if (moreLoading) return;
    const range = previousResultsWindow(fromKey);
    if (!range) return;

    const request = ++feedRequest;
    const y = window.scrollY;
    moreLoading = true;
    feedLoading = true;
    setMoreButtonLoading(true);

    try {
      const { entries: olderEntries } = await fetchEntries(range.fromKey, range.toKey, _isEn);
      if (request !== feedRequest) return;
      fromKey = range.fromKey;
      feedEntries = [...(feedEntries || []), ...olderEntries];
      moreLoading = false;
      if (activeView === 'latest') {
        renderFeed(feedEntries);
        window.scrollTo(0, y);
      }
    } catch (error) {
      if (request !== feedRequest) return;
      console.error('[resultados-feed] load more', error);
      const wrap = content.querySelector('.feed-more-wrap');
      if (wrap) {
        const note = document.createElement('div');
        note.className = 'res-update-note';
        note.setAttribute('role', 'status');
        note.textContent = _isEn
          ? 'Unable to load more results. Try again.'
          : 'No se pudieron cargar más resultados. Inténtalo de nuevo.';
        wrap.append(note);
      }
    } finally {
      if (request === feedRequest) {
        moreLoading = false;
        feedLoading = false;
        setMoreButtonLoading(false);
      }
    }
  }

  async function loadFeed({refresh=false}={}) {
    const request=++feedRequest;
    feedLoading=true;
    if (!refresh && !feedEntries) {
      paint(loadingHtml(_isEn ? 'Loading results' : 'Cargando resultados'));
    }
    try {
      const today = toDateKey(new Date());
      await anchorFeedWindow(today);
      if (request!==feedRequest) return;
      const { entries: fetched, watermark } = await fetchEntries(fromKey,today,_isEn);
      if (request!==feedRequest) return;
      const next = await fillMinDays(fetched, request);
      if (!next) return;
      // La marca de agua solo avanza: incluye el cambio que disparó la recarga
      // aunque quede fuera de la ventana del feed.
      feedWatermark = [watermark, pendingWatermark, feedWatermark].filter(Boolean).sort().at(-1)
        || new Date(Date.now() - 5 * 60_000).toISOString();
      pendingWatermark = null;
      const changed = !feedEntries || JSON.stringify(next) !== JSON.stringify(feedEntries);
      feedEntries=next;
      if (activeView==='latest' && changed) {
        const focused=document.activeElement?.closest('a')?.getAttribute('href');
        renderFeed(feedEntries);
        if (focused) [...content.querySelectorAll('a')].find(a=>a.getAttribute('href')===focused)?.focus({preventScroll:true});
      }
    } catch (error) {
      if (request!==feedRequest || activeView!=='latest') return;
      console.error('[resultados-feed] latest',error);
      if(feedEntries) renderFeed(feedEntries);
      else paint('');
      const note=document.createElement('div'); note.className='res-update-note'; note.setAttribute('role','status');
      note.innerHTML=`${feedEntries ? (_isEn?'Unable to update · Saved results':'No se pudo actualizar · Datos conservados') : (_isEn?'Unable to load results':'No se pudieron cargar los resultados')} <button type="button">${_isEn?'Retry':'Reintentar'}</button>`;
      content.append(note);
      note.querySelector('button').onclick=()=>loadFeed({refresh:true});
    } finally { if(request===feedRequest) feedLoading=false; }
  }
  let packFrame=0;
  const repackFeed=()=> {
    cancelAnimationFrame(packFrame);
    packFrame=requestAnimationFrame(()=> {
      if(activeView==='latest') packFeaturedEntries(content);
      else if(activeView==='cx') packCxDays(content);
    });
  };
  window.addEventListener('resize',repackFeed);
  document.fonts?.ready.then(repackFeed);
  // Sondeo ligero: solo se recarga el feed si alguna clasificación cambió
  // desde la última lectura.
  const refreshFeed=async()=> {
    if(document.hidden || activeView!=='latest' || feedLoading || feedProbing || !content.isConnected) return;
    if(!feedWatermark) { loadFeed({refresh:true}); return; }
    feedProbing=true;
    try {
      const newest=await latestResultChange(feedWatermark);
      if(newest && !feedLoading) { pendingWatermark=newest; loadFeed({refresh:true}); }
    }
    catch { /* Sin red: se conserva el feed visible hasta la siguiente lectura. */ }
    finally { feedProbing=false; }
  };
  const feedTimer=setInterval(refreshFeed,60000);
  document.addEventListener('visibilitychange',refreshFeed);
  window.addEventListener('pagehide',()=> {clearInterval(feedTimer);document.removeEventListener('visibilitychange',refreshFeed);window.removeEventListener('resize',repackFeed);},{once:true});

  function renderRanking(rows) {
    paint(rankingBodyHtml(rows, rankingGender, _isEn));
    content.querySelectorAll('[data-ranking-gender]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        rankingGender = button.dataset.rankingGender;
        renderRanking(rows);
        goToPage(viewPage('ranking', rankingGender));
      });
    });
    bindRankingRows(content);
  }

  async function renderRankingOrLoad() {
    if (rankingRows) {
      renderRanking(rankingRows);
      return;
    }
    paint(loadingHtml(_isEn ? 'Loading UCI ranking' : 'Cargando ránking UCI'));
    try {
      const { data, error } = await supabase
        .from('uci_team_rankings')
        .select('gender,rank,previousRank,uciTeamId,teamId,teamCategory,sourceName,displayName,teamCode,countryCode,points,rankingDate,sourceUrl,seasonYear,officialPoints,provisionalPoints,penaltyPoints,officialRankingDate,syncedAt')
        .order('gender', { ascending: true })
        .order('rank', { ascending: true });
      if (error) throw error;
      rankingRows = data || [];
      if (page.startsWith('ranking')) applyPageMeta();
      if (activeView === 'ranking') renderRanking(rankingRows);
    } catch (error) {
      console.error('[resultados-feed] ranking', error);
      if (activeView === 'ranking') {
        paint(`<div class="startlist-empty">${_isEn
          ? 'The UCI ranking could not be loaded.'
          : 'No se pudo cargar el ránking UCI.'}</div>`);
      }
    }
  }

  // ── Ciclocross ──────────────────────────────────────────────────
  // La temporada CX en curso se lee de una vez; «Cargar más» amplía en
  // memoria la ventana de días mostrados, como el feed de carretera.
  const CX_WINDOW_DAYS = 14;
  const addDays = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  let cxRounds = null, cxEntries = null, cxFromKey = addDays(todayKey, -(CX_WINDOW_DAYS - 1)), cxRequest = 0, cxLoading = false;
  // Como en carretera: la primera lectura ancla la ventana en el último día
  // con resultados (como mucho, hoy).
  let cxAnchored = false;
  // Sondeo: marca de agua = última importación de resultados leída antes de
  // descargar la temporada (como `feedWatermark` en carretera).
  let cxWatermark = null, cxLoadedAt = 0, cxProbing = false;
  // Equipo del ganador de cada categoría (`${raceId}:${category}`), leído de
  // cx_results con UNA consulta por lotes antes de pintar las pruebas de la
  // ventana: ganadores y equipos aparecen a la vez.
  const cxTeams = new Map(), cxTeamsAsked = new Set();

  // Inicio de lo que se muestra: la ventana o, si deja menos de RESULTS_MIN_DAYS
  // días que pasen los filtros, el día número RESULTS_MIN_DAYS más reciente.
  const cxStartKey = entries => resultsStartKey(cxVisible(entries || []).map(e => e.date), cxFromKey);

  function renderCx(entries) {
    const matching = cxVisible(entries);
    const start = cxStartKey(entries);
    const visible = matching.filter(e => e.date >= start);
    let html = visible.length ? cxDaysHtml(visible, cxRounds, _isEn, locale, cxTeams)
      : entries.length && filtersActive(cxGroups, cxFilters) ? filteredEmptyHtml() : cxEmptyHtml(entries.length > 0, _isEn);
    if (matching.some(e => e.date < start)) html += feedMoreHtml('cxMoreBtn', _isEn);
    paint(html);
    packCxDays(content);
    content.querySelector('#cxMoreBtn')?.addEventListener('click', async () => {
      cxFromKey = addDays(cxStartKey(cxEntries), -CX_WINDOW_DAYS);
      await loadCxTeams();
      if (activeView !== 'cx' || !content.isConnected) return;
      const y = window.scrollY;
      renderCx(cxEntries);
      window.scrollTo(0, y);
    });
  }

  // Equipos de los ganadores de la ventana que aún no se han pedido; quien
  // llama pinta después. Un fallo deja las tarjetas sin equipo.
  async function loadCxTeams() {
    // Clave por ganador: si un refresco cambia el ganador de una categoría, se
    // vuelve a pedir su equipo.
    const askKey = (e, c) => `${e.race.id}:${c.category}#${c.winnerName}`;
    const start = cxStartKey(cxEntries);
    const pending = (cxEntries || []).filter(e => e.date >= start && e.categories.some(c => !cxTeamsAsked.has(askKey(e, c))));
    if (!pending.length) return false;
    pending.forEach(e => e.categories.forEach(c => {
      if (cxTeamsAsked.has(askKey(e, c))) return;
      cxTeamsAsked.add(askKey(e, c));
      cxTeams.delete(`${e.race.id}:${c.category}`);   // el equipo del ganador anterior ya no vale
    }));
    const found = await resolveCxWinnerTeams(supabase, pending);
    let added = false;
    found.forEach((team, key) => { if (cxTeams.get(key) !== team) { cxTeams.set(key, team); added = true; } });
    return added;
  }

  async function loadCx({ refresh = false } = {}) {
    const request = ++cxRequest;
    cxLoading = true;
    if (!refresh && !cxEntries) {
      paint(loadingHtml(_isEn ? 'Loading results' : 'Cargando resultados'));
    }
    try {
      const season = cxSeason();
      // Antes que las filas: una importación posterior queda por encima de la
      // marca de agua y la recoge el siguiente sondeo.
      const imported = await latestCxImport().catch(() => null);
      const [allRows, rounds] = await Promise.all([cxSeasonRows(supabase, season), cxSeasonRounds(supabase, season).catch(() => null)]);
      const rows = allRows.filter(race => cxListedInAgenda(race, _isEn ? 'en' : 'es'));
      if (request !== cxRequest) return;
      cxWatermark = imported;
      cxLoadedAt = Date.now();
      cxRounds = rounds;
      const next = cxResultEntries(rows);
      if (!cxAnchored) {
        cxAnchored = true;
        const last = next.reduce((max, entry) => (entry.date <= todayKey && entry.date > max ? entry.date : max), '');
        if (last) cxFromKey = addDays(last, -(CX_WINDOW_DAYS - 1));
      }
      const changed = !cxEntries || JSON.stringify(next) !== JSON.stringify(cxEntries);
      cxEntries = next;
      // Equipos de la ventana antes de pintar: llegan con los ganadores.
      const teamsChanged = await loadCxTeams();
      if (request !== cxRequest) return;
      if (activeView === 'cx' && (changed || teamsChanged)) renderCx(cxEntries);
    } catch (error) {
      if (request !== cxRequest || activeView !== 'cx') return;
      console.error('[resultados-feed] ciclocross', error);
      if (cxEntries) renderCx(cxEntries);
      else paint('');
      const note = document.createElement('div'); note.className = 'res-update-note'; note.setAttribute('role', 'status');
      note.innerHTML = `${cxEntries ? (_isEn ? 'Unable to update · Saved results' : 'No se pudo actualizar · Datos conservados') : (_isEn ? 'Unable to load results' : 'No se pudieron cargar los resultados')} <button type="button">${_isEn ? 'Retry' : 'Reintentar'}</button>`;
      content.append(note);
      note.querySelector('button').onclick = () => loadCx({ refresh: true });
    } finally { if (request === cxRequest) cxLoading = false; }
  }
  // Sondeo ligero, como en carretera: la temporada solo se recarga si hubo una
  // importación de resultados posterior a la última lectura o, como red de
  // seguridad ante cambios sin importación (cancelaciones, altas), pasados
  // CX_FULL_REFRESH_MS.
  async function refreshCx() {
    if (document.hidden || activeView !== 'cx' || cxLoading || cxProbing || !content.isConnected) return;
    cxProbing = true;
    try {
      const now = Date.now();
      const stale = !cxEntries || now - cxLoadedAt >= CX_FULL_REFRESH_MS;
      const newest = stale ? null : await latestCxImport();
      if (cxFeedNeedsReload({ watermark: cxWatermark, newest, loadedAt: cxLoadedAt, now: Date.now() }) && !cxLoading) loadCx({ refresh: true });
    } catch { /* Sin red: se conserva el feed visible hasta la siguiente lectura. */ }
    finally { cxProbing = false; }
  }
  if (views.includes('cx')) {
    const cxTimer = setInterval(refreshCx, 60000);
    document.addEventListener('visibilitychange', refreshCx);
    window.addEventListener('pagehide', () => { clearInterval(cxTimer); document.removeEventListener('visibilitychange', refreshCx); }, { once: true });
  }

  if (activeView === 'cx') loadCx();
  else if (activeView === 'ranking') renderRankingOrLoad();
  else loadFeed();
}
