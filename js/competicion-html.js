// ─────────────────────────────────────────────────────────────────
//  COMPETICIÓN — HTML de la página y de sus tarjetas de jornada, sin DOM
//  Lo usan js/competicion.js (competición y challenge) y el paso de build que
//  escribe /competicion/<slug>/ y /en/race/<slugEn>/
//  (tools/site/prerender-competicion.mjs).
//
//  Lo que en la tarjeta depende del momento, de la zona o de la región
//  (insignias de tipo, cancelación, TV y orden de salida; horario, espera o
//  resultados; aviso sin información) se escribe con `dynamic: true`; con
//  `dynamic: false` queda vacío y paintCompetitionCard() lo pone en su sitio.
//  La huella de la página (js/html-fingerprint.js) es la de esa versión, que no
//  depende de la hora, la zona ni la región. El miniperfil (~10 KB por
//  tarjeta) no va en el HTML: su banda tiene el alto reservado y la llena
//  paintCompetitionCard().
// ─────────────────────────────────────────────────────────────────

import { todayRaceState, resultsTrophyHtml, tvIconHtml } from './services/race-presentation.js';
import { arrowHtml } from './scroll-rail.js';
import { formatTimeUser, resolveTypeBadges, jornadaUrl, rdLocation, startOrderUrl, buildRaceHeader, extractYouTubeId,
         esc, seoShortDate, seoShortMonth } from './shared.js';
import { t, getLang } from './i18n.js';
import { raceCardHtml, safeCardColor } from './components/race-card.js';
import { noExtraInfoMessage, stageRouteText, formatStageMetrics, stageSubHtml, stageIsClickable,
         startOrderBadgeHtml, scheduleHtml } from './components/stage-card.js';
import { agendaMetaState } from './services/today-agenda-layout.js';
import { isReviveBroadcast } from './broadcast-priority.js';
import { buildElevationSparkline } from './stage/elevation-profile.js';
import { hasModalData } from './race-data-modal.js';
import { tvBadge } from './race-assets.js';

const lang2 = () => (getLang() === 'en' ? 'en' : 'es');

// Fecha de la tarjeta («Mié, 7 ene» / «Wed 7 Jan»), con tablas fijas.
function formatDateShort(dk) {
  if (!dk) return '';
  const str = seoShortDate(dk, lang2());
  return str.charAt(0).toUpperCase() + str.slice(1);
}
// Rango de la cabecera: «6–27 jul», «30 ago – 21 sep».
function formatDateRange(startDk, endDk) {
  if (!startDk) return '';
  const [sy, sm, sd] = startDk.split('-').map(Number);
  const [ey, em, ed] = (endDk || startDk).split('-').map(Number);
  const mon = m => seoShortMonth(m - 1, lang2());
  if (sm === em && sy === ey) return `${sd}–${ed} ${mon(em)}`;
  return `${sd} ${mon(sm)} – ${ed} ${mon(em)}`;
}

// Miniperfil de la jornada (banda inferior), o null si no tiene. Completo con
// el color de la carrera en cualquier estado, como en las apps: el avance
// temporal se pinta en Hoy y en la jornada.
function sparkline(rd, color) {
  return rd.elevationProfile && !rd.profileNotViewable && !rd.isCancelledDay
    ? buildElevationSparkline(rd.elevationProfile, 1, rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? [])
    : null;
}

// Resultados y Revive en la columna derecha de una jornada terminada. Revive:
// redes sociales antes que el resto, después sortOrder. Los clics los atiende
// el manejador delegado de js/competicion.js (data-card-results, Revive embebible).
function resultsActionsHtml(rd) {
  const label = esc(t('stage.results'));
  let html = `<button type="button" class="badge badge--results badge--icon" title="${label}" aria-label="${label}" data-card-results>${resultsTrophyHtml}<span class="badge__label">${label}</span></button>`;
  const revive = (rd._broadcasts || [])
    .filter(isReviveBroadcast)
    .sort((a, b) => {
      const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
      const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
      return (aSoc - bSoc) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    })[0] ?? null;
  if (!revive?.url) return html;
  const ytId = revive.embeddable !== false ? extractYouTubeId(revive.url) : null;
  const reviveLabel = esc(t('tv.reviveRace'));
  html += `<a class="badge badge--tv badge--tv-link badge--revive badge--icon" href="${esc(revive.url)}" target="_blank" rel="noopener" title="${reviveLabel}" aria-label="${reviveLabel}"${ytId ? ` data-card-revive-yt="${esc(ytId)}"` : ''}>${tvIconHtml}<span class="badge__label">${reviveLabel}</span></a>`;
  return html;
}

/**
 * Piezas de la tarjeta que dependen del momento, de la zona o de la región,
 * y el miniperfil, que no va en el HTML:
 * { finished, badges, meta, profile, tooltip } (profile null sin miniperfil;
 * tooltip, el aviso de una jornada sin página ni datos).
 */
