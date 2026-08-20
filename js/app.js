// ─────────────────────────────────────────────────────────────────
//  APP PÚBLICA — index.html
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, formatDateLabel, formatDateLabelShort, formatTime, formatTimeUser,
         stageLabel, uciRank, proLevel, genderRank, grandTourRank,
         countryFlag, effectiveCountryCode, typeLabel, typeBadge, resolveTypeBadges,
         categoryBadge, jornadaUrl, raceUrl, raceName, rdLocation, setMeta, setMetaProperty,
         setCachedRace, tsSeconds, openPhBanner,
         getPinnedFilter, renderFilterPins, handleFilterEvent,
         filterBroadcastsByRegion, extractYouTubeId, startlistUrl, startOrderUrl, buildTimeStack,
         enBase, setPressed, announce, makeCardActivatable }
         from './shared.js';
import { t, initI18n, getLocale, getLang } from './i18n.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
initI18n(); // carga el diccionario EN en paralelo con los datos
import { annotateDoubleSectors } from './services/races.js';
import { openRaceDataModal, hasModalData, openResultsModal, openBroadcastTvModal, openYoutubeTvModal, loadInhouseStageSet } from './race-data-modal.js';
import { indicatorBadgeSVG, isIndicatorKind, buildElevationSparkline } from './elevation-profile.js';
import { initCintillo } from './cintillo.js';
import { compareChampionships, isU23Championship, isFemaleChampionship,
         isChampWeekFilterLock, CHAMP_WEEK_HOY_FILTERS, champWeekHoyDefault } from './campeonatos-config.js';
import { pickBadgeBroadcast } from './broadcast-priority.js';

// ── Progress bar / elevation sparkline en cards de carrera en curso ─
let _progressCards = [];
let _progressTimer = null;

function _updateProgressCards() {
  const now = Date.now();
  _progressCards = _progressCards.filter(({ card, startMs, endMs, clipRect }) => {
    if (now >= endMs) {
      if (clipRect) clipRect.setAttribute('width', '100');
      else card.style.setProperty('--progress', '100%');
      return false;
    }
    const pct = Math.round((now - startMs) / (endMs - startMs) * 100);
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
const _tvSvg        = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const _trophySvg    = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>';
const _cyclistSvg   = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const _timerSvg     = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><line x1="10" y1="2" x2="14" y2="2"/><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 13"/></svg>';

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
      return wrapTv(`${_tvSvg} Live`, true);
    }
    // Si el broadcast de referencia empieza antes de la salida neutralizada → cobertura íntegra
    const label = (neutralMs !== null && refMs <= neutralMs) ? t('tv.fullStage') : formatTime(refTs);
    // Live texto junto al TV mientras la carrera ya empezó pero la TV sigue en reposo
    const liveTextAlongside = (liveTextBadge && raceStarted && refMs > nowMs) ? liveTextBadge : '';
    return wrapTv(`${_tvSvg} ${label}`) + liveTextAlongside;
  }
  // Hay TV pero sin hora concreta
  return wrapTv(`${_tvSvg} TV`);
}

