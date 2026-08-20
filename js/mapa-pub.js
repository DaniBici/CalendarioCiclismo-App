// Página pública del MAPA del recorrido (Leaflet) — gemela de perfil-pub.js.
// Misma cabecera, route-grid y listas de puntos clave que el perfil; en lugar
// del SVG de elevación, un mapa interactivo: la LÍNEA sale del GPX crudo en R2
// (race_days.routeGpxUrl) y los MARCADORES de profileSummits/profileWaypoints
// proyectados por kilómetro sobre la traza. Los iconos son los MISMOS que el
// perfil (indicatorBadgeSVG).

import { supabase, esc, stageLabel, formatTimeUser, raceUrl,
         setMeta as setM, setMetaProperty as setMP,
         buildRaceHero, buildStageNav, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide, enBase,
         seoLongDate, articuloNombre, startFinishLabels } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { indicatorBadgeSVG, buildElevationProfileSVG } from './elevation-profile.js';
import { computeClimbStats, effectiveSummitAlt } from './climb-detection.js';

const params  = new URLSearchParams(location.search);
const content = document.getElementById('mapaEtapaContent');
const backBtn = document.getElementById('backBtn');

const SPRINT_TYPES  = new Set(['intermediate_sprint', 'bonus_sprint']);
const TERRAIN_TYPES = new Set(['cobblestone', 'sterrato']);
const TERRAIN_LABELS = new Proxy({}, { get(_, key) { return t(`terrain.${key}`) || key; } });

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

window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente

if (!idOrSlug) {
  content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
} else {
  initI18n().then(() => loadMap(idOrSlug));
}

