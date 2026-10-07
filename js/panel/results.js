// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Pestaña Resultados del editor de jornada
// ─────────────────────────────────────────────────────────────────

import { panelClassificationRowHtml } from './editor-ui.js';
import { supabase, esc } from '../shared.js';
import { sectorSuffixMap } from '../services/races.js';
import { confirmDialog, alertDialog } from '../components/dialog.js';
import { madridDateKey, madridTimeToTimestamp } from '../services/timezone.js';
import {
  applyPersistedResultSyncDayState, isFinalStageRaceDay, pairFinalClassifications,
  resultClassificationBelongsToDay, resultClassificationOfficialState,
  RESULT_SYNC_DAY_STATE_SELECT, resultSyncDefaultScope, resultSyncScopeOptionsVisible,
  resolveResultLeaderName,
} from '../results/panel-logic.js';
import { formatDateTime, formatTimeHHMM, showToast } from './helpers.js';
import { buildResolvedRiderMapForRace } from './start-order.js';
import {
  _deleteUciLink, _UCI_SEASON, _writeUciLink,
} from './uci-link.js';
import { _ruNewClass, openUciClassEditor } from './results-editor.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Pestaña "Resultados" del editor de jornada — clasificaciones UCI in-house
//
//  Dos piezas:
//   (1) Origen UCI: el enlace carrera↔competitionId (race_uci_links), editable
//       desde aquí a mano (escribe con _writeUciLink; la auto-detección vive
//       en el editor de carrera).
//   (2) Las clasificaciones de ESTA jornada (race_uci_stages keepForWeb con
//       raceDayId = jornada; en la última etapa/carreras de un día, también las
//       finales con raceDayId NULL), cada una editable en un drawer nivel 2.
//
//  BLOQUEO (migración 087): el candado de la lista fija lockedAt y hace que el
//  upsert del cron deje de tocar la cabecera y sus filas. Guardar cambios conserva
//  el estado actual del candado; bloquear o desbloquear es una decisión separada.
//  resolve_uci_results sigue corriendo también sobre bloqueadas: solo re-enlaza
//  globalRiderId por dorsal (la startlist curada es la verdad del corredor).
// ═══════════════════════════════════════════════════════════════════════════

const UCI_CLASS_ORDER = ['stage', 'gc', 'points', 'kom', 'youth', 'teams'];
export const UCI_CLASS_LABELS = {
  stage: 'Etapa', gc: 'General', points: 'Puntos',
  kom: 'Montaña', youth: 'Jóvenes', teams: 'Equipos',
};
export const UCI_EDITABLE_IRM_CODES = ['', 'DNF', 'DNS', 'OTL', 'DSQ', 'DF', 'NR'];

// Fuentes que el panel puede cambiar a 'uci' al (re)enlazar una competición de DataRide.
// Las de CRONOMETRADOR quedan fuera a propósito: su competitionId es sintético y su
// código propio (tissotCode…) manda — pasarlas a 'uci' las rompería. Ver _writeUciLink.
export const UCI_PANEL_OWNED_SOURCES = new Set([null, undefined, 'uci', 'pdf']);

// Fuentes SIN fetcher automático: el cron las salta (results-cron.mjs las excluye en
// la query y con un guard en el bucle) → el volcado es manual. Se avisa en la cabecera
// "Origen UCI" para que no parezca que el cron va a recogerlas y no lo haga en silencio.
const UCI_MANUAL_SOURCES = new Set(['pdf', 'sportstiming']);

const UCI_SOURCE_LABELS = {
  uci: 'UCI DataRide', pdf: 'PDF (volcado manual)', tissot: 'Tissot',
  matsport: 'Matsport', sportstiming: 'Sportstiming (volcado manual)',
  manual_timing: 'manual_timing', raceresult: 'race|result',
  sts: 'STS/Wiclax', domtel: 'Domtel', livetiming: 'Livetiming.at',
  classificacoes: 'Classificações', infocity: 'InfoCity', sportsoft: 'Sportsoft',
  eqtiming: 'EQ Timing', colombia: 'Clasificaciones del Ciclismo Colombiano',
  burgos: 'Vuelta a Burgos', 'timing.ee': 'timing.ee',
  chronohr: 'CH:RO:NO', maneffic: 'Maneffic Timing & Results',
  istanbul: 'Tour of Istanbul',
  southbohemia: 'Tour of South Bohemia',
  atresults: 'AT Results Service',
  mikatiming: 'mika:timing',
  ficr: 'FICR',
  lapclip: 'LAPCLIP (Matrix Sports)',
};

