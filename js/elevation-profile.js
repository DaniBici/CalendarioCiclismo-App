// Detailed elevation profile SVG component
// Returns an SVG string; inline injection inherits CSS vars from the document.

import { effectiveSummitAlt } from './climb-detection.js';

// All summit categories use red — the category goes inside the colored circle.
const SUMMIT_COLOR = '#c53030';

const SPRINT_META = {
  bonus_sprint:        { fill: '#f9ab00', label: 'Bonificación', letter: 'B', textColor: '#000' },
  intermediate_sprint: { fill: '#0f9d58', label: 'Sprint Int.',  letter: 'S', textColor: 'white' },
};

const WP_FILL = {
  town:               '#8e9099',
  cobblestone:        '#b0b0b0',
  sterrato:           '#c8a870',
  intermediate_split: '#00838f',
};
const WP_DISP = {
  town:               'Localidad',
  cobblestone:        'Pavé',
  sterrato:           'Sterrato',
  intermediate_split: 'Punto intermedio',
};

const CAT_DISP = { HC: 'HC', '1': '1', '2': '2', '3': '3', '4': '4', M: 'M' };

// Inner contents for the colored circle indicator (centered at 0,0).
// All paths/strokes are white to stand out on the colored fill.
//
// Mountain icon for uncategorized passes (category 'M'). Source: 14×9 path.
const CAT_M_ICON = '<g transform="translate(-7,-3)"><path d="M0 6 L4 -1.5 L7 2.5 L10 -2 L14 6 Z" fill="white"/></g>';

// Stopwatch (intermediate_split): hands + tiny crown on top.
const STOPWATCH_ICON =
  '<line x1="0" y1="-4" x2="0" y2="-0.6" stroke="white" stroke-width="1.6" stroke-linecap="round"/>' +
  '<line x1="0" y1="0" x2="2.6" y2="0" stroke="white" stroke-width="1.6" stroke-linecap="round"/>' +
  '<line x1="-2" y1="-7" x2="2" y2="-7" stroke="white" stroke-width="1.5" stroke-linecap="round"/>';

// Pavé icon (cobblestone) — same heptagon as the asset button.
// Source viewBox 24×24 → scale 0.55, center at (12,12) → translate(-6.6,-6.6).
const PAVE_ICON =
  '<g transform="translate(-6.6,-6.6) scale(0.55)" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M5 20L2 13L6 7L13 4L20 7L22 13L19 20Z"/>' +
  '</g>';

// Sterrato icon — same 3-pebble shape as the asset button.
const STERRATO_ICON =
  '<g transform="translate(-6.6,-6.6) scale(0.55)" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<ellipse cx="7" cy="15" rx="4.5" ry="3"/>' +
  '<ellipse cx="17" cy="15" rx="4" ry="2.8"/>' +
  '<ellipse cx="12.5" cy="9" rx="4.5" ry="3"/>' +
  '</g>';

// Start (play triangle), centered in the circle. Optically centered by nudging
// the barycentre (at x≈+1.3 for a triangle) back to 0.
const START_ICON = '<path d="M-3.3 -5 L5 0 L-3.3 5 Z" fill="white"/>';

// Finish (checkered flag), a 2×2 board centered at (0,0). Tile = 4 → 8×8 board.
const FINISH_ICON =
  '<g transform="translate(-4,-4)">' +
  '<rect x="0" y="0" width="8" height="8" fill="white" fill-opacity="0.3"/>' +
  '<rect x="0" y="0" width="4" height="4" fill="white"/>' +
  '<rect x="4" y="4" width="4" height="4" fill="white"/>' +
  '</g>';

// Climb foot (start of a climb): an upward arrow, centered on the diagonal.
const CLIMB_FOOT_ICON =
  '<g stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
  '<path d="M-4 4 L4 -4"/><path d="M0.5 -4 L4 -4 L4 -0.5"/>' +
  '</g>';

// Town / locality: a small solid dot.
const TOWN_ICON = '<circle cx="0" cy="0" r="2.6" fill="white"/>';

