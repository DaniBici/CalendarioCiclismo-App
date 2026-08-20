// ─────────────────────────────────────────────────────────────────
//  JORNADA — detalle de una jornada concreta
//  URL: jornada.html?id=RACE_DAY_ID
// ─────────────────────────────────────────────────────────────────

import { supabase, formatTime, formatTimeUser, getUserTimezoneLabel, stageLabel,
         TYPE_LABELS, esc,
         setMeta as setMetaJ, setMetaProperty as setMetaPropJ,
         raceUrl, jornadaUrl, buildRaceHero, buildStageNav, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, raceName, rdLocation,
         filterBroadcastsByRegion, enBase, seoLongDateWeekday, startFinishLabels, trapFocus }
         from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { annotateDoubleSectors } from './services/races.js';
import { buildSimplifiedGuide, hasSimplifiedGuide } from './simplified-guide.js';
import { guideMarkerSVG } from './elevation-profile.js';

function descriptionHtml(str) {
  if (!str) return '';
  return str.split('\n')
    .map(line => esc(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<u>$1</u>'))
    .filter(line => line.replace(/&amp;nbsp;/g, '').replace(/[\u00A0\s]/g, '').length > 0)
    .map(line => `<p>${line}</p>`)
    .join('');
}

// Datos de la guía de horarios de la jornada actual (para el modal).
let _guideCache = null;

const STAGE_COLORS = {
  flat:            '#3dba6f',
  rolling:         '#a8e6bc',
  cotas:           '#c7cf5e',
  medium_mountain: '#e6b800',
  high_mountain:   '#e63d3d',
  cobbles:         '#8c8c8c',
  sterrato:        '#c4975a',
  itt:             '#1a5ca8',
  ttt:             '#6aaee8',
  chrono_climb:    '#1a5ca8',
};
function typeLabel(t) { return TYPE_LABELS[t] || t || '—'; }
function typeColor(t) { return STAGE_COLORS[t] || null; }

// ── Combinación especial: Llana + Final en alto → Monopuerto ──────
// countryCode: código de país ISO-2 de la carrera (ej. 'fr'). Opcional.
function resolveTypeLabel(primary, secondary, countryCode) {
  if (primary === 'sterrato' && countryCode?.toLowerCase() === 'fr') return typeLabel('ribinou');
  if (primary === 'flat' && secondary === 'summit_finish') return typeLabel('monopuerto');
  if (primary === 'itt' && secondary === 'chrono_climb') return typeLabel('chrono_climb');
  return typeLabel(primary) + (secondary ? ` · ${typeLabel(secondary)}` : '');
}
function resolveTypeColor(primary, secondary) {
  if (primary === 'flat' && secondary === 'summit_finish') return STAGE_COLORS['high_mountain'];
  if (primary === 'itt' && secondary === 'chrono_climb') return STAGE_COLORS['itt'];
  return typeColor(primary);
}

const TV_STATUS_LABELS = new Proxy({}, {
  get(_, key) {
    if (key === 'confirmed_time' || key === 'confirmed_notime') return null;
    return t(`tv.status.${key}`) || null;
  },
});

// ── Botones de resultados externos (FirstCycling / ProCyclingStats) ─
function raceTimeCheck(rd, offsetMinutes) {
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
function shouldShowResults(rd, race) {
  if (rd.isRestDay || rd.isCancelledDay) return false;
  if (!race.fcId && !race.pcsSlug) return false;
  return raceTimeCheck(rd, -30);
}
function shouldShowPreviousResults(prevRd, currentRd, race) {
  if (!prevRd || race.raceFormat === 'one_day') return false;
  if (!race.fcId && !race.pcsSlug) return false;
  if (shouldShowResults(currentRd, race)) return false;
  return raceTimeCheck(prevRd, 0);
}

function buildFcUrl(race, stageNumber, fcSeqNum) {
  if (!race.fcId) return null;
  const base = `https://firstcycling.com/race.php?r=${race.fcId}&y=${race.year}`;
  if (stageNumber === null || stageNumber === undefined) return base;
  const num = fcSeqNum != null ? fcSeqNum : stageNumber;
  return base + `&e=${String(num).padStart(2, '0')}`;
}

function buildPcsUrl(race, stageNumber, stageSuffix) {
  if (!race.pcsSlug) return null;
  const base = `https://www.procyclingstats.com/race/${race.pcsSlug}/${race.year}`;
  if (stageNumber === null || stageNumber === undefined) return `${base}/result`;
  if (stageNumber === 0) return `${base}/prologue/result`;
  const suffix = stageSuffix ? stageSuffix.toLowerCase() : '';
  return `${base}/stage-${stageNumber}${suffix}/result`;
}

// URL de la página de resultados PROPIA (in-house, tablas race_uci_*).
// Espejo del enrutado de js/resultados.js (ES /resultados/<slug>/etapa-N/ · EN /en/results/…).
function buildInhouseResultsUrl(race, stageNumber, suffix = '') {
  const isEn = getLang() === 'en';
  const slug = isEn ? (race.slugEn || race.slug) : race.slug;
  if (!slug) return null;
  const base = isEn ? `${enBase()}/results/` : '/resultados/';
  const sfx = (suffix || '').toLowerCase();   // doble sector: 3A → etapa-3a
  let seg = '';
  if (stageNumber === 0) seg = isEn ? 'prologue/' : 'prologo/';
  else if (stageNumber != null) seg = isEn ? `stage-${stageNumber}${sfx}/` : `etapa-${stageNumber}${sfx}/`;
  return `${base}${encodeURIComponent(slug)}/${seg}`;
}

// Bloque de botones de resultados. Si hay página propia (inhouseUrl) → botón
// principal a nuestra página + FC/PCS como respaldo discreto. Si no → FC/PCS clásicos.
function resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, stageNumber) {
  const gaStage = stageNumber ?? '';
  const ext = (cls, href, label) =>
    `<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer" data-ga-race="${esc(race.name)}" data-ga-stage="${gaStage}">${label}</a>`;

  if (inhouseUrl) {
    // Página propia = CTA principal; FC/PCS como respaldo discreto (con ↗ de externo).
    const alts = [
      fcUrl  ? ext('result-alt-btn', fcUrl,  'FirstCycling ↗&#xFE0E;')    : '',
      pcsUrl ? ext('result-alt-btn', pcsUrl, 'ProCyclingStats ↗&#xFE0E;') : '',
    ].join('');
    const fallback = alts
      ? `<div class="result-fallback">
           <span class="result-fallback__label">${t('stage.alsoOn') || 'También en'}</span>
           ${alts}
         </div>`
      : '';
    return `<a class="result-btn result-btn--inhouse" href="${esc(inhouseUrl)}">${t('stage.viewResults')}</a>${fallback}`;
  }
  // Sin página propia → FC/PCS como hasta ahora (texto plano, sin ↗).
  if (!fcUrl && !pcsUrl) return '';
  return `<div class="result-section-btns">${
    fcUrl  ? ext('result-btn', fcUrl,  'FirstCycling')    : ''
  }${
    pcsUrl ? ext('result-btn', pcsUrl, 'ProCyclingStats') : ''
  }</div>`;
}
function _gaResultPath(raceName, stageNumber) {
  const slug = (raceName || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (stageNumber == null) return `/resultados/${slug}/`;
  if (stageNumber === 0) return `/resultados/${slug}/prologo/`;
  return `/resultados/${slug}/etapa-${stageNumber}/`;
}
// ── Render ────────────────────────────────────────────────────────
function render(rd, race, broadcasts, assets, siblings = [], hasStartlist = false, allBroadcasts = broadcasts, inhouseStages = new Set()) {
  const color  = race.colorHex || '#888';
  const name   = raceName(race) || t('stage.unknownRace') || 'Carrera desconocida';
  const stage  = stageLabel(rd.stageNumber, rd._stageSuffix);

  document.title = `${name}${stage ? ' – ' + stage : ''} — ${t('seo.siteName')}`;
  updateSeoJornada(rd, race);

  // Enlace "volver": sessionStorage tiene prioridad sobre parámetros URL
  const backBtn   = document.getElementById('backBtn');
  const urlParams = new URLSearchParams(location.search);
  const navState  = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const fromVal   = urlParams.get('from') || navState.from;
  const _isEn = getLang() === 'en';
  const _navBase = _isEn ? '/en' : '';
  // Mes y Temporada viven fusionadas en /calendario.html (subvistas ?vista=).
  const _navCalendar = _isEn ? '/calendar/' : '/calendario.html';
  const _navToday  = _isEn ? '/'        : '/index.html';
  if (fromVal === 'temporada') {
    const year = urlParams.get('year') || navState.year || '';
    const cat  = urlParams.get('cat')  || navState.cat  || '';
    const qs   = new URLSearchParams();
    qs.set('vista', 'temporada');
    if (year) qs.set('year', year);
    if (cat) qs.set('cat', cat);
    backBtn.href = _navBase + _navCalendar + '?' + qs;
  } else if (fromVal === 'mes') {
    const monthRaw = urlParams.get('month') || navState.month;
    const yearRaw  = urlParams.get('year')  || navState.year;
    const qs       = new URLSearchParams();
    qs.set('vista', 'mes');
    if (yearRaw !== undefined && yearRaw !== null && monthRaw !== undefined && monthRaw !== null) {
      // navState stores 0-based month; format as YYYY-MM
      const y = Number(yearRaw);
      const m = Number(monthRaw) + 1;
      qs.set('mes', `${y}-${String(m).padStart(2, '0')}`);
    }
    backBtn.href = _navBase + _navCalendar + '?' + qs;
  } else if (rd.dateKey) {
    backBtn.href = _navBase + _navToday + `?date=${rd.dateKey}`;
  } else {
    backBtn.href = _navBase + _navToday;
  }

  const content = document.getElementById('jornadaContent');
  content.style.setProperty('--card-color', color);

  let html = buildRaceHero(rd, race, { showCancelledBanner: true });

  // Recorrido — panel de botones (web oficial · inscritos · rutómetro · perfil ·
  // puertos · mapa · live texto), fuente única en shared.buildActionButtons.
  const assetsHtml = buildActionButtons({
    race, rd, view: 'jornada', assets, hasStartlist,
    style: 'margin-bottom:0.85rem',
  });

  // Horarios (calculados antes del bloque unificado)
  const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  const start  = startTU?.display  ?? null;
  const finish = finishTU?.display ?? null;
  const tzDiffers = !!(startTU?.tooltip || finishTU?.tooltip);
  const startMadrid  = startTU?.tooltip  ?? start;
  const finishMadrid = finishTU?.tooltip ?? finish;
  const { startLabel, finishLabel } = startFinishLabels(rd, race);

  const hasRecorrido = assetsHtml || rd.startLocation || rd.distanceKm || rd.primaryType;
  // Una jornada cancelada no se corre: el horario de salida/meta ya no describe
  // nada. El banner del hero es quien cuenta lo que pasó.
  const hasHorarios  = !rd.isCancelledDay && (start || finish);

  if (hasRecorrido || hasHorarios) {
    // SVG flecha vertical compartida
    const arrowSvg = `<svg class="route-arrow" viewBox="0 0 14 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="7" y1="0" x2="7" y2="17" stroke-width="1.5" stroke-linecap="round"/><polyline points="3,13 7,19 11,13" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

    // — Bloque 1: RECORRIDO —
    const sameLocation = rd.startLocation && (!rd.finishLocation || rd.startLocation === rd.finishLocation);
    let recorridoHtml = '';
    if (rd.startLocation) {
      if (sameLocation) {
        recorridoHtml = `<div class="route-block__place route-block__place--solo">${rdLocation(rd, 'startLocation')}</div>
          <div class="route-block__note">${t('search.startAndFinish')}</div>`;
      } else {
        recorridoHtml = `<div class="route-block__place">${rdLocation(rd, 'startLocation')}</div>
          ${arrowSvg}
          <div class="route-block__place">${rdLocation(rd, 'finishLocation') || '—'}</div>`;
      }
    } else {
      recorridoHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noData')}</div>`;
    }

    // — Bloque 2: DISTANCIA Y TIPO —
    const kmFormatted = rd.distanceKm
      ? Number(rd.distanceKm).toLocaleString(_isEn ? 'en-GB' : 'es-ES')
      : null;
    const kmHtml = kmFormatted
      ? `<div class="route-block__km">${kmFormatted}${_isEn ? 'km' : ' km'}</div>`
      : `<div class="route-block__km route-block__km--empty">—</div>`;
    const _elevGain = rd.elevationProfile?.elevationGain;
    const elevHtml = _elevGain != null
      ? `<div class="route-block__elev">+${String(Math.round(_elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEn ? ',' : '.')} m</div>`
      : '';
    const tipoHtml = rd.primaryType
      ? `<div class="route-block__type">${resolveTypeLabel(rd.primaryType, rd.secondaryType, race.countryCode)}</div>`
      : '';
    const stageTypeColor = resolveTypeColor(rd.primaryType, rd.secondaryType);

    // — Bloque 3: HORARIOS —
    // Si el usuario está en una zona diferente a Madrid, el data-tooltip muestra la hora de Madrid
    const startTipText  = tzDiffers ? `${startLabel} · Madrid: ${startMadrid}`  : startLabel;
    const finishTipText = tzDiffers ? `${finishLabel} · Madrid: ${finishMadrid}` : finishLabel;
    let horariosHtml = '';
    if (start && finish) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${start}</div>
        ${arrowSvg}
        <div class="route-block__place" data-tooltip="${finishTipText}">${finish}</div>`;
    } else if (start) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${start}</div>
        <div class="route-block__note">${startLabel}</div>`;
    } else if (finish) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${finishTipText}">${finish}</div>
        <div class="route-block__note">${finishLabel}</div>`;
    } else {
      horariosHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noSchedule')}</div>`;
    }

    // — Guía simplificada de horarios de paso (modal) —
    // El bloque "Horario" se vuelve pulsable cuando la jornada tiene puntos
    // intermedios con hora (manual o interpolable). El disparador vive en la
    // línea de título (chevron) para no aumentar la altura del bloque en la
    // rejilla horizontal de escritorio; en stacked aparece el enlace de texto.
    const guideRows = buildSimplifiedGuide({
      distanceKm: rd.distanceKm != null ? Number(rd.distanceKm) : (rd.elevationProfile?.distance ?? null),
      neutralStartTimeUtc:    rd.neutralStartTimeUtc,
      estimatedFinishTimeUtc: rd.estimatedFinishTimeUtc,
      summits:   rd.profileSummits   || [],
      waypoints: rd.profileWaypoints || [],
      primaryType: rd.primaryType,
    });
    const showGuide = !rd.isCancelledDay && hasSimplifiedGuide(guideRows);
    if (showGuide) _guideCache = { rd, race, rows: guideRows };

    const guideCue = showGuide ? `<button type="button" class="route-grid__guide-btn" data-guide-trigger="1" aria-label="${esc(t('stage.guide.open'))}">
            <svg class="route-grid__guide-ico" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span>${esc(t('stage.guide.open'))}</span>
            <svg class="route-grid__guide-chev" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>` : '';
    // Jornada cancelada → sin bloque de horario ni guía de horarios de paso:
    // no hay salida ni meta que anunciar (hasHorarios ya es false).
    const scheduleBlock = rd.isCancelledDay ? '' : `<div class="route-grid__block${showGuide ? ' route-grid__block--guide' : ''}">
          <div class="route-grid__title" data-tooltip="${tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone')}">${t('stage.schedule')}</div>
          <div class="route-grid__body route-grid__body--route">
            ${horariosHtml}
          </div>
          ${guideCue}
        </div>`;

    html += `<div class="jornada-section jornada-section--route-grid">
      ${assetsHtml}
      <div class="route-grid">
        <div class="route-grid__block">
          <div class="route-grid__title">${t('stage.route')}</div>
          <div class="route-grid__body route-grid__body--route">
            ${recorridoHtml}
          </div>
        </div>
        <div class="route-grid__block route-grid__block--type"${resolveTypeColor(rd.primaryType, rd.secondaryType) ? ` style="--type-color:${resolveTypeColor(rd.primaryType, rd.secondaryType)}"` : ''}>
          <div class="route-grid__title">${t('stage.distanceAndType')}</div>
          <div class="route-grid__body">
            ${kmHtml}
            ${elevHtml}
            ${tipoHtml}
          </div>
        </div>
        ${scheduleBlock}
      </div>
    </div>`;
  } // fin bloque unificado

  // Así está la carrera — resultados de la etapa anterior (vueltas por etapas).
  // Solo si los de la etapa ACTUAL aún no están disponibles (igual que el flujo FC/PCS):
  // si ya hay resultados de hoy, la GC del día los recoge → no duplicar la sección.
  const _navSiblings = siblings.filter(s => !s.isRestDay && !s.isCancelledDay);
  const _currentIdx  = _navSiblings.findIndex(s => s.id === rd.id);
  const _prevRd      = _currentIdx > 0 ? _navSiblings[_currentIdx - 1] : null;
  const _curStageKeyForPrev = rd.stageNumber == null ? 'final' : rd.stageNumber;
  const _currentResultsAvailable = shouldShowResults(rd, race) || inhouseStages.has(_curStageKeyForPrev);
  const _prevStageKey = _prevRd ? (_prevRd.stageNumber == null ? 'final' : _prevRd.stageNumber) : null;
  const _prevHasInhouse = _prevRd && !_currentResultsAvailable && inhouseStages.has(_prevStageKey);
  if (_prevRd && (shouldShowPreviousResults(_prevRd, rd, race) || _prevHasInhouse)) {
    // "Así está la carrera" → clasificación GENERAL (GC) de la etapa anterior,
    // no su clasificación de etapa (#gc selecciona la pestaña General en resultados.js).
    const inhouseUrl = _prevHasInhouse ? buildInhouseResultsUrl(race, _prevRd.stageNumber, _prevRd._stageSuffix) + '#gc' : null;
    const fcUrl  = buildFcUrl(race, _prevRd.stageNumber, _prevRd._fcStageNumber);
    const pcsUrl = buildPcsUrl(race, _prevRd.stageNumber, _prevRd._stageSuffix);
    const btns = resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, _prevRd.stageNumber);
    if (btns) {
      html += `<div class="jornada-section">
        <h2 class="jornada-section__title">${t('stage.previousResults')}</h2>
        ${btns}
      </div>`;
    }
  }

  // Resultados — sección propia, antes de TV.
  // Si hay resultados PROPIOS (in-house) para esta etapa → botón a nuestra página;
  // FC/PCS quedan como enlaces de respaldo. Si no, comportamiento clásico (FC/PCS).
  // Una jornada CANCELADA siempre tiene página propia de resultados: el aviso de
  // cancelación + las generales arrastradas de la etapa anterior (js/resultados.js).
  // Su CTA no depende de que tenga clasificaciones volcadas (no las tendrá nunca),
  // y `shouldShowResults` la descarta por diseño → sin esto la sección desaparecía.
  const hasInhouseResults = inhouseStages.has(_curStageKeyForPrev) || rd.isCancelledDay;
  if (shouldShowResults(rd, race) || hasInhouseResults) {
    const inhouseUrl = hasInhouseResults ? buildInhouseResultsUrl(race, rd.stageNumber, rd._stageSuffix) : null;
    const fcUrl  = buildFcUrl(race, rd.stageNumber, rd._fcStageNumber);
    const pcsUrl = buildPcsUrl(race, rd.stageNumber, rd._stageSuffix);
    const btns = resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, rd.stageNumber);
    if (btns) {
      html += `<div class="jornada-section">
        <h2 class="jornada-section__title">${t('stage.results')}</h2>
        ${btns}
      </div>`;
    }
  }

  // Televisión — sección independiente, siempre con título fijo
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para no mostrar "No TV in Spain" y dejar que
  // los broadcasts (filtrados por región) hablen por sí solos.
  const _tvStatus = (_isEn && rd.tvStatus === 'unavailable_es') ? null : rd.tvStatus;
  const tvLabel = TV_STATUS_LABELS[_tvStatus];
  const hasBroadcasts = broadcasts && broadcasts.length > 0;
  const isReviveBroadcast = b => b.url && (/eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be/i.test(b.url) || b.showInRevive === true);
  const isRaceConcluded = !!rd.estimatedFinishTimeUtc && raceTimeCheck(rd, 30);
  const hasReviveBroadcast = hasBroadcasts && isRaceConcluded && broadcasts.some(isReviveBroadcast);
  // Carrera concluida → solo mostrar sección si hay broadcasts de tipo Revive.
  // Jornada CANCELADA → nada de emisión EN DIRECTO (no se corrió), pero SÍ el
  // "Revive" si existe: una etapa cancelada en carrera puede tener vídeo de lo
  // que sí se disputó (p. ej. Qinghai E6, con su broadcast showInRevive curado).
  const hasTvInfo = rd.isCancelledDay ? hasReviveBroadcast : (isRaceConcluded
    ? hasReviveBroadcast
    : (hasBroadcasts || allBroadcasts.length > 0 || _tvStatus === 'pending' || _tvStatus === 'none' || _tvStatus === 'unavailable_es'));

  // Broadcasts que el filtro regional ocultó (presentes en allBroadcasts pero no en broadcasts)
  const filteredOutIds = new Set(broadcasts.map(b => b.id));
  const hiddenBroadcasts = allBroadcasts.filter(b => !filteredOutIds.has(b.id));
  const hasHiddenBroadcasts = hiddenBroadcasts.length > 0;

  if (hasTvInfo) {
    const reviveTitle = race.raceFormat === 'one_day' ? t('tv.reviveRaceTitle') : t('tv.reviveStageTitle');
    const tvSectionTitle = hasReviveBroadcast ? reviveTitle : t('tv.title');
    const toggleBtn = hasHiddenBroadcasts && !hasReviveBroadcast
      ? `<button class="tv-filter-btn" data-tv-filter="mine">${t('tv.filterAll')}</button>`
      : '';
    // Reutiliza el chip naranja de Hoy, también cuando hay un canal provisional.
    // En Jornada no lo sustituye el Live texto: ambos datos son complementarios.
    const pendingBadge = !hasReviveBroadcast && _tvStatus === 'pending'
      ? `<span class="badge badge--pend"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ${t('tv.status.pending')}</span>`
      : '';
    html += `<div class="jornada-section">
      <div class="jornada-section__title-row">
        <div class="jornada-section__title-badge">
          <h2 class="jornada-section__title">${tvSectionTitle}</h2>
          ${pendingBadge}
        </div>
        ${toggleBtn}
      </div>`;

    if (hasBroadcasts || hasHiddenBroadcasts) {
      const visibleBroadcasts = hasReviveBroadcast
        ? broadcasts.filter(isReviveBroadcast)
        : broadcasts;

      // Si el filtro regional dejó sin broadcasts visibles, avisar al usuario antes
      // de listar los que están ocultos (los muestra al pulsar el toggle "Todas").
      if (!hasReviveBroadcast && visibleBroadcasts.length === 0 && hasHiddenBroadcasts) {
        html += `<div class="info-row tv-no-country-msg">
          <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">${t('tv.noTvCountry')}</span>
        </div>`;
      }

      const renderEntry = (b, hidden = false) => {
        const bTimeTU = formatTimeUser(b.startTimeUtc);
        const bTime   = hasReviveBroadcast ? null : (bTimeTU?.display ?? null);
        const bTimeTip = bTimeTU?.tooltip ? `Madrid: ${bTimeTU.tooltip}` : null;
        // `getBroadcastEmbed` aplica la allowlist y respeta embeddable=false.
        const broadcastEmbed = getBroadcastEmbed(b.url, b.embeddable);
        return `<div class="tv-entry${hidden ? ' tv-entry--regional-hidden' : ''}"${hidden ? ' style="display:none"' : ''}>
          <div style="flex:1;min-width:0;padding-right:0.75rem">
            <div class="tv-entry__platform">${b.channel || '—'}</div>
            ${!hasReviveBroadcast && b.note ? `<div class="tv-entry__channel" style="font-style:italic">${b.note}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            ${bTime ? `<span class="tv-entry__time${bTimeTip ? ' tv-entry__time--tz' : ''}"${bTimeTip ? ` data-tooltip="${bTimeTip}"` : ''}>${bTime}</span>` : ''}
            ${b.url  ? `<a class="tv-link-btn${broadcastEmbed ? ' tv-link-btn--embed' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener"${broadcastEmbed ? ' data-tv-embed="1"' : ''}>${t('stage.watch')} ↗&#xFE0E;</a>` : ''}
          </div>
        </div>`;
      };

      visibleBroadcasts.forEach(b => { html += renderEntry(b, false); });
      if (!hasReviveBroadcast) {
        hiddenBroadcasts.forEach(b => { html += renderEntry(b, true); });
      }
    } else {
      html += `<div class="info-row">
        <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">
          ${tvLabel || t('tv.noInfo')}
        </span>
      </div>`;
    }

    html += `</div>`;
  } // fin hasTvInfo

  // Editorial — en EN usar solo traducción EN (sin fallback ES)
  const _enTr   = _isEn ? (rd.translations?.en || {}) : {};
  const _desc    = _isEn ? (_enTr.description?.value || '') : rd.description;
  const _bonuses = _isEn ? (_enTr.bonuses?.value     || '') : rd.bonuses;
  const _notes   = _isEn ? (_enTr.notes?.value       || '') : rd.notes;
  if (_desc || _bonuses || _notes) {
    html += `<div class="jornada-section">
      <h2 class="jornada-section__title">${race.raceFormat === 'one_day' ? t('stage.descriptionRace') : t('stage.descriptionStage')}${_isEn && _enTr.description?.status !== 'manual' ? ' <span class="jornada-section__ai-note">AI translated from Spanish, might contain errors</span>' : ''}</h2>
      ${_desc    ? `<div class="jornada-description">${descriptionHtml(_desc)}</div>` : ''}
      ${_bonuses ? `<div class="info-row"><span class="info-row__label">${t('stage.bonuses')}</span>
                    <span class="info-row__value info-row__value--secondary">${esc(_bonuses)}</span></div>` : ''}
      ${_notes   ? `<div class="info-row"><span class="info-row__label">${t('stage.notes')}</span>
                    <span class="info-row__value info-row__value--secondary">${esc(_notes)}</span></div>` : ''}
    </div>`;
  }

  // Assets ya integrados en sección Recorrido

  // Navegación entre etapas (solo vueltas por etapas con >1 etapa; excluye jornadas de descanso)
  const navSiblings = siblings.filter(s => !s.isRestDay);
  html = buildStageNav(navSiblings, rd.id, jornadaUrl, raceUrl(race)) + html;

  // Reportar se mueve al ical-bar (setupIcalModal) para quedar junto a Suscribirse

  content.innerHTML = html;

  // ── Tracking GA — botones de resultados externos (FC/PCS) ──────
  // El botón in-house no lleva data-ga-race: su page_view lo dispara la propia página.
  content.querySelectorAll('[data-ga-race]').forEach(a => {
    a.addEventListener('click', () => {
      if (!window.gtag) return;
      const stageRaw = a.dataset.gaStage;
      const stage = stageRaw !== '' ? Number(stageRaw) : null;
      gtag('event', 'page_view', {
        page_location: window.location.origin + _gaResultPath(a.dataset.gaRace, stage),
        page_title: a.dataset.gaRace + (stage != null ? ' – Etapa ' + stage : '') + ' — Resultados — Calendario Ciclismo',
      });
    });
  });

  // ── Setup report modal con datos de la jornada ─────────────────
  setupReportModal(rd.id, name, stage);

  // ── Emisiones embebibles inline (solo escritorio) ──────────────
  if (window.innerWidth >= 768) {
    content.querySelectorAll('a.tv-link-btn--embed[data-tv-embed]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const embed = getBroadcastEmbed(btn.href);
        if (!embed) return;
        const entry = btn.closest('.tv-entry');
        const next = entry.nextElementSibling;
        if (next && next.classList.contains('tv-embed-block')) {
          next.remove();
          btn.innerHTML = `${t('stage.watch')} ↗&#xFE0E;`;
        } else {
          const wrap = document.createElement('div');
          const externalText = getLang() === 'en' ? `Open on ${embed.externalLabel}` : `Abrir en ${embed.externalLabel}`;
          wrap.className = 'tv-embed-block';
          wrap.innerHTML = `<div class="tv-embed-wrap"><iframe src="${esc(embed.src)}" title="${esc(embed.externalLabel)}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
            <div class="tv-embed-actions"><a class="tv-link-btn" href="${esc(embed.externalUrl)}" target="_blank" rel="noopener">${externalText} ↗&#xFE0E;</a></div>`;
          entry.insertAdjacentElement('afterend', wrap);
          btn.innerHTML = `${t('ical.closeLabel')} &nbsp;✕`;
        }
      });
    });
  }

  // ── Tooltips de escritorio en horarios ──────────────────────────
  if (window.innerWidth >= 600) {
    content.querySelectorAll('[data-tooltip]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        let tip = document.getElementById('ph-tooltip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
        tip.textContent = el.dataset.tooltip;
        tip.style.display = 'block';
      });
      el.addEventListener('mousemove', e => {
        const tip = document.getElementById('ph-tooltip');
        if (tip) { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
      });
      el.addEventListener('mouseleave', () => {
        const tip = document.getElementById('ph-tooltip');
        if (tip) tip.style.display = 'none';
      });
    });
  }

  // ── Guía simplificada de horarios: abrir modal al pulsar el bloque ──
  content.querySelectorAll('[data-guide-trigger]').forEach(el => {
    el.addEventListener('click', openGuideModal);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGuideModal(); }
    });
  });
}

