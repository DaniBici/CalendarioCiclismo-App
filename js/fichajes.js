// ─────────────────────────────────────────────────────────────────
//  FICHAJES — /fichajes/ (+ EN /en/transfers/)
//  Mercado de fichajes de la temporada 2027 (tabla rider_transfers, mig. 122).
//
//  Estructura de la página (dos vistas, interruptor Mercado | Equipos):
//   MERCADO
//   1. Filtros (categoría, división, rango de edad, duración de contrato):
//      chips que empiezan TODOS activos; dentro de un grupo es OR y entre
//      grupos AND. Un grupo con todos sus chips activos no filtra (así siguen
//      visibles los movimientos con un dato desconocido).
//   2. Dos columnas de CONFIRMACIONES en orden cronológico inverso (fichajes y
//      renovaciones; los rumores y las dudas NO aparecen aquí). Un movimiento
//      con la fecha oculta (dateVisible=false, mig. 123) tampoco: la carga
//      inicial mete de golpe anuncios de hace semanas que poblarían el feed de
//      días viejos.
//   EQUIPOS
//   3. Botones de división (WT · PT · WWT · PRW) + losetas de equipos 2027.
//      Los equipos salen de team_seasons[2027] → los renombres de sponsor y
//      los ascensos/descensos se editan en el panel sin tocar `teams`.
//      La loseta usa los colores 2027 (headerBg/headerText) si
//      team_seasons.badgeVisible; si aún no (kit 2027 sin anunciar), los
//      ANTIGUOS del equipo (temporada en curso, 2026) — o los neutros si es un
//      equipo NUEVO nacido en 2027 (sin fila 2026, mig. 129). continuityDoubt →
//      chip + aviso (el equipo mismo puede no tener sponsor para 2027).
//   4. Vista de equipo (sustituye al listado, con volver): plantilla / en duda
//      / terminan contrato / llegan / se marchan. Regla del rumor (decisión
//      Dani): una salida rumoreada saca al corredor de la plantilla y lo pinta
//      como baja·Rumor (y como alta·Rumor en el destino). Regla de la duda: una
//      renovación en duda (status='doubt', solo en renewal) lo saca también de
//      la plantilla y lo lleva a su propia sección.
//
//  La portada (interruptor, filtros, feed y losetas de equipo) sale de
//  js/fichajes-html.js, común con el build: tools/site/prerender-fichajes.mjs
//  la escribe en el HTML y aquí se conserva si su huella coincide
//  (js/html-fingerprint.js).
//
//  Estado compartible por URL: ?vista=equipos (sin él, Mercado), ?div=WT|WWT|
//  PT|PRW y ?team=<slug> (bilingüe ES/EN; ?equipo= antiguo se sigue leyendo por
//  retrocompatibilidad), sin recarga. ?div= y ?team= implican la vista Equipos.
//  Abrir un equipo apila una entrada de historial (pushState) → el botón atrás
//  del navegador vuelve a la lista de equipos (o al equipo anterior), no a la
//  home global; el listener popstate sincroniza la vista con la URL. Cambiar de
//  vista o de división es replaceState (no apila). Los filtros viven solo en
//  memoria.
// ─────────────────────────────────────────────────────────────────

import { supabase } from './shared.js';
import { fetchAllRows, fetchAllRowsParallel, fetchByIds } from './services/paged-query.js';
import { staleWhileRevalidate, writeCache } from './services/local-cache.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';
import { patchHtml, slideIn } from './dom-patch.js';
import { t, initI18n } from './i18n.js';
import {
  SEASON, PREV_SEASON, DIVISIONS, DIVISION_GENDER, SEASON_COLUMNS, PREV_SEASON_COLUMNS, RIDER_COLUMNS, TEAM_COUNTRY_COLUMNS, UNKNOWN_DEST,
  FILTER_GROUPS, esc, riderName, marketRiderIds, marketExtraTeamIds, marketSeasonTeamIds, attachRiders, buildMarket, teamLabel,
  hasTeamView, teamHref, flagHtml, rumorLabel, doubtChip, contractBit, yearCell, arrowHtml, stripesFor, teamColorStyle,
  stripesBand, countryHtml, divisionName, newFilters, feedColumnsHtml, feedButtonsHtml, filtersHtml, divButtonsHtml,
  teamGridHtml, marketHomeHtml,
} from './fichajes-html.js';

const CACHE_KEY = `fichajes:${SEASON}`;

let _market = null;                 // buildMarket() de las lecturas (js/fichajes-html.js)
let _activeDiv = 'WT';
let _activeFeed = 'signings';
let _view = 'market';               // 'market' | 'teams' (interruptor Mercado | Equipos)
let _filters = newFilters();        // grupo → Set de valores activos
let _rosterCache = new Map();       // teamId → [{ ...ficha }]

const $ = (id) => document.getElementById(id);

