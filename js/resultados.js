import { updateResultsHtml, limitScrollToStickyStart } from './results/dom.js';
import { mountStageProfile } from './stage/profile.js';
import { stageMetricsHtml } from './stage/context.js';
import { startlistTeamsQuery } from './team-appearance.js';
import { classificationInventory, classificationLabel, classificationColor, visibleStageClassifications } from './services/race-presentation.js';
import { installScrollRail } from './scroll-rail.js';
import { applyPrerenderedHtml } from './html-fingerprint.js';
import { stagePathLabel, stageSlugSegment, statusIcon, resultsStages, resultsActive, resultsPageHtml, stageNavigationHtml,
         publicationHtml, createResultsResolver, enrichRiders, enrichOverrideTeams, classificationHtml, classificationTableHtml,
         teamFilterHtml, cancelledNoticeHtml, emptyClassificationHtml, loadingHtml } from './resultados-html.js';
// ─────────────────────────────────────────────────────────────────
//  RESULTADOS — clasificaciones oficiales (UCI) de una etapa
//  URL: /resultados/<race-slug>/etapa-N/   ·   /resultados/<race-slug>/prologo/
//       /resultados/<race-slug>/   (carrera de un día / general final)
//       ?race=<id>&stage=N   (fallback)
//
//  Lee las tablas race_uci_* (migración 081/082). La fila de resultado guarda
//  solo dorsal + dato; el CORREDOR se reconstruye por dorsal contra la startlist
//  curada (startlist_riders.dorsal → globalRiderId/nombre/bandera/equipo), igual
//  que hizo resolve_uci_results en BD. riderDisplay es el fallback si no casa.
//
//  Solo se muestran las clasificaciones keepForWeb=true (clasificación de etapa
//  + GC del día + generales acumuladas de puntos/montaña/jóvenes/equipos). Las
//  secundarias de etapa se ingieren pero no se pintan.
//
//  El HTML sale de js/resultados-html.js, común con el build
//  (tools/site/prerender-resultados.mjs): si la página trae el contenido
//  generado con la misma huella, se conserva y solo se monta lo interactivo.
//  Las listas se piden con desempate por id, en el mismo orden que el build.
// ─────────────────────────────────────────────────────────────────

import { supabase, setMeta, setMetaProperty, raceName as getRaceName, enBase, loadRaceTechnicalGuide, withRaceTechnicalGuide,
         setRaceRobots, raceSearchName, deArticulo, seoLongDateWeekday, seoDayMonth,
         embeddedId, orEqFilter, pickByPreference, esc } from './shared.js';
import { isNearToday } from './services/refresh-window.js';
import { getLang, initI18n } from './i18n.js';

const stickyHeightObservers = new Map();

// Publica en una variable CSS la altura de un bloque fijo para que los que se
// fijan debajo (pestañas, fila de columnas) no se solapen con él.
function syncStickyHeight(variable, element) {
  stickyHeightObservers.get(variable)?.disconnect();
  stickyHeightObservers.delete(variable);

  if (!element) {
    document.documentElement.style.removeProperty(variable);
    return;
  }

  const update = () => {
    document.documentElement.style.setProperty(
      variable,
      `${Math.ceil(element.getBoundingClientRect().height)}px`
    );
  };

  update();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(update);
    observer.observe(element);
    stickyHeightObservers.set(variable, observer);
  }
}

function syncResultsRaceHeaderHeight(header) {
  syncStickyHeight('--results-race-header-h', header);
}

// Título SEO de la página de resultados. Espejo del bloque RESULTADOS de
// tools/site/gen_og_pages.py: «clasificación y resultados» por delante (las
// consultas dicen más «clasificación» que «resultado»), sin sufijo de marca y
// sin aviso de datos pendientes: la misma cadena sirve con y sin clasificación.
function resultsSeoTitle(race, raceNameStr, stageNumber, suffix, isEn) {
  const hero = `${isEn ? raceNameStr : raceSearchName(race, raceNameStr)} ${race.year || ''}`.trim();
  if (race.raceFormat === 'one_day') {
    return isEn ? `${hero} results and classification` : `Clasificación y resultados ${hero}`;
  }
  if (stageNumber == null) {
    return isEn ? `${hero} final classification and results` : `Clasificación final y resultados ${hero}`;
  }
  if (isEn) return `${hero} ${stageNumber === 0 ? 'prologue' : `stage ${stageNumber}${suffix}`} results and classification`;
  return `Clasificación y resultados ${stageNumber === 0 ? 'prólogo' : `etapa ${stageNumber}${suffix}`} ${hero}`;
}

