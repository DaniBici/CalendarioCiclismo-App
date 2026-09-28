// ─────────────────────────────────────────────────────────────────
//  Orden de la agenda de Hoy. Un único criterio para web, iOS y
//  Android (RaceLogic.sortTodayAgenda):
//    1. Destacadas primero (solo en el orden por categoría).
//    2. Carreras sin jornada publicada y canceladas al final.
//    3. Modo: categoría, o primera hora de TV, o hora de meta.
//    4. Desempate: campeonatos nacionales, gran vuelta, categoría,
//       sexo, hora de salida, sector A/B y nombre.
//  El miniperfil no interviene en el orden.
// ─────────────────────────────────────────────────────────────────

import { compareChampionships } from '../campeonatos-config.js';
import { raceCategoryRank, genderRank, grandTourRank, tsSeconds } from './race-order.js';

const NO_TIME = 999999;

function isAgendaTail(item) {
  return !!(item?._placeholder || item?._race?.isCancelled);
}

function compareAgendaByCategory(a, b) {
  const tail = Number(isAgendaTail(a)) - Number(isAgendaTail(b));
  if (tail) return tail;
  const rA = a._race || {}, rB = b._race || {};
  const cn = compareChampionships(rA, a, rB, b);
  if (cn) return cn;
  const gt = grandTourRank(rA) - grandTourRank(rB);
  if (gt) return gt;
  const cat = raceCategoryRank(rA) - raceCategoryRank(rB);
  if (cat) return cat;
  const gen = genderRank(rA.gender) - genderRank(rB.gender);
  if (gen) return gen;
  const time = (tsSeconds(a.neutralStartTimeUtc) ?? NO_TIME) - (tsSeconds(b.neutralStartTimeUtc) ?? NO_TIME);
  if (time) return time;
  const sector = (a._stageSuffix || '').localeCompare(b._stageSuffix || '');
  if (sector) return sector;
  return (rA.name || '').localeCompare(rB.name || '');
}

function earliestTvSeconds(item) {
  const times = (item._broadcasts || []).map(b => tsSeconds(b.startTimeUtc)).filter(s => s != null);
  return times.length ? Math.min(...times) : null;
}

// 0 con hora de TV · 1 con TV sin hora · 2 TV pendiente · 3 sin TV.
function tvTier(item) {
  if (earliestTvSeconds(item) !== null) return 0;
  if (item.tvStatus === 'pending') return 2;
  if (item.tvStatus === 'confirmed' || (item._broadcasts || []).length) return 1;
  return 3;
}

function compareAgendaByTvTime(a, b) {
  const tail = Number(isAgendaTail(a)) - Number(isAgendaTail(b));
  if (tail) return tail;
  const tier = tvTier(a) - tvTier(b);
  if (tier) return tier;
  const time = (earliestTvSeconds(a) ?? NO_TIME) - (earliestTvSeconds(b) ?? NO_TIME);
  if (time) return time;
  return compareAgendaByCategory(a, b);
}

function compareAgendaByFinishTime(a, b) {
  const tail = Number(isAgendaTail(a)) - Number(isAgendaTail(b));
  if (tail) return tail;
  const fA = tsSeconds(a.estimatedFinishTimeUtc), fB = tsSeconds(b.estimatedFinishTimeUtc);
  if ((fA === null) !== (fB === null)) return fA === null ? 1 : -1;
  if (fA !== null && fA !== fB) return fA - fB;
  return compareAgendaByCategory(a, b);
}

const COMPARATORS = {
  category: compareAgendaByCategory,
  tvtime: compareAgendaByTvTime,
  finishtime: compareAgendaByFinishTime,
};

/** Devuelve una copia ordenada. Las destacadas encabezan solo en el orden
 *  por categoría y nunca adelantan a las carreras de la cola. */
export function sortAgenda(items, mode = 'category') {
  const compare = COMPARATORS[mode] || compareAgendaByCategory;
  const featured = item => mode === 'category' && item._featured === true && !isAgendaTail(item);
  return [...items].sort((a, b) => (Number(featured(b)) - Number(featured(a))) || compare(a, b));
}
