// Último día de la temporada de carretera en Hoy, por año natural. Desde el
// día siguiente y hasta el 31 de diciembre de ese año, Hoy no muestra ni
// permite alcanzar fechas posteriores: el selector termina en este día y
// la vista se queda en él. Un año sin entrada no tiene límite.
// Espejo de TodaySeason en iOS (TodayViewModel.swift) y Android (util/TodaySeason.kt).
export const TODAY_SEASON_LAST_DAY = Object.freeze({
  2026: '2026-10-18',
});

/** Último día navegable en Hoy según la fecha local actual, o null. */
export function todaySeasonLastDay(todayKey) {
  return TODAY_SEASON_LAST_DAY[Number(String(todayKey).slice(0, 4))] || null;
}

/** Fecha navegable más cercana: la propia fecha o el último día de temporada. */
export function clampToTodaySeason(dateKey, todayKey) {
  const lastDay = todaySeasonLastDay(todayKey);
  return lastDay && dateKey > lastDay ? lastDay : dateKey;
}

/** True si la fecha no supera el último día de temporada. */
export function isWithinTodaySeason(dateKey, todayKey) {
  const lastDay = todaySeasonLastDay(todayKey);
  return !lastDay || dateKey <= lastDay;
}
