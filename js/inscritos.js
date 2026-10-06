import { teamHeaderColors } from './team-appearance.js';
// ─────────────────────────────────────────────────────────────────
//  INSCRITOS — lista de equipos y corredores inscritos
//  URL: inscritos.html?race=RACE_ID  o  /inscritos/RACE_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, esc, setMeta, setMetaProperty, raceUrl,
         buildTeamBadgeSvg, raceName as getRaceName, enBase,
         seoLongDate, seoDayMonth, buildRaceHeader, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide,
         isNoTeamPlaceholderTeam, setRaceRobots, setHreflangPair } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { generateStartlistPDF, preload as preloadPDF } from './inscritos-pdf.js';
import { resolveStartlistRace, loadStartlistData, startlistHeroInfo, startlistPdfOptions } from './startlist/data.js';
import { setupRiderTooltips } from './rider-tooltip.js';

// ── SEO helpers ──────────────────────────────────────────────────────
function articuloNombre(name) {
  const firstWord = (name || '').trim().split(/\s+/)[0].toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const masculinos = [
    'tour', 'giro', 'gran', 'grande', 'campeonato', 'criterium', 'critérium',
    'circuito', 'circuit', 'grand', 'trofeo', 'trophee', 'trophée',
    'memorial', 'premio', 'prix', 'open', 'paris', 'eschborn'
  ];
  return masculinos.includes(firstWord) ? 'el' : 'la';
}

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
  await initI18n();
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

  if (!race) {
    content.innerHTML = `<div class="startlist-empty">${t('startlist.notFound')}</div>`;
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
  const data = await loadStartlistData(race);
  if (!data) {
    content.innerHTML = `<div class="startlist-empty">${t('startlist.empty')}</div>`;
    return;
  }
  const { raceDays, teams, ridersByTeam, globalTeamById, riderOutMap, totalTeams, totalRiders } = data;

  // ── Jornada única + assets (solo pruebas de UN DÍA) ──
  // En one_day el panel de botones muestra el recorrido (rutómetro/perfil/…),
  // que vive en la jornada y sus assets. En vueltas por etapas NO se cargan:
  // el panel solo lleva web oficial + "Ir a la carrera" (la startlist es de la
  // carrera entera, no de una etapa).
  let oneDayRd = null;
  let oneDayAssets = [];
  if (race.raceFormat === 'one_day') {
    const { data: rdRow } = await supabase.from('race_days')
      .select('*').eq('raceId', raceId).eq('editorialStatus', 'published')
      .order('dateKey', { ascending: true }).limit(1).maybeSingle();
    if (rdRow) {
      oneDayRd = rdRow;
      const { data: aRows } = await supabase.from('assets').select('*').eq('raceDayId', rdRow.id);
      oneDayAssets = aRows || [];
    }
  }

  // Update page title & SEO
  const raceName = getRaceName(race) || t('race.unknown');
  const origName = race.originalName || '';
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
  const title = `${inscritosLabel} — ${raceName} ${fechaParentesis} — ${siteName}`;
  const provisionalNote = race.startlistProvisional ? t('startlist.provisionalNote') : '';
  const isFemale = race.gender === 'female';
  let description;
  if (_isEn) {
    description = (totalRiders > 0 && totalTeams > 0)
      ? `Startlist with ${totalTeams} teams and ${totalRiders} riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`
      : totalRiders > 0
        ? `Startlist with ${totalRiders} riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`
        : `Startlist of teams and riders for ${raceName} ${fechaParentesis}${provisionalNote}. Dorsals and participants.`;
  } else {
    const riderPhrase = isFemale ? 'corredoras inscritas' : 'corredores inscritos';
    description = (totalRiders > 0 && totalTeams > 0)
      ? `Lista de ${totalTeams} equipos y ${totalRiders} ${riderPhrase} en ${art} ${nameWithOrig} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`
      : totalRiders > 0
        ? `Lista de ${totalRiders} ${riderPhrase} en ${art} ${nameWithOrig} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`
        : `Lista de equipos y ${riderPhrase} en ${art} ${nameWithOrig} ${fechaParentesis}${provisionalNote}. Dorsales y participantes.`;
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

  const DEFAULT_OG_IMAGE = 'https://pub-10252f2a495c488a856a619206783642.r2.dev/og-default.png';
  const OG_WORKER = 'https://og.calendariociclismo.app';
  const ogImage = (race.logoUrl && race.logoUrl.startsWith('https://assets.calendariociclismo.app/'))
    ? `${OG_WORKER}/?logo=${encodeURIComponent(race.logoUrl)}&title=${encodeURIComponent(inscritosLabel + ' — ' + raceName + ' ' + year)}`
    : DEFAULT_OG_IMAGE;

  document.title = title;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });
  setMeta('description', description);
  setMeta('keywords', keywords);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
  setMetaProperty('og:image', ogImage);
  setMetaProperty('og:image:width',  '1200');
  setMetaProperty('og:image:height', '630');
  setMetaProperty('og:image:alt', `${inscritosLabel} — ${raceName} ${year}`);

  // Twitter Card
  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', title);
  setMeta('twitter:description', description);
  setMeta('twitter:image', ogImage);
  setMeta('twitter:image:alt', `${inscritosLabel} — ${raceName} ${year}`);

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

  // Render
  const color = race.colorHex || '#888';   // usado en border-left de cabeceras de equipo

  // Hero secondary info (same as competicion + "Inscritos" highlighted)
  const { heroLabel, infoParts, heroSubline } = startlistHeroInfo(race, raceDays);

  // Panel de botones (web oficial · "Ir a la carrera" · recorrido en un día),
  // fuente única en shared.buildActionButtons. En vueltas por etapas solo salen
  // web oficial + "Ir a la carrera"; en un día, todo el recorrido de la jornada.
  const actionButtonsHtml = buildActionButtons({
    race,
    rd: oneDayRd || { id: race.id, slug: race.slug, slugEn: race.slugEn },
    view: 'inscritos',
    assets: withRaceTechnicalGuide(oneDayAssets, await loadRaceTechnicalGuide(race.id)),
    hasStartlist: false,
    style: 'margin:0.85rem auto', standalone: true,
  });

  const pdfAction = `<button class="btn-ical" id="btnDescargarPdf">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ${t('startlist.downloadPdf')}
        </button>`;
  // Sin equipos reales no se muestra "0 equipos": solo el total de corredores.
  const ridersWord = getLang() === 'en' ? 'riders' : (race.gender === 'female' ? 'corredoras' : 'corredores');
  const statsLine = totalTeams > 0
    ? `${totalTeams} ${getLang() === 'en' ? 'teams' : 'equipos'} · ${totalRiders} ${ridersWord}`
    : `${totalRiders} ${ridersWord}`;

  let html = buildRaceHeader({
    race,
    label: heroLabel,
    detail: infoParts,
    stats: statsLine,
    action: pdfAction,
  }) + `
    ${actionButtonsHtml}
    ${(() => {
      const notes = [];
      if (race.startlistProvisional) {
        const provText = getLang() === 'en'
          ? '<strong>Provisional Startlist</strong>; not considered final until the team managers meeting. This notice will disappear once it is official.'
          : '<strong>Lista provisional</strong>; no se considera definitiva hasta la reunión de directores. Esta indicación desaparecerá cuando sea oficial.';
        notes.push(`<span class="startlist-disclaimer startlist-disclaimer--provisional">${provText}</span>`);
      }
      return notes.length
        ? `<div class="startlist-toolbar">${notes.join('')}</div>`
        : '';
    })()}
    <div class="startlist-grid">
  `;

  teams.forEach(team => {
    const teamRiders = ridersByTeam[team.id] || [];
    // Estado sin equipo → ocultación cosmética: los corredores se listan, pero
    // la tarjeta va SIN cabecera de equipo (ni nombre, ni chapa).
    const hideHeader = isNoTeamPlaceholderTeam(team);
    const gTeam = team.teamId ? globalTeamById[team.teamId] : null;
    const enrichedClass = gTeam ? ' startlist-team__header--enriched' : '';
    const isWhiteBg = gTeam && /^#?(fff|ffffff)$/i.test((gTeam.headerBg || '').trim());
    const colors = teamHeaderColors(gTeam);
    const headerStyle = `background:${colors.background};color:${colors.text};border-left-color:${gTeam ? colors.background : color}`;
    // Nombre del equipo como texto plano (las fichas públicas de equipo se retiraron).
    const nameHtml = `<span class="startlist-team__name">${esc(team.displayName)}</span>`;
    const confirmHtml = race.startlistProvisional
      ? `<span class="startlist-team__confirm${team.isConfirmed ? ' startlist-team__confirm--yes' : ''}" title="${team.isConfirmed ? 'Confirmado' : 'Pendiente de confirmar'}">${team.isConfirmed
          ? `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect width="18" height="18" rx="4" fill="var(--accent)"/><path d="M5 9.5L7.5 12L13 6.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect width="18" height="18" rx="4" fill="#6b7280"/><path d="M6 6L12 12M12 6L6 12" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`
        }</span>`
      : '';
    const headerHtml = hideHeader ? '' : `
        <div class="startlist-team__header${enrichedClass}" style="${headerStyle}">
          ${nameHtml}
          ${confirmHtml}
        </div>`;
    html += `
      <div class="startlist-team${isWhiteBg ? ' startlist-team--white-bg' : ''}">${headerHtml}
        <div class="startlist-team__riders">
    `;
    teamRiders.forEach(r => {
      const flagHtml = r.countryCode ? countryFlag(r.countryCode) : '';
      const flagSpan = r.countryCode ? `<span class="startlist-rider__flag">${flagHtml}</span>` : '';
      // Fuera de carrera: si tiene globalRiderId y está en el mapa de abandonos.
      // El atributo lleva "irm|stageNumber" (stageNumber vacío en one-day) para
      // que el tooltip muestre el motivo ("ABN · etapa 2"). La clase --out tacha.
      // (Único data-* que sobrevive: las fichas públicas se retiraron.)
      const out = r.globalRiderId ? riderOutMap.get(r.globalRiderId) : null;
      const dnfAttr = out
        ? `data-rider-dnf="${esc(`${out.irm}|${out.stageNumber == null ? '' : out.stageNumber}`)}"`
        : '';
      const nameInner = `${esc(r.firstName)} ${esc(r.lastName)}`;
      const nameHtml = `<span class="startlist-rider__name">${nameInner}</span>`;
      html += `
          <div class="startlist-rider${out ? ' startlist-rider--out' : ''}" ${dnfAttr}>
            <span class="startlist-rider__dorsal">${r.dorsal || ''}</span>
            ${flagSpan}
            ${nameHtml}
          </div>
      `;
    });
    html += `
        </div>
      </div>
    `;
  });

  html += '</div>';

  content.innerHTML = html;

  // ── Tooltip de corredor (hover en desktop / tap en táctil) ──
  setupRiderTooltips(content);

  // ── Botón de edición admin (solo si hay sesión activa) ──
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) return;
    const existing = document.getElementById('editInscritosBtn');
    if (existing) return;
    const btn = document.createElement('a');
    btn.id        = 'editInscritosBtn';
    btn.className = 'edit-jornada-btn';
    btn.href      = '/panel/app.html?startlist=' + encodeURIComponent(raceId);
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar dorsales';
    const hero = content.querySelector('.race-header');
    if (hero) hero.appendChild(btn);
    else document.body.appendChild(btn);
  });

  // ── PDF download button ──
  const pdfBtn = document.getElementById('btnDescargarPdf');
  if (pdfBtn) {
    pdfBtn.addEventListener('mouseenter', preloadPDF, { once: true });
    pdfBtn.addEventListener('touchstart', preloadPDF, { once: true });
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      pdfBtn.textContent = t('startlist.generatingPdf');
      try {
        await generateStartlistPDF(startlistPdfOptions(race, data, { heroLabel, heroSubline }));
      } catch (err) {
        console.error('Error generando PDF:', err);
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ${t('startlist.downloadPdf')}`;
      }
    });
  }
}

init();
