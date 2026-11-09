// ─────────────────────────────────────────────────────────────────
//  TEMPORADA — temporada.html
// ─────────────────────────────────────────────────────────────────

import { supabase, setMeta, setMetaProperty, initPhTooltip, bulkCacheRaces,
         getPinnedFilter, renderFilterPins, handleFilterEvent, setPressed }
         from './shared.js';
import { S, _getFilteredData, tCountryName, temporadaCountries, temporadaListHtml } from './temporada-html.js';
import { t, initI18n, getLang } from './i18n.js';
import { readCalendarMonth } from './calendario-query.js';
import { seasonCalendarYear } from './services/today-season.js';
import { fetchAllRowsParallel } from './services/paged-query.js';
import { staleWhileRevalidate } from './services/local-cache.js';
import { PROFILE_PROBE_COLUMN } from './stage/profile-availability.js';
initI18n(); // carga el diccionario EN en paralelo con los datos
import { openRaceDataModal } from './race-data-modal.js';
import { isOnChampionshipsPage } from './campeonatos-config.js';




// ── Estado ───────────────────────────────────────────────────────
const _navOnLoad = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
S.expandedChallenges = new Set(_navOnLoad.from === 'temporada' ? _navOnLoad.expanded : []);
// Año por defecto: el siguiente tras el cierre de la temporada de carretera
// (services/today-season.js).
const _now = new Date();
S.activeYear = seasonCalendarYear(`${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`);
window._icalYear = S.activeYear;
S.activeCat = getPinnedFilter() || 'all';

let _pendingMonth  = null;       // ?mes= / ?month=: mes al que se desplaza la primera pintura

// ── Carga inicial ────────────────────────────────────────────────
async function init() {
  // Leer año y filtro de categoría de la URL si vienen como parámetros
  const params = new URLSearchParams(location.search);
  if (params.get('year')) S.activeYear = parseInt(params.get('year'));
  if (params.get('cat'))  S.activeCat  = params.get('cat');
  // Mes de la URL (compartido con la subvista Mes): fija el año si no viene
  // ?year y desplaza la primera pintura a ese mes.
  const mesParam = readCalendarMonth(params);
  if (mesParam) {
    _pendingMonth = mesParam;
    if (!params.get('year')) S.activeYear = Number(mesParam.slice(0, 4));
  }
window._temporadaCat = S.activeCat;

  // Actualizar el label del nav con el año activo
  document.querySelectorAll('#navTemporadaLabel').forEach(el => {
    el.textContent = S.activeYear;
  });

  // Poblar selector de años (rango fijo para evitar consulta extra)
  const currentYear = new Date().getFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1].filter(y => y >= 2026).sort((a, b) => b - a);
  if (!years.includes(S.activeYear)) years.unshift(S.activeYear);
  years.sort((a, b) => b - a);
  const yearSel = document.getElementById('filterYear');
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === S.activeYear) opt.selected = true;
    yearSel.appendChild(opt);
  });

  yearSel.addEventListener('change', async () => {
    S.activeYear = parseInt(yearSel.value);
  window._icalYear = S.activeYear;
    document.querySelectorAll('#navTemporadaLabel').forEach(el => el.textContent = S.activeYear);
    await reloadYear();
  });

  // Selector de mes → scroll al bloque correspondiente
  document.getElementById('filterMonth').addEventListener('change', function () {
    const m = this.value;
    if (!m) return;
    const id = `mes-${S.activeYear}-${m}`;
    const el = document.getElementById(id);
    if (el) {
      const stickyH = document.querySelector('.temporada-filters')?.offsetHeight || 0;
      const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
      const top = el.getBoundingClientRect().top + window.scrollY - headerH - stickyH - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    // Resetear el select para que se pueda volver a pulsar el mismo mes
    this.value = '';
  });

  // Filtros de categoría
  // Sincronizar botones de filtro con el estado inicial (puede venir de URL o pin)
  const filterCats = document.getElementById('filterCats');
  filterCats.querySelectorAll('.tcat-btn').forEach(b => {
    setPressed(b, b.dataset.cat === S.activeCat);
  });
  renderFilterPins(filterCats, S.activeCat);

  const onTempFilterEvent = e => {
    const res = handleFilterEvent(e);
    if (!res) return;
    if (res.type === 'pin') {
      renderFilterPins(filterCats, S.activeCat);
      return;
    }
    S.activeCat = res.cat;
    window._temporadaCat = S.activeCat;
    filterCats.querySelectorAll('.tcat-btn').forEach(b =>
      setPressed(b, b.dataset.cat === S.activeCat)
    );
    renderFilterPins(filterCats, S.activeCat);
    render();
  };
  filterCats.addEventListener('click', onTempFilterEvent);
  filterCats.addEventListener('keydown', onTempFilterEvent);

  const filterCountrySel = document.getElementById('filterCountry');
  if (filterCountrySel) {
    filterCountrySel.addEventListener('change', () => {
      S.activeCountry = filterCountrySel.value;
      render();
    });
  }

  // Delegación de clics para filas de clásicas con datos pero sin jornada clicable
  document.getElementById('temporadaContent').addEventListener('click', e => {
    const el = e.target.closest('.t-race--modal');
    if (!el) return;
    const rdId   = el.dataset.rdid;
    const raceId = el.dataset.raceid;
    if (!rdId || !raceId) return;
    const raceObj = S.allRaces.find(r => r.id === raceId);
    if (raceObj) openRaceDataModal(rdId, raceObj);
  });

  // Desplegar o plegar un challenge
  document.getElementById('temporadaContent').addEventListener('click', e => {
    const el = e.target.closest('.t-race--challenge');
    if (el) toggleChallenge(el);
  });

  // Guardar estado de navegación (incluido scroll) al salir a una carrera
  document.getElementById('temporadaContent').addEventListener('click', e => {
    if (e.target.closest('.t-race:not(.t-race--challenge)')) {
      sessionStorage.setItem('cc_nav', JSON.stringify({
        from: 'temporada', year: S.activeYear, cat: S.activeCat,
        scrollY: Math.round(window.scrollY),
        expanded: [...S.expandedChallenges],
      }));
    }
  });

  await loadYear();
}



