// ─────────────────────────────────────────────────────────────────
//  RESULTADOS — página de carrera o etapa en HTML, sin DOM
//  Lo usan js/resultados.js (pintado en el navegador) y el paso de build que
//  escribe las páginas de resultados (tools/site/prerender-resultados.mjs). El
//  marcado no puede depender del dispositivo, del ancho de pantalla, de
//  localStorage ni del momento de carga: el navegador compara su huella con
//  la del HTML del build (js/html-fingerprint.js).
//
//  La página se compone de un esqueleto (cabecera, botones, selector de
//  etapas, pestañas y columna lateral) con huecos que se rellenan después:
//  estado de publicación (barra y título de la clasificación), filtro por
//  equipo, tabla y datos de la jornada (su hora de salida va en la zona del
//  visitante). Cada hueco lleva su propia huella en el HTML del build
//  (js/results/dom.js).
// ─────────────────────────────────────────────────────────────────

import { timeToSeconds, secondsToGap, formatGap, cleanTimeText, secondsToAbsText } from './results/time.js';
import { stageContextHtml } from './stage/context.js';
import { stageProfileHtml } from './stage/profile.js';
import { TEAM_COLUMNS, teamStripes, teamsForSeason, splitStartlistTeams } from './team-appearance.js';
import { localizedTeamName } from './services/national-team-name.js';
import { visibleStageClassifications, classificationInventory, classificationLabel, classificationColor, classificationIsUpdating, isTttStageClassification } from './services/race-presentation.js';
import { arrowHtml } from './scroll-rail.js';
import { flagIconUrl } from './flag-url.js';
import { esc, buildRaceHero, buildActionButtons, findMatchingTeam, normalizeTeamName, teamLinkUrl, riderLinkUrl, isNoTeamPlaceholderTeam } from './shared.js';
import { IRM_LABELS, isAbandonIrm, isNonWinnerIrm, irmDescription } from './results/uci-irm.js';
import { sectorSuffixMap, resultStageEntryKey, parseResultStageKey } from './services/races.js';


export function stagePathLabel(stageNumber, isEn, suffix = '') {
  if (stageNumber === 0) return isEn ? 'Prologue' : 'Prólogo';
  if (stageNumber != null) return isEn ? `Stage ${stageNumber}${suffix}` : `Etapa ${stageNumber}${suffix}`;
  return isEn ? 'Final classification' : 'Clasificación final';
}

// Segmento de path de una etapa: etapa-N / prologo / (vacío = carrera/general).
export function stageSlugSegment(stageNumber, isEn, suffix = '') {
  if (stageNumber === 0) return isEn ? 'prologue' : 'prologo';
  const sfx = (suffix || '').toLowerCase();
  if (stageNumber != null) return isEn ? `stage-${stageNumber}${sfx}` : `etapa-${stageNumber}${sfx}`;
  return '';
}

export const statusIcon = kind => `<svg class="res-status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${kind==='pending'?'<path d="M14 2H6a2 2 0 0 0-2 2v16h8M14 2v6h6M14 2l6 6v3"/><circle cx="17" cy="17" r="5"/><path d="M17 14v3l2 1"/>':kind==='offline'?'<path d="m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M12 20h.01M3 9a15 15 0 0 1 3-2m4-1a15 15 0 0 1 11 3M6 12a10 10 0 0 1 3-2m5 0a10 10 0 0 1 4 2"/>':'<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>'}</svg>`;

// ── Etapas y clasificación activa ───────────────────────────────────
/**
 * Claves de entrada de la carrera (etapas, sectores, final) a partir de sus
 * clasificaciones y jornadas, y la clave activa: la pedida (`requestedKey`)
 * o, sin ella, la última con datos. `missing`: la clave activa no tiene
 * clasificaciones (página adelantada).
 */
export function resultsStages({ stagesAll, allRaceDays, requestedKey, requestedStage, stageSuffixParam = '' }) {
  // Se cargan ANTES de armar las pestañas porque una etapa CANCELADA no tiene
  // clasificaciones propias y su pantalla se construye a partir de la jornada
  // (aviso de cancelada) + las generales de la etapa anterior. El orden
  // canónico es cronológico (dateKey, luego hora de salida) — el mismo que usan
  // Hoy/Mes y las apps para los dobles sectores: la "etapa anterior" de un
  // sector B es su sector A, y la del día siguiente a un doble sector es el B.
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
  const lastRacedDay = racedWithStage.filter(d=>!d.isCancelledDay).at(-1);
  {
    const finalStages = stagesByNum.get('final');
    const lastNum = lastRacedDay ? keyForDay(lastRacedDay) : null;
    if (finalStages?.length && lastNum && stagesByNum.has(lastNum)) {
      const finalKinds = new Set(finalStages.map(s => s.classKind));
      const kept = stagesByNum.get(lastNum).filter(s => !finalKinds.has(s.classKind));
      stagesByNum.set(lastNum, kept.concat(finalStages));
    }
  }

  // Etapa activa: la pedida si existe; si no, la última con datos. Un número
  // pelado que resulta ser doble sector (`/etapa-3/` sin letra) cae a su sector A.
  let activeKey = requestedKey === undefined ? stageKeys[stageKeys.length - 1] : requestedKey;
  if (requestedKey !== undefined && !stagesByNum.has(activeKey) && (stageSuffixParam || '') === ''
      && requestedStage != null && sectoredNums.has(requestedStage)) {
    const firstSector = stageKeys.find(k => parseResultStageKey(k).stageNumber === requestedStage);
    if (firstSector) activeKey = firstSector;
  }
  return {
    racedWithStage, keyForDay, keyForStage, dayByKey, stagesByNum, stageKeys, keyRank, lastRacedDay,
    activeKey, missing: !stagesByNum.has(activeKey),
  };
}

