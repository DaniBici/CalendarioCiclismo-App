// Filtros de carreras de Hoy, Mes y Temporada (carretera) y de la agenda de
// Ciclocross, con el menú de Fichajes (js/components/filter-menu.js).
// La selección se recuerda por disciplina y la comparten Hoy, Mes y Temporada.
// Espejo de RaceFilters (iOS) y RaceFilters.kt (Android).
import { t, getLang } from './i18n.js';
import { filtersActive, matchesFilters, loadFilters } from './components/filter-menu.js';
import { roadRaceLevel, roadRaceGenders } from './category-filter.js';

export const ROAD_FILTERS_KEY = 'cc_road_filters';
export const CX_FILTERS_KEY = 'cc_cx_filters';
// Filtro fijado con la chincheta hasta la 5.2.3: se convierte una vez.
const LEGACY_ROAD_PIN = 'cc_default_filter';
const LEGACY_CX_PIN = 'cc_cx_default_filter';

export const ROAD_FILTER_GROUPS = [
  { key: 'level', options: [
    { value: 'wt', label: () => t('filter.worldtour') },
    { value: 'pro', label: () => t('filter.professional') },
    { value: 'dev', label: () => '.2' },
  ] },
  { key: 'gender', options: [
    { value: 'male', label: () => t('filter.male') },
    { value: 'female', label: () => t('filter.female') },
  ] },
];

// «Nacional» (NAC, calendario español) no existe en inglés: esas pruebas se
// ocultan en la agenda en inglés (cxHiddenClasses).
export function cxFilterGroups(lang = getLang()) {
  return [{ key: 'level', options: [
    { value: 'big', label: () => t('cx.filter.big') },
    { value: 'uci', label: () => t('cx.filter.uci') },
    ...(lang === 'en' ? [] : [{ value: 'national', label: () => t('cx.filter.national') }]),
  ] }];
}

const LEGACY_ROAD = {
  uwt: { level: ['wt'], gender: ['male'] },
  wwt: { level: ['wt'], gender: ['female'] },
  pro: { level: ['wt', 'pro'] },
  male: { level: ['wt', 'pro'], gender: ['male'] },
  female: { gender: ['female'] },
};
const LEGACY_CX = { big: { level: ['big'] }, pro: { level: ['big', 'uci'] }, spain: { level: ['national'] } };

// Convierte la chincheta antigua en la selección nueva y la retira.
function legacyFallback(pinKey, storageKey, table) {
  return () => {
    try {
      const pin = localStorage.getItem(pinKey);
      if (pin == null) return null;
      localStorage.removeItem(pinKey);
      const saved = table[pin] || null;
      if (saved) localStorage.setItem(storageKey, JSON.stringify(saved));
      return saved;
    } catch { return null; }
  };
}

export const loadRoadFilters = () =>
  loadFilters(ROAD_FILTERS_KEY, ROAD_FILTER_GROUPS, legacyFallback(LEGACY_ROAD_PIN, ROAD_FILTERS_KEY, LEGACY_ROAD));
export const loadCxFilters = (groups = cxFilterGroups()) =>
  loadFilters(CX_FILTERS_KEY, groups, legacyFallback(LEGACY_CX_PIN, CX_FILTERS_KEY, LEGACY_CX));

// Mes y Temporada comparten página y selección: un solo estado.
let _sharedRoad = null;
export const sharedRoadFilters = () => (_sharedRoad ||= loadRoadFilters());
export const setSharedRoadFilters = filters => { _sharedRoad = filters; };
export const roadFiltersActive = filters => !!filters && filtersActive(ROAD_FILTER_GROUPS, filters);

/** Pasa el filtro de carretera; sin `filters`, todo pasa. */
export function roadRaceMatches(race, filters) {
  return matchesFilters(ROAD_FILTER_GROUPS, filters, key =>
    key === 'level' ? roadRaceLevel(race) : roadRaceGenders(race));
}

/** Solo Femenino marcado: los nombres prescinden del sufijo femenino y las
 *  tarjetas, del símbolo ♀ (needsFemaleMark, cleanFeminineName). */
const roadFiltersFemaleOnly = filters =>
  !!filters && filters.gender.size === 1 && filters.gender.has('female');

/** Valor que esperan needsFemaleMark y cleanFeminineName de js/shared.js. */
export const femaleMarkCat = filters => (roadFiltersFemaleOnly(filters) ? 'female' : 'all');

// Nivel de una prueba de ciclocross: Big (Mundial, Copa del Mundo, Continental
// y los torneos Copa del Mundo, Superprestige, X2O y HG Cross, antes Exact
// Cross), Nacional (NAC, calendario nacional español) y UCI (el resto: C1 y C2
// fuera de esos torneos y los Campeonatos nacionales de cada país).
const CX_BIG_CLASSES = new Set(['CM', 'CDM', 'CC']);
const CX_BIG_TOURNAMENTS = ['superprestige', 'x2o', 'worldcup', 'copadelmundo', 'exactcross', 'hgcross'];
export function cxRaceLevel(race) {
  if (race?.class === 'NAC') return 'national';
  if (CX_BIG_CLASSES.has(race?.class)) return 'big';
  const tournament = race?.cx_tournaments;
  if (tournament) {
    const identity = `${tournament.slug || ''} ${tournament.name || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (CX_BIG_TOURNAMENTS.some(key => identity.includes(key))) return 'big';
  }
  return 'uci';
}

export function cxRaceMatches(race, filters, groups = cxFilterGroups()) {
  return matchesFilters(groups, filters, () => cxRaceLevel(race));
}

export const filterLabels = () => ({ label: t('filter.title'), clearLabel: t('filter.clear') });
