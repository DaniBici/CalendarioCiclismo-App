// ─────────────────────────────────────────────────────────────────
//  ORDEN DE SALIDA — HTML del contenido de /orden-salida/, sin DOM
//  Lo usan js/orden-salida.js (pintado en el navegador) y el paso de build
//  tools/site/prerender-auxiliares.mjs. Misma regla de marcado que
//  js/jornada-html.js: las horas dependen de la zona del visitante (el build
//  ES las pinta en Europe/Madrid) y nada más del dispositivo, del ancho, de
//  localStorage ni del momento de carga; decimales con tablas fijas.
// ─────────────────────────────────────────────────────────────────

import { esc, jornadaUrl, raceName as getRaceName, findMatchingTeam, buildRaceHeader,
         buildActionButtons } from './shared.js';
import { getLang } from './i18n.js';
import { fixedDecimal } from './fixed-number.js';
import { flagIconUrl } from './flag-url.js';
import { stageContextHtml } from './stage/context.js';
import { stageProfileHtml } from './stage/profile.js';
import { teamStripes, splitStartlistTeams } from './team-appearance.js';
import { localizedTeamName } from './services/national-team-name.js';
import { startOrderConversion } from './orden-salida-zona.js';

export const STAGE_TYPE_LABELS = {
  itt: { es: 'CRI', en: 'ITT' },
  ttt: { es: 'CRE', en: 'TTT' },
};

/** Aviso de la jornada sin filas de orden de salida. */
export function ordenSalidaEmptyHtml() {
  return `<div class="startlist-empty">${getLang() === 'en' ? 'No start order data available for this stage.' : 'No hay datos de orden de salida para esta jornada.'}</div>`;
}

const visitorTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

/**
 * HTML de #startOrderContent y si lleva los filtros Todos/Contrarrelojistas/
 * General. `entries`: filas de start_order_entries_resolved por sortOrder e
 * id; `startlistRows`: respuesta de startlistTeamsQuery (por id); `assets`:
 * documentos de la jornada con la guía técnica. Las horas se convierten a la
 * zona del visitante (`userTz`) si difiere de la de la jornada; el panel del
 * perfil lleva el gráfico vacío que dibuja mountStageProfile sobre #soProfile.
 */