/**
 * Clasificaciones de la clave activa en el orden de las pestañas, la activa
 * (`hashClass` o la primera) y las jornadas de la cabecera (raceDayId) y de
 * la columna lateral (contextDayId).
 */
export function resultsActive(stages, { stagesAll, classificationConfig, allRaceDays, hashClass = '' }) {
  const { stagesByNum, activeKey, dayByKey, lastRacedDay } = stages;
  const activeStages = [...stagesByNum.get(activeKey)];
  const { stageNumber: activeStageNumber, suffix: activeSuffix } = parseResultStageKey(activeKey);
  const inventory = classificationInventory(classificationConfig || [], stagesAll);
  const configByKind = new Map(inventory.map(row => [row.classKind,row]));
  activeStages.splice(0,activeStages.length,...visibleStageClassifications(activeStages,inventory));
  const activeClass = activeStages.find(s => s.classKind === hashClass) || activeStages[0];
  // raceDayId de la etapa activa: el que arrastra la clasificación, o —si el
  // volcado no lo trajo (race_uci_stages.raceDayId NULL)— el de la jornada que
  // corresponde a esta entrada (`dayByKey`, casada por stageNumber). Sin este
  // segundo, la cabecera cae al país de la CARRERA e ignora el override por
  // jornada (p. ej. Giro della Valle d'Aosta et1, en Francia, countryCode='FR').
  // Pruebas de un día (o GC final sin raceDayId): la "Final Classification" no
  // mapea a race_days → raceDayId NULL. Si la carrera tiene una sola jornada,
  // se usa esa para que la cabecera muestre ruta + distancia igual.
  const raceDayId = activeStages.find(s => s.raceDayId)?.raceDayId
    || dayByKey.get(activeKey)?.id
    || ((allRaceDays || []).length === 1 ? allRaceDays[0].id : null);
  // Columna derecha (perfil + datos): la clasificación final de una vuelta no
  // tiene jornada propia y muestra la de la última etapa disputada. Cabecera,
  // botones, SEO y detección CRI/CRE siguen usando solo raceDayId.
  const contextDayId = raceDayId || (activeKey === 'final' ? lastRacedDay?.id : null) || null;
  return { activeStages, activeStageNumber, activeSuffix, inventory, configByKind, activeClass, raceDayId, contextDayId };
}

// ── Esqueleto de la página ──────────────────────────────────────────
export function stageNavigationHtml(keys, activeKey, { canonBase, canonSlug, isEn }) {
  return keys.map(k=> {
    const {stageNumber:num,suffix:sfx}=parseResultStageKey(k);
    const segment=stageSlugSegment(num,isEn,sfx);
    const href=`${canonBase}${encodeURIComponent(canonSlug)}/${segment ? segment+'/' : ''}`;
    const active=k===activeKey;
    const label=num!=null ? (isEn?`Stage ${num}${sfx}`:`Etapa ${num}${sfx}`) : (isEn?'Final classification':'Clasificación final');
    return `<a class="res-stage-btn${active?' res-stage-btn--active':''}" href="${href}" title="${esc(label)}"${active?' aria-current="page" data-active="true"':''}>${num===0?'P':num!=null?esc(`${num}${sfx}`):'F'}</a>`;
  }).join('');
}

/**
 * HTML de #resultsContent con los huecos vacíos: #resStatusSlot,
 * #resTeamFilterSlot, #resPublication, #resTableWrap y la lista de datos de
 * la jornada (stageMetricsHtml). `active`:
 * resultsActive(); `raceDay`, la jornada de la cabecera (o null) y
 * `contextDay`, la de la columna lateral; `contextAssets` y `actionAssets`,
 * sus documentos con la guía técnica (withRaceTechnicalGuide).
 */
