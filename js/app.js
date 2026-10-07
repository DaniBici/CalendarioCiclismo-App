import {dateNavigationButton} from './components/date-navigation.js';
import { loadFeaturedRaces, todayRaceState, startlistCyclistHtml } from './services/race-presentation.js';
// ─────────────────────────────────────────────────────────────────
//  APP PÚBLICA — index.html
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, formatTime, formatTimeUser,
         stageLabel,
         countryFlag, effectiveCountryCode, resolveTypeBadges,
         categoryBadge, raceUrl, raceName, rdLocation, setMeta, setMetaProperty,
         setCachedRace, tsSeconds, initPhTooltip, needsFemaleMark, cleanFeminineName,
         getPinnedFilter, renderFilterPins, handleFilterEvent,
         filterBroadcastsByRegion, startlistUrl, startOrderUrl,
         setPressed, announce }
         from './shared.js';
import { isTourDelPorvenir } from './category-filter.js';
import { t, initI18n, getLocale, getLang } from './i18n.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
initI18n(); // carga el diccionario EN en paralelo con los datos
import { annotateDoubleSectors } from './services/races.js';
import { openRaceDataModal, hasModalData, openResultsModal, openBroadcastTvModal, openYoutubeTvModal, loadInhouseStageSet } from './race-data-modal.js';
import { createRaceCard, cardLogoHtml, overviewButtonHtml, raceCardHtml, setInfoTooltip } from './components/race-card.js';
import { tvIconHtml, noExtraInfoMessage, stageRouteText, formatStageMetrics, stageSubHtml, stageIsClickable,
         startOrderBadgeHtml, scheduleHtml, appendProfile, appendResultsActions, activateStageCard } from './components/stage-card.js';
import { initCintillo } from './cintillo.js';
import { championshipMatchesCategoryFilter,
         isChampWeekFilterLock, CHAMP_WEEK_HOY_FILTERS, champWeekHoyDefault } from './campeonatos-config.js';
import { pickBadgeBroadcast } from './broadcast-priority.js';
import { agendaCardIsFeatured, agendaMetaState } from './services/today-agenda-layout.js';
import { sortAgenda } from './services/today-agenda-order.js';
import { todaySeasonLastDay, clampToTodaySeason, isWithinTodaySeason } from './services/today-season.js';

// ── Progress bar / elevation sparkline en cards de carrera en curso ─
let _progressCards = [];
let _progressTimer = null;

function _updateProgressCards() {
  if (document.hidden) return;
  const now = Date.now();
  _progressCards = _progressCards.filter(({ card, startMs, endMs, clipRect }) => {
    if (now >= endMs) {
      if (clipRect) clipRect.setAttribute('width', '100');
      else card.style.removeProperty('--progress');
      return false;
    }
    const pct = Math.max(0, Math.min(100, Math.round((now - startMs) / (endMs - startMs) * 100)));
    if (clipRect) clipRect.setAttribute('width', `${pct}`);
    else card.style.setProperty('--progress', `${pct}%`);
    return true;
  });
  if (_progressCards.length === 0) {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }
}

const _liveTextSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>';
const _cyclistSvg = startlistCyclistHtml;

