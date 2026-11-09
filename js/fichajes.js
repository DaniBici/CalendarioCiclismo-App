// ─────────────────────────────────────────────────────────────────
//  FICHAJES — /fichajes/ (+ EN /en/transfers/)
//  Mercado de fichajes de la temporada 2027 (tabla rider_transfers, mig. 122).
//
//  Estructura de la página:
//   1. Feed cronológico inverso de CONFIRMACIONES (fichajes + renovaciones;
//      los rumores y las dudas NO aparecen aquí). Un movimiento con la fecha
//      oculta (dateVisible=false, mig. 123) tampoco: la carga inicial mete de
//      golpe anuncios de hace semanas que poblarían el feed de días viejos.
//   2. Botones de división (WT · PT · WWT · PRW) + lista de equipos 2027.
//      Los equipos salen de team_seasons[2027] → los renombres de sponsor y
//      los ascensos/descensos se editan en el panel sin tocar `teams`.
//      La chapa muestra los colores 2027 si team_seasons.badgeVisible; si aún
//      no (kit 2027 sin anunciar), muestra los colores ANTIGUOS del equipo
//      (temporada en curso, 2026) — o nada si es un equipo NUEVO nacido en 2027
//      (sin fila 2026, mig. 129) o si la fila 2027 tiene prevColorsHidden
//      (denominación sin confirmar). continuityDoubt → chip + aviso (el equipo
//      mismo puede no tener sponsor para 2027).
//   3. Vista de equipo (sustituye al listado de una vez, con volver): continúan /
//      en duda / se marchan / llegan. Regla del rumor (decisión Dani): una
//      salida rumoreada saca al corredor de "continúan" y lo pinta como
//      baja·Rumor (y como alta·Rumor en el destino). Regla de la duda: una
//      renovación en duda (status='doubt', solo en renewal) lo saca también
//      de "continúan" y lo lleva a su propia sección.
//
//  Feed, lista de equipos y vista de equipo salen de js/fichajes-html.js, común
//  con el build: tools/site/prerender-fichajes.mjs escribe la portada en el HTML y
//  aquí se conserva si su huella coincide (js/html-fingerprint.js).
//
//  Estado compartible por URL: ?div=WT|WWT|PT|PRW y ?team=<slug> (bilingüe
//  ES/EN; ?equipo= antiguo se sigue leyendo por retrocompatibilidad), sin
//  recarga. Abrir un equipo apila una entrada de historial (pushState) → el
//  botón atrás del navegador vuelve a la home de mercado (o al equipo anterior),
//  no a la home global; el listener popstate sincroniza la vista con la URL.
//  Cambiar de división es replaceState (no apila).
// ─────────────────────────────────────────────────────────────────

import { supabase } from './shared.js';
import { fetchAllRows, fetchAllRowsParallel, fetchByIds } from './services/paged-query.js';
import { staleWhileRevalidate, writeCache } from './services/local-cache.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';
import { patchHtml, slideIn } from './dom-patch.js';
import { t, initI18n } from './i18n.js';
import { refreshSplitSectionTitles } from './fichajes-columnas.js';
import {
  SEASON, PREV_SEASON, DIVISIONS, SEASON_COLUMNS, PREV_SEASON_COLUMNS, RIDER_COLUMNS, ROSTER_COLUMNS,
  esc, marketRiderIds, marketExtraTeamIds, attachRiders, buildMarket, hasTeamView,
  rosterGender, rosterFromRows, teamViewHtml, feedColumnsHtml, feedButtonsHtml, divButtonsHtml,
  teamGridHtml, marketHomeHtml,
} from './fichajes-html.js';

const CACHE_KEY = `fichajes:${SEASON}`;

let _market = null;                 // buildMarket() de las lecturas (js/fichajes-html.js)
let _activeDiv = 'WT';
let _activeFeed = 'signings';
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
  const [men, women, extraTeams] = await Promise.all([
    menIds.length ? fetchByIds(supabase, 'riders_men', RIDER_COLUMNS, 'id', menIds) : [],
    womenIds.length ? fetchByIds(supabase, 'riders_women', RIDER_COLUMNS, 'id', womenIds) : [],
    refIds.length ? fetchByIds(supabase, 'teams', 'id, name', 'id', refIds) : [],
  ]);
  attachRiders(transfers, men, women);
  return { seasons, prevSeasons, transfers, extraTeams };
}

function applyMarket(market) {
  _market = buildMarket(market);
  // Publicación por página: las plantillas llegan con el mercado.
  if (market.rosters) _rosterCache = new Map(Object.entries(market.rosters));
}

