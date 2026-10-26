// ─────────────────────────────────────────────────────────────────
//  ORDEN DE SALIDA — Contrarreloj individual / por equipos
//  URL: orden-salida.html?id=RD_ID  o  /orden-salida/RD_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, setMeta, setMetaProperty, jornadaUrl,
         raceName as getRaceName, enBase,
         loadRaceTechnicalGuide, withRaceTechnicalGuide, setPressed, setRaceRobots,
         embeddedId, orEqFilter, pickByPreference } from './shared.js';
import { getLang, initI18n } from './i18n.js';
import { mountStageProfile } from './stage/profile.js';
import { startlistTeamsQuery } from './team-appearance.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';
import { STAGE_TYPE_LABELS, ordenSalidaEmptyHtml, ordenSalidaHtml } from './orden-salida-html.js';

async function init(i18nReady = Promise.resolve()) {
  window.__spaDrivenAnalytics = true;
  const params  = new URLSearchParams(window.location.search);
  const content = document.getElementById('startOrderContent');
  const _isEn   = getLang() === 'en';

  let rdId = params.get('id');
  let slug = params.get('slug');

  if (!rdId && !slug) {
    const m = location.pathname.match(/^\/(orden-salida|en\/start-order|start-order)\/([^\/]+)\/?$/);
    if (m) slug = decodeURIComponent(m[2]);
  }
  // Página pre-renderizada: el build incrusta el id de la jornada.
  if (!rdId && !params.get('slug')) rdId = embeddedId('race-day-id');

  // Jornada con la carrera embebida. Por slug, una sola consulta: en EN se
  // prefiere slugEn y se admite slug.
  const DAY_WITH_RACE = '*,race:races(*)';
  let row = null;
  if (rdId) {
    const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).eq('id', rdId).maybeSingle();
    row = data;
  }
  if (!row && slug) {
    const columns = _isEn ? ['slugEn', 'slug'] : ['slug'];
    const { data } = await supabase.from('race_days').select(DAY_WITH_RACE).or(orEqFilter(columns, slug)).limit(4);
    row = pickByPreference(data, columns, slug);
  }

  if (!row) {
    await i18nReady;
    applyPrerenderedHtml(content, `<div class="startlist-empty">${_isEn ? 'Start order not found.' : 'No se encontró el orden de salida.'}</div>`);
    return;
  }
  const { race, ...rd } = row;
  rdId = rd.id;

  const canonSlug = _isEn ? (rd.slugEn || rd.slug) : rd.slug;
  const canonBase = _isEn ? `${enBase()}/start-order/` : '/orden-salida/';
  history.replaceState(null, '', canonSlug
    ? `${canonBase}${encodeURIComponent(canonSlug)}/`
    : `/orden-salida.html?id=${rdId}`);

  // Orden, assets de la jornada (panel de botones común), equipos de la
  // startlist con su temporada y guía técnica: todo depende solo de la jornada.
  // Listas con desempate por id, como el build (tools/site/prerender-auxiliares.mjs).
  const [{ data: entries, error }, { data: soAssets }, { data: startlistRows }, technicalGuide] = await Promise.all([
    supabase.from('start_order_entries_resolved').select('*').eq('raceDayId', rdId).order('sortOrder', { ascending: true }).order('id'),
    supabase.from('assets').select('*').eq('raceDayId', rdId).order('id'),
    startlistTeamsQuery(supabase, rd.raceId, race?.year, 'teamId'),
    race?.id ? loadRaceTechnicalGuide(race.id) : Promise.resolve(null),
    i18nReady,
  ]);

  if (error || !entries || entries.length === 0) {
    applyPrerenderedHtml(content, ordenSalidaEmptyHtml());
    return;
  }

  const isTtt = rd.primaryType === 'ttt';
  const raceName = getRaceName(race) || '';
  const year = race?.year || '';
  const stageLabel = rd.stageNumber === 0
    ? (_isEn ? 'Prologue' : 'Prólogo')
    : rd.stageNumber != null
      ? (_isEn ? `Stage ${rd.stageNumber}` : `Etapa ${rd.stageNumber}`)
      : '';
  const typeEntry = STAGE_TYPE_LABELS[rd.primaryType];
  const typeLabel = typeEntry ? typeEntry[_isEn ? 'en' : 'es'] : (_isEn ? 'Time trial' : 'Contrarreloj');

  const heroTitle = [raceName, year].filter(Boolean).join(' ');
  const stageSuffix = stageLabel ? ` - ${stageLabel}` : '';
  const pageTitle = _isEn
    ? `Start order - ${heroTitle}${stageSuffix}`
    : `Orden de salida - ${heroTitle}${stageSuffix}`;

  document.title = pageTitle;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  setMeta('description', _isEn
    ? `Start order for the ${typeLabel.toLowerCase()} of ${heroTitle}. ${isTtt ? 'Start times for each team.' : 'Individual start times for each rider.'}`
    : `Orden de salida de la ${typeLabel.toLowerCase()} de ${heroTitle}. ${isTtt ? 'Horarios de salida de cada equipo.' : 'Horarios de salida de cada corredor.'}`);
  setMetaProperty('og:title', pageTitle);

  const esOrigin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
  // El canonical siempre apunta a calendariociclismo.app con la ruta correcta por idioma
  const canonicalUrl = canonSlug
    ? (_isEn
        ? `${esOrigin}/en/start-order/${encodeURIComponent(rd.slugEn || rd.slug)}/`
        : `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`)
    : location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
  setRaceRobots(race);
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;

  // hreflang alternates
  const setAlternate = (hreflang, href) => {
    let el = document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`);
    if (!el) { el = document.createElement('link'); el.rel = 'alternate'; el.hreflang = hreflang; document.head.appendChild(el); }
    el.href = href;
  };
  if (!_isEn && rd.slugEn) {
    setAlternate('en', `${esOrigin}/en/start-order/${encodeURIComponent(rd.slugEn || rd.slug)}/`);
  }
  if (_isEn && rd.slug) {
    setAlternate('es', `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`);
    setAlternate('x-default', `${esOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`);
  }

  // Botón back
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    const referrer = document.referrer;
    const sameOrigin = referrer && new URL(referrer, location.href).origin === location.origin;
    if (sameOrigin && referrer) {
      backBtn.href = referrer;
      backBtn.addEventListener('click', e => { e.preventDefault(); history.back(); });
    } else {
      backBtn.href = jornadaUrl(rd);
    }
  }

  // Contenido (js/orden-salida-html.js): la página generada en el build con el
  // mismo HTML se conserva y solo se monta lo interactivo.
  const contextAssets = withRaceTechnicalGuide(soAssets || [], technicalGuide);
  const { html, hasFilters } = ordenSalidaHtml({ rd, race, entries, startlistRows, assets: contextAssets });
  applyPrerenderedHtml(content, html);
  const cleanupProfile = mountStageProfile(document.getElementById('soProfile'), {
    day: rd, race, assets: contextAssets, hidePointNames: true,
  });
  window.addEventListener('pagehide', cleanupProfile, { once: true });

  syncFiltersHeight(content.querySelector('#soFilters'));

  if (hasFilters) {
    const tableWrap = content.querySelector('.so-table-wrap');
    content.querySelectorAll('#soFilters .tcat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('#soFilters .tcat-btn').forEach(b => setPressed(b, b === btn));
        tableWrap.classList.remove('so-filter--tt', 'so-filter--gc');
        if (btn.dataset.filter !== 'all') tableWrap.classList.add(`so-filter--${btn.dataset.filter}`);
      });
    });
  }
}

// Altura de la barra de filtros fija: la fila de columnas se fija debajo
// (--res-tabs-h, resultados.css). Sin filtros se fija bajo la navegación.
function syncFiltersHeight(bar) {
  const root = document.documentElement;
  if (!bar) { root.style.removeProperty('--res-tabs-h'); return; }
  const update = () => root.style.setProperty('--res-tabs-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  update();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(bar);
}

// Esperar a cargar las traducciones (en.json) antes de renderizar: el panel de
// botones usa t('assets.*'), que sin esto cae al diccionario ES embebido.
// El diccionario EN se carga a la vez que los datos; init lo espera antes de pintar.
init(initI18n());
