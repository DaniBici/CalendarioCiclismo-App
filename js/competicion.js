// ─────────────────────────────────────────────────────────────────
//  COMPETICIÓN — competicion.html?id=RACE_ID
// ─────────────────────────────────────────────────────────────────

import { supabase, stageLabel, countryFlag, formatTime, formatTimeUser,
         typeBadge, resolveTypeBadges, setMeta, setMetaProperty, tsSeconds, initPhTooltip, esc,
         jornadaUrl, raceName as getRaceName, rdLocation, filterBroadcastsByRegion, enBase,
         extractYouTubeId, startOrderUrl, seoLongDate, seoDayMonth, buildTimeStack, buildRaceHeader,
         articuloNombre, femaleMark }
         from './shared.js';
import { t, getLang, getLocale, initI18n } from './i18n.js';
import { annotateDoubleSectors } from './services/races.js';
import { hasModalData, openRaceDataModal, openResultsModal, openBroadcastTvModal, openYoutubeTvModal, loadInhouseStageSet } from './race-data-modal.js';
import { buildElevationSparkline } from './elevation-profile.js';
// Botones de assets, badge de TV y modales de asset/perfil (compartidos con campeonatos.js).
// Importar este módulo instala window.openAssetModal / window.openDynPerfilModal.
import { tvBadge } from './race-assets.js';

