// ─────────────────────────────────────────────────────────────────
//  PERFIL Y MAPA — HTML del contenido de /perfil/ y /mapa/, sin DOM
//  Lo usan js/perfil-pub.js y js/mapa-pub.js (pintado en el navegador) y el
//  paso de build tools/site/prerender-auxiliares.mjs. Misma regla de marcado
//  que js/jornada-html.js: nada que dependa del dispositivo, del ancho, de
//  localStorage ni del momento de carga, y decimales con tablas fijas
//  (js/fixed-number.js). El navegador compara su huella con la del HTML del
//  build (js/html-fingerprint.js).
// ─────────────────────────────────────────────────────────────────

import { esc, formatTimeUser, raceUrl, rdLocation, buildRaceHero, buildStageNav, buildActionButtons,
         perfilUrl, enBase, startFinishLabels } from './shared.js';
import { fixedDecimal } from './fixed-number.js';
import { t, getLang } from './i18n.js';
import { stageProfileHtml } from './stage/profile.js';
import { computeClimbStats, effectiveSummitAlt } from './stage/climb-detection.js';
import { splitWaypoints, terrainLabel } from './route-map.js';

/** Aviso en lugar del contenido (perfil no visible, mapa no disponible…). */
export function stagePageNoticeHtml(key) {
  return `<p class="pfe-loading">${t(key)}</p>`;
}

// URL de la página de mapa (ruta limpia ES/EN), espejo de perfilUrl.
function mapaUrl(rd) {
  if (getLang() === 'en') {
    const s = rd.slugEn || rd.slug;
    return s ? `${enBase()}/route-map/${encodeURIComponent(s)}/` : `${enBase()}/route-map/?id=${rd.id}`;
  }
  return rd.slug ? `/mapa/${encodeURIComponent(rd.slug)}/` : `/mapa.html?id=${rd.id}`;
}