function tvBadgeCard(tvStatus, broadcasts, neutralStartTs, liveTextUrl, regionBlocked = false) {
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para que se muestren los broadcasts (filtrados
  // por región) o nada si no hay ninguno.
  if (tvStatus === 'unavailable_es' && getLang() === 'en') tvStatus = null;

  const nowMs = Date.now();
  const neutralMs = neutralStartTs
    ? (neutralStartTs.toDate ? neutralStartTs.toDate().getTime() : new Date(neutralStartTs).getTime())
    : null;
  const raceStarted = neutralMs !== null && nowMs >= neutralMs;
  const liveTextBadge = liveTextUrl
    ? `<a class="badge badge--livetext${raceStarted ? '' : ' badge--livetext--pre'}" href="${liveTextUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${_liveTextSvg} ${t('assets.live_text')}</a>`
    : '';

  if (!tvStatus && !(broadcasts && broadcasts.length)) {
    return liveTextBadge;
  }

  if (tvStatus === 'none') {
    if (liveTextBadge) return liveTextBadge;
    return `<span class="badge badge--notv">${t('tv.status.none')}</span>`;
  }
  if (tvStatus === 'unavailable_es') {
    if (liveTextBadge) return liveTextBadge;
    return `<span class="badge badge--notv-es"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><line x1="3" y1="2" x2="21" y2="18"/></svg> ${t('tv.status.unavailable_es')}</span>`;
  }
  if (tvStatus === 'pending') {
    if (liveTextBadge) return liveTextBadge;
    return `<span class="badge badge--pend"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ${t('tv.status.pending')}</span>`;
  }

  // Cobertura confirmada (tvStatus) pero TODA la TV es de fuera de la región del
  // usuario (sus broadcasts se filtraron por región) → no hay emisión accesible:
  // NO mostramos el badge "TV" genérico (mantenemos el live texto si lo hubiera).
  // Solo aplica cuando había broadcasts y ninguno sobrevivió al filtro; sin
  // broadcasts el badge "TV" sigue saliendo de tvStatus (cobertura sin canal aún).
  if (regionBlocked && !(broadcasts && broadcasts.length)) return liveTextBadge;

  // Enlace del badge: una emisión YA EN DIRECTO gana a una que aún no ha empezado
  // (aunque esta sea de mayor tier), luego tier (YouTube > redes > RTVE.es > resto)
  // y sortOrder. Ver `pickBadgeBroadcast`. Espejo iOS/Android.
  const linkBc = pickBadgeBroadcast(broadcasts, tsSeconds, nowMs / 1000);
  const singleUrl = linkBc ? linkBc.url : null;
  const broadcastEmbed = getBroadcastEmbed(singleUrl, linkBc?.embeddable);
  const wrapTv = (content, liveClass) => {
    const extra = liveClass ? ' badge--tv--live' : '';
    return singleUrl
      ? `<a class="badge badge--tv badge--tv-link${extra}" href="${singleUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()"${broadcastEmbed ? ' data-tv-embed="1"' : ''}>${content}</a>`
      : `<span class="badge badge--tv${extra}">${content}</span>`;
  };

  // Hora del badge = la emisión accesible que ANTES empieza (aunque el enlace
  // prioritario —p.ej. una pública— arranque más tarde): si una emisión global
  // (ALL) empieza antes que las de tu grupo, su hora manda. El ENLACE sigue por
  // prioridad de tier (YouTube > redes > pública > resto); solo se desacopla la
  // hora MOSTRADA de cuál es el enlace. Mismo criterio que `tvBadge` (race-assets).
  const refTs = (broadcasts || [])
    .filter(b => b.startTimeUtc)
    .sort((a, b) => (tsSeconds(a.startTimeUtc) ?? 0) - (tsSeconds(b.startTimeUtc) ?? 0))[0]
    ?.startTimeUtc ?? null;

  if (refTs) {
    const refMs = refTs.toDate ? refTs.toDate().getTime() : new Date(refTs).getTime();
    if (tvStatus === 'confirmed_time' && refMs <= nowMs) {
      return wrapTv(`${tvIconHtml} ${t('tv.live')}`, true);
    }
    // Si el broadcast de referencia empieza antes de la salida neutralizada → cobertura íntegra
    const label = (neutralMs !== null && refMs <= neutralMs) ? t('tv.fullStage') : formatTime(refTs);
    // Live texto junto al TV mientras la carrera ya empezó pero la TV sigue en reposo
    const liveTextAlongside = (liveTextBadge && raceStarted && refMs > nowMs) ? liveTextBadge : '';
    return wrapTv(`${tvIconHtml} ${label}`) + liveTextAlongside;
  }
  // Hay TV pero sin hora concreta
  return wrapTv(`${tvIconHtml} TV`);
}

// ── Render date bar ───────────────────────────────────────────────
const _urlDate = new URLSearchParams(window.location.search).get('date');
// `today` se recalcula bajo demanda (no es constante): un usuario que deja la
// pestaña abierta y cruza la medianoche LOCAL debe ver el día nuevo. Ver
// `todayKeyNow()` y el auto-avance de medianoche más abajo.
let today = toDateKey(new Date());
function todayKeyNow() { return toDateKey(new Date()); }
// Día que representa "hoy" en la agenda: tras el cierre de temporada es el
// último día navegable (services/today-season.js).
function agendaTodayKey() { return clampToTodaySeason(today, today); }
let currentDateKey = clampToTodaySeason((_urlDate && /^\d{4}-\d{2}-\d{2}$/.test(_urlDate)) ? _urlDate : today, today);

function buildDateBar() {
  const bar = document.getElementById('dateBar');

  // 7 días centrados en el día activo (3 antes + activo + 3 después). Cerca
  // del último día de temporada la tira se desplaza para terminar en él: no
  // se ofrece ningún día posterior.
  const [cy, cm, cd] = currentDateKey.split('-').map(Number);
  const center = new Date(cy, cm - 1, cd);
  const seasonLastDay = todaySeasonLastDay(today);
  let firstOffset = -3;
  while (firstOffset > -6 && seasonLastDay) {
    const last = new Date(center);
    last.setDate(center.getDate() + firstOffset + 6);
    if (toDateKey(last) <= seasonLastDay) break;
    firstOffset--;
  }
  const days = [];
  for (let i = firstOffset; i <= firstOffset + 6; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + i);
    days.push(toDateKey(d));
  }

  bar.innerHTML = '';

  // ── Controles izquierdos (fuera del scroll) ──────────────────────
  const leftSection = document.createElement('div');
  leftSection.className = 'date-bar__left';

  const prevBtn=dateNavigationButton({kind:'arrow',direction:'prev',label:t('today.prevDayLabel')});
  prevBtn.addEventListener('click', () => {
    const prev = findPrevDayWithRaces(currentDateKey, _agendaCat);
    if (prev) { loadDay(prev); return; }
    const [y, m, d] = currentDateKey.split('-').map(Number);
    loadDay(toDateKey(new Date(y, m - 1, d - 1)));
  });
  leftSection.appendChild(prevBtn);

  const todayKey = agendaTodayKey();
  const todayBtn=dateNavigationButton({kind:'today',visible:currentDateKey!==todayKey,label:t('today.todayBtn')});
  todayBtn.addEventListener('click', () => { currentDateKey = todayKey; buildDateBar(); loadDay(todayKey); });
  leftSection.appendChild(todayBtn);

  bar.appendChild(leftSection);

  // ── Tira de pastillas (scroll) ───────────────────────────────────
  const pillsWrap = document.createElement('div');
  pillsWrap.className = 'date-bar__pills-wrap';

  const pillsInner = document.createElement('div');
  pillsInner.className = 'date-bar__pills';

  days.forEach(dk => {
    const [y, m, d] = dk.split('-').map(Number);
    const date  = new Date(y, m - 1, d);
    // Un solo formato en todos los anchos: abreviatura sobre el número.
    let wdShort = date.toLocaleDateString(getLocale(), { weekday: 'short' }).replace(/\.$/, '');
    wdShort = wdShort.charAt(0).toUpperCase() + wdShort.slice(1);
    const dayNum = date.toLocaleDateString(getLocale(), { day: 'numeric' });

    const pill=dateNavigationButton({kind:'pill',label:dk,selected:dk===currentDateKey,isToday:dk===today});
    // «Lun 12» no dice ni el mes ni cuál es el día seleccionado: el nombre
    // accesible lleva la fecha completa y aria-current marca el activo.
    pill.setAttribute('aria-label', date.toLocaleDateString(getLocale(),
      { weekday: 'long', day: 'numeric', month: 'long' }));
    if (dk === currentDateKey) pill.setAttribute('aria-current', 'date');
    pill.innerHTML = `<span class="date-pill__wd" aria-hidden="true">${wdShort}</span><span class="date-pill__num" aria-hidden="true">${dayNum}</span>`;
    pill.dataset.dk = dk;
    pill.addEventListener('click', () => loadDay(dk));
    pillsInner.appendChild(pill);
  });

  pillsWrap.appendChild(pillsInner);
  bar.appendChild(pillsWrap);

  // ── Controles derechos (fuera del scroll) ────────────────────────
  const rightSection = document.createElement('div');
  rightSection.className = 'date-bar__right';

  const nextBtn=dateNavigationButton({kind:'arrow',direction:'next',label:t('today.nextDayLabel')});
  nextBtn.disabled = !canGoToNextDay();
  nextBtn.addEventListener('click', () => {
    const next = nextNavigableDay(currentDateKey);
    if (next) loadDay(next);
  });
  rightSection.appendChild(nextBtn);

  bar.appendChild(rightSection);

  // Centrar el día activo en el scroll
  requestAnimationFrame(() => {
    const activePill = pillsInner.querySelector('.date-pill.active');
    if (activePill) {
      const innerRect = pillsInner.getBoundingClientRect();
      const pillRect  = activePill.getBoundingClientRect();
      pillsInner.scrollLeft += (pillRect.left - innerRect.left) - (innerRect.width / 2) + (pillRect.width / 2);
    }
  });
}


