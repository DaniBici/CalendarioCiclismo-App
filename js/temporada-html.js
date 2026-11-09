// HTML y filtros de Temporada, sin DOM: lo usan el navegador y el servidor que publica
// la página. El estado vive en `S`, compartido con js/temporada.js.
import { categoryRank, countryFlag, jornadaUrl, raceUrl, raceName, categoryBadge, femaleMark, needsFemaleMark, cleanFeminineName } from './shared.js';
import { isTourDelPorvenir } from './category-filter.js';
import { t, getLang } from './i18n.js';
import { hasRenderableElevationProfile } from './stage/profile-availability.js';
import { hasModalData } from './race-data-modal.js';
import { CAMP, campUrl, campTitle, championshipMatchesCategoryFilter, isOnChampionshipsPage } from './campeonatos-config.js';
import { LOGO_ONERROR, logoPlaceholderHtml } from './components/logo-placeholder.js';

export const S = {
  allRaces: [],            // [{...raceData, id, _days:[{dateKey}]}]
  allChallengeGroups: [],  // [{...groupData, id, _races:[raceObj]}]
  // Ids de los grupos desplegados: sobreviven a los repintados y a la vuelta desde una carrera.
  expandedChallenges: new Set(),
  activeYear: null,
  activeCat: 'all',
  activeCountry: '',
};

// Fila sintética "Campeonatos Nacionales" (CN) — aparece en TODAS las categorías
// porque se inyecta tras el filtro. Enlaza a la página de Modo Campeonatos, que
// recoge las CN de su ventana; las de fuera se listan agrupadas por país.
const CHAMPIONSHIPS_ITEM = {
  id: '__championships__', _isChampionshipsLink: true,
  name: CAMP.TITLE_ES, nameEn: CAMP.TITLE_EN, uciCategory: 'CN',
  startDate: CAMP.RANGE_START, endDate: CAMP.RANGE_END, year: CAMP.YEAR,
  countryCode: null, logoUrl: null, raceFormat: 'one_day', _days: [],
};

// Devuelve true si el color hex es blanco o muy claro (luminancia > 0.85)
function isNearWhite(hex) {
  if (!hex) return false;
  const h = hex.replace('#', '');
  if (h.length !== 3 && h.length !== 6) return false;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // Luminancia relativa (fórmula sRGB)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.85;
}

// Color de paleta apagado para sustituir blancos en hover
const WHITE_FALLBACK_COLOR = '#7a9cc4';

function raceColor(colorHex) {
  if (!colorHex) return 'var(--accent)';
  return isNearWhite(colorHex) ? WHITE_FALLBACK_COLOR : colorHex;
}

function formatDateRange(days) {
  if (!days.length) return '';
  const sorted = [...days].sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
  const first = sorted[0].dateKey;
  const last  = sorted[sorted.length - 1].dateKey;
  const MONTHS = t('months.short');
  const fmt = key => {
    const [, m, d] = key.split('-').map(Number);
    return `${d} ${MONTHS[m-1]}`;
  };
  if (first === last) return fmt(first);
  const [, m1] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  return m1 === m2
    ? `${first.split('-')[2].replace(/^0/, '')} – ${d2} ${MONTHS[m2-1]}`
    : `${fmt(first)} – ${fmt(last)}`;
}