// ── Carga inicial ─────────────────────────────────────────────────
// Lectura del mercado: temporadas 2027 y 2026, movimientos con su ficha y
// nombres de equipos fuera de ambas temporadas. Temporadas y movimientos se
// paginan con orden estable: la respuesta de PostgREST tiene un tope de filas.
// El resultado se guarda en la copia local (stale-while-revalidate). El build
// hace las mismas lecturas (tools/site/prerender-fichajes.mjs).
async function fetchMarket() {
  const [seasons, prevSeasons, transfers] = await Promise.all([
    fetchAllRows(() => supabase.from('team_seasons')
      .select(SEASON_COLUMNS)
      .eq('year', SEASON).order('teamId'), 1000),
    fetchAllRowsParallel(() => supabase.from('team_seasons')
      .select(PREV_SEASON_COLUMNS)
      .eq('year', PREV_SEASON).order('teamId')),
    fetchAllRows(() => supabase.from('rider_transfers')
      .select('*')
      .eq('season', SEASON)
      .order('announcedAt', { ascending: false })
      .order('createdAt', { ascending: false })
      .order('id'), 1000),
  ]);

  // Fichas (nombre + bandera) en bulk por género, en trozos paralelos.
  const menIds   = marketRiderIds(transfers, 'male');
  const womenIds = marketRiderIds(transfers, 'female');
  const refIds = marketExtraTeamIds(seasons, prevSeasons, transfers);
  // País de cada equipo del mercado para las losetas y el banner
  // (teams.countryCode, mig. 074): solo los equipos de la temporada.
  const seasonTeamIds = marketSeasonTeamIds(seasons);
  const [men, women, extraTeams, teamCountries] = await Promise.all([
    menIds.length ? fetchByIds(supabase, 'riders_men', RIDER_COLUMNS, 'id', menIds) : [],
    womenIds.length ? fetchByIds(supabase, 'riders_women', RIDER_COLUMNS, 'id', womenIds) : [],
    refIds.length ? fetchByIds(supabase, 'teams', 'id, name', 'id', refIds) : [],
    seasonTeamIds.length ? fetchByIds(supabase, 'teams', TEAM_COUNTRY_COLUMNS, 'id', seasonTeamIds) : [],
  ]);
  attachRiders(transfers, men, women);
  return { seasons, prevSeasons, transfers, extraTeams, teamCountries };
}

function applyMarket(market) {
  _market = buildMarket(market);
}

// Feed, botones, filtros y equipos se actualizan sobre lo pintado
// (js/dom-patch.js): con datos nuevos solo cambian las filas afectadas y los
// movimientos nuevos entran deslizándose; el botón pulsado conserva el foco.
const patchMarket = (el, html) => patchHtml(el, html, { enter: slideIn });

function renderFeed() {
  const box = $('trFeed');
  if (box) patchMarket(box, feedColumnsHtml(_market, _activeFeed, _filters));
}

function renderFeedButtons() {
  const box = $('trFeedBtns');
  if (box) patchHtml(box, feedButtonsHtml(_activeFeed));
}

// ── Panel de filtros ──────────────────────────────────────────────
// Los chips conservan su nodo al repintar (js/dom-patch.js), y con él el foco
// del teclado: solo cambia su estado.
function renderFilters() {
  const box = $('trFilters');
  if (box) patchHtml(box, filtersHtml(_filters));
}

function toggleFilter(groupKey, rawValue) {
  const g = FILTER_GROUPS.find(x => x.key === groupKey);
  const option = g?.options.find(o => String(o.value) === rawValue);
  if (!option) return;
  const active = _filters[groupKey];
  if (active.has(option.value)) active.delete(option.value); else active.add(option.value);
  // Un grupo nunca queda vacío: sin ninguna opción equivaldría a "todo oculto",
  // que no es un filtro útil → se vuelve a seleccionar todo el grupo.
  if (active.size === 0) g.options.forEach(o => active.add(o.value));
  renderFilters();
  renderFeed();
}

// ── Divisiones + lista de equipos ─────────────────────────────────
function renderTeams() {
  const btns = $('trDivBtns');
  const grid = $('trTeamGrid');
  if (!btns || !grid) return;
  patchHtml(btns, divButtonsHtml(_activeDiv));
  patchHtml(grid, teamGridHtml(_market, _activeDiv));
}

