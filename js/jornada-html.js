// ─────────────────────────────────────────────────────────────────
//  JORNADA — HTML del contenido de una jornada, sin DOM
//  Lo usa js/jornada.js (pintado en el navegador) y lo usará el paso de build
//  que escribe las jornadas (docs/plans/fase-3-jornadas-estaticas.md). El
//  marcado no puede depender del dispositivo, del ancho de pantalla ni de
//  localStorage: el navegador compara su huella con la del HTML del build
//  (js/html-fingerprint.js).
// ─────────────────────────────────────────────────────────────────

import { broadcastRegionBadgeLabel, formatTimeUser, resolveTypeBadges, esc, raceUrl, jornadaUrl,
         buildRaceHero, buildStageNav, buildActionButtons, rdLocation, filterBroadcastsByRegion, enBase,
         startFinishLabels } from './shared.js';
import { fixedDecimal } from './fixed-number.js';
import { t, getLang } from './i18n.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { hasReviveBroadcastsForDay, reviveBroadcastsForDay, shouldShowBroadcastNote } from './broadcast-priority.js';
import { stageProfileHtml } from './stage/profile.js';

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

const TV_STATUS_LABELS = new Proxy({}, {
  get(_, key) {
    if (key === 'confirmed_time' || key === 'confirmed_notime') return null;
    return t(`tv.status.${key}`) || null;
  },
});

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

// Bloque de botones de resultados: el CTA propio a /resultados/ se integra como
// primer botón de la barra de assets (buildActionButtons → resultsUrl). Sin
// clasificaciones propias no hay botón (no hay fuentes externas de respaldo).
// ── Render ────────────────────────────────────────────────────────

/**
 * Etiqueta de las horas para el visitante: «GMT» en EN si su zona no tiene
 * desplazamiento ni en enero ni en julio (la del build EN, Etc/GMT); así su
 * HTML coincide con el generado y se conserva. En otra zona, ninguna.
 */
export function visitorTimeZoneLabel() {
  if (getLang() !== 'en') return null;
  const year = new Date().getFullYear();
  return [0, 6].every(month => !new Date(year, month, 1).getTimezoneOffset()) ? 'GMT' : null;
}

/**
 * HTML de #jornadaContent y si la jornada tiene clasificaciones propias.
 * `timeZoneLabel` («GMT»): el build de las páginas EN, que pinta las horas en
 * esa zona, y el navegador en ella (visitorTimeZoneLabel). Sin él, las horas
 * van en la zona del visitante sin etiqueta.
 */
