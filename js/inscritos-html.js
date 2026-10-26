// ─────────────────────────────────────────────────────────────────
//  INSCRITOS — HTML de la lista de equipos y corredores, sin DOM
//  Lo usan js/inscritos.js (pintado en el navegador) y el paso de build que
//  escribe las páginas de inscritos (tools/site/prerender-inscritos.mjs). El
//  marcado no puede depender del dispositivo, del ancho de pantalla, de
//  localStorage ni del momento de carga: el navegador compara su huella con
//  la del HTML del build (js/html-fingerprint.js).
// ─────────────────────────────────────────────────────────────────

import { teamHeaderColors } from './team-appearance.js';
import { esc, buildRaceHeader, buildActionButtons, isNoTeamPlaceholderTeam } from './shared.js';
import { flagIconUrl } from './flag-url.js';
import { t, getLang } from './i18n.js';
import { startlistHeroInfo } from './startlist/data.js';

const PDF_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/** Contenido del botón de descarga del PDF (también al restaurarlo tras generar). */
export function pdfButtonInner() {
  return `${PDF_ICON}${t('startlist.downloadPdf')}`;
}

const CONFIRMED_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect width="18" height="18" rx="4" fill="var(--accent)"/><path d="M5 9.5L7.5 12L13 6.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PENDING_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect width="18" height="18" rx="4" fill="#6b7280"/><path d="M6 6L12 12M12 6L6 12" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>';

// Fila de corredor. La bandera toma el tamaño de `.startlist-rider__flag img`
// (css/app.css) en lugar del estilo en línea de countryFlag(): una lista
// grande lleva ~180 filas.
function riderHtml(r, riderOutMap) {
  const code = r.countryCode ? r.countryCode.toLowerCase() : '';
  const flag = code ? `<span class="startlist-rider__flag"><img src="${flagIconUrl(code)}" alt="${code}"></span>` : '';
  // Fuera de carrera: si tiene globalRiderId y está en el mapa de abandonos.
  // El atributo lleva "irm|stageNumber" (stageNumber vacío en one-day) para
  // que el tooltip muestre el motivo ("ABN · etapa 2"). La clase --out tacha.
  const out = r.globalRiderId ? riderOutMap.get(r.globalRiderId) : null;
  const dnfAttr = out
    ? ` data-rider-dnf="${esc(`${out.irm}|${out.stageNumber == null ? '' : out.stageNumber}`)}"`
    : '';
  return `<div class="startlist-rider${out ? ' startlist-rider--out' : ''}"${dnfAttr}>`
    + `<span class="startlist-rider__dorsal">${r.dorsal || ''}</span>${flag}`
    + `<span class="startlist-rider__name">${esc(r.firstName)} ${esc(r.lastName)}</span></div>`;
}

function teamHtml(race, team, data) {
  // Estado sin equipo → ocultación cosmética: los corredores se listan, pero
  // la tarjeta va SIN cabecera de equipo (ni nombre, ni chapa).
  let header = '';
  if (!isNoTeamPlaceholderTeam(team)) {
    const gTeam = team.teamId ? data.globalTeamById[team.teamId] : null;
    const colors = teamHeaderColors(gTeam);
    // Nombre del equipo como texto plano (las fichas públicas de equipo se retiraron).
    const confirm = race.startlistProvisional
      ? `<span class="startlist-team__confirm${team.isConfirmed ? ' startlist-team__confirm--yes' : ''}" title="${team.isConfirmed ? 'Confirmado' : 'Pendiente de confirmar'}">${team.isConfirmed ? CONFIRMED_ICON : PENDING_ICON}</span>`
      : '';
    header = `<div class="startlist-team__header${gTeam ? ' startlist-team__header--enriched' : ''}" style="background:${colors.background};color:${colors.text}">`
      + `<span class="startlist-team__name">${esc(team.displayName)}</span>${confirm}</div>`;
  }
  const riders = (data.ridersByTeam[team.id] || []).map(r => riderHtml(r, data.riderOutMap)).join('');
  return `<div class="startlist-team">${header}<div class="startlist-team__riders">${riders}</div></div>`;
}

/**
 * HTML de #inscritosContent / #startlistContent. `data`: prepareStartlistData()
 * (js/startlist/data.js). En carreras de un día, `oneDayRd` (su jornada) y
 * `assets` (sus documentos y la guía técnica, withRaceTechnicalGuide) dan los
 * botones del recorrido; en vueltas por etapas, solo la guía técnica.
 */
export function inscritosHtml(race, data, { oneDayRd = null, assets = [] } = {}) {
  const isEn = getLang() === 'en';
  const { heroLabel, infoParts } = startlistHeroInfo(race, data.raceDays);
  // Panel de botones (web oficial · "Ir a la carrera" · recorrido en un día),
  // fuente única en shared.buildActionButtons. En vueltas por etapas solo salen
  // web oficial + "Ir a la carrera"; en un día, todo el recorrido de la jornada.
  const actionButtonsHtml = buildActionButtons({
    race,
    rd: oneDayRd || { id: race.id, slug: race.slug, slugEn: race.slugEn },
    view: 'inscritos',
    assets,
    hasStartlist: false,
    style: 'margin:0 auto 0.85rem', standalone: true,
  });
  const pdfAction = `<button class="btn-ical" id="btnDescargarPdf">${pdfButtonInner()}</button>`;
  // Sin equipos reales no se muestra "0 equipos": solo el total de corredores.
  const { totalTeams, totalRiders } = data;
  const ridersWord = isEn ? 'riders' : (race.gender === 'female' ? 'corredoras' : 'corredores');
  const statsLine = totalTeams > 0
    ? `${totalTeams} ${isEn ? 'teams' : 'equipos'} · ${totalRiders} ${ridersWord}`
    : `${totalRiders} ${ridersWord}`;
  const provisional = race.startlistProvisional
    ? `<div class="startlist-toolbar"><span class="startlist-disclaimer startlist-disclaimer--provisional">${isEn
      ? '<strong>Provisional Startlist</strong>; not considered final until the team managers meeting. This notice will disappear once it is official.'
      : '<strong>Lista provisional</strong>; no se considera definitiva hasta la reunión de directores. Esta indicación desaparecerá cuando sea oficial.'}</span></div>`
    : '';
  return buildRaceHeader({ race, label: heroLabel, detail: infoParts, stats: statsLine, action: pdfAction })
    + actionButtonsHtml + provisional
    + `<div class="startlist-grid">${data.teams.map(team => teamHtml(race, team, data)).join('')}</div>`;
}
