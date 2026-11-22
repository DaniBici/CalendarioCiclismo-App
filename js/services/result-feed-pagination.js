const RESULTS_INITIAL_WINDOW_DAYS = 14;
const RESULTS_LOAD_MORE_DAYS = 3;
export const RESULTS_SEASON_START = '2026-01-01';

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function initialResultsFromKey(todayKey) {
  return shiftDateKey(todayKey, -(RESULTS_INITIAL_WINDOW_DAYS - 1));
}

export function previousResultsWindow(currentFromKey, seasonStart = RESULTS_SEASON_START) {
  if (currentFromKey <= seasonStart) return null;
  const candidateFromKey = shiftDateKey(currentFromKey, -RESULTS_LOAD_MORE_DAYS);
  return {
    fromKey: candidateFromKey < seasonStart ? seasonStart : candidateFromKey,
    toKey: shiftDateKey(currentFromKey, -1),
  };
}

// Últimos resultados nunca se queda corto: con o sin filtros se ven al menos
// RESULTS_MIN_DAYS días con resultados, aunque la ventana sea más corta (un
// parón del calendario o un filtro estrecho). Espejo de ResultsFeedLogic en
// iOS y Android.
export const RESULTS_MIN_DAYS = 15;
// Tramo con el que se amplía lo cargado hasta reunir esos días.
const RESULTS_FILL_DAYS = 14;

/**
 * Inicio de lo que se muestra: `fromKey` o, si hasta él hay menos de
 * RESULTS_MIN_DAYS días con resultados, el día número RESULTS_MIN_DAYS más
 * reciente de `dates` (fechas de las entradas que pasan los filtros).
 */
export function resultsStartKey(dates, fromKey, minDays = RESULTS_MIN_DAYS) {
  const days = [...new Set(dates)].sort().reverse();
  const nth = days[Math.min(minDays, days.length) - 1];
  return nth && nth < fromKey ? nth : fromKey;
}

/** Días distintos de `dates`. */
export const resultDayCount = dates => new Set(dates).size;

/** Tramo anterior a `fromKey` para completar los días mínimos; null en el arranque de temporada. */
export function fillResultsWindow(fromKey, seasonStart = RESULTS_SEASON_START) {
  if (fromKey <= seasonStart) return null;
  const candidate = shiftDateKey(fromKey, -RESULTS_FILL_DAYS);
  return { fromKey: candidate < seasonStart ? seasonStart : candidate, toKey: shiftDateKey(fromKey, -1) };
}
