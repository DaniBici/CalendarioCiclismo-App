// Trozo del mapa: el mismo montaje de js/mapa-pub.js, con los datos publicados de la página.
import { mountRouteMap } from '../../../js/route-map.js';
import { initI18n, getLang } from '../../../js/i18n.js';

export async function montar(host, { rd, race }) {
  await initI18n();
  mountRouteMap(host, {
    gpxUrl: rd.routeGpxUrl, distanceKm: rd.distanceKm, colorHex: race?.colorHex,
    elevationProfile: rd.elevationProfile, summits: rd.profileSummits ?? [], waypoints: rd.profileWaypoints ?? [],
    primaryType: rd.primaryType, lang: getLang() === 'en' ? 'en' : 'es',
  });
}
