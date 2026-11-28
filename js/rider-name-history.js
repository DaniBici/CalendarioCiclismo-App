// Historial de nombres de corredores (tabla `rider_name_history`).
//
// La ficha (riders_men, riders_women) guarda el nombre actual. Cada fila del
// historial es un nombre anterior y su último día vigente (`validTo`,
// 'YYYY-MM-DD'). El nombre de un corredor en una carrera es el de la fila con la
// menor `validTo` mayor o igual que la fecha de inicio de la carrera; sin fila,
// el de la ficha. La vista `startlist_riders_resolved` aplica la misma regla a las
// inscripciones: este módulo cubre las lecturas directas de fichas (resultados de
// carreras sin inscripción y ganadores del feed).

const cache = new WeakMap();

/**
 * Filas del historial agrupadas por `riderId`. La tabla es pequeña: se lee
 * entera, una vez por cliente. Sin tabla o con error, vacío (se usa el nombre
 * de la ficha) y sin recordar el fallo.
 */
export async function loadNameHistory(client) {
  if (cache.has(client)) return cache.get(client);
  try {
    const { data, error } = await client.from('rider_name_history').select('riderId, firstName, lastName, validTo');
    if (error) return new Map();
    const byRider = new Map();
    for (const row of data || []) {
      if (!byRider.has(row.riderId)) byRider.set(row.riderId, []);
      byRider.get(row.riderId).push(row);
    }
    cache.set(client, byRider);
    return byRider;
  } catch {
    return new Map();
  }
}

/**
 * Nombre de la ficha `rider` ({ id, firstName, lastName }) vigente en `date`
 * ('YYYY-MM-DD', inicio de la carrera). Devuelve { firstName, lastName }.
 */
export function riderNameAt(rider, history, date) {
  const rows = date ? history?.get(rider.id) : null;
  let best = null;
  for (const row of rows || []) {
    if (row.validTo >= date && (!best || row.validTo < best.validTo)) best = row;
  }
  return best
    ? { firstName: best.firstName, lastName: best.lastName }
    : { firstName: rider.firstName, lastName: rider.lastName };
}
