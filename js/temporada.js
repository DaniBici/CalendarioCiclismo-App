// ─────────────────────────────────────────────────────────────────
//  TEMPORADA — temporada.html
// ─────────────────────────────────────────────────────────────────

import { supabase, uciRank, proLevel, countryFlag, jornadaUrl, raceUrl, raceName,
         categoryBadge, setMeta, setMetaProperty, initPhTooltip,
         bulkCacheRaces, enBase,
         getPinnedFilter, renderFilterPins, handleFilterEvent, setPressed, femaleMark }
         from './shared.js';
import { t, initI18n, getLang } from './i18n.js';
initI18n(); // carga el diccionario EN en paralelo con los datos
import { hasModalData, openRaceDataModal } from './race-data-modal.js';
import { CAMP, campUrl, campTitle } from './campeonatos-config.js';

// Fila sintética "Campeonatos Nacionales" (CN) — aparece en TODAS las categorías
// porque se inyecta tras el filtro. Enlaza a la página de Modo Campeonatos.
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

// ── Estado ───────────────────────────────────────────────────────
let allRaces          = [];   // [{...raceData, id, _days:[{dateKey}]}]
let allChallengeGroups = [];  // [{...groupData, id, _races:[raceObj]}]
let activeYear        = new Date().getFullYear();
window._icalYear = activeYear;
let activeCat         = getPinnedFilter() || 'all';
let activeCountry     = '';

// ── Lazy loading por mes ─────────────────────────────────────────
let _loadedMonths  = new Set();  // meses con race_days cargados, e.g. "2026-04"
let _daysByRace    = {};         // race_days acumulados: { raceId: [{id,dateKey,...}] }
let _monthObserver = null;       // IntersectionObserver para carga lazy

