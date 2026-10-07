// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Notificaciones push
// ─────────────────────────────────────────────────────────────────

import { panelArea, fillCxRaceSelect } from './cx.js';
import { supabase, countryFlag, stageLabel, esc } from '../shared.js';
import {
  resolveCxPushTarget, cxPushSubscriberQuery, cxPushAudienceLabel,
} from '../cx/push.js';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { MARKET_SEASON } from './constants.js';
import { formatCount, showToast, toSlug, uciRankSimple } from './helpers.js';
import { getAuthHeaders, R2_PUBLIC_BASE, r2PutObject } from './uploads.js';

// ═════════════════════════════════════════════════════════════════
//  VISTA DE NOTIFICACIONES PUSH
// ═════════════════════════════════════════════════════════════════

const SEND_PUSH_FN = `${SUPABASE_URL}/functions/v1/send-push`;
const PUSH_IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
let _notificationsInitialized = false;
let _pushRaceDays = []; // cache de jornadas para la carrera seleccionada
let _pushCxRaceRequest = 0;
let _pushSending = false;

// ── Resolver deep link value a partir de los selectores en cascada ──
function getComposedDeepLink() {
  const type = document.getElementById('push-deepLinkType').value;
  if (!type) return '';
  if (type === 'tab') return document.getElementById('push-deepLinkTab').value || '';
  if (type === 'cxRace') {
    const id = document.getElementById('push-deepLinkCxRace').value;
    return id ? `cxRace/${id}` : '';
  }
  if (type === 'race') {
    const raceId = document.getElementById('push-deepLinkRace').value;
    return raceId ? `race/${raceId}` : '';
  }
  // Jornada, perfil de etapa y orden de salida comparten el selector de
  // jornada (push-deepLinkStage); solo cambia el prefijo del deep link, que
  // resuelve a la pantalla correcta (jornada / perfil de elevación / orden de
  // salida) en cada app. Todos llevan el mismo raceDayId.
  if (type === 'stage' || type === 'perfil' || type === 'startOrder') {
    const stageId = document.getElementById('push-deepLinkStage').value;
    return stageId ? `${type}/${stageId}` : '';
  }
  if (type === 'startlist') {
    const raceId = document.getElementById('push-deepLinkStartlist').value;
    return raceId ? `startlist/${raceId}` : '';
  }
  // Mercado de Fichajes: el tab no necesita identificador; una ficha de
  // equipo usa el ID canónico de team_seasons (no su nombre, que puede cambiar
  // con el patrocinador de una temporada a otra).
  if (type === 'transfers') return 'transfers';
  if (type === 'team') {
    const teamId = document.getElementById('push-deepLinkTeam').value;
    return teamId ? `team/${teamId}` : '';
  }
  return '';
}

// ── Etiqueta legible de un deep link para el historial ──
function deepLinkDisplayLabel(dl) {
  if (!dl) return '';
  if (dl.startsWith('cxRace/')) return 'Carrera de ciclocross';
  if (dl === 'cyclocross') return 'Ciclocross';
  if (dl.startsWith('race/'))       return `Competición`;
  if (dl.startsWith('stage/'))      return `Jornada`;
  if (dl.startsWith('startlist/'))  return `Dorsales`;
  if (dl.startsWith('startOrder/')) return `Orden de salida`;
  if (dl.startsWith('perfil/'))     return `Perfil de etapa`;
  if (dl.startsWith('team/'))       return `Equipo (Mercado de Fichajes)`;
  const tabLabels = { today: 'Hoy', month: 'Mes', season: 'Temporada', search: 'Buscar', subscribe: 'Suscripción', notifications: 'Avisos', transfers: 'Mercado de Fichajes' };
  return tabLabels[dl] || dl;
}

// ── Separación por área (carretera / ciclocross) ──────────────────
// La vista de Notificaciones es común a las dos áreas del panel. El formulario
// y los listados se acotan al área activa, pero el envío reutiliza la misma vía
// (`send-push`) y las mismas funciones de envío y recuento.
const PUSH_DEEPLINK_OPTIONS = {
  common: [['', 'Sin destino específico'], ['tab', 'Pestaña de la app']],
  road: [
    ['race', 'Competición'], ['stage', 'Jornada / Etapa'], ['startlist', 'Dorsales'],
    ['perfil', 'Perfil de etapa'], ['startOrder', 'Orden de salida'],
    ['transfers', 'Mercado de Fichajes'], ['team', 'Equipo (Mercado de Fichajes)'],
  ],
  cx: [['cxRace', 'Carrera de ciclocross']],
};
const PUSH_TAB_OPTIONS = {
  road: [
    ['today', 'Hoy (agenda del día)'], ['month', 'Mes (calendario mensual)'],
    ['season', 'Temporada (listado completo)'], ['search', 'Buscar'],
    ['subscribe', 'Suscripción (calendarios iCal)'], ['notifications', 'Avisos (notificaciones)'],
  ],
  cx: [['cyclocross', 'Ciclocross']],
};

/** Categoría de la vía `send-push` según el área activa del panel. */
function _pushAreaCategory(area = panelArea()) {
  return area === 'cx' ? 'cyclocross' : 'general';
}

