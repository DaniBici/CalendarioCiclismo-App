// ─────────────────────────────────────────────────────────────────
//  Orden de carreras por categoría — tabla única de la web.
//  La usan Hoy, calendario, temporada y resultados. Espejo de
//  RaceLogic.categoryRank en iOS y Android.
// ─────────────────────────────────────────────────────────────────

export const UCI_ORDER = {
  'WC': 1, 'CC': 2,
  '1.UWT': 3, '2.UWT': 4,
  'CN': 4.5,
  '1.WWT': 5, '2.WWT': 6,
  '1.Pro': 7, '2.Pro': 8,
  '1.1': 9,  '2.1': 10,
  '1.2': 11, '2.2': 12, '1.2U': 13, '2.2U': 14,
};

const ASIAN_CIRCUIT = /^(CN|TH|JP|TW|KR|HK|AZ)$/i;

/** Rango de categoría: menor va antes. Las grandes vueltas encabezan; el Tour
 *  del Porvenir sube al nivel de las .1; las Pro y .1 del circuito asiático
 *  (salvo la Japan Cup) bajan tras las .1 europeas; los continentales que no
 *  son el Europeo bajan tras las .2U. */
export function categoryRank(cat, name, country) {
  const n = name || '';
  if (/giro de italia/i.test(n)) return 0.1;
  if (/tour de francia/i.test(n)) return 0.2;
  if (/la vuelta/i.test(n)) return 0.3;
  if ((cat === '1.2U' || cat === '2.2U') && /tour del porvenir/i.test(n)) return 8.5;
  if (cat === 'CC' && !/europa|europe/i.test(n)) return 14.5;
  if (['1.Pro', '2.Pro', '1.1', '2.1'].includes(cat) && ASIAN_CIRCUIT.test(country || '') && !/japan cup/i.test(n)) return 10.5;
  return UCI_ORDER[cat] ?? 99;
}

export function raceCategoryRank(race) {
  return categoryRank(race?.uciCategory, race?.name, race?.countryCode);
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