function sv(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtM(v) {
  if (v == null) return '';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' m';
}

// Build the inner content of an indicator circle. Returns SVG fragment
// centered at (0, 0); caller wraps it in `<g transform="translate(cx,cy)">`.
function indicatorInner(kind, data) {
  if (kind === 'summit') {
    const cat = data?.category;
    if (cat === 'M' || !cat) return CAT_M_ICON;
    const txt = CAT_DISP[cat] ?? String(cat);
    const fs  = txt.length >= 2 ? 9 : 11;
    return `<text text-anchor="middle" dominant-baseline="middle" x="0" y="0.5" `
      + `font-size="${fs}" font-weight="700" fill="white">${sv(txt)}</text>`;
  }
  if (kind === 'intermediate_sprint' || kind === 'bonus_sprint') {
    const { letter, textColor } = SPRINT_META[kind];
    return `<text text-anchor="middle" dominant-baseline="middle" x="0" y="0.5" `
      + `font-size="11" font-weight="700" fill="${textColor}">${letter}</text>`;
  }
  if (kind === 'intermediate_split') return STOPWATCH_ICON;
  if (kind === 'cobblestone')        return PAVE_ICON;
  if (kind === 'sterrato')           return STERRATO_ICON;
  return '';
}

// Color of the indicator circle for a given annotation kind.
function indicatorColor(kind) {
  if (kind === 'summit')              return SUMMIT_COLOR;
  if (SPRINT_META[kind])              return SPRINT_META[kind].fill;
  return WP_FILL[kind] ?? '#8e9099';
}

// Standalone badge SVG — same look as the indicators inside the elevation
// profile, ready to be embedded anywhere (race cards, lists, etc.).
// `data` is the source object (summit or waypoint); `kind` is 'summit' for
// summits, or the waypoint type ('intermediate_sprint', 'bonus_sprint',
// 'intermediate_split', 'cobblestone', 'sterrato').
export function indicatorBadgeSVG(kind, data, { size = 16 } = {}) {
  const r     = size / 2 - 1;
  const c     = size / 2;
  const col   = indicatorColor(kind);
  const inner = indicatorInner(kind, data);
  // Inner content is sized for r=9 (the profile reference); scale to fit.
  const scale = r / 9;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
    + `viewBox="0 0 ${size} ${size}" class="ann-ind" aria-hidden="true">`
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="${col}"/>`
    + `<g transform="translate(${c},${c}) scale(${scale.toFixed(3)})">${inner}</g>`
    + `</svg>`;
}

// ── Marcador de la guía simplificada de horarios (rutómetro ampliado) ─────────
// Colores propios de la guía (ligeramente distintos de los del perfil) y glifos
// SVG vectoriales bien dimensionados dentro del círculo, en lugar de caracteres
// Unicode (cuyas métricas dispares descuadraban el tamaño). Fuente única para
// web; las apps replican estos glifos de forma nativa (paridad).
const GUIDE_COLOR = {
  start:               '#3dba6f',
  finish:              '#e63d3d',
  climb_foot:          '#c53030',
  summit:              '#c53030',
  intermediate_sprint: '#3dba6f',
  bonus_sprint:        '#e6b800',
  intermediate_split:  '#1a5ca8',
  cobblestone:         '#8c8c8c',
  sterrato:            '#c4975a',
  town:                '#8c8c8c',
};

function guideInner(kind, category) {
  switch (kind) {
    case 'start':               return START_ICON;
    case 'finish':              return FINISH_ICON;
    case 'climb_foot':          return CLIMB_FOOT_ICON;
    case 'town':                return TOWN_ICON;
    case 'intermediate_split':  return STOPWATCH_ICON;
    case 'cobblestone':         return PAVE_ICON;
    case 'sterrato':            return STERRATO_ICON;
    case 'intermediate_sprint': return `<text text-anchor="middle" dominant-baseline="middle" x="0" y="0.5" font-size="11" font-weight="700" fill="white">S</text>`;
    case 'bonus_sprint':        return `<text text-anchor="middle" dominant-baseline="middle" x="0" y="0.5" font-size="11" font-weight="700" fill="#000">B</text>`;
    case 'summit': {
      if (!category || category === 'M') return CAT_M_ICON;
      const txt = CAT_DISP[category] ?? String(category);
      const fs  = txt.length >= 2 ? 9 : 11;
      return `<text text-anchor="middle" dominant-baseline="middle" x="0" y="0.5" font-size="${fs}" font-weight="700" fill="white">${sv(txt)}</text>`;
    }
    default:                    return TOWN_ICON;
  }
}

// Badge SVG for a simplified-guide row. `kind` is a guide row type
// ('start', 'finish', 'climb_foot', 'summit', 'intermediate_sprint',
// 'bonus_sprint', 'intermediate_split', 'cobblestone', 'sterrato', 'town').
// `category` (optional) is the summit category ('HC','1'..'4','M').
export function guideMarkerSVG(kind, { size = 20, category = null } = {}) {
  const r     = size / 2 - 1;
  const c     = size / 2;
  const col   = GUIDE_COLOR[kind] ?? '#8c8c8c';
  const inner = guideInner(kind, category);
  const scale = r / 9; // inner glyphs are drawn for the r=9 reference
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
    + `viewBox="0 0 ${size} ${size}" class="sg-marker-svg" aria-hidden="true">`
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="${col}"/>`
    + `<g transform="translate(${c},${c}) scale(${scale.toFixed(3)})">${inner}</g>`
    + `</svg>`;
}

// Returns true if `kind` produces a renderable circle indicator. 'town'
// stays a triangle in the profile and is excluded from card badges.
export function isIndicatorKind(kind) {
  return kind === 'summit'
      || !!SPRINT_META[kind]
      || kind === 'intermediate_split'
      || kind === 'cobblestone'
      || kind === 'sterrato';
}

// ── Sparkline de elevación para race cards ────────────────────────────────────
// CSS height of the sparkline element — must match .race-card__elevation height.
const EP_CSS_H      = 58;
const EP_MIN_PADDING  = 100;
const EP_MAX_PADDING  = 300;
const EP_RANGE_FACTOR = 0.1;

// Builds the SVG sparkline + indicator badges HTML for a race card.
// progressFraction ∈ [0,1]: 0 = static (before start), >0 = live progress.
// Returns null if profile data is insufficient.
export function buildElevationSparkline(profile, progressFraction, rdId, fillColor, summits = [], waypoints = []) {
  if (!profile || !Array.isArray(profile.points) || profile.points.length < 2 || !profile.distance) return null;
  const range   = profile.maxElevation - profile.minElevation;
  const padding = Math.max(EP_MIN_PADDING, EP_MAX_PADDING - range * EP_RANGE_FACTOR);
  const yMin    = Math.max(0, profile.minElevation - padding);
  const yMax    = profile.maxElevation + padding;
  const yRange  = yMax - yMin;
  if (yRange <= 0) return null;

  const yCoord = alt => 28 - ((alt - yMin) / yRange) * 27;

  const rawPts = profile.points;
  const ptsStr = rawPts.map(p => {
    const x = (p.km / profile.distance) * 100;
    return `${x.toFixed(2)},${yCoord(p.alt).toFixed(2)}`;
  });
  const yFirst = yCoord(rawPts[0].alt).toFixed(2);
  const yLast  = yCoord(rawPts[rawPts.length - 1].alt).toFixed(2);
  // Extend fill horizontally at the first/last GPX altitude to avoid diagonal
  // drop-offs when the GPX doesn't start at km=0 or end at the full distance.
  const pathD  = `M0,${yFirst} L${ptsStr.join(' L')} L100,${yLast} L100,30 L0,30 Z`;
  const clipId = `ep-${rdId}`;
  const clipW  = (Math.min(1, Math.max(0, progressFraction)) * 100).toFixed(2);

  const svgHtml = `<svg class="race-card__elevation" viewBox="0 0 100 30" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${clipW}" height="30"/></clipPath></defs>`
    + `<path d="${pathD}" fill="#d1d5db" fill-opacity="0.55"/>`
    + `<path d="${pathD}" fill="${fillColor || 'var(--accent)'}" fill-opacity="1" clip-path="url(#${clipId})"/>`
    + `<line x1="0" y1="29.5" x2="100" y2="29.5" stroke="#d1d5db" stroke-opacity="0.4" stroke-width="0.5"/>`
    + `</svg>`;

  const interpAlt = km => {
    if (km <= rawPts[0].km) return rawPts[0].alt;
    const last = rawPts[rawPts.length - 1];
    if (km >= last.km) return last.alt;
    for (let i = 0; i < rawPts.length - 1; i++) {
      if (km >= rawPts[i].km && km <= rawPts[i + 1].km) {
        const t = (km - rawPts[i].km) / (rawPts[i + 1].km - rawPts[i].km);
        return rawPts[i].alt + t * (rawPts[i + 1].alt - rawPts[i].alt);
      }
    }
    return last.alt;
  };

  const IND_SIZE = 12;
  const dist = profile.distance;
  const toPx = alt => (yCoord(alt) / 30 * EP_CSS_H).toFixed(1);

  let spans = '';
  for (const s of (summits ?? [])) {
    if (s?.km == null || s.km < 0 || s.km > dist) continue;
    const x = (s.km / dist * 100).toFixed(1);
    const y = toPx(s.altitude != null ? s.altitude : interpAlt(s.km));
    spans += `<span style="left:${x}%;top:${y}px">${indicatorBadgeSVG('summit', s, { size: IND_SIZE })}</span>`;
  }
  for (const w of (waypoints ?? [])) {
    if (w?.km == null || !isIndicatorKind(w.type) || w.km < 0 || w.km > dist) continue;
    const x = (w.km / dist * 100).toFixed(1);
    const y = toPx(interpAlt(w.km));
    spans += `<span style="left:${x}%;top:${y}px">${indicatorBadgeSVG(w.type, w, { size: IND_SIZE })}</span>`;
  }

  if (!spans) return svgHtml;
  return svgHtml + `<div class="race-card__ep-inds" aria-hidden="true">${spans}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function buildElevationProfileSVG({
  profile,
  summits   = [],
  waypoints = [],
  startLocation  = '',
  finishLocation = '',
  width  = 1200,
  height = 400,
  color  = null,
  lang   = 'es',
  // Opt-in: silueta + sombreado de puertos + segmentos + badges (sin nombre,
  // altitud ni guía vertical) y SIN ejes, rejilla, etiquetas, salida ni meta.
  // Pensado para exportar el miniperfil "solo iconos". Por defecto false: el
  // render normal de la web no cambia (mismo generador, single source of truth).
  iconsOnly = false,
} = {}) {
  if (!profile?.points?.length || profile.points.length < 2) {
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" `
      + `font-family="var(--font-body)" font-size="14" fill="var(--text-muted)">Sin datos de perfil</text></svg>`;
    return { svg: svgStr, hoverData: null };
  }

  const uid = Math.random().toString(36).slice(2, 8);

  // ── Layout ────────────────────────────────────────────────────────
  const ML = 68, MR = 30, MT = 34, MB = 92;
  const PW = width - ML - MR;
  const PH = height - MT - MB;
  const BL = MT + PH;

  // ── Y domain ─────────────────────────────────────────────────────
  const yMin   = Math.max(0, profile.minElevation - 150);
  const yMax   = Math.max(1100, profile.maxElevation + 200);
  const yRange = yMax - yMin;
  const xMax   = profile.distance;

  const X  = km  => ML + (km / xMax) * PW;
  const Y  = alt => MT + PH - ((alt - yMin) / yRange) * PH;

  const pts = profile.points;

  // Interpolate altitude from the profile polyline at a given km distance.
  const interpolateAlt = km => {
    if (km <= pts[0].km) return pts[0].alt;
    const last = pts[pts.length - 1];
    if (km >= last.km) return last.alt;
    for (let i = 0; i < pts.length - 1; i++) {
      if (km >= pts[i].km && km <= pts[i + 1].km) {
        const t = (km - pts[i].km) / (pts[i + 1].km - pts[i].km);
        return pts[i].alt + t * (pts[i + 1].alt - pts[i].alt);
      }
    }
    return last.alt;
  };

  // ── Path data ─────────────────────────────────────────────────────
  const lineD = pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${X(p.km).toFixed(2)},${Y(p.alt).toFixed(2)}`
  ).join(' ');
  const fillD = `${lineD} L${X(xMax).toFixed(2)},${BL} L${ML},${BL} Z`;

  // ── Solid fill + outline ──────────────────────────────────────────
  const lineColor = color || 'var(--accent)';
  const profileLayers = `<path d="${fillD}" fill="${lineColor}" fill-opacity="0.42"/>
    <path d="${lineD}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round"/>`;

  // ── Climb zones (puertos con startKm definido) ────────────────────
  // Sombrea el área bajo la curva entre startKm y el km de la cima en color
  // rojo translúcido. El detalle (km y %) lo muestra el handler de hover.
  // climbsMeta queda expuesto en hoverData para el tooltip interactivo.
  const climbsMeta = [];
  let climbZonesSvg = '';
  for (const s of (summits ?? [])) {
    if (s.km == null || s.startKm == null || s.startKm >= s.km) continue;
    const startKm = Math.max(0, s.startKm);
    const endKm   = Math.min(s.km, xMax);
    if (endKm - startKm < 0.05) continue;
    const startAlt  = interpolateAlt(startKm);
    const summitAlt = interpolateAlt(endKm);
    const lengthKm  = endKm - startKm;
    const avgGrad   = ((summitAlt - startAlt) / (lengthKm * 1000)) * 100;
    // Polígono cerrado por la base para sombrear bajo la curva.
    const segPts = [{ km: startKm, alt: startAlt }];
    for (const p of pts) {
      if (p.km > startKm && p.km < endKm) segPts.push(p);
    }
    segPts.push({ km: endKm, alt: interpolateAlt(endKm) });
    const upper = segPts.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${X(p.km).toFixed(2)},${Y(p.alt).toFixed(2)}`
    ).join(' ');
    const closed = `${upper} L${X(endKm).toFixed(2)},${BL} L${X(startKm).toFixed(2)},${BL} Z`;
    climbZonesSvg += `<path class="ep-climb-zone" d="${closed}" fill="${SUMMIT_COLOR}" fill-opacity="0.22"/>`;
    climbsMeta.push({
      startKm, endKm,
      lengthKm:    Math.round(lengthKm * 10) / 10,
      avgGradient: Math.round(avgGrad * 10) / 10,
      gain:        Math.round(summitAlt - startAlt),
      summitAlt:   Math.round(summitAlt),
      name:        s.name || null,
      category:    s.category || null,
    });
  }

  // ── Y grid & labels ───────────────────────────────────────────────
  const yStep  = yRange < 600 ? 100 : yRange > 2500 ? 500 : 200;
  const yFirst = Math.ceil(yMin / yStep) * yStep;
  let yGrid = '', yTicks = '';
  for (let alt = yFirst; alt <= yMax; alt += yStep) {
    const cy = Y(alt).toFixed(2);
    yGrid  += `<line x1="${ML}" y1="${cy}" x2="${ML + PW}" y2="${cy}" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="4,3"/>`;
    yTicks += `<text x="${ML - 7}" y="${cy}" text-anchor="end" dominant-baseline="middle" `
            + `font-size="11" fill="var(--text-muted)">${String(alt).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}</text>`;
  }
  const yAxisLabel = `<text x="${ML - 46}" y="${MT + PH / 2}" text-anchor="middle" dominant-baseline="middle" `
    + `font-size="10" fill="var(--text-muted)" `
    + `transform="rotate(-90,${ML - 46},${MT + PH / 2})">${lang === 'en' ? 'altitude (m)' : 'altitud (m)'}</text>`;

  // ── X grid & labels ───────────────────────────────────────────────
  const isNarrow = width < 900;
  const xStep = xMax < 80
    ? 5
    : isNarrow
      ? (xMax > 200 ? 30 : 20)
      : 10;
  let xGrid = '', xTicks = '';
  for (let km = 0; km <= xMax + 0.001; km += xStep) {
    if (km > xMax + 0.5) break;
    const cx = X(Math.min(km, xMax)).toFixed(2);
    xGrid  += `<line x1="${cx}" y1="${MT}" x2="${cx}" y2="${BL}" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="4,3"/>`;
    xTicks += `<text x="${cx}" y="${BL + 14}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${Math.round(km)}</text>`;
  }
  const xUnitLabel = `<text x="${ML + PW + 2}" y="${BL + 14}" text-anchor="start" `
    + `font-size="10" font-style="italic" fill="var(--text-muted)">km</text>`;

  // ── Axes borders ──────────────────────────────────────────────────
  const axes = `<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${BL}" stroke="var(--border-light)" stroke-width="1"/>
    <line x1="${ML}" y1="${BL}" x2="${ML + PW}" y2="${BL}" stroke="var(--border-light)" stroke-width="1"/>`;

  // ── Annotations: build unified list ───────────────────────────────
  // All summits + relevant waypoints become circle indicators (puertos,
  // sprints, bonificación, punto intermedio, pavé, sterrato). Los waypoints
  // de ciudad se muestran como una referencia textual con conector: sin icono
  // y siempre fuera de la silueta. 'kom' is deprecated and ignored.
  const CIRCLE_WP_TYPES = new Set([
    'intermediate_sprint', 'bonus_sprint',
    'intermediate_split', 'cobblestone', 'sterrato',
  ]);
  const inRange = w => w.km != null && w.km >= 0 && w.km <= xMax;

  const filteredWp = (waypoints ?? []).filter(w => inRange(w) && w.type !== 'kom');
  const circleWp   = filteredWp.filter(w =>  CIRCLE_WP_TYPES.has(w.type));
  const lineWp     = filteredWp.filter(w => !CIRCLE_WP_TYPES.has(w.type));

  // ── Pavé / sterrato segment overlays ─────────────────────────────
  // For cobblestone/sterrato waypoints with lengthKm, draw a thicker
  // colored stroke following the elevation curve over the whole sector.
  // Placed after the main fill+stroke so it renders on top of the accent line.
  let segmentSvg = '';
  for (const wp of circleWp) {
    if ((wp.type !== 'cobblestone' && wp.type !== 'sterrato') || !wp.lengthKm) continue;
    const endKm = Math.min(wp.km + wp.lengthKm, xMax);
    const col   = WP_FILL[wp.type];
    const segPts = [{ km: wp.km, alt: interpolateAlt(wp.km) }];
    for (const p of pts) {
      if (p.km > wp.km && p.km < endKm) segPts.push(p);
    }
    segPts.push({ km: endKm, alt: interpolateAlt(endKm) });
    if (segPts.length < 2) continue;
    const d = segPts.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${X(p.km).toFixed(2)},${Y(p.alt).toFixed(2)}`
    ).join(' ');
    segmentSvg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="3.5"
      stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // ── Circle indicators (summits + circle waypoints) ───────────────
  // En móvil (compact) renderizamos solo el círculo con la letra/icono
  // dentro, sin texto externo, para evitar el coste del layout y choques
  // con otros elementos en anchos estrechos.
  // En escritorio el texto va exento (sin tarjeta): nombre a la izquierda
  // del círculo en línea 1; si hay altitud (solo puertos), en línea 2.
  const compact = width < 600;

  // Tolerancia summit fuera de rango: si el km nominal del summit excede
  // ligeramente el GPX (cima coincide con la meta), capeamos al último km
  // visible para que se siga dibujando. Ver detector en js/climb-detection.js.
  const SUMMIT_OVERSHOOT_TOL = 2;
  const validSum  = (summits ?? [])
    .filter(s => s.km != null && s.km >= 0 && s.km - xMax <= SUMMIT_OVERSHOOT_TOL)
    .map(s => s.km > xMax ? { ...s, km: xMax } : s);
  const sortedSum = [...validSum].sort((a, b) => a.km - b.km);

  // Normalize all annotations into a single list to compute layout/collisions.
  // El GPX es siempre la fuente de verdad de la altitud — ignoramos s.altitude
  // para el anchor visual aunque venga manual, ya que la curva pintada se basa
  // en interpolateAlt y cualquier divergencia produce un punto descolgado de
  // la curva (caso Capodarco: 225 m manual vs 310 m GPX).
  const annots = [];
  for (const s of sortedSum) {
    annots.push({ kind: 'summit', item: s, km: s.km, anchorY: Y(interpolateAlt(s.km)) });
  }
  for (const wp of circleWp) {
    annots.push({ kind: wp.type, item: wp, km: wp.km, anchorY: Y(interpolateAlt(wp.km)) });
  }
  // Los waypoints de localidad se reservan para el perfil de escritorio: no
  // tienen icono y sus nombres no caben con claridad ni en móvil ni en el
  // miniperfil de los assets. Los demás tipos de waypoint siguen entrando en
  // `circleWp` y se mantienen también en esos dos contextos.
  if (!iconsOnly && !compact) {
    for (const wp of lineWp) {
      annots.push({ kind: 'waypoint', item: wp, km: wp.km, anchorY: Y(interpolateAlt(wp.km)) });
    }
  }
  annots.sort((a, b) => a.km - b.km);

  let summitSvg = '';
  let sprintSvg = '';
  let waypointSvg = '';

  if (compact) {
    // Mobile: just the colored circle floating above the anchor point.
    const R = 7;
    for (const a of annots) {
      const cx  = X(a.km);
      const cy  = a.anchorY - R - 3;
      const cxF = cx.toFixed(2);
      const cyF = cy.toFixed(2);
      const col = indicatorColor(a.kind);
      const inner = indicatorInner(a.kind, a.item);
      const isSummit = a.kind === 'summit';
      const guide = (isSummit && !iconsOnly)
        ? `<line x1="${cxF}" y1="${MT}" x2="${cxF}" y2="${BL}"
                stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`
        : '';
      const cls = isSummit ? 'ep-summit' : 'ep-sprint';
      const fragment = `<g class="${cls}">
        ${guide}
        <circle cx="${cxF}" cy="${cyF}" r="${R}" fill="${col}" stroke="var(--bg-card)" stroke-width="1.4"/>
        <g transform="translate(${cxF},${cyF})">${inner}</g>
      </g>`;
      if (isSummit) summitSvg += fragment;
      else sprintSvg += fragment;
    }
  } else {
    // Desktop: text exposed (no card) + circle indicator.
    const R         = 9;
    const GAP_NAME  = 5;
    const FONT_NAME = 11;
    const FONT_META = 9.5;
    const LINE_GAP  = 2;
    const CARD_GAP  = 6;
    const CURVE_GAP = 8;
    const LH1       = R * 2;
    const LH2       = FONT_META + 2;

    // Approximate text width (proportional font, only orientative).
    const measureName = (str) => Math.ceil((str || '').length * (FONT_NAME * 0.58));
    const measureMeta = (str) => Math.ceil((str || '').length * (FONT_META * 0.58));

    // Min Y (max altitude) of the elevation curve within an x-pixel range.
    const curveMinYInRange = (xStart, xEnd) => {
      let minY = BL;
      for (const p of pts) {
        const cx = X(p.km);
        if (cx >= xStart && cx <= xEnd) {
          const py = Y(p.alt);
          if (py < minY) minY = py;
        }
      }
      return minY;
    };

    // Build label descriptors with per-annotation bounding box.
    // Each card has two layout variants: normal (name left of circle) and
    // flipped (name right of circle). Collision avoidance tries normal first;
    // if it gets stuck at the ceiling it retries with the flipped variant.
    const cards = [];
    for (const a of annots) {
      const item    = a.item;
      const cx      = X(a.km);
      const isLineWaypoint = a.kind === 'waypoint';
      const hasName = !!(item.name?.trim());
      const altStr  = '';
      const hasAlt  = !!altStr;

      const nameW = hasName ? measureName(item.name) : 0;
      const altW  = hasAlt  ? measureMeta(altStr)    : 0;

      const circleCx = cx;
      let lx, lw, lx_f, lw_f;

      if (isLineWaypoint) {
        // Sin badge ni tarjeta: el nombre queda centrado sobre una línea que
        // baja hasta el punto exacto del recorrido.
        lx = cx - nameW / 2;
        lw = nameW;
        lx_f = lx;
        lw_f = lw;
      } else if (hasName) {
        // Normal: [name][circle]
        const nameLeftX = circleCx - R - GAP_NAME - nameW;
        lx = nameLeftX;
        lw = Math.max((circleCx + R) - nameLeftX, altW);
        // Flipped: [circle][name]
        lx_f = circleCx - R;
        lw_f = R * 2 + GAP_NAME + Math.max(nameW, altW);
      } else {
        // No name: circle only, same for both variants
        lw = Math.max(R * 2, altW);
        lx = cx - lw / 2;
        lx_f = lx; lw_f = lw;
      }
      const lh = isLineWaypoint ? FONT_NAME + 4 : (hasAlt ? (LH1 + LINE_GAP + LH2) : LH1);

      const mkBaseLy = (bx, bw) => {
        const ceil = curveMinYInRange(bx, bx + bw);
        const init = Math.min(a.anchorY - lh - 12, ceil - lh - CURVE_GAP);
        return Math.max(MT + 4, init);
      };
      const baseLy   = mkBaseLy(lx,   lw);
      const baseLy_f = mkBaseLy(lx_f, lw_f);

      cards.push({
        kind: a.kind, item, cx, anchorY: a.anchorY, isLineWaypoint,
        lx, lw, lx_f, lw_f, lh, baseLy, baseLy_f,
        hasName, hasAlt, altStr, circleCx,
      });
    }

    cards.sort((a, b) => a.cx - b.cx);

    // Greedy collision avoidance — stack labels upward when they overlap.
    // If stacking hits the ceiling, retry with the flipped variant (name on
    // the opposite side of the circle) before falling back to best-effort.
    const placed = [];

    const tryPlace = (lx, lw, lh, baseLy) => {
      let ly = baseLy;
      while (true) {
        let hit = null;
        for (const p of placed) {
          const overX = lx < p.lx + p.lw + CARD_GAP && lx + lw + CARD_GAP > p.lx;
          const overY = ly < p.ly + p.lh + CARD_GAP && ly + lh + CARD_GAP > p.ly;
          if (overX && overY) { hit = p; break; }
        }
        if (!hit) return ly;
        const newLy = Math.max(MT + 4, hit.ly - lh - CARD_GAP);
        if (newLy === ly) return null; // stuck at ceiling
        ly = newLy;
      }
    };

    for (const card of cards) {
      // Summits may carry a `side` override ('left'|'right') set in the data editor.
      // 'right' forces the flipped variant (label to the right of the circle).
      // 'left' forces the normal variant (label to the left). Auto-avoid otherwise.
      const sideOverride = card.kind === 'summit' ? (card.item.side ?? null) : null;
      let ly, flipped = false;

      if (card.isLineWaypoint) {
        ly = tryPlace(card.lx, card.lw, card.lh, card.baseLy);
        if (ly === null) ly = card.baseLy;
      } else if (sideOverride === 'right') {
        ly = tryPlace(card.lx_f, card.lw_f, card.lh, card.baseLy_f);
        if (ly === null) ly = card.baseLy_f;
        flipped = true;
      } else if (sideOverride === 'left') {
        ly = tryPlace(card.lx, card.lw, card.lh, card.baseLy);
        if (ly === null) ly = card.baseLy;
      } else {
        ly = tryPlace(card.lx, card.lw, card.lh, card.baseLy);
        if (ly === null) {
          const ly_f = tryPlace(card.lx_f, card.lw_f, card.lh, card.baseLy_f);
          if (ly_f !== null) {
            ly = ly_f;
            flipped = true;
          } else {
            ly = card.baseLy; // both stuck — best effort
          }
        }
      }

      card.ly = ly;
      card.flipped = flipped;
      const usedLx = flipped ? card.lx_f : card.lx;
      const usedLw = flipped ? card.lw_f : card.lw;
      placed.push({ lx: usedLx, ly, lw: usedLw, lh: card.lh });
    }

    // Render
    for (const card of cards) {
      const { kind, item, cx, anchorY, lx, lh, ly, hasName, hasAlt, altStr, circleCx, flipped, isLineWaypoint } = card;
      const cxF = cx.toFixed(2);
      if (isLineWaypoint) {
        if (!hasName) continue;
        waypointSvg += `<g class="ep-waypoint">
          <line x1="${cxF}" y1="${(ly + lh + 2).toFixed(2)}" x2="${cxF}" y2="${(anchorY - 3).toFixed(2)}"
                stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,2"/>
          <text x="${cxF}" y="${(ly + lh / 2).toFixed(2)}" text-anchor="middle" dominant-baseline="middle"
                font-size="${FONT_NAME}" font-weight="600" fill="var(--text-muted)">${sv(item.name)}</text>
        </g>`;
        continue;
      }
      const col = indicatorColor(kind);
      const isSummit = kind === 'summit';

      const circleCy = ly + R;
      const inner    = indicatorInner(kind, item);

      // Vertical guide line for summits (full chart height, gray dashed).
      // Omitida en iconsOnly: el export conserva punto de anclaje + conector,
      // pero no la guía vertical.
      const guide = (isSummit && !iconsOnly)
        ? `<line x1="${cxF}" y1="${MT}" x2="${cxF}" y2="${BL}"
                stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`
        : '';

      // Anchor dot at the peak (only for summits, to mark exact top).
      const anchorDot = isSummit
        ? `<circle cx="${cxF}" cy="${anchorY.toFixed(2)}" r="3.2"
                fill="${col}" stroke="var(--bg-card)" stroke-width="1.5"/>`
        : '';

      // Connector from label bottom to anchor.
      const connector = `<line x1="${cxF}" y1="${(ly + lh + 2).toFixed(2)}" x2="${cxF}" y2="${(anchorY - 4).toFixed(2)}"
                stroke="${col}" stroke-width="1" stroke-dasharray="2,2"/>`;

      // Name: normal → right-aligned left of circle; flipped → left-aligned right of circle.
      // Omitido en iconsOnly (solo el número/letra/icono dentro del círculo).
      const nameY = ly + R;
      let nameSvg = '';
      if (hasName && !iconsOnly) {
        if (flipped) {
          const nameLeftX = circleCx + R + GAP_NAME;
          nameSvg = `<text x="${nameLeftX.toFixed(2)}" y="${nameY.toFixed(2)}"
                text-anchor="start" dominant-baseline="middle"
                font-size="${FONT_NAME}" font-weight="600" fill="var(--text)">${sv(item.name)}</text>`;
        } else {
          const nameRightX = circleCx - R - GAP_NAME;
          nameSvg = `<text x="${nameRightX.toFixed(2)}" y="${nameY.toFixed(2)}"
                text-anchor="end" dominant-baseline="middle"
                font-size="${FONT_NAME}" font-weight="600" fill="var(--text)">${sv(item.name)}</text>`;
        }
      }

      // Altitude: line 2, below the circle, aligned with the name side.
      const altY = ly + LH1 + LINE_GAP;
      let altSvg = '';
      if (hasAlt) {
        if (hasName) {
          const altX = flipped ? (circleCx + R + GAP_NAME) : lx;
          const altAnchor = flipped ? 'start' : 'start';
          altSvg = `<text x="${altX.toFixed(2)}" y="${altY.toFixed(2)}"
                text-anchor="${altAnchor}" dominant-baseline="hanging"
                font-size="${FONT_META}" fill="var(--text-muted)">${sv(altStr)}</text>`;
        } else {
          altSvg = `<text x="${cxF}" y="${altY.toFixed(2)}"
                text-anchor="middle" dominant-baseline="hanging"
                font-size="${FONT_META}" fill="var(--text-muted)">${sv(altStr)}</text>`;
        }
      }

      const cls = isSummit ? 'ep-summit' : 'ep-sprint';
      const fragment = `<g class="${cls}">
        ${guide}
        ${anchorDot}
        ${connector}
        ${nameSvg}
        <circle cx="${circleCx.toFixed(2)}" cy="${circleCy.toFixed(2)}" r="${R}"
                fill="${col}" stroke="var(--bg-card)" stroke-width="1.4"/>
        <g transform="translate(${circleCx.toFixed(2)},${circleCy.toFixed(2)})">${inner}</g>
        ${altSvg}
      </g>`;
      if (isSummit) summitSvg += fragment;
      else sprintSvg += fragment;
    }
  }

  // ── Start / Finish ────────────────────────────────────────────────
  const sx   = X(0);
  const fx   = X(xMax);
  const metaY = BL + 24;
  const lblY  = BL + 36;

  const startSvg = `<g class="ep-start">
    <polygon points="${sx - 2},${BL - 10} ${sx + 8},${BL - 5} ${sx - 2},${BL}"
             fill="var(--accent)" opacity="0.9"/>
    <text x="${sx}" y="${metaY}" text-anchor="middle" font-size="9"
          fill="var(--text-muted)">${lang === 'en' ? 'Start' : 'Salida'}</text>
    <text x="${sx}" y="${lblY}" text-anchor="middle" font-size="10.5" font-weight="600"
          fill="var(--text)">${sv(startLocation)}</text>
  </g>`;

  // Checkered flag
  const py = BL - 26;
  const fw = 14, fh = 10;
  const finishSvg = `<g class="ep-finish">
    <line x1="${fx}" y1="${py}" x2="${fx}" y2="${BL}"
          stroke="var(--text-muted)" stroke-width="1.5"/>
    <rect x="${fx}"          y="${py}"        width="${fw}"     height="${fh}" fill="var(--text)" fill-opacity="0.85"/>
    <rect x="${fx}"          y="${py}"        width="${fw / 2}" height="${fh / 2}" fill="var(--bg-card)" fill-opacity="0.7"/>
    <rect x="${fx + fw / 2}" y="${py}"        width="${fw / 2}" height="${fh / 2}" fill="var(--text)"    fill-opacity="0.85"/>
    <rect x="${fx}"          y="${py + fh/2}" width="${fw / 2}" height="${fh / 2}" fill="var(--text)"    fill-opacity="0.85"/>
    <rect x="${fx + fw / 2}" y="${py + fh/2}" width="${fw / 2}" height="${fh / 2}" fill="var(--bg-card)" fill-opacity="0.7"/>
    <text x="${fx}" y="${metaY}" text-anchor="middle" font-size="9"
          fill="var(--text-muted)">${lang === 'en' ? 'Finish' : 'Meta'}</text>
    <text x="${fx}" y="${lblY}" text-anchor="middle" font-size="10.5" font-weight="600"
          fill="var(--text)">${sv(finishLocation)}</text>
  </g>`;

  // ── Assemble ──────────────────────────────────────────────────────
  // iconsOnly: solo silueta + sombreado de puertos + segmentos + badges.
  // Sin rejilla, ejes, etiquetas, ticks, salida ni meta. Fondo transparente
  // (no se pinta ningún rect) para que el PNG exportado salga con alfa.
  const inner = iconsOnly
    ? `
  ${profileLayers}
  ${climbZonesSvg}
  ${segmentSvg}
  ${waypointSvg}
  ${sprintSvg}
  ${summitSvg}
`
    : `
  ${yGrid}
  ${xGrid}
  ${profileLayers}
  ${climbZonesSvg}
  ${segmentSvg}
  ${axes}
  ${yAxisLabel}
  ${yTicks}
  ${xTicks}
  ${xUnitLabel}
  ${waypointSvg}
  ${sprintSvg}
  ${summitSvg}
  ${startSvg}
  ${finishSvg}
`;
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg"
    width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
    style="font-family:var(--font-body,'Google Sans',Roboto,sans-serif);display:block;overflow:visible;"
    class="ep-detailed">${inner}</svg>`;

  // Export hover data for interactive tooltip
  const hoverData = {
    width, height, ML, MR, MT, MB,
    PW, PH, BL,
    yMin, yMax, yRange, xMax,
    profile: pts,
    interpolateAlt,
    X: km => ML + (km / xMax) * PW,
    Y: alt => MT + PH - ((alt - yMin) / yRange) * PH,
    lang,
    climbs: climbsMeta,
  };

  return { svg: svgStr, hoverData };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export del miniperfil "solo iconos" a PNG (100% en cliente, canvas).
// ─────────────────────────────────────────────────────────────────────────────

// Sustituye cada `var(--x)` / `var(--x, fallback)` del string SVG por su valor
// resuelto en el tema activo. Al rasterizar en canvas el SVG se renderiza
// AISLADO y no hereda las custom properties de la página, así que hay que
// hornearlas en el string antes de dibujar. Resuelve contra el elemento dado
// (por defecto :root, donde theme.js aplica las clases light/dark), de modo que
// respeta el tema vigente en vez de fijar uno. Soporta fallback con comas
// (p. ej. font-family) y resolución encadenada (un token que apunta a otro var).
function _resolveCssVars(svg, rootEl) {
  const el    = rootEl || document.documentElement;
  const style = getComputedStyle(el);
  const cache = new Map();

  const lookup = (name) => {
    if (cache.has(name)) return cache.get(name);
    // WebKit (Safari) normaliza listas font-family en custom properties a comillas
    // DOBLES (p. ej. --font-body → "Google Sans", "Roboto", sans-serif). Al hornear
    // ese valor en un atributo `style="…"` (también con comillas dobles) se rompe el
    // XML y el <img> del SVG falla al cargar SOLO en Safari (Chrome usa comillas
    // simples y no colisiona). Normalizar a comillas SIMPLES es válido tanto en CSS
    // (delimitador de nombre de fuente) como dentro del atributo de doble comilla.
    const v = style.getPropertyValue(name).trim().replace(/"/g, "'");
    cache.set(name, v);
    return v;
  };

  // Reemplaza la primera `var(...)` (con paréntesis balanceado) que encuentre,
  // repitiendo hasta que no quede ninguna. Itera para resolver anidamientos.
  const replaceOnce = (str) => {
    const idx = str.indexOf('var(');
    if (idx === -1) return null;
    // Localiza el paréntesis de cierre correspondiente.
    let depth = 0, end = -1;
    for (let i = idx + 3; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null; // var( sin cierre: dejar tal cual
    const body = str.slice(idx + 4, end); // contenido entre paréntesis
    const comma = body.indexOf(',');
    const name     = (comma === -1 ? body : body.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : body.slice(comma + 1).trim();
    const resolved = lookup(name) || fallback;
    return str.slice(0, idx) + resolved + str.slice(end + 1);
  };

  let out = svg;
  // Tope de seguridad por si una cadena de fallbacks se realimentara.
  for (let i = 0; i < 5000; i++) {
    const next = replaceOnce(out);
    if (next === null) break;
    out = next;
  }
  return out;
}

// Genera el miniperfil en versión "solo iconos" y lo descarga como PNG de alta
// resolución, fondo transparente. Usa el MISMO generador que la web (flag
// iconsOnly) — single source of truth. `opts` se reenvía a
// buildElevationProfileSVG (profile, summits, waypoints, color, lang…).
// `filename` define el nombre del archivo; `scale` el factor sobre el viewBox
// natural (1200×400 → 2x ≈ 2400 px de ancho). `themeEl` permite forzar el
// elemento del que se leen las variables CSS (por defecto el tema activo).
export async function exportElevationProfilePNG(opts = {}, {
  filename = 'perfil.png',
  scale    = 2,
  themeEl  = null,
} = {}) {
  const width  = opts.width  ?? 1200;
  const height = opts.height ?? 400;

  const { svg } = buildElevationProfileSVG({ ...opts, width, height, iconsOnly: true });
  // Hornear las variables CSS con los valores del tema vigente.
  const baked = _resolveCssVars(svg, themeEl);

  // Esperar a las fuentes para que el número/letra del badge no caiga al
  // fallback al rasterizar. Los iconos son paths inline (no dependen de fuente).
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* noop */ }
  }

  // Data-URL (UTF-8 percent-encoded) en vez de blob: URL: cargar un blob: como
  // src de <Image> para SVG es inconsistente entre navegadores (Safari/WebKit y
  // algunas versiones de Chrome fallan con onerror sin más detalle). El data-URL
  // codificado es robusto y soporta el unicode de los nombres (Côte, l'Arzelier…).
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(baked);

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload  = () => resolve(im);
    im.onerror = () => reject(new Error('No se pudo cargar el SVG para rasterizar'));
    im.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(width  * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  // Sin rect de fondo: el canvas arranca transparente → PNG con alfa.
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo generar el PNG')), 'image/png');
  });

  const pngUrl = URL.createObjectURL(pngBlob);
  const a = document.createElement('a');
  a.href = pngUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Liberar el object URL del PNG en el siguiente tick (tras disparar la descarga).
  setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
}
