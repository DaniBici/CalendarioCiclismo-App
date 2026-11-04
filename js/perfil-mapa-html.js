// ─────────────────────────────────────────────────────────────────
//  PERFIL Y MAPA — HTML del contenido de /perfil/ y /mapa/, sin DOM
//  Lo usan js/perfil-pub.js y js/mapa-pub.js (pintado en el navegador) y el
//  paso de build tools/site/prerender-auxiliares.mjs. Misma regla de marcado
//  que js/jornada-html.js: nada que dependa del dispositivo, del ancho, de
//  localStorage ni del momento de carga, y decimales con tablas fijas
//  (js/fixed-number.js). El navegador compara su huella con la del HTML del
//  build (js/html-fingerprint.js).
// ─────────────────────────────────────────────────────────────────

import { esc, formatTimeUser, timeWithDay, raceUrl, buildRaceHero, buildStageNav, raceSideStageList, buildActionLinks,
         buildStageTiles, buildRaceFacts, buildRaceBreadcrumb, raceCrumbItems, raceDateKeys, raceLayoutHtml,
         stageLabel, jornadaUrl, perfilUrl, enBase, startFinishLabels } from './shared.js';
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

// Horario de la etapa para la última tesela (como en la jornada): salida y
// meta en la zona del visitante, con la hora de Madrid en el tooltip si
// difiere. Las horas llevan su instante en <time datetime>.
function scheduleTile(rd, race) {
  if (rd.isCancelledDay) return null;
  const startTU  = formatTimeUser(rd.neutralStartTimeUtc, rd.dateKey);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc, rd.dateKey);
  const start  = timeWithDay(startTU);
  const finish = timeWithDay(finishTU);
  if (!start && !finish) return null;
  const tzDiffers = !!(startTU?.tooltip || finishTU?.tooltip);
  const { startLabel, finishLabel } = startFinishLabels(rd, race);
  const zone = tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone');
  const parts = [start && `${startLabel}: ${start}`, finish && `${finishLabel}: ${finish}`].filter(Boolean).join(' · ');
  const madrid = tzDiffers ? ` · Madrid: ${[startTU?.tooltip ?? start, finishTU?.tooltip ?? finish].filter(Boolean).join(' - ')}` : '';
  const timeTag = (iso, text) => (iso ? `<time datetime="${esc(iso)}">${text}</time>` : text);
  return {
    label: t('stage.tileSchedule'),
    value: [start, finish].filter(Boolean).join(' - '),
    html: [start && timeTag(rd.neutralStartTimeUtc, start), finish && timeTag(rd.estimatedFinishTimeUtc, finish)].filter(Boolean).join(' - '),
    tooltip: `${parts}${madrid} (${zone})`,
  };
}

// Página completa con la composición de la ficha de jornada: en escritorio,
// selector de etapas, cabecera, enlaces de la carrera y lista de etapas en la
// columna lateral; migas de pan (… › Etapa › Perfil interactivo), pestañas,
// teselas y `bodyHtml` en la principal. `view`: 'perfil' o 'mapa'
// (buildActionLinks omite la pestaña de la propia vista).
function stagePageHtml({ rd, race, siblings, assets, view, urlBuilder, bodyHtml }) {
  const navSiblings = siblings.filter(s => !s.isRestDay);
  const r = race || {};
  const { start: raceStart, end: raceEnd } = raceDateKeys(r, siblings.length ? siblings : [rd]);
  const facts = race ? buildRaceFacts(race, { startKey: raceStart, endKey: raceEnd, countryCode: race.hideFlag ? '' : race.countryCode }) : '';
  const { bar, side } = race ? buildActionLinks({
    race, rd, view, assets, hasStartlist: !!race.startlistImportedAt, style: 'margin-bottom:0.85rem', standalone: true,
  }) : { bar: '', side: '' };
  const tiles = buildStageTiles(rd, r, { last: scheduleTile(rd, r) });
  const isOneDay = r.raceFormat === 'one_day';
  const crumbs = raceCrumbItems(r, { stageText: isOneDay ? '' : stageLabel(rd.stageNumber, rd._stageSuffix) });
  // La etapa enlaza a su ficha y la vista cierra las migas.
  const stageCrumb = crumbs[crumbs.length - 1];
  if (crumbs.length > 1) stageCrumb.href = jornadaUrl(rd);
  crumbs.push({ label: t(view === 'mapa' ? 'assets.mapInteractive' : 'assets.profileInteractive'), href: '' });
  return raceLayoutHtml({
    navHtml: buildStageNav(navSiblings, rd.id, urlBuilder, raceUrl(r)),
    headerHtml: buildRaceHero(rd, race, { facts }),
    sideLinksHtml: side,
    sideExtraHtml: raceSideStageList(race, navSiblings, { currentId: rd.id, href: urlBuilder }),
    crumbsHtml: buildRaceBreadcrumb(crumbs),
    mainHtml: `${bar}${tiles ? `<div class="jornada-section jornada-section--route-grid">${tiles}</div>` : ''}${bodyHtml}`,
    facts: !!facts,
  });
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
  return stagePageHtml({ rd, race, siblings, assets, view: 'perfil', urlBuilder: perfilUrl, bodyHtml: profileHtml });
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
  return stagePageHtml({ rd, race, siblings, assets, view: 'mapa', urlBuilder: mapaUrl,
    bodyHtml: `<div class="cc-map-wrap" id="ccRouteMapWrap"></div>${mapKeyPointsHtml(rd)}` });
}