function competitionCardDynamic(rd, { race }) {
  const color = safeCardColor(race.colorHex);
  const startTU = formatTimeUser(rd.neutralStartTimeUtc, rd.dateKey);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc, rd.dateKey);
  const state = todayRaceState(rd);
  const showResults = state === 'results';
  const waiting = state === 'waiting';
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  const metaState = agendaMetaState(state, { start: startTU?.display, finish: finishTU?.display, lang: getLang(), isTimeTrial });
  // Fila de badges bajo el nombre (paridad iOS): Tipo → Cancelada → TV → Orden
  // de salida. Una jornada cancelada no tiene tipo ni emisión. Sin miniperfil,
  // el tipo de etapa comunica el terreno; con él, solo CRI/CRE.
  const profile = sparkline(rd, color);
  const types = !rd.isCancelledDay && rd.primaryType && (!profile || isTimeTrial)
    ? `<span class="race-card__types--inline">${resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode)}</span>` : '';
  const tvHtml = (showResults || waiting || rd.isCancelledDay) ? ''
    : tvBadge(rd.tvStatus, rd._broadcasts, rd.neutralStartTimeUtc, rd._assets?.find(a => a.type === 'live_text')?.url || null, rd.id, rd._tvBlocked);
  const startOrderHtml = isTimeTrial && rd._assets?.some(a => a.url && a.type === 'startOrder') && !rd.isCancelledDay && !showResults && !waiting
    ? startOrderBadgeHtml(startOrderUrl(rd)) : '';
  return {
    finished: showResults,
    badges: `${types}${rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.stageCancelledBadge')}</span>` : ''}${tvHtml}${startOrderHtml}`,
    meta: showResults ? resultsActionsHtml(rd) : rd.isCancelledDay ? '' : scheduleHtml(metaState, startTU, finishTU),
    profile,
    tooltip: rd.isCancelledDay ? t('stage.stageCancelledTooltip') : noExtraInfoMessage(rd.dateKey),
  };
}

/**
 * Tarjeta de jornada: estructura común de components/race-card.js sin logo
 * (la cabecera ya identifica la carrera). El nombre es «Etapa · fecha»; en un
 * challenge, la etapa o la carrera de cada jornada. `dynamic`: con las piezas
 * de competitionCardDynamic() (si no, vacías para paintCompetitionCard()).
 */
export function competitionCardHtml(rd, { race, title, flag, tooltipName }, { dynamic = true } = {}) {
  const date = formatDateShort(rd.dateKey);
  const name = `<span>${title ? `${title} <span class="race-card__sep">·</span> ${date}` : date}</span>`;
  const color = safeCardColor(race.colorHex);
  if (rd.isRestDay) {
    const city = rd.startLocation ? `<span class="race-card__sep">·</span><span class="race-card__route">${rdLocation(rd, 'startLocation')}</span>` : '';
    return `<div class="race-card race-card--rest-day" style="--card-color:${color}">${raceCardHtml({ name: `<span>${date}</span>`, sub: `<span class="race-card__stage">${t('stage.restDay')}</span>${city}` })}</div>`;
  }
  const { km, elev } = formatStageMetrics(rd);
  const parts = dynamic ? competitionCardDynamic(rd, { race }) : null;
  const hasProfile = !!sparkline(rd, color);
  // Activación: página de la jornada, modal de datos o aviso sin información
  // (activateStageCard de components/stage-card.js). Sin página, un enlace
  // oculto (visible al recibir el foco) conserva la URL indexable.
  const label = esc([tooltipName, title, date].filter(Boolean).join(' · '));
  const clickable = stageIsClickable(rd, race.isNoClickable);
  const modal = !clickable && hasModalData(rd);
  const tooltip = !clickable && !modal;
  const attrs = clickable ? ` role="link" tabindex="0" aria-label="${label}" data-href="${esc(jornadaUrl(rd))}"`
    : modal ? ` role="button" tabindex="0" aria-label="${label}" data-card-modal`
      : `${parts ? ` data-ph-tooltip="${esc(parts.tooltip)}"` : ''} data-ph-name="${esc(tooltipName)}" data-ph-flag="${esc(flag)}" data-ph-sub="${esc(title ? `${title} · ${date}` : date)}"`;
  const classes = `race-card${hasProfile ? ' race-card--elevation' : ''}${parts?.finished ? ' race-card--finished' : ''}`;
  const seoLink = clickable ? '' : `<a href="${esc(jornadaUrl(rd))}" class="race-card__seo-link">${esc([tooltipName, title].filter(Boolean).join(' · '))}</a>`;
  return `<div class="${classes}" style="--card-color:${color}${tooltip ? ';cursor:default' : ''}" data-day-id="${esc(rd.id)}"${attrs}>`
    + raceCardHtml({
      name,
      sub: stageSubHtml({ route: stageRouteText(rd, rdLocation), km, elev }),
      badges: parts?.badges || '',
      meta: parts?.meta || '',
    })
    + (hasProfile ? '<div class="race-card__profile"></div>' : '')
    + seoLink
    + '</div>';
}

/**
 * Pone en la tarjeta (DOM) las piezas de competitionCardDynamic(): clase de
 * terminada, badges, columna derecha, miniperfil y aviso.
 */
export function paintCompetitionCard(card, rd, options) {
  const parts = competitionCardDynamic(rd, options);
  card.classList.toggle('race-card--finished', parts.finished);
  const badges = card.querySelector('.race-card__badges'), meta = card.querySelector('.race-card__meta-top');
  const profile = card.querySelector('.race-card__profile');
  if (badges) badges.innerHTML = parts.badges;
  if (meta) meta.innerHTML = parts.meta;
  if (profile) profile.innerHTML = parts.profile || '';
  if ('phName' in card.dataset) card.dataset.phTooltip = parts.tooltip;
}

// Botones de la competición: web oficial, guía técnica (en el visor) e
// inscritos. La guía se guarda una vez en assets de cualquier etapa.
function actionsHtml(race, days) {
  const website = race.websiteUrl
    ? `<a class="asset-btn" href="${race.websiteUrl}" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span class="asset-btn__label">${t('stage.websiteLabel')}</span></a>`
    : '';
  const guide = days.flatMap(day => day._assets || []).find(asset => asset.type === 'technicalGuide' && (asset.url || asset.filePath));
  let guideHtml = '';
  if (guide) {
    const guideUrl = guide.url || guide.filePath;
    const guideLabel = t('assets.technicalGuide');
    guideHtml = `<button class="asset-btn" type="button" onclick="openAssetModal('${guideUrl.replace(/'/g, "\\'")}','${guideLabel.replace(/'/g, "\\'")}')"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg><span class="asset-btn__label">${guideLabel}</span></button>`;
  }
  let startlist = '';
  if (race.startlistImportedAt) {
    const href = race.slug ? `${CONFIG.basePath}/inscritos/${encodeURIComponent(race.slug)}/` : `${CONFIG.basePath}/inscritos.html?race=${race.id}`;
    const label = race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'));
    startlist = `<a class="asset-btn" href="${href}"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg><span class="asset-btn__label">${label}</span></a>`;
  }
  if (!website && !guideHtml && !startlist) return '';
  const en = getLang() === 'en';
  return `<div class="asset-links-wrap" style="margin-bottom:0.85rem"><div class="asset-links" data-scroll-rail>${website}${guideHtml}${startlist}</div>${arrowHtml('prev', en ? 'Previous actions' : 'Acciones anteriores', 'hidden')}${arrowHtml('next', en ? 'More actions' : 'Más acciones', 'hidden')}</div>`
    + '<hr style="border:none;border-top:1px solid var(--border);margin:0 0 0.85rem">';
}