// ── Vista de equipo ───────────────────────────────────────────────
// "Continúan" = corredores que YA estaban en el equipo en la temporada en curso
// (currentTeamId = equipo) y siguen para el mercado — se materializan como una
// afiliación al año del mercado (year=SEASON) al marcarlos "continúa" en el
// panel. Los afiliados cuyo currentTeamId es OTRO equipo son fichajes (llegan de
// fuera): tienen afiliación pero NO continúan → los separa openTeam por origen.
// El año de contrato efectivo viene de la afiliación, no de riders_*.
async function loadRoster(teamId) {
  if (_rosterCache.has(teamId)) return _rosterCache.get(teamId);
  const season = _market.seasonsByTeamId.get(teamId);
  const gender = season?.gender || DIVISION_GENDER[season?.category] || null;

  const { data: affs, error: affErr } = await supabase.from('rider_team_affiliations')
    .select('riderId, riderGender, dateTo')
    .eq('affiliationType', 'regular')
    .eq('year', SEASON)
    .eq('teamId', teamId);
  if (affErr) throw affErr;
  const affRows = affs || [];
  if (affRows.length === 0) { _rosterCache.set(teamId, []); return []; }

  // Hidratar fichas por id (el riderGender de la afiliación decide la tabla; sin
  // él, el género del equipo). Se trae currentTeamId para distinguir continúa
  // (venía ya del equipo) de llegada (venía de fuera). El contrato = año de
  // dateTo de la afiliación (31-dic del año de fin), no riders_*.contractUntil.
  const cols = 'id, firstName, lastName, nationality, currentTeamId';
  const menIds = affRows.filter(a => (a.riderGender || gender) === 'male').map(a => a.riderId);
  const womenIds = affRows.filter(a => (a.riderGender || gender) === 'female').map(a => a.riderId);
  const [men, women] = await Promise.all([
    menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
    womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
  ]);
  const affYear = (d) => { if (!d) return null; const y = parseInt(String(d).slice(0, 4), 10); return isNaN(y) ? null : y; };
  const contractByRider = new Map(affRows.map(a => [a.riderId, affYear(a.dateTo)]));
  const roster = [...men, ...women]
    .map(r => ({ ...r, contractUntil: contractByRider.get(r.id) ?? null }))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
  _rosterCache.set(teamId, roster);
  return roster;
}

// `linkTeamId`: si se pasa Y ese equipo tiene ficha en el mercado (fila en
// team_seasons 2027 de una de las cuatro divisiones), la FILA ENTERA del corredor enlaza a la vista de ese
// equipo — un fichaje que LLEGA enlaza al equipo del que VENÍA; uno que se
// MARCHA, al equipo AL QUE VA (decisión Dani 2026-07-20). No hay ficha pública
// de corredor (retirada), así que el destino del enlace es siempre un equipo.
// Sin destino enlazable (retirada, fin de contrato, equipo fuera de las 4
// divisiones) la fila queda como texto plano.
// `arrow` + `team` pintan "nombre ⟵/⟶ franjas equipo"; `yearCol` reserva la
// celda del año aunque no haya contrato; `tint` colorea la fila de la plantilla
// (+ `arrival`: tinte fuerte, y texto oculto "Llega" para que el color no sea la
// única señal); `isRumor` tiñe la fila de azul y pone RUMOR a la derecha.
function personRowHtml({ flagCode, name, arrow = null, team = null, detail = '', contract = null, yearCol = false,
  isRumor = false, isDoubt = false, linkTeamId = null, tint = '', arrival = false }) {
  const teamHtml = team
    ? `<span class="tr-dest">${stripesFor(_market, team.id, team.side)}<strong>${esc(teamLabel(_market, team.id, team.freeText, team.side))}</strong></span>`
    : '';
  const status = isDoubt ? doubtChip()
    : isRumor ? rumorLabel()
    : '';
  const inner = `
    <span class="tr-row__flag">${flagHtml(flagCode)}</span>
    <span class="tr-name">${esc(name)}${arrival ? `<span class="sr-only"> (${esc(t('transfers.arrivalCue'))})</span>` : ''}</span>
    ${arrow ? arrowHtml(arrow) : ''}${teamHtml}${detail}
    ${status}
    ${contract || yearCol ? yearCell(contractBit(contract)) : ''}`;
  const cls = `tr-row tr-row--team${arrow || team || detail ? '' : ' tr-row--solo'}${tint ? ` tr-tint tr-tint--${tint}${arrival ? ' tr-tint--strong' : ''}` : ''}${isRumor && !isDoubt ? ' tr-row--rumor' : ''}`;
  if (linkTeamId && hasTeamView(_market, linkTeamId)) {
    // href con el param bilingüe `?team=<slug>` (el mismo que escribe openTeam);
    // el clic normal se intercepta y navega in-page.
    return `<a class="${cls} tr-row--link" href="${teamHref(_market, linkTeamId)}" data-team="${esc(linkTeamId)}">${inner}</a>`;
  }
  return `<div class="${cls}">${inner}</div>`;
}

// Tinte de la plantilla según el año de fin de contrato respecto a la
// temporada del mercado: 2 o más años de margen → verde, 1 → amarillo, vence
// este año (o antes) → rojo; sin año, sin tinte.
function contractTint(year) {
  if (!year) return '';
  if (year >= SEASON + 2) return 'green';
  return year === SEASON + 1 ? 'yellow' : 'red';
}

