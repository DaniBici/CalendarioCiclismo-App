// ─────────────────────────────────────────────────────────────────
//  MODO CAMPEONATOS — campeonatos-nacionales-2026.html
//                     /en/2026-national-championships/
//  Rejilla de países × pruebas de los Campeonatos Nacionales.
//  Reutiliza los botones de assets, el badge de TV y el modal de
//  carrera de la vista de competición (race-assets.js / race-data-modal.js).
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, rdLocation, filterBroadcastsByRegion,
         formatTimeUser, raceName, esc, setMeta, setMetaProperty, jornadaUrl, setPressed }
         from './shared.js';
import { t, getLang, getLocale, initI18n } from './i18n.js';
import { openRaceDataModal, openResultsModal, hasModalData, buildFcUrl, buildPcsUrl, isRaceConcluded, loadInhouseStageSet } from './race-data-modal.js';
import { tvBadge, buildAssetButtons } from './race-assets.js';
import { initCintillo } from './cintillo.js';
import { CAMP, championshipSlot, slotLabels, campTitle,
         isChampTodayFilterActive, campTodayKey } from './campeonatos-config.js';

// Mapas globales para resolver el modal al hacer click en una celda.
const _rdById   = {};
const _raceById = {};

// Estado para el filtrado (Todas/Pro/Masc/Fem). Empieza siempre en 'all'.
let _byCountry = {};
let _ordered   = [];
let _campFilter = 'all';

// Bandera de meta ajedrezada (icono junto al horario de fin): mástil a la
// izquierda + recuadro con tablero monocromo (cuadros rellenos alternos), para
// que se lea como bandera de cuadros y no como una bandera lisa. Monocromo
// (hereda currentColor), al estilo del resto de iconos lineales de la rejilla.
const _finishFlagSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="2.5" width="1.6" height="19" rx="0.8" fill="currentColor"/><g fill="currentColor"><rect x="6" y="3" width="4" height="4"/><rect x="14" y="3" width="4" height="4"/><rect x="10" y="7" width="4" height="4"/><rect x="6" y="11" width="4" height="4"/><rect x="14" y="11" width="4" height="4"/></g><rect x="6" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

// Trofeo (resultados in-house → /resultados/). Mismo icono que las race cards de Hoy.
const _trophySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>';

// Día abreviado + número a partir de un dateKey: "Sáb. 27" (ES, con punto) / "Sat 27" (EN).
function dayShort(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  let wd = dt.toLocaleDateString(getLocale(), { weekday: 'short' });
  wd = wd.charAt(0).toUpperCase() + wd.slice(1).replace(/\.$/, '');
  const isEn = getLang() === 'en';
  return isEn ? `${wd} ${d}` : `${wd}. ${d}`;
}