// Feed, botones y equipos se actualizan sobre lo pintado (js/dom-patch.js):
// con datos nuevos solo cambian las filas afectadas y los movimientos nuevos
// entran deslizándose; el botón pulsado conserva el foco.
const patchMarket = (el, html) => patchHtml(el, html, { enter: slideIn });

function renderFeed() {
  const box = $('trFeed');
  if (box) patchMarket(box, feedColumnsHtml(_market, _activeFeed));
}

function renderFeedButtons() {
  const box = $('trFeedBtns');
  if (box) patchHtml(box, feedButtonsHtml(_activeFeed));
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
  const gender = rosterGender(_market, teamId);

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
  // (venía ya del equipo) de llegada (venía de fuera).
  const menIds = affRows.filter(a => (a.riderGender || gender) === 'male').map(a => a.riderId);
  const womenIds = affRows.filter(a => (a.riderGender || gender) === 'female').map(a => a.riderId);
  const [men, women] = await Promise.all([
    menIds.length   ? supabase.from('riders_men').select(ROSTER_COLUMNS).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
    womenIds.length ? supabase.from('riders_women').select(ROSTER_COLUMNS).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
  ]);
  const roster = rosterFromRows(affRows, men, women);
  _rosterCache.set(teamId, roster);
  return roster;
}

// Abre un equipo de una sola vez: la plantilla se lee antes de pintar, porque
// «Continúan» va delante de las demás secciones y las empujaría al llegar. Hasta
// entonces sigue a la vista lo que había. `keepScroll`: datos nuevos sobre el
// equipo abierto; se actualiza lo que difiere sin mover la página.
let _teamRequest = 0;

async function openTeam(teamId, { push = true, keepScroll = false } = {}) {
  if (!_market.seasonsByTeamId.get(teamId)) return;
  const request = ++_teamRequest;

  if (push) {
    const qs = new URLSearchParams(location.search);
    qs.set('div', _activeDiv);
    qs.delete('equipo');   // limpia el param ES antiguo si venía en la URL
    qs.set('team', _market.teamIdToSlug.get(teamId) || teamId);   // slug legible, bilingüe
    // pushState (no replaceState): abrir un equipo apila una entrada de
    // historial → el botón atrás del navegador vuelve a la home de mercado (o al
    // equipo anterior si se saltó de equipo a equipo), no a la home global. La
    // sincronización vista↔URL al usar atrás/adelante la hace el listener
    // popstate (ver más abajo). El estado guarda el teamId para que popstate
    // resuelva la vista sin depender de parsear la URL.
    history.pushState({ trTeam: teamId }, '', `${location.pathname}?${qs}`);
  }

  // "Continúan" = corredores que YA estaban en el equipo en la temporada en
  // curso; sin plantilla, esa sección lleva el aviso y las demás se pintan.
  let roster = [];
  let rosterError = false;
  try {
    roster = await loadRoster(teamId);
  } catch (err) {
    console.error('[fichajes] roster', err);
    rosterError = true;
  }
  if (request !== _teamRequest) return;   // ya se pidió otra vista

  const html = teamViewHtml(_market, teamId, roster, { rosterError });
  const view = $('trTeamView');
  if (keepScroll && !view.hidden) {
    patchMarket(view, html);
  } else {
    view.innerHTML = html;
    view.hidden = false;
    $('trHome').hidden = true;
    // El scroll del sitio vive en <body> (overflow-y auto), no en window.
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }
  showTeamBack();
  // (El clic en filas de corredor enlazadas se delega UNA vez en init sobre
  // #trTeamView, que persiste entre aperturas — no se cablea aquí para no
  // acumular handlers en cada openTeam, que con pushState apilaría varias
  // entradas de historial por clic.)
  refreshSplitSectionTitles();
}

// El "volver a todos los equipos" vive en el botón ← del header (aparece solo
// dentro de un equipo y cierra la vista sin recargar). Hace lo MISMO que el
// botón atrás del navegador (history.back): así el historial no acumula basura y
// ambos caminos convergen en el listener popstate, que repinta la home de mercado.
function showTeamBack() {
  if (typeof window.ccHeaderBack === 'function') {
    window.ccHeaderBack({ onClick: () => history.back(), label: t('transfers.back') });
  }
}

window.addEventListener('resize', refreshSplitSectionTitles);