async function openTeam(teamId, { push = true } = {}) {
  const season = _market.seasonsByTeamId.get(teamId);
  if (!season) return;

  if (push) {
    const qs = new URLSearchParams(location.search);
    qs.set('vista', 'equipos');
    qs.set('div', _activeDiv);
    qs.delete('equipo');   // limpia el param ES antiguo si venía en la URL
    qs.set('team', _market.teamIdToSlug.get(teamId) || teamId);   // slug legible, bilingüe
    // pushState (no replaceState): abrir un equipo apila una entrada de
    // historial → el botón atrás del navegador vuelve a la lista de equipos (o al
    // equipo anterior si se saltó de equipo a equipo), no a la home global. La
    // sincronización vista↔URL al usar atrás/adelante la hace el listener
    // popstate (ver más abajo). El estado guarda el teamId para que popstate
    // resuelva la vista sin depender de parsear la URL.
    history.pushState({ trTeam: teamId }, '', `${location.pathname}?${qs}`);
  }

  $('trHome').hidden = true;
  const view = $('trTeamView');
  view.hidden = false;
  _view = 'teams';
  applyView();
  // El "volver a todos los equipos" vive en el botón ← del header (aparece solo
  // dentro de un equipo y cierra la vista sin recargar).
  if (typeof window.ccHeaderBack === 'function') {
    // El ← del header hace lo MISMO que el botón atrás del navegador
    // (history.back): así el historial no acumula basura y ambos caminos
    // convergen en el listener popstate, que repinta la lista de equipos.
    window.ccHeaderBack({ onClick: () => history.back(), label: t('transfers.back') });
  }
  // Banner a ancho completo con los colores del equipo; el recuento de la
  // plantilla se rellena cuando se conoce (#trTeamCount).
  view.innerHTML = `
    <div class="tr-team-banner" style="${teamColorStyle(_market, season)}">
      ${stripesBand(_market, season, 'tr-team-banner__stripes')}
      <div class="tr-team-banner__content">
        <h2 class="tr-team-banner__name">${esc(season.name)}</h2>
        <div class="tr-team-banner__meta">
          <span>${esc(divisionName(season))}</span>
          ${countryHtml(_market, teamId, 'tr-team-banner__country')}
          <span id="trTeamCount"></span>
        </div>
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">
      <div class="tr-col tr-col--squad">
        <section id="trSecStaying" hidden>
          <h3 class="tr-section-title">${esc(t('transfers.squad', { season: SEASON }))}</h3>
          <div class="tr-table" id="trStaying"></div>
        </section>
      </div>
      <div class="tr-col tr-col--ends">
        <section id="trSecDoubtful" hidden>
          <h3 class="tr-section-title">${esc(t('transfers.doubtful'))}</h3>
          <div class="tr-table" id="trDoubtful"></div>
        </section>
        <section id="trSecContractEnds" hidden>
          <h3 class="tr-section-title">${esc(t('transfers.contractEnds'))}</h3>
          <div class="tr-table" id="trContractEnds"></div>
        </section>
      </div>
      <div class="tr-col tr-col--moves">
        <section id="trSecArrivals" hidden>
          <h3 class="tr-section-title">${esc(t('transfers.arrivals'))}</h3>
          <div class="tr-table" id="trArrivals"></div>
        </section>
        <section id="trSecDepartures" hidden>
          <h3 class="tr-section-title">${esc(t('transfers.departures'))}</h3>
          <div class="tr-table" id="trDepartures"></div>
        </section>
      </div>
      <div id="trTeamEmpty" class="tr-empty" hidden>${esc(t('transfers.teamEmpty'))}</div>
    </div>`;
  // (El clic en filas de corredor enlazadas se delega UNA vez en init sobre
  // #trTeamView, que persiste entre aperturas — no se cablea aquí para no
  // acumular handlers en cada openTeam, que con pushState apilaría varias
  // entradas de historial por clic.)
  // El scroll del sitio vive en <body> (overflow-y auto), no en window.
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

  // Movimientos del equipo. Llegan (fichajes): primero los CONFIRMADOS, luego
  // los rumores; dentro de cada grupo, alfabético por apellido.
  const arrivalLastName = (x) => `${x.rider?.lastName || ''} ${x.rider?.firstName || ''}`.toLowerCase();
  // Un fichaje efectivo a mitad de temporada se muestra en el feed, pero no
  // como llegada/salida del mercado siguiente. Su afiliación contractual sí
  // puede aparecer en la situación de plantilla ("continúan").
  const marketTransfers = _market.transfers.filter(x => !x.midSeason);
  const arrivals = marketTransfers.filter(x => x.type === 'transfer' && x.toTeamId === teamId)
    .sort((a, b) => {
      const ra = a.status === 'rumor' ? 1 : 0, rb = b.status === 'rumor' ? 1 : 0;
      if (ra !== rb) return ra - rb;   // confirmados (0) antes que rumores (1)
      return arrivalLastName(a).localeCompare(arrivalLastName(b), 'es', { sensitivity: 'base' });
    });
  // Salidas del equipo. Un "fin de contrato sin destino" (transfer con
  // toTeamName='?' y sin toTeamId) NO es marcharse a otro equipo → va a su
  // propia sección "Terminan contrato". El resto (fichaje con destino conocido
  // o retirada) sigue en "Se marchan".
  const allDepartures = marketTransfers.filter(x =>
    (x.type === 'transfer' || x.type === 'retirement') && x.fromTeamId === teamId);
  const isContractEnd = (x) => x.type === 'transfer' && !x.toTeamId && x.toTeamName === UNKNOWN_DEST;
  // Terminan contrato: alfabético por apellido.
  const lastNameKey = (x) => `${x.rider?.lastName || ''} ${x.rider?.firstName || ''}`.toLowerCase();
  const contractEnds = allDepartures.filter(isContractEnd)
    .sort((a, b) => lastNameKey(a).localeCompare(lastNameKey(b), 'es', { sensitivity: 'base' }));
  // Se marchan: por categoría del equipo de destino (WT→WWT→PT→PRW→resto), luego
  // alfabético por nombre del equipo de destino; los retiros al final.
  const CAT_RANK = { WT: 0, WWT: 1, PT: 2, PRW: 3 };
  const depSortKey = (x) => {
    if (x.type === 'retirement') return { retire: 1, cat: 99, team: '' };
    const cat = _market.seasonsByTeamId.get(x.toTeamId)?.category;
    return { retire: 0, cat: (cat in CAT_RANK ? CAT_RANK[cat] : 90), team: teamLabel(_market, x.toTeamId, x.toTeamName) };
  };
  const departures = allDepartures.filter(x => !isContractEnd(x))
    .sort((a, b) => {
      const ka = depSortKey(a), kb = depSortKey(b);
      if (ka.retire !== kb.retire) return ka.retire - kb.retire;
      if (ka.cat !== kb.cat) return ka.cat - kb.cat;
      return ka.team.localeCompare(kb.team, 'es', { sensitivity: 'base' });
    });
  // Renovaciones: las EN DUDA van a su propia sección; el resto (confirmada o
  // rumoreada) sigue anotando el contrato de quien continúa.
  const renewalsByRider = new Map();
  const doubtsByRider = new Map();
  marketTransfers.filter(x => x.type === 'renewal' && x.toTeamId === teamId)
    .forEach(x => {
      const bucket = x.status === 'doubt' ? doubtsByRider : renewalsByRider;
      if (!bucket.has(x.riderId)) bucket.set(x.riderId, x);
    });

  // Cada sección solo se muestra si tiene contenido (una categoría vacía se
  // oculta por completo, título incluido).
  const showSection = (secId, contentId, has) => {
    const sec = $(secId);
    if (sec) sec.hidden = !has;
    if (!has) { const c = $(contentId); if (c) c.innerHTML = ''; }
  };

  // Llegan: confirmados primero y luego rumores (con chip); el año de contrato
  // va en la plantilla, no aquí.
  if (arrivals.length) {
    $('trArrivals').innerHTML = arrivals.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      arrow: 'left',
      team: { id: x.fromTeamId, freeText: x.fromTeamName, side: 'from' },
      isRumor: x.status === 'rumor',
      linkTeamId: x.fromTeamId,   // llega → enlaza al equipo del que VENÍA
    })).join('');
  }
  showSection('trSecArrivals', 'trArrivals', arrivals.length > 0);

  // Terminan contrato: acaban su contrato sin equipo conocido (sin destino).
  if (contractEnds.length) {
    $('trContractEnds').innerHTML = contractEnds.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      isRumor: x.status === 'rumor',
    })).join('');
  }
  showSection('trSecContractEnds', 'trContractEnds', contractEnds.length > 0);

  // Se marchan: fichaje a otro equipo (destino) o retirada, rumores con badge.
  if (departures.length) {
    $('trDepartures').innerHTML = departures.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      ...(x.type === 'retirement'
        ? { detail: `<span class="tr-dim">· ${esc(t('transfers.retired'))}</span>` }
        : { arrow: 'right', team: { id: x.toTeamId, freeText: x.toTeamName, side: 'to' } }),
      isRumor: x.status === 'rumor',
      // Se marcha → enlaza al equipo AL QUE VA (una retirada no tiene destino).
      linkTeamId: x.type === 'retirement' ? null : x.toTeamId,
    })).join('');
  }
  showSection('trSecDepartures', 'trDepartures', departures.length > 0);

  // Plantilla: los del squad 2027 que YA estaban en el equipo en la temporada
  // en curso (currentTeamId = equipo) — es lo que separa "continúa" de "llega de
  // fuera" (un fichaje también tiene afiliación 2027, pero su currentTeamId es
  // otro equipo) — MENOS los que tienen salida registrada y MENOS los que están
  // en duda (sección propia), MÁS las llegadas CONFIRMADAS (un rumor no entra en
  // la plantilla). Contrato: el de la renovación registrada gana al de la ficha;
  // una duda NO lo toca.
  try {
    const roster = await loadRoster(teamId);
    // "gone" = toda salida registrada (fichaje, retirada Y fin de contrato):
    // ninguno de ellos continúa.
    const gone = new Set(allDepartures.map(x => x.riderId));
    // Orden: por año de contrato DESC (2030 → 2029 → … → sin año al final) y,
    // como segundo factor, el APELLIDO. El contrato efectivo = el de la
    // renovación registrada, o el de la ficha (afiliación 2027).
    const contractOf = (r) => (renewalsByRider.get(r.id)?.contractUntil) || r.contractUntil || null;
    const lastNameFirst = (r) => `${r.lastName || ''} ${r.firstName || ''}`.toLowerCase();
    const squad = roster
      .filter(r => r.currentTeamId === teamId && !gone.has(r.id) && !doubtsByRider.has(r.id))
      .map(r => ({
        id: r.id, flagCode: r.nationality, name: riderName(r), last: lastNameFirst(r),
        contract: contractOf(r), isRumor: renewalsByRider.get(r.id)?.status === 'rumor', arrival: false,
      }));
    const squadIds = new Set(squad.map(e => e.id));
    arrivals.filter(x => x.status === 'confirmed' && !squadIds.has(x.riderId) && !doubtsByRider.has(x.riderId)).forEach(x => squad.push({
      id: x.riderId, flagCode: x.rider?.nationality, name: riderName(x.rider) || x.riderId,
      last: lastNameFirst(x.rider || {}), contract: x.contractUntil || null, isRumor: false, arrival: true,
    }));
    squad.sort((a, b) => {
      if (a.contract !== b.contract) return (b.contract || 0) - (a.contract || 0);   // año mayor primero; sin año (0) al final
      return a.last.localeCompare(b.last, 'es', { sensitivity: 'base' });
    });
    if (squad.length) {
      $('trStaying').innerHTML = squad.map(e => personRowHtml({
        flagCode: e.flagCode,
        name: e.name,
        contract: e.contract,
        yearCol: true,
        isRumor: e.isRumor,
        tint: contractTint(e.contract),
        arrival: e.arrival,
      })).join('');
    }
    showSection('trSecStaying', 'trStaying', squad.length > 0);
    const count = $('trTeamCount');
    // «Confirmados»: fuera los que solo tienen una renovación rumoreada.
    const confirmed = squad.filter(e => !e.isRumor).length;
    if (count) count.textContent = t(`transfers.squadCount_${confirmed === 1 ? 'one' : 'other'}`, { n: confirmed, season: SEASON });

    // En duda: los de la plantilla con renovación en duda. La ficha manda
    // para el nombre/bandera; si el corredor ya no está en la plantilla
    // (fichado en enero, ficha ya movida) se cae a la del movimiento.
    const byId = new Map(roster.map(r => [r.id, r]));
    const doubtful = [...doubtsByRider.values()]
      .filter(x => !gone.has(x.riderId))
      .map(x => ({ x, r: byId.get(x.riderId) || x.rider }))
      .sort((a, b) => riderName(a.r).localeCompare(riderName(b.r), 'es', { sensitivity: 'base' }));
    // Sin badge "Duda": ya están bajo la sección "En duda".
    if (doubtful.length) {
      $('trDoubtful').innerHTML = doubtful.map(({ x, r }) => personRowHtml({
        flagCode: r?.nationality,
        name: riderName(r) || x.riderId,
        contract: r?.contractUntil,
      })).join('');
    }
    showSection('trSecDoubtful', 'trDoubtful', doubtful.length > 0);

    // Si TODAS las secciones quedaron vacías, un único aviso (equipo sin datos).
    const anyShown = ['trSecStaying', 'trSecDoubtful', 'trSecContractEnds', 'trSecArrivals', 'trSecDepartures']
      .some(id => $(id) && !$(id).hidden);
    const emptyEl = $('trTeamEmpty'); if (emptyEl) emptyEl.hidden = anyShown;
  } catch (err) {
    console.error('[fichajes] roster', err);
    // Error al cargar la plantilla: mostrar la sección "continúan" con el aviso.
    const sec = $('trSecStaying'); if (sec) sec.hidden = false;
    $('trStaying').innerHTML = `<div class="tr-empty">${esc(t('transfers.loadError'))}</div>`;
  }
}