/**
 * HTML de #competicionContent: cabecera (rango de fechas · categoría · nº de
 * etapas), botones y lista de jornadas. `days`: jornadas ordenadas, con
 * `_broadcasts`, `_tvBlocked`, `_assets` y `_hasInhouse`; `card(rd)`:
 * opciones de competitionCardHtml() de cada jornada.
 */
export function competitionPageHtml(race, days, card, { dynamic = true } = {}) {
  const isStageRace = race.raceFormat !== 'one_day';
  const raceDaysOnly = days.filter(d => !d.isRestDay && d.dateKey);
  const first = raceDaysOnly[0]?.dateKey || null, last = raceDaysOnly.at(-1)?.dateKey || null;
  const dateRange = first ? formatDateRange(first, last) : '';
  const n = raceDaysOnly.length;
  const countKey = isStageRace
    ? (n !== 1 ? 'stage.stagesCount_other' : 'stage.stagesCount_one')
    : (n !== 1 ? 'stage.racesCount_other' : 'stage.racesCount_one');
  const detail = [dateRange ? `${dateRange} ${race.year}` : race.year, race.uciCategory, t(countKey).replace('{n}', n)].filter(Boolean).join(' · ');
  let html = buildRaceHeader({ race, nameHref: '', detail });
  html += '<div style="padding:1rem 0 3rem">' + actionsHtml(race, days);
  if (!days.length) {
    html += `<div class="empty-state" style="padding:3rem 0">
        <div class="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div>
        <div class="empty-state__text">${t('stage.noStages')}</div></div>`;
  } else {
    html += `<div class="stage-list" data-stage-list>${days.map(rd => competitionCardHtml(rd, card(rd), { dynamic })).join('')}</div>`;
  }
  return html + '</div>';
}

/** Orden de las jornadas de la competición: etapa y hora de salida; sin etapa, fecha. */
export function sortCompetitionDays(days) {
  return days.sort((a, b) => {
    if ((a.stageNumber !== null && a.stageNumber !== undefined) && (b.stageNumber !== null && b.stageNumber !== undefined)) {
      if (a.stageNumber !== b.stageNumber) return a.stageNumber - b.stageNumber;
      const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
      const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
      return tA - tB;
    }
    return (a.dateKey || '').localeCompare(b.dateKey || '');
  });
}
