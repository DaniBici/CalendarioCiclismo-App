// ─────────────────────────────────────────────────────────────────
//  BUSCA DORSAL — panel de la tarjeta de Hoy con la jornada en curso
//  Se teclea un dorsal y el corredor aparece sin confirmar. Los datos son los
//  de la página de inscritos (js/startlist/data.js), leídos al abrir el panel
//  y conservados mientras dure la página. js/app.js lo carga al pulsar.
// ─────────────────────────────────────────────────────────────────
import { esc, startlistUrl, isNoTeamPlaceholderTeam } from './shared.js';
import { t, getLang } from './i18n.js';
import { flagIconUrl } from './flag-url.js';
import { teamStripes } from './team-appearance.js';
import { loadStartlistData } from './startlist/data.js';
import { irmLabel } from './results/uci-irm.js';
import { startlistIconHtml } from './services/race-presentation.js';

const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const loads = new Map();   // raceId → promesa del índice de dorsales
let panel = null;
let anchor = null;

// Índice por dorsal de los corredores con número, con su equipo de la lista.
function bibIndex(data) {
  const teamById = new Map(data.teams.map(team => [team.id, team]));
  const byBib = new Map();
  for (const rider of data.riders) {
    if (rider.dorsal > 0 && !byBib.has(rider.dorsal)) byBib.set(rider.dorsal, rider);
  }
  return { data, teamById, byBib, bibs: [...byBib.keys()].sort((a, b) => a - b) };
}

function loadIndex(race) {
  if (!loads.has(race.id)) {
    const load = loadStartlistData(race).then(data => {
      if (!data) throw new Error('startlist');
      return bibIndex(data);
    });
    load.catch(() => loads.delete(race.id));
    loads.set(race.id, load);
  }
  return loads.get(race.id);
}

function outText(out) {
  const label = irmLabel(out.irm, getLang()) || out.irm;
  if (out.stageNumber == null) return t('startlist.dnfReason', { label });
  return Number(out.stageNumber) === 0
    ? t('startlist.dnfReasonPrologue', { label })
    : t('startlist.dnfReasonStage', { label, n: out.stageNumber });
}

const flagHtml = rider => {
  const code = rider.countryCode ? rider.countryCode.toLowerCase() : '';
  return code ? `<span class="startlist-rider__flag"><img src="${flagIconUrl(code)}" alt="${esc(code)}"></span>` : '';
};
const outOf = (index, rider) => (rider.globalRiderId ? index.data.riderOutMap.get(rider.globalRiderId) : null) || null;

function rowHtml(index, rider) {
  return `<div class="startlist-rider${outOf(index, rider) ? ' startlist-rider--out' : ''}">`
    + `<span class="startlist-rider__dorsal">${rider.dorsal}</span>${flagHtml(rider)}`
    + `<span class="startlist-rider__name">${esc(rider.firstName)} ${esc(rider.lastName)}</span></div>`;
}

function resultHtml(index, race, query) {
  if (!query) return `<p class="bib-search__note">${esc(t('startlist.bibHint'))}</p>`;
  const bib = Number(query);
  const rider = index.byBib.get(bib);
  if (!rider) {
    const near = index.bibs.filter(n => String(n).startsWith(query)).slice(0, 6);
    return `<p class="bib-search__note">${esc(t('startlist.bibNone', { n: bib }))}</p>`
      + near.map(n => rowHtml(index, index.byBib.get(n))).join('');
  }
  const team = index.teamById.get(rider.teamId);
  const out = outOf(index, rider);
  const global = team?.teamId ? index.data.globalTeamById[team.teamId] : null;
  const teamHtml = team && !isNoTeamPlaceholderTeam(team)
    ? `<div class="bib-search__team">${teamStripes(global)}${esc(team.displayName)}</div>` : '';
  const mates = (index.data.ridersByTeam[rider.teamId] || []).filter(r => r !== rider && r.dorsal > 0);
  const matesHtml = teamHtml && mates.length
    ? `<div class="bib-search__mates-title">${esc(t(race.gender === 'female' ? 'startlist.bibMatesFemale' : 'startlist.bibMates'))}</div>`
      + mates.map(r => rowHtml(index, r)).join('')
    : '';
  return `<div class="bib-search__hit${out ? ' bib-search__hit--out' : ''}">`
    + `<span class="bib-search__bib">${rider.dorsal}</span>`
    + `<div class="bib-search__who"><div class="bib-search__name">${flagHtml(rider)}<span>${esc(rider.firstName)} ${esc(rider.lastName)}</span></div>`
    + `${teamHtml}${out ? `<div class="bib-search__out">${esc(outText(out))}</div>` : ''}</div></div>${matesHtml}`;
}

function place() {
  if (!panel || !anchor?.isConnected) return;
  const r = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  panel.style.left = `${left + window.scrollX}px`;
  panel.style.top = `${r.bottom + 6 + window.scrollY}px`;
}

function close() {
  if (!panel) return;
  const node = panel;
  panel = null;
  anchor?.setAttribute('aria-expanded', 'false');
  anchor = null;
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', place);
  node.remove();
}

function onOutside(event) {
  if (panel && !panel.contains(event.target) && !event.target.closest?.('[data-bib-search]')) close();
}

/** Abre el panel bajo la etiqueta pulsada; otra pulsación lo cierra. */
export function toggleBibSearch(button, race) {
  const reopen = anchor !== button;
  close();
  if (!reopen) return;
  anchor = button;
  button.setAttribute('aria-expanded', 'true');
  const label = t('stage.bibSearch');
  panel = document.createElement('div');
  panel.className = 'bib-search';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  if (supportsPopover) panel.setAttribute('popover', 'manual');
  panel.innerHTML = `<div class="bib-search__head"><span class="bib-search__title">${esc(label)}</span>`
    + `<a class="bib-search__all" href="${esc(startlistUrl(race))}">${esc(t('startlist.bibFullList'))}</a></div>`
    + `<label class="bib-search__field">${startlistIconHtml}`
    + `<input class="bib-search__input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" aria-label="${esc(t('startlist.bibNumber'))}"></label>`
    + `<div class="bib-search__result" aria-live="polite"><p class="bib-search__note">${esc(t('startlist.bibHint'))}</p></div>`;
  document.body.appendChild(panel);
  if (supportsPopover) panel.showPopover();
  place();
  const input = panel.querySelector('.bib-search__input');
  const result = panel.querySelector('.bib-search__result');
  const node = panel;
  let index = null;
  const paint = () => {
    input.value = input.value.replace(/\D/g, '').replace(/^0+/, '');
    if (index) result.innerHTML = resultHtml(index, race, input.value);
  };
  input.addEventListener('input', paint);
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    button.focus();
    close();
  });
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', place);
  input.focus({ preventScroll: true });
  loadIndex(race).then(loaded => {
    if (panel !== node) return;
    index = loaded;
    paint();
  }, () => {
    if (panel === node) result.innerHTML = `<p class="bib-search__note">${esc(t('startlist.bibError'))}</p>`;
  });
}
