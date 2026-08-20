// Heurística para detectar el inicio de un puerto a partir de la cima.
//
// Doble pase:
//   1. Pase "estricto": iteramos hacia atrás desde la cima exigiendo que el
//      primer LOCAL_WINDOW_KM del puerto desde el candidato tenga al menos
//      MIN_LOCAL_GRADIENT_PCT de pendiente. Detecta bien los puertos
//      "serios" sin absorber valles suaves previos.
//   2. Pase "permisivo" (solo si el estricto devuelve null): sin criterio
//      local, exige que la pendiente acumulada cima→candidato no caiga por
//      debajo de MIN_GRADIENT_PCT. Captura puertos largos suaves
//      sostenidos (cat-3/4 al 2-3 %) que no pasan el filtro estricto.
//
// En ambos pases se tolera repuntes de hasta DESCENT_TOLERANCE_M sobre el
// mínimo provisional, y se aplican los mismos límites de longitud y de
// pendiente media final.
// Mantener en paridad con la función PL/pgSQL del backfill.

const DESCENT_TOLERANCE_M       = 30;
const MAX_LENGTH_KM             = 50;
const MIN_LENGTH_KM             = 0.5;
const MIN_GRADIENT_PCT          = 2.0;
const MIN_LOCAL_GRADIENT_PCT    = 3.0;
const MIN_LOOSE_GRADIENT_PCT    = 1.0;
const LOCAL_WINDOW_KM           = 2.0;

export function interpolateAlt(points, km) {
  if (km <= points[0].km) return points[0].alt;
  const last = points[points.length - 1];
  if (km >= last.km) return last.alt;
  for (let i = 0; i < points.length - 1; i++) {
    if (km >= points[i].km && km <= points[i + 1].km) {
      const span = points[i + 1].km - points[i].km;
      if (span <= 0) return points[i].alt;
      const t = (km - points[i].km) / span;
      return points[i].alt + t * (points[i + 1].alt - points[i].alt);
    }
  }
  return last.alt;
}

function indexJustBefore(points, km) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].km < km) return i;
  }
  return 0;
}

function round1(x) { return Math.round(x * 10) / 10; }

/**
 * Detecta el inicio del puerto cuya cima cae en `summitKm`.
 * @param {Array<{km:number,alt:number}>} points - perfil simplificado de la jornada
 * @param {number} summitKm - km de la cima
 * @returns {{startKm:number, lengthKm:number, avgGradient:number}|null}
 */
function _finalize(summitKm, summitAlt, lowestKm, lowestAlt) {
  const lengthKm = summitKm - lowestKm;
  if (lengthKm < MIN_LENGTH_KM) return null;
  const avgGradient = ((summitAlt - lowestAlt) / (lengthKm * 1000)) * 100;
  if (avgGradient < MIN_GRADIENT_PCT) return null;
  return {
    startKm:     round1(lowestKm),
    lengthKm:    round1(lengthKm),
    avgGradient: round1(avgGradient),
  };
}

function _detectStrict(points, summitKm, summitAlt, startIdx) {
  let lowestAlt = summitAlt;
  let lowestKm  = summitKm;
  for (let i = startIdx; i >= 0; i--) {
    const p = points[i];
    if (summitKm - p.km > MAX_LENGTH_KM) break;

    if (p.alt < lowestAlt) {
      const kFwd = Math.min(p.km + LOCAL_WINDOW_KM, summitKm);
      const aFwd = kFwd >= summitKm ? summitAlt : interpolateAlt(points, kFwd);
      const span = kFwd - p.km;
      const localGrad = span > 0 ? ((aFwd - p.alt) / (span * 1000)) * 100 : 0;
      if (localGrad < MIN_LOCAL_GRADIENT_PCT) break;

      lowestAlt = p.alt;
      lowestKm  = p.km;
      continue;
    }
    if (p.alt - lowestAlt > DESCENT_TOLERANCE_M) break;
  }
  return _finalize(summitKm, summitAlt, lowestKm, lowestAlt);
}

