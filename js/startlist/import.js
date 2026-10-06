import { normalizeStartlistSource } from './source.mjs';
export { normalizeStartlistSource, normalizePersonName } from './source.mjs';
const clean = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();

// PostgREST limita cada respuesta a 1.000 filas. La primera página obtiene el
// total; las restantes se solicitan en paralelo y se exige cobertura completa.
export async function loadCompleteStartlistCatalog(page) {
  const size = 1000;
  const first = await page(0, size - 1, true);
  if (first.error) throw first.error;
  if (!Number.isInteger(first.count) || first.count < 0) throw new Error('No se recibió el total del catálogo.');
  const pending = [];
  for (let from = size; from < first.count; from += size) pending.push(page(from, from + size - 1, false));
  const remaining = await Promise.all(pending);
  const failed = remaining.find(result => result.error);
  if (failed) throw failed.error;
  const rows = [...(first.data || []), ...remaining.flatMap(result => result.data || [])];
  if (rows.length !== first.count || new Set(rows.map(row => row.id)).size !== first.count) {
    throw new Error('El catálogo cambió durante la carga. Vuelve a abrir la lista.');
  }
  return rows;
}

// El estado de una preparación permite reintentar una respuesta perdida sin
// reconstruir la lista ni repetir las altas. Vive fuera del DOM del editor.
export async function saveEnrichedStartlist(rpc, source, provisional, previous = null, onPrepared = () => {}) {
  const document = normalizeStartlistSource(source);
  const key = JSON.stringify({ document, provisional });
  let prepared = previous?.key === key ? previous : null;
  if (!prepared) {
    const { data, error } = await rpc('prepare_startlist_import', {
      p_race_id: document.raceId, p_document: document, p_provisional: provisional,
    });
    if (error) throw error;
    if (!data?.importId) throw new Error('La preparación no devolvió identificador.');
    prepared = { key, importId: data.importId, report: data };
    onPrepared(prepared);
    if (!data.ready) return { prepared, report: data };
  }
  const { data, error } = await rpc('apply_startlist_import', { p_import_id: prepared.importId });
  if (error) throw error;
  if (!data?.status) throw new Error('No se recibió el estado de la importación.');
  return { prepared, report: data };
}

export function hasAssignedStartlistDorsals(teams) {
  return (Array.isArray(teams) ? teams : []).some(team =>
    (Array.isArray(team?.riders) ? team.riders : []).some(rider => Number(rider?.dorsal) > 0));
}

export function orderStartlistTeamsForSave(teams) {
  const rows = Array.isArray(teams) ? teams : [];
  if (!hasAssignedStartlistDorsals(rows)) return [...rows];
  const firstDorsal = team => {
    const dorsals = (Array.isArray(team?.riders) ? team.riders : [])
      .map(rider => Number(rider?.dorsal))
      .filter(dorsal => dorsal > 0);
    return dorsals.length ? Math.min(...dorsals) : Infinity;
  };
  return rows.map((team, index) => ({ team, index }))
    .sort((a, b) => firstDorsal(a.team) - firstDorsal(b.team) || a.index - b.index)
    .map(({ team }) => team);
}

/**
 * Carreras disponibles para crear una lista desde el panel. El día se recibe
 * ya resuelto en la zona horaria de producto para que el filtro sea estable.
 */
export function selectUpcomingStartlistRaces(races, today, query = '', limit = 250) {
  const dateKey = clean(today);
  const normalizedQuery = clean(query).toLocaleLowerCase('es');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];

  return [...(Array.isArray(races) ? races : [])]
    .filter(race => {
      const startDate = clean(race?.startDate);
      if (!startDate || startDate < dateKey) return false;
      if (!normalizedQuery) return true;
      return `${race?.name || ''} ${race?.id || ''} ${startDate}`
        .toLocaleLowerCase('es')
        .includes(normalizedQuery);
    })
    .sort((a, b) => clean(a.startDate).localeCompare(clean(b.startDate))
      || clean(a.name).localeCompare(clean(b.name), 'es'))
    .slice(0, limit);
}
