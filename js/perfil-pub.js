import { supabase, esc, stageLabel, formatTimeUser, raceUrl,
         setMeta as setM, setMetaProperty as setMP,
         buildRaceHero, buildStageNav, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, perfilUrl, enBase,
         seoLongDate, articuloNombre, startFinishLabels } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { buildElevationProfileSVG } from './elevation-profile.js';
import { setupElevationProfileHover } from './elevation-profile-hover.js';
import { computeClimbStats, effectiveSummitAlt } from './climb-detection.js';

const params  = new URLSearchParams(location.search);
const content = document.getElementById('perfilEtapaContent');
const backBtn = document.getElementById('backBtn');

const SPRINT_TYPES  = new Set(['intermediate_sprint', 'bonus_sprint']);
const TERRAIN_TYPES = new Set(['cobblestone', 'sterrato']);
const TERRAIN_LABELS = new Proxy({}, { get(_, key) { return t(`terrain.${key}`) || key; } });

// ── Resolve id/slug — pathname takes priority for clean URLs ─────
function slugFromPath() {
  const m = location.pathname.match(/\/(?:perfil|(?:en\/)?profile)\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}
const idOrSlug = slugFromPath() || params.get('slug') || params.get('id');

window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente

if (!idOrSlug) {
  content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
} else {
  initI18n().then(() => loadProfile(idOrSlug));
}

// ── Load ──────────────────────────────────────────────────────────
async function loadProfile(idOrSlug) {
  const isEn = getLang() === 'en';
  const cols = [
    'id','slug','slugEn','raceId','dateKey','stageNumber','isRestDay','isCancelledDay',
    'startLocation','finishLocation','startLocationEn','finishLocationEn','distanceKm','countryCode',
    'neutralStartTimeUtc','estimatedFinishTimeUtc',
    'primaryType','secondaryType','startOrderImportedAt','profileNotViewable',
    'elevationProfile','profileSummits','profileWaypoints','routeGpxUrl',
  ].join(',');

  let { data: rd, error } = await supabase.from('race_days').select(cols).eq('slug', idOrSlug).maybeSingle();
  if (!rd && !error)
    ({ data: rd, error } = await supabase.from('race_days').select(cols).eq('slugEn', idOrSlug).maybeSingle());
  if (!rd && !error)
    ({ data: rd, error } = await supabase.from('race_days').select(cols).eq('id', idOrSlug).maybeSingle());

  if (error || !rd) {
    content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
    return;
  }

  if (rd.profileNotViewable) {
    content.innerHTML = `<p class="pfe-loading">${t('profile.notAvailable')}</p>`;
    return;
  }

  let race = null;
  if (rd.raceId) {
    const { data: r } = await supabase.from('races')
      .select('id,slug,slugEn,name,nameEn,year,logoUrl,hideFlag,gender,uciCategory,raceFormat,colorHex,countryCode,websiteUrl,startlistImportedAt,startlistProvisional')
      .eq('id', rd.raceId).maybeSingle();
    race = r;
  }
  const technicalGuide = race?.id ? await loadRaceTechnicalGuide(race.id) : null;

  // Assets de la jornada (rutómetro/puertos/mapa/live texto) para el panel.
  const { data: pfAssets } = await supabase.from('assets').select('*').eq('raceDayId', rd.id);

  // Siblings for stage nav (only for multi-stage races)
  let siblings = [];
  if (rd.raceId && race?.raceFormat !== 'one_day') {
    const { data: sData } = await supabase.from('race_days')
      .select('id,slug,slugEn,stageNumber,dateKey,startLocation,finishLocation,startLocationEn,finishLocationEn,isRestDay,neutralStartTimeUtc')
      .eq('raceId', rd.raceId).eq('editorialStatus', 'published');
    if (sData) {
      siblings = sData.sort((a, b) => {
        if (a.stageNumber != null && b.stageNumber != null && a.stageNumber !== b.stageNumber)
          return a.stageNumber - b.stageNumber;
        return (a.dateKey || '').localeCompare(b.dateKey || '');
      });
    }
  }

  const stageSlug = isEn && rd.slugEn ? rd.slugEn : rd.slug;
  const _pEnB = isEn ? enBase() : null;
  const jornadaHref = isEn
    ? (stageSlug ? `${_pEnB}/stage/${encodeURIComponent(stageSlug)}/` : `/jornada.html?id=${rd.id}`)
    : (rd.slug   ? `/jornada/${encodeURIComponent(rd.slug)}/`    : `/jornada.html?id=${rd.id}`);

  // La flecha de retroceso lleva SIEMPRE a la jornada del perfil,
  // independientemente de dónde se haya llegado.
  if (backBtn) {
    backBtn.href = jornadaHref;
    backBtn.setAttribute('aria-label', t('profile.backToStage'));
  }

  render(rd, race, siblings, jornadaHref, withRaceTechnicalGuide(pfAssets || [], technicalGuide));
}

// ── Render ────────────────────────────────────────────────────────
function render(rd, race, siblings, jornadaHref, assets = []) {
  const isEn    = getLang() === 'en';
  const profile   = rd.elevationProfile ?? null;
  const summits   = rd.profileSummits   ?? [];
  const waypoints = rd.profileWaypoints ?? [];
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  const sprints   = isTimeTrial
    ? waypoints.filter(w => w.type === 'intermediate_split')
    : waypoints.filter(w => SPRINT_TYPES.has(w.type));
  const terrain   = waypoints.filter(w => TERRAIN_TYPES.has(w.type));

  const name  = (isEn && race?.nameEn) || race?.name || '';
  const year  = race?.year ?? '';
  const stage = stageLabel(rd.stageNumber);

  // ── Title & SEO ───────────────────────────────────────────────
  const racePart  = name ? `${name}${year ? ' ' + year : ''}` : '';
  const stagePart = (!rd.isRestDay && rd.stageNumber != null) ? stage : '';
  const fullTitle = [racePart, stagePart].filter(Boolean).join(' · ');
  const siteName  = t('seo.siteName');
  const pageTitle = `${t('profile.pageTitle')} — ${fullTitle} — ${siteName}`;

  // «Perfil y recorrido de [la Nª etapa del] X 2026: NNN km con salida en A
  // y meta en B. D de mes de YYYY.» — espejo en og-pages.yml (perfiles ES/EN).
  const startLoc  = (isEn && rd.startLocationEn)  || rd.startLocation  || '';
  const finishLoc = (isEn && rd.finishLocationEn) || rd.finishLocation || '';
  const circuit   = !finishLoc || startLoc === finishLoc;
  const kmTxt     = rd.distanceKm ? `${Number(rd.distanceKm).toLocaleString(isEn ? 'en-GB' : 'es-ES')} km` : '';
  let locTxt = '';
  if (startLoc) {
    if (isEn) locTxt = circuit ? `starting and finishing in ${startLoc}` : `from ${startLoc} to ${finishLoc}`;
    else      locTxt = circuit ? `con inicio y final en ${startLoc}` : `con salida en ${startLoc} y meta en ${finishLoc}`;
  }
  const isOneDay = race?.raceFormat === 'one_day';
  const sn = (!isOneDay && !rd.isRestDay && rd.stageNumber != null) ? rd.stageNumber : null;
  let head;
  if (isEn) {
    head = sn == null ? `Profile and route of ${racePart}`
         : sn === 0   ? `Profile and route of the prologue of ${racePart}`
         :              `Profile and route of stage ${sn} of ${racePart}`;
  } else {
    const deArt = articuloNombre(name) === 'el' ? 'del' : 'de la';
    head = sn == null ? `Perfil y recorrido de ${racePart}`
         : sn === 0   ? `Perfil y recorrido del prólogo ${deArt} ${racePart}`
         :              `Perfil y recorrido de la ${sn}ª etapa ${deArt} ${racePart}`;
  }
  const descTail = [kmTxt, locTxt].filter(Boolean).join(' ');
  let desc = descTail ? `${head}: ${descTail}.` : `${head}.`;
  if (rd.dateKey) desc += ` ${seoLongDate(rd.dateKey, isEn ? 'en' : 'es')}.`;

  document.title = pageTitle;
  setM('description', desc);
  setMP('og:title',       pageTitle);
  setMP('og:description', desc);
  setMP('og:url',         location.href);
  setM('twitter:title',       pageTitle);
  setM('twitter:description', desc);

  const canonicalBase = isEn ? 'https://calendariociclismo.app/en/profile/' : 'https://calendariociclismo.app/perfil/';
  const canonicalFallback = isEn
    ? `https://calendariociclismo.app/en/profile/?id=${rd.id}`
    : `https://calendariociclismo.app/perfil.html?id=${rd.id}`;
  const profileSlug = (isEn && rd.slugEn) ? rd.slugEn : rd.slug;
  const canonical = profileSlug
    ? `${canonicalBase}${encodeURIComponent(profileSlug)}/`
    : canonicalFallback;
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);

  // Expose cross-language alternates for lang switcher
  if (!isEn && rd.slugEn) {
    const enUrl = `https://calendariociclismo.app/en/profile/${encodeURIComponent(rd.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (isEn && rd.slug) {
    const esUrl = `https://calendariociclismo.app/perfil/${encodeURIComponent(rd.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // Limpiar URL si llegamos por ?id= o ?slug= con slug disponible
  const _profEnB = isEn ? enBase() : null;
  const cleanBase = isEn ? `${_profEnB}/profile/` : '/perfil/';
  const isCleanPath = location.pathname.startsWith(cleanBase) && location.pathname !== cleanBase;
  if (profileSlug && !isCleanPath) {
    history.replaceState({}, '', `${cleanBase}${encodeURIComponent(profileSlug)}/`);
  }
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

  // ── Stage nav ─────────────────────────────────────────────────
  const navSiblings = siblings.filter(s => !s.isRestDay);
  const stageNavHtml = buildStageNav(navSiblings, rd.id, perfilUrl, raceUrl(race));

  // ── Race hero (logo, bandera, nombre, categoría, fecha) ───────
  const heroHtml = buildRaceHero(rd, race);

  // ── Panel de botones (web oficial · ir a la etapa · inscritos · recorrido) ──
  // Vista DE una etapa → "Ir a la etapa" en vueltas por etapas. Se excluye el
  // botón "Perfil" (es la vista propia).
  const actionButtonsHtml = race ? buildActionButtons({
    race, rd, view: 'perfil', assets,
    hasStartlist: !!race.startlistImportedAt,
    // Margen superior (como en jornada/orden/resultados) para que el panel no se
    // pegue al separador inferior de la cabecera (.race-header border-bottom).
    style: 'max-width:860px;padding:0 1.5rem;margin:1.25rem auto 0.85rem',
  }) : '';

  // ── Route grid (recorrido, distancia, horarios) ───────────────
  const arrowSvg = `<svg class="route-arrow" viewBox="0 0 14 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="7" y1="0" x2="7" y2="17" stroke-width="1.5" stroke-linecap="round"/><polyline points="3,13 7,19 11,13" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

  const startName  = (isEn && rd.startLocationEn)  || rd.startLocation  || '';
  const finishName = (isEn && rd.finishLocationEn) || rd.finishLocation || '';

  const sameLocation = startName && (!finishName || startName === finishName);
  let recorridoHtml = '';
  if (startName) {
    recorridoHtml = sameLocation
      ? `<div class="route-block__place route-block__place--solo">${startName}</div><div class="route-block__note">${t('search.startAndFinish')}</div>`
      : `<div class="route-block__place">${startName}</div>${arrowSvg}<div class="route-block__place">${finishName || '—'}</div>`;
  } else {
    recorridoHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noData')}</div>`;
  }

  const kmLocale = isEn ? 'en-GB' : 'es-ES';
  const kmUnit = isEn ? 'km' : ' km';
  const kmFormatted = rd.distanceKm ? Number(rd.distanceKm).toLocaleString(kmLocale) : null;
  const kmHtml = kmFormatted
    ? `<div class="route-block__km">${kmFormatted}${kmUnit}</div>`
    : `<div class="route-block__km route-block__km--empty">—</div>`;
  const _elevGain = rd.elevationProfile?.elevationGain;
  const elevHtml = _elevGain != null
    ? `<div class="route-block__elev">+${String(Math.round(_elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, isEn ? ',' : '.')} m</div>`
    : '';
  const tipoHtml = isTimeTrial
    ? `<div class="route-block__type">${t(`types.${rd.primaryType}`)}</div>`
    : '';

  const startTU   = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU  = formatTimeUser(rd.estimatedFinishTimeUtc);
  const start     = startTU?.display  ?? null;
  const finish    = finishTU?.display ?? null;
  const tzDiffers = !!(startTU?.tooltip || finishTU?.tooltip);
  const startMadridTime  = startTU?.tooltip  ?? start;
  const finishMadridTime = finishTU?.tooltip ?? finish;
  const { startLabel, finishLabel } = startFinishLabels(rd, race);
  const startTipText  = tzDiffers
    ? t('profile.startMadrid').replace('{time}', startMadridTime)
    : startLabel;
  const finishTipText = tzDiffers
    ? t('profile.finishMadrid').replace('{time}', finishMadridTime)
    : finishLabel;

  let horariosHtml = '';
  if (start && finish) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${start}</div>${arrowSvg}<div class="route-block__place" data-tooltip="${finishTipText}">${finish}</div>`;
  } else if (start) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${startTipText}">${start}</div><div class="route-block__note">${startLabel}</div>`;
  } else if (finish) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${finishTipText}">${finish}</div><div class="route-block__note">${finishLabel}</div>`;
  } else {
    horariosHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noSchedule')}</div>`;
  }

  const routeGridHtml = `
    <div class="jornada-section jornada-section--route-grid" style="margin-bottom:1.25rem">
      <div class="route-grid">
        <div class="route-grid__block">
          <div class="route-grid__title">${t('stage.route')}</div>
          <div class="route-grid__body route-grid__body--route">${recorridoHtml}</div>
        </div>
        <div class="route-grid__block">
          <div class="route-grid__title">${t('profile.distance')}</div>
          <div class="route-grid__body">${kmHtml}${elevHtml}${tipoHtml}</div>
        </div>
        <div class="route-grid__block">
          <div class="route-grid__title" data-tooltip="${tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone')}">${t('stage.schedule')}</div>
          <div class="route-grid__body route-grid__body--route">${horariosHtml}</div>
        </div>
      </div>
    </div>`;

  // ── SVG ───────────────────────────────────────────────────────
  // Móvil (<600 px): altura reducida un 40 % (440 → 264) para que el perfil
  // no domine la pantalla y se vea junto al route grid sin scroll.
  const svgW = Math.min(window.innerWidth - 32, 860);
  const svgH = svgW < 600 ? 264 : 440;
  const { svg: svgStr, hoverData } = buildElevationProfileSVG({
    profile,
    summits,
    waypoints,
    startLocation:  startName,
    finishLocation: finishName,
    width:  svgW,
    height: svgH,
    color:  race?.colorHex || null,
    lang:   getLang(),
  });

  // ── Puntos clave ──────────────────────────────────────────────
  const profilePts = profile?.points;
  const summitsBoxHtml = summits.length
    ? `<div class="pfe-box">
          <p class="pfe-box-title">${t('profile.climbs')} (${summits.length})</p>
          ${summits.map(s => {
            const km  = s.km != null ? `${s.km}${kmUnit}` : '?';
            const altRaw = effectiveSummitAlt(s, profilePts);
            const alt = altRaw != null ? fmt(altRaw, isEn ? ',' : '.') + ' m' : null;
            const cat = (s.category && s.category !== 'M') ? `Cat. ${s.category}` : null;
            let climbStr = null;
            if (s.startKm != null && s.km != null && profilePts?.length) {
              const stats = computeClimbStats(profilePts, s.startKm, s.km, s.altitude ?? null);
              if (stats) {
                const sign = stats.avgGradient >= 0 ? '' : '−';
                climbStr = `${stats.lengthKm}${kmUnit} · ${sign}${Math.abs(stats.avgGradient).toFixed(1)}%`;
              }
            }
            const parts = [s.name?.trim() || null, climbStr, alt, cat].filter(Boolean);
            return `<div class="pfe-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const sprintBoxTitle = isTimeTrial ? t('profile.splits') : t('profile.sprints');
  const sprintsBoxHtml = sprints.length
    ? `<div class="pfe-box">
          <p class="pfe-box-title">${sprintBoxTitle} (${sprints.length})</p>
          ${sprints.map(w => {
            const km   = w.km != null ? `${w.km}${kmUnit}` : '?';
            const type = isTimeTrial
              ? null
              : (w.type === 'bonus_sprint' ? t('profile.bonusSprint') : t('profile.intSprint'));
            const parts = [w.name?.trim() || null, type].filter(Boolean);
            return `<div class="pfe-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const terrainBoxHtml = terrain.length
    ? `<div class="pfe-box">
          <p class="pfe-box-title">${t('profile.sectors')} (${terrain.length})</p>
          ${terrain.map(w => {
            const km     = w.km != null ? `${w.km}${kmUnit}` : '?';
            const label  = (rd.primaryType === 'ribinou' && w.type === 'sterrato')
              ? t('terrain.ribinou')
              : (TERRAIN_LABELS[w.type] ?? w.type);
            const name   = w.name?.trim() || null;
            const length = w.lengthKm != null ? `${w.lengthKm}${kmUnit}` : null;
            const parts  = [name, label, length].filter(Boolean);
            return `<div class="pfe-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const boxCount = [summitsBoxHtml, sprintsBoxHtml, terrainBoxHtml].filter(Boolean).length;
  const keyPointsHtml = boxCount > 0
    ? `<div class="pfe-section">
      <p class="pfe-section-title">${t('profile.keyPoints')}</p>
      <div class="pfe-grid${boxCount === 1 ? ' pfe-grid--single' : ''}">
        ${summitsBoxHtml}
        ${sprintsBoxHtml}
        ${terrainBoxHtml}
      </div>
    </div>`
    : '';

  content.innerHTML = `
    ${stageNavHtml}
    ${heroHtml}
    ${actionButtonsHtml}
    ${routeGridHtml}

    <div class="pfe-svg-wrap">${profile ? svgStr : `<p style="text-align:center;color:var(--text-muted);padding:2rem">${t('profile.noElevation')}</p>`}</div>

    ${keyPointsHtml}
  `;

  // ── Botón de edición admin (solo si hay sesión activa) ──
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) return;
    const existing = document.getElementById('editPerfilBtn');
    if (existing) return;
    const btn = document.createElement('a');
    btn.id        = 'editPerfilBtn';
    btn.className = 'edit-jornada-btn';
    btn.href      = '/panel/app.html?perfil=' + encodeURIComponent(rd.id);
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar perfil';
    // content es el <main class="pfe-wrap"> — anclar ahí para evitar el overflow del svg-wrap
    content.style.position = 'relative';
    content.appendChild(btn);
  });

  // Setup interactive hover effect on elevation profile
  if (profile && hoverData) {
    const svgElement = content.querySelector('.ep-detailed');
    if (svgElement) {
      setupElevationProfileHover(svgElement, hoverData);
    }
  }
}

function fmt(v, sep = '.') {
  return v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : '?';
}
