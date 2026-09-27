export const RESULTS_INITIAL_WINDOW_DAYS = 14;
export const RESULTS_LOAD_MORE_DAYS = 3;
export const RESULTS_SEASON_START = '2026-01-01';

export function shiftDateKey(dateKey, days) {
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
