import { esc, formatTimeUser, rdLocation } from '../shared.js';
import { getLang } from '../i18n.js';
import { fixedDecimal } from '../fixed-number.js';
import { formatDurationSeconds, hasValidTimeLimit } from '../services/race-presentation.js';

// Datos compartidos por Resultados y Orden de Salida, incluidos sus refrescos.
// Sin DOM: el build escribe el mismo HTML que el navegador (decimales con
// tablas fijas, js/fixed-number.js; hora de salida en la zona del proceso).
export function stageMetricsHtml(day, { hideNeutralStart = false } = {}) {
  const en = getLang() === 'en';
  const lang = en ? 'en' : 'es';
  // Mismo formato que el resto de la web: decimales del idioma y desnivel
  // positivo redondeado a la decena, con millares también con cuatro cifras.
  const gain = day.elevationProfile?.elevationGain;
  const start = rdLocation(day, 'startLocation');
  const finish = rdLocation(day, 'finishLocation');
  const sameStartFinish = !finish || finish === start;
  const route = start && sameStartFinish
    ? [[en ? 'Start and finish' : 'Salida y llegada', start]]
    : [start ? [en ? 'Start' : 'Salida', start] : null, finish ? [en ? 'Finish' : 'Llegada', finish] : null];
  const neutralStart = day.neutralStartTimeUtc && !hideNeutralStart ? formatTimeUser(day.neutralStartTimeUtc)?.display : null;
  const metrics = [
    ...route,
    day.distanceKm ? [en ? 'Distance' : 'Distancia', `${fixedDecimal(day.distanceKm, { lang })} km`] : null,
    gain != null ? [en ? 'Elevation gain' : 'Desnivel', `+${fixedDecimal(Math.round(gain / 10) * 10, { lang, useGrouping: 'always' })} m`] : null,
    neutralStart ? [en ? 'Neutral start' : 'Salida neutralizada', neutralStart, day.neutralStartTimeUtc] : null,
    Number(day.averageSpeedKmh) > 0 ? [en ? 'Average speed' : 'Velocidad media', `${fixedDecimal(day.averageSpeedKmh, { lang, maximumFractionDigits: 2 })} km/h`] : null,
    hasValidTimeLimit(day) ? [en ? 'Time limit' : 'Fuera de control', formatDurationSeconds(day.timeLimitSeconds)] : null,
  ].filter(Boolean);
  return metrics.map(([label, value, datetime]) => `<div><dt>${label}</dt><dd>${datetime ? `<time datetime="${esc(datetime)}">${esc(value)}</time>` : esc(value)}</dd></div>`).join('');
}

/**
 * Columna lateral: perfil (`profileId`) y datos de la jornada. `profile`
 * (stageProfileHtml()) escribe el panel del perfil con el gráfico vacío, que
 * mountStageProfile dibuja después; sin él, el contenedor queda vacío. Con
 * `metrics: false`, la lista de datos queda vacía para rellenarla aparte
 * (resultados: depende de la zona del visitante).
 */
export function stageContextHtml(day, profileId, { profile = undefined, metrics = true, ...options } = {}) {
  const host = profile === undefined ? `<div id="${esc(profileId)}"></div>`
    : profile ? `<div id="${esc(profileId)}" class="${esc(profile.className)}">${profile.html}</div>`
    : `<div id="${esc(profileId)}" hidden></div>`;
  return `<aside class="res-context">${host}<section class="res-stage-data"><h2>${getLang() === 'en' ? 'Stage data' : 'Datos de la jornada'}</h2><dl>${metrics ? stageMetricsHtml(day, options) : ''}</dl></section></aside>`;
}