// La cabecera del panel debe llevar a quien realmente cronometra la carrera, no
// al identificador técnico que conservamos para el fetcher. Son páginas base: el
// código de cada proveedor no siempre se puede convertir en una URL pública estable.
const UCI_SOURCE_URLS = {
  uci: 'https://dataride.uci.ch/iframe/Results/10/',
  tissot: 'https://www.tissottiming.com/',
  matsport: 'https://cycling.matsport.com/',
  sportstiming: 'https://www.sportstiming.dk/',
  manual_timing: 'https://timing.example.invalid/',
  raceresult: 'https://my.raceresult.com/',
  sts: 'https://www.stsport.fr/',
  domtel: 'https://wyniki.domtel-sport.pl/',
  livetiming: 'https://livetiming.at/',
  classificacoes: 'https://www.classificacoes.net/',
  infocity: 'https://tdp.infocity.pl/',
  sportsoft: 'https://vysledky.sportsoft.cz/',
  eqtiming: 'https://live.eqtiming.com/',
  colombia: 'https://www.clasificacionesdelciclismocolombiano.com/',
  burgos: 'https://www.vueltaburgos.com/',
  'timing.ee': 'https://timing.ee/',
  chronohr: 'https://chrono.hr/races',
  maneffic: 'https://www.timing-results.com/',
  istanbul: 'https://tourofistanbul.com.tr/results/',
  southbohemia: 'https://www.okolojiznichcech.cz/vysledky.html',
  atresults: 'https://atresults.wixsite.com/attiming/results',
  mikatiming: 'https://www.mikatiming.com/',
  ficr: 'https://ciclismo.ficr.it/',
  lapclip: 'https://matrix-sports.jp/lap/',
};

function _ruSourceLink(source) {
  const label = UCI_SOURCE_LABELS[source] || source;
  const url = UCI_SOURCE_URLS[source];
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`
    : esc(label);
}

function _ruLastDumpAt(stages) {
  return stages.reduce((latest, stage) => {
    const value = stage.updatedAt;
    return value && (!latest || new Date(value) > new Date(latest)) ? value : latest;
  }, null);
}

function _ruClassLabel(st) {
  const base = UCI_CLASS_LABELS[st.classKind] || st.classKind;
  return st.isFinalClassification ? `${base} · final` : base;
}

async function _ruEnrichStageLeaders(raceId, stages) {
  const stageIds = stages.map((stage) => stage.id).filter(Boolean);
  if (!stageIds.length) return stages;
  const [leadersRes, riderMap] = await Promise.all([
    supabase.from('race_uci_results')
      .select('stageRef,bib,riderDisplay,globalRiderId,teamId,irm,sortOrder')
      .eq('raceId', raceId).eq('rank', 1).order('sortOrder', { ascending: true }),
    buildResolvedRiderMapForRace(raceId),
  ]);
  if (leadersRes.error) throw leadersRes.error;

  const leadersByStage = new Map();
  (leadersRes.data || []).forEach((row) => {
    if (!leadersByStage.has(row.stageRef)) leadersByStage.set(row.stageRef, []);
    leadersByStage.get(row.stageRef).push(row);
  });
  // La web resuelve también líderes con ficha global aunque no aparezcan en la
  // startlist. Completar ese mismo fallback para que ambos nombres coincidan.
  const riderByGid = riderMap.__byGid || {};
  const missingGids = [...new Set((leadersRes.data || [])
    .map((row) => row.globalRiderId).filter((id) => id && !riderByGid[id]))];
  if (missingGids.length) {
    const [{ data: men, error: menError }, { data: women, error: womenError }] = await Promise.all([
      supabase.from('riders_men').select('id,firstName,lastName').in('id', missingGids),
      supabase.from('riders_women').select('id,firstName,lastName').in('id', missingGids),
    ]);
    if (menError) throw menError;
    if (womenError) throw womenError;
    [...(men || []), ...(women || [])].forEach((rider) => {
      riderByGid[rider.id] = {
        name: `${rider.firstName || ''} ${rider.lastName || ''}`.trim(),
      };
    });
  }
  const teamIds = [...new Set((leadersRes.data || []).map((row) => row.teamId).filter(Boolean))];
  const teamNameById = {};
  if (teamIds.length) {
    const { data: teams, error } = await supabase.from('teams').select('id,name').in('id', teamIds);
    if (error) throw error;
    (teams || []).forEach((team) => { teamNameById[team.id] = team.name; });
  }
  stages.forEach((stage) => {
    stage._leaderName = resolveResultLeaderName(
      stage,
      leadersByStage.get(stage.id) || [],
      riderMap,
      riderByGid,
      teamNameById,
    );
  });
  return stages;
}

export async function setupUciResultsSection(rd, race) {
  const body = document.getElementById('ruSectionBody');
  if (!body) return;
  try {
    const [linkRes, stagesRes, daysRes] = await Promise.all([
      supabase.from('race_uci_links').select('*').eq('raceId', rd.raceId).maybeSingle(),
      supabase.from('race_uci_stages').select('*').eq('raceId', rd.raceId).eq('keepForWeb', true),
      supabase.from('race_days').select('id,dateKey,stageNumber,isRestDay,isCancelledDay,neutralStartTimeUtc').eq('raceId', rd.raceId),
    ]);
    if (linkRes.error) throw linkRes.error;
    if (stagesRes.error) throw stagesRes.error;
    if (daysRes.error) throw daysRes.error;
    // Guard: el editor pudo cambiar de jornada mientras llegaba la respuesta.
    if (document.getElementById('editorArea')?.dataset.rdId !== rd.id) return;
    const stages = stagesRes.data || [];
    try {
      await _ruEnrichStageLeaders(rd.raceId, stages);
    } catch (leaderErr) {
      console.warn('No se pudieron resolver los líderes del panel:', leaderErr);
    }
    // Segundo guard: la resolución de líderes añade lecturas asíncronas.
    if (document.getElementById('editorArea')?.dataset.rdId !== rd.id) return;
    _ruRenderSection(body, rd, race, linkRes.data || null, stages, daysRes.data || []);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="u-c-danger u-fs-2">Error al cargar los resultados UCI: ${esc(err.message || String(err))}</div>`;
  }
}

