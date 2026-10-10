// ─────────────────────────────────────────────────────────────────
//  ORDEN DE SALIDA — Contrarreloj individual / por equipos
//  URL: orden-salida.html?id=RD_ID  o  /orden-salida/RD_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, esc, setMeta, setMetaProperty, jornadaUrl,
         raceUrl, raceName as getRaceName, enBase, startOrderUrl,
         findMatchingTeam, buildRaceHeader, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, setPressed, setRaceRobots,
         embeddedId, orEqFilter, pickByPreference } from './shared.js';
import { getLang, initI18n } from './i18n.js';
import { mountStageProfile } from './stage/profile.js';
import { stageContextHtml } from './stage/context.js';
import { teamStripes, startlistTeamsQuery, splitStartlistTeams } from './team-appearance.js';

const STAGE_TYPE_LABELS = {
  itt: { es: 'CRI', en: 'ITT' },
  ttt: { es: 'CRE', en: 'TTT' },
};

// Construye un Date que representa el instante en el que los relojes locales
// de `tz` marcan `dateStr` (YYYY-MM-DD) + `timeStr` (HH:MM[:SS]).
function raceLocalToInstant(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr || !tz) return null;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m, s = 0] = timeStr.split(':').map(Number);
  if (![Y, M, D, h, m].every(Number.isFinite)) return null;
  const wantedMs = Date.UTC(Y, M - 1, D, h, m, s);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(wantedMs));
  const get = type => Number(parts.find(p => p.type === type).value);
  const projectedMs = Date.UTC(get('year'), get('month') - 1, get('day'),
                               get('hour'), get('minute'), get('second'));
  return new Date(wantedMs - (projectedMs - wantedMs));
}

// "GMT+9", "GMT-5:30" para una TZ IANA en una fecha concreta (DST-correct).
function tzOffsetLabel(tz, atDate) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(atDate);
    const raw = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return raw.replace(/^GMT([+-])0?(\d+):00$/, 'GMT$1$2').replace(/^GMT([+-])0?(\d+):(\d{2})$/, 'GMT$1$2:$3');
  } catch { return ''; }
}

