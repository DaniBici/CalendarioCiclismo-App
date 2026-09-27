/**
 * Rango inclusivo de un mes en claves ISO locales (YYYY-MM-DD).
 */
export function monthDateRange(year, month0) {
  const month = String(month0 + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return {
    monthKey,
    startKey: `${monthKey}-01`,
    endKey: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    lastDay,
  };
}

/**
 * IDs de carreras que aparecen en las jornadas pero no en la consulta por
 * solapamiento de fechas. Cubre datos históricos con fechas de carrera
 * incompletas o desalineadas sin volver a descargar el año completo.
 */
export function missingRaceIds(raceDays, races) {
  const loadedIds = new Set(races.map(race => race.id));
  return [...new Set(raceDays.map(day => day.raceId).filter(Boolean))]
    .filter(id => !loadedIds.has(id));
}

/** Une resultados de carreras por ID conservando la fila más reciente. */
export function mergeRaces(...groups) {
  const byId = new Map();
  groups.flat().forEach(race => {
    if (race?.id) byId.set(race.id, race);
  });
  return [...byId.values()];
}
