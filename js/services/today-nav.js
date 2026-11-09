// Qué carreras hay un día y a qué día saltar, sin DOM: lo usan Hoy (js/app.js) y la
// publicación por página.
import { toDateKey } from '../shared.js';
import { isTourDelPorvenir } from '../category-filter.js';
import { championshipMatchesCategoryFilter } from '../campeonatos-config.js';
import { annotateDoubleSectors, buildInhouseResultsMatcher } from './races.js';

export const ACTIVE_RACE_COLUMNS = 'id,name,nameEn,slug,slugEn,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,colorHex,logoUrl,hideFlag,isCancelled,isNoClickable';
export const YEAR_NAV_COLUMNS = 'name,year,startDate,endDate,raceFormat,uciCategory,gender,countryCode,isCancelled';


// Calcula si dateKey cae en el rango de la carrera y si es día de carrera
// Grand Tours (>13 días): descanso en lunes, pero en carreras de exactamente 22 días
// el primer lunes es etapa (solo 2 descansos: 2º y 3º lunes).
function mondayIndex(race, dateKey) {
  // Devuelve qué número de lunes es dateKey dentro de la carrera (1-based), o 0 si no es lunes
  const dow = new Date(dateKey + 'T12:00:00').getDay();
  if (dow !== 1) return 0;
  let count = 0;
  const start = new Date(race.startDate + 'T12:00:00');
  const target = new Date(dateKey + 'T12:00:00');
  for (let d = new Date(start); d <= target; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 1) count++;
  }
  return count;
}

function isRaceDay(race, dateKey) {
  if (!race.startDate || !race.endDate) return false;
  if (dateKey < race.startDate || dateKey > race.endDate) return false;

  const durationDays = (new Date(race.endDate) - new Date(race.startDate)) / 86400000 + 1;
  const isGrandTourFormat = race.raceFormat === 'stage_race' && durationDays > 13;

  if (isGrandTourFormat) {
    const mi = mondayIndex(race, dateKey);
    if (mi > 0) {
      // 22 días: descanso solo en el 2º y 3º lunes
      // 23+ días: descanso en todos los lunes
      if (durationDays <= 23 && mi === 1) return true; // primer lunes es etapa
      return false; // resto de lunes son descanso
    }
  }

  return true;
}

// Calcula el número de etapa teórico para una fecha dada
export function theoreticalStageNumber(race, dateKey) {
  if (race.raceFormat === 'one_day') return null;

  const durationDays = (new Date(race.endDate) - new Date(race.startDate)) / 86400000 + 1;
  const isGrandTourFormat = race.raceFormat === 'stage_race' && durationDays > 13;

  let stage = 0;
  const start = new Date(race.startDate + 'T12:00:00');
  const target = new Date(dateKey + 'T12:00:00');

  for (let d = new Date(start); d <= target; d.setDate(d.getDate() + 1)) {
    const dk = toDateKey(d);
    if (isGrandTourFormat && !isRaceDay(race, dk)) continue;
    stage++;
  }
  return stage;
}

const EUROPE = new Set(['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK']);

function isMixedRelayChampionship(race) {
  return ['WC', 'CC'].includes(race?.uciCategory || '')
    && /relevo mixto|mixed relay/i.test(race?.name || '');
}

/** Comprueba si una carrera coincide con un filtro de categoría. La usan la
 *  lista del día (applyAgendaFilters) y la navegación entre días. */
export function matchesCategoryFilter(race, cat) {
  if (cat === 'all') return true;
  const uci = race.uciCategory || '';
  const gender = race.gender || '';
  const cc = (race.countryCode || '').toUpperCase();

  // Campeonatos Nacionales: élite cuenta como pro / por género; sub23 fuera.
  if (uci === 'CN') return championshipMatchesCategoryFilter(race, cat);

  let base = false;
  if (cat === 'pro')    base = ['1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','WC','CC'].includes(uci)
    || (['1.2U','2.2U'].includes(uci) && isTourDelPorvenir(race.name));
  if (cat === 'uwt')    base = uci === '1.UWT' || uci === '2.UWT';
  if (cat === 'wwt')    base = uci === '1.WWT' || uci === '2.WWT';
  if (cat === 'male')   base = (gender === 'male' || isMixedRelayChampionship(race))
    && !['1.2','2.2'].includes(uci)
    && (!['1.2U','2.2U'].includes(uci) || isTourDelPorvenir(race.name));
  if (cat === 'female') base = (gender === 'female' || isMixedRelayChampionship(race))
    && (!['1.2U','2.2U'].includes(uci) || isTourDelPorvenir(race.name))
    && (uci !== '1.2' && uci !== '2.2' || EUROPE.has(cc));
  if (!base) return false;

  // Ocultar CC que no sean Campeonato de Europa (igual que applyAgendaFilters)
  if (uci === 'CC') {
    return /europa|europe/i.test(race.name || '');
  }
  return true;
}

