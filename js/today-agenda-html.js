// ─────────────────────────────────────────────────────────────────
//  HOY — HTML de la agenda de un día, sin DOM
//  Lo usan js/app.js (pintado en el navegador) y la publicación por página.
//  Los oyentes van delegados en la lista y en la barra de fechas (js/app.js).
// ─────────────────────────────────────────────────────────────────
import { formatTime, formatTimeUser, stageLabel, countryFlag, effectiveCountryCode, resolveTypeBadges,
         categoryBadge, raceUrl, raceName, rdLocation, tsSeconds, needsFemaleMark, cleanFeminineName,
         startlistUrl, startOrderUrl, jornadaUrl, esc } from './shared.js';
import { t, getLang, getLocale } from './i18n.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { todayRaceState, startlistCyclistHtml, tvIconHtml, tvStatusChipHtml } from './services/race-presentation.js';
import { pickBadgeBroadcast } from './broadcast-priority.js';
import { agendaCardIsFeatured, agendaMetaState } from './services/today-agenda-layout.js';
import { hasModalData } from './stage/profile-availability.js';
import { theoreticalStageNumber } from './services/today-nav.js';
import { cardLogoHtml, overviewButtonHtml, raceCardHtml, safeCardColor } from './components/race-card.js';
import { noExtraInfoMessage, stageRouteText, formatStageMetrics, stageSubHtml, stageIsClickable,
         startOrderBadgeHtml, scheduleHtml, elevationProfileHtml, resultsActionsHtml } from './components/stage-card.js';

const attr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const _liveTextSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>';
const _cyclistSvg = startlistCyclistHtml;