// ── Carga inicial ────────────────────────────────────────────────
async function init() {
  // Leer año y filtro de categoría de la URL si vienen como parámetros
  const params = new URLSearchParams(location.search);
  if (params.get('year')) activeYear = parseInt(params.get('year'));
  if (params.get('cat'))  activeCat  = params.get('cat');
window._temporadaCat = activeCat;

  // Actualizar el label del nav con el año activo
  document.querySelectorAll('#navTemporadaLabel').forEach(el => {
    el.textContent = activeYear;
  });

  // Cargar races del año activo + race_days solo de 3 meses (actual ±1)
  const todayMonth = new Date().getMonth(); // 0-based
  const initialMonths = _monthRange(activeYear, todayMonth, 1);
  const rdStartKey = initialMonths[0].start;
  const rdEndKey   = initialMonths[initialMonths.length - 1].end;

  const [racesResult, rdResult, cgResult] = await Promise.all([
    supabase.from('races').select('*').eq('year', activeYear),
    supabase.from('race_days').select('*').eq('editorialStatus', 'published').gte('dateKey', rdStartKey).lte('dateKey', rdEndKey),
    supabase.from('challenge_groups').select('*')
  ]);
  const races = racesResult.data || [];

  // Poblar caché de races
  const raceCacheMap = {};
  races.forEach(r => { raceCacheMap[r.id] = r; });
  bulkCacheRaces(raceCacheMap);

  // Inicializar estado lazy
  _loadedMonths = new Set(initialMonths.map(m => m.key));
  _daysByRace = {};
  _mergeRaceDays(rdResult.data || []);
  races.forEach(r => { r._days = _daysByRace[r.id] || []; });

  // Incluir races con jornadas publicadas, con startDate/endDate definidos, o placeholders
  allRaces = races.filter(r => r._days.length > 0 || r.startDate || r.isPlaceholder === true);

  // Cargar challenge_groups y asociarles las races que ya tenemos en memoria
  allChallengeGroups = (cgResult.data || []).map(d => {
    const raceIds = Array.isArray(d.raceIds) ? d.raceIds : [];
    return { ...d, _races: allRaces.filter(r => raceIds.includes(r.id)) };
  }).filter(cg => cg._races.length > 0);

  // Poblar selector de años (rango fijo para evitar consulta extra)
  const currentYear = new Date().getFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1].filter(y => y >= 2026).sort((a, b) => b - a);
  if (!years.includes(activeYear)) years.unshift(activeYear);
  years.sort((a, b) => b - a);
  const yearSel = document.getElementById('filterYear');
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === activeYear) opt.selected = true;
    yearSel.appendChild(opt);
  });

  yearSel.addEventListener('change', async () => {
    activeYear = parseInt(yearSel.value);
  window._icalYear = activeYear;
    document.querySelectorAll('#navTemporadaLabel').forEach(el => el.textContent = activeYear);
    await reloadYear();
  });

  // Selector de mes → scroll al bloque correspondiente
  document.getElementById('filterMonth').addEventListener('change', function () {
    const m = this.value;
    if (!m) return;
    const id = `mes-${activeYear}-${m}`;
    const el = document.getElementById(id);
    if (el) {
      const stickyH = document.querySelector('.temporada-filters')?.offsetHeight || 0;
      const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
      const top = el.getBoundingClientRect().top + window.scrollY - headerH - stickyH - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    // Resetear el select para que se pueda volver a pulsar el mismo mes
    this.value = '';
  });

  // Filtros de categoría
  // Sincronizar botones de filtro con el estado inicial (puede venir de URL o pin)
  const filterCats = document.getElementById('filterCats');
  filterCats.querySelectorAll('.tcat-btn').forEach(b => {
    setPressed(b, b.dataset.cat === activeCat);
  });
  renderFilterPins(filterCats, activeCat);

  const onTempFilterEvent = e => {
    const res = handleFilterEvent(e);
    if (!res) return;
    if (res.type === 'pin') {
      renderFilterPins(filterCats, activeCat);
      return;
    }
    activeCat = res.cat;
    window._temporadaCat = activeCat;
    filterCats.querySelectorAll('.tcat-btn').forEach(b =>
      setPressed(b, b.dataset.cat === activeCat)
    );
    renderFilterPins(filterCats, activeCat);
    render();
  };
  filterCats.addEventListener('click', onTempFilterEvent);
  filterCats.addEventListener('keydown', onTempFilterEvent);

  const filterCountrySel = document.getElementById('filterCountry');
  if (filterCountrySel) {
    filterCountrySel.addEventListener('change', () => {
      activeCountry = filterCountrySel.value;
      render();
    });
  }

  // Delegación de clics para filas de clásicas con datos pero sin jornada clicable
  document.getElementById('temporadaContent').addEventListener('click', e => {
    const el = e.target.closest('.t-race--modal');
    if (!el) return;
    const rdId   = el.dataset.rdid;
    const raceId = el.dataset.raceid;
    if (!rdId || !raceId) return;
    const raceObj = allRaces.find(r => r.id === raceId);
    if (raceObj) openRaceDataModal(rdId, raceObj);
  });

  render();
}