// ── Cargar jornadas de un día ─────────────────────────────────────
// skipEmptyDay: si true, salta automáticamente al siguiente día con carreras
// cuando el día no tiene actividad. Solo debe ser true en la carga inicial.
let dayRequest = 0;
let dayLoading = false;
async function loadDay(dateKey, { skipEmptyDay = false, refresh = false } = {}) {
  const request = ++dayRequest;
  dayLoading = true;
  clearInterval(_progressTimer);
  _progressTimer = null;
  _progressCards = [];
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  dateKey = clampToTodaySeason(dateKey, today);
  currentDateKey = dateKey;
  // Reevaluar el bloqueo de filtros de Campeonatos contra la jornada mostrada
  // (puede entrar/salir de la ventana al navegar). Ajusta `_agendaCat` y los
  // chips ANTES de filtrar las cards de abajo; sin re-entrada en loadDay.
  applyChampWeekLock(dateKey);
  buildDateBar();

  // Actualizar URL sin recargar
  const newUrl = dateKey === today
    ? window.location.pathname
    : `${window.location.pathname}?date=${dateKey}`;
  history.replaceState(null, '', newUrl);

  const list  = document.getElementById('raceList');

  // Actualizar document.title ya, sin esperar a Firestore
  updateSeoDay(dateKey, []);

  // ── Modo Campeonatos: la vista Hoy NO se transforma y las carreras de
  // Campeonatos Nacionales (uciCategory='CN') se muestran como cualquier otra
  // carrera del día (tarjetas normales). La rejilla país×prueba sigue accesible
  // aparte, pero no sustituye ni oculta nada en Hoy.

  // El texto pre-renderizado (oculto) sale de la lista para no perderse al pintarla.
  const prerender = list.querySelector('.static-prerender');
  if (prerender) list.after(prerender);

  if (!refresh) list.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.stages')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

  try {
    // Estas dos lecturas no dependen de las jornadas del día: iniciarlas ya
    // evita dos esperas en serie antes del primer render de la agenda.
    const currentYear = parseInt(dateKey.slice(0, 4));
    const yearRacesPromise = ensureYearRacesCached(currentYear);
    const activeRacesPromise = fetchActiveRaces(dateKey);
    const { data: rdData, error: dayError } = await supabase.from('race_days').select('*').eq('dateKey', dateKey).eq('editorialStatus', 'published');

    if (dayError) throw dayError;
    if (request !== dayRequest) return;

    // Cargar datos de carrera y broadcasts para cada jornada (en paralelo)
    const raceDays = rdData || [];
    const raceIds = [...new Set(raceDays.map(rd => rd.raceId).filter(Boolean))];
    const rdIds = raceDays.map(rd => rd.id);

    const [racesResult, bcastResult, assetsResult, inhouseSet, featured] = await Promise.all([
      raceIds.length ? supabase.from('races').select('*').in('id', raceIds) : Promise.resolve({ data: [] }),
      rdIds.length ? supabase.from('broadcasts').select('*').in('raceDayId', rdIds).order('sortOrder', { ascending: true }) : Promise.resolve({ data: [] }),
      rdIds.length ? supabase.from('assets').select('id,raceDayId,type,url').in('raceDayId', rdIds) : Promise.resolve({ data: [] }),
      loadInhouseStageSet(raceIds),
      loadFeaturedRaces(supabase, [dateKey]),
    ]);

    if (request !== dayRequest) return;
    for (const result of [racesResult,bcastResult,assetsResult]) if (result.error) throw result.error;
    const raceMap = {};
    (racesResult.data || []).forEach(r => { raceMap[r.id] = r; setCachedRace(r.id, r); });
    const bcastByRd = {};
    (bcastResult.data || []).forEach(b => { (bcastByRd[b.raceDayId] = bcastByRd[b.raceDayId] || []).push(b); });
    const assetsByRd = {};
    (assetsResult.data || []).forEach(a => { (assetsByRd[a.raceDayId] = assetsByRd[a.raceDayId] || []).push(a); });
    raceDays.forEach(rd => {
      if (rd.raceId) rd._race = raceMap[rd.raceId] || {};
      const _allB = bcastByRd[rd.id] || [];
      rd._broadcasts = filterBroadcastsByRegion(_allB);
      // Había TV pero ninguna emisión sobrevive al filtro regional → el usuario no
      // puede acceder a ninguna (badge de TV suprimido aunque tvStatus diga lo contrario).
      rd._tvBlocked = _allB.length > 0 && rd._broadcasts.length === 0;
      rd._assets = assetsByRd[rd.id] || [];
      rd._hasInhouse = inhouseSet.has(rd);
      rd._featured = featured.get(dateKey)?.has(rd.raceId) || false;
    });

    // Detectar dobles sectores (misma carrera, mismo día, mismo stageNumber).
    annotateDoubleSectors(raceDays);

    // ⚠️ NO vaciar la lista aquí: por debajo quedan awaits (ensureYearRacesCached,
    // loadPlaceholders) que NO mutan el DOM. Si se limpia antes, el overlay de
    // carga (js/page-loading.js) ve el contenedor sin marcador .loading y sin
    // mutaciones durante SETTLE_MS → se desvanece sobre una lista VACÍA y las
    // cards aparecen después, con la página ya destapada. El marcador se
    // conserva hasta el instante en que hay algo que pintar.

    // Carreras del año para la navegación que respeta el filtro activo.
    await yearRacesPromise;
    // Placeholders: carreras en curso sin jornada publicada ese día.
    const placeholders = await loadPlaceholders(dateKey, raceDays, activeRacesPromise);
    if (request !== dayRequest) return;
    const dayItems = [...raceDays, ...placeholders.map(ph => ({ _placeholder: true, _race: ph, _phRace: ph }))];

    if (dayItems.length === 0) {
      // Buscar siguiente día con carreras (respetando filtro activo)
      const nextDateBtn = findNextDayWithRaces(dateKey, _agendaCat);
      if (skipEmptyDay && nextDateBtn) {
        loadDay(nextDateBtn);
        return;
      }
      // Auto-navegar si no hay items visibles. Solo con el filtro "Todas"
      // (evita saltos sorpresa cuando el usuario filtra a propósito), CON UNA
      // EXCEPCIÓN: dentro de la ventana de Campeonatos el filtro Masculino está
      // FORZADO (no lo eligió el usuario) y los días 22-23 no tienen carreras →
      // se auto-avanza igual al siguiente día con carreras masculinas.
      if ((_agendaCat === 'all' || _champLockOn) && nextDateBtn) {
        loadDay(nextDateBtn);
        return;
      }
      showEmptyDay(list, t('today.noRaces'), nextDateBtn);
      return;
    }

    const allItems = sortAgenda(applyAgendaFilters(dayItems), _agendaSort);

    updateSeoDay(dateKey, raceDays);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

    if (allItems.length === 0) {
      const nextFilteredDate = findNextDayWithRaces(dateKey, _agendaCat);
      // Dentro de la ventana de Campeonatos el filtro Masculino está FORZADO: si
      // este día no tiene carreras masculinas, auto-avanzar al siguiente que sí
      // (mismo trato que el filtro "Todas"; el escaneo respeta el filtro activo).
      if (_champLockOn && nextFilteredDate) {
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

const _emptyDayIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

function showEmptyDay(list, message, nextDateKey) {
  const nextBtn = nextDateKey
    ? `<button class="btn btn--ghost" style="margin-top:1rem" onclick="loadDay('${nextDateKey}')">${t('today.nextDay')}</button>`
    : '';
  list.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">${_emptyDayIcon}</div>
      <div class="empty-state__text">${message}</div>
      ${nextBtn}
    </div>`;
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
  const title = isEn ? 'Pro Cycling Races Today: Schedule, TV and Streaming — Calendario Ciclismo App' : 'Calendario Ciclismo App';
  const description = isEn
    ? 'All professional cycling races with schedule, route, profile and how to watch on TV and streaming.'
    : 'Todas las carreras ciclistas profesionales, con horario, recorrido, perfil y cómo ver por TV y online streaming. Una idea de Dani Sánchez.';

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

// Calcula si dateKey cae en el rango de la carrera y si es día de carrera
// Grand Tours (>13 días): descanso en lunes, pero en carreras de exactamente 22 días
// el primer lunes es etapa (solo 2 descansos: 2º y 3º lunes).
function mondayIndex(race, dateKey) {
  // Devuelve qué número de lunes es dateKey dentro de la carrera (1-based), o 0 si no es lunes
  const dow = new Date(dateKey + 'T12:00:00').getDay();
  if (dow !== 1) return 0;
  let count = 0;
  const start = new Date(race.startDate + 'T12:00:00');
  const target = new Date(dateKey + 'T12:00:00');
  for (let d = new Date(start); d <= target; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 1) count++;
  }
  return count;
}

function isRaceDay(race, dateKey) {
  if (!race.startDate || !race.endDate) return false;
  if (dateKey < race.startDate || dateKey > race.endDate) return false;

  const durationDays = (new Date(race.endDate) - new Date(race.startDate)) / 86400000 + 1;
  const isGrandTourFormat = race.raceFormat === 'stage_race' && durationDays > 13;

  if (isGrandTourFormat) {
    const mi = mondayIndex(race, dateKey);
    if (mi > 0) {
      // 22 días: descanso solo en el 2º y 3º lunes
      // 23+ días: descanso en todos los lunes
      if (durationDays <= 23 && mi === 1) return true; // primer lunes es etapa
      return false; // resto de lunes son descanso
    }
  }

  return true;
}

// Calcula el número de etapa teórico para una fecha dada
function theoreticalStageNumber(race, dateKey) {
  if (race.raceFormat === 'one_day') return null;

  const durationDays = (new Date(race.endDate) - new Date(race.startDate)) / 86400000 + 1;
  const isGrandTourFormat = race.raceFormat === 'stage_race' && durationDays > 13;

  let stage = 0;
  const start = new Date(race.startDate + 'T12:00:00');
  const target = new Date(dateKey + 'T12:00:00');

  for (let d = new Date(start); d <= target; d.setDate(d.getDate() + 1)) {
    const dk = toDateKey(d);
    if (isGrandTourFormat && !isRaceDay(race, dk)) continue;
    stage++;
  }
  return stage;
}

const ACTIVE_RACE_COLUMNS = 'id,name,nameEn,slug,slugEn,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,colorHex,logoUrl,hideFlag,isCancelled,isNoClickable';
const YEAR_NAV_COLUMNS = 'name,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,isCancelled';

function fetchActiveRaces(dateKey) {
  const currentYear = parseInt(dateKey.slice(0, 4));
  return Promise.resolve(supabase.from('races').select(ACTIVE_RACE_COLUMNS)
    .eq('year', currentYear).lte('startDate', dateKey).gte('endDate', dateKey));
}

async function loadPlaceholders(dateKey, existingRaceDays, racesPromise = fetchActiveRaces(dateKey)) {
  // IDs de carreras que ya tienen jornada publicada ese día
  const coveredIds = new Set(existingRaceDays.map(rd => rd.raceId).filter(Boolean));

  // Cargar solo las carreras activas en la fecha. Pedir todas las ediciones
  // anteriores desborda el límite de 1.000 filas de Supabase; además, sin un
  // orden explícito, una carrera actualizada puede salir del lote y perder su
  // placeholder aunque sus fechas sigan siendo correctas.
  const currentYear = parseInt(dateKey.slice(0, 4));
  const { data: racesData } = await racesPromise;

  const placeholders = [];
  for (const race of (racesData || [])) {
    if ((race.year || 0) !== currentYear) continue;
    if (coveredIds.has(race.id)) continue;
    if (race.isCancelled) continue;
    if (!isRaceDay(race, dateKey)) continue;
    placeholders.push({ ...race, _dateKey: dateKey });
  }
  return placeholders;
}

/** Carga y cachea todas las carreras del año para navegación filter-aware. */
let _cachedYear = null;
let _yearRacesRequest = null;
async function ensureYearRacesCached(year) {
  if (_cachedYear === year && _cachedYearRaces.length) return;
  if (_yearRacesRequest?.year === year) return _yearRacesRequest.promise;
  const promise = Promise.resolve(supabase.from('races').select(YEAR_NAV_COLUMNS).eq('year', year))
    .then(({ data }) => {
      _cachedYearRaces = data || [];
      _cachedYear = year;
    }).finally(() => { if (_yearRacesRequest?.promise === promise) _yearRacesRequest = null; });
  _yearRacesRequest = { year, promise };
  return promise;
}

// ── Tarjetas de la agenda ─────────────────────────────────────────
// Estructura común de components/race-card.js: logo | datos | horario, con el
// miniperfil como banda inferior. Las destacadas añaden la clase
// race-card--featured (orden y paridad con las apps); en la web no cambian de
// diseño. Carreras sin jornada, canceladas y días de descanso son
// la misma tarjeta con otro estado. El DOM no depende del ancho de pantalla.

const _overviewBtnHtml = race => race.raceFormat === 'stage_race' && race.startDate !== race.endDate && race.id && !race.isNoClickable
  ? overviewButtonHtml(raceUrl(race), t('race.viewFull'))
  : '';

const _shortDate = dateKey => dateKey
  ? new Date(dateKey + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  : '';

const _catBadgesHtml = (race, uci) => `<span class="race-card__name-cat">${categoryBadge(uci, needsFemaleMark(race, _agendaCat))}</span>`;

function buildPlaceholderCard(race) {
  const flag = race.hideFlag ? '' : countryFlag(race.countryCode);
  const name = cleanFeminineName(raceName(race) || t('race.unknown'), _agendaCat);
  const uci = race.uciCategory || '';
  const stage = race.raceFormat === 'stage_race' ? stageLabel(theoreticalStageNumber(race, race._dateKey)) : '';
  const card = createRaceCard(race.colorHex, 'race-card--placeholder');
  card.innerHTML = raceCardHtml({
    logo: cardLogoHtml(race.logoUrl, flag, race.hideFlag),
    name: `<span>${name}</span>`,
    sub: stage ? `<span class="race-card__stage">${stage}</span>` : '',
    badges: _catBadgesHtml(race, uci),
  });
  setInfoTooltip(card, {
    message: noExtraInfoMessage(race.startDate),
    name, flag,
    sub: [stage, _shortDate(race._dateKey), uci].filter(Boolean).join(' · '),
  });
  return card;
}

// ── Construir tarjeta ─────────────────────────────────────────────
function buildCard(rd) {
  const race = rd._race || {};
  const flag = countryFlag(effectiveCountryCode(rd, race));
  // El override de país de la jornada vence al hideFlag de la carrera:
  // si la jornada fija un país, se muestra bandera aunque la carrera la oculte.
  const hideFlag = race.hideFlag && !rd.countryCode;
  const name = cleanFeminineName(raceName(race) || t('race.unknown'), _agendaCat);
  const uci = race.uciCategory || '';
  const catBadgeHtml = _catBadgesHtml(race, uci);
  const isFinalStage = race.raceFormat === 'stage_race' && rd.stageNumber != null && !rd.isRestDay
    && !rd.isCancelledDay && !!rd.dateKey && rd.dateKey === race.endDate;
  const stage = stageLabel(rd.stageNumber, rd._stageSuffix, isFinalStage);
  const { km, elev } = formatStageMetrics(rd);
  const startTU = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  if (!rd._broadcasts) rd._broadcasts = [];
  const overviewBtn = _overviewBtnHtml({ ...race, id: rd.raceId });
  const logo = cardLogoHtml(race.logoUrl, flag, hideFlag);

  if (rd.isRestDay) {
    const card = createRaceCard(race.colorHex, 'race-card--rest-day');
    card.innerHTML = raceCardHtml({
      logo, name: `<span>${name}</span>${overviewBtn}`,
      sub: `<span class="race-card__stage">${t('stage.restDay')}</span>`,
      badges: catBadgeHtml,
    });
    return card;
  }

  if (race.isCancelled) {
    const card = createRaceCard(race.colorHex, 'race-card--placeholder race-card--cancelled');
    card.innerHTML = raceCardHtml({
      logo, name: `<span>${name}</span>`,
      badges: `${catBadgeHtml}<span class="badge badge--cancelled-day">${t('stage.cancelled')}</span>`,
    });
    setInfoTooltip(card, { message: t('race.cancelled'), name, flag: hideFlag ? '' : flag, sub: uci });
    return card;
  }

  const state = todayRaceState(rd);
  const showResults = state === 'results';
  const waiting = state === 'waiting';
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  const card = createRaceCard(race.colorHex);

  // Con «Hora Meta» la tarjeta programada muestra la llegada prevista.
  const metaState = agendaMetaState(_agendaSort === 'finishtime' && state === 'scheduled' ? 'running' : state,
    { start: startTU?.display ?? null, finish: finishTU?.display ?? null, lang: getLang(), isTimeTrial });

  // Fila de badges bajo el nombre, en orden iOS: Categoría → Cancelada → Tipo
  // (solo CRI/CRE: en el resto el perfil ya lo comunica) → TV → Inscritos →
  // Orden de salida. Una jornada cancelada no tiene tipo ni emisión.
  const typeBadgeHtml = isTimeTrial && !rd.isCancelledDay
    ? `<span class="race-card__types--inline">${resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode)}</span>` : '';
  const tvHtml = (showResults || waiting || rd.isCancelledDay) ? ''
    : tvBadgeCard(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd._tvBlocked);
  const isFirstOrOnlyDay = race.raceFormat !== 'stage_race' || rd.dateKey === race.startDate;
  // Crono de etapa única: el orden de salida sustituye a los dorsales.
  const isSingleTimeTrial = isTimeTrial && race.raceFormat !== 'stage_race';
  const startlistHtml = race.startlistImportedAt && !showResults && !waiting && !rd.isCancelledDay && isFirstOrOnlyDay && !isSingleTimeTrial
    ? `<a class="badge badge--startlist" href="${startlistUrl(race)}" onclick="event.stopPropagation()">${_cyclistSvg} <span class="badge__text">${race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'))}</span></a>` : '';
  const startOrderHtml = isTimeTrial && rd._assets?.some(a => a.url && a.type === 'startOrder') && !rd.isCancelledDay && !showResults && !waiting
    ? startOrderBadgeHtml(startOrderUrl(rd)) : '';

  card.innerHTML = raceCardHtml({
    logo,
    name: `<span>${name}</span>${overviewBtn}`,
    sub: stageSubHtml({ stage, route: stageRouteText(rd, rdLocation), km, elev }),
    badges: `${catBadgeHtml}${rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.cancelled')}</span>` : ''}${typeBadgeHtml}${tvHtml}${startlistHtml}${startOrderHtml}`,
    meta: showResults || rd.isCancelledDay ? '' : scheduleHtml(metaState, startTU, finishTU),
  });
  card.classList.toggle('race-card--featured', agendaCardIsFeatured(_agendaSort, rd._featured));
  card.classList.toggle('race-card--waiting', waiting);

  const tvEmbedBadge = card.querySelector('.badge--tv-link[data-tv-embed]');
  tvEmbedBadge?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openBroadcastTvModal(rd, race, tvEmbedBadge.href);
  });

  // Miniperfil: banda inferior (o columna central en las destacadas). La
  // barra de avance se actualiza cada minuto mientras la carrera está en curso.
  if (appendProfile(card, rd)) {
    const startMs = Date.parse(rd.neutralStartTimeUtc), endMs = Date.parse(rd.estimatedFinishTimeUtc);
    if (!isTimeTrial && !showResults && !waiting && Number.isFinite(startMs) && endMs > startMs) {
      _progressCards.push({ card, startMs, endMs, clipRect: card.querySelector('.race-card__elevation rect') });
    }
  }

  if (showResults) {
    appendResultsActions(card, rd, {
      onResults: () => openResultsModal(rd, race),
      onYoutube: ytId => openYoutubeTvModal(rd, race, ytId),
    });
  }

  activateStageCard(card, rd, {
    clickable: stageIsClickable(rd, race.isNoClickable),
    label: _cardAriaLabel(name, stage, uci),
    seoText: raceName(race) || t('race.unknown'),
    onModal: hasModalData(rd) ? () => openRaceDataModal(rd, race) : null,
    tooltip: {
      message: rd.isCancelledDay ? t('stage.stageCancelledTooltip') : noExtraInfoMessage(rd.dateKey),
      name, flag: hideFlag ? '' : flag,
      sub: [stage, _shortDate(rd.dateKey), uci].filter(Boolean).join(' · '),
    },
  });
  return card;
}

function renderAgendaItems(items) {
  const list = document.getElementById('raceList');
  if (!list) return;
  clearInterval(_progressTimer);
  _progressTimer = null;
  _progressCards = [];
  list.replaceChildren(...items.map(item => item._placeholder ? buildPlaceholderCard(item._phRace) : buildCard(item)));
  if (_progressCards.length > 0) {
    _progressTimer = setInterval(_updateProgressCards, 60_000);
  }
}

// Nombre accesible de una tarjeta: sin él el lector lee el amasijo de
// nombre, badges, horas y kilómetros que contiene el grid.
function _cardAriaLabel(name, stage, uci) {
  return [name, stage, uci].filter(Boolean).join(' · ');
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
// Cuando la JORNADA MOSTRADA cae en la semana de Campeonatos (22-28 jun) la
// vista "Hoy" impone el filtro Masculino, oculta WT/WWT y no deja fijar otro
// predeterminado; fuera de esa ventana se respeta el pin del usuario (que se
// conserva intacto). Se evalúa contra la fecha navegada (currentDateKey), no la
// fecha real → al navegar a esos días se aplica aunque hoy sea otra fecha.
let _agendaCat     = isChampWeekFilterLock(currentDateKey)
  ? champWeekHoyDefault(currentDateKey)
  : (getPinnedFilter() || 'all'); // categoría activa (pin > default)
// Filtro que tenía el usuario justo antes de entrar en la ventana, para
// restaurarlo al salir. `null` mientras no estamos dentro de la ventana.
let _preChampCat   = null;
let _champLockOn   = isChampWeekFilterLock(currentDateKey); // estado actual del lock
// Último filtro por defecto forzado dentro de la ventana de Campeonatos. Sirve
// para reaplicar el default solo cuando CAMBIA al navegar entre días (p. ej.
// 26→27 jun: Masculino→Todas), sin pisar la elección manual del usuario.
let _champForced   = _champLockOn ? champWeekHoyDefault(currentDateKey) : null;
let _agendaSort    = 'category'; // orden: 'category' | 'tvtime' | 'finishtime'
window._agendaCat  = _agendaCat;
window._icalYear   = new Date().getFullYear();
const EUROPE = new Set(['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK']);

// ── Caché de carreras del año para navegación filter-aware ───────
let _cachedYearRaces = [];

function isMixedRelayChampionship(race) {
  return ['WC', 'CC'].includes(race?.uciCategory || '')
    && /relevo mixto|mixed relay/i.test(race?.name || '');
}

/** Comprueba si una carrera coincide con un filtro de categoría. La usan la
 *  lista del día (applyAgendaFilters) y la navegación entre días. */
function matchesCategoryFilter(race, cat) {
  if (cat === 'all') return true;
  const uci = race.uciCategory || '';
  const gender = race.gender || '';
  const cc = (race.countryCode || '').toUpperCase();

  // Campeonatos Nacionales: élite cuenta como pro / por género; sub23 fuera.
  if (uci === 'CN') return championshipMatchesCategoryFilter(race, cat);

  let base = false;
  if (cat === 'pro')    base = ['1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','WC','CC'].includes(uci)
    || (['1.2U','2.2U'].includes(uci) && isTourDelPorvenir(race.name));
  if (cat === 'uwt')    base = uci === '1.UWT' || uci === '2.UWT';
  if (cat === 'wwt')    base = uci === '1.WWT' || uci === '2.WWT';
  if (cat === 'male')   base = (gender === 'male' || isMixedRelayChampionship(race))
    && !['1.2','2.2'].includes(uci)
    && (!['1.2U','2.2U'].includes(uci) || isTourDelPorvenir(race.name));
  if (cat === 'female') base = (gender === 'female' || isMixedRelayChampionship(race))
    && (!['1.2U','2.2U'].includes(uci) || isTourDelPorvenir(race.name))
    && (uci !== '1.2' && uci !== '2.2' || EUROPE.has(cc));
  if (!base) return false;

  // Ocultar CC que no sean Campeonato de Europa (igual que applyAgendaFilters)
  if (uci === 'CC') {
    return /europa|europe/i.test(race.name || '');
  }
  return true;
}

/** Busca el siguiente día con carreras que coincidan con el filtro (escanea
 *  hasta 180 días, sin pasar del último día de temporada). */
function findNextDayWithRaces(afterDateKey, cat) {
  if (!_cachedYearRaces.length) return null;
  let [y, m, d] = afterDateKey.split('-').map(Number);
  for (let i = 0; i < 180; i++) {
    const dt = new Date(y, m - 1, d + 1 + i);
    const dk = toDateKey(dt);
    if (!isWithinTodaySeason(dk, today)) return null;
    const hasMatch = _cachedYearRaces.some(race =>
      !race.isCancelled && isRaceDay(race, dk) && matchesCategoryFilter(race, cat)
    );
    if (hasMatch) return dk;
  }
  return null;
}

/** True si existe algún día navegable posterior al mostrado. */
function canGoToNextDay() {
  return isWithinTodaySeason(addDaysKey(currentDateKey, 1), today);
}

/** Destino de «día siguiente»: el próximo día con carreras del filtro o, si no
 *  lo hay, el día contiguo; null en el último día de temporada. */
function nextNavigableDay(fromKey) {
  const next = findNextDayWithRaces(fromKey, _agendaCat) || addDaysKey(fromKey, 1);
  return isWithinTodaySeason(next, today) ? next : null;
}

function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

/** Busca el día anterior con carreras que coincidan con el filtro (escanea hasta 180 días). */
function findPrevDayWithRaces(beforeDateKey, cat) {
  if (!_cachedYearRaces.length) return null;
  let [y, m, d] = beforeDateKey.split('-').map(Number);
  for (let i = 0; i < 180; i++) {
    const dt = new Date(y, m - 1, d - 1 - i);
    const dk = toDateKey(dt);
    const hasMatch = _cachedYearRaces.some(race =>
      !race.isCancelled && isRaceDay(race, dk) && matchesCategoryFilter(race, cat)
    );
    if (hasMatch) return dk;
  }
  return null;
}

/** Aplica/retira el bloqueo de filtros de la semana de Campeonatos según la
 *  JORNADA MOSTRADA (`dateKey`). Idempotente: se llama en cada loadDay.
 *  - Al ENTRAR en la ventana: guarda el filtro del usuario, fuerza Masculino,
 *    oculta WT/WWT y las chinchetas.
 *  - Al SALIR: restaura el filtro previo (o el pin), reexpone chips y chinchetas.
 *  Devuelve `true` si el filtro activo cambió (el caller debe recargar el día). */
function applyChampWeekLock(dateKey) {
  const cats = document.getElementById('agendaFilterCats');
  const lockNow = isChampWeekFilterLock(dateKey);
  let catChanged = false;

  if (lockNow) {
    // Dentro de la ventana se fuerza el filtro por defecto de la jornada
    // mostrada (Masculino, salvo el 27-28 jun → "Todas"). Al ENTRAR se recuerda
    // el filtro del usuario y se fuerza el default; navegando entre días dentro
    // de la ventana solo se reaplica cuando el default CAMBIA (p. ej. 26→27 jun:
    // Masculino→Todas), respetando la elección manual mientras no se cruce ese
    // límite.
    const forced = champWeekHoyDefault(dateKey);
    if (!_champLockOn) {
      _preChampCat = _agendaCat;
      if (_agendaCat !== forced) { _agendaCat = forced; catChanged = true; }
    } else if (forced !== _champForced && _agendaCat !== forced) {
      _agendaCat = forced; catChanged = true;
    }
    _champForced = forced;
  } else if (!lockNow && _champLockOn) {
    // Salimos de la ventana: restaurar el filtro previo (o el pin guardado).
    const restored = _preChampCat ?? (getPinnedFilter() || 'all');
    _preChampCat = null;
    _champForced = null;
    if (_agendaCat !== restored) { _agendaCat = restored; catChanged = true; }
  }
  _champLockOn = lockNow;
  window._agendaCat = _agendaCat;

  if (cats) {
    // Visibilidad de chips: WT/WWT ocultos solo dentro de la ventana.
    cats.querySelectorAll('.tcat-btn').forEach(b => {
      b.style.display = (lockNow && !CHAMP_WEEK_HOY_FILTERS.includes(b.dataset.cat)) ? 'none' : '';
    });
    cats.querySelectorAll('.tcat-btn').forEach(b =>
      setPressed(b, b.dataset.cat === _agendaCat)
    );
    // Chinchetas inhibidas dentro de la ventana.
    if (lockNow) cats.querySelectorAll('.tcat-pin').forEach(p => p.remove());
    else renderFilterPins(cats, _agendaCat);
  }
  return catChanged;
}

function initAgendaFilters() {
  const cats = document.getElementById('agendaFilterCats');
  if (cats) {
    // Estado inicial del lock según la jornada mostrada al cargar.
    applyChampWeekLock(currentDateKey);

    const onEvent = e => {
      const res = handleFilterEvent(e);
      if (!res) return;
      if (res.type === 'pin') {
        // Pin inhibido dentro de la ventana (no se pintan chinchetas).
        if (!_champLockOn) renderFilterPins(cats, _agendaCat);
        return;
      }
      cats.querySelectorAll('.tcat-btn').forEach(b =>
        setPressed(b, b.dataset.cat === res.cat)
      );
      _agendaCat = res.cat;
      // El cambio manual dentro de la ventana es contextual a los Campeonatos:
      // NO toca `_preChampCat`, de modo que al salir se restaura el filtro que el
      // usuario tenía antes de entrar (su pin / "fuera funciona normal").
      window._agendaCat = _agendaCat;
      if (!_champLockOn) renderFilterPins(cats, _agendaCat);
      loadDay(currentDateKey);
    };
    cats.addEventListener('click', onEvent);
    cats.addEventListener('keydown', onEvent);
  }

  const sortSel = document.getElementById('agendaSortSelect');
  sortSel?.addEventListener('change', () => {
    if (!sortSel.value) return;
    _agendaSort = sortSel.value;
    loadDay(currentDateKey);
  });

}

// Filtro de categoría activo. Misma lógica que la navegación entre días
// (matchesCategoryFilter), de modo que un día con carreras nunca queda vacío.
function applyAgendaFilters(items) {
  if (_agendaCat === 'all') return items;
  return items.filter(item => matchesCategoryFilter(item._race || {}, _agendaCat));
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
// El dedo arrastra la lista de carreras (#raceList); al soltar por encima del
// umbral (o con un flick rápido) se confirma el cambio al día anterior/siguiente
// con un «settle» animado (la lista sale por un lado y la nueva entra por el
// otro). Mismo destino que las flechas ◀▶: findNext/PrevDayWithRaces con
// fallback a ±1 día. El gesto se escucha sobre #raceList Y sobre el selector de
// días (#dateBar) — las 7 píldoras reparten el ancho SIN scroll, así que no hay
// conflicto; el feedback visual (transform) siempre va sobre #raceList y un
// arrastre sobre una píldora NO dispara su tap (suppressClick). El cintillo
// tiene gesto propio y vive fuera de ambos. Paridad con el DragGesture de las
// apps (umbral h > v*1.5).
function initDaySwipe() {
  const list = document.getElementById('raceList');
  if (!list) return;
  const dateBar = document.getElementById('dateBar');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DECIDE_PX = 12;   // distancia para decidir si el gesto es horizontal
  const COMMIT_PX = 60;   // distancia para confirmar el cambio de día
  const RESIST    = 0.4;  // rubber-band al rebasar el 60% del ancho

  let startX = 0, startY = 0, startT = 0, width = 0;
  let tracking = false, horizontal = false, dragging = false;
  let animating = false, suppressClick = false;

  const addDays = (dk, n) => {
    const [y, m, d] = dk.split('-').map(Number);
    return toDateKey(new Date(y, m - 1, d + n));
  };

  function resetTransform() {
    list.style.transition = '';
    list.style.transform = '';
    list.style.willChange = '';
  }

  function settleBack() {
    if (reduceMotion) { resetTransform(); return; }
    list.style.transition = 'transform .22s cubic-bezier(.22,.61,.36,1)';
    list.style.transform = 'translateX(0)';
    setTimeout(resetTransform, 240);
  }

  function commit(forward) {
    const targetDk = forward
      ? nextNavigableDay(currentDateKey)
      : (findPrevDayWithRaces(currentDateKey, _agendaCat) || addDays(currentDateKey, -1));
    if (!targetDk) { settleBack(); return; }

    if (reduceMotion || !width) { resetTransform(); loadDay(targetDk); return; }

    animating = true;
    const outX = forward ? -width : width;
    const inX  = forward ? width : -width;

    // 1) La lista actual sale por el lado del gesto.
    list.style.transition = 'transform .2s ease-in';
    list.style.transform = `translateX(${outX}px)`;
    setTimeout(() => {
      // 2) Cargar el nuevo día (rellena #raceList; loading → contenido «a golpes»).
      loadDay(targetDk);
      // 3) Colocar la lista fuera por el lado opuesto y deslizarla a su sitio.
      list.style.transition = 'none';
      list.style.transform = `translateX(${inX}px)`;
      void list.offsetWidth; // forzar reflow antes de la transición de entrada
      list.style.transition = 'transform .24s cubic-bezier(.22,.61,.36,1)';
      list.style.transform = 'translateX(0)';
      setTimeout(() => { resetTransform(); animating = false; }, 260);
    }, 200);
  }

  function onTouchStart(e) {
    if (animating || e.touches.length !== 1) { tracking = false; return; }
    const tch = e.touches[0];
    startX = tch.clientX; startY = tch.clientY; startT = Date.now();
    width = list.getBoundingClientRect().width || window.innerWidth;
    tracking = true; horizontal = false; dragging = false;
  }

  function onTouchMove(e) {
    if (!tracking || animating || e.touches.length !== 1) return;
    const tch = e.touches[0];
    const dx = tch.clientX - startX;
    const dy = tch.clientY - startY;

    if (!horizontal) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        horizontal = true; dragging = true;
        if (!reduceMotion) { list.style.transition = 'none'; list.style.willChange = 'transform'; }
      } else {
        tracking = false; return; // scroll vertical → no interferir
      }
    }

    e.preventDefault(); // ya es un swipe horizontal: bloquear scroll/overscroll
    if (reduceMotion) return; // sin animación de arrastre, solo se confirma al soltar
    let shift = dx;
    const cap = width * 0.6;
    if (Math.abs(dx) > cap) shift = Math.sign(dx) * (cap + (Math.abs(dx) - cap) * RESIST);
    list.style.transform = `translateX(${shift}px)`;
  }

  function onTouchEnd(e) {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    horizontal = false; dragging = false;
    suppressClick = true; // hubo arrastre horizontal → no abrir tarjeta ni píldora
    setTimeout(() => { suppressClick = false; }, 400);

    const tch = e.changedTouches[0];
    const dx = tch.clientX - startX;
    const dt = Date.now() - startT;
    const flick = dt < 300 && Math.abs(dx) > 30;
    if (Math.abs(dx) > COMMIT_PX || flick) commit(dx < 0);
    else settleBack();
  }

  function onTouchCancel() {
    if (dragging) settleBack();
    tracking = false; horizontal = false; dragging = false;
  }

  // Tras un arrastre horizontal, anular el click que dispararía la tarjeta
  // (#raceList) o la píldora de día (#dateBar). Ambos handlers escuchan en
  // burbuja; este capture corre antes y corta la propagación.
  function onClickCapture(e) {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
  }

  for (const el of [list, dateBar]) {
    if (!el) continue;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('click', onClickCapture, true);
  }
}

// ── Init ──────────────────────────────────────────────────────────
initAgendaFilters();
initCintillo();
initDaySwipe();
initPhTooltip();
window.loadDay = loadDay;
initI18n().then(() => {
  // Aplicar traducciones a elementos data-i18n del HTML estático
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.getAttribute('data-i18n'));
    if (typeof val === 'string') el.textContent = val;
  });
  buildDateBar();
  loadDay(currentDateKey, { skipEmptyDay: true });
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
  const wasOnToday = currentDateKey === agendaTodayKey();
  today = nowKey;                          // actualizar la referencia de "hoy"
  if (!wasOnToday) { buildDateBar(); return; } // respetar navegación manual
  currentDateKey = agendaTodayKey();
  buildDateBar();
  loadDay(currentDateKey, { skipEmptyDay: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _maybeAdvanceToNewLocalDay();
});
window.addEventListener('focus', _maybeAdvanceToNewLocalDay);
setInterval(_maybeAdvanceToNewLocalDay, 60_000);

const refreshToday = () => {
  if (!document.hidden && !dayLoading && currentDateKey === toDateKey(new Date())) loadDay(currentDateKey,{refresh:true});
};
const dayRefreshTimer=setInterval(refreshToday,60000);
document.addEventListener('visibilitychange',refreshToday);
window.addEventListener('pagehide',()=> { clearInterval(dayRefreshTimer); document.removeEventListener('visibilitychange',refreshToday); },{once:true});