function tvBadgeHtml(tvStatus, broadcasts, neutralStartTs, liveTextUrl, regionBlocked = false, nowMs = Date.now()) {
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para que se muestren los broadcasts (filtrados
  // por región) o nada si no hay ninguno.
  if (tvStatus === 'unavailable_es' && getLang() === 'en') tvStatus = null;

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

  if (tvStatus === 'none' || tvStatus === 'unavailable_es' || tvStatus === 'pending') {
    return liveTextBadge || tvStatusChipHtml(tvStatus, t(`tv.status.${tvStatus}`));
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

// Tarjeta completa. `data-key`: al refrescar se actualiza solo lo que difiere (js/dom-patch.js).
function cardHtml({ key, color, classes = [], attrs = '', style = '', html }) {
  const clases = ['race-card', ...classes].filter(Boolean).join(' ');
  return `<div class="${clases}" style="--card-color:${safeCardColor(color)}${style}" data-key="${attr(key)}"${attrs}>${html}</div>`;
}

// Tarjeta sin página ni modal: tooltip al pasar el ratón y aviso al pulsar en
// móvil (initPhTooltip de shared.js).
function infoTooltipAttrs({ message, name, flag, sub }) {
  return ` data-ph-tooltip="${attr(message)}" data-ph-name="${attr(name)}" data-ph-flag="${attr(flag)}"${sub ? ` data-ph-sub="${attr(sub)}"` : ''}`;
}

const NO_POINTER = ';cursor:default';

// Lo que depende de la región del visitante. `variantes(rd)`, solo al publicar: el resto de
// grupos en plantillas, que el script previo al primer pintado aplica.
function regionSlot(cls, html, render, variantes) {
  if (!variantes) return html;
  const plantillas = variantes.map(({ claves, broadcasts, blocked }) => {
    const propia = render(broadcasts, blocked);
    return propia === html ? '' : `<template data-tv="${claves.join(' ')}">${propia}</template>`;
  }).join('');
  return `<span class="${cls}">${html}${plantillas}</span>`;
}

const overviewBtnHtml = race => race.raceFormat === 'stage_race' && race.startDate !== race.endDate && race.id && !race.isNoClickable
  ? overviewButtonHtml(raceUrl(race), t('race.viewFull'))
  : '';

const shortDate = dateKey => dateKey
  ? new Date(dateKey + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  : '';

const catBadgesHtml = (race, uci, agendaCat) => `<span class="race-card__name-cat">${categoryBadge(uci, needsFemaleMark(race, agendaCat))}</span>`;

// Nombre accesible de una tarjeta: sin él el lector lee el amasijo de
// nombre, badges, horas y kilómetros que contiene el grid.
const cardAriaLabel = (name, stage, uci) => [name, stage, uci].filter(Boolean).join(' · ');

function placeholderCardHtml(race, agendaCat) {
  const flag = race.hideFlag ? '' : countryFlag(race.countryCode);
  const name = cleanFeminineName(raceName(race) || t('race.unknown'), agendaCat);
  const uci = race.uciCategory || '';
  const stage = race.raceFormat === 'stage_race' ? stageLabel(theoreticalStageNumber(race, race._dateKey)) : '';
  return cardHtml({
    key: `ph-${race.id}`, color: race.colorHex, classes: ['race-card--placeholder'], style: NO_POINTER,
    attrs: infoTooltipAttrs({
      message: noExtraInfoMessage(race.startDate), name, flag,
      sub: [stage, shortDate(race._dateKey), uci].filter(Boolean).join(' · '),
    }),
    html: raceCardHtml({
      logo: cardLogoHtml(race.logoUrl, flag, race.hideFlag, race.uciCategory !== 'CN'),
      name: `<span>${name}</span>`,
      sub: stage ? `<span class="race-card__stage">${stage}</span>` : '',
      badges: catBadgesHtml(race, uci, agendaCat),
    }),
  });
}

function stageCardHtml(rd, { agendaCat, agendaSort, variantes, now }) {
  const race = rd._race || {};
  const key = rd.id;
  const flag = countryFlag(effectiveCountryCode(rd, race));
  // El override de país de la jornada vence al hideFlag de la carrera:
  // si la jornada fija un país, se muestra bandera aunque la carrera la oculte.
  const hideFlag = race.hideFlag && !rd.countryCode;
  const name = cleanFeminineName(raceName(race) || t('race.unknown'), agendaCat);
  const uci = race.uciCategory || '';
  const catBadgeHtml = catBadgesHtml(race, uci, agendaCat);
  const isFinalStage = race.raceFormat === 'stage_race' && rd.stageNumber != null && !rd.isRestDay
    && !rd.isCancelledDay && !!rd.dateKey && rd.dateKey === race.endDate;
  const stage = stageLabel(rd.stageNumber, rd._stageSuffix, isFinalStage);
  const { km, elev } = formatStageMetrics(rd);
  const startTU = formatTimeUser(rd.neutralStartTimeUtc, rd.dateKey);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc, rd.dateKey);
  const overviewBtn = overviewBtnHtml({ ...race, id: rd.raceId });
  const logo = cardLogoHtml(race.logoUrl, flag, hideFlag, race.uciCategory !== 'CN');

  if (rd.isRestDay) {
    return cardHtml({
      key, color: race.colorHex, classes: ['race-card--rest-day'],
      html: raceCardHtml({
        logo, name: `<span>${name}</span>${overviewBtn}`,
        sub: `<span class="race-card__stage">${t('stage.restDay')}</span>`,
        badges: catBadgeHtml,
      }),
    });
  }

  if (race.isCancelled) {
    return cardHtml({
      key, color: race.colorHex, classes: ['race-card--placeholder', 'race-card--cancelled'], style: NO_POINTER,
      attrs: infoTooltipAttrs({ message: t('race.cancelled'), name, flag: hideFlag ? '' : flag, sub: uci }),
      html: raceCardHtml({
        logo, name: `<span>${name}</span>`,
        badges: `${catBadgeHtml}<span class="badge badge--cancelled-day">${t('stage.cancelled')}</span>`,
      }),
    });
  }

  const state = todayRaceState(rd, now);
  const showResults = state === 'results';
  const waiting = state === 'waiting';
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';

  // Con «Hora Meta» la tarjeta programada muestra la llegada prevista.
  const metaTime = agendaSort === 'finishtime' && state === 'scheduled' ? 'running' : state;
  const metaState = agendaMetaState(metaTime,
    { start: startTU?.display ?? null, finish: finishTU?.display ?? null, lang: getLang(), isTimeTrial });

  // Fila de badges bajo el nombre, en orden iOS: Categoría → Cancelada → Tipo
  // (solo CRI/CRE: en el resto el perfil ya lo comunica) → TV → Inscritos →
  // Orden de salida. Una jornada cancelada no tiene tipo ni emisión.
  const typeBadgeHtml = isTimeTrial && !rd.isCancelledDay
    ? `<span class="race-card__types--inline">${resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode)}</span>` : '';
  const liveTextUrl = rd._assets?.find(a => a.type === 'live_text')?.url || null;
  const tvOf = (broadcasts, blocked) => (showResults || waiting || rd.isCancelledDay) ? ''
    : tvBadgeHtml(rd.tvStatus, broadcasts, rd.neutralStartTimeUtc, liveTextUrl, blocked, now);
  const otras = variantes ? variantes(rd) : null;
  const tvHtml = regionSlot('race-card__tv', tvOf(rd._broadcasts || [], rd._tvBlocked), tvOf, otras);
  const isFirstOrOnlyDay = race.raceFormat !== 'stage_race' || rd.dateKey === race.startDate;
  // Crono de etapa única: el orden de salida sustituye a los dorsales.
  const isSingleTimeTrial = isTimeTrial && race.raceFormat !== 'stage_race';
  const startlistHtml = race.startlistImportedAt && !showResults && !waiting && !rd.isCancelledDay && isFirstOrOnlyDay && !isSingleTimeTrial
    ? `<a class="badge badge--startlist" href="${startlistUrl(race)}" onclick="event.stopPropagation()">${_cyclistSvg} <span class="badge__text">${race.startlistProvisional ? t('stage.startlistProvisional') : (race.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'))}</span></a>` : '';
  const startOrderHtml = isTimeTrial && rd._assets?.some(a => a.url && a.type === 'startOrder') && !rd.isCancelledDay && !showResults && !waiting
    ? startOrderBadgeHtml(startOrderUrl(rd)) : '';

  // Miniperfil: banda inferior (o columna central en las destacadas). La
  // barra de avance se actualiza cada minuto mientras la carrera está en curso.
  const profile = elevationProfileHtml(rd, safeCardColor(race.colorHex), now);
  const classes = [];
  if (agendaCardIsFeatured(agendaSort, rd._featured)) classes.push('race-card--featured');
  if (waiting) classes.push('race-card--waiting');
  if (profile) classes.push('race-card--elevation');
  if (showResults) classes.push('race-card--finished');
  let attrs = '';
  if (profile) {
    const startMs = Date.parse(rd.neutralStartTimeUtc), endMs = Date.parse(rd.estimatedFinishTimeUtc);
    if (!showResults && !waiting && Number.isFinite(startMs) && endMs > startMs) {
      attrs += ` data-progress-start="${startMs}" data-progress-end="${endMs}"`;
    }
  }
  // Hora a convertir en la zona del visitante, al publicar.
  if (variantes && metaState.kind === 'schedule') {
    attrs += ` data-hora-utc="${attr(metaState.time === 'finish' ? rd.estimatedFinishTimeUtc : rd.neutralStartTimeUtc)}" data-dia="${attr(rd.dateKey)}"`;
  }

  // Activación: página de la jornada, modal de datos o aviso sin información.
  // Sin página, un enlace oculto (visible al recibir el foco) conserva la URL
  // indexable de la jornada.
  const label = cardAriaLabel(name, stage, uci);
  let seoLink = '';
  let style = '';
  if (stageIsClickable(rd, race.isNoClickable)) {
    attrs += ` role="link" tabindex="0" aria-label="${attr(label)}" data-href="${attr(jornadaUrl(rd))}"`;
  } else {
    seoLink = `<a href="${attr(jornadaUrl(rd))}" class="race-card__seo-link">${esc(raceName(race) || t('race.unknown'))}</a>`;
    if (hasModalData(rd)) {
      attrs += ` role="button" tabindex="0" aria-label="${attr(label)}" data-modal=""`;
    } else {
      style = NO_POINTER;
      attrs += infoTooltipAttrs({
        message: rd.isCancelledDay ? t('stage.stageCancelledTooltip') : noExtraInfoMessage(rd.dateKey),
        name, flag: hideFlag ? '' : flag,
        sub: [stage, shortDate(rd.dateKey), uci].filter(Boolean).join(' · '),
      });
    }
  }

  const resultsOf = broadcasts => resultsActionsHtml(rd, broadcasts);
  const meta = showResults
    ? regionSlot('race-card__revive', resultsOf(rd._broadcasts || []), resultsOf, otras)
    : rd.isCancelledDay ? '' : scheduleHtml(metaState, startTU, finishTU);

  return cardHtml({
    key, color: race.colorHex, classes, attrs, style,
    html: raceCardHtml({
      logo,
      name: `<span>${name}</span>${overviewBtn}`,
      sub: stageSubHtml({ stage, route: stageRouteText(rd, rdLocation), km, elev }),
      badges: `${catBadgeHtml}${rd.isCancelledDay ? `<span class="badge badge--cancelled-day">${t('stage.cancelled')}</span>` : ''}${typeBadgeHtml}${tvHtml}${startlistHtml}${startOrderHtml}`,
      meta,
    }) + profile + seoLink,
  });
}

/** Tarjeta de un elemento de la agenda: jornada o carrera sin jornada publicada ese día. */
export function agendaCardHtml(item, { agendaCat, agendaSort, variantes = null, now = Date.now() }) {
  return item._placeholder ? placeholderCardHtml(item._phRace, agendaCat)
    : stageCardHtml(item, { agendaCat, agendaSort, variantes, now });
}

const dayPillHtml = (dk, selected, isToday) => {
  const [y, m, d] = dk.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Un solo formato en todos los anchos: abreviatura sobre el número.
  let wdShort = date.toLocaleDateString(getLocale(), { weekday: 'short' }).replace(/\.$/, '');
  wdShort = wdShort.charAt(0).toUpperCase() + wdShort.slice(1);
  const dayNum = date.toLocaleDateString(getLocale(), { day: 'numeric' });
  // «Lun 12» no dice ni el mes ni cuál es el día seleccionado: el nombre
  // accesible lleva la fecha completa y aria-current marca el activo.
  const label = date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return `<button type="button" class="date-pill${selected ? ' active' : ''}${isToday ? ' is-today' : ''}" aria-label="${attr(label)}"${selected ? ' aria-current="date"' : ''} data-dk="${dk}">`
    + `<span class="date-pill__wd" aria-hidden="true">${wdShort}</span><span class="date-pill__num" aria-hidden="true">${dayNum}</span></button>`;
};

/** HTML de #dateBar: 7 días centrados en el activo (3 antes + activo + 3 después). */
export function dateBarHtml(dateKey, today) {
  const [cy, cm, cd] = dateKey.split('-').map(Number);
  const pad = value => String(value).padStart(2, '0');
  const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const pills = [-3, -2, -1, 0, 1, 2, 3].map(i => key(new Date(cy, cm - 1, cd + i)));
  const arrow = (direction, label) => `<button type="button" class="date-week-arrow cc-scroll-arrow" aria-label="${attr(label)}" data-direction="${direction}"><span aria-hidden="true">${direction === 'prev' ? '‹' : '›'}</span></button>`;
  const todayLabel = t('today.todayBtn');
  return `<div class="date-bar__left">${arrow('prev', t('today.prevDayLabel'))}<button type="button" class="date-today-btn${dateKey !== today ? ' date-today-btn--visible' : ''}" aria-label="${attr(todayLabel)}">${esc(todayLabel)}</button></div>`
    + `<div class="date-bar__pills-wrap"><div class="date-bar__pills">${pills.map(dk => dayPillHtml(dk, dk === dateKey, dk === today)).join('')}</div></div>`
    + `<div class="date-bar__right">${arrow('next', t('today.nextDayLabel'))}</div>`;
}

const EMPTY_DAY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

/** Aviso de un día sin carreras. `loadDay` lo expone js/app.js en `window`. */
export function emptyDayHtml(message, nextDateKey) {
  const nextBtn = nextDateKey
    ? `<button class="btn btn--ghost" style="margin-top:1rem" onclick="loadDay('${nextDateKey}')">${t('today.nextDay')}</button>`
    : '';
  return `
    <div class="empty-state">
      <div class="empty-state__icon">${EMPTY_DAY_ICON}</div>
      <div class="empty-state__text">${message}</div>
      ${nextBtn}
    </div>`;
}