export function resultsPageHtml({ race, stages, active, raceDay, contextDay, contextAssets, actionAssets, canonBase, canonSlug, isEn }) {
  const { activeStages, activeStageNumber, activeSuffix, configByKind, activeClass, raceDayId } = active;
  const isOneDay = race.raceFormat === 'one_day';
  const stageLabel = stagePathLabel(activeStageNumber, isEn, activeSuffix);
  let html = '';
  // País efectivo: la jornada puede transcurrir en un país distinto al de la
  // carrera (p. ej. una etapa del Tour que sale de Italia) → prevalece el de la
  // jornada. Mismo criterio de ocultar bandera que buildRaceHero. En pruebas de
  // un día la etiqueta "Clasificación final" es redundante (no hay etapas que
  // distinguir) → se omite del subtítulo.
  html += buildRaceHero(raceDay || {}, race, { stage: isOneDay ? '' : stageLabel });

  // Solo navegación: web oficial + "Ir a la etapa/carrera" (sin inscritos ni
  // botones de recorrido — en Resultados esos botones se consideran superfluos).
  html += buildActionButtons({
    race,
    rd: raceDay || { id: raceDayId, slug: raceDay?.slug, slugEn: raceDay?.slugEn },
    view: 'resultados',
    assets:actionAssets, hasStartlist:!!race.startlistImportedAt,
    style: 'margin:0 auto 0.85rem', standalone: true,
  });

  html+=`<div class="res-stages cc-rail-shell" id="resStages" ${stages.stageKeys.length<2?'hidden':''}>${arrowHtml('prev',isEn?'Previous stages':'Etapas anteriores','hidden')}<div class="res-stages__inner" id="resStagesInner" data-scroll-rail>${stageNavigationHtml(stages.stageKeys, stages.activeKey, { canonBase, canonSlug, isEn })}</div>${arrowHtml('next',isEn?'Next stages':'Etapas siguientes','hidden')}</div>`;

  // ── Barra de CLASIFICACIÓN: pestañas (izq) + filtro por equipo (der) ──
  // Las pestañas solo si hay >1 clasificación (un día → 1 sola, sin pestañas).
  // El filtro por equipo (hueco a la derecha) lo rellena la clasificación;
  // la barra se emite si hay pestañas O si la clasif activa es individual.
  html += `<div class="res-layout${contextDay ? ' res-layout--context' : ''}"><div class="res-main">`;
  const hasTabs = activeStages.length > 1;
  const activeIsIndividual = !(activeClass.classKind === 'teams' || activeClass.isTeamEvent);
  if (hasTabs || activeIsIndividual) {
    // Carril exterior a sangre: lleva el sticky y el fondo opaco (las filas
    // scrollean por debajo). .res-tabs queda dentro, centrado a 860px.
    html += `<div class="res-tabs-bar"><div class="res-tabs" id="resTabs"><div class="res-tabs__scroll">${arrowHtml('prev',isEn ? 'Previous classifications' : 'Clasificaciones anteriores','hidden')}<div class="res-tabs__inner" id="resTabsInner" data-scroll-rail>`;
    if (hasTabs) {
      for (const st of activeStages) {
        const lbl = classificationLabel(configByKind.get(st.classKind),isEn?'en':'es');
        const color = classificationColor(configByKind.get(st.classKind));
        const isActive = st.id === activeClass.id;
        html += `<button class="res-tab${isActive ? ' res-tab--active' : ''}" style="${color ? `--class-color:${color}` : ''}" aria-pressed="${isActive}" data-class="${esc(st.classKind)}" data-stageref="${esc(st.id)}">${esc(lbl)}</button>`;
      }
    }
    html += `</div>`;   // .res-tabs__inner
    if (hasTabs) {
      // Chevron de "más clasificaciones": indica que las pestañas siguen tras el
      // borde derecho (paridad con las apps; sin degradado: mismo color → señal
      // invisible, descartado en las apps). Se oculta al llegar al final.
      const moreLbl = isEn ? 'More classifications' : 'Más clasificaciones';
      html += arrowHtml('next',moreLbl,'hidden');
    }
    html += `</div>`;   // .res-tabs__scroll
    // Estado de publicación junto al filtro cuando no hay pestañas (carreras de
    // un día); con pestañas va junto al título de la clasificación.
    html += `<div class="res-tabs__status" id="resStatusSlot"></div><div class="res-tabs__filter" id="resTeamFilterSlot"></div></div></div>`;
  }

  // Contenedor de la tabla (se rellena con la clasificación).
  html += `<div class="res-publication" id="resPublication" aria-live="polite"></div><div class="res-table-wrap" id="resTableWrap"></div></div>`;
  if (contextDay) {
    // Panel del perfil con el gráfico vacío: mountStageProfile lo dibuja sobre
    // el mismo marcado.
    html += stageContextHtml(contextDay, 'resProfile', { profile: stageProfileHtml(contextDay, race, contextAssets), metrics: false });
  }
  html += '</div>';
  return html;
}

// ── Estado de publicación ───────────────────────────────────────────
/**
 * Contenido de #resStatusSlot (`status`, carreras sin pestañas) y de
 * #resPublication (`publication`). `inBar`: sin pestañas de clasificación.
 * `timeZone`: zona de «Última actualización» (la del visitante si se omite;
 * el build usa la de su idioma).
 */