// ── Helpers de países ────────────────────────────────────────────
const COUNTRY_LIST_T = [
  // Regionales españolas (normalizadas a 'es' en el selector)
  { code: 'es-an', name: 'Andalucía' },
  { code: 'es-ar', name: 'Aragón' },
  { code: 'es-as', name: 'Asturias' },
  { code: 'es-cn', name: 'Canarias' },
  { code: 'es-cb', name: 'Cantabria' },
  { code: 'es-cm', name: 'Castilla-La Mancha' },
  { code: 'es-cl', name: 'Castilla y León' },
  { code: 'es-ct', name: 'Catalunya' },
  { code: 'es-ce', name: 'Ceuta' },
  { code: 'es-vc', name: 'Comunidad Valenciana' },
  { code: 'es-ex', name: 'Extremadura' },
  { code: 'es-ga', name: 'Galicia' },
  { code: 'es-ib', name: 'Islas Baleares' },
  { code: 'es-ri', name: 'La Rioja' },
  { code: 'es-md', name: 'Madrid' },
  { code: 'es-ml', name: 'Melilla' },
  { code: 'es-mc', name: 'Murcia' },
  { code: 'es-nc', name: 'Navarra' },
  { code: 'es-pv', name: 'País Vasco' },
  // A
  { code: 'am', name: 'Armenia' },
  { code: 'bi', name: 'Burundi' },
  { code: 'bj', name: 'Benín' },
  { code: 'hk', name: 'Hong Kong' },
  { code: 'jm', name: 'Jamaica' },
  { code: 'xk', name: 'Kosovo' },
  { code: 'ad', name: 'Andorra' },
  { code: 'ae', name: 'Emiratos Árabes Unidos' },
  { code: 'al', name: 'Albania' },
  { code: 'ao', name: 'Angola' },
  { code: 'ar', name: 'Argentina' },
  { code: 'at', name: 'Austria' },
  { code: 'au', name: 'Australia' },
  { code: 'az', name: 'Azerbaiyán' },
  // B
  { code: 'ba', name: 'Bosnia y Herzegovina' },
  { code: 'bd', name: 'Bangladés' },
  { code: 'be', name: 'Bélgica' },
  { code: 'bf', name: 'Burkina Faso' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'bh', name: 'Baréin' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'br', name: 'Brasil' },
  { code: 'by', name: 'Bielorrusia' },
  // C
  { code: 'ca', name: 'Canadá' },
  { code: 'cd', name: 'República Democrática del Congo' },
  { code: 'ch', name: 'Suiza' },
  { code: 'ci', name: 'Costa de Marfil' },
  { code: 'cl', name: 'Chile' },
  { code: 'cm', name: 'Camerún' },
  { code: 'cn', name: 'China' },
  { code: 'co', name: 'Colombia' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'cu', name: 'Cuba' },
  { code: 'cv', name: 'Cabo Verde' },
  { code: 'cy', name: 'Chipre' },
  { code: 'cz', name: 'República Checa' },
  // D
  { code: 'de', name: 'Alemania' },
  { code: 'dk', name: 'Dinamarca' },
  { code: 'do', name: 'República Dominicana' },
  { code: 'dz', name: 'Argelia' },
  // E
  { code: 'ec', name: 'Ecuador' },
  { code: 'ee', name: 'Estonia' },
  { code: 'eg', name: 'Egipto' },
  { code: 'er', name: 'Eritrea' },
  { code: 'es', name: 'España' },
  { code: 'et', name: 'Etiopía' },
  // F
  { code: 'fi', name: 'Finlandia' },
  { code: 'fr', name: 'Francia' },
  // G
  { code: 'gb', name: 'Gran Bretaña' },
  { code: 'ge', name: 'Georgia' },
  { code: 'gh', name: 'Ghana' },
  { code: 'gr', name: 'Grecia' },
  { code: 'gt', name: 'Guatemala' },
  // H
  { code: 'hr', name: 'Croacia' },
  { code: 'hu', name: 'Hungría' },
  // I
  { code: 'id', name: 'Indonesia' },
  { code: 'ie', name: 'Irlanda' },
  { code: 'il', name: 'Israel' },
  { code: 'in', name: 'India' },
  { code: 'iq', name: 'Irak' },
  { code: 'ir', name: 'Irán' },
  { code: 'it', name: 'Italia' },
  // J
  { code: 'jo', name: 'Jordania' },
  { code: 'jp', name: 'Japón' },
  // K
  { code: 'ke', name: 'Kenia' },
  { code: 'kg', name: 'Kirguistán' },
  { code: 'kp', name: 'Corea del Norte' },
  { code: 'kr', name: 'Corea del Sur' },
  { code: 'kw', name: 'Kuwait' },
  { code: 'kz', name: 'Kazajistán' },
  // L
  { code: 'lb', name: 'Líbano' },
  { code: 'li', name: 'Liechtenstein' },
  { code: 'ls', name: 'Lesoto' },
  { code: 'lt', name: 'Lituania' },
  { code: 'lu', name: 'Luxemburgo' },
  { code: 'lv', name: 'Letonia' },
  // M
  { code: 'ma', name: 'Marruecos' },
  { code: 'md', name: 'Moldavia' },
  { code: 'mk', name: 'Macedonia del Norte' },
  { code: 'mn', name: 'Mongolia' },
  { code: 'mt', name: 'Malta' },
  { code: 'mu', name: 'Mauricio' },
  { code: 'mx', name: 'México' },
  { code: 'my', name: 'Malasia' },
  // N
  { code: 'na', name: 'Namibia' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'nl', name: 'Países Bajos' },
  { code: 'no', name: 'Noruega' },
  { code: 'nz', name: 'Nueva Zelanda' },
  // O
  { code: 'om', name: 'Omán' },
  // P
  { code: 'pa', name: 'Panamá' },
  { code: 'pe', name: 'Perú' },
  { code: 'ph', name: 'Filipinas' },
  { code: 'pk', name: 'Pakistán' },
  { code: 'pl', name: 'Polonia' },
  { code: 'pt', name: 'Portugal' },
  { code: 'py', name: 'Paraguay' },
  // Q
  { code: 'qa', name: 'Catar' },
  // R
  { code: 'ro', name: 'Rumanía' },
  { code: 'rs', name: 'Serbia' },
  { code: 'ru', name: 'Rusia' },
  { code: 'rw', name: 'Ruanda' },
  // S
  { code: 'sa', name: 'Arabia Saudí' },
  { code: 'sd', name: 'Sudán' },
  { code: 'se', name: 'Suecia' },
  { code: 'sg', name: 'Singapur' },
  { code: 'si', name: 'Eslovenia' },
  { code: 'sk', name: 'Eslovaquia' },
  { code: 'sn', name: 'Senegal' },
  { code: 'sv', name: 'El Salvador' },
  { code: 'sx', name: 'San Martín' },
  // T
  { code: 'th', name: 'Tailandia' },
  { code: 'tj', name: 'Tayikistán' },
  { code: 'tm', name: 'Turkmenistán' },
  { code: 'tn', name: 'Túnez' },
  { code: 'tr', name: 'Turquía' },
  { code: 'tw', name: 'Taiwán' },
  { code: 'tz', name: 'Tanzania' },
  // U
  { code: 'ua', name: 'Ucrania' },
  { code: 'ug', name: 'Uganda' },
  { code: 'us', name: 'Estados Unidos' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'uz', name: 'Uzbekistán' },
  // V
  { code: 've', name: 'Venezuela' },
  { code: 'vn', name: 'Vietnam' },
  // Z
  { code: 'za', name: 'Sudáfrica' },
  { code: 'zm', name: 'Zambia' },
  { code: 'zw', name: 'Zimbabue' },
];
const COUNTRY_MAP_T = Object.fromEntries(COUNTRY_LIST_T.map(c => [c.code.toLowerCase(), c.name]));
export function tCountryName(code) {
  if (!code) return code;
  return COUNTRY_MAP_T[code.toLowerCase()] || code.toUpperCase();
}
function tNormalizeCC(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  return c.startsWith('es-') ? 'es' : c;
}