function _detectLoose(points, summitKm, summitAlt, startIdx) {
  // Pase permisivo con el mismo criterio local del estricto pero un umbral
  // mucho más bajo (MIN_LOOSE_GRADIENT_PCT = 1 %). Distingue puerto suave
  // continuo (Göygöl ~2 % local) de valle llano (~0 % local), evitando que
  // la simple tolerancia de descenso absorba 50 km de meseta antes del
  // puerto (caso Passo Duran).
  let lowestAlt = summitAlt;
  let lowestKm  = summitKm;
  for (let i = startIdx; i >= 0; i--) {
    const p = points[i];
    if (summitKm - p.km > MAX_LENGTH_KM) break;

    if (p.alt < lowestAlt) {
      const kFwd = Math.min(p.km + LOCAL_WINDOW_KM, summitKm);
      const aFwd = kFwd >= summitKm ? summitAlt : interpolateAlt(points, kFwd);
      const span = kFwd - p.km;
      const localGrad = span > 0 ? ((aFwd - p.alt) / (span * 1000)) * 100 : 0;
      if (localGrad < MIN_LOOSE_GRADIENT_PCT) break;

      lowestAlt = p.alt;
      lowestKm  = p.km;
      continue;
    }
    if (p.alt - lowestAlt > DESCENT_TOLERANCE_M) break;
  }
  return _finalize(summitKm, summitAlt, lowestKm, lowestAlt);
}

export function detectClimb(points, summitKm) {
  if (!Array.isArray(points) || points.length < 2 || summitKm == null) return null;
  if (summitKm < points[0].km) return null;
  // Tolerar pequeños desbordes (≤ 2 km) sobre el final del GPX simplificado:
  // suelen ser discrepancias entre el km nominal del summit y la longitud
  // del GPX real. Sin esta tolerancia, perfiles donde la cima coincide con
  // la meta (Angliru, Praeres…) se descartan por floating-point.
  const lastKm = points[points.length - 1].km;
  if (summitKm - lastKm > 2) return null;
  const effectiveSummitKm = Math.min(summitKm, lastKm);

  const summitAlt = interpolateAlt(points, effectiveSummitKm);
  const startIdx  = indexJustBefore(points, effectiveSummitKm);

  return _detectStrict(points, effectiveSummitKm, summitAlt, startIdx)
      ?? _detectLoose(points, effectiveSummitKm, summitAlt, startIdx);
}

/**
 * Calcula longitud y pendiente media para un puerto con startKm ya conocido.
 * Útil para render público sin volver a ejecutar la detección.
 * @returns {{lengthKm:number, avgGradient:number}|null}
 */
/**
 * Devuelve la altitud "efectiva" del summit. Cuando hay perfil GPX, la
 * altitud se deriva de la curva (única fuente de verdad para el render);
 * si no, se respeta la altitud manual. Evita incoherencias visuales como
 * el caso Capodarco (225 m manual vs 310 m GPX).
 */
export function effectiveSummitAlt(summit, points) {
  if (Array.isArray(points) && points.length >= 2 && summit?.km != null) {
    const lastKm = points[points.length - 1].km;
    const km = Math.min(summit.km, lastKm);
    return Math.round(interpolateAlt(points, km));
  }
  return summit?.altitude ?? null;
}

export function computeClimbStats(points, startKm, summitKm, summitAltOverride = null) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (startKm == null || summitKm == null || startKm >= summitKm) return null;

  const startAlt  = interpolateAlt(points, startKm);
  const summitAlt = summitAltOverride != null ? summitAltOverride : interpolateAlt(points, summitKm);
  const lengthKm  = summitKm - startKm;
  if (lengthKm <= 0) return null;
  const avgGradient = ((summitAlt - startAlt) / (lengthKm * 1000)) * 100;
  return { lengthKm: round1(lengthKm), avgGradient: round1(avgGradient) };
}