// Repinta la home de mercado (oculta el detalle de equipo). Es SOLO visual: NO
// toca el historial. Lo dispara el listener popstate cuando la URL ya no lleva
// ?team= (por el botón atrás del navegador o el ← del header, que hace back()).
function closeTeam() {
  _teamRequest++;   // una plantilla en camino ya no abre su equipo
  const view = $('trTeamView');
  if (view.hidden) return;   // ya en la home → nada que hacer
  view.hidden = true;
  view.innerHTML = '';
  $('trHome').hidden = false;
  // Ocultar el ← del header: en la lista de equipos no hay "volver".
  if (typeof window.ccHeaderBack === 'function') window.ccHeaderBack(null);
  window.scrollTo(0, 0);
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
// ese equipo (sin volver a apilar), y si no, repintamos la home de mercado. Con
// esto, atrás desde un equipo va a la home de mercado (o al equipo anterior si se
// saltó de equipo a equipo), no a la home global, y adelante rehace el camino.
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

// Repinta feed y lista con los datos revalidados; si hay un equipo abierto, su
// vista se actualiza sobre lo pintado, sin mover el scroll.
function refreshMarketViews() {
  renderFeed();
  renderTeams();
  const view = $('trTeamView');
  if (!view || view.hidden) return;
  const qs = new URLSearchParams(location.search);
  const teamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (teamId) openTeam(teamId, { push: false, keepScroll: true });
}

/**
 * Vuelve a leer el mercado y actualiza lo que difiere sobre lo pintado.
 * @public la isla de la publicación por página (tools/publicacion/cliente/isla-fichajes.js).
 */
export async function refreshMarket() {
  if (!_market) return;
  const market = await fetchMarket();
  applyMarket(market);
  refreshMarketViews();
}

// Monta la home del mercado y, con ?team=, la vista de equipo.
async function mountMarket() {
  const content = $('transfersContent');
  const main = $('fichajesMain');

  const qs = new URLSearchParams(location.search);
  if (DIVISIONS.includes((qs.get('div') || '').toUpperCase())) {
    _activeDiv = qs.get('div').toUpperCase();
  }

  // ?team= (bilingüe ES/EN) acepta el slug legible (visma-lease-a-bike) o,
  // retrocompatible, el teamId antiguo (team_...). El ?equipo= previo se sigue
  // leyendo para no romper enlaces ya compartidos.
  const teamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (teamId) {
    const cat = _market.seasonsByTeamId.get(teamId)?.category;
    if (DIVISIONS.includes(cat)) _activeDiv = cat;
  }
  // Publicación por página: el documento de un equipo ya lo trae pintado.
  const teamPainted = Boolean(teamId) && content.dataset.paintedTeam === teamId;
  const teamHtml = teamPainted ? teamViewHtml(_market, teamId, await loadRoster(teamId)) : null;

  // La portada generada en el build con el mismo HTML se conserva
  // (js/html-fingerprint.js); con otra división en la URL o datos nuevos desde
  // el build, se actualiza solo lo que difiere.
  applyPrerenderedHtml(content, marketHomeHtml(_market, { activeDiv: _activeDiv, activeFeed: _activeFeed, teamHtml }), patchMarket);
  // Enlace a un equipo: la portada no llega a verse mientras se lee su plantilla.
  if (teamId && !teamPainted) $('trHome').hidden = true;
  content.hidden = false;

  // Botones y tarjetas se delegan en sus contenedores, que persisten entre
  // repintados (renderFeed, renderTeams): sirven igual sobre la portada
  // generada que sobre la pintada aquí.
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
    params.set('div', _activeDiv);
    params.delete('team');
    params.delete('equipo');   // barre también el param ES antiguo
    history.replaceState(null, '', `${location.pathname}?${params}`);
    renderTeams();
  });

  // Las tarjetas son enlaces reales (?team=): el clic normal navega sin recarga.
  $('trTeamGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-team]');
    if (!card) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // abrir en pestaña nueva
    e.preventDefault();
    openTeam(card.dataset.team);
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

  if (teamId) {
    if (teamPainted) {
      showTeamBack();
      refreshSplitSectionTitles();
    } else {
      await openTeam(teamId, { push: false });
    }
    // Deep link a un equipo: sembramos el teamId en el estado de ESTA entrada de
    // historial (la de entrada al sitio). Así, si el usuario navega dentro y
    // luego vuelve, popstate reconstruye la vista de equipo sin reparsear.
    history.replaceState({ trTeam: teamId }, '', location.href);
  }

  // Retirar los marcadores del overlay de carga (page-loading.js) una vez
  // el contenido real está montado.
  main.querySelector('#trStaticLoading')?.remove();
  main.querySelector('.static-prerender')?.remove();
}

/** @public la isla de la publicación por página (tools/publicacion/cliente/isla-fichajes.js). */
export const marketReady = init();
