// Grupos del filtro de carreras de carretera (Hoy, Mes y Temporada). Espejo de
// RoadRaceFilter (iOS) y RoadRaceFilter.kt (Android).
//
// Nivel, por la categoría UCI de la carrera:
//   WorldTour   (wt)  1.UWT, 2.UWT, 1.WWT, 2.WWT y Campeonatos del Mundo (WC).
//   Profesional (pro) 1.Pro, 2.Pro, 1.1, 2.1, Campeonatos Continentales (CC) y
//                     Nacionales (CN).
//   .2          (dev) 1.2, 2.2, 1.2U, 2.2U y las clases sueltas de la lista
//                     cerrada DEV_EXTRA. Una categoría nueva no entra sola:
//                     sin nivel, solo se ve con el grupo entero marcado.
// Género: masculino o femenino por `races.gender`; una carrera sin género
// (mixta o con pruebas de ambos sexos) y los relevos mixtos cuentan en los dos.

export function isTourDelPorvenir(name) {
  return /tour del porvenir/i.test(name || '');
}

const WT = new Set(['1.UWT', '2.UWT', '1.WWT', '2.WWT', 'WC']);
const PRO = new Set(['1.Pro', '2.Pro', '1.1', '2.1', 'CC', 'CN']);
const DEV = new Set(['1.2', '2.2', '1.2U', '2.2U']);
const DEV_EXTRA = new Set(['1.Ncup', '2.Ncup', '1.NE', '2.NE']);

/** 'wt' | 'pro' | 'dev' | null */
export function roadRaceLevel(race) {
  const uci = race?.uciCategory || '';
  if (WT.has(uci)) return 'wt';
  if (PRO.has(uci)) return 'pro';
  if (DEV.has(uci) || DEV_EXTRA.has(uci)) return 'dev';
  return null;
}

const isMixedRelay = race => ['WC', 'CC'].includes(race?.uciCategory || '')
  && /relevo mixto|mixed relay/i.test(race?.name || '');

/** Géneros en los que cuenta la carrera: ['male'], ['female'] o ambos. */
export function roadRaceGenders(race) {
  if (isMixedRelay(race)) return ['male', 'female'];
  if (race?.gender === 'male') return ['male'];
  if (race?.gender === 'female') return ['female'];
  return ['male', 'female'];
}