// Cabecera de fuente: el enlace se decide a mano en DataRide; no hay matcher.
function _ruOriginHtml(rd, race, link, stageResults = []) {
  if (!link) {
    // Un placeholder manual sin fuente publica clasificaciones sin crear enlace.
    const state = stageResults.length
      ? 'los resultados cargados son provisionales; la fuente que se enlace los sustituirá.'
      : 'sin enlace no hay resultados in-house.';
    return `<div class="ru-origin">
      <div class="ru-origin__state">Esta carrera <strong>no tiene fuente enlazada</strong> —
        ${state}</div>
      <div class="u-row u-mt-045 u-wrap">
        <a class="btn btn--ghost btn--compact" href="https://dataride.uci.ch/iframe/Results/10/" target="_blank" rel="noopener">Últimos resultados de DataRide ↗</a>
        <button type="button" class="btn btn--primary ru-manual-link btn--compact">Enlazar fuente</button>
      </div>
    </div>`;
  }
  const src = link.source || 'uci';
  const srcLabel = UCI_SOURCE_LABELS[src] || src;
  const lastDumpAt = _ruLastDumpAt(stageResults);
  // Las fuentes de cronometrador sin fetcher necesitan el aviso para evitar que el
  // cron parezca activo. En PDF el volcado manual ya queda explícito en el origen.
  const manualWarn = UCI_MANUAL_SOURCES.has(src) && src !== 'pdf'
    ? `<div class="ru-origin__warn u-c-pending u-fs-1 u-mt-030">
        ⚠ Fuente <strong>${esc(srcLabel)}</strong>: el cron NO vuelca esta carrera — sus resultados se suben a mano.
        Sus resultados se mantienen manualmente; no se puede programar un volcado automático para esta fuente.
      </div>`
    : '';
  const isOneDay = race?.raceFormat === 'one_day';
  const canDumpStage = !UCI_MANUAL_SOURCES.has(src) && rd.stageNumber != null;
  const dumpButton = isOneDay
    ? `<button type="button" class="btn btn--primary ru-run-cron btn--compact"
        title="Re-vuelca esta carrera, respetando las clasificaciones bloqueadas manualmente.">▶ Volcar esta carrera</button>`
    : (canDumpStage
        ? `<button type="button" class="btn btn--primary ru-run-cron-stage btn--compact"
            title="Vuelca SOLO esta etapa: re-escribe únicamente su clasificación, sin re-volcar las demás etapas de la carrera. Respeta las clasificaciones bloqueadas.">▶ Volcar esta etapa</button>`
        : '');
  return `<div class="ru-origin">
    <div class="ru-origin__state">
      Origen: ${_ruSourceLink(src)}
      ${lastDumpAt ? `<span class="u-c-dim"> · último volcado ${formatDateTime(lastDumpAt)}</span>` : ''}
    </div>
    ${manualWarn}
    ${link.syncError ? `<div class="u-c-danger u-fs-1 u-mt-025">${esc(link.syncError)}</div>` : ''}
    <div class="u-row u-mt-045 u-wrap">
      <button type="button" class="btn btn--ghost ru-manual-link btn--compact">Cambiar enlace</button>
      <button type="button" class="btn btn--ghost ru-unlink btn--compact u-c-danger">Desenlazar</button>
      ${dumpButton}
    </div>
  </div>`;
}

