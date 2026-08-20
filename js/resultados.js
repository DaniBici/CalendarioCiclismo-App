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
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, esc, setMeta, setMetaProperty, jornadaUrl,
         raceUrl, raceName as getRaceName, enBase, findMatchingTeam, normalizeTeamName, teamLinkUrl,
         buildRaceHeader, buildActionButtons, buildTeamBadgeSvg, riderLinkUrl,
         isIndividualPlaceholderTeam, effectiveCountryCode } from './shared.js';
import { getLang, initI18n } from './i18n.js';
import { IRM_LABELS, isAbandonIrm, irmDescription } from './uci-irm.js';
import { sectorSuffixMap, resultStageEntryKey, parseResultStageKey } from './services/races.js';

// Orden y etiquetas de las clasificaciones (las pestañas se muestran en este orden).
const CLASS_ORDER = ['stage', 'gc', 'points', 'kom', 'youth', 'teams'];
const CLASS_LABELS = {
  stage:  { es: 'Etapa',    en: 'Stage' },
  gc:     { es: 'General',  en: 'GC' },
  points: { es: 'Puntos',   en: 'Points' },
  kom:    { es: 'Montaña',  en: 'KOM' },
  youth:  { es: 'Jóvenes',  en: 'Youth' },
  teams:  { es: 'Equipos',  en: 'Teams' },
};
// Columna derivada de puntos UCI. Solo nace si la clasificación concede alguno;
// queda justo antes de Tiempo/Pts: puesto · identidad · [equipo] · [UCI] · resultado.
function hasUciPoints(rows) {
  return rows.some((row) => row?.uciPoints != null);
}
function formatUciPoints(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2).replace(/\.?0+$/, '');
}
function uciPointsHeaderHtml(show) {
  return show ? '<th class="so-th res-th--uci">UCI</th>' : '';
}
function uciPointsCellHtml(show, row) {
  if (!show) return '';
  const value = row?.uciPoints;
  return `<td class="so-td res-td--uci">${esc(formatUciPoints(value))}</td>`;
}
// Marcadores especiales (no clasificados, DNF/DNS/OTL/DSQ): IRM_LABELS vive en
// uci-irm.js (fuente única, compartida con el tachado de inscritos). Se muestran
// SOLO en la columna de puesto (#), con la etiqueta corta localizada.

function stagePathLabel(stageNumber, isEn, suffix = '') {
  if (stageNumber === 0) return isEn ? 'Prologue' : 'Prólogo';
  if (stageNumber != null) return isEn ? `Stage ${stageNumber}${suffix}` : `Etapa ${stageNumber}${suffix}`;
  return isEn ? 'Final classification' : 'Clasificación final';
}

