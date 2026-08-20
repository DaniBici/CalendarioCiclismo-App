// ─────────────────────────────────────────────────────────────────
//  INSCRITOS — lista de equipos y corredores inscritos
//  URL: inscritos.html?race=RACE_ID  o  /inscritos/RACE_SLUG/
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, esc, setMeta, setMetaProperty, raceUrl,
         buildTeamBadgeSvg, raceName as getRaceName, enBase,
         seoLongDate, seoDayMonth, buildRaceHeader, buildActionButtons, loadRaceTechnicalGuide, withRaceTechnicalGuide,
         isIndividualPlaceholderTeam } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { generateStartlistPDF, preload as preloadPDF } from './inscritos-pdf.js';
import { setupRiderTooltips } from './rider-tooltip.js';
import { isAbandonIrm } from './uci-irm.js';

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

function buildFechaParentesis(race) {
  const sd = race.startDate || '';
  const ed = race.endDate   || '';
  if (!sd) return race.year ? `(${race.year})` : '';

  // Formato fijo en español (sin ICU) — esta fecha se embebe en title/description/og,
  // que Googlebot indexa; toLocaleDateString caería a inglés en su renderer. Ver shared.js.
  const fmtFull = (dateKey) => seoLongDate(dateKey, 'es');
  const fmtDayMonth = (dateKey, includeMonth) =>
    includeMonth ? seoDayMonth(dateKey, 'es') : String(dateKey.split('-').map(Number)[2]);

  if (!ed || sd === ed) return `(${fmtFull(sd)})`;

  const multiMonth = sd.slice(0, 7) !== ed.slice(0, 7);
  return `(${fmtDayMonth(sd, multiMonth)} – ${fmtFull(ed)})`;
}