// Fila de una clasificación en la lista de la pestaña. Sin chips de estado: los
// dos interruptores (oficialidad y bloqueo) son la única señal, y el detalle
// (sello manual o automático, desfase del par, fecha del candado) vive en sus
// tooltips.
function _ruClassRowHtml(st) {
  const paired = !!st._finalTwinId;
  const locked = paired ? !!st.lockedAt && !!st._finalTwinLockedAt : !!st.lockedAt;
  const partialLock = paired && (!!st.lockedAt !== !!st._finalTwinLockedAt);
  const officialState = resultClassificationOfficialState(st);
  const officialTitle = officialState.partial
    ? 'Solo una de las dos cabeceras emparejadas es oficial; usa el interruptor para igualarlas.'
    : (officialState.official
        ? (officialState.pinned
            ? `Oficializada manualmente el ${esc(formatDateTime(st.officialAt || st._finalTwinOfficialAt))} — el cron no la degrada a provisional.`
            : 'La fuente la declaró oficial.')
        : 'Marcar como oficial: la web y las apps la muestran como Oficial y el cron no la degradará a provisional.');
  const officialSwitch = `<label class="ru-switch${officialState.official ? ' is-on' : ''}" title="${officialTitle}">
    <input type="checkbox" class="ru-official-toggle" data-id="${esc(st.id)}" ${officialState.official ? 'checked' : ''} aria-label="Oficialidad de ${esc(_ruClassLabel(st))}">
    <span class="ru-switch__track"><span class="ru-switch__knob"></span></span>
    <span class="ru-switch__text">Oficial</span>
  </label>`;
  const lockTitle = partialLock
    ? 'Solo una de las dos cabeceras emparejadas está bloqueada; usa el interruptor para igualarlas.'
    : (locked
        ? `Bloqueada el ${esc(formatDateTime(st.lockedAt || st._finalTwinLockedAt))} — el cron no la sobreescribe.`
        : 'Bloquear esta clasificación: el cron dejará de actualizarla con los datos de la fuente.');
  const lockSwitch = `<label class="ru-switch ru-switch--lock${locked ? ' is-on' : ''}" title="${lockTitle}">
    <input type="checkbox" class="ru-lock-toggle" data-id="${esc(st.id)}" ${locked ? 'checked' : ''} aria-label="Bloqueo de ${esc(_ruClassLabel(st))}">
    <span class="ru-switch__track"><span class="ru-switch__knob"></span></span>
    <span class="ru-switch__text">Bloqueo</span>
  </label>`;
  return panelClassificationRowHtml({label:_ruClassLabel(st),title:st.eventName,rowCount:st.rowCount,leader:st._leaderName||st.winnerName,locked,chipsHtml:'',actionsHtml:`
    ${officialSwitch}
    ${lockSwitch}
    <button type="button" class="btn btn--ghost ru-edit btn--row" data-id="${esc(st.id)}">Editar</button>
    <button type="button" class="btn btn--ghost ru-delete btn--row u-c-danger" data-id="${esc(st.id)}" aria-label="Borrar ${esc(_ruClassLabel(st))}">Borrar</button>`});
}

function _ruSyncPolicyHtml(rd, race, link) {
  if (!link || UCI_MANUAL_SOURCES.has(link.source || 'uci')) return '';
  const defaultScope = resultSyncDefaultScope(rd);
  let startTime = '';
  if (rd.resultsSyncStartAt) {
    startTime = formatTimeHHMM(rd.resultsSyncStartAt);
  } else if (rd.resultsSyncStartOffsetMinutes != null && rd.estimatedFinishTimeUtc) {
    startTime = formatTimeHHMM(new Date(new Date(rd.estimatedFinishTimeUtc).getTime() + rd.resultsSyncStartOffsetMinutes * 60000));
  } else if (link.syncStartTime) {
    startTime = String(link.syncStartTime).slice(0, 5);
  } else if (rd.estimatedFinishTimeUtc) {
    const startOffset = link.syncStartOffsetMinutes ?? -15;
    startTime = formatTimeHHMM(new Date(new Date(rd.estimatedFinishTimeUtc).getTime() + startOffset * 60000));
  }
  let stopTime = '';
  if (rd.resultsSyncStopAt) {
    stopTime = formatTimeHHMM(rd.resultsSyncStopAt);
  } else if (rd.resultsSyncStopOffsetMinutes != null && rd.estimatedFinishTimeUtc) {
    stopTime = formatTimeHHMM(new Date(new Date(rd.estimatedFinishTimeUtc).getTime() + rd.resultsSyncStopOffsetMinutes * 60000));
  } else if (link.syncStopTime) {
    stopTime = String(link.syncStopTime).slice(0, 5);
  } else if (rd.estimatedFinishTimeUtc) {
    const stopOffset = link.syncStopOffsetMinutes ?? 180;
    stopTime = formatTimeHHMM(new Date(new Date(rd.estimatedFinishTimeUtc).getTime() + stopOffset * 60000));
  }
  const stageLabel = rd.stageNumber == null ? 'esta carrera' : `esta etapa (${rd.stageNumber === 0 ? 'prólogo' : 'etapa ' + rd.stageNumber})`;
  const scopeOptions = resultSyncScopeOptionsVisible(race)
    ? `<div class="u-row u-gap-060 u-wrap">
        <label><input type="radio" name="ru-sync-scope" value="race" ${defaultScope === 'race' ? 'checked' : ''}> Toda la carrera</label>
        <label><input type="radio" name="ru-sync-scope" value="day" ${defaultScope === 'day' ? 'checked' : ''}> Solo ${esc(stageLabel)}</label>
      </div>`
    : '';
  return `<div class="ru-sync-policy u-mt-065">
    <div class="u-fs-1 u-c-muted">Horario de volcado automático</div>
    <div class="ru-sync-box">
      ${scopeOptions}
      <div class="u-row u-gap-055 u-wrap u-items-end${scopeOptions ? ' u-mt-050' : ''}">
        <label> <span class="u-c-dim">Apertura (España)</span><input id="ru-sync-start-time" type="time" value="${esc(startTime)}" class="u-w-700"></label>
        <label> <span class="u-c-dim">Cierre (España)</span><input id="ru-sync-stop-time" type="time" value="${esc(stopTime)}" class="u-w-700"></label>
        <button type="button" class="btn btn--primary ru-sync-save btn--compact">Guardar ventana</button>
      </div>
    </div>
  </div>`;
}