/** Busca el siguiente día con carreras que coincidan con el filtro (escanea hasta 180 días). */
export function findNextDayWithRaces(afterDateKey, cat, yearRaces) {
  if (!yearRaces.length) return null;
  let [y, m, d] = afterDateKey.split('-').map(Number);
  for (let i = 0; i < 180; i++) {
    const dt = new Date(y, m - 1, d + 1 + i);
    const dk = toDateKey(dt);
    const hasMatch = yearRaces.some(race =>
      !race.isCancelled && isRaceDay(race, dk) && matchesCategoryFilter(race, cat)
    );
    if (hasMatch) return dk;
  }
  return null;
}

/** Busca el día anterior con carreras que coincidan con el filtro (escanea hasta 180 días). */
export function findPrevDayWithRaces(beforeDateKey, cat, yearRaces) {
  if (!yearRaces.length) return null;
  let [y, m, d] = beforeDateKey.split('-').map(Number);
  for (let i = 0; i < 180; i++) {
    const dt = new Date(y, m - 1, d - 1 - i);
    const dk = toDateKey(dt);
    const hasMatch = yearRaces.some(race =>
      !race.isCancelled && isRaceDay(race, dk) && matchesCategoryFilter(race, cat)
    );
    if (hasMatch) return dk;
  }
  return null;
}

export function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

/**
 * Jornadas de un día con su carrera, emisiones de la región y documentos, a partir de la lectura
 * (DAY_SELECT de js/app.js). `featured`: loadFeaturedRaces del día.
 */
export function prepareAgendaDays(rows, { dateKey, featured, filterBroadcasts }) {
  const raceDays = [];
  const raceMap = {};
  const bcastRows = [];
  const assetRows = [];
  const stageRows = [];
  for (const { race, broadcasts, assets, ...rd } of rows || []) {
    raceDays.push(rd);
    if (race) {
      const { race_uci_stages: stages, ...raceRow } = race;
      raceMap[raceRow.id] = raceRow;
      stageRows.push(...(stages || []));
    }
    bcastRows.push(...(broadcasts || []));
    assetRows.push(...(assets || []));
  }
  const raceIds = [...new Set(raceDays.map(rd => rd.raceId).filter(Boolean))];
  const rdIds = raceDays.map(rd => rd.id);
  const inhouseMatcher = buildInhouseResultsMatcher(stageRows);
  const bcastByRd = {};
  bcastRows.forEach(b => { (bcastByRd[b.raceDayId] = bcastByRd[b.raceDayId] || []).push(b); });
  const assetsByRd = {};
  assetRows.forEach(a => { (assetsByRd[a.raceDayId] = assetsByRd[a.raceDayId] || []).push(a); });
  raceDays.forEach(rd => {
    if (rd.raceId) rd._race = raceMap[rd.raceId] || {};
    const allBroadcasts = bcastByRd[rd.id] || [];
    rd._allBroadcasts = allBroadcasts;
    rd._broadcasts = filterBroadcasts(allBroadcasts);
    // Había TV pero ninguna emisión sobrevive al filtro regional → el usuario no
    // puede acceder a ninguna (badge de TV suprimido aunque tvStatus diga lo contrario).
    rd._tvBlocked = allBroadcasts.length > 0 && rd._broadcasts.length === 0;
    rd._assets = assetsByRd[rd.id] || [];
    rd._hasInhouse = !rd.isCancelledDay && inhouseMatcher.has(rd);
    rd._featured = featured?.get(dateKey)?.has(rd.raceId) || false;
  });
  // Detectar dobles sectores (misma carrera, mismo día, mismo stageNumber).
  annotateDoubleSectors(raceDays);
  return { raceDays, races: Object.values(raceMap), bcastRows, assetRows, stageRows, raceIds, rdIds };
}

/** Carreras en curso sin jornada publicada ese día. */
export function agendaPlaceholders(activeRaces, raceDays, dateKey) {
  // IDs de carreras que ya tienen jornada publicada ese día
  const coveredIds = new Set(raceDays.map(rd => rd.raceId).filter(Boolean));
  const currentYear = parseInt(dateKey.slice(0, 4));
  const placeholders = [];
  for (const race of (activeRaces || [])) {
    if ((race.year || 0) !== currentYear) continue;
    if (coveredIds.has(race.id)) continue;
    if (race.isCancelled) continue;
    if (!isRaceDay(race, dateKey)) continue;
    placeholders.push({ ...race, _dateKey: dateKey });
  }
  return placeholders;
}