// ── Guía simplificada de horarios de paso (modal) ─────────────────
// Marcadores por tipo de punto, en paridad cromática con el perfil de
// elevación y el mini-perfil de las apps.
function _guideRowLabel(row) {
  switch (row.type) {
    case 'start':      return t('stage.guide.start');
    case 'finish':     return t('stage.guide.finish');
    case 'climb_foot': return row.label ? t('stage.guide.climbFoot', { name: row.label }) : t('stage.guide.climbFootGeneric');
    case 'summit':     return row.label || t('stage.guide.summit');
    default:           return row.label || t(`stage.guide.${row.type}`);
  }
}

function _guideMarker(row) {
  const category = row.type === 'summit' ? row.category : null;
  return `<span class="sg-marker">${guideMarkerSVG(row.type, { size: 20, category })}</span>`;
}

// Formatea un km de la guía con el separador decimal del IDIOMA DE CONTENIDO
// (ES → coma, EN → punto), igual que el kilometraje de la cabecera de etapa
// (toLocaleString es-ES/en-GB). Sin esto, el número JS se interpola siempre con
// punto y descuadra respecto al resto de la ficha. Espejo en apps (fmtKm).
function _fmtGuideKm(km) {
  return Number(km).toLocaleString(getLang() === 'en' ? 'en-GB' : 'es-ES', { maximumFractionDigits: 1 });
}

