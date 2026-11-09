// ─────────────────────────────────────────────────────────────────
//  MODO CAMPEONATOS — campeonatos-nacionales-2026.html
//                     /en/2026-national-championships/
//  Rejilla de países × pruebas de los Campeonatos Nacionales.
//  Reutiliza los botones de assets, el badge de TV y el modal de
//  carrera de la vista de competición (race-assets.js / race-data-modal.js).
// ─────────────────────────────────────────────────────────────────

import { supabase, setMeta, setMetaProperty, jornadaUrl, setPressed } from './shared.js';
import { getLang, initI18n } from './i18n.js';
import { openRaceDataModal, openResultsModal } from './race-data-modal.js';
import { initCintillo } from './cintillo.js';
import { CAMP } from './campeonatos-config.js';
import { campDefaultFilter, campEmptyHtml, campGridHtml, campPageHtml, prepareChampionships } from './campeonatos-html.js';

// Mapas para resolver el modal al hacer click en una celda y estado del filtrado.
let _state = null;
let _campFilter = 'all';

async function init() {
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const content = document.getElementById('campeonatosContent');
  const isEn = getLang() === 'en';

  updateSeo();
  initCintillo(); // cintillo (today_highlights), igual que la portada "Hoy"

  try {
    // Carreras CN del año dentro del rango de fechas con sus jornadas
    // publicadas, emisiones, assets y clasificaciones in-house embebidas: una
    // sola consulta, a la vez que el diccionario EN.
    const [{ data: racesData, error: racesErr }] = await Promise.all([
      supabase.from('races')
        .select('*,race_days(*,broadcasts(*),assets(*)),race_uci_stages(raceId,raceDayId,stageNumber)')
        .eq('uciCategory', 'CN').eq('year', CAMP.YEAR)
        .gte('startDate', CAMP.QUERY_START).lte('startDate', CAMP.QUERY_END)
        .eq('race_days.editorialStatus', 'published')
        .eq('race_uci_stages.keepForWeb', true).gt('race_uci_stages.rowCount', 0),
      initI18n(),
    ]);
    if (racesErr) throw racesErr;
    _state = prepareChampionships(racesData);
    if (!_state) {
      content.innerHTML = campEmptyHtml(isEn);
      fireAnalytics();
      return;
    }
    // Filtro "Hoy": solo del 24 al 28 de junio (ambos inclusive). Cuando aparece
    // es el primero y el predeterminado; filtra por la jornada del día en curso.
    _campFilter = campDefaultFilter();
    content.innerHTML = campPageHtml(_state, _campFilter);

    // Filtros (Todas/Pro/Masc/Fem) — estado local, sin persistencia.
    document.getElementById('campFilters').addEventListener('click', e => {
      const btn = e.target.closest('.tcat-btn');
      if (!btn) return;
      _campFilter = btn.dataset.campFilter;
      document.querySelectorAll('#campFilters .tcat-btn').forEach(b =>
        setPressed(b, b.dataset.campFilter === _campFilter));
      document.getElementById('campGrid').innerHTML = campGridHtml(_state, _campFilter);
    });

    // Click en celda (zona sin botones/badges) → modal de carrera.
    content.addEventListener('click', e => {
      // Trofeo de resultados in-house → openResultsModal (redirige a /resultados/).
      const trophy = e.target.closest('.camp-inhouse-trophy');
      if (trophy) {
        const cell = trophy.closest('.camp-cell');
        const rd   = _state.rdById[cell?.dataset.rdid];
        const race = _state.raceById[cell?.dataset.raceid];
        if (rd) openResultsModal(rd, race);
        return;
      }
      const cell = e.target.closest('.camp-cell');
      if (!cell) return;
      if (e.target.closest('a.badge, button.badge, .badge--tv-link')) return;
      const nav = cell.dataset.nav;
      if (!nav) return; // celda sin datos → no clicable (mismas condiciones que Hoy)
      const rd   = _state.rdById[cell.dataset.rdid];
      const race = _state.raceById[cell.dataset.raceid];
      if (!rd) return;
      if (nav === 'jornada') { sessionStorage.removeItem('cc_nav'); window.location.href = jornadaUrl(rd); }
      else { openRaceDataModal(rd, race); }
    });

    fireAnalytics();
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="camp-wrap"><div class="empty-state"><div class="empty-state__text">${
      isEn ? 'Error loading the championships.' : 'Error al cargar los campeonatos.'}</div></div></div>`;
  }
}

function updateSeo() {
  const isEn = getLang() === 'en';
  const title = `${isEn ? CAMP.TITLE_EN : CAMP.TITLE_ES} ${CAMP.YEAR} - Calendario Ciclismo`;
  const desc  = isEn ? CAMP.DESC_EN : CAMP.DESC_ES;
  const url   = isEn
    ? `https://calendariociclismo.app/en/${CAMP.SLUG_EN}/`
    : `https://calendariociclismo.app/${CAMP.SLUG_ES}.html`;

  document.title = title;
  setMeta('description', desc);

  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = url;

  setMetaProperty('og:title', title);
  setMetaProperty('og:description', desc);
  setMetaProperty('og:url', url);
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
}

function fireAnalytics() {
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
}

/** @public la isla de la publicación por página (tools/publicacion/cliente/isla-campeonatos.js). */
export const campeonatosListos = init();
