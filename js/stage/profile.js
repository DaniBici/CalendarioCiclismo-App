import { buildElevationProfileSVG, guideMarkerSVG } from './elevation-profile.js?v=20260908a';
import { buildSimplifiedGuide, hasSimplifiedGuide } from '../simplified-guide.js';
import { hasRenderableElevationProfile } from './profile-availability.js';
import { profileProgress } from '../services/race-presentation.js';
import { arrowHtml, installScrollRail } from '../scroll-rail.js';
import { hasStageKeyPoints } from './key-points.js';
import { esc, rdLocation, formatTimeUser } from '../shared.js';
import { getLang, t } from '../i18n.js';

export function mountStageProfile(host, { day, race, assets = [], points = false, temporal = false, hidePointNames = false } = {}) {
  if (!host) return () => {};
  host._profileCleanup?.();
  const interactive = hasRenderableElevationProfile(day);
  const official = !day.profileNotViewable && assets.find(asset => asset.type === 'profile' && (asset.url || asset.filePath));
  if (!interactive && !official) { host.hidden = true; return () => {}; }
  const en = getLang() === 'en', locale = en ? 'en-GB' : 'es-ES';
  const fmt = value => Number(value).toLocaleString(locale, { maximumFractionDigits:1 });
  let preferred;
  try { preferred = localStorage.getItem('cc_profile_mode'); } catch { /* Preferencia opcional. */ }
  let mode = official && (!interactive || preferred === 'official') ? 'official' : 'interactive';
  let all = false, selectedKm = null, hoverData, lastWidth = 0;
  const distance = Number(day.distanceKm || day.elevationProfile?.distance) || null;
  const guide = buildSimplifiedGuide({ distanceKm:distance, neutralStartTimeUtc:day.neutralStartTimeUtc, realStartTimeUtc:day.realStartTimeUtc,
    estimatedFinishTimeUtc:day.estimatedFinishTimeUtc, summits:day.profileSummits || [], waypoints:day.profileWaypoints || [], primaryType:day.primaryType });
  const passageTimes = hasSimplifiedGuide(guide);
  const keyRows = guide.filter(row => row.type !== 'start');
  const onlyTowns = keyRows.some(row => row.type === 'town')
    && keyRows.every(row => row.type === 'town' || row.type === 'finish');
  const relevant = keyRows.filter(row => row.type !== 'climb_foot' && row.type !== 'town');
  // En recorridos con muchos puntos, el resumen debe priorizar el desenlace.
  // La última fila suele ser la meta, por lo que las seis últimas conservan
  // cinco puntos clave previos y la llegada sin alterar el orden de carrera.
  const initial = onlyTowns ? keyRows : relevant.length > 6 ? relevant.slice(-6) : relevant;
  const hasPoints = points && !day.isCancelledDay && hasStageKeyPoints(day);
  host.hidden = false;
  host.className = `stage-profile-layout${hasPoints ? ' stage-profile-layout--points' : ''}`;
  host.innerHTML = `<section class="stage-profile-panel"><header class="stage-profile-heading"><h2>${en ? 'Profile' : 'Perfil'}</h2>${interactive && official ? `<div class="stage-profile-modes" role="group" aria-label="${en ? 'Profile format' : 'Tipo de perfil'}"><button type="button" data-mode="interactive">${en ? 'Interactive' : 'Interactivo'}</button><button type="button" data-mode="official">${en ? 'Official' : 'Oficial'}</button></div>` : ''}</header><div class="stage-profile-graphic"></div><output class="stage-profile-readout" aria-live="polite"></output></section>${hasPoints ? `<section class="stage-key-panel"><header class="stage-profile-heading"><h2>${en ? 'Key points' : 'Puntos clave'}</h2><button type="button" class="stage-key-toggle" ${keyRows.length <= initial.length ? 'hidden' : ''}>${en ? 'Show all' : 'Ver todos'}</button></header><div class="stage-key-shell">${arrowHtml('up', en ? 'Previous points' : 'Puntos anteriores', 'hidden')}<div class="stage-key-list" data-scroll-rail tabindex="0" aria-label="${en ? 'Route points' : 'Puntos del recorrido'}"></div>${arrowHtml('down', en ? 'More points' : 'Más puntos', 'hidden')}</div></section>` : ''}`;
  const graphic = host.querySelector('.stage-profile-graphic');
  const readout = host.querySelector('output');
  const selectKm = km => {
    if (!hoverData) return;
    selectedKm = Math.max(0, Math.min(hoverData.xMax, km));
    const svg = graphic.querySelector('svg');
    let line = svg.querySelector('.stage-profile-selection');
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class','stage-profile-selection'); svg.append(line);
    }
    for (const [key,value] of Object.entries({ x1:hoverData.X(selectedKm), x2:hoverData.X(selectedKm), y1:hoverData.MT, y2:hoverData.BL })) line.setAttribute(key,value);
    readout.textContent = `${fmt(selectedKm)} km · ${Math.round(hoverData.interpolateAlt(selectedKm))} m`;
    graphic.setAttribute('aria-valuenow', selectedKm.toFixed(1));
    graphic.setAttribute('aria-valuetext', readout.textContent);
    host.querySelectorAll('[data-point-km]').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.pointKm)-selectedKm) < .01)));
  };
  const sizePoints = () => {
    const panel = host.querySelector('.stage-key-panel');
    if (!panel) return;
    const wide = host.clientWidth >= 850;
    panel.style.maxHeight = wide ? `${host.querySelector('.stage-profile-panel').offsetHeight}px` : '';
  };
  const draw = () => {
    host.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    readout.hidden = mode !== 'interactive';
    if (mode === 'official') {
      for (const attr of ['role','tabindex','aria-valuenow','aria-valuetext','aria-valuemin','aria-valuemax','aria-label']) graphic.removeAttribute(attr);
      const url = official.url || official.filePath;
      const isPdf = /\.pdf(?:[?#]|$)/i.test(url);
      graphic.innerHTML = isPdf ? `<iframe class="stage-profile-official-pdf" src="${esc(url)}#view=FitH" title="${en ? 'Official profile' : 'Perfil oficial'}"></iframe>` : `<img class="stage-profile-official" src="${esc(url)}" alt="${en ? 'Official profile' : 'Perfil oficial'}">`;
      graphic.querySelector('img')?.addEventListener('load', sizePoints);
      graphic.querySelector('img,iframe')?.addEventListener('error', () => {
        graphic.innerHTML = `<p>${en ? 'Unable to load the profile.' : 'No se ha podido cargar el perfil.'}</p>${interactive ? `<button type="button" data-fallback>${en ? 'View interactive profile' : 'Ver perfil interactivo'}</button>` : `<a href="${esc(url)}" target="_blank" rel="noopener">${en ? 'Open profile' : 'Abrir perfil'}</a>`}`;
        graphic.querySelector('[data-fallback]')?.addEventListener('click', () => { mode='interactive'; draw(); });
      });
    } else {
      const width = Math.max(240, graphic.clientWidth);
      const result = buildElevationProfileSVG({ profile:day.elevationProfile, summits:day.profileSummits || [], waypoints:day.profileWaypoints || [],
        startLocation:rdLocation(day,'startLocation'), finishLocation:rdLocation(day,'finishLocation') || rdLocation(day,'startLocation'),
        width, hidePointNames, height:Math.max(264, Math.min(400,width*.4)), color:race.colorHex, lang:getLang(), progressFraction:temporal ? profileProgress(day) : null });
      graphic.innerHTML = result.svg; hoverData=result.hoverData;
      graphic.setAttribute('tabindex','0'); graphic.setAttribute('role','slider');
      graphic.setAttribute('aria-label', en ? 'Explore route distance and altitude' : 'Consultar distancia y altitud del recorrido');
      graphic.setAttribute('aria-valuemin','0'); graphic.setAttribute('aria-valuemax',String(hoverData?.xMax || 0));
      graphic.setAttribute('aria-valuenow',String(selectedKm || 0));
      if (selectedKm != null) selectKm(selectedKm);
    }
    sizePoints();
  };
  const drawPoints = () => {
    if (!hasPoints) return;
    const list = host.querySelector('.stage-key-list');
    list.innerHTML = (all ? keyRows : initial).map(row => {
      const label = row.label || (row.type === 'finish' ? rdLocation(day,'finishLocation') || rdLocation(day,'startLocation') : t(`stage.guide.${row.type}`));
      const secondaryLabel = row.secondaryType
        ? (row.secondaryLabel || t(`stage.guide.${row.secondaryType}`))
        : '';
      const fullLabel = secondaryLabel && secondaryLabel !== label ? `${label} · ${secondaryLabel}` : label;
      const time = passageTimes && row.timeUtc ? formatTimeUser(row.timeUtc)?.display : null;
      const body = `<span class="stage-key-km">${row.kmToGo == null ? '' : `${fmt(Math.max(0,row.kmToGo))} km`}</span>${guideMarkerSVG(row.type,{ category:row.category,secondaryKind:row.secondaryType })}<span class="stage-key-name">${esc(fullLabel)}${time ? `<small ${row.isEstimated ? `title="${esc(t('stage.guide.estimatedNote'))}"` : ''}>${row.isEstimated ? '≈ ' : ''}${time}</small>` : ''}</span>`;
      return interactive ? `<button type="button" class="stage-key-row" data-point-km="${row.km}" aria-pressed="false">${body}</button>` : `<div class="stage-key-row">${body}</div>`;
    }).join('');
    sizePoints();
  };
  const onHostClick = event => {
    const button = event.target.closest('[data-mode], [data-point-km], .stage-key-toggle');
    if (!button) return;
    if (button.dataset.mode) { mode=button.dataset.mode; try { localStorage.setItem('cc_profile_mode',mode); } catch {} draw(); }
    else if (button.dataset.pointKm != null) { if (mode !== 'interactive') { mode='interactive'; draw(); } selectKm(Number(button.dataset.pointKm)); }
    else { all=!all; button.textContent=all ? (en ? 'Show less' : 'Ver menos') : (en ? 'Show all' : 'Ver todos'); drawPoints(); }
  };
  host.addEventListener('click', onHostClick);
  graphic.addEventListener('pointermove', event => {
    if (mode !== 'interactive' || !hoverData || event.pointerType === 'touch') return;
    const box=graphic.getBoundingClientRect(); selectKm((event.clientX-box.left-hoverData.ML)/hoverData.PW*hoverData.xMax);
  });
  graphic.addEventListener('click', event => {
    if (mode !== 'interactive' || !hoverData) return;
    const box=graphic.getBoundingClientRect(); selectKm((event.clientX-box.left-hoverData.ML)/hoverData.PW*hoverData.xMax);
  });
  graphic.addEventListener('keydown', event => {
    if (mode !== 'interactive' || !hoverData || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); selectKm(event.key === 'Home' ? 0 : event.key === 'End' ? hoverData.xMax : (selectedKm || 0)+(event.key === 'ArrowRight' ? 1 : -1));
  });
  draw(); drawPoints();
  if (hasPoints) installScrollRail(host.querySelector('.stage-key-shell'), { vertical:true });
  const resize = new ResizeObserver(() => { if (graphic.clientWidth !== lastWidth) { lastWidth=graphic.clientWidth; draw(); } else sizePoints(); });
  resize.observe(graphic);
  const tick = () => { if (temporal && !document.hidden && mode === 'interactive') draw(); };
  const timer = temporal ? setInterval(tick,60000) : null;
  document.addEventListener('visibilitychange',tick);
  host._profileCleanup = () => { resize.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange',tick); host.removeEventListener('click',onHostClick); host.querySelector('.stage-key-shell')?._ccRailCleanup?.(); };
  return host._profileCleanup;
}
