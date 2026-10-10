// Página pública del MAPA del recorrido — gemela de perfil-pub.js.
// Misma cabecera, route-grid y listas de puntos clave que el perfil; en lugar
// del SVG de elevación, el mapa interactivo de route-map.js, que recibe el GPX
// de Storage (race_days.routeGpxUrl) y los profileSummits/profileWaypoints.
// Esta página carga los datos de Supabase y fija el SEO.

import { supabase, esc, stageLabel, formatTimeUser, raceUrl,
         setMeta as setM, setMetaProperty as setMP,
         buildRaceHero, buildStageNav, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, enBase,
         seoLongDate, deArticulo, startFinishLabels, setRaceRobots,
         embeddedId, orEqFilter, pickByPreference } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { computeClimbStats, effectiveSummitAlt } from './stage/climb-detection.js';
import { mountRouteMap, splitWaypoints, terrainLabel } from './route-map.js';

const params  = new URLSearchParams(location.search);
const content = document.getElementById('mapaEtapaContent');
const backBtn = document.getElementById('backBtn');

// URL de la página gemela (clean URL ES/EN) — espejo de perfilUrl en shared.js.
function mapaUrl(rd) {
  const isEn = getLang() === 'en';
  if (isEn) {
    const s = rd.slugEn || rd.slug;
    return s ? `${enBase()}/route-map/${encodeURIComponent(s)}/` : `${enBase()}/route-map/?id=${rd.id}`;
  }
  return rd.slug ? `/mapa/${encodeURIComponent(rd.slug)}/` : `/mapa.html?id=${rd.id}`;
}

