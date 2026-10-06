import { todayRaceState, waitingResultsHtml as renderWaitingResults } from './services/race-presentation.js';
import { arrowHtml } from './scroll-rail.js';
// ─────────────────────────────────────────────────────────────────
//  COMPETICIÓN — competicion.html?id=RACE_ID
// ─────────────────────────────────────────────────────────────────

import { supabase, stageLabel, countryFlag, formatTimeUser,
         resolveTypeBadges, setMeta, setMetaProperty, initPhTooltip,
         jornadaUrl, raceName as getRaceName, rdLocation, filterBroadcastsByRegion, enBase,
         startOrderUrl, seoLongDate, seoDayMonth, buildRaceHeader,
         articuloNombre, femaleMark, needsFemaleMark, setRaceRobots, setHreflangPair }
         from './shared.js';
import { t, getLang, getLocale, initI18n } from './i18n.js';
import { writeCalendarParams } from './calendario-query.js';
import { annotateDoubleSectors } from './services/races.js';
import { hasModalData, openRaceDataModal, openResultsModal, openBroadcastTvModal, openYoutubeTvModal, loadInhouseStageSet } from './race-data-modal.js';
import { createRaceCard, raceCardHtml } from './components/race-card.js';
import { noExtraInfoMessage, stageRouteText, formatStageMetrics, stageSubHtml, stageIsClickable,
         startOrderBadgeHtml, scheduleHtml, appendProfile, appendResultsActions, activateStageCard } from './components/stage-card.js';