/** Ajusta formulario y etiquetas de la vista de Notificaciones al área activa. */
function applyPushArea(area = panelArea()) {
  const isCx = area === 'cx';
  const areaLabel = document.getElementById('pushAreaLabel');
  if (areaLabel) areaLabel.textContent = isCx ? 'Ciclocross' : 'Carretera';
  const formLabel = document.getElementById('pushFormLabel');
  if (formLabel) formLabel.textContent = isCx ? 'Enviar aviso de ciclocross' : 'Enviar anuncio de carretera';

  const typeSelect = document.getElementById('push-deepLinkType');
  if (typeSelect) {
    const options = [...PUSH_DEEPLINK_OPTIONS.common, ...(isCx ? PUSH_DEEPLINK_OPTIONS.cx : PUSH_DEEPLINK_OPTIONS.road)];
    typeSelect.innerHTML = options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
    typeSelect.value = '';
  }
  const tabSelect = document.getElementById('push-deepLinkTab');
  if (tabSelect) {
    const options = isCx ? PUSH_TAB_OPTIONS.cx : PUSH_TAB_OPTIONS.road;
    tabSelect.innerHTML = options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
  }

  ++_pushCxRaceRequest;
  ['push-tabSelector', 'push-cxRaceSelector', 'push-raceSelector', 'push-stageSelector', 'push-startlistSelector', 'push-teamSelector']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  try {
    const target = getPushAudienceTarget();
    _setPushAudience(target.category === 'cyclocross' ? cxPushAudienceLabel(target.cxRaceId) : '');
  } catch (error) { _setPushAudience(error.message); }
}

// La audiencia solo se muestra en ciclocross o ante un error; en carretera queda oculta.
function _setPushAudience(text) {
  const audience = document.getElementById('pushAudience');
  if (!audience) return;
  audience.textContent = text;
  audience.hidden = !text;
}

