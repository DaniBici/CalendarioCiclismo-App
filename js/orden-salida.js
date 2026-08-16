// ─────────────────────────────────────────────────────────────────
//  ORDEN DE SALIDA — Contrarreloj individual / por equipos
//  URL: orden-salida.html?id=RD_ID  o  /orden-salida/RD_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, esc, setMeta, setMetaProperty, jornadaUrl,
         raceUrl, raceName as getRaceName, enBase, startOrderUrl,
         findMatchingTeam, buildRaceHeader, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, buildTeamBadgeSvg, setPressed } from './shared.js';
import { getLang, initI18n } from './i18n.js';

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

async function init() {
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

  let rd = null;
  if (slug && !rdId) {
    // EN paths use slugEn; ES paths use slug
    const slugField = _isEn ? 'slugEn' : 'slug';
    const { data } = await supabase
      .from('race_days')
      .select('*')
      .eq(slugField, slug)
      .single();
    // fallback: if not found by slugEn, try slug
    if (!data && _isEn) {
      const { data: d2 } = await supabase
        .from('race_days')
        .select('*')
        .eq('slug', slug)
        .single();
      rd = d2;
    } else {
      rd = data;
    }
    if (rd) rdId = rd.id;
  } else if (rdId) {
    const { data } = await supabase
      .from('race_days')
      .select('*')
      .eq('id', rdId)
      .single();
    rd = data;
  }

  if (!rd) {
    content.innerHTML = `<div class="startlist-empty">${_isEn ? 'Start order not found.' : 'No se encontró el orden de salida.'}</div>`;
    return;
  }

  const canonSlug = _isEn ? (rd.slugEn || rd.slug) : rd.slug;
  const canonBase = _isEn ? `${enBase()}/start-order/` : '/orden-salida/';
  history.replaceState(null, '', canonSlug
    ? `${canonBase}${encodeURIComponent(canonSlug)}/`
    : `/orden-salida.html?id=${rdId}`);

  const { data: race } = await supabase
    .from('races')
    .select('*')
    .eq('id', rd.raceId)
    .single();

  const { data: entries, error } = await supabase
    .from('start_order_entries_resolved')
    .select('*')
    .eq('raceDayId', rdId)
    .order('sortOrder', { ascending: true });

  // Assets de la jornada (rutómetro/perfil/puertos/mapa/live texto) para el
  // panel de botones común. Solo en pruebas de un día se muestran (la salvedad
  // se aplica en inscritos; aquí, al ser una etapa concreta, siempre van).
  const { data: soAssets } = await supabase.from('assets').select('*').eq('raceDayId', rdId);

  if (error || !entries || entries.length === 0) {
    content.innerHTML = `<div class="startlist-empty">${_isEn ? 'No start order data available for this stage.' : 'No hay datos de orden de salida para esta jornada.'}</div>`;
    return;
  }

  // Equipos de la carrera (para enlazar a /equipo/<slug>/): en CRI cada corredor
  // enlaza a su equipo; en CRE cada equipo enlaza a su página. Resolvemos el slug
  // por nombre con findMatchingTeam contra los equipos de la startlist (su teamId
  // → teams.slug). Silencioso si falla → simplemente no se enlaza.
  let raceTeams = [];
  {
    const { data: slTeams } = await supabase
      .from('startlist_teams').select('teamId').eq('raceId', rd.raceId);
    const teamIds = [...new Set((slTeams || []).map(s => s.teamId).filter(Boolean))];
    if (teamIds.length) {
      const { data } = await supabase
        .from('teams')
        .select('id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle')
        .in('id', teamIds);
      raceTeams = data || [];
    }
  }
  // Equipo canónico por nombre (de él salen href y chapa).
  const teamFor = (teamName) => {
    if (!teamName || !raceTeams.length) return null;
    return findMatchingTeam(teamName, raceTeams) || null;
  };
  // Enlaces a fichas (equipo y corredor) retirados → siempre null; el render
  // cae a texto plano. teamFor se conserva para la chapa del equipo.
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
  const finishLoc = (_isEn ? rd.finishLocationEn : null) || rd.finishLocation;
  const sameOrOne = !finishLoc || startLoc === finishLoc;
  const routeLabel = sameOrOne
    ? (startLoc || finishLoc || '')
    : `${startLoc} › ${finishLoc}`;
  const distLabel = rd.distanceKm ? `${rd.distanceKm} km` : '';

  const heroTitle = [raceName, year].filter(Boolean).join(' ');
  const heroSubline = [stageLabel, typeLabel, routeLabel, distLabel].filter(Boolean).join(' · ');
  const stageSuffix = stageLabel ? ` — ${stageLabel}` : '';
  const pageTitle = _isEn
    ? `Start order — ${heroTitle}${stageSuffix}`
    : `Orden de salida — ${heroTitle}${stageSuffix}`;

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
  const startOrderLabel = _isEn ? 'Start order' : 'Orden de Salida';

  let html = buildRaceHeader({
    race,
    nameHref: jornadaHref,
    label: startOrderLabel,
    detail: heroSubline,
    stats: `${entries.length} ${ridersLabel}`,
  }) + buildActionButtons({
    race, rd, view: 'startOrder', assets: withRaceTechnicalGuide(soAssets || [], await loadRaceTechnicalGuide(race.id)),
    hasStartlist: !!race.startlistImportedAt,
    style: 'max-width:860px;padding:0 1.5rem;margin:0.85rem auto',
  }) + `

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
      <table class="so-table${isTtt ? ' so-table--teams' : ''}">
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
    const name = e.riderName ? esc(e.riderName) : `<span style="opacity:0.45">—</span>`;
    const team = e.teamName ? esc(e.teamName) : '';
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
      // El equipo enlaza a su página /equipo/<slug>/ y lleva su chapa a la izda.
      const teamObj = teamFor(e.teamName);
      const badge = teamObj ? buildTeamBadgeSvg(teamObj, { size: 16, className: 'so-team-badge' }) : '';
      const teamInner = e.teamName
        ? (teamHref ? `<a class="so-link" href="${esc(teamHref)}">${esc(e.teamName)}</a>` : esc(e.teamName))
        : `<span style="opacity:0.45">—</span>`;
      const teamCell = `<span class="so-team-cell">${badge}${teamInner}</span>`;
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
  `;

  content.innerHTML = html;

  // ── Botón de edición admin (solo si hay sesión activa) ──
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) return;
    const existing = document.getElementById('editOrdenSalidaBtn');
    if (existing) return;
    const btn = document.createElement('a');
    btn.id        = 'editOrdenSalidaBtn';
    btn.className = 'edit-jornada-btn';
    btn.href      = '/panel/app.html?edit=' + encodeURIComponent(rdId) + '&tab=mas';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar orden de salida';
    const hero = content.querySelector('.race-header');
    if (hero) hero.appendChild(btn);
    else document.body.appendChild(btn);
  });

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
initI18n().then(init);
