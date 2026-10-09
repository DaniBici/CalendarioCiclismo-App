// ─────────────────────────────────────────────────────────────────
//  CALENDARIO — subvista MES (agenda mensual)
//  Port 1:1 del MonthScreen de las apps (Android ui/month/MonthScreen.kt):
//  agenda vertical del mes con sección por día (círculo + día de la semana),
//  tarjetas de carrera con tinte de marca, chips de meses + selector de año,
//  chips de categoría con pin y botón "Hoy". Sustituye a la antigua rejilla
//  de mes.html (retirada 2026-06-12).
//  Lo importa dinámicamente js/calendario.js cuando la subvista se activa.
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, stageLabel, categoryRank, countryFlag, effectiveCountryCode,
         jornadaUrl, raceUrl, raceName, categoryBadge, rdLocation,
         setMeta, setMetaProperty, initPhTooltip, setCachedRace, openPhBanner,
         getPinnedFilter, renderFilterPins, handleFilterEvent, setPressed, femaleMark,
         needsFemaleMark, cleanFeminineName }
         from './shared.js';
import { isTourDelPorvenir } from './category-filter.js';
import { initI18n, t, getLang, getLocale } from './i18n.js';
import { readCalendarMonth, writeCalendarParams } from './calendario-query.js';
import { annotateDoubleSectors } from './services/races.js';
import { mergeRaces, missingRaceIds, monthDateRange } from './services/month-data.js';
import { fetchAllRows, fetchByIds } from './services/paged-query.js';
import { staleWhileRevalidate } from './services/local-cache.js';
import { PROFILE_PROBE_COLUMN, hasRenderableElevationProfile } from './stage/profile-availability.js';
import { hasModalData, openRaceDataModal } from './race-data-modal.js';
import { CAMP, CAMP_DATES, campUrl, campTitle, compareChampionships } from './campeonatos-config.js';

// ── Estado ────────────────────────────────────────────────────────
const today = new Date();
let viewYear  = today.getFullYear();
let viewMonth = today.getMonth(); // 0-based
let activeCat = getPinnedFilter() || 'all';
let _initialized = false;
let _scrolledToToday = false;

// Cachés por sesión de vista (se invalidan al recargar la página)
const _racesByMonth = {};  // 'YYYY-MM' → [races solapadas o referenciadas]
const _daysByMonth = {};   // 'YYYY-MM' → [race_days publicados]
let _rowRefs = new Map();  // id de fila → { rd, race } para la delegación de clics

const MIN_YEAR = 2026;
// El perfil completo solo decide si la fila enlaza a la jornada: basta la sonda.
const MONTH_DAY_COLUMNS = `id,raceId,dateKey,stageNumber,slug,slugEn,startLocation,startLocationEn,finishLocation,finishLocationEn,countryCode,primaryType,isRestDay,isCancelledDay,hasAssets,${PROFILE_PROBE_COLUMN},profileNotViewable,distanceKm,neutralStartTimeUtc,estimatedFinishTimeUtc,tvStatus,description,notes`;
const MONTH_RACE_COLUMNS = 'id,name,nameEn,slug,slugEn,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,colorHex,logoUrl,hideFlag,isCancelled,isNoClickable,websiteUrl';

const LOADING_HTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text"></p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

// ── Datos ─────────────────────────────────────────────────────────
// Paginado con orden estable: la respuesta de PostgREST tiene un tope de filas.
// Un mes cabe hoy en una página de 1.000.
async function fetchMonthData(year, month0) {
  const { startKey, endKey } = monthDateRange(year, month0);
  const [days, overlapping] = await Promise.all([
    fetchAllRows(() => supabase.from('race_days').select(MONTH_DAY_COLUMNS)
      .gte('dateKey', startKey).lte('dateKey', endKey).eq('editorialStatus', 'published').order('id'), 1000),
    fetchAllRows(() => supabase.from('races').select(MONTH_RACE_COLUMNS)
      .lte('startDate', endKey).gte('endDate', startKey).order('id'), 1000),
  ]);
  const missingIds = missingRaceIds(days, overlapping);
  const races = missingIds.length
    ? mergeRaces(overlapping, await fetchByIds(supabase, 'races', MONTH_RACE_COLUMNS, 'id', missingIds))
    : overlapping;
  return { days, races };
}

