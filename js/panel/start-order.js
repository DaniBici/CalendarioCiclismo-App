// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Editor de jornada: orden de salida
// ─────────────────────────────────────────────────────────────────

import { supabase, esc, findMatchingTeam, normalizeTeamName } from '../shared.js';
import {
  attachDeleteHandler, buildAssetRowHtml, refreshAssetTypeSelector,
} from './jornada-editor.js';

function parseStartOrderInput(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(\d+)/);
    if (!m) continue;
    let time = m[1];
    if (time.split(':').length === 2) time += ':00';
    const dorsal = parseInt(m[2], 10);
    if (!isNaN(dorsal) && dorsal > 0) entries.push({ startTime: time, dorsal });
  }
  return entries;
}

// CRE (contrarreloj por equipos): cada línea es "HH:MM[:SS] nombre equipo".
// No hay dorsal ni corredor; el cruce es por nombre de equipo.
function parseStartOrderTeamsInput(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (!m) continue;
    let time = m[1];
    if (time.split(':').length === 2) time += ':00';
    const teamName = m[2].trim();
    if (teamName) entries.push({ startTime: time, teamName });
  }
  return entries;
}

// Construye el índice de equipos de una carrera para el orden de salida CRE.
// Lee los `startlist_teams` de la carrera y resuelve su nombre canónico vía el
// catálogo `teams` (igual cadena que `buildResolvedRiderMapForRace`). Devuelve:
//   { byNorm: Map<normalizado, nombreCanónico>, teams: [{name}] }
// `byNorm` permite match exacto por nombre normalizado contra los equipos de la
// carrera; `teams` (el catálogo) sirve de fallback vía `findMatchingTeam`.
async function buildTeamMapForRace(raceId) {
  const { data: slTeams, error } = await supabase
    .from('startlist_teams')
    .select('id, teamName, teamId, sortOrder')
    .eq('raceId', raceId)
    .order('sortOrder', { ascending: true });
  if (error) throw error;

  // Nombres canónicos de los teamId enlazados.
  const linkedIds = [...new Set((slTeams || []).map(t => t.teamId).filter(Boolean))];
  let canonByTeamId = {};
  if (linkedIds.length) {
    const { data: teamsData } = await supabase
      .from('teams').select('id, name').in('id', linkedIds);
    (teamsData || []).forEach(t => { canonByTeamId[t.id] = t.name; });
  }

  // Catálogo completo (para fallback de normalización por alias).
  const { data: catalog } = await supabase
    .from('teams').select('id, name, nameAliases');

  const byNorm = new Map();
  (slTeams || []).forEach(t => {
    const canonical = (t.teamId && canonByTeamId[t.teamId]) || t.teamName || '';
    const norm = normalizeTeamName(t.teamName);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, canonical);
    // El nombre canónico también indexa (por si pegan el nombre normalizado).
    const normCanon = normalizeTeamName(canonical);
    if (normCanon && !byNorm.has(normCanon)) byNorm.set(normCanon, canonical);
  });

  return { byNorm, teams: catalog || [] };
}

// Resuelve un nombre de equipo pegado contra el índice de la carrera.
// Devuelve { teamName: <canónico|null>, matched: bool }.
function resolveTeamName(rawName, teamMap) {
  const norm = normalizeTeamName(rawName);
  if (norm && teamMap.byNorm.has(norm)) {
    return { teamName: teamMap.byNorm.get(norm), matched: true };
  }
  // Fallback: catálogo global por nombre/alias.
  const hit = findMatchingTeam(rawName, teamMap.teams);
  if (hit) return { teamName: hit.name, matched: true };
  return { teamName: rawName, matched: false };
}