// Descripción SEO (espejo de gen_og_pages.py): ruta, km y día de la jornada.
function resultsSeoDescription(race, raceNameStr, raceDay, stageNumber, suffix, isEn) {
  const hero = `${raceNameStr} ${race.year || ''}`.trim();
  const start = (isEn && raceDay?.startLocationEn) || raceDay?.startLocation || '';
  const finish = (isEn && raceDay?.finishLocationEn) || raceDay?.finishLocation || '';
  const route = start && finish && start !== finish ? `${start} > ${finish}` : (start || finish);
  const km = raceDay?.distanceKm ? `${isEn ? raceDay.distanceKm : String(raceDay.distanceKm).replace('.', ',')} km` : '';
  const routeKm = [route, km].filter(Boolean).join(', ');
  const lang = isEn ? 'en' : 'es';
  const day = raceDay?.dateKey
    ? (() => {
        const weekday = seoLongDateWeekday(raceDay.dateKey, lang).split(',')[0];
        return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${seoDayMonth(raceDay.dateKey, lang)}`;
      })()
    : '';
  const tail = `${day ? ` ${day}.` : ''}`;
  const paren = routeKm ? ` (${routeKm})` : '';
  if (race.raceFormat === 'one_day') {
    const winnerEs = race.gender === 'female' ? 'ganadora' : 'ganador';
    return isEn
      ? `Classification and results of the ${hero}${paren}: full results and winner.${tail}`
      : `Clasificación ${deArticulo(raceNameStr)} ${hero}${paren}: resultados completos y ${winnerEs}.${tail}`;
  }
  if (stageNumber == null) {
    return isEn
      ? `Final classification of the ${hero}: GC, points, KOM, youth and teams.`
      : `Clasificación final ${deArticulo(raceNameStr)} ${hero}: general, puntos, montaña, jóvenes y equipos.`;
  }
  if (isEn) {
    const stage = stageNumber === 0 ? 'the prologue' : `stage ${stageNumber}${suffix}`;
    return `Classification and results for ${stage} of the ${hero}${paren}: stage results, GC, points, KOM and youth.${tail}`;
  }
  const stage = stageNumber === 0 ? 'del prólogo' : `de la ${suffix ? `etapa ${stageNumber}${suffix}` : `${stageNumber}ª etapa`}`;
  return `Clasificación ${stage} ${deArticulo(raceNameStr)} ${hero}${paren}: resultados de etapa, general, puntos, montaña y jóvenes.${tail}`;
}

async function init(i18nReady = Promise.resolve()) {
  window.__spaDrivenAnalytics = true;
  const params  = new URLSearchParams(window.location.search);
  const content = document.getElementById('resultsContent');
  const _isEn   = getLang() === 'en';
  const lang    = _isEn ? 'en' : 'es';
  const empty = (msgEs, msgEn) =>
    applyPrerenderedHtml(content, `<div class="startlist-empty">${statusIcon('pending')}${_isEn ? msgEn : msgEs}</div>`);

  // ── Resolver carrera + etapa desde la URL ──────────────────────────
  let raceId = params.get('race');
  let raceSlug = params.get('slug');
  // stage: número (0=prólogo) o null (general/un día). 'param' lo deja explícito.
  // Doble sector: `?stage=3a` → número 3 + sufijo A (letra opcional).
  let stageSuffixParam = '';
  let stageNumberParam;
  if (params.has('stage')) {
    const raw = String(params.get('stage')).trim();
    const sm = /^(\d+)([a-z])?$/i.exec(raw);
    if (sm) { stageNumberParam = Number(sm[1]); stageSuffixParam = (sm[2] || '').toUpperCase(); }
    else { stageNumberParam = Number(raw); }   // NaN → se trata como "no pedida"
  }

  let stageFromPath; // segmento de etapa leído del path (string)
  if (!raceId && !raceSlug) {
    const m = location.pathname.match(/^\/(?:resultados|en\/results)\/([^\/]+)(?:\/([^\/]+))?\/?$/);
    if (m) {
      raceSlug = decodeURIComponent(m[1]);
      stageFromPath = m[2] ? decodeURIComponent(m[2]) : undefined;
    }
  }

  // ── Sin carrera → feed "Últimos resultados" ────────────────────────
  // El bare /resultados/ (ES) y /en/results/ (EN) son el ÍNDICE del sitio de
  // resultados: etapas y clásicas en cronología inversa (decisión 2026-06-11).
  // El módulo del feed se carga en diferido para no engordar las páginas de
  // carrera, que son la ruta caliente.
  if (!raceId && !raceSlug) {
    // Índice de una sección principal: sin flecha de volver, como Fichajes,
    // Ciclocross o Calendario (la base compartida con las fichas la declara).
    window.ccHeaderBack?.(null);
    const [{ renderResultsFeed }] = await Promise.all([import('./resultados-feed.js'), i18nReady]);
    renderResultsFeed(content);
    return;
  }

  // Traducir el segmento de path a stageNumber (+ sufijo de sector, letra opcional).
  if (stageNumberParam === undefined && stageFromPath !== undefined) {
    if (/^(prologo|prologue)$/i.test(stageFromPath)) stageNumberParam = 0;
    else {
      const sm = stageFromPath.match(/(?:etapa|stage)-(\d+)([a-z])?/i);
      if (sm) { stageNumberParam = Number(sm[1]); stageSuffixParam = (sm[2] || '').toUpperCase(); }
    }
  }

  // ── Carrera ────────────────────────────────────────────────────────
  // Página pre-renderizada: el build incrusta el id de la carrera. Por slug,
  // una sola consulta: en EN se prefiere slugEn y se admite slug.
  let race = null;
  const pageRaceId = raceId || (!params.get('slug') ? embeddedId('race-id') : null);
  if (pageRaceId) {
    const { data } = await supabase.from('races').select('*').eq('id', pageRaceId).maybeSingle();
    race = data || null;
  }
  if (!race && raceSlug) {
    const columns = _isEn ? ['slugEn', 'slug'] : ['slug'];
    const { data } = await supabase.from('races').select('*').or(orEqFilter(columns, raceSlug)).limit(4);
    race = pickByPreference(data, columns, raceSlug);
  }
  if (!race) { await i18nReady; empty('No se encontró la carrera.', 'Race not found.'); return; }
  raceId = race.id;

  // Todo lo que depende solo de la carrera va en un único viaje: clasificaciones
  // disponibles, jornadas, configuración, startlist y guía técnica. Desempate
  // por id: el build lee las mismas filas en el mismo orden.
  const [stagesResponse, daysResponse, configResponse, slRidersResponse, slTeamsResponse, technicalGuide] = await Promise.all([
    supabase.from('race_uci_stages').select('*').eq('raceId', raceId).eq('keepForWeb', true).gt('rowCount', 0)
      .order('stageNumber', { ascending: true }).order('id'),
    supabase.from('race_days')
      .select('id, "stageNumber", "dateKey", "isCancelledDay", "isRestDay", "neutralStartTimeUtc"')
      .eq('raceId', raceId)
      .order('dateKey', { ascending: true })
      .order('neutralStartTimeUtc', { ascending: true, nullsFirst: true })
      .order('id'),
    supabase.from('race_classifications').select('*').eq('raceId', raceId),
    // Vista RESUELTA (no la tabla cruda): nombre/país canónicos de la ficha
    // riders_men/women vía globalRiderId, con el snapshot de fallback. Así una
    // edición de ficha se refleja aquí sin re-importar la startlist (igual que
    // inscritos). `teamId` = PK de startlist_teams (se conserva en la vista).
    supabase.from('startlist_riders_resolved')
      .select('dorsal, firstName, lastName, countryCode, teamId, globalRiderId')
      .eq('raceId', raceId)
      .order('id'),
    // Equipos de la startlist con el equipo canónico y su temporada embebidos.
    startlistTeamsQuery(supabase, raceId, race.year),
    loadRaceTechnicalGuide(raceId),
    i18nReady,
  ]);

  // Botón atrás — prioridad a la página de procedencia de OTRO apartado
  // (p. ej. la jornada o el calendario desde los que se navegó). Si no hay
  // referente válido, o venimos del propio apartado de resultados, vuelve al
  // índice de resultados.
  const feedHref  = _isEn ? `${enBase()}/results/` : '/resultados/';
  const feedLabel = _isEn ? 'All results' : 'Todos los resultados';
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    let referrer = '';
    try {
      const refUrl = new URL(document.referrer, location.href);
      if (document.referrer && refUrl.origin === location.origin
          && refUrl.pathname !== location.pathname) referrer = document.referrer;
    } catch (_) { /* referente no parseable → índice de resultados */ }
    if (referrer) {
      backBtn.href = referrer;
      backBtn.addEventListener('click', (e) => { e.preventDefault(); history.back(); });
    } else {
      backBtn.href = feedHref;
      backBtn.setAttribute('aria-label', feedLabel);
    }
  }

  // ── Clasificaciones disponibles (keepForWeb) y jornadas de la carrera ──
  const { data: stagesAll, error: stagesError } = stagesResponse;
  if (stagesError) throw stagesError;
  const { data: allRaceDays, error: daysError } = daysResponse;
  if (daysError) throw daysError;

  // Un `?stage=` no numérico (`Number('abc')` = NaN) se trata como "sin etapa
  // pedida" — degrada con gracia al comportamiento por defecto en vez de
  // mostrar un aviso roto ("la etapa NaN").
  const requestedStage = (stageNumberParam !== undefined && Number.isNaN(stageNumberParam))
    ? undefined : stageNumberParam;
  // Clave de entrada pedida (sector-consciente): 'final' | '3' | '3A'.
  let requestedKey;
  if (requestedStage === undefined) requestedKey = undefined;
  else if (requestedStage == null) requestedKey = 'final';
  else requestedKey = `${requestedStage}${stageSuffixParam || ''}`;

  const stages = resultsStages({ stagesAll, allRaceDays, requestedKey, requestedStage, stageSuffixParam });
  const { keyForStage, keyForDay, stageKeys, keyRank, racedWithStage, lastRacedDay, activeKey } = stages;

  // Registra un page_view "pendiente" (mismo evento que el de la carga normal)
  // antes de los `return` de más abajo — si no, esta categoría de páginas
  // (adelantadas, aún sin datos) queda invisible en GA4.
  const logPendingView = (stageNumberForTitle, suffixForTitle = '') => {
    document.title = resultsSeoTitle(race, getRaceName(race) || '', stageNumberForTitle, suffixForTitle, _isEn);
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  };

  if (stages.missing) {
    const pollPending = async () => {
      if(document.hidden || !isNearToday(race.startDate,race.endDate)) return;
      const {data,error}=await supabase.from('race_uci_stages').select('raceDayId,stageNumber,isFinalClassification,rowCount').eq('raceId',raceId).eq('keepForWeb',true).gt('rowCount',0);
      if(!error && data?.some(row=>requestedKey===undefined || keyForStage(row)===activeKey)) location.reload();
    };
    // Solo en la ventana de la carrera: una página adelantada de una etapa
    // lejana no cambia minuto a minuto.
    const pendingTimer=isNearToday(race.startDate,race.endDate) ? setInterval(pollPending,60000) : null;
    document.addEventListener('visibilitychange',pollPending);
    window.addEventListener('pagehide',()=> {clearInterval(pendingTimer);document.removeEventListener('visibilitychange',pollPending);},{once:true});
    if (requestedStage !== undefined) {
      // Se pidió una etapa CONCRETA (segmento de path o ?stage=) que esta
      // carrera todavía no tiene volcada — sea porque solo falta esa etapa o
      // porque la carrera entera no ha empezado. La jornada ya existe (página
      // adelantada) pero la clasificación no. NO sustituir en silencio por
      // otra etapa (sería contenido engañoso/duplicado): avisar de que esta
      // etapa en concreto está pendiente.
      const stageForTitle = requestedStage === null ? null : requestedStage;
      const esLabel = requestedStage === 0 ? 'el prólogo' : `la ${stagePathLabel(stageForTitle, false, stageSuffixParam).toLowerCase()}`;
      const enLabel = requestedStage === 0 ? 'the prologue' : stagePathLabel(stageForTitle, true, stageSuffixParam).toLowerCase();
      logPendingView(stageForTitle, stageSuffixParam);
      empty(`Aún no hay resultados disponibles para ${esLabel}. Vuelve después de la etapa para consultar la clasificación oficial.`,
            `No results available yet for ${enLabel}. Check back after the stage for the official classification.`);
      return;
    }
    // Sin etapa pedida (URL sin segmento) y sin NINGÚN dato en la carrera.
    logPendingView(null);
    empty('Aún no hay resultados disponibles para esta carrera.',
          'No results available yet for this race.');
    return;
  }

  // Clasificaciones de la etapa activa, ordenadas como las pestañas; la
  // seleccionada sale del hash (#stage|#gc|…) o es la primera.
  const { data: classificationConfig, error: configError } = configResponse;
  if (configError) throw configError;
  const hashClass = (location.hash || '').replace('#', '');
  const active = resultsActive(stages, { stagesAll, classificationConfig, allRaceDays, hashClass });
  const { activeStages, activeStageNumber, activeSuffix, configByKind, raceDayId, contextDayId } = active;
  let { activeClass } = active;

  // ── Normalizar URL al path limpio ──────────────────────────────────
  const canonSlug = _isEn ? (race.slugEn || race.slug) : race.slug;
  const canonBase = _isEn ? `${enBase()}/results/` : '/resultados/';
  const seg = stageSlugSegment(activeStageNumber, _isEn, activeSuffix);
  if (canonSlug) {
    history.replaceState(null, '', `${canonBase}${encodeURIComponent(canonSlug)}/${seg ? seg + '/' : ''}${hashClass ? '#'+encodeURIComponent(hashClass) : ''}`);
  }

  // ── Reconstruir corredores por dorsal contra la startlist ──────────
  // Jornada de contexto y assets dependen solo de su id: salen a la vez que
  // la resolución de la startlist.
  const RD_COLS = '*';
  const stageDayRequest = Promise.all([
    contextDayId ? supabase.from('race_days').select(RD_COLS).eq('id', contextDayId).maybeSingle() : Promise.resolve({ data: null }),
    contextDayId ? supabase.from('assets').select('*').eq('raceDayId', contextDayId).order('id') : Promise.resolve({ data: [] }),
  ]);
  const resolver = createResultsResolver({ race, slRiders: slRidersResponse.data, slTeamsRows: slTeamsResponse.data, isEn: _isEn });

  // ── Jornada de la etapa activa (para detalle de cabecera + botón) ──
  // Cada clasificación keepForWeb arrastra su raceDayId; de él salen la ruta
  // (salida › meta), la distancia y el tipo (CRI/CRE), como en orden-salida.
  const [{ data: rdRow }, { data: stageAssets, error: assetsError }] = await stageDayRequest;
  let contextDay = rdRow || null;
  let raceDay = raceDayId ? contextDay : null;
  if (assetsError) throw assetsError;
  const contextAssets = withRaceTechnicalGuide(stageAssets || [],technicalGuide);
  const actionAssets = raceDayId ? contextAssets : withRaceTechnicalGuide([],technicalGuide);
  // ── SEO / cabecera ─────────────────────────────────────────────────
  const raceNameStr = getRaceName(race) || '';
  const pageTitle = resultsSeoTitle(race, raceNameStr, activeStageNumber, activeSuffix, _isEn);
  document.title = pageTitle;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  // La jornada cancelada conserva la descripción del HTML estático (avisa de la cancelación).
  if (!raceDay?.isCancelledDay) {
    setMeta('description', resultsSeoDescription(race, raceNameStr, raceDay, activeStageNumber, activeSuffix, _isEn));
  }
  setMetaProperty('og:title', pageTitle);

  const esOrigin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
  const canonicalUrl = canonSlug
    ? (_isEn
        ? `${esOrigin}/en/results/${encodeURIComponent(race.slugEn || race.slug)}/${seg ? seg + '/' : ''}`
        : `${esOrigin}/resultados/${encodeURIComponent(race.slug)}/${seg ? seg + '/' : ''}`)
    : location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
  setRaceRobots(race);
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = canonicalUrl;

  // Alternates de idioma para el selector ES/EN (lang-switch.js los lee del DOM).
  // OJO: el segmento de etapa es por idioma (etapa-N en ES, stage-N en EN), así
  // que se recalcula para cada idioma — no se reutiliza `seg` (es el del idioma
  // de la página actual).
  if (canonSlug) {
    const esSeg = stageSlugSegment(activeStageNumber, false, activeSuffix);
    const enSeg = stageSlugSegment(activeStageNumber, true, activeSuffix);
    const esUrl = `${esOrigin}/resultados/${encodeURIComponent(race.slug)}/${esSeg ? esSeg + '/' : ''}`;
    const enUrl = `${esOrigin}/en/results/${encodeURIComponent(race.slugEn || race.slug)}/${enSeg ? enSeg + '/' : ''}`;
    let esEl = document.querySelector('link[rel="alternate"][hreflang="es"]');
    if (!esEl) { esEl = document.createElement('link'); esEl.rel = 'alternate'; esEl.hreflang = 'es'; document.head.appendChild(esEl); }
    esEl.href = esUrl;
    let enEl = document.querySelector('link[rel="alternate"][hreflang="en"]');
    if (!enEl) { enEl = document.createElement('link'); enEl.rel = 'alternate'; enEl.hreflang = 'en'; document.head.appendChild(enEl); }
    enEl.href = enUrl;
  }

  // La navegación a la jornada vive en el panel de botones ("Ir a la etapa" /
  // "Ir a la carrera"), no en un botón de acción aparte en la cabecera.
  const isOneDay = race.raceFormat === 'one_day';
  // Esqueleto: la página generada en el build con la misma huella se conserva
  // (con sus huecos rellenos, cada uno con su propia huella).
  applyPrerenderedHtml(content, resultsPageHtml({
    race, stages, active, raceDay, contextDay, contextAssets, actionAssets, canonBase, canonSlug, isEn: _isEn,
  }));
  // Datos de la jornada: la hora de salida va en la zona del visitante; fuera
  // de la del build solo se sustituye esta lista.
  const metricsList = content.querySelector('.res-stage-data dl');
  if (metricsList) updateResultsHtml(metricsList, stageMetricsHtml(contextDay));
  syncResultsRaceHeaderHeight(content.querySelector(':scope > .race-header'));
  syncStickyHeight('--res-tabs-h', content.querySelector('.res-tabs-bar'));
  if (contextDay) mountStageProfile(document.getElementById('resProfile'), { day:contextDay,race,assets:contextAssets,hidePointNames:true });
  content.querySelectorAll('.res-tabs__scroll, #resStages').forEach(shell => installScrollRail(shell));

  // El selector de etapas ocupa siempre una sola línea. En vueltas largas la
  // etapa activa puede quedar lejos del inicio: centrarla al montar y al cambiar
  // de ancho evita que el usuario tenga que buscarla (mismo patrón que las apps).
  const stagesInner = document.getElementById('resStagesInner');
  const centerActiveStage = () => {
    const active = stagesInner?.querySelector('[data-active="true"]');
    if (!stagesInner || !active || stagesInner.scrollWidth <= stagesInner.clientWidth + 1) return;
    const left = active.offsetLeft - (stagesInner.clientWidth - active.offsetWidth) / 2;
    stagesInner.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  };
  if (stagesInner) {
    requestAnimationFrame(centerActiveStage);
    window.addEventListener('resize', centerActiveStage);
  }

  // ── Render de una clasificación concreta (filas por stageRef) ──────
  const tableWrap = document.getElementById('resTableWrap');
  const filterSlot = document.getElementById('resTeamFilterSlot');
  let _teamFilter = '';   // equipo seleccionado ('' = todos); persiste entre clasificaciones
  const sameTimeLbl = _isEn ? 's.t.' : 'm.t.';
  // Muestra/oculta filas según el equipo, y RECALCULA la columna de tiempo sobre
  // las filas VISIBLES: el 1º visible de cada grupo de tiempo muestra su gap real
  // (data-gap), los siguientes con el mismo gap muestran m.t. (filtrar puede dejar
  // a un corredor como primero de su grupo visible → debe verse su tiempo, no m.t.).
  // Sin filtro, el HTML ya trae ese cálculo: solo se escribe lo que cambia.
  function applyTeamFilter() {
    let visibleCount = 0;
    let prevGap = null;   // gap del último corredor por tiempo VISIBLE
    tableWrap.querySelectorAll('tr.so-row[data-team]').forEach((tr) => {
      const visible = (!_teamFilter || tr.dataset.team === _teamFilter);
      const display = visible ? '' : 'none';
      if (tr.style.display !== display) tr.style.display = display;
      if (visible) visibleCount++;
      // Recomputar la celda de tiempo de las filas por tiempo (las que tienen data-gap).
      const cell = tr.querySelector('.res-gap-dyn');
      if (cell && tr.dataset.gap != null && tr.dataset.gap !== '') {
        if (visible) {
          const g = tr.dataset.gap;
          const same = prevGap != null && g === prevGap;
          const text = same ? sameTimeLbl : g;
          const className = same ? 'res-gap res-gap--same res-gap-dyn' : 'res-gap res-gap-dyn';
          if (cell.textContent !== text) cell.textContent = text;
          if (cell.className !== className) cell.className = className;
          prevGap = g;
        }
      }
    });
    tableWrap.querySelector('.res-filter-empty')?.remove();
    if (_teamFilter && !visibleCount) {
      const empty=document.createElement('div'); empty.className='res-filter-empty';
      empty.innerHTML=`<p>${_isEn ? 'No riders from this team in this classification.' : 'No hay corredores de este equipo en esta clasificación.'}</p><button type="button" class="btn btn--ghost">${_isEn ? 'Show all teams' : 'Mostrar todos los equipos'}</button>`;
      empty.querySelector('button').onclick=()=> { _teamFilter=''; const select=document.getElementById('resTeamFilter'); if(select) select.value=''; applyTeamFilter(); }; tableWrap.append(empty);
    }
  }
  // Filtro por equipo: el desplegable se rehace con cada clasificación (o
  // llega en el HTML generado); un solo manejador en su hueco.
  filterSlot?.addEventListener('change', (event) => {
    const select = event.target.closest('#resTeamFilter');
    if (!select) return;
    _teamFilter = select.value;
    applyTeamFilter();
  });
  // CRE: despliegue por equipo, con clic o con Intro/espacio en la fila.
  const toggleTttGroup = (groupEl) => {
    const idx = groupEl.dataset.tttGroup;
    const open = groupEl.getAttribute('aria-expanded') === 'true';
    groupEl.setAttribute('aria-expanded', String(!open));
    groupEl.classList.toggle('res-team-row--open', !open);
    tableWrap.querySelectorAll(`tr.res-ttt-rider[data-ttt-member="${idx}"]`).forEach((row) => {
      row.hidden = open;
    });
  };
  tableWrap.addEventListener('click', (event) => {
    const row = event.target.closest('tr.res-team-row');
    if (row) toggleTttGroup(row);
  });
  tableWrap.addEventListener('keydown', (event) => {
    const row = event.target.closest('tr.res-team-row');
    if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleTttGroup(row); }
  });

  let renderRequest = 0;
  let displayedStage = null;
  const publication = document.getElementById('resPublication');
  const statusSlot = document.getElementById('resStatusSlot');
  const showPublication = (stageRow, error = false) => {
    const inBar = !!statusSlot && !content.querySelector('#resTabsInner .res-tab');
    const html = publicationHtml(stageRow, { configByKind, isOneDay, inBar, error, isEn: _isEn });
    if (statusSlot) updateResultsHtml(statusSlot, html.status);
    updateResultsHtml(publication, html.publication);
  };
  publication.addEventListener('click', (event) => {
    if (event.target.closest('[data-results-retry]')) renderClassification(activeClass,{ refresh:true });
  });
  async function renderClassification(stageRow, { refresh = false } = {}) {
    const request = ++renderRequest;
    activeClass = stageRow;
    try {
    showPublication(stageRow);
    // Etapa CANCELADA: su pestaña "Etapa" no tiene clasificación que mostrar.
    if (stageRow._cancelledStage) {
      updateResultsHtml(tableWrap, cancelledNoticeHtml(_isEn));
      return;
    }
    // La tabla generada en el build se queda a la vista mientras llegan las filas.
    if (!refresh && tableWrap.dataset.prerendered == null) updateResultsHtml(tableWrap, loadingHtml(_isEn));
    const { data: rows, error: rowsError } = await supabase
      .from('race_uci_results')
      .select('rank, rankText, bib, riderDisplay, globalRiderId, teamId, resultValue, timeText, gapText, points, uciPoints, irm, sortOrder')
      .eq('stageRef', stageRow.id)
      .order('sortOrder', { ascending: true })
      .order('id');

    if (request !== renderRequest) return;
    if (rowsError) { showPublication(displayedStage?.classKind===stageRow.classKind ? displayedStage : stageRow,true); return; }
    if (!rows || rows.length === 0) {
      updateResultsHtml(tableWrap, emptyClassificationHtml(_isEn));
      return;
    }

    // Carreras sin startlist (campeonatos nacionales, volcados in-house sin
    // inscritos): enriquecer por globalRiderId → bandera + equipo actual + ficha.
    // No-op si todas las filas casan por dorsal (byRider queda sin usar).
    await enrichRiders(supabase, resolver, rows.map(r => r.globalRiderId).filter(Boolean));
    // Override MANUAL de equipo (race_uci_results.teamId, fijado en el panel):
    // cuando está poblado, GANA a la resolución por dorsal/globalRiderId.
    await enrichOverrideTeams(supabase, resolver, rows.map(r => r.teamId).filter(Boolean));

    if (request !== renderRequest) return;
    displayedStage=stageRow;
    showPublication(stageRow);
    const classification = classificationHtml(rows, stageRow, { race, raceDay, isOneDay, resolver, lang });
    const changed = classification.ttt
      ? updateResultsHtml(tableWrap, classification.head)
      : updateResultsHtml(tableWrap, classificationTableHtml(classification),
        { head: classification.head, list: classification.rows, tail: classification.tail });
    if (!changed) return;
    // Filtro por equipo en el hueco de la barra de pestañas (vacío en la CRE).
    if (filterSlot) updateResultsHtml(filterSlot, teamFilterHtml(classification, _teamFilter, _isEn));
    if (!classification.ttt) applyTeamFilter();
    } catch { if(request===renderRequest) showPublication(displayedStage?.classKind===stageRow.classKind?displayedStage:stageRow,true); }

  }

  // Selección lógica: el captador puede sustituir el identificador de fuente.
  // Sin barra de pestañas (una clasificación de equipos) no hay a quién escuchar.
  let tabSwitchRequest=0;
  content.querySelector('#resTabs')?.addEventListener('click',event=> {
    const button=event.target.closest('[data-class]');
    const stage=activeStages.find(s=>s.classKind===button?.dataset.class);
    if(!stage) return;
    content.querySelectorAll('#resTabs .res-tab').forEach(b=> {b.classList.toggle('res-tab--active',b===button);b.setAttribute('aria-pressed',String(b===button));});
    button.scrollIntoView({block:'nearest',inline:'nearest'});
    history.replaceState(null,'',location.pathname+'#'+stage.classKind);
    // La página sube como máximo hasta donde se fijan las pestañas. La altura
    // de la tabla anterior se conserva mientras carga la nueva para que el
    // aviso de carga no acorte la página y la devuelva al principio.
    const tabsBar=content.querySelector('.res-tabs-bar'),tabSwitch=++tabSwitchRequest;
    delete tableWrap.dataset.prerendered;
    delete tableWrap.dataset.rows;
    tableWrap.style.minHeight=`${tableWrap.offsetHeight}px`;
    limitScrollToStickyStart(tabsBar);
    renderClassification(stage).finally(()=> {
      if(tabSwitch!==tabSwitchRequest) return;
      tableWrap.style.minHeight='';
      limitScrollToStickyStart(tabsBar);
    });
  });
  renderClassification(activeClass);
  // Sondeo: solo en la ventana de la carrera o mientras alguna clasificación
  // de la etapa siga provisional o actualizándose. Una lectura ligera de las
  // clasificaciones y de la jornada decide si se recarga todo.
  const STAGE_PROBE_COLUMNS = 'id,updatedAt,rowCount,publicationStatus,updating,updatingUntil,officialAt,lastSyncedAt';
  const DAY_PROBE_COLUMNS = 'id,updatedAt,metricsUpdatedAt,distanceKm';
  const pick = (row, columns) => columns.split(',').map(column => row?.[column] ?? null);
  const probeKey = (stages, day) => JSON.stringify([
    (stages || []).map(row => pick(row, STAGE_PROBE_COLUMNS)).sort(),
    day ? pick(day, DAY_PROBE_COLUMNS) : null,
  ]);
  let lastProbe = probeKey(stagesAll, contextDay);
  const needsRefresh = () => isNearToday(race.startDate, race.endDate)
    || activeStages.some(row => row.publicationStatus === 'provisional' || row.updating);
  let refreshing=false;
  const refreshCurrent=async()=> {
    if(document.hidden || refreshing || !content.isConnected || !needsRefresh()) return;
    refreshing=true;
    try {
      const [stageProbe, dayProbe] = await Promise.all([
        supabase.from('race_uci_stages').select(STAGE_PROBE_COLUMNS).eq('raceId',raceId).eq('keepForWeb',true).gt('rowCount',0),
        contextDayId ? supabase.from('race_days').select(DAY_PROBE_COLUMNS).eq('id',contextDayId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if(stageProbe.error || dayProbe.error) throw stageProbe.error || dayProbe.error;
      const nextProbe = probeKey(stageProbe.data, dayProbe.data);
      if(nextProbe === lastProbe) return;
      const [stageResult,configResult,dayResult]=await Promise.all([
        supabase.from('race_uci_stages').select('*').eq('raceId',raceId).eq('keepForWeb',true).gt('rowCount',0),
        supabase.from('race_classifications').select('*').eq('raceId',raceId),
        contextDayId ? supabase.from('race_days').select('*').eq('id',contextDayId).maybeSingle() : Promise.resolve({data:null}),
      ]);
      if(stageResult.error || configResult.error || dayResult.error) throw stageResult.error || configResult.error || dayResult.error;
      const latest=stageResult.data || [];
      const nextInventory=classificationInventory(configResult.data || [],latest);
      configByKind.clear(); nextInventory.forEach(row=>configByKind.set(row.classKind,row));
      let currentRows=latest.filter(row=>keyForStage(row)===activeKey);
      if(lastRacedDay && keyForDay(lastRacedDay)===activeKey) {
        const final=latest.filter(row=>keyForStage(row)==='final');
        currentRows=currentRows.filter(row=>!final.some(f=>f.classKind===row.classKind)).concat(final);
      }
      const cancelled=activeStages.find(row=>row._cancelledStage);
      if(cancelled) currentRows=activeStages.filter(row=>row._cancelledStage || row._carriedFromStage!=null);
      activeStages.splice(0,activeStages.length,...visibleStageClassifications(currentRows,nextInventory));
      if(!activeStages.some(row=>row.classKind===activeClass.classKind) && activeStages.length) activeClass=activeStages[0];
      const rail=content.querySelector('#resTabsInner');
      if(rail) {
        const focusedKind=rail.contains(document.activeElement)?document.activeElement.dataset.class:null;
        const tabsChanged=updateResultsHtml(rail,activeStages.length > 1 ? activeStages.map(row=> {
          const cfg=configByKind.get(row.classKind),color=classificationColor(cfg),active=row.classKind===activeClass.classKind;
          return `<button class="res-tab${active?' res-tab--active':''}" style="${color?`--class-color:${color}`:''}" aria-pressed="${active}" data-class="${esc(row.classKind)}">${esc(classificationLabel(cfg,lang))}</button>`;
        }).join('') : '');
        if(tabsChanged && focusedKind) [...rail.children].find(button=>button.dataset.class===focusedKind)?.focus({preventScroll:true});
      }
      const nextKeys=[...new Set([...latest.map(keyForStage),...racedWithStage.filter(d=>d.isCancelledDay).map(keyForDay)])].sort((a,b)=> {const [na,sa]=keyRank(a),[nb,sb]=keyRank(b);return na-nb||sa.localeCompare(sb);});
      if(JSON.stringify(nextKeys)!==JSON.stringify(stageKeys)) {
        stageKeys.splice(0,stageKeys.length,...nextKeys);
        stagesInner.innerHTML=stageNavigationHtml(stageKeys, activeKey, { canonBase, canonSlug, isEn: _isEn });
        document.getElementById('resStages').hidden=stageKeys.length<2;
      }
      const fresh=activeStages.find(row=>row.classKind===activeClass.classKind)||activeStages[0];
      if(fresh) await renderClassification(fresh,{refresh:true});
      if(dayResult.data) {
        const nextDay=dayResult.data;
        if(JSON.stringify([nextDay.elevationProfile,nextDay.profileSummits,nextDay.profileWaypoints,nextDay.distanceKm])!==JSON.stringify([contextDay?.elevationProfile,contextDay?.profileSummits,contextDay?.profileWaypoints,contextDay?.distanceKm])) mountStageProfile(document.getElementById('resProfile'),{day:nextDay,race,assets:contextAssets,hidePointNames:true});
        contextDay=nextDay;
        if(raceDayId) raceDay=nextDay;
        const list=content.querySelector('.res-stage-data dl');if(list) updateResultsHtml(list,stageMetricsHtml(contextDay));
      }
      lastProbe = nextProbe;
    } catch { showPublication(displayedStage||activeClass,true); }
    finally { refreshing=false; }
  };
  const refreshTimer=setInterval(refreshCurrent,60000);
  document.addEventListener('visibilitychange',refreshCurrent);
  window.addEventListener('pagehide',()=> {clearInterval(refreshTimer);document.removeEventListener('visibilitychange',refreshCurrent);window.removeEventListener('resize',centerActiveStage);document.getElementById('resProfile')?._profileCleanup?.();},{once:true});
}

// Esperar a cargar las traducciones (en.json) antes de renderizar: el panel de
// botones usa t('assets.*'), que sin esto cae al diccionario ES embebido.
// El diccionario EN (assets.* de buildActionButtons) se carga en paralelo con
// los datos; init lo espera antes de pintar.
init(initI18n()).catch(() => {
  const en=getLang()==='en',content=document.getElementById('resultsContent');
  content.innerHTML=`<div class="startlist-empty" role="status">${en?'Unable to load results.':'No se han podido cargar los resultados.'} <button type="button" data-initial-retry>${en?'Retry':'Reintentar'}</button></div>`;
  content.querySelector('[data-initial-retry]').addEventListener('click',()=>location.reload());
});