function prepareMonthData(year, month0, { days, races }) {
  const { monthKey, startKey, endKey, lastDay } = monthDateRange(year, month0);
  _daysByMonth[monthKey] = days;
  _racesByMonth[monthKey] = races;
  const raceMap = {};
  races.forEach(r => { raceMap[r.id] = r; setCachedRace(r.id, r); });
  return { rdDocs: days, races, raceMap, startKey, endKey, lastDay };
}

// ── Placeholders (carreras sin jornadas publicadas) — misma heurística
//    que la rejilla retirada y que el MonthScreen de las apps ───────
function buildPlaceholders(races, coveredRaceIds, startKey, endKey, year) {
  const out = {};
  for (const race of races) {
    if ((race.year || 0) !== year) continue;
    if (!race.startDate || !race.endDate) continue;
    if (coveredRaceIds.has(race.id)) continue;
    if (race.endDate < startKey || race.startDate > endKey) continue;

    const durationDays = (new Date(race.endDate) - new Date(race.startDate)) / 86400000 + 1;
    const isGrandTourFormat = race.raceFormat === 'stage_race' && durationDays > 13;

    const isRestDay = dk => {
      if (!isGrandTourFormat) return false;
      const d = new Date(dk + 'T12:00:00');
      if (d.getDay() !== 1) return false;
      let count = 0;
      const s = new Date(race.startDate + 'T12:00:00');
      for (let x = new Date(s); x <= d; x.setDate(x.getDate() + 1)) {
        if (x.getDay() === 1) count++;
      }
      return durationDays <= 23 ? count >= 2 : true;
    };

    const cur = new Date(Math.max(new Date(race.startDate + 'T12:00:00'), new Date(startKey + 'T12:00:00')));
    const end = new Date(Math.min(new Date(race.endDate + 'T12:00:00'),   new Date(endKey + 'T12:00:00')));
    let stageCount = 0;
    if (race.raceFormat === 'stage_race' && race.startDate < startKey) {
      const preStart = new Date(race.startDate + 'T12:00:00');
      for (let d = new Date(preStart); d < cur; d.setDate(d.getDate() + 1)) {
        if (!isRestDay(toDateKey(d))) stageCount++;
      }
    }
    while (cur <= end) {
      const dk = toDateKey(cur);
      if (!isRestDay(dk)) {
        stageCount++;
        if (!out[dk]) out[dk] = [];
        out[dk].push({
          id: `ph-${race.id}-${dk}`,
          _race: race,
          _placeholder: true,
          dateKey: dk,
          stageNumber: race.raceFormat === 'stage_race' ? stageCount : null,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return out;
}

// ── Filtro de categoría (mismas reglas que la web de siempre) ─────
const EUROPE = new Set(['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK']);
const ASIA_1 = /^(CN|TH|JP|TW|KR|HK|AZ)$/i;

function passesCategoryFilter(rd) {
  if (rd._race?.isCancelled && rd._placeholder) return false;
  const cat    = rd._race?.uciCategory || '';
  const gender = rd._race?.gender || '';
  const name   = rd._race?.name || '';
  const isMixedRelay = (cat === 'WC' || cat === 'CC') && /relevo mixto|mixed relay/i.test(name);
  // CN nunca como fila suelta (los Campeonatos van en su fila sintética).
  if (cat === 'CN') return false;
  if ((cat === 'WC' || cat === 'CC') && activeCat !== 'all') {
    if (!/europa|mundo/i.test(name)) return false;
  }
  const isAsia1 = (cat === '1.1' || cat === '2.1') && ASIA_1.test(rd._race?.countryCode || '');
  if (activeCat === 'pro')    return !isAsia1 && cat !== '1.2' && cat !== '2.2' && (cat !== '1.2U' && cat !== '2.2U' || isTourDelPorvenir(name));
  if (activeCat === 'uwt')    return cat === '1.UWT' || cat === '2.UWT';
  if (activeCat === 'wwt')    return cat === '1.WWT' || cat === '2.WWT';
  if (activeCat === 'male')   return !isAsia1 && (gender === 'male' || isMixedRelay) && cat !== '1.2' && cat !== '2.2' && (cat !== '1.2U' && cat !== '2.2U' || isTourDelPorvenir(name));
  if (activeCat === 'female') return !isAsia1 && (gender === 'female' || isMixedRelay) && (cat !== '1.2U' && cat !== '2.2U' || isTourDelPorvenir(name)) && ((cat !== '1.2' && cat !== '2.2') || EUROPE.has((rd._race?.countryCode || '').toUpperCase()));
  return true; // 'all'
}

function sortDayRaces(list) {
  return list.sort((a, b) => {
    const phA = a._placeholder ? 1 : 0, phB = b._placeholder ? 1 : 0;
    if (phA !== phB) return phA - phB;
    // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
    const cn = compareChampionships(a._race, a, b._race, b);
    if (cn != null && cn !== 0) return cn;
    const catDiff = categoryRank(a._race?.uciCategory, a._race?.name, a._race?.countryCode)
                  - categoryRank(b._race?.uciCategory, b._race?.name, b._race?.countryCode);
    if (catDiff !== 0) return catDiff;
    const genA = a._race?.gender === 'female' ? 2 : 1;
    const genB = b._race?.gender === 'female' ? 2 : 1;
    if (genA !== genB) return genA - genB;
    // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA primero.
    // Desempate por hora de salida; si falta, por el sufijo A/B (que ya se
    // asigna en orden cronológico en annotateDoubleSectors).
    const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
    const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
    if (tA !== tB) return tA - tB;
    const sfx = (a._stageSuffix || '').localeCompare(b._stageSuffix || '');
    if (sfx !== 0) return sfx;
    return (a._race?.name || '').toLowerCase().localeCompare((b._race?.name || '').toLowerCase(), 'es');
  });
}

// ── Render ────────────────────────────────────────────────────────
function raceRowHtml(rd, refId) {
  const race = rd._race || {};
  const color = race.colorHex || 'var(--accent)';
  const isRestDay = rd.isRestDay === true;
  const cancelled = race.isCancelled === true || rd.isCancelledDay === true;

  const flag = race.hideFlag && !rd.countryCode ? '' : countryFlag(effectiveCountryCode(rd, race), { lazy: true });
  const isFemale = needsFemaleMark(race, activeCat);
  const name = cleanFeminineName(raceName(race) || '-', activeCat);

  let l1Extra = '';
  if (isRestDay)       l1Extra = `<span class="cal-race__note">· ${t('stage.restDay')}</span>`;
  else if (cancelled)  l1Extra = `<span class="cal-race__note cal-race__note--cancel">· ${t('stage.cancelled')}</span>`;

  // Segunda línea: badge UCI + etiqueta de etapa (+ tipo CRI/CRE) + recorrido
  let l2 = '';
  if (!isRestDay) {
    const cat = race.uciCategory ? categoryBadge(race.uciCategory) : '';
    const stageStr = (rd.stageNumber != null && rd.stageNumber !== '') ? stageLabel(rd.stageNumber, rd._stageSuffix) : '';
    // Tipo CRI/CRE: la misma etiqueta de color que en Hoy.
    const typeBadge = (rd.primaryType === 'itt' || rd.primaryType === 'ttt')
      ? `<span class="badge badge--type-chrono">${t(`types.${rd.primaryType}`)}</span>` : '';
    const route = (race.raceFormat === 'stage_race' && rd.startLocation)
      ? (!rd.finishLocation || rd.startLocation === rd.finishLocation
          ? rdLocation(rd, 'startLocation')
          : `${rdLocation(rd, 'startLocation')} › ${rdLocation(rd, 'finishLocation')}`)
      : '';
    l2 = `<div class="cal-race__l2">${cat}${typeBadge}${stageStr ? `<span class="cal-race__stage">${stageStr}</span>` : ''}${route ? `<span class="cal-race__route">${route}</span>` : ''}</div>`;
  }

  const logo = race.logoUrl
    ? `<img class="cal-race__logo" src="${race.logoUrl}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '<span class="cal-race__logo cal-race__logo--empty"></span>';

  const nameStyle = cancelled ? ' style="text-decoration:line-through;opacity:0.5"' : '';
  const inner = `${logo}<div class="cal-race__main"><div class="cal-race__l1"><span class="cal-race__flag">${flag}</span><span class="cal-race__name"${nameStyle}>${name}</span>${isFemale ? femaleMark({ cls: 'cal-race__female' }) : ''}${l1Extra}</div>${l2}</div><span class="cal-race__chev">›</span>`;

  // Destino del clic: misma lógica que la rejilla retirada.
  const isNoClickable = race.isNoClickable === true;
  const isStageRace   = race.raceFormat === 'stage_race';
  const rdViewableProfile = hasRenderableElevationProfile(rd);
  const rdHasAssets = rdViewableProfile || (rd.hasAssets === true);
  const rdClickable = !rd._placeholder && !isRestDay && !isNoClickable && rdHasAssets && !cancelled;

  const cls = `cal-race${isRestDay ? ' cal-race--rest' : ''}${rd._placeholder ? ' cal-race--ph' : ''}`;
  const style = `--rc:${color}`;

  if (rdClickable) {
    return `<a class="${cls}" href="${jornadaUrl(rd)}" style="${style}" data-ref="${refId}" data-nav="1">${inner}</a>`;
  }
  if (!rd._placeholder && !isRestDay && !cancelled && isStageRace) {
    const month = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    return `<a class="${cls}" href="${raceUrl(race, { from: 'mes', month })}" style="${style}" data-ref="${refId}" data-nav="1">${inner}</a>`;
  }
  // Estas dos filas abren un diálogo en vez de navegar: <button> real, que
  // ya trae foco, Enter/Espacio y el rol anunciado (WCAG 2.1.1). No llevan
  // enlaces anidados, así que el botón no rompe nada.
  if (!rd._placeholder && !isRestDay && !cancelled && hasModalData(rd)) {
    return `<button type="button" class="${cls} cal-race--modal" style="${style}" data-ref="${refId}" data-modal="1">${inner}</button>`;
  }
  // Placeholder / sin información: banner-tooltip (mismo openPhBanner de la rejilla)
  return `<button type="button" class="${cls}" style="${style}" data-ref="${refId}" data-ph="1">${inner}</button>`;
}

function champRowHtml() {
  return `<a class="cal-race cal-race--champ" href="${campUrl(getLang())}" style="--rc:${CAMP.ACCENT}">
    <span class="cal-race__logo cal-race__logo--empty"></span>
    <div class="cal-race__main"><div class="cal-race__l1"><span class="cal-race__name">${campTitle(getLang())}</span></div>
    <div class="cal-race__l2">${categoryBadge('CN')}</div></div><span class="cal-race__chev">›</span></a>`;
}

async function renderMes() {
  window.__spaDrivenAnalytics = true;
  window._icalYear = viewYear;
  const content = document.getElementById('mesContent');
  const year = viewYear;
  const month0 = viewMonth;
  const monthKey = `${year}-${String(month0 + 1).padStart(2, '0')}`;
  const isCurrent = () => monthKey === `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

  updateChips();

  if (_daysByMonth[monthKey]) {
    paintMonth(prepareMonthData(year, month0, { days: _daysByMonth[monthKey], races: _racesByMonth[monthKey] }));
    return;
  }

  // La copia local, si existe, sustituye a la pantalla de carga en el acto;
  // la lectura de red solo repinta si trae cambios.
  content.innerHTML = LOADING_HTML;
  content.querySelector('.loading__text').textContent = t('loading.month');
  let painted = false;
  try {
    await staleWhileRevalidate(`mes:${monthKey}`, () => fetchMonthData(year, month0), bundle => {
      // Si el usuario cambió de mes mientras cargaba, descartar este render
      if (!isCurrent()) return;
      paintMonth(prepareMonthData(year, month0, bundle), { refresh: painted });
      painted = true;
    });
  } catch (err) {
    console.error('[calendario-mes]', err);
    if (isCurrent()) content.innerHTML = `<div class="empty-state"><p class="empty-state__text">${t('loading.month')}: error</p></div>`;
  }
}

// `refresh`: repintado por revalidación; conserva el scroll y no repite la analítica.
function paintMonth(data, { refresh = false } = {}) {
  const content = document.getElementById('mesContent');
  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const keepScrollY = refresh ? window.scrollY : null;
  const { rdDocs, races, raceMap, startKey, endKey, lastDay } = data;

  const byDate = {};
  for (const rd of rdDocs) {
    if (rd.raceId) rd._race = raceMap[rd.raceId] || {};
    if (!byDate[rd.dateKey]) byDate[rd.dateKey] = [];
    byDate[rd.dateKey].push(rd);
  }
  annotateDoubleSectors(rdDocs);

  const coveredRaceIds = new Set(rdDocs.map(rd => rd.raceId).filter(Boolean));
  const placeholders = buildPlaceholders(races, coveredRaceIds, startKey, endKey, viewYear);
  Object.entries(placeholders).forEach(([dk, list]) => {
    if (!byDate[dk]) byDate[dk] = [];
    byDate[dk].push(...list);
  });

  _rowRefs = new Map();
  const todayKey = toDateKey(today);
  const MESES = t('months.long');
  const monthTitle = `${MESES[viewMonth] || ''} ${viewYear}`;

  let html = `<div class="cal-mes-list"><h2 class="cal-mes-title">${monthTitle}</h2>`;
  for (let d = 1; d <= lastDay; d++) {
    const dk = `${monthKey}-${String(d).padStart(2, '0')}`;
    const isToday = dk === todayKey;
    const weekdayRaw = new Date(dk + 'T12:00:00').toLocaleDateString(getLocale(), { weekday: 'long' });
    const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);

    const dayRaces = sortDayRaces((byDate[dk] || []).filter(passesCategoryFilter));
    const isChampDay = viewYear === CAMP.YEAR && CAMP_DATES.has(dk);

    let rowsHtml = '';
    dayRaces.forEach(rd => {
      const refId = rd.id;
      _rowRefs.set(refId, rd);
      rowsHtml += raceRowHtml(rd, refId);
    });
    if (isChampDay) rowsHtml = champRowHtml() + rowsHtml;

    html += `<section class="cal-day${isToday ? ' cal-day--today' : ''}" id="cal-day-${dk}">
      <div class="cal-day__head"><span class="cal-day__num">${d}</span><span class="cal-day__wd">${weekday}</span></div>
      ${rowsHtml ? `<div class="cal-day__races">${rowsHtml}</div>` : `<p class="cal-day__empty">${t('cal.noRaces')}</p>`}
    </section>`;
  }
  html += '</div>';
  content.innerHTML = html;

  // Auto-scroll a hoy en el mes en curso (solo el primer render, como la app)
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  if (isCurrentMonth && !_scrolledToToday) {
    _scrolledToToday = true;
    scrollToToday(false);
  }

  syncUrl();
  updateSeoMes(byDate);
  if (refresh) {
    window.scrollTo({ top: keepScrollY, behavior: 'instant' });
    return;
  }
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
}

function scrollToToday(smooth = true) {
  const el = document.getElementById(`cal-day-${toDateKey(today)}`);
  if (!el) return;
  const headerH = document.querySelector('.site-header')?.offsetHeight || 56;
  const navH = document.querySelector('.primary-nav')?.offsetHeight || 0;
  const barH = document.getElementById('mesBar')?.offsetHeight || 0;
  const top = el.getBoundingClientRect().top + window.scrollY - headerH - navH - barH - 6;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'instant' });
}

// ── Chips de meses + selector de año ──────────────────────────────
let _chipsScrolledOnce = false;
function updateChips() {
  const chips = document.getElementById('mesChips');
  if (!chips) return;
  chips.querySelectorAll('.cal-month-chip').forEach((b, i) => {
    b.classList.toggle('cal-month-chip--active', i === viewMonth);
  });
  // Centrar el chip activo SIN scrollIntoView (movería también la página);
  // se desplaza solo el contenedor horizontal, instantáneo en el primer render.
  const active = chips.querySelector('.cal-month-chip--active');
  if (active) {
    // Posición del chip dentro del contenido scrolleable (offsetLeft no sirve:
    // el offsetParent es la fila, no el contenedor de chips).
    const contentX = active.getBoundingClientRect().left - chips.getBoundingClientRect().left + chips.scrollLeft;
    const target = contentX - (chips.clientWidth - active.offsetWidth) / 2;
    chips.scrollTo({ left: Math.max(0, target), behavior: _chipsScrolledOnce ? 'smooth' : 'instant' });
    _chipsScrolledOnce = true;
  }
  const yearSel = document.getElementById('mesYear');
  if (yearSel && yearSel.value !== String(viewYear)) yearSel.value = String(viewYear);
}

function buildBar() {
  // Chips Ene..Dic
  const chips = document.getElementById('mesChips');
  const MESES_SHORT = t('months.short');
  chips.innerHTML = MESES_SHORT.map((m, i) =>
    `<button class="cal-month-chip" data-month="${i}">${m}</button>`).join('');
  chips.addEventListener('click', e => {
    if (chips.dataset.dragged === 'true') {
      delete chips.dataset.dragged;
      return;
    }
    const btn = e.target.closest('.cal-month-chip');
    if (!btn) return;
    viewMonth = Number(btn.dataset.month);
    renderMes();
  });
  // En escritorio la barra de scroll está oculta: permitir arrastrar los meses
  // con el ratón, manteniendo el clic normal para seleccionar un mes.
  let pointerStartX = 0;
  let pointerStartScroll = 0;
  let activePointerId = null;
  let isDragging = false;
  chips.addEventListener('pointerdown', e => {
    // En táctil el propio ScrollView horizontal del navegador ya gestiona el
    // arrastre. Capturar el puntero aquí convertía el mínimo temblor del dedo
    // en un drag y anulaba el clic de los meses.
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    activePointerId = e.pointerId;
    pointerStartX = e.clientX;
    pointerStartScroll = chips.scrollLeft;
    isDragging = false;
  });
  chips.addEventListener('pointermove', e => {
    if (e.pointerId !== activePointerId) return;
    const distance = e.clientX - pointerStartX;
    if (!isDragging && Math.abs(distance) < 4) return;
    isDragging = true;
    chips.classList.add('cal-month-chips--dragging');
    chips.scrollLeft = pointerStartScroll - distance;
  });
  const stopDragging = e => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    chips.classList.remove('cal-month-chips--dragging');
    if (isDragging) {
      chips.dataset.dragged = 'true';
      // El click sintético posterior al arrastre se ignora; si no se genera,
      // se limpia antes de la siguiente interacción.
      setTimeout(() => delete chips.dataset.dragged, 0);
    }
  };
  chips.addEventListener('pointerup', stopDragging);
  chips.addEventListener('pointercancel', stopDragging);
  chips.addEventListener('pointerleave', stopDragging);

  // Selector de año
  const yearSel = document.getElementById('mesYear');
  const years = [];
  for (let y = Math.max(MIN_YEAR, today.getFullYear() + 1); y >= MIN_YEAR; y--) years.push(y);
  if (!years.includes(viewYear)) years.unshift(viewYear);
  yearSel.innerHTML = years.map(y => `<option value="${y}"${y === viewYear ? ' selected' : ''}>${y}</option>`).join('');
  yearSel.addEventListener('change', () => {
    viewYear = Number(yearSel.value);
    viewMonth = viewYear === today.getFullYear() ? today.getMonth() : 0;
    renderMes();
  });

  // Botón "Hoy"
  document.getElementById('mesTodayBtn').addEventListener('click', () => {
    const sameMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    if (sameMonth) scrollToToday();
    else renderMes().then(() => scrollToToday());
  });

  // Filtros de categoría (mismo patrón pin/click que temporada)
  const mesCats = document.getElementById('mesCats');
  mesCats.querySelectorAll('.tcat-btn').forEach(b =>
    setPressed(b, b.dataset.cat === activeCat));
  renderFilterPins(mesCats, activeCat);
  const onFilterEvent = e => {
    const res = handleFilterEvent(e);
    if (!res) return;
    if (res.type === 'pin') { renderFilterPins(mesCats, activeCat); return; }
    activeCat = res.cat;
    mesCats.querySelectorAll('.tcat-btn').forEach(b =>
      setPressed(b, b.dataset.cat === activeCat));
    renderFilterPins(mesCats, activeCat);
    renderMes();
  };
  mesCats.addEventListener('click', onFilterEvent);
  mesCats.addEventListener('keydown', onFilterEvent);

  // Delegación de clics del contenido (modales, placeholders, nav-state)
  document.getElementById('mesContent').addEventListener('click', e => {
    const row = e.target.closest('.cal-race[data-ref]');
    if (!row) return;
    const rd = _rowRefs.get(row.dataset.ref);
    if (!rd) return;
    if (row.dataset.nav) {
      sessionStorage.setItem('cc_nav', JSON.stringify({ from: 'mes', month: viewMonth, year: viewYear }));
      return; // el <a> navega solo
    }
    if (row.dataset.modal) { openRaceDataModal({ id: rd.id, _stageSuffix: rd._stageSuffix }, rd._race); return; }
    if (row.dataset.ph) {
      const todayStr = new Date().toISOString().slice(0, 10);
      row.dataset.phMsg = rd._race?.isCancelled
        ? t('stage.cancelled')
        : ((rd._race?.startDate && todayStr < rd._race.startDate) || (rd.dateKey && todayStr < rd.dateKey)
            ? 'Por ahora sin información extra' : 'Sin información extra');
      row.dataset.phName = rd._race?.name || '';
      row.dataset.phFlag = countryFlag(effectiveCountryCode(rd, rd._race));
      const _stageStr  = rd.stageNumber ? stageLabel(rd.stageNumber, rd._stageSuffix) : '';
      const _dateShort = rd.dateKey ? new Date(rd.dateKey + 'T12:00:00').toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' }) : '';
      const _sub = [_stageStr, _dateShort, rd._race?.uciCategory || ''].filter(Boolean).join(' · ');
      if (_sub) row.dataset.phSub = _sub;
      openPhBanner(row);
    }
  });
}

// ── URL + SEO ─────────────────────────────────────────────────────
function syncUrl() {
  const qs = new URLSearchParams(location.search);
  writeCalendarParams(qs, getLang(), { view: 'mes', month: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}` });
  history.replaceState(null, '', `${location.pathname}?${qs}`);
}

function updateSeoMes(byDate) {
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Tour de Francia, Giro de Italia, Vuelta a España, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';
  const TOP_CATS = new Set(['WC', 'CC', '1.UWT', '2.UWT', '1.Pro', '2.Pro']);
  const mesNombre = new Date(viewYear, viewMonth, 1).toLocaleDateString(getLocale(), { month: 'long' });
  const mesCapit  = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

  const isEn = getLang() === 'en';
  const topRaces = new Set();
  Object.values(byDate).forEach(list => list.forEach(rd => {
    if (TOP_CATS.has(rd._race?.uciCategory || '')) topRaces.add((isEn && rd._race?.nameEn) || rd._race?.name || '');
  }));
  const racesStr = topRaces.size
    ? (isEn ? ` Races this month: ${[...topRaces].join(', ')}.` : ` Este mes se disputan ${[...topRaces].join(', ')}.`)
    : '';

  const title = isEn
    ? `${mesCapit} ${viewYear} - ${t('seo.siteName')}`
    : `${mesCapit} de ${viewYear} - ${t('seo.siteName')}`;
  const description = (isEn
    ? `All professional cycling races in ${mesCapit} ${viewYear}: routes, schedules and how to watch on TV and online streaming.${racesStr}`
    : `Todas las carreras ciclistas profesionales de ${mesNombre} de ${viewYear}: recorridos, horarios y cómo ver por TV y online streaming.${racesStr}`).trim();
  document.title = title;
  setMeta('description', description);
  setMeta('keywords', [BASE_KW, `${mesNombre} ${viewYear}`, mesNombre, String(viewYear), ...topRaces].filter(Boolean).join(', '));
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);

  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) || window.location.origin;
  const canonQs = writeCalendarParams(new URLSearchParams(), getLang(), { view: 'mes', month: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}` });
  const canonicalUrl = `${origin}${location.pathname}?${canonQs}`;
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;
  setMetaProperty('og:url', canonicalUrl);
}

// ── API pública (la consume js/calendario.js) ─────────────────────
export async function initMesView() {
  if (_initialized) { renderMes(); return; }
  _initialized = true;

  await initI18n();

  const params = new URLSearchParams(location.search);
  const monthParam = readCalendarMonth(params); // ?mes= (ES), ?month= (EN y legacy de mes.html)
  if (monthParam) {
    const [y, m] = monthParam.split('-').map(Number);
    viewYear = y;
    viewMonth = m - 1;
    _scrolledToToday = true; // mes explícito en la URL → no saltar a hoy
  }
  if (params.get('cat')) activeCat = params.get('cat');

  buildBar();
  initPhTooltip();
  await renderMes();
}