// Construye el mapa dorsal → rider para una carrera, leyendo la vista
// `startlist_riders_resolved`. La vista aplica la precedencia oficial:
//   1) Si startlist_riders.globalRiderId está set:
//        - races.gender = 'male'   → firstName/lastName de riders_men
//        - races.gender = 'female' → firstName/lastName de riders_women
//   2) Si no hay link (o gender no es male/female) → snapshot de
//      startlist_riders como fallback.
// Esto garantiza que cualquier escritor (importación o re-sync) consume la
// misma fuente de verdad que la página pública.
export async function buildResolvedRiderMapForRace(raceId) {
  const map = {};
  const { data, error } = await supabase
    .from('startlist_riders_resolved')
    .select('dorsal, firstName, lastName, countryCode, id, teamId, globalRiderId, currentTeamId')
    .eq('raceId', raceId);
  if (error) throw error;
  if (!data) return map;

  // Equipo de la STARTLIST (por dorsal): teamId aquí = PK de startlist_teams →
  // su teamId canónico → fila de `teams` (nombre e identidad).
  const teamIds = [...new Set(data.map(r => r.teamId).filter(Boolean))];
  let teamNames = {};      // PK startlist_teams → nombre
  let teamObjs = {};       // PK startlist_teams → fila teams (identidad)
  if (teamIds.length) {
    const { data: slTeams } = await supabase
      .from('startlist_teams').select('id, teamName, teamId').in('id', teamIds);
    const matchedTeamIds = [...new Set((slTeams || []).map(t => t.teamId).filter(Boolean))];
    let normalizedNames = {}, teamRowById = {};
    if (matchedTeamIds.length) {
      const { data: teamsData } = await supabase
        .from('teams').select('*').in('id', matchedTeamIds);
      (teamsData || []).forEach(t => { normalizedNames[t.id] = t.name; teamRowById[t.id] = t; });
    }
    (slTeams || []).forEach(t => {
      teamNames[t.id] = (t.teamId && normalizedNames[t.teamId]) || t.teamName || '';
      teamObjs[t.id]  = (t.teamId && teamRowById[t.teamId]) || null;
    });
  }
  // Equipo ACTUAL de cada corredor (currentTeamId → teams): es lo que la web
  // pinta cuando la fila no casa por dorsal (CN sin startlist). Se usa para el
  // fallback por globalRiderId, igual que `byRider` en js/resultados.js.
  const curIds = [...new Set(data.map(r => r.currentTeamId).filter(Boolean))];
  let curTeamById = {};
  if (curIds.length) {
    const { data: curTeams } = await supabase.from('teams').select('*').in('id', curIds);
    (curTeams || []).forEach(t => { curTeamById[t.id] = t; });
  }

  // Índice secundario por globalRiderId (companion no enumerable: los otros
  // consumidores solo leen map[dorsal], nunca iteran el objeto).
  const byGid = {};
  Object.defineProperty(map, '__byGid', { value: byGid, enumerable: false });

  data.forEach(r => {
    const slTeamObj = r.teamId ? (teamObjs[r.teamId] || null) : null;
    const curTeamObj = r.currentTeamId ? (curTeamById[r.currentTeamId] || null) : null;
    const entry = {
      id: r.id,
      dorsal: r.dorsal,
      firstName: r.firstName || '',
      lastName: r.lastName || '',
      name: `${r.firstName} ${r.lastName}`.trim(),
      // .team (string): equipo de la startlist por dorsal — lo consumen los
      // otros call sites (re-resolución de inscritos por dorsal). NO cambiar.
      team: teamNames[r.teamId] || '',
      countryCode: r.countryCode || '',
      // Objeto de equipo: startlist (por dorsal) o, en su defecto,
      // el equipo ACTUAL del corredor (por globalRiderId). Espejo de la cascada web.
      teamObj: slTeamObj || curTeamObj,
      // Nombre del equipo a MOSTRAR en el editor (auto-resuelto): el de startlist
      // o el actual del corredor.
      teamDisplay: teamNames[r.teamId] || curTeamObj?.name || '',
      globalRiderId: r.globalRiderId || null,
    };
    if (r.dorsal != null) map[r.dorsal] = entry;
    if (r.globalRiderId) byGid[r.globalRiderId] = entry;
  });
  return map;
}

// Re-sincroniza riderName (y campos derivados) en start_order_entries para una
// jornada, releyendo los nombres canónicos desde startlist_riders_resolved.
// Reusa la misma precedencia que la importación: BD canónica si hay link,
// snapshot si no. Devuelve { updated, total } con cuántas filas cambiaron.
async function resyncStartOrderRiderNames(rd) {
  const { data: entries, error: fetchErr } = await supabase
    .from('start_order_entries')
    .select('id, dorsal, riderId, riderName, teamName, countryCode')
    .eq('raceDayId', rd.id);
  if (fetchErr) throw fetchErr;
  if (!entries || !entries.length) return { updated: 0, total: 0 };

  const map = await buildResolvedRiderMapForRace(rd.raceId);

  const toUpdate = [];
  for (const e of entries) {
    const r = map[e.dorsal];
    const newRiderId   = r?.id || null;
    const newRiderName = r?.name || null;
    const newTeamName  = r?.team || null;
    const newCountry   = r?.countryCode || null;
    if (
      e.riderId     !== newRiderId   ||
      e.riderName   !== newRiderName ||
      e.teamName    !== newTeamName  ||
      e.countryCode !== newCountry
    ) {
      toUpdate.push({ id: e.id, riderId: newRiderId, riderName: newRiderName, teamName: newTeamName, countryCode: newCountry });
    }
  }

  // Actualizar fila a fila — el volumen por jornada es pequeño (≤200 corredores).
  for (const u of toUpdate) {
    const { error: upErr } = await supabase
      .from('start_order_entries')
      .update({ riderId: u.riderId, riderName: u.riderName, teamName: u.teamName, countryCode: u.countryCode })
      .eq('id', u.id);
    if (upErr) throw upErr;
  }
  return { updated: toUpdate.length, total: entries.length };
}

