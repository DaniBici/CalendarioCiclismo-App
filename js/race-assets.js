// ─────────────────────────────────────────────────────────────────
//  RACE ASSETS — botones de assets + badge de TV + modales de asset/perfil
//  Extraído de competicion.js para compartir entre competición y la
//  página de Campeonatos. Importar este módulo instala los globals
//  window.openAssetModal / window.openDynPerfilModal como efecto secundario.
// ─────────────────────────────────────────────────────────────────

import { formatTime, tsSeconds, rdLocation, enBase, esc } from './shared.js';
import { pickBadgeBroadcast } from './broadcast-priority.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { t, getLang } from './i18n.js';
import { buildElevationProfileSVG } from './elevation-profile.js';
import { setupElevationProfileHover } from './elevation-profile-hover.js';

// rd data keyed by id para el modal de perfil SVG dinámico
const _dynPerfilRdMap = {};

const _tvSvgC       = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const _liveTextSvgC = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>';

export const ASSET_ICONS  = { roadbook: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>', profile: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>', map: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>' };
export const ASSET_TITLES = { roadbook: 'Rutómetro', profile: 'Perfil', map: 'Mapa' };

// ── Badge de TV ───────────────────────────────────────────────────
export function tvBadge(tvStatus, broadcasts, neutralStartTs, liveTextUrl, rdId = null, regionBlocked = false, noFullStage = false) {
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para que se muestren los broadcasts (filtrados
  // por región) o nada si no hay ninguno.
  if (tvStatus === 'unavailable_es' && getLang() === 'en') tvStatus = null;

  if (!tvStatus && !(broadcasts && broadcasts.length)) return '';

  if (tvStatus === 'none')           return '<span class="badge badge--notv">Sin TV</span>';
  if (tvStatus === 'unavailable_es') return '<span class="badge badge--notv-es"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><line x1="3" y1="2" x2="21" y2="18"/></svg> No TV España</span>';
  if (tvStatus === 'pending')        return '<span class="badge badge--pend">Sin confirmar</span>';

  // Cobertura confirmada (tvStatus) pero TODA la TV es de fuera de la región del
  // usuario (sus broadcasts se filtraron por región) → no hay emisión accesible:
  // NO mostramos el badge "TV" genérico. (Solo aplica cuando había broadcasts y
  // ninguno sobrevivió al filtro; sin broadcasts el badge sigue saliendo de tvStatus.)
  if (regionBlocked && !(broadcasts && broadcasts.length)) return '';

  // Enlace del badge: una emisión YA EN DIRECTO gana a una que aún no ha empezado
  // (aunque esta sea de mayor tier), luego tier (YouTube > redes > RTVE.es > resto)
  // y sortOrder. Ver `pickBadgeBroadcast`. Espejo iOS/Android.
  const linkBroadcast = pickBadgeBroadcast(broadcasts, tsSeconds, Date.now() / 1000);
  const linkUrl = linkBroadcast?.url || null;
  // Los proveedores de la allowlist se abren en el modal inline.
  const broadcastEmbed = getBroadcastEmbed(linkUrl, linkBroadcast?.embeddable);
  const wrapTv = (content, liveClass) => {
    const extra = liveClass ? ' badge--tv--live' : '';
    return linkUrl
      ? `<a class="badge badge--tv badge--tv-link${extra}" href="${linkUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()"${broadcastEmbed ? ` data-tv-embed="1"${rdId ? ` data-tv-rd-id="${rdId}"` : ''}` : ''}>${content}</a>`
      : `<span class="badge badge--tv${extra}">${content}</span>`;
  };

  // Hora del badge = la emisión accesible que ANTES empieza (aunque el enlace
  // prioritario arranque más tarde): si una emisión global (ALL) empieza antes que
  // las de tu grupo, su hora manda. El ENLACE sigue por prioridad de tier; solo se
  // desacopla la hora MOSTRADA de cuál es el enlace.
  const refTs = (broadcasts || [])
    .filter(b => b.startTimeUtc)
    .sort((a, b) => (tsSeconds(a.startTimeUtc) ?? 0) - (tsSeconds(b.startTimeUtc) ?? 0))[0]
    ?.startTimeUtc ?? null;

  if (refTs) {
    const neutralMs = neutralStartTs
      ? (neutralStartTs.toDate ? neutralStartTs.toDate().getTime() : new Date(neutralStartTs).getTime())
      : null;
    const refMs = refTs.toDate ? refTs.toDate().getTime() : new Date(refTs).getTime();
    const nowMs = Date.now();
    if (tvStatus === 'confirmed_time' && refMs <= nowMs) {
      return wrapTv(`${_tvSvgC} Live`, true);
    }
    // `noFullStage` (rejilla de Campeonatos): nunca mostramos "TV íntegra"; siempre
    // un horario, para que toda celda tenga una hora visible tenga TV o no.
    const label = (!noFullStage && neutralMs !== null && refMs <= neutralMs) ? t('tv.fullStage') : formatTime(refTs);
    // Live texto junto al TV mientras la carrera ya empezó pero la TV sigue en reposo
    const raceStarted = neutralMs !== null && nowMs >= neutralMs;
    const liveTextHtml = (liveTextUrl && raceStarted && refMs > nowMs)
      ? `<a class="badge badge--livetext" href="${liveTextUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${_liveTextSvgC} Live texto</a>`
      : '';
    return wrapTv(`${_tvSvgC} ${label}`) + liveTextHtml;
  }
  return wrapTv(`${_tvSvgC} TV`);
}

// ── Botones de assets (rutómetro / perfil / mapa) ─────────────────
// Devuelve el HTML (string) de los botones de asset de una jornada, con
// el mismo comportamiento que la vista de competición: assets R2 abren
// modal en desktop (≥768px), enlace externo en móvil; el perfil dinámico
// (GPX+anotaciones) tiene prioridad sobre el asset estático de tipo profile.
// `colorHex` se usa para colorear el perfil dinámico en su modal.
export function buildAssetButtons(rd, { colorHex = null } = {}) {
  const assetOrder = ['roadbook', 'profile', 'map'];
  const hasDynProfile1  = !!(rd.elevationProfile && !rd.profileNotViewable);
  const hasDynMap1      = !!rd.routeGpxUrl;
  // NOTA: en la rejilla de Campeonatos (único consumidor de estos badges) el
  // perfil interactivo tiene PRIORIDAD sobre el asset estático (un solo badge),
  // como siempre. La opción "Perfil oficial / Perfil interactivo" se ofrece solo
  // en la JORNADA de la carrera (buildActionButtons / modal / apps), no aquí.
  const validAssets = (rd._assets || [])
    .filter(a => (a.url || a.filePath) && a.type !== 'live_text' && a.type !== 'ports' && a.type !== 'startOrder'
                 && !(hasDynProfile1 && a.type === 'profile')
                 && !(hasDynMap1 && a.type === 'map'))
    .sort((a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type));
  const assetBtnsArr = validAssets.map(a => {
    const url      = a.url || a.filePath;
    const icon     = ASSET_ICONS[a.type] || '';
    const title    = ASSET_TITLES[a.type] || a.type;
    const isR2     = url.startsWith('https://assets.calendariociclismo.app');
    const isDesktop = window.innerWidth >= 768;
    if (isR2 && isDesktop) {
      const safeUrl = url.replace(/'/g, "\\'");
      const safeTxt = title.replace(/'/g, "\\'");
      return `<button class="badge badge--asset" title="${title}" style="cursor:pointer;border:none" onclick="event.stopPropagation();openAssetModal('${safeUrl}','${safeTxt}')">${icon}</button>`;
    }
    return `<a class="badge badge--asset" href="${url}" target="_blank" rel="noopener" title="${title}" style="text-decoration:none" onclick="event.stopPropagation()">${icon}</a>`;
  });
  if (hasDynProfile1) {
    rd._colorHex = colorHex || null;
    _dynPerfilRdMap[rd.id] = rd;
    const _isEnComp = getLang() === 'en';
    const _compEnB = _isEnComp ? enBase() : null;
    const _compProfSlug = _isEnComp ? (rd.slugEn || rd.slug) : rd.slug;
    const extUrl = _isEnComp
      ? (_compProfSlug ? `${_compEnB}/profile/${encodeURIComponent(_compProfSlug)}/` : `${_compEnB}/profile/?id=${rd.id}`)
      : (rd.slug ? `/perfil/${encodeURIComponent(rd.slug)}/`     : `/perfil.html?id=${rd.id}`);
    const profilePos = assetOrder.indexOf('profile');
    const insertAt = assetBtnsArr.findIndex((_, i) => assetOrder.indexOf(validAssets[i]?.type ?? '') > profilePos);
    const btn = `<button class="badge badge--asset" title="Perfil" style="cursor:pointer;border:none" onclick="event.stopPropagation();openDynPerfilModal('${rd.id}','${extUrl}')">${ASSET_ICONS.profile}</button>`;
    insertAt === -1 ? assetBtnsArr.push(btn) : assetBtnsArr.splice(insertAt, 0, btn);
  }
  // Mapa interactivo: enlace a la página /mapa/ (no modal — es página completa).
  // `map` es el último del assetOrder → se añade al final.
  if (hasDynMap1) {
    const _isEnMap = getLang() === 'en';
    const _mapEnB  = _isEnMap ? enBase() : null;
    const _mapSlug = _isEnMap ? (rd.slugEn || rd.slug) : rd.slug;
    const mapUrl = _isEnMap
      ? (_mapSlug ? `${_mapEnB}/route-map/${encodeURIComponent(_mapSlug)}/` : `${_mapEnB}/route-map/?id=${rd.id}`)
      : (rd.slug ? `/mapa/${encodeURIComponent(rd.slug)}/` : `/mapa.html?id=${rd.id}`);
    const mapTitle = ASSET_TITLES.map || 'Mapa';
    assetBtnsArr.push(`<a class="badge badge--asset" href="${mapUrl}" title="${mapTitle}" style="text-decoration:none" onclick="event.stopPropagation()">${ASSET_ICONS.map || ''}</a>`);
  }
  return assetBtnsArr.join('');
}

// ── Modal de assets ───────────────────────────────────────────────
window.openAssetModal = function(url, label) {
  let overlay = document.getElementById('assetModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'assetModalOverlay';
    overlay.innerHTML = `
      <div class="asset-modal" id="assetModal">
        <div class="asset-modal__bar">
          <span class="asset-modal__title" id="assetModalTitle"></span>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <a class="asset-modal__external" id="assetModalExternal" target="_blank" rel="noopener">↗ Nueva pestaña</a>
            <button class="asset-modal__close" onclick="closeAssetModal()"><svg xmlns="http://www.w3.org/2000/svg" width="14px" height="14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          </div>
        </div>
        <div class="asset-modal__body" id="assetModalBody"></div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAssetModal(); });
    document.body.appendChild(overlay);
  }

  const isImage = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  const isPdf   = /\.pdf(\?|$)/i.test(url);

  document.getElementById('assetModalTitle').textContent = label;
  document.getElementById('assetModalExternal').href = url;

  const body  = document.getElementById('assetModalBody');
  const modal = document.querySelector('.asset-modal');
  if (isImage) {
    body.innerHTML = `<img src="${url}" alt="${esc(label)}" style="width:100%;height:auto;display:block">`;
    modal.classList.add('asset-modal--image');
    modal.classList.remove('asset-modal--document');
  } else if (isPdf) {
    body.innerHTML = `<embed src="${url}" type="application/pdf" style="width:100%;height:100%;border:none">`;
    modal.classList.add('asset-modal--document');
    modal.classList.remove('asset-modal--image');
  } else {
    body.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
    modal.classList.add('asset-modal--document');
    modal.classList.remove('asset-modal--image');
  }

  overlay.classList.add('asset-modal--open');
  document.body.style.overflow = 'hidden';
};

window.closeAssetModal = function() {
  const overlay = document.getElementById('assetModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('asset-modal--open');
  document.body.style.overflow = '';
  setTimeout(() => {
    const body = document.getElementById('assetModalBody');
    if (body) body.innerHTML = '';
  }, 250);
};

// ── Modal de perfil SVG dinámico ─────────────────────────────────
window.openDynPerfilModal = function(rdId, externalUrl) {
  const rd = _dynPerfilRdMap[rdId];
  if (!rd?.elevationProfile) return;

  // overlay padding: 1rem*2=32px; modal max-width: 1100px; body div padding: 0.75rem*2≈24px
  const svgW = Math.min(window.innerWidth - 32, 1100) - 24;
  const { svg: svgStr, hoverData } = buildElevationProfileSVG({
    profile:        rd.elevationProfile,
    summits:        rd.profileSummits  ?? [],
    waypoints:      rd.profileWaypoints ?? [],
    startLocation:  rdLocation(rd, 'startLocation'),
    finishLocation: rdLocation(rd, 'finishLocation'),
    width:  svgW,
    height: 400,
    color:  rd._colorHex || null,
    lang:   getLang(),
  });

  let overlay = document.getElementById('assetModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'assetModalOverlay';
    overlay.innerHTML = `
      <div class="asset-modal" id="assetModal">
        <div class="asset-modal__bar">
          <span class="asset-modal__title" id="assetModalTitle"></span>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <a class="asset-modal__external" id="assetModalExternal" target="_blank" rel="noopener">↗ Nueva pestaña</a>
            <button class="asset-modal__close" onclick="closeAssetModal()"><svg xmlns="http://www.w3.org/2000/svg" width="14px" height="14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          </div>
        </div>
        <div class="asset-modal__body" id="assetModalBody"></div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAssetModal(); });
    document.body.appendChild(overlay);
  }

  document.getElementById('assetModalTitle').textContent = t('assets.profile');
  document.getElementById('assetModalExternal').textContent = getLang() === 'en' ? '↗ New tab' : '↗ Nueva pestaña';
  document.getElementById('assetModalExternal').href = externalUrl || '#';

  const body  = document.getElementById('assetModalBody');
  const modal = document.querySelector('.asset-modal');
  body.innerHTML = `<div style="padding:0.75rem;overflow-x:auto">${svgStr}</div>`;
  modal.classList.add('asset-modal--image');
  modal.classList.remove('asset-modal--document');

  overlay.classList.add('asset-modal--open');
  document.body.style.overflow = 'hidden';

  // Setup interactive hover effect
  if (hoverData) {
    const svgElement = body.querySelector('.ep-detailed');
    if (svgElement) {
      setupElevationProfileHover(svgElement, hoverData);
    }
  }
};