// ── Resultados post-carrera (30 min después de la llegada estimada) ─
function _raceTimeCheckCard(rd, offsetMinutes) {
  if (rd.estimatedFinishTimeUtc && rd.dateKey) {
    const [y, m, d] = rd.dateKey.split('-').map(Number);
    const finish = new Date(rd.estimatedFinishTimeUtc);
    if (finish.getTime() >= Date.UTC(y, m - 1, d)) {
      return new Date() >= new Date(finish.getTime() + offsetMinutes * 60 * 1000);
    }
  }
  if (rd.dateKey) {
    const [y, m, d] = rd.dateKey.split('-').map(Number);
    return new Date() >= new Date(Date.UTC(y, m - 1, d, 18, 0, 0) + offsetMinutes * 60 * 1000);
  }
  return false;
}
function _shouldShowResultsCard(rd, race) {
  if (rd.isRestDay || rd.isCancelledDay) return false;
  if (!race.fcId && !race.pcsSlug) return false;
  return _raceTimeCheckCard(rd, 30);
}
function _noIdsAndPastDeadline(rd, race) {
  if (rd.isRestDay || rd.isCancelledDay) return false;
  if (race.fcId || race.pcsSlug) return false;
  return _raceTimeCheckCard(rd, 0);
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

  // 7 días centrados en el día activo (3 antes + activo + 3 después)
  const [cy, cm, cd] = currentDateKey.split('-').map(Number);
  const center = new Date(cy, cm - 1, cd);
  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + i);
    days.push(toDateKey(d));
  }

  bar.innerHTML = '';

  // ── Controles izquierdos (fuera del scroll) ──────────────────────
  const leftSection = document.createElement('div');
  leftSection.className = 'date-bar__left';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'date-week-arrow';
  // El glifo es decorativo: sin aria-label el lector anuncia «‹ botón».
  prevBtn.innerHTML = '<span aria-hidden="true">&#8249;</span>';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', t('today.prevDayLabel'));
  prevBtn.addEventListener('click', () => {
    const prev = findPrevDayWithRaces(currentDateKey, _agendaCat);
    if (prev) { loadDay(prev); return; }
    const [y, m, d] = currentDateKey.split('-').map(Number);
    loadDay(toDateKey(new Date(y, m - 1, d - 1)));
  });
  leftSection.appendChild(prevBtn);

  const todayBtn = document.createElement('button');
  todayBtn.className = 'date-today-btn' + (currentDateKey !== today ? ' date-today-btn--visible' : '');
  todayBtn.textContent = t('today.todayBtn');
  todayBtn.addEventListener('click', () => { currentDateKey = today; buildDateBar(); loadDay(today); });
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
    // Dos líneas, como en las apps: día de la semana (abreviado) sobre el número
    let wd = date.toLocaleDateString(getLocale(), { weekday: 'short' }).replace(/\.$/, '');
    wd = wd.charAt(0).toUpperCase() + wd.slice(1);
    const dayNum = date.toLocaleDateString(getLocale(), { day: 'numeric' });

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'date-pill'
      + (dk === currentDateKey ? ' active' : '')
      + (dk === today ? ' is-today' : '');
    // «Lun 12» no dice ni el mes ni cuál es el día seleccionado: el nombre
    // accesible lleva la fecha completa y aria-current marca el activo.
    pill.setAttribute('aria-label', date.toLocaleDateString(getLocale(),
      { weekday: 'long', day: 'numeric', month: 'long' }));
    if (dk === currentDateKey) pill.setAttribute('aria-current', 'date');
    pill.innerHTML = `<span class="date-pill__wd" aria-hidden="true">${wd}</span><span class="date-pill__num" aria-hidden="true">${dayNum}</span>`;
    pill.dataset.dk = dk;
    pill.addEventListener('click', () => loadDay(dk));
    pillsInner.appendChild(pill);
  });

  pillsWrap.appendChild(pillsInner);
  bar.appendChild(pillsWrap);

  // ── Controles derechos (fuera del scroll) ────────────────────────
  const rightSection = document.createElement('div');
  rightSection.className = 'date-bar__right';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'date-week-arrow';
  nextBtn.innerHTML = '<span aria-hidden="true">&#8250;</span>';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', t('today.nextDayLabel'));
  nextBtn.addEventListener('click', () => {
    const next = findNextDayWithRaces(currentDateKey, _agendaCat);
    if (next) { loadDay(next); return; }
    const [y, m, d] = currentDateKey.split('-').map(Number);
    loadDay(toDateKey(new Date(y, m - 1, d + 1)));
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
async function loadDay(dateKey, { skipEmptyDay = false } = {}) {
  clearInterval(_progressTimer);
  _progressTimer = null;
  _progressCards = [];
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
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

  list.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.stages')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

  try {
    const { data: rdData } = await supabase.from('race_days').select('*').eq('dateKey', dateKey).eq('editorialStatus', 'published');

    // Cargar datos de carrera y broadcasts para cada jornada (en paralelo)
    const raceDays = rdData || [];
    const raceIds = [...new Set(raceDays.map(rd => rd.raceId).filter(Boolean))];
    const rdIds = raceDays.map(rd => rd.id);

    const [racesResult, bcastResult, assetsResult, inhouseSet] = await Promise.all([
      raceIds.length ? supabase.from('races').select('*').in('id', raceIds) : Promise.resolve({ data: [] }),
      rdIds.length ? supabase.from('broadcasts').select('*').in('raceDayId', rdIds).order('sortOrder', { ascending: true }) : Promise.resolve({ data: [] }),
      rdIds.length ? supabase.from('assets').select('id,raceDayId,type,url').in('raceDayId', rdIds) : Promise.resolve({ data: [] }),
      loadInhouseStageSet(raceIds),
    ]);

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
    });

    // Detectar dobles sectores (misma carrera, mismo día, mismo stageNumber).
    // skipFcNumbers: solo tenemos la etapa del día actual por carrera, no la
    // secuencia completa → _fcStageNumber sería siempre 1 (incorrecto).
    annotateDoubleSectors(raceDays, { skipFcNumbers: true });

    // Ordenar: categoría UCI → género (masc antes fem) → hora → nombre
    // (orden preliminar; el orden definitivo de la agenda lo fija _sortByCategory)
    raceDays.sort((a, b) => {
      const gtA  = grandTourRank(a._race);
      const gtB  = grandTourRank(b._race);
      if (gtA !== gtB) return gtA - gtB;
      const catA = uciRank(a._race?.uciCategory, a._race?.name, a._race?.countryCode);
      const catB = uciRank(b._race?.uciCategory, b._race?.name, b._race?.countryCode);
      // Ordenar por nivel (UWT+WWT agrupados), luego género, luego categoría exacta
      const lvlA = proLevel(a._race?.uciCategory, a._race?.name, a._race?.countryCode), lvlB = proLevel(b._race?.uciCategory, b._race?.name, b._race?.countryCode);
      if (lvlA !== lvlB) return lvlA - lvlB;
      const genA = genderRank(a._race?.gender);
      const genB = genderRank(b._race?.gender);
      if (genA !== genB) return genA - genB;
      if (catA !== catB) return catA - catB;
      const timeA = tsSeconds(a.neutralStartTimeUtc) ?? 999999;
      const timeB = tsSeconds(b.neutralStartTimeUtc) ?? 999999;
      if (timeA !== timeB) return timeA - timeB;
      return (a._race?.name || '').localeCompare(b._race?.name || '');
    });

    // ⚠️ NO vaciar la lista aquí: por debajo quedan awaits (ensureYearRacesCached,
    // loadPlaceholders) que NO mutan el DOM. Si se limpia antes, el overlay de
    // carga (js/page-loading.js) ve el contenedor sin marcador .loading y sin
    // mutaciones durante SETTLE_MS → se desvanece sobre una lista VACÍA y las
    // cards aparecen después, con la página ya destapada. El marcador se
    // conserva hasta el instante en que hay algo que pintar (cada rama limpia
    // justo antes de su propio render).

    if (raceDays.length === 0) {
      // Comprobar si hay placeholders antes de mostrar vacío
      const placeholders = await loadPlaceholders(dateKey, []);
      const phAsDays0 = placeholders.map(ph => ({
        _placeholder: true, _race: ph, _phRace: ph,
        neutralStartTimeUtc: { seconds: -1 },
      }));

      let allItems0 = [...phAsDays0];

      if (allItems0.length === 0) {
        // Cachear carreras del año para navegación filter-aware
        const currentYear0 = parseInt(dateKey.slice(0, 4));
        await ensureYearRacesCached(currentYear0);
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
        const nextBtn = nextDateBtn
          ? `<button class="btn btn--ghost" style="margin-top:1rem" onclick="loadDay('${nextDateBtn}')">${t('today.nextDay')}</button>`
          : '';
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div>
            <div class="empty-state__text">${t('today.noRaces')}</div>
            ${nextBtn}
          </div>`;
        announce(t('today.noRaces'));
        return;
      }

      allItems0.sort((a, b) => {
        const phA = (a._placeholder || a._cancelled) ? 1 : 0;
        const phB = (b._placeholder || b._cancelled) ? 1 : 0;
        if (phA !== phB) return phA - phB;
        const rA = a._race || {}, rB = b._race || {};
        const lvlA = proLevel(rA.uciCategory, rA.name, rA.countryCode);
        const lvlB = proLevel(rB.uciCategory, rB.name, rB.countryCode);
        if (lvlA !== lvlB) return lvlA - lvlB;
        const gA = genderRank(rA.gender), gB = genderRank(rB.gender);
        if (gA !== gB) return gA - gB;
        return (rA.name || '').localeCompare(rB.name || '');
      });

      const total0 = allItems0.length;
      list.innerHTML = '';
      allItems0.forEach(item => {
        if (item._placeholder) {
          const ph = item._phRace; ph._dateKey = dateKey;
          list.appendChild(buildPlaceholderCard(ph));
        } else {
          list.appendChild(buildCard(item));
        }
      });
      return;
    }

    // ── Cachear carreras del año para navegación filter-aware ──
    const currentYear = parseInt(dateKey.slice(0, 4));
    await ensureYearRacesCached(currentYear);

    // ── Combinar jornadas reales y placeholders, ordenar todo junto ─
    const placeholders = await loadPlaceholders(dateKey, raceDays);
    placeholders.forEach(ph => { ph._dateKey = dateKey; });

    // Normalizar placeholders al mismo formato que raceDays para el sort
    // seconds = -1 para que vayan antes que cualquier jornada con hora real
    const phAsDays = placeholders.map(ph => ({
      _placeholder: true,
      _race:        ph,
      _phRace:      ph,
      neutralStartTimeUtc: { seconds: -1 },
    }));

    let allItems = [...raceDays, ...phAsDays];

    // Aplicar filtros de categoría y ordenación
    allItems = applyAgendaFilters(allItems);
    allItems.sort(_sortByCategory);
    allItems = applyAgendaSort(allItems);

    const total = allItems.length;

    updateSeoDay(dateKey, raceDays);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

    if (total === 0) {
      const nextFilteredDate = findNextDayWithRaces(dateKey, _agendaCat);
      // Dentro de la ventana de Campeonatos el filtro Masculino está FORZADO: si
      // este día no tiene carreras masculinas, auto-avanzar al siguiente que sí
      // (mismo trato que el filtro "Todas"; el escaneo respeta el filtro activo).
      if (_champLockOn && nextFilteredDate) {
        loadDay(nextFilteredDate);
        return;
      }
      const nextFilteredBtn = nextFilteredDate
        ? `<button class="btn btn--ghost" style="margin-top:1rem" onclick="loadDay('${nextFilteredDate}')">${t('today.nextDay')}</button>`
        : '';
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div>
          <div class="empty-state__text">${t('today.noRacesFilter')}</div>
          ${nextFilteredBtn}
        </div>`;
      announce(t('today.noRacesFilter'));
      return;
    }

    list.innerHTML = '';
    allItems.forEach(item => {
      if (item._placeholder) {
        list.appendChild(buildPlaceholderCard(item._phRace));
      } else {
        list.appendChild(buildCard(item));
      }
    });
    // La lista se sustituye sin recargar: sin región activa, quien usa lector
    // pulsa un filtro o cambia de día y no recibe confirmación (WCAG 4.1.3).
    _announceDay(allItems.length, dateKey);

    if (_progressCards.length > 0) {
      _progressTimer = setInterval(_updateProgressCards, 60_000);
    }

  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <div class="empty-state__title">Error al cargar los datos</div>
    </div>`;
    announce('Error al cargar los datos');
  }
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
  const title = 'Calendario Ciclismo App';
  const description = 'Todas las carreras ciclistas profesionales, con horario, recorrido, perfil y cómo ver por TV y online streaming. Una idea de Dani Sánchez.';

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

async function loadPlaceholders(dateKey, existingRaceDays) {
  // IDs de carreras que ya tienen jornada publicada ese día
  const coveredIds = new Set(existingRaceDays.map(rd => rd.raceId).filter(Boolean));

  // Cargar races con startDate <= dateKey, filtrar por año en cliente
  // (evita índice compuesto year+startDate en Firestore)
  const currentYear = parseInt(dateKey.slice(0, 4));
  const { data: racesData } = await supabase.from('races').select('*').lte('startDate', dateKey);

  const placeholders = [];
  for (const race of (racesData || [])) {
    if ((race.year || 0) !== currentYear) continue;
    if (coveredIds.has(race.id)) continue;
    if (race.isCancelled) continue;
    if (!isRaceDay(race, dateKey)) continue;
    placeholders.push(race);
  }

  // Ordenar igual que race_days: categoría UCI → género
  placeholders.sort((a, b) => {
    const ca = uciRank(a.uciCategory, a.name, a.countryCode), cb = uciRank(b.uciCategory, b.name, b.countryCode);
    if (ca !== cb) return ca - cb;
    const ga = genderRank(a.gender), gb = genderRank(b.gender);
    if (ga !== gb) return ga - gb;
    return (a.name || '').localeCompare(b.name || '');
  });

  return placeholders;
}

/** Carga y cachea todas las carreras del año para navegación filter-aware. */
let _cachedYear = null;
async function ensureYearRacesCached(year) {
  if (_cachedYear === year && _cachedYearRaces.length) return;
  const { data } = await supabase.from('races').select('*').eq('year', year);
  _cachedYearRaces = data || [];
  _cachedYear = year;
}

// Devuelve el color ajustado para que sea visible como raya/borde en ambos temas.
// Si el color es demasiado claro (blanco o cercano), lo oscurece.
function safeCardColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return '#888';
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c+c).join('') : h;
  const r = parseInt(full.slice(0,2), 16);
  const g = parseInt(full.slice(2,4), 16);
  const b = parseInt(full.slice(4,6), 16);
  const lum = 0.299*r + 0.587*g + 0.114*b;
  if (lum > 210) {
    const darken = v => Math.round(v * 0.6).toString(16).padStart(2,'0');
    return '#' + darken(r) + darken(g) + darken(b);
  }
  return hex;
}

// Detecta si el color original es muy claro (blanco/cercano) o inválido para añadir borde mínimo.
function isLightCardColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return true;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c+c).join('') : h;
  const r = parseInt(full.slice(0,2), 16);
  const g = parseInt(full.slice(2,4), 16);
  const b = parseInt(full.slice(4,6), 16);
  return (0.299*r + 0.587*g + 0.114*b) > 210;
}

function cleanFeminineAgendaName(name) {
  if (_agendaCat !== 'female' && _agendaCat !== 'wwt') return name;
  if (/women cycling pro|sanremo women|tour de feminin/i.test(name)) return name;
  const cleaned = name
    .replace(/\s*\b(women'?s?\s+elite|femenino|femenina|féminas|femeninos|féminin|féminine|femmes|women'?s?|ladies|donne|dames|elite women|emakumeen|pour dames)\b\s*/gi, ' ')
    .trim().replace(/\s{2,}/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '');
  return cleaned || name;
}

function buildPlaceholderCard(race) {
  const color  = safeCardColor(race.colorHex) || '#888';
  const flag   = countryFlag(race.countryCode);
  const rawName = raceName(race) || t('race.unknown');
  const name   = cleanFeminineAgendaName(rawName);
  const uci    = race.uciCategory || '';
  const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);
  const isFemaleFilterActive = _agendaCat === 'female' || _agendaCat === 'wwt';
  const isFemale = race.gender === 'female' && !nameImpliesFemale(race.name || '') && !isFemaleFilterActive;

  const logo = race.logoUrl
    ? `<div class="race-card__logo">
         <img class="race-logo-img" src="${race.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
         ${race.hideFlag ? '' : `<span>${flag}</span>`}
       </div>`
    : (race.hideFlag ? '' : `<div class="race-card__flag">${flag}</div>`);

  // Etapa teórica para vueltas
  let subText = '';
  if (race.raceFormat === 'stage_race') {
    const n = theoreticalStageNumber(race, /* necesitamos dateKey */ race._dateKey);
    subText = n ? stageLabel(n) : '';
  }

  const flagHtml = race.hideFlag ? '' : flag;
  const card = document.createElement('div');
  card.className = 'race-card race-card--placeholder' + (isLightCardColor(race.colorHex) ? ' race-card--light-color' : '');
  card.style.setProperty('--card-color', color);
  card.innerHTML = `
    <div class="race-card__ph-row">
      ${flagHtml ? `<span class="race-card__ph-flag">${flagHtml}</span>` : ''}
      ${subText
        ? `<span class="race-card__ph-name">${name}</span><span class="race-card__ph-stage">${subText}${categoryBadge(uci, isFemale)}</span>`
        : `<span class="race-card__ph-name">${name}<span class="race-card__name-cat">${categoryBadge(uci, isFemale)}</span></span>`
      }
    </div>
    <div class="race-card__meta"></div>
  `;
  // Tooltip custom que sigue al cursor
  card.addEventListener('mouseenter', e => {
    if (window.innerWidth < 600) return;
    let tip = document.getElementById('ph-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ph-tooltip';
      document.body.appendChild(tip);
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const startStr  = race.startDate || '';
    tip.textContent = (startStr && todayStr < startStr)
      ? 'Por ahora sin información extra'
      : 'Sin información extra';
    tip.style.display = 'block';
  });
  card.addEventListener('mousemove', e => {
    if (window.innerWidth < 600) return;
    const tip = document.getElementById('ph-tooltip');
    if (tip) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top  = (e.clientY + 14) + 'px';
    }
  });
  card.addEventListener('mouseleave', () => {
    if (window.innerWidth < 600) return;
    const tip = document.getElementById('ph-tooltip');
    if (tip) tip.style.display = 'none';
  });

  // Datos para el modal móvil
  card.dataset.phName = name;
  card.dataset.phFlag = flagHtml;
  const _phDateShort = race._dateKey ? new Date(race._dateKey + 'T12:00:00').toLocaleDateString('es-ES', {day: 'numeric', month: 'short'}) : '';
  const _phSub = [subText, _phDateShort, uci].filter(Boolean).join(' · ');
  if (_phSub) card.dataset.phSub = _phSub;

  // Móvil: modal al pulsar
  card.addEventListener('click', e => {
    if (window.innerWidth >= 600) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const startStr = race.startDate || '';
    card.dataset.phTooltip = (startStr && todayStr < startStr)
      ? 'Por ahora sin información extra'
      : 'Sin información extra';
    openPhBanner(card);
  });

  // No clicable
  return card;
}

// ── Construir tarjeta ─────────────────────────────────────────────
function buildCard(rd) {
  const race   = rd._race || {};
  const color  = safeCardColor(race.colorHex) || '#888';
  const flag   = countryFlag(effectiveCountryCode(rd, race));
  // El override de país de la jornada vence al hideFlag de la carrera:
  // si la jornada fija un país, se muestra bandera aunque la carrera la oculte.
  const hideFlag = race.hideFlag && !rd.countryCode;
  const rawName = raceName(race) || t('race.unknown');
  const name   = cleanFeminineAgendaName(rawName);
  const uci    = race.uciCategory || '';
  const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);
  const isFemaleFilterActive = _agendaCat === 'female' || _agendaCat === 'wwt';
  const isFemale = race.gender === 'female' && !nameImpliesFemale(race.name || '') && !isFemaleFilterActive;
  const _isFinalStage = !!(
    rd._race?.raceFormat === 'stage_race' &&
    rd.stageNumber != null &&
    !rd.isRestDay &&
    !rd.isCancelledDay &&
    rd.dateKey && rd._race?.endDate &&
    rd.dateKey === rd._race.endDate
  );
  const stage  = stageLabel(rd.stageNumber, rd._stageSuffix, _isFinalStage);
  const route  = rd.startLocation
    ? (!rd.finishLocation || rd.startLocation === rd.finishLocation ? rdLocation(rd, 'startLocation') : `${rdLocation(rd, 'startLocation')} > ${rdLocation(rd, 'finishLocation')}`) : '';
  const _isEn  = getLang() === 'en';
  const km     = rd.distanceKm ? `${_isEn ? String(rd.distanceKm) : String(rd.distanceKm).replace('.', ',')}${_isEn ? 'km' : ' km'}` : '';
  const _elevGain = rd.elevationProfile?.elevationGain;
  const elev   = _elevGain != null ? `+${String(Math.round(_elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEn ? ',' : '.')} m` : '';
  const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  const start  = startTU?.display  ?? null;
  const finish = finishTU?.display ?? null;
  const timeTip = (startTU?.tooltip || finishTU?.tooltip)
    ? 'Hora Madrid · ' + [startTU?.tooltip, finishTU?.tooltip].filter(Boolean).join(' – ')
    : null;

  if (!rd._broadcasts) rd._broadcasts = [];
  // El badge UCI va SIEMPRE junto al nombre, nunca en el sub
  const catBadgeHtml = categoryBadge(uci, isFemale);
  // Sub: etapa (sin badge), ruta truncable, km fijo, tipos inline.
  const stagePart   = stage ? `<span class="race-card__stage">${stage}</span>` : '';
  const routePart   = route ? `<span class="race-card__route">${route}</span>` : '';
  const kmPart      = km    ? `<span class="race-card__km">${km}</span>` : '';
  const elevPart    = elev  ? `<span class="race-card__elev">${elev}</span>` : '';
  const typeBadges  = rd.primaryType ? resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode) : '';
  // La ruta (salida > llegada) se oculta en móvil (≤600px, CSS) para no quedar como
  // muñón ni dejar separadores huérfanos. El separador adyacente viaja dentro del
  // wrapper para desaparecer con la ruta en ese ancho.
  const sep = `<span class="race-card__sep">·</span>`;
  const _routeLeadSep  = routePart && stagePart;
  const _routeTrailSep = routePart && !stagePart && kmPart;
  const sepLead  = `<span class="race-card__sep race-card__sep--in-route">·</span>`;
  const sepTrail = `<span class="race-card__sep race-card__sep--in-route race-card__sep--in-route-trail">·</span>`;
  const routeWrap = routePart
    ? `<span class="race-card__route-wrap">${_routeLeadSep ? sepLead : ''}${routePart}${_routeTrailSep ? sepTrail : ''}</span>`
    : '';
  const sepRouteKm = (routePart && _routeLeadSep && kmPart) ? sep
    : (!routePart && stagePart && kmPart) ? sep
    : '';
  const sepRouteElev  = (routePart && !kmPart && elevPart) ? sep : '';
  const sepKmElev     = (kmPart && elevPart) ? sep : '';
  const sepStageElev  = (!routePart && stagePart && !kmPart && elevPart) ? sep : '';
  // Horario apilado (paridad iOS): salida ↓ meta. Helper compartido en shared.js.
  const timeStackHtml = buildTimeStack(start, finish, timeTip);

  const logo = race.logoUrl
    ? `<div class="race-card__logo">
         <img class="race-logo-img" src="${race.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
         ${hideFlag ? '' : `<span>${flag}</span>`}
       </div>`
    : (hideFlag ? '' : `<div class="race-card__flag">${flag}</div>`);

  const card = document.createElement('div');
  const _isLight = isLightCardColor(race.colorHex);
  card.className = 'race-card' + (_isLight ? ' race-card--light-color' : '');
  card.style.setProperty('--card-color', color);

  let _epSvgHtml = null;
  let _epEntry   = null;
  // Con clasificaciones propias la card pasa a modo terminado aunque la heurística
  // horaria aún no haya vencido (paridad apps) → sin horario, pero el
  // miniperfil se conserva completado.
  const _rdInhouse = rd._hasInhouse === true;
  // Una etapa cancelada no puede entrar en modo resultados, incluso si la
  // ingesta propia contiene filas heredadas o sintéticas. Paridad iOS/Android.
  const showResults = !rd.isCancelledDay && (_rdInhouse || _shouldShowResultsCard(rd, race));
  const hideNoIds = !_rdInhouse && _noIdsAndPastDeadline(rd, race);
  // CRI/CRE: el perfil se renderiza en reposo (sin avance) hasta que la card se sustituya por modo resultados/Revive.
  const _isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  // Una jornada cancelada no se corre: ni silueta ni avance (el % seguía
  // "recorriendo" un perfil de una etapa que nunca salió). Espejo de competicion.js.
  if (!rd.isCancelledDay && rd.elevationProfile && (showResults || hideNoIds)) {
    _epSvgHtml = buildElevationSparkline(rd.elevationProfile, 1, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
    if (_epSvgHtml) card.classList.add('race-card--elevation');
  } else if (!rd.isCancelledDay && !_rdInhouse && rd.neutralStartTimeUtc && rd.estimatedFinishTimeUtc) {
    const now = Date.now();
    const startMs = new Date(rd.neutralStartTimeUtc).getTime();
    const endMs   = new Date(rd.estimatedFinishTimeUtc).getTime();
    const duration = endMs - startMs;
    const cutoffMs = (race.fcId || race.pcsSlug) ? endMs + 30 * 60 * 1000 : endMs;
    if (duration > 0 && now >= startMs && now < cutoffMs) {
      const pct = _isTimeTrial ? 0 : Math.min(100, Math.round((now - startMs) / duration * 100));
      _epSvgHtml = buildElevationSparkline(rd.elevationProfile, pct / 100, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
      if (!_isTimeTrial) {
        _epEntry = { card, startMs, endMs, clipRect: null };
        _progressCards.push(_epEntry);
      }
      if (_epSvgHtml) card.classList.add('race-card--elevation');
      else if (!_isTimeTrial) card.style.setProperty('--progress', `${pct}%`);
    }
  }
  // Perfil estático al 0%: con horario, mientras no haya empezado; sin horario, mientras
  // la jornada no haya entrado en modo resultados (clásicas sin start time aún configurado).
  if (!rd.isCancelledDay && !_rdInhouse && !showResults && !hideNoIds && !_epSvgHtml && rd.elevationProfile) {
    const _showStaticProfile = rd.neutralStartTimeUtc
      ? Date.now() < new Date(rd.neutralStartTimeUtc).getTime()
      : !_raceTimeCheckCard(rd, 30);
    if (_showStaticProfile) {
      _epSvgHtml = buildElevationSparkline(rd.elevationProfile, 0, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
      if (_epSvgHtml) card.classList.add('race-card--elevation');
    }
  }

  // Una jornada es clicable solo si no está marcada isNoClickable en la carrera
  // Y además tiene al menos un asset documental (rutómetro/perfil/mapa/puertos)
  // o un perfil de elevación nativo (GPX) renderizable, que cuenta como asset "profile".
  // (La descripción ya NO es requisito: una jornada con assets es página completa aunque no la tenga.)
  const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
    && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
  const rdHasAssets = rdViewableProfile || (rd._assets
    ? rd._assets.some(a => (a.url || a.filePath) && ['startOrder','roadbook','profile','map','ports'].includes(a.type))
    : (rd.hasAssets === true));
  const rdClickable = !race.isNoClickable && rdHasAssets;
  const _isFirstOrOnlyDay = race.raceFormat !== 'stage_race' || rd.dateKey === race.startDate;
  const _showStartlist = !!(race.startlistImportedAt) && !showResults && !hideNoIds && !rd.isCancelledDay && _isFirstOrOnlyDay;
  const _startlistHref = _showStartlist ? startlistUrl(race) : '';
  const _startlistLabel = race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'));
  const _startlistBadgeHtml = _showStartlist ? `<a class="badge badge--startlist" href="${_startlistHref}" onclick="event.stopPropagation()">${_cyclistSvg} ${_startlistLabel}</a>` : '';
  const _startOrderAsset = rd._assets ? rd._assets.find(a => a.url && a.type === 'startOrder') : null;
  const _showStartOrder = !!_startOrderAsset && (rd.primaryType === 'itt' || rd.primaryType === 'ttt') && !rd.isCancelledDay && !showResults && !hideNoIds;
  const _startOrderBadgeHtml = _showStartOrder ? `<a class="badge badge--startorder" href="${startOrderUrl(rd)}" onclick="event.stopPropagation()">${_timerSvg} ${t('assets.startOrder')}</a>` : '';
  // Badge de TV como variable (paridad iOS: va en la fila de badges bajo el nombre)
  // Una jornada cancelada no se emite: ni TV ni Live Texto (no hay nada que seguir).
  const _tvBadgeHtml = (showResults || hideNoIds || rd.isCancelledDay) ? '' : tvBadgeCard(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd._tvBlocked);
  // Tipo de etapa: en iOS se omite cuando hay mini-perfil (la silueta ya lo comunica),
  // salvo CRI/CRE. Mismo criterio que ya usaba la web para los badges de tipo.
  // Cancelada → sin badge de tipo: el carácter de una etapa que no se corrió
  // no describe nada, y el badge "Cancelada" es lo único que importa ahí
  // (las apps ya lo omitían: esto es la paridad que faltaba en la web).
  const _showTypeBadge = !showResults && !hideNoIds && !rd.isCancelledDay && (!_epSvgHtml || _isTimeTrial) && !!typeBadges;
  const _cancelledBadgeHtml = rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.cancelled')}</span>` : '';
  // Fila unificada de badges bajo el nombre, en orden iOS:
  // Categoría → Cancelada → Tipo → TV → Inscritos → Orden salida.
  const _badgeRowHtml = `<div class="race-card__badges">`
    + `<span class="race-card__name-cat">${catBadgeHtml}</span>`
    + _cancelledBadgeHtml
    + (_showTypeBadge ? `<span class="race-card__types--inline">${typeBadges}</span>` : '')
    + _tvBadgeHtml
    + _startlistBadgeHtml
    + _startOrderBadgeHtml
    + `</div>`;
  const _noIdsReviveBcast = hideNoIds ? (rd._broadcasts || [])
    .filter(b => b.url && (b.showInRevive || /eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be|facebook\.com/i.test(b.url)))
    .sort((a, b) => {
      const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
      const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
      if (aSoc !== bSoc) return aSoc - bSoc;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    })[0] ?? null : null;
  const noIdsReviveUrl = _noIdsReviveBcast?.url ?? null;

  if (rd.isRestDay) {
    card.className = 'race-card race-card--rest-day' + (_isLight ? ' race-card--light-color' : '');
    const restLabel = `<span class="race-card__stage">${t('stage.restDay')}</span>`;
    card.innerHTML = `
      ${logo}
      <div class="race-card__main">
        <div class="race-card__name"><span>${name}</span><span class="race-card__name-cat">${catBadgeHtml}</span>${race.raceFormat === 'stage_race' && race.startDate !== race.endDate && rd.raceId && !rd._race?.isNoClickable ? `<a class="race-card__overview-btn" href="${raceUrl(rd._race || { id: rd.raceId })}" aria-label="${t('race.viewFull')}" onclick="event.stopPropagation()"><span aria-hidden="true">☰</span></a>` : ''}</div>
        <div class="race-card__sub">${restLabel}</div>
      </div>
      <div class="race-card__meta">
        <div class="race-card__meta-top"></div>
      </div>
    `;
    // No clicable — sin listeners de navegación
    return card;
  }

  if (race.isCancelled) {
    card.className = 'race-card race-card--placeholder' + (_isLight ? ' race-card--light-color' : '');
    const flagHtml = hideFlag ? '' : flag;
    card.innerHTML = `
      <div class="race-card__ph-row">
        ${flagHtml ? `<span class="race-card__ph-flag">${flagHtml}</span>` : ''}
        <span class="race-card__ph-name" style="text-decoration:line-through">${name}${uci ? `<span class="race-card__name-cat">${categoryBadge(uci, isFemale)}</span>` : ''}</span>
        <span class="race-card__ph-stage race-card__cancelled-label" style="color:var(--red);font-weight:700;letter-spacing:0.05em;text-transform:uppercase">Cancelada</span>
      </div>
      <div class="race-card__meta"></div>
    `;
    card.addEventListener('mouseenter', e => {
      if (window.innerWidth < 600) return;
      let tip = document.getElementById('ph-tooltip');
      if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
      tip.textContent = 'Carrera cancelada';
      tip.style.display = 'block';
    });
    card.addEventListener('mousemove', e => {
      if (window.innerWidth < 600) return;
      const tip = document.getElementById('ph-tooltip');
      if (tip) { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
    });
    card.addEventListener('mouseleave', () => {
      if (window.innerWidth < 600) return;
      const tip = document.getElementById('ph-tooltip');
      if (tip) tip.style.display = 'none';
    });
    card.dataset.phName    = name;
    card.dataset.phFlag    = hideFlag ? '' : flag;
    card.dataset.phTooltip = 'Carrera cancelada';
    if (uci) card.dataset.phSub = uci;
    card.addEventListener('click', e => {
      if (window.innerWidth >= 600) return;
      e.stopPropagation();
      openPhBanner(card);
    });
  } else {
    // Estructura paritaria con iOS:
    //   __main: nombre · subtítulo (Etapa·ruta·km·elev) · fila de badges
    //   __meta: horario apilado (salida ↓ meta) + ☰  (+ resultados/revive si terminado)
    card.innerHTML = `
      ${logo}
      <div class="race-card__main">
        <div class="race-card__name"><span>${name}</span>${race.raceFormat === 'stage_race' && race.startDate !== race.endDate && rd.raceId && !rd._race?.isNoClickable ? `<a class="race-card__overview-btn" href="${raceUrl(rd._race || { id: rd.raceId })}" aria-label="${t('race.viewFull')}" onclick="event.stopPropagation()"><span aria-hidden="true">☰</span></a>` : ''}</div>
        <div class="race-card__sub">
          ${stagePart}${routeWrap}${sepRouteKm}${sepRouteElev}${kmPart}${sepKmElev}${sepStageElev}${elevPart}
        </div>
        ${_badgeRowHtml}
      </div>
      <div class="race-card__meta">
        <div class="race-card__meta-top">
          ${(showResults || hideNoIds || rd.isCancelledDay) ? '' : timeStackHtml}
        </div>
      </div>
    `;

    const tvEmbedBadge = card.querySelector('.badge--tv-link[data-tv-embed]');
    if (tvEmbedBadge) {
      tvEmbedBadge.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openBroadcastTvModal(rd, race, tvEmbedBadge.href);
      });
    }

    if (_epSvgHtml) {
      card.insertAdjacentHTML('beforeend', _epSvgHtml);
      if (_epEntry) _epEntry.clipRect = card.querySelector('.race-card__elevation rect');
    }

    if (showResults) {
      // Modo terminado: los iconos copa/TV se clavan al borde derecho sobre la
      // misma fila que el contenido (paridad apps); el título/subtítulo se
      // truncan y se desvanecen por debajo. Lo gobierna .race-card--finished.
      card.classList.add('race-card--finished');
      const metaTop = card.querySelector('.race-card__meta-top');

      const resultsBadge = document.createElement('button');
      resultsBadge.type = 'button';
      resultsBadge.className = 'badge badge--results badge--icon';
      resultsBadge.title = t('stage.results');
      resultsBadge.setAttribute('aria-label', t('stage.results'));
      resultsBadge.innerHTML = `${_trophySvg}<span class="badge__label">${t('stage.results')}</span>`;
      resultsBadge.addEventListener('click', e => { e.stopPropagation(); openResultsModal(rd, race); });
      // Orden: Resultados → Revive (la hamburguesa ☰ vive ahora junto al nombre)
      metaTop.appendChild(resultsBadge);

      const _reviveBcast = (rd._broadcasts || [])
        .filter(b => b.url && (b.showInRevive || /eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be|facebook\.com/i.test(b.url)))
        .sort((a, b) => {
          const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
          const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
          if (aSoc !== bSoc) return aSoc - bSoc;
          return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        })[0] ?? null;
      const reviveUrl = _reviveBcast?.url;
      if (reviveUrl) {
        const reviveYtId = _reviveBcast.embeddable !== false ? extractYouTubeId(reviveUrl) : null;
        const reviveBadge = document.createElement('a');
        reviveBadge.className = 'badge badge--tv badge--tv-link badge--revive badge--icon';
        reviveBadge.href = reviveUrl;
        reviveBadge.target = '_blank';
        reviveBadge.rel = 'noopener';
        reviveBadge.title = t('tv.reviveRace');
        reviveBadge.setAttribute('aria-label', t('tv.reviveRace'));
        reviveBadge.innerHTML = `${_tvSvg}<span class="badge__label">${t('tv.reviveRace')}</span>`;
        if (reviveYtId) {
          reviveBadge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openYoutubeTvModal(rd, race, reviveYtId); });
        } else {
          reviveBadge.addEventListener('click', e => e.stopPropagation());
        }
        resultsBadge.after(reviveBadge);
      }
    }

    if (hideNoIds && noIdsReviveUrl) {
      card.classList.add('race-card--finished');
      const noIdsYtId = _noIdsReviveBcast?.embeddable !== false ? extractYouTubeId(noIdsReviveUrl) : null;
      const metaTop = card.querySelector('.race-card__meta-top');
      const reviveBadge = document.createElement('a');
      reviveBadge.className = 'badge badge--tv badge--tv-link badge--revive badge--icon';
      reviveBadge.href = noIdsReviveUrl;
      reviveBadge.target = '_blank';
      reviveBadge.rel = 'noopener';
      reviveBadge.title = t('tv.reviveRace');
      reviveBadge.setAttribute('aria-label', t('tv.reviveRace'));
      reviveBadge.innerHTML = `${_tvSvg}<span class="badge__label">${t('tv.reviveRace')}</span>`;
      if (noIdsYtId) {
        reviveBadge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openYoutubeTvModal(rd, race, noIdsYtId); });
      } else {
        reviveBadge.addEventListener('click', e => e.stopPropagation());
      }
      metaTop.appendChild(reviveBadge);
    }

  }

  if (!rdClickable) {
    // Link para buscadores: la jornada tiene su propia URL indexable aunque
    // el usuario no pueda clicar la card. Antes iba con aria-hidden +
    // tabindex="-1", lo que cerraba a propósito la única ruta alternativa
    // que le quedaba al teclado y al lector: ahora es un enlace normal,
    // visible solo al recibir el foco.
    const seoLink = document.createElement('a');
    seoLink.href = jornadaUrl(rd);
    seoLink.className = 'race-card__seo-link';
    seoLink.textContent = raceName(race) || t('race.unknown');
    card.style.position = 'relative';
    card.appendChild(seoLink);

    if (hasModalData(rd)) {
      card.style.cursor = 'pointer';
      const open = e => {
        if (e?.target?.closest?.('a.badge, .race-card__overview-btn')) return;
        openRaceDataModal(rd, race);
      };
      card.addEventListener('click', open);
      // Abre un diálogo, no navega → botón.
      makeCardActivatable(card, {
        role: 'button',
        label: _cardAriaLabel(name, stage, uci),
        onActivate: open,
      });
    } else {
      card.style.cursor = 'default';
      const todayStr = new Date().toISOString().slice(0, 10);
      const phMsg = rd.isCancelledDay ? 'Etapa cancelada' : (rd.dateKey && todayStr < rd.dateKey) ? 'Por ahora sin información extra' : 'Sin información extra';
      card.addEventListener('mouseover', e => {
        if (window.innerWidth < 600) return;
        if (e.target.closest('a.badge, .race-card__overview-btn')) return;
        let tip = document.getElementById('ph-tooltip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
        tip.textContent = phMsg;
        tip.style.display = 'block';
      });
      card.addEventListener('mousemove', e => {
        if (window.innerWidth < 600) return;
        const tip = document.getElementById('ph-tooltip');
        if (!tip) return;
        if (e.target.closest('a.badge, .race-card__overview-btn')) { tip.style.display = 'none'; return; }
        tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      });
      card.addEventListener('mouseleave', () => {
        if (window.innerWidth < 600) return;
        const tip = document.getElementById('ph-tooltip');
        if (tip) tip.style.display = 'none';
      });
      const _dateShort = rd.dateKey ? new Date(rd.dateKey + 'T12:00:00').toLocaleDateString('es-ES', {day: 'numeric', month: 'short'}) : '';
      card.dataset.phName    = name;
      card.dataset.phFlag    = hideFlag ? '' : flag;
      card.dataset.phTooltip = phMsg;
      card.dataset.phSub     = [stage, _dateShort, uci].filter(Boolean).join(' · ');
      card.addEventListener('click', e => {
        if (window.innerWidth >= 600) return;
        e.stopPropagation();
        openPhBanner(card);
      });
    }
  } else {
    const go = () => {
      sessionStorage.removeItem('cc_nav');
      window.location.href = jornadaUrl(rd);
    };
    card.addEventListener('click', go);
    // La card navega: se anuncia como enlace y responde a Enter/Espacio.
    makeCardActivatable(card, {
      role: 'link',
      href: jornadaUrl(rd),
      label: _cardAriaLabel(name, stage, uci),
      onActivate: go,
    });
  }

  return card;
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

/** Comprueba si una carrera individual coincide con un filtro de categoría.
 *  Replica exactamente la lógica de applyAgendaFilters para consistencia. */
function matchesCategoryFilter(race, cat) {
  if (cat === 'all') return true;
  const uci = race.uciCategory || '';
  const gender = race.gender || '';
  const cc = (race.countryCode || '').toUpperCase();

  // Campeonatos Nacionales: élite cuenta como pro / por género; sub23 fuera.
  if (uci === 'CN') {
    if (isU23Championship(race)) return false;
    if (cat === 'pro')    return true;
    if (cat === 'male')   return !isFemaleChampionship(race);
    if (cat === 'female') return isFemaleChampionship(race);
    return false;
  }

  let base = false;
  if (cat === 'pro')    base = ['1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','WC','CC'].includes(uci);
  if (cat === 'uwt')    base = uci === '1.UWT' || uci === '2.UWT';
  if (cat === 'wwt')    base = uci === '1.WWT' || uci === '2.WWT';
  if (cat === 'male')   base = (gender !== 'female' || uci === 'WC' || uci === 'CC') && !['1.2','2.2','1.2U','2.2U'].includes(uci);
  if (cat === 'female') base = (gender === 'female' || uci === 'WC' || uci === 'CC') && !['1.2U','2.2U'].includes(uci) && (uci !== '1.2' && uci !== '2.2' || EUROPE.has(cc));
  if (!base) return false;

  // Ocultar CC que no sean Campeonato de Europa (igual que applyAgendaFilters)
  if (uci === 'CC') {
    return /europa|europe/i.test(race.name || '');
  }
  return true;
}

/** Busca el siguiente día con carreras que coincidan con el filtro (escanea hasta 180 días). */
function findNextDayWithRaces(afterDateKey, cat) {
  if (!_cachedYearRaces.length) return null;
  let [y, m, d] = afterDateKey.split('-').map(Number);
  for (let i = 0; i < 180; i++) {
    const dt = new Date(y, m - 1, d + 1 + i);
    const dk = toDateKey(dt);
    const hasMatch = _cachedYearRaces.some(race =>
      !race.isCancelled && isRaceDay(race, dk) && matchesCategoryFilter(race, cat)
    );
    if (hasMatch) return dk;
  }
  return null;
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
  const sortSelMobile = document.getElementById('agendaSortSelectMobile');

  function onSortChange(val) {
    if (!val) return;
    _agendaSort = val;
    if (sortSel) sortSel.value = val;
    if (sortSelMobile) sortSelMobile.value = val;
    loadDay(currentDateKey);
  }

  if (sortSel) sortSel.addEventListener('change', () => onSortChange(sortSel.value));
  if (sortSelMobile) sortSelMobile.addEventListener('change', () => onSortChange(sortSelMobile.value));

}

// ── Helpers de ordenación ─────────────────────────────────────────

// Devuelve el timestamp en segundos del primer broadcast con hora, o null
function _earliestTvSeconds(item) {
  const broadcasts = item._broadcasts || [];
  const withTime = broadcasts.filter(b => b.startTimeUtc != null).map(b => tsSeconds(b.startTimeUtc)).filter(s => s != null);
  if (!withTime.length) return null;
  return Math.min(...withTime);
}

// Devuelve el rango de TV del item para ordenar por Hora TV:
//   0 → con hora (cualquier estado confirmado que tenga hora en broadcasts)
//   1 → con TV pero sin hora (confirmed sin hora, o broadcasts sin hora)
//   2 → sin confirmar (tvStatus === 'pending')
//   3 → sin TV o sin datos
function _tvSortTier(item) {
  const tv = item.tvStatus || '';
  const hasBroadcasts = (item._broadcasts || []).length > 0;
  const hasHora = _earliestTvSeconds(item) !== null;

  if (hasHora) return 0;
  if (tv === 'pending') return 2;
  if (tv === 'confirmed' || hasBroadcasts) return 1;
  return 3;
}

// Devuelve segundos de hora meta, o null
function _finishSeconds(item) {
  return item.estimatedFinishTimeUtc != null ? tsSeconds(item.estimatedFinishTimeUtc) : null;
}

// ¿La jornada tiene miniperfil de elevación visible? (mismo dato que pinta la card)
// Un perfil marcado profileNotViewable cuenta como SIN perfil.
function _hasMiniProfile(item) {
  const ep = item?.elevationProfile;
  return !!(ep && !item.profileNotViewable && Array.isArray(ep.points) && ep.points.length >= 2);
}

// Comparador para ordenación por categoría (el orden base existente)
function _sortByCategory(a, b) {
  const phA = (a._placeholder || a._cancelled || a._race?.isCancelled) ? 1 : 0;
  const phB = (b._placeholder || b._cancelled || b._race?.isCancelled) ? 1 : 0;
  if (phA !== phB) return phA - phB;
  const rA = a._race || {}, rB = b._race || {};
  // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
  const cn = compareChampionships(rA, a, rB, b);
  if (cn != null && cn !== 0) return cn;
  const gtA = grandTourRank(rA), gtB = grandTourRank(rB);
  if (gtA !== gtB) return gtA - gtB;
  // Con miniperfil por delante de las que no lo tienen (dentro de su grupo, sigue el orden por categoría)
  const profA = _hasMiniProfile(a) ? 0 : 1, profB = _hasMiniProfile(b) ? 0 : 1;
  if (profA !== profB) return profA - profB;
  const catA = uciRank(rA.uciCategory, rA.name, rA.countryCode);
  const catB = uciRank(rB.uciCategory, rB.name, rB.countryCode);
  const lvlA = proLevel(rA.uciCategory, rA.name, rA.countryCode);
  const lvlB = proLevel(rB.uciCategory, rB.name, rB.countryCode);
  if (lvlA !== lvlB) return lvlA - lvlB;
  const genA = genderRank(rA.gender), genB = genderRank(rB.gender);
  if (genA !== genB) return genA - genB;
  if (catA !== catB) return catA - catB;
  // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA primero.
  // Desempate por hora de salida; si falta, por el sufijo A/B (asignado en
  // orden cronológico en annotateDoubleSectors).
  const timeA = tsSeconds(a.neutralStartTimeUtc) ?? 999999;
  const timeB = tsSeconds(b.neutralStartTimeUtc) ?? 999999;
  if (timeA !== timeB) return timeA - timeB;
  const sfx = (a._stageSuffix || '').localeCompare(b._stageSuffix || '');
  if (sfx !== 0) return sfx;
  return (rA.name || '').localeCompare(rB.name || '');
}

// Comparador para ordenación por Hora TV
function _sortByTvTime(a, b) {
  const phA = (a._placeholder || a._cancelled || a._race?.isCancelled) ? 1 : 0;
  const phB = (b._placeholder || b._cancelled || b._race?.isCancelled) ? 1 : 0;
  if (phA !== phB) return phA - phB;

  const tierA = _tvSortTier(a), tierB = _tvSortTier(b);
  if (tierA !== tierB) return tierA - tierB;

  // Mismo tier: si tienen hora, ordenar por hora más temprana
  if (tierA === 0) {
    const hA = _earliestTvSeconds(a) ?? 999999;
    const hB = _earliestTvSeconds(b) ?? 999999;
    if (hA !== hB) return hA - hB;
  }

  // Desempate: categoría
  return _sortByCategory(a, b);
}

// Comparador para ordenación por Hora Meta
function _sortByFinishTime(a, b) {
  const phA = (a._placeholder || a._cancelled || a._race?.isCancelled) ? 1 : 0;
  const phB = (b._placeholder || b._cancelled || b._race?.isCancelled) ? 1 : 0;
  if (phA !== phB) return phA - phB;

  const fA = _finishSeconds(a), fB = _finishSeconds(b);
  // Con hora meta primero, sin hora después
  if ((fA === null) !== (fB === null)) return fA === null ? 1 : -1;
  if (fA !== null && fB !== null && fA !== fB) return fA - fB;

  // Desempate: categoría
  return _sortByCategory(a, b);
}

function applyAgendaSort(items) {
  if (_agendaSort === 'tvtime')     return [...items].sort(_sortByTvTime);
  if (_agendaSort === 'finishtime') return [...items].sort(_sortByFinishTime);
  return items; // 'category': ya ordenado
}

function applyAgendaFilters(items) {
  if (_agendaCat !== 'all') {
    items = items.filter(item => {
      const r = item._race || {};
      const cat = r.uciCategory || '';
      const gender = r.gender || '';
      const name = r.name || '';
      const cc = (r.countryCode || '').toUpperCase();
      // Campeonatos Nacionales: las élite (masc/fem) cuentan como "pro"; las
      // sub23 quedan fuera de Pro/Masc/Fem (igual que las 1.2U/2.2U). Masc/Fem
      // respetan el género de la prueba (deducido del nombre/gender).
      if (cat === 'CN') {
        if (isU23Championship(r)) return false;
        if (_agendaCat === 'pro')    return true;
        if (_agendaCat === 'male')   return !isFemaleChampionship(r);
        if (_agendaCat === 'female') return isFemaleChampionship(r);
        return false; // uwt/wwt no aplican a CN
      }
      if (_agendaCat === 'pro')    return ['1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','WC','CC'].includes(cat);
      if (_agendaCat === 'uwt')    return cat === '1.UWT' || cat === '2.UWT';
      if (_agendaCat === 'wwt')    return cat === '1.WWT' || cat === '2.WWT';
      if (_agendaCat === 'male')   return (gender !== 'female' || cat === 'WC' || cat === 'CC') && !['1.2','2.2','1.2U','2.2U'].includes(cat);
      if (_agendaCat === 'female') return (gender === 'female' || cat === 'WC' || cat === 'CC') && !['1.2U','2.2U'].includes(cat) && (cat !== '1.2' && cat !== '2.2' || EUROPE.has(cc));
      return true;
    });
    // Ocultar pruebas CC que no son el Campeonato de Europa
    items = items.filter(item => {
      const r = item._race || {};
      if ((r.uciCategory || '') !== 'CC') return true;
      return /europa|europe/i.test(r.name || '');
    });
  }
  return items;
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
      ? (findNextDayWithRaces(currentDateKey, _agendaCat) || addDays(currentDateKey, 1))
      : (findPrevDayWithRaces(currentDateKey, _agendaCat) || addDays(currentDateKey, -1));

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
  const wasOnToday = currentDateKey === today;
  today = nowKey;                          // actualizar la referencia de "hoy"
  if (!wasOnToday) { buildDateBar(); return; } // respetar navegación manual
  currentDateKey = today;
  buildDateBar();
  loadDay(today, { skipEmptyDay: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _maybeAdvanceToNewLocalDay();
});
window.addEventListener('focus', _maybeAdvanceToNewLocalDay);
setInterval(_maybeAdvanceToNewLocalDay, 60_000);