export async function setupStartOrderSection(rd) {
  const rawInput  = document.getElementById('soRawInput');
  const parseBtn  = document.getElementById('soParseBtn');
  const saveBtn   = document.getElementById('soSaveBtn');
  const deleteBtn    = document.getElementById('soDeleteBtn');
  const resyncBtn    = document.getElementById('soResyncBtn');
  const preview      = document.getElementById('soPreview');
  const msg          = document.getElementById('soMsg');
  const ttInput      = document.getElementById('soTtDorsals');
  const gcInput      = document.getElementById('soGcDorsals');
  const tzInput      = document.getElementById('soTimezone');
  const groupSaveBtn = document.getElementById('soGroupSaveBtn');
  const groupMsg     = document.getElementById('soGroupMsg');
  if (!rawInput || !parseBtn || !saveBtn || !preview) return;

  // CRE (contrarreloj por equipos): se pegan equipos (hora + nombre), no
  // corredores. Se cruzan por nombre contra los equipos de la carrera.
  const isTtt = rd.primaryType === 'ttt';

  const attachResyncHandler = (btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = 'Re-sincronizando…';
      msg.textContent = '';
      try {
        const { updated, total } = await resyncStartOrderRiderNames(rd);
        msg.textContent = updated === 0
          ? `✓ Ya estaba en sync (${total} entradas).`
          : `✓ ${updated}/${total} nombres actualizados desde la BD canónica.`;
      } catch (err) {
        console.error(err);
        msg.textContent = `Error: ${err.message}`;
      } finally {
        btn.textContent = prevText;
        btn.disabled = false;
      }
    });
  };

  const readTimezone = () => {
    const v = tzInput?.value.trim() || '';
    if (!v) return { value: null, error: null };
    try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return { value: v, error: null }; }
    catch { return { value: null, error: `Zona horaria no válida: "${v}". Usa formato IANA (Europe/Madrid).` }; }
  };

  const parseDorsalField = el =>
    (el?.value || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);

  // Mapa dorsal → rider (cargado bajo demanda).
  // Lee la vista resuelta para que el admin vea el nombre canónico
  // (igual que el público), no el snapshot histórico.
  let riderMap = null;
  const getRiderMap = async () => {
    if (riderMap) return riderMap;
    riderMap = await buildResolvedRiderMapForRace(rd.raceId);
    return riderMap;
  };

  // Índice de equipos de la carrera (CRE, cargado bajo demanda).
  let teamMap = null;
  const getTeamMap = async () => {
    if (teamMap) return teamMap;
    teamMap = await buildTeamMapForRace(rd.raceId);
    return teamMap;
  };

  let parsedEntries = [];

  const renderPreview = (entries, map) => {
    if (!entries.length) { preview.innerHTML = ''; return; }
    let html = `<table><thead><tr><th>Salida</th><th>Dor.</th><th>Corredor</th><th>Equipo</th></tr></thead><tbody>`;
    entries.forEach(e => {
      const r = map[e.dorsal];
      const nameHtml = r ? esc(r.name) : `<span class="so-ep-unmatched">Dorsal ${e.dorsal} — sin match</span>`;
      const teamHtml = r ? esc(r.team) : '';
      html += `<tr><td>${esc(e.startTime)}</td><td>${e.dorsal}</td><td>${nameHtml}</td><td>${teamHtml}</td></tr>`;
    });
    html += '</tbody></table>';
    preview.innerHTML = html;
  };

  // Preview CRE: solo Salida + Equipo. Marca los equipos sin match.
  const renderTeamsPreview = (entries) => {
    if (!entries.length) { preview.innerHTML = ''; return; }
    let html = `<table><thead><tr><th>Salida</th><th>Equipo</th></tr></thead><tbody>`;
    entries.forEach(e => {
      const teamHtml = e.matched
        ? esc(e.teamName)
        : `<span class="so-ep-unmatched">${esc(e.rawName)} — sin match</span>`;
      html += `<tr><td>${esc(e.startTime)}</td><td>${teamHtml}</td></tr>`;
    });
    html += '</tbody></table>';
    preview.innerHTML = html;
  };

  parseBtn.addEventListener('click', async () => {
    const text = rawInput.value;
    if (isTtt) {
      const raw = parseStartOrderTeamsInput(text);
      if (!raw.length) { msg.textContent = 'No se encontraron entradas válidas. Formato esperado: HH:MM nombre del equipo'; return; }
      msg.textContent = 'Cargando equipos…';
      const map = await getTeamMap();
      // Resolver nombre canónico de cada equipo.
      parsedEntries = raw.map(e => {
        const { teamName, matched } = resolveTeamName(e.teamName, map);
        return { startTime: e.startTime, teamName, rawName: e.teamName, matched };
      });
      renderTeamsPreview(parsedEntries);
      const unmatched = parsedEntries.filter(e => !e.matched).length;
      msg.textContent = `${parsedEntries.length} equipos · ${parsedEntries.length - unmatched} con match · ${unmatched} sin match`;
      saveBtn.disabled = false;
      return;
    }
    const entries = parseStartOrderInput(text);
    if (!entries.length) { msg.textContent = 'No se encontraron entradas válidas. Formato esperado: HH:MM:SS dorsal'; return; }
    msg.textContent = 'Cargando inscritos…';
    const map = await getRiderMap();
    parsedEntries = entries;
    renderPreview(entries, map);
    const unmatched = entries.filter(e => !map[e.dorsal]).length;
    msg.textContent = `${entries.length} entradas · ${entries.length - unmatched} con match · ${unmatched} sin match`;
    saveBtn.disabled = false;
  });

  saveBtn.addEventListener('click', async () => {
    if (!parsedEntries.length) return;
    saveBtn.disabled = true;
    msg.textContent = 'Guardando…';
    try {
      // Construir registros. En CRE: dorsal=0 (placeholder), sin corredor/bandera;
      // teamName = nombre canónico (o snapshot pegado si no hubo match).
      let records;
      if (isTtt) {
        records = parsedEntries.map((e, i) => ({
          id: crypto.randomUUID(),
          raceDayId: rd.id,
          sortOrder: i,
          dorsal: 0,
          startTime: e.startTime,
          riderId: null,
          riderName: null,
          teamName: e.teamName || null,
          countryCode: null,
        }));
      } else {
        const map = await getRiderMap();
        records = parsedEntries.map((e, i) => {
          const r = map[e.dorsal];
          return {
            id: crypto.randomUUID(),
            raceDayId: rd.id,
            sortOrder: i,
            dorsal: e.dorsal,
            startTime: e.startTime,
            riderId: r?.id || null,
            riderName: r?.name || null,
            teamName: r?.team || null,
            countryCode: r?.countryCode || null,
          };
        });
      }

      // Borrar antiguas y guardar nuevas
      const { error: delErr } = await supabase
        .from('start_order_entries').delete().eq('raceDayId', rd.id);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase
        .from('start_order_entries').insert(records);
      if (insErr) throw insErr;

      // Actualizar startOrderImportedAt, grupos de filtro y timezone.
      // En CRE no hay filtros de dorsales: se fuerzan a null.
      const now = new Date().toISOString();
      const ttDorsals = isTtt ? [] : parseDorsalField(ttInput);
      const gcDorsals = isTtt ? [] : parseDorsalField(gcInput);
      const tz = readTimezone();
      if (tz.error) { msg.textContent = tz.error; saveBtn.disabled = false; return; }
      const { error: rdErr } = await supabase
        .from('race_days').update({
          startOrderImportedAt: now,
          startOrderTtDorsals: ttDorsals.length ? ttDorsals : null,
          startOrderGcDorsals: gcDorsals.length ? gcDorsals : null,
          timezone: tz.value,
        }).eq('id', rd.id);
      if (rdErr) throw rdErr;
      rd.timezone = tz.value;

      // Gestionar asset startOrder — sustituir por URL de la página
      // Fallback a id si no hay slug ES (la URL por id la sirve orden-salida.html)
      const soUrl = rd.slug
        ? `${CONFIG.webOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`
        : `${CONFIG.webOrigin}/orden-salida.html?id=${rd.id}`;
      const { data: oldAssets } = await supabase
        .from('assets').select('id').eq('raceDayId', rd.id).eq('type', 'startOrder');
      if (oldAssets?.length) {
        await supabase.from('assets').delete().in('id', oldAssets.map(a => a.id));
      }
      await supabase.from('assets').insert({
        id: crypto.randomUUID(), raceDayId: rd.id,
        type: 'startOrder', sourceType: 'external', url: soUrl,
      });

      // Sincronizar el input de URL en el panel si existe
      const soInput = document.querySelector('.asset-url-input[data-type="startOrder"]');
      // Importar deshace un borrado previo en esta misma sesión de edición:
      // la marca de "borrado a propósito" caducó (acabamos de crear el asset).
      const soList = document.getElementById('assetsList');
      if (soList?.dataset.removedTypes) {
        soList.dataset.removedTypes = soList.dataset.removedTypes
          .split(',').filter(t => t && t !== 'startOrder').join(',');
      }
      if (soInput) {
        soInput.value = soUrl;
      } else {
        // Añadir la fila si no está
        const list = document.getElementById('assetsList');
        if (list) {
          const empty = list.querySelector('.assets-empty');
          if (empty) empty.remove();
          list.insertAdjacentHTML('afterbegin', buildAssetRowHtml('startOrder', { url: soUrl }));
          refreshAssetTypeSelector?.();
        }
      }

      // Actualizar hasAssets
      await supabase.from('race_days').update({ hasAssets: true }).eq('id', rd.id);

      // Actualizar estado visual
      const statusEl = document.getElementById('soStatus');
      if (statusEl) {
        const pageUrl = rd.slug ? `${CONFIG.basePath}/orden-salida/${encodeURIComponent(rd.slug)}/` : `/orden-salida.html?id=${rd.id}`;
        statusEl.className = 'so-editor-status so-editor-status--ok';
        statusEl.innerHTML = `✓ Importado el ${new Date(now).toLocaleDateString('es-ES')} — <a href="${pageUrl}" target="_blank" rel="noopener">ver página ↗</a>`;
      }
      if (groupSaveBtn) groupSaveBtn.disabled = false;
      // El re-sync recanoniza nombres de corredor por dorsal; no aplica a CRE.
      if (!isTtt && !document.getElementById('soResyncBtn')) {
        const resyncEl = document.createElement('button');
        resyncEl.className = 'btn btn--ghost';
        resyncEl.id = 'soResyncBtn';
        resyncEl.type = 'button';
        resyncEl.title = 'Re-aplica nombres canónicos desde riders_men/women a las entradas ya importadas';
        resyncEl.textContent = 'Re-sincronizar nombres';
        saveBtn.parentNode.insertBefore(resyncEl, saveBtn.nextSibling);
        attachResyncHandler(resyncEl);
      }
      if (!deleteBtn) {
        const deleteEl = document.createElement('button');
        deleteEl.className = 'btn btn--ghost';
        deleteEl.id = 'soDeleteBtn';
        deleteEl.type = 'button';
        deleteEl.style.color = 'var(--red)';
        deleteEl.textContent = 'Eliminar';
        // Insertar después del botón de resync (o tras saveBtn si aún no existía).
        const anchor = document.getElementById('soResyncBtn') || saveBtn;
        anchor.parentNode.insertBefore(deleteEl, anchor.nextSibling);
        attachDeleteHandler(deleteEl, rd);
      }

      msg.textContent = `✓ ${records.length} entradas guardadas.`;
      saveBtn.disabled = false;
    } catch (err) {
      console.error(err);
      msg.textContent = `Error: ${err.message}`;
      saveBtn.disabled = false;
    }
  });

  if (deleteBtn) attachDeleteHandler(deleteBtn, rd);
  if (resyncBtn) attachResyncHandler(resyncBtn);

  if (groupSaveBtn) {
    groupSaveBtn.addEventListener('click', async () => {
      groupSaveBtn.disabled = true;
      groupMsg.textContent = 'Guardando…';
      try {
        const ttDorsals = parseDorsalField(ttInput);
        const gcDorsals = parseDorsalField(gcInput);
        const tz = readTimezone();
        if (tz.error) { groupMsg.textContent = tz.error; return; }
        const { error } = await supabase.from('race_days').update({
          startOrderTtDorsals: ttDorsals.length ? ttDorsals : null,
          startOrderGcDorsals: gcDorsals.length ? gcDorsals : null,
          timezone: tz.value,
        }).eq('id', rd.id);
        if (error) throw error;
        rd.timezone = tz.value;
        groupMsg.textContent = '✓ Guardado';
        setTimeout(() => { groupMsg.textContent = ''; }, 2500);
      } catch (err) {
        groupMsg.textContent = `Error: ${err.message}`;
      } finally {
        groupSaveBtn.disabled = false;
      }
    });
  }
}
