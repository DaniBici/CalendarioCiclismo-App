// Mapa interactivo del recorrido (MapLibre + OpenFreeMap), sin dependencia de
// Supabase: recibe la traza GPX y los datos de la jornada ya cargados. Lo usan
// mapa-pub.js y cualquier build externo que incruste los datos en la página.
//
// Requisitos de la página: maplibre-gl 4.x cargado como global `maplibregl`
// (JS y CSS) y los estilos .cc-map* de css/app.css.
//
//   import { mountRouteMap } from './route-map.js';
//   mountRouteMap(document.getElementById('mapa'), {
//     gpx: '<gpx>…</gpx>',           // o gpxUrl: '/ruta.gpx'
//     distanceKm: 163.4,             // escala los km oficiales sobre la traza
//     colorHex: '#d8442e',
//     elevationProfile, summits, waypoints, primaryType,
//     lang: 'es', theme: 'light',    // theme omitido: sigue la clase .light de <html>
//   });
//
// La línea sale del GPX crudo y los marcadores de summits/waypoints se
// proyectan por km sobre la traza, con los mismos iconos que el perfil.
//
// Recorrer el perfil superpuesto (ratón, dedo en horizontal o flechas) marca
// km y altitud y sitúa un punto en la traza. La instancia devuelta expone
// map.showRouteKm(km) para hacer lo mismo desde fuera (null lo oculta).

import { t as defaultT, getLang } from './i18n.js';
import { indicatorBadgeSVG, buildElevationProfileSVG } from './stage/elevation-profile.js';
import { effectiveSummitAlt } from './stage/climb-detection.js';

const SPRINT_TYPES  = new Set(['intermediate_sprint', 'bonus_sprint']);
const TERRAIN_TYPES = new Set(['cobblestone', 'sterrato']);

// Reparto de profileWaypoints en sprints (o parciales en una CRI) y sectores.
export function splitWaypoints(waypoints = [], primaryType = null) {
  const isTimeTrial = primaryType === 'itt' || primaryType === 'ttt';
  const sprints = isTimeTrial
    ? waypoints.filter(w => w.type === 'intermediate_split')
    : waypoints.filter(w => SPRINT_TYPES.has(w.type));
  const terrain = waypoints.filter(w => TERRAIN_TYPES.has(w.type));
  return { sprints, terrain, isTimeTrial };
}

export function terrainLabel(type, primaryType, t = defaultT) {
  if (primaryType === 'ribinou' && type === 'sterrato') return t('terrain.ribinou');
  return t(`terrain.${type}`) || type;
}

const esc = (str) => str
  ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  : '';

const fmt = (v, sep = '.') =>
  v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : '?';

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

// Pasos por el mismo punto en circuitos (cima o sprint): misma clave (nombre,
// y tipo en los sprints) y a menos de esta distancia en el mapa → un solo
// marcador con los km de todos los pasos.
const SAME_POINT_KM = 0.5;
// Un punto a esta distancia de la meta o menos (final en alto, sprint de meta)
// nunca se une con otros pasos.
const FINISH_TOLERANCE_KM = 0.2;
// Orden de dureza para el icono del marcador agrupado (el más duro manda).
const CAT_RANK = { HC: 0, 1: 1, 2: 2, 3: 3, 4: 4 };