export async function setupNotificationsView() {
  applyPushArea();
  if (_notificationsInitialized) {
    loadPushHistory();
    loadScheduledNotifications();
    loadSubscriberCount();
    _loadPushDebugDevices();
    return;
  }
  _notificationsInitialized = true;

  // Preview en tiempo real
  const titleInput    = document.getElementById('push-title');
  const subtitleInput = document.getElementById('push-subtitle');
  const imageInput    = document.getElementById('push-imageUrl');

  function updatePreview() {
    const title    = titleInput.value.trim() || 'Título de la notificación';
    const subtitle = subtitleInput.value.trim();
    const imageUrl = imageInput.value.trim();

    document.getElementById('pushPreviewTitle').textContent = title;
    const subEl = document.getElementById('pushPreviewSubtitle');
    if (subtitle) {
      subEl.textContent = subtitle;
      subEl.style.display = '';
    } else {
      subEl.style.display = 'none';
    }

    const imgWrap = document.getElementById('pushPreviewImage');
    const imgEl   = document.getElementById('pushPreviewImg');
    if (imageUrl) {
      imgEl.src = imageUrl;
      imgWrap.style.display = '';
    } else {
      imgWrap.style.display = 'none';
    }

    const bigPreview    = document.getElementById('pushImagePreview');
    const bigPreviewImg = document.getElementById('pushImagePreviewImg');
    if (imageUrl) {
      bigPreviewImg.src = imageUrl;
      bigPreview.style.display = '';
    } else {
      bigPreview.style.display = 'none';
    }
    try {
      const target = getPushAudienceTarget();
      _setPushAudience(target.category === 'cyclocross' ? cxPushAudienceLabel(target.cxRaceId) : '');
    } catch (error) { _setPushAudience(error.message); }
  }

  titleInput.addEventListener('input', updatePreview);
  subtitleInput.addEventListener('input', updatePreview);
  imageInput.addEventListener('input', updatePreview);
  ['push-deepLinkType', 'push-deepLinkTab', 'push-deepLinkCxRace'].forEach(id =>
    document.getElementById(id).addEventListener('change', updatePreview));
  updatePreview();

  // ── Selector de deep link en cascada ──────────────────────────
  const typeSelect  = document.getElementById('push-deepLinkType');
  const tabSel      = document.getElementById('push-tabSelector');
  const raceSel     = document.getElementById('push-raceSelector');
  const stageSel    = document.getElementById('push-stageSelector');
  const raceSelect  = document.getElementById('push-deepLinkRace');
  const stageSelect = document.getElementById('push-deepLinkStage');
  const raceSearch  = document.getElementById('push-raceSearch');
  const teamSelect  = document.getElementById('push-deepLinkTeam');
  const teamSearch  = document.getElementById('push-teamSearch');
  const cxRaceSelect = document.getElementById('push-deepLinkCxRace');
  const cxRaceRetry = document.getElementById('push-cx-retry');
  let pushMarketTeams = [];

  async function populatePushCxRaceList() {
    const request = ++_pushCxRaceRequest;
    const isCurrent = () => request === _pushCxRaceRequest && typeSelect.value === 'cxRace';
    cxRaceSelect.value = '';
    cxRaceSelect.innerHTML = '<option value="">Cargando carreras CX…</option>';
    cxRaceSelect.disabled = true;
    cxRaceRetry.style.display = 'none';
    updatePreview();
    try {
      await fillCxRaceSelect(supabase, cxRaceSelect, '', { isCurrent });
    } catch (error) {
      if (isCurrent()) {
        cxRaceSelect.innerHTML = '<option value="">No se han podido cargar las carreras CX</option>';
        cxRaceRetry.style.display = '';
        showToast(error.message, 'error');
      }
    } finally {
      if (isCurrent()) { cxRaceSelect.disabled = false; updatePreview(); }
    }
  }
  cxRaceRetry.addEventListener('click', () => {
    if (typeSelect.value === 'cxRace' && !_pushSending) void populatePushCxRaceList();
  });

  function populatePushRaceList(query) {
    const q = (query || '').toLowerCase();
    const year = new Date().getFullYear();
    let filtered = panelState.allRaces.filter(r => (r.year || year) === year);
    if (q) filtered = filtered.filter(r => r.name?.toLowerCase().includes(q));
    filtered.sort((a, b) => uciRankSimple(a.uciCategory) - uciRankSimple(b.uciCategory));
    raceSelect.innerHTML = filtered.map(r =>
      `<option value="${esc(r.id)}">${countryFlag(r.countryCode)} ${esc(r.name)} — ${r.uciCategory || '?'}</option>`
    ).join('');
  }

  async function populatePushTeamList(query = '') {
    const q = query.toLowerCase();
    // El destino solo es válido para equipos publicados en el Mercado de la
    // temporada activa, exactamente el mismo conjunto que cargan las apps.
    if (pushMarketTeams.length === 0) {
      teamSelect.innerHTML = '<option value="">Cargando equipos…</option>';
      const { data, error } = await supabase.from('team_seasons')
        .select('teamId,name,category')
        .eq('year', MARKET_SEASON)
        .order('name');
      if (error) {
        teamSelect.innerHTML = `<option value="">Error: ${esc(error.message)}</option>`;
        return;
      }
      pushMarketTeams = data || [];
    }
    const teams = q
      ? pushMarketTeams.filter(team => team.name?.toLowerCase().includes(q))
      : pushMarketTeams;
    teamSelect.innerHTML = teams.length
      ? teams.map(team => `<option value="${esc(team.teamId)}">${esc(team.name || team.teamId)}${team.category ? ` — ${esc(team.category)}` : ''}</option>`).join('')
      : '<option value="">No hay equipos que coincidan</option>';
  }

  // Tipos que necesitan elegir una jornada concreta (competición → jornada).
  const STAGE_LIKE = ['stage', 'perfil', 'startOrder'];
  typeSelect.addEventListener('change', () => {
    const t = typeSelect.value;
    ++_pushCxRaceRequest;
    document.getElementById('push-cxRaceSelector').style.display = t === 'cxRace' ? '' : 'none';
    if (t === 'cxRace') void populatePushCxRaceList();
    const stageLike = STAGE_LIKE.includes(t);
    tabSel.style.display   = t === 'tab' ? '' : 'none';
    raceSel.style.display  = (t === 'race' || stageLike) ? '' : 'none';
    stageSel.style.display = stageLike ? '' : 'none';
    document.getElementById('push-startlistSelector').style.display = t === 'startlist' ? '' : 'none';
    document.getElementById('push-teamSelector').style.display = t === 'team' ? '' : 'none';
    if (t === 'race' || stageLike) populatePushRaceList('');
    if (t === 'startlist') populatePushStartlistRaceList('');
    if (t === 'team') populatePushTeamList();
    // Resetear el selector de jornada al cambiar de tipo stage-like.
    if (stageLike) {
      stageSelect.innerHTML = '<option value="">Selecciona primero una competición</option>';
    }
  });

  raceSearch.addEventListener('input', () => {
    populatePushRaceList(raceSearch.value);
  });

  // Cuando se selecciona una carrera y el tipo necesita jornada (stage /
  // perfil / orden de salida), cargar la lista de jornadas de esa competición.
  raceSelect.addEventListener('change', async () => {
    if (!STAGE_LIKE.includes(typeSelect.value)) return;
    const raceId = raceSelect.value;
    if (!raceId) {
      stageSelect.innerHTML = '<option value="">Selecciona una competición</option>';
      return;
    }
    stageSelect.innerHTML = '<option value="">Cargando jornadas…</option>';
    try {
      const { data, error } = await supabase.from('race_days')
        .select('id,dateKey,stageNumber,startLocation,finishLocation,primaryType')
        .eq('raceId', raceId)
        .order('dateKey');
      if (error) throw error;
      _pushRaceDays = data || [];
      if (_pushRaceDays.length === 0) {
        stageSelect.innerHTML = '<option value="">No hay jornadas para esta competición</option>';
        return;
      }
      stageSelect.innerHTML = _pushRaceDays.map(rd => {
        const label = rd.stageNumber
          ? `Etapa ${rd.stageNumber}`
          : rd.dateKey;
        const route = [rd.startLocation, rd.finishLocation].filter(Boolean).join(' → ');
        const typeLabel = stageLabel(rd.primaryType);
        return `<option value="${esc(rd.id)}">${esc(label)} · ${esc(rd.dateKey)}${route ? ` · ${esc(route)}` : ''}${typeLabel ? ` · ${esc(typeLabel)}` : ''}</option>`;
      }).join('');
    } catch (err) {
      stageSelect.innerHTML = `<option value="">Error: ${esc(err.message)}</option>`;
    }
  });

  // Funciones para cargar listas de inscritos y perfiles
  function populatePushStartlistRaceList(query) {
    const q = (query || '').toLowerCase();
    const year = new Date().getFullYear();
    let filtered = panelState.allRaces.filter(r => (r.startlistImportedAt != null) && (r.year || year) === year);
    if (q) filtered = filtered.filter(r => r.name?.toLowerCase().includes(q));
    filtered.sort((a, b) => uciRankSimple(a.uciCategory) - uciRankSimple(b.uciCategory));
    const sel = document.getElementById('push-deepLinkStartlist');
    sel.innerHTML = filtered.map(r =>
      `<option value="${esc(r.id)}">${countryFlag(r.countryCode)} ${esc(r.name)} — ${r.uciCategory || '?'}</option>`
    ).join('');
  }

  // Event listeners para búsqueda
  document.getElementById('push-startlistSearch')?.addEventListener('input', (e) => {
    populatePushStartlistRaceList(e.target.value);
  });
  teamSearch?.addEventListener('input', () => populatePushTeamList(teamSearch.value));

  // Botón de upload para imagen (reutilizar R2)
  const imageWrap = document.getElementById('push-image-wrap');
  if (imageWrap && !imageWrap.querySelector('.field-upload-btn')) {
    const uploadBtn = document.createElement('label');
    uploadBtn.className = 'field-upload-btn';
    uploadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir`;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.style.display = 'none';
    uploadBtn.appendChild(fileInput);
    imageWrap.appendChild(uploadBtn);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        // La Edge Function firma la clave sin codificarla: tildes, signos o
        // paréntesis del nombre original provocan SignatureDoesNotMatch en R2.
        const ext = PUSH_IMAGE_EXT[file.type] || 'jpg';
        const base = toSlug(file.name.replace(/\.[^.]+$/, '')) || 'imagen';
        const filename = `push/${Date.now()}-${base}.${ext}`;
        const buf = await file.arrayBuffer();
        const res = await r2PutObject(filename, buf, file.type);
        if (!res.ok) {
          const detail = await res.json().then(d => d.error).catch(() => '');
          throw new Error(detail || `Error al subir imagen (${res.status})`);
        }
        const url = `${R2_PUBLIC_BASE}/${filename}`;
        imageInput.value = url;
        updatePreview();
        showToast('Imagen subida', 'success');
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
      fileInput.value = '';
    });
  }

  // ── Toggle de programación ────────────────────────────────────
  const scheduleToggle   = document.getElementById('push-schedule-toggle');
  const scheduleDateWrap = document.getElementById('push-schedule-datetime-wrap');
  const scheduledAtInput = document.getElementById('push-scheduledAt');
  const sendBtn          = document.getElementById('sendPushBtn');

  scheduleToggle.addEventListener('change', () => {
    const on = scheduleToggle.checked;
    scheduleDateWrap.style.display = on ? '' : 'none';
    sendBtn.textContent = on ? 'Programar envío' : 'Enviar ahora';
    if (on && !scheduledAtInput.value) {
      // Sugerir la próxima hora en punto (o media hora) redondeada hacia arriba
      const d = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
      // datetime-local necesita "YYYY-MM-DDTHH:MM" en hora local
      const pad = n => String(n).padStart(2, '0');
      scheduledAtInput.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  });

  // Enviar / programar notificación
  document.getElementById('sendPushBtn').addEventListener('click', sendPushNotification);

  // Debug single-token: precarga la lista al abrir la vista y la re-carga al
  // cambiar el filtro o pulsar "Recargar". Precargar al inicio evita el
  // problema de tener que recargar la página si el bloque <details> se abrió
  // antes del setup.
  const debugPlatformFilter = document.getElementById('push-debug-platform-filter');
  const debugReloadBtn      = document.getElementById('push-debug-reload');
  if (debugPlatformFilter && !debugPlatformFilter.dataset.bound) {
    debugPlatformFilter.dataset.bound = '1';
    debugPlatformFilter.addEventListener('change', _loadPushDebugDevices);
  }
  if (debugReloadBtn && !debugReloadBtn.dataset.bound) {
    debugReloadBtn.dataset.bound = '1';
    debugReloadBtn.addEventListener('click', _loadPushDebugDevices);
  }
  _loadPushDebugDevices();

  // Cargar datos
  loadPushHistory();
  loadScheduledNotifications();
  loadSubscriberCount();
}

/** Carga los dispositivos registrados en push_subscriptions en el selector
 * de debug. Aplica el filtro de plataforma seleccionado. Pinta una etiqueta
 * legible con los últimos 8 chars del token, plataforma, idioma, región y
 * fecha de registro para poder identificar rápido cuál es el propio.
 */
async function _loadPushDebugDevices() {
  const sel = document.getElementById('push-debug-token');
  const countEl = document.getElementById('push-debug-token-count');
  const platformFilter = document.getElementById('push-debug-platform-filter')?.value || '';
  if (!sel) return;

  const previousValue = sel.value;
  sel.innerHTML = '<option value="">— Cargando dispositivos… —</option>';
  sel.disabled = true;
  if (countEl) countEl.textContent = '';

  try {
    // PostgREST hace fold a lowercase para identificadores sin comillas:
    // `select('deviceToken')` y `order('createdAt')` rompen porque las
    // columnas reales son camelCase con quoting. Por eso `select('*')`
    // y `order('"createdAt"', …)` igual que en fetchPushSubscriptionsCount.
    let q = supabase
      .from('push_subscriptions')
      .select('*')
      .order('"createdAt"', { ascending: false })
      .limit(200);
    if (platformFilter) q = q.eq('platform', platformFilter);
    const { data, error } = await q;
    if (error) throw error;

    const rows = data ?? [];
    sel.innerHTML = '<option value="">— Sin debug, enviar al público objetivo —</option>';
    for (const r of rows) {
      const token = r.deviceToken || r.devicetoken || '';
      const isActive = r.isActive ?? r.isactive;
      const createdAt = r.createdAt || r.createdat;
      const tail = token.slice(-8);
      const dateStr = createdAt ? new Date(createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
      const flags = [pushPlatformLabel(r.platform || 'ios')];
      if (r.language) flags.push(r.language.toUpperCase());
      if (r.region)   flags.push(r.region);
      if (isActive === false) flags.push('inactivo');
      const label = `…${tail} · ${flags.join(' · ')} · ${dateStr}`;
      const opt = document.createElement('option');
      opt.value = token;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    if (previousValue && rows.some(r => (r.deviceToken || r.devicetoken) === previousValue)) {
      sel.value = previousValue;
    }
    if (countEl) countEl.textContent = `${formatCount(rows.length)} dispositivo${rows.length !== 1 ? 's' : ''}`;
  } catch (err) {
    console.error('[push-debug] Error cargando dispositivos:', err);
    sel.innerHTML = '<option value="">— Error cargando dispositivos —</option>';
    if (countEl) countEl.textContent = String(err?.message || err);
  } finally {
    sel.disabled = false;
  }
}

function _clearPushForm() {
  ++_pushCxRaceRequest;
  const cxRaceSelect = document.getElementById('push-deepLinkCxRace');
  cxRaceSelect.innerHTML = '<option value="">Seleccionar carrera CX</option>';
  cxRaceSelect.value = '';
  cxRaceSelect.disabled = false;
  document.getElementById('push-cx-retry').style.display = 'none';
  document.getElementById('push-title').value = '';
  document.getElementById('push-subtitle').value = '';
  document.getElementById('push-imageUrl').value = '';
  document.getElementById('push-deepLinkType').value = '';
  document.getElementById('push-cxRaceSelector').style.display = 'none';
  _setPushAudience(panelArea() === 'cx' ? cxPushAudienceLabel() : '');
  document.getElementById('push-tabSelector').style.display = 'none';
  document.getElementById('push-raceSelector').style.display = 'none';
  document.getElementById('push-stageSelector').style.display = 'none';
  document.getElementById('push-startlistSelector').style.display = 'none';
  document.getElementById('push-teamSelector').style.display = 'none';
  document.getElementById('pushPreviewTitle').textContent = 'Título de la notificación';
  document.getElementById('pushPreviewSubtitle').style.display = 'none';
  document.getElementById('pushPreviewImage').style.display = 'none';
  document.getElementById('pushImagePreview').style.display = 'none';
  // Resetear plataformas (sin filtro = todas las plataformas).
  document.querySelectorAll('.push-platform-cb').forEach(cb => { cb.checked = false; });
  // Resetear debug single-token (sin persistir): selección y bloque colapsado.
  const debugSel = document.getElementById('push-debug-token');
  if (debugSel) debugSel.value = '';
  const debugBlock = document.getElementById('push-debug-block');
  if (debugBlock) debugBlock.open = false;
  // Resetear toggle de programación
  const toggle = document.getElementById('push-schedule-toggle');
  if (toggle) toggle.checked = false;
  const wrap = document.getElementById('push-schedule-datetime-wrap');
  if (wrap) wrap.style.display = 'none';
  const scheduledInput = document.getElementById('push-scheduledAt');
  if (scheduledInput) scheduledInput.value = '';
  const btn = document.getElementById('sendPushBtn');
  if (btn) btn.textContent = 'Enviar ahora';
}

/** Lee las plataformas marcadas en el form. undefined = sin filtro
 * (llega a todas las plataformas). El backend acepta undefined igual
 * que array vacío. */
function _getSelectedTargetPlatforms() {
  const checked = Array.from(document.querySelectorAll('.push-platform-cb:checked'))
    .map(cb => cb.value);
  return checked.length > 0 ? checked : undefined;
}

/** Etiqueta humana para una plataforma. */
function pushPlatformLabel(p) {
  switch (p) {
    case 'ios':     return 'iOS';
    case 'android': return 'Android';
    case 'web':     return 'Web';
    default:        return p;
  }
}

/** Etiqueta de plataformas para mostrar en historial / programadas. */
function pushPlatformsLabel(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) return '';
  return platforms.map(pushPlatformLabel).join(', ');
}

function getPushAudienceTarget() {
  const type = document.getElementById('push-deepLinkType').value;
  if (type === 'cxRace' &&
      document.getElementById('push-deepLinkCxRace').disabled) throw new Error('Espera a que se carguen las carreras de ciclocross.');
  if (type === 'cxRace' &&
      !document.getElementById('push-deepLinkCxRace').value) throw new Error('Selecciona una carrera de ciclocross antes de enviar.');
  return resolveCxPushTarget({ category: _pushAreaCategory(), deepLink: getComposedDeepLink() });
}

async function sendPushNotification() {
  if (_pushSending) return;
  const errorDiv = document.getElementById('pushSendError');
  let target;
  try { target = getPushAudienceTarget(); }
  catch (error) { errorDiv.textContent = error.message; errorDiv.style.display = 'block'; return; }
  _pushSending = true;
  const btn = document.getElementById('sendPushBtn');
  const status = document.getElementById('pushSendStatus');
  const controls = [...btn.closest('.panel-card').querySelectorAll('input,select,textarea,button')]
    .map(node => ({ node, disabled: node.disabled }));
  controls.forEach(({ node }) => { node.disabled = true; });
  status.textContent = 'Preparando…';
  try { await _sendPushNotification(target); }
  catch (error) {
    errorDiv.textContent = String(error?.message || error);
    errorDiv.style.display = 'block';
    status.textContent = '';
  }
  finally {
    controls.forEach(({ node, disabled }) => { node.disabled = disabled; });
    if (status.textContent === 'Preparando…') status.textContent = '';
    _pushSending = false;
  }
}

async function _sendPushNotification(target) {
  const title    = document.getElementById('push-title').value.trim();
  const subtitle = document.getElementById('push-subtitle').value.trim();
  const imageUrl = document.getElementById('push-imageUrl').value.trim();
  const targetPlatforms = _getSelectedTargetPlatforms();
  const debugToken = document.getElementById('push-debug-token')?.value?.trim() || '';
  const errorDiv = document.getElementById('pushSendError');
  const statusEl = document.getElementById('pushSendStatus');
  const btn      = document.getElementById('sendPushBtn');
  const isScheduled = document.getElementById('push-schedule-toggle')?.checked;

  errorDiv.style.display = 'none';
  const { category, deepLink, cxRaceId } = target;
  const audienceInfo = category === 'cyclocross' ? `\nPúblico: ${cxPushAudienceLabel(cxRaceId)}` : '';
  if (!title) {
    errorDiv.textContent = 'El título es obligatorio.';
    errorDiv.style.display = 'block';
    return;
  }

  if (debugToken && isScheduled) {
    errorDiv.textContent = 'El modo debug (single-token) no es compatible con la programación diferida. Desactiva uno de los dos.';
    errorDiv.style.display = 'block';
    return;
  }

  // ── Modo programado ──────────────────────────────────────────
  if (isScheduled) {
    const rawValue = document.getElementById('push-scheduledAt')?.value;
    if (!rawValue) {
      errorDiv.textContent = 'Selecciona una fecha y hora para el envío programado.';
      errorDiv.style.display = 'block';
      return;
    }
    const scheduledDate = new Date(rawValue);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      errorDiv.textContent = 'La fecha programada debe ser en el futuro.';
      errorDiv.style.display = 'block';
      return;
    }

    const dateStr = scheduledDate.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const deepLinkInfo = deepLink ? `\nDestino: ${deepLinkDisplayLabel(deepLink)} (${deepLink})` : '';
    if (!await confirmDialog(`¿Programar notificación para el ${dateStr}?\n\nTítulo: ${title}\n${subtitle ? `Subtítulo: ${subtitle}\n` : ''}${deepLinkInfo}${audienceInfo}`, { title: 'Programar notificación', confirmText: 'Programar' })) {
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Programando…';
    try {
      const auth = await getAuthHeaders();
      const res = await fetch(SEND_PUSH_FN, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          subtitle:        subtitle    || undefined,
          imageUrl:        imageUrl    || undefined,
          deepLink:        deepLink    || undefined,
          category,
          cxRaceId,
          targetPlatforms: targetPlatforms,
          scheduledAt:     scheduledDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al programar');

      showToast(`Notificación programada para el ${dateStr}`, 'success');
      statusEl.textContent = `Programada para el ${dateStr}`;
      _clearPushForm();
      loadScheduledNotifications();
    } catch (err) {
      errorDiv.textContent = String(err?.message || err);
      errorDiv.style.display = 'block';
      statusEl.textContent = '';
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // ── Modo inmediato ───────────────────────────────────────────
  const deepLinkInfo = deepLink ? `\nDestino: ${deepLinkDisplayLabel(deepLink)} (${deepLink})` : '';

  if (debugToken) {
    // Modo debug — confirm distinto, no se cuenta nada porque va a un único token.
    const tail = debugToken.slice(-8);
    if (!await confirmDialog(`¿Enviar notificación SOLO al dispositivo …${tail}?\n\nTítulo: ${title}\n${subtitle ? `Subtítulo: ${subtitle}\n` : ''}Modo debug: ignora filtros y NO se registra en el historial.${deepLinkInfo}`, { title: 'Enviar (debug)', confirmText: 'Enviar' })) {
      return;
    }
  } else {
    let countQuery = category === 'cyclocross'
      ? cxPushSubscriberQuery(supabase, { cxRaceId }, { count: 'exact', head: true })
      : supabase.from('push_subscriptions').select('deviceToken,push_subscription_categories!inner(category)', { count: 'exact', head: true })
        .eq('isActive', true).eq('push_subscription_categories.category', 'general');
    if (targetPlatforms?.length > 0) countQuery = countQuery.in('platform', targetPlatforms);
    const { count: filteredCount, error: countError } = await countQuery;
    if (countError) { errorDiv.textContent = `No se pudo comprobar el público: ${countError.message}`; errorDiv.style.display = 'block'; return; }
    const n = filteredCount ?? 0;
    const subscriberText = `${formatCount(n)} dispositivo${n !== 1 ? 's' : ''} suscrito${n !== 1 ? 's' : ''}`;
    const platformInfo = targetPlatforms?.length > 0 ? ` (solo ${targetPlatforms.map(pushPlatformLabel).join(', ')})` : '';
    const audienceTitle = category === 'cyclocross' ? 'Enviar aviso de ciclocross' : 'Enviar a todos';
    if (!await confirmDialog(`¿Enviar notificación al público indicado?\n\nTítulo: ${title}\n${subtitle ? `Subtítulo: ${subtitle}\n` : ''}${subscriberText}${platformInfo}${deepLinkInfo}${audienceInfo}`, { title: audienceTitle, confirmText: 'Enviar' })) {
      return;
    }
  }

  btn.disabled = true;
  statusEl.textContent = 'Enviando…';

  try {
    const auth = await getAuthHeaders();
    const res = await fetch(SEND_PUSH_FN, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        subtitle:        subtitle || undefined,
        imageUrl:        imageUrl || undefined,
        deepLink:        deepLink || undefined,
        category,
        cxRaceId,
        targetPlatforms: debugToken ? undefined : targetPlatforms,
        targetToken:     debugToken || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');

    if (debugToken) {
      const tail = debugToken.slice(-8);
      if (data.sent === 0) {
        showToast(`Debug: el token …${tail} no se encontró o no recibió la notificación. Revisa logs.`, 'warning');
        statusEl.textContent = `Debug: 0 entregas a …${tail}`;
      } else {
        showToast(`Debug: notificación entregada al dispositivo …${tail}`, 'success');
        statusEl.textContent = `Debug enviado a …${tail}`;
      }
    } else {
      showToast(`Notificación enviada a ${formatCount(data.sent)} dispositivos`, 'success');
      statusEl.textContent = `Enviada a ${formatCount(data.sent)}/${formatCount(data.totalDevices)} dispositivos`;
    }
    _clearPushForm();
    loadPushHistory();
  } catch (err) {
    // Safari iOS aborta fetch con "Load failed" (TypeError) si la edge function
    // tarda más de ~60 s — frecuente con muchos suscriptores aunque APNs/FCM
    // hayan completado. Tratarlo como envío probable y refrescar el historial.
    const msg = String(err?.message || err);
    const isNetworkAbort = /load failed|failed to fetch|networkerror|timeout/i.test(msg);
    if (isNetworkAbort) {
      errorDiv.textContent = 'Se perdió la conexión antes de recibir respuesta. La notificación probablemente se envió — comprueba el historial de envíos.';
      statusEl.textContent = 'Verificando historial…';
      loadPushHistory();
    } else {
      errorDiv.textContent = msg;
      statusEl.textContent = '';
    }
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

// Botones «Enviar ahora» y «Cancelar» de la lista programada: un único
// manejador delegado en el contenedor (los handlers en línea no alcanzan las
// funciones del módulo). El botón queda desactivado mientras dura la acción.
function wireScheduledActions(container) {
  if (container.dataset.actionsWired) return;
  container.dataset.actionsWired = '1';
  container.addEventListener('click', async e => {
    const button = e.target.closest('button[data-scheduled-action]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.dataset.scheduledAction === 'send') await sendScheduledNotificationNow(button.dataset.id);
      else await cancelScheduledNotification(button.dataset.id);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}

async function loadScheduledNotifications() {
  const container = document.getElementById('pushScheduledList');
  if (!container) return;
  wireScheduledActions(container);
  try {
    // Acotado al área activa: carretera → anuncios generales; ciclocross →
    // avisos CX. Las categorías automáticas de carretera se gestionan fuera.
    const { data, error } = await supabase
      .from('scheduled_push_notifications')
      .select('*')
      .in('status', ['pending', 'processing', 'failed', 'cancelled'])
      .eq('category', _pushAreaCategory())
      .order('scheduledAt', { ascending: true })
      .limit(30);
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="u-c-dim u-fs-2 u-py-050 u-px-0">No hay notificaciones programadas.</div>';
      return;
    }
    container.innerHTML = data.map(n => {
      const scheduledDate = new Date(n.scheduledAt).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
      });
      const dlLabel = n.deepLink ? ` → ${esc(deepLinkDisplayLabel(n.deepLink))}` : '';

      const isPending    = n.status === 'pending';
      const isProcessing  = n.status === 'processing';
      const isFailed     = n.status === 'failed';

      const platformsText = pushPlatformsLabel(n.targetPlatforms);
      const platformsBadge = platformsText
        ? `<span class="push-badge push-badge--muted push-badge--platforms" title="Plataformas">${esc(platformsText)}</span>`
        : '';

      const statusBadge = isPending
        ? `<span class="push-badge push-badge--accent">Pendiente</span>`
        : isProcessing
          ? `<span class="push-badge push-badge--accent">Enviando…</span>`
        : isFailed
          ? `<span class="push-badge push-badge--danger">Fallida</span>`
          : `<span class="push-badge push-badge--muted">Cancelada</span>`;

      const sendNowBtn = isPending
        ? `<button type="button" data-scheduled-action="send" data-id="${esc(n.id)}" class="push-sched-btn push-sched-btn--send">Enviar ahora</button>`
        : '';
      const cancelBtn = isPending
        ? `<button type="button" data-scheduled-action="cancel" data-id="${esc(n.id)}" class="push-sched-btn push-sched-btn--cancel">Cancelar</button>`
        : '';

      const errorNote = isFailed && n.errorMessage
        ? `<div class="u-fs-1 u-c-danger u-mt-020">${esc(n.errorMessage.slice(0, 120))}</div>`
        : '';

      return `<div class="push-history-row">
        ${n.imageUrl ? `<img src="${esc(n.imageUrl)}" alt="" class="push-history-img">` : ''}
        <div class="u-grow u-min0">
          <div class="u-row u-wrap u-mb-020">
            <span class="u-fw-600 u-fs-3">${esc(n.title)}</span>
            ${statusBadge}
            ${platformsBadge}
          </div>
          ${n.subtitle ? `<div class="u-fs-2 u-c-muted">${esc(n.subtitle)}</div>` : ''}
          <div class="u-fs-1 u-c-dim u-mt-020">${scheduledDate}${dlLabel}</div>
          ${n.category === 'cyclocross' ? `<div class="u-fs-2 u-c-muted">${esc(cxPushAudienceLabel(n.cxRaceId))}</div>` : ''}
          ${errorNote}
        </div>
        <div class="u-flex u-gap-040 u-shrink-0">
          ${sendNowBtn}
          ${cancelBtn}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="u-c-danger u-fs-2">${esc(err.message)}</div>`;
  }
}

async function sendScheduledNotificationNow(id) {
  try {
    // Obtener datos de la notificación
    const { data: notification, error: fetchError } = await supabase
      .from('scheduled_push_notifications')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;
    if (!notification) throw new Error('Notificación no encontrada');
    const target = resolveCxPushTarget({ category: notification.category || 'general', deepLink: notification.deepLink,
      cxRaceId: notification.cxRaceId, raceId: notification.raceId, raceDayId: notification.raceDayId });
    if (target.category === 'cyclocross' && !await confirmDialog(`¿Enviar ahora este aviso?\n\n${notification.title}\n${cxPushAudienceLabel(target.cxRaceId)}`, { title: 'Enviar aviso de ciclocross', confirmText: 'Enviar' })) return;

    // Invocar send-push como envío inmediato. Propaga targetRegions
    // de la fila programada para mantener el targeting elegido al crearla.
    const auth = await getAuthHeaders();
    const res = await fetch(SEND_PUSH_FN, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: notification.title,
        subtitle: notification.subtitle || undefined,
        imageUrl: notification.imageUrl || undefined,
        deepLink: target.deepLink || undefined,
        category: target.category,
        cxRaceId: target.cxRaceId,
        targetRegions: Array.isArray(notification.targetRegions) && notification.targetRegions.length > 0
          ? notification.targetRegions
          : undefined,
        targetPlatforms: Array.isArray(notification.targetPlatforms) && notification.targetPlatforms.length > 0
          ? notification.targetPlatforms
          : undefined,
        targetCountryGroups: notification.targetCountryGroups?.length ? notification.targetCountryGroups : undefined,
        targetLanguages: notification.targetLanguages?.length ? notification.targetLanguages : undefined,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al enviar');

    // Marcar como enviada
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('scheduled_push_notifications')
      .update({
        status: 'sent',
        sentAt: now,
        recipientCount: result.sent,
        category: target.category,
        cxRaceId: target.cxRaceId ?? null,
      })
      .eq('id', id);
    if (updateError) throw updateError;

    showToast(`Notificación enviada a ${formatCount(result.sent)} dispositivos`, 'success');
    loadScheduledNotifications();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function cancelScheduledNotification(id) {
  if (!await confirmDialog('¿Cancelar esta notificación programada?', { danger: true })) return;
  try {
    // Cancelar elimina la programación del panel. Solo se puede borrar una
    // fila que siga pendiente; si el cron ya la está procesando no debemos
    // fingir que se ha cancelado porque podría llegar a enviarse igualmente.
    const { data: deleted, error } = await supabase
      .from('scheduled_push_notifications')
      .delete()
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      throw new Error('La notificación ya no está pendiente o ya fue procesada');
    }
    showToast('Notificación cancelada', 'success');
    loadScheduledNotifications();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function loadPushHistory() {
  const container = document.getElementById('pushHistoryList');
  try {
    // Historial del área activa; excluye las categorías automáticas de carretera.
    const { data, error } = await supabase
      .from('push_notifications')
      .select('*')
      .eq('category', _pushAreaCategory())
      .order('sentAt', { ascending: false })
      .limit(20);
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="u-c-dim u-fs-2 u-py-050 u-px-0">No se han enviado notificaciones aún.</div>';
      return;
    }
    container.innerHTML = data.map(n => {
      const date = new Date(n.sentAt).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
      });
      const dlLabel = n.deepLink ? ` → ${esc(deepLinkDisplayLabel(n.deepLink))}` : '';
      const platformsText = pushPlatformsLabel(n.targetPlatforms);
      const platformsBadge = platformsText
        ? `<span class="push-badge push-badge--muted push-badge--platforms u-ml-040" title="Plataformas">${esc(platformsText)}</span>`
        : '';
      return `<div class="push-history-row">
        ${n.imageUrl ? `<img src="${esc(n.imageUrl)}" alt="" class="push-history-img">` : ''}
        <div class="u-grow u-min0">
          <div class="u-fw-600 u-fs-3">${esc(n.title)}${platformsBadge}</div>
          ${n.subtitle ? `<div class="u-fs-2 u-c-muted">${esc(n.subtitle)}</div>` : ''}
          ${n.category === 'cyclocross' ? `<div class="u-fs-2 u-c-muted">${esc(cxPushAudienceLabel(n.cxRaceId))}</div>` : ''}
          <div class="u-fs-1 u-c-dim u-mt-025">${date} · ${formatCount(n.recipientCount)} destinatarios${dlLabel}</div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="u-c-danger u-fs-2">${esc(err.message)}</div>`;
  }
}

async function loadSubscriberCount() {
  const el = document.getElementById('pushSubscriberCount');
  try {
    const { count, error } = await supabase.from('push_subscriptions')
      .select('deviceToken', { count: 'exact', head: true })
      .eq('isActive', true);
    if (error) throw error;
    const n = count ?? 0;
    el.textContent = `${formatCount(n)} dispositivo${n !== 1 ? 's' : ''}`;
  } catch {
    el.textContent = '';
  }
}