// Cierra el detalle de equipo y repinta la vista activa (Mercado o Equipos). Es
// SOLO visual: NO toca el historial. Lo dispara el listener popstate cuando la
// URL ya no lleva ?team= (por el botón atrás del navegador o el ← del header,
// que hace back()) y el interruptor de vistas.
function closeTeam() {
  const view = $('trTeamView');
  if (!view.hidden) {
    view.hidden = true;
    view.innerHTML = '';
    $('trHome').hidden = false;
    // Ocultar el ← del header: en la lista de equipos no hay "volver".
    if (typeof window.ccHeaderBack === 'function') window.ccHeaderBack(null);
    window.scrollTo(0, 0);
  }
  applyView();
}

// Muestra la vista activa (Mercado | Equipos) y deja el interruptor y el h1 en
// consonancia. El h1 es el único de la página: visible en Mercado y oculto solo
// visualmente (.sr-only) en Equipos y en el detalle de un equipo, donde el
// título visible es otro.
function applyView() {
  const teamOpen = !$('trTeamView').hidden;
  $('trViewMarket').hidden = _view !== 'market';
  $('trViewTeams').hidden = _view !== 'teams';
  $('trViewSwitch').querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === _view;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('tr-view-btn--active', on);
  });
  $('trH1').classList.toggle('sr-only', _view !== 'market' || teamOpen);
}