// ── Helpers de países ────────────────────────────────────────────
const COUNTRY_LIST_T = [
  // Regionales españolas (normalizadas a 'es' en el selector)
  { code: 'es-ct', name: 'Catalunya' },
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
function tCountryName(code) {
  if (!code) return code;
  return COUNTRY_MAP_T[code.toLowerCase()] || code.toUpperCase();
}
function tNormalizeCC(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  return (c === 'es-ct' || c === 'es-pv') ? 'es' : c;
}

function updateTemporadaCountrySelector(races) {
  const sel = document.getElementById('filterCountry');
  if (!sel) return;
  const codes = [...new Set(
    races.map(r => tNormalizeCC(r.countryCode || '')).filter(Boolean)
  )].sort((a, b) => tCountryName(a).localeCompare(tCountryName(b), 'es'));
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('season.countryPlaceholder')}</option>`;
  codes.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = tCountryName(code);
    sel.appendChild(opt);
  });
  if (prev && codes.includes(prev)) sel.value = prev;
  else if (prev) activeCountry = '';
}

// ── Helpers de carga lazy por mes ─────────────────────────────────

// Devuelve un array de objetos { key: "YYYY-MM", start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
// para el mes centerMonth (0-based) ± radius meses, acotado al año dado
function _monthRange(year, centerMonth, radius) {
  const months = [];
  for (let i = centerMonth - radius; i <= centerMonth + radius; i++) {
    if (i < 0 || i > 11) continue;
    const m = String(i + 1).padStart(2, '0');
    const lastDay = new Date(year, i + 1, 0).getDate();
    months.push({
      key:   `${year}-${m}`,
      start: `${year}-${m}-01`,
      end:   `${year}-${m}-${String(lastDay).padStart(2, '0')}`
    });
  }
  return months;
}

// Merge race_days (array of plain objects from Supabase) en el acumulador global
function _mergeRaceDays(docs) {
  docs.forEach(d => {
    const raceId = d.raceId;
    if (!raceId) return;
    if (!_daysByRace[raceId]) _daysByRace[raceId] = [];
    // Evitar duplicados
    if (_daysByRace[raceId].some(existing => existing.id === d.id)) return;
    _daysByRace[raceId].push(d);
  });
  // Actualizar _days en allRaces
  allRaces.forEach(r => { r._days = _daysByRace[r.id] || []; });
  // Actualizar _days en challenge groups
  allChallengeGroups.forEach(cg => {
    cg._races.forEach(r => { r._days = _daysByRace[r.id] || []; });
  });
}

// Carga race_days de un mes concreto y re-renderiza su sección
async function _loadMonth(monthKey) {
  if (_loadedMonths.has(monthKey)) return;
  _loadedMonths.add(monthKey);

  const [year, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const startKey = `${monthKey}-01`;
  const endKey   = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

  const { data: rdData } = await supabase.from('race_days').select('*').eq('editorialStatus', 'published').gte('dateKey', startKey).lte('dateKey', endKey);

  _mergeRaceDays(rdData || []);

  // Actualizar allRaces: incluir races que ahora tienen _days pero antes no
  const racesById = {};
  allRaces.forEach(r => { racesById[r.id] = true; });
  // (races sin _days ya están incluidas si tienen startDate/endDate)

  // Re-renderizar solo la sección del mes afectado
  _rerenderMonth(monthKey);
}

// Re-renderiza el contenido de un mes concreto sin tocar el resto
function _rerenderMonth(monthKey) {
  const container = document.querySelector(`.temporada-races[data-month="${monthKey}"]`);
  if (!container) return;

  // Obtener items para este mes (misma lógica que render pero solo para este mes)
  const monthItems = _getMonthItems(monthKey);
  if (!monthItems.length) {
    container.innerHTML = '';
    return;
  }
  let html = '';
  monthItems.forEach(item => {
    const rowHtml = item.type === 'challenge'
      ? renderChallengeGroup(item.data)
      : renderRaceRow(item.data);
    html += `<div data-sortkey="${item.sortKey}" data-endkey="${item.endKey}">${rowHtml}</div>`;
  });
  container.innerHTML = html;
}

// ── Filtros reutilizables (usados por render y _getMonthItems) ────
const _EUROPE = new Set(['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK']);

function _applyCategoryFilter(races) {
  races = races.filter(r => r.uciCategory !== 'CN');
  if (activeCat === 'pro') {
    races = races.filter(r => r.uciCategory !== '1.2' && r.uciCategory !== '2.2' && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || /tour del porvenir/i.test(r.name || '')));
  } else if (activeCat === 'uwt') {
    races = races.filter(r => r.uciCategory === '1.UWT' || r.uciCategory === '2.UWT');
  } else if (activeCat === 'wwt') {
    races = races.filter(r => r.uciCategory === '1.WWT' || r.uciCategory === '2.WWT');
  } else if (activeCat === 'male') {
    races = races.filter(r => (r.gender !== 'female' || r.uciCategory === 'WC' || r.uciCategory === 'CC') && r.uciCategory !== '1.2' && r.uciCategory !== '2.2' && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || /tour del porvenir/i.test(r.name || '')));
  } else if (activeCat === 'female') {
    races = races.filter(r => (r.gender === 'female' || r.uciCategory === 'WC' || r.uciCategory === 'CC') && (r.uciCategory !== '1.2U' && r.uciCategory !== '2.2U' || /tour del porvenir/i.test(r.name || '')) && ((r.uciCategory !== '1.2' && r.uciCategory !== '2.2') || _EUROPE.has((r.countryCode || '').toUpperCase())));
  }
  if (activeCat !== 'all') {
    races = races.filter(r => {
      if (r.uciCategory === 'WC' || r.uciCategory === 'CC') return /europa|mundo/i.test(r.name || '');
      return true;
    });
  }
  return races;
}

function _applyCountryFilter(races) {
  if (!activeCountry) return races;
  const esGroup = new Set(['es', 'es-ct', 'es-pv']);
  return races.filter(r => {
    const cc = tNormalizeCC(r.countryCode || '');
    return activeCountry === 'es' ? esGroup.has((r.countryCode || '').toLowerCase()) || cc === 'es' : cc === activeCountry;
  });
}

function _applyCategoryFilterCG(challengeGroups) {
  if (activeCat === 'male') return challengeGroups.filter(cg => cg.gender !== 'female' && cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  if (activeCat === 'female') return challengeGroups.filter(cg => cg.gender === 'female' && cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  if (activeCat === 'uwt' || activeCat === 'wwt') return [];
  if (activeCat === 'pro') return challengeGroups.filter(cg => cg.uciCategory !== '1.2' && cg.uciCategory !== '2.2');
  return challengeGroups;
}

function _applyCountryFilterCG(challengeGroups) {
  if (!activeCountry) return challengeGroups;
  const esGroup = new Set(['es', 'es-ct', 'es-pv']);
  return challengeGroups.filter(cg => {
    const cc = tNormalizeCC(cg.countryCode || '');
    return activeCountry === 'es' ? esGroup.has((cg.countryCode || '').toLowerCase()) || cc === 'es' : cc === activeCountry;
  });
}

function _firstDateKey(race) {
  // Prefer startDate for stable month assignment during lazy loading;
  // avoids races shifting between months as race_days load incrementally.
  if (race.startDate) return race.startDate;
  if (race._days && race._days.length) return race._days.map(d => d.dateKey).sort()[0] || '9999-99-99';
  return '9999-99-99';
}
function _firstDateKeyGroup(cg) {
  // Prefer startDate for stable month assignment during lazy loading
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
    ...standaloneRaces.map(r => ({ type: 'race', data: r, sortKey: _firstDateKey(r), endKey: _lastDateKey(r), uciRankVal: uciRank(r.uciCategory, r.name, r.countryCode), lvlVal: proLevel(r.uciCategory, r.name, r.countryCode) })),
    ...challengeGroups.map(cg => ({ type: 'challenge', data: cg, sortKey: _firstDateKeyGroup(cg), endKey: _lastDateKeyGroup(cg), uciRankVal: uciRank(cg.uciCategory || '1.1'), lvlVal: proLevel(cg.uciCategory || '1.1', cg.name, cg.countryCode) })),
  ];
  items.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    if (a.lvlVal !== b.lvlVal) return a.lvlVal - b.lvlVal;
    const genderVal = item => (item.data.gender === 'female') ? 1 : 0;
    if (genderVal(a) !== genderVal(b)) return genderVal(a) - genderVal(b);
    if (a.uciRankVal !== b.uciRankVal) return a.uciRankVal - b.uciRankVal;
    return 0;
  });
  return items;
}

function _getFilteredData() {
  let races = allRaces.filter(r => (r.year || 0) === activeYear);
  races = _applyCategoryFilter(races);
  races = _applyCountryFilter(races);
  let challengeGroups = allChallengeGroups.filter(cg => (cg.year || 0) === activeYear);
  challengeGroups = _applyCategoryFilterCG(challengeGroups);
  challengeGroups = _applyCountryFilterCG(challengeGroups);
  const racesInChallenges = new Set(challengeGroups.flatMap(cg => (cg.raceIds || [])));
  const standaloneRaces = races.filter(r => !racesInChallenges.has(r.id));
  // Inyectar la fila de Campeonatos TRAS el filtro de categoría (así aparece en todas
  // las pestañas). Gated por año y por filtro de país (no tiene país → solo en "todos").
  if (activeYear === CAMP.YEAR && !activeCountry) {
    standaloneRaces.push(CHAMPIONSHIPS_ITEM);
  }
  return { standaloneRaces, challengeGroups };
}

// Obtiene los items filtrados y ordenados para un mes concreto
function _getMonthItems(monthKey) {
  const { standaloneRaces, challengeGroups } = _getFilteredData();
  const items = _buildSortedItems(standaloneRaces, challengeGroups);
  return items.filter(item => item.sortKey.slice(0, 7) === monthKey);
}

// ── Recarga datos al cambiar de año ──────────────────────────────
async function reloadYear() {
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const content = document.getElementById('temporadaContent');
  content.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.season')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;

  if (_monthObserver) { _monthObserver.disconnect(); _monthObserver = null; }

  const todayMonth = new Date().getMonth();
  const initialMonths = _monthRange(activeYear, todayMonth, 1);
  const rdStartKey = initialMonths[0].start;
  const rdEndKey   = initialMonths[initialMonths.length - 1].end;

  const [racesResult, rdResult, cgResult] = await Promise.all([
    supabase.from('races').select('*').eq('year', activeYear),
    supabase.from('race_days').select('*').eq('editorialStatus', 'published').gte('dateKey', rdStartKey).lte('dateKey', rdEndKey),
    supabase.from('challenge_groups').select('*')
  ]);
  const races = racesResult.data || [];

  const raceCacheMap = {};
  races.forEach(r => { raceCacheMap[r.id] = r; });
  bulkCacheRaces(raceCacheMap);

  _loadedMonths = new Set(initialMonths.map(m => m.key));
  _daysByRace = {};
  _mergeRaceDays(rdResult.data || []);
  races.forEach(r => { r._days = _daysByRace[r.id] || []; });

  allRaces = races.filter(r => r._days.length > 0 || r.startDate || r.isPlaceholder === true);

  allChallengeGroups = (cgResult.data || []).map(d => {
    const raceIds = Array.isArray(d.raceIds) ? d.raceIds : [];
    return { ...d, _races: allRaces.filter(r => raceIds.includes(r.id)) };
  }).filter(cg => cg._races.length > 0);

  render();
}

// ── Render ───────────────────────────────────────────────────────
function render() {
  const content = document.getElementById('temporadaContent');

  // Poblar selector de país con las carreras del año (antes del filtro de país)
  updateTemporadaCountrySelector(allRaces.filter(r => (r.year || 0) === activeYear && r.uciCategory !== 'CN'));

  const { standaloneRaces, challengeGroups } = _getFilteredData();

  if (!standaloneRaces.length && !challengeGroups.length) {
    content.innerHTML = '<div class="empty-state"><p class="empty-state__text">No hay carreras para los filtros seleccionados.</p></div>';
    return;
  }

  const items = _buildSortedItems(standaloneRaces, challengeGroups);

  // Agrupar por mes
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

  html += '</div>';
  content.innerHTML = html;

  // ── IntersectionObserver para carga lazy de meses ────────────
  if (_monthObserver) _monthObserver.disconnect();
  _monthObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const monthKey = entry.target.dataset.month;
      if (!monthKey || _loadedMonths.has(monthKey)) return;
      _loadMonth(monthKey);
    });
  }, { rootMargin: '200px 0px' }); // pre-cargar 200px antes de que sea visible

  content.querySelectorAll('.temporada-races[data-month]').forEach(el => {
    if (!_loadedMonths.has(el.dataset.month)) {
      _monthObserver.observe(el);
    }
  });

  // Actualizar top dinámico del sticky de mes
  function updateMonthStickyTop() {
    const header  = document.querySelector('.site-header');
    const filters = document.getElementById('temporadaFilters');
    const hH = header  ? header.offsetHeight  : 56;
    const fH = filters ? filters.offsetHeight : 0;
    document.documentElement.style.setProperty('--temporada-month-top', `${hH + fH}px`);
  }
  updateMonthStickyTop();
  // Recalcular si cambia tamaño (wrap de filtros en móvil)
  if (window._temporadaResizeObs) window._temporadaResizeObs.disconnect();
  const filtersEl = document.getElementById('temporadaFilters');
  if (filtersEl && window.ResizeObserver) {
    window._temporadaResizeObs = new ResizeObserver(updateMonthStickyTop);
    window._temporadaResizeObs.observe(filtersEl);
  }

  // ── Restaurar scroll o scroll inteligente ────────────────────────
  const navState = JSON.parse(sessionStorage.getItem('cc_nav') || '{}');
  const savedScrollY = navState.from === 'temporada' && typeof navState.scrollY === 'number'
    ? navState.scrollY : null;

  // Limpiar scrollY del estado para que solo se restaure una vez
  if (savedScrollY !== null) {
    const cleaned = { ...navState };
    delete cleaned.scrollY;
    sessionStorage.setItem('cc_nav', JSON.stringify(cleaned));
  }

  if (savedScrollY !== null) {
    // Precargar todos los meses con datos por encima del scroll guardado
    // para que el layout sea estable antes de restaurar la posición
    const allMonthEls = [...content.querySelectorAll('.temporada-races[data-month]')];
    const pendingLoads = [];
    for (const el of allMonthEls) {
      const mk = el.dataset.month;
      if (!mk || _loadedMonths.has(mk)) continue;
      // Estimamos si el mes está por encima del scroll guardado
      if (el.offsetTop < savedScrollY + window.innerHeight) {
        pendingLoads.push(_loadMonth(mk));
      }
    }
    const restoreScroll = () => window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    if (pendingLoads.length) {
      Promise.all(pendingLoads).then(restoreScroll);
    } else {
      restoreScroll();
    }
  } else {
    // Scroll inteligente al año en curso (comportamiento original)
    const todayFull = new Date().toISOString().slice(0, 10);
    const todayYear = new Date().getFullYear();
    if (activeYear === todayYear) {
      const header     = document.querySelector('.site-header');
      const filters    = document.getElementById('temporadaFilters');
      const monthTitle = document.querySelector('.temporada-month__title');
      const isMobile   = window.innerWidth < 600;
      const offset  = (header     ? header.offsetHeight     : 0)
                    + (filters    ? filters.offsetHeight    : 0)
                    + (monthTitle ? monthTitle.offsetHeight : 0)
                    + (isMobile ? 4 : 8);

      const allRows = [...content.querySelectorAll('[data-sortkey]')];
      const target = allRows.find(el => (el.dataset.endkey || el.dataset.sortkey) >= todayFull);

      const doScroll = (el, fallbackMonthId) => {
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top, behavior: 'smooth' });
        } else if (fallbackMonthId) {
          const mesEl = document.getElementById(fallbackMonthId);
          if (mesEl) {
            const top = mesEl.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top, behavior: 'smooth' });
          }
        }
      };

      const targetMonthKey = target
        ? (target.closest('.temporada-races[data-month]')?.dataset.month || todayFull.slice(0, 7))
        : todayFull.slice(0, 7);
      const [ty, tm] = targetMonthKey.split('-').map(Number);
      const pendingLoads = [];
      for (let mi = 1; mi < tm; mi++) {
        const mk = `${ty}-${String(mi).padStart(2, '0')}`;
        if (!_loadedMonths.has(mk)) pendingLoads.push(_loadMonth(mk));
      }
      if (pendingLoads.length) {
        Promise.all(pendingLoads).then(() => doScroll(target, 'mes-' + todayFull.slice(0, 7)));
      } else {
        doScroll(target, 'mes-' + todayFull.slice(0, 7));
      }
    }
  }

  // Guardar estado de navegación (incluido scroll) al salir a una carrera
  content.addEventListener('click', e => {
    if (e.target.closest('.t-race')) {
      sessionStorage.setItem('cc_nav', JSON.stringify({
        from: 'temporada', year: activeYear, cat: activeCat,
        scrollY: Math.round(window.scrollY)
      }));
    }
  });

  updateSeoTemporada(activeYear);
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
}

// ── Renderiza una carrera individual (fila estándar) ─────────────
function renderRaceRow(race) {
  // Fila sintética de Campeonatos: enlaza a la página, badge CN, sin logo/país.
  if (race._isChampionshipsLink) {
    const dStr = formatDateRange([{ dateKey: CAMP.RANGE_START }, { dateKey: CAMP.RANGE_END }]);
    return `<a class="t-race" href="${campUrl(getLang())}" style="--rc:var(--accent)">
      <span class="t-race__flag"></span><span class="t-race__logo-empty"></span>
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
      const fdViewableProfile = !!(firstDay.elevationProfile && !firstDay.profileNotViewable
        && Array.isArray(firstDay.elevationProfile.points) && firstDay.elevationProfile.points.length >= 2);
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
  const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);
  const isFemale = race.gender === 'female' && !nameImpliesFemale(race.name || '') && activeCat !== 'female' && activeCat !== 'wwt';
  const colorStyle = `--rc:${raceColor(race.colorHex)}`;
  const isPlaceholder = !hasDays;

  const inner = `
    <span class="t-race__flag">${flag}</span>
    ${race.logoUrl
      ? `<img class="t-race__logo" src="${race.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '<span class="t-race__logo-empty"></span>'
    }
    <span class="t-race__name" style="${race.isCancelled ? 'text-decoration:line-through;opacity:0.45' : ''}">${(() => { const _rn = raceName(race); return (activeCat === 'female' || activeCat === 'wwt') ? (/women cycling pro|sanremo women|tour de feminin/i.test(_rn) ? _rn : _rn.replace(/\s*\b(women'?s?\s+elite|femenino|femenina|féminas|femeninos|féminin|féminine|femmes|women'?s?|ladies|donne|dames|elite women|emakumeen|pour dames)\b\s*/gi, ' ').trim().replace(/\s{2,}/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '')) : _rn; })()}${isFemale ? femaleMark({ cls: 't-race__female', style: 'font-size:0.75em;opacity:0.7;font-weight:400' }) : ''}</span>
    <span class="t-race__dates">${dateStr}</span>
    ${cat ? `<span class="t-race__cat">${categoryBadge(cat)}</span>` : ''}
  `;

  if (href) {
    return `<a class="t-race" href="${href}" style="${colorStyle}"${race.isCancelled ? ' data-ph-tooltip="Carrera cancelada"' : ''} >${inner}</a>`;
  }
  // Abre el modal de datos: <button> real para que entre en el orden de
  // tabulación y responda a Enter/Espacio (WCAG 2.1.1).
  if (modalRdId) {
    return `<button type="button" class="t-race t-race--modal" style="${colorStyle}" data-rdid="${modalRdId}" data-raceid="${race.id}">${inner}</button>`;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const phTooltip = race.isCancelled ? 'Carrera cancelada'
    : (race.startDate && todayStr < race.startDate ? 'Por ahora sin información extra' : 'Sin información extra');
  return `<div class="t-race t-race--placeholder" style="${colorStyle}" data-ph-tooltip="${phTooltip}">${inner}</div>`;
}

// ── Renderiza un challenge group (fila expandible) ────────────────
function renderChallengeGroup(cg) {
  const allDays  = cg._races.flatMap(r => r._days);
  // Fallback de fechas para challenges con carreras placeholder (sin race_days)
  let dateStr = formatDateRange(allDays);
  if (!dateStr) {
    const starts = cg._races.map(r => r.startDate).filter(Boolean).sort();
    const ends   = cg._races.map(r => r.endDate || r.startDate).filter(Boolean).sort();
    if (starts.length) {
      dateStr = formatDateRange([
        { dateKey: starts[0] },
        { dateKey: ends[ends.length - 1] },
      ]);
    }
  }
  const cat        = cg.uciCategory || '1.1';
  const flag       = countryFlag(cg.countryCode);
  const isFemale   = cg.gender === 'female';
  const color      = raceColor(cg.colorHex);
  const colorStyle = `--rc:${color}`;

  // Si todas las carreras del grupo son placeholder (sin race_days), tratar el challenge como placeholder
  const allPlaceholder = cg._races.every(r => !r._days || r._days.length === 0);

  const href = (!allPlaceholder && cg.slug)
    ? (getLang() === 'en'
        ? `${enBase()}/race/?challenge=${cg.slug}`
        : `/competicion.html?challenge=${cg.slug}`)
    : null;

  const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);
  const showFemale = isFemale && !nameImpliesFemale(cg.name || '') && activeCat !== 'female' && activeCat !== 'wwt';
  const displayName = (activeCat === 'female' || activeCat === 'wwt')
    ? (/women cycling pro|sanremo women|tour de feminin/i.test(cg.name) ? cg.name : cg.name.replace(/\s*\b(women'?s?\s+elite|femenino|femenina|féminas|femeninos|féminin|féminine|femmes|women'?s?|ladies|donne|dames|elite women|emakumeen|pour dames)\b\s*/gi, ' ').trim().replace(/\s{2,}/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, ''))
    : cg.name;
  const femaleSuffix = showFemale
    ? femaleMark({ cls: 't-race__female', style: 'font-size:0.75em;opacity:0.7;font-weight:400' })
    : '';

  const inner = `
    <span class="t-race__flag">${flag}</span>
    ${cg.logoUrl
      ? `<img class="t-race__logo" src="${cg.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '<span class="t-race__logo-empty"></span>'
    }
    <span class="t-race__name">${displayName}${femaleSuffix}</span>
    <span class="t-race__dates">${dateStr}</span>
    ${cat ? `<span class="t-race__cat">${categoryBadge(cat)}</span>` : ''}
  `;

  if (href) {
    return `<a class="t-race" href="${href}" style="${colorStyle}">${inner}</a>`;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const starts   = cg._races.map(r => r.startDate).filter(Boolean).sort();
  const phTooltip = (starts[0] && todayStr < starts[0]) ? 'Por ahora sin información extra' : 'Sin información extra';
  return `<div class="t-race t-race--placeholder" style="${colorStyle}" data-ph-tooltip="${phTooltip}">${inner}</div>`;
}

initPhTooltip();


init().then(() => {
}).catch(err => {
  document.getElementById('temporadaContent').innerHTML =
    `<div class="empty-state"><p class="empty-state__text">Error al cargar la temporada.</p></div>`;
  console.error(err);
});

// ── SEO ──────────────────────────────────────────────────────────
function updateSeoTemporada(year) {
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';

  const title       = `${getLang() === 'en' ? 'Season' : 'Temporada'} ${year} — ${t('seo.siteName')}`;
  const description = `Listado con todas las carreras de la temporada ${year}, con acceso a la información sobre sus recorridos, horarios, fechas y cómo ver por TV.`;
  const keywords    = [BASE_KW, `temporada ${year}`, `ciclismo ${year}`, `carreras ciclismo ${year}`, String(year)].join(', ');

  document.title = title;
  setMeta('description', description);
  setMeta('keywords', keywords);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
}
