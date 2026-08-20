// ─────────────────────────────────────────────────────────────────
//  GUÍA SIMPLIFICADA DE HORARIOS DE PASO
// ─────────────────────────────────────────────────────────────────
//
// Construye una lista ordenada por km de los puntos destacados de una
// jornada (salida, pie y cima de cada puerto, sprints/puntos intermedios,
// sectores de pavé/sterrato, llegada) con su horario medio de paso.
//
// Las horas manuales (del rutómetro) se guardan en `timeUtc` (cima) y
// `footTimeUtc` (pie del puerto) dentro de cada item de `profileSummits`, y en
// `timeUtc` de cada `profileWaypoints`. Salida y llegada usan los horarios de
// la jornada (`neutralStartTimeUtc`/`estimatedFinishTimeUtc`). Las horas que no
// vienen en el rutómetro se ESTIMAN por interpolación lineal por km entre las
// horas conocidas (anclas).
//
// Función PURA, sin dependencias. Mantener en PARIDAD con:
//   - ios-app/CalendarioCiclismo/Services/SimplifiedGuide.swift
//   - android-app/.../util/SimplifiedGuide.kt
// ─────────────────────────────────────────────────────────────────

function round1(x) { return Math.round(x * 10) / 10; }

function parseMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// Redondea al minuto y serializa a ISO UTC (las horas de rutómetro son HH:MM).
function msToIso(ms) {
  const rounded = Math.round(ms / 60000) * 60000;
  return new Date(rounded).toISOString();
}

// Decide qué waypoints son visibles según el tipo de prueba, en paridad con
// `js/perfil-pub.js`: en CRI/CRE (itt/ttt) se muestran los puntos intermedios
// (`intermediate_split`); en el resto, los sprints. Pavé/sterrato/localidad
// se muestran siempre.
function isWaypointVisible(type, isTimeTrial) {
  if (type === 'kom') return false;
  if (type === 'intermediate_sprint' || type === 'bonus_sprint') return !isTimeTrial;
  if (type === 'intermediate_split') return isTimeTrial;
  return true; // cobblestone, sterrato, town
}

/**
 * @typedef {Object} GuideRow
 * @property {number} km
 * @property {number|null} kmToGo
 * @property {string} type   start|climb_foot|summit|intermediate_sprint|
 *                           bonus_sprint|intermediate_split|cobblestone|
 *                           sterrato|town|finish
 * @property {string|null} label    nombre del punto (puerto/waypoint)
 * @property {string|null} category categoría del puerto (HC|1|2|3|4|M)
 * @property {string|null} timeUtc  ISO 8601 UTC (hora de paso) o null
 * @property {boolean} isEstimated  true si la hora se interpoló/estimó
 */

/**
 * @param {Object} opts
 * @param {number|null} [opts.distanceKm]
 * @param {string|null} [opts.neutralStartTimeUtc]
 * @param {string|null} [opts.estimatedFinishTimeUtc]
 * @param {Array} [opts.summits]    profileSummits
 * @param {Array} [opts.waypoints]  profileWaypoints
 * @param {string|null} [opts.primaryType]
 * @returns {GuideRow[]} ordenado por km ascendente
 */
export function buildSimplifiedGuide({
  distanceKm = null,
  neutralStartTimeUtc = null,
  estimatedFinishTimeUtc = null,
  summits = [],
  waypoints = [],
  primaryType = null,
} = {}) {
  const isTimeTrial = primaryType === 'itt' || primaryType === 'ttt';
  const rows = [];

  // — Salida (km 0) —
  if (neutralStartTimeUtc) {
    rows.push({ km: 0, type: 'start', label: null, category: null,
                timeUtc: neutralStartTimeUtc, isEstimated: false });
  }

  // — Puertos: pie (estimado) + cima (manual si la hubiera) —
  for (const s of summits) {
    if (s == null || s.km == null || !Number.isFinite(s.km)) continue;
    if (s.startKm != null && Number.isFinite(s.startKm) && s.startKm < s.km) {
      rows.push({ km: s.startKm, type: 'climb_foot', label: s.name ?? null,
                  category: s.category ?? null,
                  timeUtc: s.footTimeUtc ?? null, isEstimated: s.footTimeUtc == null });
    }
    rows.push({ km: s.km, type: 'summit', label: s.name ?? null,
                category: s.category ?? null,
                timeUtc: s.timeUtc ?? null, isEstimated: s.timeUtc == null });
  }

  // — Waypoints —
  for (const w of waypoints) {
    if (w == null || w.km == null || !Number.isFinite(w.km)) continue;
    if (!isWaypointVisible(w.type, isTimeTrial)) continue;
    rows.push({ km: w.km, type: w.type, label: w.name ?? null, category: null,
                timeUtc: w.timeUtc ?? null, isEstimated: w.timeUtc == null });
  }

  // — Llegada (km = distancia) —
  if (estimatedFinishTimeUtc && distanceKm != null && Number.isFinite(distanceKm)) {
    rows.push({ km: distanceKm, type: 'finish', label: null, category: null,
                timeUtc: estimatedFinishTimeUtc, isEstimated: false });
  }

  // — Orden por km (sort estable: pie < cima por construcción) —
  rows.sort((a, b) => a.km - b.km);

  // — Deduplicar puntos en el mismo km y mismo tipo (tol. 0.05 km) —
  const deduped = [];
  for (const r of rows) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.type === r.type && Math.abs(prev.km - r.km) < 0.05) {
      // Conservar el que tenga hora manual.
      if (prev.timeUtc == null && r.timeUtc != null) deduped[deduped.length - 1] = r;
      continue;
    }
    deduped.push(r);
  }

  // — kmToGo —
  for (const r of deduped) {
    r.kmToGo = (distanceKm != null && Number.isFinite(distanceKm))
      ? round1(distanceKm - r.km) : null;
  }

  // — Interpolación de horas faltantes entre anclas —
  // En CRI/CRE no se interpola: cada corredor/equipo pasa en un momento
  // distinto, así que solo se muestran las horas manuales (anclas).
  if (!isTimeTrial) {
    const anchors = deduped
      .map((r, i) => ({ i, km: r.km, ms: parseMs(r.timeUtc) }))
      .filter(a => a.ms != null);
    if (anchors.length >= 2) {
      for (const r of deduped) {
        if (r.timeUtc != null) continue;
        let prev = null, next = null;
        for (const a of anchors) {
          if (a.km <= r.km && (prev == null || a.km > prev.km)) prev = a;
          if (a.km >= r.km && (next == null || a.km < next.km)) next = a;
        }
        if (prev && next && next.km > prev.km) {
          const t = (r.km - prev.km) / (next.km - prev.km);
          r.timeUtc = msToIso(prev.ms + t * (next.ms - prev.ms));
          r.isEstimated = true;
        }
      }
    }
  }

  return deduped;
}

/** True si la jornada tiene una guía que merezca enseñarse. Es **opt-in**:
 *  solo se muestra si el editor ha introducido al menos UNA hora real del
 *  rutómetro en un punto intermedio (cima/waypoint). Las horas puramente
 *  interpoladas NO bastan — si no hay ninguna hora manual, no hay guía. */
export function hasSimplifiedGuide(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some(r => r.type !== 'start' && r.type !== 'finish'
    && r.timeUtc != null && !r.isEstimated);
}
