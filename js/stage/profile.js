import { buildElevationProfileSVG, guideMarkerSVG } from './elevation-profile.js';
import { buildSimplifiedGuide, hasSimplifiedGuide } from '../simplified-guide.js';
import { hasRenderableElevationProfile } from './profile-availability.js';
import { profileProgress } from '../services/race-presentation.js';
import { hasStageKeyPoints } from './key-points.js';
import { profileSegmentStats } from './profile-segment.js';
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
  let all = false, selectedKm = null, pinnedKm = null, range = null, drag = null, hoverData, lastWidth = 0;
  const distance = Number(day.distanceKm || day.elevationProfile?.distance) || null;
  const guide = buildSimplifiedGuide({ distanceKm:distance, neutralStartTimeUtc:day.neutralStartTimeUtc, realStartTimeUtc:day.realStartTimeUtc,
    estimatedFinishTimeUtc:day.estimatedFinishTimeUtc, summits:day.profileSummits || [], waypoints:day.profileWaypoints || [], primaryType:day.primaryType });
  const passageTimes = hasSimplifiedGuide(guide);
  // Los pies de puerto solo aparecen en la lista completa, como filas
  // secundarias; la lista resumida se queda con las cimas.
  const keyRows = guide.filter(row => row.type !== 'start');
  const footBySummitKm = new Map((day.profileSummits || [])
    .filter(summit => summit?.km != null && summit.startKm != null && summit.startKm < summit.km)
    .map(summit => [summit.km, summit.startKm]));
  const onlyTowns = keyRows.some(row => row.type === 'town')
    && keyRows.every(row => row.type === 'town' || row.type === 'finish');
  const relevant = keyRows.filter(row => row.type !== 'climb_foot' && row.type !== 'town');
  // En recorridos con muchos puntos, el resumen debe priorizar el desenlace.
  // La última fila suele ser la meta, por lo que las seis últimas conservan
  // cinco puntos clave previos y la llegada sin alterar el orden de carrera.
  // Lista resumida sin pies de puerto: solo aparecen con «Ver todos».
  const initial = onlyTowns ? keyRows.filter(row => row.type !== 'climb_foot') : relevant.length > 6 ? relevant.slice(-6) : relevant;
  const hasPoints = points && !day.isCancelledDay && hasStageKeyPoints(day);
  host.hidden = false;
  host.className = `stage-profile-layout${hasPoints ? ' stage-profile-layout--points' : ''}`;
  host.innerHTML = `<section class="stage-profile-panel"><header class="stage-profile-heading"><h2>${en ? 'Profile' : 'Perfil'}</h2><output class="stage-profile-readout" aria-live="polite"></output>${interactive && official ? `<div class="stage-profile-modes" role="group" aria-label="${en ? 'Profile format' : 'Tipo de perfil'}"><button type="button" data-mode="interactive">${en ? 'Interactive' : 'Interactivo'}</button><button type="button" data-mode="official">${en ? 'Official' : 'Oficial'}</button></div>` : ''}</header><div class="stage-profile-graphic"></div></section>${hasPoints ? `<div class="stage-side"><section class="stage-key-panel"><header class="stage-profile-heading"><h2>${en ? 'Key points' : 'Puntos clave'}</h2><button type="button" class="stage-key-toggle" ${keyRows.length <= initial.length ? 'hidden' : ''}>${en ? 'Show all' : 'Ver todos'}</button></header><div class="stage-key-shell"><div class="stage-key-list" tabindex="0" aria-label="${en ? 'Route points' : 'Puntos del recorrido'}"></div></div></section><div class="stage-side__actions"></div></div>` : ''}`;
  const graphic = host.querySelector('.stage-profile-graphic');
  const readout = host.querySelector('output');
  const svgNode = (selector, tag, cls) => {
    const svg = graphic.querySelector('svg');
    let node = svg.querySelector(selector);
    if (!node) { node = document.createElementNS('http://www.w3.org/2000/svg', tag); node.setAttribute('class', cls); svg.append(node); }
    return node;
  };
  const setAttrs = (node, attrs) => { for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); };
  const clampKm = km => Math.max(0, Math.min(hoverData.xMax, km));
  const kmAt = clientX => { const box = graphic.getBoundingClientRect(); return clampKm((clientX - box.left - hoverData.ML) / hoverData.PW * hoverData.xMax); };
  // La lectura vive en la cabecera con altura fija: aparecer o desaparecer no
  // desplaza el perfil.
  const clearReadout = () => { readout.innerHTML = ''; };
  const clearPoint = () => {
    selectedKm = null;
    graphic.querySelector('.stage-profile-selection')?.setAttribute('display', 'none');
    clearReadout();
    host.querySelectorAll('[data-point-km]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  };
  const clearRange = () => {
    range = null;
    graphic.querySelectorAll('.stage-profile-dim').forEach(node => node.remove());
  };
  const selectKm = km => {
    if (!hoverData) return;
    selectedKm = clampKm(km);
    const line = svgNode('.stage-profile-selection', 'line', 'stage-profile-selection');
    setAttrs(line, { x1:hoverData.X(selectedKm), x2:hoverData.X(selectedKm), y1:hoverData.MT, y2:hoverData.BL });
    line.removeAttribute('display');
    const text = `${fmt(selectedKm)} km · ${Math.round(hoverData.interpolateAlt(selectedKm)).toLocaleString(locale, { useGrouping:'always' })} m`;
    readout.innerHTML = `<span class="stage-profile-readout__main"><strong>${text}</strong></span>`;
    graphic.setAttribute('aria-valuenow', selectedKm.toFixed(1));
    graphic.setAttribute('aria-valuetext', text);
    // El punto se marca a ±1 km de la posición señalada en el perfil.
    host.querySelectorAll('[data-point-km]').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.pointKm)-selectedKm) <= 1)));
  };
  // Tramo entre dos kilómetros: banda sombreada, bordes y cifras bajo el eje.
  const drawRange = (kmA, kmB, label = null) => {
    if (!hoverData) return;
    const stats = profileSegmentStats(hoverData.profile, clampKm(kmA), clampKm(kmB), hoverData.interpolateAlt);
    if (!stats) return;
    range = { a:kmA, b:kmB, label };
    graphic.querySelector('.stage-profile-selection')?.setAttribute('display', 'none');
    // El tramo se marca sobre el propio perfil: conserva su color y el resto
    // del gráfico se atenúa, sea cual sea el color de la carrera.
    const x1 = hoverData.X(stats.from), x2 = hoverData.X(stats.to);
    const left = hoverData.ML, right = hoverData.ML + hoverData.PW, top = 0, bottom = hoverData.BL + 1;
    const dim = svgNode('.stage-profile-dim', 'path', 'stage-profile-dim');
    setAttrs(dim, { d:`M${left},${top}H${x1}V${bottom}H${left}Z M${x2},${top}H${right}V${bottom}H${x2}Z` });
    const m = value => Math.round(value).toLocaleString(locale, { useGrouping:'always' });
    const gradient = stats.gradient.toLocaleString(locale, { maximumFractionDigits:1, minimumFractionDigits:1 }).replace('-', '−');
    readout.innerHTML = `<span class="stage-profile-readout__main"><span class="stage-profile-readout__label">${label ? esc(label) : (en ? 'Section' : 'Tramo')}</span>`
      + `<strong>${fmt(stats.distance)} km</strong><strong>+${m(stats.ascent)} m</strong><span>−${m(stats.descent)} m</span><span>${gradient} %</span>`
      + `<button type="button" class="stage-profile-readout__clear" data-clear-range>${en ? 'Clear' : 'Quitar'}</button></span>`;
    graphic.setAttribute('aria-valuetext', readout.textContent);
  };
  const sizePoints = () => {
    const panel = host.querySelector('.stage-key-panel');
    if (!panel) return;
    const wide = host.clientWidth >= 850;
    // La columna lateral (Puntos clave y, debajo, las acciones de la jornada)
    // no supera el alto del perfil.
    const actions = host.querySelector('.stage-side__actions');
    const actionsH = actions?.childElementCount ? actions.offsetHeight + 12 : 0;
    panel.style.maxHeight = wide ? `${host.querySelector('.stage-profile-panel').offsetHeight - actionsH}px` : '';
  };
  // Alto común de los dos formatos: el oficial ocupa el mismo hueco que el
  // interactivo y el panel no cambia de tamaño al alternar.
  const graphicHeight = width => Math.max(264, Math.min(400, width * .4));
  const draw = () => {
    host.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    if (mode !== 'interactive') clearReadout();
    if (mode === 'official') {
      for (const attr of ['role','tabindex','aria-valuenow','aria-valuetext','aria-valuemin','aria-valuemax','aria-label']) graphic.removeAttribute(attr);
      graphic.style.height = `${graphicHeight(Math.max(240, graphic.clientWidth))}px`;
      const url = official.url || official.filePath;
      const isPdf = /\.pdf(?:[?#]|$)/i.test(url);
      graphic.innerHTML = isPdf ? `<iframe class="stage-profile-official-pdf" src="${esc(url)}#view=FitH" title="${en ? 'Official profile' : 'Perfil oficial'}"></iframe>` : `<img class="stage-profile-official" src="${esc(url)}" alt="${en ? 'Official profile' : 'Perfil oficial'}">`;
      graphic.querySelector('img')?.addEventListener('load', sizePoints);
      graphic.querySelector('img,iframe')?.addEventListener('error', () => {
        graphic.innerHTML = `<p>${en ? 'Unable to load the profile.' : 'No se ha podido cargar el perfil.'}</p>${interactive ? `<button type="button" data-fallback>${en ? 'View interactive profile' : 'Ver perfil interactivo'}</button>` : `<a href="${esc(url)}" target="_blank" rel="noopener">${en ? 'Open profile' : 'Abrir perfil'}</a>`}`;
        graphic.querySelector('[data-fallback]')?.addEventListener('click', () => { mode='interactive'; draw(); });
      });
    } else {
      graphic.style.height = '';
      const width = Math.max(240, graphic.clientWidth);
      const result = buildElevationProfileSVG({ profile:day.elevationProfile, summits:day.profileSummits || [], waypoints:day.profileWaypoints || [],
        startLocation:rdLocation(day,'startLocation'), finishLocation:rdLocation(day,'finishLocation') || rdLocation(day,'startLocation'),
        width, hidePointNames, height:graphicHeight(width), color:race.colorHex, lang:getLang(), progressFraction:temporal ? profileProgress(day) : null });
      graphic.innerHTML = result.svg; hoverData=result.hoverData;
      graphic.setAttribute('tabindex','0'); graphic.setAttribute('role','slider');
      graphic.setAttribute('aria-label', en ? 'Explore route distance and altitude' : 'Consultar distancia y altitud del recorrido');
      graphic.setAttribute('aria-valuemin','0'); graphic.setAttribute('aria-valuemax',String(hoverData?.xMax || 0));
      graphic.setAttribute('aria-valuenow',String(selectedKm || 0));
      if (range) drawRange(range.a, range.b, range.label);
      else if (selectedKm != null) selectKm(selectedKm);
      else clearReadout();
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
      // Ficha del puerto en una columna a la derecha: longitud y pendiente media.
      const footKm = row.type === 'summit' ? footBySummitKm.get(row.km) : null;
      let climbStats = '';
      if (footKm != null) {
        const climb = hoverData ? profileSegmentStats(hoverData.profile, footKm, row.km, hoverData.interpolateAlt) : null;
        climbStats = `${fmt(row.km - footKm)} km${climb ? ` ${en ? 'at' : 'al'} ${climb.gradient.toLocaleString(locale, { maximumFractionDigits:1, minimumFractionDigits:1 })} %` : ''}`;
      }
      const timeText = time ? `${row.isEstimated ? '≈ ' : ''}${time}` : '';
      const small = [timeText, climbStats].filter(Boolean).join(' · ');
      if (row.type === 'climb_foot') {
        const footBody = `<span class="stage-key-km">${row.kmToGo == null ? '' : `${fmt(Math.max(0,row.kmToGo))} km`}</span><span class="stage-key-foot-mark" aria-hidden="true"></span><span class="stage-key-name">${en ? 'Foot of' : 'Pie de'} ${esc(row.label || (en ? 'climb' : 'puerto'))}${timeText ? ` · ${timeText}` : ''}</span>`;
        return interactive ? `<button type="button" class="stage-key-row stage-key-row--foot" data-point-km="${row.km}" aria-pressed="false">${footBody}</button>` : `<div class="stage-key-row stage-key-row--foot">${footBody}</div>`;
      }
      const body = `<span class="stage-key-km">${row.kmToGo == null ? '' : `${fmt(Math.max(0,row.kmToGo))} km`}</span>${guideMarkerSVG(row.type,{ category:row.category,secondaryKind:row.secondaryType })}<span class="stage-key-name">${esc(fullLabel)}${small ? `<small ${time && row.isEstimated ? `title="${esc(t('stage.guide.estimatedNote'))}"` : ''}>${small}</small>` : ''}</span>`;
      return interactive ? `<button type="button" class="stage-key-row" data-point-km="${row.km}" aria-pressed="false">${body}</button>` : `<div class="stage-key-row">${body}</div>`;
    }).join('');
    sizePoints();
  };
  const onHostClick = event => {
    if (event.target.closest('[data-clear-range]')) { clearRange(); if (selectedKm != null) selectKm(selectedKm); else clearReadout(); return; }
    const button = event.target.closest('[data-mode], [data-point-km], .stage-key-toggle');
    if (!button) return;
    if (button.dataset.mode) { mode=button.dataset.mode; try { localStorage.setItem('cc_profile_mode',mode); } catch {} draw(); }
    else if (button.dataset.pointKm != null) {
      // Un punto clave pulsado muestra su tramo (el puerto entero si es una
      // cima); pulsarlo de nuevo lo retira.
      const wasPressed = button.getAttribute('aria-pressed') === 'true';
      clearRange(); pinnedKm = null; clearPoint();
      if (wasPressed) return;
      if (mode !== 'interactive') { mode='interactive'; draw(); }
      const km = Number(button.dataset.pointKm), footKm = footBySummitKm.get(km);
      if (footKm != null) drawRange(footKm, km, button.querySelector('.stage-key-name')?.firstChild?.textContent || null);
      else { pinnedKm = km; selectKm(km); }
      host.querySelectorAll('[data-point-km]').forEach(row => row.setAttribute('aria-pressed', String(row === button)));
    }
    else { all=!all; button.textContent=all ? (en ? 'Show less' : 'Ver menos') : (en ? 'Show all' : 'Ver todos'); drawPoints(); }
  };
  host.addEventListener('click', onHostClick);
  // Ratón: el puntero recorre el perfil. Pulsar y arrastrar (también con el
  // dedo, en horizontal) mide un tramo; una pulsación sin arrastre fija un punto.
  graphic.addEventListener('pointerdown', event => {
    if (mode !== 'interactive' || !hoverData || event.button > 0) return;
    drag = { km:kmAt(event.clientX), x:event.clientX, moved:false, id:event.pointerId };
  });
  graphic.addEventListener('pointermove', event => {
    if (mode !== 'interactive' || !hoverData) return;
    if (drag && drag.id === event.pointerId) {
      if (!drag.moved && Math.abs(event.clientX - drag.x) < 6) return;
      if (!drag.moved) { drag.moved = true; try { graphic.setPointerCapture(event.pointerId); } catch { /* Sin captura, el arrastre sigue dentro del gráfico. */ } }
      drawRange(drag.km, kmAt(event.clientX));
      return;
    }
    if (event.pointerType === 'touch' || range) return;
    selectKm(kmAt(event.clientX));
  });
  // Al salir del perfil, el punto de paso del puntero desaparece; se conserva
  // el punto fijado con un clic o el tramo medido.
  graphic.addEventListener('pointerleave', event => {
    if (event.pointerType === 'touch' || range || drag) return;
    if (pinnedKm != null) selectKm(pinnedKm); else clearPoint();
  });
  graphic.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    if (!wasDrag) { clearRange(); pinnedKm = kmAt(event.clientX); selectKm(pinnedKm); }
  });
  graphic.addEventListener('pointercancel', () => { drag = null; });
  // Doble clic sobre la zona sombreada de un puerto: su tramo, del pie a la cima.
  graphic.addEventListener('dblclick', event => {
    if (mode !== 'interactive' || !hoverData?.climbs?.length) return;
    const km = kmAt(event.clientX);
    const climb = hoverData.climbs.find(c => km >= c.startKm && km <= c.endKm);
    if (!climb) return;
    event.preventDefault();
    drawRange(climb.startKm, climb.endKm, climb.name || (en ? 'Climb' : 'Puerto'));
  });
  graphic.addEventListener('keydown', event => {
    if (mode !== 'interactive' || !hoverData) return;
    if (event.key === 'Escape' && range) { clearRange(); if (selectedKm != null) selectKm(selectedKm); else clearReadout(); return; }
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const anchor = range ? range.a : (selectedKm || 0);
      drawRange(anchor, (range ? range.b : anchor) + step);
      return;
    }
    clearRange();
    pinnedKm = event.key === 'Home' ? 0 : event.key === 'End' ? hoverData.xMax : (selectedKm || 0)+step;
    selectKm(pinnedKm);
  });
  draw(); drawPoints();
  const resize = new ResizeObserver(() => { if (graphic.clientWidth !== lastWidth) { lastWidth=graphic.clientWidth; draw(); } else sizePoints(); });
  resize.observe(graphic);
  // Las acciones de la jornada llegan después (jornada.js): recalcular el alto.
  const actionsSlot = host.querySelector('.stage-side__actions');
  const actionsObserver = actionsSlot ? new MutationObserver(sizePoints) : null;
  actionsObserver?.observe(actionsSlot, { childList:true });
  const tick = () => { if (temporal && !document.hidden && mode === 'interactive') draw(); };
  const timer = temporal ? setInterval(tick,60000) : null;
  document.addEventListener('visibilitychange',tick);
  host._profileCleanup = () => { resize.disconnect(); actionsObserver?.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange',tick); host.removeEventListener('click',onHostClick); };
  return host._profileCleanup;
}