function buildGuideModalHtml(rd, race, rows) {
  const dist = rd.distanceKm != null ? Number(rd.distanceKm) : (rd.elevationProfile?.distance ?? null);
  const body = rows.map(row => {
    const tu = formatTimeUser(row.timeUtc);
    const timeStr = tu ? tu.display : '—';
    const est = (row.isEstimated && row.timeUtc) ? '<span class="sg-est">*</span>' : '';
    const titleAttr = (tu && tu.tooltip) ? ` title="Madrid: ${tu.tooltip}"` : '';
    // A ≤0.5 km de meta (o en la propia meta) se etiqueta "Meta", igual que en el
    // perfil interactivo. Cubre varios puntos cercanos (cima + sprint + llegada),
    // y valores negativos por redondeo (una cima justo en meta → kmToGo ≈ -0,1).
    const kmToGo = row.kmToGo != null
      ? (row.kmToGo <= 0.5
          ? t('stage.guide.atFinish')
          : t('stage.guide.kmToGo', { km: _fmtGuideKm(row.kmToGo) }))
      : (dist == null ? `km ${_fmtGuideKm(row.km)}` : '');
    return `<div class="sg-row sg-row--${row.type}">
      <div class="sg-row__time"${titleAttr}>${timeStr}${est}</div>
      <div class="sg-row__name">${_guideMarker(row)}<span>${esc(_guideRowLabel(row))}</span></div>
      <div class="sg-row__km">${esc(kmToGo)}</div>
    </div>`;
  }).join('');
  const hasEst = rows.some(r => r.isEstimated && r.timeUtc);
  const note = hasEst ? `<div class="sg-note">${t('stage.guide.estimatedNote')}</div>` : '';
  const title = t('stage.guide.title');
  return `<div class="sg-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sg-modal__bar">
      <span class="sg-modal__title">${esc(title)}</span>
      <button class="sg-modal__close" aria-label="Cerrar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    </div>
    <div class="sg-modal__body">${body}${note}</div>
  </div>`;
}