async function _ruSaveSyncPolicy(btn, rd, race) {
  const scope = document.querySelector('input[name="ru-sync-scope"]:checked')?.value || 'race';
  const startTime = document.getElementById('ru-sync-start-time')?.value || '';
  const stopTime = document.getElementById('ru-sync-stop-time')?.value || '';
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [stopHour, stopMinute] = stopTime.split(':').map(Number);
  const validStartTime = /^\d{2}:\d{2}$/.test(startTime)
    && Number.isInteger(startHour) && startHour >= 0 && startHour <= 23
    && Number.isInteger(startMinute) && startMinute >= 0 && startMinute <= 59;
  const validStopTime = /^\d{2}:\d{2}$/.test(stopTime)
    && Number.isInteger(stopHour) && stopHour >= 0 && stopHour <= 23
    && Number.isInteger(stopMinute) && stopMinute >= 0 && stopMinute <= 59;
  if (!validStartTime || !validStopTime) {
    alertDialog('Indica horas válidas de apertura y cierre.');
    return;
  }
  if (!rd.estimatedFinishTimeUtc) {
    alertDialog('La jornada necesita una hora estimada de meta para programar la ventana.');
    return;
  }
  const dateKey = madridDateKey(rd.estimatedFinishTimeUtc) || rd.dateKey;
  const startAt = validStartTime ? madridTimeToTimestamp(dateKey, startTime) : null;
  const stopAt = validStopTime ? madridTimeToTimestamp(dateKey, stopTime) : null;
  const finishMs = new Date(rd.estimatedFinishTimeUtc).getTime();
  const startMs = startAt ? new Date(startAt).getTime() : NaN;
  let stopMs = stopAt ? new Date(stopAt).getTime() : NaN;
  if (stopMs <= startMs) stopMs += 24 * 60 * 60 * 1000;
  if (stopMs < finishMs) {
    alertDialog('El cierre debe ser posterior a la apertura y a la hora estimada de meta.');
    return;
  }
  btn.disabled = true;
  const patch = {
    "resultsSyncStartAt": startAt,
    "resultsSyncStopAt": stopAt ? new Date(stopMs).toISOString() : null,
    "resultsSyncStartOffsetMinutes": null,
    "resultsSyncIntervalMinutes": null,
    "resultsSyncStopOffsetMinutes": null,
  };
  try {
    let error;
    let savedDay = null;
    if (scope === 'day') {
      ({ data: savedDay, error } = await supabase.from('race_days')
        .update(patch)
        .eq('id', rd.id)
        .select(RESULT_SYNC_DAY_STATE_SELECT)
        .single());
    } else {
      ({ error } = await supabase.from('race_uci_links').update({
        syncStartTime: validStartTime ? `${startTime}:00` : null,
        syncStopTime: validStopTime ? `${stopTime}:00` : null,
        updatedAt: new Date().toISOString(),
      }).eq('raceId', rd.raceId).select('raceId').single());
      if (!error) {
        ({ data: savedDay, error } = await supabase.from('race_days').update({
          resultsSyncStartAt: null,
          resultsSyncStopAt: null,
          resultsSyncStartOffsetMinutes: null,
          resultsSyncIntervalMinutes: null,
          resultsSyncStopOffsetMinutes: null,
        }).eq('id', rd.id).select(RESULT_SYNC_DAY_STATE_SELECT).single());
      }
    }
    if (error) throw error;
    applyPersistedResultSyncDayState(rd, savedDay);
    showToast(scope === 'day' ? 'Excepción de jornada guardada.' : 'Ventana de carrera guardada.', 'success');
    setupUciResultsSection(rd, race);
  } catch (err) {
    alertDialog(`No se pudo guardar la programación: ${err.message || err}`, { title: 'Error' });
    btn.disabled = false;
  }
}