// "H:MM:SS" | "MM:SS" | "SS" → segundos (o null si no parsea).
function timeToSeconds(txt) {
  if (!txt) return null;
  const parts = String(txt).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
// segundos → gap con la convención de la prensa ciclista (PCS):
//   <1min  → +SS"        (p. ej. +7")
//   <1h    → +M'SS"      (p. ej. +1'38")
//   ≥1h    → +H:MM:SS    (p. ej. +1:02:41)
function secondsToGap(sec) {
  if (sec == null || sec < 0) return null;
  // Segundos ENTEROS siempre (regla de carretera: el tiempo oficial se trunca al
  // segundo). El floor también mata el error flotante de derivar con decimales.
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `+${h}:${String(m).padStart(2, '0')}:${ss}`;
  if (m > 0) return `+${m}'${ss}"`;
  return `+${s}"`;
}
// segundos → tiempo absoluto "H:MM:SS" (inverso de timeToSeconds; sin '+').
function secondsToTimeText(sec) {
  if (sec == null || sec < 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Normaliza un gap al formato de prensa. La UCI publica los gaps con ':' como
// separador único y SIN unidades ("+41" = 41s, "+1:56" = 1m56s, "+3:13" = 3m13s,
// "+35:09" = 35m09s, "+1:02:41" = 1h02m41s) → re-emitir como +SS"/+M'SS"/+H:MM:SS.
// Si el gap ya trae las marcas de prensa (' o ") se devuelve tal cual.
function formatGap(gap) {
  if (!gap) return gap;
  const t = String(gap).trim();
  if (t.includes("'") || t.includes('"')) return t;   // ya formateado
  const sec = timeToSeconds(t.replace(/^\+/, ''));      // "+3:13" → 193
  return sec != null ? secondsToGap(sec) : t;
}
// Limpia un tiempo absoluto para PRESENTACIÓN: recorta el bloque de horas a
// cero ("0:06:36"/"00:30:36" → "6:36"/"30:36"), el cero a la izquierda del
// primer bloque y los DECIMALES enteros fuera ("1:04.869" → "1:04"): en
// carretera el tiempo oficial se cuenta en segundos enteros (truncado). La UCI
// publica los tiempos con formatos muy dispares (visto en las CRI del backfill).
function cleanTimeText(txt) {
  if (!txt) return '';
  let t = String(txt).trim();
  t = t.replace(/^0+:(?=\d)/, '');         // fuera el bloque de horas "0:"/"00:"
  t = t.replace(/^0(?=\d:)/, '');          // "06:36" → "6:36"
  t = t.replace(/\.\d+$/, '');             // decimales fuera (segundos enteros)
  return t;
}
// segundos → tiempo absoluto ("6:36" · "45:53" · "1:05:05"): sin horas a cero
// y en segundos ENTEROS (truncado, regla de carretera).
function secondsToAbsText(sec) {
  if (sec == null || sec < 0) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
// segundos (enteros) → tiempo absoluto en NOTACIÓN DE PRENSA: 20'52" (sub-hora;
// ≥1h sigue el mismo escalón H:MM:SS que secondsToGap). Para el tiempo del
// ganador de una CRI: "20:52.99" → 20'52" (truncado, segundos enteros).
function secondsToPressTime(sec) {
  if (sec == null || sec < 0) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}'${String(s).padStart(2, '0')}"`;
}
// Segmento de path de una etapa: etapa-N / prologo / (vacío = carrera/general).
function stageSlugSegment(stageNumber, isEn, suffix = '') {
  if (stageNumber === 0) return isEn ? 'prologue' : 'prologo';
  const sfx = (suffix || '').toLowerCase();
  if (stageNumber != null) return isEn ? `stage-${stageNumber}${sfx}` : `etapa-${stageNumber}${sfx}`;
  return '';
}

async function init() {
  window.__spaDrivenAnalytics = true;
  const params  = new URLSearchParams(window.location.search);
  const content = document.getElementById('resultsContent');
  const _isEn   = getLang() === 'en';
  const lang    = _isEn ? 'en' : 'es';
  const empty = (msgEs, msgEn) =>
    content.innerHTML = `<div class="startlist-empty">${_isEn ? msgEn : msgEs}</div>`;

  // Etiqueta corta de un código IRM (ABN/NS/FC/EXP) con su descripción larga
  // como tooltip (title) — p. ej. "Abandono" / "Did not finish". El corredor que
  // abandona rara vez es de WT/PT (sin tooltip de ficha), así que el title es la
  // única pista de qué significa la abreviatura.
  const dnfBadge = (code) => {
    const label = (IRM_LABELS[code] || { es: code, en: code })[lang];
    const desc  = irmDescription(code, lang, race?.gender === 'female');
    const title = desc ? ` title="${esc(desc)}"` : '';
    return `<span class="res-rank-dnf"${title}>${esc(label)}</span>`;
  };

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
    const { renderResultsFeed } = await import('./resultados-feed.js');
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
  let race = null;
  if (raceId) {
    const { data } = await supabase.from('races').select('*').eq('id', raceId).maybeSingle();
    race = data || null;
  } else if (raceSlug) {
    const slugField = _isEn ? 'slugEn' : 'slug';
    let { data } = await supabase.from('races').select('*').eq(slugField, raceSlug).maybeSingle();
    if (!data && _isEn) {
      ({ data } = await supabase.from('races').select('*').eq('slug', raceSlug).maybeSingle());
    }
    race = data || null;
  }
  if (!race) { empty('No se encontró la carrera.', 'Race not found.'); return; }
  raceId = race.id;

  // Botón atrás — volver a la página de procedencia si es del mismo origen
  // (p. ej. la jornada desde la que se navegó), si no a la carrera.
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    const referrer = document.referrer;
    const sameOrigin = referrer && new URL(referrer, location.href).origin === location.origin
      && new URL(referrer, location.href).pathname !== location.pathname;
    if (sameOrigin) {
      backBtn.href = referrer;
      backBtn.addEventListener('click', (e) => { e.preventDefault(); history.back(); });
    } else {
      backBtn.href = raceUrl(race);
    }
  }

  // ── Clasificaciones disponibles (keepForWeb) de esta carrera ───────
  const { data: stagesAll } = await supabase
    .from('race_uci_stages')
    .select('*')
    .eq('raceId', raceId)
    .eq('keepForWeb', true)
    .order('stageNumber', { ascending: true });

  // ── Jornadas de la carrera ─────────────────────────────────────────
  // Se cargan ANTES de armar las pestañas porque una etapa CANCELADA no tiene
  // clasificaciones propias y su pantalla se construye a partir de la jornada
  // (aviso de cancelada) + las generales de la etapa anterior. El orden
  // canónico es cronológico (dateKey, luego hora de salida) — el mismo que usan
  // Hoy/Mes y las apps para los dobles sectores: la "etapa anterior" de un
  // sector B es su sector A, y la del día siguiente a un doble sector es el B.
  const { data: allRaceDays } = await supabase
    .from('race_days')
    .select('id, "stageNumber", "dateKey", "isCancelledDay", "isRestDay", "neutralStartTimeUtc"')
    .eq('raceId', raceId)
    .order('dateKey', { ascending: true })
    .order('neutralStartTimeUtc', { ascending: true, nullsFirst: true });
  const racedDays = (allRaceDays || []).filter(d => !d.isRestDay);
  // Dobles sectores (etapa partida 3A/3B): dos jornadas del mismo día con el
  // MISMO entero stageNumber. Se separan por raceDayId (cada clasificación lleva
  // el de SU sector). suffixByDayId: raceDayId → 'A'/'B'; sectoredNums: los
  // stageNumber que son doble sector.
  const { suffixByDayId, sectoredNums } = sectorSuffixMap(racedDays);
  const keyForDay = (d) => resultStageEntryKey(d.stageNumber, d.id, suffixByDayId, sectoredNums);
  const keyForStage = (st) => resultStageEntryKey(st.stageNumber, st.raceDayId, suffixByDayId, sectoredNums);
  // clave de entrada → jornada (para el raceDayId y el estado de cancelación).
  const dayByKey = new Map();
  for (const d of racedDays) if (d.stageNumber != null) {
    const k = keyForDay(d);
    if (!dayByKey.has(k)) dayByKey.set(k, d);
  }
  // Etapa anterior EN CARRERA (salta descansos y otras canceladas), en orden
  // cronológico: para un sector B es su sector A, para el día siguiente a un
  // doble sector es el B. racedDays ya viene ordenado por dateKey y hora.
  const racedWithStage = racedDays.filter(d => d.stageNumber != null);
  const prevRacedKey = (day) => {
    const idx = racedWithStage.findIndex(d => d.id === day.id);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      if (!racedWithStage[i].isCancelledDay) return keyForDay(racedWithStage[i]);
    }
    return null;
  };

  // Agrupar por entrada (clave sector-consciente; 'final' = clasificación final).
  const stagesByNum = new Map();   // key: '3' | '3A' | 'final' → [stage rows]
  for (const st of (stagesAll || [])) {
    const key = keyForStage(st);
    if (!stagesByNum.has(key)) stagesByNum.set(key, []);
    stagesByNum.get(key).push(st);
  }
  // Una etapa CANCELADA no se corrió: sus propias clasificaciones (si el cron
  // llegó a volcar algo antes de la cancelación) NO se muestran. Su pantalla es
  // sintética: pestaña "Etapa" con el aviso + generales de la etapa ANTERIOR
  // (mismas filas, solo presentación: no se vuelca nada). Sin etapa anterior
  // (cancelación en la etapa 1) no hay generales que arrastrar → solo el aviso.
  for (const day of racedWithStage) {
    if (!day.isCancelledDay) continue;
    const key = keyForDay(day);
    const prevKey = prevRacedKey(day);
    const carried = prevKey != null
      ? (stagesByNum.get(prevKey) || []).filter(s => s.classKind !== 'stage')
      : [];
    const prevMeta = prevKey != null ? parseResultStageKey(prevKey) : null;
    // La pestaña "Etapa" es un marcador sin filas: la pinta el aviso de cancelada.
    stagesByNum.set(key, [
      { id: `cancelled-${key}`, stageNumber: day.stageNumber, classKind: 'stage', _cancelledStage: true,
        raceDayId: day.id },
      ...carried.map(s => ({ ...s, _carriedFromStage: prevMeta ? prevMeta.stageNumber : null,
                             _carriedFromSuffix: prevMeta ? prevMeta.suffix : '' })),
    ]);
  }
  const keyRank = (k) => {
    if (k === 'final') return [Infinity, ''];
    const p = parseResultStageKey(k);
    return [p.stageNumber == null ? Infinity : p.stageNumber, p.suffix || ''];
  };
  const stageKeys = [...stagesByNum.keys()].sort((a, b) => {
    const [na, sa] = keyRank(a), [nb, sb] = keyRank(b);
    return (na - nb) || sa.localeCompare(sb);
  });

  // Las generales del ÚLTIMO día (clasificación final, stageNumber null) se
  // muestran TAMBIÉN bajo la última etapa numerada — duplicado visual a petición:
  // la pantalla 'F' se conserva intacta y todas las generales aparecen a la vez en
  // los dos sitios. NO se vuelcan dos veces (es solo presentación: mismas filas por
  // id de clasificación). Si la etapa ya trae una clasificación del mismo tipo
  // (p. ej. su 'gc' del día), manda la final (es la oficial del último día).
  {
    const finalStages = stagesByNum.get('final');
    const numericKeys = stageKeys.filter(k => k !== 'final');
    if (finalStages && finalStages.length && numericKeys.length) {
      const lastNum = numericKeys[numericKeys.length - 1];
      const finalKinds = new Set(finalStages.map(s => s.classKind));
      const kept = stagesByNum.get(lastNum).filter(s => !finalKinds.has(s.classKind));
      stagesByNum.set(lastNum, kept.concat(finalStages));
    }
  }

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

  // Registra un page_view "pendiente" (mismo evento que el de la carga normal,
  // línea ~446) antes de los `return` de más abajo — si no, esta categoría de
  // páginas (adelantadas, aún sin datos) queda invisible en GA4.
  const logPendingView = (stageNumberForTitle, suffixForTitle = '') => {
    const heroTitle = [getRaceName(race) || '', race.year || ''].filter(Boolean).join(' ');
    const stageLabel = stagePathLabel(stageNumberForTitle, _isEn, suffixForTitle);
    const titleStage = race.raceFormat === 'one_day' ? '' : ` · ${stageLabel}`;
    document.title = _isEn ? `Results — ${heroTitle}${titleStage}` : `Resultados — ${heroTitle}${titleStage}`;
    if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  };

  // Etapa activa: la pedida si existe; si no, la última con datos. Un número
  // pelado que resulta ser doble sector (`/etapa-3/` sin letra) cae a su sector A.
  let activeKey = requestedKey === undefined ? stageKeys[stageKeys.length - 1] : requestedKey;
  if (requestedKey !== undefined && !stagesByNum.has(activeKey) && (stageSuffixParam || '') === ''
      && requestedStage != null && sectoredNums.has(requestedStage)) {
    const firstSector = stageKeys.find(k => parseResultStageKey(k).stageNumber === requestedStage);
    if (firstSector) activeKey = firstSector;
  }
  if (!stagesByNum.has(activeKey)) {
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
  const activeStages = stagesByNum.get(activeKey);
  const { stageNumber: activeStageNumber, suffix: activeSuffix } = parseResultStageKey(activeKey);

  // Clasificaciones de la etapa activa, ordenadas por CLASS_ORDER.
  activeStages.sort((a, b) => CLASS_ORDER.indexOf(a.classKind) - CLASS_ORDER.indexOf(b.classKind));
  // Clasificación seleccionada (hash #stage|#gc|… o la primera).
  const hashClass = (location.hash || '').replace('#', '');
  let activeClass = activeStages.find(s => s.classKind === hashClass) || activeStages[0];

  // ── Normalizar URL al path limpio ──────────────────────────────────
  const canonSlug = _isEn ? (race.slugEn || race.slug) : race.slug;
  const canonBase = _isEn ? `${enBase()}/results/` : '/resultados/';
  const seg = stageSlugSegment(activeStageNumber, _isEn, activeSuffix);
  if (canonSlug) {
    history.replaceState(null, '', `${canonBase}${encodeURIComponent(canonSlug)}/${seg ? seg + '/' : ''}`);
  }

  // ── Reconstruir corredores por dorsal contra la startlist ──────────
  // startlist_riders: dorsal → globalRiderId/nombre/bandera/equipo (curado).
  // OJO: startlist_riders.teamId apunta al **PK** de startlist_teams (id), NO a
  // su columna teamId (que es la referencia canónica a teams). El equipo canónico
  // (para el slug de /equipo/) se resuelve por ese teamId canónico de la fila.
  const byDorsal = new Map();          // dorsal(int) → snapshot resuelto de la startlist
  const byStartlistRider = new Map();  // globalRiderId → el mismo snapshot de la startlist
  let raceTeams = [];
  let startlistTeams = [];
  const teamBySlugId = new Map();   // teamId canónico → fila teams (hoisted: lo reusa enrichRiders)
  {
    const [{ data: slRiders }, { data: slTeams }] = await Promise.all([
      // Vista RESUELTA (no la tabla cruda): nombre/país canónicos de la ficha
      // riders_men/women vía globalRiderId, con el snapshot de fallback. Así una
      // edición de ficha se refleja aquí sin re-importar la startlist (igual que
      // inscritos). `teamId` = PK de startlist_teams (se conserva en la vista).
      supabase.from('startlist_riders_resolved')
        .select('dorsal, firstName, lastName, countryCode, teamId, globalRiderId')
        .eq('raceId', raceId),
      supabase.from('startlist_teams').select('id, teamId, teamName').eq('raceId', raceId),
    ]);
    // PK de la fila de startlist_teams → { teamName, canonical teamId }.
    startlistTeams = slTeams || [];
    const slTeamByPk = new Map(startlistTeams.map(t => [t.id, t]));
    // Equipos canónicos (para enlazar a /equipo/<slug>/): teamId canónico → fila teams.
    const canonIds = [...new Set(startlistTeams.map(s => s.teamId).filter(Boolean))];
    if (canonIds.length) {
      const { data } = await supabase
        .from('teams')
        .select('id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle')
        .in('id', canonIds);
      raceTeams = data || [];
      raceTeams.forEach(t => teamBySlugId.set(t.id, t));
    }
    (slRiders || []).forEach(r => {
      const slTeam = r.teamId ? slTeamByPk.get(r.teamId) : null;       // fila por PK
      const canon  = slTeam?.teamId ? teamBySlugId.get(slTeam.teamId) : null;
      // Ficticio "Individual" (corredor sin equipo en la fuente) → ocultación
      // cosmética: sin nombre de equipo, y en cascada sin chapa ni opción de filtro.
      const slName = isIndividualPlaceholderTeam(slTeam) ? '' : (slTeam?.teamName || '');
      const snapshot = {
        name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        countryCode: r.countryCode || '',
        // Equipo casado → nombre canónico del catálogo (Title Case);
        // sin casar → el crudo de la startlist (p. ej. "TEAM RINGERIKE" de la UCI).
        teamName: canon?.name || slName,
        teamObj: canon || null,   // para la chapa (solo desktop)
      };
      if (r.dorsal != null) byDorsal.set(r.dorsal, snapshot);
      // Los resultados introducidos a mano pueden no llevar dorsal. Si el panel
      // ya los enlazó a una ficha presente en la startlist, el equipo inscrito
      // sigue siendo la fuente de verdad y debe ganar al equipo actual de la ficha.
      if (r.globalRiderId) byStartlistRider.set(r.globalRiderId, snapshot);
    });
  }
  const startlistRiderForResult = (row) => {
    const dorsal = row?.bib != null && /^\d+$/.test(String(row.bib)) ? Number(row.bib) : null;
    return (dorsal != null ? byDorsal.get(dorsal) : null)
      || (row?.globalRiderId ? byStartlistRider.get(row.globalRiderId) : null)
      || null;
  };
  // La clasificación por equipos debe conservar el snapshot que figura en los
  // inscritos. Primero se resuelve por teamId; los cronometrajes colombianos
  // abrevian varios nombres, por lo que aceptamos solo una segunda coincidencia
  // inequívoca de dos o más tokens distintivos (nunca un "mejor" empate).
  const startlistTeamForResult = (resultRow) => {
    if (resultRow?.teamId) {
      const byId = startlistTeams.find(t => t.teamId === resultRow.teamId);
      if (byId) return byId;
    }
    const source = normalizeTeamName(resultRow?.riderDisplay || '');
    if (!source) return null;
    const exact = startlistTeams.filter(t => normalizeTeamName(t.teamName) === source);
    if (exact.length === 1) return exact[0];
    const wanted = new Set(source.split(' ').filter(Boolean));
    const scored = startlistTeams.map((team) => ({
      team,
      score: normalizeTeamName(team.teamName).split(' ').filter(token => wanted.has(token)).length,
    }));
    const max = Math.max(0, ...scored.map(item => item.score));
    const candidates = scored.filter(item => item.score === max);
    return max >= 2 && candidates.length === 1 ? candidates[0].team : null;
  };
  // Fallback por nombre (eventos de equipos: el dorsal es del equipo, no del corredor).
  const teamHrefByName = (teamName) => {
    if (!teamName || !raceTeams.length) return null;
    // teamLinkUrl decide: enlaces globalmente desactivados POR EL MOMENTO → null.
    return teamLinkUrl(findMatchingTeam(teamName, raceTeams));
  };

  // ── Fallback por globalRiderId (carreras SIN startlist: campeonatos
  // nacionales y demás volcados in-house sin inscritos curados) ──────────
  // Cuando una fila trae globalRiderId pero no casa por dorsal con la startlist
  // (porque no hay), la ficha del corredor existe igualmente: resolvemos su
  // bandera (nationality) y su equipo ACTUAL (currentTeamId → categoría/nombre/
  // chapa) directamente de riders_men/women, para que la fila muestre bandera +
  // chapa + equipo y enlace a /corredor/<id>/ igual que una fila con startlist.
  // Cache perezosa, poblada por renderClassification según aparecen ids nuevos.
  const byRider = new Map();   // globalRiderId → { name, countryCode, teamName, teamHref, teamObj, riderHref }
  async function enrichRiders(ids) {
    const need = [...new Set(ids)].filter(id => id && !byRider.has(id));
    if (!need.length) return;
    const [{ data: men }, { data: women }] = await Promise.all([
      supabase.from('riders_men').select('id, firstName, lastName, nationality, currentTeamId').in('id', need),
      supabase.from('riders_women').select('id, firstName, lastName, nationality, currentTeamId').in('id', need),
    ]);
    const riders = [...(men || []), ...(women || [])];
    // Equipos actuales: reusar los canónicos ya cargados (teamBySlugId) y
    // completar los que falten (nombre/slug/categoría/chapa para el badge).
    const curIds = [...new Set(riders.map(r => r.currentTeamId).filter(Boolean))];
    const teamById = new Map();
    curIds.forEach(id => { const t = teamBySlugId.get(id); if (t) teamById.set(id, t); });
    const missing = curIds.filter(id => !teamById.has(id));
    if (missing.length) {
      const { data } = await supabase
        .from('teams')
        .select('id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle')
        .in('id', missing);
      (data || []).forEach(t => teamById.set(t.id, t));
    }
    for (const r of riders) {
      const team = r.currentTeamId ? teamById.get(r.currentTeamId) : null;
      byRider.set(r.id, {
        // Nombre canónico de la ficha (orden natural "Nombre Apellido"). El
        // render lo prefiere al riderDisplay crudo (que en CN sin startlist
        // llega como "APELLIDO Nombre" de la fuente). Así el formato del
        // riderDisplay deja de importar cuando la fila está enlazada a ficha.
        name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim(),
        countryCode: r.nationality || '',
        teamName: team?.name || '',
        teamHref: teamLinkUrl(team),
        teamObj: team || null,
        // Mismo gate estricto que la ficha: solo divisiones top.
        riderHref: riderLinkUrl(r.id, team),
      });
    }
    // ids sin ficha (no estaban en riders_*): marcar como vistos (vacío) para no
    // re-consultar en cada render.
    need.forEach(id => { if (!byRider.has(id)) byRider.set(id, null); });
  }

  // ── Override manual de equipo (race_uci_results.teamId) ────────────────
  // Carga perezosa de los equipos canónicos referidos por un teamId de override,
  // reutilizando teamBySlugId (ya poblado por la startlist) y completando los que
  // falten con la chapa + nombre.
  async function enrichOverrideTeams(ids) {
    const need = [...new Set(ids)].filter(id => id && !teamBySlugId.has(id));
    if (!need.length) return;
    const { data } = await supabase
      .from('teams')
      .select('id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle')
      .in('id', need);
    (data || []).forEach(t => teamBySlugId.set(t.id, t));
  }
  // Resuelve un teamId de override a su equipo canónico (nombre + chapa + enlace).
  // Requiere que enrichOverrideTeams haya corrido antes para el id en cuestión.
  const overrideTeam = (teamId) => {
    if (!teamId) return null;
    const team = teamBySlugId.get(teamId);
    return team ? { teamName: team.name, teamHref: teamLinkUrl(team), teamObj: team } : null;
  };

  // ── Jornada de la etapa activa (para detalle de cabecera + botón) ──
  // Cada clasificación keepForWeb arrastra su raceDayId; de él salen la ruta
  // (salida › meta), la distancia y el tipo (CRI/CRE), como en orden-salida.
  const RD_COLS = 'id, slug, slugEn, startLocation, finishLocation, startLocationEn, finishLocationEn, distanceKm, primaryType, countryCode';
  // raceDayId de la etapa activa: el que arrastra la clasificación, o —si el
  // volcado no lo trajo (race_uci_stages.raceDayId NULL)— el de la jornada que
  // corresponde a esta entrada (`dayByKey`, casada por stageNumber). Sin este
  // segundo, la cabecera cae al país de la CARRERA e ignora el override por
  // jornada (p. ej. Giro della Valle d'Aosta et1, en Francia, countryCode='FR').
  let raceDayId = activeStages.find(s => s.raceDayId)?.raceDayId
    || dayByKey.get(activeKey)?.id || null;
  let raceDay = null;
  if (raceDayId) {
    const { data: rdRow } = await supabase
      .from('race_days').select(RD_COLS).eq('id', raceDayId).maybeSingle();
    raceDay = rdRow || null;
  }
  // Pruebas de un día (o GC final sin raceDayId): la "Final Classification" no
  // mapea a race_days → raceDayId NULL. Si la carrera tiene una sola jornada,
  // la cargamos por raceId para que la cabecera muestre ruta + distancia igual.
  if (!raceDay) {
    const { data: rdRows } = await supabase
      .from('race_days').select(RD_COLS).eq('raceId', race.id).order('stageNumber', { ascending: true }).limit(2);
    if (rdRows && rdRows.length === 1) { raceDay = rdRows[0]; raceDayId = raceDay.id; }
  }

  // ── SEO / cabecera ─────────────────────────────────────────────────
  const raceNameStr = getRaceName(race) || '';
  const year = race.year || '';
  const stageLabel = stagePathLabel(activeStageNumber, _isEn, activeSuffix);
  const heroTitle = [raceNameStr, year].filter(Boolean).join(' ');
  // En pruebas de un día NO hay etapas → el sufijo "· Clasificación final" es
  // redundante y se omite del título (igual que en detailLine más abajo).
  const titleStage = race.raceFormat === 'one_day' ? '' : ` · ${stageLabel}`;
  const pageTitle = _isEn
    ? `Results — ${heroTitle}${titleStage}`
    : `Resultados — ${heroTitle}${titleStage}`;
  document.title = pageTitle;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: document.title });
  setMeta('description', _isEn
    ? `Official results for ${heroTitle} — ${stageLabel}: stage classification, GC, points, KOM and youth.`
    : `Resultados oficiales de ${heroTitle} — ${stageLabel}: clasificación de etapa, general, puntos, montaña y jóvenes.`);
  setMetaProperty('og:title', pageTitle);

  const esOrigin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
  const canonicalUrl = canonSlug
    ? (_isEn
        ? `${esOrigin}/en/results/${encodeURIComponent(race.slugEn || race.slug)}/${seg ? seg + '/' : ''}`
        : `${esOrigin}/resultados/${encodeURIComponent(race.slug)}/${seg ? seg + '/' : ''}`)
    : location.href.split('?')[0];
  setMetaProperty('og:url', canonicalUrl);
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

  // Ruta (salida › meta) + distancia de la jornada — como en orden-salida.
  const STAGE_TYPE_LABELS = { itt: { es: 'CRI', en: 'ITT' }, ttt: { es: 'CRE', en: 'TTT' } };
  const startLoc  = (_isEn ? raceDay?.startLocationEn : null) || raceDay?.startLocation || '';
  const finishLoc = (_isEn ? raceDay?.finishLocationEn : null) || raceDay?.finishLocation || '';
  const sameOrOne = !finishLoc || startLoc === finishLoc;
  const routeLabel = sameOrOne ? (startLoc || finishLoc || '') : `${startLoc} › ${finishLoc}`;
  // Kilometraje con separador decimal del locale (175,5 km en ES; 175.5 en EN),
  // como en jornada.js (toLocaleString), NO interpolación cruda (siempre da punto).
  const distLabel = raceDay?.distanceKm
    ? `${Number(raceDay.distanceKm).toLocaleString(_isEn ? 'en-GB' : 'es-ES')} km` : '';
  const ttEntry = raceDay?.primaryType ? STAGE_TYPE_LABELS[raceDay.primaryType] : null;
  const ttLabel = ttEntry ? ttEntry[_isEn ? 'en' : 'es'] : '';
  // Detalle: etapa · [CRI/CRE] · ruta · distancia.
  // En pruebas de un día la etiqueta "Clasificación final" es redundante (no hay
  // etapas que distinguir) → se omite y el detalle arranca por la ruta.
  const isOneDay = race.raceFormat === 'one_day';
  const detailLine = [isOneDay ? '' : stageLabel, ttLabel, routeLabel, distLabel].filter(Boolean).join(' · ');

  const resultsLabel = _isEn ? 'Results' : 'Resultados';
  // "Volver a todos los resultados" vive en el botón ← del header (apunta al
  // feed /resultados/ · /en/results/), no en el cuerpo de la página.
  const feedHref = _isEn ? `${enBase()}/results/` : '/resultados/';
  const feedLabel = _isEn ? 'All results' : 'Todos los resultados';
  if (typeof window.ccHeaderBack === 'function') {
    window.ccHeaderBack({ href: feedHref, label: feedLabel });
  }
  let html = '';
  // País efectivo: la jornada puede transcurrir en un país distinto al de la
  // carrera (p. ej. una etapa del Tour que sale de Italia) → prevalece el de la
  // jornada. Mismo criterio de ocultar bandera que buildRaceHero.
  const showHeaderFlag = !(race?.hideFlag && !raceDay?.countryCode);
  html += buildRaceHeader({
    race,
    countryCode: effectiveCountryCode(raceDay, race),
    hideFlag: !showHeaderFlag,
    nameHref: race.raceFormat !== 'one_day' ? raceUrl(race) : undefined,
    label: resultsLabel,
    detail: detailLine,
  });
  // Solo navegación: web oficial + "Ir a la etapa/carrera" (sin inscritos ni
  // botones de recorrido — en Resultados esos botones se consideran superfluos).
  html += buildActionButtons({
    race,
    rd: raceDay || { id: raceDayId, slug: raceDay?.slug, slugEn: raceDay?.slugEn },
    view: 'resultados',
    navOnly: true,
    style: 'max-width:860px;padding:0 1.5rem;margin:0.85rem auto',
  });

  // ── Selector de ETAPA (si hay más de una con datos) ────────────────
  if (stageKeys.length > 1) {
    html += `<div class="res-stages" id="resStages"><div class="res-stages__inner" id="resStagesInner">`;
    for (const k of stageKeys) {
      const { stageNumber: num, suffix: sfx } = parseResultStageKey(k);
      const seg2 = stageSlugSegment(num, _isEn, sfx);
      const href = `${canonBase}${encodeURIComponent(canonSlug)}/${seg2 ? seg2 + '/' : ''}`;
      const isActive = k === activeKey;
      const aria = num != null
        ? (_isEn ? `Stage ${num}${sfx}` : `Etapa ${num}${sfx}`)
        : (_isEn ? 'Final classification' : 'Clasificación final');
      // Cápsula: P (prólogo), F (final) o el número con su sufijo de sector (3A).
      const cap = num === 0 ? 'P' : (num != null ? `${num}${sfx}` : 'F');
      html += `<a class="res-stage-btn${isActive ? ' res-stage-btn--active' : ''}" href="${href}" title="${esc(aria)}"${isActive ? ' aria-current="page" data-active="true"' : ''}>${esc(cap)}</a>`;
    }
    html += `</div></div>`;
  }

  // ── Barra de CLASIFICACIÓN: pestañas (izq) + filtro por equipo (der) ──
  // Las pestañas solo si hay >1 clasificación (un día → 1 sola, sin pestañas).
  // El filtro por equipo (slot a la derecha) lo rellena renderClassification;
  // la barra se emite si hay pestañas O si la clasif activa es individual.
  const hasTabs = activeStages.length > 1;
  const activeIsIndividual = !(activeClass.classKind === 'teams' || activeClass.isTeamEvent);
  if (hasTabs || activeIsIndividual) {
    // Carril exterior a sangre: lleva el sticky y el fondo opaco (las filas
    // scrollean por debajo). .res-tabs queda dentro, centrado a 860px.
    html += `<div class="res-tabs-bar"><div class="res-tabs" id="resTabs"><div class="res-tabs__scroll"><div class="res-tabs__inner" id="resTabsInner">`;
    if (hasTabs) {
      for (const st of activeStages) {
        const lbl = (CLASS_LABELS[st.classKind] || { es: st.classKind, en: st.classKind })[lang];
        const isActive = st.id === activeClass.id;
        html += `<button class="res-tab${isActive ? ' res-tab--active' : ''}" data-class="${esc(st.classKind)}" data-stageref="${esc(st.id)}">${esc(lbl)}</button>`;
      }
    }
    html += `</div>`;   // .res-tabs__inner
    if (hasTabs) {
      // Chevron de "más clasificaciones": indica que las pestañas siguen tras el
      // borde derecho (paridad con las apps; sin degradado: mismo color → señal
      // invisible, descartado en las apps). Se oculta al llegar al final.
      const moreLbl = _isEn ? 'More classifications' : 'Más clasificaciones';
      html += `<button class="res-tabs__more" id="resTabsMore" type="button" aria-label="${esc(moreLbl)}" title="${esc(moreLbl)}" hidden><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>`;
    }
    html += `</div>`;   // .res-tabs__scroll
    // Separador vertical entre las pestañas y el selector de equipos (solo con
    // pestañas; su visibilidad la afina renderClassification según haya filtro).
    if (hasTabs) html += `<div class="res-tabs__sep" id="resTabsSep" hidden></div>`;
    html += `<div class="res-tabs__filter" id="resTeamFilterSlot"></div></div></div>`;
  }

  // Contenedor de la tabla (se rellena por renderClassification).
  html += `<div class="res-table-wrap" id="resTableWrap"></div>`;

  content.innerHTML = html;

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
  let _teamFilter = '';   // equipo seleccionado ('' = todos); persiste entre clasificaciones
  const sameTimeLbl = _isEn ? 's.t.' : 'm.t.';
  // Muestra/oculta filas según el equipo, y RECALCULA la columna de tiempo sobre
  // las filas VISIBLES: el 1º visible de cada grupo de tiempo muestra su gap real
  // (data-gap), los siguientes con el mismo gap muestran m.t. (filtrar puede dejar
  // a un corredor como primero de su grupo visible → debe verse su tiempo, no m.t.).
  function applyTeamFilter() {
    let prevGap = null;   // gap del último corredor por tiempo VISIBLE
    tableWrap.querySelectorAll('tr.so-row[data-team]').forEach((tr) => {
      const visible = (!_teamFilter || tr.dataset.team === _teamFilter);
      tr.style.display = visible ? '' : 'none';
      // Recomputar la celda de tiempo de las filas por tiempo (las que tienen data-gap).
      const cell = tr.querySelector('.res-gap-dyn');
      if (cell && tr.dataset.gap != null && tr.dataset.gap !== '') {
        if (visible) {
          const g = tr.dataset.gap;
          if (prevGap != null && g === prevGap) {
            cell.textContent = sameTimeLbl; cell.className = 'res-gap res-gap--same res-gap-dyn';
          } else {
            cell.textContent = g; cell.className = 'res-gap res-gap-dyn';
          }
          prevGap = g;
        }
      }
    });
  }
  // ── Render de una CRE (crono por equipos) colapsada a una fila por equipo ──
  // Entrada: filas crudas de la "Stage Classification" donde cada corredor comparte
  // el rank de su equipo y trae su tiempo individual (ver isTttStage). Salida: una
  // fila por equipo (rank · equipo · tiempo), con el tiempo de equipo = el del
  // corredor MÁS RÁPIDO (regla del Dauphiné: el equipo marca con su 1er corredor en
  // meta) y gaps respecto al equipo ganador. Cada fila despliega sus corredores con
  // su tiempo individual al pulsarla.
  //
  // "M:SS.cc" | "H:MM:SS.cc" | "SS.cc" → segundos (float, conserva centésimas).
  function tttToSeconds(txt) {
    if (!txt) return null;
    const parts = String(txt).trim().split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  // Gap entre dos tiempos de equipo. Cada tiempo se TRUNCA a segundos enteros ANTES
  // de restar (no se redondea el gap): la diferencia entre 32:33.99 y 32:34.00 es 1",
  // no 0.01" — porque la clasificación oficial cuenta segundos enteros. El resultado
  // se formatea con la convención de prensa estándar (+SS"/+M'SS"/+H:MM:SS).
  function tttGapBetween(teamSecs, winnerSecs) {
    if (teamSecs == null || winnerSecs == null) return null;
    return secondsToGap(Math.trunc(teamSecs) - Math.trunc(winnerSecs));
  }
  function renderTttStage(rows, stageRow) {
    // Agrupar los corredores por equipo. La UCI publica la CRE en DOS variantes y este
    // agrupamiento cubre ambas, recorriendo las filas EN ORDEN (sortOrder ya preserva
    // el orden del volcado UCI) y abriendo un equipo nuevo cada vez que el `rank` CAMBIA
    // respecto a la fila anterior (rank=null = "sigue el mismo equipo"):
    //   A) Dauphiné: todos los corredores del equipo comparten el rank del equipo
    //      (rank 1,1,1,1 · 2,2,2,2 …). El rank cambia en cada nuevo equipo.
    //   B) Tour de Japón: SOLO el líder de cada equipo trae rank; los compañeros van con
    //      rank=null justo detrás (rank 1,·,·,· · 2,·,·,· …). El null no abre equipo.
    // En ambas, el `lead` (primera fila del grupo, la que trae el rank) define la posición
    // y el TIEMPO del equipo: timeText del lead. (En A el lead es el más rápido; en B es
    // el 3º en meta, pero la UCI le adjudica el rank y su tiempo ES el del equipo.)
    // teamKey de una fila: el equipo resuelto por dorsal (startlist curada) es lo más
    // fiable; agrupa bien incluso a los no-clasificados sueltos (un DNS que la UCI lista
    // al final fuera de su bloque). Si no hay startlist (byDorsal vacío), se cae al
    // "arrastre por rank" (boundary = cambio de rank; rank=null sigue el equipo anterior),
    // que es el único recurso cuando solo el líder trae teamName.
    const order = [];                 // orden de aparición de los equipos
    const byKey = new Map();          // teamKey → { lead, riders }
    let prevRank = undefined, fallbackKey = 0;
    for (const r of rows) {
      const fromSl = startlistRiderForResult(r);
      if (r.rank != null && r.rank !== prevRank) fallbackKey++;   // nuevo equipo (arrastre)
      const key = (fromSl && fromSl.teamName) || `__grp${fallbackKey}`;
      if (!byKey.has(key)) { const g = { lead: null, riders: [] }; byKey.set(key, g); order.push(key); }
      const g = byKey.get(key);
      if (g.lead == null && r.rank != null) g.lead = r;          // 1ª fila con rank = líder
      g.riders.push(r);
      if (r.rank != null) prevRank = r.rank;
    }
    const teamRows = order.map((key) => {
      const g = byKey.get(key);
      const lead = g.lead || g.riders[0];                        // si nadie trae rank (sueltos)
      const fromSl = startlistRiderForResult(lead);
      // Override manual de equipo (panel): el teamId del líder define el equipo
      // de la fila colapsada, ganando a la resolución por dorsal.
      const ovr = overrideTeam(lead?.teamId);
      return {
        rank: g.lead ? g.lead.rank : null,
        teamName: (ovr && ovr.teamName) || (fromSl && fromSl.teamName) || lead?.teamName || lead?.riderDisplay || '',
        teamObj: (ovr && ovr.teamObj) || (fromSl && fromSl.teamObj) || null,
        teamHref: (ovr && ovr.teamHref) || (fromSl && fromSl.teamHref) || null,
        uciPoints: lead?.uciPoints ?? null,
        teamSecs: g.lead ? tttToSeconds(g.lead.timeText) : null,
        teamTimeText: g.lead ? g.lead.timeText : null,
        riders: g.riders,
      };
    });
    const winnerSecs = teamRows.find(tr => tr.rank === 1 && tr.teamSecs != null)?.teamSecs ?? null;
    const showUciPoints = hasUciPoints(teamRows);

    const teamHdr = _isEn ? 'Team' : 'Equipo';
    const timeHdr = _isEn ? 'Time' : 'Tiempo';
    let t = `<table class="so-table res-table res-table--ttt">
      <thead><tr>
        <th class="so-th res-th--rank">#</th>
        <th class="so-th res-th--rider">${teamHdr}</th>
        ${uciPointsHeaderHtml(showUciPoints)}
        <th class="so-th res-th--result">${timeHdr}</th>
      </tr></thead><tbody>`;

    teamRows.forEach((tr, i) => {
      const teamBadge = tr.teamObj ? buildTeamBadgeSvg(tr.teamObj, { size: 16, className: 'res-team-badge' }) : '';
      const nameInner = tr.teamHref
        ? `<a class="so-link" href="${esc(tr.teamHref)}">${esc(tr.teamName)}</a>`
        : esc(tr.teamName || '—');
      // Tiempo: 1er equipo absoluto; resto +gap respecto al ganador.
      let resultCell;
      if (tr.rank == null) resultCell = '';
      else if (tr.rank === 1 && tr.teamTimeText) resultCell = `<span class="res-time">${esc(tr.teamTimeText)}</span>`;
      else if (tr.teamSecs != null && winnerSecs != null) {
        const gap = tttGapBetween(tr.teamSecs, winnerSecs);
        resultCell = gap ? `<span class="res-gap">${esc(gap)}</span>` : `<span class="res-time">${esc(tr.teamTimeText || '')}</span>`;
      } else resultCell = esc(tr.teamTimeText || '');

      const rankCell = tr.rank != null ? tr.rank : '<span class="res-rank-dnf">–</span>';
      // Fila de equipo (pulsable → despliega corredores).
      t += `<tr class="so-row res-team-row" data-ttt-group="${i}" tabindex="0" role="button" aria-expanded="false">
        <td class="so-td res-td--rank">${rankCell}</td>
        <td class="so-td res-td--rider"><span class="res-ttt-team">${teamBadge}<span class="res-ttt-team-name">${nameInner}</span><span class="res-ttt-caret" aria-hidden="true">▾</span></span></td>
        ${uciPointsCellHtml(showUciPoints, tr)}
        <td class="so-td res-td--result">${resultCell}</td>
      </tr>`;
      // Sub-filas de corredores (ocultas por defecto): bandera + nombre + tiempo individual.
      tr.riders.forEach((r) => {
        const fs = startlistRiderForResult(r);
        const fr = !fs && r.globalRiderId ? byRider.get(r.globalRiderId) : null;
        const nm = (fs && fs.name) || (fr && fr.name) || r.riderDisplay || '';
        const cc = fs ? fs.countryCode : (fr ? fr.countryCode : '');
        const flag = cc ? `<span class="so-flag">${countryFlag(cc)}</span>` : '';
        const indiv = r.irm
          ? dnfBadge(r.irm)
          : (r.timeText ? `<span class="res-gap">${esc(r.timeText)}</span>` : '');
        // (El tooltip/enlace de ficha de las sub-filas CRE se retiró; nombre plano.)
        const nmInner = `<span class="res-rider-name">${esc(nm)}</span>`;
        t += `<tr class="so-row res-ttt-rider" data-ttt-member="${i}" hidden>
          <td class="so-td res-td--rank"></td>
          <td class="so-td res-td--rider res-ttt-rider-cell">${flag}<span class="res-rider-main">${nmInner}</span></td>
          ${uciPointsCellHtml(showUciPoints, r)}
          <td class="so-td res-td--result">${indiv}</td>
        </tr>`;
      });
    });
    t += `</tbody></table>`;
    tableWrap.innerHTML = carriedNoticeHtml(stageRow) + t;

    // El slot de filtro por equipo no aplica a CRE (1 fila = 1 equipo).
    const slot = document.getElementById('resTeamFilterSlot');
    if (slot) slot.innerHTML = '';

    // Toggle de despliegue por equipo.
    const toggle = (groupEl) => {
      const idx = groupEl.dataset.tttGroup;
      const open = groupEl.getAttribute('aria-expanded') === 'true';
      groupEl.setAttribute('aria-expanded', String(!open));
      groupEl.classList.toggle('res-team-row--open', !open);
      tableWrap.querySelectorAll(`tr.res-ttt-rider[data-ttt-member="${idx}"]`).forEach((row) => {
        row.hidden = open;
      });
    };
    tableWrap.querySelectorAll('tr.res-team-row').forEach((row) => {
      row.addEventListener('click', () => toggle(row));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row); }
      });
    });
  }

  // Aviso de general ARRASTRADA: en una etapa cancelada las generales que se
  // muestran son las de la etapa anterior (la carrera no se movió). Sin decirlo,
  // una GC idéntica a la de ayer se lee como un volcado viejo o roto.
  function carriedNoticeHtml(stageRow) {
    const from = stageRow?._carriedFromStage;
    if (from == null) return '';
    const fromLbl = `${from}${stageRow._carriedFromSuffix || ''}`;
    const lbl = _isEn
      ? `Standings unchanged: the stage was cancelled. Classification after stage ${fromLbl}.`
      : `La clasificación no varía: la etapa se canceló. General tras la etapa ${fromLbl}.`;
    return `<div class="res-carried-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>${esc(lbl)}</span>
    </div>`;
  }

  async function renderClassification(stageRow) {
    // Etapa CANCELADA: su pestaña "Etapa" no tiene clasificación que mostrar —
    // la carrera no llegó a meta. En vez de una tabla vacía ("no hay datos",
    // que se lee como un volcado que falta), el aviso explica QUÉ pasó.
    if (stageRow._cancelledStage) {
      tableWrap.innerHTML = `<div class="res-cancelled-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        <span>${_isEn ? 'Stage cancelled' : 'Etapa cancelada'}</span>
      </div>`;
      return;
    }
    tableWrap.innerHTML = `<div class="loading">${_isEn ? 'Loading' : 'Cargando'}</div>`;
    const { data: rows } = await supabase
      .from('race_uci_results')
      .select('rank, rankText, bib, riderDisplay, globalRiderId, teamId, resultValue, timeText, gapText, points, uciPoints, irm, sortOrder')
      .eq('stageRef', stageRow.id)
      .order('sortOrder', { ascending: true });

    if (!rows || rows.length === 0) {
      tableWrap.innerHTML = `<div class="startlist-empty">${_isEn ? 'No data for this classification.' : 'No hay datos para esta clasificación.'}</div>`;
      return;
    }

    // Carreras sin startlist (campeonatos nacionales, volcados in-house sin
    // inscritos): enriquecer por globalRiderId → bandera + equipo actual + ficha.
    // No-op si todas las filas casan por dorsal (byRider queda sin usar).
    await enrichRiders(rows.map(r => r.globalRiderId).filter(Boolean));
    // Override MANUAL de equipo (race_uci_results.teamId, fijado en el panel):
    // cuando está poblado, GANA a la resolución por dorsal/globalRiderId. Resolvemos
    // su equipo canónico (nombre + chapa + enlace) en un lote, reusando los ya
    // cargados (teamBySlugId) y completando los que falten. overrideTeam() vive en
    // el scope exterior (lo comparten renderClassification y renderTttStage).
    await enrichOverrideTeams(rows.map(r => r.teamId).filter(Boolean));

    // isTeams = clasificación de EQUIPOS ya colapsada (1 fila por equipo): solo cuando
    // el nombre lo dice (classKind='teams'). NO se usa isTeamEvent: la UCI lo marca true
    // en TODAS las clasificaciones de una etapa CRE (incl. la de etapa, la general, los
    // puntos…), así que no distingue una tabla de equipos de una CRE de corredores.
    const isTeams = stageRow.classKind === 'teams';

    // ── Crono por equipos (CRE/TTT) DISFRAZADA de clasificación individual ──
    // La UCI publica la etapa de CRE como "Stage Classification" (classKind='stage')
    // listando TODOS los corredores agrupados por equipo. Renderizarla como individual
    // da el absurdo "varios corredores en el puesto 1 con tiempos distintos". Hay que
    // COLAPSARLA a una fila por equipo (lo hace renderTttStage). Dos variantes de la UCI:
    //   A) Dauphiné: cada corredor del equipo lleva el rank del equipo (1,1,1 · 2,2,2…),
    //      y la etapa NO viene marcada como de equipos (isTeamEvent=false, raceType=ITT).
    //   B) Tour de Japón: solo el líder del equipo lleva rank, los compañeros rank=null;
    //      la UCI SÍ la marca isTeamEvent=true (pero con eventName cruzado).
    //   C) CRE de UN DÍA (Ses Salines…): la UCI publica el resultado como classKind='gc'
    //      (no hay etapa separada). Mismo patrón que ITT de un día en isIttStage.
    // Señal: classKind='stage' (o 'gc' final de un día) + jornada CRE en NUESTRO catálogo
    // (raceDay.primaryType='ttt'), corroborado por la estructura (ranks compartidos [A] o
    // muchos rank=null entre clasificados [B]). No nos fiamos de los flags de la UCI.
    const isTttStage = (() => {
      const isEligibleKind = stageRow.classKind === 'stage'
        || (stageRow.classKind === 'gc' && stageRow.stageNumber == null && isOneDay);
      if (isTeams || !isEligibleKind) return false;
      // Una jornada CRI (primaryType='itt') NUNCA es una crono por equipos: aunque
      // tenga ex aequo reales (varios corredores con el mismo tiempo al cronómetro →
      // mismo puesto), no se colapsa por equipos. Sin este guard, ≥3 empates en una
      // CRI disparan la rama estructural `sharedRanks >= 3` y la pintan como CRE.
      if (raceDay?.primaryType === 'itt' || stageRow.raceType === 'ITT') return false;
      const classified = rows.filter(r => !r.irm);
      const sharedRanks = (() => {
        const c = new Map();
        for (const r of classified) if (r.rank != null) c.set(r.rank, (c.get(r.rank) || 0) + 1);
        let n = 0; for (const v of c.values()) if (v >= 2) n++; return n;
      })();                                                  // [A] puestos con ≥2 corredores
      const nullRanks = classified.filter(r => r.rank == null).length;  // [B] compañeros sin rank
      const structural = sharedRanks >= 2 || nullRanks >= 2;
      const dayIsTtt = raceDay?.primaryType === 'ttt';
      // El tipo de jornada es nuestro dato curado y fiable → basta con la estructura.
      // Sin él (jornada no mapeada), exigimos una estructura MUY marcada para no colapsar
      // por error una crono individual con un par de empates.
      return structural && (dayIsTtt || sharedRanks >= 3 || nullRanks >= 6);
    })();
    if (isTttStage) { renderTttStage(rows, stageRow); return; }

    // Puntos/Montaña son clasificaciones por PUNTOS, no por tiempo: la última
    // columna se titula "Pts" y el valor va en gris (sin estilo de tiempo ganador).
    // El valor puede venir en `points` o, si es null, como entero en resultValue.
    const isPtsClass = stageRow.classKind === 'points' || stageRow.classKind === 'kom';
    const ptsOf = (r) => r.points != null ? r.points
      : (/^\d+$/.test(String(r.resultValue ?? '')) ? Number(r.resultValue)
        : (/^\d+$/.test(String(r.timeText ?? '')) ? Number(r.timeText) : null));
    const valueHeader = isPtsClass ? 'Pts' : (_isEn ? 'Time' : 'Tiempo');
    const showUciPoints = hasUciPoints(rows);
    // Clasificaciones por tiempo (etapa/general/jóvenes): "mismo tiempo" → m.t./s.t.
    const isTimeClass = !isPtsClass && !isTeams;
    const sameTimeLabel = _isEn ? 's.t.' : 'm.t.';
    // CRI: señal doble — RaceTypeCode 'ITT' de DataRide en la etapa, o
    // primaryType 'itt' de la jornada (cubre las CRI de UN DÍA, que llegan con
    // el bloque final SIN raceType — p. ej. campeonatos CRI — Y las que DataRide
    // etiqueta mal, caso Tour of the Gila: IRR en todas). Aplica a la
    // clasificación de la etapa (o la final de un día). Presentación (espec
    // Dani 2026-06-10): EXACTAMENTE como una etapa en línea — ganador con su
    // tiempo OFICIAL (truncado a segundos enteros, notación de prensa 20'52")
    // y el resto con su diferencia sobre los enteros (+1") y m.t. cuando el
    // tiempo truncado coincide con el de arriba: 20:52.99/20:53.00/20:53.05
    // → 20'52" / +1" / m.t.
    const isIttStage = isTimeClass
      && (stageRow.raceType === 'ITT' || raceDay?.primaryType === 'itt')
      && (stageRow.classKind === 'stage'
          || (stageRow.classKind === 'gc' && stageRow.stageNumber == null && isOneDay));
    let prevGap = null;   // gap del último corredor CLASIFICADO (para detectar grupos)

    // El rank 1 puede traer un `irm`. Hay que distinguir dos cosas opuestas:
    //   · RUIDO (p. ej. irm='LAP' = doblada): la corredora SÍ ganó; la UCI cuelga el
    //     código por error. Caso real: Dwars door de Westhoek 2026 — la ganadora
    //     llegó con LAP y SIN timeText. Debe encabezar como ganadora.
    //   · ABANDONO real (DNF/DNS/OTL/DSQ/ABD): ese rank 1 es espurio (no compitió);
    //     el ganador real es el primer clasificado SIN irm. Caso real: Vuelta a
    //     Colombia Femenina — rank 1 con DNS, el tiempo de cabeza es el del rank 2.
    // → `winnerRow` solo cuenta como ganadora si su irm NO es de abandono.
    const rank1Row = rows.find(r => r.rank === 1) || null;
    const winnerRow = (rank1Row && !isAbandonIrm(rank1Row.irm)) ? rank1Row : null;
    // Clasificado a efectos de TIEMPO: el ganador (ruido aparte) o cualquier fila con
    // puesto sin irm. Un rank 1 con abandono NO cuenta (no aporta su null ni recibe gap).
    const isRankedFinisher = (r) =>
      (winnerRow && r === winnerRow) || (r.rank != null && !r.irm);
    // Si el ganador no trae timeText (el LAP de arriba), el tiempo de cabeza es el
    // MENOR de los clasificados: el grueso del grupo que cruzó con él marca 00:00:00
    // → winnerSec=0 y los gaps se derivan bien. En Colombia, ese mínimo es el rank 2.
    const minFinisherSec = isTimeClass
      ? rows.filter(isRankedFinisher)
            .map(r => timeToSeconds(r.timeText))
            .filter(s => s != null)
            .reduce((min, s) => (min == null || s < min ? s : min), null)
      : null;

    // La UCI publica los tiempos de forma inconsistente. Hay dos casos a normalizar
    // (solo en clasificaciones por tiempo, y solo cuando NO viene gapText explícito):
    //   A) TIEMPOS ABSOLUTOS: cada fila trae su tiempo total → gap = tiempo − ganador.
    //   B) GAPS DISFRAZADOS: el rank 1 trae su tiempo total, pero el resto trae el gap
    //      SIN el '+' y en formato HH:MM:SS ("00:00:01" = +1s). El fetcher lo confundió
    //      con timeText. Señal segura: en una etapa por tiempo, un rank>1 nunca puede
    //      tener un tiempo MENOR que el ganador → si su valor < ganador, ES un gap.
    const winnerSec = isTimeClass
      ? (timeToSeconds(winnerRow?.timeText) ?? minFinisherSec)
      : null;
    const allTimed = isTimeClass && winnerSec != null && !rows.some(r => r.gapText)
      && rows.filter(r => r.rank != null && r !== winnerRow && !r.irm)
             .every(r => timeToSeconds(r.timeText) != null);
    // Caso B si alguna fila rank>1 tiene timeText estrictamente menor que el ganador.
    const gapsDisguised = allTimed
      && rows.some(r => r.rank != null && r !== winnerRow && !r.irm && timeToSeconds(r.timeText) < winnerSec);
    const deriveGaps = allTimed && !gapsDisguised;   // Caso A: restar al ganador

    // Equipos presentes (para el filtro). Solo en clasificaciones individuales.
    const teamsInClass = new Set();
    if (!isTeams) {
      rows.forEach((r) => {
        const ovr = overrideTeam(r.teamId);
        const fs = startlistRiderForResult(r);
        const fr = !fs && r.globalRiderId ? byRider.get(r.globalRiderId) : null;
        const tn = (ovr && ovr.teamName) || (fs && fs.teamName) || (fr && fr.teamName) || '';
        if (tn) teamsInClass.add(tn);
      });
    }

    let t = `<table class="so-table res-table">
      <thead><tr>
        <th class="so-th res-th--rank">#</th>
        <th class="so-th res-th--rider">${isTeams ? (_isEn ? 'Team' : 'Equipo') : (_isEn ? 'Rider' : 'Corredor')}</th>
        ${isTeams ? '' : `<th class="so-th res-th--team">${_isEn ? 'Team' : 'Equipo'}</th>`}
        ${uciPointsHeaderHtml(showUciPoints)}
        <th class="so-th res-th--result">${esc(valueHeader)}</th>
      </tr></thead><tbody>`;

    // Último índice del BLOQUE DE CABEZA: las filas que llegaron con el ganador,
    // contiguas desde el rank 1. Una fila con gap 0 FUERA de ese bloque no cruzó con
    // el grupo: es una REASIGNACIÓN DE COMISARIOS (incidente en los últimos 3 km → se
    // le acredita el tiempo del grupo con el que rodaba, pero conserva su puesto por
    // orden de llegada; UCI 2.6.027). Caso real: Baloise Ladies Tour 2026 et.5, Manly
    // 97ª con el tiempo de la ganadora.
    // Esas filas NUNCA se colapsan a "m.t." (ni aquí ni en applyTeamFilter, que las
    // deja fuera al no llevar data-gap): el m.t. es una abreviatura que sólo significa
    // algo dentro de un grupo contiguo en meta, y aquí mentiría sobre cómo terminó.
    // Se pinta su gap explícito (+0" incluido).
    const isZeroGapRow = (r) => {
      const raw = String(r.gapText || '').trim();
      if (raw) return timeToSeconds(raw.replace(/^\+/, '')) === 0;
      if (!deriveGaps || winnerSec == null) return false;
      const sec = timeToSeconds(r.timeText);
      return sec != null && Math.floor(sec) === Math.floor(winnerSec);
    };
    let headBlockEnd = -1;
    if (isTimeClass) {
      // Ancla = el primer CLASIFICADO real. Normalmente es winnerRow; si el rank 1 es
      // un abandono espurio (DNS), el cabeza es el primer clasificado sin irm, que
      // marca el tiempo de referencia (mismo criterio que minFinisherSec).
      const w = rows.findIndex(isRankedFinisher);
      if (w >= 0) {
        headBlockEnd = w;
        for (let i = w + 1; i < rows.length; i++) {
          // Los abandonos van al final y no rompen el bloque si aún no empezaron.
          if (rows[i].rank == null || rows[i].irm) break;
          if (!isZeroGapRow(rows[i])) break;
          headBlockEnd = i;
        }
      }
    }

    rows.forEach((r, rowIndex) => {
      const fromSl = startlistRiderForResult(r);
      const teamSnapshot = isTeams ? startlistTeamForResult(r) : null;
      // Sin casar por dorsal (carrera sin startlist): caer al enriquecido por
      // globalRiderId (bandera + equipo actual + ficha de riders_*). null si la
      // fila no tiene ficha (corredor amateur fuera del catálogo).
      const fromRider = !fromSl && r.globalRiderId ? byRider.get(r.globalRiderId) : null;
      // Nombre: startlist (curado) → ficha por globalRiderId (orden natural) →
      // riderDisplay (fallback de la fuente). La ficha gana al riderDisplay para
      // que las CN sin startlist no muestren el "APELLIDO Nombre" crudo de la UCI.
      const riderName = isTeams
        ? (teamSnapshot?.teamName || r.riderDisplay || '')
        : ((fromSl && fromSl.name) || (fromRider && fromRider.name) || r.riderDisplay || '');
      // Override manual de equipo (panel): gana a dorsal/globalRiderId.
      const ovrTeam = isTeams ? null : overrideTeam(r.teamId);
      const teamName = (ovrTeam && ovrTeam.teamName) || (fromSl && fromSl.teamName) || (fromRider && fromRider.teamName) || '';
      const cc = (fromSl ? fromSl.countryCode : (fromRider ? fromRider.countryCode : '')) || '';
      const flagHtml = cc ? `<span class="so-flag">${countryFlag(cc)}</span>` : '';
      // Equipos: la fila ES un equipo (riderDisplay = nombre crudo de la fuente,
      // sin dorsal) → se casa por NOMBRE contra los equipos canónicos de la
      // startlist (mismo patrón que orden-salida) para chapa + nombre bonito +
      // enlace. Individual: override manual → equipo de la startlist → href por nombre.
      const rowTeamObj = isTeams
        ? ((overrideTeam(r.teamId) || {}).teamObj || (teamSnapshot?.teamId ? teamBySlugId.get(teamSnapshot.teamId) : null) || findMatchingTeam(r.riderDisplay || '', raceTeams))
        : (ovrTeam ? ovrTeam.teamObj : null);
      const teamHref = isTeams
        ? teamLinkUrl(rowTeamObj)
        : ((ovrTeam && ovrTeam.teamHref) || (fromSl && fromSl.teamHref) || (fromRider && fromRider.teamHref) || teamHrefByName(teamName));

      // Valor de la fila: puntos o tiempo/gap. Los marcadores especiales
      // (DNF/DNS/OTL/DSQ) NO se rotulan: la fila se mantiene pero el valor
      // queda vacío (decisión de producto — no ensuciar la clasificación).
      // Gap efectivo: el de la UCI, o el normalizado. El ganador nunca lleva gap.
      //   · Caso A (deriveGaps): timeText es absoluto → gap = timeText − ganador.
      //   · Caso B (gapsDisguised): timeText YA es el gap (en HH:MM:SS sin '+')
      //     → reformatear a "+M:SS" (normaliza "00:00:01" → "+0:01").
      let effGap = r.gapText;
      // Gap publicado CON décimas ("+36.98", Tour of the Gila): el gap oficial
      // en segundos enteros se deriva de los TIEMPOS truncados — floor(ganador
      // + gap) − floor(ganador) —, NO truncando el gap (20:52.99 y 20:53.00 son
      // +1", no +0"). Con gaps enteros el resultado es idéntico → no se toca.
      if (effGap && winnerSec != null && r.rank != null && r !== winnerRow && !r.irm) {
        const gs = timeToSeconds(String(effGap).trim().replace(/^\+/, ''));
        if (gs != null && gs % 1 !== 0) {
          effGap = secondsToGap(Math.floor(winnerSec + gs) - Math.floor(winnerSec));
        }
      }
      if (!effGap && r.rank != null && r !== winnerRow && !r.irm) {
        const sec = timeToSeconds(r.timeText);
        if (sec != null) {
          // El gap oficial se calcula sobre tiempos TRUNCADOS a segundos enteros,
          // truncando CADA tiempo antes de restar (cronos con décimas: 20:52.99 y
          // 20:53.00 → 20:52 y 20:53 → +1", no +0.01 ni +0").
          if (deriveGaps && winnerSec != null) effGap = secondsToGap(Math.floor(sec) - Math.floor(winnerSec));
          else if (gapsDisguised) effGap = secondsToGap(sec);
        }
      }
      // El gapText de la UCI viene crudo ("+41", "+1:56", "+3:13"): normalizar
      // a la convención de prensa (+41", +1'56", +3'13"). Los casos A/B ya vienen
      // formateados → formatGap los devuelve intactos.
      effGap = formatGap(effGap);

      // rowGap: el gap real de esta fila (para data-gap; m.t. lo decide
      // applyTeamFilter sobre las filas VISIBLES, no aquí, para que el filtro por
      // equipo recalcule bien quién es el primero de cada grupo).
      let rowGap = '';
      let resultCell;
      // El ganador real (winnerRow) se renderiza SIEMPRE como tal, ignorando un `irm`
      // de ruido (LAP). Un rank 1 con abandono real NO es winnerRow → cae aquí (celda
      // vacía) y su código se rotula en la columna # como cualquier otro abandono.
      if (r.irm && r !== winnerRow) {
        resultCell = '';
      } else if (isPtsClass) {
        // Puntos: número en gris normal, nunca el estilo azul de tiempo ganador.
        const pts = ptsOf(r);
        resultCell = `<span class="res-pts">${pts != null ? pts : esc(r.resultValue || '')}</span>`;
      } else if (r === winnerRow) {
        // Tiempo de la ganadora: el suyo si lo trae; si la UCI lo omitió (caso LAP),
        // el tiempo de cabeza derivado SOLO si es significativo (>0). En una carrera
        // de un día sin tiempo absoluto el cabeza es 00:00:00 → no inventamos un "0"
        // ni rotulamos nada: celda vacía. Los gaps del resto sí salen bien (winnerSec=0).
        // cleanTimeText: la UCI publica "00:30:36"/"0:06:36" → "30:36"/"6:36".
        // CRI: el tiempo del ganador va en notación de prensa y TRUNCADO a
        // segundos enteros ("20:52.99" → 20'52"); el resto de la fila fluye por
        // el MISMO pipeline de gaps/m.t. que una etapa en línea (espec Dani).
        const winIttSec = isIttStage ? Math.floor(timeToSeconds(r.timeText) ?? winnerSec ?? -1) : -1;
        const wt = (isIttStage && winIttSec >= 0)
          ? secondsToPressTime(winIttSec)
          : (cleanTimeText(r.timeText) || (winnerSec ? secondsToAbsText(winnerSec) : ''));
        resultCell = wt ? `<span class="res-time">${esc(wt)}</span>` : '';
      } else if (effGap && /^\+0"$/.test(effGap) && rowIndex <= headBlockEnd) {
        // Gap de 0 s (mismo tiempo que el ganador, p. ej. UCI publica "00:00:00"
        // para el 2º): la prensa lo cita como m.t., no como "+0"". Sin data-gap →
        // applyTeamFilter no lo toca; queda fijo como m.t.
        resultCell = `<span class="res-gap res-gap--same">${esc(sameTimeLabel)}</span>`;
      } else if (effGap && rowIndex > headBlockEnd && /^\+0"$/.test(effGap)) {
        // Reasignación de comisarios (gap 0 fuera del bloque de cabeza): gap FIJO,
        // sin data-gap → applyTeamFilter no lo toca y nunca se colapsa a m.t.
        resultCell = `<span class="res-gap">${esc(effGap)}</span>`;
      } else if (effGap) {
        // Gap real en un span dinámico; applyTeamFilter lo convertirá a m.t. si
        // procede sobre las filas visibles. (Se llama siempre tras el render.)
        rowGap = effGap;
        resultCell = `<span class="res-gap res-gap-dyn">${esc(effGap)}</span>`;
      } else {
        resultCell = esc(r.timeText || r.resultValue || '');
      }

      // Columna #: un abandono real (DNF/DNS/OTL/DSQ/ABD) se rotula con su etiqueta
      // corta AUNQUE la UCI le haya dejado un rank (rank 1 con DNS en la Vuelta a
      // Colombia → "NS", no "1": no salió, no es un puesto). Un rank con irm de ruido
      // (LAP en el ganador) conserva su número. Sin rank ni irm → guion.
      let rankCell;
      if (isAbandonIrm(r.irm)) {
        rankCell = dnfBadge(r.irm);
      } else if (r.rank != null) {
        rankCell = r.rank;
      } else if (r.irm) {
        rankCell = dnfBadge(r.irm);
      } else {
        rankCell = `<span class="res-rank-dnf">${esc(r.rankText || '–')}</span>`;
      }

      if (isTeams) {
        // Casado → nombre canónico del catálogo + chapa (como la columna Equipo
        // de las clasificaciones individuales); sin casar → el crudo de la fuente.
        const displayName = (rowTeamObj && rowTeamObj.name) || riderName;
        const teamBadge = rowTeamObj ? buildTeamBadgeSvg(rowTeamObj, { size: 16, className: 'res-team-badge' }) : '';
        const nameInner = teamHref
          ? `<a class="so-link" href="${esc(teamHref)}">${esc(displayName)}</a>`
          : esc(displayName);
        const teamCell = `<span class="res-team-cell">${teamBadge}${nameInner}</span>`;
        t += `<tr class="so-row">
          <td class="so-td res-td--rank">${rankCell}</td>
          <td class="so-td res-td--rider">${teamCell}</td>
          ${uciPointsCellHtml(showUciPoints, r)}
          <td class="so-td res-td--result">${resultCell}</td>
        </tr>`;
      } else {
        // El corredor enlaza a SU FICHA (/corredor/<id>/) si es de las dos
        // primeras divisiones (riderHref, gateado por riderLinkUrl); si no,
        // texto plano. El equipo enlaza en su propia columna.
        const riderHref = (fromSl && fromSl.riderHref) || (fromRider && fromRider.riderHref) || null;
        const nameLink = (riderHref && riderName)
          ? `<a class="so-link res-rider-name" href="${esc(riderHref)}">${esc(riderName)}</a>`
          : (riderName
            ? `<span class="res-rider-name">${esc(riderName)}</span>`
            : '<span class="res-rider-name" style="opacity:0.45">—</span>');
        // Subtítulo de equipo (solo visible en móvil, donde la columna Equipo se oculta).
        const teamSub = teamName
          ? `<span class="res-rider-team">${esc(teamName)}</span>`
          : '';
        // Objeto equipo (override manual → por dorsal → equipo actual del
        // enriquecido por globalRiderId; null si nada casó → sin chapa).
        const teamObj = (ovrTeam && ovrTeam.teamObj) || (fromSl && fromSl.teamObj) || (fromRider && fromRider.teamObj) || null;
        // Chapa del equipo JUNTO a la bandera del corredor, dentro de la celda
        // Corredor (idea traída de las apps: bandera país + chapa equipo + nombre).
        // Se mantiene además la columna Equipo en desktop (chapa + nombre).
        const riderTeamBadge = teamObj ? buildTeamBadgeSvg(teamObj, { size: 15, className: 'res-rider-badge' }) : '';
        const riderCell = `${flagHtml}${riderTeamBadge}<span class="res-rider-main">${nameLink}${teamSub}</span>`;
        const teamBadge = teamObj ? buildTeamBadgeSvg(teamObj, { size: 16, className: 'res-team-badge' }) : '';
        const teamInner = teamName
          ? (teamHref ? `<a class="so-link res-team-link" href="${esc(teamHref)}">${esc(teamName)}</a>` : esc(teamName))
          : '';
        const teamCell = teamName ? `<span class="res-team-cell">${teamBadge}${teamInner}</span>` : '';
        // (El tooltip de corredor con ficha/edad/equipo se retiró junto con las
        // fichas públicas; la fila ya no necesita data-rider-*.)
        t += `<tr class="so-row" data-team="${esc(teamName)}" data-gap="${esc(rowGap)}">
          <td class="so-td res-td--rank">${rankCell}</td>
          <td class="so-td res-td--rider">${riderCell}</td>
          <td class="so-td res-td--team">${teamCell}</td>
          ${uciPointsCellHtml(showUciPoints, r)}
          <td class="so-td res-td--result">${resultCell}</td>
        </tr>`;
      }
    });

    t += `</tbody></table>`;

    tableWrap.innerHTML = carriedNoticeHtml(stageRow) + t;

    // Filtro por equipo (solo individuales con ≥2 equipos), en el slot de la
    // barra de pestañas (misma línea que el filtro de clasificación). La
    // selección persiste entre clasificaciones.
    const slot = document.getElementById('resTeamFilterSlot');
    if (slot) {
      if (!isTeams && teamsInClass.size >= 2) {
        const sorted = [...teamsInClass].sort((a, b) => a.localeCompare(b, _isEn ? 'en' : 'es'));
        if (_teamFilter && !teamsInClass.has(_teamFilter)) _teamFilter = '';   // el equipo no está aquí
        const allTeamsLbl = _isEn ? 'All teams' : 'Todos los equipos';
        const allLbl = window.matchMedia('(max-width: 640px)').matches
          ? (_isEn ? 'All' : 'Todos')
          : allTeamsLbl;
        const opts = [`<option value="">${esc(allLbl)}</option>`]
          .concat(sorted.map((tn) => `<option value="${esc(tn)}"${tn === _teamFilter ? ' selected' : ''}>${esc(tn)}</option>`))
          .join('');
        slot.innerHTML = `<select class="res-teamfilter__select" id="resTeamFilter" aria-label="${esc(allTeamsLbl)}" title="${esc(allTeamsLbl)}">${opts}</select>`;
        const sel = slot.querySelector('#resTeamFilter');
        sel.addEventListener('change', () => { _teamFilter = sel.value; applyTeamFilter(); });
      } else {
        slot.innerHTML = '';
      }
    }
    // Separador pestañas↔filtro: solo cuando hay filtro de equipo a la derecha.
    const sep = document.getElementById('resTabsSep');
    if (sep) sep.hidden = !(slot && slot.innerHTML);
    applyTeamFilter();
  }

  // Pestañas → cambiar clasificación (sin recargar).
  content.querySelectorAll('#resTabs .res-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const st = activeStages.find(s => s.id === btn.dataset.stageref);
      if (!st) return;
      content.querySelectorAll('#resTabs .res-tab').forEach(b => b.classList.remove('res-tab--active'));
      btn.classList.add('res-tab--active');
      history.replaceState(null, '', location.pathname + '#' + st.classKind);
      renderClassification(st);
    });
  });

  // Render inicial.
  renderClassification(activeClass);

  // Chevron de "más clasificaciones": visible solo cuando las pestañas
  // desbordan a la derecha; al pulsarlo desplaza hasta el final (paridad apps).
  const tabsInner = document.getElementById('resTabsInner');
  const tabsMore = document.getElementById('resTabsMore');
  if (tabsInner && tabsMore) {
    const syncMore = () => {
      const overflow = tabsInner.scrollWidth - tabsInner.clientWidth;
      tabsMore.hidden = overflow <= 1 || tabsInner.scrollLeft >= overflow - 1;
    };
    tabsInner.addEventListener('scroll', syncMore, { passive: true });
    window.addEventListener('resize', syncMore);
    tabsMore.addEventListener('click', () => {
      tabsInner.scrollTo({ left: tabsInner.scrollWidth, behavior: 'smooth' });
    });
    syncMore();
  }

  // ── Botón de edición admin (solo con sesión) → editor de la jornada ─
  if (raceDayId) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user || document.getElementById('editResultsBtn')) return;
      const btn = document.createElement('a');
      btn.id        = 'editResultsBtn';
      btn.className = 'edit-jornada-btn';
      btn.href      = '/panel/app.html?edit=' + encodeURIComponent(raceDayId);
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> ' + (_isEn ? 'Edit' : 'Editar');
      const hero = content.querySelector('.race-header');
      (hero || document.body).appendChild(btn);
    });
  }
}

// Esperar a cargar las traducciones (en.json) antes de renderizar: el panel de
// botones usa t('assets.*'), que sin esto cae al diccionario ES embebido.
initI18n().then(init);
