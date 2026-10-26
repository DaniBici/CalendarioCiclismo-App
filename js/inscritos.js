// ─────────────────────────────────────────────────────────────────
//  INSCRITOS — lista de equipos y corredores inscritos
//  URL: inscritos.html?race=RACE_ID  o  /inscritos/RACE_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, setMeta, setMetaProperty, raceUrl,
         raceName as getRaceName, enBase,
         seoLongDate, seoDayMonth, articuloNombre, conArticulo, originalNameDistinto, raceSearchName, loadRaceTechnicalGuide, withRaceTechnicalGuide,
         setRaceRobots, setHreflangPair } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { generateStartlistPDF, preload as preloadPDF } from './inscritos-pdf.js';
import { resolveStartlistRace, loadStartlistData, startlistHeroInfo, startlistPdfOptions } from './startlist/data.js';
import { setupRiderTooltips } from './rider-tooltip.js';
import { inscritosHtml, pdfButtonInner } from './inscritos-html.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';

// ── SEO helpers ──────────────────────────────────────────────────────
function buildFechaParentesis(race, lang) {
  const sd = race.startDate || '';
  const ed = race.endDate   || '';
  if (!sd) return race.year ? `(${race.year})` : '';

  // Formato fijo por idioma (sin ICU) — esta fecha se embebe en title/description/og,
  // que Googlebot indexa; toLocaleDateString caería a inglés en su renderer. Ver shared.js.
  const fmtFull = (dateKey) => seoLongDate(dateKey, lang);
  const fmtDayMonth = (dateKey, includeMonth) =>
    includeMonth ? seoDayMonth(dateKey, lang) : String(dateKey.split('-').map(Number)[2]);

  if (!ed || sd === ed) return `(${fmtFull(sd)})`;

  const multiMonth = sd.slice(0, 7) !== ed.slice(0, 7);
  return `(${fmtDayMonth(sd, multiMonth)} – ${fmtFull(ed)})`;
}

