// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Monitor de automatizaciones del VPS
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { confirmDialog } from '../components/dialog.js';
import {
  operationSourceCatalog, operationRunStatus, selectOperationHistory,
  shortOperationRevision,
} from '../services/operations-monitor.js?v=20260912cxruntime';
import { showToast } from './helpers.js';

// ── Monitor de automatizaciones del VPS ─────────────────────────
let _operationsReady = false;
let _operationsRefreshTimer = null;
let _operationsRefreshVersion = 0;
let _operationsQueues = {};
const _operationsForcing = new Set();

const _OPERATIONS_JOBS = [
  { id: 'results', label: 'Resultados', cadence: 'Cada minuto', force: true },
  { id: 'cx_results', label: 'Resultados CX', cadence: 'Cada minuto · mangas con ventana verificada', force: true },
  { id: 'broadcasts', label: 'Emisiones', cadence: 'Cada 30 minutos', force: true },
  { id: 'uci_team_ranking', label: 'Ranking UCI', cadence: 'Lunes, martes y control del miércoles', force: false },
  { id: 'uci_catalog', label: 'Catálogo UCI', cadence: 'Cada día · 07:25', force: false },
];

const _OPERATIONS_SOURCES = [
  { id: 'dataride_cx', label: 'DataRide CX', job: 'cx_results' },
  { id: 'cx_standings', label: 'Generales CX', job: 'cx_results' },
  { id: 'cx_push', label: 'Avisos CX', job: 'cx_results' },
  { id: 'hbo_max', label: 'HBO Max' },
  { id: 'rtve', label: 'RTVE' },
  { id: 'eitb', label: 'EITB' },
  { id: 'sporza', label: 'Sporza' },
  { id: 'rtbf', label: 'RTBF' },
  { id: 'rai', label: 'RAI' },
  { id: 'lequipe', label: "L'Équipe" },
];

const _OPERATIONS_ACTION_LABELS = {
  source_failure: ['error al consultar la fuente', 'errores al consultar la fuente'],
  unmatched: ['evento sin carrera asociada', 'eventos sin carrera asociada'],
  ambiguous: ['asociación ambigua', 'asociaciones ambiguas'],
  manual_conflict: ['conflicto con una emisión manual', 'conflictos con emisiones manuales'],
  optimistic_conflict: ['cambio concurrente', 'cambios concurrentes'],
  implausible_change: ['cambio horario no plausible', 'cambios horarios no plausibles'],
  insufficient_broadcast_evidence: [
    'evento deportivo sin hora y canal de emisión verificables',
    'eventos deportivos sin hora y canal de emisión verificables',
  ],
  pending_stability: ['dato pendiente de una segunda confirmación', 'datos pendientes de una segunda confirmación'],
  manual_lock: ['emisión protegida por bloqueo manual', 'emisiones protegidas por bloqueo manual'],
};

function _operationsActionLabel(action, count) {
  const labels = _OPERATIONS_ACTION_LABELS[action] || [action, action];
  return labels[count === 1 ? 0 : 1];
}