function openGuideModal() {
  if (!_guideCache) return;
  const { rd, race, rows } = _guideCache;
  let overlay = document.getElementById('sgOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sgOverlay';
    overlay.className = 'sg-overlay';
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('.sg-modal__close')) closeGuideModal();
    });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = buildGuideModalHtml(rd, race, rows);
  overlay.classList.add('sg-overlay--open');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _guideEsc);
  _releaseGuideFocus = trapFocus(overlay.querySelector('.sg-modal') || overlay);
}

function closeGuideModal() {
  const overlay = document.getElementById('sgOverlay');
  if (!overlay) return;
  overlay.classList.remove('sg-overlay--open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _guideEsc);
  if (_releaseGuideFocus) { _releaseGuideFocus(); _releaseGuideFocus = null; }
}
let _releaseGuideFocus = null;

function _guideEsc(e) { if (e.key === 'Escape') closeGuideModal(); }

// ── SEO dinámico — jornada ────────────────────────────────────────
function articuloJornada(name) {
  const firstWord = (name || '').trim().split(/\s+/)[0].toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const masculinos = [
    'tour', 'giro', 'gran', 'grande', 'campeonato', 'criterium', 'critérium',
    'circuito', 'circuit', 'grand', 'trofeo', 'trophee', 'trophée',
    'memorial', 'premio', 'prix', 'open', 'paris', 'eschborn'
  ];
  return masculinos.includes(firstWord) ? 'el' : 'la';
}

function ordinalEtapa(n) {
  const ord = ['1ª','2ª','3ª','4ª','5ª','6ª','7ª','8ª','9ª','10ª',
               '11ª','12ª','13ª','14ª','15ª','16ª','17ª','18ª','19ª','20ª','21ª'];
  return ord[n - 1] || `${n}ª`;
}

function updateSeoJornada(rd, race) {
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';
  const _seoIsEn = getLang() === 'en';

  const raceNameStr = raceName(race) || '';
  const origName   = race.originalName || '';
  const raceNameWithOrig = origName ? `${raceNameStr} (${origName})` : raceNameStr;
  const raceYear   = race.year  || '';
  const isOneDay   = race.raceFormat === 'one_day';
  const stageNum   = (rd.stageNumber !== null && rd.stageNumber !== undefined) ? parseInt(rd.stageNumber) : null;
  const art        = articuloJornada(raceNameStr);
  const artCap     = art.charAt(0).toUpperCase() + art.slice(1);

  const startLoc   = rdLocation(rd, 'startLocation');
  const finishLoc  = rdLocation(rd, 'finishLocation');
  const sameOrOne  = !finishLoc || startLoc === finishLoc;
  const km         = rd.distanceKm ? rd.distanceKm : null;

  // Fecha larga para embeber en descripción. Formato fijo sin ICU: esta cadena va en
  // title/description/og, que Googlebot indexa, y su renderer degrada toLocaleDateString
  // a inglés aunque se pase 'es-ES'. Ver shared.js / docs/memory/seo-og-pages.md.
  const fechaLarga = rd.dateKey ? seoLongDateWeekday(rd.dateKey, _seoIsEn ? 'en' : 'es') : '';

  // ── TÍTULO ──
  let title;
  if (_seoIsEn) {
    if (isOneDay) {
      title = `${raceNameStr}${raceYear ? ' ' + raceYear : ''} — ${t('seo.siteName')}`;
    } else {
      const stageLabelStr = stageNum !== null && stageNum !== undefined ? stageLabel(stageNum, rd._stageSuffix) : '';
      const route = sameOrOne ? startLoc : `${startLoc} › ${finishLoc}`;
      title = `${raceNameStr}, ${stageLabelStr}: ${route} — ${t('seo.siteName')}`;
    }
  } else if (isOneDay) {
    title = `${raceNameStr}${raceYear ? ' ' + raceYear : ''} — ${t('seo.siteName')}`;
  } else {
    const stageLabelStr = stageNum !== null && stageNum !== undefined ? stageLabel(stageNum, rd._stageSuffix) : '';
    const route = sameOrOne
      ? startLoc
      : `${startLoc} › ${finishLoc}`;
    title = `${raceNameStr}, ${stageLabelStr}: ${route} — ${t('seo.siteName')}`;
  }

  // ── DESCRIPCIÓN ──
  let description;
  if (_seoIsEn) {
    const kmStrEn = km ? `, over ${Number(km).toLocaleString('en-GB')}km,` : '';
    const routeStrEn = sameOrOne
      ? `starting and finishing in ${startLoc}`
      : `from ${startLoc} to ${finishLoc}`;
    if (isOneDay) {
      description = `${raceNameWithOrig} takes place on ${fechaLarga}${kmStrEn} ${routeStrEn}. Check route, schedule and how to watch on TV and online streaming.`;
    } else if (stageNum === 0) {
      description = `The prologue of ${raceNameWithOrig} takes place on ${fechaLarga}${kmStrEn} ${routeStrEn}. Check route, schedule and how to watch on TV and online streaming.`;
    } else {
      const ordEn = stageNum !== null ? `Stage ${stageNum}` : 'Stage';
      description = `${ordEn} of ${raceNameWithOrig} takes place on ${fechaLarga}${kmStrEn} ${routeStrEn}. Check route, schedule and how to watch on TV and online streaming.`;
    }
  } else {
    const rutaStr = sameOrOne
      ? `con salida y meta en ${startLoc}`
      : `con salida en ${startLoc} y meta en ${finishLoc}`;
    const fechaStr = fechaLarga ? ` (${fechaLarga})` : '';
    const recorridoStr = km
      ? `cubre ${Number(km).toLocaleString('es-ES')} km${rutaStr ? ` ${rutaStr}` : ''}`
      : rutaStr ? `se disputa ${rutaStr}` : 'se disputa';
    if (isOneDay) {
      description = `${artCap} ${raceNameWithOrig}${fechaStr} ${recorridoStr}. Consulta recorrido, horarios y cómo ver por TV y online streaming.`;
    } else if (stageNum === 0) {
      const deArt = art === 'el' ? 'del' : 'de la';
      description = `El prólogo ${deArt} ${raceNameWithOrig}${fechaStr} ${recorridoStr}. Consulta recorrido, horarios y cómo ver por TV y online streaming.`;
    } else {
      const deArt = art === 'el' ? 'del' : 'de la';
      const ordinal = stageNum !== null ? ordinalEtapa(stageNum) : '';
      description = `La ${ordinal} etapa ${deArt} ${raceNameWithOrig}${fechaStr} ${recorridoStr}. Consulta recorrido, horarios y cómo ver por TV y online streaming.`;
    }
  }

  // ── KEYWORDS ──
  // Detectar adoquines o sterrato
  const extraTipo = [];
  if (rd.primaryType === 'cobbles' || rd.secondaryType === 'cobbles') extraTipo.push('adoquines', 'pavé');
  if (rd.primaryType === 'sterrato' || rd.secondaryType === 'sterrato') extraTipo.push('sterrato', 'gravel');

  // Ciudades: solo salida si coinciden o no hay llegada
  const ciudades = sameOrOne ? [startLoc] : [startLoc, finishLoc].filter(Boolean);
  const ciudadesUnicas = [...new Set(ciudades)];

  const kwParts = [
    BASE_KW,
    raceNameStr,
    raceYear ? `${raceNameStr} ${raceYear}` : '',
    origName,
    ...ciudadesUnicas,
    ...extraTipo,
  ].filter(Boolean);
  const keywords = kwParts.join(', ');

  // ── APLICAR ──
  document.title = title;
  setMetaJ('description', description);
  setMetaJ('keywords', keywords);
  setMetaPropJ('og:title', title);
  setMetaPropJ('og:description', description);

  // og:image: imagen OG compuesta con logo de la carrera
  const DEFAULT_OG_IMAGE = 'https://pub-10252f2a495c488a856a619206783642.r2.dev/og-default.png';
  const OG_WORKER = 'https://og.calendariociclismo.app';
  const ogTitle = title.replace(` — ${t('seo.siteName')}`, '');
  const ogImage = (race.logoUrl && race.logoUrl.startsWith('https://assets.calendariociclismo.app/'))
    ? `${OG_WORKER}/?logo=${encodeURIComponent(race.logoUrl)}&title=${encodeURIComponent(ogTitle)}`
    : DEFAULT_OG_IMAGE;
  setMetaPropJ('og:image', ogImage);
  setMetaPropJ('og:image:width',  '1200');
  setMetaPropJ('og:image:height', '630');
  setMetaPropJ('og:image:alt', ogTitle);

  // Twitter Card
  setMetaJ('twitter:card', 'summary_large_image');
  setMetaJ('twitter:title', title);
  setMetaJ('twitter:description', description);
  setMetaJ('twitter:image', ogImage);
  setMetaJ('twitter:image:alt', ogTitle);

  // ── Canonical + og:url ──
  const _canonIsEn = getLang() === 'en';
  const _canonSlug = (_canonIsEn && rd.slugEn) ? rd.slugEn : rd.slug;
  const _canonBase = _canonIsEn ? '/en/stage/' : '/jornada/';
  const canonicalUrl = _canonSlug
    ? `${CONFIG.webOrigin}${_canonBase}${encodeURIComponent(_canonSlug)}/`
    : window.location.href.split('?')[0];
  setMetaPropJ('og:url', canonicalUrl);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = canonicalUrl;
  setHreflang(canonicalUrl);
  // Expose cross-language alternate for lang switcher
  if (!_canonIsEn && rd.slugEn) {
    const enUrl = `${CONFIG.webOrigin}/en/stage/${encodeURIComponent(rd.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (_canonIsEn && rd.slug) {
    const esUrl = `${CONFIG.webOrigin}/jornada/${encodeURIComponent(rd.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // ── JSON-LD SportsEvent ──
  const origin = CONFIG.webOrigin;
  const isCancelled = rd.isCancelledDay || race.isCancelled;
  const locationName = sameOrOne ? (startLoc || null)
                                 : (startLoc && finishLoc ? `${startLoc} → ${finishLoc}` : (startLoc || finishLoc || null));
  const locationCountry = String(rd.countryCode || race.countryCode || '').toUpperCase() || null;
  const eventStatus = isCancelled
    ? 'https://schema.org/EventCancelled'
    : 'https://schema.org/EventScheduled';
  // Google exige nombre, fecha y ubicación para que SportsEvent sea elegible.
  // Si falta alguno, retiramos solo el bloque de evento; breadcrumbs y SEO
  // visible permanecen intactos.
  const jsonLd = raceNameStr && rd.dateKey && locationName && locationCountry ? {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    'name': title.replace(` — ${t('seo.siteName')}`, ''),
    'url': canonicalUrl,
    'description': description,
    'sport': 'Ciclismo en ruta',
    'eventStatus': eventStatus,
    'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
    'organizer': {
      '@type': 'Organization',
      'name': t('seo.siteName'),
      'url': origin
    }
  } : null;
  if (jsonLd) { jsonLd.startDate = rd.dateKey; jsonLd.endDate = rd.dateKey; }
  if (jsonLd && ogImage) jsonLd.image = ogImage;
  if (jsonLd) {
    jsonLd.location = { '@type': 'Place', 'name': locationName };
    jsonLd.location.address = {
      '@type': 'PostalAddress',
      'addressCountry': locationCountry,
    };
  }
  setJsonLd('jsonld-main', jsonLd);

  // ── JSON-LD BreadcrumbList ──
  const crumbs = [{ '@type': 'ListItem', 'position': 1, 'name': 'Inicio', 'item': `${origin}/` }];
  let pos = 2;
  if (raceYear) {
    crumbs.push({ '@type': 'ListItem', 'position': pos++, 'name': `Temporada ${raceYear}`,
                  'item': `${origin}/calendario.html?year=${raceYear}` });
  }
  if (!isOneDay && race.slug) {
    crumbs.push({ '@type': 'ListItem', 'position': pos++,
                  'name': `${raceNameStr}${raceYear ? ' ' + raceYear : ''}`,
                  'item': `${origin}/competicion/${encodeURIComponent(race.slug)}/` });
  }
  let finalCrumbName;
  if (isOneDay) {
    finalCrumbName = `${raceNameStr}${raceYear ? ' ' + raceYear : ''}`;
  } else {
    const stageLabelStr = stageNum !== null && stageNum !== undefined ? stageLabel(stageNum, rd._stageSuffix) : '';
    const route = sameOrOne ? startLoc : (startLoc && finishLoc ? `${startLoc} › ${finishLoc}` : '');
    finalCrumbName = [stageLabelStr, route].filter(Boolean).join(': ') || (raceNameStr || 'Jornada');
  }
  crumbs.push({ '@type': 'ListItem', 'position': pos, 'name': finalCrumbName });
  setJsonLd('jsonld-breadcrumbs', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': crumbs,
  });
}

function setJsonLd(id, obj) {
  // EN: conservar el JSON-LD en castellano del HTML estático (SEO en español).
  if (getLang() === 'en') return;
  let el = document.getElementById(id);
  if (!obj) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(obj);
}

function setHreflang(url) {
  ['es', 'x-default'].forEach(lang => {
    let el = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (!el) {
      el = document.createElement('link');
      el.rel = 'alternate';
      el.hreflang = lang;
      document.head.appendChild(el);
    }
    el.href = url;
  });
}

// ── Visor de assets (iframe) ──────────────────────────────────────
function openAssetViewer(url, label) {
  const isInternal = url.startsWith('https://assets.calendariociclismo.app');
  const isImage    = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  const isPdf      = /\.pdf(\?|$)/i.test(url);
  const useImg     = isInternal && isImage;
  const useEmbed   = isInternal && isPdf;
  // iOS Safari no soporta PDFs embebidos — abrir directamente
  const isSafariMobile = /iP(hone|ad|od)/.test(navigator.userAgent);
  const usePdfDirect   = useEmbed && isSafariMobile;

  // Crear overlay si no existe
  let overlay = document.getElementById('assetViewerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'assetViewerOverlay';
    overlay.innerHTML = `
      <div class="asset-viewer__bar">
        <button class="asset-viewer__back" onclick="closeAssetViewer()">← ${getLang() === 'en' ? 'BACK' : 'VOLVER'}</button>
        <span class="asset-viewer__title" id="assetViewerTitle"></span>
        <a class="asset-viewer__external" id="assetViewerExternal" target="_blank" rel="noopener">
          ${getLang() === 'en' ? 'Open in new tab ↗' : 'Abrir en nueva pestaña ↗'}
        </a>
      </div>
      <iframe id="assetViewerFrame" class="asset-viewer__frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      <embed id="assetViewerEmbed" class="asset-viewer__frame" type="application/pdf" style="display:none">
      <div class="asset-viewer__fallback" id="assetViewerFallback" style="display:none">
        <p>${getLang() === 'en' ? 'This content cannot be displayed here.' : 'Este contenido no puede mostrarse aquí.'}</p>
        <a id="assetViewerFallbackLink" target="_blank" rel="noopener" class="btn-fallback">${getLang() === 'en' ? 'Open in new tab ↗' : 'Abrir en nueva pestaña ↗'}</a>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const frame    = document.getElementById('assetViewerFrame');
  const embedEl  = document.getElementById('assetViewerEmbed');
  const fallback = document.getElementById('assetViewerFallback');
  const extLink  = document.getElementById('assetViewerExternal');
  const title    = document.getElementById('assetViewerTitle');
  const fbLink   = document.getElementById('assetViewerFallbackLink');

  title.textContent      = label.replace(/^\p{Emoji}\s*/u, '');
  extLink.href           = url;
  fbLink.href            = url;
  frame.style.display    = 'none';
  embedEl.style.display  = 'none';
  fallback.style.display = 'none';

  // Para imágenes internas: usar <img>
  let imgEl = document.getElementById('assetViewerImg');
  if (!imgEl) {
    imgEl = document.createElement('img');
    imgEl.id = 'assetViewerImg';
    imgEl.className = 'asset-viewer__img';
    frame.parentNode.insertBefore(imgEl, frame);
  }
  if (useImg) {
    imgEl.src = url;
    imgEl.style.display = 'block';
    overlay.classList.add('asset-viewer--scrollable');
  } else {
    imgEl.style.display = 'none';
    imgEl.src = '';
    overlay.classList.remove('asset-viewer--scrollable');
  }

  // Para PDFs internos: embed en desktop, nueva pestaña en iOS Safari
  if (useEmbed) {
    if (usePdfDirect) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    embedEl.src = url;
    embedEl.style.display = 'block';
    overlay.classList.add('asset-viewer--open');
    document.body.style.overflow = 'hidden';
    return;
  }

  // Iframe para externos y PDFs externos
  if (!useImg) {
    frame.style.display = 'block';
    if (!isInternal) {
      frame.onload = () => {
        clearTimeout(loadTimeout);
        try { void frame.contentWindow.location.href; } catch (_) {}
      };
      frame.onerror = () => { clearTimeout(loadTimeout); showFallback(); };
      loadTimeout = setTimeout(() => {
        try {
          const doc = frame.contentDocument || frame.contentWindow?.document;
          if (!doc || doc.body === null || doc.body.innerHTML === '') {
            showFallback();
            window.open(url, '_blank', 'noopener');
          }
        } catch(_) {}
      }, 4000);
    } else {
      frame.onload = null;
      frame.onerror = null;
    }
    frame.src = url;
  }
  overlay.classList.add('asset-viewer--open');
  document.body.style.overflow = 'hidden';
}

function showFallback() {
  const frame    = document.getElementById('assetViewerFrame');
  const fallback = document.getElementById('assetViewerFallback');
  frame.style.display    = 'none';
  fallback.style.display = 'flex';
}

function closeAssetViewer() {
  const overlay = document.getElementById('assetViewerOverlay');
  if (!overlay) return;
  overlay.classList.remove('asset-viewer--open');
  document.body.style.overflow = '';
  // Limpiar src para cortar cualquier carga en curso
  setTimeout(() => {
    const frame   = document.getElementById('assetViewerFrame');
    const embedEl = document.getElementById('assetViewerEmbed');
    if (frame)   frame.src   = '';
    if (embedEl) embedEl.src = '';
  }, 300);
}

// openAssetModal / closeAssetModal → shared.js (window.openAssetModal / window.closeAssetModal)

document.addEventListener('click', e => {
  const tvBtn = e.target.closest('[data-tv-filter]');
  if (tvBtn) {
    const isShowingMine = tvBtn.dataset.tvFilter === 'mine';
    const content = document.getElementById('jornadaContent');
    if (!content) return;
    if (isShowingMine) {
      // estamos en Mi País → pasar a Todas
      content.querySelectorAll('.tv-entry--regional-hidden').forEach(el => { el.style.display = ''; });
      content.querySelectorAll('.tv-no-country-msg').forEach(el => { el.style.display = 'none'; });
      tvBtn.dataset.tvFilter = 'all';
      tvBtn.textContent = t('tv.filterMine');
      tvBtn.classList.add('tv-filter-btn--active');
    } else {
      // estamos en Todas → volver a Mi País
      content.querySelectorAll('.tv-entry--regional-hidden').forEach(el => { el.style.display = 'none'; });
      content.querySelectorAll('.tv-no-country-msg').forEach(el => { el.style.display = ''; });
      tvBtn.dataset.tvFilter = 'mine';
      tvBtn.textContent = t('tv.filterAll');
      tvBtn.classList.remove('tv-filter-btn--active');
    }
  }
});

// ── Modal de reporte de cambios (Supabase Edge Function) ──────────
function setupReportModal(raceDayId, raceName, stageStr) {
  let overlay = document.getElementById('reportModalOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'reportModalOverlay';
  overlay.className = 'report-modal-overlay';
  overlay.innerHTML = `
    <div class="report-modal" id="reportModal">
      <div class="report-modal__bar">
        <span class="report-modal__title">${t('report.title')}</span>
        <button class="report-modal__close" onclick="closeReportModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <form class="report-modal__form" id="reportForm">
        <div class="report-modal__row">
          <div class="report-modal__field">
            <label class="report-modal__label" for="reporterName">${t('report.nameLabel')}</label>
            <input class="report-modal__input" type="text" id="reporterName" name="reporter-name"
                   placeholder="${t('report.namePlaceholder')}" required autocomplete="name">
          </div>
          <div class="report-modal__field">
            <label class="report-modal__label" for="reporterEmail">${t('report.emailLabel')}</label>
            <input class="report-modal__input" type="email" id="reporterEmail" name="reporter-email"
                   placeholder="${t('report.emailPlaceholder')}" required autocomplete="email">
          </div>
        </div>

        <label class="report-modal__label" for="reportType">${t('report.typeLabel')}</label>
        <select class="report-modal__select" id="reportType" name="report-type" required>
          <option value="" disabled selected>${t('report.typeSelect')}</option>
          <option value="horario">${t('report.typeSchedule')}</option>
          <option value="tv">${t('report.typeTV')}</option>
          <option value="recorrido">${t('report.typeRoute')}</option>
          <option value="cancelacion">${t('report.typeCancellation')}</option>
          <option value="otro">${t('report.typeOther')}</option>
        </select>

        <label class="report-modal__label" for="reportMessage">${t('report.messageLabel')}</label>
        <textarea class="report-modal__textarea" id="reportMessage" name="message" rows="3"
                  placeholder="${t('report.messagePlaceholder')}" required></textarea>

        <!-- honeypot: oculto para humanos, los bots lo rellenan -->
        <input type="text" name="_hp" id="reportHp" autocomplete="off"
               style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
               tabindex="-1" aria-hidden="true">

        <button class="report-modal__submit" type="submit">${t('report.submit')}</button>
      </form>
      <div class="report-modal__success" id="reportSuccess" style="display:none">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p style="margin:0.75rem 0 0;font-weight:600">${t('report.successTitle')}</p>
        <p style="margin:0.25rem 0 0;font-size:0.85rem;color:var(--text-muted)">${t('report.successDesc')}</p>
      </div>
    </div>
  `;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeReportModal(); });
  document.body.appendChild(overlay);

  const form = document.getElementById('reportForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('.report-modal__submit');

    const reporterName = document.getElementById('reporterName').value.trim();
    const reporterEmail = document.getElementById('reporterEmail').value.trim();

    // Validar que el nombre no esté vacío
    if (!reporterName) {
      alert(t('report.nameRequired') || 'Por favor ingresa tu nombre.');
      return;
    }

    // Validar email con expresión regular
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(reporterEmail)) {
      alert(t('report.emailInvalid') || 'Por favor ingresa un correo válido.');
      return;
    }

    // ── Cooldown por navegador: máx. 1 envío cada 2 minutos ────────
    const COOLDOWN_MS  = 2 * 60 * 1000;
    const LS_KEY       = 'report_last_sent';
    const lastSent     = parseInt(localStorage.getItem(LS_KEY) ?? '0', 10);
    const msSinceLast  = Date.now() - lastSent;
    if (msSinceLast < COOLDOWN_MS) {
      const secsLeft = Math.ceil((COOLDOWN_MS - msSinceLast) / 1000);
      alert(t('report.cooldown', { secs: secsLeft }));
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('report.submitting');

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/report-jornada`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          raceDayId,
          raceDayName:   raceName + (stageStr ? ' \u2013 ' + stageStr : ''),
          reportType:    document.getElementById('reportType').value,
          message:       document.getElementById('reportMessage').value,
          reporterName:  document.getElementById('reporterName').value.trim(),
          reporterEmail: document.getElementById('reporterEmail').value.trim(),
          _hp:           document.getElementById('reportHp').value,
        }),
      });
      if (res.status === 429) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('report.submit');
        alert(t('report.tooMany'));
        return;
      }
      if (!res.ok) throw new Error('server error');
      localStorage.setItem(LS_KEY, String(Date.now()));
      form.style.display = 'none';
      document.getElementById('reportSuccess').style.display = 'flex';
    } catch (_) {
      submitBtn.disabled = false;
      submitBtn.textContent = t('report.submit');
      alert(t('report.error'));
    }
  });
}