async function init() {
  // El diccionario EN se carga a la vez que los datos; se espera antes de pintar.
  const i18nReady = initI18n();
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  const params  = new URLSearchParams(window.location.search);
  const content = document.getElementById('inscritosContent') || document.getElementById('startlistContent');
  let raceId    = params.get('race');
  let slug      = params.get('slug');
  const _isEn   = getLang() === 'en';

  // Leer slug del path — soporta /inscritos/SLUG/ y /en/startlist/SLUG/
  if (!raceId && !slug) {
    const pathMatch = location.pathname.match(/^\/(inscritos|en\/startlist|startlist)\/([^\/]+)\/?$/);
    if (pathMatch) slug = decodeURIComponent(pathMatch[2]);
  }

  // Resolve slug → raceId (en EN busca primero por slugEn)
  const race = await resolveStartlistRace({ raceId, slug, isEn: _isEn });
  if (race) raceId = race.id;
  await i18nReady;

  if (!race) {
    applyPrerenderedHtml(content, `<div class="startlist-empty">${t('startlist.notFound')}</div>`);
    return;
  }

  // Actualizar mensaje de carga en femenino si aplica
  if (race.gender === 'female') {
    const loadingEl = content.querySelector('.loading');
    if (loadingEl) loadingEl.textContent = t('startlist.loading');
  }

  // Actualizar URL al path limpio correcto según idioma
  if (_isEn && (race.slugEn || race.slug)) {
    const _slEnB = enBase();
    history.replaceState(null, '', `${_slEnB}/startlist/${encodeURIComponent(race.slugEn || race.slug)}/`);
  } else if (!_isEn && race.slug) {
    history.replaceState(null, '', `/inscritos/${encodeURIComponent(race.slug)}/`);
  }

  // Equipos, corredores, colores de temporada y abandonos (startlist/data.js,
  // compartido con la página que generan las apps).
  // ── Jornada única + assets (solo pruebas de UN DÍA) ──
  // En one_day el panel de botones muestra el recorrido (rutómetro/perfil/…),
  // que vive en la jornada y sus assets. En vueltas por etapas NO se cargan:
  // el panel solo lleva web oficial + "Ir a la carrera" (la startlist es de la
  // carrera entera, no de una etapa). Se piden junto con la startlist, con el
  // mismo orden que el build (desempate y documentos por id).
  const oneDayRequest = race.raceFormat === 'one_day'
    ? supabase.from('race_days')
      .select('*,assets(*)').eq('raceId', raceId).eq('editorialStatus', 'published')
      .order('dateKey', { ascending: true }).order('id')
      .order('id', { referencedTable: 'assets' })
      .limit(1).maybeSingle()
    : Promise.resolve({ data: null });
  const [data, { data: oneDayRow }] = await Promise.all([loadStartlistData(race), oneDayRequest]);
  if (!data) {
    applyPrerenderedHtml(content, `<div class="startlist-empty">${t('startlist.empty')}</div>`);
    return;
  }
  const { totalTeams, totalRiders } = data;

  const { assets: oneDayAssetRows, ...oneDayFields } = oneDayRow || {};
  const oneDayRd = oneDayRow ? oneDayFields : null;
  const oneDayAssets = oneDayAssetRows || [];

  // Update page title & SEO
  const raceName = getRaceName(race) || t('race.unknown');
  const origName = originalNameDistinto(raceName, race.originalName);
  const nameWithOrig = origName ? `${raceName} (${origName})` : raceName;
  const year = race.year || new Date().getFullYear();
  const art = articuloNombre(raceName);
  const artCap = art.charAt(0).toUpperCase() + art.slice(1);

  // Fechas entre paréntesis
  const fechaParentesis = buildFechaParentesis(race, _isEn ? 'en' : 'es');

  const inscritosLabel = race.startlistProvisional
    ? t('startlist.provisional')
    : (race.gender === 'female' ? t('startlist.labelFemale') : t('startlist.label'));
  const siteName = t('seo.siteName');
  const provisionalNote = race.startlistProvisional ? t('startlist.provisionalNote') : '';
  const isFemale = race.gender === 'female';
  // ES: «Vuelta a España 2026: dorsales y corredores inscritos». Paridad con gen_og_pages.py.
  const riderPhraseEs = isFemale ? 'corredoras inscritas' : 'corredores inscritos';
  const titleTailEs = race.startlistProvisional ? 'lista provisional de inscritos' : `dorsales y ${riderPhraseEs}`;
  const title = _isEn
    ? `${inscritosLabel} - ${raceName} ${fechaParentesis} - ${siteName}`
    : `${raceSearchName(race, raceName)} ${year}: ${titleTailEs} - ${siteName}`;
  const nameConArt = conArticulo(raceName, nameWithOrig, art);
  let description;
  if (_isEn) {
    description = (totalRiders > 0 && totalTeams > 0)
      ? `Startlist with ${totalTeams} teams and ${totalRiders} riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`
      : totalRiders > 0
        ? `Startlist with ${totalRiders} riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`
        : `Startlist of teams and riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`;
  } else {
    const riderPhrase = riderPhraseEs;
    description = (totalRiders > 0 && totalTeams > 0)
      ? `Lista de ${totalTeams} equipos y ${totalRiders} ${riderPhrase} en ${nameConArt} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`
      : totalRiders > 0
        ? `Lista de ${totalRiders} ${riderPhrase} en ${nameConArt} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`
        : `Lista de equipos y ${riderPhrase} en ${nameConArt} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`;
  }

  // Keywords: mismas de competición + específicas de inscritos
  const BASE_KW = 'calendario ciclismo, ciclismo donde echan, ciclismo por TV, ciclismo streaming, Danibici, Dani Sánchez, calendario ciclismo app, calendario ciclista, horarios carrera ciclismo';
  const kwParts = [
    BASE_KW,
    raceName,
    `${raceName} ${year}`,
    origName,
    'inscritos',
    'startlist',
    'dorsales',
    'equipos',
  ].filter(Boolean);
  const keywords = kwParts.join(', ');

  const ogImage = 'https://assets.calendariociclismo.app/og/calendario-ciclismo.jpg';

  document.title = title;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
  setMeta('description', description);
  setMeta('keywords', keywords);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
  setMetaProperty('og:image', ogImage);
  setMetaProperty('og:image:width',  '1200');
  setMetaProperty('og:image:height', '630');
  setMetaProperty('og:image:alt', 'Calendario Ciclismo');

  // Twitter Card
  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', description);
  setMeta('twitter:image', ogImage);
  setMeta('twitter:image:alt', 'Calendario Ciclismo');

  // Canonical + og:url
  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : location.origin;
  const _canonSlug = (_isEn && race.slugEn) ? race.slugEn : race.slug;
  const _canonBase = _isEn ? '/en/startlist/' : '/inscritos/';
  const canonicalUrl = _canonSlug
    ? `${origin}${_canonBase}${encodeURIComponent(_canonSlug)}/`
    : location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
  setRaceRobots(race);
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;
  setHreflangPair(
    race.slug ? `${origin}/inscritos/${encodeURIComponent(race.slug)}/` : canonicalUrl,
    race.slugEn ? `${origin}/en/startlist/${encodeURIComponent(race.slugEn)}/` : (_isEn ? canonicalUrl : null),
  );

  // JSON-LD BreadcrumbList
  const crumbItems = [
    { '@type': 'ListItem', 'position': 1, 'name': 'Inicio', 'item': `${origin}/` },
    { '@type': 'ListItem', 'position': 2, 'name': `Temporada ${year}`, 'item': `${origin}/calendario/?year=${year}` },
  ];
  if (race.slug) {
    crumbItems.push({ '@type': 'ListItem', 'position': 3, 'name': `${raceName} ${year}`,
                      'item': `${origin}/competicion/${encodeURIComponent(race.slug)}/` });
  }
  crumbItems.push({ '@type': 'ListItem', 'position': crumbItems.length + 1, 'name': inscritosLabel });
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': crumbItems,
  };
  // EN: conservar el JSON-LD inglés del HTML estático (este constructor es solo ES).
  if (getLang() !== 'en') {
    let ldBc = document.getElementById('jsonld-breadcrumbs');
    if (!ldBc) {
      ldBc = document.createElement('script');
      ldBc.id = 'jsonld-breadcrumbs';
      ldBc.type = 'application/ld+json';
      document.head.appendChild(ldBc);
    }
    ldBc.textContent = JSON.stringify(crumbs);
  }

  // Back button — return to referring page if from same origin, else to competicion
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    const referrer = document.referrer;
    const sameOrigin = referrer && new URL(referrer, location.href).origin === location.origin;
    if (sameOrigin && referrer) {
      backBtn.href = referrer;
      backBtn.addEventListener('click', (e) => { e.preventDefault(); history.back(); });
    } else {
      backBtn.href = raceUrl(race);
    }
  }

  // Render: la página generada en el build con el mismo HTML se conserva
  // (js/html-fingerprint.js) y solo se montan el tooltip y el botón del PDF.
  const html = inscritosHtml(race, data, {
    oneDayRd,
    assets: withRaceTechnicalGuide(oneDayAssets, await loadRaceTechnicalGuide(race.id)),
  });
  applyPrerenderedHtml(content, html);

  // ── Tooltip de corredor (hover en desktop / tap en táctil) ──
  setupRiderTooltips(content);

  // ── PDF download button ──
  const pdfBtn = document.getElementById('btnDescargarPdf');
  if (pdfBtn) {
    pdfBtn.addEventListener('mouseenter', preloadPDF, { once: true });
    pdfBtn.addEventListener('touchstart', preloadPDF, { once: true });
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      pdfBtn.textContent = t('startlist.generatingPdf');
      try {
        await generateStartlistPDF(startlistPdfOptions(race, data, startlistHeroInfo(race, data.raceDays)));
      } catch (err) {
        console.error('Error generando PDF:', err);
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = pdfButtonInner();
      }
    });
  }
}

init();
