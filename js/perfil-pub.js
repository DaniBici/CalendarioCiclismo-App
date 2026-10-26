import { supabase, stageLabel,
         setMeta as setM, setMetaProperty as setMP,
         loadRaceTechnicalGuide, withRaceTechnicalGuide, enBase,
         seoLongDate, deArticulo, setRaceRobots,
         embeddedId, orEqFilter, pickByPreference } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { mountStageProfile } from './stage/profile.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';
import { perfilHtml, stagePageNoticeHtml } from './perfil-mapa-html.js';
import { PERFIL_DAY_COLUMNS, PERFIL_SIBLING_COLUMNS, STAGE_PAGE_RACE_COLUMNS, sortStagePageSiblings } from './services/races.js';

const params  = new URLSearchParams(location.search);
const content = document.getElementById('perfilEtapaContent');
const backBtn = document.getElementById('backBtn');

// ── Resolve id/slug — pathname takes priority for clean URLs ─────
function slugFromPath() {
  const m = location.pathname.match(/\/(?:perfil|(?:en\/)?profile)\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}
const idOrSlug = slugFromPath() || params.get('slug') || params.get('id');

window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente

if (!idOrSlug) {
  content.innerHTML = `<p class="pfe-loading">${t('profile.notFound')}</p>`;
} else {
  // El diccionario EN se carga a la vez que los datos; se espera antes de pintar.
  loadProfile(idOrSlug, initI18n());
}

// ── Load ──────────────────────────────────────────────────────────
async function loadProfile(idOrSlug, i18nReady = Promise.resolve()) {
  const isEn = getLang() === 'en';

  // Página pre-renderizada: el build incrusta el id de la jornada. Si no,
  // una sola consulta por slug, slugEn o id (en ese orden de preferencia),
  // con la carrera embebida. Mismas columnas que el build
  // (tools/site/prerender-auxiliares.mjs).
  const select = `${PERFIL_DAY_COLUMNS},race:races(${STAGE_PAGE_RACE_COLUMNS})`;
  const pageId = embeddedId('race-day-id');
  let row = null, error = null;
  if (pageId) ({ data: row, error } = await supabase.from('race_days').select(select).eq('id', pageId).maybeSingle());
  if (!row && !error) {
    const columns = ['slug', 'slugEn', 'id'];
    const response = await supabase.from('race_days').select(select).or(orEqFilter(columns, idOrSlug)).limit(3);
    error = response.error;
    row = pickByPreference(response.data, columns, idOrSlug);
  }
  const { race: raceRow = null, ...rd } = row || {};
  await i18nReady;

  if (error || !row) {
    applyPrerenderedHtml(content, stagePageNoticeHtml('profile.notFound'));
    return;
  }

  if (rd.profileNotViewable) {
    applyPrerenderedHtml(content, stagePageNoticeHtml('profile.notAvailable'));
    return;
  }

  const race = raceRow;
  // Guía técnica, assets de la jornada (panel de botones) y etapas hermanas
  // (navegación, solo en carreras por etapas) dependen solo de la jornada.
  // Listas por id, como el build.
  const [technicalGuide, { data: pfAssets }, siblingsResult] = await Promise.all([
    race?.id ? loadRaceTechnicalGuide(race.id) : Promise.resolve(null),
    supabase.from('assets').select('*').eq('raceDayId', rd.id).order('id'),
    rd.raceId && race?.raceFormat !== 'one_day'
      ? supabase.from('race_days').select(PERFIL_SIBLING_COLUMNS)
        .eq('raceId', rd.raceId).eq('editorialStatus', 'published').order('id')
      : Promise.resolve({ data: null }),
  ]);

  const siblings = siblingsResult.data ? sortStagePageSiblings(siblingsResult.data) : [];

  const stageSlug = isEn && rd.slugEn ? rd.slugEn : rd.slug;
  const _pEnB = isEn ? enBase() : null;
  const jornadaHref = isEn
    ? (stageSlug ? `${_pEnB}/stage/${encodeURIComponent(stageSlug)}/` : `/jornada.html?id=${rd.id}`)
    : (rd.slug   ? `/jornada/${encodeURIComponent(rd.slug)}/`    : `/jornada.html?id=${rd.id}`);

  // La flecha de retroceso lleva SIEMPRE a la jornada del perfil,
  // independientemente de dónde se haya llegado.
  if (backBtn) {
    backBtn.href = jornadaHref;
    backBtn.setAttribute('aria-label', t('profile.backToStage'));
  }

  render(rd, race, siblings, withRaceTechnicalGuide(pfAssets || [], technicalGuide));
}

// ── Render ────────────────────────────────────────────────────────
function render(rd, race, siblings, assets = []) {
  const isEn    = getLang() === 'en';

  const name  = (isEn && race?.nameEn) || race?.name || '';
  const year  = race?.year ?? '';
  const stage = stageLabel(rd.stageNumber);

  // ── Title & SEO ───────────────────────────────────────────────
  const racePart  = name ? `${name}${year ? ' ' + year : ''}` : '';
  const stagePart = (!rd.isRestDay && rd.stageNumber != null) ? stage : '';
  const fullTitle = [racePart, stagePart].filter(Boolean).join(' · ');
  const siteName  = t('seo.siteName');
  const pageTitle = `${t('profile.pageTitle')} - ${fullTitle} - ${siteName}`;

  // «Perfil y recorrido de [la Nª etapa del] X 2026: NNN km con salida en A
  // y meta en B. D de mes de YYYY.» — espejo en og-pages.yml (perfiles ES/EN).
  const startLoc  = (isEn && rd.startLocationEn)  || rd.startLocation  || '';
  const finishLoc = (isEn && rd.finishLocationEn) || rd.finishLocation || '';
  const circuit   = !finishLoc || startLoc === finishLoc;
  const kmTxt     = rd.distanceKm ? `${Number(rd.distanceKm).toLocaleString(isEn ? 'en-GB' : 'es-ES')} km` : '';
  let locTxt = '';
  if (startLoc) {
    if (isEn) locTxt = circuit ? `starting and finishing in ${startLoc}` : `from ${startLoc} to ${finishLoc}`;
    else      locTxt = circuit ? `con inicio y final en ${startLoc}` : `con salida en ${startLoc} y meta en ${finishLoc}`;
  }
  const isOneDay = race?.raceFormat === 'one_day';
  const sn = (!isOneDay && !rd.isRestDay && rd.stageNumber != null) ? rd.stageNumber : null;
  let head;
  if (isEn) {
    head = sn == null ? `Profile and route of ${racePart}`
         : sn === 0   ? `Profile and route of the prologue of ${racePart}`
         :              `Profile and route of stage ${sn} of ${racePart}`;
  } else {
    const deArt = deArticulo(name);
    head = sn == null ? `Perfil y recorrido de ${racePart}`
         : sn === 0   ? `Perfil y recorrido del prólogo ${deArt} ${racePart}`
         :              `Perfil y recorrido de la ${sn}ª etapa ${deArt} ${racePart}`;
  }
  const descTail = [kmTxt, locTxt].filter(Boolean).join(' ');
  let desc = descTail ? `${head}: ${descTail}.` : `${head}.`;
  if (rd.dateKey) desc += ` ${seoLongDate(rd.dateKey, isEn ? 'en' : 'es')}.`;

  document.title = pageTitle;
  setM('description', desc);
  setMP('og:title',       pageTitle);
  setMP('og:description', desc);
  setMP('og:url',         location.href);
  setM('twitter:title',       pageTitle);
  setM('twitter:description', desc);

  const canonicalBase = isEn ? 'https://calendariociclismo.app/en/profile/' : 'https://calendariociclismo.app/perfil/';
  const canonicalFallback = isEn
    ? `https://calendariociclismo.app/en/profile/?id=${rd.id}`
    : `https://calendariociclismo.app/perfil.html?id=${rd.id}`;
  const profileSlug = (isEn && rd.slugEn) ? rd.slugEn : rd.slug;
  const canonical = profileSlug
    ? `${canonicalBase}${encodeURIComponent(profileSlug)}/`
    : canonicalFallback;
  setRaceRobots(race);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);

  // Expose cross-language alternates for lang switcher
  if (!isEn && rd.slugEn) {
    const enUrl = `https://calendariociclismo.app/en/profile/${encodeURIComponent(rd.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (isEn && rd.slug) {
    const esUrl = `https://calendariociclismo.app/perfil/${encodeURIComponent(rd.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // Limpiar URL si llegamos por ?id= o ?slug= con slug disponible
  const _profEnB = isEn ? enBase() : null;
  const cleanBase = isEn ? `${_profEnB}/profile/` : '/perfil/';
  const isCleanPath = location.pathname.startsWith(cleanBase) && location.pathname !== cleanBase;
  if (profileSlug && !isCleanPath) {
    history.replaceState({}, '', `${cleanBase}${encodeURIComponent(profileSlug)}/`);
  }
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

  // Contenido (js/perfil-mapa-html.js): la página generada en el build con el
  // mismo HTML se conserva y solo se monta lo interactivo.
  applyPrerenderedHtml(content, perfilHtml({ rd, race, siblings, assets }));
  mountStageProfile(document.getElementById('pfeProfile'), { day:rd, race:race || {}, assets, points:true });
}
