// ─────────────────────────────────────────────────────────────────
//  CINTILLO — entradas de Ciclocross (cxRace, cxTournament)
//  Se carga con `import()` desde cintillo.js solo cuando la sección `cx`
//  está activa o alguna entrada editorial apunta a una prueba o un torneo.
//  La home de carretera no descarga el código de Ciclocross sin ellas.
// ─────────────────────────────────────────────────────────────────

import {CX_AGENDA_SELECT,cxHiddenClasses,cxIsHidden} from './services/cx-data.js';
export {cxHighlightSlide,cxTournamentHighlightSlide} from './cx/highlight.js';

/**
 * Pruebas y torneos referenciados por el cintillo, indexados por id. En inglés
 * se descartan las carreras nacionales y los torneos solo nacionales.
 */
export async function loadCxHighlightData(supabase, cxIds, cxTournamentIds, lang) {
  const hiddenClasses = cxHiddenClasses(lang);
  let visibleQuery = null;
  if (hiddenClasses.length && cxTournamentIds.length) {
    visibleQuery = supabase.from('cx_races').select('tournamentId').eq('editorialStatus', 'published').in('tournamentId', cxTournamentIds);
    for (const raceClass of hiddenClasses) visibleQuery = visibleQuery.neq('class', raceClass);
  }
  const none = { data: [] };
  const [cxRes, cxTournamentsRes, visibleRes] = await Promise.all([
    cxIds.length ? Promise.resolve(supabase.from('cx_races').select(CX_AGENDA_SELECT).eq('editorialStatus', 'published').in('id', cxIds)).catch(() => none) : none,
    cxTournamentIds.length ? Promise.resolve(supabase.from('cx_tournaments').select('id,name,nameEn,slug,seasonKey,logoUrl').in('id', cxTournamentIds)).catch(() => none) : none,
    visibleQuery ? Promise.resolve(visibleQuery).catch(() => ({ data: null })) : { data: null },
  ]);
  const visibleTournamentIds = visibleRes.data ? new Set(visibleRes.data.map(row => row.tournamentId)) : null;
  return {
    cxById: Object.fromEntries((cxRes.data || []).filter(r => !cxIsHidden(r, lang)).map(r => [r.id, r])),
    cxTournamentsById: Object.fromEntries((cxTournamentsRes.data || []).filter(t => !visibleTournamentIds || visibleTournamentIds.has(t.id)).map(t => [t.id, t])),
  };
}
