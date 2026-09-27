import { cxDateInSeason } from './cx-season.js';

/** @type {readonly ['general', 'race_start', 'tv_start', 'results', 'cyclocross']} */
export const CX_PUSH_CATEGORIES = ['general', 'race_start', 'tv_start', 'results', 'cyclocross'];
const categories = ['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
const validAnchor = value => value === 'general' || categories.some(code => [code, `inscritos-${code}`, `general-${code}`].includes(value));

/**
 * Resuelve destinos CX sin interpretar IDs de carretera como carreras CX.
 * @param {{category: typeof CX_PUSH_CATEGORIES[number], deepLink?: unknown, cxRaceId?: unknown, raceId?: unknown, raceDayId?: unknown}} input
 * @returns {{category: typeof CX_PUSH_CATEGORIES[number], deepLink?: string, cxRaceId?: string}}
 */
export function resolveCxPushTarget(input) {
  if (input.deepLink != null && typeof input.deepLink !== 'string') throw new Error('El deep link debe ser texto.');
  let deepLink = typeof input.deepLink === 'string' ? input.deepLink : undefined;
  let cxRaceId;
  if (deepLink?.startsWith('cxRace/')) {
    const parts = deepLink.slice(7).split('#');
    if (!validId(parts[0]) || parts.length > 2 || (parts.length === 2 && !validAnchor(parts[1]))) throw new Error('Destino CX inválido.');
    cxRaceId = parts[0];
  }
  if (input.cxRaceId != null) {
    if (!validId(input.cxRaceId)) throw new Error('Identificador CX inválido.');
    if (cxRaceId && cxRaceId !== input.cxRaceId) throw new Error('El destino y la carrera CX no coinciden.');
    if (deepLink && !cxRaceId) throw new Error('La carrera CX requiere su propio destino.');
    cxRaceId = String(input.cxRaceId);
    deepLink ||= `cxRace/${cxRaceId}`;
  }
  if (cxRaceId || deepLink === 'cyclocross' || input.category === 'cyclocross') {
    if (input.raceId != null || input.raceDayId != null) throw new Error('El destino CX no admite IDs de carretera.');
    if (!['general', 'cyclocross'].includes(input.category)) throw new Error('La carrera CX requiere la categoría cyclocross.');
    if (deepLink && !cxRaceId && deepLink !== 'cyclocross') throw new Error('La categoría cyclocross requiere un destino CX.');
    deepLink ||= 'cyclocross';
    return { category: 'cyclocross', deepLink, cxRaceId };
  }
  return { category: input.category, deepLink };
}

/** @param {{seasonKey: string, dateKey: string, endDateKey?: string | null, editorialStatus: string, isCancelled: boolean} | null} race */
export function cxPushRaceAvailable(race) {
  if (!race || race.editorialStatus !== 'published' || race.isCancelled) return false;
  try { return cxDateInSeason(race.seasonKey, race.dateKey) && (!race.endDateKey || cxDateInSeason(race.seasonKey, race.endDateKey)); }
  catch { return false; }
}

/**
 * Consulta común al emisor y al recuento del panel, paginable por dispositivo.
 * @param {any} client
 * @param {{cxRaceId?: string, regions?: string[], platforms?: string[], countryGroups?: string[], languages?: string[]}} target
 * @param {{count?: 'exact', head?: boolean}} options
 * @returns {any}
 */
export function cxPushSubscriberQuery(client, target, options = {}) {
  const columns = 'deviceToken,platform,push_subscription_categories!inner(category)' +
    (target.cxRaceId ? ',push_cx_race_subscriptions!inner(raceId)' : '');
  let query = client.from('push_subscriptions').select(columns, options)
    .eq('isActive', true).eq('push_subscription_categories.category', 'cyclocross');
  if (target.cxRaceId) query = query.eq('push_cx_race_subscriptions.raceId', target.cxRaceId);
  if (target.regions?.length) query = query.in('region', target.regions);
  if (target.platforms?.length) query = query.in('platform', target.platforms);
  if (target.countryGroups?.length) query = query.in('countryGroup', target.countryGroups);
  if (target.languages?.length) query = query.in('language', target.languages);
  return query;
}

export const cxPushAudienceLabel = cxRaceId => cxRaceId
  ? 'Dispositivos con avisos de Ciclocross activos que siguen esta carrera.'
  : 'Dispositivos con avisos de Ciclocross activos.';