// Agrupa los pasos por el mismo punto. `locate(s)` devuelve { ll: [lat,lon],
// altRaw } de cada punto; `keyOf(s)` decide qué puntos pueden unirse;
// `finishKm` aparta el punto de meta. Cada grupo lleva la posición del primer
// paso, el de categoría más dura (`top`; en sprints, el primero), los pasos en
// orden y la altitud mayor.
export function groupRepeatedPoints(items = [], locate, { keyOf = s => s.name, finishKm = null } = {}) {
  const groups = [];
  items.forEach(s => {
    if (s.km == null) return;
    const { ll, altRaw } = locate(s);
    const atFinish = finishKm > 0 && s.km >= finishKm - FINISH_TOLERANCE_KM;
    const key = String(keyOf(s) ?? '').trim().toLowerCase();
    const group = !atFinish && groups.find(g => !g.atFinish && g.key === key
      && haversineKm(g.ll[0], g.ll[1], ll[0], ll[1]) < SAME_POINT_KM);
    if (group) group.passes.push({ s, altRaw });
    else groups.push({ key, ll, atFinish, passes: [{ s, altRaw }] });
  });
  return groups.map(({ ll, passes }) => {
    const alts = passes.map(p => p.altRaw).filter(a => a != null);
    return {
      ll,
      passes: passes.map(p => p.s),
      top: passes.reduce((a, b) => (CAT_RANK[b.s.category] ?? 9) < (CAT_RANK[a.s.category] ?? 9) ? b : a).s,
      altRaw: alts.length ? Math.max(...alts) : null,
    };
  });
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

const htmlIsDark = () => !document.documentElement.classList.contains('light');

const EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const COLLAPSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

// Pinta el mapa dentro de `host` (recibe la clase .cc-map-wrap): lienzo, barra
// de herramientas y perfil superpuesto. Devuelve la instancia de MapLibre, o
// null si falta MapLibre o el GPX no se puede leer.
export async function mountRouteMap(host, opts = {}) {
  const {
    gpx = null, gpxUrl = null, distanceKm = null, colorHex = null,
    elevationProfile = null, summits = [], waypoints = [], primaryType = null,
    lang = getLang(), theme = null, t = defaultT,
  } = opts;
  if (!host) return null;
  const isEn = lang === 'en';
  const { sprints, terrain, isTimeTrial } = splitWaypoints(waypoints, primaryType);

  host.classList.add('cc-map-wrap');
  host.innerHTML = `
      <div class="cc-map" data-cc-map="canvas"></div>
      <div class="cc-map-toolbar">
        <button class="cc-map-tbtn is-active" data-cc-map="base">${t('map.baseMap')}</button>
        <button class="cc-map-tbtn" data-cc-map="sat">${t('map.satellite')}</button>
        <span class="cc-map-tsep"></span>
        <button class="cc-map-tbtn" data-cc-map="2d">2D</button>
        <button class="cc-map-tbtn is-active" data-cc-map="3d">3D</button>
        <span class="cc-map-tsep"></span>
        <button class="cc-map-tbtn is-active" data-cc-map="profile-toggle">${t('map.profile')}</button>
      </div>
      <div class="cc-map-profile" data-cc-map="profile" hidden></div>`;
  const q = (name) => host.querySelector(`[data-cc-map="${name}"]`);
  const el = q('canvas');
  if (typeof maplibregl === 'undefined') return null;

  const kmUnit = isEn ? 'km' : ' km';
  const color = colorHex || '#d8442e';
  const totalKm = distanceKm ? Number(distanceKm) : 0;
  const errHtml = `<p style="text-align:center;color:var(--text-muted);padding:2rem">${t('map.loadError')}</p>`;

  let points, segments;
  try {
    const xml = gpx ?? await fetch(gpxUrl).then(r => { if (!r.ok) throw new Error('GPX ' + r.status); return r.text(); });
    ({ points, segments } = parseGpx(xml));
  } catch (err) { el.innerHTML = errHtml; return null; }
  if (!points.length || !segments.length) { el.innerHTML = errHtml; return null; }

  const isDark = () => (theme ? theme === 'dark' : htmlIsDark());
  const bounds = new maplibregl.LngLatBounds();
  points.forEach(p => bounds.extend([p.lon, p.lat]));

  // Estado del toolbar (lo refleja setBase/setDim); se conserva entre cambios de
  // tema para reaplicarlo al reconstruir las capas tras setStyle.
  const mapState = { base: 'base', dim: '3d' };

  const map = new maplibregl.Map({
    container: el,
    style: isDark() ? BASE_STYLE.dark : BASE_STYLE.light, // OpenFreeMap (vector)
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
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 4.5 } });
    }
  };
  const fitRoute = () => map.fitBounds(bounds, { padding: 40, pitch: 58, bearing: -18, duration: 600 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.scrollZoom.disable();

  // Punto de la traza en un km de carrera, con la misma escala que los
  // marcadores (km oficiales sobre la longitud del GPX). null lo oculta.
  const cursorNode = document.createElement('div');
  cursorNode.className = 'cc-map-cursor';
  const cursor = new maplibregl.Marker({ element: cursorNode, anchor: 'center' });
  const cursorTotal = totalKm || Number(elevationProfile?.distance) || 0;
  let cursorOn = false;
  map.showRouteKm = (km) => {
    if (km == null || !Number.isFinite(Number(km))) {
      if (cursorOn) { cursor.remove(); cursorOn = false; }
      return;
    }
    cursor.setLngLat(toLngLat(kmToLatLng(points, Number(km), cursorTotal)));
    if (!cursorOn) { cursor.addTo(map); cursorOn = true; }
  };

  // ── Control de expandir (overlay a viewport; sin Fullscreen API por iOS) ──
  // Conmuta una clase que pone el contenedor en position:fixed sobre todo el
  // viewport; tras conmutar, map.resize() recalcula el lienzo.
  let expandBtn = null;
  const setExpanded = (on) => {
    host.classList.toggle('cc-map--expanded', on);
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
      expandBtn.addEventListener('click', () => setExpanded(!host.classList.contains('cc-map--expanded')));
      c.appendChild(expandBtn);
      this._c = c;
      return c;
    },
    onRemove() { this._c?.remove(); },
  };
  map.addControl(expandCtrl, 'top-right');
  const onKey = (e) => { if (e.key === 'Escape' && host.classList.contains('cc-map--expanded')) setExpanded(false); };
  document.addEventListener('keydown', onKey);
  map.on('remove', () => document.removeEventListener('keydown', onKey));

  // ── Cambio de tema (claro/oscuro): recargar el estilo de OpenFreeMap ──
  // theme.js muta la clase de <html>; con un estilo VECTOR completo hay que
  // recargarlo con setStyle (no basta setTiles). setStyle reemplaza las capas
  // del estilo → reconstruimos las nuestras al cargar el nuevo (style.load).
  // Con `theme` fijo no se observa nada.
  if (!theme) {
    let curDark = isDark();
    const themeObserver = new MutationObserver(() => {
      const d = isDark();
      if (d === curDark) return;
      curDark = d;
      map.setStyle(d ? BASE_STYLE.dark : BASE_STYLE.light);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    map.on('remove', () => themeObserver.disconnect());
  }
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

    // Puertos (snap por altitud → en circuitos repetidos cada paso cae en su
    // cima). Los pasos por la misma cima comparten marcador: icono de la
    // categoría más dura, km de cada paso y la altitud mayor. La meta, nunca.
    const finishKm = totalKm || Number(elevationProfile?.distance) || null;
    const summitGroups = groupRepeatedPoints(summits, s => {
      const altRaw = effectiveSummitAlt(s, elevationProfile?.points);
      return { ll: markerLatLng(points, s.km, totalKm, altRaw), altRaw };
    }, { finishKm });
    summitGroups.forEach(({ ll, passes, top, altRaw }) => {
      const cat = (top.category && top.category !== 'M') ? ` · ${t('profile.cat')} ${top.category}` : '';
      const alt = altRaw != null ? ` · ${fmt(altRaw, isEn ? ',' : '.')} m` : '';
      const kms = passes.map(s => s.km).join(', ');
      addMarker(pinNode(indicatorBadgeSVG('summit', top, { size: 26 })), toLngLat(ll),
        `<b>${esc(passes[0].name || t('profile.climbsOne'))}</b><br><span class="cc-map-km">${kms}${kmUnit}${cat}${alt}</span>`);
    });

    // Sprints / puntos intermedios: los pasos del mismo tipo por el mismo
    // lugar comparten marcador con los km de cada paso. La meta, nunca.
    const sprintGroups = groupRepeatedPoints(sprints,
      w => ({ ll: kmToLatLng(points, w.km, totalKm), altRaw: null }),
      { keyOf: w => `${w.type}|${w.name || ''}`, finishKm });
    sprintGroups.forEach(({ ll, passes, top: w }) => {
      const lbl = isTimeTrial ? t('profile.splitsOne') : (w.type === 'bonus_sprint' ? t('profile.bonusSprint') : t('profile.intSprint'));
      const kms = passes.map(p => p.km).join(', ');
      addMarker(pinNode(indicatorBadgeSVG(w.type, w, { size: 26 })), toLngLat(ll),
        `<b>${esc(w.name || lbl)}</b><br><span class="cc-map-km">${lbl} · ${kms}${kmUnit}</span>`);
    });

    // Sectores (pavé / sterrato).
    terrain.forEach(w => {
      if (w.km == null) return;
      const lbl = terrainLabel(w.type, primaryType, t);
      addMarker(pinNode(indicatorBadgeSVG(w.type, w, { size: 26 })), toLngLat(kmToLatLng(points, w.km, totalKm)),
        `<b>${esc(w.name || lbl)}</b><br><span class="cc-map-km">${lbl} · ${w.km}${kmUnit}</span>`);
    });

    fitRoute();
    renderProfileOverlay(q('profile'), q('profile-toggle'), { elevationProfile, summits, waypoints, color, isEn, t, showKm: map.showRouteKm });
  });

  wireMapControls(map, mapState, q);
  return map;
}

