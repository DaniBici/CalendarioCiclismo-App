// ─────────────────────────────────────────────────────────────────
//  Orden de carreras por categoría — tabla única de la web.
//  La usan Hoy, calendario, temporada y resultados. Espejo de
//  RaceLogic.categoryRank en iOS y Android y del orden del widget
//  (`widget_day`).
// ─────────────────────────────────────────────────────────────────

// Grandes Vueltas, Mundiales, WorldTour, Continental europeo, ProSeries, .1,
// Continentales de otras áreas, Nacionales y .2. Sin excepciones por país.
export const UCI_ORDER = {
  'WC': 1,
  '1.UWT': 2, '2.UWT': 3, '1.WWT': 4, '2.WWT': 5,
  'CC': 6,
  '1.Pro': 7, '2.Pro': 8,
  '1.1': 9, '2.1': 10,
  'CN': 12,
  '1.2': 13, '2.2': 14, '1.2U': 15, '2.2U': 16,
  '1.Ncup': 17, '2.Ncup': 18, '1.NE': 19, '2.NE': 20,
};
// Continental que no es el Europeo: tras las .1 y antes de las Nacionales.
const CC_OTHER = 11;

/** Rango de categoría: menor va antes. Las Grandes Vueltas encabezan. */
export function categoryRank(cat, name) {
  const n = name || '';
  if (/giro de italia/i.test(n)) return 0.1;
  if (/tour de francia/i.test(n)) return 0.2;
  if (/la vuelta/i.test(n)) return 0.3;
  if (cat === 'CC' && !/europa|europe/i.test(n)) return CC_OTHER;
  return UCI_ORDER[cat] ?? 99;
}

export function raceCategoryRank(race) {
  return categoryRank(race?.uciCategory, race?.name);
}

export function genderRank(g) { return g === 'female' ? 2 : 1; }
export function grandTourRank(race) { return race?.isGrandTour ? 0 : 1; }

/** Segundos desde epoch de un timestamp ISO, numérico o {seconds}. */
export function tsSeconds(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') return new Date(ts).getTime() / 1000;
  if (typeof ts === 'number') return ts;
  if (ts.seconds !== undefined) return ts.seconds;
  if (ts.toDate) return ts.toDate().getTime() / 1000;
  return null;
}