window.openReportModal = function() {
  const overlay = document.getElementById('reportModalOverlay');
  if (!overlay) return;
  const form = document.getElementById('reportForm');
  const success = document.getElementById('reportSuccess');
  if (form) { form.reset(); form.style.display = ''; }
  if (success) success.style.display = 'none';
  const submitBtn = form?.querySelector('.report-modal__submit');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = t('report.submit'); }
  overlay.classList.add('report-modal--open');
  document.body.style.overflow = 'hidden';
};

window.closeReportModal = function() {
  const overlay = document.getElementById('reportModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('report-modal--open');
  document.body.style.overflow = '';
};

// ── Botón de edición (solo si hay sesión activa en el panel) ──────
function setupEditBtn(raceDayId) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) return;
    const existing = document.getElementById('editJornadaBtn');
    if (existing) return;
    const btn = document.createElement('a');
    btn.id        = 'editJornadaBtn';
    btn.className = 'edit-jornada-btn';
    btn.href      = CONFIG.basePath + '/panel/app.html?edit=' + encodeURIComponent(raceDayId);
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar jornada';
    const hero = document.querySelector('.race-header');
    if (hero) hero.appendChild(btn);
    else document.body.appendChild(btn);
  });
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  await initI18n();
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const params = new URLSearchParams(window.location.search);
  let id = params.get('id');
  let slug = params.get('slug');
  const _initIsEn = getLang() === 'en';

  // Leer slug del path — soporta /jornada/SLUG/ y /en/stage/SLUG/
  if (!id && !slug) {
    const pathMatch = location.pathname.match(/^\/(jornada|en\/stage|stage)\/([^\/]+)\/?$/);
    if (pathMatch) slug = decodeURIComponent(pathMatch[2]);
  }

  // Buscar id por slug — en EN intentamos primero por slugEn, luego por slug (compatibilidad)
  if (!id && slug) {
    try {
      if (_initIsEn) {
        const { data: d1 } = await supabase.from('race_days').select('id').eq('slugEn', slug).limit(1);
        if (d1 && d1.length) { id = d1[0].id; }
        else {
          const { data: d2 } = await supabase.from('race_days').select('id').eq('slug', slug).limit(1);
          if (d2 && d2.length) id = d2[0].id;
        }
      } else {
        const { data } = await supabase.from('race_days').select('id').eq('slug', slug).limit(1);
        if (data && data.length) id = data[0].id;
      }
    } catch (_) { /* si falla la búsqueda, mostrará el error de abajo */ }
  }

  if (!id) {
    document.getElementById('jornadaContent').innerHTML = `
      <div class="empty-state" style="padding:4rem 1.5rem">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__title">Jornada no encontrada</div>
      </div>`;
    return;
  }

  try {
    const { data: rdData, error: rdErr } = await supabase.from('race_days').select('*').eq('id', id).single();
    if (rdErr || !rdData) throw new Error('No existe');
    const rd = rdData;

    // Actualizar URL al path limpio correcto según idioma
    if (_initIsEn && (rd.slugEn || rd.slug)) {
      const cleanSlug = rd.slugEn || rd.slug;
      const _stageEnB = enBase();
      history.replaceState(null, '', `${_stageEnB}/stage/${encodeURIComponent(cleanSlug)}/`);
    } else if (!_initIsEn && rd.slug) {
      history.replaceState(null, '', `/jornada/${encodeURIComponent(rd.slug)}/`);
    }

    // Carrera + broadcasts + assets + resultados in-house: todo depende SOLO de
    // la jornada (rd) ya cargada → un único round-trip (antes la carrera iba
    // antes y bloqueaba a los demás). Las etapas hermanas (siblings) necesitan
    // el formato de la carrera → van después y SOLO en carreras por etapas
    // (en un día no hay navegación entre etapas, así que ahí nos ahorramos el RT).
    const [raceResult, bcastResult, assetsResult, uciResult] = await Promise.all([
      rd.raceId
        ? supabase.from('races').select('*').eq('id', rd.raceId).single()
        : Promise.resolve({ data: null }),
      supabase.from('broadcasts').select('*').eq('raceDayId', id).order('sortOrder', { ascending: true }),
      supabase.from('assets').select('*').eq('raceDayId', id),
      // Resultados in-house: qué etapas de esta carrera tienen clasificaciones
      // propias (race_uci_stages.keepForWeb). Una sola consulta por carrera.
      rd.raceId
        ? supabase.from('race_uci_stages').select('stageNumber').eq('raceId', rd.raceId).eq('keepForWeb', true)
        : Promise.resolve(null),
    ]);
    const race = raceResult.data || {};

    // Etapas hermanas (para navegar entre ellas) — solo en carreras por etapas.
    const siblingsResult = (rd.raceId && race.raceFormat !== 'one_day')
      ? await supabase.from('race_days').select('*').eq('raceId', rd.raceId).eq('editorialStatus', 'published')
      : null;

    const allBroadcasts = bcastResult.data || [];
    const broadcasts = filterBroadcastsByRegion(allBroadcasts);
    const assets     = assetsResult.data || [];
    // Set de stageNumbers con resultados propios (null → clasificación final/un día → 'final').
    const inhouseStages = new Set(
      (uciResult?.data || []).map(s => s.stageNumber == null ? 'final' : s.stageNumber)
    );
    // Derivado de `races.startlistImportedAt` (ya cargado con la carrera).
    // Evita un roundtrip extra a `startlist_teams` que retrasaba el botón.
    const hasStartlist = !!race.startlistImportedAt;
    const technicalGuide = race.id ? await loadRaceTechnicalGuide(race.id) : null;

    // Ordenar etapas hermanas
    let siblings = [];
    if (siblingsResult) {
      siblings = (siblingsResult.data || [])
        .sort((a, b) => {
          if ((a.stageNumber !== null && a.stageNumber !== undefined) && (b.stageNumber !== null && b.stageNumber !== undefined)) {
            if (a.stageNumber !== b.stageNumber) return a.stageNumber - b.stageNumber;
            const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
            const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
            return tA - tB;
          }
          return (a.dateKey||'').localeCompare(b.dateKey||'');
        });
      annotateDoubleSectors(siblings);
      // Propagar sufijo y número FC al rd actual desde siblings
      const match = siblings.find(s => s.id === rd.id);
      if (match) {
        if (match._stageSuffix) rd._stageSuffix = match._stageSuffix;
        if (match._fcStageNumber != null) rd._fcStageNumber = match._fcStageNumber;
      }
    }

    render(rd, race, broadcasts, withRaceTechnicalGuide(assets, technicalGuide), siblings, hasStartlist, allBroadcasts, inhouseStages);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
    setupEditBtn(id);
    setupIcalModal(rd, race);

  } catch (err) {
    console.error(err);
    document.getElementById('jornadaContent').innerHTML = `
      <div class="empty-state" style="padding:4rem 1.5rem">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__title">Error al cargar la jornada</div>
      </div>`;
  } finally {
  }
}

