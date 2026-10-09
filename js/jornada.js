import { mountStageProfile } from './stage/profile.js';
// ─────────────────────────────────────────────────────────────────
//  JORNADA — detalle de una jornada concreta
//  URL: jornada.html?id=RACE_DAY_ID
// ─────────────────────────────────────────────────────────────────

import { supabase, broadcastRegionBadgeLabel, formatTime, formatTimeUser, getUserTimezoneLabel, stageLabel,
         resolveTypeBadges, esc,
         setMeta as setMetaJ, setMetaProperty as setMetaPropJ,
         raceUrl, jornadaUrl, buildRaceHero, buildStageNav, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, raceName, rdLocation,
         filterBroadcastsByRegion, enBase, seoLongDateWeekday, startFinishLabels, trapFocus, setRaceRobots, setHreflangPair,
         embeddedId, orEqFilter, pickByPreference }
         from './shared.js';
import { isNearToday } from './services/refresh-window.js';
import { t, getLang, initI18n } from './i18n.js';
import { writeCalendarParams } from './calendario-query.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { annotateDoubleSectors, buildInhouseResultsMatcher, hasCalendarForYear } from './services/races.js';
import { hasReviveBroadcastsForDay, reviveBroadcastsForDay, shouldShowBroadcastNote } from './broadcast-priority.js';

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
function render(rd, race, broadcasts, assets, siblings = [], hasStartlist = false, allBroadcasts = broadcasts, inhouseStages = new Set()) {
  const color  = race.colorHex || '#888';
  const name   = raceName(race) || t('stage.unknownRace') || 'Carrera desconocida';
  const stage  = stageLabel(rd.stageNumber, rd._stageSuffix);

  document.title = `${name}${stage ? ' – ' + stage : ''} - ${t('seo.siteName')}`;
  updateSeoJornada(rd, race);

  // Enlace "volver": sessionStorage tiene prioridad sobre parámetros URL
  const backBtn   = document.getElementById('backBtn');
  const urlParams = new URLSearchParams(location.search);
  const navState  = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const fromVal   = urlParams.get('from') || navState.from;
  const _isEn = getLang() === 'en';
  const _navBase = _isEn ? '/en' : '';
  // Mes y Temporada viven fusionadas en /calendario/ (subvistas por
  // parámetro según idioma: js/calendario-query.js).
  const _navCalendar = _isEn ? '/calendar/' : '/calendario/';
  const _navToday  = '/';
  if (fromVal === 'temporada') {
    const year = urlParams.get('year') || navState.year || '';
    const cat  = urlParams.get('cat')  || navState.cat  || '';
    const qs   = new URLSearchParams();
    writeCalendarParams(qs, getLang(), { view: 'temporada' });
    if (year) qs.set('year', year);
    if (cat) qs.set('cat', cat);
    backBtn.href = _navBase + _navCalendar + '?' + qs;
  } else if (fromVal === 'mes') {
    const monthRaw = urlParams.get('month') || navState.month;
    const yearRaw  = urlParams.get('year')  || navState.year;
    let month = null;
    if (yearRaw !== undefined && yearRaw !== null && monthRaw !== undefined && monthRaw !== null) {
      // navState stores 0-based month; format as YYYY-MM
      const y = Number(yearRaw);
      const m = Number(monthRaw) + 1;
      month = `${y}-${String(m).padStart(2, '0')}`;
    }
    const qs = writeCalendarParams(new URLSearchParams(), getLang(), { view: 'mes', month });
    backBtn.href = _navBase + _navCalendar + '?' + qs;
  } else if (rd.dateKey) {
    backBtn.href = _navBase + _navToday + `?date=${rd.dateKey}`;
  } else {
    backBtn.href = _navBase + _navToday;
  }

  const content = document.getElementById('jornadaContent');
  content.querySelector('[data-integrated-profile]')?._profileCleanup?.();
  content.style.setProperty('--card-color', color);

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
      ? Number(rd.distanceKm).toLocaleString(_isEn ? 'en-GB' : 'es-ES')
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

    // Jornada cancelada → sin bloque de horario ni guía de horarios de paso:
    // no hay salida ni meta que anunciar (hasHorarios ya es false).
    const scheduleBlock = rd.isCancelledDay ? '' : `<div class="route-grid__block">
          <div class="route-grid__title" data-tooltip="${tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone')}">${t('stage.schedule')}</div>
          <div class="route-grid__body route-grid__body--route">
            ${horariosHtml}
          </div>
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
            ${bTime ? `<span class="tv-entry__time${bTimeTip ? ' tv-entry__time--tz' : ''}"${bTimeTip ? ` data-tooltip="${bTimeTip}"` : ''}>${bTime}</span>` : ''}
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

  // Reportar se mueve al ical-bar (setupIcalModal) para quedar junto a Suscribirse

  content.querySelector('[data-integrated-profile]')?._profileCleanup?.();
  content.innerHTML = html;
  const routeSection = content.querySelector('.jornada-section--route-grid');
  const resourceBar = routeSection?.querySelector('.asset-links-wrap');
  const stageHeader = content.querySelector('.race-header');
  if (resourceBar && stageHeader) stageHeader.after(resourceBar);
  const profileHost = document.createElement('div'); profileHost.dataset.integratedProfile = '';
  (routeSection || resourceBar || stageHeader)?.after(profileHost);
  mountStageProfile(profileHost, { day:{ ...rd, _hasInhouse:hasActualResults }, race, assets, points:true, temporal:true });
  syncTvPanelWidth(content);

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

  // ── Notas de emisión: en táctil, la nota se abre al pulsar el icono ──
  content.querySelectorAll('.tv-entry__note-btn').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      let tip = document.getElementById('ph-tooltip');
      if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
      const open = tip.style.display === 'block' && tip.dataset.owner === btn.dataset.tooltip;
      if (open) { tip.style.display = 'none'; return; }
      const box = btn.getBoundingClientRect();
      tip.textContent = btn.dataset.tooltip;
      tip.dataset.owner = btn.dataset.tooltip;
      tip.style.display = 'block';
      tip.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - tip.offsetWidth - 8))}px`;
      tip.style.top = `${box.bottom + 6}px`;
      const close = () => { tip.style.display = 'none'; document.removeEventListener('click', close); window.removeEventListener('scroll', close); };
      setTimeout(() => { document.addEventListener('click', close); window.addEventListener('scroll', close, { passive:true }); }, 0);
    });
  });

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

}

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
      title = `${raceNameStr}${raceYear ? ' ' + raceYear : ''} - ${t('seo.siteName')}`;
    } else {
      const stageLabelStr = stageNum !== null && stageNum !== undefined ? stageLabel(stageNum, rd._stageSuffix) : '';
      const route = sameOrOne ? startLoc : `${startLoc} › ${finishLoc}`;
      title = `${raceNameStr}, ${stageLabelStr}: ${route} - ${t('seo.siteName')}`;
    }
  } else if (isOneDay) {
    title = `${raceNameStr}${raceYear ? ' ' + raceYear : ''} - ${t('seo.siteName')}`;
  } else {
    const stageLabelStr = stageNum !== null && stageNum !== undefined ? stageLabel(stageNum, rd._stageSuffix) : '';
    const route = sameOrOne
      ? startLoc
      : `${startLoc} › ${finishLoc}`;
    title = `${raceNameStr}, ${stageLabelStr}: ${route} - ${t('seo.siteName')}`;
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
  const ogTitle = title.replace(` - ${t('seo.siteName')}`, '');
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
  setRaceRobots(race);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = canonicalUrl;
  // Alternativas ES/EN (también las lee el selector de idioma).
  setHreflangPair(
    rd.slug ? `${CONFIG.webOrigin}/jornada/${encodeURIComponent(rd.slug)}/` : canonicalUrl,
    rd.slugEn ? `${CONFIG.webOrigin}/en/stage/${encodeURIComponent(rd.slugEn)}/` : (_canonIsEn ? canonicalUrl : null),
  );

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
    'name': title.replace(` - ${t('seo.siteName')}`, ''),
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
                  'item': `${origin}/calendario/?year=${raceYear}` });
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
      content.querySelectorAll('.tv-region-badge').forEach(el => { el.style.display = 'inline-flex'; });
      content.querySelectorAll('.tv-no-region-msg').forEach(el => { el.style.display = 'none'; });
      tvBtn.dataset.tvFilter = 'all';
      tvBtn.textContent = t('tv.filterMine');
      tvBtn.classList.add('tv-filter-btn--active');
    } else {
      // estamos en Todas → volver a Mi País
      content.querySelectorAll('.tv-entry--regional-hidden').forEach(el => { el.style.display = 'none'; });
      content.querySelectorAll('.tv-region-badge').forEach(el => { el.style.display = 'none'; });
      content.querySelectorAll('.tv-no-region-msg').forEach(el => { el.style.display = ''; });
      tvBtn.dataset.tvFilter = 'mine';
      tvBtn.textContent = t('tv.filterAll');
      tvBtn.classList.remove('tv-filter-btn--active');
    }
    syncTvPanelWidth(content);
  }
});