export function ordenSalidaHtml({ rd, race, entries, startlistRows = [], assets = [], userTz = visitorTimeZone() }) {
  const _isEn = getLang() === 'en';
  const raceTeams = splitStartlistTeams(startlistRows, race?.year).teams;
  // Equipo por nombre, una búsqueda por nombre distinto (hasta ~190 filas).
  const teamsByName = new Map();
  const teamFor = teamName => {
    if (!teamName) return null;
    if (!teamsByName.has(teamName)) teamsByName.set(teamName, findMatchingTeam(teamName, raceTeams));
    return teamsByName.get(teamName);
  };

  // CRE (contrarreloj por equipos): salen equipos, no corredores. La vista
  // muestra solo Salida + Equipo (sin dorsal, sin bandera, sin corredor) y sin
  // los filtros Contrarrelojistas/General (que se basan en dorsales de corredor).
  const isTtt = rd.primaryType === 'ttt';
  const ttDorsals = new Set(rd.startOrderTtDorsals || []);
  const gcDorsals = new Set(rd.startOrderGcDorsals || []);
  const hasFilters = !isTtt && (ttDorsals.size > 0 || gcDorsals.size > 0);

  const raceName = getRaceName(race) || '';
  const year = race?.year || '';
  const stageLabel = rd.stageNumber === 0
    ? (_isEn ? 'Prologue' : 'Prólogo')
    : rd.stageNumber != null
      ? (_isEn ? `Stage ${rd.stageNumber}` : `Etapa ${rd.stageNumber}`)
      : '';
  const typeEntry = STAGE_TYPE_LABELS[rd.primaryType];
  const typeLabel = typeEntry ? typeEntry[_isEn ? 'en' : 'es'] : (_isEn ? 'Time trial' : 'Contrarreloj');
  const startLoc = (_isEn ? rd.startLocationEn : null) || rd.startLocation;
  const distLabel = rd.distanceKm ? `${fixedDecimal(rd.distanceKm, { lang: _isEn ? 'en' : 'es' })} km` : '';
  const heroSubline = [stageLabel, typeLabel, distLabel].filter(Boolean).join(' · ');
  const ridersLabel = isTtt ? (_isEn ? 'teams' : 'equipos') : (_isEn ? 'riders' : 'corredores');

  let html = buildRaceHeader({
    race,
    nameHref: jornadaUrl(rd),
    label: _isEn ? 'Start order' : 'Orden de salida',
    detail: heroSubline,
    stats: `${entries.length} ${ridersLabel}`,
  }) + buildActionButtons({
    race, rd, view: 'startOrder', assets,
    hasStartlist: !!race.startlistImportedAt,
    style: 'margin:0 auto 0.85rem', standalone: true,
  }) + `<div class="res-layout res-layout--context"><div class="res-main">
    ${hasFilters ? `
    <div class="so-filters" id="soFilters">
      <div class="so-filters__inner">
        <button type="button" class="tcat-btn tcat-btn--active" aria-pressed="true" data-filter="all">${_isEn ? 'All' : 'Todos'}</button>
        ${ttDorsals.size > 0 ? `<button type="button" class="tcat-btn" aria-pressed="false" data-filter="tt">${_isEn ? 'TT Specialists' : 'Contrarrelojistas'}</button>` : ''}
        ${gcDorsals.size > 0 ? `<button type="button" class="tcat-btn" aria-pressed="false" data-filter="gc">${_isEn ? 'GC' : 'General'}</button>` : ''}
      </div>
    </div>` : ''}`;

  // ── Conversión a hora del usuario (si la jornada tiene timezone) ──
  const raceTz = rd.timezone || null;
  // Fecha de referencia para la conversión: `dateKey` es el campo canónico y
  // NUNCA es null; `date` es legacy y puede faltar (rompía la conversión → se
  // mostraba la hora cruda sin pasar a la zona del usuario).
  const rdDate = rd.dateKey || rd.date;
  const locName = startLoc || (raceTz ? raceTz.split('/').pop().replace(/_/g, ' ') : '');
  const conversion = startOrderConversion({ rdDate, raceTz, userTz, firstTime: entries[0]?.startTime, place: locName, isEn: _isEn });
  if (conversion) html += conversion.noteHtml();

  html += `
    <div class="so-table-wrap">
      <table class="so-table res-table${isTtt ? ' so-table--teams' : ''}">
        <thead>
          <tr>
            <th class="so-th so-th--time">${_isEn ? 'Start' : 'Salida'}</th>
            ${isTtt ? '' : `<th class="so-th so-th--dorsal">${_isEn ? 'Bib' : 'Dor.'}</th>
            <th class="so-th so-th--rider">${_isEn ? 'Rider' : 'Corredor'}</th>`}
            <th class="so-th so-th--team">${_isEn ? 'Team' : 'Equipo'}</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Enlaces a fichas retirados: equipos y corredores se muestran como texto.
  // Filas sin sangrado y bandera sin estilo en línea (tamaño en
  // `.so-flag > img`, css/app.css), diferida: una CRI lleva hasta ~190 filas y
  // sus banderas competirían con el CSS y el JS al cargar la página.
  entries.forEach(e => {
    const code = String(e.countryCode || '').toLowerCase();
    const flagHtml = code ? `<span class="so-flag"><img src="${flagIconUrl(code)}" alt="${esc(code)}" loading="lazy"></span>` : '';
    const name = e.riderName ? esc(e.riderName) : `<span style="opacity:0.45">-</span>`;
    // El casado usa el nombre de la vista; solo el texto visible se traduce.
    const teamObj = teamFor(e.teamName);
    const teamLabel = e.teamName ? localizedTeamName(e.teamName, teamObj, _isEn) : '';
    const team = teamLabel ? `${teamStripes(teamObj)}${esc(teamLabel)}` : '';
    const isTt = ttDorsals.has(e.dorsal);
    const isGc = gcDorsals.has(e.dorsal);

    const timeCell = conversion ? conversion.cellHtml(e.startTime) : esc(e.startTime);

    if (isTtt) {
      // CRE: solo hora + equipo (sin dorsal, sin bandera, sin corredor).
      html += `<tr class="so-row"><td class="so-td so-td--time">${timeCell}</td>`
        + `<td class="so-td so-td--team">${e.teamName ? team : `<span style="opacity:0.45">-</span>`}</td></tr>`;
    } else {
      html += `<tr class="so-row"${isTt ? ' data-is-tt="1"' : ''}${isGc ? ' data-is-gc="1"' : ''}><td class="so-td so-td--time">${timeCell}</td>`
        + `<td class="so-td so-td--dorsal">${e.dorsal}</td><td class="so-td so-td--rider">${flagHtml}${name}</td>`
        + `<td class="so-td so-td--team"${teamLabel ? ` title="${esc(teamLabel)}"` : ''}>${team}</td></tr>`;
    }
  });

  html += `
        </tbody>
      </table>
    </div>
    </div>${stageContextHtml(rd, 'soProfile', { hideNeutralStart: true, profile: stageProfileHtml(rd, race, assets) })}</div>
  `;
  return { html, hasFilters };
}