// ── Modal de suscripción iCal por jornada ─────────────────────────────────────

let _icalOverlay = null;
let _releaseIcalFocus = null;

function closeIcalModal() {
  if (!_icalOverlay) return;
  _icalOverlay.classList.remove('rd-modal--open');
  document.body.style.overflow = '';
  if (_releaseIcalFocus) { _releaseIcalFocus(); _releaseIcalFocus = null; }
}

function setupIcalModal(rd, race) {
  const showSubscribe = !rd.isRestDay && !rd.isCancelledDay;

  let bar = document.getElementById('icalBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'icalBar';
    bar.className = 'ical-bar';
    const footer = document.querySelector('footer.site-footer');
    if (footer) footer.before(bar); else document.body.appendChild(bar);
  } else {
    bar.style.display = '';
  }

  const CAL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>'
    + '<line x1="16" y1="2" x2="16" y2="6"/>'
    + '<line x1="8" y1="2" x2="8" y2="6"/>'
    + '<line x1="3" y1="10" x2="21" y2="10"/>'
    + '</svg>';
  const FLAG_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';

  let barHTML = '';
  if (showSubscribe) {
    barHTML += '<button type="button" class="btn-ical" id="icalOpenBtn">' + CAL_SVG + ' ' + t('stage.addToCalendar') + '</button>';
  }
  barHTML += '<button type="button" class="btn-ical btn-ical--report" id="reportBarBtn">' + FLAG_SVG + ' ' + t('stage.reportChanges') + '</button>';
  bar.innerHTML = barHTML;

  const reportBarBtn = document.getElementById('reportBarBtn');
  if (reportBarBtn) reportBarBtn.onclick = openReportModal;

  if (!showSubscribe) return;

  const openBtn = document.getElementById('icalOpenBtn');
  if (!openBtn) return;

  openBtn.onclick = function () {
    if (!_icalOverlay) {
      const _icalIsEn = getLang() === 'en';
      const _icalSlug = _icalIsEn ? (rd.slugEn || rd.slug) : rd.slug;
      const hasEventFeed = !!_icalSlug;
      const eventUrl = hasEventFeed
        ? 'https://calendariociclismo.app/' + (_icalIsEn ? 'en/' : '') + 'feed/event/' + encodeURIComponent(_icalSlug) + '.ics'
        : null;
      const year = new Date().getFullYear();
      const sn = rd.stageNumber;
      const stageLabel = sn === 0 ? t('stage.prologue') : sn != null ? (t('stage.stage') + ' ' + sn) : '';
      const raceName = _icalIsEn ? (race.nameEn || race.name || '') : (race.name || '');
      const eventLabel = stageLabel
        ? (raceName + ' — ' + stageLabel)
        : (raceName || t('ical.thisStageDefault'));

      const FEEDS = [
        { key: 'todo',  label: t('ical.feeds.todo'),  desc: t('ical.feeds.todoDesc') },
        { key: 'pro',   label: t('ical.feeds.pro'),   desc: t('ical.feeds.proDesc') },
        { key: 'wt',    label: t('ical.feeds.wt'),    desc: t('ical.feeds.wtDesc') },
        { key: 'wwt',   label: t('ical.feeds.wwt'),   desc: t('ical.feeds.wwtDesc') },
        { key: 'masc',  label: t('ical.feeds.masc'),  desc: t('ical.feeds.mascDesc') },
        { key: 'fem',   label: t('ical.feeds.fem'),   desc: t('ical.feeds.femDesc') },
      ];

      const _icalFeedBase = 'https://calendariociclismo.app/' + (_icalIsEn ? 'en/' : '') + 'feed/';
      const feedUrl = key => key === 'todo'
        ? _icalFeedBase + year + '.ics'
        : _icalFeedBase + year + '-' + key + '.ics';

      const ICON_COPY  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      const ICON_ARROW = '<svg class="sus-feed__arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      const ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      const feedCard = (url, label, desc, extra) =>
        '<div class="sus-feed' + (extra ? ' ' + extra : '') + '">' +
          '<a class="sus-feed__link" href="' + url + '" aria-label="' + t('ical.subscribeLabel') + ': ' + label + '">' +
            '<div class="sus-feed__body">' +
              '<p class="sus-feed__label">' + label + '</p>' +
              '<p class="sus-feed__desc">' + desc + '</p>' +
            '</div>' +
            ICON_ARROW +
          '</a>' +
          '<button type="button" class="sus-feed__copy" aria-label="' + t('ical.copyLabel') + '" data-url="' + url + '">' + ICON_COPY + '</button>' +
        '</div>';

      const seasonFeeds = FEEDS.map(f => feedCard(feedUrl(f.key), f.label + ' ' + year, f.desc, '')).join('');

      _icalOverlay = document.createElement('div');
      _icalOverlay.className = 'rd-modal-overlay';
      _icalOverlay.innerHTML =
        '<div class="rd-modal" role="dialog" aria-modal="true" aria-label="' + t('ical.title') + '">' +
          '<div class="rd-modal__bar">' +
            '<div class="rd-modal__header-text">' +
              '<span class="rd-modal__race-name">' + t('ical.title') + '</span>' +
            '</div>' +
            '<button class="rd-modal__close" id="icalModalClose" aria-label="' + t('ical.closeLabel') + '">' + ICON_CLOSE + '</button>' +
          '</div>' +
          '<div class="ical-modal__body">' +
            (hasEventFeed
              ? '<p class="ical-modal__section">' + t('ical.thisStageSection') + '</p>' +
                feedCard(eventUrl, eventLabel, t('ical.onlyThisStage'), 'sus-feed--event') +
                '<div class="ical-modal__or">' + t('ical.orSubscribeSeason') + '</div>'
              : '<p class="ical-modal__section">' + t('ical.season') + ' ' + year + '</p>') +
            '<div class="sus-feeds">' + seasonFeeds + '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(_icalOverlay);

      _icalOverlay.addEventListener('click', function (e) {
        const copyBtn = e.target.closest('.sus-feed__copy');
        if (copyBtn) {
          const url = copyBtn.dataset.url;
          const doFallback = () => {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
          };
          (navigator.clipboard ? navigator.clipboard.writeText(url).catch(doFallback) : Promise.resolve(doFallback()));
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = ICON_CHECK;
          setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = ICON_COPY; }, 1600);
          return;
        }
        if (e.target === _icalOverlay) closeIcalModal();
      });

      document.getElementById('icalModalClose').addEventListener('click', closeIcalModal);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && _icalOverlay && _icalOverlay.classList.contains('rd-modal--open')) closeIcalModal();
      });
    }

    _icalOverlay.classList.add('rd-modal--open');
    document.body.style.overflow = 'hidden';
    _releaseIcalFocus = trapFocus(_icalOverlay.querySelector('.rd-modal') || _icalOverlay);
  };
}

init();
