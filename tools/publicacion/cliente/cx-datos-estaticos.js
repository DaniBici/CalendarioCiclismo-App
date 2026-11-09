// Lecturas de la agenda desde el archivo publicado de la temporada, en lugar de
// Supabase. El resto de js/services/cx-data.js no cambia.
import { cxTournamentRounds } from '../../../js/services/cx-data.js';

export * from '../../../js/services/cx-data.js';

const leer = seasonKey => fetch(`/d/cx/${seasonKey}.json`, { cache: 'no-cache' }).then(respuesta => {
  if (!respuesta.ok) throw new Error(`Temporada ${seasonKey}: ${respuesta.status}`);
  return respuesta.json();
});

export async function cxSeasonRows(_cliente, seasonKey) {
  return (await leer(seasonKey)).rows;
}

export async function cxMonth(_cliente, seasonKey, year, month) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return (await leer(seasonKey)).rows.filter(race => race.dateKey <= last && (race.dateKey >= first || race.endDateKey >= first));
}

const rondas = new Map();
export function cxSeasonRounds(_cliente, seasonKey) {
  if (!rondas.has(seasonKey)) {
    rondas.set(seasonKey, leer(seasonKey).then(({ rondas: filas }) => cxTournamentRounds(filas, seasonKey)).catch(error => { rondas.delete(seasonKey); throw error; }));
  }
  return rondas.get(seasonKey);
}