// ── Load ──────────────────────────────────────────────────────────
async function loadMap(idOrSlug) {
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
  // Sin GPX de mapa → no hay nada que pintar (la página solo existe si hay mapa).
  if (!rd.routeGpxUrl) {
    content.innerHTML = `<p class="pfe-loading">${t('map.notAvailable')}</p>`;
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

  const { data: pfAssets } = await supabase.from('assets').select('*').eq('raceDayId', rd.id);

  let siblings = [];
  if (rd.raceId && race?.raceFormat !== 'one_day') {
    const { data: sData } = await supabase.from('race_days')
      .select('id,slug,slugEn,stageNumber,dateKey,startLocation,finishLocation,startLocationEn,finishLocationEn,isRestDay,neutralStartTimeUtc,routeGpxUrl')
      .eq('raceId', rd.raceId).eq('editorialStatus', 'published');
    if (sData) {
      siblings = sData.sort((a, b) => {
        if (a.stageNumber != null && b.stageNumber != null && a.stageNumber !== b.stageNumber)
          return a.stageNumber - b.stageNumber;
        return (a.dateKey || '').localeCompare(b.dateKey || '');
      });
    }
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
  const pageTitle = `${t('map.pageTitle')} — ${fullTitle} — ${siteName}`;

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
    const deArt = articuloNombre(name) === 'el' ? 'del' : 'de la';
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

    <div class="cc-map-wrap">
      <div id="ccRouteMap" class="cc-map"></div>
      <div class="cc-map-toolbar">
        <button id="ccMapBase" class="cc-map-tbtn is-active">${t('map.baseMap')}</button>
        <button id="ccMapSat" class="cc-map-tbtn">${t('map.satellite')}</button>
        <span class="cc-map-tsep"></span>
        <button id="ccMap2d" class="cc-map-tbtn">2D</button>
        <button id="ccMap3d" class="cc-map-tbtn is-active">3D</button>
        <span class="cc-map-tsep"></span>
        <button id="ccMapProf" class="cc-map-tbtn is-active">${t('map.profile')}</button>
      </div>
      <div id="ccMapProfile" class="cc-map-profile" hidden></div>
    </div>

    ${keyPointsHtml}
  `;

  // ── Botón de edición admin (solo si hay sesión activa) ──
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) return;
    if (document.getElementById('editMapBtn')) return;
    const btn = document.createElement('a');
    btn.id        = 'editMapBtn';
    btn.className = 'edit-jornada-btn';
    btn.href      = '/panel/app.html?perfil=' + encodeURIComponent(rd.id);
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar';
    content.style.position = 'relative';
    content.appendChild(btn);
  });

  // ── Mapa MapLibre (terreno 3D) ────────────────────────────────
  initRouteMap(rd, race, { summits, sprints, terrain, isTimeTrial, isEn, waypoints });
}

// ─────────────────────────────────────────────────────────────────
// MAPA
// ─────────────────────────────────────────────────────────────────
const haversineKm = (a, b, c, d) => {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(c - a), dLon = toRad(d - b);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Salto máximo (km) entre dos puntos consecutivos antes de cortar la línea.
// Algunos GPX de organizadores (ASO: 400+ <trkseg>) traen el recorrido en
// fragmentos que, concatenados a ciegas, dibujan rectas-fantasma de decenas de
// km uniendo trozos lejanos. Cortamos en cada salto > umbral y entre <trkseg>.
const GPX_SEGMENT_BREAK_KM = 1;

// Devuelve { points, segments }:
//  - points:   lista plana {lat,lon,km} con km acumulado en orden del GPX (para
//              proyectar marcadores por km y situar salida/meta).
//  - segments: array de arrays [[lat,lon],...], cada uno una traza CONTINUA
//              (se corta entre <trkseg> y en saltos > GPX_SEGMENT_BREAK_KM) →
//              cada uno se dibuja como una polyline sin unir los huecos.
function parseGpx(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const segNodes = [...doc.getElementsByTagName('trkseg')];
  // Fallback: GPX sin <trkseg> (p.ej. solo <rtept>) → tratar todos los trkpt
  // como un único segmento.
  const rawSegs = segNodes.length
    ? segNodes.map(seg => [...seg.getElementsByTagName('trkpt')])
    : [[...doc.getElementsByTagName('trkpt')]];

  const points = [];
  const segments = [];
  let cur = null;        // segmento contiguo en construcción ([[lat,lon],...])
  let cum = 0;
  let prev = null;       // último punto válido (para km y detección de saltos)

  const flush = () => { if (cur && cur.length > 1) segments.push(cur); cur = null; };

  for (const nodes of rawSegs) {
    // Cada <trkseg> empieza un corte de línea, pero el km sigue acumulando.
    flush();
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute('lat'));
      const lon = parseFloat(n.getAttribute('lon'));
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const eleNode = n.getElementsByTagName('ele')[0];
      const ele = eleNode ? parseFloat(eleNode.textContent) : null;
      let jump = 0;
      if (prev) jump = haversineKm(prev.lat, prev.lon, lat, lon);
      cum += jump;
      points.push({ lat, lon, km: cum, ele: Number.isNaN(ele) ? null : ele });
      // Corte de la línea (no del km) si el salto al punto anterior es grande.
      if (cur && jump > GPX_SEGMENT_BREAK_KM) flush();
      if (!cur) cur = [];
      cur.push([lat, lon]);
      prev = { lat, lon };
    }
  }
  flush();
  return { points, segments };
}

// Proyecta un km de carrera (escalado a la longitud real del GPX) a [lat,lng].
function kmToLatLng(points, officialKm, officialTotal) {
  const gpxTotal = points[points.length - 1].km || 0;
  const targetKm = officialTotal > 0 ? (officialKm / officialTotal) * gpxTotal : officialKm;
  for (let i = 1; i < points.length; i++) {
    if (points[i].km >= targetKm) {
      const a = points[i-1], b = points[i];
      const span = (b.km - a.km) || 1e-9;
      const f = (targetKm - a.km) / span;
      return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
    }
  }
  const last = points[points.length - 1];
  return [last.lat, last.lon];
}

// Ventana de búsqueda (km de GPX) alrededor del km escalado para el snap.
const SNAP_WINDOW_KM = 2.5;
// 1 metro de diferencia de altitud pesa como SNAP_KM_PENALTY km de desvío en
// el score; alto = prioriza estar cerca del km esperado, bajo = prioriza clavar
// la altitud. 8 da buen equilibrio (verificado en el circuito de Montjuïc).
const SNAP_KM_PENALTY = 8;

// Proyecta un punto-clave a coordenadas COMBINANDO km y altitud. En circuitos
// repetidos (mismo lugar pasado N veces) el escalado proporcional puro desvía
// cada pasada; si conocemos la altitud del punto (summit.altitude / waypoint),
// buscamos el punto del GPX que mejor case altitud DENTRO de una ventana de km
// → cada pasada hace snap a SU cima real. Sin altitud o sin <ele> en el GPX →
// fallback al escalado proporcional (kmToLatLng), que va bien en lineales.
function markerLatLng(points, officialKm, officialTotal, altTarget) {
  const hasEle = altTarget != null && points.some(p => p.ele != null);
  if (!hasEle) return kmToLatLng(points, officialKm, officialTotal);
  const gpxTotal = points[points.length - 1].km || 0;
  const center = officialTotal > 0 ? (officialKm / officialTotal) * gpxTotal : officialKm;
  let best = null, bestScore = Infinity;
  for (const p of points) {
    if (p.ele == null) continue;
    const dKm = Math.abs(p.km - center);
    if (dKm > SNAP_WINDOW_KM) continue;
    const score = Math.abs(p.ele - altTarget) + dKm * SNAP_KM_PENALTY;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best ? [best.lat, best.lon] : kmToLatLng(points, officialKm, officialTotal);
}

// Convierte [lat,lon] (helpers de proyección) → [lon,lat] (orden GeoJSON/MapLibre).
const toLngLat = (ll) => [ll[1], ll[0]];

// Base: estilo VECTOR de OpenFreeMap por tema (claro/oscuro), sin clave y con uso
// comercial permitido (sustituye a MapTiler, que invalidó la clave por uso). Es un
// style.json completo (sources + layers propios) → se carga como `style` del mapa
// y nuestras capas (satélite, relieve, recorrido, marcadores) se añaden ENCIMA al
// cargar el estilo (y se re-añaden tras cada cambio de tema con setStyle). Satélite:
// Esri World Imagery (raster, gratis y sin clave). Relieve 3D: DEM de AWS Terrain
// Tiles (terrarium, público y gratis). Ninguno requiere clave ni cuota.
const BASE_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark:  'https://tiles.openfreemap.org/styles/dark',
};
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SAT_ATTRIB = 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const isDarkTheme = () => !document.documentElement.classList.contains('light');

const EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const COLLAPSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

async function initRouteMap(rd, race, ctx) {
  const el = document.getElementById('ccRouteMap');
  if (!el || typeof maplibregl === 'undefined') return;
  const { summits, sprints, terrain, isTimeTrial, isEn, waypoints } = ctx;
  const kmUnit = isEn ? 'km' : ' km';
  const colorHex = race?.colorHex || '#d8442e';
  const totalKm = rd.distanceKm ? Number(rd.distanceKm) : 0;
  const errHtml = `<p style="text-align:center;color:var(--text-muted);padding:2rem">${t('map.loadError')}</p>`;

  let points, segments;
  try {
    const xml = await fetch(rd.routeGpxUrl).then(r => { if (!r.ok) throw new Error('GPX ' + r.status); return r.text(); });
    ({ points, segments } = parseGpx(xml));
  } catch (err) { el.innerHTML = errHtml; return; }
  if (!points.length || !segments.length) { el.innerHTML = errHtml; return; }

  const bounds = new maplibregl.LngLatBounds();
  points.forEach(p => bounds.extend([p.lon, p.lat]));

  // Estado del toolbar (lo refleja setBase/setDim); se conserva entre cambios de
  // tema para reaplicarlo al reconstruir las capas tras setStyle.
  const mapState = { base: 'base', dim: '3d' };

  const map = new maplibregl.Map({
    container: el,
    style: isDarkTheme() ? BASE_STYLE.dark : BASE_STYLE.light, // OpenFreeMap (vector)
    center: [points[0].lon, points[0].lat], zoom: 9, pitch: 60, bearing: -18, maxPitch: 85,
    attributionControl: { compact: true },
  });

  // Añade NUESTRAS capas (satélite Esri, DEM/relieve de AWS, sky, recorrido) ENCIMA
  // del estilo vector de OpenFreeMap. Se ejecuta al cargar el estilo y se RE-EJECUTA
  // tras cada setStyle (cambio de tema), porque setStyle reemplaza sources/layers
  // del estilo (los marcadores DOM, en cambio, sobreviven y se añaden una sola vez).
  const addCustomLayers = () => {
    if (!map.getSource('sat')) {
      map.addSource('sat', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: SAT_ATTRIB });
    }
    if (!map.getSource('terrain')) {
      map.addSource('terrain', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
    }
    // Relieve (hillshade) sobre el callejero + satélite (oculto por defecto) ENCIMA
    // de las capas de OpenFreeMap. El recorrido va sobre ambos.
    if (!map.getLayer('hills')) {
      map.addLayer({ id: 'hills', type: 'hillshade', source: 'terrain', paint: { 'hillshade-exaggeration': 0.45 } });
    }
    if (!map.getLayer('sat')) {
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: mapState.base === 'sat' ? 'visible' : 'none' } });
    }
    try { map.setSky({ 'sky-color': '#7fb4e8', 'horizon-color': '#cfe4f5', 'fog-color': '#dfe7ee', 'fog-ground-blend': 0.4, 'sky-horizon-blend': 0.6 }); } catch (_) {}
    if (mapState.dim === '3d') { try { map.setTerrain({ source: 'terrain', exaggeration: 1.2 }); } catch (_) {} }

    // Recorrido: casing blanco + trazo del color. Una línea por segmento contiguo
    // → los huecos del GPX (saltos) NO se dibujan como rectas. seg es [lat,lon].
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection',
        features: segments.map(seg => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg.map(([la, lo]) => [lo, la]) } })) } });
    }
    if (!map.getLayer('route-casing')) {
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 } });
    }
    if (!map.getLayer('route-line')) {
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorHex, 'line-width': 4.5 } });
    }
  };
  const fitRoute = () => map.fitBounds(bounds, { padding: 40, pitch: 58, bearing: -18, duration: 600 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.scrollZoom.disable();

  // ── Control de expandir (overlay a viewport; sin Fullscreen API por iOS) ──
  // Conmuta una clase que pone el contenedor en position:fixed sobre todo el
  // viewport; tras conmutar, map.resize() recalcula el lienzo.
  const wrap = el.closest('.cc-map-wrap') || el.parentElement;
  let expandBtn = null;
  const setExpanded = (on) => {
    if (!wrap) return;
    wrap.classList.toggle('cc-map--expanded', on);
    document.body.classList.toggle('cc-map-expanded-lock', on); // bloquea scroll de fondo
    if (expandBtn) {
      expandBtn.innerHTML = on ? COLLAPSE_SVG : EXPAND_SVG;
      expandBtn.title = on ? t('map.exitFullscreen') : t('map.fullscreen');
    }
    setTimeout(() => { map.resize(); fitRoute(); }, 60);
  };
  const expandCtrl = {
    onAdd() {
      const c = document.createElement('div');
      c.className = 'maplibregl-ctrl maplibregl-ctrl-group cc-map-expand-ctrl';
      expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.innerHTML = EXPAND_SVG;
      expandBtn.title = t('map.fullscreen');
      expandBtn.addEventListener('click', () => setExpanded(!wrap.classList.contains('cc-map--expanded')));
      c.appendChild(expandBtn);
      this._c = c;
      return c;
    },
    onRemove() { this._c?.remove(); },
  };
  map.addControl(expandCtrl, 'top-right');
  const onKey = (e) => { if (e.key === 'Escape' && wrap?.classList.contains('cc-map--expanded')) setExpanded(false); };
  document.addEventListener('keydown', onKey);
  map.on('remove', () => document.removeEventListener('keydown', onKey));

  // ── Cambio de tema (claro/oscuro): recargar el estilo de OpenFreeMap ──
  // theme.js muta la clase de <html>; con un estilo VECTOR completo hay que
  // recargarlo con setStyle (no basta setTiles). setStyle reemplaza las capas
  // del estilo → reconstruimos las nuestras al cargar el nuevo (style.load).
  let curDark = isDarkTheme();
  const themeObserver = new MutationObserver(() => {
    const d = isDarkTheme();
    if (d === curDark) return;
    curDark = d;
    map.setStyle(d ? BASE_STYLE.dark : BASE_STYLE.light);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  map.on('remove', () => themeObserver.disconnect());
  // Reconstruir nuestras capas tras CADA carga de estilo (inicial y por setStyle).
  map.on('style.load', addCustomLayers);

  map.on('load', () => {
    const addMarker = (node, lngLat, popupHtml) =>
      new maplibregl.Marker({ element: node, anchor: 'center' })
        .setLngLat(lngLat)
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(popupHtml))
        .addTo(map);
    const pinNode = (svg) => { const n = document.createElement('div'); n.className = 'cc-map-pin'; n.innerHTML = svg; return n; };
    const flagNode = (which, glyph) => { const n = document.createElement('div'); n.className = `cc-map-flag cc-map-flag--${which}`; n.textContent = glyph; return n; };

    // Salida y meta.
    addMarker(flagNode('start', '▶'), [points[0].lon, points[0].lat],
      `<b>${t('map.start')}</b><br><span class="cc-map-km">${t('profile.kmLabel')} 0</span>`);
    const finishKmLabel = totalKm ? Number(totalKm).toLocaleString(isEn ? 'en-GB' : 'es-ES') : '';
    const fp = points[points.length - 1];
    addMarker(flagNode('finish', '🏁'), [fp.lon, fp.lat],
      `<b>${t('map.finish')}</b>${finishKmLabel ? `<br><span class="cc-map-km">${t('profile.kmLabel')} ${finishKmLabel}</span>` : ''}`);

    // Puertos (snap por altitud → en circuitos repetidos cada paso cae en su cima).
    summits.forEach(s => {
      if (s.km == null) return;
      const cat = (s.category && s.category !== 'M') ? ` · ${t('profile.cat')} ${s.category}` : '';
      const altRaw = effectiveSummitAlt(s, rd.elevationProfile?.points);
      const ll = markerLatLng(points, s.km, totalKm, altRaw);
      const alt = altRaw != null ? ` · ${fmt(altRaw, isEn ? ',' : '.')} m` : '';
      addMarker(pinNode(indicatorBadgeSVG('summit', s, { size: 26 })), toLngLat(ll),
        `<b>${esc(s.name || t('profile.climbsOne'))}</b><br><span class="cc-map-km">${s.km}${kmUnit}${cat}${alt}</span>`);
    });

    // Sprints / puntos intermedios.
    sprints.forEach(w => {
      if (w.km == null) return;
      const lbl = isTimeTrial ? t('profile.splitsOne') : (w.type === 'bonus_sprint' ? t('profile.bonusSprint') : t('profile.intSprint'));
      addMarker(pinNode(indicatorBadgeSVG(w.type, w, { size: 26 })), toLngLat(kmToLatLng(points, w.km, totalKm)),
        `<b>${esc(w.name || lbl)}</b><br><span class="cc-map-km">${lbl} · ${w.km}${kmUnit}</span>`);
    });

    // Sectores (pavé / sterrato).
    terrain.forEach(w => {
      if (w.km == null) return;
      const lbl = (rd.primaryType === 'ribinou' && w.type === 'sterrato') ? t('terrain.ribinou') : (TERRAIN_LABELS[w.type] ?? w.type);
      addMarker(pinNode(indicatorBadgeSVG(w.type, w, { size: 26 })), toLngLat(kmToLatLng(points, w.km, totalKm)),
        `<b>${esc(w.name || lbl)}</b><br><span class="cc-map-km">${lbl} · ${w.km}${kmUnit}</span>`);
    });

    fitRoute();
    renderProfileOverlay(rd, { summits, waypoints, colorHex, isEn });
  });

  wireMapControls(map, fitRoute, mapState);
}

// Perfil SVG superpuesto al fondo del mapa (silueta iconsOnly, a todo el ancho).
function renderProfileOverlay(rd, { summits, waypoints, colorHex, isEn }) {
  const host = document.getElementById('ccMapProfile');
  if (!host) return;
  if (!rd.elevationProfile?.points?.length) {
    document.getElementById('ccMapProf')?.setAttribute('disabled', ''); // sin perfil → toggle inerte
    return;
  }
  const { svg, hoverData } = buildElevationProfileSVG({
    profile: rd.elevationProfile, summits, waypoints,
    width: 1200, height: 360, color: colorHex, lang: isEn ? 'en' : 'es', iconsOnly: true,
  });
  host.innerHTML = svg;
  // Recortar el viewBox al área de dibujo (ML/MR/MB salen de hoverData, sin
  // hardcodear) → la silueta toca ambos bordes y llega al fondo; preserveAspect
  // por defecto (meet) para no deformar los badges; height natural del recorte.
  const svgEl = host.querySelector('svg');
  if (svgEl && hoverData) {
    const { ML, MR, width, BL } = hoverData;
    svgEl.setAttribute('viewBox', `${ML} 0 ${width - ML - MR} ${BL}`);
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
  }
  host.hidden = false;
}

// Controles del toolbar: base (mapa/satélite) · 2D/3D · mostrar/ocultar perfil.
// `state` se comparte con addCustomLayers para reaplicar la elección tras un
// cambio de tema (setStyle reconstruye las capas).
function wireMapControls(map, fitRoute, state) {
  const base = document.getElementById('ccMapBase'), sat = document.getElementById('ccMapSat');
  const b2d = document.getElementById('ccMap2d'), b3d = document.getElementById('ccMap3d');
  const prof = document.getElementById('ccMapProf');

  // "Mapa" = ocultar el satélite (queda el callejero vector de OpenFreeMap debajo);
  // "Satélite" = mostrar la capa raster de Esri por encima.
  const setBase = (which) => {
    state.base = which;
    if (map.getLayer('sat')) map.setLayoutProperty('sat', 'visibility', which === 'sat' ? 'visible' : 'none');
    base?.classList.toggle('is-active', which === 'base');
    sat?.classList.toggle('is-active', which === 'sat');
  };
  base?.addEventListener('click', () => setBase('base'));
  sat?.addEventListener('click', () => setBase('sat'));

  const setDim = (dim) => {
    state.dim = dim;
    if (dim === '3d') { try { map.setTerrain({ source: 'terrain', exaggeration: 1.2 }); } catch (_) {} map.easeTo({ pitch: 60, duration: 500 }); }
    else              { try { map.setTerrain(null); } catch (_) {} map.easeTo({ pitch: 0, bearing: 0, duration: 500 }); }
    b3d?.classList.toggle('is-active', dim === '3d');
    b2d?.classList.toggle('is-active', dim === '2d');
  };
  b2d?.addEventListener('click', () => setDim('2d'));
  b3d?.addEventListener('click', () => setDim('3d'));

  prof?.addEventListener('click', () => {
    if (prof.hasAttribute('disabled')) return;
    const host = document.getElementById('ccMapProfile');
    const show = host.hidden;
    host.hidden = !show;
    prof.classList.toggle('is-active', show);
  });
}

function fmt(v, sep = '.') {
  return v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : '?';
}