// Vista que pide una URL: ?vista=equipos, o un ?div=/?team= (enlaces anteriores
// al interruptor) → Equipos; sin nada de eso, Mercado.
function viewFromUrl(qs) {
  const hasDiv = DIVISIONS.includes((qs.get('div') || '').toUpperCase());
  const hasTeam = Boolean(resolveTeamParam(qs.get('team') || qs.get('equipo')));
  return qs.get('vista') === 'equipos' || hasDiv || hasTeam ? 'teams' : 'market';
}

// Cambio de vista desde el interruptor (replaceState: no apila historial). Si
// había un equipo abierto, se cierra. Mercado limpia ?div= porque implicaría
// Equipos al recargar.
function setView(view) {
  _view = view;
  const qs = new URLSearchParams(location.search);
  if (view === 'teams') qs.set('vista', 'equipos');
  else { qs.delete('vista'); qs.delete('div'); }
  qs.delete('team');
  qs.delete('equipo');
  const query = qs.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  closeTeam();
}

// Resuelve un teamId desde el valor de ?team=/?equipo= (slug legible bilingüe o,
// retrocompatible, el teamId antiguo team_...). Devuelve null si no casa.
function resolveTeamParam(value) {
  if (!value) return null;
  const teamId = _market.slugToTeamId.get(value) || value;
  return hasTeamView(_market, teamId) ? teamId : null;
}

