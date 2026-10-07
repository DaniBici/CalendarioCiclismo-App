// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Enlace UCI de carreras (race_uci_links)
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { confirmDialog, alertDialog } from '../components/dialog.js';
import { UCI_PANEL_OWNED_SOURCES } from './results.js';

// ── Enlace UCI (race_uci_links) — Fase 4b del plan de resultados ──────────────
// El enlace carrera↔competitionId UCI lo decide el matcher offline
// (scripts/results-fetchers/uci-match-poc.mjs), que para cada carrera deja en
// su match-report.json el candidato único (.match), los candidatos ambiguos
// (.candidates) y, en colisiones masc/fem, la carrera rival (.collision.rivals).
// El panel NO re-corre el matcher (la API UCI es CORS-only desde el navegador):
// lee ese reporte estático, muestra el/los candidato(s) para que Dani elija a
// mano, y al confirmar escribe en race_uci_links (autoMatched=false).
//
// DE DÓNDE SALE EL REPORT (cambiado 2026-07-19): del bucket PRIVADO
// `uci-reports` de Storage (migración 133), que escriben los crons
// uci-link-discover.yml / uci-link-evening.yml. ANTES se leía con una ruta
// relativa al fichero commiteado en el repo — pero build-site.yml excluye
// `scripts/` del rsync a _site, así que en producción daba 404 y esta sección
// estaba ROTA (regresión silenciosa de la migración a Pages-por-artifact).
// El bucket es privado a propósito: solo lo lee el panel, que va autenticado.

const UCI_REPORT_BUCKET = 'uci-reports';
// Año del report a cargar. MANTENIMIENTO ANUAL: subirlo cuando la UCI abra la
// temporada nueva (espejo del ROAD_SEASON de los scripts del matcher).
const UCI_REPORT_YEAR   = 2026;
const UCI_REPORT_OBJECT = `match-${UCI_REPORT_YEAR}.json`;

let _uciReportPromise = null;   // cache de la promesa de carga (se carga una vez)
let _uciReportIndex   = null;   // Map raceId → rec del reporte

// Carga el match-report una vez y lo indexa por raceId (our.id).
function _loadUciReport() {
  if (_uciReportPromise) return _uciReportPromise;
  _uciReportPromise = supabase.storage.from(UCI_REPORT_BUCKET).download(UCI_REPORT_OBJECT)
    .then(async ({ data, error }) => {
      if (error) throw new Error(error.message || 'descarga fallida');
      if (!data) throw new Error('respuesta vacía');
      return JSON.parse(await data.text());
    })
    .then(report => {
      _uciReportIndex = new Map();
      const tag = (arr, bucket) => (arr || []).forEach(rec => {
        if (rec.our && rec.our.id) _uciReportIndex.set(rec.our.id, { ...rec, bucket });
      });
      tag(report.unique, 'unique');
      tag(report.ambiguous, 'ambiguous');
      tag(report.none, 'none');
      return { report, index: _uciReportIndex };
    })
    .catch(err => { _uciReportPromise = null; throw err; }); // permite reintentar
  return _uciReportPromise;
}

// Carga el enlace actual (race_uci_links) y rellena el input al abrir el editor.
export async function _loadUciLink(raceId) {
  if (!raceId) return;
  const input = document.getElementById('er-uciCompetitionId');
  try {
    const { data, error } = await supabase
      .from('race_uci_links')
      .select('competitionId, autoMatched, syncStatus')
      .eq('raceId', raceId)
      .maybeSingle();
    if (error) throw error;
    // Guard: el editor pudo cambiar de carrera mientras llegaba la respuesta.
    if (document.getElementById('er-id')?.value !== raceId) return;
    if (data && input) {
      input.value = data.competitionId;
      input.dataset.uciLinked = '1';
      input.dataset.uciAuto = data.autoMatched ? '1' : '0';
    } else if (input) {
      delete input.dataset.uciLinked;
      delete input.dataset.uciAuto;
    }
  } catch { /* silencioso: el campo queda editable a mano igualmente */ }
}

export const _UCI_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