async function init(i18nReady = Promise.resolve()) {
  window.__spaDrivenAnalytics = true;
  const params  = new URLSearchParams(window.location.search);
  const content = document.getElementById('startOrderContent');
  const _isEn   = getLang() === 'en';

  let rdId = params.get('id');
  let slug = params.get('slug');

  if (!rdId && !slug) {
    const m = location.pathname.match(/^\/(orden-salida|en\/start-order|start-order)\/([^\/]+)\/?$/);
    if (m) slug = decodeURIComponent(m[2]);
  }
  // Página pre-renderizada: el build incrusta el id de la jornada.
  if (!rdId && !params.get('slug')) rdId = embeddedId('race-day-id');

  // Jornada con la carrera embebida. Por slug, una sola consulta: en EN se
  // prefiere slugEn y se admite slug.
  const DAY_WITH_RACE = '*,race:races(*)';
  let row = null;
  if (rdId) {
    const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).eq('id', rdId).maybeSingle();
    row = data;
  }
  if (!row && slug) {
    const columns = _isEn ? ['slugEn', 'slug'] : ['slug'];
    const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).or(orEqFilter(columns, slug)).limit(4);
    row = pickByPreference(data, columns, slug);
  }

  if (!row) {
    await i18nReady;
    content.innerHTML = `<div class="startlist-empty">${_isEn ? 'Start order not found.' : 'No se encontró el orden de salida.'}</div>`;
    return;
  }
  const { race, ...rd } = row;
  rdId = rd.id;

  const canonSlug = _isEn ? (rd.slugEn || rd.slug) : rd.slug;
  const canonBase = _isEn ? `${enBase()}/start-order/` : '/orden-salida/';
  history.replaceState(null, '', canonSlug
    ? `${canonBase}${encodeURIComponent(canonSlug)}/`
    : `/orden-salida.html?id=${rdId}`);

  // Orden, assets de la jornada (panel de botones común), equipos de la
  // startlist con su temporada y guía técnica: todo depende solo de la jornada.
  const [{ data: entries, error }, { data: soAssets }, { data: startlistRows }, technicalGuide] = await Promise.all([
    supabase.from('start_order_entries_resolved').select('*').eq('raceDayId', rdId).order('sortOrder', { ascending: true }),
    supabase.from('assets').select('*').eq('raceDayId', rdId),
    startlistTeamsQuery(supabase, rd.raceId, race?.year, 'teamId'),
    race?.id ? loadRaceTechnicalGuide(race.id) : Promise.resolve(null),
    i18nReady,
  ]);

  if (error || !entries || entries.length === 0) {
    content.innerHTML = `<div class="startlist-empty">${_isEn ? 'No start order data available for this stage.' : 'No hay datos de orden de salida para esta jornada.'}</div>`;
    return;
  }

  const raceTeams = splitStartlistTeams(startlistRows, race?.year).teams;
  const teamFor = teamName => teamName ? findMatchingTeam(teamName, raceTeams) : null;

  // Enlaces a fichas retirados; equipos y corredores se muestran como texto.
  const teamHrefFor = (_teamName) => null;
  const riderHrefFor = (_dorsal) => null;

  // CRE (contrarreloj por equipos): salen equipos, no corredores. La vista
  // muestra solo Salida + Equipo (sin dorsal, sin bandera, sin corredor) y sin
  // los filtros Contrarrelojistas/General (que se basan en dorsales de corredor).
  const isTtt = rd.primaryType === 'ttt';

  const ttDorsals = new Set(rd.startOrderTtDorsals || []);
  const gcDorsals = new Set(rd.startOrderGcDorsals || []);
  const hasFilters = !isTtt && (ttDorsals.size > 0 || gcDorsals.size > 0);

  const raceName = getRaceName(race) || '';
  const year = race?.year || '';
  const stageLabel = rd.stageNumber === 0
    ? (_isEn ? 'Prologue' : 'Prólogo')
    : rd.stageNumber != null
      ? (_isEn ? `Stage ${rd.stageNumber}` : `Etapa ${rd.stageNumber}`)
      : '';
  const typeEntry = STAGE_TYPE_LABELS[rd.primaryType];
  const typeLabel = typeEntry ? typeEntry[_isEn ? 'en' : 'es'] : (_isEn ? 'Time trial' : 'Contrarreloj');
  const startLoc = (_isEn ? rd.startLocationEn : null) || rd.startLocation;
  const distLabel = rd.distanceKm ? `${Number(rd.distanceKm).toLocaleString(_isEn ? 'en-GB' : 'es-ES')} km` : '';

  const heroTitle = [raceName, year].filter(Boolean).join(' ');
  const heroSubline = [stageLabel, typeLabel, distLabel].filter(Boolean).join(' · ');
  const stageSuffix = stageLabel ? ` - ${stageLabel}` : '';
  const pageTitle = _isEn
    ? `Start order - ${heroTitle}${stageSuffix}`
    : `Orden de salida - ${heroTitle}${stageSuffix}`;

  document.title = pageTitle;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  setMeta('description', _isEn
    ? `Start order for the ${typeLabel.toLowerCase()} of ${heroTitle}. ${isTtt ? 'Start times for each team.' : 'Individual start times for each rider.'}`
    : `Orden de salida de la ${typeLabel.toLowerCase()} de ${heroTitle}. ${isTtt ? 'Horarios de salida de cada equipo.' : 'Horarios de salida de cada corredor.'}`);
  setMetaProperty('og:title', pageTitle);

  const esOrigin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
  // El canonical siempre apunta a calendariociclismo.app con la ruta correcta por idioma
  const canonicalUrl = canonSlug
    ? (_isEn
        ? `${esOrigin}/en/start-order/${encodeURIComponent(rd.slugEn || rd.slug)}/`
        : `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`)
    : location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
  setRaceRobots(race);
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;

  // hreflang alternates
  const setAlternate = (hreflang, href) => {
    let el = document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`);
    if (!el) { el = document.createElement('link'); el.rel = 'alternate'; el.hreflang = hreflang; document.head.appendChild(el); }
    el.href = href;
  };
  if (!_isEn && rd.slugEn) {
    setAlternate('en', `${esOrigin}/en/start-order/${encodeURIComponent(rd.slugEn || rd.slug)}/`);
  }
  if (_isEn && rd.slug) {
    setAlternate('es', `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`);
    setAlternate('x-default', `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`);
  }

  // Botón back
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    const referrer = document.referrer;
    const sameOrigin = referrer && new URL(referrer, location.href).origin === location.origin;
    if (sameOrigin && referrer) {
      backBtn.href = referrer;
      backBtn.addEventListener('click', e => { e.preventDefault(); history.back(); });
    } else {
      backBtn.href = jornadaUrl(rd);
    }
  }

  const jornadaHref = jornadaUrl(rd);
  const ridersLabel = isTtt
    ? (_isEn ? 'teams' : 'equipos')
    : (_isEn ? 'riders' : 'corredores');
  const startOrderLabel = _isEn ? 'Start order' : 'Orden de salida';
  const contextAssets = withRaceTechnicalGuide(soAssets || [], technicalGuide);

  let html = buildRaceHeader({
    race,
    nameHref: jornadaHref,
    label: startOrderLabel,
    detail: heroSubline,
    stats: `${entries.length} ${ridersLabel}`,
  }) + buildActionButtons({
    race, rd, view: 'startOrder', assets: contextAssets,
    hasStartlist: !!race.startlistImportedAt,
    style: 'margin:0 auto 0.85rem', standalone: true,
  }) + `<div class="res-layout res-layout--context"><div class="res-main">
    ${hasFilters ? `
    <div class="so-filters" id="soFilters">
      <div class="so-filters__inner">
        <button type="button" class="tcat-btn tcat-btn--active" aria-pressed="true" data-filter="all">${_isEn ? 'All' : 'Todos'}</button>
        ${ttDorsals.size > 0 ? `<button type="button" class="tcat-btn" aria-pressed="false" data-filter="tt">${_isEn ? 'TT Specialists' : 'Contrarrelojistas'}</button>` : ''}
        ${gcDorsals.size > 0 ? `<button type="button" class="tcat-btn" aria-pressed="false" data-filter="gc">${_isEn ? 'GC' : 'General'}</button>` : ''}
      </div>
    </div>` : ''}`;

  // ── Conversión a hora del usuario (si la jornada tiene timezone) ──
  const userTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })();
  const raceTz = rd.timezone || null;
  // Fecha de referencia para la conversión: `dateKey` es el campo canónico y
  // NUNCA es null; `date` es legacy y puede faltar (rompía la conversión → se
  // mostraba la hora cruda sin pasar a la zona del usuario).
  const rdDate = rd.dateKey || rd.date;
  // Probe instant: usamos la primera entrada para decidir si las horas coinciden con el usuario.
  let willConvert = false;
  if (raceTz && userTz && raceTz !== userTz && entries[0]) {
    const probe = raceLocalToInstant(rdDate, entries[0].startTime, raceTz);
    if (probe) {
      const raceStr = probe.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: raceTz });
      const userStr = probe.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: userTz });
      willConvert = raceStr !== userStr;
    }
  }
  const locName = startLoc || (raceTz ? raceTz.split('/').pop().replace(/_/g, ' ') : '');
  if (willConvert) {
    const userOffset = tzOffsetLabel(userTz, new Date(rdDate + 'T12:00:00Z'));
    const raceOffset = tzOffsetLabel(raceTz, new Date(rdDate + 'T12:00:00Z'));
    html += `
    <div class="so-tz-note">
      ${_isEn
        ? `Times shown in your local time${userOffset ? ` (${userOffset})` : ''}. Race-local time in ${esc(locName)}${raceOffset ? ` (${raceOffset})` : ''} is shown on hover.`
        : `Horarios en tu hora local${userOffset ? ` (${userOffset})` : ''}. Pasa el ratón para ver la hora oficial en ${esc(locName)}${raceOffset ? ` (${raceOffset})` : ''}.`}
    </div>`;
  }

  html += `
    <div class="so-table-wrap">
      <table class="so-table res-table${isTtt ? ' so-table--teams' : ''}">
        <thead>
          <tr>
            <th class="so-th so-th--time">${_isEn ? 'Start' : 'Salida'}</th>
            ${isTtt ? '' : `<th class="so-th so-th--dorsal">${_isEn ? 'Bib' : 'Dor.'}</th>
            <th class="so-th so-th--rider">${_isEn ? 'Rider' : 'Corredor'}</th>`}
            <th class="so-th so-th--team">${_isEn ? 'Team' : 'Equipo'}</th>
          </tr>
        </thead>
        <tbody>
  `;

  entries.forEach(e => {
    const flagHtml = e.countryCode ? `<span class="so-flag">${countryFlag(e.countryCode)}</span>` : '';
    const name = e.riderName ? esc(e.riderName) : `<span style="opacity:0.45">-</span>`;
    const teamColors = teamStripes(teamFor(e.teamName));
    const team = e.teamName ? `${teamColors}${esc(e.teamName)}` : '';
    const teamHref = teamHrefFor(e.teamName);
    const isTt = ttDorsals.has(e.dorsal);
    const isGc = gcDorsals.has(e.dorsal);

    let timeCell = esc(e.startTime);
    if (willConvert) {
      const inst = raceLocalToInstant(rdDate, e.startTime, raceTz);
      if (inst) {
        const userStr = inst.toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: userTz,
        });
        // Si la fecha-en-zona-del-usuario difiere de la fecha de la carrera, anotar +1d / -1d
        const userDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(inst);
        let dayHint = '';
        if (userDate !== rdDate) {
          const diff = Math.round((Date.parse(userDate) - Date.parse(rdDate)) / 86400000);
          dayHint = diff > 0 ? `+${diff}d ` : `${diff}d `;
        }
        const tip = _isEn
          ? `${e.startTime} local time in ${locName}`
          : `${e.startTime} hora local en ${locName}`;
        timeCell = `<span title="${esc(tip)}">${dayHint ? `<span class="so-day-shift">${dayHint}</span>` : ''}${esc(userStr)}</span>`;
      }
    }

    if (isTtt) {
      // CRE: solo hora + equipo (sin dorsal, sin bandera, sin corredor).
      const teamCell = e.teamName
        ? (teamHref ? `<a class="so-link" href="${esc(teamHref)}">${team}</a>` : team)
        : `<span style="opacity:0.45">-</span>`;
      html += `
          <tr class="so-row">
            <td class="so-td so-td--time">${timeCell}</td>
            <td class="so-td so-td--team">${teamCell}</td>
          </tr>`;
    } else {
      // CRI: el nombre enlaza a la FICHA del corredor (/corredor/<id>/) si su
      // equipo actual es top-división; si no tiene ficha pública, cae al enlace
      // de su equipo (los clubs amateur quedan sin enlace porque teamLinkUrl no
      // resuelve un equipo sin slug). El equipo NUNCA debe ganar al corredor.
      const riderHref = e.riderName ? (riderHrefFor(e.dorsal) || teamHref) : null;
      const riderCell = riderHref
        ? `${flagHtml}<a class="so-link" href="${esc(riderHref)}">${name}</a>`
        : `${flagHtml}${name}`;
      html += `
          <tr class="so-row"${isTt ? ' data-is-tt="1"' : ''}${isGc ? ' data-is-gc="1"' : ''}>
            <td class="so-td so-td--time">${timeCell}</td>
            <td class="so-td so-td--dorsal">${e.dorsal}</td>
            <td class="so-td so-td--rider">${riderCell}</td>
            <td class="so-td so-td--team">${team}</td>
          </tr>`;
    }
  });

  html += `
        </tbody>
      </table>
    </div>
    </div>${stageContextHtml(rd, 'soProfile', { hideNeutralStart: true })}</div>
  `;

  content.innerHTML = html;
  const cleanupProfile = mountStageProfile(document.getElementById('soProfile'), {
    day: rd, race, assets: contextAssets, hidePointNames: true,
  });
  window.addEventListener('pagehide', cleanupProfile, { once: true });

  if (hasFilters) {
    const tableWrap = content.querySelector('.so-table-wrap');
    content.querySelectorAll('#soFilters .tcat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('#soFilters .tcat-btn').forEach(b => setPressed(b, b === btn));
        tableWrap.classList.remove('so-filter--tt', 'so-filter--gc');
        if (btn.dataset.filter !== 'all') tableWrap.classList.add(`so-filter--${btn.dataset.filter}`);
      });
    });
  }
}

// Esperar a cargar las traducciones (en.json) antes de renderizar: el panel de
// botones usa t('assets.*'), que sin esto cae al diccionario ES embebido.
// El diccionario EN se carga a la vez que los datos; init lo espera antes de pintar.
init(initI18n());