async function init() {
  await initI18n();
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const content = document.getElementById('campeonatosContent');
  const isEn = getLang() === 'en';

  updateSeo();
  initCintillo(); // cintillo (today_highlights), igual que la portada "Hoy"

  try {
    // 1. Carreras CN del año dentro del rango de fechas.
    const { data: racesData, error: racesErr } = await supabase.from('races').select('*')
      .eq('uciCategory', 'CN').eq('year', CAMP.YEAR)
      .gte('startDate', CAMP.QUERY_START).lte('startDate', CAMP.QUERY_END);
    if (racesErr) throw racesErr;
    const races = racesData || [];

    if (!races.length) {
      content.innerHTML = emptyState(isEn);
      fireAnalytics();
      return;
    }

    races.forEach(r => { _raceById[r.id] = r; });
    const raceIds = races.map(r => r.id);

    // 2. Jornadas publicadas de esas carreras + assets + broadcasts (en paralelo).
    const { data: rdData } = await supabase.from('race_days').select('*')
      .in('raceId', raceIds).eq('editorialStatus', 'published');
    const days = rdData || [];
    const dayIds = days.map(d => d.id);

    const [bResult, aResult, inhouseSet] = dayIds.length
      ? await Promise.all([
          supabase.from('broadcasts').select('*').in('raceDayId', dayIds),
          supabase.from('assets').select('*').in('raceDayId', dayIds),
          loadInhouseStageSet(raceIds),
        ])
      : [{ data: [] }, { data: [] }, { has: () => false }];
    const bByRd = {}, aByRd = {};
    (bResult.data || []).forEach(b => { (bByRd[b.raceDayId] ??= []).push(b); });
    (aResult.data || []).forEach(a => { (aByRd[a.raceDayId] ??= []).push(a); });
    days.forEach(rd => {
      const _allB = bByRd[rd.id] || [];
      rd._broadcasts = filterBroadcastsByRegion(_allB);
      // Había TV pero ninguna emisión sobrevive al filtro regional → suprimir el badge.
      rd._tvBlocked = _allB.length > 0 && rd._broadcasts.length === 0;
      rd._assets     = aByRd[rd.id] || [];
      // ¿Clasificaciones in-house (keepForWeb)? → el trofeo abre /resultados/ (nativo
      // de la web), igual que las race cards de Hoy; si no, caemos a FC/PCS.
      rd._hasInhouse = inhouseSet.has(rd);
      _rdById[rd.id] = rd;
    });

    // 3. Emparejar cada carrera con su (primera) jornada publicada.
    const firstDayByRace = {};
    days.forEach(rd => {
      const cur = firstDayByRace[rd.raceId];
      if (!cur || (rd.dateKey || '') < (cur.dateKey || '')) firstDayByRace[rd.raceId] = rd;
    });

    // 4. Agrupar por país y bucketizar en slots.
    //    byCountry[cc] = { slots: { slot: {race, rd} }, hostCity }
    const byCountry = {};
    for (const race of races) {
      const rd = firstDayByRace[race.id];
      if (!rd) continue; // sin jornada publicada → no se muestra
      const cc = (race.countryCode || '').toUpperCase();
      if (!cc) continue;
      const slot = championshipSlot(race, rd);
      (byCountry[cc] ??= { slots: {}, hostCity: '' });
      byCountry[cc].slots[slot] = { race, rd };
    }
    // Sede de la prueba élite masculina de ruta (linea_masc): si tiene meta,
    // se usa la META (más representativa de la sede del campeonato); si solo
    // tiene salida, se usa la salida.
    Object.values(byCountry).forEach(entry => {
      const elite = entry.slots['linea_masc'];
      entry.hostCity = elite
        ? (rdLocation(elite.rd, 'finishLocation') || rdLocation(elite.rd, 'startLocation') || '')
        : '';
    });

    // 5. Orden de países: COUNTRY_ORDER primero, luego el resto por bandera/código.
    const present = Object.keys(byCountry);
    const ordered = [
      ...CAMP.COUNTRY_ORDER.filter(cc => byCountry[cc]),
      ...present.filter(cc => !CAMP.COUNTRY_ORDER.includes(cc)).sort(),
    ];

    if (!ordered.length) {
      content.innerHTML = emptyState(isEn);
      fireAnalytics();
      return;
    }

    // Guardar estado para el filtrado y pintar el armazón (título + filtros + grid).
    _byCountry = byCountry;
    _ordered   = ordered;

    const isEnF = getLang() === 'en';
    // Filtro "Hoy": solo del 24 al 28 de junio (ambos inclusive). Cuando aparece
    // es el primero y el predeterminado; filtra por la jornada del día en curso.
    const showToday = isChampTodayFilterActive();
    _campFilter = showToday ? 'today' : 'all';
    const F = (cat, label) => `<button type="button" class="tcat-btn${cat === _campFilter ? ' tcat-btn--active' : ''}" aria-pressed="${cat === _campFilter}" data-camp-filter="${cat}">${label}</button>`;
    content.innerHTML = `<div class="camp-sticky">
      <div class="camp-sticky__inner">
        <h1 class="camp-title">${esc(campTitle(getLang()))} ${CAMP.YEAR}</h1>
        <div class="agenda-filter-cats camp-filters" id="campFilters">
          ${showToday ? F('today', isEnF ? 'Today' : 'Hoy') : ''}
          ${F('all',    isEnF ? 'All'   : 'Todas')}
          ${F('pro',    'Pro')}
          ${F('male',   isEnF ? 'Men'   : 'Masc')}
          ${F('female', isEnF ? 'Women' : 'Fem')}
        </div>
      </div>
    </div>
    <div class="camp-wrap">
      <div class="camp-grid" id="campGrid"></div>
    </div>`;

    renderGrid();

    // Filtros (Todas/Pro/Masc/Fem) — estado local, sin persistencia.
    document.getElementById('campFilters').addEventListener('click', e => {
      const btn = e.target.closest('.tcat-btn');
      if (!btn) return;
      _campFilter = btn.dataset.campFilter;
      document.querySelectorAll('#campFilters .tcat-btn').forEach(b =>
        setPressed(b, b.dataset.campFilter === _campFilter));
      renderGrid();
    });

    // Click en celda (zona sin botones/badges) → modal de carrera.
    content.addEventListener('click', e => {
      // Trofeo de resultados in-house → openResultsModal (redirige a /resultados/).
      const trophy = e.target.closest('.camp-inhouse-trophy');
      if (trophy) {
        const cell = trophy.closest('.camp-cell');
        const rd   = _rdById[cell?.dataset.rdid];
        const race = _raceById[cell?.dataset.raceid];
        if (rd) openResultsModal(rd, race);
        return;
      }
      const cell = e.target.closest('.camp-cell');
      if (!cell) return;
      if (e.target.closest('a.badge, button.badge, .badge--tv-link')) return;
      const nav = cell.dataset.nav;
      if (!nav) return; // celda sin datos → no clicable (mismas condiciones que Hoy)
      const rd   = _rdById[cell.dataset.rdid];
      const race = _raceById[cell.dataset.raceid];
      if (!rd) return;
      if (nav === 'jornada') { sessionStorage.removeItem('cc_nav'); window.location.href = jornadaUrl(rd); }
      else { openRaceDataModal(rd, race); }
    });

    fireAnalytics();
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="camp-wrap"><div class="empty-state"><div class="empty-state__text">${
      isEn ? 'Error loading the championships.' : 'Error al cargar los campeonatos.'}</div></div></div>`;
  }
}

// Pinta la rejilla según el filtro activo (_campFilter). Los filtros por género
// (Todas/Pro/Masc/Fem) restringen los slots vía CAMP.SLOT_FILTERS; el filtro
// "Hoy" muestra todos los slots pero solo las pruebas de la jornada del día.
// Los países sin ninguna prueba bajo el filtro se omiten.
function renderGrid() {
  const grid = document.getElementById('campGrid');
  if (!grid) return;
  const labels  = slotLabels(getLang());
  const isToday = _campFilter === 'today';
  const todayK  = isToday ? campTodayKey() : null;
  const allowed = isToday
    ? CAMP.SLOT_FILTERS.all
    : (CAMP.SLOT_FILTERS[_campFilter] || CAMP.SLOT_FILTERS.all);
  const allowedSet = new Set(allowed);

  let html = '';
  let visibleRows = 0;
  for (const cc of _ordered) {
    const entry = _byCountry[cc];
    // Celdas visibles para este país bajo el filtro actual.
    const cells = CAMP.SLOT_ORDER
      .filter(slot => allowedSet.has(slot) && entry.slots[slot]
        && (!isToday || entry.slots[slot].rd.dateKey === todayK))
      .map(slot => eventCell(entry.slots[slot].race, entry.slots[slot].rd, labels[slot]));
    if (!cells.length) continue; // país sin pruebas en este filtro → no se muestra
    visibleRows++;
    html += `<div class="camp-row">
      <div class="camp-country">
        <span class="camp-flag">${countryFlag(cc)}</span>
        ${entry.hostCity ? `<span class="camp-sede">${esc(entry.hostCity)}</span>` : ''}
      </div>
      <div class="camp-events">${cells.join('')}</div>
    </div>`;
  }

  if (!visibleRows) {
    const isEn = getLang() === 'en';
    html = `<div class="empty-state"><div class="empty-state__text">${
      isEn ? 'No events for this filter.' : 'No hay pruebas para este filtro.'}</div></div>`;
  }
  grid.innerHTML = html;
}

// Una celda de evento: etiqueta · día · botones de assets · horario/TV (o resultados FC/PCS).
function eventCell(race, rd, label) {
  const liveTextUrl = rd._assets?.find(a => a.type === 'live_text')?.url || null;
  const concluded = isRaceConcluded(rd);

  // Tras concluir la carrera no se muestran los assets (rutómetro/perfil/mapa/live texto).
  const assetBtns = concluded ? '' : buildAssetButtons(rd, { colorHex: race.colorHex });

  // Fila inferior: con resultados in-house → trofeo a /resultados/ (como las race
  // cards de Hoy); si no, tras concluir → badges FC/PCS (sin Revive); si no,
  // horario de llegada sustituido por el badge de TV cuando hay TV.
  let timeHtml = '';
  const fcUrl  = buildFcUrl(race, rd.stageNumber, rd._fcStageNumber);
  const pcsUrl = buildPcsUrl(race, rd.stageNumber, rd._stageSuffix);
  if (rd._hasInhouse) {
    // El trofeo abre openResultsModal (que redirige a /resultados/ cuando hay
    // clasificaciones propias). Gestionado por delegación en el listener de la rejilla.
    timeHtml = `<button type="button" class="badge badge--results camp-inhouse-trophy" title="${esc(t('stage.results'))}" aria-label="${esc(t('stage.results'))}">${_trophySvg}</button>`;
  } else if (concluded && (fcUrl || pcsUrl)) {
    // Misma presentación que el badge de "Resultados" de las race cards (badge--results).
    timeHtml =
      (fcUrl  ? `<a class="badge badge--results" href="${fcUrl}"  target="_blank" rel="noopener" onclick="event.stopPropagation()" title="FirstCycling">FC</a>` : '') +
      (pcsUrl ? `<a class="badge badge--results" href="${pcsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="ProCyclingStats">PCS</a>` : '');
  } else {
    // En la rejilla de Campeonatos nunca mostramos "TV íntegra": el badge de TV
    // siempre muestra un horario (noFullStage=true), para que cada celda tenga una
    // hora visible tenga la carrera TV o no.
    const tv = tvBadge(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, liveTextUrl, rd.id, rd._tvBlocked, true);
    const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
    const finishBadge = finishTU?.display
      ? `<span class="badge badge--time${finishTU.tooltip ? ' badge--time-user' : ''}"${finishTU.tooltip ? ` data-tztip="Hora Madrid · ${finishTU.tooltip}"` : ''}>${_finishFlagSvg} ${finishTU.display}</span>`
      : '';
    // El badge de TV tiene hora propia salvo que ninguna emisión la traiga (badge
    // "TV" pelado). Para garantizar un horario en cada celda, si la TV no la lleva,
    // anteponemos la hora de meta estimada.
    const tvHasTime = (rd._broadcasts || []).some(b => b.startTimeUtc);
    timeHtml = tv
      ? ((!tvHasTime && finishBadge) ? finishBadge + tv : tv)
      : finishBadge;
  }
  const colorVar = race.colorHex ? ` style="--card-color:${race.colorHex}"` : '';
  // Clicabilidad de la celda = MISMAS condiciones que las race cards de Hoy
  // (js/app.js): con assets/perfil renderizable y no `isNoClickable` → navega a la
  // jornada; si no, pero hay datos de modal → abre el modal de carrera; si no hay
  // ni una cosa ni otra → la celda NO es clicable (sin cursor ni acción).
  const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
    && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
  const rdHasAssets = rdViewableProfile || (rd._assets
    ? rd._assets.some(a => (a.url || a.filePath) && ['startOrder','roadbook','profile','map','ports'].includes(a.type))
    : (rd.hasAssets === true));
  const rdClickable = !race.isNoClickable && rdHasAssets;
  const navMode = rdClickable ? 'jornada' : (hasModalData(rd) ? 'modal' : '');
  // Los bloques de assets y de hora/TV solo se emiten si tienen contenido: así
  // una celda sin assets ni horario (p.ej. Asti) no reserva su altura y la
  // tarjeta se encoge. En filas mixtas, el grid sigue igualando alturas.
  const assetsHtml = assetBtns ? `<div class="camp-cell__assets">${assetBtns}</div>` : '';
  const timeRow    = timeHtml  ? `<div class="camp-cell__time">${timeHtml}</div>` : '';
  return `<div class="camp-cell${navMode ? '' : ' camp-cell--static'}" data-rdid="${rd.id}" data-raceid="${race.id}" data-nav="${navMode}"${colorVar}>
    <div class="camp-cell__label">${esc(label)}</div>
    <div class="camp-cell__day">${dayShort(rd.dateKey)}</div>
    ${assetsHtml}${timeRow}
  </div>`;
}

function emptyState(isEn) {
  return `<div class="camp-wrap">
    <h1 class="camp-title">${esc(isEn ? CAMP.TITLE_EN : CAMP.TITLE_ES)} ${CAMP.YEAR}</h1>
    <div class="empty-state"><div class="empty-state__text">${
      isEn ? 'No championship data available yet.' : 'Aún no hay datos de los campeonatos.'}</div></div>
  </div>`;
}

function updateSeo() {
  const isEn = getLang() === 'en';
  const title = `${isEn ? CAMP.TITLE_EN : CAMP.TITLE_ES} ${CAMP.YEAR} — Calendario Ciclismo`;
  const desc  = isEn ? CAMP.DESC_EN : CAMP.DESC_ES;
  const url   = isEn
    ? `https://calendariociclismo.app/en/${CAMP.SLUG_EN}/`
    : `https://calendariociclismo.app/${CAMP.SLUG_ES}/`;

  document.title = title;
  setMeta('description', desc);

  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = url;

  setMetaProperty('og:title', title);
  setMetaProperty('og:description', desc);
  setMetaProperty('og:url', url);
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
}

function fireAnalytics() {
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
}

init();