function _operationsSafeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function _operationsSourceIssues(item, sourceId) {
  if(sourceId==='dataride_cx'||sourceId==='cx_standings'){
    const issues=sourceId==='dataride_cx'?[
      ...(item?.summary?.decisions||[]).map(issue=>`${issue.category}: ${issue.reason}`),
      ...(item?.summary?.results||[]).flatMap(result=>[
        ...[...(result.reviews||[]),...(result.skipped||[]),...(result.warnings||[])].map(issue=>`${issue.category||''}: ${issue.reason}`),
        ...(result.error?[result.error]:[])
      ])
    ]:(item?.summary?.categories||[]).flatMap(result=>[result.reviewReason,result.error,...(result.issues||[]).map(issue=>typeof issue==='string'?issue:issue.message||issue.code||JSON.stringify(issue))].filter(Boolean));
    return issues.length?`<details class="operations-source__details"><summary>Revisiones CX (${issues.length})</summary><ul class="operations-source__issue-list">${issues.slice(0,50).map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul></details>`:'';
  }
  const actions = item?.summary?.actions || {};
  const actionEntries = Object.entries(actions)
    .filter(([action, count]) => _OPERATIONS_ACTION_LABELS[action] && Number(count) > 0)
  const counts = actionEntries.map(([action, count]) => `${Number(count)} ${_operationsActionLabel(action, Number(count))}`);
  const issueCount = actionEntries.reduce((total, [, count]) => total + Number(count), 0);
  const details = Array.isArray(item?.summary?.issues) ? item.summary.issues : [];
  if (!counts.length && !details.length) {
    if (sourceId !== 'sporza' || Number(item?.itemsFound || 0) > 0) return '';
    return `<div class="operations-source__note">Sin emisiones confirmadas. Sporza solo se incorpora cuando la página editorial publica hora y canal; el horario deportivo no se usa como horario de TV.</div>`;
  }
  const detailCount = issueCount > details.length ? `${details.length} de ${issueCount}` : String(details.length);
  const detailHtml = details.length ? `<details class="operations-source__details"><summary>Ver detalles registrados (${detailCount})</summary><ul class="operations-source__issue-list">${details.map((issue) => {
    const label = _operationsActionLabel(issue.action, 1);
    const subject = [issue.title, issue.dateKey].filter(Boolean).map(esc).join(' · ') || 'Fuente completa';
    const url = _operationsSafeUrl(issue.sourceUrl);
    return `<li><span>${subject}: ${esc(label)}${issue.detail ? ` — ${esc(issue.detail)}` : ''}</span>${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">Abrir fuente ↗</a>` : ''}</li>`;
  }).join('')}</ul></details>` : '';
  return `<div class="operations-source__issues"><strong>${counts.map(esc).join(' · ')}</strong>${detailHtml}</div>`;
}

function _operationsDate(value) {
  if (!value) return 'Sin ejecuciones';
  return new Date(value).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}

function _operationsDuration(run) {
  if (!run?.startedAt) return '—';
  const end = run.finishedAt ? new Date(run.finishedAt) : new Date();
  const seconds = Math.max(0, Math.round((end - new Date(run.startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function _operationsStatusLabel(status) {
  return ({
    running: 'En curso', success: 'Correcto', noop: 'Sin cambios', partial: 'Parcial', error: 'Error',
    warning: 'Aviso', pending: 'En cola', done: 'Completado', stale: 'Sin actualizar',
  })[status] || 'Sin datos';
}

function _operationsRenderJobs(payload) {
  const runs = payload.runs || [];
  const queues = payload.queues || {};
  _operationsQueues = queues;
  document.getElementById('operationsJobs').innerHTML = _OPERATIONS_JOBS.map((job) => {
    const run = runs.find((item) => item.job === job.id);
    const queue = queues[job.id] || {};
    const queued = Number(queue.pending || 0) + Number(queue.running || 0) > 0;
    const processing = _operationsForcing.has(job.id);
    const forced = queued || processing;
    const catalog = job.id === 'uci_catalog' ? payload.uciCatalog : null;
    const status = operationRunStatus(job.id, run, catalog);
    const catalogInfo = catalog ? _operationsCatalogInfo(catalog) : '';
    const error = run?.errorMessage
      ? `<div class="operations-card__error">${esc(run.errorMessage)}</div>` : '';
    const control = job.force ? `
      <button type="button" class="btn btn--ghost operations-force" data-job="${job.id}"
        ${forced ? 'disabled' : ''}>
        ${processing ? 'Procesando…' : queued ? 'Pasada en cola' : 'Forzar próxima pasada'}
      </button>` : '';
    return `<article class="operations-card">
      <div class="operations-card__head">
        <div><div class="operations-card__title">${job.label}</div><div class="operations-card__cadence">${job.cadence}</div></div>
        <span class="operations-status operations-status--${status}"><i></i>${_operationsStatusLabel(status)}</span>
      </div>
      <div class="operations-card__time">${_operationsDate(run?.startedAt)}</div>
      <div class="operations-card__meta">Duración: ${_operationsDuration(run)}${run?.revision ? ` · versión ${esc(shortOperationRevision(run.revision))}` : ''}</div>
      ${catalogInfo}${error}${control}
    </article>`;
  }).join('');

  document.querySelectorAll('.operations-force').forEach((button) => {
    button.addEventListener('click', () => _operationsForce(button.dataset.job, button));
  });
}

function _operationsCatalogInfo(catalog) {
  const openCases = Number(catalog.openCases || 0);
  const lockedCases = Number(catalog.lockedCases || 0);
  const breakdown = catalog.caseBreakdown || {};
  const rows = [
    ['Biografías con discrepancias', breakdown.biographyReview],
    ['Equipos por asociar', breakdown.teamsToReview],
    ['Corredores dependientes de esos equipos', breakdown.ridersWaitingForTeam],
    ['Identidades sin resolver', breakdown.sourceIdentityConflict],
    ['Corredores con varios equipos regulares', breakdown.multipleRegularTeams],
    ['Otras revisiones', breakdown.otherOpen],
  ].filter(([, count]) => Number(count || 0) > 0);
  const detailRows = rows.length
    ? `<dl class="operations-catalog__breakdown">${rows.map(([label, count]) => `<div><dt>${esc(label)}</dt><dd>${Number(count)}</dd></div>`).join('')}</dl>`
    : '';
  const resolved = Number(breakdown.resolved || 0);
  return `<div class="operations-catalog">
    <p>Compara a diario el catálogo oficial de la UCI con las fichas, equipos y afiliaciones. Solo aplica correcciones automáticas seguras.</p>
    <div class="operations-catalog__mode">${catalog.enabled ? 'Correcciones automáticas seguras activadas' : 'Solo observación'}${lockedCases ? ` · ${lockedCases} bloqueos manuales` : ''}${catalog.overdue ? ' · Sin captura válida en 36 horas' : ''}</div>
    <details class="operations-catalog__details">
      <summary>${openCases} incidencias pendientes de revisión</summary>
      <p>No son errores publicados: son diferencias retenidas para evitar cambios sin evidencia suficiente.</p>
      ${detailRows}
      ${resolved ? `<div class="operations-catalog__resolved">${resolved} incidencias resueltas</div>` : ''}
    </details>
  </div>`;
}

function _operationsRenderSources(payload) {
  const sources = payload.sources || [];
  const sourceCatalog = operationSourceCatalog(_OPERATIONS_SOURCES, sources);
  document.getElementById('operationsSources').innerHTML = sourceCatalog.map((source) => {
    const item = sources.find((row) => row.source === source.id);
    const job = source.job || item?.job || (source.id==='dataride'?'results':'broadcasts');
    const run = (payload.runs || []).find((row) => row.job === job);
    const status = operationRunStatus(job,run) === 'stale' ? 'stale' : (item?.status || 'unknown');
    return `<article class="operations-source">
      <div class="operations-source__head"><strong>${esc(source.label)}</strong><span class="operations-status operations-status--${status}"><i></i>${_operationsStatusLabel(status)}</span></div>
      <div class="operations-source__numbers">
        <span><b>${item?.itemsFound ?? 0}</b> encontrados</span>
        <span><b>${item?.itemsMatched ?? 0}</b> ${source.id==='dataride_cx'?'importables':source.id==='cx_standings'?'publicadas':source.id==='cx_push'?'programados':'asociados'}</span>
        <span><b>${item?.itemsChanged ?? 0}</b> cambios</span>
        <span><b>${item?.errors ?? 0}</b> errores</span>
      </div>
      ${_operationsSourceIssues(item, source.id)}
      <div class="operations-source__time">${_operationsDate(item?.startedAt)}</div>
    </article>`;
  }).join('');
}

function _operationsRenderHistory(payload) {
  const runs = selectOperationHistory(payload.runs || []);
  const host = document.getElementById('operationsHistory');
  if (!runs.length) {
    host.innerHTML = '<div class="u-empty-note">Todavía no hay ejecuciones registradas.</div>';
    return;
  }
  const labels = Object.fromEntries(_OPERATIONS_JOBS.map((job) => [job.id, job.label]));
  host.innerHTML = `<table class="operations-table">
    <caption class="sr-only">Últimas ejecuciones por trabajo</caption>
    <thead><tr><th>Inicio</th><th>Trabajo</th><th>Origen</th><th>Estado</th><th>Duración</th></tr></thead>
    <tbody>${runs.map((run) => `<tr>
      <td>${_operationsDate(run.startedAt)}</td>
      <td>${esc(labels[run.job] || run.job)}</td>
      <td>${run.triggerKind === 'scheduled' ? 'Automático' : run.triggerKind === 'manual' ? 'Panel' : 'Automático + panel'}</td>
      <td><span class="operations-status operations-status--${run.status}"><i></i>${_operationsStatusLabel(run.status)}</span></td>
      <td>${_operationsDuration(run)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function refreshOperationsMonitor() {
  const version = ++_operationsRefreshVersion;
  const refresh = document.getElementById('operationsRefreshBtn');
  refresh.disabled = true;
  try {
    const { data, error } = await supabase.rpc('admin_get_automation_monitor');
    if (version !== _operationsRefreshVersion) return;
    if (error) throw error;
    _operationsRenderJobs(data || {});
    _operationsRenderSources(data || {});
    _operationsRenderHistory(data || {});
    document.getElementById('operationsUpdated').textContent = `Actualizado: ${_operationsDate(data?.generatedAt)}`;
  } catch (error) {
    if (version !== _operationsRefreshVersion) return;
    document.getElementById('operationsUpdated').textContent = 'No se pudo leer el estado operativo';
    document.getElementById('operationsJobs').innerHTML = `<div class="u-empty-note">${esc(error.message || error)}</div>`;
    document.getElementById('operationsSources').innerHTML = '<div class="u-empty-note">Datos no actualizados.</div>';
    document.getElementById('operationsHistory').innerHTML = '<div class="u-empty-note">Datos no actualizados.</div>';
  } finally {
    if (version === _operationsRefreshVersion) refresh.disabled = false;
  }
}

function _operationsUpdateForceButtons() {
  document.querySelectorAll('.operations-force').forEach(button => {
    const job = button.dataset.job;
    const queue = _operationsQueues[job] || {};
    const queued = Number(queue.pending || 0) + Number(queue.running || 0) > 0;
    const processing = _operationsForcing.has(job);
    button.disabled = queued || processing;
    button.textContent = processing ? 'Procesando…' : queued ? 'Pasada en cola' : 'Forzar próxima pasada';
  });
}

async function _operationsForce(job, button) {
  if (button.disabled || _operationsForcing.has(job) || !_OPERATIONS_JOBS.some(item => item.id === job && item.force)) return;
  _operationsForcing.add(job);
  _operationsUpdateForceButtons();
  const label = job === 'cx_results' ? 'resultados CX' : job === 'results' ? 'resultados' : 'emisiones';
  try {
    const ok = await confirmDialog(job==='cx_results'?'¿Consultar las mangas CX de hoy en Madrid con recogida activada? Se conservarán los resultados protegidos.':`¿Encolar una pasada completa de ${label} en el VPS?`);
    if (!ok) return;
    const rpc = job === 'cx_results' ? 'cx_enqueue_results_fetch' : job === 'results' ? 'admin_trigger_results_sync' : 'admin_trigger_broadcasts_sync';
    const { error } = await supabase.rpc(rpc);
    if (error) throw error;
    showToast(`Pasada de ${label} encolada`, 'success', 4000);
    await refreshOperationsMonitor();
  } catch (error) {
    showToast(`No se pudo encolar la pasada: ${error.message || error}`, 'error');
  } finally {
    _operationsForcing.delete(job);
    _operationsUpdateForceButtons();
  }
}

export function setupOperationsView() {
  if (!_operationsReady) {
    _operationsReady = true;
    document.getElementById('operationsRefreshBtn').addEventListener('click', refreshOperationsMonitor);
    _operationsRefreshTimer = window.setInterval(() => {
      if (document.getElementById('operationsView').style.display !== 'none') refreshOperationsMonitor();
    }, 30_000);
  }
  refreshOperationsMonitor();
}