function _ruRenderSection(body, rd, race, link, stages, raceDays) {
  rd._stageSuffix = sectorSuffixMap(raceDays).suffixByDayId.get(rd.id) || '';
  // El fallback por número solo es válido si identifica una única jornada.
  const mine = stages.filter(s => resultClassificationBelongsToDay(s, rd, raceDays));
  // Las FINALES (pseudo-etapa "Final Classification", stageNumber NULL, sin jornada
  // propia) se muestran en la última etapa — y en carreras de un día (su "gc" sin
  // raceDayId es la clasificación de la prueba).
  const maxStage = stages.reduce((m, s) =>
    (s.stageNumber != null && (m == null || s.stageNumber > m)) ? s.stageNumber : m, null);
  const isLastDay = race?.raceFormat === 'one_day'
    || (rd.stageNumber != null && maxStage != null && rd.stageNumber >= maxStage)
    || stages.some(s => s.isFinalClassification && s.stageDate && s.stageDate === rd.dateKey);
  let finals = isLastDay ? stages.filter(s => s.raceDayId == null && s.stageNumber == null) : [];

  // En la última jornada de una vuelta, las clasificaciones acumuladas de la etapa
  // y sus pseudo-finales son dos cabeceras de datos, pero una sola unidad editable.
  const finalStageDay = isFinalStageRaceDay(rd, race, raceDays);
  const paired = pairFinalClassifications(mine, finals, finalStageDay);
  const visibleMine = paired.mine;
  finals = paired.finals;

  const ord = (s) => { const i = UCI_CLASS_ORDER.indexOf(s.classKind); return i === -1 ? 99 : i; };
  visibleMine.sort((a, b) => ord(a) - ord(b));
  finals.sort((a, b) => ord(a) - ord(b));

  // `updatedAt` vive en cada clasificación: no usar `link.lastSyncedAt`, que
  // pertenece a la carrera completa y puede corresponder a otra etapa.
  let html = _ruOriginHtml(rd, race, link, [...visibleMine, ...finals]);
  html += `<div id="ruDetectPanel" class="u-mt-050 u-fs-2" style="display:none"></div>`;
  html += _ruSyncPolicyHtml(rd, race, link);

  // Las clasificaciones ya volcadas se muestran SIEMPRE (aunque la carrera se haya
  // desenlazado después: sin link el cron no refresca, pero los datos siguen ahí).
  if (link && !visibleMine.length && !finals.length) html += `<div class="ru-empty">Aún no hay clasificaciones volcadas para esta jornada.</div>`;
  if (visibleMine.length) html += `<div class="ru-class-list">${visibleMine.map(_ruClassRowHtml).join('')}</div>`;
  if (finals.length) {
    // En carreras de un día (p. ej. los Campeonatos Nacionales, una ficha por prueba) la
    // clasificación llega como 'gc'/final sin raceDayId → cae aquí; "finales de la carrera"
    // sería impreciso (es la ÚNICA clasificación). Título contextual.
    const finalsTitle = race?.raceFormat === 'one_day'
      ? (finals.length === 1 ? 'Clasificación de la prueba' : 'Clasificaciones de la prueba')
      : 'Clasificaciones finales de la carrera';
    html += `<div class="ru-group-title">${finalsTitle}</div>
      <div class="ru-class-list">${finals.map(_ruClassRowHtml).join('')}</div>`;
  }

  // Crear una clasificación A MANO (pruebas sin fuente automática, o un tipo que el
  // cron no trajo). La fila se inserta SIN bloquear → placeholder que la fuente
  // oficial PISA si llega (mismo modelo que el volcado PDF). Ver _ruCreateClass.
  html += `<div class="u-row u-mt-070 u-gap-050 u-wrap">
    <button type="button" class="btn btn--ghost ru-new u-fs-1 u-py-030 u-px-070"
      title="Crea una clasificación vacía para teclear sus resultados a mano. Se crea como placeholder: si luego la UCI/PDF publica esa misma clasificación, su volcado la sustituye.">＋ Nueva clasificación</button>
  </div>`;

  body.innerHTML = html;

  // Cableado por render (el DOM se recrea en cada apertura).
  const visibleStages = [...visibleMine, ...finals];
  const stById = new Map(visibleStages.map(s => [s.id, s]));
  body.querySelectorAll('.ru-new').forEach(b => b.addEventListener('click', () => _ruNewClass(rd, race, stages, finalStageDay, raceDays)));
  body.querySelectorAll('.ru-manual-link').forEach(b => b.addEventListener('click', () => _ruOpenManualLink(rd, race)));
  body.querySelectorAll('.ru-sync-save').forEach(b => b.addEventListener('click', () => _ruSaveSyncPolicy(b, rd, race)));
  body.querySelectorAll('.ru-unlink').forEach(b => b.addEventListener('click', () => _ruUnlinkFromDay(rd, race)));
  body.querySelectorAll('.ru-run-cron').forEach(b => b.addEventListener('click', () => _runResultsSyncNow(b, rd.raceId)));
  body.querySelectorAll('.ru-run-cron-stage').forEach(b => b.addEventListener('click', () => _runResultsSyncNow(b, rd.raceId, rd.stageNumber)));
  body.querySelectorAll('.ru-lock-toggle').forEach(b => b.addEventListener('change', () => {
    const s = stById.get(b.dataset.id);
    if (s) _ruToggleLock(s, rd, race, b);
  }));
  body.querySelectorAll('.ru-official-toggle').forEach(b => b.addEventListener('change', () => {
    const s = stById.get(b.dataset.id);
    if (s) _ruToggleOfficial(s, rd, race, b);
  }));
  body.querySelectorAll('.ru-edit').forEach(b => b.addEventListener('click', () => {
    const s = stById.get(b.dataset.id);
    if (s) openUciClassEditor(s, rd, race);
  }));
  body.querySelectorAll('.ru-delete').forEach(b => b.addEventListener('click', () => {
    const s = stById.get(b.dataset.id);
    if (s) _ruDeleteClass(s, rd, race);
  }));
}