export function publicationHtml(stageRow, { configByKind, isOneDay, inBar, error = false, isEn, timeZone, now = Date.now() }) {
  if (!stageRow || stageRow._cancelledStage) return { status: '', publication: '' };
  const provisional = stageRow.publicationStatus === 'provisional';
  const stamp = provisional ? stageRow.lastSyncedAt : null;
  const date = stamp ? new Date(stamp) : null;
  const time = date && Number.isFinite(date.getTime()) ? date.toLocaleString(isEn ? 'en-GB' : 'es-ES', { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit', ...(timeZone ? { timeZone } : {}) }) : '';
  const classHeading = isOneDay ? ''
    : `<strong class="res-class-heading">${esc(classificationLabel(configByKind.get(stageRow.classKind),isEn?'en':'es'))}</strong>`;
  // Clasificación en actualización: solo el indicador giratorio, sin letrero.
  const updatingText = isEn ? 'Classification updating' : 'Clasificación actualizándose';
  const spinner = classificationIsUpdating(stageRow, now)
    ? `<span class="res-refreshing" role="status" aria-label="${updatingText}" title="${updatingText}">${statusIcon('refresh')}</span>`
    : '';
  const updateNote = error
    ? `<div class="res-update-note">${statusIcon('offline')}${isEn ? 'Offline · Saved results' : 'Sin conexión · Datos conservados'}${time ? ' · '+esc(time) : ''}<button type="button" data-results-retry>${isEn ? 'Retry':'Reintentar'}</button></div>`
    : '';
  const status = `<span>${stageRow.publicationStatus === 'official' ? (isEn ? 'Official' : 'Oficial') : (isEn ? 'Provisional' : 'Provisional')}</span>${spinner}${time ? `<time datetime="${esc(stamp)}">${isEn ? 'Last updated' : 'Última actualización'}: ${esc(time)}</time>` : ''}`;
  return {
    status: inBar ? `<div class="res-publication-line">${status}</div>` : '',
    publication: inBar ? updateNote : `<div class="res-publication-line">${classHeading}${status}</div>${updateNote}`,
  };
}

// ── Corredores y equipos de las filas ───────────────────────────────
/**
 * Resolución de corredores y equipos de las filas contra la startlist curada
 * (startlist_riders_resolved por dorsal → globalRiderId/nombre/bandera/equipo,
 * igual que hizo resolve_uci_results en BD) y, sin ella, contra las fichas.
 * `slRiders`: filas de startlist_riders_resolved; `slTeamsRows`: respuesta de
 * startlistTeamsQuery(); `isEn`: idioma de los nombres de las selecciones.
 */
export function createResultsResolver({ race, slRiders, slTeamsRows, isEn }) {
  // OJO: startlist_riders.teamId apunta al **PK** de startlist_teams (id), NO a
  // su columna teamId (que es la referencia canónica a teams). El equipo canónico
  // (para el slug de /equipo/) se resuelve por ese teamId canónico de la fila.
  const byDorsal = new Map();          // dorsal(int) → snapshot resuelto de la startlist
  const byStartlistRider = new Map();  // globalRiderId → el mismo snapshot de la startlist
  const teamBySlugId = new Map();   // teamId canónico → fila teams (lo reusa enrichRiders)
  // PK de la fila de startlist_teams → { teamName, canonical teamId }, y
  // equipos canónicos (para enlazar a /equipo/<slug>/): teamId canónico → fila teams.
  const { startlistTeams, teams: raceTeams } = splitStartlistTeams(slTeamsRows, race.year);
  const slTeamByPk = new Map(startlistTeams.map(t => [t.id, t]));
  raceTeams.forEach(t => teamBySlugId.set(t.id, t));
  (slRiders || []).forEach(r => {
    const slTeam = r.teamId ? slTeamByPk.get(r.teamId) : null;       // fila por PK
    const canon  = slTeam?.teamId ? teamBySlugId.get(slTeam.teamId) : null;
    // Estado sin equipo → ocultación cosmética: sin nombre de equipo, y en
    // cascada sin chapa ni opción de filtro.
    const slName = isNoTeamPlaceholderTeam(slTeam) ? '' : (slTeam?.teamName || '');
    const snapshot = {
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      countryCode: r.countryCode || '',
      // Equipo casado → nombre canónico del catálogo (Title Case), con las
      // selecciones nacionales en el idioma de la página; sin casar → el
      // crudo de la startlist (p. ej. "TEAM RINGERIKE" de la UCI).
      teamName: localizedTeamName(canon?.name || slName, canon, isEn),
      teamObj: canon || null,   // para la chapa (solo desktop)
    };
    if (r.dorsal != null) byDorsal.set(r.dorsal, snapshot);
    // Los resultados introducidos a mano pueden no llevar dorsal. Si el panel
    // ya los enlazó a una ficha presente en la startlist, el equipo inscrito
    // sigue siendo la fuente de verdad y debe ganar al equipo actual de la ficha.
    if (r.globalRiderId) byStartlistRider.set(r.globalRiderId, snapshot);
  });
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
  // Fallback por nombre (eventos de equipos: el dorsal es del equipo, no del
  // corredor). Una búsqueda por nombre: se repite en cada fila del equipo.
  const hrefByName = new Map();
  const teamHrefByName = (teamName) => {
    if (!teamName || !raceTeams.length) return null;
    // teamLinkUrl decide: enlaces globalmente desactivados POR EL MOMENTO → null.
    if (!hrefByName.has(teamName)) hrefByName.set(teamName, teamLinkUrl(findMatchingTeam(teamName, raceTeams)));
    return hrefByName.get(teamName);
  };
  // Resuelve un teamId de override a su equipo canónico (nombre + chapa + enlace).
  // Requiere que enrichOverrideTeams haya corrido antes para el id en cuestión.
  const overrideTeam = (teamId) => {
    if (!teamId) return null;
    const team = teamBySlugId.get(teamId);
    return team ? { teamName: localizedTeamName(team.name, team, isEn), teamHref: teamLinkUrl(team), teamObj: team } : null;
  };
  return {
    race, isEn, raceTeams, startlistTeams, teamBySlugId,
    // Fallback por globalRiderId (carreras SIN startlist), poblado por enrichRiders.
    byRider: new Map(),   // globalRiderId → { name, countryCode, teamName, teamHref, teamObj, riderHref }
    startlistRiderForResult, startlistTeamForResult, teamHrefByName, overrideTeam,
  };
}

/**
 * Fichas de los corredores `ids` (carreras SIN startlist): la ficha global
 * aporta nombre y nacionalidad. El año vigente conserva el fallback actual
 * para no degradar resultados ya publicados. En temporadas anteriores, el
 * equipo solo puede proceder de la startlist o del teamId de la fila;
 * currentTeamId describe el presente y no es temporalmente válido. Caché
 * perezosa en `resolver.byRider`. `client`: cliente de Supabase (o el local
 * del build, con las mismas filas).
 */
export async function enrichRiders(client, resolver, ids, now = new Date()) {
  const { byRider, teamBySlugId, race, isEn } = resolver;
  const need = [...new Set(ids)].filter(id => id && !byRider.has(id));
  if (!need.length) return;
  const currentMadridYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(now));
  const includeCurrentTeam = race.year === currentMadridYear;
  const riderColumns = includeCurrentTeam ? 'id, firstName, lastName, nationality, currentTeamId' : 'id, firstName, lastName, nationality';
  const [{ data: men }, { data: women }] = await Promise.all([
    client.from('riders_men').select(riderColumns).in('id', need),
    client.from('riders_women').select(riderColumns).in('id', need),
  ]);
  const riders = [...(men || []), ...(women || [])];
  const teamById = new Map();
  if (includeCurrentTeam) {
    const curIds = [...new Set(riders.map(r => r.currentTeamId).filter(Boolean))];
    curIds.forEach(id => { const team = teamBySlugId.get(id); if (team) teamById.set(id, team); });
    const missing = curIds.filter(id => !teamById.has(id));
    if (missing.length) {
      const { data } = await client.from('teams').select(TEAM_COLUMNS).in('id', missing);
      (await teamsForSeason(client, data || [], race.year)).forEach(team => teamById.set(team.id, team));
    }
  }
  for (const r of riders) {
    const team = includeCurrentTeam && r.currentTeamId ? teamById.get(r.currentTeamId) : null;
    byRider.set(r.id, {
      // Nombre canónico de la ficha (orden natural "Nombre Apellido"). El
      // render lo prefiere al riderDisplay crudo (que en CN sin startlist
      // llega como "APELLIDO Nombre" de la fuente). Así el formato del
      // riderDisplay deja de importar cuando la fila está enlazada a ficha.
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim(),
      countryCode: r.nationality || '',
      teamName: localizedTeamName(team?.name || '', team, isEn),
      teamHref: teamLinkUrl(team),
      teamObj: team || null,
      riderHref: riderLinkUrl(r.id, team),
    });
  }
  // ids sin ficha (no estaban en riders_*): marcar como vistos (vacío) para no
  // re-consultar en cada render.
  need.forEach(id => { if (!byRider.has(id)) byRider.set(id, null); });
}

/**
 * Override manual de equipo (race_uci_results.teamId, fijado en el panel):
 * carga perezosa de los equipos canónicos referidos, reutilizando los de la
 * startlist y completando los que falten con la chapa + nombre.
 */
export async function enrichOverrideTeams(client, resolver, ids) {
  const { teamBySlugId, race } = resolver;
  const need = [...new Set(ids)].filter(id => id && !teamBySlugId.has(id));
  if (!need.length) return;
  const { data } = await client.from('teams').select(TEAM_COLUMNS).in('id', need);
  (await teamsForSeason(client,data || [],race.year,need)).forEach(t => teamBySlugId.set(t.id, t));
}

// ── Clasificación ───────────────────────────────────────────────────
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

// Bandera de las filas sin estilo en línea: el tamaño sale de `.so-flag > img`
// (css/app.css). Una tabla lleva hasta ~180 filas.
function flagHtml(code) {
  const c = String(code || '').toLowerCase();
  return c ? `<span class="so-flag"><img src="${flagIconUrl(c)}" alt="${esc(c)}"></span>` : '';
}

// Marcadores especiales (no clasificados, DNF/DNS/OTL/DSQ): IRM_LABELS vive en
// results/uci-irm.js (fuente única, compartida con el tachado de inscritos). Se
// muestran SOLO en la columna de puesto (#), con la etiqueta corta localizada y
// su descripción larga como tooltip (title) — p. ej. "Abandono" / "Did not
// finish". El corredor que abandona rara vez es de WT/PT (sin tooltip de
// ficha), así que el title es la única pista de qué significa la abreviatura.
function dnfBadge(code, race, lang) {
  const label = (IRM_LABELS[code] || { es: code, en: code })[lang];
  const desc  = irmDescription(code, lang, race?.gender === 'female');
  const title = desc ? ` title="${esc(desc)}"` : '';
  return `<span class="res-rank-dnf"${title}>${esc(label)}</span>`;
}

// Aviso de general ARRASTRADA: en una etapa cancelada las generales que se
// muestran son las de la etapa anterior (la carrera no se movió). Sin decirlo,
// una GC idéntica a la de ayer se lee como un volcado viejo o roto.
export function carriedNoticeHtml(stageRow, isEn) {
  const from = stageRow?._carriedFromStage;
  if (from == null) return '';
  const fromLbl = `${from}${stageRow._carriedFromSuffix || ''}`;
  const lbl = isEn
    ? `Standings unchanged: the stage was cancelled. Classification after stage ${fromLbl}.`
    : `La clasificación no varía: la etapa se canceló. General tras la etapa ${fromLbl}.`;
  return `<div class="res-carried-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>${esc(lbl)}</span>
    </div>`;
}

// Etapa CANCELADA: su pestaña "Etapa" no tiene clasificación que mostrar —
// la carrera no llegó a meta. En vez de una tabla vacía ("no hay datos",
// que se lee como un volcado que falta), el aviso explica QUÉ pasó.
export function cancelledNoticeHtml(isEn) {
  return `<div class="res-cancelled-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        <span>${isEn ? 'Stage cancelled' : 'Etapa cancelada'}</span>
      </div>`;
}

export const emptyClassificationHtml = isEn => `<div class="startlist-empty">${isEn ? 'No data for this classification.' : 'No hay datos para esta clasificación.'}</div>`;
export const loadingHtml = isEn => `<div class="loading">${isEn ? 'Loading' : 'Cargando'}</div>`;

// ── Crono por equipos (CRE/TTT) colapsada a una fila por equipo ──
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
function tttTableHtml(rows, stageRow, { resolver, race, lang }) {
  const isEn = lang === 'en';
  const { startlistRiderForResult, overrideTeam, byRider } = resolver;
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

  const teamHdr = isEn ? 'Team' : 'Equipo';
  const timeHdr = isEn ? 'Time' : 'Tiempo';
  let t = `<table class="so-table res-table res-table--ttt">
      <thead><tr>
        <th class="so-th res-th--rank">#</th>
        <th class="so-th res-th--rider">${teamHdr}</th>
        ${uciPointsHeaderHtml(showUciPoints)}
        <th class="so-th res-th--result">${timeHdr}</th>
      </tr></thead><tbody>`;

  teamRows.forEach((tr, i) => {
    const teamBadge = tr.teamObj ? teamStripes(tr.teamObj) : '';
    const nameInner = tr.teamHref
      ? `<a class="so-link" href="${esc(tr.teamHref)}">${esc(tr.teamName)}</a>`
      : esc(tr.teamName || '-');
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
    t += `<tr class="so-row res-team-row" data-ttt-group="${i}" tabindex="0" role="button" aria-expanded="false">`
      + `<td class="so-td res-td--rank">${rankCell}</td>`
      + `<td class="so-td res-td--rider"><span class="res-ttt-team">${teamBadge}<span class="res-ttt-team-name">${nameInner}</span><span class="res-ttt-caret" aria-hidden="true">▾</span></span></td>`
      + `${uciPointsCellHtml(showUciPoints, tr)}<td class="so-td res-td--result">${resultCell}</td></tr>`;
    // Sub-filas de corredores (ocultas por defecto): bandera + nombre + tiempo individual.
    tr.riders.forEach((r) => {
      const fs = startlistRiderForResult(r);
      const fr = !fs && r.globalRiderId ? byRider.get(r.globalRiderId) : null;
      const nm = (fs && fs.name) || (fr && fr.name) || r.riderDisplay || '';
      const cc = fs ? fs.countryCode : (fr ? fr.countryCode : '');
      const flag = flagHtml(cc);
      // timing.ee separa el crono oficial del equipo (`timeText` del líder)
      // del crono individual de TODOS sus integrantes (`resultValue`). Otras
      // fuentes CRE conservan el contrato histórico en `timeText`.
      const riderTimeText = /^https:\/\/timing\.ee\//i.test(stageRow?.sourcePdfUrl || '')
        ? r.resultValue
        : r.timeText;
      const indiv = r.irm
        ? dnfBadge(r.irm, race, lang)
        : (riderTimeText ? `<span class="res-gap">${esc(riderTimeText)}</span>` : '');
      // (El tooltip/enlace de ficha de las sub-filas CRE se retiró; nombre plano.)
      const nmInner = `<span class="res-rider-name">${esc(nm)}</span>`;
      t += `<tr class="so-row res-ttt-rider" data-ttt-member="${i}" hidden><td class="so-td res-td--rank"></td>`
        + `<td class="so-td res-td--rider res-ttt-rider-cell">${flag}<span class="res-rider-main">${nmInner}</span></td>`
        + `${uciPointsCellHtml(showUciPoints, r)}<td class="so-td res-td--result">${indiv}</td></tr>`;
    });
  });
  t += `</tbody></table>`;
  return carriedNoticeHtml(stageRow, isEn) + t;
}

/**
 * HTML de la clasificación `stageRow` con sus filas (`rows`, por sortOrder):
 * { ttt, head, rows, tail, teamsInClass, isTeams }. La tabla completa es
 * head + rows.join('') + tail; la CRE colapsada va entera en `head` (rows
 * vacío). «m.t.» sale ya calculado para la tabla sin filtro por equipo
 * (applyTeamFilter de js/resultados.js lo recalcula sobre las filas visibles).
 * `resolver`: createResultsResolver() con enrichRiders() y
 * enrichOverrideTeams() aplicados a las filas.
 */
export function classificationHtml(rows, stageRow, { race, raceDay, isOneDay, resolver, lang }) {
  const isEn = lang === 'en';
  const { startlistRiderForResult, startlistTeamForResult, teamHrefByName, overrideTeam, byRider, teamBySlugId, raceTeams } = resolver;
  // isTeams = clasificación de EQUIPOS ya colapsada (1 fila por equipo): solo cuando
  // el nombre lo dice (classKind='teams'). NO se usa isTeamEvent: la UCI lo marca true
  // en TODAS las clasificaciones de una etapa CRE (incl. la de etapa, la general, los
  // puntos…), así que no distingue una tabla de equipos de una CRE de corredores.
  const isTeams = stageRow.classKind === 'teams';

  // ── Crono por equipos (CRE/TTT) DISFRAZADA de clasificación individual ──
  // La UCI publica la etapa de CRE como "Stage Classification" (classKind='stage')
  // listando TODOS los corredores agrupados por equipo. Renderizarla como individual
  // da el absurdo "varios corredores en el puesto 1 con tiempos distintos". Hay que
  // COLAPSARLA a una fila por equipo (lo hace tttTableHtml). Dos variantes de la UCI:
  //   A) Dauphiné: cada corredor del equipo lleva el rank del equipo (1,1,1 · 2,2,2…),
  //      y la etapa NO viene marcada como de equipos (isTeamEvent=false, raceType=ITT).
  //   B) Tour de Japón: solo el líder del equipo lleva rank, los compañeros rank=null;
  //      la UCI SÍ la marca isTeamEvent=true (pero con eventName cruzado).
  //   C) CRE de UN DÍA (Ses Salines…): la UCI publica el resultado como classKind='gc'
  //      (no hay etapa separada). Mismo patrón que ITT de un día en isIttStage.
  // Señal: classKind='stage' (o 'gc' final de un día) + jornada CRE en NUESTRO catálogo
  // (raceDay.primaryType='ttt'), corroborado por la estructura (ranks compartidos [A] o
  // muchos rank=null entre clasificados [B]). No nos fiamos de los flags de la UCI.
  const isTttStage = isTttStageClassification({
    rows, classKind: stageRow.classKind, isTeams, raceDay,
    stageNumber: stageRow.stageNumber, isOneDay, stageRaceType: stageRow.raceType,
  });
  if (isTttStage) return { ttt: true, head: tttTableHtml(rows, stageRow, { resolver, race, lang }), rows: [], tail: '', teamsInClass: new Set(), isTeams };

  // Puntos/Montaña son clasificaciones por PUNTOS, no por tiempo: la última
  // columna se titula "Pts" y el valor va en gris (sin estilo de tiempo ganador).
  // El valor puede venir en `points` o, si es null, como entero en resultValue.
  const isPtsClass = stageRow.classKind === 'points' || stageRow.classKind === 'kom';
  const ptsOf = (r) => r.points != null ? r.points
    : (/^\d+$/.test(String(r.resultValue ?? '')) ? Number(r.resultValue)
      : (/^\d+$/.test(String(r.timeText ?? '')) ? Number(r.timeText) : null));
  const valueHeader = isPtsClass ? 'Pts' : (isEn ? 'Time' : 'Tiempo');
  const showUciPoints = hasUciPoints(rows);
  // Clasificaciones por tiempo (etapa/general/jóvenes): "mismo tiempo" → m.t./s.t.
  const isTimeClass = !isPtsClass && !isTeams;
  const sameTimeLabel = isEn ? 's.t.' : 'm.t.';
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

  // El rank 1 puede traer un `irm`. Hay que distinguir dos cosas opuestas:
  //   · RUIDO (p. ej. irm='LAP' = doblada): la corredora SÍ ganó; la UCI cuelga el
  //     código por error. Caso real: Dwars door de Westhoek 2026 — la ganadora
  //     llegó con LAP y SIN timeText. Debe encabezar como ganadora.
  //   · IRM SIN GANADOR (abandono, DF o NR): ese rank 1 no determina ganador;
  //     el ganador real, si existe, es el primer clasificado SIN irm. Caso real: Vuelta a
  //     Colombia Femenina — rank 1 con DNS, el tiempo de cabeza es el del rank 2.
  // → `winnerRow` solo cuenta como ganadora si su irm admite ganador.
  const rank1Row = rows.find(r => r.rank === 1) || null;
  const winnerRow = (rank1Row && !isNonWinnerIrm(rank1Row.irm)) ? rank1Row : null;
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

  const head = carriedNoticeHtml(stageRow, isEn) + `<table class="so-table res-table">
      <thead><tr>
        <th class="so-th res-th--rank">#</th>
        <th class="so-th res-th--rider">${isTeams ? (isEn ? 'Team' : 'Equipo') : (isEn ? 'Rider' : 'Corredor')}</th>
        ${isTeams ? '' : `<th class="so-th res-th--team">${isEn ? 'Team' : 'Equipo'}</th>`}
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

  // «m.t.» de la tabla sin filtro: el 1º de cada grupo de tiempo muestra su gap
  // real y los siguientes con el mismo gap, m.t. (applyTeamFilter repite el
  // cálculo sobre las filas visibles al filtrar por equipo).
  let prevGap = null;
  const rowsHtml = rows.map((r, rowIndex) => {
    const fromSl = startlistRiderForResult(r);
    const teamSnapshot = isTeams ? startlistTeamForResult(r) : null;
    // Sin casar por dorsal (carrera sin startlist): caer al enriquecido por
    // globalRiderId (nombre + bandera + ficha de riders_*). null si la
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
    const flagCell = flagHtml(cc);
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

    // rowGap: el gap real de esta fila (data-gap): applyTeamFilter rehace m.t.
    // sobre las filas VISIBLES para que el filtro por equipo recalcule bien
    // quién es el primero de cada grupo.
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
    } else if (effGap && /^\+0"$/.test(effGap) && (isTeams || rowIndex <= headBlockEnd)) {
      // Un equipo con gap 0 tiene el mismo tiempo total que el ganador. En las
      // clasificaciones individuales se exige además el bloque de cabeza para
      // no ocultar una reasignación de tiempo fuera de ese grupo. Sin data-gap →
      // applyTeamFilter no lo toca; queda fijo como m.t.
      resultCell = `<span class="res-gap res-gap--same">${esc(sameTimeLabel)}</span>`;
    } else if (effGap && rowIndex > headBlockEnd && /^\+0"$/.test(effGap)) {
      // Reasignación de comisarios (gap 0 fuera del bloque de cabeza): gap FIJO,
      // sin data-gap → applyTeamFilter no lo toca y nunca se colapsa a m.t.
      resultCell = `<span class="res-gap">${esc(effGap)}</span>`;
    } else if (effGap) {
      // Gap real en un span dinámico: m.t. si repite el gap del anterior.
      rowGap = effGap;
      resultCell = prevGap != null && effGap === prevGap
        ? `<span class="res-gap res-gap--same res-gap-dyn">${esc(sameTimeLabel)}</span>`
        : `<span class="res-gap res-gap-dyn">${esc(effGap)}</span>`;
      prevGap = effGap;
    } else {
      resultCell = esc(r.timeText || r.resultValue || '');
    }

    // Columna #: un abandono real (DNF/DNS/OTL/DSQ/ABD) se rotula con su etiqueta
    // corta AUNQUE la UCI le haya dejado un rank (rank 1 con DNS en la Vuelta a
    // Colombia → "NS", no "1": no salió, no es un puesto). Un rank con irm de ruido
    // (LAP en el ganador) conserva su número. Sin rank ni irm → guion.
    let rankCell;
    if (isAbandonIrm(r.irm)) {
      rankCell = dnfBadge(r.irm, race, lang);
    } else if (r.rank != null) {
      rankCell = r.rank;
    } else if (r.irm) {
      rankCell = dnfBadge(r.irm, race, lang);
    } else {
      rankCell = `<span class="res-rank-dnf">${esc(r.rankText || '–')}</span>`;
    }

    if (isTeams) {
      // Casado → nombre canónico del catálogo + chapa (como la columna Equipo
      // de las clasificaciones individuales); sin casar → el crudo de la fuente.
      const displayName = localizedTeamName((rowTeamObj && rowTeamObj.name) || riderName, rowTeamObj, isEn);
      const teamBadge = rowTeamObj ? teamStripes(rowTeamObj) : '';
      const nameInner = teamHref
        ? `<a class="so-link" href="${esc(teamHref)}">${esc(displayName)}</a>`
        : esc(displayName);
      const teamCell = `<span class="res-team-cell">${teamBadge}${nameInner}</span>`;
      return `<tr class="so-row"><td class="so-td res-td--rank">${rankCell}</td><td class="so-td res-td--rider">${teamCell}</td>`
        + `${uciPointsCellHtml(showUciPoints, r)}<td class="so-td res-td--result">${resultCell}</td></tr>`;
    }
    // El corredor enlaza a SU FICHA (/corredor/<id>/) si es de las dos
    // primeras divisiones (riderHref, gateado por riderLinkUrl); si no,
    // texto plano. El equipo enlaza en su propia columna.
    const riderHref = (fromSl && fromSl.riderHref) || (fromRider && fromRider.riderHref) || null;
    const nameLink = (riderHref && riderName)
      ? `<a class="so-link res-rider-name" href="${esc(riderHref)}">${esc(riderName)}</a>`
      : (riderName
        ? `<span class="res-rider-name">${esc(riderName)}</span>`
        : '<span class="res-rider-name" style="opacity:0.45">-</span>');
    // Objeto equipo (override manual → por dorsal → equipo actual del
    // enriquecido por globalRiderId; null si nada casó → sin chapa).
    const teamObj = (ovrTeam && ovrTeam.teamObj) || (fromSl && fromSl.teamObj) || (fromRider && fromRider.teamObj) || null;
    // Subtítulo de equipo (solo visible en móvil, donde la columna Equipo se
    // oculta) con las franjas del equipo; la columna Equipo de escritorio
    // repite franjas y nombre.
    const teamSub = teamName ? `<span class="res-rider-team">${teamStripes(teamObj)}${esc(teamName)}</span>` : '';
    const riderCell = `${flagCell}<span class="res-rider-main">${nameLink}${teamSub}</span>`;
    const teamBadge = teamObj ? teamStripes(teamObj) : '';
    const teamInner = teamName
      ? (teamHref ? `<a class="so-link res-team-link" href="${esc(teamHref)}">${esc(teamName)}</a>` : esc(teamName))
      : '';
    const teamCell = teamName ? `<span class="res-team-cell">${teamBadge}${teamInner}</span>` : '';
    // Sin sangrado ni data-gap vacío: applyTeamFilter trata igual un atributo
    // ausente y uno vacío.
    return `<tr class="so-row" data-team="${esc(teamName)}"${rowGap ? ` data-gap="${esc(rowGap)}"` : ''}>`
      + `<td class="so-td res-td--rank">${rankCell}</td><td class="so-td res-td--rider">${riderCell}</td>`
      + `<td class="so-td res-td--team">${teamCell}</td>${uciPointsCellHtml(showUciPoints, r)}<td class="so-td res-td--result">${resultCell}</td></tr>`;
  });

  return { ttt: false, head, rows: rowsHtml, tail: '</tbody></table>', teamsInClass, isTeams };
}

/** HTML de la tabla con sus primeras `limit` filas (todas sin límite). */
export function classificationTableHtml(content, limit = Infinity) {
  return content.head + content.rows.slice(0, limit).join('') + content.tail;
}

/**
 * Filtro por equipo (solo individuales con ≥2 equipos; la CRE colapsada no
 * lo lleva: 1 fila = 1 equipo), en el hueco de la barra de pestañas. La
 * selección (`teamFilter`) persiste entre clasificaciones.
 */
export function teamFilterHtml({ ttt, teamsInClass, isTeams }, teamFilter, isEn) {
  if (ttt || isTeams || !(teamsInClass.size >= 2 || teamFilter)) return '';
  const sorted = [...teamsInClass].sort((a, b) => a.localeCompare(b, isEn ? 'en' : 'es'));
  if (teamFilter && !teamsInClass.has(teamFilter)) sorted.push(teamFilter);
  const allTeamsLbl = isEn ? 'All teams' : 'Todos los equipos';
  const opts = [`<option value="">${esc(allTeamsLbl)}</option>`]
    .concat(sorted.map((tn) => `<option value="${esc(tn)}"${tn === teamFilter ? ' selected' : ''}>${esc(tn)}</option>`))
    .join('');
  return `<select class="res-teamfilter__select" id="resTeamFilter" aria-label="${esc(allTeamsLbl)}" title="${esc(allTeamsLbl)}">${opts}</select>`;
}
