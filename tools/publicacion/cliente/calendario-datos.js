// Lecturas del calendario desde los archivos publicados por temporada, en lugar de
// Supabase. Solo se piden al primer uso de un filtro, otro año o la vista Mes.
const anios = new Map();

function leer(anio) {
  if (!anios.has(anio)) {
    anios.set(anio, fetch(`/d/temporada/${anio}.json`, { cache: 'no-cache' }).then(respuesta => {
      if (respuesta.status === 404) return { races: [], days: [], groups: [] };
      if (!respuesta.ok) throw new Error(`Temporada ${anio}: ${respuesta.status}`);
      return respuesta.json();
    }).catch(error => { anios.delete(anio); throw error; }));
  }
  return anios.get(anio);
}

export const leerTemporada = anio => leer(anio);

export async function leerMes(anio, { startKey, endKey }) {
  const { races, days } = await leer(anio);
  const delMes = days.filter(dia => dia.dateKey >= startKey && dia.dateKey <= endKey);
  const conJornada = new Set(delMes.map(dia => dia.raceId));
  return { days: delMes, races: races.filter(race => conJornada.has(race.id) || (race.startDate && race.endDate && race.startDate <= endKey && race.endDate >= startKey)) };
}
