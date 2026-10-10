import { esc, formatTimeUser, rdLocation } from '../shared.js';
import { getLang } from '../i18n.js';
import { formatDurationSeconds, hasValidTimeLimit } from '../services/race-presentation.js';

// Datos compartidos por Resultados y Orden de Salida, incluidos sus refrescos.
export function stageMetricsHtml(day, { hideNeutralStart = false } = {}) {
  const en = getLang() === 'en';
  const locale = en ? 'en-GB' : 'es-ES';
  // Mismo formato que el resto de la web: decimales del idioma y desnivel
  // positivo redondeado a la decena, con millares también con cuatro cifras.
  const gain = day.elevationProfile?.elevationGain;
  const start = rdLocation(day, 'startLocation');
  const finish = rdLocation(day, 'finishLocation');
  const sameStartFinish = !finish || finish === start;
  const route = start && sameStartFinish
    ? [[en ? 'Start and finish' : 'Salida y llegada', start]]
    : [start ? [en ? 'Start' : 'Salida', start] : null, finish ? [en ? 'Finish' : 'Llegada', finish] : null];
  const metrics = [
    ...route,
    day.distanceKm ? [en ? 'Distance' : 'Distancia', `${Number(day.distanceKm).toLocaleString(locale)} km`] : null,
    gain != null ? [en ? 'Elevation gain' : 'Desnivel', `+${(Math.round(gain / 10) * 10).toLocaleString(locale, { useGrouping: 'always' })} m`] : null,
    day.neutralStartTimeUtc && !hideNeutralStart ? [en ? 'Neutral start' : 'Salida neutralizada', formatTimeUser(day.neutralStartTimeUtc)?.display] : null,
    Number(day.averageSpeedKmh) > 0 ? [en ? 'Average speed' : 'Velocidad media', `${Number(day.averageSpeedKmh).toLocaleString(en ? 'en-GB' : 'es-ES', { maximumFractionDigits: 2 })} km/h`] : null,
    hasValidTimeLimit(day) ? [en ? 'Time limit' : 'Fuera de control', formatDurationSeconds(day.timeLimitSeconds)] : null,
  ].filter(Boolean);
  return metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('');
}

export function stageContextHtml(day, profileId, options) {
  return `<aside class="res-context"><div id="${esc(profileId)}"></div><section class="res-stage-data"><h2>${getLang() === 'en' ? 'Stage data' : 'Datos de la jornada'}</h2><dl>${stageMetricsHtml(day, options)}</dl></section></aside>`;
}
