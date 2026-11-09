// ─────────────────────────────────────────────────────────────────
//  Tarjeta de jornada de carretera — Hoy y Competición
// ─────────────────────────────────────────────────────────────────
// Contenido común de la tarjeta de race-card.js para una jornada: cifras,
// subtítulo, horario, miniperfil y resultados.

import { esc, extractYouTubeId } from '../shared.js';
import { t, getLang } from '../i18n.js';
import { waitingResultsHtml, resultsTrophyHtml, profileProgress, profileUsesTimeHatch, tvIconHtml } from '../services/race-presentation.js';
import { isReviveBroadcast } from '../broadcast-priority.js';
import { buildElevationSparkline } from '../stage/elevation-profile.js';

const timerIconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><line x1="10" y1="2" x2="14" y2="2"/><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 13"/></svg>';

export function noExtraInfoMessage(dateKey) {
  const todayStr = new Date().toISOString().slice(0, 10);
  return t(dateKey && todayStr < dateKey ? 'stage.noExtraInfoSoon' : 'stage.noExtraInfo');
}

export function stageRouteText(rd, location) {
  if (!rd.startLocation) return '';
  return !rd.finishLocation || rd.startLocation === rd.finishLocation
    ? location(rd, 'startLocation')
    : `${location(rd, 'startLocation')} > ${location(rd, 'finishLocation')}`;
}

export function formatStageMetrics(rd, isEn = getLang() === 'en') {
  const km = rd.distanceKm ? `${isEn ? String(rd.distanceKm) : String(rd.distanceKm).replace('.', ',')}${isEn ? 'km' : ' km'}` : '';
  const gain = rd.elevationProfile?.elevationGain;
  const elev = gain != null ? `+${String(Math.round(gain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, isEn ? ',' : '.')} m` : '';
  return { km, elev };
}

// Subtítulo: etapa · ruta · km · desnivel. Km y desnivel van en
// .race-card__metrics con su separador inicial, que el CSS oculta cuando la
// ruta desaparece (Hoy en móvil) o cuando las cifras pasan a otra línea
// (destacadas).
export function stageSubHtml({ stage, route, km, elev }) {
  const sep = cls => `<span class="race-card__sep${cls ? ` ${cls}` : ''}">·</span>`;
  const stagePart = stage ? `<span class="race-card__stage">${stage}</span>` : '';
  const routeWrap = route
    ? `<span class="race-card__route-wrap">${stagePart ? sep('race-card__sep--in-route') : ''}<span class="race-card__route">${route}</span></span>`
    : '';
  const values = [km && `<span class="race-card__km">${km}</span>`, elev && `<span class="race-card__elev">${elev}</span>`]
    .filter(Boolean).join(sep());
  if (!values) return stagePart + routeWrap;
  const lead = stagePart ? sep('race-card__sep--lead')
    : routeWrap ? sep('race-card__sep--lead race-card__sep--after-route') : '';
  return `${stagePart}${routeWrap}<span class="race-card__metrics">${lead}${values}</span>`;
}

// La jornada abre su página si tiene perfil visible o documentos.
export function stageIsClickable(rd, isNoClickable) {
  const viewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
    && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
  const hasAssets = viewableProfile || (rd._assets
    ? rd._assets.some(a => (a.url || a.filePath) && ['startOrder', 'roadbook', 'profile', 'map', 'ports'].includes(a.type))
    : rd.hasAssets === true);
  return !isNoClickable && hasAssets;
}

export function startOrderBadgeHtml(href) {
  return `<a class="badge badge--startorder" href="${href}" onclick="event.stopPropagation()">${timerIconHtml} <span class="badge__text">${t('assets.startOrder')}</span></a>`;
}

// Horario de la columna derecha según agendaMetaState.
export function scheduleHtml(metaState, startTU, finishTU) {
  if (metaState.kind === 'waiting') return waitingResultsHtml(getLang());
  if (metaState.kind !== 'schedule') return '';
  const tu = metaState.time === 'finish' ? finishTU : startTU;
  const tip = tu?.tooltip;
  const finishClass = metaState.time === 'finish' ? ' race-card__schedule--finish' : '';
  const title = tip ? ` title="${getLang() === 'en' ? 'Madrid time' : 'Hora Madrid'} · ${esc(tip)}"` : '';
  // Hora en otra fecha que la jornada: el día, debajo de la hora.
  const day = tu?.day ? `<span class="race-card__schedule-day">(${esc(tu.day)})</span>` : '';
  return `<div class="race-card__schedule${finishClass}"${title}><span>${metaState.label}</span><strong>${metaState.value}</strong>${day}</div>`;
}

// Miniperfil como banda inferior. Sigue el avance de la carrera, rayado en
// contrarreloj (tiempo de la sesión); con resultados queda completo. `color`:
// el de la tarjeta.
export function elevationProfileHtml(rd, color, now = Date.now()) {
  const sparkline = rd.elevationProfile && !rd.profileNotViewable && !rd.isCancelledDay
    ? buildElevationSparkline(rd.elevationProfile, profileProgress(rd, now), rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? [],
      { timeHatch: profileUsesTimeHatch(rd) })
    : null;
  return sparkline ? `<div class="race-card__profile">${sparkline}</div>` : '';
}

// Modo terminado: sin horario, con Resultados y Revive a la derecha. `data-yt`: Revive que se
// abre en la página; los oyentes van delegados en la lista.
export function resultsActionsHtml(rd, broadcasts = rd._broadcasts || []) {
  const results = `<button type="button" class="badge badge--results badge--icon" title="${esc(t('stage.results'))}" aria-label="${esc(t('stage.results'))}">${resultsTrophyHtml}<span class="badge__label">${t('stage.results')}</span></button>`;
  // Revive: redes sociales antes que el resto, después sortOrder.
  const revive = broadcasts
    .filter(isReviveBroadcast)
    .sort((a, b) => {
      const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
      const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
      return (aSoc - bSoc) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    })[0] ?? null;
  if (!revive?.url) return results;
  const ytId = revive.embeddable !== false ? extractYouTubeId(revive.url) : null;
  return `${results}<a class="badge badge--tv badge--tv-link badge--revive badge--icon" href="${esc(revive.url)}" target="_blank" rel="noopener" title="${esc(t('tv.reviveRace'))}" aria-label="${esc(t('tv.reviveRace'))}"${ytId ? ` data-yt="${esc(ytId)}"` : ' onclick="event.stopPropagation()"'}>${tvIconHtml}<span class="badge__label">${t('tv.reviveRace')}</span></a>`;
}
