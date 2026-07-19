// ─────────────────────────────────────────────────────────────────
//  MODO CAMPEONATOS — configuración (Campeonatos Nacionales 2026)
//  Único punto con los literales anuales: fechas, slugs, orden de
//  países, slots y etiquetas. El año siguiente = editar este archivo
//  + crear las dos páginas nuevas + sembrar las carreras en el panel.
// ─────────────────────────────────────────────────────────────────

export const CAMP = {
  YEAR: 2026,

  // Semana grande de Campeonatos (22-28 jun). Gobierna TODO lo que rodea la
  // experiencia central de esa semana: el cintillo, la fila sintética de
  // Temporada, el selector de días, el filtro "Hoy" forzado y el takeover de
  // la vista Hoy. NO ampliar: define la "semana de campeonatos" visible.
  RANGE_START: '2026-06-22',
  RANGE_END:   '2026-06-28',
  DATES: ['2026-06-22','2026-06-23','2026-06-24','2026-06-25','2026-06-26','2026-06-27','2026-06-28'],

  // Ventana de CARGA de la página de Campeonatos: qué carreras CN entran en la
  // rejilla. Más ancha que la semana grande para recoger campeonatos fuera de
  // ella (Ecuador, EEUU, los sub23 de los cuatro países reunidos en Luxemburgo).
  // Solo la usan las queries de datos (web/iOS/Android); todo lo demás usa el
  // par RANGE_START/RANGE_END de la semana grande.
  QUERY_START: '2026-06-01',
  QUERY_END:   '2026-07-15',

  // Filtro "Hoy" de la rejilla: solo aparece del 24 al 28 de junio (ambos
  // inclusive). Los dos primeros días apenas hay pruebas → es superfluo; a
  // mitad de semana se solapan y filtrar por la jornada del día facilita la
  // tarea del usuario. El fin del rango coincide con RANGE_END.
  TODAY_FILTER_START: '2026-06-24',

  // Slugs de la página (con año, future-proof). ES servida en raíz, EN bajo /en/.
  SLUG_ES: 'campeonatos-nacionales-2026',
  SLUG_EN: '2026-national-championships',

  // Orden de filas (ISO-3166-1 alpha-2, mayúscula). Es el UCI Nation Ranking,
  // pero con los seis primeros forzados: ES, FR, IT, BE, NL, PT. El resto sigue
  // el ranking UCI (saltando los ya colocados arriba). Países presentes en datos
  // pero ausentes de esta lista se añaden al final, ordenados por código.
  COUNTRY_ORDER: [
    // Top 6 forzado
    'ES', 'FR', 'IT', 'BE', 'NL', 'PT',
    // Resto en orden UCI Nation Ranking (sin los 6 anteriores)
    'DK', 'SI', 'GB', 'AU', 'US', 'NO', 'CH', 'DE', 'CO', 'MX',
    'AT', 'NZ', 'ER', 'IE', 'CZ', 'EC', 'PL', 'KZ', 'UY', 'CA',
    'LV', 'SK', 'EE', 'VE', 'ZA', 'SE', 'CR', 'LU', 'GR', 'IL',
    'DZ', 'PA', 'MN', 'RS', 'CN', 'MU', 'UZ', 'JP', 'UA', 'GT',
    'BR', 'AE', 'AR', 'BZ', 'TH', 'RO', 'RW', 'HU', 'BM', 'ID',
    'MT', 'HN', 'JM', 'ET', 'TR', 'CL', 'DO', 'HK', 'LT', 'BY', 'CY',
    'KR', 'BO', 'BG', 'MA', 'FI', 'VN', 'MC', 'XK', 'TT', 'PR',
    'PE', 'PH', 'TW', 'BJ', 'SV', 'MY', 'ZW', 'JO', 'IR', 'NA',
    'EG', 'BA', 'SG', 'CM', 'MK', 'UG', 'CU', 'ME', 'HR', 'IN',
    'MD', 'AG', 'AL', 'CV', 'IS', 'TN', 'LA', 'AO', 'VG', 'MO',
    'GD', 'KY', 'GU', 'SZ', 'VC', 'DM', 'BF', 'KG', 'AZ', 'PY',
    'KE', 'CI', 'SX', 'CW', 'GY', 'TZ', 'BH', 'SY', 'CD', 'IQ', 'SA',
  ],

  // Orden fijo de columnas (slots). 8 eventos.
  // Por pares (línea, CRI) de cada categoría: masc, fem, sub23 masc, sub23 fem.
  SLOT_ORDER: ['linea_masc','cri_masc','linea_fem','cri_fem','linea_sub23_m','cri_sub23_m','linea_sub23_f','cri_sub23_f'],

  SLOT_LABELS_ES: {
    linea_masc:    'Línea masc',
    linea_fem:     'Línea fem',
    cri_masc:      'CRI masc',
    cri_fem:       'CRI fem',
    linea_sub23_m: 'Línea sub23 masc',
    cri_sub23_m:   'CRI sub23 masc',
    linea_sub23_f: 'Línea sub23 fem',
    cri_sub23_f:   'CRI sub23 fem',
  },
  SLOT_LABELS_EN: {
    linea_masc:    "Men's RR",
    linea_fem:     "Women's RR",
    cri_masc:      "Men's ITT",
    cri_fem:       "Women's ITT",
    linea_sub23_m: "Men's U23 RR",
    cri_sub23_m:   "Men's U23 ITT",
    linea_sub23_f: "Women's U23 RR",
    cri_sub23_f:   "Women's U23 ITT",
  },

  // Filtros de la página (Todas/Pro/Masc/Fem) → qué slots se muestran.
  // 'pro' = solo elite (sin sub23); 'male'/'female' = solo elite de ese género.
  SLOT_FILTERS: {
    all:    ['linea_masc','cri_masc','linea_fem','cri_fem','linea_sub23_m','cri_sub23_m','linea_sub23_f','cri_sub23_f'],
    pro:    ['linea_masc','cri_masc','linea_fem','cri_fem'],
    male:   ['linea_masc','cri_masc'],
    female: ['linea_fem','cri_fem'],
  },

  // Nombre mostrado en las entradas (Mes/Temporada/Hoy) y título de la página.
  TITLE_ES: 'Campeonatos Nacionales',
  TITLE_EN: 'National Championships',

  // Descripción SEO (meta description / og:description). Una sola fuente para el
  // HTML estático y el updateSeo() en runtime.
  DESC_ES: 'Consulta toda la información sobre los Campeonatos Nacionales de ciclismo en carretera 2026, en la semana del 22 al 28 de junio, incluidos los de España, Francia e Italia',
  DESC_EN: 'Find all the information about the 2026 national road cycling championships, in the week of June 22–28, including those of Spain, France and Italy',

  ACCENT: '#1a73e8', // azul suave del rediseño
};