// Panel de televisión a media anchura en escritorio cuando solo se ve una fila.
function syncTvPanelWidth(content) {
  content.querySelectorAll('.tv-panel').forEach(panel => {
    const rows = [...panel.querySelectorAll('.tv-panel__list>:is(.tv-entry,.info-row)')].filter(el => el.style.display !== 'none');
    panel.classList.toggle('tv-panel--single', rows.length <= 1);
  });
}

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

        <p style="font-size:0.75rem;line-height:1.45;color:var(--text-muted);margin:0.75rem 0 0">
          ${document.documentElement.lang === 'en'
            ? 'We use your contact and technical data to review this report and keep it for up to 12 months. <a href="/en/privacy/">Privacy policy</a>.'
            : 'Usamos tus datos de contacto y técnicos para revisar este aviso y los conservamos hasta 12 meses. <a href="/privacidad.html">Política de privacidad</a>.'}
        </p>

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

// Columnas de las jornadas hermanas: navegación entre etapas
// (buildStageNav), dobles sectores y resultados de la etapa anterior.
const SIBLING_COLUMNS = 'id,raceId,dateKey,stageNumber,isRestDay,isCancelledDay,neutralStartTimeUtc,startLocation,startLocationEn,finishLocation,finishLocationEn,slug,slugEn';
// La jornada lleva la carrera embebida: un viaje menos antes de pintar.
const DAY_WITH_RACE = '*,race:races(*)';