// Abre el enlace manual bajo el campo. La búsqueda se hace directamente en
// DataRide; se eliminó el matcher automático por su baja fiabilidad.
export async function openUciLinkPanel() {
  const raceId = document.getElementById('er-id').value;
  const panel  = document.getElementById('er-uciPanel');
  if (!raceId || !panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `<div class="u-row u-gap-050 u-items-center u-wrap">
    <a class="btn btn--ghost u-fs-1 u-py-0 u-px-060" href="https://dataride.uci.ch/iframe/Results/10/" target="_blank" rel="noopener">Últimos resultados de DataRide ↗</a>
    <button type="button" class="btn btn--primary u-uci-save-manual u-fs-1 u-py-0 u-px-060">Guardar el ID del campo</button>
  </div>`;
  _wireUciPanel(raceId);
  return;

  let rec = null;
  try {
    const { index } = await _loadUciReport();
    rec = index.get(raceId) || null;
  } catch (err) {
    panel.innerHTML = `<span class="u-c-danger">No se pudo cargar el reporte de matching (${esc(err.message)}).</span>`
      + '<div class="u-c-muted u-mt-030">Puedes introducir el <strong>competitionId</strong> a mano y pulsar Guardar abajo.</div>'
      + _uciManualSaveRow(raceId);
    _wireUciPanel(raceId);
    return;
  }
  panel.innerHTML = _renderUciPanel(raceId, rec);
  _wireUciPanel(raceId);
}

// HTML de una fila/candidato (botón Enlazar + metadatos). uciRaceId (CN) opcional: si viene,
// el enlace es a una PRUEBA dentro del campeonato y el botón lo arrastra en data-uciraceid.
function _uciCandidateRow(raceId, c, { recommended = false } = {}) {
  const cls = c.uciClass != null ? esc(String(c.uciClass)) : '—';
  const sim = c.nameSim != null ? `sim ${c.nameSim}` : '';
  const tick = c.classMatch ? '<span class="u-c-done" title="clase coincide">✓ clase</span>' : '<span class="u-c-muted">≠ clase</span>';
  const isEvent = c.uciRaceId != null && c.uciRaceId !== 0;
  const label = isEvent ? `Enlazar prueba #${c.competitionId}` : `Enlazar #${c.competitionId}`;
  const evMeta = isEvent ? ` · <span title="race.Id de DataRide de la prueba">prueba ${esc(String(c.uciRaceId))}</span>` : '';
  return `
    <div class="u-row uci-candidate">
      <button type="button" class="btn btn--ghost u-uci-pick u-fs-1 u-py-0 u-px-055 u-nowrap" data-comp="${c.competitionId}"${isEvent ? ` data-uciraceid="${esc(String(c.uciRaceId))}"` : ''}>${esc(label)}</button>
      <div class="u-grow u-lh-135">
        <div><strong>${esc(c.uciName || '(sin nombre)')}</strong>${recommended ? ' <span class="u-c-done u-fs-1">★ propuesto</span>' : ''}</div>
        <div class="u-c-muted u-fs-1">${tick} · ${cls}${sim ? ' · ' + sim : ''}${evMeta}</div>
      </div>
    </div>`;
}

// Fila para guardar el competitionId tecleado a mano.
function _uciManualSaveRow(raceId) {
  return `
    <div class="u-row u-gap-050 u-mt-050 u-items-center">
      <button type="button" class="btn btn--primary u-uci-save-manual u-fs-1 u-py-0 u-px-060">Guardar el valor del campo</button>
      <span class="u-c-muted u-fs-1">usa el número del campo de arriba</span>
    </div>`;
}

// Construye el cuerpo del panel según el bucket del reporte.
function _renderUciPanel(raceId, rec) {
  const linked  = document.getElementById('er-uciCompetitionId').dataset.uciLinked === '1';
  const linkVal = document.getElementById('er-uciCompetitionId').value;
  const auto    = document.getElementById('er-uciCompetitionId').dataset.uciAuto === '1';

  let head = '';
  if (linked && linkVal) {
    head = `<div class="uci-link-head">
        Enlazada a <strong>#${esc(linkVal)}</strong> ${auto ? '<span class="u-c-muted u-fs-1">(auto)</span>' : '<span class="u-c-muted u-fs-1">(manual)</span>'}
        <button type="button" class="btn btn--ghost u-uci-unlink uci-unlink-btn">Desenlazar</button>
      </div>`;
  }

  if (!rec) {
    return head + `<div class="u-c-muted">Esta carrera no está en el reporte de matching
      (futura aún sin publicar en la UCI, o sin equivalente). Introduce el <strong>competitionId</strong>
      a mano si lo conoces.</div>` + _uciManualSaveRow(raceId);
  }

  // Contexto de NUESTRA carrera (lo que el matcher vio).
  const o = rec.our || {};
  const ourLine = `<div class="u-c-muted u-fs-1 u-mb-040">
      Nuestra: «${esc(o.name || '')}» · ${esc(o.class || '')} · ${esc(o.gender || '')} · ${esc((o.country || '').toUpperCase())} · ${esc((o.dates || []).filter(Boolean).join(' → '))}
    </div>`;

  // unique → 1 candidato propuesto (.match) o CN por prueba (.cnMatch). ambiguous → varios.
  let body = '';
  if (rec.cnMatch && rec.cnMatch.uciRaceId) {
    // Campeonato Nacional: la UCI publica el campeonato entero bajo un competitionId; el
    // matcher resolvió la PRUEBA concreta (por edad/género/tipo). Se enlaza a esa prueba.
    body = `<div class="u-mb-030">Prueba propuesta dentro del Campeonato:</div>`
      + _uciCandidateRow(raceId, {
          competitionId: rec.cnMatch.competitionId,
          uciRaceId: rec.cnMatch.uciRaceId,
          uciName: rec.cnMatch.uciRaceName,
          uciClass: 'CN', classMatch: true,
        }, { recommended: true });
  } else if (rec.bucket === 'unique' && rec.match) {
    body = `<div class="u-mb-030">Candidato propuesto:</div>`
      + _uciCandidateRow(raceId, rec.match, { recommended: true });
  } else if (rec.bucket === 'ambiguous' && Array.isArray(rec.candidates) && rec.candidates.length) {
    // Aviso de colisión masc/fem: la UCI publica UNA competición para el par;
    // la rival comparte competitionId y el constraint impedirá enlazar las dos.
    if (rec.collision && Array.isArray(rec.collision.rivals) && rec.collision.rivals.length) {
      const rivals = rec.collision.rivals.map(rv =>
        `«${esc(rv.name || '')}» <span class="u-c-muted">(${esc(rv.class || '')}/${esc(rv.gender || '')})</span>`).join(', ');
      body += `<div class="uci-collision">
          ⚠️ <strong>Colisión</strong>: la UCI publica una sola competición (#${rec.collision.competitionId}) para este par.
          Comparte candidato con: ${rivals}.<br>
          <span class="u-c-muted u-fs-1">Solo UNA de las dos puede enlazar a #${rec.collision.competitionId}. La otra se queda sin enlace UCI (o enlaza otra competición si existe).</span>
        </div>`;
    }
    body += `<div class="u-mb-030">${rec.candidates.length} candidato(s) — elige:</div>`
      + rec.candidates.map(c => _uciCandidateRow(raceId, c)).join('');
  } else {
    body = `<div class="u-c-muted">Sin candidatos en el reporte. Introduce el <strong>competitionId</strong> a mano.</div>`;
  }

  return head + ourLine + body + _uciManualSaveRow(raceId);
}

// Cablea los botones del panel (se recrea cada apertura → listeners por render).
function _wireUciPanel(raceId) {
  const panel = document.getElementById('er-uciPanel');
  if (!panel) return;
  panel.querySelectorAll('.u-uci-pick').forEach(btn =>
    btn.addEventListener('click', () => saveUciLink(raceId, parseInt(btn.dataset.comp, 10), parseInt(btn.dataset.uciraceid || '0', 10))));
  const manual = panel.querySelector('.u-uci-save-manual');
  if (manual) manual.addEventListener('click', () => {
    const v = parseInt(document.getElementById('er-uciCompetitionId').value, 10);
    if (!v) { alertDialog('Introduce un competitionId numérico en el campo.', { title: 'Falta el ID' }); return; }
    saveUciLink(raceId, v);
  });
  const unlink = panel.querySelector('.u-uci-unlink');
  if (unlink) unlink.addEventListener('click', () => unlinkUci(raceId));
}

// ── Núcleo headless de escritura (compartido por el editor de carrera y la vista
//    que usaba la vista global retirada). Solo toca race_uci_links; NO toca el DOM ni muestra
//    diálogos — eso lo decide cada UI. autoMatched=false (lo decide un humano). ──

// Devuelve { ok:true } | { ok:false, conflict:true, ownerName, ownerId } (la unicidad
// UNIQUE(competitionId,disciplineId,uciRaceId) la viola otra carrera con la MISMA
// competición+prueba). Otros errores se relanzan.
// uciRaceId (migración 110): 0 = competición ENTERA (todo lo no-CN, comportamiento de
// siempre); != 0 = una PRUEBA concreta dentro de la competición (Campeonatos Nacionales).
//
// source: enlazar a mano un competitionId de DataRide SIGNIFICA "esta carrera va por
// UCI" → se escribe source='uci' para que el cron la recoja. Sin esto, una carrera que
// quedó en 'pdf' (volcado manual con la skill cc-resultados-pdf) seguía saltándose el
// cron para siempre aunque el panel dijera lo contrario (cazado con el Tour of
// Magnificent Qinghai 2026: el 'pdf' de la etapa 4 dejó mudo el volcado de la 5).
// NO se pisan las fuentes de CRONOMETRADOR (tissot/matsport/…): ahí el competitionId es
// sintético y su código propio manda; pasarlas a 'uci' en un re-guardado del enlace las
// rompería en silencio. Tampoco el HÍBRIDO (source='uci' + domtelCode) — ya es 'uci'.
export async function _writeUciLink(raceId, competitionId, seasonId = null, uciRaceId = 0) {
  const patch = {
    raceId,
    competitionId,
    disciplineId: 10,
    seasonId,
    uciRaceId,
    autoMatched: false,
    syncStatus: 'pending',
    updatedAt: new Date().toISOString(),
  };
  // Solo se toca `source` si la fuente actual NO es de cronometrador (null/'uci'/'pdf').
  // El upsert no puede leer-y-decidir en el mismo statement → lectura previa.
  let prevSource = null;
  try {
    const { data: cur } = await supabase.from('race_uci_links')
      .select('source').eq('raceId', raceId).maybeSingle();
    prevSource = cur ? cur.source : null;
    if (!cur || UCI_PANEL_OWNED_SOURCES.has(cur.source)) patch.source = 'uci';
  } catch { /* si la lectura falla, no tocar source: conservador */ }
  const { error } = await supabase.from('race_uci_links').upsert(patch, { onConflict: 'raceId' });
  if (!error) return { ok: true, sourceSetToUci: patch.source === 'uci', source: patch.source || prevSource };
  // El índice UNIQUE(competitionId,disciplineId,uciRaceId) impide que dos carreras
  // compartan la MISMA competición+prueba. Si choca, averiguar QUÉ carrera la tiene
  // (no-CN: par masc/fem sobre la misma competición; CN: la misma prueba ya enlazada).
  if (error.code === '23505' || /duplicate key|unique/i.test(error.message || '')) {
    let ownerName = '', ownerId = null;
    try {
      const { data } = await supabase.from('race_uci_links')
        .select('raceId').eq('competitionId', competitionId).eq('disciplineId', 10).eq('uciRaceId', uciRaceId).maybeSingle();
      if (data && data.raceId) {
        ownerId = data.raceId;
        const { data: r } = await supabase.from('races').select('name, year').eq('id', data.raceId).maybeSingle();
        ownerName = r ? `«${r.name}»${r.year ? ' (' + r.year + ')' : ''}` : `la carrera ${data.raceId}`;
      }
    } catch { /* el mensaje base ya informa */ }
    return { ok: false, conflict: true, ownerName, ownerId };
  }
  throw error;
}

export async function _deleteUciLink(raceId) {
  const { error } = await supabase.from('race_uci_links').delete().eq('raceId', raceId);
  if (error) throw error;
  return { ok: true };
}

// Editor de carrera: guarda el enlace y refresca el campo/panel #er-*.
// uciRaceId (CN, migración 110): 0 = competición entera; != 0 = una prueba concreta.
async function saveUciLink(raceId, competitionId, uciRaceId = 0) {
  if (!raceId || !competitionId) return;
  const year = parseInt(document.getElementById('er-year').value, 10) || null;
  const seasonId = (year && _UCI_SEASON[year]) || null;
  let res;
  try {
    res = await _writeUciLink(raceId, competitionId, seasonId, uciRaceId);
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
  // Reflejar en el campo + recargar el panel (muestra "enlazada (manual)").
  const input = document.getElementById('er-uciCompetitionId');
  input.value = competitionId;
  input.dataset.uciLinked = '1';
  input.dataset.uciAuto = '0';
  await openUciLinkPanel();
  alertDialog(uciRaceId ? `Enlazada a la prueba ${uciRaceId} de #${competitionId}.` : `Enlazada a la competición UCI #${competitionId}.`, { title: 'Enlace UCI guardado' });
}

// Editor de carrera: desenlaza (deja la carrera sin resultados UCI) y refresca #er-*.
async function unlinkUci(raceId) {
  if (!raceId) return;
  if (!await confirmDialog('¿Quitar el enlace UCI de esta carrera? No borra resultados ya importados, pero el cron dejará de refrescarlos.', { danger: true })) return;
  try {
    await _deleteUciLink(raceId);
    const input = document.getElementById('er-uciCompetitionId');
    input.value = '';
    delete input.dataset.uciLinked;
    delete input.dataset.uciAuto;
    await openUciLinkPanel();
  } catch (err) {
    alertDialog(`Error al desenlazar: ${err.message || err}`, { title: 'Error' });
  }
}