const ARROW_SVG = `<svg class="route-arrow" viewBox="0 0 14 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="7" y1="0" x2="7" y2="17" stroke-width="1.5" stroke-linecap="round"/><polyline points="3,13 7,19 11,13" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// Recorrido, distancia y horarios. Las horas llevan su instante en
// <time datetime>, como en la jornada.
function routeGridHtml(rd, race) {
  const isEn = getLang() === 'en';
  const startName  = rdLocation(rd, 'startLocation');
  const finishName = rdLocation(rd, 'finishLocation');
  const sameLocation = startName && (!finishName || startName === finishName);
  const recorridoHtml = !startName
    ? `<div class="route-block__note route-block__note--empty">${t('stage.noData')}</div>`
    : sameLocation
      ? `<div class="route-block__place route-block__place--solo">${startName}</div><div class="route-block__note">${t('search.startAndFinish')}</div>`
      : `<div class="route-block__place">${startName}</div>${ARROW_SVG}<div class="route-block__place">${finishName || '-'}</div>`;

  const kmHtml = rd.distanceKm
    ? `<div class="route-block__km">${fixedDecimal(rd.distanceKm, { lang: isEn ? 'en' : 'es' })}${isEn ? 'km' : ' km'}</div>`
    : `<div class="route-block__km route-block__km--empty">-</div>`;
  const elevGain = rd.elevationProfile?.elevationGain;
  const elevHtml = elevGain != null
    ? `<div class="route-block__elev">+${String(Math.round(elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, isEn ? ',' : '.')} m</div>`
    : '';
  const tipoHtml = rd.primaryType === 'itt' || rd.primaryType === 'ttt'
    ? `<div class="route-block__type">${t(`types.${rd.primaryType}`)}</div>`
    : '';

  const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  const start  = startTU?.display  ?? null;
  const finish = finishTU?.display ?? null;
  const tzDiffers = !!(startTU?.tooltip || finishTU?.tooltip);
  const { startLabel, finishLabel } = startFinishLabels(rd, race);
  const startTip  = tzDiffers ? t('profile.startMadrid').replace('{time}', startTU?.tooltip ?? start) : startLabel;
  const finishTip = tzDiffers ? t('profile.finishMadrid').replace('{time}', finishTU?.tooltip ?? finish) : finishLabel;
  const timeTag = (iso, text) => `<time datetime="${esc(iso)}">${text}</time>`;
  let horariosHtml;
  if (start && finish) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${startTip}">${timeTag(rd.neutralStartTimeUtc, start)}</div>${ARROW_SVG}<div class="route-block__place" data-tooltip="${finishTip}">${timeTag(rd.estimatedFinishTimeUtc, finish)}</div>`;
  } else if (start) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${startTip}">${timeTag(rd.neutralStartTimeUtc, start)}</div><div class="route-block__note">${startLabel}</div>`;
  } else if (finish) {
    horariosHtml = `<div class="route-block__place" data-tooltip="${finishTip}">${timeTag(rd.estimatedFinishTimeUtc, finish)}</div><div class="route-block__note">${finishLabel}</div>`;
  } else {
    horariosHtml = `<div class="route-block__note route-block__note--empty">${t('stage.noSchedule')}</div>`;
  }

  return `<div class="jornada-section jornada-section--route-grid" style="margin-bottom:1.25rem">
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
}

// Selector de etapas, cabecera de carrera, botones y rejilla, comunes a las
// dos páginas. `view`: 'perfil' o 'mapa' (buildActionButtons omite el botón
// de la propia vista).
function stagePageHeadHtml({ rd, race, siblings, assets, view, urlBuilder }) {
  const stageNavHtml = buildStageNav(siblings.filter(s => !s.isRestDay), rd.id, urlBuilder, raceUrl(race));
  // Margen superior (como en jornada, orden y resultados) para que el panel no
  // se pegue al separador inferior de la cabecera (.race-header).
  const actionButtonsHtml = race ? buildActionButtons({
    race, rd, view, assets, hasStartlist: !!race.startlistImportedAt,
    style: 'margin:1.25rem auto 0.85rem', standalone: true,
  }) : '';
  return `${stageNavHtml}${buildRaceHero(rd, race)}${actionButtonsHtml}${routeGridHtml(rd, race)}`;
}

/**
 * HTML de #perfilEtapaContent. El perfil y los puntos clave salen de
 * stageProfileHtml(), con el gráfico vacío que dibuja mountStageProfile sobre
 * #pfeProfile; sin perfil que mostrar, el aviso de que no hay elevación.
 */
export function perfilHtml({ rd, race, siblings = [], assets = [] }) {
  const profile = stageProfileHtml(rd, race || {}, assets, { points: true });
  const profileHtml = profile
    ? `<div id="pfeProfile" class="${profile.className}">${profile.html}</div>`
    : stagePageNoticeHtml('profile.noElevation');
  return `${stagePageHeadHtml({ rd, race, siblings, assets, view: 'perfil', urlBuilder: perfilUrl })}${profileHtml}`;
}

const fmtInt = (v, sep = '.') => (v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : '?');

// Puntos clave del mapa: puertos, sprints (o parciales en una contrarreloj) y
// sectores, en cajas como las del perfil.
function mapKeyPointsHtml(rd) {
  const isEn = getLang() === 'en';
  const kmUnit = isEn ? 'km' : ' km';
  const summits = rd.profileSummits ?? [];
  const { sprints, terrain, isTimeTrial } = splitWaypoints(rd.profileWaypoints ?? [], rd.primaryType);
  const profilePts = rd.elevationProfile?.points;
  const box = (title, items) => `<div class="pfe-box">
          <p class="pfe-box-title">${title} (${items.length})</p>
          ${items.map(([km, parts]) => `<div class="pfe-item"><b>${km != null ? `${km}${kmUnit}` : '?'}</b>${esc(parts.filter(Boolean).join(' · '))}</div>`).join('')}
        </div>`;

  const summitsBox = summits.length ? box(t('profile.climbs'), summits.map(s => {
    const altRaw = effectiveSummitAlt(s, profilePts);
    let climb = null;
    if (s.startKm != null && s.km != null && profilePts?.length) {
      const stats = computeClimbStats(profilePts, s.startKm, s.km, s.altitude ?? null);
      if (stats) climb = `${stats.lengthKm}${kmUnit} · ${stats.avgGradient >= 0 ? '' : '−'}${Math.abs(stats.avgGradient).toFixed(1)}%`;
    }
    return [s.km, [s.name?.trim() || null, climb, altRaw != null ? `${fmtInt(altRaw, isEn ? ',' : '.')} m` : null,
      s.category && s.category !== 'M' ? `Cat. ${s.category}` : null]];
  })) : '';
  const sprintsBox = sprints.length ? box(isTimeTrial ? t('profile.splits') : t('profile.sprints'), sprints.map(w => [w.km,
    [w.name?.trim() || null, isTimeTrial ? null : (w.type === 'bonus_sprint' ? t('profile.bonusSprint') : t('profile.intSprint'))]])) : '';
  const terrainBox = terrain.length ? box(t('profile.sectors'), terrain.map(w => [w.km,
    [w.name?.trim() || null, terrainLabel(w.type, rd.primaryType), w.lengthKm != null ? `${w.lengthKm}${kmUnit}` : null]])) : '';

  const boxes = [summitsBox, sprintsBox, terrainBox].filter(Boolean);
  return boxes.length ? `<div class="pfe-section">
      <p class="pfe-section-title">${t('profile.keyPoints')}</p>
      <div class="pfe-grid${boxes.length === 1 ? ' pfe-grid--single' : ''}">
        ${boxes.join('')}
      </div>
    </div>` : '';
}

/**
 * HTML de #mapaEtapaContent: el contenedor del mapa va vacío (lo monta
 * mountRouteMap, con alto reservado en css/app.css) y debajo los puntos clave.
 */
export function mapaHtml({ rd, race, siblings = [], assets = [] }) {
  return `${stagePageHeadHtml({ rd, race, siblings, assets, view: 'mapa', urlBuilder: mapaUrl })}<div class="cc-map-wrap" id="ccRouteMapWrap"></div>${mapKeyPointsHtml(rd)}`;
}