export const CAMP_DATES = new Set(CAMP.DATES);

// Clave de fecha de hoy en la zona del usuario (idéntica a toDateKey de shared.js).
export const campTodayKey = () => new Date().toLocaleDateString('sv-SE');

// ¿Debe ofrecerse el filtro "Hoy" en la rejilla? Solo del 24 al 28 de junio
// (ambos inclusive). Se evalúa contra la fecha real, no la jornada navegada.
export function isChampTodayFilterActive(todayKey = campTodayKey()) {
  return todayKey >= CAMP.TODAY_FILTER_START && todayKey <= CAMP.RANGE_END;
}

// ¿Estamos en la semana de Campeonatos (22-28 jun, ventana completa)? Durante
// esta ventana la vista "Hoy" impone el filtro Masculino por defecto y solo
// ofrece cuatro filtros (Todas/Pro/Masc/Fem), sin posibilidad de fijar otro
// predeterminado. Se evalúa contra la fecha real, no la jornada navegada.
export function isChampWeekFilterLock(todayKey = campTodayKey()) {
  return todayKey >= CAMP.RANGE_START && todayKey <= CAMP.RANGE_END;
}

// Filtros visibles en la vista "Hoy" durante la semana de Campeonatos
// (se ocultan WT/WWT) y filtro forzado por defecto en esa ventana.
export const CHAMP_WEEK_HOY_FILTERS = ['all', 'pro', 'male', 'female'];

// Filtro forzado por defecto en la vista "Hoy" durante la semana de
// Campeonatos. Es Masculino salvo el 27 y 28 de junio, en los que arranca en
// "Todas". Se evalúa contra la jornada mostrada (mismo dateKey que el lock).
export function champWeekHoyDefault(dateKey = campTodayKey()) {
  return (dateKey >= '2026-06-27' && dateKey <= '2026-06-28') ? 'all' : 'male';
}

// URL de la página según idioma de la vista que enlaza.
export const campUrl = (lang) => lang === 'en' ? `/en/${CAMP.SLUG_EN}/` : `/${CAMP.SLUG_ES}/`;

// Etiquetas de slot según idioma.
export const slotLabels = (lang) => lang === 'en' ? CAMP.SLOT_LABELS_EN : CAMP.SLOT_LABELS_ES;

// Título según idioma.
export const campTitle = (lang) => lang === 'en' ? CAMP.TITLE_EN : CAMP.TITLE_ES;