// ── Resolve id/slug — pathname takes priority for clean URLs ─────
function slugFromPath() {
  const m = location.pathname.match(/\/(?:mapa|(?:en\/)?route-map)\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}
const idOrSlug = slugFromPath() || params.get('slug') || params.get('id');

// Columnas de la carrera embebida en la jornada.
const RACE_COLUMNS = 'id,slug,slugEn,name,nameEn,year,logoUrl,hideFlag,gender,uciCategory,raceFormat,colorHex,countryCode,websiteUrl,startlistImportedAt,startlistProvisional';

window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente

if (!idOrSlug) {
  content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
} else {
  // El diccionario EN se carga a la vez que los datos; se espera antes de pintar.
  loadMap(idOrSlug, initI18n());
}

// ── Load ──────────────────────────────────────────────────────────
async function loadMap(idOrSlug, i18nReady = Promise.resolve()) {
  const cols = [
    'id','slug','slugEn','raceId','dateKey','stageNumber','isRestDay','isCancelledDay',
    'startLocation','finishLocation','startLocationEn','finishLocationEn','distanceKm','countryCode',
    'neutralStartTimeUtc','estimatedFinishTimeUtc',
    'primaryType','secondaryType','startOrderImportedAt','profileNotViewable',
    'elevationProfile','profileSummits','profileWaypoints','routeGpxUrl',
  ].join(',');

  // Página pre-renderizada: el build incrusta el id de la jornada. Si no,
  // una sola consulta por slug, slugEn o id (en ese orden de preferencia),
  // con la carrera embebida.
  const select = `${cols},race:races(${RACE_COLUMNS})`;
  const pageId = embeddedId('race-day-id');
  let row = null, error = null;
  if (pageId) ({ data: row, error } = await supabase.from('race_days').select(select).eq('id', pageId).maybeSingle());
  if (!row && !error) {
    const columns = ['slug', 'slugEn', 'id'];
    const response = await supabase.from('race_days').select(select).or(orEqFilter(columns, idOrSlug)).limit(3);
    error = response.error;
    row = pickByPreference(response.data, columns, idOrSlug);
  }
  const { race: raceRow = null, ...rd } = row || {};
  await i18nReady;

  if (error || !row) {
    content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
    return;
  }
  // Sin GPX de mapa → no hay nada que pintar (la página solo existe si hay mapa).
  if (!rd.routeGpxUrl) {
    content.innerHTML = `<p class="pfe-loading">${t('map.notAvailable')}</p>`;
    return;
  }

  const race = raceRow;
  // Guía técnica, assets de la jornada (panel de botones) y etapas hermanas
  // (navegación, solo en carreras por etapas) dependen solo de la jornada.
  const [technicalGuide, { data: pfAssets }, siblingsResult] = await Promise.all([
    race?.id ? loadRaceTechnicalGuide(race.id) : Promise.resolve(null),
    supabase.from('assets').select('*').eq('raceDayId', rd.id),
    rd.raceId && race?.raceFormat !== 'one_day'
      ? supabase.from('race_days')
        .select('id,slug,slugEn,stageNumber,dateKey,startLocation,finishLocation,startLocationEn,finishLocationEn,isRestDay,neutralStartTimeUtc,routeGpxUrl')
        .eq('raceId', rd.raceId).eq('editorialStatus', 'published')
      : Promise.resolve({ data: null }),
  ]);

  let siblings = [];
  const sData = siblingsResult.data;
  if (sData) {
    siblings = sData.sort((a, b) => {
      if (a.stageNumber != null && b.stageNumber != null && a.stageNumber !== b.stageNumber)
        return a.stageNumber - b.stageNumber;
      return (a.dateKey || '').localeCompare(b.dateKey || '');
    });
  }

  const isEn = getLang() === 'en';
  const stageSlug = isEn && rd.slugEn ? rd.slugEn : rd.slug;
  const _pEnB = isEn ? enBase() : null;
  const jornadaHref = isEn
    ? (stageSlug ? `${_pEnB}/stage/${encodeURIComponent(stageSlug)}/` : `/jornada.html?id=${rd.id}`)
    : (rd.slug   ? `/jornada/${encodeURIComponent(rd.slug)}/`    : `/jornada.html?id=${rd.id}`);

  if (backBtn) {
    backBtn.href = jornadaHref;
    backBtn.setAttribute('aria-label', t('profile.backToStage'));
  }

  render(rd, race, siblings, jornadaHref, withRaceTechnicalGuide(pfAssets || [], technicalGuide));
}

// ── Render ────────────────────────────────────────────────────────
function render(rd, race, siblings, jornadaHref, assets = []) {
  const isEn    = getLang() === 'en';
  const summits   = rd.profileSummits   ?? [];
  const waypoints = rd.profileWaypoints ?? [];
  const { sprints, terrain, isTimeTrial } = splitWaypoints(waypoints, rd.primaryType);

  const name  = (isEn && race?.nameEn) || race?.name || '';
  const year  = race?.year ?? '';
  const stage = stageLabel(rd.stageNumber);

  // ── Title & SEO ───────────────────────────────────────────────
  const racePart  = name ? `${name}${year ? ' ' + year : ''}` : '';
  const stagePart = (!rd.isRestDay && rd.stageNumber != null) ? stage : '';
  const fullTitle = [racePart, stagePart].filter(Boolean).join(' · ');
  const siteName  = t('seo.siteName');
  const pageTitle = `${t('map.pageTitle')} - ${fullTitle} - ${siteName}`;

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
    head = sn == null ? `Route map of ${racePart}`
         : sn === 0   ? `Route map of the prologue of ${racePart}`
         :              `Route map of stage ${sn} of ${racePart}`;
  } else {
    const deArt = deArticulo(name);
    head = sn == null ? `Mapa del recorrido de ${racePart}`
         : sn === 0   ? `Mapa del recorrido del prólogo ${deArt} ${racePart}`
         :              `Mapa del recorrido de la ${sn}ª etapa ${deArt} ${racePart}`;
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

  const canonicalBase = isEn ? 'https://calendariociclismo.app/en/route-map/' : 'https://calendariociclismo.app/mapa/';
  const canonicalFallback = isEn
    ? `https://calendariociclismo.app/en/route-map/?id=${rd.id}`
    : `https://calendariociclismo.app/mapa.html?id=${rd.id}`;
  const mapSlug = (isEn && rd.slugEn) ? rd.slugEn : rd.slug;
  const canonical = mapSlug
    ? `${canonicalBase}${encodeURIComponent(mapSlug)}/`
    : canonicalFallback;
  setRaceRobots(race);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);

  if (!isEn && rd.slugEn) {
    const enUrl = `https://calendariociclismo.app/en/route-map/${encodeURIComponent(rd.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (isEn && rd.slug) {
    const esUrl = `https://calendariociclismo.app/mapa/${encodeURIComponent(rd.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // Limpiar URL si llegamos por ?id= o ?slug= con slug disponible
  const _enB = isEn ? enBase() : null;
  const cleanBase = isEn ? `${_enB}/route-map/` : '/mapa/';
  const isCleanPath = location.pathname.startsWith(cleanBase) && location.pathname !== cleanBase;
  if (mapSlug && !isCleanPath) {
    history.replaceState({}, '', `${cleanBase}${encodeURIComponent(mapSlug)}/`);
  }
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

  // ── Stage nav ─────────────────────────────────────────────────
  const navSiblings = siblings.filter(s => !s.isRestDay);
  const stageNavHtml = buildStageNav(navSiblings, rd.id, mapaUrl, raceUrl(race));

  // ── Race hero ─────────────────────────────────────────────────
  const heroHtml = buildRaceHero(rd, race);

  // ── Panel de botones (web oficial · ir a la etapa · inscritos · perfil) ──
  const actionButtonsHtml = race ? buildActionButtons({
    race, rd, view: 'mapa', assets,
    hasStartlist: !!race.startlistImportedAt,
    style: 'margin:1.25rem auto 0.85rem', standalone: true,
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
      : `<div class="route-block__place">${startName}</div>${arrowSvg}<div class="route-block__place">${finishName || '-'}</div>`;
  } else {
    recorridoHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noData')}</div>`;
  }

  const kmLocale = isEn ? 'en-GB' : 'es-ES';
  const kmUnit = isEn ? 'km' : ' km';
  const kmFormatted = rd.distanceKm ? Number(rd.distanceKm).toLocaleString(kmLocale) : null;
  const kmHtml = kmFormatted
    ? `<div class="route-block__km">${kmFormatted}${kmUnit}</div>`
    : `<div class="route-block__km route-block__km--empty">-</div>`;
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

  // ── Puntos clave (mismas cajas que el perfil) ─────────────────
  const profilePts = rd.elevationProfile?.points;
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
            const label  = terrainLabel(w.type, rd.primaryType);
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

    <div class="cc-map-wrap" id="ccRouteMapWrap"></div>

    ${keyPointsHtml}
  `;

  // ── Mapa MapLibre (terreno 3D) ────────────────────────────────
  mountRouteMap(document.getElementById('ccRouteMapWrap'), {
    gpxUrl: rd.routeGpxUrl, distanceKm: rd.distanceKm, colorHex: race?.colorHex,
    elevationProfile: rd.elevationProfile, summits, waypoints,
    primaryType: rd.primaryType, lang: isEn ? 'en' : 'es',
  });
}

function fmt(v, sep = '.') {
  return v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : '?';
}