// ── Sincronización con el botón atrás/adelante del navegador ───────
// openTeam apila una entrada con pushState; el ← del header hace history.back().
// Aquí reaccionamos al cambio de historial: si la nueva URL lleva ?team= abrimos
// ese equipo (sin volver a apilar), y si no, repintamos la vista que pida la URL.
// Con esto, atrás desde un equipo va a la lista de equipos (o al equipo anterior
// si se saltó de equipo a equipo), no a la home global, y adelante rehace el
// camino.
window.addEventListener('popstate', (e) => {
  // El mercado aún no está cargado (navegación muy temprana; la portada
  // generada en el build ya lleva #trTeamView): lo resuelve init.
  if (!_market || !$('trTeamView')) return;
  const qs = new URLSearchParams(location.search);
  const div = (qs.get('div') || '').toUpperCase();
  if (DIVISIONS.includes(div)) { _activeDiv = div; renderTeams(); }
  const teamId = (e.state && e.state.trTeam)
    || resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (teamId && hasTeamView(_market, teamId)) {
    openTeam(teamId, { push: false });   // sin pushState: no duplica historial
  } else {
    _view = viewFromUrl(qs);
    closeTeam();
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────
async function init() {
  // El diccionario EN se carga a la vez que el mercado.
  const i18nReady = initI18n();

  const content = $('transfersContent');
  const main = $('fichajesMain');
  const prerendered = content.hasAttribute('data-prerendered');

  // Sin portada generada en el build, se pinta desde la copia local, si existe,
  // y se revalida contra la red; la revalidación solo repinta si los datos
  // cambian. Con portada generada se espera a la red: la copia local puede ser
  // anterior al build.
  let mounted = false, mounting = null;
  const onMarket = market => {
    applyMarket(market);
    if (!mounted) {
      mounted = true;
      mounting = i18nReady.then(mountMarket);
      return;
    }
    mounting.then(refreshMarketViews);
  };
  try {
    if (prerendered) {
      const market = await fetchMarket();
      writeCache(CACHE_KEY, market);
      onMarket(market);
    } else {
      await staleWhileRevalidate(CACHE_KEY, fetchMarket, onMarket);
    }
  } catch (err) {
    console.error('[fichajes] load', err);
    await i18nReady;
    main.querySelector('#trStaticLoading')?.remove();
    content.hidden = false;
    // La portada generada en el build se conserva con los datos de ese build.
    if (prerendered) return;
    content.innerHTML = `<div class="tr-empty" style="padding:2rem 0">${esc(t('transfers.loadError'))}</div>`;
    main.querySelector('.static-prerender')?.remove();
    return;
  }
  await mounting;
}

// Repinta feed y lista con los datos revalidados; si hay un equipo abierto,
// se reconstruye su vista sin mover el scroll.
function refreshMarketViews() {
  renderFeed();
  renderTeams();
  const view = $('trTeamView');
  if (!view || view.hidden) return;
  const qs = new URLSearchParams(location.search);
  const teamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (!teamId) return;
  const y = window.scrollY;
  openTeam(teamId, { push: false }).then(() => window.scrollTo(0, y));
}

// Monta la home del mercado y, con ?team=, la vista de equipo.
async function mountMarket() {
  const content = $('transfersContent');
  const main = $('fichajesMain');

  const qs = new URLSearchParams(location.search);
  if (DIVISIONS.includes((qs.get('div') || '').toUpperCase())) {
    _activeDiv = qs.get('div').toUpperCase();
  }

  const urlTeamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
  _view = viewFromUrl(qs);

  // La portada generada en el build con el mismo HTML se conserva
  // (js/html-fingerprint.js); con otra división en la URL o datos nuevos desde
  // el build, se actualiza solo lo que difiere. Siempre trae Mercado a la
  // vista: applyView muestra la que pida la URL.
  applyPrerenderedHtml(content, marketHomeHtml(_market, { activeDiv: _activeDiv, activeFeed: _activeFeed, filters: _filters }), patchMarket);
  content.hidden = false;

  $('trViewSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setView(btn.dataset.view);
  });

  // Chips, botones y tarjetas se delegan en sus contenedores, que persisten
  // entre repintados (renderFeed, renderTeams): sirven igual sobre la portada
  // generada que sobre la pintada aquí.
  $('trFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('.tr-filter-chip');
    if (chip) { toggleFilter(chip.dataset.group, chip.dataset.value); return; }
    if (e.target.closest('#trFiltersClear')) {
      _filters = newFilters();
      renderFilters();
      renderFeed();
    }
  });

  $('trFeedBtns').addEventListener('click', (e) => {
    const button = e.target.closest('[data-feed]');
    if (!button) return;
    _activeFeed = button.dataset.feed;
    renderFeedButtons();
    renderFeed();
  });

  $('trDivBtns').addEventListener('click', (e) => {
    const button = e.target.closest('[data-div]');
    if (!button) return;
    _activeDiv = button.dataset.div;
    const params = new URLSearchParams(location.search);
    params.set('vista', 'equipos');
    params.set('div', _activeDiv);
    params.delete('team');
    params.delete('equipo');   // barre también el param ES antiguo
    history.replaceState(null, '', `${location.pathname}?${params}`);
    renderTeams();
  });

  $('trTeamGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-team]');
    if (card) openTeam(card.dataset.team);
  });

  // Clic en fila de corredor enlazada (Llegan → equipo de origen; Se marchan →
  // equipo destino): navegación interna a ese equipo, sin recarga. Delegado UNA
  // vez sobre #trTeamView, que persiste entre aperturas (su innerHTML se
  // reemplaza pero el nodo no) → no se acumulan handlers. La <a> lleva href real
  // para accesibilidad/copiar-enlace; interceptamos el clic normal.
  $('trTeamView').addEventListener('click', (e) => {
    const link = e.target.closest('.tr-row--link[data-team]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // abrir en pestaña nueva
    e.preventDefault();
    openTeam(link.dataset.team);
  });

  // El feed también lleva a la ficha del equipo de DESTINO del fichaje. Usa la
  // misma navegación interna que las filas de la ficha de equipo, conservando
  // el href real para accesibilidad y para abrir el destino en otra pestaña.
  $('trFeed').addEventListener('click', (e) => {
    const link = e.target.closest('.tr-row--link[data-team]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openTeam(link.dataset.team);
  });

  // Retirar los marcadores del overlay de carga (page-loading.js) una vez
  // el contenido real está montado.
  main.querySelector('#trStaticLoading')?.remove();
  main.querySelector('.static-prerender')?.remove();

  applyView();
  // ?team= (bilingüe ES/EN) acepta el slug legible (visma-lease-a-bike) o,
  // retrocompatible, el teamId antiguo (team_...). El ?equipo= previo se sigue
  // leyendo para no romper enlaces ya compartidos.
  const teamId = urlTeamId;
  if (teamId) {
    const cat = _market.seasonsByTeamId.get(teamId)?.category;
    if (DIVISIONS.includes(cat)) _activeDiv = cat;
    await openTeam(teamId, { push: false });
    // Deep link a un equipo: sembramos el teamId en el estado de ESTA entrada de
    // historial (la de entrada al sitio). Así, si el usuario navega dentro y
    // luego vuelve, popstate reconstruye la vista de equipo sin reparsear.
    history.replaceState({ trTeam: teamId }, '', location.href);
  }
}

init();