// Deduce el slot de una carrera país-evento a partir de su nombre (señal
// primaria) con respaldo en primaryType/gender. Total: siempre devuelve un slot.
export function championshipSlot(race, rd) {
  const n   = (race?.name || '');
  const u23 = /\bsub-?23\b|\bu-?23\b/i.test(n);
  // Tipo: CRI por nombre; respaldo en primaryType (itt/ttt). Si el nombre dice 'línea', es ruta.
  const itt = /\bcri\b|contrarreloj/i.test(n)
              || ((rd?.primaryType === 'itt' || rd?.primaryType === 'ttt') && !/\bl[ií]nea\b/i.test(n));
  // Género: por nombre; respaldo en race.gender.
  const fem = /\bfemenin/i.test(n) || (race?.gender === 'female' && !/\bmasculin/i.test(n));
  if (u23) return fem ? (itt ? 'cri_sub23_f' : 'linea_sub23_f')
                      : (itt ? 'cri_sub23_m' : 'linea_sub23_m');
  return fem ? (itt ? 'cri_fem' : 'linea_fem')
             : (itt ? 'cri_masc' : 'linea_masc');
}

// ── Clasificación de una CN para los filtros de categoría (Pro/Masc/Fem) ──
// Misma señal que championshipSlot (nombre con respaldo en gender), pero sin
// depender del rd. Una CN elite cuenta como "pro"; las sub23 quedan fuera de
// Pro/Masc/Fem (igual que las 1.2U/2.2U). Masc/Fem además respetan el género.

// ¿Es una CN de categoría sub23? (línea o CRI; masc o fem)
export const isU23Championship = (race) =>
  isChampionshipRace(race) && /\bsub-?23\b|\bu-?23\b/i.test(race?.name || '');

// Género de una CN: 'female' si el nombre dice femenino o gender==='female'
// (sin que el nombre diga masculino); 'male' en otro caso.
export const isFemaleChampionship = (race) =>
  /\bfemenin/i.test(race?.name || '') ||
  (race?.gender === 'female' && !/\bmasculin/i.test(race?.name || ''));

// ── Orden interno de la categoría CN en Hoy/Mes ───────────────────
// Cuando dos jornadas son Campeonatos Nacionales (uciCategory === 'CN')
// se ordenan entre sí por: (1) país según COUNTRY_ORDER, (2) LÍNEA antes
// que CRI (toda la línea por delante de toda la CRI), (3) elite masc,
// elite fem, sub23 masc, sub23 fem. Distinto del SLOT_ORDER de columnas
// de la página (que intercala línea/CRI por categoría).

// Índice de país: posición en COUNTRY_ORDER; los ausentes van al final
// ordenados por código (mismo criterio que la rejilla de la página).
const _COUNTRY_INDEX = new Map(CAMP.COUNTRY_ORDER.map((cc, i) => [cc, i]));
export function championshipCountryIndex(countryCode) {
  const cc = (countryCode || '').toUpperCase();
  const i = _COUNTRY_INDEX.get(cc);
  return i != null ? i : CAMP.COUNTRY_ORDER.length;
}

// Prioridad de slot dentro de un país: línea primero (todas), luego CRI;
// dentro de cada bloque elite masc → elite fem → sub23 masc → sub23 fem.
const _CN_SLOT_ORDER = [
  'linea_masc', 'linea_fem', 'linea_sub23_m', 'linea_sub23_f',
  'cri_masc',   'cri_fem',   'cri_sub23_m',   'cri_sub23_f',
];
const _CN_SLOT_INDEX = new Map(_CN_SLOT_ORDER.map((s, i) => [s, i]));
export function championshipSlotRank(race, rd) {
  return _CN_SLOT_INDEX.get(championshipSlot(race, rd)) ?? _CN_SLOT_ORDER.length;
}

// ¿Es una jornada de Campeonato Nacional?
export const isChampionshipRace = (race) => (race?.uciCategory || '') === 'CN';

// Comparador parcial para dos CN: país → slot. Devuelve un número (≠0 ⇒
// orden decidido; 0 ⇒ desempate al comparador genérico) o null si alguna
// no es CN (no aplica este orden).
export function compareChampionships(rA, rdA, rB, rdB) {
  if (!isChampionshipRace(rA) || !isChampionshipRace(rB)) return null;
  const ci = championshipCountryIndex(rA?.countryCode) - championshipCountryIndex(rB?.countryCode);
  if (ci !== 0) return ci;
  return championshipSlotRank(rA, rdA) - championshipSlotRank(rB, rdB);
}