function formatDateRange(startDk, endDk) {
  if (!startDk) return '';
  const [sy, sm, sd] = startDk.split('-').map(Number);
  const [ey, em, ed] = (endDk || startDk).split('-').map(Number);
  const startD = new Date(sy, sm - 1, sd);
  const endD   = new Date(ey, em - 1, ed);
  const fmtDay = d => d.getDate();
  const fmtMon = d => d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'es-ES', { month: 'short' });
  if (startDk === (endDk || startDk)) {
    return `${fmtDay(startD)} ${fmtMon(startD)}`;
  }
  if (sm === em && sy === ey) {
    return `${fmtDay(startD)}–${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  if (sy === ey) {
    return `${fmtDay(startD)} ${fmtMon(startD)} – ${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  return `${fmtDay(startD)} ${fmtMon(startD)} ${sy} – ${fmtDay(endD)} ${fmtMon(endD)} ${ey}`;
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
  let race = null;
  if (slug && !raceId) {
    if (_isEn) {
      const { data: d1 } = await supabase.from('races').select('*').eq('slugEn', slug).single();
      if (d1) { race = d1; raceId = d1.id; }
      else {
        const { data: d2 } = await supabase.from('races').select('*').eq('slug', slug).single();
        if (d2) { race = d2; raceId = d2.id; }
      }
    } else {
      const { data } = await supabase.from('races').select('*').eq('slug', slug).single();
      if (data) { race = data; raceId = data.id; }
    }
  } else if (raceId) {
    const { data } = await supabase.from('races').select('*').eq('id', raceId).single();
    if (data) race = data;
  }

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

  // ── Carga en paralelo (fase A): todo lo que depende SOLO de raceId ──
  // race_days (hero), startlist_teams y las etapas con resultados in-house
  // (race_uci_stages, para detectar abandonos) son independientes entre sí →
  // un único round-trip en vez de tres encadenados.
  const [raceDaysRes, teamsRes, uciStagesRes] = await Promise.all([
    supabase.from('race_days')
      .select('dateKey, isRestDay')
      .eq('raceId', raceId)
      .eq('editorialStatus', 'published')
      .order('dateKey', { ascending: true }),
    supabase.from('startlist_teams')
      .select('*')
      .eq('raceId', raceId)
      .order('sortOrder', { ascending: true }),
    supabase.from('race_uci_stages')
      .select('id, stageNumber, rowCount')
      .eq('raceId', raceId)
      .eq('classKind', 'stage'),
  ]);
  const raceDays  = raceDaysRes.data;
  const teams     = teamsRes.data;
  const teamsErr  = teamsRes.error;

  if (teamsErr || !teams || teams.length === 0) {
    content.innerHTML = `<div class="startlist-empty">${t('startlist.empty')}</div>`;
    return;
  }

  const teamIds = teams.map(t => t.id);

  // ── Carga en paralelo (fase B): corredores resueltos (dependen de teamIds)
  // y las filas de resultados UCI para tachar abandonos (dependen de las etapas
  // in-house ya cargadas en la fase A). Independientes entre sí.
  const stageRows = (uciStagesRes.data || []).filter(s => (s.rowCount || 0) > 0);
  // Vista resuelta: nombre/country canónicos de riders_men/women cuando hay link,
  // fallback al snapshot del propio startlist_riders cuando no.
  const [ridersRes, outRowsRes] = await Promise.all([
    supabase.from('startlist_riders_resolved')
      .select('*')
      .in('teamId', teamIds)
      .order('dorsal', { ascending: true }),
    stageRows.length > 0
      ? supabase.from('race_uci_results')
          .select('globalRiderId, irm, stageRef')
          .in('stageRef', stageRows.map(s => s.id))
          .not('globalRiderId', 'is', null)
          .not('irm', 'is', null)
      : Promise.resolve({ data: [] }),
  ]);
  const riders = ridersRes.data;

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

  // Enriquecida: si el flag está activo, cargamos los equipos globales referenciados
  // y los mapeamos por id. Silencioso si falla — el render cae al estilo estándar.
  //
  // Render temporal: si la carrera tiene año, además cargamos `team_seasons` de ese
  // año y sobrescribimos los campos VISUALES del equipo con la versión de la temporada
  // (nombre/colores/categoría correctos del año). Si no hay fila de season para un
  // equipo, se mantiene `teams` (estado actual) como FALLBACK — nunca se queda sin
  // chapa. `teams` es la referencia viva que leen también las apps; aquí solo se
  // ENRIQUECE la lectura, nunca se retira. En 2026 season == teams (idéntico).
  let globalTeamById = {};
  if (race.enrichedStartlist) {
    const refIds = [...new Set(teams.map(t => t.teamId).filter(Boolean))];
    if (refIds.length > 0) {
      // teams (visual base) y team_seasons (override del año) dependen ambos solo
      // de refIds → en paralelo.
      const [gTeamsRes, seasonsRes] = await Promise.all([
        supabase.from('teams').select('*').in('id', refIds),
        race.year
          ? supabase.from('team_seasons').select('*').in('teamId', refIds).eq('year', race.year)
          : Promise.resolve({ data: [] }),
      ]);
      (gTeamsRes.data || []).forEach(t => { globalTeamById[t.id] = t; });

      if (race.year) {
        const VISUAL = ['name','nameAliases','category','gender','headerBg','headerText',
                        'badgeTorsoCenter','badgeTorsoSides','badgeInnerCircle','badgeShorts'];
        (seasonsRes.data || []).forEach(s => {
          const base = globalTeamById[s.teamId];
          if (!base) return;
          VISUAL.forEach(k => { if (s[k] != null) base[k] = s[k]; });
        });
      }
    }
  }

  // Nombre a mostrar: si hay match, prevalece el nombre del equipo global (tabla teams)
  // sobre el `teamName` importado. Aplica tanto en web como en PDF.
  teams.forEach(t => {
    const g = t.teamId ? globalTeamById[t.teamId] : null;
    t.displayName = (g && g.name) ? g.name : t.teamName;
  });

  // Group riders by teamId
  const ridersByTeam = {};
  (riders || []).forEach(r => {
    if (!ridersByTeam[r.teamId]) ridersByTeam[r.teamId] = [];
    ridersByTeam[r.teamId].push(r);
  });

  // Corredores sin dorsal (dorsal=0) al final de su equipo
  Object.values(ridersByTeam).forEach(teamRiders => {
    teamRiders.sort((a, b) => {
      const da = a.dorsal || 0;
      const db = b.dorsal || 0;
      if (da === 0 && db === 0) return 0;
      if (da === 0) return 1;
      if (db === 0) return -1;
      return da - db;
    });
  });

  // Orden de equipos por el dorsal del PRIMER corredor (mínimo dorsal > 0):
  // las startlists entran al panel en cualquier orden (sortOrder = inserción),
  // así que el orden canónico lo imponen los dorsales en el render — este
  // array lo comparten web y PDF. Equipos sin ningún dorsal → al final,
  // conservando sortOrder entre ellos (startlist sin dorsales = orden del panel).
  {
    const firstDorsal = {};
    teams.forEach(tm => {
      const first = (ridersByTeam[tm.id] || [])[0];
      firstDorsal[tm.id] = (first && first.dorsal > 0) ? first.dorsal : Infinity;
    });
    teams.sort((a, b) => {
      const da = firstDorsal[a.id], db = firstDorsal[b.id];
      if (da !== db) return da < db ? -1 : 1;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }

  // ── Abandonos in-house (resultados UCI) ──────────────────────────
  // Solo en carreras donde recogemos resultados propios (tablas race_uci_*):
  // tachamos a quien ya NO sigue en carrera. Señal = campo `irm` de ABANDONO REAL
  // (DNF/DNS/OTL/DSQ/ABD vía isAbandonIrm) de race_uci_results — NO un código de
  // ruido como 'LAP' (doblada), que la UCI cuelga a veces de corredores en carrera
  // (incl. la propia ganadora; ver resultados.js). Se mira la fila de la etapa MÁS RECIENTE del
  // corredor (un abandono en la etapa 3 aparece con rank normal en las 1-2; lo
  // que manda es su última etapa con fila). Solo se consideran los eventos de
  // resultado de ETAPA (classKind='stage'); la "Stage General Classification"
  // es el GC acumulado, no sirve para detectar abandonos. Cruce por
  // globalRiderId (lo expone startlist_riders_resolved). En vivo desde cliente:
  // refleja el último volcado del cron sin paso de build.
  // stageRows y outRowsRes ya se cargaron en la fase B (arriba). Aquí solo se
  // procesan en memoria — sin round-trips adicionales.
  const riderOutMap = new Map();   // globalRiderId → { irm, stageNumber }
  if (stageRows.length > 0) {
    const stageNumById = new Map(stageRows.map(s => [s.id, s.stageNumber]));
    const outRows = outRowsRes.data;
    // Por corredor, quedarse con la fila de mayor stageNumber (null = -1, va
    // primero y lo pisa cualquier etapa numerada). Esa es su "última palabra".
    // Solo cuentan los abandonos reales: un 'LAP' (u otro código de ruido) NO tacha.
    (outRows || []).filter(row => isAbandonIrm(row.irm)).forEach(row => {
      const sn = stageNumById.has(row.stageRef) ? stageNumById.get(row.stageRef) : null;
      const prev = riderOutMap.get(row.globalRiderId);
      const snv = sn == null ? -1 : sn;
      const prevv = prev == null ? -2 : (prev.stageNumber == null ? -1 : prev.stageNumber);
      if (!prev || snv >= prevv) riderOutMap.set(row.globalRiderId, { irm: row.irm, stageNumber: sn });
    });
  }

  // Update page title & SEO
  const raceName = getRaceName(race) || t('race.unknown');
  const origName = race.originalName || '';
  const nameWithOrig = origName ? `${raceName} (${origName})` : raceName;
  const year = race.year || new Date().getFullYear();
  const art = articuloNombre(raceName);
  const artCap = art.charAt(0).toUpperCase() + art.slice(1);

  // Fechas entre paréntesis
  const fechaParentesis = buildFechaParentesis(race);

  const inscritosLabel = race.startlistProvisional
    ? t('startlist.provisional')
    : (race.gender === 'female' ? t('startlist.labelFemale') : t('startlist.label'));
  const siteName = t('seo.siteName');
  const title = `${inscritosLabel} — ${raceName} ${fechaParentesis} — ${siteName}`;
  const provisionalNote = race.startlistProvisional ? t('startlist.provisionalNote') : '';
  // El ficticio "Individual" (corredores sin equipo en la fuente UCI) no cuenta
  // como equipo: sus corredores sí suman en totalRiders.
  const totalTeams = teams.filter(tm => !isIndividualPlaceholderTeam(tm)).length;
  const totalRiders = (riders || []).length;
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
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;
  ['es', 'x-default'].forEach(lang => {
    let el = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (!el) { el = document.createElement('link'); el.rel = 'alternate'; el.hreflang = lang; document.head.appendChild(el); }
    el.href = canonicalUrl;
  });
  if (!_isEn && race.slugEn) {
    const enUrl = `${origin}/en/startlist/${encodeURIComponent(race.slugEn)}/`;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }
  if (_isEn && race.slug) {
    const esUrl = `${origin}/inscritos/${encodeURIComponent(race.slug)}/`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
  }

  // JSON-LD BreadcrumbList
  const crumbItems = [
    { '@type': 'ListItem', 'position': 1, 'name': 'Inicio', 'item': `${origin}/` },
    { '@type': 'ListItem', 'position': 2, 'name': `Temporada ${year}`, 'item': `${origin}/calendario.html?year=${year}` },
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
  // EN: conservar el JSON-LD en castellano del HTML estático (SEO en español).
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
  const flag  = countryFlag(race.countryCode);   // usado por el generador de PDF

  // Hero secondary info (same as competicion + "Inscritos" highlighted)
  const isStageRace = race.raceFormat !== 'one_day';
  const activeDays = (raceDays || []).filter(d => !d.isRestDay && d.dateKey);
  const firstDateKey = activeDays.length ? activeDays[0].dateKey : (race.startDate || null);
  const lastDateKey  = activeDays.length ? activeDays[activeDays.length - 1].dateKey : (race.endDate || race.startDate || null);
  const dateRange    = firstDateKey ? formatDateRange(firstDateKey, lastDateKey) : '';
  const nDays        = activeDays.length;

  const infoParts = [
    dateRange ? `${dateRange} ${race.year}` : race.year,
    race.uciCategory,
    isStageRace && nDays ? t(nDays !== 1 ? 'stage.stagesCount_other' : 'stage.stagesCount_one', { n: nDays }) : '',
  ].filter(Boolean).join(' · ');

  const heroLabel = race.startlistProvisional
    ? t('startlist.provisional')
    : (race.gender === 'female' ? t('startlist.labelFemale') : t('startlist.label'));
  const heroSubline = `<span style="color:var(--text)">${heroLabel}</span>${infoParts ? ' · ' + infoParts : ''}`;

  // Panel de botones (web oficial · "Ir a la carrera" · recorrido en un día),
  // fuente única en shared.buildActionButtons. En vueltas por etapas solo salen
  // web oficial + "Ir a la carrera"; en un día, todo el recorrido de la jornada.
  const actionButtonsHtml = buildActionButtons({
    race,
    rd: oneDayRd || { id: race.id, slug: race.slug, slugEn: race.slugEn },
    view: 'inscritos',
    assets: withRaceTechnicalGuide(oneDayAssets, await loadRaceTechnicalGuide(race.id)),
    hasStartlist: false,
    style: 'max-width:860px;padding:0 1.5rem;margin:0.85rem auto',
  });

  const pdfAction = `<button class="btn-ical" id="btnDescargarPdf">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ${t('startlist.downloadPdf')}
        </button>`;
  // Sin equipos reales (startlist 100% ficticio "Individual") no se muestra
  // "0 equipos": solo el total de corredores.
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
    // Ficticio "Individual" → ocultación cosmética: los corredores se listan,
    // pero la tarjeta va SIN cabecera de equipo (ni nombre, ni chapa).
    const hideHeader = isIndividualPlaceholderTeam(team);
    const gTeam = team.teamId ? globalTeamById[team.teamId] : null;
    const enrichedClass = gTeam ? ' startlist-team__header--enriched' : '';
    const isWhiteBg = gTeam && /^#?(fff|ffffff)$/i.test((gTeam.headerBg || '').trim());
    const headerStyle = gTeam
      ? `background:${esc(gTeam.headerBg)};color:${esc(gTeam.headerText)};border-left-color:${esc(gTeam.headerBg)}`
      : `border-left-color: ${color}`;
    const badgeHtml = gTeam ? `<span class="startlist-team__badge">${buildTeamBadgeSvg(gTeam, { size: 24 })}</span>` : '';
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
          ${badgeHtml}
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
        await generateStartlistPDF({
          race,
          teams,
          ridersByTeam,
          heroSubline,
          totalTeams,
          totalRiders,
          flag,
        });
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