function formatDateShort(dk) {
  if (!dk) return '';
  const [y, m, d] = dk.split('-').map(Number);
  const str = new Date(y, m-1, d).toLocaleDateString(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function formatDateRange(startDk, endDk) {
  if (!startDk) return '';
  const [sy, sm, sd] = startDk.split('-').map(Number);
  const [ey, em, ed] = (endDk || startDk).split('-').map(Number);
  const startD = new Date(sy, sm - 1, sd);
  const endD   = new Date(ey, em - 1, ed);
  const fmtDay = d => d.getDate();
  const fmtMon = d => d.toLocaleDateString(getLocale(), { month: 'short' });
  if (sm === em && sy === ey) {
    // Mismo mes: "6–27 jul"
    return `${fmtDay(startD)}–${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  if (sy === ey) {
    // Mismo año, distinto mes: "30 ago – 21 sep"
    return `${fmtDay(startD)} ${fmtMon(startD)} – ${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  // Distinto año (rarísimo): "31 dic – 2 ene"
  return `${fmtDay(startD)} ${fmtMon(startD)} – ${fmtDay(endD)} ${fmtMon(endD)}`;
}
const _tvSvgC     = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const _timerSvgC  = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><line x1="10" y1="2" x2="14" y2="2"/><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 13"/></svg>';
const _trophySvgC = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>';

function _raceTimeCheckC(rd, offsetMinutes) {
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
function _shouldShowResultsC(rd, fcId, pcsSlug) {
  if (rd.isRestDay || rd.isCancelledDay) return false;
  if (!fcId && !pcsSlug) return false;
  return _raceTimeCheckC(rd, 30);
}
// Cablea el badge "Resultados" con un listener DIRECTO (no delegado): el badge
// vive dentro de una fila con onclick→jornada, así que necesita stopPropagation
// propio. Antes el inline stopPropagation mataba también el handler delegado →
// el botón no hacía nada. openResultsModal decide: in-house → va a /resultados/.
// raceFor: o un objeto carrera fijo (vista de una carrera) o una función
// (rd) => raceObj (vista de grupo, cada fila lleva su propia carrera).
function _wireResultsBadges(container, rdMap, raceFor) {
  container.querySelectorAll('.badge--results[data-results-rdid]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const rd = rdMap[btn.dataset.resultsRdid];
      if (!rd) return;
      const raceObj = typeof raceFor === 'function' ? raceFor(rd) : raceFor;
      openResultsModal(rd, raceObj);
    });
  });
}
function _resultsBadgesC(rd) {
  const reviveBcast = (rd._broadcasts || [])
    .filter(b => b.url && (b.showInRevive || /eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be|facebook\.com/i.test(b.url)))
    .sort((a, b) => {
      const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
      const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
      if (aSoc !== bSoc) return aSoc - bSoc;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    })[0] ?? null;
  const reviveUrl = reviveBcast?.url;
  const reviveYtId = reviveUrl && reviveBcast.embeddable !== false ? extractYouTubeId(reviveUrl) : null;
  // El listener se cablea directamente sobre el botón tras el render (wireResultsBadges):
  // stopPropagation ahí evita el onclick de fila (→ jornada) Y permite ir a resultados.
  const resultsBadge = `<button type="button" class="badge badge--results badge--icon" data-results-rdid="${rd.id}" title="${t('stage.results')}" aria-label="${t('stage.results')}">${_trophySvgC}<span class="badge__label">${t('stage.results')}</span></button>`;
  const reviveBadge = reviveUrl
    ? `<a class="badge badge--tv badge--tv-link badge--revive badge--icon" href="${reviveUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${t('tv.reviveRace')}" aria-label="${t('tv.reviveRace')}"${reviveYtId ? ` data-yt-id="${reviveYtId}" data-yt-rd-id="${rd.id}"` : ''}>${_tvSvgC}<span class="badge__label">${t('tv.reviveRace')}</span></a>`
    : '';
  return resultsBadge + reviveBadge;
}

// tvBadge vive en ./race-assets.js (importado arriba). Los botones de assets ya
// no se muestran en la lista de etapas: forzamos la entrada a la jornada (visitas).

async function init() {
  await initI18n();
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const params  = new URLSearchParams(window.location.search);
  let   id      = params.get('id');
  const content = document.getElementById('competicionContent');

  // ── Modo challenge group ──────────────────────────────────────
  const challengeSlug = params.get('challenge');
  if (challengeSlug) {
    await loadChallenge(challengeSlug, content, params);
    return;
  }

  // Enlace "volver"
  const navState = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const backBtn  = document.querySelector('.back-btn');
  if (backBtn) {
    const fromVal = params.get('from') || navState.from;
    if (fromVal === 'temporada') {
      const year = params.get('year') || navState.year || '';
      const cat  = params.get('cat')  || navState.cat  || '';
      const qs   = new URLSearchParams();
      if (year) qs.set('year', year);
      if (cat) qs.set('cat', cat);
      qs.set('vista', 'temporada');
      const _isEnBack = getLang() === 'en';
      backBtn.href = _isEnBack
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario.html?' + qs;
    } else if (fromVal === 'mes') {
      // Leer mes desde URL (?month=YYYY-MM) o desde sessionStorage
      const monthParam = params.get('month');
      let month, year;
      if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        const [y, m] = monthParam.split('-').map(Number);
        year  = y;
        month = m - 1; // 0-indexed para consistencia con sessionStorage
      } else {
        month = navState.month ?? new Date().getMonth();
        year  = navState.year  ?? new Date().getFullYear();
      }
      const qs = new URLSearchParams({ vista: 'mes', mes: String(year) + '-' + String(month + 1).padStart(2, '0') });
      const _isEnBackM = getLang() === 'en';
      backBtn.href = _isEnBackM
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario.html?' + qs;
    } else if (fromVal === 'dia') {
      const date = params.get('date') || navState.date || '';
      backBtn.href = CONFIG.basePath + '/index.html' + (date ? '?date=' + date : '');
    }
  }

  const _initIsEn = getLang() === 'en';

  // Fallback: si no hay id pero sí slug, buscar por slug.
  // Soporta /competicion/<slug>/ y /en/race/<slug>/ (pre-render hidratada).
  if (!id) {
    let slug = params.get('slug');
    if (!slug) {
      const pathMatch = location.pathname.match(/^\/(competicion|en\/race|race)\/([^\/]+)\/?$/);
      if (pathMatch) slug = decodeURIComponent(pathMatch[2]);
    }
    if (slug) {
      try {
        if (_initIsEn) {
          const { data: d1 } = await supabase.from('races').select('id').eq('slugEn', slug).limit(1);
          if (d1 && d1.length) { id = d1[0].id; }
          else {
            const { data: d2 } = await supabase.from('races').select('id').eq('slug', slug).limit(1);
            if (d2 && d2.length) id = d2[0].id;
          }
        } else {
          const { data } = await supabase.from('races').select('id').eq('slug', slug).limit(1);
          if (data && data.length) id = data[0].id;
        }
      } catch (_) { /* si falla, mostrará error abajo */ }
    }
  }

  if (!id) { content.innerHTML = errorHTML('Competición no especificada'); return; }

  try {
    const { data: raceData, error: raceErr } = await supabase.from('races').select('*').eq('id', id).single();
    if (raceErr || !raceData) throw new Error('No existe');
    const race = raceData;
    document.title = `${getRaceName(race)} — ${t('seo.siteName')}`;

    // Actualizar URL al path limpio según idioma
    if (_initIsEn && (race.slugEn || race.slug)) {
      const _raceEnB = enBase();
      history.replaceState(null, '', `${_raceEnB}/race/${encodeURIComponent(race.slugEn || race.slug)}/`);
    } else if (!_initIsEn && race.slug) {
      history.replaceState(null, '', `/competicion/${encodeURIComponent(race.slug)}/`);
    }
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

    const { data: daysData } = await supabase.from('race_days').select('*').eq('raceId', id).eq('editorialStatus', 'published');
    let days = daysData || [];
    days.sort((a, b) => {
      if ((a.stageNumber !== null && a.stageNumber !== undefined) && (b.stageNumber !== null && b.stageNumber !== undefined)) {
        if (a.stageNumber !== b.stageNumber) return a.stageNumber - b.stageNumber;
        const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
        const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
        return tA - tB;
      }
      return (a.dateKey||'').localeCompare(b.dateKey||'');
    });

    // Cargar broadcasts, assets y etapas con resultados in-house en paralelo
    const dayIds = days.map(d => d.id);
    const [bResult, aResult, inhouseSet] = dayIds.length
      ? await Promise.all([
          supabase.from('broadcasts').select('*').in('raceDayId', dayIds),
          supabase.from('assets').select('*').in('raceDayId', dayIds),
          loadInhouseStageSet([id]),
        ])
      : [{ data: [] }, { data: [] }, { has: () => false }];
    const bByRd = {}, aByRd = {};
    (bResult.data || []).forEach(b => { (bByRd[b.raceDayId] = bByRd[b.raceDayId] || []).push(b); });
    (aResult.data || []).forEach(a => { (aByRd[a.raceDayId] = aByRd[a.raceDayId] || []).push(a); });
    days.forEach(rd => { const _allB = bByRd[rd.id] || []; rd._broadcasts = filterBroadcastsByRegion(_allB); rd._tvBlocked = _allB.length > 0 && rd._broadcasts.length === 0; rd._assets = aByRd[rd.id] || []; rd._hasInhouse = inhouseSet.has(rd); });
    annotateDoubleSectors(days);

    const flag        = countryFlag(race.countryCode);   // usado en tooltips de etapa (data-ph-flag)
    const color       = race.colorHex || 'var(--accent)'; // usado por buildElevationSparkline
    const isStageRace = race.raceFormat !== 'one_day';

    // Calcular rango de fechas usando los race_days (excluir descansos)
    const raceDaysOnly = days.filter(d => !d.isRestDay && d.dateKey);
    const firstDateKey = raceDaysOnly.length ? raceDaysOnly[0].dateKey : null;
    const lastDateKey  = raceDaysOnly.length ? raceDaysOnly[raceDaysOnly.length - 1].dateKey : null;
    const dateRange    = firstDateKey ? formatDateRange(firstDateKey, lastDateKey) : '';

    // Hero (cabecera unificada). Detalle = rango de fechas · categoría · nº etapas.
    const nDaysC  = raceDaysOnly.length;
    const countKey = isStageRace
      ? (nDaysC !== 1 ? 'stage.stagesCount_other' : 'stage.stagesCount_one')
      : (nDaysC !== 1 ? 'stage.racesCount_other'  : 'stage.racesCount_one');
    const detailC = [
      dateRange ? `${dateRange} ${race.year}` : race.year,
      race.uciCategory,
      t(countKey).replace('{n}', nDaysC),
    ].filter(Boolean).join(' · ');
    let html = buildRaceHeader({ race, nameHref: '', detail: detailC });

    // Lista de etapas
    html += `<div style="max-width:860px;padding:1rem 1.5rem 3rem">`;

    // Web oficial + Libro de Ruta + Inscritos. La guía se guarda una vez en
    // assets de cualquier etapa y se resuelve aquí a nivel de competición.
    const hasStartlistC = !!race.startlistImportedAt;
    let websiteBtnHtmlC = '';
    if (race.websiteUrl) {
      websiteBtnHtmlC = `<a class="asset-btn" href="${race.websiteUrl}" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> ${t('stage.websiteLabel')}</a>`;
    }
    const technicalGuideC = days.flatMap(day => day._assets || [])
      .find(asset => asset.type === 'technicalGuide' && (asset.url || asset.filePath));
    let technicalGuideBtnHtmlC = '';
    if (technicalGuideC) {
      const guideUrl = technicalGuideC.url || technicalGuideC.filePath;
      const safeGuideUrl = guideUrl.replace(/'/g, "\\'");
      const guideLabel = t('assets.technicalGuide');
      const safeGuideLabel = guideLabel.replace(/'/g, "\\'");
      technicalGuideBtnHtmlC = `<button class="asset-btn" type="button" onclick="openAssetModal('${safeGuideUrl}','${safeGuideLabel}')"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg> ${guideLabel}</button>`;
    }
    let startlistBtnHtmlC = '';
    if (hasStartlistC) {
      const inscritosHrefC = race.slug
        ? `${CONFIG.basePath}/inscritos/${encodeURIComponent(race.slug)}/`
        : `${CONFIG.basePath}/inscritos.html?race=${race.id}`;
      const startlistLabelC = race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'));
      startlistBtnHtmlC = `<a class="asset-btn" href="${inscritosHrefC}"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg> ${startlistLabelC}</a>`;
    }
    if (websiteBtnHtmlC || technicalGuideBtnHtmlC || startlistBtnHtmlC) {
      html += `<div class="asset-links" style="margin-bottom:0.85rem">${websiteBtnHtmlC}${technicalGuideBtnHtmlC}${startlistBtnHtmlC}</div>`;
      html += `<hr style="border:none;border-top:1px solid var(--border);margin:0 0 0.85rem">`;
    }

    if (days.length === 0) {
      html += `<div class="empty-state" style="padding:3rem 0">
        <div class="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div>
        <div class="empty-state__text">${t('stage.noStages')}</div></div>`;
    } else {
      days.forEach((rd, idx) => {
        const stage  = stageLabel(rd.stageNumber, rd._stageSuffix);
        const date   = formatDateShort(rd.dateKey);

        // Jornada de descanso
        if (rd.isRestDay) {
          const city = rd.startLocation ? `<span class="race-card__sep">·</span><span class="race-card__route">${rdLocation(rd, 'startLocation')}</span>` : '';
          html += `<div class="race-card race-card--stage race-card--rest-day" style="--card-color:transparent;margin-bottom:0.5rem;opacity:0.6">
            <div class="race-card__main">
              <div class="race-card__name" style="font-size:0.9rem;font-style:italic">${date}</div>
              <div class="race-card__sub">
                <span style="font-style:italic">${t('stage.restDay')}</span>${city}
              </div>
            </div>
          </div>`;
          return;
        }

        const route  = rd.startLocation ? (!rd.finishLocation || rd.startLocation === rd.finishLocation ? rdLocation(rd, 'startLocation') : `${rdLocation(rd, 'startLocation')} › ${rdLocation(rd, 'finishLocation')}`) : '';
        const _isEnC = getLang() === 'en';
        const km     = rd.distanceKm ? `${_isEnC ? String(rd.distanceKm) : String(rd.distanceKm).replace('.', ',')} km` : '';
        const _elevGainC = rd.elevationProfile?.elevationGain;
        const elev   = _elevGainC != null ? `+${String(Math.round(_elevGainC / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEnC ? ',' : '.')} m` : '';
        const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
        const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
        const start  = startTU?.display  ?? null;
        const finish = finishTU?.display ?? null;
        const timeTip = (startTU?.tooltip || finishTU?.tooltip)
          ? 'Hora Madrid · ' + [startTU?.tooltip, finishTU?.tooltip].filter(Boolean).join(' – ')
          : null;

        const typeBadges = rd.primaryType ? resolveTypeBadges(rd.primaryType, rd.secondaryType) : '';
        const routePart = route ? `<span class="race-card__route">${route}</span>` : '';
        const kmPart    = km    ? `<span class="race-card__km">${km}</span>` : '';
        const elevPart  = elev  ? `<span class="race-card__elev">${elev}</span>` : '';
        // route va en wrapper truncable; km va fijo; sep entre ambos solo si hay los dos
        const routeWrap = routePart ? `<span class="race-card__route-wrap">${routePart}</span>` : '';
        const sepRouteKm = (routePart && kmPart) ? `<span class="race-card__sep">·</span>` : '';
        const sepKmElev  = (kmPart && elevPart) ? `<span class="race-card__sep">·</span>` : '';

        const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
          && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
        const rdHasAssets = rdViewableProfile || (rd._assets
          ? rd._assets.some(a => (a.url || a.filePath) && ['startOrder','roadbook','profile','map','ports'].includes(a.type))
          : (rd.hasAssets === true));
        const rdClickable = !race.isNoClickable && rdHasAssets;
        // La jornada cancelada SÍ abre su modal: conserva recorrido, distancia,
        // tipo y descripción — describen la etapa que estaba trazada. Antes se
        // quedaba muerta mientras sus hermanas sí abrían.
        const rdHasModal  = !rdClickable && hasModalData(rd);
        // Con clasificaciones propias → modo terminado sin esperar a la heurística
        // horaria ni exigir fcId/pcsSlug (paridad apps: hasInhouse || shouldShowResults)
        const showResultsC = rd._hasInhouse === true || _shouldShowResultsC(rd, race.fcId, race.pcsSlug);
        const hideNoIdsC = !rd._hasInhouse && !rd.isCancelledDay && !race.fcId && !race.pcsSlug && _raceTimeCheckC(rd, 0);
        const _noIdsReviveBcastC = hideNoIdsC ? (rd._broadcasts || [])
          .filter(b => b.url && (b.showInRevive || /eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be|facebook\.com/i.test(b.url)))
          .sort((a, b) => {
            const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
            const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
            if (aSoc !== bSoc) return aSoc - bSoc;
            return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          })[0] ?? null : null;
        const noIdsReviveUrlC = _noIdsReviveBcastC?.url ?? null;
        const _noIdsReviveYtIdC = noIdsReviveUrlC && _noIdsReviveBcastC?.embeddable !== false ? extractYouTubeId(noIdsReviveUrlC) : null;
        const noIdsReviveBadgeC = noIdsReviveUrlC
          ? `<a class="badge badge--tv badge--tv-link badge--revive badge--icon" href="${noIdsReviveUrlC}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${t('tv.reviveRace')}" aria-label="${t('tv.reviveRace')}"${_noIdsReviveYtIdC ? ` data-yt-id="${_noIdsReviveYtIdC}" data-yt-rd-id="${rd.id}"` : ''}>${_tvSvgC}<span class="badge__label">${t('tv.reviveRace')}</span></a>`
          : '';

        // Elevation sparkline
        const _isTimeTrial1 = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
        let epSvgHtml1 = null;
        if (rd.elevationProfile && !rd.isCancelledDay) {
          if (showResultsC || hideNoIdsC) {
            epSvgHtml1 = buildElevationSparkline(rd.elevationProfile, 1, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
          } else {
            if (rd.neutralStartTimeUtc && rd.estimatedFinishTimeUtc) {
              const now1 = Date.now();
              const startMs1 = new Date(rd.neutralStartTimeUtc).getTime();
              const endMs1   = new Date(rd.estimatedFinishTimeUtc).getTime();
              const cutMs1   = (race.fcId || race.pcsSlug) ? endMs1 + 30 * 60 * 1000 : endMs1;
              if (endMs1 > startMs1 && now1 >= startMs1 && now1 < cutMs1) {
                const pct1 = _isTimeTrial1 ? 0 : Math.min(100, Math.round((now1 - startMs1) / (endMs1 - startMs1) * 100));
                epSvgHtml1 = buildElevationSparkline(rd.elevationProfile, pct1 / 100, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
              }
            }
            if (!epSvgHtml1) {
              const showStatic1 = rd.neutralStartTimeUtc
                ? Date.now() < new Date(rd.neutralStartTimeUtc).getTime()
                : !_raceTimeCheckC(rd, 30);
              if (showStatic1) {
                epSvgHtml1 = buildElevationSparkline(rd.elevationProfile, 0, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
              }
            }
          }
        }

        const _startOrderAsset1 = rd._assets ? rd._assets.find(a => a.url && a.type === 'startOrder') : null;
        const _showStartOrder1 = !!_startOrderAsset1 && _isTimeTrial1 && !rd.isCancelledDay && !showResultsC && !hideNoIdsC;
        const _startOrderBadgeHtml1 = _showStartOrder1 ? `<a class="badge badge--startorder" href="${startOrderUrl(rd)}" onclick="event.stopPropagation()">${_timerSvgC} ${t('assets.startOrder')}</a>` : '';
        const todayStr1 = new Date().toISOString().slice(0, 10);
        const phMsg1 = (!rdClickable && !rdHasModal) ? (rd.isCancelledDay ? t('stage.stageCancelledTooltip') : (rd.dateKey && todayStr1 < rd.dateKey) ? t('stage.noExtraInfoSoon') : t('stage.noExtraInfo')) : '';
        // Fila unificada de badges bajo el nombre (paridad iOS):
        // Cancelada → Tipo → TV → Orden salida. El horario va apilado a la derecha.
        // Cancelada → sin badge de tipo (paridad con Hoy y con las apps).
        const _showTypeBadge1 = !rd.isCancelledDay && (!epSvgHtml1 || _isTimeTrial1) && !!typeBadges;
        // Cancelada → sin TV ni Live Texto: no se emitió (paridad con Hoy y apps).
        const _tvBadgeHtml1 = (showResultsC || hideNoIdsC || rd.isCancelledDay) ? '' : tvBadge(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd.id, rd._tvBlocked);
        const _badgeRow1 = `<div class="race-card__badges">`
          + (rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.stageCancelledBadge')}</span>` : '')
          + (_showTypeBadge1 ? `<span class="race-card__types--inline">${typeBadges}</span>` : '')
          + _tvBadgeHtml1
          + _startOrderBadgeHtml1
          + `</div>`;
        const _finishedC1 = showResultsC || (hideNoIdsC && !!noIdsReviveUrlC);
        html += `<div class="race-card race-card--stage${epSvgHtml1 ? ' race-card--elevation' : ''}${rdHasModal ? ' race-card--has-modal' : ''}${_finishedC1 ? ' race-card--finished' : ''}" style="--card-color:${epSvgHtml1 ? color : 'transparent'};margin-bottom:0.5rem;${rdClickable || rdHasModal ? 'cursor:pointer' : 'cursor:default'}"
          ${rdClickable ? `onclick="location.href='${jornadaUrl(rd)}'"` : rdHasModal ? `data-rdid="${rd.id}"` : `data-ph-tooltip="${phMsg1}" data-ph-flag="${esc(flag)}" data-ph-name="${esc(getRaceName(race))}" data-ph-sub="${esc(stage ? stage + ' · ' + date : date)}"`}>
          <div class="race-card__main">
            <div class="race-card__name" style="font-size:0.9rem">${stage ? `${stage}<span class="race-card__sep">·</span>${date}` : date}</div>
            <div class="race-card__sub">
              ${routeWrap}${sepRouteKm}${kmPart}${sepKmElev}${elevPart}
            </div>
            ${_badgeRow1}
          </div>
          <div class="race-card__meta">
            <div class="race-card__meta-top">
              ${showResultsC
                ? _resultsBadgesC(rd)
                : hideNoIdsC
                  ? noIdsReviveBadgeC
                  : rd.isCancelledDay ? '' : buildTimeStack(start, finish, timeTip)}
            </div>
          </div>
          ${epSvgHtml1 || ''}
        </div>`;
      });
    }
    html += `</div>`;
    const rdMap = {};
    days.forEach(d => { rdMap[d.id] = d; });

    content.innerHTML = html;
    _wireResultsBadges(content, rdMap, race);

    content.addEventListener('click', e => {
      const embedBadge = e.target.closest('[data-tv-embed][data-tv-rd-id]');
      if (embedBadge) {
        e.stopPropagation();
        e.preventDefault();
        const rd = rdMap[embedBadge.dataset.tvRdId];
        if (rd) openBroadcastTvModal(rd, race, embedBadge.href);
        return;
      }
      const ytBadge = e.target.closest('[data-yt-id][data-yt-rd-id]');
      if (ytBadge) {
        e.stopPropagation();
        e.preventDefault();
        const rd = rdMap[ytBadge.dataset.ytRdId];
        if (rd) openYoutubeTvModal(rd, race, ytBadge.dataset.ytId);
        return;
      }
      const el = e.target.closest('[data-rdid]');
      if (!el) return;
      openRaceDataModal(el.dataset.rdid, race);
    });

    updateSeoCompeticion(race, days);

  } catch(err) {
    console.error(err);
    content.innerHTML = errorHTML(t('race.errorCompetition'));
  } finally {
  }
}

// ── SEO dinámico — competición ────────────────────────────────────
// articuloNombre vive ahora en shared.js (compartida con perfil-pub.js).

// Solo lo usa updateSeoCompeticion: fecha embebida en title/description/og (Spanish-only),
// que Googlebot indexa. Formato fijo sin ICU — toLocaleDateString cae a inglés en su
// renderer. Ver shared.js / docs/memory/seo-og-pages.md.
function formatDayMonth(dateKey, includeMonth) {
  return includeMonth ? seoDayMonth(dateKey, 'es') : String(dateKey.split('-').map(Number)[2]);
}

function updateSeoCompeticion(race, days) {
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';

  const name  = race.name || '';
  const origName = race.originalName || '';
  const nameWithOrig = origName ? `${name} (${origName})` : name;
  const year  = race.year || new Date().getFullYear();
  const art   = articuloNombre(name);

  // Ordenar etapas por dateKey para obtener primera y última
  const sorted = [...days].sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
  const first  = sorted[0];
  const last   = sorted[sorted.length - 1];

  // Detectar si la carrera abarca más de un mes
  const firstMonth = first?.dateKey?.slice(0, 7);
  const lastMonth  = last?.dateKey?.slice(0, 7);
  const multiMonth = firstMonth !== lastMonth;

  // Formatear fechas — si es el mismo mes, la fecha de inicio solo lleva el día
  const fechaInicio  = first ? formatDayMonth(first.dateKey, multiMonth) : '';
  const fechaFin     = last  ? seoLongDate(last.dateKey, 'es') : '';

  // Ciudades primera salida y última llegada para keywords
  const ciudadSalida  = first ? rdLocation(first, 'startLocation')  : '';
  const ciudadLlegada = last  ? rdLocation(last,  'finishLocation') : '';

  // Carrera de un día: /competicion/ comparte keyword/slug con su jornada.
  // Consolidamos la señal SEO hacia la JORNADA (canonical, og:url, JSON-LD url)
  // y describimos "se disputa el D de mes" (nunca "del D al D"). Espejo del
  // generador estático (og-pages.yml).
  const isOneDay = race.raceFormat === 'one_day';
  const oneDayRd = isOneDay
    ? sorted.find(d => !d.isRestDay && d.slug) || first
    : null;

  const title       = `${name} ${year} — ${t('seo.siteName')}`;
  const description = isOneDay
    ? `${art.charAt(0).toUpperCase() + art.slice(1)} ${nameWithOrig} se disputa el ${fechaFin}. Consulta el recorrido y cómo ver por TV y online streaming.`
    : `${art.charAt(0).toUpperCase() + art.slice(1)} ${nameWithOrig} se disputa del ${fechaInicio} al ${fechaFin}. Consulta el recorrido, etapas y cómo ver por TV y online streaming.`;
  const keywords    = `${BASE_KW}, ${name}, ${name} ${year}${origName ? ', ' + origName : ''}${ciudadSalida ? ', ' + ciudadSalida : ''}${ciudadLlegada ? ', ' + ciudadLlegada : ''}`;

  document.title = title;
  setMeta('description', description);
  setMeta('keywords', keywords);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);

  // og:image: imagen OG compuesta con logo de la carrera
  const DEFAULT_OG_IMAGE = 'https://pub-10252f2a495c488a856a619206783642.r2.dev/og-default.png';
  const OG_WORKER = 'https://og.calendariociclismo.app';
  const ogImage = (race.logoUrl && race.logoUrl.startsWith('https://assets.calendariociclismo.app/'))
    ? `${OG_WORKER}/?logo=${encodeURIComponent(race.logoUrl)}&title=${encodeURIComponent(name + ' ' + year)}`
    : DEFAULT_OG_IMAGE;
  setMetaProperty('og:image', ogImage);
  setMetaProperty('og:image:alt', `${name} ${year}`);

  // Twitter Card
  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', description);
  setMeta('twitter:image', ogImage);
  setMeta('twitter:image:alt', `${name} ${year}`);

  // ── Canonical + og:url ──
  // Un día → canonical a la jornada (contenido real); resto → /competicion/.
  let cleanPath = null;
  if (isOneDay && oneDayRd) {
    cleanPath = jornadaUrl(oneDayRd);       // slug-aware (respeta idioma)
  } else if (race.slug) {
    cleanPath = `/competicion/${encodeURIComponent(race.slug)}/`;
  }
  const canonicalUrl = cleanPath
    ? (cleanPath.startsWith('http') ? cleanPath : `${CONFIG.webOrigin}${cleanPath}`)
    : window.location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = canonicalUrl;
  ['es', 'x-default'].forEach(lang => {
    let el = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (!el) { el = document.createElement('link'); el.rel = 'alternate'; el.hreflang = lang; document.head.appendChild(el); }
    el.href = canonicalUrl;
  });
  if (getLang() !== 'en' && race.slugEn) {
    const enUrl = `${CONFIG.webOrigin}/en/race/${encodeURIComponent(race.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (getLang() === 'en' && race.slug) {
    // Un día → alternate ES a la jornada (espejo del canonical ES).
    const esUrl = (isOneDay && oneDayRd && oneDayRd.slug)
      ? `${CONFIG.webOrigin}/jornada/${encodeURIComponent(oneDayRd.slug)}/`
      : `${CONFIG.webOrigin}/competicion/${encodeURIComponent(race.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // ── JSON-LD SportsEvent ──
  const origin = CONFIG.webOrigin;
  const eventDays = sorted.filter(d => !d.isRestDay);
  const firstEventDay = eventDays.find(d => d.dateKey && (rdLocation(d, 'startLocation') || rdLocation(d, 'finishLocation')));
  const lastEventDay = [...eventDays].reverse().find(d => d.dateKey);
  const eventLocation = firstEventDay
    ? (rdLocation(firstEventDay, 'startLocation') || rdLocation(firstEventDay, 'finishLocation'))
    : '';
  const eventCountry = String(firstEventDay?.countryCode || race.countryCode || '').toUpperCase() || null;
  const eventStatus = race.isCancelled
    ? 'https://schema.org/EventCancelled'
    : 'https://schema.org/EventScheduled';
  const jsonLd = name && firstEventDay?.dateKey && eventLocation && eventCountry ? {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    'name': title.replace(` — ${t('seo.siteName')}`, ''),
    'url': canonicalUrl,
    'description': description,
    'sport': 'Ciclismo en ruta',
    'eventStatus': eventStatus,
    'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
    'image': ogImage,
    'organizer': {
      '@type': 'Organization',
      'name': t('seo.siteName'),
      'url': origin
    }
  } : null;
  if (jsonLd) {
    jsonLd.startDate = firstEventDay.dateKey;
    jsonLd.endDate = lastEventDay?.dateKey || firstEventDay.dateKey;
    jsonLd.location = { '@type': 'Place', 'name': eventLocation };
    jsonLd.location.address = {
      '@type': 'PostalAddress',
      'addressCountry': eventCountry,
    };
  }
  setJsonLdC('jsonld-main', jsonLd);

  // ── JSON-LD BreadcrumbList ──
  setJsonLdC('jsonld-breadcrumbs', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Inicio', 'item': `${origin}/` },
      { '@type': 'ListItem', 'position': 2, 'name': `Temporada ${year}`, 'item': `${origin}/calendario.html?year=${year}` },
      { '@type': 'ListItem', 'position': 3, 'name': `${name} ${year}` },
    ],
  });
}

function setJsonLdC(id, obj) {
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

function errorHTML(msg) {
  return `<div class="empty-state" style="padding:4rem 1.5rem">
    <div class="empty-state__icon">⚠️</div>
    <div class="empty-state__title">${msg}</div></div>`;
}

// ── Carga un challenge group por slug ────────────────────────────
async function loadChallenge(slug, content, params) {
  const navState = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const backBtn  = document.querySelector('.back-btn');
  if (backBtn) {
    const fromVal = params.get('from') || navState.from;
    if (fromVal === 'temporada') {
      const year = params.get('year') || navState.year || '';
      const cat  = params.get('cat')  || navState.cat  || '';
      const qs   = new URLSearchParams();
      if (year) qs.set('year', year);
      if (cat) qs.set('cat', cat);
      qs.set('vista', 'temporada');
      const _isEnBackCg = getLang() === 'en';
      backBtn.href = _isEnBackCg
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario.html?' + qs;
    } else if (fromVal === 'mes') {
      // Leer mes desde URL (?month=YYYY-MM) o desde sessionStorage
      const monthParam = params.get('month');
      let month, year;
      if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        const [y, m] = monthParam.split('-').map(Number);
        year  = y;
        month = m - 1; // 0-indexed para consistencia con sessionStorage
      } else {
        month = navState.month ?? new Date().getMonth();
        year  = navState.year  ?? new Date().getFullYear();
      }
      const qs = new URLSearchParams({ vista: 'mes', mes: String(year) + '-' + String(month + 1).padStart(2, '0') });
      const _isEnBackCgM = getLang() === 'en';
      backBtn.href = _isEnBackCgM
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario.html?' + qs;
    } else if (fromVal === 'dia') {
      const date = params.get('date') || navState.date || '';
      backBtn.href = CONFIG.basePath + '/index.html' + (date ? '?date=' + date : '');
    }
  }

  try {
    // Buscar el challenge group por slug
    const { data: cgData } = await supabase.from('challenge_groups').select('*').eq('slug', decodeURIComponent(slug)).limit(1);
    if (!cgData || !cgData.length) { content.innerHTML = errorHTML('Challenge no encontrado'); return; }

    const cg = cgData[0];
    const color = cg.colorHex || 'var(--accent)';
    const flag  = countryFlag(cg.countryCode);
    const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);
    const isFemale = cg.gender === 'female' && !nameImpliesFemale(cg.name || '');

    document.title = `${cg.name} — ${t('seo.siteName')}`;

    // Cargar todas las race_days de las carreras del challenge
    const raceIds = Array.isArray(cg.raceIds) ? cg.raceIds : [];
    let allDays = [];

    const inhousePromise = loadInhouseStageSet(raceIds);
    await Promise.all(raceIds.map(async raceId => {
      const { data: daysData } = await supabase.from('race_days').select('*').eq('raceId', raceId).eq('editorialStatus', 'published');
      const days = daysData || [];

      const dayIds = days.map(d => d.id);
      const [bRes, aRes, raceRes] = await Promise.all([
        dayIds.length ? supabase.from('broadcasts').select('*').in('raceDayId', dayIds) : Promise.resolve({ data: [] }),
        dayIds.length ? supabase.from('assets').select('*').in('raceDayId', dayIds) : Promise.resolve({ data: [] }),
        supabase.from('races').select('*').eq('id', raceId).single(),
      ]);
      const bByRd = {}, aByRd = {};
      (bRes.data || []).forEach(b => { (bByRd[b.raceDayId] = bByRd[b.raceDayId] || []).push(b); });
      (aRes.data || []).forEach(a => { (aByRd[a.raceDayId] = aByRd[a.raceDayId] || []).push(a); });
      const raceData = raceRes.data || {};
      const raceName = getRaceName(raceData) || '';
      const raceIsNoClickable = raceData.isNoClickable || false;
      days.forEach(rd => {
        const _allB = bByRd[rd.id] || [];
        rd._broadcasts = filterBroadcastsByRegion(_allB);
        rd._tvBlocked = _allB.length > 0 && rd._broadcasts.length === 0;
        rd._assets = aByRd[rd.id] || [];
        rd._raceName = raceName;
        rd._raceIsNoClickable = raceIsNoClickable;
        rd._fcId = raceData.fcId || null;
        rd._pcsSlug = raceData.pcsSlug || null;
        rd._raceGender = raceData.gender || null;
        rd._raceCountryCode = raceData.countryCode || null;
        rd._raceHideFlag = raceData.hideFlag || false;
        rd._raceSlug = raceData.slug || null;        // para la URL in-house de resultados
        rd._raceSlugEn = raceData.slugEn || null;
        rd._colorHex = raceData.colorHex || null;
      });

      allDays.push(...days);
    }));

    // Ordenar por fecha
    allDays.sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
    annotateDoubleSectors(allDays);
    const inhouseSetCh = await inhousePromise;
    allDays.forEach(rd => { rd._hasInhouse = inhouseSetCh.has(rd); });

    // Hero
    let html = `<div class="jornada-hero" style="--card-color:${color}">
      <div style="display:flex;align-items:center;gap:1.25rem">`;
    if (cg.logoUrl) {
      html += `<div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem;flex-shrink:0">
        <img class="jornada-hero__logo" src="${cg.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
        ${cg.hideFlag ? '' : `<span style="font-size:1.5rem">${flag}</span>`}
      </div>`;
    } else if (!cg.hideFlag) {
      html += `<span style="font-size:2rem">${flag}</span>`;
    }
    html += `<div>
        <div class="jornada-hero__name">${cg.name}${isFemale ? femaleMark({ style: 'font-size:0.8em;opacity:0.7;font-weight:400' }) : ''}</div>
        <div class="jornada-hero__stage">${[cg.uciCategory, cg.year].filter(Boolean).join(' · ')} · ${t(allDays.length !== 1 ? 'stage.racesCount_other' : 'stage.racesCount_one').replace('{n}', allDays.length)}</div>
      </div></div></div>`;

    html += `<div style="max-width:860px;padding:1rem 1.5rem 3rem">`;

    if (!allDays.length) {
      html += `<div class="empty-state" style="padding:3rem 0">
        <div class="empty-state__text">${t('stage.noRaces')}</div></div>`;
    } else {
      allDays.forEach(rd => {
        const stage  = stageLabel(rd.stageNumber, rd._stageSuffix);
        const date   = formatDateShort(rd.dateKey);
        const route  = rd.startLocation ? (!rd.finishLocation || rd.startLocation === rd.finishLocation ? rdLocation(rd, 'startLocation') : `${rdLocation(rd, 'startLocation')} › ${rdLocation(rd, 'finishLocation')}`) : '';
        const _isEnC2 = getLang() === 'en';
        const km     = rd.distanceKm ? `${_isEnC2 ? String(rd.distanceKm) : String(rd.distanceKm).replace('.', ',')} km` : '';
        const _elevGainC2 = rd.elevationProfile?.elevationGain;
        const elev   = _elevGainC2 != null ? `+${String(Math.round(_elevGainC2 / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEnC2 ? ',' : '.')} m` : '';
        const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
        const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
        const start  = startTU?.display  ?? null;
        const finish = finishTU?.display ?? null;
        const timeTip = (startTU?.tooltip || finishTU?.tooltip)
          ? 'Hora Madrid · ' + [startTU?.tooltip, finishTU?.tooltip].filter(Boolean).join(' – ')
          : null;
        const cardName = stage || rd._raceName || '';
        const typeBadges = rd.primaryType ? resolveTypeBadges(rd.primaryType, rd.secondaryType) : '';
        const routePart = route ? `<span class="race-card__route">${route}</span>` : '';
        const kmPart    = km    ? `<span class="race-card__km">${km}</span>` : '';
        const elevPart  = elev  ? `<span class="race-card__elev">${elev}</span>` : '';
        const routeWrap = routePart ? `<span class="race-card__route-wrap">${routePart}</span>` : '';
        const sepRouteKm = (routePart && kmPart) ? `<span class="race-card__sep">·</span>` : '';
        const sepKmElev  = (kmPart && elevPart) ? `<span class="race-card__sep">·</span>` : '';

        const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
          && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
        const rdHasAssets = rdViewableProfile || (rd._assets
          ? rd._assets.some(a => (a.url || a.filePath) && ['startOrder','roadbook','profile','map','ports'].includes(a.type))
          : (rd.hasAssets === true));
        const rdClickable = !rd._raceIsNoClickable && rdHasAssets;
        // La jornada cancelada SÍ abre su modal (ver comentario en el bloque de
        // etapas): conserva recorrido, distancia, tipo y descripción.
        const rdHasModal2 = !rdClickable && hasModalData(rd);
        const showResultsC2 = rd._hasInhouse === true || _shouldShowResultsC(rd, rd._fcId, rd._pcsSlug);

        // Elevation sparkline
        const _isTimeTrial2 = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
        const rdEpColor2 = rd._colorHex || 'var(--accent)';
        let epSvgHtml2 = null;
        if (rd.elevationProfile && !rd.isCancelledDay) {
          if (showResultsC2) {
            epSvgHtml2 = buildElevationSparkline(rd.elevationProfile, 1, rd.id, rdEpColor2, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
          } else if (rd.neutralStartTimeUtc && rd.estimatedFinishTimeUtc) {
            const now2 = Date.now();
            const startMs2 = new Date(rd.neutralStartTimeUtc).getTime();
            const endMs2   = new Date(rd.estimatedFinishTimeUtc).getTime();
            const cutMs2   = (rd._fcId || rd._pcsSlug) ? endMs2 + 30 * 60 * 1000 : endMs2;
            if (endMs2 > startMs2 && now2 >= startMs2 && now2 < cutMs2) {
              const pct2 = _isTimeTrial2 ? 0 : Math.min(100, Math.round((now2 - startMs2) / (endMs2 - startMs2) * 100));
              epSvgHtml2 = buildElevationSparkline(rd.elevationProfile, pct2 / 100, rd.id, rdEpColor2, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
            }
          }
          if (!epSvgHtml2) {
            const showStatic2 = rd.neutralStartTimeUtc
              ? Date.now() < new Date(rd.neutralStartTimeUtc).getTime()
              : !_raceTimeCheckC(rd, 30);
            if (showStatic2) {
              epSvgHtml2 = buildElevationSparkline(rd.elevationProfile, 0, rd.id, rdEpColor2, rd.profileSummits ?? [], rd.profileWaypoints ?? []);
            }
          }
        }

        const _startOrderAsset2 = rd._assets ? rd._assets.find(a => a.url && a.type === 'startOrder') : null;
        const _showStartOrder2 = !!_startOrderAsset2 && _isTimeTrial2 && !rd.isCancelledDay;
        const _startOrderBadgeHtml2 = _showStartOrder2 ? `<a class="badge badge--startorder" href="${startOrderUrl(rd)}" onclick="event.stopPropagation()">${_timerSvgC} ${t('assets.startOrder')}</a>` : '';
        const todayStr2 = new Date().toISOString().slice(0, 10);
        const phMsg2 = (!rdClickable && !rdHasModal2) ? (rd.isCancelledDay ? t('stage.stageCancelledTooltip') : (rd.dateKey && todayStr2 < rd.dateKey) ? t('stage.noExtraInfoSoon') : t('stage.noExtraInfo')) : '';
        // Fila unificada de badges bajo el nombre (paridad iOS):
        // Cancelada → Tipo → TV → Orden salida. El horario va apilado a la derecha.
        // Cancelada → sin badge de tipo (paridad con Hoy y con las apps).
        const _showTypeBadge2 = !rd.isCancelledDay && (!epSvgHtml2 || _isTimeTrial2) && !!typeBadges;
        // Cancelada → sin TV ni Live Texto: no se emitió (paridad con Hoy y apps).
        const _tvBadgeHtml2 = (showResultsC2 || rd.isCancelledDay) ? '' : tvBadge(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd.id, rd._tvBlocked);
        const _badgeRow2 = `<div class="race-card__badges">`
          + (rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.stageCancelledBadge')}</span>` : '')
          + (_showTypeBadge2 ? `<span class="race-card__types--inline">${typeBadges}</span>` : '')
          + _tvBadgeHtml2
          + _startOrderBadgeHtml2
          + `</div>`;
        html += `<div class="race-card race-card--stage${epSvgHtml2 ? ' race-card--elevation' : ''}${rdHasModal2 ? ' race-card--has-modal' : ''}${showResultsC2 ? ' race-card--finished' : ''}" style="--card-color:${epSvgHtml2 ? rdEpColor2 : 'transparent'};margin-bottom:0.5rem;${rdClickable || rdHasModal2 ? 'cursor:pointer' : 'cursor:default'}"
          ${rdClickable ? `onclick="location.href='${jornadaUrl(rd)}'"` : rdHasModal2 ? `data-rdid="${rd.id}"` : `data-ph-tooltip="${phMsg2}" data-ph-flag="${esc(flag)}" data-ph-name="${esc(rd._raceName || '')}" data-ph-sub="${esc(cardName ? cardName + ' · ' + date : date)}"`}>
          <div class="race-card__main">
            <div class="race-card__name" style="font-size:0.9rem">${cardName ? `${cardName}<span class="race-card__sep">·</span>${date}` : date}</div>
            <div class="race-card__sub">
              ${routeWrap}${sepRouteKm}${kmPart}${sepKmElev}${elevPart}
            </div>
            ${_badgeRow2}
          </div>
          <div class="race-card__meta">
            <div class="race-card__meta-top">
              ${showResultsC2
                ? _resultsBadgesC(rd, rdClickable)
                : rd.isCancelledDay ? '' : buildTimeStack(start, finish, timeTip)}
            </div>
          </div>
          ${epSvgHtml2 || ''}
        </div>`;
      });
    }

    html += '</div>';
    content.innerHTML = html;

    const rdMap2 = {};
    allDays.forEach(d => { rdMap2[d.id] = d; });
    // Cada fila lleva su propia carrera → raceObj derivado del rd (incl. slug
    // para la URL in-house de resultados).
    const _raceObjOf = (rd2) => ({
      name: rd2._raceName || '', gender: rd2._raceGender,
      countryCode: rd2._raceCountryCode, hideFlag: rd2._raceHideFlag,
      slug: rd2._raceSlug, slugEn: rd2._raceSlugEn,
    });
    _wireResultsBadges(content, rdMap2, _raceObjOf);
    content.addEventListener('click', e => {
      const embedBadge2 = e.target.closest('[data-tv-embed][data-tv-rd-id]');
      if (embedBadge2) {
        e.stopPropagation();
        e.preventDefault();
        const rd2 = rdMap2[embedBadge2.dataset.tvRdId];
        if (rd2) openBroadcastTvModal(rd2, _raceObjOf(rd2), embedBadge2.href);
        return;
      }
      const ytBadge2 = e.target.closest('[data-yt-id][data-yt-rd-id]');
      if (ytBadge2) {
        e.stopPropagation();
        e.preventDefault();
        const rd2 = rdMap2[ytBadge2.dataset.ytRdId];
        if (rd2) openYoutubeTvModal(rd2, _raceObjOf(rd2), ytBadge2.dataset.ytId);
        return;
      }
      const el = e.target.closest('[data-rdid]');
      if (!el) return;
      const rd2 = rdMap2[el.dataset.rdid];
      const raceObj2 = rd2 ? { name: rd2._raceName || '', gender: rd2._raceGender, countryCode: rd2._raceCountryCode, hideFlag: rd2._raceHideFlag } : { name: '' };
      openRaceDataModal(el.dataset.rdid, raceObj2);
    });

  } catch (err) {
    content.innerHTML = errorHTML(t('race.errorChallenge'));
    console.error(err);
  }
}

// window.openAssetModal / window.closeAssetModal / window.openDynPerfilModal
// viven ahora en ./race-assets.js (instalados al importarlo arriba).

// ── Tooltip zona horaria en badge--time ──────────────────────────
(function() {
  const container = document.getElementById('competicionContent');
  if (!container) return;
  let tip = null;
  function getTip() {
    if (!tip) { tip = document.createElement('div'); tip.id = 'tz-tip-comp'; document.body.appendChild(tip); }
    return tip;
  }
  container.addEventListener('mouseover', e => {
    if (window.innerWidth < 600) return;
    const badge = e.target.closest('.badge--time-user');
    if (!badge) return;
    const t = getTip();
    t.textContent = badge.dataset.tztip;
    t.style.cssText = 'position:fixed;background:var(--tooltip-bg,#222);color:var(--tooltip-color,#fff);padding:4px 8px;border-radius:4px;font-size:.75rem;pointer-events:none;z-index:9999;white-space:nowrap;display:block';
  });
  container.addEventListener('mousemove', e => {
    if (!tip || tip.style.display === 'none') return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY + 14) + 'px';
  });
  container.addEventListener('mouseout', e => {
    const badge = e.target.closest('.badge--time-user');
    if (badge && !badge.contains(e.relatedTarget)) {
      if (tip) tip.style.display = 'none';
    }
  });
})();

initPhTooltip();

init();