// ── Filtros reutilizables ────
const _EUROPE = new Set(['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK']);

function _applyCategoryFilter(races) {
  // CN fuera de la página de Campeonatos: mismas reglas que en Hoy y Mes.
  const championships = races.filter(r => r.uciCategory === 'CN' && !isOnChampionshipsPage(r)
    && (S.activeCat === 'all' || championshipMatchesCategoryFilter(r, S.activeCat)));
  races = races.filter(r => r.uciCategory !== 'CN');
  if (S.activeCat === 'pro') {
    races = races.filter(r => r.uciCategory !== '1.2' && r.uciCategory !== '2.2' && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || isTourDelPorvenir(r.name)));
  } else if (S.activeCat === 'uwt') {
    races = races.filter(r => r.uciCategory === '1.UWT' || r.uciCategory === '2.UWT');
  } else if (S.activeCat === 'wwt') {
    races = races.filter(r => r.uciCategory === '1.WWT' || r.uciCategory === '2.WWT');
  } else if (S.activeCat === 'male') {
    races = races.filter(r => (r.gender === 'male' || ((r.uciCategory === 'WC' || r.uciCategory === 'CC') && /relevo mixto|mixed relay/i.test(r.name || ''))) && r.uciCategory !== '1.2' && r.uciCategory !== '2.2' && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || isTourDelPorvenir(r.name)));
  } else if (S.activeCat === 'female') {
    races = races.filter(r => (r.gender === 'female' || ((r.uciCategory === 'WC' || r.uciCategory === 'CC') && /relevo mixto|mixed relay/i.test(r.name || ''))) && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || isTourDelPorvenir(r.name)) && ((r.uciCategory !== '1.2' && r.uciCategory !== '2.2') || _EUROPE.has((r.countryCode || '').toUpperCase())));
  }
  if (S.activeCat !== 'all') {
    races = races.filter(r => {
      if (r.uciCategory === 'WC' || r.uciCategory === 'CC') return /europa|mundo/i.test(r.name || '');
      return true;
    });
  }
  return [...races, ...championships];
}