function splitDayRace(row) {
  if (!row) return { rd: null, race: null };
  const { race, ...rd } = row;
  return { rd, race };
}

function showNotFound() {
  document.getElementById('jornadaContent').innerHTML = `
      <div class="empty-state" style="padding:4rem 1.5rem">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__title">Jornada no encontrada</div>
      </div>`;
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  // El diccionario EN se carga a la vez que los datos; se espera antes de pintar.
  const i18nReady = initI18n();
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
  // Página pre-renderizada: el build incrusta los ids y evita resolver el
  // slug; con ellos, las lecturas dependientes salen a la vez que la jornada.
  const pageRaceId = !id && !params.get('slug') ? embeddedId('race-id') : null;
  if (!id && !params.get('slug')) id = embeddedId('race-day-id');

  if (!id && !slug) {
    await i18nReady;
    showNotFound();
    return;
  }

  // Lecturas que dependen solo de la jornada o de la carrera. Las hermanas
  // solo en carreras por etapas (en un día no hay navegación entre etapas);
  // con el id incrustado se piden siempre y se descartan si no hacen falta.
  const dayRequests = dayId => [
    supabase.from('broadcasts').select('*').eq('raceDayId', dayId).order('sortOrder', { ascending: true }),
    supabase.from('assets').select('*').eq('raceDayId', dayId),
  ];
  const raceRequests = (raceId, withSiblings = true) => [
    // Resultados in-house: qué etapas de esta carrera tienen clasificaciones
    // propias (race_uci_stages.keepForWeb). Una sola consulta por carrera.
    raceId
      ? supabase.from('race_uci_stages').select('raceId,raceDayId,stageNumber').eq('raceId', raceId).eq('keepForWeb', true).gt('rowCount', 0)
      : Promise.resolve(null),
    raceId ? loadRaceTechnicalGuide(raceId) : Promise.resolve(null),
    raceId && withSiblings
      ? supabase.from('race_days').select(SIBLING_COLUMNS).eq('raceId', raceId).eq('editorialStatus', 'published')
      : Promise.resolve(null),
  ];
  // Las consultas de supabase-js solo se envían al resolverlas: Promise.resolve
  // las lanza ya.
  const earlyDay = id ? dayRequests(id).map(request => Promise.resolve(request)) : null;
  const earlyRace = pageRaceId ? raceRequests(pageRaceId).map(request => Promise.resolve(request)) : null;

  try {
    // Jornada por id; si no existe (o solo hay slug), por slug en una sola
    // consulta: en EN se prefiere slugEn y se admite slug por compatibilidad.
    let row = null;
    if (id) {
      const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).eq('id', id).maybeSingle();
      row = data;
    }
    if (!row && slug) {
      const columns = _initIsEn ? ['slugEn', 'slug'] : ['slug'];
      const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).or(orEqFilter(columns, slug)).limit(4);
      row = pickByPreference(data, columns, slug);
      if (!row) {
        await i18nReady;
        showNotFound();
        return;
      }
    }
    const { rd, race: raceRow } = splitDayRace(row);
    if (!rd) throw new Error('No existe');
    const sameDay = rd.id === id;
    id = rd.id;
    const race = raceRow || {};

    // Actualizar URL al path limpio correcto según idioma
    if (_initIsEn && (rd.slugEn || rd.slug)) {
      const cleanSlug = rd.slugEn || rd.slug;
      const _stageEnB = enBase();
      history.replaceState(null, '', `${_stageEnB}/stage/${encodeURIComponent(cleanSlug)}/`);
    } else if (!_initIsEn && rd.slug) {
      history.replaceState(null, '', `/jornada/${encodeURIComponent(rd.slug)}/`);
    }

    // Broadcasts, assets, resultados in-house, guía técnica y etapas hermanas:
    // las que no salieron ya con los ids incrustados, en un único round-trip.
    const isStageRace = race.raceFormat !== 'one_day';
    const [bcastResult, assetsResult, uciResult, technicalGuide, siblingsAll] = await Promise.all([
      ...(sameDay && earlyDay ? earlyDay : dayRequests(id)),
      ...(earlyRace && rd.raceId === pageRaceId ? earlyRace : raceRequests(rd.raceId, isStageRace)),
      i18nReady,
    ]);
    const siblingsResult = isStageRace ? siblingsAll : null;

    const allBroadcasts = bcastResult.data || [];
    const broadcasts = filterBroadcastsByRegion(allBroadcasts);
    const assets     = assetsResult.data || [];
    const inhouseStages = buildInhouseResultsMatcher(uciResult?.data || []);
    // Derivado de `races.startlistImportedAt` (ya cargado con la carrera).
    // Evita un roundtrip extra a `startlist_teams` que retrasaba el botón.
    const hasStartlist = !!race.startlistImportedAt;

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
      // Propagar sufijo de doble sector al rd actual desde siblings
      const match = siblings.find(s => s.id === rd.id);
      if (match?._stageSuffix) rd._stageSuffix = match._stageSuffix;
    }

    render(rd, race, broadcasts, withRaceTechnicalGuide(assets, technicalGuide), siblings, hasStartlist, allBroadcasts, inhouseStages);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
    setupIcalModal(rd, race);
    // Sondeo de estado solo alrededor de la fecha de la jornada: una lectura
    // ligera de las columnas que cambian el pintado; la jornada completa se
    // vuelve a pedir únicamente si cambian.
    const STATE_COLUMNS = 'raceStatus,isCancelledDay,isRestDay';
    const stateKey=(day,results)=>JSON.stringify([day.raceStatus,day.isCancelledDay,day.isRestDay,results.map(row=>[row.raceDayId,row.stageNumber]).sort()]);
    let previous=stateKey(rd,uciResult?.data || []), refreshing=false;
    const refreshState=async()=> {
      const content=document.getElementById('jornadaContent');
      if(document.hidden || refreshing || !content?.isConnected || document.querySelector('.tv-embed-block,.rd-modal--open,.report-modal--open')) return;
      if(!isNearToday(rd.dateKey)) return;
      refreshing=true;
      try {
        const [nextState,nextResults]=await Promise.all([
          supabase.from('race_days').select(STATE_COLUMNS).eq('id',id).single(),
          rd.raceId
            ? supabase.from('race_uci_stages').select('raceId,raceDayId,stageNumber').eq('raceId',rd.raceId).eq('keepForWeb',true).gt('rowCount',0)
            : Promise.resolve({ data: [] }),
        ]);
        if(nextState.error || nextResults.error) return;
        const nextKey=stateKey(nextState.data,nextResults.data || []);
        if(previous===nextKey) return;
        const nextDay=await supabase.from('race_days').select('*').eq('id',id).single();
        if(nextDay.error) return;
        const all=content.querySelector('[data-tv-filter]')?.dataset.tvFilter==='all';
        const focusHref=document.activeElement?.closest('a')?.getAttribute('href');
        const updated={...nextDay.data,_stageSuffix:rd._stageSuffix};
        render(updated,race,broadcasts,withRaceTechnicalGuide(assets,technicalGuide),siblings,hasStartlist,allBroadcasts,buildInhouseResultsMatcher(nextResults.data || []));
        if(all) content.querySelector('[data-tv-filter=mine]')?.click();
        if(focusHref) [...content.querySelectorAll('a')].find(a=>a.getAttribute('href')===focusHref)?.focus({preventScroll:true});
        previous=stateKey(nextDay.data,nextResults.data || []);
      } catch { /* Conservar la jornada visible hasta la siguiente lectura válida. */ }
      finally { refreshing=false; }
    };
    const stateTimer=isNearToday(rd.dateKey) ? setInterval(refreshState,60000) : null;
    document.addEventListener('visibilitychange',refreshState);
    window.addEventListener('pagehide',()=> {clearInterval(stateTimer);document.removeEventListener('visibilitychange',refreshState);document.querySelector('[data-integrated-profile]')?._profileCleanup?.();},{once:true});

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

