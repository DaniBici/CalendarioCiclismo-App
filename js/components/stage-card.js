// ─────────────────────────────────────────────────────────────────
//  Tarjeta de jornada de carretera — Hoy y Competición
// ─────────────────────────────────────────────────────────────────
// Contenido común de la tarjeta de race-card.js para una jornada: cifras,
// subtítulo, horario, miniperfil, resultados y activación.

import { esc, extractYouTubeId, jornadaUrl, makeCardActivatable } from '../shared.js';
import { t, getLang } from '../i18n.js';
import { waitingResultsHtml, resultsTrophyHtml, profileProgress } from '../services/race-presentation.js';
import { isReviveBroadcast } from '../broadcast-priority.js';
import { buildElevationSparkline } from '../stage/elevation-profile.js';
import { setInfoTooltip } from './race-card.js';

export const tvIconHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
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
  const tip = (metaState.time === 'finish' ? finishTU : startTU)?.tooltip;
  const finishClass = metaState.time === 'finish' ? ' race-card__schedule--finish' : '';
  const title = tip ? ` title="${getLang() === 'en' ? 'Madrid time' : 'Hora Madrid'} · ${esc(tip)}"` : '';
  return `<div class="race-card__schedule${finishClass}"${title}><span>${metaState.label}</span><strong>${metaState.value}</strong></div>`;
}

// Miniperfil como banda inferior. Sigue el avance de la carrera salvo en
// contrarreloj; con resultados queda completo.
export function appendProfile(card, rd) {
  const color = card.style.getPropertyValue('--card-color');
  const sparkline = rd.elevationProfile && !rd.profileNotViewable && !rd.isCancelledDay
    ? buildElevationSparkline(rd.elevationProfile, profileProgress(rd), rd.id, color, rd.profileSummits ?? [], rd.profileWaypoints ?? [])
    : null;
  if (!sparkline) return false;
  card.classList.add('race-card--elevation');
  card.insertAdjacentHTML('beforeend', `<div class="race-card__profile">${sparkline}</div>`);
  return true;
}

// Modo terminado: sin horario, con Resultados y Revive a la derecha.
export function appendResultsActions(card, rd, { onResults, onYoutube }) {
  card.classList.add('race-card--finished');
  const metaTop = card.querySelector('.race-card__meta-top');
  metaTop.replaceChildren();
  const resultsBadge = document.createElement('button');
  resultsBadge.type = 'button';
  resultsBadge.className = 'badge badge--results badge--icon';
  resultsBadge.title = t('stage.results');
  resultsBadge.setAttribute('aria-label', t('stage.results'));
  resultsBadge.innerHTML = `${resultsTrophyHtml}<span class="badge__label">${t('stage.results')}</span>`;
  resultsBadge.addEventListener('click', e => { e.stopPropagation(); onResults(); });
  metaTop.appendChild(resultsBadge);

  // Revive: redes sociales antes que el resto, después sortOrder.
  const revive = (rd._broadcasts || [])
    .filter(isReviveBroadcast)
    .sort((a, b) => {
      const aSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(a.url || '') ? 0 : 1;
      const bSoc = /youtube\.com|youtu\.be|facebook\.com/i.test(b.url || '') ? 0 : 1;
      return (aSoc - bSoc) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    })[0] ?? null;
  if (!revive?.url) return;
  const ytId = revive.embeddable !== false ? extractYouTubeId(revive.url) : null;
  const reviveBadge = document.createElement('a');
  reviveBadge.className = 'badge badge--tv badge--tv-link badge--revive badge--icon';
  reviveBadge.href = revive.url;
  reviveBadge.target = '_blank';
  reviveBadge.rel = 'noopener';
  reviveBadge.title = t('tv.reviveRace');
  reviveBadge.setAttribute('aria-label', t('tv.reviveRace'));
  reviveBadge.innerHTML = `${tvIconHtml}<span class="badge__label">${t('tv.reviveRace')}</span>`;
  reviveBadge.addEventListener('click', ytId
    ? e => { e.preventDefault(); e.stopPropagation(); onYoutube(ytId); }
    : e => e.stopPropagation());
  resultsBadge.after(reviveBadge);
}

// Activación: página de la jornada, modal de datos o aviso sin información.
// Sin página, un enlace oculto (visible al recibir el foco) conserva la URL
// indexable de la jornada.
export function activateStageCard(card, rd, { clickable, label, seoText, onModal, tooltip }) {
  if (clickable) {
    const go = () => {
      sessionStorage.removeItem('cc_nav');
      window.location.href = jornadaUrl(rd);
    };
    card.addEventListener('click', go);
    makeCardActivatable(card, { role: 'link', href: jornadaUrl(rd), label, onActivate: go });
    return;
  }
  const seoLink = document.createElement('a');
  seoLink.href = jornadaUrl(rd);
  seoLink.className = 'race-card__seo-link';
  seoLink.textContent = seoText;
  card.appendChild(seoLink);
  if (onModal) {
    const open = e => {
      if (e?.target?.closest?.('a.badge, .race-card__overview-btn')) return;
      onModal();
    };
    card.addEventListener('click', open);
    makeCardActivatable(card, { role: 'button', label, onActivate: open });
    return;
  }
  setInfoTooltip(card, tooltip);
}
