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
//      (sin fila 2026, mig. 129). continuityDoubt → chip + aviso (el equipo
//      mismo puede no tener sponsor para 2027).
//   3. Vista de equipo (sustituye al listado, con volver): continúan /
//      en duda / se marchan / llegan. Regla del rumor (decisión Dani): una
//      salida rumoreada saca al corredor de "continúan" y lo pinta como
//      baja·Rumor (y como alta·Rumor en el destino). Regla de la duda: una
//      renovación en duda (status='doubt', solo en renewal) lo saca también
//      de "continúan" y lo lleva a su propia sección.
//
//  Feed y lista de equipos (1 y 2) salen de js/fichajes-html.js, común con el
//  build: tools/site/prerender-fichajes.mjs escribe la portada en el HTML y
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
import {
  SEASON, PREV_SEASON, DIVISIONS, DIVISION_GENDER, SEASON_COLUMNS, PREV_SEASON_COLUMNS, RIDER_COLUMNS, UNKNOWN_DEST,
  esc, riderName, marketRiderIds, marketExtraTeamIds, attachRiders, buildMarket, teamLabel, hasTeamView, teamHref,
  flagHtml, rumorChip, doubtChip, contractBit, marketStripesHtml, feedColumnsHtml, feedButtonsHtml, divButtonsHtml,
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
function personRowHtml({ flagCode, name, detail = '', contract = null, isRumor = false, isDoubt = false, linkTeamId = null }) {
  // El año de contrato y el estado (rumor/duda) van como BADGES al final de la
  // fila, no en el texto.
  const inner = `
    <span class="tr-row__flag">${flagHtml(flagCode)}</span>
    <span class="tr-row__body"><strong>${esc(name)}</strong>${detail ? ` ${detail}` : ''}</span>
    ${contractBit(contract)}
    ${isDoubt ? doubtChip() : isRumor ? rumorChip() : ''}`;
  if (linkTeamId && hasTeamView(_market, linkTeamId)) {
    // href con el param bilingüe `?team=<slug>` (el mismo que escribe openTeam);
    // el clic normal se intercepta y navega in-page.
    return `<a class="tr-row tr-row--team tr-row--link" href="${teamHref(_market, linkTeamId)}" data-team="${esc(linkTeamId)}">${inner}</a>`;
  }
  return `<div class="tr-row tr-row--team">${inner}</div>`;
}

// En escritorio, las secciones del equipo se distribuyen con CSS multicolumna.
// Cuando una sección cruza el salto de columna, el navegador conserva su título
// únicamente en la primera; se añade una copia delante de la primera fila de la
// siguiente columna para que el contexto no se pierda. La copia se recalcula
// después de cada repintado y al cambiar el ancho de la ventana.
function refreshSplitSectionTitles() {
  const sections = $('trTeamView')?.querySelector('.tr-team-sections');
  if (!sections) return;

  sections.querySelectorAll('.tr-section-title--duplicate').forEach(title => title.remove());
  if (!window.matchMedia('(min-width: 761px)').matches) return;

  sections.querySelectorAll(':scope > section:not([hidden])').forEach(section => {
    const title = section.querySelector(':scope > .tr-section-title');
    const content = title?.nextElementSibling;
    if (!title || !content) return;

    const rows = [...content.children].filter(child => child.matches('.tr-row'));
    if (rows.length < 2) return;

    const firstColumnLeft = rows[0].getBoundingClientRect().left;
    const firstRowInNextColumn = rows.find(row =>
      Math.abs(row.getBoundingClientRect().left - firstColumnLeft) > 1
    );
    if (!firstRowInNextColumn) return;

    const duplicate = title.cloneNode(true);
    duplicate.classList.add('tr-section-title--duplicate');
    duplicate.setAttribute('aria-hidden', 'true');
    content.insertBefore(duplicate, firstRowInNextColumn);
  });
}

window.addEventListener('resize', refreshSplitSectionTitles);

async function openTeam(teamId, { push = true } = {}) {
  const season = _market.seasonsByTeamId.get(teamId);
  if (!season) return;

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

  $('trHome').hidden = true;
  const view = $('trTeamView');
  view.hidden = false;
  // El "volver a todos los equipos" vive en el botón ← del header (aparece solo
  // dentro de un equipo y cierra la vista sin recargar).
  if (typeof window.ccHeaderBack === 'function') {
    // El ← del header hace lo MISMO que el botón atrás del navegador
    // (history.back): así el historial no acumula basura y ambos caminos
    // convergen en el listener popstate, que repinta la home de mercado.
    window.ccHeaderBack({ onClick: () => history.back(), label: t('transfers.back') });
  }
  view.innerHTML = `
    <div class="tr-team-header">
      <div class="tr-team-header__text">
        <h2 class="tr-team-header__name">${marketStripesHtml(_market, season)}${esc(season.name)}</h2>
        <span class="tr-team-header__cat">${esc(season.category || '')} · ${SEASON}</span>
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">
      <section id="trSecStaying" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.staying'))}</h3>
        <div id="trStaying"></div>
      </section>
      <section id="trSecDoubtful" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.doubtful'))}</h3>
        <div id="trDoubtful"></div>
      </section>
      <section id="trSecContractEnds" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.contractEnds'))}</h3>
        <div id="trContractEnds"></div>
      </section>
      <section id="trSecArrivals" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.arrivals'))}</h3>
        <div id="trArrivals"></div>
      </section>
      <section id="trSecDepartures" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.departures'))}</h3>
        <div id="trDepartures"></div>
      </section>
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

  // Llegan: cronológico inverso (ya vienen ordenados), rumores con badge.
  if (arrivals.length) {
    $('trArrivals').innerHTML = arrivals.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      detail: `<span class="tr-dim">· ${esc(teamLabel(_market, x.fromTeamId, x.fromTeamName, 'from'))}</span>`,
      contract: x.contractUntil,
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
      detail: x.type === 'retirement'
        ? `<span class="tr-dim">· ${esc(t('transfers.retired'))}</span>`
        : `<span class="tr-dim">· ${esc(teamLabel(_market, x.toTeamId, x.toTeamName))}</span>`,
      isRumor: x.status === 'rumor',
      // Se marcha → enlaza al equipo AL QUE VA (una retirada no tiene destino).
      linkTeamId: x.type === 'retirement' ? null : x.toTeamId,
    })).join('');
  }
  showSection('trSecDepartures', 'trDepartures', departures.length > 0);

  // Continúan: los del squad 2027 que YA estaban en el equipo en la temporada
  // en curso (currentTeamId = equipo) — es lo que separa "continúa" de "llega de
  // fuera" (un fichaje también tiene afiliación 2027, pero su currentTeamId es
  // otro equipo, así que va a "Llegan", no aquí). MENOS los que tienen salida
  // registrada y MENOS los que están en duda (sección propia). Contrato: el de
  // la renovación registrada gana al de la ficha; una duda NO lo toca.
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
    const staying = roster
      .filter(r => r.currentTeamId === teamId && !gone.has(r.id) && !doubtsByRider.has(r.id))
      .sort((a, b) => {
        const ya = contractOf(a), yb = contractOf(b);
        if (ya !== yb) return (yb || 0) - (ya || 0);   // año mayor primero; sin año (0) al final
        return lastNameFirst(a).localeCompare(lastNameFirst(b), 'es', { sensitivity: 'base' });
      });
    if (staying.length) {
      $('trStaying').innerHTML = staying.map(r => {
        const renewal = renewalsByRider.get(r.id);
        return personRowHtml({
          flagCode: r.nationality,
          name: riderName(r),
          contract: renewal?.contractUntil || r.contractUntil,
          isRumor: renewal?.status === 'rumor',
        });
      }).join('');
    }
    showSection('trSecStaying', 'trStaying', staying.length > 0);

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

  refreshSplitSectionTitles();
}

// Repinta la home de mercado (oculta el detalle de equipo). Es SOLO visual: NO
// toca el historial. Lo dispara el listener popstate cuando la URL ya no lleva
// ?team= (por el botón atrás del navegador o el ← del header, que hace back()).
function closeTeam() {
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

  // La portada generada en el build con el mismo HTML se conserva
  // (js/html-fingerprint.js); con otra división en la URL o datos nuevos desde
  // el build, se actualiza solo lo que difiere.
  applyPrerenderedHtml(content, marketHomeHtml(_market, { activeDiv: _activeDiv, activeFeed: _activeFeed }), patchMarket);
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

  // ?team= (bilingüe ES/EN) acepta el slug legible (visma-lease-a-bike) o,
  // retrocompatible, el teamId antiguo (team_...). El ?equipo= previo se sigue
  // leyendo para no romper enlaces ya compartidos.
  const teamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
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