function _applyCountryFilter(races) {
  if (!S.activeCountry) return races;
  return races.filter(r => tNormalizeCC(r.countryCode || '') === S.activeCountry);
}

function _applyCategoryFilterCG(challengeGroups) {
  if (S.activeCat === 'male') return challengeGroups.filter(cg => cg.gender !== 'female' && cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  if (S.activeCat === 'female') return challengeGroups.filter(cg => cg.gender === 'female' && cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  if (S.activeCat === 'uwt' || S.activeCat === 'wwt') return [];
  if (S.activeCat === 'pro') return challengeGroups.filter(cg => cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  return challengeGroups;
}

function _applyCountryFilterCG(challengeGroups) {
  if (!S.activeCountry) return challengeGroups;
  return challengeGroups.filter(cg => tNormalizeCC(cg.countryCode || '') === S.activeCountry);
}

// Nombre del campeonato sin la prueba: «Campeonato de Asia CRI femenino» →
// «Campeonato de Asia»; «Asian Championships - Women's Elite ITT» → «Asian Championships».
const championshipBaseName = name => (name || '').replace(/\s+(?:-\s|(?:CRI|CRE|línea|[Mm]en's|[Ww]omen's)\b).*$/, '');

// Pruebas que se agrupan: campeonatos continentales, mundiales y nacionales, y las
// que llevan «Panamericano» o «Juegos» en el nombre.
const isGroupedEvent = race => ['CC', 'CN', 'WC'].includes(race.uciCategory)
  || /\b(?:panamericanos?|juegos)\b/i.test(race.name || '');

// Solo la prueba, para la fila bajo el grupo: «CRI femenina», «Línea sub23
// masculina», «Women's Elite ITT». El nombre completo no cabe en el móvil y todas
// las filas se verían iguales. El género concuerda con la modalidad.
function championshipEventName(name) {
  const event = name.slice(championshipBaseName(name).length).replace(/^\s+(?:-\s+)?/, '')
    .replace('femenino', 'femenina').replace('masculino', 'masculina');
  return event.charAt(0).toUpperCase() + event.slice(1);
}

// Campeonatos y Juegos visibles, agrupados como un challenge: una fila
// desplegable con las fechas de la primera a la última prueba. Con una
// sola prueba visible no se agrupa. Un país con pruebas a ambos lados de la
// ventana de la página de Campeonatos forma un grupo por cada lado.
function _buildChampionshipGroups(races) {
  const byEvent = new Map();
  races.forEach(race => {
    if (!isGroupedEvent(race)) return;
    const afterPage = race.uciCategory === 'CN' && (race.startDate || '').slice(5) > CAMP.QUERY_END.slice(5);
    const key = `${race.year}-${race.uciCategory}-${championshipBaseName(race.name)}${afterPage ? '-2' : ''}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(race);
  });
  return [...byEvent].filter(([, members]) => members.length > 1).map(([key, members]) => {
    const [first] = members;
    return {
      id: key.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
      name: championshipBaseName(raceName(first)),
      gender: members.every(r => r.gender === first.gender) ? first.gender : null,
      uciCategory: first.uciCategory,
      countryCode: first.countryCode,
      colorHex: first.colorHex,
      logoUrl: first.logoUrl,
      raceIds: members.map(r => r.id),
      _races: members,
      _isChampionship: true,
    };
  });
}

function _firstDateKey(race) {
  // Prefer startDate: asigna el mes aunque la carrera aún no tenga jornadas.
  if (race.startDate) return race.startDate;
  if (race._days && race._days.length) return race._days.map(d => d.dateKey).sort()[0] || '9999-99-99';
  return '9999-99-99';
}
function _firstDateKeyGroup(cg) {
  // Prefer startDate: asigna el mes aunque las pruebas aún no tengan jornadas.
  const starts = cg._races.map(r => r.startDate).filter(Boolean).sort();
  if (starts.length) return starts[0];
  const allDays = cg._races.flatMap(r => r._days.map(d => d.dateKey));
  if (allDays.length) return allDays.sort()[0];
  return '9999-99-99';
}
function _lastDateKey(race) {
  const dayKey = (race._days && race._days.length) ? (race._days.map(d => d.dateKey).sort().slice(-1)[0] || '') : '';
  // Para clásicas de un día no usar endDate (puede tener dato erróneo en BD); basta con startDate
  const dateKey = (race.raceFormat === 'one_day')
    ? (race.startDate || '')
    : (race.endDate || race.startDate || '');
  return (dayKey > dateKey ? dayKey : dateKey) || '0000-00-00';
}
function _lastDateKeyGroup(cg) {
  const allDays = cg._races.flatMap(r => r._days.map(d => d.dateKey));
  const lastDayKey  = allDays.length ? allDays.sort().slice(-1)[0] : '';
  const ends        = cg._races.map(r => r.endDate || r.startDate).filter(Boolean).sort();
  const lastEndDate = ends.slice(-1)[0] || '';
  return (lastDayKey > lastEndDate ? lastDayKey : lastEndDate) || '0000-00-00';
}

function _buildSortedItems(standaloneRaces, challengeGroups) {
  const items = [
    ...standaloneRaces.map(r => ({ type: 'race', data: r, sortKey: _firstDateKey(r), endKey: _lastDateKey(r), rankVal: categoryRank(r.uciCategory, r.name, r.countryCode) })),
    ...challengeGroups.map(cg => ({ type: 'challenge', data: cg, sortKey: _firstDateKeyGroup(cg), endKey: _lastDateKeyGroup(cg), rankVal: categoryRank(cg.uciCategory || '1.1', cg.name, cg.countryCode) })),
  ];
  items.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    if (a.rankVal !== b.rankVal) return a.rankVal - b.rankVal;
    const genderVal = item => (item.data.gender === 'female') ? 1 : 0;
    if (genderVal(a) !== genderVal(b)) return genderVal(a) - genderVal(b);
    return 0;
  });
  return items;
}

export function _getFilteredData() {
  let races = S.allRaces.filter(r => (r.year || 0) === S.activeYear);
  races = _applyCategoryFilter(races);
  races = _applyCountryFilter(races);
  let challengeGroups = S.allChallengeGroups.filter(cg => (cg.year || 0) === S.activeYear);
  challengeGroups = _applyCategoryFilterCG(challengeGroups);
  challengeGroups = _applyCountryFilterCG(challengeGroups);
  challengeGroups = [...challengeGroups, ..._buildChampionshipGroups(races)];
  const racesInChallenges = new Set(challengeGroups.flatMap(cg => (cg.raceIds || [])));
  const standaloneRaces = races.filter(r => !racesInChallenges.has(r.id));
  // Inyectar la fila de Campeonatos TRAS el filtro de categoría (así aparece en todas
  // las pestañas). Gated por año y por filtro de país (no tiene país → solo en "todos").
  if (S.activeYear === CAMP.YEAR && !S.activeCountry) {
    standaloneRaces.push(CHAMPIONSHIPS_ITEM);
  }
  return { standaloneRaces, challengeGroups };
}

// Lista de la temporada con el estado actual, agrupada por mes.
export function temporadaListHtml() {
  const { standaloneRaces, challengeGroups } = _getFilteredData();
  const items = _buildSortedItems(standaloneRaces, challengeGroups);
  const byMonth = [];
  let currentMonth = null;
  items.forEach(item => {
    const month = item.sortKey.slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      byMonth.push({ month, items: [] });
    }
    byMonth[byMonth.length - 1].items.push(item);
  });
  const MESES = t('months.long');
  let html = '<div class="temporada-list">';
  byMonth.forEach(({ month, items: monthItems }) => {
    const [, m] = month.split('-').map(Number);
    html += `<div class="temporada-month" id="mes-${month}">
      <h3 class="temporada-month__title">${MESES[m - 1] || month}</h3>
      <div class="temporada-races" data-month="${month}">`;
    monthItems.forEach(item => {
      const rowHtml = item.type === 'challenge'
        ? renderChallengeGroup(item.data)
        : renderRaceRow(item.data);
      html += `<div data-sortkey="${item.sortKey}" data-endkey="${item.endKey}">${rowHtml}</div>`;
    });
    html += `</div></div>`;
  });
  return `${html}</div>`;
}

// Países del selector: los de las carreras del año, sin las de la página de Campeonatos.
export function temporadaCountries(races) {
  return [...new Set(
    races.map(r => tNormalizeCC(r.countryCode || '')).filter(Boolean)
  )].sort((a, b) => tCountryName(a).localeCompare(tCountryName(b), 'es'));
}

// ── Renderiza una carrera individual (fila estándar) ─────────────
function renderRaceRow(race, name = raceName(race)) {
  // Fila sintética de Campeonatos: enlaza a la página, badge CN, sin logo/país.
  if (race._isChampionshipsLink) {
    const dStr = formatDateRange([{ dateKey: CAMP.RANGE_START }, { dateKey: CAMP.RANGE_END }]);
    return `<a class="t-race t-race--no-logo t-race--no-flag" href="${campUrl(getLang())}" style="--rc:var(--accent)">
      <span class="t-race__name">${campTitle(getLang())}</span>
      <span class="t-race__dates">${dStr}</span>
      <span class="t-race__cat">${categoryBadge('CN')}</span></a>`;
  }
  const isOneDay = race.raceFormat === 'one_day';
  const hasDays  = race._days && race._days.length > 0;

  // Fechas: desde jornadas reales o desde startDate/endDate
  let dateStr = '';
  if (hasDays) {
    dateStr = formatDateRange(race._days);
  } else if (race.startDate) {
    const fakeDays = [{ dateKey: race.startDate }];
    if (race.endDate && race.endDate !== race.startDate) fakeDays.push({ dateKey: race.endDate });
    dateStr = formatDateRange(fakeDays);
  }

  // Enlace solo si hay jornadas; para clásicas, además debe cumplir condición de clicabilidad
  let href = null;
  let modalRdId = null;
  if (hasDays) {
    const firstDay = [...race._days].sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
    if (isOneDay) {
      const fdViewableProfile = hasRenderableElevationProfile(firstDay);
      const rdClickable = !race.isNoClickable && (fdViewableProfile || firstDay.hasAssets === true);
      if (rdClickable) {
        href = jornadaUrl(firstDay);
      } else if (!race.isCancelled && hasModalData(firstDay)) {
        modalRdId = firstDay.id;
      }
    } else {
      href = raceUrl(race);
    }
  }

  const flag    = race.hideFlag ? '' : countryFlag(race.countryCode);
  const cat     = race.uciCategory || '';
  const isFemale = needsFemaleMark(race, S.activeCat);
  const colorStyle = `--rc:${raceColor(race.colorHex)}`;
  const isPlaceholder = !hasDays;
  // Los Campeonatos Nacionales no llevan logo: sin hueco.
  const noLogo = race.uciCategory === 'CN';
  const rowClass = noLogo ? 't-race t-race--no-logo' : 't-race';

  const inner = `
    <span class="t-race__flag">${flag}</span>
    ${noLogo ? '' : race.logoUrl
      ? `<img class="t-race__logo" src="${race.logoUrl}" alt="" loading="lazy" ${LOGO_ONERROR}>`
      : logoPlaceholderHtml('t-race__logo-empty')
    }
    <span class="t-race__name${race.isCancelled ? ' t-race__name--cancelled' : ''}">${cleanFeminineName(name, S.activeCat)}${isFemale ? femaleMark({ cls: 't-race__female', style: 'font-size:0.75em;opacity:0.7;font-weight:400' }) : ''}</span>
    <span class="t-race__dates">${dateStr}</span>
    ${cat ? `<span class="t-race__cat">${categoryBadge(cat)}</span>` : ''}
  `;

  if (href) {
    return `<a class="${rowClass}" href="${href}" style="${colorStyle}"${race.isCancelled ? ' data-ph-tooltip="Carrera cancelada"' : ''} >${inner}</a>`;
  }
  // Abre el modal de datos: <button> real para que entre en el orden de
  // tabulación y responda a Enter/Espacio (WCAG 2.1.1).
  if (modalRdId) {
    return `<button type="button" class="${rowClass} t-race--modal" style="${colorStyle}" data-rdid="${modalRdId}" data-raceid="${race.id}">${inner}</button>`;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const phTooltip = race.isCancelled ? 'Carrera cancelada'
    : (race.startDate && todayStr < race.startDate ? 'Por ahora sin información extra' : 'Sin información extra');
  return `<div class="${rowClass} t-race--placeholder" style="${colorStyle}" data-ph-tooltip="${phTooltip}">${inner}</div>`;
}

// ── Renderiza un challenge group o un campeonato (fila desplegable) ───
// La fila es un botón que despliega bajo ella las pruebas del grupo, igual que
// las apps.
const CHEVRON_SVG = '<svg class="t-race__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

function renderChallengeGroup(cg) {
  // De la primera a la última prueba.
  const firstKey = _firstDateKeyGroup(cg);
  const dateStr  = firstKey === '9999-99-99' ? ''
    : formatDateRange([{ dateKey: firstKey }, { dateKey: _lastDateKeyGroup(cg) }]);
  const cat        = cg.uciCategory || '1.1';
  const flag       = countryFlag(cg.countryCode);
  const color      = raceColor(cg.colorHex);
  const colorStyle = `--rc:${color}`;
  const expanded   = S.expandedChallenges.has(cg.id);
  const panelId    = `cg-panel-${cg.id}`;

  const showFemale = needsFemaleMark(cg, S.activeCat);
  const displayName = cleanFeminineName(cg.name, S.activeCat);
  const femaleSuffix = showFemale
    ? femaleMark({ cls: 't-race__female', style: 'font-size:0.75em;opacity:0.7;font-weight:400' })
    : '';

  const noLogo = cat === 'CN';

  const members = [...cg._races].sort((a, b) =>
    _firstDateKey(a).localeCompare(_firstDateKey(b)) || raceName(a).localeCompare(raceName(b)));

  return `<div class="t-challenge">
    <button type="button" class="t-race t-race--challenge${noLogo ? ' t-race--no-logo' : ''}" style="${colorStyle}" data-cgid="${cg.id}" aria-expanded="${expanded}" aria-controls="${panelId}">
      <span class="t-race__flag">${flag}</span>
      ${noLogo ? '' : cg.logoUrl
        ? `<img class="t-race__logo" src="${cg.logoUrl}" alt="" loading="lazy" ${LOGO_ONERROR}>`
        : logoPlaceholderHtml('t-race__logo-empty')
      }
      <span class="t-race__name t-race__name--group"><span class="t-race__name-text">${displayName}${femaleSuffix}</span>${CHEVRON_SVG}</span>
      <span class="t-race__dates">${dateStr}</span>
      ${cat ? `<span class="t-race__cat">${categoryBadge(cat)}</span>` : ''}
    </button>
    <div class="t-challenge__races" id="${panelId}"${expanded ? '' : ' hidden'}>
      ${members.map(r => renderRaceRow(r, cg._isChampionship ? championshipEventName(raceName(r)) : undefined)).join('')}
    </div>
  </div>`;
}