// Perfil SVG superpuesto al fondo del mapa (silueta iconsOnly, a todo el ancho).
function renderProfileOverlay(host, toggle, { elevationProfile, summits, waypoints, color, isEn, t, showKm }) {
  if (!host) return;
  if (!elevationProfile?.points?.length) {
    toggle?.setAttribute('disabled', ''); // sin perfil → toggle inerte
    return;
  }
  const { svg, hoverData } = buildElevationProfileSVG({
    profile: elevationProfile, summits, waypoints,
    width: 1200, height: 360, color, lang: isEn ? 'en' : 'es', iconsOnly: true,
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
    wireProfileScrub(host, svgEl, hoverData, { isEn, t, showKm });
  }
  host.hidden = false;
}

// Recorrido del perfil superpuesto. El SVG ocupa el ancho del área de dibujo
// (viewBox recortado), así que la posición horizontal es lineal en km. La
// marca y la lectura son HTML en porcentajes: no escalan con el viewBox.
// Con el dedo, touch-action: pan-y deja el gesto vertical a la página.
function wireProfileScrub(host, svgEl, hd, { isEn, t, showKm }) {
  const locale = isEn ? 'en-GB' : 'es-ES';
  const viewW = hd.width - hd.ML - hd.MR;
  const mark = document.createElement('div');
  mark.className = 'cc-map-profile-mark';
  mark.hidden = true;
  mark.innerHTML = '<span class="cc-map-profile-line"></span><span class="cc-map-profile-dot"></span><output class="cc-map-profile-readout"></output>';
  host.append(mark);
  const readout = mark.querySelector('output');

  svgEl.setAttribute('tabindex', '0');
  svgEl.setAttribute('role', 'slider');
  svgEl.setAttribute('aria-label', t('map.profileExplore'));
  svgEl.setAttribute('aria-valuemin', '0');
  svgEl.setAttribute('aria-valuemax', String(hd.xMax));

  let current = null;
  const select = (km) => {
    if (km == null) {
      current = null;
      mark.hidden = true;
      svgEl.removeAttribute('aria-valuenow');
      svgEl.removeAttribute('aria-valuetext');
      showKm?.(null);
      return;
    }
    current = Math.max(0, Math.min(hd.xMax, km));
    const alt = hd.interpolateAlt(current);
    const x = (hd.X(current) - hd.ML) / viewW * 100;
    mark.style.left = `${x}%`;
    mark.style.setProperty('--cc-profile-x', `${x}%`);
    mark.style.setProperty('--cc-profile-y', `${hd.Y(alt) / hd.BL * 100}%`);
    readout.textContent = `${current.toLocaleString(locale, { maximumFractionDigits: 1 })} km · ${Math.round(alt).toLocaleString(locale)} m`;
    mark.hidden = false;
    svgEl.setAttribute('aria-valuenow', current.toFixed(1));
    svgEl.setAttribute('aria-valuetext', readout.textContent);
    showKm?.(current);
  };
  host._ccProfileClear = () => select(null);

  const kmAt = (e) => {
    const box = svgEl.getBoundingClientRect();
    return box.width ? (e.clientX - box.left) / box.width * hd.xMax : null;
  };
  svgEl.addEventListener('pointerdown', e => select(kmAt(e)));
  svgEl.addEventListener('pointermove', e => select(kmAt(e)));
  // Con ratón la marca sigue al puntero; con el dedo queda donde se suelta.
  svgEl.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') select(null); });
  svgEl.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (step) select((current ?? 0) + step);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(hd.xMax);
    else if (e.key === 'Escape') select(null);
    else return;
    e.preventDefault();
  });
}

// Controles del toolbar: base (mapa/satélite) · 2D/3D · mostrar/ocultar perfil.
// `state` se comparte con addCustomLayers para reaplicar la elección tras un
// cambio de tema (setStyle reconstruye las capas).
function wireMapControls(map, state, q) {
  const base = q('base'), sat = q('sat');
  const b2d = q('2d'), b3d = q('3d');
  const prof = q('profile-toggle');

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
    const host = q('profile');
    const show = host.hidden;
    if (!show) host._ccProfileClear?.();
    host.hidden = !show;
    prof.classList.toggle('is-active', show);
  });
}