// Escritorio con Puntos clave: las acciones van bajo ese panel; en el resto,
// sobre el pie.
const _sideActionsQuery = window.matchMedia('(min-width: 1024px)');
function placeIcalBar(bar) {
  const slot = document.querySelector('.stage-side__actions');
  const footer = document.querySelector('footer.site-footer');
  if (slot && _sideActionsQuery.matches) { if (bar.parentElement !== slot) slot.append(bar); }
  else if (footer && bar.nextElementSibling !== footer) footer.before(bar);
}
_sideActionsQuery.addEventListener('change', () => {
  const bar = document.getElementById('icalBar');
  if (bar) placeIcalBar(bar);
});

function setupIcalModal(rd, race) {
  const showSubscribe = hasCalendarForYear(race?.year) && !!rd.slug && !rd.isRestDay && !rd.isCancelledDay;

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
  placeIcalBar(bar);

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
      const year = new Date().getUTCFullYear();
      const sn = rd.stageNumber;
      const stageLabel = sn === 0 ? t('stage.prologue') : sn != null ? (t('stage.stage') + ' ' + sn) : '';
      const raceName = _icalIsEn ? (race.nameEn || race.name || '') : (race.name || '');
      const eventLabel = stageLabel
        ? (raceName + ' - ' + stageLabel)
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