// Enlace manual: DataRide no ofrece una búsqueda usable desde el navegador del panel,
// así que se abre en otra pestaña y se guarda aquí el ID comprobado por la persona.
function _ruOpenManualLink(rd, race) {
  const panel = document.getElementById('ruDetectPanel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `<div class="u-row u-gap-050 u-items-center u-wrap">
    <input type="number" id="ruManualComp" placeholder="competitionId" min="1" class="u-w-950">
    <input type="number" id="ruManualUciRaceId" placeholder="uciRaceId (CN, opc.)" min="1" class="u-w-1100"
      title="Solo para Campeonatos Nacionales: race.Id de DataRide de la prueba dentro de la competición. Vacío = competición entera.">
    <button type="button" class="btn btn--primary ru-manual-save u-fs-1 u-py-0 u-px-060">Guardar enlace</button>
  </div>`;
  panel.querySelector('.ru-manual-save').addEventListener('click', () => {
    const comp = parseInt(document.getElementById('ruManualComp').value, 10);
    if (!comp) { alertDialog('Introduce un competitionId numérico.', { title: 'Falta el ID' }); return; }
    const event = parseInt(document.getElementById('ruManualUciRaceId').value, 10) || 0;
    _ruSaveLink(rd, race, comp, event);
  });
}

// Guarda el enlace carrera↔competición desde la pestaña de jornada (núcleo
// compartido _writeUciLink, mismo manejo de conflicto que el editor de carrera).
// uciRaceId (CN, migración 110): 0 = competición entera; != 0 = una prueba concreta.
async function _ruSaveLink(rd, race, competitionId, uciRaceId = 0) {
  if (!competitionId) return;
  const seasonId = (race?.year && _UCI_SEASON[race.year]) || null;
  let res;
  try {
    res = await _writeUciLink(rd.raceId, competitionId, seasonId, uciRaceId);
  } catch (err) {
    alertDialog(`Error al guardar el enlace: ${err.message || err}`, { title: 'Error' });
    return;
  }
  if (!res.ok && res.conflict) {
    const owner = res.ownerName ? ` Ya la usa: ${res.ownerName}.` : '';
    const what = uciRaceId ? `La prueba ${uciRaceId} de la competición UCI #${competitionId}` : `La competición UCI #${competitionId}`;
    alertDialog(`${what} ya está enlazada a otra carrera.${owner} Desenlázala allí primero, o enlaza una distinta.`,
      { title: 'Ya en uso' });
    return;
  }
  // El "lo volcará el cron" solo es cierto si la fuente quedó automática; con una de
  // cronometrador (que _writeUciLink NO pisa) el volcado sigue siendo el suyo.
  const what = uciRaceId ? `Enlazada a la prueba ${uciRaceId} de #${competitionId}` : `Enlazada a la competición UCI #${competitionId}`;
  showToast(res.sourceSetToUci
    ? `${what} — el cron volcará los resultados en su próxima pasada.`
    : `${what}. Ojo: la fuente sigue siendo ${UCI_SOURCE_LABELS[res.source] || res.source} — el enlace no cambia de dónde salen los datos.`,
    'success');
  setupUciResultsSection(rd, race);
}

async function _ruUnlinkFromDay(rd, race) {
  if (!await confirmDialog('¿Quitar el enlace UCI de esta carrera? No borra resultados ya importados, pero el cron dejará de refrescarlos.', { danger: true })) return;
  try {
    await _deleteUciLink(rd.raceId);
    showToast('Enlace UCI eliminado.', 'success');
    setupUciResultsSection(rd, race);
  } catch (err) {
    alertDialog(`Error al desenlazar: ${err.message || err}`, { title: 'Error' });
  }
}