import { agendaMetaState } from './services/today-agenda-layout.js';
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
// Tarjeta de jornada: estructura común de components/race-card.js sin logo
// (la cabecera ya identifica la carrera). El nombre es «Etapa · fecha»; en un
// challenge, la etapa o la carrera de cada jornada.
function buildCompetitionCard(rd, { race, title, flag, tooltipName }) {
  const date = formatDateShort(rd.dateKey);
  const name = `<span>${title ? `${title} <span class="race-card__sep">·</span> ${date}` : date}</span>`;

  if (rd.isRestDay) {
    const card = createRaceCard(race.colorHex, 'race-card--rest-day');
    const city = rd.startLocation ? `<span class="race-card__sep">·</span><span class="race-card__route">${rdLocation(rd, 'startLocation')}</span>` : '';
    card.innerHTML = raceCardHtml({ name: `<span>${date}</span>`, sub: `<span class="race-card__stage">${t('stage.restDay')}</span>${city}` });
    return card;
  }

  const { km, elev } = formatStageMetrics(rd);
  const startTU = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  const state = todayRaceState(rd);
  const showResults = state === 'results';
  const waiting = state === 'waiting';
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  const metaState = agendaMetaState(state, { start: startTU?.display, finish: finishTU?.display, lang: getLang(), isTimeTrial });
  // Fila de badges bajo el nombre (paridad iOS): Cancelada → Tipo → TV →
  // Orden de salida. Una jornada cancelada no tiene tipo ni emisión.
  const tvHtml = (showResults || waiting || rd.isCancelledDay) ? ''
    : tvBadge(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd.id, rd._tvBlocked);
  const startOrderHtml = isTimeTrial && rd._assets?.some(a => a.url && a.type === 'startOrder') && !rd.isCancelledDay && !showResults && !waiting
    ? startOrderBadgeHtml(startOrderUrl(rd)) : '';

  const card = createRaceCard(race.colorHex);
  card.dataset.dayId = rd.id;
  card.innerHTML = raceCardHtml({
    name,
    sub: stageSubHtml({ route: stageRouteText(rd, rdLocation), km, elev }),
    badges: `${rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.stageCancelledBadge')}</span>` : ''}${tvHtml}${startOrderHtml}`,
    meta: showResults || rd.isCancelledDay ? '' : scheduleHtml(metaState, startTU, finishTU),
  });
  // Sin miniperfil, el tipo de etapa comunica el terreno; con él, solo CRI/CRE.
  const hasProfile = appendProfile(card, rd);
  if (!rd.isCancelledDay && rd.primaryType && (!hasProfile || isTimeTrial)) {
    card.querySelector('.race-card__badges').insertAdjacentHTML('afterbegin',
      `<span class="race-card__types--inline">${resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode)}</span>`);
  }
  if (showResults) {
    appendResultsActions(card, rd, {
      onResults: () => openResultsModal(rd, race),
      onYoutube: ytId => openYoutubeTvModal(rd, race, ytId),
    });
  }
  // La jornada cancelada SÍ abre su modal: conserva recorrido, distancia,
  // tipo y descripción de la etapa que estaba trazada.
  const tooltipSub = title ? `${title} · ${date}` : date;
  activateStageCard(card, rd, {
    clickable: stageIsClickable(rd, race.isNoClickable),
    label: [tooltipName, title, date].filter(Boolean).join(' · '),
    seoText: [tooltipName, title].filter(Boolean).join(' · '),
    onModal: hasModalData(rd) ? () => openRaceDataModal(rd, race) : null,
    tooltip: {
      message: rd.isCancelledDay ? t('stage.stageCancelledTooltip') : noExtraInfoMessage(rd.dateKey),
      name: tooltipName, flag, sub: tooltipSub,
    },
  });
  return card;
}

// Las tarjetas se construyen como DOM (con sus listeners) y se insertan en el
// hueco que deja el HTML de la página.
function mountCompetitionCards(content, cards) {
  content.querySelector('[data-stage-list]')?.append(...cards);
}

// Una jornada que pasa a «Esperando resultados» sin recargar la página pierde
// el horario y la emisión.
function watchCompetitionWaiting(content, days) {
  content._waitingCleanup?.();
  const byId = new Map(days.map(day => [day.id,day]));
  const update = () => {
    if (document.hidden) return;
    content.querySelectorAll('[data-day-id]').forEach(card => {
      const day = byId.get(card.dataset.dayId), meta = card.querySelector('.race-card__meta-top');
      if (day && todayRaceState(day)==='waiting' && meta && !meta.querySelector('.badge--results,.race-card__schedule--waiting')) {
        meta.innerHTML=renderWaitingResults(getLang());
        card.querySelectorAll('.race-card__badges :is(.badge--tv,.badge--livetext,.badge--notv,.badge--notv-es,.badge--pend,.badge--startorder)').forEach(node => node.remove());
      }
    });
  };
  const timer=setInterval(update,60000);
  document.addEventListener('visibilitychange',update);
  const cleanup=()=> { clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('pagehide',cleanup); };
  content._waitingCleanup=cleanup;
  window.addEventListener('pagehide',cleanup,{once:true});
}

// El badge de TV de race-assets.js abre el reproductor integrado por delegación.
function wireTvEmbeds(content, rdMap, raceFor) {
  content.addEventListener('click', e => {
    const embedBadge = e.target.closest('[data-tv-embed][data-tv-rd-id]');
    if (!embedBadge) return;
    e.stopPropagation();
    e.preventDefault();
    const rd = rdMap[embedBadge.dataset.tvRdId];
    if (rd) openBroadcastTvModal(rd, raceFor(rd), embedBadge.href);
  });
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
      writeCalendarParams(qs, getLang(), { view: 'temporada' });
      const _isEnBack = getLang() === 'en';
      backBtn.href = _isEnBack
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario/?' + qs;
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
      const qs = writeCalendarParams(new URLSearchParams(), getLang(), { view: 'mes', month: String(year) + '-' + String(month + 1).padStart(2, '0') });
      const _isEnBackM = getLang() === 'en';
      backBtn.href = _isEnBackM
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario/?' + qs;
    } else if (fromVal === 'dia') {
      const date = params.get('date') || navState.date || '';
      backBtn.href = CONFIG.basePath + '/' + (date ? '?date=' + date : '');
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
    html += `<div style="padding:1rem 0 3rem">`;

    // Web oficial + Libro de Ruta + Inscritos. La guía se guarda una vez en
    // assets de cualquier etapa y se resuelve aquí a nivel de competición.
    const hasStartlistC = !!race.startlistImportedAt;
    let websiteBtnHtmlC = '';
    if (race.websiteUrl) {
      websiteBtnHtmlC = `<a class="asset-btn" href="${race.websiteUrl}" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span class="asset-btn__label">${t('stage.websiteLabel')}</span></a>`;
    }
    const technicalGuideC = days.flatMap(day => day._assets || [])
      .find(asset => asset.type === 'technicalGuide' && (asset.url || asset.filePath));
    let technicalGuideBtnHtmlC = '';
    if (technicalGuideC) {
      const guideUrl = technicalGuideC.url || technicalGuideC.filePath;
      const safeGuideUrl = guideUrl.replace(/'/g, "\\'");
      const guideLabel = t('assets.technicalGuide');
      const safeGuideLabel = guideLabel.replace(/'/g, "\\'");
      technicalGuideBtnHtmlC = `<button class="asset-btn" type="button" onclick="openAssetModal('${safeGuideUrl}','${safeGuideLabel}')"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg><span class="asset-btn__label">${guideLabel}</span></button>`;
    }
    let startlistBtnHtmlC = '';
    if (hasStartlistC) {
      const inscritosHrefC = race.slug
        ? `${CONFIG.basePath}/inscritos/${encodeURIComponent(race.slug)}/`
        : `${CONFIG.basePath}/inscritos.html?race=${race.id}`;
      const startlistLabelC = race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'));
      startlistBtnHtmlC = `<a class="asset-btn" href="${inscritosHrefC}"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg><span class="asset-btn__label">${startlistLabelC}</span></a>`;
    }
    if (websiteBtnHtmlC || technicalGuideBtnHtmlC || startlistBtnHtmlC) {
      html += `<div class="asset-links-wrap" style="margin-bottom:0.85rem"><div class="asset-links" data-scroll-rail>${websiteBtnHtmlC}${technicalGuideBtnHtmlC}${startlistBtnHtmlC}</div>${arrowHtml('prev',getLang()==='en'?'Previous actions':'Acciones anteriores','hidden')}${arrowHtml('next',getLang()==='en'?'More actions':'Más acciones','hidden')}</div>`;
      html += `<hr style="border:none;border-top:1px solid var(--border);margin:0 0 0.85rem">`;
    }

    if (days.length === 0) {
      html += `<div class="empty-state" style="padding:3rem 0">
        <div class="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div>
        <div class="empty-state__text">${t('stage.noStages')}</div></div>`;
    } else {
      html += `<div data-stage-list style="display:grid;gap:0.5rem"></div>`;
    }
    html += `</div>`;
    const rdMap = {};
    days.forEach(d => { rdMap[d.id] = d; });

    content.innerHTML = html;
    const cardOptions = { race, flag, tooltipName: getRaceName(race) };
    mountCompetitionCards(content, days.map(rd => buildCompetitionCard(rd, { ...cardOptions, title: stageLabel(rd.stageNumber, rd._stageSuffix) })));
    watchCompetitionWaiting(content, days);
    wireTvEmbeds(content, rdMap, () => race);

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

  const isEn  = getLang() === 'en';
  const name  = (isEn && race.nameEn) || race.name || '';
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
  // EN: paridad con race_description_en de tools/site/gen_og_pages.py.
  const enStart = first ? (multiMonth ? seoDayMonth(first.dateKey, 'en') : String(Number(first.dateKey.slice(8, 10)))) : '';
  const enEnd   = last ? seoLongDate(last.dateKey, 'en') : '';
  const description = isEn
    ? (isOneDay && enEnd
        ? `${name} ${year} takes place on ${enEnd}. See the route and how to watch on TV and online streaming.`
        : first && last
          ? `${name} ${year} runs from ${enStart} to ${enEnd}. See the route, stages and how to watch on TV and online streaming.`
          : `Route, stages and how to watch ${name} ${year} on TV and online streaming.`)
    : isOneDay
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
  setRaceRobots(race);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = canonicalUrl;
  // Alternativas ES/EN. Un día → la pareja de la jornada (espejo del canonical).
  const oneDayPair = isOneDay && oneDayRd && oneDayRd.slug;
  const esAlt = oneDayPair
    ? `${CONFIG.webOrigin}/jornada/${encodeURIComponent(oneDayRd.slug)}/`
    : race.slug ? `${CONFIG.webOrigin}/competicion/${encodeURIComponent(race.slug)}/` : canonicalUrl;
  const enSlug = oneDayPair ? oneDayRd.slugEn : race.slugEn;
  const enAlt = enSlug
    ? `${CONFIG.webOrigin}/en/${oneDayPair ? 'stage' : 'race'}/${encodeURIComponent(enSlug)}/`
    : (getLang() === 'en' ? canonicalUrl : null);
  setHreflangPair(esAlt, enAlt);

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
      { '@type': 'ListItem', 'position': 2, 'name': `Temporada ${year}`, 'item': `${origin}/calendario/?year=${year}` },
      { '@type': 'ListItem', 'position': 3, 'name': `${name} ${year}` },
    ],
  });
}

function setJsonLdC(id, obj) {
  // EN: conservar el JSON-LD inglés del HTML estático (este constructor es solo ES).
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
      writeCalendarParams(qs, getLang(), { view: 'temporada' });
      const _isEnBackCg = getLang() === 'en';
      backBtn.href = _isEnBackCg
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario/?' + qs;
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
      const qs = writeCalendarParams(new URLSearchParams(), getLang(), { view: 'mes', month: String(year) + '-' + String(month + 1).padStart(2, '0') });
      const _isEnBackCgM = getLang() === 'en';
      backBtn.href = _isEnBackCgM
        ? `${enBase()}/calendar/?${qs}`
        : CONFIG.basePath + '/calendario/?' + qs;
    } else if (fromVal === 'dia') {
      const date = params.get('date') || navState.date || '';
      backBtn.href = CONFIG.basePath + '/' + (date ? '?date=' + date : '');
    }
  }

  try {
    // Buscar el challenge group por slug
    const { data: cgData } = await supabase.from('challenge_groups').select('*').eq('slug', decodeURIComponent(slug)).limit(1);
    if (!cgData || !cgData.length) { content.innerHTML = errorHTML('Challenge no encontrado'); return; }

    const cg = cgData[0];
    const color = cg.colorHex || 'var(--accent)';
    const flag  = countryFlag(cg.countryCode);
    const isFemale = needsFemaleMark(cg);

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

    html += `<div style="padding:1rem 0 3rem">`;

    if (!allDays.length) {
      html += `<div class="empty-state" style="padding:3rem 0">
        <div class="empty-state__text">${t('stage.noRaces')}</div></div>`;
    } else {
      html += `<div data-stage-list style="display:grid;gap:0.5rem"></div>`;
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
      colorHex: rd2._colorHex, isNoClickable: rd2._raceIsNoClickable,
    });
    mountCompetitionCards(content, allDays.map(rd => buildCompetitionCard(rd, {
      race: _raceObjOf(rd), flag, tooltipName: rd._raceName || '',
      title: stageLabel(rd.stageNumber, rd._stageSuffix) || rd._raceName || '',
    })));
    watchCompetitionWaiting(content, allDays);
    wireTvEmbeds(content, rdMap2, _raceObjOf);

  } catch (err) {
    content.innerHTML = errorHTML(t('race.errorChallenge'));
    console.error(err);
  }
}

// window.openAssetModal / window.closeAssetModal / window.openDynPerfilModal
// viven ahora en ./race-assets.js (instalados al importarlo arriba).

initPhTooltip();

init();