function updateTemporadaCountrySelector(races) {
  const sel = document.getElementById('filterCountry');
  if (!sel) return;
  const codes = temporadaCountries(races);
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('season.countryPlaceholder')}</option>`;
  codes.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = tCountryName(code);
    sel.appendChild(opt);
  });
  if (prev && codes.includes(prev)) sel.value = prev;
  else if (prev) S.activeCountry = '';
}

// ── Recarga datos al cambiar de año ──────────────────────────────
async function reloadYear() {
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const content = document.getElementById('temporadaContent');
  content.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.season')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

  await loadYear();
}

// ── Carga del año: carreras, todas sus jornadas y challenges ──
// La respuesta de PostgREST tiene un tope de filas: carreras y jornadas se
// paginan con orden estable. Se pinta desde la copia local y se revalida
// contra la red.
const SEASON_RACE_COLUMNS = 'id,name,nameEn,slug,slugEn,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,colorHex,logoUrl,hideFlag,isCancelled,isNoClickable,websiteUrl';
// Lo que leen renderRaceRow y hasModalData; el modal pide la jornada completa.
const SEASON_DAY_COLUMNS = `id,raceId,dateKey,slug,slugEn,hasAssets,profileNotViewable,${PROFILE_PROBE_COLUMN},startLocation,distanceKm,primaryType,neutralStartTimeUtc,estimatedFinishTimeUtc,tvStatus,description,notes`;

// De los textos solo importa si existen (hasModalData): la copia local no los guarda.
const withoutTexts = day => ({ ...day, description: day.description ? '1' : null, notes: day.notes ? '1' : null });

async function fetchSeasonBundle(year) {
  const [races, days, groups] = await Promise.all([
    fetchAllRowsParallel(() => supabase.from('races').select(SEASON_RACE_COLUMNS).eq('year', year).order('id')),
    fetchAllRowsParallel(() => supabase.from('race_days').select(SEASON_DAY_COLUMNS)
      .eq('editorialStatus', 'published').gte('dateKey', `${year}-01-01`).lte('dateKey', `${year}-12-31`).order('id')),
    supabase.from('challenge_groups').select('*').then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  ]);
  return { races, days: days.map(withoutTexts), groups };
}

// Vuelca un lote en el estado.
function applySeasonBundle({ races, days, groups }) {
  const raceCacheMap = {};
  races.forEach(r => { raceCacheMap[r.id] = r; });
  bulkCacheRaces(raceCacheMap);

  const daysByRace = {};
  days.forEach(day => {
    if (day.raceId) (daysByRace[day.raceId] ||= []).push(day);
  });
  races.forEach(r => { r._days = daysByRace[r.id] || []; });

  // Incluir races con jornadas publicadas, con startDate/endDate definidos, o placeholders
  S.allRaces = races.filter(r => r._days.length > 0 || r.startDate || r.isPlaceholder === true);

  // Challenge_groups con las races que ya tenemos en memoria
  S.allChallengeGroups = groups.map(d => {
    const raceIds = Array.isArray(d.raceIds) ? d.raceIds : [];
    return { ...d, _races: S.allRaces.filter(r => raceIds.includes(r.id)) };
  }).filter(cg => cg._races.length > 0);
}

async function loadYear() {
  const year = S.activeYear;
  let painted = false;
  await staleWhileRevalidate(`temporada:${year}`, () => fetchSeasonBundle(year), bundle => {
    if (year !== S.activeYear) return;
    applySeasonBundle(bundle);
    render({ refresh: painted });
    painted = true;
  });
}

// ── Render ───────────────────────────────────────────────────────
// `refresh`: repintado por revalidación en segundo plano; conserva el scroll
// y no repite el desplazamiento inicial ni la analítica.
function render({ refresh = false } = {}) {
  const content = document.getElementById('temporadaContent');
  const keepScrollY = refresh ? window.scrollY : null;

  // Poblar selector de país con las carreras del año (antes del filtro de país)
  updateTemporadaCountrySelector(S.allRaces.filter(r => (r.year || 0) === S.activeYear && !isOnChampionshipsPage(r)));

  const { standaloneRaces, challengeGroups } = _getFilteredData();

  if (!standaloneRaces.length && !challengeGroups.length) {
    content.innerHTML = '<div class="empty-state"><p class="empty-state__text">No hay carreras para los filtros seleccionados.</p></div>';
    return;
  }

  const html = temporadaListHtml();
  content.innerHTML = html;

  // Altura de los filtros para el sticky de mes; la cabecera la aporta --site-header-h,
  // que vale 0 cuando la cabecera se desplaza con la página (móvil).
  function updateMonthStickyTop() {
    const filters = document.getElementById('temporadaFilters');
    const fH = filters ? filters.offsetHeight : 0;
    document.documentElement.style.setProperty('--temporada-filters-h', `${fH}px`);
  }
  updateMonthStickyTop();
  // Recalcular si cambia tamaño (wrap de filtros en móvil)
  if (window._temporadaResizeObs) window._temporadaResizeObs.disconnect();
  const filtersEl = document.getElementById('temporadaFilters');
  if (filtersEl && window.ResizeObserver) {
    window._temporadaResizeObs = new ResizeObserver(updateMonthStickyTop);
    window._temporadaResizeObs.observe(filtersEl);
  }

  if (refresh) {
    window.scrollTo({ top: keepScrollY, behavior: 'instant' });
    return;
  }

  // ── Restaurar scroll o scroll inteligente ────────────────────────
  const navState = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const savedScrollY = navState.from === 'temporada' && typeof navState.scrollY === 'number'
    ? navState.scrollY : null;

  // Limpiar scrollY del estado para que solo se restaure una vez
  if (savedScrollY !== null) {
    const cleaned = { ...navState };
    delete cleaned.scrollY;
    sessionStorage.setItem('cc_nav', JSON.stringify(cleaned));
  }

  // El mes de la URL solo se aplica una vez: los re-render por filtro
  // conservan el comportamiento habitual.
  const pendingMonth = _pendingMonth;
  _pendingMonth = null;

  if (savedScrollY !== null) {
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
  } else if (pendingMonth && document.getElementById(`mes-${pendingMonth}`)) {
    const el = document.getElementById(`mes-${pendingMonth}`);
    const stickyH = document.querySelector('.temporada-filters')?.offsetHeight || 0;
    const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
    const top = el.getBoundingClientRect().top + window.scrollY - headerH - stickyH - 8;
    window.scrollTo({ top, behavior: 'instant' });
  } else if (S.activeYear === new Date().getFullYear()) {
    // Al día de hoy, en el año en curso.
    const todayFull = new Date().toISOString().slice(0, 10);
    const header     = document.querySelector('.site-header');
    const filters    = document.getElementById('temporadaFilters');
    const monthTitle = document.querySelector('.temporada-month__title');
    const isMobile   = window.innerWidth < 600;
    const offset  = (header     ? header.offsetHeight     : 0)
                  + (filters    ? filters.offsetHeight    : 0)
                  + (monthTitle ? monthTitle.offsetHeight : 0)
                  + (isMobile ? 4 : 8);
    const target = [...content.querySelectorAll('[data-sortkey]')].find(el => (el.dataset.endkey || el.dataset.sortkey) >= todayFull)
      || document.getElementById(`mes-${todayFull.slice(0, 7)}`);
    if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
  }

  updateSeoTemporada(S.activeYear);
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
}


// Despliega o pliega un grupo sin repintar la lista.
function toggleChallenge(button) {
  const id = button.dataset.cgid;
  const open = !S.expandedChallenges.has(id);
  if (open) S.expandedChallenges.add(id); else S.expandedChallenges.delete(id);
  button.setAttribute('aria-expanded', String(open));
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (panel) panel.hidden = !open;
}

initPhTooltip();


init().then(() => {
}).catch(err => {
  document.getElementById('temporadaContent').innerHTML =
    `<div class="empty-state"><p class="empty-state__text">Error al cargar la temporada.</p></div>`;
  console.error(err);
});

// ── SEO ──────────────────────────────────────────────────────────
function updateSeoTemporada(year) {
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';

  const isEn        = getLang() === 'en';
  const title       = `${isEn ? 'Season' : 'Temporada'} ${year} - ${t('seo.siteName')}`;
  const description = isEn
    ? `All races of the ${year} season, with their routes, schedules, dates and how to watch on TV.`
    : `Listado con todas las carreras de la temporada ${year}, con acceso a la información sobre sus recorridos, horarios, fechas y cómo ver por TV.`;
  const keywords    = [BASE_KW, `temporada ${year}`, `ciclismo ${year}`, `carreras ciclismo ${year}`, String(year)].join(', ');

  document.title = title;
  setMeta('description', description);
  setMeta('keywords', keywords);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
}