// Candado de la lista (interruptor): bloquear sin editar / desbloquear (volver a
// dejar mandar al cron). El checkbox se repone si el usuario cancela o falla el guardado.
async function _ruToggleLock(st, rd, race, checkbox) {
  const ids = [st.id, st._finalTwinId].filter(Boolean);
  const locked = st._finalTwinId
    ? !!st.lockedAt && !!st._finalTwinLockedAt
    : !!st.lockedAt;
  const msg = locked
    ? '¿Desbloquear esta clasificación? El próximo volcado del cron la sobreescribirá con los datos de la UCI (se perderán las correcciones manuales).'
    : '¿Bloquear esta clasificación sin editarla? El cron dejará de actualizarla con los datos de la UCI.';
  if (!await confirmDialog(msg, locked ? { danger: true } : {})) {
    if (checkbox) checkbox.checked = locked;
    return;
  }
  const { error } = await supabase.from('race_uci_stages')
    .update({ lockedAt: locked ? null : new Date().toISOString() }).in('id', ids);
  if (error) {
    showToast('Error: ' + error.message);
    if (checkbox) checkbox.checked = locked;
    return;
  }
  showToast(locked ? 'Clasificación desbloqueada — el cron vuelve a sincronizarla.' : 'Clasificación bloqueada — el cron no la sobreescribirá.', 'success');
  setupUciResultsSection(rd, race);
}

// Interruptor de oficialidad: marca o retira el estado oficial de la clasificación
// (y de su pseudo-final emparejada). El ancla officialAt impide que el contrato de
// publicación degrade a provisional una oficialización manual; retirarlo devuelve
// el mando al criterio automático de la fuente. El interruptor refleja siempre
// publicationStatus: las clasificaciones que la fuente ya declaró oficiales se
// muestran activadas aunque nadie las haya tocado a mano.
async function _ruToggleOfficial(st, rd, race, checkbox) {
  const ids = [st.id, st._finalTwinId].filter(Boolean);
  const { official } = resultClassificationOfficialState(st);
  if (official && !await confirmDialog('¿Retirar el oficial de esta clasificación? Volverá a «Provisional» hasta que la fuente la publique de nuevo como oficial.', { danger: true })) {
    if (checkbox) checkbox.checked = true;
    return;
  }
  const patch = official
    ? { officialAt: null, publicationStatus: 'provisional' }
    : { officialAt: new Date().toISOString(), publicationStatus: 'official' };
  const { error } = await supabase.from('race_uci_stages')
    .update(patch).in('id', ids).eq('raceId', rd.raceId);
  if (error) {
    showToast('Error: ' + error.message);
    if (checkbox) checkbox.checked = official;
    return;
  }
  showToast(official
    ? 'Oficial retirado — la clasificación vuelve a provisional.'
    : 'Clasificación oficial — el cron no la degradará a provisional.', 'success');
  setupUciResultsSection(rd, race);
}

// Borra la cabecera y, por ON DELETE CASCADE, las filas de esta clasificación.
// El filtro por carrera evita actuar sobre un id ajeno si se cambió de jornada.
async function _ruDeleteClass(st, rd, race) {
  const label = _ruClassLabel(st);
  const count = st.rowCount || 0;
  const rows = count === 1 ? '1 fila de resultado' : `${count} filas de resultados`;
  const pairedNote = st._finalTwinId
    ? ' Se eliminarán tanto la cabecera de la etapa como su pseudo-final.'
    : '';
  const message = `¿Eliminar la clasificación «${label}»? Se borrarán también sus ${rows}.${pairedNote}\n\nSi la fuente automática vuelve a publicarla, el cron podrá crearla de nuevo.`;
  if (!await confirmDialog(message, {
    danger: true,
    title: 'Eliminar clasificación',
    confirmText: 'Eliminar',
  })) return;

  const ids = [st.id, st._finalTwinId].filter(Boolean);
  const { error } = await supabase.from('race_uci_stages')
    .delete().in('id', ids).eq('raceId', rd.raceId);
  if (error) {
    showToast('Error al eliminar la clasificación: ' + error.message);
    return;
  }
  showToast(`Clasificación «${label}» eliminada.`, 'success');
  setupUciResultsSection(rd, race);
}

// Encola una pasada dirigida desde la pestaña Resultados de una jornada. La RPC
// escribe en una cola privada y el timer del VPS la reclama en menos de un minuto.
// stageNumber puede ser 0 (prólogo), por lo que se comprueba con != null.
async function _runResultsSyncNow(btn, raceId = null, stageNumber = null) {
  const oneStage = raceId && stageNumber != null;
  if (!raceId) {
    const ok = await confirmDialog(
      '¿Encolar ahora una pasada global de resultados? Procesará las carreras con etapa hoy sin esperar la ventana de meta.'
    );
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    const { error } = oneStage
      ? await supabase.rpc('admin_trigger_results_sync', { p_race_id: raceId, p_stage: stageNumber })
      : raceId
      ? await supabase.rpc('admin_trigger_results_sync', { p_race_id: raceId })
      : await supabase.rpc('admin_trigger_results_sync');
    if (error) throw error;
    showToast('Pasada encolada en el VPS — comenzará en menos de 1 min', 'success', 6000);
  } catch (err) {
    showToast('No se pudo encolar la pasada: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
  }
}