export function jornadaHtml(rd, race, broadcasts, assets, siblings = [], hasStartlist = false, allBroadcasts = broadcasts, inhouseStages = new Set(), { timeZoneLabel = null } = {}) {
  const _isEn = getLang() === 'en';
  let html = buildRaceHero(rd, race, { showCancelledBanner: true });

  // Clasificaciones propias (in-house): de esta jornada si ya están volcadas;
  // en su defecto, la GENERAL de la etapa anterior (vueltas por etapas). Una
  // jornada cancelada siempre tiene página propia. Se ofrece como PRIMER botón
  // de la barra de assets (buildActionButtons → `.asset-btn--results`).
  const _navSiblings = siblings.filter(s => !s.isRestDay && !s.isCancelledDay);
  const _currentIdx  = _navSiblings.findIndex(s => s.id === rd.id);
  const _prevRd      = _currentIdx > 0 ? _navSiblings[_currentIdx - 1] : null;
  const _currentResultsAvailable = inhouseStages.has(rd);
  const _prevHasInhouse = _prevRd && !_currentResultsAvailable && inhouseStages.has(_prevRd);
  const hasInhouseResults = inhouseStages.has(rd) || rd.isCancelledDay;
  const hasActualResults = inhouseStages.has(rd);
  const resultsUrl = hasInhouseResults
    ? buildInhouseResultsUrl(race, rd.stageNumber, rd._stageSuffix)
    : (_prevHasInhouse ? buildInhouseResultsUrl(race, _prevRd.stageNumber, _prevRd._stageSuffix) + '#gc' : null);
  // Paridad con las apps: el botón de la jornada actual se destaca; la general
  // arrastrada de la etapa anterior sigue siendo una acción secundaria.
  const resultsHighlighted = hasInhouseResults;

  // Recorrido — panel de botones (clasificaciones · web oficial · inscritos ·
  // rutómetro · perfil · puertos · mapa · live texto), fuente única en
  // shared.buildActionButtons.
  const assetsHtml = buildActionButtons({
    race, rd, view: 'jornada', assets, hasStartlist, resultsUrl, resultsHighlighted,
    style: 'margin-bottom:0.85rem',
  });

  // Horarios (calculados antes del bloque unificado)
  // Horas con su instante UTC legible por máquina (buscadores y LLM): el texto
  // está en la zona del usuario y <time datetime> fija el momento exacto.
  const zoned = text => timeZoneLabel ? `${text} ${timeZoneLabel}` : text;
  const timeTag = (iso, text) => iso ? `<time datetime="${esc(iso)}">${zoned(text)}</time>` : zoned(text);
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
          <div class="route-block__place">${rdLocation(rd, 'finishLocation') || '-'}</div>`;
      }
    } else {
      recorridoHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noData')}</div>`;
    }

    // — Bloque 2: DISTANCIA Y TIPO —
    const kmFormatted = rd.distanceKm
      ? fixedDecimal(rd.distanceKm, { lang: _isEn ? 'en' : 'es' })
      : null;
    const kmHtml = kmFormatted
      ? `<div class="route-block__km">${kmFormatted}${_isEn ? 'km' : ' km'}</div>`
      : `<div class="route-block__km route-block__km--empty">-</div>`;
    const _elevGain = rd.elevationProfile?.elevationGain;
    const elevHtml = _elevGain != null
      ? `<div class="route-block__elev">+${String(Math.round(_elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEn ? ',' : '.')} m</div>`
      : '';
    const tipoHtml = rd.primaryType
      ? `<div class="route-block__type">${resolveTypeBadges(rd.primaryType, rd.secondaryType, race.countryCode)}</div>`
      : '';

    // — Bloque 3: HORARIOS —
    // Si el usuario está en una zona diferente a Madrid, el data-tooltip muestra la hora de Madrid
    const startTipText  = tzDiffers ? `${startLabel} · Madrid: ${startMadrid}`  : startLabel;
    const finishTipText = tzDiffers ? `${finishLabel} · Madrid: ${finishMadrid}` : finishLabel;
    let horariosHtml = '';
    if (start && finish) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${timeTag(rd.neutralStartTimeUtc, start)}</div>
        ${arrowSvg}
        <div class="route-block__place" data-tooltip="${finishTipText}">${timeTag(rd.estimatedFinishTimeUtc, finish)}</div>`;
    } else if (start) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${timeTag(rd.neutralStartTimeUtc, start)}</div>
        <div class="route-block__note">${startLabel}</div>`;
    } else if (finish) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${finishTipText}">${timeTag(rd.estimatedFinishTimeUtc, finish)}</div>
        <div class="route-block__note">${finishLabel}</div>`;
    } else {
      horariosHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noSchedule')}</div>`;
    }

    // Jornada cancelada → sin bloque de horario ni guía de horarios de paso:
    // no hay salida ni meta que anunciar (hasHorarios ya es false).
    const scheduleBlock = rd.isCancelledDay ? '' : `<div class="route-grid__block">
          <div class="route-grid__title" data-tooltip="${timeZoneLabel || (tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone'))}">${t('stage.schedule')}</div>
          <div class="route-grid__body route-grid__body--route">
            ${horariosHtml}
          </div>
        </div>`;

    // La barra de documentos va tras la cabecera de carrera (antes la movía
    // render() en el DOM); así el HTML generado ya es el definitivo.
    html += `${assetsHtml}<div class="jornada-section jornada-section--route-grid">
      <div class="route-grid">
        <div class="route-grid__block">
          <div class="route-grid__title">${t('stage.route')}</div>
          <div class="route-grid__body route-grid__body--route">
            ${recorridoHtml}
          </div>
        </div>
        <div class="route-grid__block route-grid__block--type">
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

  // Perfil y Puntos clave (js/stage/profile.js): el HTML lleva el panel del
  // perfil con el gráfico vacío y la lista de puntos; el montaje dibuja el
  // gráfico. Sin perfil, el contenedor queda oculto como al montarlo. Las
  // horas de paso llevan la misma etiqueta de zona que Horarios.
  const profile = stageProfileHtml({ ...rd, _hasInhouse: hasActualResults }, race, assets, { points: true, timeZoneLabel });
  html += profile
    ? `<div data-integrated-profile class="${profile.className}">${profile.html}</div>`
    : '<div data-integrated-profile hidden></div>';

  // Televisión — sección independiente, siempre con título fijo
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para no mostrar "No TV in Spain" y dejar que
  // los broadcasts (filtrados por región) hablen por sí solos.
  const _tvStatus = (_isEn && rd.tvStatus === 'unavailable_es') ? null : rd.tvStatus;
  const tvLabel = _tvStatus ? TV_STATUS_LABELS[_tvStatus] : null;
  const hasBroadcasts = broadcasts && broadcasts.length > 0;
  const isRaceConcluded = _currentResultsAvailable || rd.raceStatus === 'finished';
  // Revive depende de clasificaciones de ESTA jornada y de un enlace persistente.
  // La general de la etapa anterior y el estado/horario de meta no lo activan.
  const hasReviveBroadcast = hasReviveBroadcastsForDay(broadcasts, hasActualResults, rd.isCancelledDay);
  // Jornada cancelada: solo se conserva el replay explícito si aun así se
  // publicaron clasificaciones propias de lo disputado.
  const liveText = !rd.isCancelledDay && !rd.isRestDay && !isRaceConcluded ? assets.find(a => a.type === 'live_text' && (a.url || a.filePath)) : null;
  const hasTvInfo = liveText || (rd.isCancelledDay ? hasReviveBroadcast : (isRaceConcluded
    ? hasReviveBroadcast
    : (hasBroadcasts || allBroadcasts.length > 0 || _tvStatus === 'pending' || _tvStatus === 'none' || _tvStatus === 'unavailable_es')));

  // Broadcasts que el filtro regional ocultó (presentes en allBroadcasts pero no en broadcasts)
  const filteredOutIds = new Set(broadcasts.map(b => b.id));
  const hiddenBroadcasts = allBroadcasts.filter(b => !filteredOutIds.has(b.id));
  const hasHiddenBroadcasts = hiddenBroadcasts.length > 0;

  if (hasTvInfo) {
    const reviveTitle = race.raceFormat === 'one_day' ? t('tv.reviveRaceTitle') : t('tv.reviveStageTitle');
    const tvSectionTitle = hasReviveBroadcast ? reviveTitle : t('tv.title');
    const toggleBtn = hasHiddenBroadcasts && !hasReviveBroadcast
      ? `<button type="button" class="stage-key-toggle" data-tv-filter="mine">${t('tv.filterAll')}</button>`
      : '';
    // Reutiliza el chip naranja de Hoy, también cuando hay un canal provisional.
    // En Jornada no lo sustituye el Live texto: ambos datos son complementarios.
    const pendingBadge = !hasReviveBroadcast && _tvStatus === 'pending'
      ? `<span class="badge badge--pend"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ${t('tv.status.pending')}</span>`
      : '';
    // Mismo panel que Puntos clave: título y acciones en la cabecera, emisoras
    // como filas separadas por filetes.
    html += `<section class="jornada-section tv-panel">
      <header class="stage-profile-heading">
        <div class="tv-panel__title">
          <h2>${tvSectionTitle}</h2>
          ${pendingBadge}
        </div>
        <div class="tv-panel__actions">${liveText ? `<a class="stage-key-toggle tv-live-text" href="${esc(liveText.url || liveText.filePath)}" target="_blank" rel="noopener">${t('assets.live_text')}</a>` : ''}${toggleBtn}</div>
      </header>
      <div class="tv-panel__list">`;

    if (hasBroadcasts || hasHiddenBroadcasts) {
      const visibleBroadcasts = hasReviveBroadcast
        ? reviveBroadcastsForDay(broadcasts, rd.isCancelledDay)
        : broadcasts;

      // Si el filtro regional dejó sin broadcasts visibles, avisar al usuario antes
      // de listar los que están ocultos (los muestra al pulsar el toggle "Todas").
      if (!hasReviveBroadcast && visibleBroadcasts.length === 0 && hasHiddenBroadcasts) {
        html += `<div class="info-row tv-no-region-msg">
          <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">${t('tv.noTvRegion')}</span>
        </div>`;
      }

      const renderEntry = (b, hidden = false) => {
        const bTimeTU = formatTimeUser(b.startTimeUtc);
        const bTime   = hasReviveBroadcast ? null : (bTimeTU?.display ?? null);
        const bTimeTip = bTimeTU?.tooltip ? `Madrid: ${bTimeTU.tooltip}` : null;
        const regionLabel = filterBroadcastsByRegion([b]).length ? '' : broadcastRegionBadgeLabel(b.country);
        // `getBroadcastEmbed` aplica la allowlist y respeta embeddable=false.
        const broadcastEmbed = getBroadcastEmbed(b.url, b.embeddable);
        return `<div class="tv-entry${hidden ? ' tv-entry--regional-hidden' : ''}"${hidden ? ' style="display:none"' : ''}>
          <div class="tv-entry__info">
            <div class="tv-entry__platform-row">
              <div class="tv-entry__platform">${b.channel || '-'}</div>
              ${b.note && shouldShowBroadcastNote(hasActualResults, hasReviveBroadcast, b.showInRevive) ? `<button type="button" class="tv-entry__note-btn" data-tooltip="${esc(b.note)}" aria-label="${esc(b.note)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></button>` : ''}
              ${regionLabel ? `<span class="badge badge--uci tv-region-badge">${regionLabel}</span>` : ''}
            </div>
          </div>
          <div class="tv-entry__actions">
            ${bTime ? `<span class="tv-entry__time${bTimeTip ? ' tv-entry__time--tz' : ''}"${bTimeTip ? ` data-tooltip="${bTimeTip}"` : ''}>${timeTag(b.startTimeUtc, bTime)}</span>` : ''}
            ${b.url  ? `<a class="tv-link-btn${broadcastEmbed ? ' tv-link-btn--embed' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener"${broadcastEmbed ? ' data-tv-embed="1"' : ''}>${t('stage.watch')} ↗&#xFE0E;</a>` : ''}
          </div>
        </div>`;
      };

      visibleBroadcasts.forEach(b => { html += renderEntry(b, false); });
      if (!hasReviveBroadcast) {
        hiddenBroadcasts.forEach(b => { html += renderEntry(b, true); });
      }
    } else if (tvLabel) {
      html += `<div class="info-row">
        <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">
          ${tvLabel}
        </span>
      </div>`;
    } else if (!_tvStatus) {
      // Solo Live texto: sin emisiones ni estado de TV, el panel indica que no
      // hay televisión en lugar de quedarse con la cabecera y la lista vacía.
      html += `<div class="info-row">
        <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">${t('tv.noBroadcast')}</span>
      </div>`;
    }

    html += `</div></section>`;
  } // fin hasTvInfo

  // Editorial — en EN usar solo traducción EN (sin fallback ES)
  const _enTr   = _isEn ? (rd.translations?.en || {}) : {};
  const _desc    = _isEn ? (_enTr.description?.value || '') : rd.description;
  const _bonuses = _isEn ? (_enTr.bonuses?.value     || '') : rd.bonuses;
  const _notes   = _isEn ? (_enTr.notes?.value       || '') : rd.notes;
  if (_desc || _bonuses || _notes) {
    // Mismo panel que Perfil, Puntos clave y Televisión.
    html += `<section class="jornada-section stage-panel stage-text-panel">
      <header class="stage-profile-heading"><h2>${race.raceFormat === 'one_day' ? t('stage.descriptionRace') : t('stage.descriptionStage')}${_isEn && _enTr.description?.status !== 'manual' ? ' <span class="jornada-section__ai-note">AI translated from Spanish, might contain errors</span>' : ''}</h2></header>
      ${_desc    ? `<div class="jornada-description">${descriptionHtml(_desc)}</div>` : ''}
      ${_bonuses ? `<div class="info-row"><span class="info-row__label">${t('stage.bonuses')}</span>
                    <span class="info-row__value info-row__value--secondary">${esc(_bonuses)}</span></div>` : ''}
      ${_notes   ? `<div class="info-row"><span class="info-row__label">${t('stage.notes')}</span>
                    <span class="info-row__value info-row__value--secondary">${esc(_notes)}</span></div>` : ''}
    </section>`;
  }

  // Assets ya integrados en sección Recorrido

  // Navegación entre etapas (solo vueltas por etapas con >1 etapa; excluye jornadas de descanso)
  const navSiblings = siblings.filter(s => !s.isRestDay);
  html = buildStageNav(navSiblings, rd.id, jornadaUrl, raceUrl(race)) + html;
  return { html, hasActualResults };
}
