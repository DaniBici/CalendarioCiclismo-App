// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — panel/app.html
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, countryFlag, stageLabel, esc,
         UCI_ORDER, genderRank, grandTourRank, tsSeconds,
         buildTeamBadgeSvg, findMatchingTeam,
         extractYouTubeId, checkYouTubeEmbeddable,
         categoryBadge, effectiveCountryCode,
         nameImpliesFemale, normalizeTeamName }
  from './shared.js';
import { annotateDoubleSectors } from './services/races.js';
import { detectClimb, computeClimbStats } from './climb-detection.js';
import { exportElevationProfilePNG } from './elevation-profile.js';
import { buildProfileAssetDownloadRequest, mountProfileDigitizer } from './profile-digitizer.js';
import { openDrawer, closeDrawer, isDrawerOpen } from './components/drawer.js';
import { confirmDialog, alertDialog, promptDialog } from './components/dialog.js';
import { genderToggleHtml, setGenderToggleActive, wireGenderToggle } from './components/gender-toggle.js';
import { compareChampionships } from './campeonatos-config.js';

// ── GPX — parseo en browser y calculo de perfil de elevacion ─────
const _GPX_THRESHOLD_M  = 3;
const _GPX_TARGET_MIN   = 250;
const _GPX_TARGET_MAX   = 350;
const _GPX_MIN_PADDING  = 100;
const _GPX_MAX_PADDING  = 300;
const _GPX_RANGE_FACTOR = 0.1;

function _gpxHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _gpxParse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML invalido');
  const raw = [];
  const collect = els => {
    for (const pt of els) {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const ele = parseFloat(pt.querySelector('ele')?.textContent ?? 'NaN');
      if (!isNaN(lat) && !isNaN(lon) && !isNaN(ele)) raw.push({ lat, lon, ele });
    }
  };
  const trkpts = doc.querySelectorAll('trk trkpt');
  collect(trkpts.length ? trkpts : doc.querySelectorAll('rte rtept'));
  if (raw.length < 2) throw new Error('El GPX no contiene puntos de elevacion validos');
  return raw;
}

function _gpxDP(pts, tol) {
  if (pts.length <= 2) return pts;
  const [f, l] = [pts[0], pts[pts.length - 1]];
  const dx = l.x - f.x, dy = l.y - f.y, len = Math.hypot(dx, dy);
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len === 0
      ? Math.hypot(pts[i].x - f.x, pts[i].y - f.y)
      : Math.abs(dy * pts[i].x - dx * pts[i].y + l.x * f.y - l.y * f.x) / len;
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= tol) return [f, l];
  return [..._gpxDP(pts.slice(0, maxI + 1), tol).slice(0, -1), ..._gpxDP(pts.slice(maxI), tol)];
}

function _gpxSimplify(enriched) {
  const pts = enriched.map(p => ({ x: p.km, y: p.ele }));
  if (pts.length <= _GPX_TARGET_MAX) return pts;
  let lo = 0, hi = 10000, best = pts, bestDist = Infinity;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    const s = _gpxDP(pts, mid);
    const dist = s.length < _GPX_TARGET_MIN ? _GPX_TARGET_MIN - s.length
               : s.length > _GPX_TARGET_MAX ? s.length - _GPX_TARGET_MAX : 0;
    if (dist < bestDist) { bestDist = dist; best = s; }
    if (dist === 0) break;
    if (s.length > _GPX_TARGET_MAX) lo = mid; else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return best;
}

async function _gpxHandleUpload(file, rdId, statusEl, summaryEl, btnEl, onSaved = null) {
  statusEl.textContent = 'Procesando…';
  btnEl.disabled = true;
  try {
    const raw = _gpxParse(await file.text());
    let cumKm = 0, gain = 0, loss = 0, refEle = raw[0].ele;
    let minEle = raw[0].ele, maxEle = raw[0].ele;
    const enriched = [{ km: 0, ele: raw[0].ele }];
    for (let i = 1; i < raw.length; i++) {
      const [p, c] = [raw[i - 1], raw[i]];
      cumKm += _gpxHaversineKm(p.lat, p.lon, c.lat, c.lon);
      const diff = c.ele - refEle;
      if (diff >= _GPX_THRESHOLD_M)        { gain += diff;            refEle = c.ele; }
      else if (diff <= -_GPX_THRESHOLD_M)  { loss += Math.abs(diff);  refEle = c.ele; }
      if (c.ele < minEle) minEle = c.ele;
      if (c.ele > maxEle) maxEle = c.ele;
      enriched.push({ km: cumKm, ele: c.ele });
    }
    const simplified = _gpxSimplify(enriched);
    const profile = {
      distance:      Math.round(cumKm * 10) / 10,
      elevationGain: Math.round(gain),
      elevationLoss: Math.round(loss),
      minElevation:  Math.round(minEle),
      maxElevation:  Math.round(maxEle),
      points: simplified.map(p => ({ km: Math.round(p.x * 100) / 100, alt: Math.round(p.y) })),
    };
    statusEl.textContent = 'Guardando…';
    const { error } = await supabase.from('race_days').update({ elevationProfile: profile }).eq('id', rdId);
    if (error) throw error;
    if (_editorCache?.rdId === rdId) _editorCache.rd = { ..._editorCache.rd, elevationProfile: profile };
    onSaved?.(profile);
    // Tras guardar el GPX, intentar detectar el inicio de cada puerto que aún
    // no lo tenga, y refrescar el "X km · Y%" de los que sí. Los cambios se
    // reflejan en los inputs y se persisten cuando el usuario pulse Guardar.
    const summitRows = document.querySelectorAll('#summitsList .ann-row');
    let detected = 0;
    summitRows.forEach(row => {
      const startInput = row.querySelector('.ann-start');
      const km = parseFloat(row.querySelector('.ann-km')?.value);
      if (startInput && startInput.value.trim() === '' && !isNaN(km)) {
        const before = startInput.value;
        _autoDetectSummitClimb(row, /*silent*/ true);
        if (startInput.value !== before) detected++;
      }
      _refreshSummitStats(row);
    });
    if (detected > 0) {
      showToast(`Detectados ${detected} puerto${detected > 1 ? 's' : ''} — pulsa Guardar para conservarlos`, 'success', 5000);
    }
    summaryEl.textContent = `${profile.distance} km · +${profile.elevationGain} m / -${profile.elevationLoss} m · ${profile.points.length} puntos`;
    summaryEl.dataset.distance = profile.distance;
    summaryEl.style.display = '';
    // Sincronizar el campo manual de desnivel con el gain recién calculado, para
    // que un Guardado posterior no lo sobrescriba con el valor anterior del input.
    const _elevInput = document.getElementById('ed-elev');
    if (_elevInput) _elevInput.value = profile.elevationGain;
    btnEl.textContent = 'Reemplazar GPX';
    statusEl.textContent = '';
    showToast('Perfil de elevacion guardado', 'success', 3000);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    btnEl.disabled = false;
  }
}

// Bucket de Supabase Storage para los GPX del mapa. Storage devuelve CORS
// correcto (un solo Access-Control-Allow-Origin), a diferencia del proxy R2 de
// assets.calendariociclismo.app, que lo duplica y rompe el fetch() del navegador.
const ROUTE_GPX_BUCKET = 'route-gpx';

// Sube el GPX CRUDO de la jornada a Supabase Storage (route-{rdId}.gpx) y guarda
// routeGpxUrl. Activa la página /mapa/ — opt-in por jornada. Independiente del
// perfil: usa el mismo archivo, pero el mapa lee la traza cruda mientras el
// perfil va destilado a {km,alt} en la BD.
async function _mapHandleUpload(file, rdId, statusEl, summaryEl, btnEl) {
  statusEl.textContent = 'Subiendo…';
  btnEl.disabled = true;
  try {
    const text = await file.text();
    // Validación mínima: que sea un GPX con puntos de track.
    if (!/<trkpt[\s>]/i.test(text)) throw new Error('El GPX no contiene <trkpt> (puntos de track).');
    const objectPath = `route-${rdId}.gpx`;
    const blob = new Blob([text], { type: 'application/gpx+xml' });
    const { error: upErr } = await supabase.storage.from(ROUTE_GPX_BUCKET)
      .upload(objectPath, blob, { upsert: true, contentType: 'application/gpx+xml', cacheControl: '3600' });
    if (upErr) throw new Error('Storage: ' + upErr.message);
    // URL pública de Storage + cache-buster (el nombre es estable → sobrescribe).
    const { data: pub } = supabase.storage.from(ROUTE_GPX_BUCKET).getPublicUrl(objectPath);
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from('race_days').update({ routeGpxUrl: publicUrl }).eq('id', rdId);
    if (error) throw error;
    if (_editorCache?.rdId === rdId) _editorCache.rd = { ..._editorCache.rd, routeGpxUrl: publicUrl };
    summaryEl.textContent = 'Mapa activo · GPX en Storage';
    summaryEl.style.display = '';
    btnEl.textContent = 'Reemplazar GPX del mapa';
    statusEl.textContent = '';
    showToast('Mapa del recorrido activado', 'success', 3000);
    // Mostrar los botones "Quitar mapa" / "Ver mapa" si no estaban.
    if (!document.getElementById('ed-map-del')) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn--ghost'; delBtn.id = 'ed-map-del';
      delBtn.style.cssText = 'font-size:0.8rem;color:var(--red)';
      delBtn.textContent = 'Quitar mapa';
      btnEl.insertAdjacentElement('afterend', delBtn);
      _wireMapDelete(delBtn, rdId, summaryEl, btnEl);
      const viewLink = document.createElement('a');
      viewLink.className = 'btn btn--ghost u-fs-082';
      viewLink.href = `/mapa.html?id=${rdId}`; viewLink.target = '_blank'; viewLink.rel = 'noopener';
      viewLink.textContent = 'Ver mapa ↗';
      delBtn.insertAdjacentElement('afterend', viewLink);
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    btnEl.disabled = false;
  }
}

function _wireMapDelete(delBtn, rdId, summaryEl, btnEl) {
  delBtn.addEventListener('click', async () => {
    if (!await confirmDialog('¿Quitar el mapa interactivo de esta jornada? (el GPX seguirá en Storage; solo se desvincula)', { danger: true })) return;
    const { error } = await supabase.from('race_days').update({ routeGpxUrl: null }).eq('id', rdId);
    if (error) { showToast('Error al quitar: ' + error.message); return; }
    if (_editorCache?.rdId === rdId) _editorCache.rd = { ..._editorCache.rd, routeGpxUrl: null };
    summaryEl.style.display = 'none';
    summaryEl.textContent = '';
    btnEl.textContent = 'Subir GPX del mapa';
    delBtn.nextElementSibling?.remove(); // el enlace "Ver mapa ↗"
    delBtn.remove();
    showToast('Mapa del recorrido quitado', 'success', 3000);
  });
}

// ── Cloudflare R2 — subida vía Edge Function (proxy server-side) ─
const R2_PUBLIC_BASE       = 'https://assets.calendariociclismo.app';
const R2_UPLOAD_FN         = `${SUPABASE_URL}/functions/v1/r2-upload`;

// ── Helpers para subir/borrar/listar archivos vía Edge Function ──
async function getAuthHeaders() {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || isTokenExpiringSoon(session)) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      await supabase.auth.signOut();
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    }
    session = data.session;
  }
  if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'apikey':        SUPABASE_ANON_KEY,
  };
}

function isTokenExpiringSoon(session) {
  if (!session.expires_at) return false;
  // Refresh if token expires within 60 seconds
  return session.expires_at * 1000 - Date.now() < 60_000;
}

async function r2PutObject(filename, fileBuffer, contentType) {
  const auth = await getAuthHeaders();
  const res = await fetch(R2_UPLOAD_FN, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': contentType,
      'x-action':     'upload',
      'x-filename':   encodeURIComponent(filename),
    },
    body: fileBuffer,
  });
  return res;
}

// Las guías técnicas grandes van directamente al endpoint S3 de R2 mediante
// una URL PUT temporal. La Edge Function solo firma: no recibe el PDF.
async function r2PutTechnicalGuide(filename, file, contentType) {
  const auth = await getAuthHeaders();
  const signRes = await fetch(R2_UPLOAD_FN, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': contentType, 'x-action': 'sign-upload', 'x-filename': encodeURIComponent(filename) },
  });
  if (!signRes.ok) throw new Error(`No se pudo preparar la subida (${signRes.status})`);
  const { url } = await signRes.json();
  const putRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!putRes.ok) throw new Error(`R2 ${putRes.status}`);
  return putRes;
}

async function r2ListObjects() {
  const auth = await getAuthHeaders();
  const res = await fetch(R2_UPLOAD_FN, {
    headers: auth,
  });
  const data = await res.json();
  return data.files || [];
}

// ── Claves canónicas de assets de jornada ────────────────────────
// No usar el nombre que trae el archivo ni una marca temporal: ambos hacen que
// una misma carrera termine con rutas imposibles de descubrir. La edición vive
// en el segmento de año y el tipo es el nombre estable del objeto.
function stableRaceAssetSlug(slug, year) {
  const suffix = `-${year}`;
  return slug?.endsWith(suffix) ? slug.slice(0, -suffix.length) : (slug || 'race');
}

function stageAssetDirectory(stageNumber, raceDaySlug = '') {
  if (stageNumber === null || stageNumber === undefined || stageNumber === '') return '';
  // Jornadas partidas: el slug canónico acaba en etapa-3a / stage-3a. El
  // sufijo evita que 3 y 3a compartan objeto sin imponer convenciones nuevas.
  const match = String(raceDaySlug).match(new RegExp(`(?:etapa|stage)-${stageNumber}([a-z]+)$`, 'i'));
  const suffix = match ? match[1].toLowerCase() : '';
  return `stage-${stageNumber}${suffix}/`;
}

function canonicalStageAssetKey({ raceSlug, year, stageNumber, raceDaySlug, type, ext }) {
  if (!raceSlug || !year || !['technicalGuide', 'roadbook', 'profile', 'ports', 'map'].includes(type)) {
    throw new Error('No se puede construir la ruta canónica de este asset.');
  }
  // La guía técnica es única para toda la carrera, nunca para una etapa.
  const stageDir = type === 'technicalGuide' ? '' : stageAssetDirectory(stageNumber, raceDaySlug);
  return `races/${stableRaceAssetSlug(raceSlug, year)}/${year}/${stageDir}${type}.${ext}`;
}

function nextCanonicalStageAssetKey(context, currentUrl = '') {
  const baseKey = canonicalStageAssetKey(context);
  // Reemplazar un documento no pisa su URL cacheada: conserva la carpeta y el
  // tipo, incrementando únicamente la revisión (`profile-2.png`, etc.).
  const currentName = String(currentUrl).split('/').pop()?.split('?')[0] || '';
  const match = currentName.match(new RegExp(`^${context.type}-(\\d+)\\.${context.ext}$`, 'i'));
  return match
    ? baseKey.replace(`.${context.ext}`, `-${Number(match[1]) + 1}.${context.ext}`)
    : currentName === `${context.type}.${context.ext}`
      ? baseKey.replace(`.${context.ext}`, `-2.${context.ext}`)
      : baseKey;
}

// ── Slug utils ────────────────────────────────────────────────────
function toSlug(str) {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // solo alfanum, espacios, guiones
    .trim()
    .replace(/[\s_]+/g, '-')       // espacios → guión
    .replace(/-{2,}/g, '-')        // guiones dobles → uno
    .slice(0, 80);
}
function validateSlug(val) {
  if (!val) return null; // vacío = permitido (sin slug)
  if (!/^[a-z0-9-]+$/.test(val)) return 'Solo letras minúsculas, números y guiones.';
  if (val.startsWith('-') || val.endsWith('-')) return 'No puede empezar ni terminar con guión.';
  if (val.length > 80) return 'Máximo 80 caracteres.';
  return null;
}

// ── Guard de autenticación ────────────────────────────────────────
// Antes de expulsar al login, conservar el deep-link (?edit=…, #analytics…)
// para que login.js (devReturnUrl) vuelva aquí tras autenticarse.
function _gotoLogin() {
  const target = location.pathname + location.search + location.hash;
  if (location.search || (location.hash && location.hash !== '#agenda')) {
    sessionStorage.setItem('devReturnUrl', target);
  }
  window.location.href = CONFIG.basePath + '/panel/index.html';
}

supabase.auth.getSession().then(async ({ data: { session } }) => {
  if (!session?.user) {
    _gotoLogin();
    return;
  }
  document.getElementById('userEmail').textContent = 'Dani Sánchez';
  await initPanel();
  const overlay = document.getElementById('panelOverlay');
  if (overlay) {
    overlay.classList.add('panel-overlay--hidden');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    _gotoLogin();
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => supabase.auth.signOut());
document.getElementById('logoutBtnMobile')?.addEventListener('click', () => supabase.auth.signOut());

// ── Estado global ─────────────────────────────────────────────────
// ── Toast ────────────────────────────────────────────────────────
function showToast(msg, type = 'error', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// La agenda abre SIEMPRE en el día en curso (antes recordaba el último día
// visitado vía localStorage 'panel_dateKey' y resultaba incómodo).
let currentDateKey  = toDateKey(new Date());
let currentRaceDayId    = null;
let allRaces            = [];
let currentDayRaceIds   = new Set(); // raceIds que ya tienen jornada en currentDateKey
let _editorCache = null; // { rd, broadcasts, assets } | null — evita releer Firestore tras guardar
let _profileDigitizerCleanup = null;
let _raceDaySaveInFlight = false;

function setRaceDaySaveInFlight(inFlight) {
  _raceDaySaveInFlight = inFlight;
  document.querySelectorAll('#ed-draft, #ed-publish').forEach(btn => {
    btn.disabled = inFlight;
    btn.setAttribute('aria-busy', String(inFlight));
    if (inFlight) {
      btn.dataset.idleText = btn.textContent;
      btn.textContent = 'Guardando…';
    } else if (btn.dataset.idleText) {
      btn.textContent = btn.dataset.idleText;
      delete btn.dataset.idleText;
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function formatTimeLocal(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
  });
}

// Convierte "HH:MM" + dateKey a ISO string UTC
function toTimestamp(dateKey, timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const [y, mo, d] = dateKey.split('-').map(Number);
  // Crear en hora de Madrid (UTC+1/+2) — usamos el offset del momento
  const dt = new Date(y, mo - 1, d, h, m, 0);
  // Si la hora introducida es "pasada medianoche" (ej. 00:49), la conversión
  // a UTC puede caer un día antes del dateKey. En ese caso la hora pertenece
  // al día siguiente: sumamos un día para que el timestamp UTC sea coherente.
  if (dt.getTime() < Date.UTC(y, mo - 1, d)) dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

function uciRankSimple(cat) { return UCI_ORDER[cat] ?? 99; }

// Activa una pestaña del editor de jornada cuando exista. El editor carga
// la jornada por red, así que con un deep-link (?edit=…&tab=mas / ?perfil=…)
// las pestañas aún no están montadas: reintentar en vez de un timeout fijo.
function _clickEditorTab(target, tries = 20) {
  const btn = document.querySelector(`#editorTabs .editor-tab[data-target="${target}"]`);
  if (btn) { btn.click(); return; }
  if (tries > 0) setTimeout(() => _clickEditorTab(target, tries - 1), 150);
}

// ── Init panel ────────────────────────────────────────────────────
async function initPanel() {
  // Fecha picker
  const datePicker = document.getElementById('agendaDate');
  datePicker.value = currentDateKey;
  datePicker.addEventListener('change', () => {
    currentDateKey = datePicker.value;
    loadSidebar();
  });

  datePicker.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const [y, m, d] = currentDateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + (e.key === 'ArrowUp' ? -1 : 1));
    currentDateKey = toDateKey(date);
    datePicker.value = currentDateKey;
    loadSidebar();
  });

  const shiftDay = (delta) => {
    const [y, m, d] = currentDateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    currentDateKey = toDateKey(date);
    datePicker.value = currentDateKey;
    loadSidebar();
  };

  document.getElementById('prevDayBtn').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDayBtn').addEventListener('click', () => shiftDay(1));

  document.getElementById('todayBtn').addEventListener('click', () => {
    currentDateKey = toDateKey(new Date());
    datePicker.value = currentDateKey;
    loadSidebar();
  });

  document.getElementById('addJornadaBtn').addEventListener('click', openRaceModal);

  // Cargar carreras
  await loadRaces();

  // Si venimos desde una página pública con query params, navegar a la sección correspondiente
  const _urlEdit   = new URLSearchParams(location.search);
  const _editId    = _urlEdit.get('edit');
  const _startlist = _urlEdit.get('startlist');
  const _perfilId  = _urlEdit.get('perfil');
  const _teamId    = _urlEdit.get('team');
  const _tabParam  = _urlEdit.get('tab');

  if (_editId) {
    try {
      const { data: rdData } = await supabase.from('race_days').select('dateKey').eq('id', _editId).single();
      if (rdData?.dateKey) {
        currentDateKey    = rdData.dateKey;
        datePicker.value  = rdData.dateKey;
      }
    } catch (_) {}
  } else if (_perfilId) {
    try {
      const { data: rdData } = await supabase.from('race_days').select('dateKey').eq('id', _perfilId).single();
      if (rdData?.dateKey) {
        currentDateKey    = rdData.dateKey;
        datePicker.value  = rdData.dateKey;
      }
    } catch (_) {}
  }
  // Limpiar los query params del deep-link conservando el hash: tabFromHash()
  // se lee más abajo y los marcadores (#analytics…) deben sobrevivir.
  history.replaceState(null, '', location.pathname + location.hash);

  setupModals();
  setupRacesView();
  loadSidebar();
  if (_editId) {
    switchTab('agenda', { updateHash: false });
    history.replaceState(null, '', '#agenda');
    openEditor(_editId);
    if (_tabParam) _clickEditorTab(_tabParam);
  } else if (_startlist) {
    switchTab('startlists', { updateHash: false });
    history.replaceState(null, '', '#startlists');
    // allRaces ya está cargado (loadRaces se awaiteó antes de este bloque)
    openStartlistEditor(_startlist);
  } else if (_perfilId) {
    switchTab('agenda', { updateHash: false });
    history.replaceState(null, '', '#agenda');
    openEditor(_perfilId);
    _clickEditorTab('perfil');
  } else if (_teamId) {
    // Deep-link desde la página pública /equipo/<slug>/ ("Editar equipo").
    switchTab('teams', { updateHash: false });
    history.replaceState(null, '', '#teams');
    // switchTab→setupTeamsView es async y no se awaita; garantizamos que el
    // cache de equipos esté cargado antes de abrir el editor del equipo.
    await fetchTeams();
    openTeamEditor(_teamId);
  } else {
    const initialTab = tabFromHash();
    switchTab(initialTab, { updateHash: false });
    history.replaceState(null, '', '#' + initialTab);
  }

}

// ── Carreras ──────────────────────────────────────────────────────
function sortRaces(arr) {
  return arr.sort((a, b) => grandTourRank(a) - grandTourRank(b)
    || uciRankSimple(a.uciCategory) - uciRankSimple(b.uciCategory)
    || (a.name || '').localeCompare(b.name || ''));
}

async function loadRaces() {
  const { data } = await supabase.from('races').select('*');
  allRaces = data || [];
  sortRaces(allRaces);
}

// Actualiza allRaces en memoria sin ir a Firestore
function upsertRaceLocal(race) {
  const idx = allRaces.findIndex(r => r.id === race.id);
  if (idx >= 0) allRaces[idx] = race;
  else allRaces.push(race);
  sortRaces(allRaces);
}

function removeRaceLocal(id) {
  const idx = allRaces.findIndex(r => r.id === id);
  if (idx >= 0) allRaces.splice(idx, 1);
}

// ── Sidebar: jornadas del día ─────────────────────────────────────
async function loadSidebar() {
  const list = document.getElementById('sidebarList');
  list.innerHTML = '<div style="padding:1rem;font-size:0.8rem;color:var(--text-dim)">Cargando…</div>';

  try {
    const { data: daysData } = await supabase
      .from('race_days')
      .select('*')
      .eq('dateKey', currentDateKey);
    let days = daysData || [];

    // Actualizar raceIds con jornada en este día
    currentDayRaceIds = new Set(days.map(d => d.raceId).filter(Boolean));

    annotateDoubleSectors(days, { skipFcNumbers: true });

    // Enriquecer con datos de carrera
    days = days.map(rd => ({
      ...rd,
      _race: allRaces.find(r => r.id === rd.raceId) || {},
    }));

    // Ordenar
    days.sort((a, b) => {
      // Dos Campeonatos Nacionales: orden por país → línea/CRI → categoría
      // (mismo orden que el feed /resultados/ y Hoy/Mes; el rd da el primaryType).
      const cn = compareChampionships(a._race, a, b._race, b);
      if (cn != null && cn !== 0) return cn;
      const diff = uciRankSimple(a._race.uciCategory) - uciRankSimple(b._race.uciCategory);
      if (diff !== 0) return diff;
      const genDiff = genderRank(a._race.gender) - genderRank(b._race.gender);
      if (genDiff !== 0) return genDiff;
      const tA = tsSeconds(a.neutralStartTimeUtc) ?? 999999;
      const tB = tsSeconds(b.neutralStartTimeUtc) ?? 999999;
      if (tA !== tB) return tA - tB;
      return (a._race.name || '').localeCompare(b._race.name || '');
    });

    list.innerHTML = '';

    if (days.length === 0) {
      list.innerHTML = '';
    } else {

    const getSidebarGroup = (rd) => {
      if (rd.editorialStatus !== 'published') return 'draft';
      const incomplete = !rd.description?.trim() || !rd.hasAssets || rd._race.isNoClickable;
      return incomplete ? 'incomplete' : 'published';
    };

    const groups = [
      { key: 'published',  label: 'Completas'     },
      { key: 'incomplete', label: 'Simplificadas' },
      { key: 'draft',      label: 'Borrador'      },
    ];

    groups.forEach(({ key, label }) => {
      const groupDays = days.filter(rd => getSidebarGroup(rd) === key);
      if (groupDays.length === 0) return;

      const header = document.createElement('div');
      header.className = 'sidebar-group-label';
      header.textContent = label;
      list.appendChild(header);

      groupDays.forEach(rd => {
        const item = document.createElement('div');
        item.className = 'sidebar-item' + (rd.id === currentRaceDayId ? ' active' : '');

        const cc    = effectiveCountryCode(rd, rd._race);
        const flag  = countryFlag(cc);
        const name  = rd._race.name || rd._race.abbrev || 'Sin carrera';
        const stage = stageLabel(rd.stageNumber, rd._stageSuffix);
        const catBadge  = categoryBadge(rd._race.uciCategory, rd._race.gender === 'female' && !nameImpliesFemale(rd._race.name || ''));
        const statusBadge = rd.isRestDay
          ? '<span class="badge badge--type-rest">Descanso</span>'
          : rd.isCancelledDay
            ? '<span class="badge badge--type-cancelled">Cancelada</span>'
            : '';

        item.innerHTML = `
          <span class="sidebar-item__flag">${flag}</span>
          <div class="sidebar-item__info">
            <div class="sidebar-item__name">${name}</div>
            ${stage ? `<div class="sidebar-item__stage">${stage}</div>` : ''}
            <div class="sidebar-item__badges">${catBadge}${statusBadge ? ' ' + statusBadge : ''}</div>
          </div>
        `;
        item.addEventListener('click', () => openEditor(rd.id));
        list.appendChild(item);
      });
    });

    } // end if days.length > 0

    // Carreras sin jornada asignada en este día
    const pending = getRaceSuggestionsForDate(currentDateKey);
    if (pending.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'sidebar-pending-divider';
      divider.textContent = 'Por añadir';
      list.appendChild(divider);

      pending.forEach(race => {
        const flag = countryFlag(race.countryCode);
        const catBadge = categoryBadge(race.uciCategory, race.gender === 'female' && !nameImpliesFemale(race.name || ''));
        const item = document.createElement('div');
        item.className = 'sidebar-item sidebar-item--pending';
        item.innerHTML = `
          <span class="sidebar-item__flag">${race.hideFlag ? '' : flag}</span>
          <div class="sidebar-item__info">
            <div class="sidebar-item__name">${race.name}</div>
            <div class="sidebar-item__badges">${catBadge}</div>
          </div>
        `;
        item.addEventListener('click', () => createNewRaceDay(race.id));
        list.appendChild(item);
      });
    } else if (list.innerHTML === '') {
      list.innerHTML = `<div style="padding:1.5rem 1rem;text-align:center;
        color:var(--text-muted);font-size:0.8rem">No hay jornadas para este día</div>`;
    }

  } catch (err) {
    console.error(err);
    list.innerHTML = `<div style="padding:1rem;color:#e84747;font-size:0.8rem">Error al cargar</div>`;
  }
}

// ── Editor de jornada ─────────────────────────────────────────────
// El editor vive en el drawer. `#editorArea` es el contenedor que el drawer
// monta en su body; `renderEditor()` (y saveRaceDay/deleteRaceDay/…) lo
// localizan por id como siempre, así que su lógica interna no cambia.
function _ensureEditorArea() {
  // Si el drawer ya tiene el editor montado, reusarlo (re-render in situ).
  let area = document.getElementById('editorArea');
  if (area && area.closest('#ccDrawer1Body')) return area;

  openDrawer({
    title: 'Jornada',
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = '<section class="editor-area" id="editorArea"></section>';
    },
    onClose: () => { currentRaceDayId = null; },
  });
  return document.getElementById('editorArea');
}

async function openEditor(raceDayId, cachedData = null) {
  // Al cambiar de jornada, invalidar caché anterior
  if (raceDayId !== currentRaceDayId) _editorCache = null;
  currentRaceDayId = raceDayId;

  // Marcar activo en sidebar
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));

  const area = _ensureEditorArea();

  // Usar datos en memoria si vienen de un guardado reciente (0 lecturas Firestore)
  const source = cachedData || _editorCache;
  if (source && source.rdId === raceDayId) {
    const race = allRaces.find(r => r.id === source.rd.raceId) || {};
    renderEditor(source.rd, race, source.broadcasts, source.assets);
    return;
  }

  area.innerHTML = '<div class="loading" style="margin:3rem auto">Cargando jornada</div>';

  try {
    const { data: rdData, error: rdError } = await supabase.from('race_days').select('*').eq('id', raceDayId).single();
    if (rdError || !rdData) throw new Error('No existe');
    const rd = rdData;

    const [bcastRes, assetsRes] = await Promise.all([
      supabase.from('broadcasts').select('*').eq('raceDayId', raceDayId).order('sortOrder', { ascending: true }),
      supabase.from('assets').select('*').eq('raceDayId', raceDayId),
    ]);
    const broadcasts = bcastRes.data || [];
    const assets     = assetsRes.data || [];

    // Guardar en caché para posibles guardados sucesivos
    _editorCache = { rdId: raceDayId, rd, broadcasts, assets };

    const race = allRaces.find(r => r.id === rd.raceId) || {};
    renderEditor(rd, race, broadcasts, assets);

  } catch (err) {
    console.error(err);
    area.innerHTML = `<div class="editor-placeholder">
      <div class="editor-placeholder__icon">⚠️</div>
      <div class="editor-placeholder__title">Error al cargar la jornada</div>
    </div>`;
  }
}

// Tipos de documento soportados en la sección Documentación.
// El icono se inyecta como SVG inline para no depender de assets externos.
const ASSET_TYPE_LABELS = {
  technicalGuide: 'Libro de Ruta',
  roadbook: 'Rutómetro',
  profile: 'Perfil',
  ports: 'Puertos',
  map: 'Mapa',
  startOrder: 'Orden Salida',
  live_text: 'Live texto',
};
const ASSET_TYPE_ICONS = {
  technicalGuide: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
  roadbook: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  profile: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  ports: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M8 3 4 7l4 4"/><path d="m16 3 4 4-4 4"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M8 17 4 21l4 4"/><path d="m16 17 4 4-4 4"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
  map: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
  startOrder: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V3"/><path d="M10 2h4"/></svg>',
  live_text: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>',
};
const ASSET_DOC_TYPES_ALL = ['technicalGuide', 'roadbook', 'profile', 'ports', 'map', 'startOrder', 'live_text'];

function buildAssetRowHtml(type, asset = null) {
  const isLive = type === 'live_text';
  return `<div class="asset-row" data-asset-type="${type}">
    <span class="asset-row__type">${ASSET_TYPE_ICONS[type]} ${ASSET_TYPE_LABELS[type]}</span>
    <input type="url" class="asset-url-input${isLive ? ' asset-url-input--live' : ''}" data-type="${type}"
           ${asset?.id ? `data-assetid="${asset.id}"` : ''}
           value="${asset?.url || ''}" placeholder="https://…">
    <button type="button" class="asset-row__remove" title="Quitar" aria-label="Quitar">✕</button>
  </div>`;
}

function refreshAssetTypeSelector() {
  const sel = document.getElementById('assetTypeSelector');
  if (!sel) return;
  const used = new Set(
    [...document.querySelectorAll('#assetsList .asset-row')].map(r => r.dataset.assetType)
  );
  const remaining = ASSET_DOC_TYPES_ALL.filter(t => !used.has(t));
  sel.innerHTML = '<option value="">+ Añadir documento…</option>'
    + remaining.map(t => `<option value="${t}">${ASSET_TYPE_LABELS[t]}</option>`).join('');
  sel.disabled = remaining.length === 0;
}

function setupAssetsSection() {
  const sel = document.getElementById('assetTypeSelector');
  const list = document.getElementById('assetsList');
  if (!sel || !list) return;
  refreshAssetTypeSelector();

  sel.addEventListener('change', () => {
    const type = sel.value;
    if (!type) return;
    // Si la lista está en estado vacío, limpiarla
    const empty = list.querySelector('.assets-empty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('beforeend', buildAssetRowHtml(type));
    const newRow = list.lastElementChild;
    const input = newRow.querySelector('.asset-url-input');
    // Reconectar el upload inline para tipos != live_text
    if (type !== 'live_text' && input) attachInlineUpload(input, type);
    refreshAssetTypeSelector();
    sel.value = '';
    if (input) input.focus();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.asset-row__remove');
    if (!btn) return;
    const row = btn.closest('.asset-row');
    if (!row) return;
    // Marcar el tipo como borrado A PROPÓSITO. saveRaceDay reconstruye los
    // assets desde el DOM y preserva el `startOrder` ausente (lo crea el
    // importador, no el editor); sin esta marca, quitar la fila a mano y
    // "que el editor nunca la renderizara" serían indistinguibles y el
    // guardado resucitaría el asset que se acaba de borrar.
    list.dataset.removedTypes = [
      ...new Set([...(list.dataset.removedTypes || '').split(',').filter(Boolean), row.dataset.assetType]),
    ].join(',');
    row.remove();
    if (!list.querySelector('.asset-row')) {
      list.innerHTML = '<div class="assets-empty">Aún no hay documentos. Usa el selector de arriba para añadir.</div>';
    }
    refreshAssetTypeSelector();
  });
}

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
async function buildResolvedRiderMapForRace(raceId) {
  const map = {};
  const { data, error } = await supabase
    .from('startlist_riders_resolved')
    .select('dorsal, firstName, lastName, countryCode, id, teamId, globalRiderId, currentTeamId')
    .eq('raceId', raceId);
  if (error) throw error;
  if (!data) return map;

  // Equipo de la STARTLIST (por dorsal): teamId aquí = PK de startlist_teams →
  // su teamId canónico → fila de `teams` (nombre + chapa).
  const teamIds = [...new Set(data.map(r => r.teamId).filter(Boolean))];
  let teamNames = {};      // PK startlist_teams → nombre
  let teamObjs = {};       // PK startlist_teams → fila teams (chapa)
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
      name: `${r.firstName} ${r.lastName}`.trim(),
      // .team (string): equipo de la startlist por dorsal — lo consumen los
      // otros call sites (re-resolución de inscritos por dorsal). NO cambiar.
      team: teamNames[r.teamId] || '',
      countryCode: r.countryCode || '',
      // Objeto de equipo para la chapa: startlist (por dorsal) o, en su defecto,
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

async function setupStartOrderSection(rd) {
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
        deleteEl.style.color = 'var(--red,#e55)';
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

function attachDeleteHandler(btn, rd) {
  btn.addEventListener('click', async () => {
    if (!await confirmDialog('¿Eliminar el orden de salida de esta jornada?', { danger: true })) return;
    btn.disabled = true;
    try {
      await supabase.from('start_order_entries').delete().eq('raceDayId', rd.id);
      await supabase.from('race_days').update({ startOrderImportedAt: null, startOrderTtDorsals: null, startOrderGcDorsals: null }).eq('id', rd.id);
      // Borrar asset startOrder
      const { data: oldAssets } = await supabase
        .from('assets').select('id').eq('raceDayId', rd.id).eq('type', 'startOrder');
      if (oldAssets?.length) {
        await supabase.from('assets').delete().in('id', oldAssets.map(a => a.id));
      }
      // Limpiar input en panel
      const soInput = document.querySelector('.asset-url-input[data-type="startOrder"]');
      if (soInput) soInput.closest('.asset-row')?.remove();
      refreshAssetTypeSelector?.();

      const statusEl = document.getElementById('soStatus');
      if (statusEl) { statusEl.className = 'so-editor-status'; statusEl.textContent = 'Sin datos importados.'; }
      btn.remove();
      document.getElementById('soResyncBtn')?.remove();
      const preview = document.getElementById('soPreview');
      if (preview) preview.innerHTML = '';
      const msg = document.getElementById('soMsg');
      if (msg) msg.textContent = '';
      const ttEl = document.getElementById('soTtDorsals');
      const gcEl = document.getElementById('soGcDorsals');
      if (ttEl) ttEl.value = '';
      if (gcEl) gcEl.value = '';
    } catch (err) {
      alertDialog(`Error al eliminar: ${err.message}`, { title: 'Error' });
      btn.disabled = false;
    }
  });
}

function renderEditor(rd, race, broadcasts, assets) {
  const area   = document.getElementById('editorArea');
  _profileDigitizerCleanup?.();
  _profileDigitizerCleanup = null;
  const isDraft = rd.editorialStatus !== 'published';
  const flag    = countryFlag(race.countryCode);

  const startTime  = rd.neutralStartTimeUtc   ? formatTimeHHMM(rd.neutralStartTimeUtc)   : '';
  const finishTime = rd.estimatedFinishTimeUtc ? formatTimeHHMM(rd.estimatedFinishTimeUtc) : '';

  const editorStage = stageLabel(rd.stageNumber, rd._stageSuffix);
  const publicUrl = rd.slug
    ? `${CONFIG.basePath}/jornada/${rd.slug}/`
    : `${CONFIG.basePath}/jornada.html?id=${rd.id}`;

  area.innerHTML = `
    <!-- Top bar del editor -->
    <div class="editor-topbar">
      <div class="editor-topbar__title">
        <div class="editor-topbar__headline">${flag} ${race.name || 'Jornada'}${editorStage ? ` · ${editorStage}` : ''}${rd.dateKey ? ` · <span class="editor-topbar__date">${rd.dateKey}</span>` : ''}</div>
        <div class="editor-topbar__meta">
          <span class="editor-topbar__status ${isDraft ? '' : 'editor-topbar__status--pub'}">${isDraft ? 'Borrador' : 'Publicado'}</span>
          ${rd.updatedAt ? `<span class="editor-topbar__updated" title="Última actualización">✎ ${formatDateTime(rd.updatedAt)}</span>` : ''}
        </div>
      </div>
      <div class="editor-topbar__actions">
        <a class="btn btn--ghost" href="${publicUrl}" target="_blank" rel="noopener">Ver ↗</a>
        <button class="btn btn--ghost" id="ed-startlist" data-race-id="${rd.raceId}">Dorsales</button>
        <button class="btn btn--danger" id="ed-delete">Borrar</button>
        <button class="btn btn--ghost" id="ed-duplicate">Duplicar</button>
        <button class="btn btn--ghost" id="ed-draft">Borrador</button>
        <button class="btn btn--primary" id="ed-publish">${isDraft ? 'Publicar' : 'Actualizar'}</button>
      </div>
    </div>

    <div class="editor-content">

      <!-- Pestañas del editor -->
      <div class="editor-tabs" id="editorTabs" role="tablist">
        <button type="button" class="editor-tab" role="tab" data-target="general">General</button>
        <button type="button" class="editor-tab" role="tab" data-target="tv">TV</button>
        <button type="button" class="editor-tab" role="tab" data-target="perfil">GPX</button>
        <button type="button" class="editor-tab" role="tab" data-target="mas">Docs</button>
        <button type="button" class="editor-tab" role="tab" data-target="resultados">Resultados</button>
      </div>

      <!-- Identidad -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header">
          <span class="editor-section__title">Identidad</span>
        </div>
        <div class="editor-section__body">
          <div class="field-row field-row--2">
            <div class="field">
              <label>Fecha</label>
              <input type="date" id="ed-date" value="${rd.dateKey || ''}">
            </div>
            <div class="field">
              <label>Nº etapa (opcional)</label>
              <input type="number" id="ed-stage" value="${rd.stageNumber != null ? rd.stageNumber : ''}" placeholder="—" min="0" ${rd.isRestDay ? 'disabled' : ''}>
            </div>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer">
              <input type="checkbox" id="ed-isRestDay" ${rd.isRestDay ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
              <span>Jornada de descanso</span>
              <span class="u-field-hint">— no se mostrará como etapa ni será clicable</span>
            </label>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer">
              <input type="checkbox" id="ed-isCancelledDay" ${rd.isCancelledDay ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#e55">
              <span style="color:#e55;font-weight:600">Jornada cancelada</span>
              <span class="u-field-hint">— se mostrará con indicador visual en la jornada y en las cards</span>
            </label>
          </div>
          <div class="field">
            <label>Carrera</label>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <span style="font-family:var(--font-display);font-weight:700;
                           font-size:0.95rem;text-transform:uppercase;flex:1">
                ${flag} ${race.name || '—'}
              </span>
              <button class="btn btn--ghost" id="ed-changeRace" style="font-size:0.75rem;padding:0.35rem 0.7rem">
                Cambiar
              </button>
            </div>
          </div>
          <div class="lang-pair" data-lang="es">
            <div class="lang-pair__header">
              <label style="display:flex;align-items:center;gap:0.5rem;margin:0">
                <span class="lang-field--es">Slug</span>
                <span class="lang-field--en">Slug (EN)</span>
                <span class="u-field-hint">— URL amigable (opcional, solo a-z, 0-9 y guiones)</span>
              </label>
              <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
            </div>
            <div class="field lang-field--es">
              <div class="u-row">
                <input type="text" id="ed-slug" value="${esc(rd.slug || '')}" placeholder="tour-de-france-2025-etapa-3" maxlength="80"
                       style="flex:1;font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
                       autocomplete="off" spellcheck="false" ${!rd.slug ? 'data-auto="1"' : ''}>
                <button type="button" id="ed-slug-suggest" class="btn btn--ghost u-fs-xs u-btn-sm"
                       >Auto</button>
              </div>
              <div id="ed-slug-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
            </div>
            <div class="field lang-field--en">
              <div class="u-row">
                <input type="text" id="ed-slug-en" value="${esc(rd.slugEn || '')}" placeholder="tour-de-france-2025-stage-3" maxlength="80"
                       style="flex:1;font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
                       autocomplete="off" spellcheck="false" ${!rd.slugEn ? 'data-auto="1"' : ''}>
                <button type="button" id="ed-slug-en-suggest" class="btn btn--ghost u-fs-xs u-btn-sm"
                       >Auto</button>
              </div>
              <div id="ed-slug-en-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
            </div>
          </div>
          <div class="field">
            <label class="u-row">
              País (solo bandera, opcional)
              <span class="u-field-hint">— sobrescribe la bandera de la carrera; déjalo vacío para usar la del país de la carrera (${esc((race.countryCode || '').toUpperCase()) || '—'})</span>
            </label>
            <input type="text" id="ed-country" value="${esc(rd.countryCode || '')}" placeholder="ES, FR, IT…" maxlength="6" autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>

      <!-- Recorrido -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header u-between u-gap-sm">
          <span class="editor-section__title">Recorrido</span>
        </div>
        <div class="editor-section__body">
          <div class="lang-pair" data-lang="es">
            <div class="lang-pair__header">
              <span class="lang-pair__label">
                <span class="lang-field--es">Salida y Llegada</span>
                <span class="lang-field--en">Start &amp; Finish (EN)</span>
              </span>
              <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
            </div>
            <div class="field-row field-row--2 lang-field--es">
              <div class="field">
                <label>Salida</label>
                <input type="text" id="ed-start" value="${esc(rd.startLocation || '')}" placeholder="Ciudad salida">
              </div>
              <div class="field">
                <label>Llegada</label>
                <input type="text" id="ed-finish" value="${esc(rd.finishLocation || '')}" placeholder="Ciudad llegada">
              </div>
            </div>
            <div class="field-row field-row--2 lang-field--en">
              <div class="field">
                <label>Start (EN)</label>
                <input type="text" id="ed-start-en" value="${esc(rd.startLocationEn || '')}" placeholder="Start city (English)" ${!rd.startLocationEn ? 'data-auto="1"' : ''}>
              </div>
              <div class="field">
                <label>Finish (EN)</label>
                <input type="text" id="ed-finish-en" value="${esc(rd.finishLocationEn || '')}" placeholder="Finish city (English)" ${!rd.finishLocationEn ? 'data-auto="1"' : ''}>
              </div>
            </div>
          </div>
          <div class="field-row field-row--4">
            <div class="field">
              <label>Distancia (km)</label>
              <input type="number" id="ed-km" value="${rd.distanceKm || ''}" placeholder="0">
            </div>
            <div class="field">
              <label>Desnivel (m)</label>
              <input type="number" id="ed-elev" value="${rd.elevationProfile?.elevationGain ?? ''}" placeholder="0" min="0" step="10" title="Desnivel positivo. Si la jornada tiene GPX, sobrescribe el calculado; si no, se guarda solo el número (sin silueta).">
            </div>
            <div class="field">
              <label>Tipo principal</label>
              <select id="ed-type">
                <option value="">—</option>
                <option value="flat"             ${rd.primaryType==='flat'?'selected':''}>Llana</option>
                <option value="rolling"          ${rd.primaryType==='rolling'?'selected':''}>Sinuosa</option>
                <option value="cotas"            ${rd.primaryType==='cotas'?'selected':''}>Cotas</option>
                <option value="medium_mountain"  ${rd.primaryType==='medium_mountain'?'selected':''}>Media montaña</option>
                <option value="high_mountain"    ${rd.primaryType==='high_mountain'?'selected':''}>Alta montaña</option>
                <option value="cobbles"          ${rd.primaryType==='cobbles'?'selected':''}>Adoquines</option>
                <option value="sterrato"         ${rd.primaryType==='sterrato'?'selected':''}>Sterrato</option>
                <option value="itt"              ${rd.primaryType==='itt'?'selected':''}>CRI</option>
                <option value="ttt"              ${rd.primaryType==='ttt'?'selected':''}>CRE</option>
              </select>
            </div>
            <div class="field">
              <label>Tipo secundario</label>
              <select id="ed-type2">
                <option value=""                 ${!rd.secondaryType?'selected':''}>—</option>
                <option value="summit_finish"    ${rd.secondaryType==='summit_finish'?'selected':''}>Final en alto</option>
                <option value="uphill_finish"    ${rd.secondaryType==='uphill_finish'?'selected':''}>Final en repecho</option>
                <option value="chrono_climb"     ${rd.secondaryType==='chrono_climb'?'selected':''}>Cronoescalada</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Horarios -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header">
          <span class="editor-section__title">Horarios (hora española)</span>
        </div>
        <div class="editor-section__body">
          <div class="field-row field-row--2">
            <div class="field">
              <label>Salida neutralizada</label>
              <input type="time" id="ed-startTime" value="${startTime}">
            </div>
            <div class="field">
              <label>Llegada estimada</label>
              <input type="time" id="ed-finishTime" value="${finishTime}">
            </div>
          </div>
        </div>
      </div>

      <!-- TV -->
      <div class="editor-section" data-tab="tv">
        <div class="editor-section__header">
          <span class="editor-section__title">Televisión</span>
        </div>
        <div class="editor-section__body">
          <div class="field">
            <label>Estado</label>
            <select id="ed-tvStatus">
              <option value=""                 ${!rd.tvStatus?'selected':''}>—</option>
              <option value="confirmed_time"   ${rd.tvStatus==='confirmed_time'?'selected':''}>Confirmado con hora</option>
              <option value="confirmed_notime" ${rd.tvStatus==='confirmed_notime'?'selected':''}>Confirmado sin hora</option>
              <option value="pending"          ${rd.tvStatus==='pending'?'selected':''}>Por confirmar</option>
              <option value="none"             ${rd.tvStatus==='none'?'selected':''}>Sin retransmisión</option>
              <option value="unavailable_es"  ${rd.tvStatus==='unavailable_es'?'selected':''}>No TV España</option>
            </select>
          </div>
          <div id="broadcastsList">
            ${(broadcasts || []).map((b, i) => broadcastHTML(b, i)).join('')}
          </div>
          <button class="btn btn--ghost" id="addBroadcastBtn" style="margin-top:0.25rem">
            + Añadir emisión
          </button>
        </div>
      </div>

      <!-- Editorial -->
      <div class="editor-section" data-tab="general">
        <div class="lang-pair" data-lang="es">
          <div class="editor-section__header u-between u-gap-sm">
            <span class="editor-section__title">
              <span class="lang-field--es">Editorial</span>
              <span class="lang-field--en">Editorial (EN)</span>
            </span>
            <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
          </div>
          <div class="editor-section__body">
            ${(() => {
              const tr = rd.translations?.en || {};
              const statusBadge = (field) => {
                const s = tr[field]?.status;
                const labels = { auto: 'auto', manual: 'manual', stale: 'stale', pending: 'pending' };
                const cls = `en-badge en-badge--${s || 'pending'}`;
                return `<span class="${cls}">${labels[s] || 'pending'}</span>`;
              };
              return `
            <!-- Descripción -->
            <div class="field lang-field--es">
              <label>Descripción</label>
              <div class="md-editor">
                ${mdToolbarHtml('md-toolbar')}
                <div id="ed-description-wysiwyg" class="md-wysiwyg" contenteditable="true" data-placeholder="Describe la jornada…"></div>
                <textarea id="ed-description" style="display:none">${rd.description || ''}</textarea>
              </div>
            </div>
            <div class="field lang-field--en">
              <label class="u-row">Description (EN) ${statusBadge('description')}
                ${tr.description?.status !== 'manual' ? `<button type="button" class="btn btn--ghost" onclick="markTranslationAsManual('description')" style="font-size:0.7rem;padding:0.15rem 0.5rem">✓ Manual</button>` : ''}
              </label>
              <div class="md-editor">
                ${mdToolbarHtml('md-toolbar-en', { bold: 'Bold (Cmd+B)', italic: 'Italic (Cmd+I)', h2: 'Heading H2', h3: 'Heading H3', ul: 'List', blockquote: 'Blockquote', hr: 'Horizontal rule' })}
                <div id="ed-description-en-wysiwyg" class="md-wysiwyg" contenteditable="true" data-placeholder="Stage description in English…"></div>
                <textarea id="ed-description-en" style="display:none">${esc(tr.description?.value || '')}</textarea>
              </div>
            </div>

            <!-- Bonificaciones y Notas -->
            <div class="field-row field-row--2 lang-field--es">
              <div class="field">
                <label>Bonificaciones (opcional)</label>
                <input type="text" id="ed-bonuses" value="${esc(rd.bonuses || '')}" placeholder="—">
              </div>
              <div class="field">
                <label>Notas (opcional)</label>
                <input type="text" id="ed-notes" value="${esc(rd.notes || '')}" placeholder="—">
              </div>
            </div>
            <div class="field-row field-row--2 lang-field--en">
              <div class="field">
                <label class="u-row">Bonuses (EN) ${statusBadge('bonuses')}</label>
                <input type="text" id="ed-bonuses-en" value="${esc(tr.bonuses?.value || '')}" placeholder="—">
              </div>
              <div class="field">
                <label class="u-row">Notes (EN) ${statusBadge('notes')}</label>
                <input type="text" id="ed-notes-en" value="${esc(tr.notes?.value || '')}" placeholder="—">
              </div>
            </div>`;
            })()}
          </div>
        </div>
      </div>

      <!-- Orden de Salida (solo CRI/CRE) -->
      ${(rd.primaryType === 'itt' || rd.primaryType === 'ttt') ? `<div class="editor-section" data-tab="mas" id="soEditorSection">
        <div class="editor-section__header">
          <span class="editor-section__title">Orden de Salida</span>
        </div>
        <div class="editor-section__body">
          ${rd.startOrderImportedAt
            ? `<div class="so-editor-status so-editor-status--ok" id="soStatus">✓ Importado el ${new Date(rd.startOrderImportedAt).toLocaleDateString('es-ES')} — <a href="${rd.slug ? `${CONFIG.basePath}/orden-salida/${encodeURIComponent(rd.slug)}/` : `/orden-salida.html?id=${rd.id}`}" target="_blank" rel="noopener">ver página ↗</a></div>`
            : `<div class="so-editor-status" id="soStatus">Sin datos importados.</div>`
          }
          <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 0.5rem">
            ${rd.primaryType === 'ttt'
              ? `Pega el orden de salida en formato <code>HH:MM nombre del equipo</code>, un equipo por línea. El sistema cruzará automáticamente con los equipos de la carrera.`
              : `Pega el orden de salida en formato <code>HH:MM:SS dorsal</code>, una entrada por línea. El sistema cruzará automáticamente con los inscritos por dorsal.`}
          </p>
          <textarea id="soRawInput" class="so-editor-textarea" placeholder="${rd.primaryType === 'ttt' ? '14:00:00 UAE Team Emirates&#10;14:05:00 Visma | Lease a Bike&#10;14:10:00 Soudal Quick-Step&#10;…' : '14:00:00 1&#10;14:00:30 2&#10;14:01:00 3&#10;…'}"></textarea>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">
            <button class="btn btn--ghost" id="soParseBtn" type="button">Procesar</button>
            <button class="btn btn--primary" id="soSaveBtn" type="button" disabled>Guardar</button>
            ${(rd.startOrderImportedAt && rd.primaryType !== 'ttt')
              ? `<button class="btn btn--ghost" id="soResyncBtn" type="button" title="Re-aplica nombres canónicos desde riders_men/women a las entradas ya importadas">Re-sincronizar nombres</button>`
              : ''}
            ${rd.startOrderImportedAt
              ? `<button class="btn btn--ghost" id="soDeleteBtn" type="button" style="color:var(--red,#e55)">Eliminar</button>`
              : ''}
            <span class="u-fs-md u-c-muted" id="soMsg"></span>
          </div>
          <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.5rem">
            <div>
              <label class="u-sublabel" for="soTimezone">Zona horaria de la jornada (IANA)</label>
              <input type="text" id="soTimezone" class="input u-input-block" value="${esc(rd.timezone || '')}" placeholder="Ej: Europe/Madrid, Asia/Tokyo, America/New_York" autocomplete="off" spellcheck="false">
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0.25rem 0 0">Si se indica, la página pública convierte las horas a la zona del visitante.</p>
            </div>
            ${rd.primaryType === 'ttt' ? '' : `
            <div>
              <label class="u-sublabel" for="soTtDorsals">Dorsales Contrarrelojistas (separados por coma)</label>
              <input type="text" id="soTtDorsals" class="input u-input-block" value="${(rd.startOrderTtDorsals || []).join(', ')}" placeholder="Ej: 1, 12, 45">
            </div>
            <div>
              <label class="u-sublabel" for="soGcDorsals">Dorsales General / GC (separados por coma)</label>
              <input type="text" id="soGcDorsals" class="input u-input-block" value="${(rd.startOrderGcDorsals || []).join(', ')}" placeholder="Ej: 1, 12, 45">
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin:0">Los grupos con al menos un dorsal muestran filtros en la página pública.</p>`}
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem">
              <button class="btn btn--ghost u-fs-082" id="soGroupSaveBtn" type="button">${rd.primaryType === 'ttt' ? 'Guardar zona horaria' : 'Guardar zona y grupos'}</button>
              <span id="soGroupMsg" style="font-size:0.78rem;color:var(--text-muted)"></span>
            </div>
          </div>
          <div id="soPreview" class="so-editor-preview"></div>
        </div>
      </div>` : ''}

      <!-- Assets -->
      <div class="editor-section" data-tab="mas">
        <div class="editor-section__header u-between u-gap-sm">
          <span class="editor-section__title">Documentación</span>
          <div class="assets-add">
            <select id="assetTypeSelector" class="assets-add__select">
              <option value="">+ Añadir documento…</option>
            </select>
          </div>
        </div>
        <div class="editor-section__body">
          <div id="assetsList" class="assets-list">
            ${(() => {
              // Si hay startOrderImportedAt y no hay asset startOrder, auto-añadirlo
              const existing = (assets || []).filter(a => ASSET_DOC_TYPES_ALL.includes(a.type));
              if (rd.startOrderImportedAt && !existing.find(a => a.type === 'startOrder')) {
                const soUrl = rd.slug
                  ? `${CONFIG.webOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`
                  : `${CONFIG.webOrigin}/orden-salida.html?id=${rd.id}`;
                existing.unshift({ type: 'startOrder', url: soUrl, sourceType: 'external', id: '' });
              }
              if (existing.length === 0) {
                return '<div class="assets-empty">Aún no hay documentos. Usa el selector de arriba para añadir.</div>';
              }
              return existing.map(a => buildAssetRowHtml(a.type, a)).join('');
            })()}
          </div>
        </div>
      </div>

      <!-- Perfil de elevacion GPX -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> Perfil de elevación GPX</span>
        </div>
        <div class="editor-section__body">
          <div id="ed-gpx-summary" style="${rd.elevationProfile ? '' : 'display:none'}; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem"${rd.elevationProfile ? ` data-distance="${rd.elevationProfile.distance}"` : ''}>
            ${rd.elevationProfile ? `${rd.elevationProfile.distance} km &middot; +${rd.elevationProfile.elevationGain} m / -${rd.elevationProfile.elevationLoss} m &middot; ${rd.elevationProfile.points?.length ?? '?'} puntos` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem">
            <button class="btn btn--ghost" id="ed-gpx-btn">${rd.elevationProfile ? 'Reemplazar GPX' : 'Subir GPX'}</button>
            <button class="btn btn--ghost" id="ed-gpx-del" style="font-size:0.8rem;color:var(--red);${rd.elevationProfile ? '' : 'display:none'}">Borrar</button>
            <a class="btn btn--ghost u-fs-082" id="ed-gpx-view" href="/panel/perfil.html?id=${rd.id}" target="_blank" rel="noopener" style="${rd.elevationProfile ? '' : 'display:none'}">Ver perfil ↗</a>
            <button class="btn btn--ghost u-fs-082" id="ed-gpx-png" style="${rd.elevationProfile ? '' : 'display:none'}" title="Exportar el miniperfil (solo iconos) a PNG con fondo transparente"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.3em"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar PNG</button>
            <span class="u-fs-md u-c-muted" id="ed-gpx-status"></span>
          </div>
          <label id="ed-profile-not-viewable-label" style="display:${rd.elevationProfile ? 'flex' : 'none'};align-items:center;gap:0.45rem;margin-top:0.5rem;cursor:pointer;font-size:0.82rem;color:var(--text-muted)">
            <input type="checkbox" id="ed-profile-not-viewable" ${rd.profileNotViewable ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer;accent-color:var(--red)">
            No visualizable en público
          </label>
        </div>
      </div>

      <!-- Digitalizador manual de perfiles desde una imagen -->
      <details class="editor-section editor-section--advanced" data-tab="perfil">
        <summary class="editor-section__header editor-advanced__summary">
          <span class="editor-section__title">Digitalizar perfil desde imagen</span>
          <span class="editor-advanced__hint">Clics + dos referencias de altitud</span>
        </summary>
        <div class="editor-section__body">
          <div id="ed-profile-digitizer" class="profile-digitizer"></div>
        </div>
      </details>

      <!-- Mapa interactivo del recorrido (Leaflet, opt-in) -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg> Mapa interactivo del recorrido</span>
        </div>
        <div class="editor-section__body">
          <div id="ed-map-summary" style="${rd.routeGpxUrl ? '' : 'display:none'};font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem">
            ${rd.routeGpxUrl ? 'Mapa activo · GPX en Storage' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
            <button class="btn btn--ghost" id="ed-map-btn">${rd.routeGpxUrl ? 'Reemplazar GPX del mapa' : 'Subir GPX del mapa'}</button>
            ${rd.routeGpxUrl ? `<button class="btn btn--ghost" id="ed-map-del" style="font-size:0.8rem;color:var(--red)">Quitar mapa</button>` : ''}
            ${rd.routeGpxUrl ? `<a class="btn btn--ghost u-fs-082" href="/mapa.html?id=${rd.id}" target="_blank" rel="noopener">Ver mapa ↗</a>` : ''}
            <span class="u-fs-md u-c-muted" id="ed-map-status"></span>
          </div>
        </div>
      </div>

      <!-- Puertos del perfil -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m2 20 4-9 4 5 4-7 4 11H2z"/></svg> Puertos del perfil</span>
        </div>
        <div class="editor-section__body">
          <div class="ann-row ann-row--header" aria-hidden="true">
            <span class="ann-km">km cima</span>
            <span class="ann-alt">alt (m)</span>
            <span class="ann-name--wide">Nombre</span>
            <span class="ann-cat">Cat.</span>
            <span class="ann-side">Etiq.</span>
            <span class="ann-start">km inicio</span>
            <span class="ann-foot-time">hora pie</span>
            <span class="ann-time">hora cima</span>
            <span class="ann-detect-placeholder"></span>
            <span class="ann-stats">long. · %</span>
            <span class="ann-del-placeholder"></span>
          </div>
          <div id="summitsList">${(rd.profileSummits || []).map(summitRowHTML).join('')}</div>
          <button class="btn btn--ghost" id="addSummitBtn" style="margin-top:0.5rem;font-size:0.82rem">+ Añadir puerto</button>
        </div>
      </div>

      <!-- Localidades del perfil -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> Localidades del perfil</span>
        </div>
        <div class="editor-section__body">
          <div class="ann-row ann-row--header" aria-hidden="true">
            <span class="u-w-time u-fs-xs u-c-muted">km</span>
            <span style="flex:1;font-size:0.72rem;color:var(--text-muted)">Nombre</span>
            <span style="width:12rem;font-size:0.72rem;color:var(--text-muted)">Tipo</span>
            <span style="width:5.5em;font-size:0.72rem;color:var(--text-muted)">hora</span>
            <span style="width:2rem"></span>
          </div>
          <div id="waypointsList">${(rd.profileWaypoints || []).filter(w => w.type !== 'kom').map(waypointRowHTML).join('')}</div>
          <button class="btn btn--ghost" id="addWaypointBtn" style="margin-top:0.5rem;font-size:0.82rem">+ Añadir localidad</button>
        </div>
      </div>

      <!-- Resultados UCI in-house (pestaña Resultados) -->
      <div class="editor-section" data-tab="resultados">
        <div class="editor-section__header">
          <span class="editor-section__title">Clasificaciones</span>
        </div>
        <div class="editor-section__body" id="ruSectionBody">
          <div style="color:var(--text-muted);font-size:0.8rem">Cargando clasificaciones…</div>
        </div>
      </div>

      <!-- Resultados externos (FC/PCS) -->
      ${(() => {
        const fcId     = race.fcId;
        const pcsSlug  = race.pcsSlug;
        const year     = race.year;
        const stageNum = rd.isRestDay ? null : (rd.stageNumber !== null && rd.stageNumber !== undefined ? rd.stageNumber : null);
        const isRest   = !!rd.isRestDay;

        const fcUrl = (!isRest && fcId && year)
          ? (stageNum !== null
              ? `https://firstcycling.com/race.php?r=${fcId}&y=${year}&e=${String(stageNum).padStart(2, '0')}`
              : `https://firstcycling.com/race.php?r=${fcId}&y=${year}`)
          : null;
        const pcsUrl = (!isRest && pcsSlug && year)
          ? (stageNum !== null
              ? (stageNum === 0
                  ? `https://www.procyclingstats.com/race/${pcsSlug}/${year}/prologue/result`
                  : `https://www.procyclingstats.com/race/${pcsSlug}/${year}/stage-${stageNum}/result`)
              : `https://www.procyclingstats.com/race/${pcsSlug}/${year}/result`)
          : null;

        const fcSearchQ   = encodeURIComponent((race.name || '') + (year ? ' ' + year : ''));
        const pcsSearchUrl = `https://www.google.com/search?q=site:procyclingstats.com+${fcSearchQ}`;

        // Enlaces automáticos a resultados externos. Raramente se
        // tocan → colapsada por defecto vía <details> para despejar el form.
        const hasIds = fcId != null || (pcsSlug && pcsSlug !== '');
        return `<details class="editor-section editor-section--advanced" data-tab="resultados" ${hasIds ? 'open' : ''}>
          <summary class="editor-section__header editor-advanced__summary">
            <span class="editor-section__title">Enlaces automáticos</span>
          </summary>
          <div class="editor-section__body">
            <div class="field-row field-row--2">
              <div class="field">
                <label>ID FirstCycling (fcId)</label>
                <div class="u-row u-row--gap-sm">
                  <input class="u-grow" type="number" id="ed-fcId" value="${fcId != null ? fcId : ''}" placeholder="—" min="1">
                  ${fcUrl ? `<a href="${fcUrl}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost u-btn-mini">Abrir ↗</a>` : ''}
                  <a href="https://www.google.com/search?q=site:firstcycling.com+${fcSearchQ}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost u-btn-mini">Buscar ↗</a>
                </div>
              </div>
              <div class="field">
                <label>Slug ProCyclingStats (pcsSlug)</label>
                <div class="u-row u-row--gap-sm">
                  <input class="u-grow" type="text" id="ed-pcsSlug" value="${pcsSlug || ''}" placeholder="tour-de-france">
                  ${pcsUrl ? `<a href="${pcsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost u-btn-mini">Abrir ↗</a>` : ''}
                  <a href="${pcsSearchUrl}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost u-btn-mini">Buscar ↗</a>
                </div>
              </div>
            </div>
          </div>
        </details>`;
      })()}

      <div id="editorFeedback" style="margin-top:1rem"></div>
      <div style="height:3rem"></div>

    </div><!-- /editor-content -->
  `;

  // Guardar referencia al raceId actual
  area.dataset.raceId = rd.raceId || '';
  area.dataset.rdId   = rd.id;
  area.dataset.raceSlug = race.slug || '';
  area.dataset.raceYear = race.year || '';
  area.dataset.stageNumber = rd.stageNumber ?? '';
  area.dataset.raceDaySlug = rd.slug || '';

  // Título del drawer (cabecera fija): nombre de la carrera + etapa
  const _drawerTitle = document.getElementById('ccDrawer1Title');
  if (_drawerTitle) _drawerTitle.textContent = `${race.name || 'Jornada'}${editorStage ? ` · ${editorStage}` : ''}`;

  // Upload inline en campos de documentación (excluye live_text, siempre URL)
  area.querySelectorAll('.asset-url-input:not(.asset-url-input--live)').forEach(input => {
    attachInlineUpload(input, input.dataset.type);
  });

  // Boton de subida de GPX
  const _gpxBtn    = document.getElementById('ed-gpx-btn');
  const _gpxStatus = document.getElementById('ed-gpx-status');
  const _gpxSummary = document.getElementById('ed-gpx-summary');
  const _syncElevationProfileUi = profile => {
    if (_editorCache?.rdId === area.dataset.rdId) {
      _editorCache.rd = { ..._editorCache.rd, elevationProfile: profile };
    }
    if (profile) {
      _gpxSummary.textContent = `${profile.distance} km · +${profile.elevationGain} m / -${profile.elevationLoss} m · ${profile.points?.length ?? '?'} puntos`;
      _gpxSummary.dataset.distance = profile.distance;
      _gpxSummary.style.display = '';
      _gpxBtn.textContent = 'Reemplazar GPX';
      document.getElementById('ed-gpx-del').style.display = '';
      document.getElementById('ed-gpx-view').style.display = '';
      document.getElementById('ed-gpx-png').style.display = '';
      document.getElementById('ed-profile-not-viewable-label').style.display = 'flex';
      const elevInput = document.getElementById('ed-elev');
      if (elevInput) elevInput.value = profile.elevationGain ?? '';
    } else {
      _gpxSummary.style.display = 'none';
      _gpxSummary.textContent = '';
      delete _gpxSummary.dataset.distance;
      _gpxBtn.textContent = 'Subir GPX';
      document.getElementById('ed-gpx-del').style.display = 'none';
      document.getElementById('ed-gpx-view').style.display = 'none';
      document.getElementById('ed-gpx-png').style.display = 'none';
      document.getElementById('ed-profile-not-viewable-label').style.display = 'none';
      const elevInput = document.getElementById('ed-elev');
      if (elevInput) elevInput.value = '';
    }
  };
  if (_gpxBtn) {
    const _gpxFileIn = document.createElement('input');
    _gpxFileIn.type = 'file';
    _gpxFileIn.accept = '.gpx,application/gpx+xml,text/xml,application/xml';
    _gpxFileIn.addEventListener('change', () => {
      if (_gpxFileIn.files[0]) _gpxHandleUpload(_gpxFileIn.files[0], area.dataset.rdId, _gpxStatus, _gpxSummary, _gpxBtn, _syncElevationProfileUi);
      _gpxFileIn.value = '';
    });
    _gpxBtn.addEventListener('click', () => _gpxFileIn.click());
  }
  document.getElementById('ed-gpx-del')?.addEventListener('click', async () => {
    if (!await confirmDialog('Borrar el perfil de elevación de esta jornada?', { danger: true })) return;
    const { error } = await supabase.from('race_days').update({ elevationProfile: null }).eq('id', area.dataset.rdId);
    if (error) { showToast('Error al borrar: ' + error.message); return; }
    _syncElevationProfileUi(null);
    showToast('Perfil de elevacion borrado', 'success', 3000);
  });

  _profileDigitizerCleanup = mountProfileDigitizer({
    root: document.getElementById('ed-profile-digitizer'),
    distanceInput: document.getElementById('ed-km'),
    initialAssetUrl: (() => {
      const profileAsset = assets.find(asset => asset.type === 'profile' && (asset.url || asset.filePath));
      return profileAsset?.url || profileAsset?.filePath || null;
    })(),
    loadAssetData: async url => {
      if (!url.startsWith(R2_PUBLIC_BASE)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      }
      const request = buildProfileAssetDownloadRequest(R2_UPLOAD_FN, url);
      const response = await fetch(request.url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          ...await getAuthHeaders(),
          'x-action': 'download-profile',
          'x-filename': encodeURIComponent(request.filename),
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    },
    onSave: async profile => {
      const current = (_editorCache?.rdId === area.dataset.rdId) ? _editorCache.rd?.elevationProfile : rd.elevationProfile;
      if (current && !await confirmDialog('¿Reemplazar el perfil de elevación actual por el digitalizado?')) {
        throw new Error('Guardado cancelado.');
      }
      const { error } = await supabase.from('race_days').update({ elevationProfile: profile }).eq('id', area.dataset.rdId);
      if (error) throw error;
      _syncElevationProfileUi(profile);
      showToast('Perfil digitalizado guardado', 'success', 3000);
    },
  });

  // Boton de subida del GPX del MAPA interactivo (independiente del perfil).
  const _mapBtn     = document.getElementById('ed-map-btn');
  const _mapStatus  = document.getElementById('ed-map-status');
  const _mapSummary = document.getElementById('ed-map-summary');
  if (_mapBtn) {
    const _mapFileIn = document.createElement('input');
    _mapFileIn.type = 'file';
    _mapFileIn.accept = '.gpx,application/gpx+xml,text/xml,application/xml';
    _mapFileIn.addEventListener('change', () => {
      if (_mapFileIn.files[0]) _mapHandleUpload(_mapFileIn.files[0], area.dataset.rdId, _mapStatus, _mapSummary, _mapBtn);
      _mapFileIn.value = '';
    });
    _mapBtn.addEventListener('click', () => _mapFileIn.click());
  }
  const _mapDelExisting = document.getElementById('ed-map-del');
  if (_mapDelExisting) _wireMapDelete(_mapDelExisting, area.dataset.rdId, _mapSummary, _mapBtn);

  // Exportar el miniperfil "solo iconos" a PNG (cliente, canvas). Usa los datos
  // ya cargados en memoria; no relee Supabase. El render normal de la web no se
  // toca (el generador recibe iconsOnly:true sólo para este export).
  document.getElementById('ed-gpx-png')?.addEventListener('click', async () => {
    const cached = (_editorCache?.rdId === area.dataset.rdId) ? _editorCache.rd : rd;
    const profile = cached?.elevationProfile;
    if (!profile?.points?.length) { showToast('Esta jornada no tiene perfil', 'error', 3000); return; }

    const btn = document.getElementById('ed-gpx-png');
    const prevDisabled = btn.disabled;
    btn.disabled = true;
    try {
      const slug = s => String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const stagePart = (!cached.isRestDay && cached.stageNumber != null)
        ? `etapa-${cached.stageNumber}`
        : (cached.dateKey || '');
      const base = [slug(race.name), slug(stagePart)].filter(Boolean).join('-');
      const filename = (base ? `${base}-perfil` : 'perfil') + '.png';

      await exportElevationProfilePNG({
        profile,
        summits:        cached.profileSummits   || [],
        waypoints:      cached.profileWaypoints  || [],
        startLocation:  cached.startLocation     || '',
        finishLocation: cached.finishLocation    || '',
        color:          race.colorHex || null,
      }, { filename });
    } catch (err) {
      console.error(err);
      showToast('Error al exportar el PNG: ' + (err?.message || err), 'error', 4000);
    } finally {
      btn.disabled = prevDisabled;
    }
  });

  // Eventos del editor
  document.getElementById('ed-delete').addEventListener('click', deleteRaceDay);
  document.getElementById('ed-draft').addEventListener('click',   () => saveRaceDay('draft'));
  document.getElementById('ed-publish').addEventListener('click', () => saveRaceDay('published'));
  document.getElementById('ed-duplicate').addEventListener('click', duplicateRaceDay);
  document.getElementById('ed-changeRace').addEventListener('click', openRaceModal);
  document.getElementById('ed-startlist').addEventListener('click', () => {
    const raceId = document.getElementById('ed-startlist').dataset.raceId;
    if (!raceId) return;
    switchTab('startlists');
    openStartlistEditor(raceId);
  });
  document.getElementById('addBroadcastBtn').addEventListener('click', addBroadcastRow);

  document.getElementById('addSummitBtn').addEventListener('click', () => {
    document.getElementById('summitsList').insertAdjacentHTML('beforeend', summitRowHTML());
  });
  // Refresca el span "long. · %" de cada puerto ya cargado.
  document.querySelectorAll('#summitsList .ann-row').forEach(_refreshSummitStats);
  document.getElementById('addWaypointBtn').addEventListener('click', () => {
    document.getElementById('waypointsList').insertAdjacentHTML('beforeend', waypointRowHTML());
  });
  document.getElementById('summitsList').addEventListener('click', e => {
    const delBtn    = e.target.closest('.ann-del-btn');
    const detectBtn = e.target.closest('.ann-detect-btn');
    if (delBtn) {
      delBtn.closest('.ann-row').remove();
      return;
    }
    if (detectBtn) {
      const row = detectBtn.closest('.ann-row');
      _autoDetectSummitClimb(row);
    }
  });
  document.getElementById('summitsList').addEventListener('change', e => {
    const row = e.target.closest('.ann-row');
    if (!row) return;
    const pts = _editorCache?.rd?.elevationProfile?.points;
    const kmInput = e.target.closest('.ann-km');
    if (kmInput && pts?.length) {
      const altInput = row.querySelector('.ann-alt');
      const km = parseFloat(kmInput.value);
      if (altInput && altInput.value.trim() === '' && !isNaN(km)) {
        altInput.value = _interpolateElevation(km, pts);
      }
      // Si aún no se ha rellenado el inicio del puerto, lanzar detección automática.
      const startInput = row.querySelector('.ann-start');
      if (startInput && startInput.value.trim() === '' && !isNaN(km)) {
        _autoDetectSummitClimb(row, /*silent*/ true);
      }
    }
    _refreshSummitStats(row);
  });
  document.getElementById('waypointsList').addEventListener('click', e => {
    if (e.target.closest('.ann-del-btn')) e.target.closest('.ann-row').remove();
  });
  document.getElementById('waypointsList').addEventListener('change', e => {
    const typeSelect = e.target.closest('.ann-type');
    if (!typeSelect) return;
    const row = typeSelect.closest('.ann-row');
    const lenInput = row?.querySelector('.ann-len');
    if (!lenInput) return;
    const show = typeSelect.value === 'cobblestone' || typeSelect.value === 'sterrato';
    lenInput.style.display = show ? '' : 'none';
    if (!show) lenInput.value = '';
  });

  // Autocompletado de país para el override de jornada
  attachCountryAutocomplete(document.getElementById('ed-country'));

  // Enter en campos de texto/hora/url → Publicar / Actualizar
  ['ed-stage', 'ed-start', 'ed-finish', 'ed-km', 'ed-elev',
   'ed-slug', 'ed-startTime', 'ed-finishTime',
   'ed-bonuses', 'ed-notes', 'ed-fcId', 'ed-pcsSlug',
   'ed-bonuses-en', 'ed-notes-en'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRaceDay('published');
      }
    });
  });

  // Enter en campos dinámicos (broadcasts, assets, puertos y localidades) → Publicar / Actualizar
  document.getElementById('broadcastsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('editorArea')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.asset-url-input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('summitsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('waypointsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });

  // Jornada de descanso / cancelada — adaptar campos y pestañas
  const restDayCb     = document.getElementById('ed-isRestDay');
  const cancelledDayCb = document.getElementById('ed-isCancelledDay');
  const restDayIds = ['ed-stage', 'ed-finish', 'ed-km', 'ed-elev', 'ed-type', 'ed-type2',
                      'ed-startTime', 'ed-finishTime', 'ed-tvStatus'];

  function applyDayModeState() {
    const isRest      = restDayCb.checked;
    const isCancelled = cancelledDayCb?.checked || false;

    // Campos incompatibles con rest day
    restDayIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = isRest;
      el.closest('.field')?.style.setProperty('opacity', isRest ? '0.4' : '1');
    });
    if (isRest) document.getElementById('ed-stage').value = '';

    // Pestañas a ocultar según modo
    const hiddenTabs = new Set();
    if (isRest) { hiddenTabs.add('tv'); hiddenTabs.add('perfil'); hiddenTabs.add('resultados'); }
    if (isCancelled) hiddenTabs.add('tv');

    document.querySelectorAll('#editorTabs .editor-tab').forEach(tab => {
      tab.hidden = hiddenTabs.has(tab.dataset.target);
    });

    // Si la pestaña activa se acaba de ocultar, saltar a General
    const activeTab = document.querySelector('#editorTabs .editor-tab--active');
    if (activeTab && activeTab.hidden) {
      document.querySelector('#editorTabs .editor-tab[data-target="general"]')?.click();
    }
  }

  applyDayModeState();
  restDayCb.addEventListener('change', applyDayModeState);
  cancelledDayCb?.addEventListener('change', applyDayModeState);

  // Slug jornada — generación automática y botón Auto
  function buildSlugSuggestion() {
    const raceName = (race.name || '').trim();
    const stageVal = document.getElementById('ed-stage').value.trim();
    const dateVal  = document.getElementById('ed-date').value.trim();
    const year     = dateVal ? dateVal.slice(0, 4) : (race.year ? String(race.year) : '');
    const baseRace = toSlug(raceName);
    if (stageVal !== '') {
      const n = parseInt(stageVal, 10);
      const stageStr = n === 0 ? 'prologo' : `etapa-${n}`;
      return (year ? `${baseRace}-${year}-${stageStr}` : `${baseRace}-${stageStr}`).slice(0, 80);
    }
    return (year ? `${baseRace}-${year}` : baseRace).slice(0, 80);
  }

  function applyAutoSlug() {
    const slugInput = document.getElementById('ed-slug');
    if (!slugInput.dataset.auto) return;
    slugInput.value = buildSlugSuggestion();
    document.getElementById('ed-slug-error').style.display = 'none';
  }

  // Generar slug base al abrir si la jornada es nueva
  const slugInputInit = document.getElementById('ed-slug');
  if (slugInputInit.dataset.auto && !slugInputInit.value) applyAutoSlug();

  document.getElementById('ed-slug-suggest').addEventListener('click', () => {
    const slugInput = document.getElementById('ed-slug');
    slugInput.value = buildSlugSuggestion();
    slugInput.dataset.auto = '1';
    document.getElementById('ed-slug-error').style.display = 'none';
  });
  document.getElementById('ed-slug').addEventListener('input', e => {
    delete e.target.dataset.auto;
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('ed-slug-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  document.getElementById('ed-stage').addEventListener('input', applyAutoSlug);
  document.getElementById('ed-date').addEventListener('change', applyAutoSlug);

  // Slug EN — generación automática y botón Auto
  function buildSlugEnSuggestion() {
    const raceName = (race.nameEn || race.name || '').trim();
    const stageVal = document.getElementById('ed-stage').value.trim();
    const dateVal  = document.getElementById('ed-date').value.trim();
    const year     = dateVal ? dateVal.slice(0, 4) : (race.year ? String(race.year) : '');
    const baseRace = toSlug(raceName);
    if (stageVal !== '') {
      const n = parseInt(stageVal, 10);
      const stageStr = n === 0 ? 'prologue' : `stage-${n}`;
      return (year ? `${baseRace}-${year}-${stageStr}` : `${baseRace}-${stageStr}`).slice(0, 80);
    }
    return (year ? `${baseRace}-${year}` : baseRace).slice(0, 80);
  }

  function applyAutoSlugEn() {
    const slugEnInput = document.getElementById('ed-slug-en');
    if (!slugEnInput.dataset.auto) return;
    slugEnInput.value = buildSlugEnSuggestion();
    document.getElementById('ed-slug-en-error').style.display = 'none';
  }

  const slugEnInputInit = document.getElementById('ed-slug-en');
  if (slugEnInputInit.dataset.auto && !slugEnInputInit.value) applyAutoSlugEn();

  document.getElementById('ed-slug-en-suggest').addEventListener('click', () => {
    const slugEnInput = document.getElementById('ed-slug-en');
    slugEnInput.value = buildSlugEnSuggestion();
    slugEnInput.dataset.auto = '1';
    document.getElementById('ed-slug-en-error').style.display = 'none';
  });
  document.getElementById('ed-slug-en').addEventListener('input', e => {
    delete e.target.dataset.auto;
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('ed-slug-en-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  document.getElementById('ed-stage').addEventListener('input', applyAutoSlugEn);
  document.getElementById('ed-date').addEventListener('change', applyAutoSlugEn);

  // Ciudades EN — auto-copia desde castellano mientras el campo EN no se haya editado manualmente
  document.getElementById('ed-start').addEventListener('input', () => {
    const enInput = document.getElementById('ed-start-en');
    if (enInput.dataset.auto) enInput.value = document.getElementById('ed-start').value;
  });
  document.getElementById('ed-finish').addEventListener('input', () => {
    const enInput = document.getElementById('ed-finish-en');
    if (enInput.dataset.auto) enInput.value = document.getElementById('ed-finish').value;
  });
  document.getElementById('ed-start-en').addEventListener('input', e => { delete e.target.dataset.auto; });
  document.getElementById('ed-finish-en').addEventListener('input', e => { delete e.target.dataset.auto; });

  // Barra de herramientas Markdown + atajos de teclado
  initMdToolbar('md-toolbar', 'ed-description');
  initMdToolbar('md-toolbar-en', 'ed-description-en', 'ed-description-en-wysiwyg');

  // Pestañas del editor
  setupEditorTabs();

  // Sección Documentación: selector dinámico para añadir/quitar tipos
  setupAssetsSection();

  // Sección Orden de Salida (solo CRI/CRE)
  if (rd.primaryType === 'itt' || rd.primaryType === 'ttt') setupStartOrderSection(rd);

  // Pestaña Resultados: clasificaciones UCI in-house (carga async)
  if (!rd.isRestDay) setupUciResultsSection(rd, race);

  // Toggles ES/EN por sección
  setupLangToggles();
}

// Cada `.lang-pair` tiene un botón `.lang-toggle` que alterna entre los
// idiomas mostrando/ocultando los `.lang-field--es` y `.lang-field--en`
// dentro del mismo contenedor. El botón muestra el idioma al que se va a
// cambiar (en modo ES, dice "EN", y viceversa).
function setupLangToggles() {
  document.querySelectorAll('.lang-pair').forEach(pair => {
    const btn = pair.querySelector(':scope > .lang-pair__header .lang-toggle')
             || pair.querySelector(':scope > .editor-section__header .lang-toggle')
             || pair.querySelector('.lang-toggle');
    if (!btn) return;
    const update = () => {
      const current = pair.dataset.lang || 'es';
      btn.textContent = current === 'es' ? 'EN' : 'ES';
      btn.dataset.langTarget = current;
    };
    btn.addEventListener('click', () => {
      pair.dataset.lang = (pair.dataset.lang === 'en') ? 'es' : 'en';
      update();
    });
    update();
  });
}

// Activación de pestañas del editor.
// La pestaña activa se persiste en localStorage para que al volver al editor
// el usuario caiga donde estaba.
function setupEditorTabs() {
  const tabs = document.querySelectorAll('#editorTabs .editor-tab');
  if (tabs.length === 0) return;
  const saved = localStorage.getItem('panel_editorTab');
  const savedTab = saved ? document.querySelector(`#editorTabs .editor-tab[data-target="${saved}"]`) : null;
  const initial = savedTab && !savedTab.hidden ? saved : 'general';
  const activate = (target, { persist = true } = {}) => {
    const targetTab = document.querySelector(`#editorTabs .editor-tab[data-target="${target}"]`);
    let effective = target;
    let fallbackApplied = false;
    if (targetTab?.hidden) { effective = 'general'; fallbackApplied = true; }
    tabs.forEach(t => t.classList.toggle('editor-tab--active', t.dataset.target === effective));
    document.querySelectorAll('.editor-section[data-tab]').forEach(sec => {
      sec.style.display = sec.dataset.tab === effective ? '' : 'none';
    });
    if (persist && !fallbackApplied) localStorage.setItem('panel_editorTab', effective);
  };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.target));
  });
  activate(initial, { persist: false });
}

// ── Markdown → HTML (para cargar contenido inicial en el WYSIWYG) ──
function markdownToHtml(md) {
  if (!md) return '';
  const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline  = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,         '<u>$1</u>')
    .replace(/\*(.+?)\*/g,       '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  const lines = md.split('\n');
  const out   = [];
  let inUl = false, inBq = false;
  const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false; } };
  const closeBq = () => { if (inBq) { out.push('</blockquote>'); inBq = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^---+$/.test(line))       { closeUl(); closeBq(); out.push('<hr>'); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { closeUl(); closeBq(); out.push(`<h2>${inline(escHtml(h2[1]))}</h2>`); continue; }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { closeUl(); closeBq(); out.push(`<h3>${inline(escHtml(h3[1]))}</h3>`); continue; }
    const bq = line.match(/^>\s?(.*)/);
    if (bq) { closeUl(); if (!inBq) { out.push('<blockquote>'); inBq = true; } out.push(`<p>${inline(escHtml(bq[1]))}</p>`); continue; }
    closeBq();
    const li = line.match(/^-\s+(.*)/);
    if (li) { if (!inUl) { out.push('<ul>'); inUl = true; } out.push(`<li>${inline(escHtml(li[1]))}</li>`); continue; }
    closeUl();
    // En Markdown una línea vacía separa párrafos; no es un párrafo editable
    // adicional. Los <p> reales se volverán a serializar con \n\n al guardar.
    if (line.trim() === '') continue;
    out.push(`<p>${inline(escHtml(line))}</p>`);
  }
  closeUl(); closeBq();
  return out.join('');
}

// ── HTML → Markdown (serializa el contenido del WYSIWYG al guardar) ─
function htmlToMarkdown(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  function markdownWrap(marker, value) { const a=value.match(/^[\s\u00A0]+/)?.[0]||'', z=value.match(/[\s\u00A0]+$/)?.[0]||'', c=value.slice(a.length,value.length-z.length); return c ? `${a}${marker}${c}${marker}${z}` : value; }

  function walk(nodes) {
    let out = '';
    for (const n of nodes) {
      if (n.nodeType === 3) { out += n.textContent; continue; }
      if (n.nodeType !== 1) continue;
      const tag   = n.tagName.toLowerCase();
      const inner = walk(n.childNodes);
      switch (tag) {
        case 'strong': case 'b': out += markdownWrap('**', inner); break;
        case 'em':     case 'i': out += markdownWrap('*', inner);   break;
        case 'u':                  out += markdownWrap('__', inner); break;
        case 'a':      out += `[${inner}](${n.getAttribute('href') || ''})`; break;
        case 'h2':     out += `\n## ${inner}\n`; break;
        case 'h3':     out += `\n### ${inner}\n`; break;
        case 'p':      out += inner.replace(/[\u00A0\s]/g, '') === '' ? '\n\n' : `${inner}\n\n`; break;
        case 'br':     out += '\n'; break;
        case 'hr':     out += '\n---\n'; break;
        case 'ul': case 'ol': out += walk(n.childNodes); break;
        case 'li':     out += `- ${inner}\n`; break;
        case 'blockquote': {
          const bqLines = inner.trim().split('\n').map(l => `> ${l}`);
          out += bqLines.join('\n') + '\n';
          break;
        }
        // Aunque pedimos <p> como separador por defecto, Safari y Chrome pueden
        // crear un <div> al pulsar Enter en un contenteditable nuevo. Es también
        // un bloque: serializarlo como párrafo evita que el salto se convierta
        // en una única nueva línea, que el renderizador público colapsa.
        case 'div':    out += inner ? `\n\n${inner}\n\n` : '\n\n'; break;
        default:       out += inner;
      }
    }
    return out;
  }

  return walk(div.childNodes).replace(/\n{3,}/g, '\n\n').trim();
}

// La fuente de verdad durante la edición es el contenteditable. Algunos
// navegadores no emiten `input` para todos los Enter, así que antes de guardar
// se serializa siempre desde él en vez de confiar solo en el textarea oculto.
function markdownFromEditor(wysiwygId, textareaId) {
  const wysiwyg = document.getElementById(wysiwygId);
  const textarea = document.getElementById(textareaId);
  if (!textarea) return '';
  if (wysiwyg) textarea.value = htmlToMarkdown(wysiwyg.innerHTML);
  return textarea.value;
}

// Markup de la barra de herramientas markdown. Idéntica para ES y EN salvo
// el id y los `title` localizados → un solo sitio para los SVG (antes
// duplicados literalmente). `initMdToolbar` (abajo) cablea los data-action.
function mdToolbarHtml(toolbarId, t = {}) {
  const SVG = {
    bold: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
    italic: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    ul: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    blockquote: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
  };
  return `<div class="md-toolbar" id="${toolbarId}">
    <button type="button" class="md-toolbar__btn" data-action="bold" title="${t.bold || 'Negrita (Cmd+B)'}">${SVG.bold}</button>
    <button type="button" class="md-toolbar__btn" data-action="italic" title="${t.italic || 'Cursiva (Cmd+I)'}">${SVG.italic}</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="h2" title="${t.h2 || 'Encabezado H2'}">H2</button>
    <button type="button" class="md-toolbar__btn" data-action="h3" title="${t.h3 || 'Encabezado H3'}">H3</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="ul" title="${t.ul || 'Lista'}">${SVG.ul}</button>
    <button type="button" class="md-toolbar__btn" data-action="blockquote" title="${t.blockquote || 'Cita'}">${SVG.blockquote}</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="hr" title="${t.hr || 'Separador horizontal'}">—</button>
  </div>`;
}

// ── Editor WYSIWYG ────────────────────────────────────────────────
function initMdToolbar(toolbarId, textareaId, wysiwygId) {
  const toolbar  = document.getElementById(toolbarId);
  const hidden   = document.getElementById(textareaId);          // textarea oculto (fuente markdown)
  const wysiwyg  = document.getElementById(wysiwygId || 'ed-description-wysiwyg');
  if (!toolbar || !hidden || !wysiwyg) return;

  // Cargar contenido inicial convertido a HTML
  wysiwyg.innerHTML = markdownToHtml(hidden.value);

  // Sincronizar WYSIWYG → markdown oculto en cada cambio
  wysiwyg.addEventListener('input', syncMarkdown);

  // Fallback: sincronizar al perder el foco (cubre casos donde input no dispara,
  // e.g. corrección ortográfica del SO, drag-and-drop, o IME composition)
  wysiwyg.addEventListener('blur', syncMarkdown);

  function syncMarkdown() { markdownFromEditor(wysiwyg.id, hidden.id); }
  function applyInlineFormat(tag) { const sel=window.getSelection(), r=sel?.rangeCount?sel.getRangeAt(0):null; if(!r||r.collapsed||!wysiwyg.contains(r.commonAncestorContainer)) return false; const w=document.createElement(tag); try { r.surroundContents(w); } catch (_) { const c=r.extractContents(); w.append(c); r.insertNode(w); } sel.removeAllRanges(); const n=document.createRange(); n.selectNodeContents(w); sel.addRange(n); return true; }
  function applyFormat(action) { wysiwyg.focus(); const tags={bold:'strong',italic:'em',underline:'u'}; if(tags[action]) { if(applyInlineFormat(tags[action])) syncMarkdown(); return; } switch(action) { case 'h2': document.execCommand('formatBlock',false,'h2'); break; case 'h3': document.execCommand('formatBlock',false,'h3'); break; case 'ul': document.execCommand('insertUnorderedList'); break; case 'blockquote': document.execCommand('formatBlock',false,'blockquote'); break; case 'hr': document.execCommand('insertHTML',false,'<hr>'); break; } syncMarkdown(); }

  // Listeners de la toolbar
  toolbar.querySelectorAll('.md-toolbar__btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // evita que el WYSIWYG pierda el foco/selección
      applyFormat(btn.dataset.action);
    });
  });

  // Párrafo por defecto: <p> en lugar de <div> o <br>.
  document.execCommand('defaultParagraphSeparator', false, 'p');

  // Atajos de teclado. El Enter queda en manos del navegador: así conserva
  // correctamente la selección y el historial de deshacer; el serializador
  // admite tanto <p> como el <div> que algunos navegadores puedan crear.
  wysiwyg.addEventListener('keydown', e => {
    const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;

    if (!mod) return;
    const map = { b: 'bold', i: 'italic', u: 'underline' };
    const action = map[e.key];
    if (!action) return;
    e.preventDefault();
    applyFormat(action);
  });
}


function _refreshSummitStats(row) {
  const stats = row?.querySelector('.ann-stats');
  if (!stats) return;
  const pts = _editorCache?.rd?.elevationProfile?.points;
  if (!pts?.length) { stats.textContent = ''; return; }
  const km    = parseFloat(row.querySelector('.ann-km')?.value);
  const start = parseFloat(row.querySelector('.ann-start')?.value);
  if (isNaN(km) || isNaN(start) || start >= km) { stats.textContent = ''; return; }
  const altRaw = row.querySelector('.ann-alt')?.value.trim();
  const altOverride = altRaw !== '' ? parseFloat(altRaw) : null;
  const r = computeClimbStats(pts, start, km, altOverride);
  if (!r) { stats.textContent = ''; return; }
  const sign = r.avgGradient >= 0 ? '' : '−';
  stats.textContent = `${r.lengthKm} km · ${sign}${Math.abs(r.avgGradient).toFixed(1)} %`;
}

function _autoDetectSummitClimb(row, silent = false) {
  const pts = _editorCache?.rd?.elevationProfile?.points;
  if (!pts?.length) {
    if (!silent) showToast('Sin perfil GPX para detectar', 'warning');
    return;
  }
  const km = parseFloat(row.querySelector('.ann-km')?.value);
  if (isNaN(km)) {
    if (!silent) showToast('Falta el km de la cima', 'warning');
    return;
  }
  const r = detectClimb(pts, km);
  if (!r) {
    if (!silent) showToast('No se detectó un puerto significativo', 'warning');
    return;
  }
  const startInput = row.querySelector('.ann-start');
  if (startInput) startInput.value = r.startKm;
  // Si el usuario no había puesto altitud manual, también se rellenará la altitud
  // del summit aprovechando el detector (que la interpola al pasar).
  const altInput = row.querySelector('.ann-alt');
  if (altInput && altInput.value.trim() === '') {
    altInput.value = _interpolateElevation(km, pts);
  }
  _refreshSummitStats(row);
}

function _interpolateElevation(km, pts) {
  if (km <= pts[0].km) return pts[0].alt;
  const last = pts[pts.length - 1];
  if (km >= last.km) return last.alt;
  for (let i = 0; i < pts.length - 1; i++) {
    if (km >= pts[i].km && km < pts[i + 1].km) {
      const t = (km - pts[i].km) / (pts[i + 1].km - pts[i].km);
      return Math.round(pts[i].alt + t * (pts[i + 1].alt - pts[i].alt));
    }
  }
  return last.alt;
}

function summitRowHTML(s = {}) {
  const esc = v => String(v ?? '').replace(/"/g, '&quot;');
  // 'M' = puerto sin categorización oficial (se renderiza con icono de
  // montaña en el SVG, sin número).
  const catOpts = ['HC','1','2','3','4','M'].map(c =>
    `<option value="${c}"${(s.category ?? 'HC') === c ? ' selected' : ''}>${c}</option>`
  ).join('');
  return `<div class="ann-row">
    <input type="number" class="ann-km"  placeholder="km"  min="0" step="0.1" value="${esc(s.km  ?? '')}">
    <input type="number" class="ann-alt" placeholder="alt" min="0" step="1"   value="${esc(s.altitude ?? '')}">
    <input type="text"   class="ann-name ann-name--wide" placeholder="Nombre del puerto" value="${esc(s.name ?? '')}">
    <select class="ann-cat">${catOpts}</select>
    <select class="ann-side">
      <option value="left" ${(!s.side || s.side === 'left')  ? 'selected' : ''}>Izda</option>
      <option value="right"${s.side === 'right'              ? ' selected' : ''}>Dcha</option>
    </select>
    <input type="number" class="ann-start" placeholder="auto" min="0" step="0.1" value="${esc(s.startKm ?? '')}"
           title="km de inicio del puerto (vacío = sin pintar tramo)">
    <input type="time" class="ann-foot-time" value="${esc(s.footTimeUtc ? formatTimeHHMM(s.footTimeUtc) : '')}"
           title="Hora de paso por el PIE del puerto (rutómetro). Vacío = se estima.">
    <input type="time" class="ann-time" value="${esc(s.timeUtc ? formatTimeHHMM(s.timeUtc) : '')}"
           title="Hora de paso por la CIMA (rutómetro). Vacío = se estima.">
    <button type="button" class="btn btn--ghost ann-detect-btn"
            style="padding:0.2rem 0.45rem;font-size:0.7rem;flex-shrink:0"
            title="Detectar inicio del puerto a partir del km de la cima">⌖</button>
    <span class="ann-stats"></span>
    <button type="button" class="btn btn--danger ann-del-btn" style="padding:0.2rem 0.5rem;font-size:0.7rem;flex-shrink:0">✕</button>
  </div>`;
}

function waypointRowHTML(w = {}) {
  const esc = v => String(v ?? '').replace(/"/g, '&quot;');
  const typeOpts = [
    ['town',                'Localidad'],
    ['intermediate_sprint', 'Sprint Intermedio'],
    ['bonus_sprint',        'Sprint Bonificación'],
    ['intermediate_split',  'Punto intermedio'],
    ['cobblestone',         'Pavé / Adoquín'],
    ['sterrato',            'Sterrato'],
  ].map(([v, l]) => `<option value="${v}"${(w.type ?? 'town') === v ? ' selected' : ''}>${l}</option>`).join('');
  const isCobSter = w.type === 'cobblestone' || w.type === 'sterrato';
  return `<div class="ann-row">
    <input type="number" class="ann-km"  placeholder="km" min="0" step="0.1" value="${esc(w.km ?? '')}">
    <input type="number" class="ann-len" placeholder="long.km" min="0.1" step="0.1"
           ${isCobSter ? '' : 'style="display:none"'} value="${esc(w.lengthKm ?? '')}">
    <input type="text"   class="ann-name ann-name--wide" placeholder="Nombre" value="${esc(w.name ?? '')}">
    <select class="ann-type u-shrink-0">${typeOpts}</select>
    <input type="time" class="ann-time" value="${esc(w.timeUtc ? formatTimeHHMM(w.timeUtc) : '')}"
           title="Hora de paso (rutómetro). Vacío = se estima.">
    <button type="button" class="btn btn--danger ann-del-btn" style="padding:0.2rem 0.5rem;font-size:0.7rem;flex-shrink:0">✕</button>
  </div>`;
}

function broadcastHTML(b, i) {
  return `<div class="tv-entry-panel" data-bid="${b.id || ''}">
    <div class="tv-entry-panel__header">
      <span class="tv-entry-panel__label">Emisión ${i + 1}</span>
      <div style="display:flex;gap:0.25rem;align-items:center">
        <button class="btn btn--ghost move-broadcast-up-btn"
                style="padding:0.2rem 0.4rem;font-size:0.7rem" title="Subir">↑</button>
        <button class="btn btn--ghost move-broadcast-down-btn"
                style="padding:0.2rem 0.4rem;font-size:0.7rem" title="Bajar">↓</button>
        <button class="btn btn--danger remove-broadcast-btn"
                style="padding:0.2rem 0.5rem;font-size:0.7rem">✕ Eliminar</button>
      </div>
    </div>
    <div class="field">
      <label>Canal</label>
      <input type="text" class="bc-channel" value="${b.channel || b.platform || ''}" placeholder="Movistar LaLiga, DAZN 1…">
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Hora (opcional)</label>
        <input type="time" class="bc-time" value="${b.startTimeUtc ? formatTimeHHMM(b.startTimeUtc) : ''}">
      </div>
      <div class="field">
        <label>URL (opcional)</label>
        <input type="url" class="bc-url" value="${b.url || ''}" placeholder="https://…">
        ${b.embeddable === false ? `<div class="field-hint" style="color:#c97a00;font-size:0.75rem;margin-top:0.25rem">⚠ Embed deshabilitado en YouTube — se abrirá en una pestaña nueva.</div>` : ''}
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nota (opcional)</label>
        <input type="text" class="bc-note" value="${b.note || ''}" placeholder="—">
      </div>
      <div class="field">
        <label>Grupo de país</label>
        <select class="bc-country">
          <option value="">— Sin asignar</option>
          <option value="ALL"${b.country === 'ALL' ? ' selected' : ''}>ALL — Mundial (YouTube oficial)</option>
          <optgroup label="Europa">
            <option value="EUROPA"${b.country === 'EUROPA' ? ' selected' : ''}>EUROPA — Pan-europeo (Eurosport / HBO Max)</option>
            <option value="ES"${b.country === 'ES' ? ' selected' : ''}>ES — España</option>
            <option value="PT"${b.country === 'PT' ? ' selected' : ''}>PT — Portugal</option>
            <option value="FR"${b.country === 'FR' ? ' selected' : ''}>FR — Francia</option>
            <option value="BE"${b.country === 'BE' ? ' selected' : ''}>BE — Bélgica</option>
            <option value="NL"${b.country === 'NL' ? ' selected' : ''}>NL — Países Bajos</option>
            <option value="IT"${b.country === 'IT' ? ' selected' : ''}>IT — Italia</option>
            <option value="DE_AT_CH"${b.country === 'DE_AT_CH' ? ' selected' : ''}>DE_AT_CH — Alemania / Austria / Suiza</option>
            <option value="UK_IE"${b.country === 'UK_IE' ? ' selected' : ''}>UK_IE — Reino Unido / Irlanda</option>
            <option value="SCANDI"${b.country === 'SCANDI' ? ' selected' : ''}>SCANDI — Nórdicos</option>
            <option value="EE"${b.country === 'EE' ? ' selected' : ''}>EE — Europa del Este</option>
          </optgroup>
          <optgroup label="Resto del mundo">
            <option value="LATAM"${b.country === 'LATAM' ? ' selected' : ''}>LATAM — América Latina</option>
            <option value="NORTEAM"${b.country === 'NORTEAM' ? ' selected' : ''}>NORTEAM — EE.UU. / Canadá</option>
            <option value="ASIAPAC"${b.country === 'ASIAPAC' ? ' selected' : ''}>ASIAPAC — Asia / Pacífico</option>
            <option value="AFRICA"${b.country === 'AFRICA' ? ' selected' : ''}>AFRICA — África subsahariana</option>
            <option value="MENA"${b.country === 'MENA' ? ' selected' : ''}>MENA — Oriente Medio / Norte de África</option>
          </optgroup>
        </select>
      </div>
    </div>
    <div class="field" style="display:flex;align-items:center;gap:0.5rem;padding-top:0.25rem">
      <input type="checkbox" class="bc-show-in-revive" id="bc-revive-${b.id || i}"${b.showInRevive ? ' checked' : ''}>
      <label for="bc-show-in-revive-${b.id || i}" style="margin:0;font-weight:normal;cursor:pointer">Mostrar en "Revive"</label>
    </div>
  </div>`;
}

function addBroadcastRow() {
  const list = document.getElementById('broadcastsList');
  const count = list.querySelectorAll('.tv-entry-panel').length;
  const tmp = document.createElement('div');
  tmp.innerHTML = broadcastHTML({}, count);
  list.appendChild(tmp.firstElementChild);
  const newEl = list.lastElementChild;
  bindRemoveBroadcast(newEl);
  bindMoveBroadcast(newEl);
}

function moveBroadcastRow(el, direction) {
  const list = el.parentElement;
  if (direction === 'up' && el.previousElementSibling) {
    list.insertBefore(el, el.previousElementSibling);
  } else if (direction === 'down' && el.nextElementSibling) {
    list.insertBefore(el.nextElementSibling, el);
  }
  updateBroadcastLabels();
}

function updateBroadcastLabels() {
  document.querySelectorAll('.tv-entry-panel').forEach((panel, i) => {
    const label = panel.querySelector('.tv-entry-panel__label');
    if (label) label.textContent = `Emisión ${i + 1}`;
  });
}

function bindRemoveBroadcast(el) {
  el.querySelector('.remove-broadcast-btn').addEventListener('click', () => {
    el.remove();
    updateBroadcastLabels();
  });
}

function bindMoveBroadcast(el) {
  el.querySelector('.move-broadcast-up-btn').addEventListener('click', () => moveBroadcastRow(el, 'up'));
  el.querySelector('.move-broadcast-down-btn').addEventListener('click', () => moveBroadcastRow(el, 'down'));
}

// Bind existing remove buttons after render
function bindAllRemoveBroadcasts() {
  document.querySelectorAll('.tv-entry-panel').forEach(panel => {
    panel.querySelector('.remove-broadcast-btn').addEventListener('click', () => {
      panel.remove();
      updateBroadcastLabels();
    });
    panel.querySelector('.move-broadcast-up-btn').addEventListener('click', () => moveBroadcastRow(panel, 'up'));
    panel.querySelector('.move-broadcast-down-btn').addEventListener('click', () => moveBroadcastRow(panel, 'down'));
  });
}

// ── Guardar jornada ───────────────────────────────────────────────
async function saveRaceDay(status) {
  if (_raceDaySaveInFlight) return;
  setRaceDaySaveInFlight(true);

  const area    = document.getElementById('editorArea');
  const rdId    = area.dataset.rdId;
  const raceId  = area.dataset.raceId;
  const feedback = document.getElementById('editorFeedback');

  const dateKey = document.getElementById('ed-date').value;

  // Validar slug
  const slugVal = document.getElementById('ed-slug').value.trim();
  const slugErr = validateSlug(slugVal);
  if (slugErr) {
    const el = document.getElementById('ed-slug-error');
    el.textContent = slugErr;
    el.style.display = 'block';
    document.getElementById('ed-slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRaceDaySaveInFlight(false);
    return;
  }

  // Validación básica para publicar: solo fecha y carrera asociada
  if (status === 'published') {
    const required = {
      'Fecha':   dateKey,
      'Carrera': raceId,
    };
    const missing = Object.entries(required).filter(([,v]) => !v).map(([k]) => k);
    if (missing.length) {
      showToast('Faltan campos obligatorios: ' + missing.join(', '));
      setRaceDaySaveInFlight(false);
      return;
    }
  }

  // hidden.value is kept in sync by initMdToolbar (input, keydown, blur listeners).

  // Recoger anotaciones del perfil
  const _distanceKm = parseFloat(document.getElementById('ed-km').value) || null;

  // Desnivel manual: edita elevationProfile.elevationGain (lo que muestran web y
  // apps). Tres casos, partiendo SIEMPRE del perfil actual en caché (que ya
  // refleja cualquier GPX subido/borrado en esta sesión, ya que esos flujos
  // escriben directamente en _editorCache.rd.elevationProfile):
  //   1. Hay perfil (GPX) → preservar points/distance/etc. y solo fijar el gain.
  //   2. No hay perfil y hay valor → crear uno mínimo VÁLIDO. iOS exige
  //      `distance` y `points` no-opcionales en su Codable: sin ellos el decode
  //      rompe y la jornada deja de cargar. Por eso distance + points:[].
  //      points:[] hace que la silueta no se pinte (gate >= 2 puntos) → solo
  //      sale el número "+X m", que es justo lo deseado sin GPX.
  //   3. No hay perfil y vacío → null (queda vacío como en la DB).
  const _elevRaw  = document.getElementById('ed-elev')?.value.trim() ?? '';
  const _elevGain = _elevRaw !== '' && Number.isFinite(parseFloat(_elevRaw))
    ? Math.round(parseFloat(_elevRaw))
    : null;
  const _existingProfile = _editorCache?.rd?.elevationProfile ?? null;
  let _elevationProfile;
  if (_existingProfile) {
    _elevationProfile = { ..._existingProfile, elevationGain: _elevGain };
  } else if (_elevGain != null) {
    _elevationProfile = {
      distance:      _distanceKm ?? 0,
      elevationGain: _elevGain,
      elevationLoss: null,
      minElevation:  null,
      maxElevation:  null,
      points:        [],
    };
  } else {
    _elevationProfile = null;
  }

  const profileSummits = [...document.querySelectorAll('#summitsList .ann-row')].reduce((acc, row) => {
    const km    = row.querySelector('.ann-km').value.trim();
    const alt   = row.querySelector('.ann-alt').value.trim();
    const name  = row.querySelector('.ann-name').value.trim();
    const start = row.querySelector('.ann-start')?.value.trim() ?? '';
    // km es obligatorio: una fila sin km rompe el decode de las apps (Swift/Kotlin
    // esperan Double no-opcional). Descartamos también filas totalmente vacías.
    if (km === '' || !Number.isFinite(parseFloat(km))) return acc;
    if (!km && !name) return acc;
    const kmNum    = parseFloat(km);
    const startNum = start !== '' ? parseFloat(start) : null;
    // El startKm sólo tiene sentido si es estrictamente menor que el km de la cima.
    const validStart = (startNum != null && startNum < kmNum) ? startNum : null;
    const timeVal  = row.querySelector('.ann-time')?.value.trim() ?? '';
    const footVal  = row.querySelector('.ann-foot-time')?.value.trim() ?? '';
    acc.push({
      km:        kmNum,
      altitude:  alt !== '' ? parseInt(alt) : null,
      name:      name || null,
      category:  row.querySelector('.ann-cat').value,
      side:      row.querySelector('.ann-side').value,
      ...(validStart != null ? { startKm: validStart } : {}),
      ...(timeVal ? { timeUtc: toTimestamp(dateKey, timeVal) } : {}),
      // footTimeUtc solo tiene sentido si hay startKm (pie del puerto)
      ...(footVal && validStart != null ? { footTimeUtc: toTimestamp(dateKey, footVal) } : {}),
    });
    return acc;
  }, []);

  const profileWaypoints = [...document.querySelectorAll('#waypointsList .ann-row')].reduce((acc, row) => {
    const km   = row.querySelector('.ann-km').value.trim();
    const name = row.querySelector('.ann-name').value.trim();
    // Mismo motivo que en summits: km es obligatorio para que las apps decodifiquen bien.
    if (km === '' || !Number.isFinite(parseFloat(km))) return acc;
    if (!km && !name) return acc;
    const type   = row.querySelector('.ann-type').value;
    const lenRaw = row.querySelector('.ann-len')?.value.trim();
    const timeVal = row.querySelector('.ann-time')?.value.trim() ?? '';
    const obj = {
      km:   parseFloat(km),
      name: name || null,
      type,
    };
    if ((type === 'cobblestone' || type === 'sterrato') && lenRaw) {
      obj.lengthKm = parseFloat(lenRaw);
    }
    if (timeVal) obj.timeUtc = toTimestamp(dateKey, timeVal);
    acc.push(obj);
    return acc;
  }, []);

  const kmSort = (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity);
  profileSummits.sort(kmSort);
  profileWaypoints.sort(kmSort);

  // Validar km dentro de [0, distancia]
  // Usar el máximo entre el campo manual y la distancia real del GPX para evitar
  // falsos positivos cuando el GPX mide ligeramente más que el kilometraje nominal.
  // Tolerancia de 0.1 km (100 m) para absorber redondeos típicos entre el km
  // nominal de las fuentes y la medición real del GPX (p.ej. cima a 12.73 en
  // una etapa de 12.7 km).
  const _gpxDistance = parseFloat(document.getElementById('ed-gpx-summary')?.dataset.distance) || null;
  const _maxKm = (_distanceKm != null && _gpxDistance != null)
    ? Math.max(_distanceKm, _gpxDistance)
    : (_distanceKm ?? _gpxDistance);
  const _kmTolerance = 0.1;
  if (_maxKm != null) {
    const _limit = _maxKm + _kmTolerance;
    const outOfRange = [...profileSummits, ...profileWaypoints].find(
      a => a.km != null && (a.km < -_kmTolerance || a.km > _limit)
    );
    if (outOfRange) {
      showToast(`km ${outOfRange.km} fuera de rango [0, ${_maxKm}] (tolerancia ±${_kmTolerance})`);
      setRaceDaySaveInFlight(false);
      return;
    }
    const startOutOfRange = profileSummits.find(
      s => s.startKm != null && (s.startKm < -_kmTolerance || s.startKm > _limit)
    );
    if (startOutOfRange) {
      showToast(`km inicio ${startOutOfRange.startKm} fuera de rango [0, ${_maxKm}] (tolerancia ±${_kmTolerance})`);
      setRaceDaySaveInFlight(false);
      return;
    }
  }

  // No depender de que el navegador haya emitido `input` al pulsar Enter.
  const descriptionMarkdown = markdownFromEditor('ed-description-wysiwyg', 'ed-description');

  const data = {
    raceId,
    dateKey,
    date: dateKey,
    slug:                 slugVal || null,
    isRestDay:            document.getElementById('ed-isRestDay')?.checked || false,
    isCancelledDay:       document.getElementById('ed-isCancelledDay')?.checked || false,
    stageNumber:          document.getElementById('ed-isRestDay')?.checked ? null : (document.getElementById('ed-stage').value !== '' ? parseInt(document.getElementById('ed-stage').value) : null),
    startLocation:        document.getElementById('ed-start').value.trim(),
    finishLocation:       document.getElementById('ed-finish').value.trim(),
    startLocationEn:      document.getElementById('ed-start-en')?.value.trim() || null,
    finishLocationEn:     document.getElementById('ed-finish-en')?.value.trim() || null,
    slugEn:               document.getElementById('ed-slug-en')?.value.trim() || null,
    countryCode:          document.getElementById('ed-country').value.trim() || null,
    distanceKm:           _distanceKm,
    elevationProfile:     _elevationProfile,
    primaryType:          document.getElementById('ed-type').value || null,
    secondaryType:        document.getElementById('ed-type2').value || null,
    neutralStartTimeUtc:  toTimestamp(dateKey, document.getElementById('ed-startTime').value),
    estimatedFinishTimeUtc: toTimestamp(dateKey, document.getElementById('ed-finishTime').value),
    tvStatus:             document.getElementById('ed-tvStatus').value || null,
    description:          descriptionMarkdown.trim(),
    bonuses:              document.getElementById('ed-bonuses').value.trim(),
    notes:                document.getElementById('ed-notes').value.trim(),
    editorialStatus:      status,
    updatedAt:            new Date().toISOString(),
    profileSummits:       profileSummits.length  ? profileSummits  : null,
    profileWaypoints:     profileWaypoints.length ? profileWaypoints : null,
    profileNotViewable:   document.getElementById('ed-profile-not-viewable')?.checked || false,
  };

  // Leer fcId/pcsSlug del editor de jornada (se guardan en races, no en race_days)
  const edFcId    = parseInt(document.getElementById('ed-fcId')?.value) || null;
  const edPcsSlug = document.getElementById('ed-pcsSlug')?.value.trim() || null;

  try {
    const { error: rdErr } = await supabase.from('race_days').update(data).eq('id', rdId);
    if (rdErr) throw rdErr;

    // Actualizar fcId/pcsSlug en races si el editor los tiene
    const raceInMem = allRaces.find(r => r.id === raceId);
    if (raceId && (edFcId !== (raceInMem?.fcId ?? null) || edPcsSlug !== (raceInMem?.pcsSlug ?? null))) {
      const { error: raceErr } = await supabase.from('races').update({ fcId: edFcId, pcsSlug: edPcsSlug }).eq('id', raceId);
      if (raceErr) throw raceErr;
      if (raceInMem) upsertRaceLocal({ ...raceInMem, fcId: edFcId, pcsSlug: edPcsSlug });
    }

    // Guardar broadcasts — INSERT primero + DELETE después por ID, para no
    // perder los datos antiguos si la INSERT falla (p.ej. columna inexistente
    // por migración pendiente). Las IDs nuevas son UUIDs frescas, así que no
    // colisionan con las viejas durante la ventana mixta.
    const { data: oldBcasts, error: oldBcErr } = await supabase
      .from('broadcasts').select('id,url,embeddable').eq('raceDayId', rdId);
    if (oldBcErr) throw oldBcErr;

    const bcPanels = document.querySelectorAll('.tv-entry-panel');
    const newBroadcasts = [...bcPanels].reduce((acc, panel) => {
      const channel = panel.querySelector('.bc-channel').value.trim();
      const timeVal = panel.querySelector('.bc-time').value;
      const url     = panel.querySelector('.bc-url').value.trim();
      const note    = panel.querySelector('.bc-note').value.trim();
      const country = panel.querySelector('.bc-country')?.value || null;
      // Solo descartar filas completamente vacías (p.ej. "+ Añadir emisión"
      // sin rellenar). Un canal vacío con hora/nota es válido (ej: "Por confirmar").
      if (!channel && !timeVal && !url && !note) return acc;
      acc.push({
        id:           crypto.randomUUID(),
        raceDayId:    rdId,
        channel:      channel || null,
        startTimeUtc: toTimestamp(dateKey, timeVal),
        url:          url || null,
        note:         note || null,
        country:      country || null,
        sortOrder:    acc.length,
        showInRevive: panel.querySelector('.bc-show-in-revive').checked,
        embeddable:   null,
      });
      return acc;
    }, []);
    // Validar URLs de YouTube contra oEmbed. Reusa el valor previo si la URL
    // no cambió para evitar la llamada extra en cada guardado.
    const oldEmbedByUrl = new Map(
      (oldBcasts || []).filter(b => b.url).map(b => [b.url, b.embeddable])
    );
    await Promise.all(newBroadcasts.map(async b => {
      if (!b.url || !extractYouTubeId(b.url)) return;
      if (oldEmbedByUrl.has(b.url)) {
        b.embeddable = oldEmbedByUrl.get(b.url);
        return;
      }
      b.embeddable = await checkYouTubeEmbeddable(b.url);
    }));
    if (newBroadcasts.length) {
      const { error: insBcErr } = await supabase.from('broadcasts').insert(newBroadcasts);
      if (insBcErr) throw insBcErr;
    }
    const oldBcIds = (oldBcasts || []).map(b => b.id);
    if (oldBcIds.length) {
      const { error: delBcErr } = await supabase.from('broadcasts').delete().in('id', oldBcIds);
      if (delBcErr) throw delBcErr;
    }

    // Guardar assets — misma estrategia INSERT primero + DELETE por ID
    const { data: oldAssets, error: oldAsErr } = await supabase
      .from('assets').select('id, type, sourceType, url').eq('raceDayId', rdId);
    if (oldAsErr) throw oldAsErr;

    const assetDocTypes = ['roadbook', 'profile', 'ports', 'map', 'startOrder'];
    let hasAssets = false;
    const newAssets = [];
    for (const input of document.querySelectorAll('.asset-url-input')) {
      const url = input.value.trim();
      if (!url) continue;
      newAssets.push({ id: crypto.randomUUID(), raceDayId: rdId, type: input.dataset.type, sourceType: 'external', url });
      if (assetDocTypes.includes(input.dataset.type)) hasAssets = true;
    }
    // El guardado reconstruye los assets DESDE EL DOM: borra todos y reinserta
    // los inputs con valor. Eso es correcto para los documentos que el editor
    // renderiza siempre, pero el asset `startOrder` NO lo crea el editor: lo
    // inserta el importador de orden de salida (attachImportHandler). Si el
    // editor se guarda sin que su fila esté cableada en #assetsList (pestaña no
    // abierta, editor montado antes del import…), el DELETE se lo llevaba y el
    // INSERT no lo reponía → la jornada perdía el badge "Orden salida" en las
    // tres plataformas, que lo gatean por la existencia de este asset, aunque
    // `startOrderImportedAt` y las filas de start_order_entries siguieran ahí.
    // Cazado en el Tour de Francia 2026 etapa 16 (CRI, 166 entries importados).
    // Quitar la fila a mano (botón ✕) SÍ debe borrarlo: ese handler la apunta
    // en `#assetsList[data-removed-types]`, que aquí se respeta. Sin esa marca
    // el borrado explícito y "el editor nunca la renderizó" serían el mismo
    // estado (row.remove() la saca del DOM) y resucitaríamos lo recién borrado.
    const soInDom = document.querySelector('.asset-url-input[data-type="startOrder"]');
    const soRemoved = (document.getElementById('assetsList')?.dataset.removedTypes || '')
      .split(',').includes('startOrder');
    const soOld = (oldAssets || []).find(a => a.type === 'startOrder');
    if (!soInDom && !soRemoved && soOld?.url) {
      newAssets.push({
        id: crypto.randomUUID(), raceDayId: rdId,
        type: 'startOrder', sourceType: soOld.sourceType || 'external', url: soOld.url,
      });
      hasAssets = true;
    }
    // Los assets son únicos por jornada y tipo. Al guardar el editor, conservar
    // la fila existente de cada tipo evita que el trigger anti-duplicados choque
    // con la estrategia anterior de INSERT antes de DELETE. Sin esto, el
    // broadcast sí se insertaba, pero el guardado completo acababa mostrando un
    // error de asset al llegar aquí.
    const oldAssetByType = new Map((oldAssets || []).map(asset => [asset.type, asset]));
    const retainedAssetIds = new Set();
    const assetsToInsert = [];
    for (const asset of newAssets) {
      const oldAsset = oldAssetByType.get(asset.type);
      if (!oldAsset) {
        assetsToInsert.push(asset);
        continue;
      }
      const { error: upAsErr } = await supabase
        .from('assets')
        .update({ sourceType: asset.sourceType, url: asset.url })
        .eq('id', oldAsset.id);
      if (upAsErr) throw upAsErr;
      retainedAssetIds.add(oldAsset.id);
    }
    if (assetsToInsert.length) {
      const { error: insAsErr } = await supabase.from('assets').insert(assetsToInsert);
      if (insAsErr) throw insAsErr;
    }
    const obsoleteAssetIds = (oldAssets || [])
      .filter(asset => !retainedAssetIds.has(asset.id))
      .map(asset => asset.id);
    if (obsoleteAssetIds.length) {
      const { error: delAsErr } = await supabase.from('assets').delete().in('id', obsoleteAssetIds);
      if (delAsErr) throw delAsErr;
    }
    // Denormalizar hasAssets en el documento raíz
    const { error: rdUpErr } = await supabase.from('race_days').update({ hasAssets }).eq('id', rdId);
    if (rdUpErr) throw rdUpErr;

    // Construir estado actualizado en memoria para pasarlo al editor sin releer Supabase.
    // `data` ya incluye el elevationProfile fusionado (desnivel manual + perfil GPX),
    // así que ...data aporta el valor correcto — no reusar el del caché previo.
    const savedRd = { ...data, id: rdId, hasAssets };

    // Recoger broadcasts y assets tal como quedaron tras el guardado
    const savedBcasts = [...document.querySelectorAll('.tv-entry-panel')].reduce((acc, panel) => {
      const channel = panel.querySelector('.bc-channel').value.trim();
      const timeVal = panel.querySelector('.bc-time').value;
      const url     = panel.querySelector('.bc-url').value.trim();
      const note    = panel.querySelector('.bc-note').value.trim();
      if (!channel && !timeVal && !url && !note) return acc;
      const country = panel.querySelector('.bc-country')?.value || null;
      acc.push({ id: '', channel: channel || null,
        startTimeUtc: toTimestamp(dateKey, timeVal),
        url: url || null,
        note: note || null,
        country,
        showInRevive: panel.querySelector('.bc-show-in-revive').checked,
      });
      return acc;
    }, []);

    const savedAssets = [...document.querySelectorAll('.asset-url-input')].reduce((acc, input) => {
      const url = input.value.trim();
      if (url) acc.push({ id: '', type: input.dataset.type, sourceType: 'external', url });
      return acc;
    }, []);

    // Guardar traducciones EN — leer estado actual de BD, actualizar solo los campos editados
    const { data: rdForTr } = await supabase.from('race_days').select('translations').eq('id', rdId).single();
    const existingTr = rdForTr?.translations || {};
    const existingEn = existingTr.en || {};
    const descEnVal    = markdownFromEditor('ed-description-en-wysiwyg', 'ed-description-en').trim() || null;
    const bonusesEnVal = document.getElementById('ed-bonuses-en')?.value.trim() || null;
    const notesEnVal   = document.getElementById('ed-notes-en')?.value.trim() || null;
    const updateEnFields = (field, newVal, currentEntry) => {
      if (newVal === null && !currentEntry) return currentEntry;
      // Si el valor difiere del existente y el status no es manual, marcar manual
      const changed = newVal !== (currentEntry?.value ?? null);
      if (!changed) return currentEntry;
      return { ...(currentEntry || {}), value: newVal, status: 'manual', updatedAt: new Date().toISOString() };
    };
    const newEn = { ...existingEn };
    if (descEnVal !== null || existingEn.description) newEn.description = updateEnFields('description', descEnVal, existingEn.description);
    if (bonusesEnVal !== null || existingEn.bonuses)   newEn.bonuses    = updateEnFields('bonuses', bonusesEnVal, existingEn.bonuses);
    if (notesEnVal !== null || existingEn.notes)       newEn.notes      = updateEnFields('notes', notesEnVal, existingEn.notes);
    const newTranslations = { ...existingTr, en: newEn };
    if (JSON.stringify(newTranslations) !== JSON.stringify(existingTr)) {
      const { error: trErr } = await supabase.from('race_days').update({ translations: newTranslations }).eq('id', rdId);
      if (trErr) throw trErr;
    }

    // Actualizar caché del editor
    _editorCache = { rdId, rd: { ...savedRd, translations: newTranslations }, broadcasts: savedBcasts, assets: savedAssets };

    loadSidebar();
    await openEditor(rdId); // usará _editorCache, 0 lecturas Firestore
    showToast(status === 'published' ? 'Publicado correctamente' : 'Borrador guardado', 'success', 3000);

    // Crear las páginas estáticas solo si la URL canónica aún no existe. Las
    // jornadas ya publicadas leen sus cambios en vivo desde Supabase y no deben
    // reconstruir el artifact completo tras cada edición.
    if (status === 'published' && slugVal) {
      _markWebPagesDirtyIfMissing(slugVal);
    }

  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message);
  } finally {
    setRaceDaySaveInFlight(false);
  }
}

// ── Borrar jornada ───────────────────────────────────────────────
async function deleteRaceDay() {
  const rdId = document.getElementById('editorArea').dataset.rdId;
  if (!await confirmDialog('¿Seguro que quieres borrar esta jornada? Esta acción no se puede deshacer.', { danger: true })) return;

  try {
    // Borrar broadcasts y assets (ON DELETE CASCADE los borra automáticamente,
    // pero lo hacemos explícito por seguridad)
    await Promise.all([
      supabase.from('broadcasts').delete().eq('raceDayId', rdId),
      supabase.from('assets').delete().eq('raceDayId', rdId),
    ]);
    await supabase.from('race_days').delete().eq('id', rdId);

    // Cerrar el drawer y recargar la lista de jornadas del día
    currentRaceDayId = null;
    closeDrawer(1);
    loadSidebar();
    showToast('Jornada eliminada', 'success', 2500);
  } catch (err) {
    console.error(err);
    alertDialog('Error al borrar la jornada.', { title: 'Error' });
  }
}

// ── Duplicar jornada ──────────────────────────────────────────────
async function duplicateRaceDay() {
  const newDate = await promptDialog('Fecha para la jornada duplicada:', {
    title: 'Duplicar jornada',
    inputType: 'date',
    value: document.getElementById('ed-date')?.value || currentDateKey || '',
    confirmText: 'Duplicar',
  });
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;

  const rdId = document.getElementById('editorArea').dataset.rdId;
  const { data: rdData } = await supabase.from('race_days').select('*').eq('id', rdId).single();
  if (!rdData) return;

  const { id: _origId, ...rdFields } = rdData;
  const data = { ...rdFields, dateKey: newDate, date: newDate,
    editorialStatus: 'draft', updatedAt: new Date().toISOString() };
  const newId = crypto.randomUUID();

  const { data: newRef, error: newRefErr } = await supabase
    .from('race_days')
    .insert({ ...data, id: newId })
    .select()
    .single();
  if (newRefErr) { alertDialog('Error al duplicar.', { title: 'Error' }); return; }

  // Copiar broadcasts y assets
  const [bcastRes, assetsRes] = await Promise.all([
    supabase.from('broadcasts').select('*').eq('raceDayId', rdId),
    supabase.from('assets').select('*').eq('raceDayId', rdId),
  ]);
  const copiedBcasts = (bcastRes.data || []).map(({ id: _bid, raceDayId: _rid, ...b }) => ({
    ...b, id: crypto.randomUUID(), raceDayId: newId
  }));
  const copiedAssets = (assetsRes.data || []).map(({ id: _aid, raceDayId: _rid, ...a }) => ({
    ...a, id: crypto.randomUUID(), raceDayId: newId
  }));
  await Promise.all([
    copiedBcasts.length ? supabase.from('broadcasts').insert(copiedBcasts) : Promise.resolve(),
    copiedAssets.length ? supabase.from('assets').insert(copiedAssets)     : Promise.resolve(),
  ]);

  // Actualizar el picker si el nuevo día coincide con el seleccionado
  if (newDate === currentDateKey) loadSidebar();

  alertDialog(`Jornada duplicada. Puedes encontrarla el ${newDate}.`, { title: 'Hecho' });
}

// ── Modal: seleccionar carrera ────────────────────────────────────
// Cuerpo del selector de carrera (mismos ids que el markup estático que
// sustituye; se monta en el body del drawer).
function raceModalBodyHtml() {
  return `
    <div class="modal__search">
      <input type="text" id="raceSearch" placeholder="Buscar carrera…"
             style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.875rem;padding:0.5rem 0.75rem;outline:none">
    </div>
    <div class="modal__list" id="raceList">
      <div id="raceSuggestionsSection" style="display:none">
        <div class="race-modal-section-label" id="raceSuggestionsLabel"></div>
        <div id="raceSuggestions"></div>
        <div class="race-modal-divider" id="raceModalDivider" style="display:none">
          <span>Otras carreras</span>
        </div>
      </div>
      <div id="raceListGeneral"></div>
    </div>
    <div style="padding:0.75rem 0 0;border-top:1px solid var(--border);margin-top:0.75rem">
      <button class="btn btn--ghost btn--full" id="newRaceBtn">+ Crear carrera nueva</button>
    </div>`;
}

function wireRaceModal() {
  document.getElementById('raceSearch').addEventListener('input', e => {
    renderRaceModal(e.target.value);
  });
  document.getElementById('newRaceBtn').addEventListener('click', () => {
    closeRaceModal();
    openNewRaceEditor();
  });
}

let _racePickerLevel = 1;  // nivel en el que se abrió el selector de carrera

async function openRaceModal() {
  // Si el editor de jornada (nivel 1) está abierto, apilar en nivel 2;
  // si se abre desde la agenda (+ Añadir jornada), va en nivel 1.
  const level = document.getElementById('editorArea') ? 2 : 1;
  _racePickerLevel = level;
  openDrawer({
    title: 'Seleccionar carrera',
    level,
    render: (body) => {
      body.innerHTML = raceModalBodyHtml();
      wireRaceModal();
      renderRaceModal('');
    },
  });
  // Refrescar IDs con jornada en este día y re-render
  try {
    const { data: dayData } = await supabase
      .from('race_days').select('raceId').eq('dateKey', currentDateKey);
    currentDayRaceIds = new Set((dayData || []).map(d => d.raceId).filter(Boolean));
  } catch (e) {
    // Si falla, usamos el Set que ya teníamos
  }
  renderRaceModal('');
}

function getRaceSuggestionsForDate(dateKey) {
  if (!dateKey) return [];
  return allRaces.filter(r => {
    const start = r.startDate || '';
    const end   = r.endDate   || '';
    if (!start || !end) return false;
    return start <= dateKey && dateKey <= end && !currentDayRaceIds.has(r.id) && !r.isCancelled;
  });
}

function buildRaceOption(race, suggested = false) {
  const opt = document.createElement('div');
  opt.className = 'race-option' + (suggested ? ' race-option--suggested' : '');
  opt.innerHTML = `
    ${race.hideFlag ? '<span class="race-option__flag"></span>' : `<span class="race-option__flag">${countryFlag(race.countryCode)}</span>`}
    <div>
      <div class="race-option__name">${race.name}</div>
      <div class="race-option__cat">${race.uciCategory || ''} · ${race.gender === 'female' ? 'Femenino' : 'Masculino'}</div>
    </div>`;
  opt.addEventListener('click', () => selectRace(race));
  return opt;
}

function renderRaceModal(query) {
  const suggestionsSection = document.getElementById('raceSuggestionsSection');
  const suggestionsLabel   = document.getElementById('raceSuggestionsLabel');
  const suggestionsEl      = document.getElementById('raceSuggestions');
  const divider            = document.getElementById('raceModalDivider');
  const generalEl          = document.getElementById('raceListGeneral');

  const sorted = (arr) => [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));

  if (query.trim() === '') {
    // — Sin búsqueda: sugeridas arriba + resto abajo —
    const suggested = getRaceSuggestionsForDate(currentDateKey);
    const suggestedIds = new Set(suggested.map(r => r.id));
    const rest = allRaces.filter(r => !suggestedIds.has(r.id));

    if (suggested.length > 0) {
      suggestionsLabel.textContent = `Carreras pendientes del ${formatDateLabel(currentDateKey)}`;
      suggestionsEl.innerHTML = '';
      sorted(suggested).forEach(r => suggestionsEl.appendChild(buildRaceOption(r, true)));
      divider.style.display = rest.length > 0 ? 'flex' : 'none';
      suggestionsSection.style.display = 'block';
    } else {
      suggestionsSection.style.display = 'none';
      divider.style.display = 'none';
    }

    generalEl.innerHTML = '';
    if (rest.length === 0 && suggested.length === 0) {
      generalEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem">Sin carreras</div>`;
    } else {
      sorted(rest).forEach(r => generalEl.appendChild(buildRaceOption(r, false)));
    }

  } else {
    // — Con búsqueda: una lista unificada, sugeridas marcadas —
    suggestionsSection.style.display = 'none';
    const q = query.toLowerCase();
    const filtered = allRaces.filter(r => r.name?.toLowerCase().includes(q));
    const suggestedIds = new Set(getRaceSuggestionsForDate(currentDateKey).map(r => r.id));

    generalEl.innerHTML = '';
    if (filtered.length === 0) {
      generalEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem">Sin resultados</div>`;
    } else {
      sorted(filtered).forEach(r => generalEl.appendChild(buildRaceOption(r, suggestedIds.has(r.id))));
    }
  }
}

function formatDateLabel(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

function renderRaceList(races) {
  // Alias de compatibilidad — redirige al nuevo sistema
  renderRaceModal('');
}

function selectRace(race) {
  // Crear nueva jornada con esta carrera para el día actual
  createNewRaceDay(race.id);
  closeRaceModal();
}

function closeRaceModal() {
  closeDrawer(_racePickerLevel);
}

async function createNewRaceDay(raceId) {
  const newId = crypto.randomUUID();
  const { error } = await supabase.from('race_days').insert({
    id:              newId,
    raceId,
    dateKey:         currentDateKey,
    date:            currentDateKey,
    editorialStatus: 'draft',
    updatedAt:       new Date().toISOString(),
  });
  if (error) { showToast('Error al crear jornada: ' + error.message); return; }
  await loadSidebar();
  openEditor(newId);
}

// ── Modal: nueva carrera ──────────────────────────────────────────
function setupModals() {
  // Race modal
  // El selector de carrera y el editor "nueva carrera" viven ahora en el
  // drawer; sus listeners se cablean por apertura (wireRaceModal en
  // openRaceModal, wireNewRaceEditor en openNewRaceEditor). El cierre y el
  // click-fuera los gestiona el propio drawer (✕ + scrim).

  // Broadcast buttons (delegated — funciona para filas cargadas y añadidas dinámicamente)
  document.addEventListener('click', e => {
    const panel = e.target.closest('.tv-entry-panel');
    if (!panel) return;
    if (e.target.classList.contains('remove-broadcast-btn')) {
      panel.remove();
      updateBroadcastLabels();
    } else if (e.target.classList.contains('move-broadcast-up-btn')) {
      moveBroadcastRow(panel, 'up');
    } else if (e.target.classList.contains('move-broadcast-down-btn')) {
      moveBroadcastRow(panel, 'down');
    }
  });
}

// ── Editor "nueva carrera" (drawer) ───────────────────────────────
// Mismos ids nr-* que el markup anterior para no tocar reset/save.
function newRaceBodyHtml() {
  return `
    <div id="newRaceError" class="alert alert--error" style="display:none"></div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="nr-name" placeholder="Vuelta a España">
      </div>
      <div class="field">
        <label>Abreviatura <span class="u-hint">(máx. 6)</span></label>
        <input class="u-upper" type="text" id="nr-abbrev" placeholder="VUELTA" maxlength="6">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="nr-uci">
          <option value="WC">WC</option><option value="CC">CC</option><option value="CN">CN</option>
          <option value="1.UWT">1.UWT</option><option value="2.UWT">2.UWT</option>
          <option value="1.WWT">1.WWT</option><option value="2.WWT">2.WWT</option>
          <option value="1.Pro">1.Pro</option><option value="2.Pro">2.Pro</option>
          <option value="1.1">1.1</option><option value="2.1">2.1</option>
          <option value="1.2">1.2</option><option value="2.2">2.2</option>
          <option value="1.2U">1.2U</option><option value="2.2U">2.2U</option>
        </select>
      </div>
      <div class="field">
        <label>Género</label>
        <select id="nr-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Formato</label>
        <select id="nr-format">
          <option value="stage_race">Vuelta por etapas</option>
          <option value="one_day">Clásica</option>
        </select>
      </div>
      <div class="field">
        <label>País (código ISO)</label>
        <input class="u-upper" type="text" id="nr-country" placeholder="ES" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="nr-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Fecha inicio</label>
        <input type="date" id="nr-startDate">
      </div>
      <div class="field">
        <label>Fecha fin</label>
        <input type="date" id="nr-endDate">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview">
        <input class="u-color-dot" type="color" id="nr-colorPicker" value="#e8c547"
              >
        <input class="u-grow" type="text" id="nr-color" placeholder="#e8c547">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="nr-logo-wrap"><input type="url" id="nr-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.5rem 0 0.25rem">
      <input class="u-checkbox" type="checkbox" id="nr-hideFlag">
      <span class="u-collapse-header" onclick="document.getElementById('nr-hideFlag').click()">Ocultar bandera</span>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.25rem 0 0">
      <input class="u-checkbox" type="checkbox" id="nr-isGrandTour">
      <span class="u-collapse-header" onclick="document.getElementById('nr-isGrandTour').click()">Gran Vuelta</span>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.25rem 0 0">
      <input type="checkbox" id="nr-isNoClickable" style="width:15px;height:15px;accent-color:#f90;cursor:pointer;flex-shrink:0;position:relative;z-index:1">
      <span onclick="document.getElementById('nr-isNoClickable').click()" style="font-family:var(--font-display);font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f90;cursor:pointer;user-select:none">No clicable</span>
    </div>
    <div style="margin-top:1.25rem;padding-top:0.75rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;justify-content:flex-end">
      <button class="btn btn--primary" id="newRaceSaveBtn">Crear carrera</button>
    </div>
  `;
}

// Listeners del editor "nueva carrera" (por apertura del drawer).
function wireNewRaceEditor() {
  document.getElementById('newRaceSaveBtn').addEventListener('click', saveNewRace);
  // Autoseleccionar formato según categoría UCI
  const CLASICA_CATS   = new Set(['1.UWT','1.WWT','1.Pro','1.1','1.2','1.2U','WC','CC']);
  const WWT_CATS       = new Set(['1.WWT','2.WWT']);
  const HIDEFLAG_CATS  = new Set(['WC','CC']);
  document.getElementById('nr-uci').addEventListener('change', e => {
    const val       = e.target.value;
    const formatSel = document.getElementById('nr-format');
    const genderSel = document.getElementById('nr-gender');
    if (val === '') return;
    formatSel.value = CLASICA_CATS.has(val) ? 'one_day' : 'stage_race';
    if (WWT_CATS.has(val))      genderSel.value = 'female';
    if (HIDEFLAG_CATS.has(val)) document.getElementById('nr-hideFlag').checked = true;
  });
  // Color picker — sincronización bidireccional
  const nrPicker = document.getElementById('nr-colorPicker');
  const nrText   = document.getElementById('nr-color');
  nrPicker.addEventListener('input', e => { nrText.value = e.target.value; });
  nrText.addEventListener('input', e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) nrPicker.value = e.target.value;
  });
  // Upload inline de logo + autocompletado de país
  attachInlineUpload(document.getElementById('nr-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('nr-country'));
}

// Abre el editor de nueva carrera en el drawer.
// presetYear: año a preseleccionar (cuando se abre desde la vista Carreras).
function openNewRaceEditor({ presetYear = null } = {}) {
  openDrawer({
    title: 'Nueva carrera',
    level: 1,
    render: (body) => {
      body.innerHTML = newRaceBodyHtml();
      wireNewRaceEditor();
      resetNewRaceModal();
      if (presetYear != null) {
        const yr = document.getElementById('nr-year');
        if (yr) yr.value = presetYear;
      }
    },
  });
}

function resetNewRaceModal() {
  const nrErr = document.getElementById('newRaceError');
  if (nrErr) nrErr.style.display = 'none';
  ['nr-name','nr-abbrev','nr-country','nr-logo','nr-color','nr-startDate','nr-endDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const yr = document.getElementById('nr-year');
  if (yr) yr.value = new Date().getFullYear();
  const uci = document.getElementById('nr-uci');
  if (uci) uci.selectedIndex = 0;
  const gender = document.getElementById('nr-gender');
  if (gender) gender.selectedIndex = 0;
  const format = document.getElementById('nr-format');
  if (format) format.selectedIndex = 0;
  const colorPicker = document.getElementById('nr-colorPicker');
  if (colorPicker) colorPicker.value = '#e8c547';
  const hideFlag = document.getElementById('nr-hideFlag');
  if (hideFlag) hideFlag.checked = false;
  const isGT = document.getElementById('nr-isGrandTour');
  if (isGT) isGT.checked = false;
  const isNC = document.getElementById('nr-isNoClickable');
  if (isNC) isNC.checked = false;
}

function closeNewRaceModal() {
  closeDrawer(1);
}

// ── Validación categoría ↔ género ────────────────────────────────
function validateCatGender(uci, gender, errDiv) {
  const MALE_ONLY = new Set(['1.UWT','2.UWT']);
  const FEM_ONLY  = new Set(['1.WWT','2.WWT']);
  if (MALE_ONLY.has(uci) && gender === 'female') {
    errDiv.textContent = `La categoría ${uci} es exclusivamente masculina.`;
    errDiv.style.display = 'block';
    return false;
  }
  if (FEM_ONLY.has(uci) && gender !== 'female') {
    errDiv.textContent = `La categoría ${uci} es exclusivamente femenina.`;
    errDiv.style.display = 'block';
    return false;
  }
  return true;
}

// Las carreras CN (Campeonatos Nacionales) alimentan la página de Modo Campeonatos,
// que deduce la prueba (línea/CRI, sub23, género) parseando el nombre. Por eso el
// nombre ES y, si existe, el EN deben seguir la convención. Bloquea el guardado y
// da un tip cuando no la cumplen. Misma firma/uso que validateCatGender.
function validateChampionshipName(uci, name, nameEn, errDiv) {
  if (uci !== 'CN') return true; // solo aplica a CN
  // ES: "Campeonato de <País> <línea|CRI> [sub23] <masculino|femenino>"
  const reEs = /^Campeonato de .+\s+(línea|cri)\b.*\b(masculino|femenino)\s*$/i;
  if (!reEs.test((name || '').trim())) {
    errDiv.textContent = 'Nombre CN inválido. Formato: "Campeonato de (País) (línea|CRI) (sub23 si aplica) (masculino|femenino)". Ej: "Campeonato de España CRI sub23 masculino".';
    errDiv.style.display = 'block';
    return false;
  }
  // EN (solo si hay nameEn): "<Gentilicio> Championships - <Men's|Women's> [U23] <RR|ITT>"
  if ((nameEn || '').trim()) {
    const reEn = /Championships\s*-\s*(men's|women's)\b.*\b(rr|itt)\s*$/i;
    if (!reEn.test(nameEn.trim())) {
      errDiv.textContent = "Invalid EN name. Format: \"(Nationality) Championships - (Men's|Women's) (U23 if applies) (RR|ITT)\". E.g. \"Spanish Championships - Men's U23 ITT\".";
      errDiv.style.display = 'block';
      return false;
    }
  }
  return true;
}

async function saveNewRace() {
  const name    = document.getElementById('nr-name').value.trim();
  const errDiv  = document.getElementById('newRaceError');

  if (!name) {
    errDiv.textContent = 'El nombre es obligatorio.';
    errDiv.style.display = 'block';
    return;
  }

  const uci    = document.getElementById('nr-uci').value;
  const gender = document.getElementById('nr-gender').value;
  if (!validateCatGender(uci, gender, errDiv)) return;
  // El modal de nueva carrera no tiene nameEn → se valida solo el ES (el EN se
  // valida al editar). La convención CN alimenta la página de Modo Campeonatos.
  if (!validateChampionshipName(uci, name, null, errDiv)) return;

  const newRaceId = crypto.randomUUID();
  const newSeriesId = crypto.randomUUID();
  const data = {
    id:          newRaceId,
    raceSeriesId: newSeriesId,
    name,
    abbrev:      document.getElementById('nr-abbrev').value.trim().toUpperCase() || null,
    uciCategory: document.getElementById('nr-uci').value,
    gender:      document.getElementById('nr-gender').value,
    raceFormat:  document.getElementById('nr-format').value,
    countryCode: document.getElementById('nr-country').value.trim() || null,
    colorHex:    document.getElementById('nr-color').value || document.getElementById('nr-colorPicker').value || '#888888',
    logoUrl:     document.getElementById('nr-logo').value.trim() || null,
    hideFlag:    document.getElementById('nr-hideFlag').checked || false,
    isGrandTour: document.getElementById('nr-isGrandTour').checked || false,
    isNoClickable: document.getElementById('nr-isNoClickable').checked || false,
    startDate:   document.getElementById('nr-startDate').value || null,
    endDate:     document.getElementById('nr-endDate').value   || null,
    year:        parseInt(document.getElementById('nr-year').value) || new Date().getFullYear(),
    createdAt:   new Date().toISOString(),
  };

  try {
    const { error: seriesErr } = await supabase.from('race_series').insert({
      id: newSeriesId,
      canonicalName: name,
      gender,
    });
    if (seriesErr) throw seriesErr;
    const { error: insertErr } = await supabase.from('races').insert(data);
    if (insertErr) {
      await supabase.from('race_series').delete().eq('id', newSeriesId);
      throw insertErr;
    }
    const newRace = { ...data };
    upsertRaceLocal(newRace);
    closeNewRaceModal();
    if (_newRaceFromRacesView) {
      _newRaceFromRacesView = false;
      renderRacesView();
    } else {
      selectRace(newRace);
    }
  } catch (err) {
    errDiv.textContent = 'Error al guardar la carrera.';
    errDiv.style.display = 'block';
  }
}

// ── Utilidad: formatear timestamp a HH:MM ────────────────────────
function formatTimeHHMM(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE CARRERAS
// ═════════════════════════════════════════════════════════════════

// ── Navegación (rail lateral; antes pestañas) ─────────────────────
function initTabs() {
  document.querySelectorAll('.rail-item[data-tab], .panel-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Logo → Agenda
  const logoHome = document.getElementById('logoHome');
  if (logoHome) logoHome.addEventListener('click', e => { e.preventDefault(); switchTab('agenda'); });

  // Burger menu (mobile)
  const burger = document.getElementById('panelBurger');
  const burgerMenu = document.getElementById('panelBurgerMenu');
  if (burger && burgerMenu) {
    burger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = burgerMenu.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
      burgerMenu.setAttribute('aria-hidden', String(!open));
    });
    burgerMenu.querySelectorAll('.panel-burger-item[data-tab]').forEach(item => {
      item.addEventListener('click', () => {
        switchTab(item.dataset.tab);
        burgerMenu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        burgerMenu.setAttribute('aria-hidden', 'true');
      });
    });
    document.addEventListener('click', (e) => {
      if (!burgerMenu.contains(e.target) && !burger.contains(e.target)) {
        burgerMenu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        burgerMenu.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // Navegación con botones atrás/adelante del navegador
  window.addEventListener('hashchange', () => switchTab(tabFromHash(), { updateHash: false }));
}

const VALID_TABS = new Set(['agenda', 'startlists', 'teams', 'analytics', 'races', 'notifications', 'highlights', 'fichajes']);

function tabFromHash() {
  const hash = location.hash.slice(1);
  return VALID_TABS.has(hash) ? hash : 'agenda';
}

function switchTab(tab, { updateHash = true } = {}) {
  // Rail lateral (nav permanente). Se conservan los selectores antiguos
  // (.panel-tab/.panel-burger-item) por si quedan referencias; el rail usa
  // .rail-item[data-tab].
  document.querySelectorAll('.rail-item, .panel-tab, .panel-burger-item').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  const isAgenda        = tab === 'agenda';
  const isRaces         = tab === 'races';
  const isAnalytics     = tab === 'analytics';
  const isStartlists    = tab === 'startlists';
  const isTeams         = tab === 'teams';
  const isNotifications = tab === 'notifications';
  const isHighlights    = tab === 'highlights';
  const isFichajes      = tab === 'fichajes';
  document.querySelector('.panel-body').style.display                  = isAgenda        ? 'flex' : 'none';
  document.getElementById('racesView').style.display                   = isRaces         ? 'flex' : 'none';
  document.getElementById('racesView').style.flexDirection             = 'column';
  document.getElementById('analyticsView').style.display               = isAnalytics     ? 'flex' : 'none';
  document.getElementById('startlistsView').style.display              = isStartlists    ? 'flex' : 'none';
  document.getElementById('teamsView').style.display                   = isTeams         ? 'flex' : 'none';
  document.getElementById('notificationsView').style.display           = isNotifications ? 'flex' : 'none';
  document.getElementById('highlightsView').style.display              = isHighlights    ? 'flex' : 'none';
  const fichajesView = document.getElementById('fichajesView');
  if (fichajesView) fichajesView.style.display                         = isFichajes      ? 'flex' : 'none';
  // La vista Carreras tiene dos subvistas (Carreras / Challenges) con toggle
  // propio; al entrar se renderiza la subvista activa.
  if (isRaces)         applyRacesSubview(_racesSubview);
  if (isAnalytics)     setupAnalyticsView();
  if (isStartlists)    setupStartlistsView();
  if (isTeams)         setupTeamsView();
  if (isNotifications) setupNotificationsView();
  if (isHighlights)    setupHighlightsView();
  if (isFichajes)      setupFichajesView();
  if (updateHash) history.pushState(null, '', '#' + tab);
}

// ── Subvista de la pestaña Carreras: 'races' | 'challenges' ──────────
// Los challenges agrupan varias carreras (challenge_groups.raceIds) y se usan
// en pocas carreras → no merecen un tab propio en el rail; viven aquí, como
// una segunda subvista que comparte cabecera con Carreras.
let _racesSubview = 'races';

function applyRacesSubview(subview) {
  _racesSubview = subview === 'challenges' ? 'challenges' : 'races';
  const isChallenges = _racesSubview === 'challenges';

  // Estado del toggle
  document.querySelectorAll('#racesSubviewToggle .races-subview-btn').forEach(btn => {
    const active = btn.dataset.subview === _racesSubview;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  // Acciones de cabecera: cada subvista muestra su botón "+ Nuevo …"
  const addRaceBtn      = document.getElementById('addRaceDirectBtn');
  const newChallengeBtn = document.getElementById('newChallengeBtn');
  const filtersRow      = document.getElementById('racesFiltersRow');
  if (addRaceBtn)      addRaceBtn.style.display      = isChallenges ? 'none' : '';
  if (newChallengeBtn) newChallengeBtn.style.display = isChallenges ? '' : 'none';
  // Los filtros (año/categoría/país/búsqueda) son específicos de Carreras
  if (filtersRow)      filtersRow.style.display      = isChallenges ? 'none' : '';

  // Cuerpos de cada subvista
  document.getElementById('racesListView').style.display      = isChallenges ? 'none' : '';
  document.getElementById('challengesListView').style.display = isChallenges ? '' : 'none';

  if (isChallenges) renderChallengesView();
  else              renderRacesView();
}

// ── Render listado de carreras ────────────────────────────────────
// Orden canónico de categorías UCI (cuadrícula de botones + agrupación).
const RACES_CAT_ORDER = ['WC','CC','CN','1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','1.2','2.2','1.2U','2.2U'];

// Categoría seleccionada en la cuadrícula (null = mostrar cuadrícula).
let _racesCatSelected = null;

// Construye el HTML de una fila de carrera.
function _raceListItemHtml(race, { showTimestamp = false } = {}) {
  const flag   = race.hideFlag ? '' : countryFlag(race.countryCode);
  const gender = race.gender === 'female' ? 'Femenino' : 'Masculino';
  const format = race.raceFormat === 'one_day' ? 'Clásica' : 'Vuelta por etapas';
  let extra = '';
  if (showTimestamp) {
    const tsStr = race.updatedAt || race.createdAt || null;
    const createdStr = tsStr
      ? new Date(tsStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    if (createdStr) extra = ` · <span class="u-c-accent">${createdStr}</span>`;
  }
  return `
    ${flag ? `<span class="race-list-item__flag">${flag}</span>` : '<span class="race-list-item__flag"></span>'}
    <div class="race-list-item__main">
      <div class="race-list-item__name" style="${race.isCancelled ? 'text-decoration:line-through' : ''}">${race.name}${race.isCancelled ? ' <span style="font-size:0.65rem;color:var(--red);font-family:var(--font-display);font-weight:700;letter-spacing:0.05em;text-transform:uppercase">Cancelada</span>' : ''}</div>
      <div class="race-list-item__sub">${gender} · ${format} · ${race.startDate || '—'} → ${race.endDate || '—'} · <strong>${race.uciCategory || '—'}</strong>${extra}</div>
    </div>
    <span class="race-list-item__cat">${race.uciCategory || '—'}</span>
  `;
}

function _appendRaceRow(container, race, opts) {
  const item = document.createElement('div');
  item.className = 'race-list-item';
  item.innerHTML = _raceListItemHtml(race, opts);
  item.addEventListener('click', () => openEditRaceModal(race));
  container.appendChild(item);
}

function renderRacesView(searchQ) {
  const container = document.getElementById('racesListView');
  container.innerHTML = '';

  // Mantener el desplegable de categoría en sincronía con la cuadrícula.
  const catSel = document.getElementById('racesCatFilter');
  if (catSel && catSel.value !== (_racesCatSelected || '')) catSel.value = _racesCatSelected || '';

  // Leer búsqueda del input si no se pasa como argumento
  const q = (searchQ !== undefined ? searchQ : (document.getElementById('racesSearch')?.value || '')).toLowerCase();

  let filteredRaces = allRaces.filter(r => (r.year || new Date().getFullYear()) === _racesYear);
  if (q) filteredRaces = filteredRaces.filter(r => r.name?.toLowerCase().includes(q));
  const countryFilter = document.getElementById('racesCountryFilter')?.value || '';
  if (countryFilter) filteredRaces = filteredRaces.filter(r => (r.countryCode || '').toUpperCase() === countryFilter);

  const sortOrder = document.getElementById('racesSortOrder')?.value || 'cat';

  // ── Búsqueda o "más recientes primero" → listado plano (sin cuadrícula) ──
  if (q || sortOrder === 'recent') {
    if (filteredRaces.length === 0) {
      container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:2rem 0;text-align:center">
        No hay carreras${q ? ' que coincidan con la búsqueda' : ` para ${_racesYear}`}.</div>`;
      return;
    }
    const flat = [...filteredRaces].sort((a, b) => {
      if (sortOrder === 'recent') {
        const ta = a.updatedAt || a.createdAt || '';
        const tb = b.updatedAt || b.createdAt || '';
        return tb.localeCompare(ta);
      }
      return (a.name || '').localeCompare(b.name || '');
    });
    flat.forEach(race => _appendRaceRow(container, race, { showTimestamp: sortOrder === 'recent' }));
    return;
  }

  // ── Modo por categoría: cuadrícula de botones ────────────────────
  // Agrupar por categoría
  const groups = {};
  filteredRaces.forEach(race => {
    const cat = race.uciCategory || 'Sin categoría';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(race);
  });

  const sortedCats = Object.keys(groups).sort((a, b) => {
    const ia = RACES_CAT_ORDER.indexOf(a);
    const ib = RACES_CAT_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Si la categoría seleccionada ya no tiene carreras (cambio de año/país),
  // volver a la cuadrícula.
  if (_racesCatSelected && !groups[_racesCatSelected]) _racesCatSelected = null;

  // ── Vista cuadrícula (ninguna categoría seleccionada) ────────────
  if (!_racesCatSelected) {
    if (sortedCats.length === 0) {
      container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:2rem 0;text-align:center">
        No hay carreras para ${_racesYear}.</div>`;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    sortedCats.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-grid__btn';
      btn.innerHTML = `<span class="cat-grid__label">${esc(cat)}</span><span class="cat-grid__count">${groups[cat].length}</span>`;
      btn.addEventListener('click', () => { _racesCatSelected = cat; renderRacesView(); });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
    return;
  }

  // ── Vista de una categoría: listado alfabético ───────────────────
  const back = document.createElement('div');
  back.className = 'cat-back';
  back.innerHTML = `
    <button type="button" class="cat-back__btn">← Categorías</button>
    <div class="cat-back__title">${esc(_racesCatSelected)} <span class="u-o60">(${groups[_racesCatSelected].length})</span></div>
  `;
  back.querySelector('.cat-back__btn').addEventListener('click', () => { _racesCatSelected = null; renderRacesView(); });
  container.appendChild(back);

  const sorted = [...groups[_racesCatSelected]].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sorted.forEach(race => _appendRaceRow(container, race));
}

// ── Editor de carrera (drawer) ────────────────────────────────────
// HTML del formulario (mismos ids que antes para no tocar populate/save).
function raceEditorBodyHtml() {
  return `
    <div id="editRaceError" class="alert alert--error" style="display:none"></div>
    <input type="hidden" id="er-id">
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="er-name">
      </div>
      <div class="field">
        <label>Abreviatura <span class="u-hint">(máx. 6)</span></label>
        <input class="u-upper" type="text" id="er-abbrev" placeholder="VUELTA" maxlength="6">
      </div>
    </div>
    <div class="field">
      <label>Nombre original <span class="u-hint">(para SEO, no visible en la web)</span></label>
      <input type="text" id="er-originalName" placeholder="Tour de France">
    </div>
    <div class="field">
      <label>Nombre en inglés <span class="u-hint">(EN, opcional)</span></label>
      <input type="text" id="er-nameEn" placeholder="Tour of Flanders">
    </div>
    <div class="field">
      <label class="u-row u-row--gap-sm">Slug
        <span class="u-field-hint">— URL amigable (solo a-z, 0-9 y guiones)</span>
      </label>
      <div class="u-row" style="gap:0.5rem">
        <input type="text" id="er-slug" placeholder="tour-de-france-2025" maxlength="80"
               style="flex:1;font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
               autocomplete="off" spellcheck="false">
        <button type="button" id="er-slug-suggest" class="btn btn--ghost u-fs-xs u-btn-sm"
               >Auto</button>
      </div>
      <div id="er-slug-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
    </div>
    <div class="field">
      <label class="u-row u-row--gap-sm">Slug EN
        <span class="u-field-hint">— URL en inglés (solo a-z, 0-9 y guiones)</span>
      </label>
      <input type="text" id="er-slugEn" placeholder="tour-of-flanders-2025" maxlength="80"
             style="font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
             autocomplete="off" spellcheck="false">
      <div id="er-slugEn-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="er-uci">
          <option value="WC">WC</option><option value="CC">CC</option><option value="CN">CN</option>
          <option value="1.UWT">1.UWT</option><option value="2.UWT">2.UWT</option>
          <option value="1.WWT">1.WWT</option><option value="2.WWT">2.WWT</option>
          <option value="1.Pro">1.Pro</option><option value="2.Pro">2.Pro</option>
          <option value="1.1">1.1</option><option value="2.1">2.1</option>
          <option value="1.2">1.2</option><option value="2.2">2.2</option>
          <option value="1.2U">1.2U</option><option value="2.2U">2.2U</option>
        </select>
      </div>
      <div class="field">
        <label>Género</label>
        <select id="er-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Formato</label>
        <select id="er-format">
          <option value="stage_race">Vuelta por etapas</option>
          <option value="one_day">Clásica</option>
        </select>
      </div>
      <div class="field">
        <label>País (código ISO)</label>
        <input type="text" id="er-country" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="er-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview">
        <input class="u-color-dot" type="color" id="er-colorPicker" value="#e8c547"
              >
        <input class="u-grow" type="text" id="er-color" placeholder="#e8c547">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Fecha inicio</label>
        <input type="date" id="er-startDate">
      </div>
      <div class="field">
        <label>Fecha fin</label>
        <input type="date" id="er-endDate">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="er-logo-wrap"><input type="url" id="er-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="field">
      <label>Web oficial (URL, opcional)</label>
      <input type="url" id="er-website" placeholder="https://…">
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>ID FirstCycling (fcId)</label>
        <div class="u-row" style="gap:0.4rem">
          <input class="u-grow" type="number" id="er-fcId" placeholder="—" min="1">
          <button type="button" class="btn btn--ghost" style="font-size:0.7rem;padding:0 0.5rem;white-space:nowrap" onclick="erDetectFc()">Buscar ↗</button>
        </div>
      </div>
      <div class="field">
        <label>Slug ProCyclingStats (pcsSlug)</label>
        <div class="u-row" style="gap:0.4rem">
          <input class="u-grow" type="text" id="er-pcsSlug" placeholder="tour-de-france">
          <button type="button" class="btn btn--ghost" style="font-size:0.7rem;padding:0 0.5rem;white-space:nowrap" onclick="erDetectPcs()">Buscar ↗</button>
        </div>
      </div>
    </div>
    <div class="field">
      <label>Resultados UCI (competitionId)</label>
      <div class="u-row" style="gap:0.4rem">
        <input class="u-grow" type="number" id="er-uciCompetitionId" placeholder="—" min="1">
        <button type="button" class="btn btn--ghost" style="font-size:0.7rem;padding:0 0.6rem;white-space:nowrap" id="er-uciLinkBtn">Enlazar con UCI</button>
      </div>
      <div id="er-uciPanel" style="display:none;margin-top:0.5rem;font-size:0.8rem"></div>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.5rem 0 0.25rem">
      <input class="u-checkbox" type="checkbox" id="er-hideFlag">
      <span class="u-collapse-header" onclick="document.getElementById('er-hideFlag').click()">Ocultar bandera</span>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.25rem 0 0">
      <input class="u-checkbox" type="checkbox" id="er-isGrandTour">
      <span class="u-collapse-header" onclick="document.getElementById('er-isGrandTour').click()">Gran Vuelta</span>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.25rem 0 0">
      <input type="checkbox" id="er-isCancelled" style="width:15px;height:15px;accent-color:#e55;cursor:pointer;flex-shrink:0;position:relative;z-index:1">
      <span onclick="document.getElementById('er-isCancelled').click()" style="font-family:var(--font-display);font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#e55;cursor:pointer;user-select:none">Cancelada</span>
    </div>
    <div class="u-row" style="gap:0.6rem;padding:0.25rem 0 0">
      <input type="checkbox" id="er-isNoClickable" style="width:15px;height:15px;accent-color:#f90;cursor:pointer;flex-shrink:0;position:relative;z-index:1">
      <span onclick="document.getElementById('er-isNoClickable').click()" style="font-family:var(--font-display);font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f90;cursor:pointer;user-select:none">No clicable</span>
    </div>
    <div style="margin-top:1.25rem;padding-top:0.75rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <div class="u-row" style="gap:0.5rem">
        <button class="btn btn--danger" id="er-deleteBtn">Borrar carrera</button>
        <button class="btn btn--ghost" id="er-editStartlistBtn" style="font-size:0.75rem">Editar dorsales</button>
      </div>
      <div class="u-row" style="gap:0.5rem">
        <button class="btn btn--ghost" id="er-duplicateBtn">Crear edición</button>
        <button class="btn btn--primary" id="editRaceSaveBtn">Guardar cambios</button>
      </div>
    </div>
  `;
}

// Engancha todos los listeners del editor de carrera (se crean por apertura).
function wireRaceEditor() {
  document.getElementById('editRaceSaveBtn').addEventListener('click', saveEditRace);
  document.getElementById('er-deleteBtn').addEventListener('click', deleteRaceFromList);
  document.getElementById('er-duplicateBtn').addEventListener('click', duplicateRace);
  document.getElementById('er-editStartlistBtn').addEventListener('click', () => {
    const raceId = document.getElementById('er-id').value;
    if (!raceId) return;
    closeEditRaceModal();
    switchTab('startlists');
    openStartlistEditor(raceId);
  });
  // Slug — Auto + validación en vivo
  document.getElementById('er-slug-suggest').addEventListener('click', () => {
    const name = document.getElementById('er-name').value.trim();
    const year = document.getElementById('er-year').value.trim();
    const base = toSlug(name);
    const suggestion = year ? `${base}-${year}` : base;
    document.getElementById('er-slug').value = suggestion.slice(0, 80);
    document.getElementById('er-slug-error').style.display = 'none';
  });
  document.getElementById('er-slug').addEventListener('input', e => {
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('er-slug-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  // Color picker — sincronización bidireccional
  const erPicker = document.getElementById('er-colorPicker');
  const erText   = document.getElementById('er-color');
  erPicker.addEventListener('input', e => { erText.value = e.target.value; });
  erText.addEventListener('input', e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) erPicker.value = e.target.value;
  });
  // Auto-formato al cambiar categoría UCI
  _wireRaceUciAutoFormat();
  // Enlace con la competición de resultados UCI (lee el match-report + escribe race_uci_links)
  document.getElementById('er-uciLinkBtn').addEventListener('click', openUciLinkPanel);
  // Upload inline de logo + autocompletado de país
  attachInlineUpload(document.getElementById('er-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('er-country'));
}

// ── Editor de carrera — abrir en drawer ───────────────────────────
function openEditRaceModal(race) {
  openDrawer({
    title: 'Editar carrera',
    level: 1,
    render: (body) => {
      body.innerHTML = raceEditorBodyHtml();
      wireRaceEditor();
      populateRaceEditor(race);
    },
  });
}

function populateRaceEditor(race) {
  document.getElementById('er-id').value      = race.id;
  document.getElementById('er-name').value    = race.name || '';
  document.getElementById('er-originalName').value = race.originalName || '';
  document.getElementById('er-nameEn').value = race.nameEn || '';
  document.getElementById('er-slugEn').value = race.slugEn || '';
  document.getElementById('er-slugEn-error').style.display = 'none';
  document.getElementById('er-abbrev').value  = race.abbrev || '';
  document.getElementById('er-slug').value    = race.slug  || '';
  document.getElementById('er-slug-error').style.display = 'none';
  document.getElementById('er-uci').value     = race.uciCategory || '1.UWT';
  document.getElementById('er-uci').value     = race.uciCategory || '1.UWT';
  document.getElementById('er-gender').value  = race.gender || 'male';
  document.getElementById('er-format').value  = race.raceFormat || 'stage_race';
  document.getElementById('er-country').value = race.countryCode || '';
  document.getElementById('er-color').value     = race.colorHex || '';
  document.getElementById('er-colorPicker').value = race.colorHex || '#888888';
  document.getElementById('er-logo').value    = race.logoUrl || '';
  document.getElementById('er-website').value = race.websiteUrl || '';
  document.getElementById('er-fcId').value    = race.fcId != null ? race.fcId : '';
  document.getElementById('er-pcsSlug').value = race.pcsSlug || '';
  // El enlace UCI vive en race_uci_links (no en races) → cargar async.
  document.getElementById('er-uciCompetitionId').value = '';
  document.getElementById('er-uciPanel').style.display = 'none';
  document.getElementById('er-uciPanel').innerHTML = '';
  _loadUciLink(race.id);
  document.getElementById('er-hideFlag').checked    = race.hideFlag    || false;
  document.getElementById('er-isGrandTour').checked  = race.isGrandTour || false;
  document.getElementById('er-isCancelled').checked  = race.isCancelled || false;
  document.getElementById('er-isNoClickable').checked = race.isNoClickable || false;
  document.getElementById('er-year').value      = race.year || new Date().getFullYear();
  document.getElementById('er-startDate').value = race.startDate || '';
  document.getElementById('er-endDate').value   = race.endDate   || '';
  document.getElementById('editRaceError').style.display = 'none';
}

function closeEditRaceModal() {
  closeDrawer(1);
}

// ── Auto-detección FC / PCS desde el editor de carrera ────────────
function _guessPcsSlug(race) {
  const name = (race.originalName || race.name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return name;
}

window.erDetectFc = function() {
  const name = document.getElementById('er-name').value.trim();
  const year = document.getElementById('er-year').value.trim();
  const q    = encodeURIComponent((name + (year ? ' ' + year : '')));
  window.open(`https://www.google.com/search?q=site:firstcycling.com+${q}`, '_blank', 'noopener');
};

window.erDetectPcs = function() {
  const name = document.getElementById('er-name').value.trim();
  const year = document.getElementById('er-year').value.trim();
  const q    = encodeURIComponent((name + (year ? ' ' + year : '')));
  window.open(`https://www.google.com/search?q=site:procyclingstats.com+${q}`, '_blank', 'noopener');
};

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
async function _loadUciLink(raceId) {
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

const _UCI_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

// Abre el enlace manual bajo el campo. La búsqueda se hace directamente en
// DataRide; se eliminó el matcher automático por su baja fiabilidad.
async function openUciLinkPanel() {
  const raceId = document.getElementById('er-id').value;
  const panel  = document.getElementById('er-uciPanel');
  if (!raceId || !panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `<div class="u-row" style="gap:0.5rem;align-items:center;flex-wrap:wrap">
    <a class="btn btn--ghost" href="https://dataride.uci.ch/iframe/Results/10/" target="_blank" rel="noopener" style="font-size:0.7rem;padding:0 0.6rem">Últimos resultados de DataRide ↗</a>
    <button type="button" class="btn btn--primary u-uci-save-manual" style="font-size:0.7rem;padding:0 0.6rem">Guardar el ID del campo</button>
  </div>`;
  _wireUciPanel(raceId);
  return;

  let rec = null;
  try {
    const { index } = await _loadUciReport();
    rec = index.get(raceId) || null;
  } catch (err) {
    panel.innerHTML = `<span style="color:#e55">No se pudo cargar el reporte de matching (${esc(err.message)}).</span>`
      + '<div style="color:var(--text-muted);margin-top:0.3rem">Puedes introducir el <strong>competitionId</strong> a mano y pulsar Guardar abajo.</div>'
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
  const tick = c.classMatch ? '<span style="color:#3a3" title="clase coincide">✓ clase</span>' : '<span style="color:var(--text-muted)">≠ clase</span>';
  const isEvent = c.uciRaceId != null && c.uciRaceId !== 0;
  const label = isEvent ? `Enlazar prueba #${c.competitionId}` : `Enlazar #${c.competitionId}`;
  const evMeta = isEvent ? ` · <span title="race.Id de DataRide de la prueba">prueba ${esc(String(c.uciRaceId))}</span>` : '';
  return `
    <div class="u-row" style="gap:0.5rem;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--border)">
      <button type="button" class="btn btn--ghost u-uci-pick" data-comp="${c.competitionId}"${isEvent ? ` data-uciraceid="${esc(String(c.uciRaceId))}"` : ''}
              style="font-size:0.7rem;padding:0 0.55rem;white-space:nowrap">${esc(label)}</button>
      <div class="u-grow" style="line-height:1.35">
        <div><strong>${esc(c.uciName || '(sin nombre)')}</strong>${recommended ? ' <span style="color:#3a3;font-size:0.7rem">★ propuesto</span>' : ''}</div>
        <div style="color:var(--text-muted);font-size:0.72rem">${tick} · ${cls}${sim ? ' · ' + sim : ''}${evMeta}</div>
      </div>
    </div>`;
}

// Fila para guardar el competitionId tecleado a mano.
function _uciManualSaveRow(raceId) {
  return `
    <div class="u-row" style="gap:0.5rem;margin-top:0.5rem;align-items:center">
      <button type="button" class="btn btn--primary u-uci-save-manual" style="font-size:0.7rem;padding:0 0.6rem">Guardar el valor del campo</button>
      <span style="color:var(--text-muted);font-size:0.72rem">usa el número del campo de arriba</span>
    </div>`;
}

// Construye el cuerpo del panel según el bucket del reporte.
function _renderUciPanel(raceId, rec) {
  const linked  = document.getElementById('er-uciCompetitionId').dataset.uciLinked === '1';
  const linkVal = document.getElementById('er-uciCompetitionId').value;
  const auto    = document.getElementById('er-uciCompetitionId').dataset.uciAuto === '1';

  let head = '';
  if (linked && linkVal) {
    head = `<div style="padding:0.3rem 0.5rem;background:var(--bg-subtle,rgba(0,0,0,0.04));border-radius:6px;margin-bottom:0.5rem">
        Enlazada a <strong>#${esc(linkVal)}</strong> ${auto ? '<span style="color:var(--text-muted);font-size:0.72rem">(auto)</span>' : '<span style="color:var(--text-muted);font-size:0.72rem">(manual)</span>'}
        <button type="button" class="btn btn--ghost u-uci-unlink" style="font-size:0.68rem;padding:0 0.5rem;margin-left:0.4rem;color:#e55">Desenlazar</button>
      </div>`;
  }

  if (!rec) {
    return head + `<div style="color:var(--text-muted)">Esta carrera no está en el reporte de matching
      (futura aún sin publicar en la UCI, o sin equivalente). Introduce el <strong>competitionId</strong>
      a mano si lo conoces.</div>` + _uciManualSaveRow(raceId);
  }

  // Contexto de NUESTRA carrera (lo que el matcher vio).
  const o = rec.our || {};
  const ourLine = `<div style="color:var(--text-muted);font-size:0.72rem;margin-bottom:0.4rem">
      Nuestra: «${esc(o.name || '')}» · ${esc(o.class || '')} · ${esc(o.gender || '')} · ${esc((o.country || '').toUpperCase())} · ${esc((o.dates || []).filter(Boolean).join(' → '))}
    </div>`;

  // unique → 1 candidato propuesto (.match) o CN por prueba (.cnMatch). ambiguous → varios.
  let body = '';
  if (rec.cnMatch && rec.cnMatch.uciRaceId) {
    // Campeonato Nacional: la UCI publica el campeonato entero bajo un competitionId; el
    // matcher resolvió la PRUEBA concreta (por edad/género/tipo). Se enlaza a esa prueba.
    body = `<div style="margin-bottom:0.3rem">Prueba propuesta dentro del Campeonato:</div>`
      + _uciCandidateRow(raceId, {
          competitionId: rec.cnMatch.competitionId,
          uciRaceId: rec.cnMatch.uciRaceId,
          uciName: rec.cnMatch.uciRaceName,
          uciClass: 'CN', classMatch: true,
        }, { recommended: true });
  } else if (rec.bucket === 'unique' && rec.match) {
    body = `<div style="margin-bottom:0.3rem">Candidato propuesto:</div>`
      + _uciCandidateRow(raceId, rec.match, { recommended: true });
  } else if (rec.bucket === 'ambiguous' && Array.isArray(rec.candidates) && rec.candidates.length) {
    // Aviso de colisión masc/fem: la UCI publica UNA competición para el par;
    // la rival comparte competitionId y el constraint impedirá enlazar las dos.
    if (rec.collision && Array.isArray(rec.collision.rivals) && rec.collision.rivals.length) {
      const rivals = rec.collision.rivals.map(rv =>
        `«${esc(rv.name || '')}» <span style="color:var(--text-muted)">(${esc(rv.class || '')}/${esc(rv.gender || '')})</span>`).join(', ');
      body += `<div style="padding:0.35rem 0.5rem;background:rgba(240,160,0,0.12);border-radius:6px;margin-bottom:0.5rem;line-height:1.4">
          ⚠️ <strong>Colisión</strong>: la UCI publica una sola competición (#${rec.collision.competitionId}) para este par.
          Comparte candidato con: ${rivals}.<br>
          <span style="color:var(--text-muted);font-size:0.72rem">Solo UNA de las dos puede enlazar a #${rec.collision.competitionId}. La otra se queda sin enlace UCI (o enlaza otra competición si existe).</span>
        </div>`;
    }
    body += `<div style="margin-bottom:0.3rem">${rec.candidates.length} candidato(s) — elige:</div>`
      + rec.candidates.map(c => _uciCandidateRow(raceId, c)).join('');
  } else {
    body = `<div style="color:var(--text-muted)">Sin candidatos en el reporte. Introduce el <strong>competitionId</strong> a mano.</div>`;
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
//    de lote "Resultados UCI"). Solo toca race_uci_links; NO toca el DOM ni muestra
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
async function _writeUciLink(raceId, competitionId, seasonId = null, uciRaceId = 0) {
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

async function _deleteUciLink(raceId) {
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

// ═══════════════════════════════════════════════════════════════════════════
//  Pestaña "Resultados" del editor de jornada — clasificaciones UCI in-house
//
//  Dos piezas:
//   (1) Origen UCI: el enlace carrera↔competitionId (race_uci_links), editable
//       desde aquí con la MISMA auto-detección del editor de carrera (lee el
//       match-report estático vía _loadUciReport y escribe con _writeUciLink).
//   (2) Las clasificaciones de ESTA jornada (race_uci_stages keepForWeb con
//       raceDayId = jornada; en la última etapa/carreras de un día, también las
//       finales con raceDayId NULL), cada una editable en un drawer nivel 2.
//
//  BLOQUEO (migración 087): guardar una clasificación desde el panel fija
//  race_uci_stages.lockedAt → el upsert del cron (uci-results-upsert.mjs) deja
//  de tocar su cabecera y sus filas. El candado de la lista permite bloquear
//  sin editar o desbloquear (= el siguiente volcado vuelve a mandar).
//  resolve_uci_results sigue corriendo también sobre bloqueadas: solo re-enlaza
//  globalRiderId por dorsal (la startlist curada es la verdad del corredor).
// ═══════════════════════════════════════════════════════════════════════════

const UCI_CLASS_ORDER = ['stage', 'gc', 'points', 'kom', 'youth', 'teams'];
const UCI_CLASS_LABELS = {
  stage: 'Etapa', gc: 'General', points: 'Puntos',
  kom: 'Montaña', youth: 'Jóvenes', teams: 'Equipos',
};
const UCI_IRM_CODES = ['DNF', 'DNS', 'OTL', 'DSQ', 'ABD', 'LAP'];

// Fuentes que el panel puede cambiar a 'uci' al (re)enlazar una competición de DataRide.
// Las de CRONOMETRADOR quedan fuera a propósito: su competitionId es sintético y su
// código propio (tissotCode…) manda — pasarlas a 'uci' las rompería. Ver _writeUciLink.
const UCI_PANEL_OWNED_SOURCES = new Set([null, undefined, 'uci', 'pdf']);

// Fuentes SIN fetcher automático: el cron las salta (uci-results-cron.mjs las excluye en
// la query y con un guard en el bucle) → el volcado es manual. Se avisa en la cabecera
// "Origen UCI" para que no parezca que el cron va a recogerlas y no lo haga en silencio.
const UCI_MANUAL_SOURCES = new Set(['pdf', 'sportstiming', 'manual_timing']);

const UCI_SOURCE_LABELS = {
  uci: 'UCI DataRide', pdf: 'PDF (volcado manual)', tissot: 'Tissot',
  matsport: 'Matsport', sportstiming: 'Sportstiming (volcado manual)',
  manual_timing: 'manual_timing (volcado manual)', raceresult: 'race|result',
  sts: 'STS/Wiclax', domtel: 'Domtel', livetiming: 'Livetiming.at',
  classificacoes: 'Classificações', infocity: 'InfoCity', sportsoft: 'Sportsoft',
  eqtiming: 'EQ Timing', colombia: 'Clasificaciones del Ciclismo Colombiano',
  burgos: 'Vuelta a Burgos',
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

async function setupUciResultsSection(rd, race) {
  const body = document.getElementById('ruSectionBody');
  if (!body) return;
  try {
    const [linkRes, stagesRes] = await Promise.all([
      supabase.from('race_uci_links').select('*').eq('raceId', rd.raceId).maybeSingle(),
      supabase.from('race_uci_stages').select('*').eq('raceId', rd.raceId).eq('keepForWeb', true),
    ]);
    if (linkRes.error) throw linkRes.error;
    if (stagesRes.error) throw stagesRes.error;
    // Guard: el editor pudo cambiar de jornada mientras llegaba la respuesta.
    if (document.getElementById('editorArea')?.dataset.rdId !== rd.id) return;
    _ruRenderSection(body, rd, race, linkRes.data || null, stagesRes.data || []);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div style="color:#e55;font-size:0.8rem">Error al cargar los resultados UCI: ${esc(err.message || String(err))}</div>`;
  }
}

// Cabecera de fuente: el enlace se decide a mano en DataRide; no hay matcher.
function _ruOriginHtml(rd, race, link, stageResults = []) {
  if (!link) {
    return `<div class="ru-origin">
      <div class="ru-origin__state">Esta carrera <strong>no tiene fuente enlazada</strong> —
        sin enlace no hay resultados in-house.</div>
      <div class="u-row" style="gap:0.5rem;margin-top:0.45rem;flex-wrap:wrap">
        <a class="btn btn--ghost" href="https://dataride.uci.ch/iframe/Results/10/" target="_blank" rel="noopener" style="font-size:0.72rem;padding:0.3rem 0.7rem">Últimos resultados de DataRide ↗</a>
        <button type="button" class="btn btn--primary ru-manual-link" style="font-size:0.72rem;padding:0.3rem 0.7rem">Enlazar fuente</button>
      </div>
    </div>`;
  }
  const src = link.source || 'uci';
  const srcLabel = UCI_SOURCE_LABELS[src] || src;
  const lastDumpAt = _ruLastDumpAt(stageResults);
  // Una fuente sin fetcher deja el volcado en manos del volcado manual: decirlo aquí
  // evita que el cron parezca activo y no lo esté (fallo mudo).
  const manualWarn = UCI_MANUAL_SOURCES.has(src)
    ? `<div class="ru-origin__warn" style="color:#e0a400;font-size:0.72rem;margin-top:0.3rem">
        ⚠ Fuente <strong>${esc(srcLabel)}</strong>: el cron NO vuelca esta carrera — sus resultados se suben a mano.
        Sus resultados se mantienen manualmente; no se puede programar un volcado automático para esta fuente.
      </div>`
    : '';
  const isOneDay = race?.raceFormat === 'one_day';
  const canDumpStage = !UCI_MANUAL_SOURCES.has(src) && rd.stageNumber != null;
  const dumpButton = isOneDay
    ? `<button type="button" class="btn btn--primary ru-run-cron" style="font-size:0.72rem;padding:0.3rem 0.7rem"
        title="Re-vuelca esta carrera, respetando las clasificaciones bloqueadas manualmente.">▶ Volcar esta carrera</button>`
    : (canDumpStage
        ? `<button type="button" class="btn btn--primary ru-run-cron-stage" style="font-size:0.72rem;padding:0.3rem 0.7rem"
            title="Vuelca SOLO esta etapa: re-escribe únicamente su clasificación, sin re-volcar las demás etapas de la carrera. Respeta las clasificaciones bloqueadas.">▶ Volcar esta etapa</button>`
        : '');
  return `<div class="ru-origin">
    <div class="ru-origin__state">
      Origen: ${_ruSourceLink(src)}
      ${lastDumpAt ? `<span class="u-c-dim"> · último volcado ${formatDateTime(lastDumpAt)}</span>` : ''}
    </div>
    ${manualWarn}
    ${link.syncError ? `<div style="color:#e55;font-size:0.72rem;margin-top:0.25rem">${esc(link.syncError)}</div>` : ''}
    <div class="u-row" style="gap:0.5rem;margin-top:0.45rem;flex-wrap:wrap">
      <button type="button" class="btn btn--ghost ru-manual-link" style="font-size:0.72rem;padding:0.3rem 0.7rem">Cambiar enlace</button>
      <button type="button" class="btn btn--ghost ru-unlink" style="font-size:0.72rem;padding:0.3rem 0.7rem;color:#e55">Desenlazar</button>
      ${dumpButton}
    </div>
  </div>`;
}

// Fila de una clasificación en la lista de la pestaña.
function _ruClassRowHtml(st) {
  const locked = !!st.lockedAt;
  const winner = st.winnerName ? ` · 🏆 ${esc(st.winnerName)}` : '';
  return `<div class="ru-class-row${locked ? ' ru-class-row--locked' : ''}">
    <div class="ru-class-row__main">
      <span class="ru-class-row__label" title="${esc(st.eventName || '')}">${esc(_ruClassLabel(st))}</span>
      <span class="ru-class-row__meta">${st.rowCount || 0} filas${winner}</span>
    </div>
    ${locked ? `<span class="uci-chip ru-chip-lock" title="Bloqueada el ${esc(formatDateTime(st.lockedAt))} — el cron no la sobreescribe">🔒 bloqueada</span>` : ''}
    <button type="button" class="btn btn--ghost ru-lock-toggle" data-id="${esc(st.id)}" style="font-size:0.68rem;padding:0 0.55rem">${locked ? 'Desbloquear' : 'Bloquear'}</button>
    <button type="button" class="btn btn--ghost ru-edit" data-id="${esc(st.id)}" style="font-size:0.72rem;padding:0.25rem 0.7rem">Editar</button>
    <button type="button" class="btn btn--ghost ru-delete" data-id="${esc(st.id)}" style="font-size:0.72rem;padding:0.25rem 0.7rem;color:#e55" aria-label="Borrar ${esc(_ruClassLabel(st))}">Borrar</button>
  </div>`;
}

function _ruSyncPolicyHtml(rd, link) {
  if (!link || UCI_MANUAL_SOURCES.has(link.source || 'uci')) return '';
  const dayOverride = rd.resultsAutoSyncEnabled != null;
  const enabled = dayOverride ? rd.resultsAutoSyncEnabled : link.autoSyncEnabled;
  const startOffset = dayOverride && rd.resultsSyncStartOffsetMinutes != null
    ? rd.resultsSyncStartOffsetMinutes : (link.syncStartOffsetMinutes ?? -15);
  const interval = dayOverride && rd.resultsSyncIntervalMinutes != null
    ? rd.resultsSyncIntervalMinutes : (link.syncIntervalMinutes ?? 30);
  const stopOffset = dayOverride && rd.resultsSyncStopOffsetMinutes != null
    ? rd.resultsSyncStopOffsetMinutes : (link.syncStopOffsetMinutes ?? 180);
  const stageLabel = rd.stageNumber == null ? 'esta carrera' : `esta etapa (${rd.stageNumber === 0 ? 'prólogo' : 'etapa ' + rd.stageNumber})`;
  return `<details class="ru-sync-policy" style="margin-top:0.65rem">
    <summary style="cursor:pointer;font-size:0.76rem;color:var(--text-muted)">Programación automática ${enabled ? '· activa' : '· desactivada'}</summary>
    <div style="margin-top:0.55rem;padding:0.6rem;border:1px solid var(--border);border-radius:6px;font-size:0.78rem">
      <p style="margin:0 0 0.5rem;color:var(--text-muted)">La captación es opt-in: enlazar una fuente no la activa. Solo se crea un runner si marcas «Activar» y la jornada está dentro de esta ventana.</p>
      <div class="u-row" style="gap:0.6rem;flex-wrap:wrap">
        <label><input type="radio" name="ru-sync-scope" value="race" ${dayOverride ? '' : 'checked'}> Regla global de carrera</label>
        <label><input type="radio" name="ru-sync-scope" value="day" ${dayOverride ? 'checked' : ''}> Solo ${esc(stageLabel)}</label>
      </div>
      <div class="u-row" style="gap:0.55rem;flex-wrap:wrap;margin-top:0.5rem;align-items:end">
        <label> <span class="u-c-dim">Inicio antes de meta</span><input id="ru-sync-before" type="number" min="0" max="1440" value="${Math.max(0, -startOffset)}" style="width:4.5rem"> min</label>
        <label> <span class="u-c-dim">Cadencia</span><input id="ru-sync-interval" type="number" min="1" max="240" value="${interval}" style="width:4.5rem"> min</label>
        <label> <span class="u-c-dim">Parar después de meta</span><input id="ru-sync-after" type="number" min="0" max="2880" value="${Math.max(0, stopOffset)}" style="width:4.5rem"> min</label>
        <label style="white-space:nowrap"><input id="ru-sync-enabled" type="checkbox" ${enabled ? 'checked' : ''}> Activar</label>
        <button type="button" class="btn btn--primary ru-sync-save" style="font-size:0.72rem;padding:0.3rem 0.7rem">Guardar programación</button>
      </div>
    </div>
  </details>`;
}

async function _ruSaveSyncPolicy(btn, rd, race) {
  const scope = document.querySelector('input[name="ru-sync-scope"]:checked')?.value || 'race';
  const before = Number(document.getElementById('ru-sync-before')?.value);
  const interval = Number(document.getElementById('ru-sync-interval')?.value);
  const after = Number(document.getElementById('ru-sync-after')?.value);
  if (!Number.isInteger(before) || before < 0 || !Number.isInteger(interval) || interval < 1 || !Number.isInteger(after) || after < 0) {
    alertDialog('Revisa los minutos: inicio y fin no pueden ser negativos, y la cadencia mínima es 1 minuto.');
    return;
  }
  btn.disabled = true;
  const patch = {
    "resultsAutoSyncEnabled": document.getElementById('ru-sync-enabled').checked,
    "resultsSyncStartOffsetMinutes": -before,
    "resultsSyncIntervalMinutes": interval,
    "resultsSyncStopOffsetMinutes": after,
  };
  try {
    const req = scope === 'day'
      ? supabase.from('race_days').update(patch).eq('id', rd.id)
      : supabase.from('race_uci_links').update({
          autoSyncEnabled: patch.resultsAutoSyncEnabled,
          syncStartOffsetMinutes: patch.resultsSyncStartOffsetMinutes,
          syncIntervalMinutes: patch.resultsSyncIntervalMinutes,
          syncStopOffsetMinutes: patch.resultsSyncStopOffsetMinutes,
          updatedAt: new Date().toISOString(),
        }).eq('raceId', rd.raceId);
    const { error } = await req;
    if (error) throw error;
    showToast(scope === 'day' ? 'Programación de etapa guardada.' : 'Programación global guardada.', 'success');
    setupUciResultsSection(rd, race);
  } catch (err) {
    alertDialog(`No se pudo guardar la programación: ${err.message || err}`, { title: 'Error' });
    btn.disabled = false;
  }
}

function _ruRenderSection(body, rd, race, link, stages) {
  // Clasificaciones de ESTA jornada: por raceDayId; fallback por stageNumber para
  // stages volcados antes de que existiera la jornada (raceDayId quedó NULL).
  const mine = stages.filter(s => s.raceDayId === rd.id
    || (s.raceDayId == null && s.stageNumber != null && rd.stageNumber != null && s.stageNumber === rd.stageNumber));
  // Las FINALES (pseudo-etapa "Final Classification", stageNumber NULL, sin jornada
  // propia) se muestran en la última etapa — y en carreras de un día (su "gc" sin
  // raceDayId es la clasificación de la prueba).
  const maxStage = stages.reduce((m, s) =>
    (s.stageNumber != null && (m == null || s.stageNumber > m)) ? s.stageNumber : m, null);
  const isLastDay = race?.raceFormat === 'one_day'
    || (rd.stageNumber != null && maxStage != null && rd.stageNumber >= maxStage)
    || stages.some(s => s.isFinalClassification && s.stageDate && s.stageDate === rd.dateKey);
  const finals = isLastDay ? stages.filter(s => s.raceDayId == null && s.stageNumber == null) : [];

  const ord = (s) => { const i = UCI_CLASS_ORDER.indexOf(s.classKind); return i === -1 ? 99 : i; };
  mine.sort((a, b) => ord(a) - ord(b));
  finals.sort((a, b) => ord(a) - ord(b));

  // `updatedAt` vive en cada clasificación: no usar `link.lastSyncedAt`, que
  // pertenece a la carrera completa y puede corresponder a otra etapa.
  let html = _ruOriginHtml(rd, race, link, [...mine, ...finals]);
  html += `<div id="ruDetectPanel" style="display:none;margin-top:0.5rem;font-size:0.8rem"></div>`;
  html += _ruSyncPolicyHtml(rd, link);

  // Las clasificaciones ya volcadas se muestran SIEMPRE (aunque la carrera se haya
  // desenlazado después: sin link el cron no refresca, pero los datos siguen ahí).
  if (link && !mine.length && !finals.length) html += `<div class="ru-empty">Aún no hay clasificaciones volcadas para esta jornada.</div>`;
  if (mine.length) html += `<div class="ru-class-list">${mine.map(_ruClassRowHtml).join('')}</div>`;
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
  html += `<div class="u-row" style="margin-top:0.7rem;gap:0.5rem;flex-wrap:wrap">
    <button type="button" class="btn btn--ghost ru-new" style="font-size:0.74rem;padding:0.3rem 0.7rem"
      title="Crea una clasificación vacía para teclear sus resultados a mano. Se crea como placeholder: si luego la UCI/PDF publica esa misma clasificación, su volcado la sustituye.">＋ Nueva clasificación</button>
  </div>`;

  body.innerHTML = html;

  // Cableado por render (el DOM se recrea en cada apertura).
  const stById = new Map(stages.map(s => [s.id, s]));
  body.querySelectorAll('.ru-new').forEach(b => b.addEventListener('click', () => _ruNewClass(rd, race, stages)));
  body.querySelectorAll('.ru-manual-link').forEach(b => b.addEventListener('click', () => _ruOpenManualLink(rd, race)));
  body.querySelectorAll('.ru-sync-save').forEach(b => b.addEventListener('click', () => _ruSaveSyncPolicy(b, rd, race)));
  body.querySelectorAll('.ru-unlink').forEach(b => b.addEventListener('click', () => _ruUnlinkFromDay(rd, race)));
  body.querySelectorAll('.ru-run-cron').forEach(b => b.addEventListener('click', () => _uciRunCronNow(b, rd.raceId)));
  body.querySelectorAll('.ru-run-cron-stage').forEach(b => b.addEventListener('click', () => _uciRunCronNow(b, rd.raceId, rd.stageNumber)));
  body.querySelectorAll('.ru-lock-toggle').forEach(b => b.addEventListener('click', () => {
    const s = stById.get(b.dataset.id);
    if (s) _ruToggleLock(s, rd, race);
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
  panel.innerHTML = `<div class="u-row" style="gap:0.5rem;align-items:center;flex-wrap:wrap">
    <input type="number" id="ruManualComp" placeholder="competitionId" min="1" style="width:9.5rem">
    <input type="number" id="ruManualUciRaceId" placeholder="uciRaceId (CN, opc.)" min="1" style="width:11rem"
      title="Solo para Campeonatos Nacionales: race.Id de DataRide de la prueba dentro de la competición. Vacío = competición entera.">
    <button type="button" class="btn btn--primary ru-manual-save" style="font-size:0.7rem;padding:0 0.6rem">Guardar enlace</button>
  </div>`;
  panel.querySelector('.ru-manual-save').addEventListener('click', () => {
    const comp = parseInt(document.getElementById('ruManualComp').value, 10);
    if (!comp) { alertDialog('Introduce un competitionId numérico.', { title: 'Falta el ID' }); return; }
    const event = parseInt(document.getElementById('ruManualUciRaceId').value, 10) || 0;
    _ruSaveLink(rd, race, comp, event);
  });
}

// Compatibilidad temporal con enlaces profundos antiguos: ya no propone candidatos.
async function _ruOpenDetect(rd, race) {
  _ruOpenManualLink(rd, race);
  return;
  const panel = document.getElementById('ruDetectPanel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<span style="color:var(--text-muted)">Cargando candidatos UCI…</span>';

  let rec = null, reportFailed = false;
  try {
    const { index } = await _loadUciReport();
    rec = index.get(rd.raceId) || null;
  } catch (err) {
    reportFailed = true;
  }

  const manualRow = `
    <div class="u-row" style="gap:0.5rem;margin-top:0.5rem;align-items:center;flex-wrap:wrap">
      <input type="number" id="ruManualComp" placeholder="competitionId" min="1" style="width:9.5rem">
      <input type="number" id="ruManualUciRaceId" placeholder="uciRaceId (CN, opc.)" min="1" style="width:11rem"
             title="Solo para Campeonatos Nacionales: race.Id de DataRide de la prueba dentro de la competición. Vacío = competición entera.">
      <button type="button" class="btn btn--primary ru-manual-save" style="font-size:0.7rem;padding:0 0.6rem">Enlazar el ID del campo</button>
    </div>`;

  let bodyHtml = '';
  if (reportFailed) {
    bodyHtml = `<span style="color:#e55">No se pudo cargar el reporte de matching.</span>
      <div style="color:var(--text-muted);margin-top:0.3rem">Introduce el <strong>competitionId</strong> a mano.</div>`;
  } else if (!rec) {
    bodyHtml = `<div style="color:var(--text-muted)">Esta carrera no está en el reporte de matching
      (futura aún sin publicar en la UCI, o sin equivalente). Introduce el <strong>competitionId</strong>
      a mano si lo conoces.</div>`;
  } else if (rec.cnMatch && rec.cnMatch.uciRaceId) {
    // Campeonato Nacional: el matcher resolvió la PRUEBA concreta dentro del competitionId
    // del campeonato (por edad/género/tipo). Se enlaza a esa prueba (uciRaceId), no a la
    // competición entera → ya no hay "colisión": cada ficha CN apunta a su prueba.
    bodyHtml = `<div style="margin-bottom:0.3rem">Prueba propuesta dentro del Campeonato:</div>`
      + _uciCandidateRow(rd.raceId, {
          competitionId: rec.cnMatch.competitionId,
          uciRaceId: rec.cnMatch.uciRaceId,
          uciName: rec.cnMatch.uciRaceName,
          uciClass: 'CN', classMatch: true,
        }, { recommended: true });
  } else if (rec.bucket === 'unique' && rec.match) {
    bodyHtml = `<div style="margin-bottom:0.3rem">Candidato propuesto:</div>`
      + _uciCandidateRow(rd.raceId, rec.match, { recommended: true });
  } else if (rec.bucket === 'ambiguous' && Array.isArray(rec.candidates) && rec.candidates.length) {
    if (rec.collision && Array.isArray(rec.collision.rivals) && rec.collision.rivals.length) {
      const rivals = rec.collision.rivals.map(rv =>
        `«${esc(rv.name || '')}» <span style="color:var(--text-muted)">(${esc(rv.class || '')}/${esc(rv.gender || '')})</span>`).join(', ');
      bodyHtml += `<div style="padding:0.35rem 0.5rem;background:rgba(240,160,0,0.12);border-radius:6px;margin-bottom:0.5rem;line-height:1.4">
          ⚠️ <strong>Colisión</strong>: la UCI publica una sola competición (#${rec.collision.competitionId}) para este par.
          Comparte candidato con: ${rivals}.
        </div>`;
    }
    bodyHtml += `<div style="margin-bottom:0.3rem">${rec.candidates.length} candidato(s) — elige:</div>`
      + rec.candidates.map(c => _uciCandidateRow(rd.raceId, c)).join('');
  } else {
    bodyHtml = `<div style="color:var(--text-muted)">Sin candidatos en el reporte. Introduce el <strong>competitionId</strong> a mano.</div>`;
  }

  panel.innerHTML = bodyHtml + manualRow;

  panel.querySelectorAll('.u-uci-pick').forEach(btn =>
    btn.addEventListener('click', () => _ruSaveLink(rd, race, parseInt(btn.dataset.comp, 10), parseInt(btn.dataset.uciraceid || '0', 10))));
  panel.querySelector('.ru-manual-save')?.addEventListener('click', () => {
    const v = parseInt(document.getElementById('ruManualComp')?.value, 10);
    if (!v) { alertDialog('Introduce un competitionId numérico en el campo.', { title: 'Falta el ID' }); return; }
    // uciRaceId opcional para enlace manual de una prueba CN (vacío = competición entera).
    const ev = parseInt(document.getElementById('ruManualUciRaceId')?.value, 10) || 0;
    _ruSaveLink(rd, race, v, ev);
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

// Candado de la lista: bloquear sin editar / desbloquear (volver a dejar mandar al cron).
async function _ruToggleLock(st, rd, race) {
  const locked = !!st.lockedAt;
  const msg = locked
    ? '¿Desbloquear esta clasificación? El próximo volcado del cron la sobreescribirá con los datos de la UCI (se perderán las correcciones manuales).'
    : '¿Bloquear esta clasificación sin editarla? El cron dejará de actualizarla con los datos de la UCI.';
  if (!await confirmDialog(msg, locked ? { danger: true } : {})) return;
  const { error } = await supabase.from('race_uci_stages')
    .update({ lockedAt: locked ? null : new Date().toISOString() }).eq('id', st.id);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast(locked ? 'Clasificación desbloqueada — el cron vuelve a sincronizarla.' : 'Clasificación bloqueada — el cron no la sobreescribirá.', 'success');
  setupUciResultsSection(rd, race);
}

// Borra la cabecera y, por ON DELETE CASCADE, las filas de esta clasificación.
// El filtro por carrera evita actuar sobre un id ajeno si se cambió de jornada.
async function _ruDeleteClass(st, rd, race) {
  const label = _ruClassLabel(st);
  const count = st.rowCount || 0;
  const rows = count === 1 ? '1 fila de resultado' : `${count} filas de resultados`;
  const message = `¿Eliminar la clasificación «${label}»? Se borrarán también sus ${rows}.\n\nSi la fuente automática vuelve a publicarla, el cron podrá crearla de nuevo.`;
  if (!await confirmDialog(message, {
    danger: true,
    title: 'Eliminar clasificación',
    confirmText: 'Eliminar',
  })) return;

  const { error } = await supabase.from('race_uci_stages')
    .delete().eq('id', st.id).eq('raceId', rd.raceId);
  if (error) {
    showToast('Error al eliminar la clasificación: ' + error.message);
    return;
  }
  showToast(`Clasificación «${label}» eliminada.`, 'success');
  setupUciResultsSection(rd, race);
}

// ── Crear una clasificación A MANO ────────────────────────────────────────
// Para pruebas sin fuente automática (CN, carreras pequeñas) o para añadir un
// tipo que el cron no trajo. El único punto del sistema que da de alta filas en
// race_uci_stages es el upsert del cron; esto replica esa alta desde el panel.
//
// El id es `ru_<eventId>` y el eventId es SINTÉTICO NEGATIVO determinista (misma
// convención que los fetchers PDF/Matsport/…: fnv1a(salt+clave)%200000). Negativo
// → jamás choca con los eventId positivos de DataRide; el offset por slot+clase lo
// hace único entre clasificaciones de la misma jornada. Se crea SIN bloquear:
// es un placeholder que la fuente oficial PISA si llega (decisión Dani 2026-06-27;
// el upsert purga las gemelas sintéticas por raceId+stageNumber+classKind+scope).
function _ruFnv1a(str) {
  let h = 0x811c9dc5;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}
// Índice por (classKind, isFinal) para separar el eventId de tipos distintos de la
// misma jornada. stage→0, gc→1, points→2, kom→3, youth→4, teams→5; +50 si es final.
const _RU_CLASS_IDX = { stage: 0, gc: 1, points: 2, kom: 3, youth: 4, teams: 5 };
function _ruScopeFor(kind, isFinal) {
  // Espejo de cómo el cron mapea scope (cosmético: la web agrupa por stageNumber +
  // classKind, NO usa scope). stage/gc → 'stage'; secundarias overall → 'overall'.
  if (kind === 'stage' || kind === 'gc') return 'stage';
  return isFinal ? 'stage' : 'overall';
}

// Diálogo: elegir tipo de clasificación (+ "es la final/de la prueba") y crear.
async function _ruNewClass(rd, race, stages) {
  const isOneDay = race?.raceFormat === 'one_day';
  // En carrera de un día la clasificación es la prueba entera (final, sin etapa).
  // En carrera por etapas, por defecto cuelga de ESTA jornada (su stageNumber).
  const opts = Object.keys(UCI_CLASS_LABELS)
    .map(k => `<option value="${k}"${k === (isOneDay ? 'gc' : 'stage') ? ' selected' : ''}>${UCI_CLASS_LABELS[k]}</option>`)
    .join('');

  const h = openDrawer({
    title: 'Nueva clasificación',
    level: 2,
    render: (body) => {
      body.innerHTML = `
        <div class="ru-ed-note">
          Crea una clasificación vacía para teclear sus resultados a mano. Se crea como
          <strong>placeholder</strong>: si más tarde la UCI/PDF publica esa misma clasificación,
          su volcado la sustituye. Para que el cron no la toque, edítala y guárdala (se bloquea)
          o usa el candado de la lista.
        </div>
        <label class="u-block" style="margin:0.8rem 0 0.3rem;font-size:0.8rem">Tipo de clasificación</label>
        <select id="ruNewKind" class="input u-input-block">${opts}</select>
        <label class="u-row" style="gap:0.5rem;margin-top:0.8rem;font-size:0.85rem;cursor:pointer">
          <input type="checkbox" id="ruNewFinal"${isOneDay ? ' checked' : ''}>
          <span>Es la clasificación <strong>final / de la prueba</strong>
            ${isOneDay ? '' : '(general definitiva del último día; no cuelga de una etapa)'}</span>
        </label>
        <div class="u-row" style="gap:0.5rem;margin-top:1.1rem;justify-content:flex-end">
          <button type="button" class="btn btn--ghost ru-new-cancel">Cancelar</button>
          <button type="button" class="btn btn--primary ru-new-create">Crear y editar</button>
        </div>`;
      body.querySelector('.ru-new-cancel').addEventListener('click', () => closeDrawer(2));
      body.querySelector('.ru-new-create').addEventListener('click', async (e) => {
        const kind = body.querySelector('#ruNewKind').value;
        const isFinal = body.querySelector('#ruNewFinal').checked;
        e.target.disabled = true;
        try {
          const st = await _ruCreateClass(rd, race, stages, kind, isFinal);
          closeDrawer(2);
          openUciClassEditor(st, rd, race);   // abre el editor de filas YA existente
        } catch (err) {
          console.error(err);
          showToast('Error al crear: ' + (err.message || err));
          e.target.disabled = false;
        }
      });
    },
  });
  return h;
}

// Inserta la fila en race_uci_stages y devuelve el objeto stage para editarla.
async function _ruCreateClass(rd, race, stages, kind, isFinal) {
  const isOneDay = race?.raceFormat === 'one_day';
  // Una "final" no cuelga de etapa (stageNumber null, raceDayId null, como el cron).
  // Si no, cuelga de ESTA jornada.
  const stageNumber = isFinal ? null : (rd.stageNumber ?? null);
  const raceDayId = isFinal ? null : rd.id;
  const scope = _ruScopeFor(kind, isFinal);

  // Guard contra el error más típico: ya existe esa misma clasificación lógica
  // (raceId ya está fijo por la lista) para esta etapa/scope. Mejor avisar que dejar
  // que reviente el UNIQUE del eventId/id con un error críptico.
  const dup = stages.find(s => s.classKind === kind && s.scope === scope
    && (s.stageNumber ?? null) === stageNumber
    && !!s.isFinalClassification === isFinal);
  if (dup) {
    const lbl = (UCI_CLASS_LABELS[kind] || kind) + (isFinal ? ' (final)' : '');
    throw new Error(`Ya existe una clasificación «${lbl}» para esta jornada. Edítala desde la lista en vez de crear otra.`);
  }

  const base = _ruFnv1a(`manual:${rd.raceId}`) % 200000;
  const slot = (stageNumber == null ? 99 : stageNumber);     // 99 = bloque final
  const idx = (_RU_CLASS_IDX[kind] ?? 9) + (isFinal ? 50 : 0);
  let eventId = -((base * 10000 + slot * 100 + idx) & 0x7fffffff);

  // Garantizar unicidad de eventId frente a lo ya presente (improbable choque, pero
  // dos "finales" de tipos distintos comparten slot 99 → el idx las separa; si aun
  // así colisiona con algo, desplazar).
  const used = new Set(stages.map(s => Number(s.eventId)));
  while (used.has(eventId)) eventId -= 1;

  const id = `ru_${eventId}`;
  const row = {
    id,
    raceId: rd.raceId,
    raceDayId,
    competitionId: eventId,   // sintético: sin DataRide, competitionId = eventId
    uciRaceId: eventId,       // NOT NULL en schema; sintético
    eventId,
    classKind: kind,
    scope,
    eventName: null,
    isTeamEvent: kind === 'teams',
    stageNumber,
    isFinalClassification: isFinal,
    stageDate: rd.dateKey || null,
    raceType: rd.primaryType === 'itt' ? 'ITT' : (rd.primaryType === 'ttt' ? 'TTT' : null),
    rowCount: 0,
    // keepForWeb es una columna GENERADA (migración 092): true cuando classKind ∈
    // {stage,gc,points,kom,youth,teams} Y (classKind ∈ {stage,gc} O scope='overall'
    // O isFinalClassification). _ruScopeFor garantiza scope='overall' en las
    // secundarias no-finales → siempre sale true. NO se inserta a mano.
    // lockedAt: null → placeholder; la fuente oficial puede pisarla hasta que se
    // edite/guarde (que la bloquea) o se use el candado de la lista.
  };
  const { data, error } = await supabase.from('race_uci_stages').insert(row).select().single();
  if (error) throw error;
  return data;
}

// ── Editor de una clasificación (drawer nivel 2) ──────────────────────────
// Tabla editable con las columnas CRUDAS de race_uci_results. Guardar reemplaza
// las filas (insert tras delete, sortOrder = orden visual), BLOQUEA la
// clasificación y re-resuelve los corredores por dorsal (RPC resolve_uci_results).
async function openUciClassEditor(st, rd, race) {
  const stageLbl = st.isFinalClassification ? 'Final' : stageLabel(st.stageNumber) || (race?.name || '');
  const h = openDrawer({
    title: `${UCI_CLASS_LABELS[st.classKind] || st.classKind} — ${stageLbl}`,
    level: 2,
    wide: true,
    render: (body) => {
      body.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:1rem">Cargando clasificación…</div>';
    },
  });

  let rows = [], riderMap = {};
  try {
    const [rowsRes, map] = await Promise.all([
      supabase.from('race_uci_results').select('*')
        .eq('stageRef', st.id).order('sortOrder', { ascending: true }),
      buildResolvedRiderMapForRace(rd.raceId).catch(() => ({})),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    rows = rowsRes.data || [];
    riderMap = map || {};
  } catch (err) {
    console.error(err);
    h.body.innerHTML = `<div style="color:#e55;padding:1rem;font-size:0.85rem">Error al cargar: ${esc(err.message || String(err))}</div>`;
    return;
  }

  const isTeamsClass = st.classKind === 'teams';
  // Tipo de clasificación → qué columna de valor mostrar:
  //   · Puntos/Montaña (points/kom) → columna Pts (sin tiempo).
  //   · Etapa/General/Jóvenes/Equipos → columna Tiempo/Gap (sin puntos).
  const isPtsClass = st.classKind === 'points' || st.classKind === 'kom';
  // Equipos globales para el override manual (chapa + nombre + selector).
  await fetchTeams().catch(() => {});
  const teamById = (id) => (id ? (_teamsCache || []).find(t => t.id === id) : null);
  const gidIndex = riderMap.__byGid || {};
  // Corredor resuelto: por dorsal contra la startlist (preferente) o, sin dorsal
  // casable, por globalRiderId (CN sin startlist) — espejo de la cascada de la web.
  const resolvedOf = (bib, gid) => {
    if (isTeamsClass) return null;
    const t = String(bib ?? '').trim();
    return (/^\d+$/.test(t) ? riderMap[Number(t)] : null) || (gid ? gidIndex[gid] : null) || null;
  };
  const resolvedLabel = (bib, gid) => {
    const r = resolvedOf(bib, gid);
    if (!r) return '';
    const team = r.teamDisplay || r.team || '';
    return `→ ${r.name}${team ? ` · ${team}` : ''}`;
  };
  // Pinta la celda Equipo de una fila:
  //   · Con override (teamId) → equipo elegido a mano, color normal.
  //   · Sin override pero con corredor casado → equipo AUTO-resuelto en gris
  //     (es el que pintará la web; lo muestra para no parecer "sin equipo").
  //   · Sin nada → "— equipo —".
  const teamCellHtml = (teamId, bib, gid) => {
    const ovr = teamById(teamId);
    if (ovr) {
      return `<span class="ru-team-badge">${buildTeamBadgeSvg(ovr, { size: 16 })}</span><span class="ru-team-name">${esc(ovr.name)}</span>`;
    }
    const auto = resolvedOf(bib, gid);
    const autoTeam = auto?.teamObj || null;
    const autoName = auto?.teamDisplay || auto?.team || '';
    if (autoName) {
      const badge = autoTeam ? `<span class="ru-team-badge">${buildTeamBadgeSvg(autoTeam, { size: 16 })}</span>` : '';
      return `<span class="ru-team-auto" title="Equipo auto-resuelto del corredor (pulsa para fijar otro)">${badge}<span class="ru-team-name">${esc(autoName)}</span></span>`;
    }
    return `<span class="ru-team-name ru-team-name--empty">— equipo —</span>`;
  };

  // Celda de valor según el tipo: Pts (points/kom) o Tiempo/Gap (resto).
  const valueCell = (r) => isPtsClass
    ? `<td class="ru-td-value"><input class="ru-in ru-pts" type="number" value="${r.points ?? ''}" placeholder="pts"></td>`
    : `<td class="ru-td-value"><input class="ru-in ru-time" type="text" value="${esc(r.timeText ?? r.gapText ?? '')}" placeholder="H:MM:SS o +0:14"></td>`;

  const rowHtml = (r) => `<tr class="ru-row" draggable="true" data-gid="${esc(r.globalRiderId || '')}" data-team-id="${esc(r.teamId || '')}" data-rv="${esc(r.resultValue ?? '')}">
    <td class="ru-td-drag"><span class="ru-drag-handle" title="Arrastra para reordenar">⠿</span></td>
    <td class="ru-td-rank"><input class="ru-in ru-rank" type="number" min="0" value="${r.rank ?? ''}" placeholder="#"></td>
    <td class="ru-td-bib"><input class="ru-in ru-bib" type="text" inputmode="numeric" value="${esc(r.bib ?? '')}" title="Dorsal (casa el corredor por la startlist al teclearlo)"></td>
    <td class="ru-td-name">
      <div class="ru-name-row">
        <input class="ru-in ru-name" type="text" value="${esc(r.riderDisplay ?? '')}">
        ${isTeamsClass ? '' : `<button type="button" class="ru-act ru-match" title="Casar corredor con la BD">🔗</button>`}
      </div>
      <span class="ru-resolved">${esc(resolvedLabel(r.bib, r.globalRiderId))}</span>
    </td>
    <td class="ru-td-team">
      <button type="button" class="ru-team-btn" title="Asignar equipo a mano (override)">${teamCellHtml(r.teamId, r.bib, r.globalRiderId)}</button>
    </td>
    ${valueCell(r)}
    <td class="ru-td-irm">
      <select class="ru-in ru-irm">
        ${['', 'DNF', 'DNS', 'OTL', 'DSQ'].map(c => `<option value="${c}" ${(r.irm ?? '') === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}
      </select>
    </td>
    <td class="ru-actions">
      <button type="button" class="ru-act ru-del" title="Quitar fila">✕</button>
    </td>
  </tr>`;

  const lockedBadge = st.lockedAt
    ? `<span class="uci-chip ru-chip-lock">🔒 bloqueada desde ${esc(formatDateTime(st.lockedAt))}</span>`
    : '';

  h.body.innerHTML = `
    <div class="ru-ed-note">
      ${lockedBadge}
      Guardar <strong>bloquea</strong> esta clasificación: el cron dejará de sobreescribirla con los
      datos de la UCI hasta que la desbloquees desde la lista. El corredor se resuelve por
      <strong>dorsal</strong> contra la startlist (o por la ficha si no hay dorsal); usa
      <strong>🔗</strong> para casarlo a mano y el botón de <strong>equipo</strong> para fijarlo a
      mano (override; el equipo en gris es el automático). En <strong>Tiempo</strong>: escribe el
      tiempo absoluto del ganador, o el gap del resto empezando por <strong>+</strong>. Arrastra las
      filas (⠿) para reordenarlas.
    </div>
    <div class="u-row" style="gap:0.5rem;flex-wrap:wrap;margin:0.6rem 0">
      <button type="button" class="btn btn--ghost" id="ruAddRow" style="font-size:0.75rem">＋ Añadir fila</button>
      <button type="button" class="btn btn--ghost" id="ruSortRank" style="font-size:0.75rem"
              title="Reordena las filas por la columna # (sin puesto → al final, en su orden actual)">Ordenar por puesto</button>
      <span style="flex:1"></span>
      <button type="button" class="btn btn--primary ru-save" style="font-size:0.78rem">Guardar y bloquear 🔒</button>
    </div>
    <table class="ru-edit-table">
      <thead><tr>
        <th style="width:1.6rem"></th>
        <th class="ru-th-rank" title="Puesto (vacío = no clasificado)">#</th>
        <th style="width:2.8rem" title="Dorsal — casa el corredor por la startlist al teclearlo">Dor.</th>
        <th>${isTeamsClass ? 'Equipo' : 'Corredor'}</th>
        <th style="width:9rem" title="Equipo (override manual; gana a la resolución por dorsal)">Equipo</th>
        ${isPtsClass
          ? '<th style="width:5rem" title="Puntos">Pts</th>'
          : '<th style="width:7rem" title="Tiempo del ganador, o gap del resto empezando por +">Tiempo / Gap</th>'}
        <th style="width:4.6rem" title="DNF/DNS/OTL/DSQ">IRM</th>
        <th style="width:2.4rem"></th>
      </tr></thead>
      <tbody id="ruRows">${rows.map(rowHtml).join('')}</tbody>
    </table>
    <div class="u-row" style="gap:0.5rem;margin-top:0.8rem;justify-content:flex-end">
      <button type="button" class="btn btn--ghost ru-cancel">Cancelar</button>
      <button type="button" class="btn btn--primary ru-save">Guardar y bloquear 🔒</button>
    </div>`;

  const tbody = h.body.querySelector('#ruRows');
  const bibOf = (tr) => tr.querySelector('.ru-bib')?.value || '';

  // Refresca la celda de equipo (override o auto-resuelto en gris) de una fila.
  const refreshTeamCell = (tr) => {
    const btn = tr.querySelector('.ru-team-btn');
    if (btn) btn.innerHTML = teamCellHtml(tr.dataset.teamId || '', bibOf(tr), tr.dataset.gid || '');
  };
  // Refresca el hint del corredor resuelto de una fila.
  const refreshResolved = (tr) => {
    const span = tr.querySelector('.ru-resolved');
    if (span) span.textContent = resolvedLabel(bibOf(tr), tr.dataset.gid || '');
  };

  // Acciones de fila por delegación (sobreviven a añadir/mover filas).
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    // Casar corredor a mano (🔗): fija globalRiderId como override.
    if (e.target.closest('.ru-match')) {
      _ruOpenRiderMatchPicker(tr, race?.gender, (b) => resolvedLabel(b, tr.dataset.gid || ''), refreshTeamCell);
      return;
    }
    // Asignar equipo a mano (override): selector de equipos globales.
    if (e.target.closest('.ru-team-btn')) {
      _ruOpenTeamPicker(tr, race, refreshTeamCell);
      return;
    }
    if (e.target.closest('.ru-del')) tr.remove();
  });
  // Dorsal editado → CASAR al instante contra la startlist: si el dorsal existe,
  // fija el corredor (gid + nombre) sin esperar a guardar; si no, limpia el gid
  // heredado y deja el corredor sin enlazar (lo re-resuelve la RPC si procede).
  tbody.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ru-bib')) return;
    const tr = e.target.closest('tr');
    const t = String(e.target.value ?? '').trim();
    const hit = /^\d+$/.test(t) ? riderMap[Number(t)] : null;
    if (hit && hit.globalRiderId) {
      tr.dataset.gid = hit.globalRiderId;
      const nameInput = tr.querySelector('.ru-name');
      if (nameInput && hit.name) nameInput.value = hit.name;
    } else {
      tr.dataset.gid = '';
    }
    refreshResolved(tr);
    refreshTeamCell(tr);
  });

  // ── Reordenar filas arrastrando con el ratón (HTML5 drag-and-drop) ──
  let dragRow = null;
  tbody.addEventListener('dragstart', (e) => {
    dragRow = e.target.closest('tr.ru-row');
    if (!dragRow) return;
    dragRow.classList.add('ru-row--dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox exige setData para iniciar el arrastre.
    try { e.dataTransfer.setData('text/plain', ''); } catch (_) {}
  });
  tbody.addEventListener('dragend', () => {
    dragRow?.classList.remove('ru-row--dragging');
    dragRow = null;
  });
  tbody.addEventListener('dragover', (e) => {
    if (!dragRow) return;
    e.preventDefault();
    const over = e.target.closest('tr.ru-row');
    if (!over || over === dragRow) return;
    const rect = over.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    tbody.insertBefore(dragRow, after ? over.nextElementSibling : over);
  });

  h.body.querySelector('#ruAddRow').addEventListener('click', () => {
    tbody.insertAdjacentHTML('beforeend', rowHtml({}));
    tbody.lastElementChild?.querySelector('.ru-rank')?.focus();
  });
  h.body.querySelector('#ruSortRank').addEventListener('click', () => {
    const trs = [...tbody.children];
    const keyOf = (tr) => {
      const v = parseInt(tr.querySelector('.ru-rank')?.value, 10);
      return Number.isFinite(v) ? v : Infinity;
    };
    trs.map((tr, i) => ({ tr, k: keyOf(tr), i }))
      .sort((a, b) => (a.k - b.k) || (a.i - b.i))
      .forEach(({ tr }) => tbody.appendChild(tr));
  });
  h.body.querySelector('.ru-cancel').addEventListener('click', () => closeDrawer(2));

  // ── Guardado: lock → reemplazo de filas → cabecera → re-resolución por dorsal ──
  const save = async () => {
    const records = [];
    for (const tr of tbody.querySelectorAll('tr.ru-row')) {
      const val = (sel) => tr.querySelector(sel)?.value.trim() ?? '';
      const txtOf = (sel) => (val(sel) === '' ? null : val(sel));
      const intOf = (sel) => {
        const v = val(sel);
        if (v === '') return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };
      const rank = intOf('.ru-rank');
      const irm = txtOf('.ru-irm')?.toUpperCase() || null;
      const bib = txtOf('.ru-bib');
      const name = txtOf('.ru-name');
      // Columna de tiempo única: empieza por '+' → gap; si no → tiempo absoluto.
      const timeRaw = txtOf('.ru-time');
      const isGap = timeRaw != null && timeRaw.startsWith('+');
      const timeText = isGap ? null : timeRaw;
      const gapText  = isGap ? timeRaw : null;
      // resultValue (crudo de la UCI) ya no se edita: se conserva el original de
      // la fila (data-rv) para no perder el respaldo que vuelca el cron.
      const resultValue = tr.dataset.rv ? tr.dataset.rv : null;
      // Descartar filas totalmente vacías ("+ Añadir fila" sin rellenar).
      if (rank == null && !bib && !name && !timeRaw
          && intOf('.ru-pts') == null && !resultValue && !irm) continue;
      records.push({
        stageRef: st.id,
        raceId: rd.raceId,
        eventId: st.eventId,
        rank,
        rankText: rank != null ? String(rank) : irm,
        bib,
        riderDisplay: name || '—',   // NOT NULL en schema; la web resuelve por dorsal
        globalRiderId: tr.dataset.gid || null,
        teamId: tr.dataset.teamId || null,   // override manual de equipo (gana al dorsal)
        resultValue,
        timeText,
        gapText,
        points: intOf('.ru-pts'),
        irm,
        sortOrder: records.length,
      });
    }

    const btns = h.body.querySelectorAll('.ru-save, .ru-cancel, #ruAddRow, #ruSortRank');
    btns.forEach(b => b.disabled = true);
    try {
      // 1) Bloquear PRIMERO: a partir de aquí el cron ya no interfiere.
      const { error: lockErr } = await supabase.from('race_uci_stages')
        .update({ lockedAt: new Date().toISOString() }).eq('id', st.id);
      if (lockErr) throw lockErr;
      // 2) Reemplazo de filas (con el lock puesto, la ventana sin filas es segura;
      //    si el INSERT fallara, el editor sigue abierto → reintentar Guardar).
      const { error: delErr } = await supabase.from('race_uci_results')
        .delete().eq('stageRef', st.id);
      if (delErr) throw delErr;
      if (records.length) {
        const { error: insErr } = await supabase.from('race_uci_results').insert(records);
        if (insErr) throw insErr;
      }
      // 3) Cabecera coherente con lo editado (rowCount/winnerName son el resumen).
      const winner = records.find(r => r.rank === 1);
      const winnerName = winner
        ? (resolvedOf(winner.bib, winner.globalRiderId)?.name || (winner.riderDisplay !== '—' ? winner.riderDisplay : null))
        : null;
      const { error: updErr } = await supabase.from('race_uci_stages')
        .update({ rowCount: records.length, winnerName }).eq('id', st.id);
      if (updErr) throw updErr;
      // 4) Re-resolver corredores por dorsal (no fatal: los datos ya están guardados).
      const { error: rpcErr } = await supabase.rpc('resolve_uci_results', { p_race_id: rd.raceId });
      if (rpcErr) showToast('Guardado, pero falló la re-resolución por dorsal: ' + rpcErr.message);

      showToast('Clasificación guardada y bloqueada — el cron no la sobreescribirá.', 'success');
      closeDrawer(2);
      setupUciResultsSection(rd, race);
    } catch (err) {
      console.error(err);
      showToast('Error al guardar: ' + (err.message || err));
      btns.forEach(b => b.disabled = false);
    }
  };
  h.body.querySelectorAll('.ru-save').forEach(b => b.addEventListener('click', save));
}

// ── Picker de corredor para una fila de la clasificación (override manual) ──
// Variante ligera del picker de inscritos: busca por nombre en riders_men/women
// (según el género de la carrera) y, al elegir, fija tr.dataset.gid + el nombre.
// El gid manual sobrevive al cron porque resolve_uci_results ya no borra un
// globalRiderId cuyo dorsal no casa con la startlist (migración 112).
let _ruMatchPickerEl = null;
function _ruCloseMatchPicker() { _ruMatchPickerEl?.remove(); _ruMatchPickerEl = null; }
function _ruOpenRiderMatchPicker(tr, gender, resolvedLabel, onChange) {
  _ruCloseMatchPicker();
  const ridersTable = gender === 'female' ? 'riders_women' : gender === 'male' ? 'riders_men' : null;
  if (!ridersTable) { showToast('La carrera no tiene género definido', 'error'); return; }
  const currentId = tr.dataset.gid || null;

  const pop = document.createElement('div');
  pop.style.cssText = 'position:absolute;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.6rem;width:360px;max-height:420px;overflow:auto;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
  pop.innerHTML = `
    ${currentId ? `<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:0.35rem">Match actual: <code style="color:var(--text)">${esc(currentId)}</code></div>` : ''}
    <input type="search" class="ru-pick-input" placeholder="Apellido, nombre u otherNames…"
           style="width:100%;padding:0.4rem 0.6rem;font-size:0.82rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none;box-sizing:border-box;margin-bottom:0.4rem">
    <div class="ru-pick-results" style="display:flex;flex-direction:column;gap:0.2rem;min-height:1.2rem"></div>
    <div style="margin-top:0.5rem;border-top:1px solid var(--border);padding-top:0.5rem;display:flex;justify-content:space-between;align-items:center">
      ${currentId ? '<button data-action="unlink" type="button" class="btn btn--ghost" style="padding:0.3rem 0.6rem;font-size:0.72rem;color:var(--text-dim)">Desligar</button>' : '<span></span>'}
      <button data-action="close" type="button" class="btn btn--ghost" style="padding:0.3rem 0.6rem;font-size:0.72rem">Cerrar</button>
    </div>`;
  document.body.appendChild(pop);
  const cell = tr.querySelector('.ru-td-name') || tr;
  const rect = cell.getBoundingClientRect();
  pop.style.left = (rect.left + window.scrollX) + 'px';
  pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  const popRect = pop.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 16) pop.style.left = (rect.right + window.scrollX - popRect.width) + 'px';
  _ruMatchPickerEl = pop;

  const input = pop.querySelector('.ru-pick-input');
  const results = pop.querySelector('.ru-pick-results');
  let reqId = 0;
  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    if (q.length < 2) { results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Escribe al menos 2 letras.</div>'; return; }
    results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Buscando…</div>';
    const safe = q.replace(/[%,()]/g, '');
    const { data, error } = await supabase.from(ridersTable)
      .select('id,firstName,lastName,otherNames,nationality,verified')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div style="color:var(--red);font-size:0.72rem;padding:0.3rem">Error: ${esc(error.message)}</div>`; return; }
    if (!data?.length) { results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Sin resultados.</div>'; return; }
    results.innerHTML = data.map(rd2 => `
      <div data-pick="${esc(rd2.id)}" role="button" tabindex="0" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.4rem;background:var(--bg);border:1px solid ${rd2.id === currentId ? '#22c55e' : 'var(--border)'};border-radius:5px;font-size:0.78rem;color:var(--text);cursor:pointer">
        ${_slRiderFlagPreview(rd2.nationality)}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${esc(rd2.lastName)}</strong>, ${esc(rd2.firstName)}${rd2.otherNames ? ` <span class="u-c-dim u-fs-070">(${esc(rd2.otherNames)})</span>` : ''}</span>
        ${rd2.verified === false ? '<span title="Sin verificar" style="color:#f59e0b;font-size:0.65rem;font-weight:700;flex-shrink:0">?</span>' : ''}
      </div>`).join('');
    results.querySelectorAll('[data-pick]').forEach(el => {
      el.addEventListener('click', () => {
        const rider = data.find(x => x.id === el.dataset.pick);
        if (!rider) return;
        tr.dataset.gid = rider.id;
        const nameInput = tr.querySelector('.ru-name');
        if (nameInput) nameInput.value = `${rider.firstName || ''} ${rider.lastName || ''}`.trim();
        const span = tr.querySelector('.ru-resolved');
        if (span) span.textContent = `→ ${rider.firstName || ''} ${rider.lastName || ''}`.trim() + ' (manual)';
        onChange?.(tr);   // refresca la celda de equipo auto-resuelto
        _ruCloseMatchPicker();
        showToast(`Corredor casado: ${rider.firstName} ${rider.lastName}`, 'success');
      });
    });
  };
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _ruCloseMatchPicker(); });
  pop.querySelector('[data-action="unlink"]')?.addEventListener('click', () => {
    tr.dataset.gid = '';
    const span = tr.querySelector('.ru-resolved');
    if (span) span.textContent = resolvedLabel(tr.querySelector('.ru-bib')?.value || '');
    onChange?.(tr);   // refresca la celda de equipo auto-resuelto
    _ruCloseMatchPicker();
    showToast('Match eliminado', 'success');
  });
  pop.querySelector('[data-action="close"]').addEventListener('click', _ruCloseMatchPicker);
  // Precarga: buscar ya por el nombre que hay en la fila (espejo de inscritos),
  // para mostrar candidatos + resaltar el match actual sin teclear nada. El
  // último token suele ser el apellido (la búsqueda casa mejor por lastName).
  const seedName = (tr.querySelector('.ru-name')?.value || '').trim();
  const seed = seedName.split(/\s+/).filter(Boolean).pop() || seedName;
  if (seed.length >= 2) { input.value = seed; search(); }
  setTimeout(() => input.focus(), 0);
}

// ── Combobox de equipos reutilizable (con chapa) ────────────────────────────
// Reemplaza al <select> nativo, que no admite SVG dentro de las opciones. Muestra
// la chapa (buildTeamBadgeSvg) + nombre + etiqueta «Ed. especial» de cada equipo,
// con búsqueda por texto y navegación por teclado (↑/↓/Enter/Esc). Recibe la lista
// YA filtrada (por sexo, etc.) y devuelve el equipo elegido por callback.
//
// opts = {
//   title,                // encabezado del modal
//   teams,                // array de equipos candidatos (ya filtrado)
//   currentId,            // id preseleccionado (o '')
//   suggestionId,         // id a resaltar como sugerencia (opcional)
//   allowNone,            // muestra opción «— Ninguno —» (default true)
//   validate,             // (team) => {ok, reason}; bloquea al confirmar (opcional)
//   onPick,               // (teamIdOrEmpty) => void
// }
function _openTeamCombo(opts) {
  const { title = 'Asignar equipo', teams = [], currentId = '',
          suggestionId = '', allowNone = true, validate, onPick } = opts;
  const sorted = [...teams].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const overlay = document.createElement('div');
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:1.2rem;width:min(92vw,440px);display:flex;flex-direction:column;gap:0.7rem">
      <div style="font-family:var(--font-display);font-weight:700;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.03em">${esc(title)}</div>
      <input type="text" class="tc-search" placeholder="Buscar equipo…" autocomplete="off"
        style="padding:0.45rem 0.55rem;font-size:0.85rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
      <div class="tc-list" role="listbox" tabindex="-1"
        style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:0.2rem;border:1px solid var(--border);border-radius:6px;padding:0.3rem;background:var(--bg)"></div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end">
        <button class="btn btn--ghost tc-cancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('.tc-list');
  const searchEl = overlay.querySelector('.tc-search');
  const close = () => { document.removeEventListener('keydown', onDocKey, true); overlay.remove(); };

  // Filas candidatas (incluye «Ninguno» como pseudo-fila con id '').
  const rows = [];
  if (allowNone) rows.push({ id: '', name: '— Ninguno —', _none: true });
  sorted.forEach(t => rows.push(t));

  let filtered = rows.slice();
  let active = -1; // índice sobre `filtered`

  const rowHtml = (t, idx, isActive) => {
    const selected = t.id === currentId;
    const isSug = t.id && t.id === suggestionId;
    const badge = t._none ? '' : `<span class="u-shrink-0">${buildTeamBadgeSvg(t, { size: 20 })}</span>`;
    const special = t.specialEdition
      ? '<span style="font-size:0.66rem;color:var(--text-dim);white-space:nowrap;margin-left:auto">Ed. especial</span>' : '';
    const sug = isSug ? '<span style="font-size:0.62rem;font-weight:700;color:var(--accent);white-space:nowrap;margin-left:0.35rem">sugerido</span>' : '';
    const border = isActive ? 'var(--accent)' : (selected ? '#22c55e' : 'var(--border)');
    return `<div class="tc-item" data-idx="${idx}" data-id="${esc(t.id)}" role="option" aria-selected="${selected}"
        style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;border:1px solid ${border};border-radius:5px;cursor:pointer;font-size:0.82rem;color:var(--text);${t._none ? 'font-style:italic;color:var(--text-dim)' : ''}">
        ${badge}<span style="${t._none ? '' : 'font-weight:600'}">${esc(t.name)}</span>${sug}${special}
      </div>`;
  };

  const render = () => {
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Sin equipos que coincidan.</div>';
      return;
    }
    listEl.innerHTML = filtered.map((t, i) => rowHtml(t, i, i === active)).join('');
    const act = listEl.querySelector(`.tc-item[data-idx="${active}"]`);
    if (act) act.scrollIntoView({ block: 'nearest' });
  };

  const pick = (t) => {
    if (t && !t._none && validate) {
      const v = validate(t);
      if (!v.ok) { alertDialog(v.reason, { title: '⚠️ No permitido' }); return; }
    }
    onPick?.(t ? t.id : '');
    close();
  };

  const applyFilter = () => {
    const q = normalizeTeamName(searchEl.value.trim());
    filtered = !q ? rows.slice() : rows.filter(t => t._none || normalizeTeamName(t.name || '').includes(q));
    // Activo por defecto: la selección/sugerencia actual si sigue visible; si no,
    // el PRIMER equipo real (nunca «Ninguno», para que Enter tras buscar no borre
    // la asignación); y solo si no hay equipos reales, se cae a «Ninguno».
    active = filtered.findIndex(t => t.id && (t.id === currentId || t.id === suggestionId));
    if (active < 0) active = filtered.findIndex(t => !t._none);
    if (active < 0) active = filtered.length ? 0 : -1;
    render();
  };

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.tc-item');
    if (!item) return;
    pick(filtered[Number(item.dataset.idx)]);
  });
  searchEl.addEventListener('input', applyFilter);
  overlay.querySelector('.tc-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const onDocKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { active = (active + 1) % filtered.length; render(); } return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (filtered.length) { active = (active - 1 + filtered.length) % filtered.length; render(); } return; }
    if (e.key === 'Enter')     { e.preventDefault(); if (active >= 0 && filtered[active]) pick(filtered[active]); return; }
  };
  document.addEventListener('keydown', onDocKey, true);

  applyFilter();
  setTimeout(() => searchEl.focus(), 0);
}

// ── Picker de equipo para una fila de la clasificación (override manual) ──
// Combobox con chapas sobre los equipos globales. Valida specialEdition y sexo
// contra la carrera de la jornada (mismo guard que inscritos). Guarda en tr.dataset.teamId.
function _ruOpenTeamPicker(tr, race, onPicked) {
  if (!_teamsCache || _teamsCache.length === 0) {
    alertDialog('No hay equipos globales. Crea equipos en la pestaña Equipos primero.');
    return;
  }
  const current = tr.dataset.teamId || '';
  // Candidatos filtrados por sexo de la carrera (excluye el sexo opuesto); se
  // incluye igualmente el equipo ya asignado aunque sea del sexo opuesto (dato
  // heredado) para poder verlo y corregirlo.
  const genderTeams = _teamsFilteredByGender(_teamsCache, race && race.gender);
  if (current && !genderTeams.some(t => t.id === current)) {
    const cur = _teamsCache.find(t => t.id === current);
    if (cur) genderTeams.push(cur);
  }
  _openTeamCombo({
    title: 'Equipo (override)',
    teams: genderTeams,
    currentId: current,
    validate: (team) => {
      const v = _validateSpecialEditionForRace(team, race);
      if (!v.ok) return v;
      return _validateGenderMismatch(team, race && race.gender);
    },
    onPick: (val) => { tr.dataset.teamId = val || ''; onPicked?.(tr); },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Vista "Resultados UCI" — revisión en lote de enlaces carrera↔competición
//  (rail-item data-tab="uci"). Espejo del escáner de duplicados (#dupScanModal):
//  presenta de golpe los casos que el matcher dejó sin resolver, con su contexto
//  y un botón por caso, en vez de obligar a abrir el editor carrera por carrera.
//
//  Fuente de verdad: el match-report.json ESTÁTICO (vía _loadUciReport, cacheado;
//  NO re-corre el matcher, la API DataRide es CORS-only) RECONCILIADO con el estado
//  vivo de race_uci_links. Una carrera que el reporte llama "ambiguous" puede estar
//  ya enlazada (a mano o por backfill) → el estado vivo manda para pintar.
// ═══════════════════════════════════════════════════════════════════════════

let _uciViewReady = false;
let _uciShowAll = false;          // toggle "solo pendientes / ver todas"
let _uciLinkMap = new Map();      // raceId → { competitionId, autoMatched } (estado vivo)

async function setupUciView() {
  const view = document.getElementById('uciView');
  if (!_uciViewReady) {
    _uciViewReady = true;
    view.innerHTML = `
      <div class="panel-section-divider">
        <div class="panel-view-row">
          <div class="panel-view-title">Resultados UCI</div>
          <div class="u-row" style="gap:0.5rem;align-items:center">
            <button class="btn btn--primary" id="uciRunCron" style="padding:0.35rem 0.7rem;font-size:0.75rem"
              title="Dispara el workflow de volcado para TODAS las carreras con etapa hoy, sin esperar la ventana de meta">▶ Volcar hoy ahora</button>
            <button class="btn btn--ghost" id="uciToggleAll" style="padding:0.35rem 0.7rem;font-size:0.75rem"></button>
          </div>
        </div>
        <div style="max-width:900px;margin:0.5rem auto 0;color:var(--text-dim);font-size:0.78rem" id="uciSubtitle">Cargando…</div>
      </div>
      <div style="padding:1.25rem;max-width:900px;margin:0 auto;width:100%;box-sizing:border-box">
        <div class="u-stack" id="uciViewContent"></div>
      </div>`;
    document.getElementById('uciToggleAll').addEventListener('click', () => {
      _uciShowAll = !_uciShowAll;
      renderUciReview();
    });
    document.getElementById('uciRunCron').addEventListener('click', e => _uciRunCronNow(e.currentTarget));
  }
  await renderUciReview();
}

// Botón de volcado a mano del cron de resultados (RPC admin_trigger_uci_results_workflow,
// migraciones 088/099/134). La RPC solo ENCOLA el workflow_dispatch (pg_net es asíncrono):
// aquí se confirma el encolado; el run tarda ~1-3 min en verse reflejado en la web.
//   · Sin raceId → "▶ Volcar hoy ahora" (vista global): ignore_window=true,
//     procesa TODO lo que tenga etapa HOY sin esperar la ventana de meta (087).
//   · Con raceId → "▶ Volcar esta carrera" (pestaña Resultados de la jornada):
//     vuelca SOLO esa carrera ignorando fecha/ventana → trae TODAS las etapas que
//     la UCI tenga publicadas, también las de días anteriores (caso Tour de Beauce:
//     resultados de ayer que "hoy" no recogía). Migración 099.
//   · Con raceId + stageNumber → "▶ Volcar esta etapa" (migración 134): re-escribe
//     SOLO esa etapa (stage_number → --stage → --only-stage en el upsert). El fetcher
//     sigue trayendo la carrera entera, pero no se re-vuelcan las demás etapas: en una
//     grande (Tour, 21 etapas) tocar la etapa 16 ya no re-escribe la 1-15. stageNumber
//     puede ser 0 (prólogo) → se comprueba con `!= null`, NO por truthiness.
async function _uciRunCronNow(btn, raceId = null, stageNumber = null) {
  const oneStage = raceId && stageNumber != null;
  // Los botones de una carrera ya expresan el alcance de la operación. El toast
  // posterior confirma visualmente que la RPC se ha encolado. La confirmación
  // queda reservada para la acción global, que afecta a todas las carreras de hoy.
  if (!raceId) {
    const ok = await confirmDialog(
      '¿Disparar ahora el volcado de resultados UCI? Procesa todas las carreras con etapa hoy (sin esperar la ventana de meta); los resultados tardan 1-3 min en verse reflejados.'
    );
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    const { error } = oneStage
      ? await supabase.rpc('admin_trigger_uci_results_workflow', { p_race_id: raceId, p_stage: stageNumber })
      : raceId
      ? await supabase.rpc('admin_trigger_uci_results_workflow', { p_race_id: raceId })
      : await supabase.rpc('admin_trigger_uci_results_workflow');
    if (error) throw error;
    showToast('Volcado disparado — visible en la web en 1-3 min', 'success', 6000);
  } catch (err) {
    showToast('No se pudo disparar el volcado: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
  }
}

// Marca que hay páginas estáticas pendientes de crear solo cuando la URL
// canónica de la jornada todavía responde 404. Una página ya creada se hidrata
// con los datos vivos de Supabase y no necesita reconstruir el artifact.
//
// DEBOUNCE EN EL SERVIDOR (migración 121): antes esto programaba un setTimeout(8s)
// en el navegador que, al vencer, disparaba los workflows. Era frágil — si tras
// guardar se cambiaba de jornada, se cerraba el editor, se recargaba o la pestaña
// pasaba a segundo plano (el navegador congela sus timers), el dispatch NUNCA salía
// y la página quedaba en 404 hasta el cron diario (bug cazado con la Clásica
// Castilla y León 2026). Y no colapsaba ráfagas entre guardados espaciados: una
// sesión de edición llegaba a disparar ~15 runs de og-pages en 30 min.
//
// La comprobación es conservadora: solo un 404 confirmado marca la cola. Un
// error de red o una respuesta distinta no dispara nada, porque una edición de
// una jornada existente nunca debe provocar una regeneración por defecto.
//
// Fire-and-forget y NON-BLOCKING: el guardado ya terminó cuando se llama.
async function _markWebPagesDirtyIfMissing(slug) {
  try {
    const pageUrl = `${CONFIG.basePath}/jornada/${encodeURIComponent(slug)}/`;
    const response = await fetch(pageUrl, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) return;
    if (response.status !== 404) {
      console.warn(`No se comprobó la página de jornada (${response.status}); no se regenera.`);
      return;
    }
    const { error } = await supabase.rpc('admin_mark_web_pages_dirty');
    if (error) console.warn('No se pudo marcar la creación de páginas:', error.message || error);
  } catch (err) {
    console.warn('No se pudo comprobar la página de jornada; no se regenera:', err?.message || err);
  }
}

// Carga el estado vivo de race_uci_links (tabla corta) → Map por raceId.
async function _loadUciLinkMap() {
  _uciLinkMap = new Map();
  try {
    const { data, error } = await supabase.from('race_uci_links').select('raceId, competitionId, autoMatched');
    if (error) throw error;
    for (const row of (data || [])) _uciLinkMap.set(row.raceId, { competitionId: row.competitionId, autoMatched: row.autoMatched });
  } catch (err) { console.warn('[uci] loadLinkMap', err); }
  return _uciLinkMap;
}

// Carreras canceladas en el estado VIVO de la BD → fuera de la revisión. El reporte
// de matching es un snapshot estático: una carrera cancelada DESPUÉS de generarlo
// seguiría apareciendo como ambigua/sin-match (caso real: Tour du Doubs 2026). El
// matcher ya las excluye al regenerar el reporte (uci-match-poc.mjs); aquí se aplica
// el mismo criterio en vivo — marcar cancelada en el editor la saca de la vista.
async function _loadUciCancelledSet() {
  try {
    const { data, error } = await supabase.from('races').select('id').eq('isCancelled', true);
    if (error) throw error;
    return new Set((data || []).map(r => r.id));
  } catch (err) { console.warn('[uci] loadCancelledSet', err); return new Set(); }
}

async function renderUciReview() {
  const content = document.getElementById('uciViewContent');
  const subtitle = document.getElementById('uciSubtitle');
  const toggle = document.getElementById('uciToggleAll');
  if (!content) return;
  content.innerHTML = '<div class="u-empty-note">Cargando reporte de matching…</div>';

  let report;
  try { ({ report } = await _loadUciReport()); }
  catch (err) {
    content.innerHTML = `<div class="u-empty-note">No se pudo cargar el reporte de matching (${esc(err.message)}).</div>`;
    subtitle.textContent = 'Error al cargar.';
    return;
  }
  await _loadUciLinkMap();
  const cancelled = await _loadUciCancelledSet();

  // Construir los grupos desde el reporte (solo dentro del horizonte UCI; las
  // futuras aún sin publicar no tienen candidato y se enlazan solas al publicarse).
  // Las canceladas en el estado VIVO se excluyen de TODOS los grupos: el reporte es
  // un snapshot y el vivo manda, igual que con race_uci_links.
  const inPlay = (r) => r.inHorizon && !cancelled.has(r.our.id);
  const amb = (report.ambiguous || []).filter(inPlay);
  const collisions = amb.filter(r => r.collision);
  const realAmbig = amb.filter(r => !r.collision);
  const noneIn = (report.none || []).filter(inPlay);

  // Colisiones → grupos por competitionId compartido (cada grupo = una tarjeta-par).
  const byComp = new Map();
  for (const r of collisions) {
    const k = r.collision.competitionId;
    if (!byComp.has(k)) byComp.set(k, []);
    byComp.get(k).push(r);
  }

  // ¿Un caso está resuelto? (todas sus carreras tienen enlace en el estado vivo, o
  // —en colisión— alguna del par ya tiene el competitionId compartido).
  const isLinked = (id) => _uciLinkMap.has(id);
  const collisionResolved = (group, comp) => group.some(r => _uciLinkMap.get(r.our.id)?.competitionId === comp);

  // Filtrar pendientes salvo "ver todas".
  const pendingCollisions = [...byComp.entries()].filter(([comp, grp]) => _uciShowAll || !collisionResolved(grp, comp));
  const pendingAmbig = realAmbig.filter(r => _uciShowAll || !isLinked(r.our.id));

  // Subtítulo + toggle.
  const totalPendC = [...byComp.entries()].filter(([comp, grp]) => !collisionResolved(grp, comp)).length;
  const totalPendA = realAmbig.filter(r => !isLinked(r.our.id)).length;
  subtitle.innerHTML = `${totalPendC + totalPendA} por revisar · <strong>${totalPendC}</strong> colisiones masc/fem · <strong>${totalPendA}</strong> ambiguas`
    + (_uciShowAll ? ` · mostrando también ${noneIn.length} sin equivalente UCI + ya resueltas` : '');
  toggle.textContent = _uciShowAll ? 'Solo pendientes' : 'Ver todas';

  // Render.
  const parts = [];

  if (pendingCollisions.length) {
    parts.push(`<div class="uci-group-label">Colisiones masc/fem <span class="u-c-dim">(la UCI publica una sola competición para el par → solo una enlaza)</span></div>`);
    for (const [comp, grp] of pendingCollisions) parts.push(_renderUciCollisionCard(comp, grp));
  }

  if (pendingAmbig.length) {
    parts.push(`<div class="uci-group-label" style="margin-top:1rem">Ambiguas <span class="u-c-dim">(varios candidatos UCI; elige el correcto)</span></div>`);
    for (const r of pendingAmbig) parts.push(_renderUciAmbiguousRow(r));
  }

  if (_uciShowAll && noneIn.length) {
    parts.push(`<div class="uci-group-label" style="margin-top:1rem">Sin equivalente UCI <span class="u-c-dim">(carreras no disputadas / fuera de road UCI — nada que enlazar)</span></div>`);
    for (const r of noneIn) {
      parts.push(`<div class="uci-card uci-card--muted"><div class="uci-claim__title">«${esc(r.our.name)}» <span class="u-c-dim">[${esc(r.our.class)}/${esc(r.our.gender)}]</span></div>
        <div class="u-c-dim u-fs-085">${esc((r.our.dates || []).filter(Boolean).join(' → '))} · ${esc((r.our.country || '').toUpperCase())}</div></div>`);
    }
  }

  if (!parts.length) {
    content.innerHTML = `<div class="u-empty-note">Todo revisado 🎉 ${_uciShowAll ? '' : '(pulsa «Ver todas» para auditar las resueltas y las sin equivalente)'}</div>`;
    return;
  }
  content.innerHTML = parts.join('');
  _wireUciReview();
}

// Tarjeta de colisión: competición compartida arriba + las 2 carreras reclamantes
// en columnas, cada una con su botón. Elegir una desenlaza la otra.
// URL pública de resultados de una competición en la UCI (iframe Kendo, viewable
// en el navegador) → para que Dani verifique de un vistazo cuál es la correcta.
function _uciCompUrl(comp) {
  return `https://dataride.uci.ch/iframe/CompetitionResults/${comp}/10/`;
}
// Enlace al competitionId que abre la página UCI en otra pestaña.
function _uciCompLink(comp, label) {
  return `<a href="${_uciCompUrl(comp)}" target="_blank" rel="noopener" class="uci-comp-link" title="Ver en la UCI ↗">${label != null ? label : '#' + comp} ↗</a>`;
}

function _renderUciCollisionCard(comp, group) {
  const uciName = group[0]?.collision?.uciName || '';
  const cols = group.map(r => {
    const id = r.our.id;
    const link = _uciLinkMap.get(id);
    const sim = r.candidates?.[0]?.nameSim;
    const linkedHere = link && link.competitionId === comp;
    const linkedElsewhere = link && link.competitionId !== comp;
    let action;
    if (linkedHere) {
      action = `<span class="uci-chip uci-chip--ok">✓ enlazada</span>
        <button type="button" class="btn btn--ghost uci-unlink" data-race="${esc(id)}" style="font-size:0.68rem;padding:0 0.5rem;color:#e55">Desenlazar</button>`;
    } else if (linkedElsewhere) {
      action = `<span class="uci-chip">enlazada a #${link.competitionId}</span>
        <button type="button" class="btn btn--ghost uci-unlink" data-race="${esc(id)}" style="font-size:0.68rem;padding:0 0.5rem;color:#e55">Desenlazar</button>`;
    } else {
      action = `<button type="button" class="btn btn--primary uci-link" data-race="${esc(id)}" data-comp="${comp}" data-year="${r.our.dates?.[0]?.slice(0,4) || ''}" style="font-size:0.72rem;padding:0.3rem 0.6rem">Enlazar a #${comp}</button>`;
    }
    return `<div class="uci-claim${linkedHere ? ' uci-claim--active' : ''}">
        <div class="uci-claim__title">${r.our.gender === 'female' ? '♀' : '♂'} «${esc(r.our.name)}»</div>
        <div class="u-c-dim u-fs-085">${esc(r.our.class)} · ${sim != null ? 'sim ' + sim : 'sin nombre en común'}</div>
        <div class="uci-claim__action">${action} <span class="u-c-dim u-fs-075">${_uciCompLink(comp, 'ver en UCI')}</span></div>
      </div>`;
  }).join('');
  return `<div class="uci-card">
      <div class="uci-card__head">${_uciCompLink(comp)} · <strong>${esc(uciName)}</strong></div>
      <div class="uci-pair">${cols}</div>
      <div class="uci-card__foot">
        <button type="button" class="btn btn--ghost uci-none" style="font-size:0.7rem;padding:0 0.5rem;color:var(--text-dim)">Ninguna de las dos</button>
        <span class="u-c-dim u-fs-075">si no son realmente el mismo evento (p. ej. carreras distintas que solo solapan fecha)</span>
      </div>
    </div>`;
}

// Fila ambigua: una carrera con sus candidatos (reusa _uciCandidateRow de la Fase 4b).
function _renderUciAmbiguousRow(rec) {
  const id = rec.our.id;
  const link = _uciLinkMap.get(id);
  const o = rec.our;
  let head = `<div class="uci-claim__title">«${esc(o.name)}» <span class="u-c-dim">[${esc(o.class)}/${esc(o.gender)}] · ${esc((o.dates || []).filter(Boolean).join(' → '))} · ${esc((o.country || '').toUpperCase())}</span></div>`;
  if (link) {
    head += `<div style="margin-top:0.25rem"><span class="uci-chip uci-chip--ok">✓ enlazada a #${link.competitionId}${link.autoMatched ? ' (auto)' : ''}</span>
      <button type="button" class="btn btn--ghost uci-unlink" data-race="${esc(id)}" style="font-size:0.68rem;padding:0 0.5rem;color:#e55;margin-left:0.3rem">Desenlazar</button></div>`;
  }
  // Reutiliza la fila de candidato de la Fase 4b, pero con data-attrs propios de la vista.
  const year = o.dates?.[0]?.slice(0, 4) || '';
  const cands = (rec.candidates || []).map(c => {
    const cls = c.uciClass != null ? esc(String(c.uciClass)) : '—';
    const tick = c.classMatch ? '<span style="color:#3a3">✓ clase</span>' : '<span class="u-c-dim">≠ clase</span>';
    const sim = c.nameSim != null ? ` · sim ${c.nameSim}` : '';
    return `<div class="u-row uci-cand" style="gap:0.5rem;align-items:center;padding:0.3rem 0;border-top:1px solid var(--border)">
        <button type="button" class="btn btn--ghost uci-link" data-race="${esc(id)}" data-comp="${c.competitionId}" data-year="${year}" style="font-size:0.7rem;padding:0 0.55rem;white-space:nowrap">Enlazar #${c.competitionId}</button>
        <div class="u-grow"><strong>${esc(c.uciName || '(sin nombre)')}</strong> ${_uciCompLink(c.competitionId, 'ver')}<div class="u-c-dim u-fs-075">${tick} · ${cls}${sim}</div></div>
      </div>`;
  }).join('');
  return `<div class="uci-card">${head}<div style="margin-top:0.4rem">${cands || '<span class="u-c-dim u-fs-085">Sin candidatos en el reporte.</span>'}</div></div>`;
}

// Cablea botones de la vista (se recrea en cada render → listeners por render).
function _wireUciReview() {
  const content = document.getElementById('uciViewContent');
  if (!content) return;
  content.querySelectorAll('.uci-link').forEach(btn =>
    btn.addEventListener('click', () => _uciViewLink(btn.dataset.race, parseInt(btn.dataset.comp, 10), btn.dataset.year)));
  content.querySelectorAll('.uci-unlink').forEach(btn =>
    btn.addEventListener('click', () => _uciViewUnlink(btn.dataset.race)));
  content.querySelectorAll('.uci-none').forEach(btn =>
    btn.addEventListener('click', () => {
      // "Ninguna de las dos": no escribe nada; colapsa la tarjeta visualmente.
      const card = btn.closest('.uci-card');
      if (card) card.classList.toggle('uci-card--dismissed');
    }));
}

// Enlazar desde la vista de lote. Si OTRA carrera ya tiene ese competitionId
// (caso colisión: el par), la desenlaza ANTES para no chocar con el UNIQUE.
async function _uciViewLink(raceId, competitionId, yearStr) {
  if (!raceId || !competitionId) return;
  const year = parseInt(yearStr, 10) || null;
  const seasonId = (year && _UCI_SEASON[year]) || null;
  try {
    // ¿Hay un dueño actual del competitionId distinto de esta carrera? → desenlazarlo.
    const { data: cur } = await supabase.from('race_uci_links')
      .select('raceId').eq('competitionId', competitionId).eq('disciplineId', 10).maybeSingle();
    if (cur && cur.raceId && cur.raceId !== raceId) {
      await _deleteUciLink(cur.raceId);
    }
    const res = await _writeUciLink(raceId, competitionId, seasonId);
    if (!res.ok && res.conflict) {
      // No debería ocurrir tras el desenlace, pero por si acaso informamos.
      showToast(`#${competitionId} ya la usa ${res.ownerName || 'otra carrera'}.`, 'error');
      return;
    }
    showToast(`Enlazada a #${competitionId}.`, 'success', 2500);
    await renderUciReview();
  } catch (err) {
    showToast(`Error al enlazar: ${err.message || err}`, 'error');
  }
}

async function _uciViewUnlink(raceId) {
  if (!raceId) return;
  if (!await confirmDialog('¿Quitar el enlace UCI de esta carrera?', { danger: true })) return;
  try {
    await _deleteUciLink(raceId);
    showToast('Enlace quitado.', 'success', 2000);
    await renderUciReview();
  } catch (err) {
    showToast(`Error al desenlazar: ${err.message || err}`, 'error');
  }
}

// Auto-formato al cambiar categoría en editar carrera (cableado por apertura
// del drawer en wireRaceEditor; antes era un listener a nivel de módulo que
// petaba al cargar cuando #er-uci ya no vive en el HTML estático).
function _wireRaceUciAutoFormat() {
  document.getElementById('er-uci').addEventListener('change', e => {
    const val = e.target.value;
    const CLASICA = new Set(['1.UWT','1.WWT','1.Pro','1.1','1.2','1.2U','WC','CC']);
    const WWT     = new Set(['1.WWT','2.WWT']);
    const HIDE    = new Set(['WC','CC']);
    if (!val) return;
    document.getElementById('er-format').value = CLASICA.has(val) ? 'one_day' : 'stage_race';
    if (WWT.has(val))  document.getElementById('er-gender').value = 'female';
    if (HIDE.has(val)) document.getElementById('er-hideFlag').checked = true;
  });
}

async function saveEditRace() {
  const id   = document.getElementById('er-id').value;
  const name = document.getElementById('er-name').value.trim();
  const errDiv = document.getElementById('editRaceError');

  if (!name) {
    errDiv.textContent = 'El nombre es obligatorio.';
    errDiv.style.display = 'block';
    return;
  }

  // Validar slug
  const slugVal = document.getElementById('er-slug').value.trim();
  const slugErr = validateSlug(slugVal);
  const slugErrEl = document.getElementById('er-slug-error');
  if (slugErr) {
    slugErrEl.textContent = slugErr;
    slugErrEl.style.display = 'block';
    return;
  }
  slugErrEl.style.display = 'none';

  // Validar slugEn (opcional, pero si tiene valor debe ser válido)
  const slugEnVal = document.getElementById('er-slugEn').value.trim();
  const slugEnErr = slugEnVal ? validateSlug(slugEnVal) : null;
  const slugEnErrEl = document.getElementById('er-slugEn-error');
  if (slugEnErr) {
    slugEnErrEl.textContent = slugEnErr;
    slugEnErrEl.style.display = 'block';
    return;
  }
  slugEnErrEl.style.display = 'none';

  const uci    = document.getElementById('er-uci').value;
  const gender = document.getElementById('er-gender').value;
  if (!validateCatGender(uci, gender, errDiv)) return;
  // Convención de nombres CN (ES + EN) para la deducción en Modo Campeonatos.
  if (!validateChampionshipName(uci, name, document.getElementById('er-nameEn').value, errDiv)) return;

  try {
    const updatedData = {
      name,
      originalName: document.getElementById('er-originalName').value.trim() || null,
      nameEn:      document.getElementById('er-nameEn').value.trim() || null,
      slugEn:      slugEnVal || null,
      slug:        slugVal || null,
      abbrev:      document.getElementById('er-abbrev').value.trim().toUpperCase() || null,
      uciCategory: document.getElementById('er-uci').value,
      gender:      document.getElementById('er-gender').value,
      raceFormat:  document.getElementById('er-format').value,
      countryCode: document.getElementById('er-country').value.trim() || null,
      colorHex:    document.getElementById('er-color').value || '#888888',
      logoUrl:     document.getElementById('er-logo').value.trim() || null,
      websiteUrl:  document.getElementById('er-website').value.trim() || null,
      fcId:        parseInt(document.getElementById('er-fcId').value) || null,
      pcsSlug:     document.getElementById('er-pcsSlug').value.trim() || null,
      hideFlag:    document.getElementById('er-hideFlag').checked || false,
      isGrandTour: document.getElementById('er-isGrandTour').checked || false,
      isCancelled: document.getElementById('er-isCancelled').checked || false,
      isNoClickable: document.getElementById('er-isNoClickable').checked || false,
      year:        parseInt(document.getElementById('er-year').value) || new Date().getFullYear(),
      startDate:   document.getElementById('er-startDate').value || null,
      endDate:     document.getElementById('er-endDate').value   || null,
    };
    const { error: upErr } = await supabase.from('races').update(updatedData).eq('id', id);
    if (upErr) throw upErr;
    upsertRaceLocal({ id, ...updatedData });
    closeEditRaceModal();
    renderRacesView();
  } catch (err) {
    errDiv.textContent = 'Error al guardar.';
    errDiv.style.display = 'block';
  }
}

async function deleteRaceFromList() {
  const id   = document.getElementById('er-id').value;
  const name = document.getElementById('er-name').value;
  if (!await confirmDialog(`¿Borrar la carrera "${name}"? Esta acción no borra sus jornadas asociadas.`, { danger: true })) return;
  try {
    const { error: delErr } = await supabase.from('races').delete().eq('id', id);
    if (delErr) throw delErr;
    removeRaceLocal(id);
    closeEditRaceModal();
    renderRacesView();
  } catch (err) {
    document.getElementById('editRaceError').textContent = 'Error al borrar.';
    document.getElementById('editRaceError').style.display = 'block';
  }
}

async function duplicateRace() {
  const id = document.getElementById('er-id').value;
  try {
    const { data: raceData } = await supabase.from('races').select('*').eq('id', id).single();
    if (!raceData) return;
    const sourceYear = Number(raceData.year) || new Date().getFullYear();
    const rawYear = window.prompt('Año de la nueva edición', String(sourceYear + 1));
    if (rawYear == null) return;
    const targetYear = Number.parseInt(rawYear, 10);
    if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2099) {
      throw new Error('Año de edición inválido.');
    }

    let seriesId = raceData.raceSeriesId;
    if (!seriesId) {
      // Compatibilidad con carreras que aún no se hayan asociado durante el
      // backfill de la migración: nunca creamos una edición huérfana.
      seriesId = crypto.randomUUID();
      const { error: seriesErr } = await supabase.from('race_series').insert({
        id: seriesId,
        canonicalName: raceData.name,
        gender: raceData.gender || null,
      });
      if (seriesErr) throw seriesErr;
      const { error: sourceErr } = await supabase.from('races')
        .update({ raceSeriesId: seriesId }).eq('id', id);
      if (sourceErr) throw sourceErr;
      upsertRaceLocal({ ...raceData, raceSeriesId: seriesId });
    }

    const { data: existing, error: existingErr } = await supabase.from('races')
      .select('id')
      .eq('raceSeriesId', seriesId)
      .eq('year', targetYear)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) throw new Error(`La serie ya tiene una edición en ${targetYear}.`);

    const baseSlug = raceData.slug?.replace(new RegExp(`-${sourceYear}$`), '') || toSlug(raceData.name);
    const baseSlugEn = raceData.slugEn?.replace(new RegExp(`-${sourceYear}$`), '') || null;
    const newRaceId = crypto.randomUUID();
    // Solo se heredan los datos estables de la prueba. Fechas, jornadas,
    // documentación, inscritos y resultados pertenecen a cada edición.
    const data = {
      id: newRaceId,
      raceSeriesId: seriesId,
      name: raceData.name,
      originalName: raceData.originalName || null,
      nameEn: raceData.nameEn || null,
      abbrev: raceData.abbrev || null,
      uciCategory: raceData.uciCategory || null,
      gender: raceData.gender || null,
      raceFormat: raceData.raceFormat || null,
      countryCode: raceData.countryCode || null,
      colorHex: raceData.colorHex || null,
      logoUrl: raceData.logoUrl || null,
      websiteUrl: raceData.websiteUrl || null,
      fcId: raceData.fcId || null,
      pcsSlug: raceData.pcsSlug || null,
      hideFlag: raceData.hideFlag || false,
      isGrandTour: raceData.isGrandTour || false,
      isNoClickable: raceData.isNoClickable || false,
      isCancelled: false,
      year: targetYear,
      startDate: null,
      endDate: null,
      slug: `${baseSlug}-${targetYear}`.slice(0, 80),
      slugEn: baseSlugEn ? `${baseSlugEn}-${targetYear}`.slice(0, 80) : null,
      translations: raceData.translations || {},
      createdAt: new Date().toISOString(),
    };
    const { error: dupErr } = await supabase.from('races').insert(data);
    if (dupErr) throw dupErr;
    const newRace = { ...data };
    upsertRaceLocal(newRace);
    closeEditRaceModal();
    renderRacesView();
    openEditRaceModal(newRace);
  } catch (err) {
    document.getElementById('editRaceError').textContent = err.message || 'Error al crear la edición.';
    document.getElementById('editRaceError').style.display = 'block';
  }
}

// ── Setup modales de carreras ─────────────────────────────────────
function setupRacesView() {
  // Selector de año
  const yearSel = document.getElementById('racesYearSelect');
  yearSel.value = _racesYear;
  yearSel.addEventListener('change', () => {
    _racesYear = parseInt(yearSel.value);
    renderRacesView();
  });

  // El desplegable de categoría sincroniza con la cuadrícula: elegir una
  // categoría salta a su listado; "Todas" vuelve a la cuadrícula.
  document.getElementById('racesCatFilter').addEventListener('change', e => {
    _racesCatSelected = e.target.value || null;
    renderRacesView();
  });
  document.getElementById('racesSortOrder').addEventListener('change', () => renderRacesView());

  // Poblar selector de países con los del año activo
  const countryFilter = document.getElementById('racesCountryFilter');
  const racesForYear  = allRaces.filter(r => (r.year || new Date().getFullYear()) === _racesYear);
  const countryCodes  = [...new Set(racesForYear.map(r => r.countryCode).filter(Boolean))].sort();
  countryFilter.innerHTML = '<option value="">Todos los países</option>';
  countryCodes.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code.toUpperCase();
    opt.textContent = code.toUpperCase();
    countryFilter.appendChild(opt);
  });
  countryFilter.addEventListener('change', () => renderRacesView());

  // Buscador en vista de carreras
  document.getElementById('racesSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderRacesView(q);
  });

  // Botón nueva carrera desde vista de carreras
  document.getElementById('addRaceDirectBtn').addEventListener('click', () => {
    _newRaceFromRacesView = true;
    openNewRaceEditor({ presetYear: _racesYear });
  });

  // Editor de carrera: ahora se renderiza en el drawer; sus listeners se
  // cablean por apertura en wireRaceEditor() (ver openEditRaceModal).

  // Editor de challenge: se renderiza en el drawer; abrir desde newChallengeBtn.
  // El resto de listeners (guardar, etc.) se cablean por apertura.
  document.getElementById('newChallengeBtn').addEventListener('click', () => openChallengeModal());

  // Toggle de subvista Carreras / Challenges (sustituye al antiguo tab del rail)
  document.querySelectorAll('#racesSubviewToggle .races-subview-btn').forEach(btn => {
    btn.addEventListener('click', () => applyRacesSubview(btn.dataset.subview));
  });

  initTabs();
}

// Flag para saber si nueva carrera viene de la vista de carreras
let _newRaceFromRacesView = false;
let _racesYear = new Date().getFullYear();

// ─────────────────────────────────────────────────────────────────
//  UPLOAD INLINE — para logos y roadbooks desde el editor
// ─────────────────────────────────────────────────────────────────
async function inlineUpload(file, targetInput, tipo) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) { showToast('Formato no permitido. Solo JPG, PNG, WebP o PDF.'); return; }
  const maxBytes = tipo === 'technicalGuide' ? 150 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxBytes) { showToast(`El archivo supera los ${tipo === 'technicalGuide' ? '150' : '10'} MB.`); return; }

  const btn = targetInput.parentElement.querySelector('.inline-upload-btn');
  const origText = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';

  let uploadBlob, uploadExt, uploadMime;

  // Si es logo, procesar: redimensionar a 128×128 y convertir a WebP
  if (tipo === 'logo') {
    try {
      uploadBlob = await processLogoImage(file);
      uploadExt  = 'webp';
      uploadMime = 'image/webp';
    } catch (e) {
      showToast('Error al procesar logo: ' + e.message);
      if (btn) btn.textContent = origText;
      return;
    }
  } else {
    uploadBlob = file;
    uploadExt  = file.name.split('.').pop().toLowerCase();
    uploadMime = file.type;
  }

  const editorArea = document.getElementById('editorArea');
  let filename;
  if (['technicalGuide', 'roadbook', 'profile', 'ports', 'map'].includes(tipo)) {
    filename = nextCanonicalStageAssetKey({
      raceSlug: editorArea?.dataset.raceSlug,
      year: editorArea?.dataset.raceYear,
      stageNumber: editorArea?.dataset.stageNumber === '' ? null : Number(editorArea?.dataset.stageNumber),
      raceDaySlug: editorArea?.dataset.raceDaySlug,
      type: tipo,
      ext: uploadExt,
    }, targetInput.value);
  } else {
    filename = `${Date.now()}-${tipo}.${uploadExt}`;
  }
  const publicUrl = `${R2_PUBLIC_BASE}/${filename}`;

  try {
    const res = tipo === 'technicalGuide'
      ? await r2PutTechnicalGuide(filename, uploadBlob, uploadMime)
      : await r2PutObject(filename, await uploadBlob.arrayBuffer(), uploadMime);
    if (!res.ok) throw new Error(`R2 ${res.status}`);
    targetInput.value = publicUrl;
    targetInput.dispatchEvent(new Event('input'));
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = origText; }, 2000); }
    // Si es logo, intentar extraer color dominante y rellenar colorHex si está vacío
    if (tipo === 'logo') {
      // Deducir el prefijo del id del input de logo (nr-, er-, cg-)
      const prefix = (targetInput.id || '').replace(/-logo$/, '-');
      const colorInput  = document.getElementById(prefix + 'color');
      const colorPicker = document.getElementById(prefix + 'colorPicker');
      if (colorInput && !colorInput.value.trim()) {
        extractDominantColor(publicUrl).then(hex => {
          if (hex) {
            colorInput.value = hex;
            if (colorPicker) colorPicker.value = hex;
            showToast('Color extraído del logo: ' + hex, 'success', 3000);
          }
        });
      }
    }
  } catch (err) {
    showToast('Error al subir: ' + err.message);
    if (btn) btn.textContent = origText;
  }
}


// ── Procesar logo: redimensionar a 128×128 y convertir a WebP ───
const LOGO_SIZE    = 128;  // px (cubre 48px@2x retina)
const LOGO_QUALITY = 0.82; // calidad WebP (buen balance peso/calidad)

async function processLogoImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = LOGO_SIZE;
        const ctx = canvas.getContext('2d');

        // Fondo transparente (WebP soporta alpha)
        ctx.clearRect(0, 0, LOGO_SIZE, LOGO_SIZE);

        // Escalar manteniendo proporción (contain)
        const scale = Math.min(LOGO_SIZE / img.width, LOGO_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (LOGO_SIZE - w) / 2;
        const y = (LOGO_SIZE - h) / 2;
        ctx.drawImage(img, x, y, w, h);

        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Error al procesar imagen')); return; }
            resolve(blob);
          },
          'image/webp',
          LOGO_QUALITY
        );
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('No se pudo cargar la imagen')); };
    img.src = objUrl;
  });
}

// ── Extraer color dominante de una imagen via canvas ─────────────
async function extractDominantColor(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const SIZE = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

        // Contar píxeles por color (cubos de 24 para más precisión)
        const buckets = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a < 80) continue; // transparente
          const key = `${Math.round(r/24)*24},${Math.round(g/24)*24},${Math.round(b/24)*24}`;
          buckets[key] = (buckets[key] || 0) + 1;
        }

        if (!Object.keys(buckets).length) { resolve(null); return; }

        // Ordenar por frecuencia (más píxeles primero)
        const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);

        // Tomar el más frecuente que no sea blanco/casi blanco ni negro/casi negro
        const isWhitish = key => {
          const [r, g, b] = key.split(',').map(Number);
          return (r + g + b) / 3 > 220;
        };
        const isBlackish = key => {
          const [r, g, b] = key.split(',').map(Number);
          return (r + g + b) / 3 < 35;
        };

        const winner = sorted.find(([key]) => !isWhitish(key) && !isBlackish(key));
        if (!winner) { resolve(null); return; }

        const [r, g, b] = winner[0].split(',').map(Number);
        const hex = '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch(e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}


// ── Autocomplete de país ──────────────────────────────────────────
const COUNTRY_LIST = [
  // Regionales
  { code: 'es-ct', name: 'Catalunya' },
  { code: 'es-pv', name: 'País Vasco' },
  // A
  { code: 'ad', name: 'Andorra' },
  { code: 'ae', name: 'Emiratos Árabes Unidos' },
  { code: 'al', name: 'Albania' },
  { code: 'ao', name: 'Angola' },
  { code: 'ar', name: 'Argentina' },
  { code: 'at', name: 'Austria' },
  { code: 'au', name: 'Australia' },
  { code: 'az', name: 'Azerbaiyán' },
  // B
  { code: 'ba', name: 'Bosnia y Herzegovina' },
  { code: 'bd', name: 'Bangladés' },
  { code: 'be', name: 'Bélgica' },
  { code: 'bf', name: 'Burkina Faso' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'bh', name: 'Baréin' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'br', name: 'Brasil' },
  { code: 'by', name: 'Bielorrusia' },
  // C
  { code: 'ca', name: 'Canadá' },
  { code: 'cd', name: 'República Democrática del Congo' },
  { code: 'ch', name: 'Suiza' },
  { code: 'ci', name: 'Costa de Marfil' },
  { code: 'cl', name: 'Chile' },
  { code: 'cm', name: 'Camerún' },
  { code: 'cn', name: 'China' },
  { code: 'co', name: 'Colombia' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'cu', name: 'Cuba' },
  { code: 'cy', name: 'Chipre' },
  { code: 'cz', name: 'República Checa' },
  // D
  { code: 'de', name: 'Alemania' },
  { code: 'dk', name: 'Dinamarca' },
  { code: 'do', name: 'República Dominicana' },
  { code: 'dz', name: 'Argelia' },
  // E
  { code: 'ec', name: 'Ecuador' },
  { code: 'ee', name: 'Estonia' },
  { code: 'eg', name: 'Egipto' },
  { code: 'er', name: 'Eritrea' },
  { code: 'es', name: 'España' },
  { code: 'et', name: 'Etiopía' },
  // F
  { code: 'fi', name: 'Finlandia' },
  { code: 'fr', name: 'Francia' },
  // G
  { code: 'gb', name: 'Gran Bretaña' },
  { code: 'ge', name: 'Georgia' },
  { code: 'gh', name: 'Ghana' },
  { code: 'gr', name: 'Grecia' },
  { code: 'gt', name: 'Guatemala' },
  // H
  { code: 'hr', name: 'Croacia' },
  { code: 'hu', name: 'Hungría' },
  // I
  { code: 'id', name: 'Indonesia' },
  { code: 'ie', name: 'Irlanda' },
  { code: 'il', name: 'Israel' },
  { code: 'in', name: 'India' },
  { code: 'iq', name: 'Irak' },
  { code: 'ir', name: 'Irán' },
  { code: 'it', name: 'Italia' },
  // J
  { code: 'jo', name: 'Jordania' },
  { code: 'jp', name: 'Japón' },
  // K
  { code: 'ke', name: 'Kenia' },
  { code: 'kg', name: 'Kirguistán' },
  { code: 'kp', name: 'Corea del Norte' },
  { code: 'kr', name: 'Corea del Sur' },
  { code: 'kw', name: 'Kuwait' },
  { code: 'kz', name: 'Kazajistán' },
  // L
  { code: 'lb', name: 'Líbano' },
  { code: 'li', name: 'Liechtenstein' },
  { code: 'lt', name: 'Lituania' },
  { code: 'lu', name: 'Luxemburgo' },
  { code: 'lv', name: 'Letonia' },
  // M
  { code: 'ma', name: 'Marruecos' },
  { code: 'md', name: 'Moldavia' },
  { code: 'mk', name: 'Macedonia del Norte' },
  { code: 'mn', name: 'Mongolia' },
  { code: 'mt', name: 'Malta' },
  { code: 'mu', name: 'Mauricio' },
  { code: 'mx', name: 'México' },
  { code: 'my', name: 'Malasia' },
  // N
  { code: 'ng', name: 'Nigeria' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'nl', name: 'Países Bajos' },
  { code: 'no', name: 'Noruega' },
  { code: 'nz', name: 'Nueva Zelanda' },
  // O
  { code: 'om', name: 'Omán' },
  // P
  { code: 'pa', name: 'Panamá' },
  { code: 'pe', name: 'Perú' },
  { code: 'ph', name: 'Filipinas' },
  { code: 'pk', name: 'Pakistán' },
  { code: 'pl', name: 'Polonia' },
  { code: 'pt', name: 'Portugal' },
  { code: 'py', name: 'Paraguay' },
  // Q
  { code: 'qa', name: 'Catar' },
  // R
  { code: 'ro', name: 'Rumanía' },
  { code: 'rs', name: 'Serbia' },
  { code: 'ru', name: 'Rusia' },
  { code: 'rw', name: 'Ruanda' },
  // S
  { code: 'sa', name: 'Arabia Saudí' },
  { code: 'sd', name: 'Sudán' },
  { code: 'se', name: 'Suecia' },
  { code: 'sg', name: 'Singapur' },
  { code: 'si', name: 'Eslovenia' },
  { code: 'sk', name: 'Eslovaquia' },
  { code: 'sn', name: 'Senegal' },
  { code: 'sv', name: 'El Salvador' },
  // T
  { code: 'th', name: 'Tailandia' },
  { code: 'tj', name: 'Tayikistán' },
  { code: 'tm', name: 'Turkmenistán' },
  { code: 'tn', name: 'Túnez' },
  { code: 'tr', name: 'Turquía' },
  { code: 'tw', name: 'Taiwán' },
  { code: 'tz', name: 'Tanzania' },
  // U
  { code: 'ua', name: 'Ucrania' },
  { code: 'ug', name: 'Uganda' },
  { code: 'us', name: 'Estados Unidos' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'uz', name: 'Uzbekistán' },
  // V
  { code: 've', name: 'Venezuela' },
  { code: 'vn', name: 'Vietnam' },
  // Z
  { code: 'za', name: 'Sudáfrica' },
  { code: 'zm', name: 'Zambia' },
  { code: 'zw', name: 'Zimbabue' },
];

function attachCountryAutocomplete(input) {
  if (input.dataset.countryAc) return; // evitar duplicados
  input.dataset.countryAc = '1';
  input.autocomplete = 'off';

  const dropdown = document.createElement('div');
  dropdown.className = 'country-ac-dropdown';
  // position:fixed anclado al body para no depender del overflow:hidden de contenedores
  // ancestrales (p.ej. .editor-section tiene overflow:hidden para recortar el header).
  dropdown.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 4px 16px rgba(0,0,0,0.18);max-height:220px;overflow-y:auto;min-width:220px;display:none';
  document.body.appendChild(dropdown);

  function positionDropdown() {
    const r = input.getBoundingClientRect();
    dropdown.style.left  = `${r.left}px`;
    dropdown.style.top   = `${r.bottom + 4}px`;
    dropdown.style.width = `${Math.max(r.width, 220)}px`;
  }

  function show(items) {
    dropdown.innerHTML = items.map(c =>
      `<div class="country-ac-item" data-code="${c.code}" style="padding:0.4rem 0.75rem;cursor:pointer;font-family:var(--font-display);font-size:0.8rem;display:flex;align-items:center;gap:0.5rem">
        <img src="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${c.code}.svg" style="width:1.2em;height:0.9em;object-fit:cover;border-radius:2px;flex-shrink:0">
        <span>${c.name}</span>
        <span style="margin-left:auto;opacity:0.45;font-size:0.7rem">${c.code.toUpperCase()}</span>
      </div>`
    ).join('');
    if (items.length) {
      positionDropdown();
      dropdown.style.display = 'block';
    } else {
      dropdown.style.display = 'none';
    }
    dropdown.querySelectorAll('.country-ac-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-card-hover)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = item.dataset.code.toUpperCase();
        dropdown.style.display = 'none';
      });
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = COUNTRY_LIST.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    ).slice(0, 8);
    show(matches);
  });

  input.addEventListener('focus', () => {
    const q = input.value.toLowerCase().trim();
    if (q.length >= 1) input.dispatchEvent(new Event('input'));
  });

  // Reposicionar si el usuario scrollea o redimensiona mientras está abierto
  window.addEventListener('scroll', () => {
    if (dropdown.style.display === 'block') positionDropdown();
  }, true);
  window.addEventListener('resize', () => {
    if (dropdown.style.display === 'block') positionDropdown();
  });

  document.addEventListener('click', e => {
    if (e.target !== input && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

function attachInlineUpload(input, tipo) {
  // Evitar duplicados
  if (input.parentElement.querySelector('.inline-upload-btn')) return;
  // Crear input file oculto y botón visible
  const fileIn = document.createElement('input');
  fileIn.type   = 'file';
  fileIn.accept = tipo === 'logo' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf';
  fileIn.style.display = 'none';
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) inlineUpload(fileIn.files[0], input, tipo); fileIn.value = ''; });

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'inline-upload-btn';
  btn.textContent = '↑';
  btn.title     = 'Subir archivo';
  btn.addEventListener('click', () => fileIn.click());

  input.parentElement.style.display  = 'flex';
  input.parentElement.style.gap      = '0.4rem';
  input.parentElement.style.alignItems = 'center';
  input.style.flex = '1';
  input.after(btn);
  input.after(fileIn);
}

async function handleUpload(file) {
  const allowed  = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const errDiv   = document.getElementById('uploadError');
  const progress = document.getElementById('uploadProgress');
  const result   = document.getElementById('uploadResult');

  errDiv.style.display   = 'none';
  result.style.display   = 'none';
  progress.style.display = 'none';

  if (!allowed.includes(file.type)) {
    errDiv.textContent   = 'Formato no permitido. Solo JPG, PNG, WebP o PDF.';
    errDiv.style.display = 'block';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    errDiv.textContent   = 'El archivo supera los 10 MB.';
    errDiv.style.display = 'block';
    return;
  }

  const uploadBlob = file;
  const uploadExt  = file.name.split('.').pop().toLowerCase();
  const uploadMime = file.type;

  const slug     = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
  const ts       = Date.now();
  const filename = `${ts}-${slug}.${uploadExt}`;
  const publicUrl = `${R2_PUBLIC_BASE}/${filename}`;

  progress.style.display = 'flex';
  document.getElementById('uploadProgressBar').style.width = '0%';
  document.getElementById('uploadProgressLabel').textContent = 'Subiendo…';

  try {
    const fileBuffer = await uploadBlob.arrayBuffer();

    document.getElementById('uploadProgressBar').style.width = '50%';
    document.getElementById('uploadProgressLabel').textContent = 'Subiendo… 50%';

    const res = await r2PutObject(filename, fileBuffer, uploadMime);

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`R2 ${res.status}: ${txt.slice(0, 120)}`);
    }

    document.getElementById('uploadProgressBar').style.width = '100%';
    document.getElementById('uploadProgressLabel').textContent = 'Subido ✓';
    setTimeout(() => { progress.style.display = 'none'; }, 800);

    document.getElementById('uploadResultUrl').value = publicUrl;
    result.style.display = 'flex';
    document.getElementById('fileInput').value  = '';

  } catch (err) {
    progress.style.display  = 'none';
    errDiv.textContent       = 'Error al subir: ' + err.message;
    errDiv.style.display     = 'block';
  }
}


// ─────────────────────────────────────────────────────────────────
//  CHALLENGE GROUPS
// ─────────────────────────────────────────────────────────────────

let _challengeEditingId = null; // null = crear nuevo, string = editar existente

// ── Render listado de challenges ─────────────────────────────────
async function renderChallengesView() {
  const container = document.getElementById('challengesListView');
  container.innerHTML = '<div class="u-fs-085 u-c-dim">Cargando…</div>';

  try {
    const { data: groupsData } = await supabase.from('challenge_groups').select('*');
    const groups = groupsData || [];

    groups.sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    });

    if (!groups.length) {
      container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:1rem 0">
        No hay challenge groups todavía. Crea uno con el botón de arriba.
      </div>`;
      return;
    }

    container.innerHTML = groups.map(cg => {
      const raceCount = Array.isArray(cg.raceIds) ? cg.raceIds.length : 0;
      const genderLabel = cg.gender === 'female' ? 'Femenino' : 'Masculino';
      const colorDot = cg.colorHex
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cg.colorHex};margin-right:0.35rem;flex-shrink:0"></span>`
        : '';

      return `<div class="challenge-item" data-id="${cg.id}" style="
        display:flex;align-items:center;gap:0.75rem;
        padding:0.75rem 1rem;border-radius:8px;
        border:1px solid var(--border);background:var(--surface);
        margin-bottom:0.5rem
      ">
        ${colorDot}
        <div class="u-grow u-min0">
          <div style="font-weight:600;font-size:0.95rem">${cg.name || '—'}</div>
          <div style="font-size:0.78rem;color:var(--text-dim);margin-top:0.15rem">
            ${cg.year || '—'} · ${genderLabel} · ${cg.uciCategory || '1.1'} · ${raceCount} carrera${raceCount !== 1 ? 's' : ''}
            ${cg.slug ? `· <span style="font-family:monospace;font-size:0.75rem">${cg.slug}</span>` : ''}
          </div>
        </div>
        <button class="cg-edit-btn" data-id="${cg.id}" style="
          padding:0.35rem 0.75rem;border-radius:6px;border:1px solid var(--border);
          background:none;color:var(--text);font-size:0.8rem;cursor:pointer;font-family:inherit
        ">Editar</button>
        <button class="cg-delete-btn" data-id="${cg.id}" style="
          padding:0.35rem 0.6rem;border-radius:6px;border:1px solid rgba(229,62,62,0.3);
          background:none;color:#e53e3e;font-size:0.8rem;cursor:pointer;font-family:inherit
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>`;
    }).join('');

    // Listeners de editar / borrar
    container.querySelectorAll('.cg-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openChallengeModal(btn.dataset.id));
    });
    container.querySelectorAll('.cg-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await confirmDialog('¿Eliminar este challenge group? Las carreras individuales no se borran.', { danger: true })) return;
        await supabase.from('challenge_groups').delete().eq('id', btn.dataset.id);
        renderChallengesView();
      });
    });

  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.82rem">Error: ${err.message}</div>`;
  }
}

// ── Abrir modal (nuevo o editar) ─────────────────────────────────
// HTML del formulario de challenge (mismos ids cg-* que el markup anterior).
function challengeBodyHtml() {
  return `
    <div id="challengeError" class="alert alert--error" style="display:none"></div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="cg-name" placeholder="Challenge Mallorca">
      </div>
      <div class="field">
        <label>Slug</label>
        <input type="text" id="cg-slug" placeholder="challenge-mallorca-2026" style="font-family:monospace">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="cg-category">
          <option value="WC">WC</option><option value="CC">CC</option><option value="CN">CN</option>
          <option value="1.UWT">1.UWT</option><option value="2.UWT">2.UWT</option>
          <option value="1.WWT">1.WWT</option><option value="2.WWT">2.WWT</option>
          <option value="1.Pro">1.Pro</option><option value="2.Pro">2.Pro</option>
          <option value="1.1" selected>1.1</option><option value="2.1">2.1</option>
          <option value="1.2">1.2</option><option value="2.2">2.2</option>
          <option value="1.2U">1.2U</option><option value="2.2U">2.2U</option>
        </select>
      </div>
      <div class="field">
        <label>Género</label>
        <select id="cg-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>País (código ISO)</label>
        <input type="text" id="cg-country" placeholder="ES" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="cg-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview" style="max-width:100%;overflow:hidden">
        <input class="u-color-dot" type="color" id="cg-colorPicker" value="#217cc4"
              >
        <input type="text" id="cg-color" placeholder="#217cc4" style="flex:1;min-width:0;max-width:120px">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="cg-logo-wrap"><input type="url" id="cg-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="field">
      <label>Carreras incluidas</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:0.5rem;align-items:start">
        <div class="u-stack" style="gap:0.3rem">
          <div class="u-micro">Disponibles</div>
          <input type="text" id="cg-search-available" placeholder="Buscar…"
            style="padding:0.3rem 0.5rem;border-radius:5px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.78rem;font-family:inherit">
          <select id="cg-available" multiple size="8"
            style="border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-size:0.8rem;font-family:inherit;padding:0.25rem;width:100%;cursor:pointer"></select>
        </div>
        <div class="u-stack" style="gap:0.4rem;padding-top:1.8rem">
          <button type="button" id="cg-add-race" class="btn btn--ghost" style="padding:0.35rem 0.6rem" title="Añadir">›</button>
          <button type="button" id="cg-remove-race" class="btn btn--ghost" style="padding:0.35rem 0.6rem" title="Quitar">‹</button>
        </div>
        <div class="u-stack" style="gap:0.3rem">
          <div class="u-micro">Incluidas</div>
          <div style="height:1.75rem"></div>
          <select id="cg-selected" multiple size="8"
            style="border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-size:0.8rem;font-family:inherit;padding:0.25rem;width:100%;cursor:pointer"></select>
        </div>
      </div>
    </div>
    <div style="margin-top:1.25rem;padding-top:0.75rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;justify-content:flex-end">
      <button class="btn btn--primary" id="challengeSaveBtn">Guardar challenge</button>
    </div>
  `;
}

async function openChallengeModal(editId = null) {
  _challengeEditingId = editId;
  openDrawer({
    title: editId ? 'Editar challenge' : 'Nuevo challenge',
    level: 1,
    render: (body) => {
      body.innerHTML = challengeBodyHtml();
      document.getElementById('challengeSaveBtn').addEventListener('click', saveChallengeGroup);
      _populateChallengeEditor(editId);
    },
  });
}

// Pobla y cablea el editor de challenge (todo per-apertura, ya lo era).
async function _populateChallengeEditor(editId) {
  const errorDiv = document.getElementById('challengeError');
  errorDiv.style.display = 'none';

  // Usar allRaces ya cargado en memoria — no hay necesidad de otra query a Firestore
  const allR = [...allRaces].sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
  });

  let existingRaceIds = [];
  let existing = null;

  if (editId) {
    const { data: cgData } = await supabase.from('challenge_groups').select('*').eq('id', editId).single();
    existing   = cgData || {};
    existingRaceIds = Array.isArray(existing.raceIds) ? existing.raceIds : [];

    document.getElementById('cg-name').value     = existing.name     || '';
    document.getElementById('cg-slug').value     = existing.slug     || '';
    document.getElementById('cg-gender').value   = existing.gender   || 'male';
    document.getElementById('cg-year').value     = existing.year     || new Date().getFullYear();
    document.getElementById('cg-category').value = existing.uciCategory || '1.1';
    document.getElementById('cg-country').value  = existing.countryCode  || '';
    document.getElementById('cg-color').value    = existing.colorHex    || '';
    document.getElementById('cg-logo').value     = existing.logoUrl     || '';
  } else {
    document.getElementById('cg-name').value     = '';
    document.getElementById('cg-slug').value     = '';
    document.getElementById('cg-gender').value   = 'male';
    document.getElementById('cg-year').value     = new Date().getFullYear();
    document.getElementById('cg-category').value = '1.1';
    document.getElementById('cg-country').value  = '';
    document.getElementById('cg-color').value    = '';
    document.getElementById('cg-logo').value     = '';
  }

  // Auto-slug desde el nombre
  const nameInput = document.getElementById('cg-name');
  const slugInput = document.getElementById('cg-slug');
  nameInput.addEventListener('input', () => {
    if (!editId) {
      const year = document.getElementById('cg-year').value || new Date().getFullYear();
      const gender = document.getElementById('cg-gender').value;
      const base = nameInput.value
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const suffix = gender === 'female' ? '-fem' : '';
      slugInput.value = `${base}${suffix}-${year}`;
    }
  });
  document.getElementById('cg-gender').addEventListener('change', () => {
    if (!editId) nameInput.dispatchEvent(new Event('input'));
  });
  document.getElementById('cg-year').addEventListener('input', () => {
    if (!editId) nameInput.dispatchEvent(new Event('input'));
  });

  // Sistema de dos listas: disponibles / incluidas
  const selAvailable = document.getElementById('cg-available');
  const selSelected  = document.getElementById('cg-selected');
  const searchAvail  = document.getElementById('cg-search-available');

  // Poblar lista de disponibles (las no seleccionadas) y seleccionadas
  function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

  function fillLists(filter = '') {
    const q = norm(filter);
    const selectedIds = [...selSelected.options].map(o => o.value);
    selAvailable.innerHTML = '';
    allR.forEach(r => {
      if (selectedIds.includes(r.id)) return;
      if (q && !norm(r.name || r.id).includes(q)) return;
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.name || r.id}  ${r.year || ''} ${r.uciCategory || ''}`;
      selAvailable.appendChild(opt);
    });
  }

  // Añadir seleccionadas iniciales
  selSelected.innerHTML = '';
  existingRaceIds.forEach(id => {
    const r = allR.find(x => x.id === id);
    if (!r) return;
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name || r.id}  ${r.year || ''} ${r.uciCategory || ''}`;
    selSelected.appendChild(opt);
  });

  fillLists();

  searchAvail.addEventListener('input', () => fillLists(searchAvail.value));

  document.getElementById('cg-add-race').addEventListener('click', () => {
    [...selAvailable.selectedOptions].forEach(opt => {
      selAvailable.removeChild(opt);
      selSelected.appendChild(opt);
    });
  });

  document.getElementById('cg-remove-race').addEventListener('click', () => {
    [...selSelected.selectedOptions].forEach(opt => {
      selSelected.removeChild(opt);
      fillLists(searchAvail.value); // re-añade a disponibles respetando el filtro
    });
    fillLists(searchAvail.value);
  });

  // Color picker sincronizado (igual que nueva carrera)
  const cgColorPicker = document.getElementById('cg-colorPicker');
  const cgColorText   = document.getElementById('cg-color');
  cgColorPicker.value = (editId && existing?.colorHex) ? existing.colorHex : '#217cc4';
  cgColorText.value   = (editId && existing?.colorHex) ? existing.colorHex : '';
  cgColorPicker.addEventListener('input', () => { cgColorText.value = cgColorPicker.value; });
  cgColorText.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(cgColorText.value)) cgColorPicker.value = cgColorText.value;
  });

  // Upload de logo hacia R2
  attachInlineUpload(document.getElementById('cg-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('cg-country'));
}

// ── Cerrar editor de challenge ───────────────────────────────────
function closeChallengeModal() {
  closeDrawer(1);
  _challengeEditingId = null;
}

// ── Guardar challenge ────────────────────────────────────────────
async function saveChallengeGroup() {
  const errorDiv = document.getElementById('challengeError');
  errorDiv.style.display = 'none';

  const name     = document.getElementById('cg-name').value.trim();
  const slug     = document.getElementById('cg-slug').value.trim();
  const gender   = document.getElementById('cg-gender').value;
  const year     = parseInt(document.getElementById('cg-year').value) || new Date().getFullYear();
  const category = document.getElementById('cg-category').value.trim() || '1.1';
  const country  = document.getElementById('cg-country').value.trim();
  const color    = document.getElementById('cg-color').value.trim()
                || document.getElementById('cg-colorPicker').value;
  const logoUrl  = document.getElementById('cg-logo').value.trim();

  if (!name) {
    errorDiv.textContent = 'El nombre es obligatorio.';
    errorDiv.style.display = 'block';
    return;
  }
  if (!slug) {
    errorDiv.textContent = 'El slug es obligatorio.';
    errorDiv.style.display = 'block';
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    errorDiv.textContent = 'El slug solo puede contener letras minúsculas, números y guiones.';
    errorDiv.style.display = 'block';
    return;
  }

  // Recoger raceIds seleccionados
  const raceIds = [...document.getElementById('cg-selected').options].map(o => o.value);

  const data = {
    name,
    slug,
    gender,
    year,
    uciCategory: category,
    countryCode: country,
    colorHex:    color,
    logoUrl:     logoUrl || null,
    raceIds,
    updatedAt:   new Date().toISOString(),
  };

  try {
    if (_challengeEditingId) {
      const { error: cgErr } = await supabase.from('challenge_groups').update(data).eq('id', _challengeEditingId);
      if (cgErr) throw cgErr;
    } else {
      const { error: cgErr } = await supabase.from('challenge_groups').insert({ ...data, id: crypto.randomUUID() });
      if (cgErr) throw cgErr;
    }
    closeChallengeModal();
    renderChallengesView();
  } catch (err) {
    errorDiv.textContent = 'Error al guardar: ' + err.message;
    errorDiv.style.display = 'block';
  }
}

// ═════════════════════════════════════════════════════════════════
//  ANALYTICS — Google Analytics Data API (GA4)
// ═════════════════════════════════════════════════════════════════

const GA_FN_URL = `${SUPABASE_URL}/functions/v1/ga-analytics`;
let _analyticsViewReady = false;

// Caché en memoria de respuestas GA4 por (report+rango), TTL corto: evita
// re-disparar las ~7 llamadas a la API por cada apertura de pestaña/cambio
// de rango/reapertura cuando los datos no han podido cambiar todavía, que
// agotaba la cuota de errores del servidor ("RESOURCE_EXHAUSTED").
const GA_CACHE_TTL_MS = 5 * 60 * 1000;
const _gaReportCache = new Map(); // key -> { data, ts }

// La cifra de "nuevos usuarios" es irreal en dos vistas: el mes de lanzamiento
// (abril 2026, cuando TODO visitante contaba como nuevo) y "Desde inicio web"
// (que arrastra ese pico). En esas dos vistas se oculta cualquier mención a
// nuevos usuarios; en el resto de rangos se mantiene intacta.
let _gaHideNewUsers = false;

function analyticsHidesNewUsers(dateRange) {
  const rangeValue = document.getElementById('gaDateRange')?.value;
  if (rangeValue === 'since_start') return true;
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);
  return startISO.startsWith('2026-04') && endISO.startsWith('2026-04');
}

function _gaCacheKey(report, dateRange) {
  return `${report}|${dateRange.startDate}|${dateRange.endDate}`;
}

function setupAnalyticsView() {
  if (_analyticsViewReady) {
    return; // ya está inicializado, no recargar
  }
  _analyticsViewReady = true;

  const rangeSelect = document.getElementById('gaDateRange');
  const startInput  = document.getElementById('gaStartDate');
  const endInput    = document.getElementById('gaEndDate');
  const refreshBtn  = document.getElementById('gaRefreshBtn');

  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const now = new Date();
  [
    ['current_month', 0],
    ['prev_month', 1],
    ['month_minus_2', 2],
    ['month_minus_3', 3],
  ].forEach(([value, offset]) => {
    const opt = rangeSelect.querySelector(`option[value="${value}"]`);
    if (!opt) return;
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    opt.textContent = `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  });

  rangeSelect.addEventListener('change', () => {
    const isCustom = rangeSelect.value === 'custom';
    startInput.style.display = isCustom ? '' : 'none';
    endInput.style.display   = isCustom ? '' : 'none';
    if (!isCustom) loadAllAnalytics();
  });

  refreshBtn.addEventListener('click', () => loadAllAnalytics(true));

  startInput.addEventListener('change', () => { if (endInput.value) loadAllAnalytics(); });
  endInput.addEventListener('change', ()   => { if (startInput.value) loadAllAnalytics(); });

  loadAllAnalytics();
}

function getAnalyticsDateRange() {
  const rangeSelect = document.getElementById('gaDateRange');
  if (rangeSelect.value === 'custom') {
    return {
      startDate: document.getElementById('gaStartDate').value,
      endDate:   document.getElementById('gaEndDate').value,
    };
  }
  const days = rangeSelect.value;
  if (days === '0') return { startDate: 'today', endDate: 'today' };
  if (days === '1') return { startDate: 'yesterday', endDate: 'yesterday' };
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (days === 'last_7') {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() - 1);
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return { startDate: fmt(start), endDate: fmt(end) };
  }
  if (days === 'current_week') {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    return { startDate: fmt(monday), endDate: 'today' };
  }
  if (days === 'prev_week') {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysFromMonday - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { startDate: fmt(lastMonday), endDate: fmt(lastSunday) };
  }
  if (days === 'current_month') {
    const now = new Date();
    return { startDate: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: 'today' };
  }
  if (days === 'prev_month') {
    const now = new Date();
    return {
      startDate: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      endDate:   fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (days === 'month_minus_2' || days === 'month_minus_3') {
    const offset = days === 'month_minus_2' ? 2 : 3;
    const now = new Date();
    return {
      startDate: fmt(new Date(now.getFullYear(), now.getMonth() - offset, 1)),
      endDate:   fmt(new Date(now.getFullYear(), now.getMonth() - offset + 1, 0)),
    };
  }
  if (days === 'since_start') {
    // 6 de abril de 2026: día de lanzamiento de la web, incluido en el rango.
    // Debe coincidir con el `startDate` del endpoint público `portfolio_stats`
    // de la edge function: empezar el día 7 dejaba fuera el pico del
    // lanzamiento y el panel mostraba ~10.600 páginas vistas menos que la web.
    return { startDate: '2026-04-06', endDate: 'today' };
  }
  return { startDate: 'today', endDate: 'today' };
}

async function fetchGaReport(report, dateRange, { force = false } = {}) {
  const key = _gaCacheKey(report, dateRange);
  const cached = _gaReportCache.get(key);
  if (!force && cached && (Date.now() - cached.ts) < GA_CACHE_TTL_MS) {
    return cached.data;
  }
  const auth = await getAuthHeaders();
  const res = await fetch(GA_FN_URL, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, ...dateRange }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error desconocido');
  _gaReportCache.set(key, { data: json.data, ts: Date.now() });
  return json.data;
}

async function loadAllAnalytics(force = false) {
  const dateRange = getAnalyticsDateRange();
  const notice = document.getElementById('gaConfigNotice');

  // ¿Vista de lanzamiento (abril 2026 / "Desde inicio web")? → sin nuevos usuarios
  _gaHideNewUsers = analyticsHidesNewUsers(dateRange);
  const newUsersCard = document.getElementById('gaKpiNewUsersCard');
  if (newUsersCard) newUsersCard.style.display = _gaHideNewUsers ? 'none' : '';
  if (force) {
    // El botón "Refrescar" fuerza datos frescos; invalida solo lo cacheado
    // para este rango, no toda la caché (otros rangos ya vistos siguen sirviendo).
    for (const k of Array.from(_gaReportCache.keys())) {
      if (k.endsWith(`|${dateRange.startDate}|${dateRange.endDate}`)) _gaReportCache.delete(k);
    }
  }

  // Reset KPIs to loading state
  ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers','gaKpiPushSubs']
    .forEach(id => { document.getElementById(id).textContent = '…'; });
  ['gaPlatforms','gaPeakHour','gaTopPages','gaTopStages','gaTrafficSources','gaCountries']
    .forEach(id => { document.getElementById(id).innerHTML = '<div class="ga-placeholder">Cargando…</div>'; });

  // En rangos de ≥2 días sustituimos el gráfico de horas por uno con barras
  // por día; en rangos largos (p. ej. "Desde inicio web"), por semana ISO
  // (si no, con meses de datos el gráfico de barras diarias es ilegible).
  // La sección comparte container (gaPeakHour) pero el título y el
  // contenido cambian según el rango.
  const rangeDays = analyticsRangeDays(dateRange);
  const useWeekly = rangeDays > 60;
  const useDaily = !useWeekly && rangeDays >= 2;
  const timeSectionTitleEl = document.getElementById('gaTimeSectionTitle');
  if (timeSectionTitleEl) {
    timeSectionTitleEl.textContent = useWeekly ? 'Usuarios por semana' : (useDaily ? 'Usuarios por día' : 'Hora pico de usuarios');
  }

  // Platform report — pedido en paralelo con el resto. Además de alimentar
  // el bloque "Plataformas", sus totales por plataforma (activeUsers
  // deduplicado por GA4 sobre TODO el rango, sin trocear por fecha) los
  // reutilizan renderDailyPageviews/renderWeeklyPageviews para la leyenda:
  // sumar activeUsers día a día (o semana a semana) sobrecuenta a los
  // usuarios recurrentes, igual que le pasaba al total general.
  const platformsPromise = fetchGaReport('platforms', dateRange);

  // Cada reporte se resuelve de forma independiente: un fallo en uno no debe
  // tumbar al resto (p. ej. dimensiones custom no registradas en GA4 hacían
  // explotar TODOS los paneles porque compartían un único Promise.all).
  const reports = [
    { key: 'overview',        kpiIds: ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers'], render: renderOverviewKpis },
    useWeekly
      ? { key: 'weekly_pageviews', containerId: 'gaPeakHour', render: renderWeeklyPageviews, needsPlatformTotals: true }
      : (useDaily
        ? { key: 'daily_pageviews', containerId: 'gaPeakHour', render: renderDailyPageviews, needsPlatformTotals: true }
        : { key: 'peak_hour',       containerId: 'gaPeakHour', render: renderPeakHour }),
    { key: 'top_pages',       containerId: 'gaTopPages',       render: renderTopPages },
    { key: 'traffic_sources', containerId: 'gaTrafficSources', render: renderTrafficSources },
    { key: 'top_countries',   containerId: 'gaCountries',      render: renderCountries },
    { key: 'top_stages',      containerId: 'gaTopStages',      render: renderTopStages },
  ];

  const [settled, platformsResult] = await Promise.all([
    Promise.allSettled(reports.map(r => fetchGaReport(r.key, dateRange))),
    Promise.allSettled([platformsPromise]).then(([r]) => r),
  ]);

  const platformTotals = platformsResult.status === 'fulfilled'
    ? platformUserTotals(platformsResult.value)
    : null;

  let configMissing = false;
  settled.forEach((result, i) => {
    const { key, containerId, kpiIds, render, needsPlatformTotals } = reports[i];
    if (result.status === 'fulfilled') {
      try { render(result.value, needsPlatformTotals ? platformTotals : undefined); } catch (e) { console.error(`Render ${key} error:`, e); }
      return;
    }
    const msg = result.reason?.message || 'Error desconocido';
    console.error(`Analytics ${key} error:`, msg);
    if (msg.includes('no configuradas')) configMissing = true;
    if (kpiIds) {
      kpiIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    }
    if (containerId) {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = `<div class="ga-placeholder" style="color:var(--red)">${esc(msg)}</div>`;
    }
  });
  notice.style.display = configMissing ? 'flex' : 'none';

  if (platformsResult.status === 'fulfilled') {
    renderPlatforms(platformsResult.value);
  } else {
    console.warn('Platform report not available:', platformsResult.reason?.message);
    document.getElementById('gaPlatforms').innerHTML =
      '<div class="ga-placeholder" style="color:var(--text-dim)">Redespliega la edge function <code>ga-analytics</code> para activar el reporte de plataforma.</div>';
  }

  // Push subscriptions count — queried directly from Supabase, independent of GA
  try {
    const pushCount = await fetchPushSubscriptionsCount(dateRange);
    renderPushKpi(pushCount);
  } catch (err) {
    console.warn('Push subscriptions count error:', err.message);
    document.getElementById('gaKpiPushSubs').textContent = '—';
  }
}

function analyticsRangeDays(dateRange) {
  const start = gaDateToISO(dateRange.startDate);
  const end   = gaDateToISO(dateRange.endDate);
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end   + 'T00:00:00Z');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// ── Push subscriptions KPI ───────────────────────────────────────
function gaDateToISO(gaDate) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(gaDate)) return gaDate;
  if (gaDate === 'today') return new Date().toISOString().slice(0, 10);
  if (gaDate === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  }
  const m = gaDate.match(/^(\d+)daysAgo$/);
  if (m) { const d = new Date(); d.setDate(d.getDate() - Number(m[1])); return d.toISOString().slice(0, 10); }
  return gaDate;
}

async function fetchPushSubscriptionsCount(dateRange) {
  const start = gaDateToISO(dateRange.startDate) + 'T00:00:00.000Z';
  const end   = gaDateToISO(dateRange.endDate)   + 'T23:59:59.999Z';
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .gte('"createdAt"', start)
    .lte('"createdAt"', end);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function renderPushKpi(count) {
  document.getElementById('gaKpiPushSubs').textContent = formatNumber(count);
}

// ── Helpers para extraer datos de la respuesta GA ────────────────
function gaMetricValue(row, idx) {
  return row?.metricValues?.[idx]?.value || '0';
}

function gaDimensionValue(row, idx) {
  return row?.dimensionValues?.[idx]?.value || '(no definido)';
}

function formatNumber(n) {
  return Number(n).toLocaleString('es-ES');
}

function formatDuration(seconds) {
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function formatPercent(val) {
  return (Number(val) * 100).toFixed(1) + '%';
}

// ── Render KPI overview ──────────────────────────────────────────
function renderOverviewKpis(data) {
  const row = data?.rows?.[0];
  if (!row) {
    ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers']
      .forEach(id => { document.getElementById(id).textContent = '0'; });
    return;
  }
  document.getElementById('gaKpiUsers').textContent    = formatNumber(gaMetricValue(row, 0));
  document.getElementById('gaKpiPageviews').textContent = formatNumber(gaMetricValue(row, 2));
  document.getElementById('gaKpiNewUsers').textContent  = formatNumber(gaMetricValue(row, 5));
}

// ── Render platforms (horizontal bars + metric cards) ────────────
// Totales de activeUsers por plataforma, deduplicados por GA4 sobre TODO
// el rango (report 'platforms', dimensión solo `platform`, sin fecha) — a
// diferencia de sumar activeUsers día a día, que sobrecuenta usuarios
// recurrentes. Usado por la leyenda del gráfico de barras (día/semana).
function platformUserTotals(data) {
  const rows = data?.rows || [];
  const totals = { web: 0, ios: 0, android: 0 };
  for (const row of rows) {
    const key = (gaDimensionValue(row, 0) || '').toLowerCase();
    if (key in totals) totals[key] = Number(gaMetricValue(row, 0));
  }
  return totals;
}

function renderPlatforms(data) {
  const container = document.getElementById('gaPlatforms');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const totalUsers = rows.reduce((sum, r) => sum + Number(gaMetricValue(r, 0)), 0);
  const platformLabels = { web: 'Web', ios: 'iOS', android: 'Android' };
  const platformColors = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Stacked bar with inline labels
  let html = '<div class="ga-stacked-bar">';
  for (const row of rows) {
    const platform = gaDimensionValue(row, 0);
    const key      = platform.toLowerCase();
    const users    = Number(gaMetricValue(row, 0));
    const pct      = totalUsers > 0 ? (users / totalUsers * 100) : 0;
    const label    = platformLabels[key] || platform;
    const color    = platformColors[key] || 'var(--accent)';
    const text     = pct >= 8 ? `<span class="ga-stacked-label">${esc(label)} ${pct.toFixed(1)}%</span>` : '';
    html += `<div class="ga-stacked-segment" data-platform="${key}" style="width:${pct}%;background:${color};min-width:${pct > 0 ? 3 : 0}px" data-tip="${esc(label)} · ${pct.toFixed(1)}%">${text}</div>`;
  }
  html += '</div>';

  // Per-platform metric cards (full color)
  html += '<div class="ga-platform-cards">';
  for (const row of rows) {
    const platform  = gaDimensionValue(row, 0);
    const key       = platform.toLowerCase();
    const label     = platformLabels[key] || platform;
    const color     = platformColors[key] || 'var(--accent)';
    const users    = formatNumber(gaMetricValue(row, 0));
    const newUsersMetric = _gaHideNewUsers ? '' :
      `<div class="ga-platform-card__metric"><span class="ga-platform-card__val">${formatNumber(gaMetricValue(row, 3))}</span><span class="ga-platform-card__lbl">Nuevos</span></div>`;
    html += `<div class="ga-platform-card" data-platform="${key}" style="background:${color};border-color:${color}">
      <div class="ga-platform-card__name">${esc(label)}</div>
      <div class="ga-platform-card__metrics">
        <div class="ga-platform-card__metric"><span class="ga-platform-card__val">${users}</span><span class="ga-platform-card__lbl">Usuarios</span></div>
        ${newUsersMetric}
      </div>
    </div>`;
  }
  html += '</div>';

  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-stacked-bar'));
}

function initStackedTooltip(bar) {
  if (!bar) return;
  let tip = document.getElementById('gaStackedTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'gaStackedTip';
    tip.className = 'ga-tooltip';
    document.body.appendChild(tip);
  }
  bar.addEventListener('mousemove', e => {
    const seg = e.target.closest('[data-tip]');
    if (!seg) return;
    tip.textContent = seg.dataset.tip || '';
    tip.style.left = e.clientX + 'px';
    tip.style.top  = e.clientY + 'px';
    tip.classList.add('visible');
  });
  bar.addEventListener('mouseleave', () => tip.classList.remove('visible'));
}

// ── Render peak hour chart ───────────────────────────────────────
// Filas (hour, platform) → mapa por hora con segmentos apilados por plataforma.
function renderPeakHour(data) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  const byHour = new Map();
  for (const row of rows) {
    const h = Number(gaDimensionValue(row, 0));
    const platform = (gaDimensionValue(row, 1) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 0));
    if (!byHour.has(h)) byHour.set(h, { web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byHour.get(h);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  let peakH = 0;
  let maxUsers = 0;
  for (const [h, b] of byHour) {
    if (b.total > maxUsers) { maxUsers = b.total; peakH = h; }
  }
  const peakHStr = String(peakH).padStart(2, '0');

  let html = `<div class="ga-peak-summary">Pico: <strong>${peakHStr}:00 – ${peakHStr}:59</strong> con <strong>${formatNumber(maxUsers)}</strong> usuarios</div>`;
  html += '<div class="ga-hour-chart">';
  for (let h = 0; h < 24; h++) {
    const bucket = byHour.get(h) || { web: 0, ios: 0, android: 0, total: 0 };
    const pct = maxUsers > 0 ? (bucket.total / maxUsers * 100) : 0;
    const isPeak = h === peakH && bucket.total > 0;

    const tipParts = [`${String(h).padStart(2,'0')}:00 – ${String(h).padStart(2,'0')}:59`, `Total ${formatNumber(bucket.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (bucket[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(bucket[key])}`);
    }
    const tip = tipParts.join(' · ');

    // Segmentos apilados de abajo arriba: web → ios → android.
    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!bucket[key]) continue;
      const segPct = bucket.total > 0 ? (bucket[key] / bucket.total * 100) : 0;
      segments += `<div class="ga-hour-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-hour-bar${isPeak ? ' ga-hour-bar--peak' : ''}" data-tip="${esc(tip)}">
      <div class="ga-hour-fill" style="height:${pct}%">${segments}</div>
      <div class="ga-hour-label">${h}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-hour-chart'));
}

// ── Render daily users chart (rango ≥ 2 días) ────────────────────
// Barra apilada por día: web (accent) + iOS (orange) + Android (green).
// Usa activeUsers (usuarios), no screenPageViews (visitas) — un mismo
// usuario que ve varias páginas cuenta 1 vez, no N.
// `platformTotals`: { web, ios, android } de activeUsers deduplicado por
// GA4 sobre TODO el rango (ver platformUserTotals) — sustituye a la suma
// naive día a día en la leyenda, que sobrecuenta usuarios recurrentes.
function renderDailyPageviews(data, platformTotals) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const dateRange = getAnalyticsDateRange();
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Filas (date, platform) → mapa por fecha con segmentos por plataforma.
  // Métrica: activeUsers (índice 1; índice 0 es screenPageViews, sin usar aquí).
  const byDate = new Map();
  for (const row of rows) {
    const ga = gaDimensionValue(row, 0);  // YYYYMMDD
    const iso = ga.length === 8 ? `${ga.slice(0,4)}-${ga.slice(4,6)}-${ga.slice(6,8)}` : ga;
    const platform = (gaDimensionValue(row, 1) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 1));
    if (!byDate.has(iso)) byDate.set(iso, { web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byDate.get(iso);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  // Continuidad: relleno de huecos.
  const days = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end   = new Date(endISO   + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const bucket = byDate.get(iso) || { web: 0, ios: 0, android: 0, other: 0, total: 0 };
    days.push({ iso, ...bucket });
  }

  const totals = { web: 0, ios: 0, android: 0, total: 0 };
  let peak = days[0];
  for (const day of days) {
    totals.web     += day.web;
    totals.ios     += day.ios;
    totals.android += day.android;
    totals.total   += day.total;
    if (day.total > peak.total) peak = day;
  }
  const avg = days.length ? Math.round(totals.total / days.length) : 0;
  const maxViews = peak.total;

  // Leyenda: preferir los totales deduplicados de GA4 (platformTotals) sobre
  // la suma día a día (totals), que sobrecuenta usuarios recurrentes.
  const legendTotals = platformTotals || totals;

  const fmtDay = iso => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  };
  const fmtDayLong = iso => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  };

  // Densidad de etiquetas: máx 12 visibles.
  const labelStep = Math.max(1, Math.ceil(days.length / 12));

  let html = `<div class="ga-peak-summary">Media diaria: <strong>${formatNumber(avg)}</strong> · Pico: <strong>${fmtDay(peak.iso)}</strong> (${formatNumber(peak.total)})</div>`;

  // Leyenda
  html += '<div class="ga-day-legend">';
  for (const key of PLATFORM_ORDER) {
    if (!legendTotals[key]) continue;
    html += `<div class="ga-day-legend__item"><span class="ga-day-legend__swatch" style="background:${PLATFORM_COLORS[key]}"></span>${PLATFORM_LABELS[key]} <span class="ga-day-legend__val">${formatNumber(legendTotals[key])}</span></div>`;
  }
  html += '</div>';

  html += '<div class="ga-day-chart">';
  days.forEach((day, idx) => {
    const totalPct = maxViews > 0 ? (day.total / maxViews * 100) : 0;
    const showLabel = idx % labelStep === 0 || idx === days.length - 1;
    const tipParts = [fmtDayLong(day.iso), `Total ${formatNumber(day.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (day[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(day[key])}`);
    }
    const tip = tipParts.join(' · ');

    // Segmentos apilados de abajo arriba: web → ios → android.
    // Posicionados con `bottom` absoluto dentro del stack, donde el stack
    // mide el % correspondiente al día respecto al pico del rango.
    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!day[key]) continue;
      const segPct = day.total > 0 ? (day[key] / day.total * 100) : 0;
      segments += `<div class="ga-day-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-day-bar" data-tip="${esc(tip)}">
      <div class="ga-day-bar__col">
        <div class="ga-day-stack" style="height:${totalPct}%">${segments}</div>
      </div>
      <div class="ga-day-label">${showLabel ? fmtDay(day.iso) : ''}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-day-chart'));
}

// ── Semana ISO-8601 (lunes-domingo) de una fecha UTC ─────────────
function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esa semana ISO
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const weekNum = Math.round((d - week1Monday) / 604800000) + 1;
  // Lunes de la semana ISO de `date` (no del jueves usado para el cálculo del año/número).
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - dayNum);
  return { isoYear, weekNum, monday };
}

// ── Render weekly users chart (rangos largos, p. ej. "Desde inicio web") ─
// Mismo lenguaje visual que renderDailyPageviews (barras apiladas por
// plataforma) pero agregado por semana ISO — con meses de datos, una barra
// por día es ilegible. Incluye la semana en curso (parcial) al final.
// `platformTotals`: { web, ios, android } de activeUsers deduplicado por
// GA4 sobre TODO el rango (ver platformUserTotals) — sustituye a la suma
// naive semana a semana en la leyenda, que sobrecuenta usuarios recurrentes.
function renderWeeklyPageviews(data, platformTotals) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const dateRange = getAnalyticsDateRange();
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Filas (isoWeek, isoYear, platform) → mapa por semana ISO con segmentos
  // por plataforma. La API de GA4 YA deduplica activeUsers dentro de cada
  // semana (igual que hace 'overview' para todo el rango) — NO se suman
  // días individuales aquí, porque activeUsers no es sumable entre días
  // (un usuario que vuelve varias veces en la semana se contaría de más).
  const byWeek = new Map(); // key "YYYY-Www" → { isoYear, weekNum, monday, web, ios, android, other, total }
  for (const row of rows) {
    const weekNum = Number(gaDimensionValue(row, 0)); // "isoWeek": "01".."53"
    const isoYear = Number(gaDimensionValue(row, 1)); // "isoYear": "2026"
    if (!weekNum || !isoYear) continue;
    // Lunes de esa semana ISO: el jueves de la semana 1 cae siempre en enero;
    // a partir de su lunes, sumamos (weekNum-1) semanas.
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
    const monday = new Date(week1Monday);
    monday.setUTCDate(monday.getUTCDate() + (weekNum - 1) * 7);
    const key = `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    const platform = (gaDimensionValue(row, 2) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 1));
    if (!byWeek.has(key)) byWeek.set(key, { isoYear, weekNum, monday, web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byWeek.get(key);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  // Continuidad: relleno de huecos, semana a semana desde el lunes de la
  // semana del inicio hasta el lunes de la semana de fin (incluye la semana
  // en curso, aunque esté parcial).
  const weeks = [];
  const startMonday = isoWeekInfo(new Date(startISO + 'T00:00:00Z')).monday;
  const endMonday   = isoWeekInfo(new Date(endISO   + 'T00:00:00Z')).monday;
  for (let m = new Date(startMonday); m <= endMonday; m.setUTCDate(m.getUTCDate() + 7)) {
    const { isoYear, weekNum, monday } = isoWeekInfo(m);
    const key = `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    const bucket = byWeek.get(key) || { isoYear, weekNum, monday, web: 0, ios: 0, android: 0, other: 0, total: 0 };
    weeks.push({ key, ...bucket });
  }

  const totals = { web: 0, ios: 0, android: 0, total: 0 };
  let peak = weeks[0];
  for (const week of weeks) {
    totals.web     += week.web;
    totals.ios     += week.ios;
    totals.android += week.android;
    totals.total   += week.total;
    if (week.total > peak.total) peak = week;
  }
  const avg = weeks.length ? Math.round(totals.total / weeks.length) : 0;
  const maxViews = peak.total;

  // Leyenda: preferir los totales deduplicados de GA4 (platformTotals) sobre
  // la suma semana a semana (totals), que sobrecuenta usuarios recurrentes.
  const legendTotals = platformTotals || totals;

  const fmtWeek = w => `Sem. ${w.weekNum}`;
  const fmtWeekLong = w => {
    const sunday = new Date(w.monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const fmtD = d => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return `Semana ${w.weekNum} (${fmtD(w.monday)} – ${fmtD(sunday)})`;
  };

  // Densidad de etiquetas: máx 14 visibles.
  const labelStep = Math.max(1, Math.ceil(weeks.length / 14));

  let html = `<div class="ga-peak-summary">Media semanal: <strong>${formatNumber(avg)}</strong> · Pico: <strong>${fmtWeek(peak)}</strong> (${formatNumber(peak.total)})</div>`;

  // Leyenda
  html += '<div class="ga-day-legend">';
  for (const key of PLATFORM_ORDER) {
    if (!legendTotals[key]) continue;
    html += `<div class="ga-day-legend__item"><span class="ga-day-legend__swatch" style="background:${PLATFORM_COLORS[key]}"></span>${PLATFORM_LABELS[key]} <span class="ga-day-legend__val">${formatNumber(legendTotals[key])}</span></div>`;
  }
  html += '</div>';

  html += '<div class="ga-day-chart">';
  weeks.forEach((week, idx) => {
    const totalPct = maxViews > 0 ? (week.total / maxViews * 100) : 0;
    const showLabel = idx % labelStep === 0 || idx === weeks.length - 1;
    const tipParts = [fmtWeekLong(week), `Total ${formatNumber(week.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (week[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(week[key])}`);
    }
    const tip = tipParts.join(' · ');

    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!week[key]) continue;
      const segPct = week.total > 0 ? (week[key] / week.total * 100) : 0;
      segments += `<div class="ga-day-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-day-bar" data-tip="${esc(tip)}">
      <div class="ga-day-bar__col">
        <div class="ga-day-stack" style="height:${totalPct}%">${segments}</div>
      </div>
      <div class="ga-day-label">${showLabel ? fmtWeek(week) : ''}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-day-chart'));
}

// ── Render top pages table ───────────────────────────────────────
function renderTopPages(data) {
  const container = document.getElementById('gaTopPages');
  const allRows = data?.rows || [];
  const rows = allRows.filter(r => /\/(jornada|competicion|inscritos|orden-salida|resultados|equipo|corredor|campeonatos|modal|perfil|fichajes|transfers)/.test(gaDimensionValue(r, 0))).slice(0, 15);
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos de páginas</div>'; return; }

  const maxViews = Math.max(...rows.map(r => Number(gaMetricValue(r, 0))));
  let html = `<table class="ga-table"><thead><tr><th>Página</th><th>Usuarios</th><th>Vistas</th><th>Duración</th></tr></thead><tbody>`;
  for (const row of rows) {
    const page     = esc(gaDimensionValue(row, 0));  // pagePath
    const views    = Number(gaMetricValue(row, 0));
    const users    = formatNumber(gaMetricValue(row, 1));
    const duration = formatDuration(gaMetricValue(row, 2));
    const pct      = maxViews > 0 ? (views / maxViews * 100) : 0;
    html += `<tr>
      <td class="ga-bar-cell"><span class="ga-bar" style="width:${pct}%"></span><span style="position:relative">${page}</span></td>
      <td>${users}</td><td>${formatNumber(views)}</td><td>${duration}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render top stages (apps) ─────────────────────────────────────
function renderTopStages(data) {
  const container = document.getElementById('gaTopStages');
  const rows = (data?.rows || []).slice(0, 5);
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const maxViews = Math.max(...rows.map(r => Number(gaMetricValue(r, 0))));
  let html = `<table class="ga-table"><thead><tr><th>Etapa</th><th>Carrera</th><th>Usuarios</th><th>Vistas</th></tr></thead><tbody>`;
  for (const row of rows) {
    const raceName  = esc(gaDimensionValue(row, 1)) || '—';
    // Las pruebas de un día (clásicas, Campeonatos Nacionales) no tienen
    // etiqueta de etapa → stage_name vacío. En esos casos mostramos "Prueba
    // única" en la columna Etapa en lugar de un "—" suelto.
    const stageName = esc(gaDimensionValue(row, 0)) || 'Prueba única';
    const views     = Number(gaMetricValue(row, 0));
    const users     = formatNumber(gaMetricValue(row, 1));
    const pct       = maxViews > 0 ? (views / maxViews * 100) : 0;
    html += `<tr>
      <td class="ga-bar-cell" style="width:35%"><span class="ga-bar" style="width:${pct}%"></span><span style="position:relative">${stageName}</span></td>
      <td style="width:35%">${raceName}</td>
      <td>${users}</td><td>${formatNumber(views)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render traffic sources ───────────────────────────────────────
function renderTrafficSources(data) {
  const container = document.getElementById('gaTrafficSources');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  let html = `<table class="ga-table"><thead><tr><th>Fuente</th><th>Usuarios</th><th>Vistas</th></tr></thead><tbody>`;
  for (const row of rows) {
    const source = esc(gaDimensionValue(row, 0));
    const users  = formatNumber(gaMetricValue(row, 1));
    const views  = formatNumber(gaMetricValue(row, 3));
    html += `<tr><td>${source}</td><td>${users}</td><td>${views}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render countries ─────────────────────────────────────────────
function renderCountries(data) {
  const container = document.getElementById('gaCountries');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  let html = `<table class="ga-table"><thead><tr><th>País</th><th>Usuarios</th></tr></thead><tbody>`;
  for (const row of rows) {
    const country = esc(gaDimensionValue(row, 0));
    const users   = formatNumber(gaMetricValue(row, 0));
    html += `<tr><td>${country}</td><td>${users}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render devices (horizontal bars) ─────────────────────────────
// ═════════════════════════════════════════════════════════════════
//  INSCRITOS / STARTLISTS
// ═════════════════════════════════════════════════════════════════

let _startlistsInitialized = false;

function setupStartlistsView() {
  if (_startlistsInitialized) { loadExistingStartlists(); return; }
  _startlistsInitialized = true;
  // El editor de inscritos se renderiza en el drawer; sus listeners se cablean
  // por apertura en wireStartlistEditor() (ver openStartlistEditor).
  loadExistingStartlists();
}

async function loadExistingStartlists() {
  const container = document.getElementById('existingStartlists');

  // Filtramos directamente la tabla `races` por `startlistImportedAt IS NOT NULL`
  // y ordenamos por startDate desc. Sale en 1 query de 10 filas — antes había
  // que paginar miles de filas de `startlist_teams` para sacar los raceIds.
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, startDate, endDate, countryCode, uciCategory, gender, hideFlag, enrichedStartlist')
    .not('startlistImportedAt', 'is', null)
    .order('startDate', { ascending: false })
    .limit(10);

  if (error || !races || races.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);padding:0.5rem 0">No hay listas importadas.</div>';
    return;
  }

  const raceEntries = races.map(r => ({ raceId: r.id, race: r }));

  function formatRaceDates(race) {
    if (!race) return '';
    const fmt = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
    if (race.startDate && race.endDate && race.startDate !== race.endDate) {
      return `${fmt(race.startDate)} – ${fmt(race.endDate)}`;
    }
    if (race.startDate) return fmt(race.startDate);
    return '';
  }

  const rowHtml = ({ raceId, race }) => {
    const name  = race ? race.name : raceId;
    const dates = formatRaceDates(race);
    const flag  = (race && !race.hideFlag) ? countryFlag(race.countryCode) : '';
    const catBadge = race
      ? categoryBadge(race.uciCategory, race.gender === 'female' && !nameImpliesFemale(race.name || ''))
      : '';
    return `<div class="listrow">
      <span class="listrow__flag">${flag}</span>
      <div class="listrow__info">
        <div class="listrow__name">${esc(name)}</div>
        ${dates ? `<div class="listrow__meta">${esc(dates)}</div>` : ''}
        ${catBadge ? `<div class="listrow__badges">${catBadge}</div>` : ''}
      </div>
      <div class="listrow__actions">
        <button class="btn btn--ghost listrow__btn" onclick="openStartlistEditor('${raceId}')">Editar</button>
        <button class="btn btn--ghost listrow__btn listrow__btn--danger" onclick="deleteStartlist('${raceId}')">Eliminar</button>
      </div>
    </div>`;
  };

  // Agrupar como la Agenda: enriquecidas (chapas curadas) vs sin enriquecer.
  const groups = [
    { key: true,  label: 'Enriquecidas' },
    { key: false, label: 'Sin enriquecer' },
  ];

  let html = '';
  for (const { key, label } of groups) {
    const entries = raceEntries.filter(({ race }) => !!(race && race.enrichedStartlist) === key);
    if (entries.length === 0) continue;
    html += `<div class="sidebar-group-label">${label}</div>`;
    html += entries.map(rowHtml).join('');
  }
  container.innerHTML = html;
}

window.deleteStartlist = async function(raceId) {
  if (!await confirmDialog('¿Eliminar la lista de inscritos de esta carrera?', { danger: true })) return;
  await supabase.from('startlist_riders').delete().eq('raceId', raceId);
  await supabase.from('startlist_teams').delete().eq('raceId', raceId);
  await supabase.from('races').update({
    startlistImportedAt: null,
    startlistProvisional: false,
  }).eq('id', raceId);
  const race = allRaces.find(r => r.id === raceId);
  if (race) {
    race.startlistImportedAt = null;
    race.startlistProvisional = false;
  }
  showToast('Lista de inscritos eliminada', 'success');
  closeStartlistEditor();
  loadExistingStartlists();
};

// ── Editor de startlist ──────────────────────────────────────────
let _editingRaceId = null;
let _editingRaceEnriched = false;   // estado del toggle del editor abierto
let _editingRaceProvisional = false; // toggle "Lista provisional"

// ─── Rider matching ───────────────────────────────────────────────
// Fase 4: el matching automático orden-dependiente (normalizeTeamName + score)
// se eliminó. La resolución contra el catálogo la hace el RPC resolve_riders al
// GUARDAR la startlist (por identityKey, invariante al orden apellido/nombre,
// y crea las fichas faltantes). El editor conserva el vínculo MANUAL por corredor
// (botón "Buscar/Vincular" → _slOpenMatchPicker) y la creación inline.

function _slRefreshRiderMatchBtn(riderEl, rider /* opcional, para tooltip */) {
  const btn = riderEl.querySelector('.sl-rider-match-btn');
  if (!btn) return;
  const id = riderEl.dataset.globalRiderId || '';
  if (id) {
    btn.textContent = '✓ BD';
    btn.style.color = '#22c55e';
    btn.title = rider
      ? `Match en BD: ${rider.firstName || ''} ${rider.lastName || ''}. Click para cambiar/desligar.`
      : 'Match en BD. Click para cambiar/desligar.';
  } else {
    btn.textContent = '🔗';
    btn.style.color = 'var(--text-dim)';
    btn.title = 'Buscar o forzar un match en la BD de corredores';
  }
}

// ── Picker manual de match contra la BD ─────────────────────────────
let _slMatchPickerEl = null;

function _slCloseMatchPicker() {
  if (_slMatchPickerEl) { _slMatchPickerEl.remove(); _slMatchPickerEl = null; }
  document.removeEventListener('mousedown', _slOutsideMatchPickerClick, true);
}

function _slOutsideMatchPickerClick(e) {
  if (!_slMatchPickerEl) return;
  if (_slMatchPickerEl.contains(e.target)) return;
  if (e.target.closest('.sl-rider-match-btn')) return;
  _slCloseMatchPicker();
}

async function _slOpenRiderMatchPicker(riderEl) {
  _slCloseMatchPicker();

  const race = allRaces.find(r => r.id === _editingRaceId);
  const raceGender = race?.gender;
  const ridersTable = raceGender === 'female' ? 'riders_women' : raceGender === 'male' ? 'riders_men' : null;
  if (!ridersTable) { showToast('La carrera no tiene género definido', 'error'); return; }

  const currentLast = (riderEl.querySelector('.sl-lastname').value || '').trim();
  const currentId   = riderEl.dataset.globalRiderId || null;

  const popover = document.createElement('div');
  popover.style.cssText = 'position:absolute;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.6rem;width:400px;max-height:600px;overflow:auto;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
  popover.innerHTML = `
    ${currentId ? `
      <div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:0.3rem">Match actual: <code style="color:var(--text)">${esc(currentId)}</code></div>
      <div class="sl-picker-edit-current" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem">
        <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.04em">Editar este rider en BD</div>
        <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center">
          <input type="text" class="sl-edit-last" placeholder="Apellidos" style="flex:1.4;min-width:6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none;font-weight:700">
          <input type="text" class="sl-edit-first" placeholder="Nombre" style="flex:1.2;min-width:5rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none">
          <input type="text" class="sl-edit-nat" placeholder="es" maxlength="5" style="width:2.8rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none;text-transform:lowercase;text-align:center">
          <span class="sl-edit-flag" style="font-size:1.1rem;min-width:1.4rem;text-align:center"></span>
        </div>
        <input type="text" class="sl-edit-other" placeholder="otherNames (aliases separados por coma)" style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.74rem;padding:0.2rem 0.35rem;outline:none;margin-top:0.3rem">
        <input type="date" class="sl-edit-birth" title="Fecha de nacimiento" style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.74rem;padding:0.2rem 0.35rem;outline:none;margin-top:0.3rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.4rem;gap:0.3rem">
          <button data-action="delete-current" type="button" class="btn btn--ghost" style="padding:0.25rem 0.5rem;font-size:0.7rem;color:var(--red)" title="Eliminar este rider de la BD (desliga primero las startlists afectadas)">Eliminar de BD</button>
          <button data-action="save-current" type="button" class="btn btn--primary" disabled style="padding:0.25rem 0.55rem;font-size:0.7rem;opacity:0.45">Guardar</button>
        </div>
        <div class="sl-picker-dups" style="margin-top:0.5rem;display:none">
          <div style="font-size:0.66rem;color:var(--text-dim);margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:0.04em">Posibles duplicados en BD</div>
          <div class="sl-picker-dups-list u-stack u-stack--xs"></div>
        </div>
      </div>
    ` : `
      <div style="font-size:0.72rem;color:var(--text-dim);margin-bottom:0.4rem">Sin match en BD.</div>
      <div class="sl-picker-create-new" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem">
        <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.04em">Crear nuevo rider en BD</div>
        <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center;margin-bottom:0.3rem">
          <input type="text" class="sl-new-last" placeholder="Apellidos" style="flex:1.4;min-width:6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none;font-weight:700">
          <input type="text" class="sl-new-first" placeholder="Nombre" style="flex:1.2;min-width:5rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none">
          <input type="text" class="sl-new-nat" placeholder="es" maxlength="5" style="width:2.8rem;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.78rem;padding:0.2rem 0.35rem;outline:none;text-transform:lowercase;text-align:center">
          <span class="sl-new-flag" style="font-size:1.1rem;min-width:1.4rem;text-align:center"></span>
        </div>
        <input type="text" class="sl-new-other" placeholder="otherNames (opcional): aliases separados por coma" style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.74rem;padding:0.2rem 0.35rem;outline:none;margin-bottom:0.3rem">
        <input type="date" class="sl-new-birth" title="Fecha de nacimiento (opcional)" style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.74rem;padding:0.2rem 0.35rem;outline:none;margin-bottom:0.4rem">
        <div style="display:flex;justify-content:flex-end">
          <button data-action="create-new" type="button" class="btn btn--primary" style="padding:0.25rem 0.6rem;font-size:0.72rem">Crear y vincular</button>
        </div>
      </div>
    `}
    <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:0.04em">${currentId ? 'O buscar otro' : 'O buscar match existente'}</div>
    <input type="search" class="sl-picker-input" placeholder="Apellido, nombre u otherNames…"
           style="width:100%;padding:0.4rem 0.6rem;font-size:0.82rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none;box-sizing:border-box;margin-bottom:0.4rem">
    <div class="sl-picker-results" style="display:flex;flex-direction:column;gap:0.2rem;min-height:1.2rem"></div>
    <div style="margin-top:0.5rem;border-top:1px solid var(--border);padding-top:0.5rem;display:flex;justify-content:space-between;align-items:center">
      ${currentId
        ? '<button data-action="unlink" type="button" class="btn btn--ghost" style="padding:0.3rem 0.6rem;font-size:0.72rem;color:var(--text-dim)">Desligar (sin borrar)</button>'
        : '<span></span>'}
      <button data-action="close" type="button" class="btn btn--ghost" style="padding:0.3rem 0.6rem;font-size:0.72rem">Cerrar</button>
    </div>`;

  document.body.appendChild(popover);
  const rect = riderEl.getBoundingClientRect();
  popover.style.left = (rect.left + window.scrollX) + 'px';
  popover.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  // Si se sale por la derecha, alinear a la derecha del rider
  const popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 16) {
    popover.style.left = (rect.right + window.scrollX - popRect.width) + 'px';
  }
  _slMatchPickerEl = popover;

  const input = popover.querySelector('.sl-picker-input');
  const results = popover.querySelector('.sl-picker-results');
  let reqId = 0;

  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    if (q.length < 2) {
      results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Escribe al menos 2 letras.</div>';
      return;
    }
    results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Buscando…</div>';
    const safe = q.replace(/[%,()]/g, '');
    const { data, error } = await supabase.from(ridersTable)
      .select('id,firstName,lastName,otherNames,nationality,currentTeamId,verified,source')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div style="color:var(--red);font-size:0.72rem;padding:0.3rem">Error: ${esc(error.message)}</div>`; return; }
    if (!data?.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Sin resultados.</div>';
      return;
    }
    results.innerHTML = data.map(rd => `
      <div data-rid="${esc(rd.id)}" style="display:flex;align-items:center;gap:0.35rem;padding:0.3rem 0.4rem;background:var(--bg);border:1px solid ${rd.id === currentId ? '#22c55e' : 'var(--border)'};border-radius:5px;font-size:0.78rem;color:var(--text)">
        <div data-pick="${esc(rd.id)}" role="button" tabindex="0" style="display:flex;align-items:center;gap:0.4rem;flex:1;min-width:0;cursor:pointer">
          ${_slRiderFlagPreview(rd.nationality)}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${esc(rd.lastName)}</strong>, ${esc(rd.firstName)}${rd.otherNames ? ` <span class="u-c-dim u-fs-070">(${esc(rd.otherNames)})</span>` : ''}</span>
          ${rd.verified === false ? '<span title="Sin verificar" style="color:#f59e0b;font-size:0.65rem;font-weight:700;flex-shrink:0">?</span>' : ''}
        </div>
        ${currentId ? `<button type="button" data-action="merge-into" data-rid="${esc(rd.id)}" title="Fusionar este corredor en el match actual (mueve sus startlists y lo elimina)" style="background:#22c55e;color:#fff;border:none;border-radius:3px;padding:0.15rem 0.35rem;font-size:0.65rem;cursor:pointer;flex-shrink:0">🔀</button>` : ''}
        <button type="button" data-action="delete-result" data-rid="${esc(rd.id)}" title="Eliminar este corredor de la BD" style="background:none;border:1px solid var(--border);color:var(--red);border-radius:3px;padding:0.1rem 0.35rem;font-size:0.7rem;cursor:pointer;flex-shrink:0">🗑</button>
      </div>`).join('');
    // Click sobre la zona de info → selección como match.
    results.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rider = data.find(x => x.id === btn.dataset.pick);
        if (!rider) return;
        riderEl.dataset.globalRiderId = rider.id;
        riderEl.querySelector('.sl-firstname').value = rider.firstName;
        riderEl.querySelector('.sl-lastname').value  = rider.lastName;
        const country = riderEl.querySelector('.sl-country');
        const flagEl  = riderEl.querySelector('.sl-flag-preview');
        if (rider.nationality && country.value.trim().toLowerCase() !== rider.nationality.toLowerCase()) {
          country.value = rider.nationality;
          if (flagEl) flagEl.innerHTML = _slRiderFlagPreview(rider.nationality);
        }
        _slRefreshRiderMatchBtn(riderEl, rider);
        const sugg = riderEl.querySelector('.sl-rider-suggestion');
        if (sugg) { sugg.style.display = 'none'; sugg.dataset.dismissed = '1'; }
        _slCloseMatchPicker();
        showToast(`Match: ${rider.firstName} ${rider.lastName}`, 'success');
      });
    });
    // 🔀 Fusionar este resultado en el currentId (solo si hay currentId).
    results.querySelectorAll('[data-action="merge-into"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const src = data.find(x => x.id === btn.dataset.rid);
        if (!src || !currentId) return;
        const { count: linkedCount } = await supabase.from('startlist_riders')
          .select('id', { count: 'exact', head: true }).eq('globalRiderId', src.id);
        if (!await confirmDialog(`Mover ${linkedCount || 0} startlist(s) de "${src.lastName}, ${src.firstName}" → match actual y eliminar el duplicado.\n\n¿Continuar?`, { danger: true })) return;
        btn.disabled = true; btn.textContent = '…';
        // Reconstruimos target con datos mínimos para acumular otherNames.
        const target = { id: currentId, firstName: '', lastName: '', otherNames: '' };
        const { ok, error } = await _mergeRidersSilent(src, target, ridersTable);
        if (!ok) { btn.disabled = false; btn.textContent = '🔀'; showToast('Error: ' + error, 'error'); return; }
        btn.closest('[data-rid]').remove();
        showToast(`Fusionado: ${linkedCount || 0} startlist(s) movidas`, 'success');
      });
    });
    // 🗑 Borrar este resultado de la BD (desliga sus startlists primero).
    results.querySelectorAll('[data-action="delete-result"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const rd = data.find(x => x.id === btn.dataset.rid);
        if (!rd) return;
        const { count: linkedCount } = await supabase.from('startlist_riders')
          .select('id', { count: 'exact', head: true }).eq('globalRiderId', rd.id);
        if (!await confirmDialog(`Eliminar "${rd.lastName}, ${rd.firstName}" de la BD.\n\n${linkedCount || 0} startlist(s) perderán el match (snapshot se conserva).\n\n¿Continuar?`, { danger: true })) return;
        btn.disabled = true; btn.textContent = '…';
        if (linkedCount) {
          await supabase.from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', rd.id);
        }
        const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', rd.id);
        if (delErr) { btn.disabled = false; btn.textContent = '🗑'; showToast('Error: ' + delErr.message, 'error'); return; }
        btn.closest('[data-rid]').remove();
        showToast(`Eliminado. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
      });
    });
  };

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _slCloseMatchPicker(); });

  popover.querySelector('[data-action="unlink"]')?.addEventListener('click', () => {
    delete riderEl.dataset.globalRiderId;
    _slRefreshRiderMatchBtn(riderEl);
    _slCloseMatchPicker();
    showToast('Match eliminado', 'success');
  });
  popover.querySelector('[data-action="close"]').addEventListener('click', _slCloseMatchPicker);

  // ── Crear nuevo rider en BD (solo si NO hay match) ────────────────
  if (!currentId) {
    const newLast  = popover.querySelector('.sl-new-last');
    const newFirst = popover.querySelector('.sl-new-first');
    const newNat   = popover.querySelector('.sl-new-nat');
    const newFlag  = popover.querySelector('.sl-new-flag');
    const newOther = popover.querySelector('.sl-new-other');
    const newBirth = popover.querySelector('.sl-new-birth');
    const createBtn = popover.querySelector('[data-action="create-new"]');

    // Precargar desde la fila del editor de inscritos.
    newLast.value  = (riderEl.querySelector('.sl-lastname').value  || '').trim();
    newFirst.value = (riderEl.querySelector('.sl-firstname').value || '').trim();
    const slCountry = (riderEl.querySelector('.sl-country')?.value || '').trim().toLowerCase();
    newNat.value   = slCountry;
    newFlag.innerHTML = _slRiderFlagPreview(slCountry);
    newNat.addEventListener('input', () => {
      newFlag.innerHTML = _slRiderFlagPreview(newNat.value.trim().toLowerCase());
    });

    // currentTeamId: si el team de la fila tiene teamId canónico (enriquecido), úsalo.
    const teamEl = riderEl.closest('.sl-edit-team');
    const teamIdRef = teamEl?.dataset.teamId || null;

    createBtn.addEventListener('click', async () => {
      const last  = newLast.value.trim();
      const first = newFirst.value.trim();
      const nat   = (newNat.value.trim().toLowerCase()) || null;
      const other = newOther.value.trim() || null;
      const birth = newBirth.value || null;
      if (!last || !first) { showToast('Necesita nombre y apellido', 'error'); return; }
      createBtn.disabled = true; createBtn.textContent = 'Creando…';

      // Generar slug "apellido-nombre", con sufijo numérico si colisiona.
      const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const base = `${slugify(last)}-${slugify(first)}` || `rider-${Date.now()}`;
      let candidate = base;
      let n = 2;
      // Verificar colisiones en BD
      while (true) {
        const { data: exists } = await supabase.from(ridersTable).select('id').eq('id', candidate).limit(1);
        if (!exists?.length) break;
        candidate = `${base}-${n++}`;
        if (n > 100) { createBtn.disabled = false; createBtn.textContent = 'Crear y vincular'; showToast('Demasiadas colisiones de slug', 'error'); return; }
      }

      const { error } = await supabase.from(ridersTable).insert({
        id: candidate,
        firstName: first,
        lastName: last,
        nationality: nat,
        otherNames: other,
        birthDate: birth,
        currentTeamId: teamIdRef,
        source: 'manual',
        verified: true,
      });
      if (error) { createBtn.disabled = false; createBtn.textContent = 'Crear y vincular'; showToast('Error: ' + error.message, 'error'); return; }

      // Vincular en la fila del editor de inscritos.
      riderEl.dataset.globalRiderId = candidate;
      riderEl.querySelector('.sl-firstname').value = first;
      riderEl.querySelector('.sl-lastname').value  = last;
      _slRefreshRiderMatchBtn(riderEl, { firstName: first, lastName: last });
      const sugg = riderEl.querySelector('.sl-rider-suggestion');
      if (sugg) { sugg.style.display = 'none'; sugg.dataset.dismissed = '1'; }
      _slCloseMatchPicker();
      showToast(`Creado en BD: ${first} ${last} (${candidate})`, 'success');
    });
  }

  // ── Editor inline del rider matcheado (solo si hay match) ─────────
  if (currentId) {
    const editLast  = popover.querySelector('.sl-edit-last');
    const editFirst = popover.querySelector('.sl-edit-first');
    const editNat   = popover.querySelector('.sl-edit-nat');
    const editFlag  = popover.querySelector('.sl-edit-flag');
    const editOther = popover.querySelector('.sl-edit-other');
    const editBirth = popover.querySelector('.sl-edit-birth');
    const saveBtn   = popover.querySelector('[data-action="save-current"]');
    const delBtn    = popover.querySelector('[data-action="delete-current"]');

    // Carga datos actuales del rider matcheado para precargar los inputs.
    const { data: currentRider } = await supabase.from(ridersTable)
      .select('firstName,lastName,nationality,otherNames,birthDate').eq('id', currentId).single();
    if (currentRider) {
      editLast.value  = currentRider.lastName  || '';
      editFirst.value = currentRider.firstName || '';
      editNat.value   = currentRider.nationality || '';
      editOther.value = currentRider.otherNames || '';
      editBirth.value = currentRider.birthDate || '';
      editFlag.innerHTML = _slRiderFlagPreview(currentRider.nationality);
    }
    const baseline = {
      last: editLast.value, first: editFirst.value, nat: editNat.value,
      other: editOther.value, birth: editBirth.value,
    };
    const refreshSaveBtn = () => {
      const dirty = (
        editLast.value.trim()  !== baseline.last  ||
        editFirst.value.trim() !== baseline.first ||
        editNat.value.trim().toLowerCase() !== baseline.nat ||
        editOther.value.trim() !== baseline.other.trim() ||
        editBirth.value !== baseline.birth
      ) && editLast.value.trim() && editFirst.value.trim();
      saveBtn.disabled = !dirty;
      saveBtn.style.opacity = dirty ? '1' : '0.45';
    };
    [editLast, editFirst, editNat, editOther, editBirth].forEach(inp => inp.addEventListener('input', () => {
      if (inp === editNat) editFlag.innerHTML = _slRiderFlagPreview(inp.value.trim().toLowerCase());
      refreshSaveBtn();
    }));

    saveBtn.addEventListener('click', async () => {
      const last  = editLast.value.trim();
      const first = editFirst.value.trim();
      const nat   = editNat.value.trim().toLowerCase() || null;
      const other = editOther.value.trim() || null;
      const birth = editBirth.value || null;
      if (!last || !first) { showToast('Necesita nombre y apellido', 'error'); return; }
      saveBtn.disabled = true; saveBtn.textContent = '…';
      const { error } = await supabase.from(ridersTable).update({
        firstName: first, lastName: last, nationality: nat,
        otherNames: other, birthDate: birth,
        verified: true, updatedAt: new Date().toISOString(),
      }).eq('id', currentId);
      if (error) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; showToast('Error: ' + error.message, 'error'); return; }
      // Reflejar el cambio en la fila del editor de inscritos también.
      riderEl.querySelector('.sl-firstname').value = first;
      riderEl.querySelector('.sl-lastname').value  = last;
      _slRefreshRiderMatchBtn(riderEl, { firstName: first, lastName: last });
      baseline.last = last; baseline.first = first; baseline.nat = nat || '';
      baseline.other = other || ''; baseline.birth = birth || '';
      saveBtn.textContent = 'Guardar'; saveBtn.style.opacity = '0.45';
      showToast('Rider de BD actualizado', 'success');
    });

    // ── Posibles duplicados en BD del rider actual ──────────────────
    // Heurística: mismo apellido normalizado + mismo primer carácter del
    // firstName normalizado. Resultado limitado a 25, excluyendo el propio
    // currentId. Por candidato, dos botones: "Fusionar aquí" (mueve sus
    // startlists al rider actual y lo borra) o "Eliminar" (sin reapuntar).
    const renderDups = async () => {
      const wrap = popover.querySelector('.sl-picker-dups');
      const list = popover.querySelector('.sl-picker-dups-list');
      const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      const curLast = norm(editLast.value);
      const curFirstInitial = norm(editFirst.value).charAt(0);
      if (!curLast) { wrap.style.display = 'none'; return; }
      const safeLast = editLast.value.trim().replace(/[%,()]/g, '');
      const { data, error } = await supabase.from(ridersTable)
        .select('id,firstName,lastName,nationality,verified,source,otherNames')
        .neq('id', currentId)
        .ilike('lastName', `%${safeLast}%`)
        .limit(25);
      if (error) { wrap.style.display = 'none'; return; }
      const dups = (data || []).filter(c =>
        norm(c.lastName) === curLast &&
        (!curFirstInitial || norm(c.firstName).charAt(0) === curFirstInitial)
      );
      if (!dups.length) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      list.innerHTML = dups.map(d => `
        <div data-dup-id="${esc(d.id)}" style="display:flex;align-items:center;gap:0.35rem;padding:0.3rem 0.4rem;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;font-size:0.72rem">
          ${_slRiderFlagPreview(d.nationality)}
          <span class="u-grow u-min0 u-truncate"><strong>${esc(d.lastName)}</strong>, ${esc(d.firstName)}${d.otherNames ? ` <span style="color:var(--text-dim);font-size:0.65rem">(${esc(d.otherNames)})</span>` : ''}</span>
          <span style="color:${d.verified ? '#22c55e' : '#f59e0b'};font-size:0.65rem;font-weight:700;flex-shrink:0">${d.verified ? '✓' : '?'}</span>
          <span style="color:var(--text-dim);font-size:0.62rem;flex-shrink:0">${esc(d.source || '')}</span>
          <button data-dup-action="merge-into-current" title="Mover sus startlists al rider actual y eliminarlo" type="button" style="background:#22c55e;color:#fff;border:none;border-radius:3px;padding:0.15rem 0.4rem;font-size:0.65rem;cursor:pointer;flex-shrink:0">Fusionar</button>
          <button data-dup-action="delete-dup" title="Eliminar este rider de BD (desliga sus startlists, no las reapunta)" type="button" style="background:none;border:1px solid var(--border);border-radius:3px;padding:0.15rem 0.4rem;font-size:0.65rem;cursor:pointer;color:var(--red);flex-shrink:0">Borrar</button>
        </div>`).join('');

      list.querySelectorAll('[data-dup-action="merge-into-current"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('[data-dup-id]');
          const dupId = row.dataset.dupId;
          const dup = dups.find(d => d.id === dupId);
          if (!dup) return;
          const { count: linkedCount } = await supabase.from('startlist_riders')
            .select('id', { count: 'exact', head: true }).eq('globalRiderId', dupId);
          if (!await confirmDialog(`Mover ${linkedCount || 0} startlist(s) de "${dup.lastName}, ${dup.firstName}" → "${editLast.value}, ${editFirst.value}" y eliminar el duplicado.\n\n¿Continuar?`, { danger: true })) return;
          btn.disabled = true; btn.textContent = '…';
          const target = { id: currentId, firstName: editFirst.value.trim(), lastName: editLast.value.trim(), otherNames: '' };
          const { ok, error } = await _mergeRidersSilent(dup, target, ridersTable);
          if (!ok) { btn.disabled = false; btn.textContent = 'Fusionar'; showToast('Error: ' + error, 'error'); return; }
          row.remove();
          if (!list.children.length) popover.querySelector('.sl-picker-dups').style.display = 'none';
          showToast(`Fusionado: ${linkedCount || 0} startlist(s) reapuntadas`, 'success');
        });
      });
      list.querySelectorAll('[data-dup-action="delete-dup"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('[data-dup-id]');
          const dupId = row.dataset.dupId;
          const dup = dups.find(d => d.id === dupId);
          if (!dup) return;
          const { count: linkedCount } = await supabase.from('startlist_riders')
            .select('id', { count: 'exact', head: true }).eq('globalRiderId', dupId);
          if (!await confirmDialog(`Eliminar "${dup.lastName}, ${dup.firstName}" de BD.\n\n${linkedCount || 0} startlist(s) perderán el match (snapshot del nombre se conserva).\n\n¿Continuar?`, { danger: true })) return;
          btn.disabled = true; btn.textContent = '…';
          if (linkedCount) {
            await supabase.from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', dupId);
          }
          const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', dupId);
          if (delErr) { btn.disabled = false; btn.textContent = 'Borrar'; showToast('Error: ' + delErr.message, 'error'); return; }
          row.remove();
          if (!list.children.length) popover.querySelector('.sl-picker-dups').style.display = 'none';
          showToast(`Eliminado. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
        });
      });
    };
    renderDups();
    // Re-evaluar duplicados si el admin edita apellido o nombre (puede aflorar
    // otros candidatos al normalizar la búsqueda).
    let dupTimer = null;
    [editLast, editFirst].forEach(inp => inp.addEventListener('input', () => {
      clearTimeout(dupTimer);
      dupTimer = setTimeout(renderDups, 350);
    }));

    delBtn.addEventListener('click', async () => {
      // Conteo de startlists afectadas para informar al admin.
      const { count: linkedCount } = await supabase.from('startlist_riders')
        .select('id', { count: 'exact', head: true }).eq('globalRiderId', currentId);
      const msg = `Eliminar "${editLast.value}, ${editFirst.value}" (id ${currentId}) de la BD.\n\nAparece en ${linkedCount || 0} startlist(s). Sus filas perderán el match (snapshot del nombre se conserva).\n\n¿Continuar?`;
      if (!await confirmDialog(msg, { danger: true })) return;
      delBtn.disabled = true; delBtn.textContent = '…';
      // 1. Desligar todas las startlists.
      if (linkedCount) {
        const { error: upErr } = await supabase.from('startlist_riders')
          .update({ globalRiderId: null }).eq('globalRiderId', currentId);
        if (upErr) { delBtn.disabled = false; delBtn.textContent = 'Eliminar de BD'; showToast('Error desligando: ' + upErr.message, 'error'); return; }
      }
      // 2. DELETE.
      const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', currentId);
      if (delErr) { delBtn.disabled = false; delBtn.textContent = 'Eliminar de BD'; showToast('Error: ' + delErr.message, 'error'); return; }
      // Reflejar: la fila del editor pierde el match.
      delete riderEl.dataset.globalRiderId;
      _slRefreshRiderMatchBtn(riderEl);
      _slCloseMatchPicker();
      showToast(`Rider eliminado de BD. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
    });
  }

  if (currentLast) input.value = currentLast;
  search();
  setTimeout(() => { input.focus(); input.select(); }, 0);
  setTimeout(() => document.addEventListener('mousedown', _slOutsideMatchPickerClick, true), 0);
}

function _slRiderFlagPreview(code) {
  return code ? countryFlag(code) : '<span style="display:inline-block;width:1.2em;height:0.9em"></span>';
}

function _slTeamRowHtml({ teamName = '', teamId = null, isConfirmed = false, riders = [] } = {}) {
  const ridersHtml = riders.map(r => `
      <div class="sl-edit-rider" data-global-rider-id="${esc(r.globalRiderId || '')}" style="display:flex;align-items:center;gap:0.35rem;padding:0.15rem 0.75rem;font-size:0.82rem;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:0.35rem;flex:1;min-width:0">
          <input type="number" class="sl-dorsal" value="${r.dorsal ?? ''}" style="width:3.2rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);font-size:0.78rem;padding:0.2rem 0.3rem;text-align:right;outline:none" min="1">
          <span class="sl-flag-preview u-icon-box">${_slRiderFlagPreview(r.countryCode)}</span>
          <input type="text" class="sl-country" value="${esc(r.countryCode || '')}" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2 (2 letras)" style="width:3rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);font-size:0.72rem;padding:0.2rem 0.3rem;text-align:center;text-transform:lowercase;outline:none">
          <input type="text" class="sl-firstname u-input-sm" value="${esc(r.firstName || '')}" placeholder="Nombre">
          <input type="text" class="sl-lastname u-input-sm" value="${esc(r.lastName || '')}" placeholder="Apellido">
          <button type="button" class="sl-rider-match-btn" data-action="picker"
                  title="${r.globalRiderId ? 'Match en BD: ' + esc((r.firstName||'') + ' ' + (r.lastName||'')) + '. Click para cambiar/desligar.' : 'Buscar o forzar un match en la BD de corredores'}"
                  style="background:none;border:1px solid var(--border);border-radius:4px;padding:0.05rem 0.4rem;font-size:0.7rem;font-weight:700;cursor:pointer;flex-shrink:0;color:${r.globalRiderId ? '#22c55e' : 'var(--text-dim)'}">${r.globalRiderId ? '✓ BD' : '🔗'}</button>
          <button class="btn btn--ghost" style="padding:0.15rem 0.35rem;font-size:0.65rem;color:var(--text-dim);flex-shrink:0" onclick="this.closest('.sl-edit-rider').remove()">✕</button>
        </div>
        <div class="sl-rider-suggestion" style="display:none;width:100%;padding:0.1rem 0.75rem 0.3rem 4.2rem"></div>
      </div>`).join('');
  return `<div class="sl-edit-team" data-team-id="${teamId ? esc(teamId) : ''}" style="border:1px solid var(--border);border-radius:8px;margin-bottom:0.75rem;overflow:hidden">
      <div class="sl-edit-team-header" style="background:var(--bg-card-hover);padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <span class="sl-team-badge-slot u-shrink-0"></span>
        <input type="text" class="sl-team-name" value="${esc(teamName)}" placeholder="Nombre del equipo" style="flex:1;min-width:180px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text);font-family:var(--font-display);font-weight:700;font-size:0.82rem;padding:0.25rem 0.4rem;outline:none;transition:border-color 0.15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
        <span class="sl-team-enrich-slot" style="display:flex;align-items:center;gap:0.35rem"></span>
        <label class="sl-confirmed-cell" style="${_editingRaceProvisional ? 'display:inline-flex' : 'display:none'};align-items:center;gap:0.25rem;font-size:0.7rem;color:var(--text-dim);cursor:pointer;white-space:nowrap">
          <input type="checkbox" class="sl-is-confirmed" ${isConfirmed ? 'checked' : ''}>
          Confirmado
        </label>
        <button class="btn btn--ghost" style="padding:0.2rem 0.5rem;font-size:0.7rem;color:var(--red)" onclick="this.closest('.sl-edit-team').remove()">Eliminar equipo</button>
      </div>
      <div class="sl-edit-riders" style="padding:0.35rem 0">${ridersHtml}</div>
      <div style="padding:0.3rem 0.75rem 0.5rem">
        <button class="btn btn--ghost" style="padding:0.2rem 0.5rem;font-size:0.7rem" onclick="addRiderRow(this)">+ Corredor</button>
      </div>
    </div>`;
}

function _slUpdateRowEnrichUI(rowEl) {
  const slot = rowEl.querySelector('.sl-team-enrich-slot');
  const badgeSlot = rowEl.querySelector('.sl-team-badge-slot');
  if (!_editingRaceEnriched) {
    slot.innerHTML = '';
    badgeSlot.innerHTML = '';
    return;
  }
  const teamId = rowEl.dataset.teamId || '';
  const team = teamId ? (_teamsCache || []).find(t => t.id === teamId) : null;
  if (team) {
    badgeSlot.innerHTML = buildTeamBadgeSvg(team, { size: 28 });
    slot.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.15rem 0.45rem;border-radius:4px;font-size:0.7rem;font-family:var(--font-display);letter-spacing:0.03em;background:${esc(team.headerBg)};color:${esc(team.headerText)}">
        ${esc(team.name)}
      </span>
      <button class="btn btn--ghost sl-change-team" type="button" style="padding:0.15rem 0.4rem;font-size:0.65rem">Cambiar</button>
      <button class="btn btn--ghost sl-unassign-team" type="button" style="padding:0.15rem 0.4rem;font-size:0.65rem;color:var(--text-dim)">Quitar</button>`;
  } else {
    badgeSlot.innerHTML = '';
    slot.innerHTML = `
      <span style="font-size:0.7rem;color:var(--text-dim)">Sin equipo</span>
      <button class="btn btn--ghost sl-assign-team" type="button" style="padding:0.15rem 0.4rem;font-size:0.65rem">Asignar</button>`;
  }
}

function _slRefreshAllEnrichUI() {
  document.querySelectorAll('#startlistEditorContent .sl-edit-team').forEach(row => _slUpdateRowEnrichUI(row));
}

// ── Gate por sexo (equipo ↔ carrera) ────────────────────────────────────────
// Filtra la lista de equipos candidatos por el sexo de la carrera: excluye SOLO
// los equipos del sexo OPUESTO. Los del mismo sexo y los que aún no tienen sexo
// asignado (gender null) se mantienen. Si la carrera no tiene sexo (raceGender
// null), no se filtra nada. Esto evita que una startlist femenina se
// automatchee/asigne a un equipo masculino homónimo (y viceversa), error que
// "Women/Femmes" como stopword hace probable en findMatchingTeam.
function _teamsFilteredByGender(teams, raceGender) {
  if (!raceGender) return [...teams];
  return teams.filter(t => !t.gender || t.gender === raceGender);
}

// Devuelve { ok:true } o { ok:false, reason } si el equipo elegido es del sexo
// OPUESTO al de la carrera. Un equipo sin sexo asignado (o carrera sin sexo) se permite.
function _validateGenderMismatch(team, raceGender) {
  if (!team || !team.gender || !raceGender || team.gender === raceGender) return { ok: true };
  const label = s => (s === 'female' ? 'femenina/o' : s === 'male' ? 'masculina/o' : s);
  return {
    ok: false,
    reason: `«${team.name}» es un equipo ${label(team.gender)} y esta carrera es ${label(raceGender)}. Asigna el equipo del sexo correcto.`,
  };
}

// Sexo de la carrera del editor de inscritos en curso ('male'|'female'|null).
function _slEditingRaceGender() {
  const race = allRaces.find(r => r.id === _editingRaceId);
  return (race && race.gender) || null;
}
// Atajos ligados a la carrera en edición (editor de inscritos).
function _slGenderFilteredTeams(teams) {
  return _teamsFilteredByGender(teams, _slEditingRaceGender());
}
function _validateGenderForRace(team) {
  return _validateGenderMismatch(team, _slEditingRaceGender());
}

function _slAutoMatchAll() {
  if (!_teamsCache || _teamsCache.length === 0) return;
  const availableTeams = _slGenderFilteredTeams(_teamsCache.filter(t => !t.specialEdition));
  document.querySelectorAll('#startlistEditorContent .sl-edit-team').forEach(row => {
    if (row.dataset.teamId) return;
    const name = row.querySelector('.sl-team-name').value.trim();
    const match = findMatchingTeam(name, availableTeams);
    if (match) {
      row.dataset.teamId = match.id;
    }
  });
  _slRefreshAllEnrichUI();
}

// Valida que un equipo specialEdition sea compatible con la carrera en edición.
// Devuelve { ok:true } o { ok:false, reason } para bloquear la asignación.
// Reglas: si el specialEdition declara una carrera concreta (specialEditionRaceId),
// solo vale en esa carrera. Si declara un rango [validFrom..validTo], las fechas de
// la carrera deben caer dentro (validFrom null = sin límite inferior). Un specialEdition
// SIN vigencia declarada no se puede validar → se permite.
function _validateSpecialEditionForRace(team, race) {
  if (!team || !team.specialEdition) return { ok: true };
  if (!race) return { ok: true };

  // Patrón 1: maillot atado a UNA carrera concreta.
  if (team.specialEditionRaceId) {
    if (team.specialEditionRaceId === race.id) return { ok: true };
    const target = allRaces.find(r => r.id === team.specialEditionRaceId);
    return {
      ok: false,
      reason: `«${team.name}» es un maillot especial reservado para ${target ? `«${target.name}»` : 'otra carrera'}. No corresponde a «${race.name}».`,
    };
  }

  // Patrón 2: rango de fechas (denominación de tramo).
  const from = team.specialEditionValidFrom || null;
  const to   = team.specialEditionValidTo   || null;
  if (from || to) {
    const rStart = race.startDate || race.endDate || null;
    const rEnd   = race.endDate   || race.startDate || null;
    if (!rStart || !rEnd) return { ok: true }; // carrera sin fechas → no se puede validar
    // Solapamiento de [rStart..rEnd] con [from..to] (límites null = abiertos).
    const afterFrom = !from || rEnd >= from;
    const beforeTo  = !to   || rStart <= to;
    if (afterFrom && beforeTo) return { ok: true };
    const rango = `${from || 'inicio de temporada'} → ${to || 'sin fin'}`;
    return {
      ok: false,
      reason: `«${team.name}» es un maillot especial vigente solo en ${rango}. «${race.name}» (${rStart}) queda fuera de ese tramo.`,
    };
  }

  return { ok: true }; // sin vigencia declarada
}

function _slOpenTeamPicker(rowEl) {
  if (!_teamsCache || _teamsCache.length === 0) {
    alertDialog('No hay equipos globales. Crea equipos en la pestaña Equipos primero.');
    return;
  }
  const current = rowEl.dataset.teamId || '';
  const currentName = rowEl.querySelector('.sl-team-name').value.trim();
  // Candidatos filtrados por sexo de la carrera (excluye el sexo opuesto).
  const genderTeams = _slGenderFilteredTeams(_teamsCache);
  // Si la fila ya tenía asignado un equipo del sexo opuesto (dato heredado),
  // lo incluimos igualmente para que se vea seleccionado y se pueda corregir.
  if (current && !genderTeams.some(t => t.id === current)) {
    const cur = _teamsCache.find(t => t.id === current);
    if (cur) genderTeams.push(cur);
  }
  // La sugerencia se calcula sobre candidatos NO specialEdition (las ediciones
  // especiales nunca se automatchean).
  const suggestion = findMatchingTeam(currentName, genderTeams.filter(t => !t.specialEdition));
  const race = allRaces.find(r => r.id === _editingRaceId);
  _openTeamCombo({
    title: 'Asignar equipo',
    teams: genderTeams,
    currentId: current,
    suggestionId: suggestion?.id || '',
    validate: (team) => {
      const v = _validateSpecialEditionForRace(team, race);
      if (!v.ok) return v;
      return _validateGenderForRace(team);
    },
    onPick: (val) => { rowEl.dataset.teamId = val || ''; _slUpdateRowEnrichUI(rowEl); },
  });
}

// Estructura del editor de inscritos dentro del drawer (mismos ids).
function startlistEditorBodyHtml() {
  return `
    <div id="startlistEditorContent"></div>
    <div class="u-row" style="gap:0.75rem;margin-top:1.25rem;padding-top:0.75rem;border-top:1px solid var(--border)">
      <button class="btn btn--primary" id="saveStartlistBtn">Guardar cambios</button>
      <span class="u-fs-md u-c-dim" id="startlistSaveStatus"></span>
    </div>`;
}

// Listeners del editor de inscritos (por apertura del drawer).
function wireStartlistEditor() {
  document.getElementById('saveStartlistBtn').addEventListener('click', saveStartlistEdits);
  const content = document.getElementById('startlistEditorContent');
  content.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.sl-dorsal, .sl-firstname, .sl-lastname')) {
      e.preventDefault();
      saveStartlistEdits();
    }
  });
  // Delegado para el picker manual de match (botón ✓ BD / 🔗 en cada rider)
  content.addEventListener('click', (e) => {
    const btn = e.target.closest('.sl-rider-match-btn');
    if (!btn) return;
    const riderEl = btn.closest('.sl-edit-rider');
    if (riderEl) _slOpenRiderMatchPicker(riderEl);
  });
}

window.openStartlistEditor = async function(raceId) {
  _editingRaceId = raceId;
  const race = allRaces.find(r => r.id === raceId);
  _editingRaceEnriched = !!(race && race.enrichedStartlist);
  _editingRaceProvisional = !!(race && race.startlistProvisional);

  // El editor vive ahora en el drawer (paradigma único). Se monta su cuerpo y
  // sus listeners; el resto de la función pobla #startlistEditorContent igual.
  openDrawer({
    title: race ? `Dorsales — ${race.name}` : `Dorsales — ${raceId}`,
    level: 1,
    render: (body) => {
      body.innerHTML = startlistEditorBodyHtml();
      wireStartlistEditor();
    },
  });

  const content = document.getElementById('startlistEditorContent');
  content.innerHTML = '<div style="color:var(--text-dim)">Cargando…</div>';

  // Fetch startlist + global teams en paralelo
  const [{ data: teams }, _teams] = await Promise.all([
    supabase.from('startlist_teams').select('*').eq('raceId', raceId).order('sortOrder'),
    fetchTeams(),
  ]);
  const teamIds = (teams || []).map(t => t.id);
  // Vista resuelta: para los inscritos con globalRiderId, nombre/country vienen
  // del catálogo riders_men/women (canónico). Así el editor abre mostrando los
  // datos oficiales, no el snapshot histórico que pudo quedar desactualizado.
  const { data: riders } = teamIds.length
    ? await supabase.from('startlist_riders_resolved').select('*').in('teamId', teamIds).order('dorsal')
    : { data: [] };

  const ridersByTeam = {};
  (riders || []).forEach(r => {
    if (!ridersByTeam[r.teamId]) ridersByTeam[r.teamId] = [];
    ridersByTeam[r.teamId].push(r);
  });

  // Fase 4: no se precarga caché de matching. La resolución contra el catálogo
  // (enlazar/crear por identityKey) la hace el RPC resolve_riders al GUARDAR.

  // Toolbar con toggles (Enriquecida + Provisional)
  const toolbar = `<div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:0.75rem;padding:0.5rem 0.75rem;background:var(--bg-card-hover);border:1px solid var(--border);border-radius:8px">
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.82rem">
        <input type="checkbox" id="slEnrichedToggle" ${_editingRaceEnriched ? 'checked' : ''}>
        <span style="font-family:var(--font-display);font-weight:600;text-transform:uppercase;letter-spacing:0.03em;font-size:0.78rem">Enriquecida</span>
      </label>
      <span class="u-fs-xs u-c-dim u-grow">Asocia cada equipo a la tabla global <em>Equipos</em> para aplicar cabecera de color y chapa.</span>
      <button class="btn btn--ghost" id="slAutoMatchBtn" type="button" style="padding:0.25rem 0.6rem;font-size:0.72rem;${_editingRaceEnriched ? '' : 'display:none'}">Auto-asociar</button>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.82rem">
        <input type="checkbox" id="slProvisionalToggle" ${_editingRaceProvisional ? 'checked' : ''}>
        <span style="font-family:var(--font-display);font-weight:600;text-transform:uppercase;letter-spacing:0.03em;font-size:0.78rem">Lista provisional</span>
      </label>
      <span class="u-fs-xs u-c-dim u-grow">Sustituye la etiqueta «Inscritos» por «Lista provisional» en web e iOS/Android. Mantiene el icono.</span>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <span style="font-family:var(--font-display);font-weight:600;text-transform:uppercase;letter-spacing:0.03em;font-size:0.78rem">BD corredores</span>
      <span class="u-fs-xs u-c-dim u-grow">Al <strong>guardar</strong>, cada corredor se enlaza al catálogo por identityKey (o se crea la ficha si no existe). Botón manual «Buscar» por corredor para casos dudosos.</span>
      <button class="btn btn--ghost" id="slSyncCanonicalBtn" type="button" style="padding:0.25rem 0.6rem;font-size:0.72rem" title="Sobreescribe firstName/lastName/countryCode en startlist_riders con los valores canónicos de riders_men/women (para corredores ya enlazados). Propaga también a start_order_entries.">Re-sync canónico</button>
    </div>
  </div>`;

  let html = toolbar;
  (teams || []).forEach(team => {
    html += _slTeamRowHtml({
      teamName:    team.teamName,
      teamId:      team.teamId || null,
      isConfirmed: team.isConfirmed || false,
      riders:      ridersByTeam[team.id] || [],
    });
  });
  html += `<button class="btn btn--ghost" id="addTeamBtn" style="padding:0.35rem 0.75rem;font-size:0.75rem;margin-top:0.25rem">+ Añadir equipo</button>`;
  content.innerHTML = html;

  // Auto-match inicial de EQUIPOS si enriched está activo y hay filas sin teamId
  if (_editingRaceEnriched) _slAutoMatchAll();
  _slRefreshAllEnrichUI();

  // Listeners toolbar
  document.getElementById('slEnrichedToggle').addEventListener('change', (e) => {
    _editingRaceEnriched = e.target.checked;
    document.getElementById('slAutoMatchBtn').style.display = _editingRaceEnriched ? '' : 'none';
    if (_editingRaceEnriched) _slAutoMatchAll();
    _slRefreshAllEnrichUI();
  });
  document.getElementById('slAutoMatchBtn').addEventListener('click', () => {
    _slAutoMatchAll();
    showToast('Auto-asociación aplicada', 'success');
  });
  document.getElementById('slSyncCanonicalBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'Sincronizando…';
    try {
      const { data, error } = await supabase
        .rpc('sync_startlist_riders_to_canonical', { p_race_id: raceId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const slUpd  = row?.updated_startlist_riders    ?? 0;
      const soeUpd = row?.updated_start_order_entries ?? 0;
      if (!slUpd && !soeUpd) {
        showToast('Ya estaba en sync con la BD canónica', 'success');
      } else {
        showToast(`${slUpd} inscritos · ${soeUpd} entradas de orden de salida actualizadas`, 'success');
        // Recargar el editor para reflejar los nombres canónicos en la UI.
        openStartlistEditor(raceId);
      }
    } catch (err) {
      console.error('[sync canonical]', err);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btn.textContent = prevText;
      btn.disabled = false;
    }
  });
  document.getElementById('slProvisionalToggle').addEventListener('change', (e) => {
    _editingRaceProvisional = e.target.checked;
    document.querySelectorAll('#startlistEditorContent .sl-confirmed-cell').forEach(el => {
      el.style.display = _editingRaceProvisional ? 'inline-flex' : 'none';
    });
  });

  // Delegación para asignar/cambiar/quitar + re-match al editar nombre
  content.addEventListener('click', (ev) => {
    const row = ev.target.closest('.sl-edit-team');
    if (!row) return;
    if (ev.target.closest('.sl-assign-team') || ev.target.closest('.sl-change-team')) {
      _slOpenTeamPicker(row);
    } else if (ev.target.closest('.sl-unassign-team')) {
      row.dataset.teamId = '';
      _slUpdateRowEnrichUI(row);
    }
  });
  content.addEventListener('input', (ev) => {
    if (ev.target.matches('.sl-country')) {
      const code = ev.target.value.trim().toLowerCase();
      const preview = ev.target.parentElement.querySelector('.sl-flag-preview');
      if (preview) preview.innerHTML = _slRiderFlagPreview(code);
      return;
    }
    // Al editar nombre/apellido a mano, se invalida el enlace previo (ya no
    // corresponde). La resolución se rehace al guardar vía RPC. (El matching
    // automático as-you-type se eliminó en la Fase 4.)
    if (ev.target.matches('.sl-firstname') || ev.target.matches('.sl-lastname')) {
      const riderEl = ev.target.closest('.sl-edit-rider');
      if (!riderEl) return;
      delete riderEl.dataset.globalRiderId;
      const badge = riderEl.querySelector('.sl-rider-matched');
      if (badge) badge.style.display = 'none';
      _slRefreshRiderMatchBtn(riderEl);
      return;
    }
    if (!ev.target.matches('.sl-team-name')) return;
    if (!_editingRaceEnriched) return;
    const row = ev.target.closest('.sl-edit-team');
    if (row.dataset.teamId) return; // no pisar asignación manual
    const availableTeams = _slGenderFilteredTeams(_teamsCache.filter(t => !t.specialEdition));
    const match = findMatchingTeam(ev.target.value.trim(), availableTeams);
    if (match) {
      row.dataset.teamId = match.id;
      _slUpdateRowEnrichUI(row);
    }
  });

  document.getElementById('addTeamBtn').addEventListener('click', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = _slTeamRowHtml({ teamName: '', teamId: null, riders: [] });
    const teamDiv = wrapper.firstElementChild;
    content.insertBefore(teamDiv, document.getElementById('addTeamBtn'));
    _slUpdateRowEnrichUI(teamDiv);
  });

  editor.scrollIntoView({ behavior: 'smooth' });
};

window.addRiderRow = function(btn) {
  const ridersDiv = btn.closest('.sl-edit-team').querySelector('.sl-edit-riders');
  const row = document.createElement('div');
  row.className = 'sl-edit-rider';
  row.style = 'display:flex;align-items:center;gap:0.35rem;padding:0.15rem 0.75rem;font-size:0.82rem;flex-wrap:wrap';
  row.innerHTML = `<div style="display:flex;align-items:center;gap:0.35rem;flex:1;min-width:0">
    <input type="number" class="sl-dorsal" value="" placeholder="0" style="width:3.2rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);font-size:0.78rem;padding:0.2rem 0.3rem;text-align:right;outline:none" min="1">
    <span class="sl-flag-preview u-icon-box"><span style="display:inline-block;width:1.2em;height:0.9em"></span></span>
    <input type="text" class="sl-country" value="" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2 (2 letras)" style="width:3rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);font-size:0.72rem;padding:0.2rem 0.3rem;text-align:center;text-transform:lowercase;outline:none">
    <input type="text" class="sl-firstname u-input-sm" value="" placeholder="Nombre">
    <input type="text" class="sl-lastname u-input-sm" value="" placeholder="Apellido">
    <span class="sl-rider-matched" style="display:none;font-size:0.65rem;color:#22c55e;font-weight:700;flex-shrink:0">✓</span>
    <button class="btn btn--ghost" style="padding:0.15rem 0.35rem;font-size:0.65rem;color:var(--text-dim);flex-shrink:0" onclick="this.closest('.sl-edit-rider').remove()">✕</button>
  </div>
  <div class="sl-rider-suggestion" style="display:none;width:100%;padding:0.1rem 0.75rem 0.3rem 4.2rem"></div>`;
  ridersDiv.appendChild(row);
};

function closeStartlistEditor() {
  _editingRaceId = null;
  _editingRaceEnriched = false;
  _editingRaceProvisional = false;
  closeDrawer(1);
}

async function saveStartlistEdits() {
  if (!_editingRaceId) return;
  const raceId = _editingRaceId;
  const status = document.getElementById('startlistSaveStatus');
  status.textContent = 'Guardando…';

  const teamEls = document.querySelectorAll('#startlistEditorContent .sl-edit-team');
  const teamsData = [];
  teamEls.forEach((el) => {
    const name = el.querySelector('.sl-team-name').value.trim();
    if (!name) return;
    const teamIdRef = el.dataset.teamId || null;
    const isConfirmed = el.querySelector('.sl-is-confirmed')?.checked || false;
    const riders = [];
    el.querySelectorAll('.sl-edit-rider').forEach(rEl => {
      const dorsal = parseInt(rEl.querySelector('.sl-dorsal').value) || 0;
      const firstName = rEl.querySelector('.sl-firstname').value.trim();
      const lastName = rEl.querySelector('.sl-lastname').value.trim();
      const rawCountry = (rEl.querySelector('.sl-country')?.value || '').trim().toLowerCase();
      const countryCode = /^[a-z]{2}(-[a-z0-9]{2,4})?$/.test(rawCountry) ? rawCountry : null;
      const globalRiderId = rEl.dataset.globalRiderId || null;
      if (firstName || lastName) riders.push({ dorsal, firstName, lastName, countryCode, globalRiderId });
    });
    teamsData.push({ name, riders, teamIdRef, isConfirmed });
  });

  // Sort teams by the lowest dorsal of their riders
  teamsData.sort((a, b) => {
    const minA = Math.min(...a.riders.map(r => r.dorsal || Infinity));
    const minB = Math.min(...b.riders.map(r => r.dorsal || Infinity));
    return minA - minB;
  });
  teamsData.forEach((t, i) => t.sortOrder = i);

  // ── Fase 4: resolución de la startlist contra el catálogo vía RPC ──
  // El RPC resolve_riders resuelve TODA la startlist por identityKey (token-set del
  // nombre plegado, invariante al orden apellido/nombre — mata la causa raíz del
  // matcher antiguo) en un solo round-trip, y CREA las fichas faltantes
  // (verified=false, source='startlist_resolve'; el identityKey lo pone el trigger).
  // Cada fila sin globalRiderId queda enlazada a una ficha (existente o nueva).
  const race = allRaces.find(r => r.id === raceId);
  const raceGender = race?.gender;
  const pGender = raceGender === 'female' ? 'female' : raceGender === 'male' ? 'male' : null;
  let autoMatchedCount = 0;
  let autoCreatedCount = 0;
  let canonicalSyncedCount = 0;
  if (pGender) {
    try {
      // Filas sin link, con nombre+apellido. Indexamos por (teamIdx, riderIdx) para
      // aplicar el resultado del RPC de vuelta a cada rider.
      const pRows = [];
      const rowRefs = [];
      for (const t of teamsData) {
        for (const r of t.riders) {
          if (r.globalRiderId || !r.firstName || !r.lastName) continue;
          const idx = pRows.length;
          pRows.push({ idx, firstName: r.firstName, lastName: r.lastName, countryCode: r.countryCode || null });
          rowRefs.push(r);
        }
      }

      if (pRows.length) {
        const { data: resolved, error: resErr } = await supabase
          .rpc('resolve_riders', { p_gender: pGender, p_rows: pRows });
        if (resErr) throw resErr;
        for (const res of (resolved || [])) {
          const r = rowRefs[res.idx];
          if (r && res.matched_id) {
            r.globalRiderId = res.matched_id;
            if (res.created) autoCreatedCount++; else autoMatchedCount++;
          }
        }
      }

      // Sincronizar el snapshot (nombre/apellido/nacionalidad) de TODOS los riders
      // linkados con su ficha canónica, para que el INSERT a startlist_riders quede
      // consistente con riders_*. Una sola lectura de los ids implicados.
      const linkedIds = [...new Set(teamsData.flatMap(t => t.riders.map(r => r.globalRiderId).filter(Boolean)))];
      if (linkedIds.length) {
        const ridersTable = pGender === 'female' ? 'riders_women' : 'riders_men';
        const { data: canonRows } = await supabase
          .from(ridersTable).select('id,firstName,lastName,nationality').in('id', linkedIds);
        const canonById = new Map((canonRows || []).map(c => [c.id, c]));
        for (const t of teamsData) {
          for (const r of t.riders) {
            const canon = r.globalRiderId ? canonById.get(r.globalRiderId) : null;
            if (!canon) continue;
            let touched = false;
            if (canon.firstName && r.firstName !== canon.firstName) { r.firstName = canon.firstName; touched = true; }
            if (canon.lastName  && r.lastName  !== canon.lastName)  { r.lastName  = canon.lastName;  touched = true; }
            if (canon.nationality && !r.countryCode) { r.countryCode = canon.nationality; touched = true; }
            if (touched) canonicalSyncedCount++;
          }
        }
      }
    } catch (err) {
      console.warn('[saveStartlistEdits] resolución RPC fallida', err);
    }
  }

  try {
    const { error: delR } = await supabase.from('startlist_riders').delete().eq('raceId', raceId);
    if (delR) throw new Error('Error borrando corredores: ' + delR.message);
    const { error: delT } = await supabase.from('startlist_teams').delete().eq('raceId', raceId);
    if (delT) throw new Error('Error borrando equipos: ' + delT.message);

    const ts = Date.now();
    const teamRows = [];
    const riderRows = [];
    for (let i = 0; i < teamsData.length; i++) {
      const t = teamsData[i];
      const teamId = `sl_${raceId}_${ts}_${i}`;
      teamRows.push({
        id: teamId, raceId, teamName: t.name, sortOrder: t.sortOrder,
        teamId: _editingRaceEnriched ? (t.teamIdRef || null) : null,
        isConfirmed: t.isConfirmed || false,
      });
      t.riders.forEach((r, j) => {
        riderRows.push({
          id: `${teamId}_${j}`, teamId, raceId,
          dorsal: r.dorsal, firstName: r.firstName, lastName: r.lastName,
          countryCode: r.countryCode || null,
          globalRiderId: r.globalRiderId || null,
        });
      });
    }

    // Insert teams in chunks of 50
    for (let c = 0; c < teamRows.length; c += 50) {
      const { error: tErr } = await supabase.from('startlist_teams').insert(teamRows.slice(c, c + 50));
      if (tErr) throw new Error(`Error insertando equipos (lote ${c}): ${tErr.message}`);
    }

    // Insert riders in chunks of 50
    for (let c = 0; c < riderRows.length; c += 50) {
      const { error: rErr } = await supabase.from('startlist_riders').insert(riderRows.slice(c, c + 50));
      if (rErr) throw new Error(`Error insertando corredores (lote ${c}): ${rErr.message}`);
    }

    const importedAt = new Date().toISOString();
    await supabase.from('races').update({
      startlistImportedAt: importedAt,
      enrichedStartlist: _editingRaceEnriched,
      startlistProvisional: _editingRaceProvisional,
    }).eq('id', raceId);
    const race = allRaces.find(r => r.id === raceId);
    if (race) {
      race.startlistImportedAt = importedAt;
      race.enrichedStartlist = _editingRaceEnriched;
      race.startlistProvisional = _editingRaceProvisional;
    }

    const matchInfo = (autoMatchedCount || autoCreatedCount || canonicalSyncedCount)
      ? ` · auto-match: ${autoMatchedCount} · auto-creados en BD: ${autoCreatedCount} · sync canónico: ${canonicalSyncedCount}`
      : '';
    status.textContent = `Guardado: ${teamRows.length} equipos, ${riderRows.length} corredores${matchInfo}.`;
    showToast(autoCreatedCount
      ? `Inscritos actualizados (${autoCreatedCount} corredores nuevos en BD pendientes de verificar)`
      : 'Inscritos actualizados', 'success');
    loadExistingStartlists();
  } catch (err) {
    console.error('[startlist save]', err);
    status.textContent = 'Error: ' + err.message;
  }
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE EQUIPOS (teams)
// ═════════════════════════════════════════════════════════════════

let _teamsCache = null;      // todos los equipos (ordenados por nombre)
let _editingTeamId = null;   // null = creando nuevo
let _teamsViewReady = false;
let _teamColorsExplicitlySet = false; // false = colores no tocados → guardar null
// Alta desde «+ Equipo <MARKET_SEASON>»: el equipo NACE en la temporada del
// mercado → al insertarlo en `teams` se le fija firstSeason para que el trigger
// sync_team_to_season NO le estampe una temporada del año en curso (mig. 129).
// Se resetea en cada openTeamEditor y se consume en el INSERT de saveTeam.
let _newTeamMarketBorn = false;

const DEFAULT_TEAM = {
  headerBg:          '#1f2937',
  headerText:        '#ffffff',
  badgeTorsoCenter:  '#ffffff',
  badgeTorsoSides:   '#111111',
  badgeInnerCircle:  null,
  badgeShorts:       '#111111',
};

async function fetchTeams({ force = false } = {}) {
  if (_teamsCache && !force) return _teamsCache;
  const { data, error } = await supabase
    .from('teams').select('*').order('name', { ascending: true });
  if (error) { console.error('[teams] fetch', error); return []; }
  _teamsCache = data || [];
  return _teamsCache;
}

function _populateParentTeamSelect(selectedId) {
  const sel = document.getElementById('te-parentTeamId');
  const baseTeams = (_teamsCache || [])
    .filter(t => !t.specialEdition)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">— Sin vincular —</option>' +
    baseTeams.map(t =>
      `<option value="${esc(t.id)}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`
    ).join('');
}

// Pobla el selector de carrera del bloque de vigencia del maillot especial.
// `query` filtra por nombre; `selectedId` preselecciona (se conserva aunque no
// coincida con el filtro, para no perder el valor guardado al teclear).
function _populateSpecialRaceSelect(selectedId, query = '') {
  const sel = document.getElementById('te-seRaceId');
  if (!sel) return;
  const q = (query || '').trim().toLowerCase();
  const sorted = [...allRaces].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const matches = sorted.filter(r =>
    !q || (r.name || '').toLowerCase().includes(q) || r.id === selectedId
  );
  sel.innerHTML = '<option value="">— Ninguna —</option>' +
    matches.map(r =>
      `<option value="${esc(r.id)}"${r.id === selectedId ? ' selected' : ''}>${r.hideFlag ? '' : countryFlag(r.countryCode)} ${esc(r.name)}${r.year ? ` (${r.year})` : ''}</option>`
    ).join('');
  sel.value = selectedId || '';
}

async function setupTeamsView() {
  if (!_teamsViewReady) {
    _teamsViewReady = true;
    // Enlazar listeners de forma resiliente: si un nodo falta (p. ej. HTML
    // de app.html cacheado por el navegador y desfasado respecto a panel.js),
    // un único elemento ausente NO debe abortar todo setupTeamsView y dejar la
    // lista de equipos sin cargar. Avisamos por consola y seguimos.
    const bind = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
      else console.warn(`[setupTeamsView] #${id} no existe en el DOM — listener omitido (¿app.html cacheado?)`);
    };
    bind('addTeamPanelBtn', 'click', () => openTeamEditor(null));
    bind('teamsSearch', 'input', () => renderTeamsList());
    // Los listeners del editor de equipo (form, colores, specialEdition,
    // categoría→género, editTeamColorsBtn, roster) se cablean por apertura en
    // wireTeamEditor() — el editor se renderiza en el drawer.

    // Detector de duplicados del catálogo de corredores. Antes vivía en la zona
    // Corredores (eliminada); ahora se dispara desde Equipos y se renderiza en
    // el drawer (cierre por ✕; toggle masc/fem cableado por apertura en
    // wireDupScan()).
    bind('dupScanBtn', 'click', openDuplicateScanner);
  }
  await fetchTeams({ force: true });
  renderTeamsList();
}

const TEAM_CATEGORIES = [
  { key: 'WT',    label: 'WorldTour Masculino',      gender: 'male'   },
  { key: 'WWT',   label: 'WorldTour Femenino',       gender: 'female' },
  { key: 'PT',    label: 'ProTeam Masculino',         gender: 'male'   },
  { key: 'PRW',   label: 'ProTeam Femenino',          gender: 'female' },
  { key: 'CT',    label: 'Continental Masculino',     gender: 'male'   },
  { key: 'CTW',   label: 'Continental Femenino',      gender: 'female' },
  { key: 'NTM',   label: 'Selecciones Masculino',     gender: 'male'   },
  { key: 'NTW',   label: 'Selecciones Femenino',      gender: 'female' },
  { key: 'CLUBM', label: 'Club Masculino',            gender: 'male'   },
  { key: 'CLUBW', label: 'Club Femenino',             gender: 'female' },
];

// Categoría de equipos seleccionada en la cuadrícula (null = mostrar cuadrícula).
// Claves: las de TEAM_CATEGORIES, más '__none__' (sin categoría) y '__orphan__'
// (ediciones especiales sin vincular).
let _teamsCatSelected = null;

function renderTeamsList() {
  const container = document.getElementById('teamsList');
  const q = (document.getElementById('teamsSearch').value || '').toLowerCase().trim();
  const allTeams = _teamsCache || [];
  const filtered = allTeams.filter(t =>
    !q || (t.name || '').toLowerCase().includes(q) || ((t.nameAliases || '').toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="u-fs-085 u-c-dim">
      ${allTeams.length === 0 ? 'No hay equipos todavía. Crea el primero con “+ Nuevo equipo”.' : 'Sin resultados.'}
    </div>`;
    return;
  }

  const total = allTeams.length;

  // Mapa: parentTeamId → ediciones especiales (del cache completo, para que siempre
  // aparezcan bajo su padre aunque no coincidan con la búsqueda)
  const specialsByParent = {};
  for (const s of allTeams.filter(t => t.specialEdition && t.parentTeamId)) {
    if (!specialsByParent[s.parentTeamId]) specialsByParent[s.parentTeamId] = [];
    specialsByParent[s.parentTeamId].push(s);
  }

  // Equipos base (no edición especial) que pasan el filtro
  const regular = filtered.filter(t => !t.specialEdition);
  const regularIds = new Set(regular.map(t => t.id));

  // Ediciones especiales huérfanas: sin padre, o cuyo padre no está en la lista filtrada
  const orphanSpecials = filtered.filter(t =>
    t.specialEdition && (!t.parentTeamId || !regularIds.has(t.parentTeamId))
  );

  const renderSpecialRow = (t) => `
    <div style="margin-left:1.25rem;display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.6rem;background:var(--bg-card);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;cursor:pointer" data-team-id="${esc(t.id)}">
      <span class="u-shrink-0">${buildTeamBadgeSvg(t, { size: 16 })}</span>
      <span style="flex:1;font-size:0.8rem">${esc(t.name)}</span>
      <span style="font-size:0.68rem;color:var(--text-dim);white-space:nowrap">Edición especial</span>
      <button class="btn btn--ghost" data-edit-team-id="${esc(t.id)}" style="padding:0.15rem 0.4rem;font-size:0.7rem;flex-shrink:0">Editar</button>
    </div>`;

  const renderTeamRow = (t) => {
    const children = specialsByParent[t.id] || [];
    const childrenHtml = children.length
      ? `<div style="display:flex;flex-direction:column;gap:0.15rem;margin-top:0.15rem">${children.map(renderSpecialRow).join('')}</div>`
      : '';
    return `
      <div>
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer" data-team-id="${esc(t.id)}">
          <span class="u-shrink-0">${buildTeamBadgeSvg(t, { size: 20 })}</span>
          <span style="flex:1;font-size:0.85rem"><strong>${esc(t.name)}</strong></span>
          <button class="btn btn--ghost" data-edit-team-id="${esc(t.id)}" style="padding:0.2rem 0.5rem;font-size:0.72rem;flex-shrink:0">Editar</button>
        </div>
        ${childrenHtml}
      </div>`;
  };

  // Agrupar equipos base por categoría
  const byCategory = {};
  const uncategorized = [];
  for (const t of regular) {
    if (t.category) {
      if (!byCategory[t.category]) byCategory[t.category] = [];
      byCategory[t.category].push(t);
    } else {
      uncategorized.push(t);
    }
  }

  // Definición ordenada de las categorías que existen (con su listado).
  const sections = [];
  for (const { key, label } of TEAM_CATEGORIES) {
    if (byCategory[key]?.length) sections.push({ key, label, items: byCategory[key], special: false });
  }
  if (uncategorized.length) sections.push({ key: '__none__', label: 'Sin categoría', items: uncategorized, special: false });
  if (orphanSpecials.length) sections.push({ key: '__orphan__', label: 'Ediciones especiales sin vincular', items: orphanSpecials, special: true });

  const wireRows = () => {
    container.querySelectorAll('[data-team-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openTeamEditor(el.dataset.teamId);
      });
    });
    container.querySelectorAll('[data-edit-team-id]').forEach(btn => {
      btn.addEventListener('click', () => openTeamEditor(btn.dataset.editTeamId));
    });
  };

  // ── Búsqueda activa → listado plano (sin cuadrícula) ─────────────
  if (q) {
    let html = `<div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.5rem">${filtered.length} de ${total} equipos</div>`;
    const flatRegular = [...regular].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    html += `<div class="u-stack u-stack--xs">${flatRegular.map(renderTeamRow).join('')}</div>`;
    if (orphanSpecials.length) {
      const flatOrphans = [...orphanSpecials].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      html += `<div class="u-stack u-stack--xs" style="margin-top:0.5rem">${flatOrphans.map(renderSpecialRow).join('')}</div>`;
    }
    container.innerHTML = html;
    wireRows();
    return;
  }

  // Si la categoría seleccionada ya no existe, volver a la cuadrícula.
  if (_teamsCatSelected && !sections.some(s => s.key === _teamsCatSelected)) _teamsCatSelected = null;

  // ── Vista cuadrícula (ninguna categoría seleccionada) ────────────
  if (!_teamsCatSelected) {
    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    sections.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-grid__btn';
      btn.innerHTML = `<span class="cat-grid__label">${esc(s.label)}</span><span class="cat-grid__count">${s.items.length}</span>`;
      btn.addEventListener('click', () => { _teamsCatSelected = s.key; renderTeamsList(); });
      grid.appendChild(btn);
    });
    container.innerHTML = '';
    container.appendChild(grid);
    return;
  }

  // ── Vista de una categoría: listado alfabético ───────────────────
  const section = sections.find(s => s.key === _teamsCatSelected);
  const sorted = [...section.items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const rowFn = section.special ? renderSpecialRow : renderTeamRow;
  container.innerHTML = `
    <div class="cat-back">
      <button type="button" class="cat-back__btn">← Categorías</button>
      <div class="cat-back__title">${esc(section.label)} <span class="u-o60">(${section.items.length})</span></div>
    </div>
    <div class="u-stack u-stack--xs">${sorted.map(rowFn).join('')}</div>`;
  container.querySelector('.cat-back__btn').addEventListener('click', () => { _teamsCatSelected = null; renderTeamsList(); });
  wireRows();
}

function setColorPair(key, value) {
  const color = document.getElementById(`te-${key}-color`);
  const text  = document.getElementById(`te-${key}-text`);
  const hex = (value || '').toLowerCase();
  const safe = /^#[0-9a-f]{6}$/.test(hex) ? hex : '#000000';
  color.value = safe;
  text.value = safe.toUpperCase();
}

function getColorPair(key) {
  const text = document.getElementById(`te-${key}-text`).value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return document.getElementById(`te-${key}-color`).value.toLowerCase();
}

function readTeamFromForm() {
  const inner = (_teamColorsExplicitlySet && document.getElementById('te-innerCircle-enabled').checked)
    ? getColorPair('innerCircle') : null;
  return {
    name:             document.getElementById('te-name').value.trim(),
    nameAliases:      document.getElementById('te-aliases').value.split('\n').map(s => s.trim()).filter(Boolean).join('\n') || null,
    headerBg:         _teamColorsExplicitlySet ? getColorPair('headerBg')         : DEFAULT_TEAM.headerBg,
    headerText:       _teamColorsExplicitlySet ? getColorPair('headerText')        : DEFAULT_TEAM.headerText,
    badgeTorsoCenter: _teamColorsExplicitlySet ? getColorPair('torsoCenter')       : DEFAULT_TEAM.badgeTorsoCenter,
    badgeTorsoSides:  _teamColorsExplicitlySet ? getColorPair('torsoSides')        : DEFAULT_TEAM.badgeTorsoSides,
    badgeInnerCircle: inner,
    badgeShorts:      _teamColorsExplicitlySet ? getColorPair('shorts')            : DEFAULT_TEAM.badgeShorts,
    specialEdition:   document.getElementById('te-specialEdition').checked,
    parentTeamId:     document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-parentTeamId').value || null)
                        : null,
    // Vigencia del maillot especial (solo si specialEdition). Rango O carrera.
    specialEditionValidFrom: document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seValidFrom').value || null) : null,
    specialEditionValidTo:   document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seValidTo').value || null) : null,
    specialEditionRaceId:    document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seRaceId').value || null) : null,
    category:         document.getElementById('te-category').value || null,
    gender:           document.getElementById('te-gender').value || null,
    countryCode:      (document.getElementById('te-countryCode').value || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || null,
  };
}

// Bandera SVG (flag-icons), igual que el resto de la web (countryFlag → <img>).
// Reutiliza _slRiderFlagPreview para que tenga el mismo tamaño y placeholder que
// la bandera de nacionalidad del corredor.
function refreshTeamCountryFlag() {
  const cc = (document.getElementById('te-countryCode').value || '').trim().toLowerCase();
  document.getElementById('te-countryFlag').innerHTML = _slRiderFlagPreview(cc);
}

function refreshTeamPreview() {
  const t = readTeamFromForm();
  document.getElementById('teamEditorBadgePreview').innerHTML = buildTeamBadgeSvg(t, { size: 120 });
  const hdr = document.getElementById('teamEditorHeaderPreview');
  hdr.style.background = t.headerBg;
  hdr.style.color = t.headerText;
  hdr.textContent = t.name || 'Cabecera';
}

function duplicateTeam() {
  const t = readTeamFromForm();
  _editingTeamId = null;
  const drawerTitle = document.getElementById('ccDrawer1Title');
  if (drawerTitle) drawerTitle.textContent = 'Nuevo equipo';
  document.getElementById('deleteTeamBtn').style.display = 'none';
  document.getElementById('duplicateTeamBtn').style.display = 'none';
  document.getElementById('te-name').value = '';
  document.getElementById('te-aliases').value = '';
  document.getElementById('teamSaveStatus').textContent = 'Copia lista. Pon nombre y guarda.';
  // Colors and badge are already in the form — just refresh preview with empty name
  refreshTeamPreview();
}

// HTML del editor de equipo dentro del drawer (mismos ids; sin botón Cerrar
// propio — el drawer trae su ✕; sin span de título — va al header del drawer).
function teamEditorBodyHtml() {
  return `
    <div style="display:grid;grid-template-columns:1fr 140px;gap:1.25rem;align-items:start">
      <div class="u-stack">
        <div class="field">
          <label>Nombre</label>
          <input type="text" id="te-name" placeholder="Nombre oficial del equipo" class="u-w-full">
        </div>
        <div class="field">
          <label>Alias (uno por línea) <span class="u-dim">— para matching</span></label>
          <textarea id="te-aliases" rows="3" placeholder="Alias 1&#10;Alias 2" class="u-w-full" style="font-family:var(--font-body);font-size:0.82rem"></textarea>
        </div>
        <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
          <input type="checkbox" id="te-specialEdition">
          <span>Edición especial (Grandes Vueltas)</span>
        </label>
        <div id="te-parentTeam-row" class="field" style="display:none;margin-top:0.1rem">
          <label>Equipo base <span class="u-dim">— al que pertenece esta edición especial</span></label>
          <select id="te-parentTeamId" class="u-w-full">
            <option value="">— Sin vincular —</option>
          </select>
        </div>
        <div id="te-specialValidity-row" style="display:none;margin-top:0.1rem;padding:0.6rem 0.7rem;border:1px dashed var(--border);border-radius:6px;flex-direction:column;gap:0.6rem">
          <div style="font-size:0.78rem;color:var(--text-dim)">
            Vigencia del maillot especial — usa <strong>un rango de fechas</strong> (denominación de tramo, p. ej. hasta abril)
            <strong>o</strong> una <strong>carrera concreta</strong> (maillot de una sola prueba). No ambos.
          </div>
          <div class="field-row field-row--2">
            <div class="field">
              <label>Vigente desde <span class="u-dim">— vacío = inicio de temporada</span></label>
              <input type="date" id="te-seValidFrom" class="u-w-full">
            </div>
            <div class="field">
              <label>Vigente hasta</label>
              <input type="date" id="te-seValidTo" class="u-w-full">
            </div>
          </div>
          <div class="field">
            <label>O carrera concreta</label>
            <input type="text" id="te-seRaceSearch" placeholder="Filtrar carreras…" autocomplete="off" class="u-w-full" style="margin-bottom:0.35rem">
            <select id="te-seRaceId" class="u-w-full">
              <option value="">— Ninguna —</option>
            </select>
          </div>
        </div>
        <div class="field-row field-row--3">
          <div class="field">
            <label>Categoría UCI</label>
            <select id="te-category" class="u-w-full">
              <option value="">— Sin categoría —</option>
              <optgroup label="Masculino">
                <option value="WT">WT — WorldTour</option>
                <option value="PT">PT — ProTeam</option>
                <option value="CT">CT — Continental</option>
                <option value="NTM">NTM — Selección nac.</option>
                <option value="CLUBM">CLUBM — Club</option>
              </optgroup>
              <optgroup label="Femenino">
                <option value="WWT">WWT — WorldTour</option>
                <option value="PRW">PRW — ProTeam</option>
                <option value="CTW">CTW — Continental</option>
                <option value="NTW">NTW — Selección nac.</option>
                <option value="CLUBW">CLUBW — Club</option>
              </optgroup>
            </select>
          </div>
          <div class="field">
            <label>Género</label>
            <select id="te-gender" class="u-w-full">
              <option value="">— Sin especificar —</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </select>
          </div>
          <div class="field">
            <label>País <span class="u-dim">— ISO 2</span></label>
            <div class="u-row u-row--gap-sm">
              <span class="u-icon-box" id="te-countryFlag" title="Bandera"></span>
              <input type="text" id="te-countryCode" placeholder="es" maxlength="2" autocapitalize="off" autocomplete="off" spellcheck="false" style="flex:1;text-transform:lowercase">
            </div>
          </div>
        </div>
        <div id="te-colors">
        <div class="field-row field-row--2">
          <div class="field">
            <label>Fondo cabecera</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-headerBg-color">
              <input class="u-grow" type="text" id="te-headerBg-text" value="#1f2937">
            </div>
          </div>
          <div class="field">
            <label>Texto cabecera</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-headerText-color">
              <input class="u-grow" type="text" id="te-headerText-text" value="#ffffff">
            </div>
          </div>
        </div>
        <div class="field-row field-row--2">
          <div class="field">
            <label>Chapa — central torso</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-torsoCenter-color">
              <input class="u-grow" type="text" id="te-torsoCenter-text" value="#ffffff">
            </div>
          </div>
          <div class="field">
            <label>Chapa — laterales</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-torsoSides-color">
              <input class="u-grow" type="text" id="te-torsoSides-text" value="#111111">
            </div>
          </div>
        </div>
        <div class="field-row field-row--2">
          <div class="field">
            <label>
              Chapa — círculo interior
              <label style="display:inline-flex;align-items:center;gap:0.3rem;font-weight:400;margin-left:0.5rem">
                <input type="checkbox" id="te-innerCircle-enabled">
                <span class="u-fs-sm u-c-dim">activar</span>
              </label>
            </label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-innerCircle-color">
              <input class="u-grow" type="text" id="te-innerCircle-text" value="#ffd700">
            </div>
          </div>
          <div class="field">
            <label>Chapa — culotte</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-shorts-color">
              <input class="u-grow" type="text" id="te-shorts-text" value="#111111">
            </div>
          </div>
        </div>
        </div><!-- /te-colors -->
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;align-items:center;position:sticky;top:1rem">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-dim)">Vista previa</div>
        <div id="teamEditorBadgePreview" style="display:flex;align-items:center;justify-content:center;width:120px;height:120px"></div>
        <div id="teamEditorHeaderPreview" style="width:100%;text-align:center;padding:0.5rem 0.6rem;border-radius:6px;font-family:var(--font-display);font-weight:700;font-size:0.82rem;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Cabecera</div>
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn--primary" id="saveTeamBtn">Guardar</button>
      <button class="btn btn--ghost" id="duplicateTeamBtn" style="display:none">Duplicar</button>
      <button class="btn btn--ghost" id="deleteTeamBtn" style="color:var(--red);display:none">Eliminar</button>
      <span class="u-fs-md u-c-dim" id="teamSaveStatus"></span>
    </div>
    <div id="teamRosterPanel" style="display:none;flex-direction:column;gap:0.75rem;margin-top:0.5rem;padding-top:1rem;border-top:1px solid var(--border)">
      <div class="u-row" style="gap:0.75rem;flex-wrap:wrap">
        <div style="font-family:var(--font-display);font-weight:600;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text)">
          Plantilla <span id="teamRosterYear"></span>
        </div>
        <span class="u-fs-sm u-c-dim" id="teamRosterCount"></span>
        <div class="u-grow"></div>
        <button class="btn btn--primary" id="rosterNewRiderBtn" style="padding:0.3rem 0.7rem;font-size:0.76rem;white-space:nowrap">+ Nuevo corredor</button>
      </div>
      <div id="rosterAddBox" style="display:flex;flex-direction:column;gap:0.4rem;padding:0.6rem 0.7rem;border:1px dashed var(--border);border-radius:6px">
        <div class="u-row" style="gap:0.5rem;flex-wrap:wrap">
          <label style="font-size:0.76rem;color:var(--text-dim);white-space:nowrap">Añadir corredor existente:</label>
          <input type="search" id="rosterAddSearch" placeholder="Buscar por nombre o apellido…" autocomplete="off" style="flex:1;min-width:160px;padding:0.35rem 0.6rem;font-size:0.8rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)">
          ${genderToggleHtml({ idMale: 'rosterAddGenderMale', idFemale: 'rosterAddGenderFemale', wrapId: 'rosterAddGenderToggle', wrapStyle: 'display:none;gap:0.2rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:2px' })}
        </div>
        <div id="rosterAddResults" style="display:none;flex-direction:column;gap:0.2rem;max-height:240px;overflow-y:auto"></div>
      </div>
      <div id="teamRosterList" style="display:flex;flex-direction:column;gap:0.3rem">
        <div class="u-fs-085 u-c-dim">Cargando…</div>
      </div>
    </div>
    <div id="teamSeason27Panel" style="display:none;flex-direction:column;gap:0.75rem;margin-top:0.5rem;padding-top:1rem;border-top:1px solid var(--border)">
      <div class="u-row" style="gap:0.75rem;flex-wrap:wrap">
        <div style="font-family:var(--font-display);font-weight:600;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text)">
          Temporada 2027
        </div>
        <span class="u-fs-sm u-c-dim">identidad del equipo en el mercado de fichajes (team_seasons)</span>
      </div>
      <div class="field-row field-row--2">
        <div class="field">
          <label>Nombre 2027 <span class="u-dim">— el que se muestra en Fichajes</span></label>
          <input type="text" id="ts27-name" class="u-w-full">
        </div>
        <div class="field">
          <label>Categoría 2027 <span class="u-dim">— ascensos/descensos</span></label>
          <select id="ts27-category" class="u-w-full">
            <option value="">— Sin categoría —</option>
            <optgroup label="Masculino">
              <option value="WT">WT — WorldTour</option>
              <option value="PT">PT — ProTeam</option>
              <option value="CT">CT — Continental</option>
              <option value="NTM">NTM — Selección nac.</option>
              <option value="CLUBM">CLUBM — Club</option>
            </optgroup>
            <optgroup label="Femenino">
              <option value="WWT">WWT — WorldTour</option>
              <option value="PRW">PRW — ProTeam</option>
              <option value="CTW">CTW — Continental</option>
              <option value="NTW">NTW — Selección nac.</option>
              <option value="CLUBW">CLUBW — Club</option>
            </optgroup>
          </select>
        </div>
      </div>
      <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
        <input type="checkbox" id="ts27-badgeVisible">
        <span>Mostrar los colores 2027 en Fichajes <span class="u-dim">— sin marcar, un equipo que ya existía muestra sus colores ACTUALES; uno nuevo queda vacío hasta que publiques el kit 2027</span></span>
      </label>
      <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
        <input type="checkbox" id="ts27-continuityDoubt">
        <span>Continuidad en duda <span class="u-dim">— el equipo sigue listado, con aviso (ej.: sin sponsor todavía). Si ya sabes que NO sigue, usa «No continúa en 2027»</span></span>
      </label>
      <details id="ts27-colors-details">
        <summary style="cursor:pointer;font-size:0.8rem;color:var(--text-muted)">🎨 Colores 2027</summary>
        <div style="display:flex;flex-direction:column;gap:0.6rem;margin-top:0.6rem">
          <div class="field-row field-row--2">
            <div class="field">
              <label>Fondo cabecera</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-headerBg-color">
                <input class="u-grow" type="text" id="ts27-headerBg-text" value="#1f2937">
              </div>
            </div>
            <div class="field">
              <label>Texto cabecera</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-headerText-color">
                <input class="u-grow" type="text" id="ts27-headerText-text" value="#ffffff">
              </div>
            </div>
          </div>
          <div class="field-row field-row--2">
            <div class="field">
              <label>Chapa — central torso</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-torsoCenter-color">
                <input class="u-grow" type="text" id="ts27-torsoCenter-text" value="#ffffff">
              </div>
            </div>
            <div class="field">
              <label>Chapa — laterales</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-torsoSides-color">
                <input class="u-grow" type="text" id="ts27-torsoSides-text" value="#111111">
              </div>
            </div>
          </div>
          <div class="field-row field-row--2">
            <div class="field">
              <label>
                Chapa — círculo interior
                <label style="display:inline-flex;align-items:center;gap:0.3rem;font-weight:400;margin-left:0.5rem">
                  <input type="checkbox" id="ts27-innerCircle-enabled">
                  <span class="u-fs-sm u-c-dim">activar</span>
                </label>
              </label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-innerCircle-color">
                <input class="u-grow" type="text" id="ts27-innerCircle-text" value="#ffd700">
              </div>
            </div>
            <div class="field">
              <label>Chapa — culotte</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-shorts-color">
                <input class="u-grow" type="text" id="ts27-shorts-text" value="#111111">
              </div>
            </div>
          </div>
          <div class="u-row" style="align-items:center;gap:0.75rem">
            <div id="ts27BadgePreview" style="width:64px;height:64px;display:flex;align-items:center;justify-content:center"></div>
            <span class="u-fs-sm u-c-dim">Vista previa de la chapa 2027</span>
          </div>
        </div>
      </details>
      <div class="u-row" style="gap:0.75rem;flex-wrap:wrap">
        <button class="btn btn--primary" id="saveTeamSeason27Btn" style="padding:0.35rem 0.8rem;font-size:0.8rem">Guardar temporada 2027</button>
        <button class="btn btn--ghost" id="ts27DiscontinueBtn" title="Equipos que cierran: elimina su temporada 2027 y deja de aparecer en Fichajes (reversible guardando de nuevo)" style="padding:0.35rem 0.8rem;font-size:0.8rem;color:var(--red);display:none">No continúa en 2027</button>
        <span class="u-fs-md u-c-dim" id="ts27Status"></span>
      </div>
    </div>
  `;
}

// Listeners del editor de equipo (por apertura del drawer). Incluye los pares
// de color, specialEdition, categoría→género, colores-modal y el panel de
// plantilla (que tenía guarda once _rosterReady → ahora se cablea por apertura).
function wireTeamEditor() {
  const bind = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  };
  bind('saveTeamBtn', 'click', saveTeam);
  bind('duplicateTeamBtn', 'click', duplicateTeam);
  bind('deleteTeamBtn', 'click', deleteTeam);
  ['headerBg', 'headerText', 'torsoCenter', 'torsoSides', 'innerCircle', 'shorts'].forEach(key => {
    const color = document.getElementById(`te-${key}-color`);
    const text  = document.getElementById(`te-${key}-text`);
    if (!color || !text) return;
    color.addEventListener('input', () => { _teamColorsExplicitlySet = true; text.value = color.value.toUpperCase(); refreshTeamPreview(); });
    text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { _teamColorsExplicitlySet = true; color.value = v.toLowerCase(); refreshTeamPreview(); }
    });
  });
  bind('te-innerCircle-enabled', 'change', refreshTeamPreview);
  bind('te-name', 'input', refreshTeamPreview);
  bind('te-countryCode', 'input', refreshTeamCountryFlag);
  bind('te-specialEdition', 'change', (e) => {
    const row = document.getElementById('te-parentTeam-row');
    if (row) row.style.display = e.target.checked ? '' : 'none';
    if (e.target.checked) _populateParentTeamSelect(null);
    const valRow = document.getElementById('te-specialValidity-row');
    if (valRow) valRow.style.display = e.target.checked ? 'flex' : 'none';
    if (e.target.checked) _populateSpecialRaceSelect(null);
    _syncRosterVisibility(_editingTeamId, e.target.checked);
  });
  bind('te-seRaceSearch', 'input', (e) => {
    const current = document.getElementById('te-seRaceId').value || null;
    _populateSpecialRaceSelect(current, e.target.value);
  });
  const CATEGORY_GENDER = { WT:'male',WWT:'female',PT:'male',PRW:'female',CT:'male',CTW:'female',NTM:'male',NTW:'female',CLUBM:'male',CLUBW:'female' };
  bind('te-category', 'change', (e) => {
    const g = CATEGORY_GENDER[e.target.value];
    if (g) document.getElementById('te-gender').value = g;
  });
  // Panel de plantilla (antes setupRosterPanel con guarda once)
  setupRosterPanel();
  // Panel de temporada 2027 (mercado de fichajes)
  setupSeason27Panel();
}

function openTeamEditor(teamId) {
  _editingTeamId = teamId;
  // Por defecto, un alta normal NO nace en el mercado (solo lo hace el alta por
  // «+ Equipo <MARKET_SEASON>», que fija el flag después de esta llamada).
  _newTeamMarketBorn = false;
  const team = teamId ? (_teamsCache || []).find(t => t.id === teamId) : null;
  _teamColorsExplicitlySet = !!(team?.headerBg);

  // El editor vive en el drawer: se monta su cuerpo + listeners por apertura.
  openDrawer({
    title: team ? 'Editar equipo' : 'Nuevo equipo',
    level: 1,
    render: (body) => {
      body.innerHTML = teamEditorBodyHtml();
      wireTeamEditor();
    },
  });

  document.getElementById('deleteTeamBtn').style.display = team ? '' : 'none';
  document.getElementById('duplicateTeamBtn').style.display = team ? '' : 'none';
  document.getElementById('teamSaveStatus').textContent = '';

  document.getElementById('te-name').value    = team?.name || '';
  document.getElementById('te-aliases').value = team?.nameAliases || '';
  setColorPair('headerBg',    team?.headerBg         || DEFAULT_TEAM.headerBg);
  setColorPair('headerText',  team?.headerText       || DEFAULT_TEAM.headerText);
  setColorPair('torsoCenter', team?.badgeTorsoCenter || DEFAULT_TEAM.badgeTorsoCenter);
  setColorPair('torsoSides',  team?.badgeTorsoSides  || DEFAULT_TEAM.badgeTorsoSides);
  setColorPair('shorts',      team?.badgeShorts      || DEFAULT_TEAM.badgeShorts);
  const innerEnabled = !!team?.badgeInnerCircle;
  document.getElementById('te-innerCircle-enabled').checked = innerEnabled;
  setColorPair('innerCircle', team?.badgeInnerCircle || '#ffd700');
  document.getElementById('te-specialEdition').checked = !!team?.specialEdition;
  const parentRow = document.getElementById('te-parentTeam-row');
  parentRow.style.display = team?.specialEdition ? '' : 'none';
  if (team?.specialEdition) _populateParentTeamSelect(team?.parentTeamId || null);
  // Vigencia del maillot especial
  document.getElementById('te-specialValidity-row').style.display = team?.specialEdition ? 'flex' : 'none';
  document.getElementById('te-seValidFrom').value = team?.specialEditionValidFrom || '';
  document.getElementById('te-seValidTo').value   = team?.specialEditionValidTo   || '';
  document.getElementById('te-seRaceSearch').value = '';
  _populateSpecialRaceSelect(team?.specialEditionRaceId || null);
  document.getElementById('te-category').value = team?.category || '';
  document.getElementById('te-gender').value   = team?.gender   || '';
  document.getElementById('te-countryCode').value = team?.countryCode || '';
  refreshTeamCountryFlag();

  refreshTeamPreview();
  // Plantilla: visible solo para equipos guardados que no sean edición especial.
  _syncRosterVisibility(teamId, team?.specialEdition);
  // Temporada 2027 (mercado): mismas condiciones de visibilidad.
  _syncSeason27Visibility(teamId, team?.specialEdition);
}

function closeTeamEditor() {
  _editingTeamId = null;
  _rosterTeamId = null;
  closeDrawer(1);
}

// Repinta SOLO los inputs de color del editor desde un objeto de colores, sin
// tocar el resto del formulario ni hacer scroll. Se usa tras la detección de
// colores (overlay del detector) para que el editor abierto detrás refleje los
// nuevos valores sin esperar a un F5. No-op si el editor no está abierto o no
// corresponde al equipo guardado.
function refreshTeamEditorColors(teamId, colors) {
  if (_editingTeamId !== teamId || !colors) return;
  // El editor vive en el drawer: comprobamos que esté montado (inputs de color
  // presentes) en vez del antiguo #teamEditor display.
  if (!document.getElementById('te-headerBg-color')) return;
  _teamColorsExplicitlySet = true;
  setColorPair('headerBg',    colors.headerBg);
  setColorPair('headerText',  colors.headerText);
  setColorPair('torsoCenter', colors.badgeTorsoCenter);
  setColorPair('torsoSides',  colors.badgeTorsoSides);
  setColorPair('shorts',      colors.badgeShorts);
  if (colors.badgeInnerCircle) {
    document.getElementById('te-innerCircle-enabled').checked = true;
    setColorPair('innerCircle', colors.badgeInnerCircle);
  }
  refreshTeamPreview();
}

async function saveTeam() {
  const status = document.getElementById('teamSaveStatus');
  const t = readTeamFromForm();
  if (!t.name) { status.textContent = 'Falta el nombre.'; return; }
  if (!t.category) { status.textContent = 'Selecciona una categoría UCI.'; return; }
  status.textContent = 'Guardando…';
  try {
    if (_editingTeamId) {
      const payload = { ...t, updatedAt: new Date().toISOString() };
      const { error } = await supabase.from('teams').update(payload).eq('id', _editingTeamId);
      if (error) throw error;
    } else {
      const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Alta desde «+ Equipo <MARKET_SEASON>» → firstSeason = temporada del
      // mercado: el trigger sync_team_to_season NO le estampa una temporada del
      // año en curso (mig. 129) → nace SIN identidad anterior → el mercado lo
      // deja vacío hasta publicar la chapa, en vez de mostrar colores antiguos
      // que no existen.
      const insert = { id, ...t };
      if (_newTeamMarketBorn) insert.firstSeason = MARKET_SEASON;
      const { error } = await supabase.from('teams').insert(insert);
      if (error) throw error;
      _newTeamMarketBorn = false;
      _editingTeamId = id;
      document.getElementById('deleteTeamBtn').style.display = '';
      const drawerTitle = document.getElementById('ccDrawer1Title');
      if (drawerTitle) drawerTitle.textContent = 'Editar equipo';
    }
    await fetchTeams({ force: true });
    renderTeamsList();
    status.textContent = 'Guardado.';
    showToast('Equipo guardado', 'success');

    // Revelar/refrescar la plantilla del equipo recién guardado (no para ediciones especiales).
    _syncRosterVisibility(_editingTeamId, t.specialEdition);
    _syncSeason27Visibility(_editingTeamId, t.specialEdition);

  } catch (err) {
    console.error('[saveTeam]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

async function deleteTeam() {
  if (!_editingTeamId) return;
  if (!await confirmDialog('¿Eliminar este equipo? Las listas de inscritos enlazadas perderán su enriquecimiento visual.', { danger: true })) return;
  const status = document.getElementById('teamSaveStatus');
  status.textContent = 'Eliminando…';
  try {
    const { error } = await supabase.from('teams').delete().eq('id', _editingTeamId);
    if (error) throw error;
    await fetchTeams({ force: true });
    renderTeamsList();
    closeTeamEditor();
    showToast('Equipo eliminado', 'success');
  } catch (err) {
    console.error('[deleteTeam]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

// ═════════════════════════════════════════════════════════════════
//  PLANTILLA DEL EQUIPO (afiliaciones rider_team_affiliations)
// ═════════════════════════════════════════════════════════════════
//
// La plantilla se construye desde rider_team_affiliations del AÑO EN CURSO,
// NO desde currentTeamId: un corredor puede tener afiliación a este equipo en
// 2026 aunque su currentTeamId apunte a otro (fichajes, catálogo oro).
//
// ⚠️ Las fechas de vínculo se escriben SIEMPRE directo sobre
// rider_team_affiliations (upsert por id = riderId__teamId__year). NUNCA vía
// currentTeamId: el trigger sync_rider_to_affiliation borra la afiliación SIMPLE
// (fechas NULL) del corredor para el año — de CUALQUIER equipo, no solo este —
// y la reescribiría con fechas NULL, robando afiliaciones a otros equipos.

const ROSTER_YEAR = new Date().getFullYear();
let _rosterTeamId = null;
let _rosterRows   = [];                 // [{ riderId, riderGender, dateFrom, dateTo, rider }]
let _rosterAddGender = 'male';          // género activo del buscador (equipos sin género)

function _rosterAffId(riderId, teamId) {
  return `${riderId}__${teamId}__${ROSTER_YEAR}`;
}

// Muestra/oculta el panel de plantilla según el estado del equipo y lo carga.
function _syncRosterVisibility(teamId, specialEdition) {
  const panel = document.getElementById('teamRosterPanel');
  if (!panel) return;
  const show = !!teamId && !specialEdition;
  panel.style.display = show ? 'flex' : 'none';
  if (!show) { _rosterTeamId = null; return; }
  setupRosterPanel();
  _rosterTeamId = teamId;
  document.getElementById('teamRosterYear').textContent = ROSTER_YEAR;
  // Reset del buscador de añadir
  const addSearch = document.getElementById('rosterAddSearch');
  if (addSearch) addSearch.value = '';
  const addResults = document.getElementById('rosterAddResults');
  if (addResults) { addResults.style.display = 'none'; addResults.innerHTML = ''; }
  // Género del buscador: el del equipo si lo tiene; si no, toggle visible.
  const team = (_teamsCache || []).find(t => t.id === teamId);
  const toggle = document.getElementById('rosterAddGenderToggle');
  if (team?.gender) {
    _rosterAddGender = team.gender;
    if (toggle) toggle.style.display = 'none';
  } else {
    _rosterAddGender = 'male';
    if (toggle) toggle.style.display = 'flex';
    _updateRosterGenderToggle();
  }
  loadTeamRoster(teamId);
}

const _updateRosterGenderToggle = () =>
  setGenderToggleActive('rosterAddGenderMale', 'rosterAddGenderFemale', _rosterAddGender);

async function loadTeamRoster(teamId) {
  const list = document.getElementById('teamRosterList');
  if (list) list.innerHTML = '<div class="u-fs-085 u-c-dim">Cargando…</div>';
  try {
    // La VERDAD es rider_team_affiliations (mig. 116): la plantilla = los corredores
    // con una afiliación a este equipo en el año. Cada fila lleva sus fechas (tramo);
    // las participaciones puntuales (corredor de desarrollo con el WT, etc.) viven solo
    // a nivel de startlist y NO crean afiliación → no aparecen aquí. (Editor: se muestran
    // también los tramos cerrados/futuros, con sus fechas, para poder revisarlos.)
    const cols = 'id, firstName, lastName, otherNames, nationality, birthDate, currentTeamId, verified, source';

    // 1) Afiliaciones a este equipo (año).
    const { data: affs, error: affErr } = await supabase
      .from('rider_team_affiliations')
      .select('riderId, riderGender, dateFrom, dateTo')
      .eq('teamId', teamId)
      .eq('year', ROSTER_YEAR);
    if (affErr) throw affErr;
    const affByKey = new Map();
    (affs || []).forEach(a => affByKey.set(`${a.riderGender}:${a.riderId}`, a));

    // 2) Traer las fichas de esos corredores (por género).
    const menIds   = (affs || []).filter(a => a.riderGender === 'male').map(a => a.riderId);
    const womenIds = (affs || []).filter(a => a.riderGender === 'female').map(a => a.riderId);
    const [men, women] = await Promise.all([
      menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
      womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
    ]);
    const riderByKey = new Map();
    men.forEach(r => riderByKey.set(`male:${r.id}`, r));
    women.forEach(r => riderByKey.set(`female:${r.id}`, r));

    // 3) Construir filas desde las afiliaciones (la ficha puede faltar → fila huérfana).
    const rows = [];
    const seen = new Set();
    (affs || []).forEach(a => {
      const gender = a.riderGender === 'female' ? 'female' : 'male';
      const key = `${gender}:${a.riderId}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        riderId: a.riderId,
        riderGender: gender,
        dateFrom: a.dateFrom || null,
        dateTo:   a.dateTo   || null,
        rider: riderByKey.get(key) || null,
      });
    });

    // La ficha puede faltar (afiliación huérfana: p. ej. justo tras fusionar un
    // duplicado, su afiliación queda apuntando a un id ya borrado) → null-guard
    // en el orden; esas filas se pintan degradadas en renderTeamRoster.
    const sortKey = (row) => row.rider
      ? `${row.rider.lastName || ''} ${row.rider.firstName || ''}`
      : `￿${row.riderId}`;   // huérfanas al final
    rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'es', { sensitivity: 'base' }));
    _rosterRows = rows;
    renderTeamRoster();
  } catch (err) {
    console.error('[loadTeamRoster]', err);
    if (list) list.innerHTML = `<div style="color:var(--red);font-size:0.85rem">Error cargando la plantilla: ${esc(err.message || String(err))}</div>`;
  }
}

function renderTeamRoster() {
  const list = document.getElementById('teamRosterList');
  const countEl = document.getElementById('teamRosterCount');
  if (!list) return;
  if (countEl) countEl.textContent = _rosterRows.length ? `${_rosterRows.length} corredor${_rosterRows.length === 1 ? '' : 'es'}` : '';

  if (_rosterRows.length === 0) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:0.35rem 0">Sin corredores en la plantilla ${ROSTER_YEAR}. Añade uno existente o crea uno nuevo.</div>`;
    return;
  }

  list.innerHTML = _rosterRows.map(row => {
    const r = row.rider;
    if (!r) {
      // Afiliación huérfana (el corredor ya no existe): fila degradada.
      return `<div class="roster-row" data-rider-id="${esc(row.riderId)}" data-gender="${esc(row.riderGender)}" style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.6rem;background:var(--bg-card);border:1px solid var(--red);border-radius:6px">
        <span style="flex:1;font-size:0.82rem;color:var(--red)">⚠ Corredor no encontrado — ${esc(row.riderId)} (${esc(row.riderGender)})</span>
        <button class="btn btn--ghost roster-clean-orphan" style="padding:0.2rem 0.5rem;font-size:0.72rem;color:var(--red)">Limpiar afiliación</button>
      </div>`;
    }
    // Pertenece como titular (currentTeamId == este equipo) o como traspaso
    // entrante (solo afiliación con fechas; su currentTeamId apunta a otro).
    const isTitular = r.currentTeamId === _rosterTeamId;
    const otherTeam = !isTitular && r.currentTeamId
      ? (_teamsCache || []).find(t => t.id === r.currentTeamId)
      : null;
    return `<div class="roster-row" data-rider-id="${esc(r.id)}" data-gender="${esc(row.riderGender)}" style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.6rem;background:var(--bg-card);border:1px solid ${isTitular ? 'var(--border)' : '#f59e0b'};border-radius:6px;flex-wrap:wrap">
      <span style="flex-shrink:0;width:1.6em;text-align:center">${_slRiderFlagPreview(r.nationality)}</span>
      <span style="flex:1;min-width:8rem;font-size:0.85rem">
        <strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
        ${r.birthDate ? `<span style="color:var(--text-dim);font-size:0.72rem;margin-left:0.3rem">'${esc(String(r.birthDate).slice(2,4))}</span>` : ''}
        ${r.verified === false ? '<span title="Sin verificar" style="color:#f59e0b;margin-left:0.3rem">?</span>' : ''}
        ${otherTeam ? `<span title="Traspaso con fechas; su equipo actual es otro" style="display:block;font-size:0.68rem;color:#f59e0b">tramo · equipo actual: ${esc(otherTeam.name)}</span>` : ''}
      </span>
      <label class="u-row u-row--gap-xs u-fs-068 u-c-dim">Desde
        <input type="date" class="roster-from u-chip-input" value="${esc(row.dateFrom || '')}">
      </label>
      <label class="u-row u-row--gap-xs u-fs-068 u-c-dim">Hasta
        <input type="date" class="roster-to u-chip-input" value="${esc(row.dateTo || '')}">
      </label>
      <button class="btn btn--ghost roster-save-dates u-btn-xs" title="Guardar fechas de vínculo (vacío = toda la temporada)">💾</button>
      <button class="btn btn--ghost roster-edit-rider u-btn-xs" title="Editar datos del corredor">✎</button>
      <button class="btn btn--ghost roster-remove" title="Quitar del equipo (no borra el corredor)" style="padding:0.2rem 0.5rem;font-size:0.72rem;color:var(--red)">Quitar</button>
    </div>`;
  }).join('');

  // Listeners por fila
  list.querySelectorAll('.roster-row').forEach(rowEl => {
    const riderId = rowEl.dataset.riderId;
    const gender  = rowEl.dataset.gender;

    const cleanOrphan = rowEl.querySelector('.roster-clean-orphan');
    if (cleanOrphan) cleanOrphan.addEventListener('click', () => removeRiderFromTeam(riderId, gender, { orphan: true }));

    const saveDates = rowEl.querySelector('.roster-save-dates');
    if (saveDates) saveDates.addEventListener('click', () => {
      const from = rowEl.querySelector('.roster-from').value || null;
      const to   = rowEl.querySelector('.roster-to').value || null;
      saveAffiliationDates(riderId, gender, from, to, saveDates);
    });

    const editBtn = rowEl.querySelector('.roster-edit-rider');
    if (editBtn) editBtn.addEventListener('click', () => openRosterRiderEditor(riderId, gender));

    const removeBtn = rowEl.querySelector('.roster-remove');
    if (removeBtn) removeBtn.addEventListener('click', () => removeRiderFromTeam(riderId, gender));
  });
}

// Upsert directo de fechas de vínculo (NO toca currentTeamId).
async function saveAffiliationDates(riderId, riderGender, dateFrom, dateTo, btnEl) {
  if (!_rosterTeamId) return;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    showToast('La fecha "desde" no puede ser posterior a "hasta".', 'error');
    return;
  }
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
  try {
    const payload = {
      id: _rosterAffId(riderId, _rosterTeamId),
      riderId,
      riderGender,
      teamId: _rosterTeamId,
      year: ROSTER_YEAR,
      dateFrom: dateFrom || null,
      dateTo:   dateTo   || null,
      source: 'panel',
      verified: true,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from('rider_team_affiliations').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    // Reflejar en memoria sin recargar.
    const row = _rosterRows.find(r => r.riderId === riderId && r.riderGender === riderGender);
    if (row) { row.dateFrom = payload.dateFrom; row.dateTo = payload.dateTo; }
    showToast('Fechas guardadas', 'success', 2000);
  } catch (err) {
    console.error('[saveAffiliationDates]', err);
    showToast('Error: ' + (err.message || err), 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '💾'; }
  }
}

// Quitar de la plantilla. La VERDAD es rider_team_affiliations (mig. 116): quitar =
// borrar la afiliación de este corredor a este equipo del año (sea simple o con
// fechas). El trigger inverso deriva currentTeamId (→ NULL si era su afiliación
// activa y no queda otra). NUNCA se escribe currentTeamId a mano.
async function removeRiderFromTeam(riderId, riderGender, { orphan = false } = {}) {
  if (!_rosterTeamId) return;
  const row = _rosterRows.find(r => r.riderId === riderId && r.riderGender === riderGender);
  const r = row?.rider;
  const name = r ? `${r.firstName} ${r.lastName}` : riderId;
  const isTitular = r && r.currentTeamId === _rosterTeamId;

  const msg = orphan
    ? `¿Eliminar la afiliación huérfana de "${name}"?`
    : isTitular
      ? `¿Quitar a ${name} del equipo? Dejará de tener equipo actual. No borra el corredor.`
      : `¿Quitar el tramo de ${name} en este equipo ${ROSTER_YEAR}? (Su equipo actual no cambia.)`;
  if (!await confirmDialog(msg, { danger: true })) return;

  try {
    // Borrar la afiliación a este equipo (simple o con fechas). El trigger inverso
    // recalcula currentTeamId.
    const { error: delErr } = await supabase.from('rider_team_affiliations')
      .delete().eq('id', _rosterAffId(riderId, _rosterTeamId));
    if (delErr) throw delErr;
    _rosterRows = _rosterRows.filter(x => !(x.riderId === riderId && x.riderGender === riderGender));
    renderTeamRoster();
    showToast('Corredor quitado de la plantilla', 'success', 2000);
  } catch (err) {
    console.error('[removeRiderFromTeam]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Añadir corredor existente. La VERDAD es rider_team_affiliations (mig. 116): se
// upserta la afiliación SIMPLE (sin fechas) del año a este equipo y el trigger
// inverso deriva currentTeamId. La pertenencia es única → se borra la afiliación
// simple del equipo anterior (un fichaje). NUNCA se escribe currentTeamId a mano.
async function addExistingRiderToTeam(riderId, riderGender, rider) {
  if (!_rosterTeamId) return;
  if (_rosterRows.some(r => r.riderId === riderId && r.riderGender === riderGender)) {
    showToast('Ese corredor ya está en la plantilla.', 'info', 2500);
    return;
  }
  const prevTeamId = rider?.currentTeamId || null;
  if (prevTeamId && prevTeamId !== _rosterTeamId) {
    const prev = (_teamsCache || []).find(t => t.id === prevTeamId);
    const name = rider ? `${rider.firstName} ${rider.lastName}` : riderId;
    if (!await confirmDialog(`${name} pertenece actualmente a "${prev?.name || prevTeamId}". ¿Ficharlo para este equipo? (Pasará a ser su equipo actual y saldrá de la plantilla del anterior.)`)) return;
  }
  try {
    // 1) Borrar la afiliación simple del equipo anterior (pertenencia única).
    if (prevTeamId && prevTeamId !== _rosterTeamId) {
      await supabase.from('rider_team_affiliations').delete().eq('id', _rosterAffId(riderId, prevTeamId));
    }
    // 2) Upsert de la afiliación simple a este equipo. El trigger inverso deriva currentTeamId.
    const { error } = await supabase.from('rider_team_affiliations').upsert({
      id: _rosterAffId(riderId, _rosterTeamId),
      riderId, riderGender, teamId: _rosterTeamId, year: ROSTER_YEAR,
      dateFrom: null, dateTo: null, source: 'panel',
      verified: rider?.verified ?? false, updatedAt: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) throw error;
    showToast('Corredor añadido a la plantilla', 'success', 2000);
    const addSearch = document.getElementById('rosterAddSearch');
    if (addSearch) addSearch.value = '';
    const addResults = document.getElementById('rosterAddResults');
    if (addResults) { addResults.style.display = 'none'; addResults.innerHTML = ''; }
    await loadTeamRoster(_rosterTeamId);
  } catch (err) {
    console.error('[addExistingRiderToTeam]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Búsqueda de corredores para añadir a la plantilla del equipo.
async function _rosterSearchRiders(q) {
  const results = document.getElementById('rosterAddResults');
  if (!results) return;
  const term = (q || '').trim();
  if (term.length < 3) { results.style.display = 'none'; results.innerHTML = ''; return; }

  const table = _rosterAddGender === 'male' ? 'riders_men' : 'riders_women';
  const safe = term.replace(/[%,()]/g, '');
  results.style.display = 'flex';
  results.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:0.3rem 0">Buscando…</div>';
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id, firstName, lastName, nationality, birthDate, currentTeamId, verified')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .order('lastName')
      .limit(20);
    if (error) throw error;
    const rows = data || [];
    const inRoster = new Set(_rosterRows.filter(r => r.riderGender === _rosterAddGender).map(r => r.riderId));
    if (rows.length === 0) {
      results.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:0.3rem 0">Sin resultados.</div>';
      return;
    }
    results.innerHTML = rows.map(r => {
      const already = inRoster.has(r.id);
      const team = r.currentTeamId ? (_teamsCache || []).find(t => t.id === r.currentTeamId) : null;
      return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.5rem;border-radius:5px;background:var(--bg-card);border:1px solid var(--border)" data-rid="${esc(r.id)}">
        <span style="width:1.5em;text-align:center">${_slRiderFlagPreview(r.nationality)}</span>
        <span style="flex:1;min-width:0;font-size:0.82rem"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
          ${r.birthDate ? `<span class="u-c-dim u-fs-070">'${esc(String(r.birthDate).slice(2,4))}</span>` : ''}
          ${team ? `<span style="display:block;font-size:0.66rem;color:var(--text-dim)">${esc(team.name)}</span>` : ''}
        </span>
        ${already
          ? '<span class="u-fs-xs u-c-dim">ya en plantilla</span>'
          : '<button class="btn btn--ghost roster-add-pick u-btn-xs">Añadir</button>'}
      </div>`;
    }).join('');
    results.querySelectorAll('.roster-add-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const rid = btn.closest('[data-rid]').dataset.rid;
        const rider = rows.find(x => x.id === rid);
        addExistingRiderToTeam(rid, _rosterAddGender, rider);
      });
    });
  } catch (err) {
    console.error('[_rosterSearchRiders]', err);
    results.innerHTML = `<div style="color:var(--red);font-size:0.8rem;padding:0.3rem 0">Error: ${esc(err.message || String(err))}</div>`;
  }
}

// Editor de un corredor desde la plantilla: abre el modal de ficha con el género
// correcto y el corredor cargado (reutiliza saveRider/merge/delete). `_ridersGender`
// fija el catálogo (riders_men/women) sobre el que operan esas funciones.
async function openRosterRiderEditor(riderId, riderGender) {
  _ridersGender = riderGender;
  _onRiderSavedOnce = null;   // apertura normal: sin hook de otro flujo
  try {
    const table = riderGender === 'male' ? 'riders_men' : 'riders_women';
    const { data } = await supabase.from(table).select('*').eq('id', riderId).maybeSingle();
    if (data) {
      _ridersAllCache = [data];
      openRiderEditor(riderId);
    }
  } catch (err) {
    console.error('[openRosterRiderEditor]', err);
  }
}

// Refresca la plantilla del equipo abierto (si la hay) tras editar/borrar/fusionar
// una ficha desde el modal. Sustituye al antiguo loadRidersTable() (la lista global
// se eliminó al fusionar Corredores en Equipos).
async function _refreshOpenRoster() {
  if (_rosterTeamId) await loadTeamRoster(_rosterTeamId);
}

// ── Crear corredor nuevo dentro del equipo ────────────────────────
// Inserta en riders_* con currentTeamId = equipo (el trigger crea la afiliación
// simple). Si se indican fechas, las aplica con saveAffiliationDates después.
function _rosterGenderForNewRider() {
  // Para crear: si el equipo tiene género, usarlo; si no, el del toggle.
  const team = (_teamsCache || []).find(t => t.id === _rosterTeamId);
  return team?.gender || _rosterAddGender;
}

function openNewRiderInTeamForm() {
  if (!_rosterTeamId) return;
  const gender = _rosterGenderForNewRider();
  const genderLabel = gender === 'male' ? 'masculino' : 'femenino';
  const results = document.getElementById('rosterAddResults');
  if (!results) return;
  // Reutilizamos rosterAddResults como contenedor del mini-formulario.
  results.style.display = 'flex';
  results.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.6rem;border:1px solid var(--accent);border-radius:6px;background:var(--bg-card)">
      <div style="font-size:0.78rem;font-weight:600;color:var(--text)">Nuevo corredor (${genderLabel}) en este equipo</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
        <input class="u-input-bordered" type="text" id="rnr-firstName" placeholder="Nombre">
        <input class="u-input-bordered" type="text" id="rnr-lastName" placeholder="Apellido(s)">
        <input type="text" id="rnr-nationality" placeholder="País (es)" maxlength="5" style="padding:0.35rem 0.5rem;font-size:0.8rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);text-transform:lowercase">
        <input class="u-input-bordered" type="date" id="rnr-birthDate" title="Fecha de nacimiento">
        <label class="u-row u-row--gap-xs u-fs-068 u-c-dim">Desde
          <input class="u-chip-input" type="date" id="rnr-from">
        </label>
        <label class="u-row u-row--gap-xs u-fs-068 u-c-dim">Hasta
          <input class="u-chip-input" type="date" id="rnr-to">
        </label>
      </div>
      <div class="u-row">
        <button class="btn btn--primary" id="rnr-save" style="padding:0.3rem 0.7rem;font-size:0.78rem">Crear</button>
        <button class="btn btn--ghost" id="rnr-cancel" style="padding:0.3rem 0.7rem;font-size:0.78rem">Cancelar</button>
        <span id="rnr-status" style="font-size:0.76rem;color:var(--text-dim)"></span>
      </div>
    </div>`;
  document.getElementById('rnr-firstName').focus();
  document.getElementById('rnr-save').addEventListener('click', () => createRiderInTeam(gender));
  document.getElementById('rnr-cancel').addEventListener('click', () => { results.style.display = 'none'; results.innerHTML = ''; });
}

async function createRiderInTeam(gender) {
  if (!_rosterTeamId) return;
  const status = document.getElementById('rnr-status');
  const firstName = document.getElementById('rnr-firstName').value.trim();
  const lastName  = document.getElementById('rnr-lastName').value.trim();
  if (!firstName || !lastName) { if (status) status.textContent = 'Faltan nombre y/o apellido.'; return; }
  const nationality = document.getElementById('rnr-nationality').value.trim().toLowerCase() || null;
  const birthDate   = document.getElementById('rnr-birthDate').value || null;
  const dateFrom    = document.getElementById('rnr-from').value || null;
  const dateTo      = document.getElementById('rnr-to').value || null;
  if (status) status.textContent = 'Creando…';

  const table = gender === 'male' ? 'riders_men' : 'riders_women';
  try {
    // Slug con el plegado canónico (igual que saveRider).
    const slugFromFold = async s => {
      const { data } = await supabase.rpc('fold_name_rpc', { p_text: s });
      return (data || '').replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    };
    const baseSlug = `${await slugFromFold(lastName)}-${await slugFromFold(firstName)}`.replace(/^-|-$/g, '') || 'rider';
    let id = baseSlug;
    const { data: existing } = await supabase.from(table).select('id').eq('id', id);
    if (existing?.length) {
      const year = birthDate ? birthDate.slice(0, 4) : Date.now().toString().slice(-4);
      id = `${id}-${year}`;
    }
    // La VERDAD es rider_team_affiliations (mig. 116): se crea la ficha SIN
    // currentTeamId (lo deriva el trigger inverso) y la pertenencia se declara con
    // una afiliación al equipo. NO se escribe currentTeamId a mano.
    const { error } = await supabase.from(table).insert({
      id, firstName, lastName, nationality, birthDate,
      source: 'manual', verified: true,
      updatedAt: new Date().toISOString(),
    });
    if (error) {
      if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
        if (status) status.textContent = 'Ya existe un corredor con ese nombre. Búscalo arriba y añádelo en vez de crearlo.';
        return;
      }
      throw error;
    }
    // Afiliación al equipo: con fechas si se indicaron, simple si no. El trigger
    // inverso deriva currentTeamId.
    if (dateFrom || dateTo) {
      await saveAffiliationDates(id, gender, dateFrom, dateTo, null);
    } else {
      const { error: affErr } = await supabase.from('rider_team_affiliations').upsert({
        id: _rosterAffId(id, _rosterTeamId),
        riderId: id, riderGender: gender, teamId: _rosterTeamId, year: ROSTER_YEAR,
        dateFrom: null, dateTo: null, source: 'manual', verified: true,
        updatedAt: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (affErr) throw affErr;
    }
    showToast('Corredor creado y añadido a la plantilla', 'success', 2500);
    const results = document.getElementById('rosterAddResults');
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }
    await loadTeamRoster(_rosterTeamId);
  } catch (err) {
    console.error('[createRiderInTeam]', err);
    if (status) status.textContent = 'Error: ' + (err.message || err);
  }
}

// Wiring del panel de plantilla (una sola vez).
function setupRosterPanel() {
  // Se cablea POR APERTURA del drawer (el DOM del roster se recrea cada vez).
  // Idempotente sobre el DOM actual vía data-flag: el panel se llama desde
  // wireTeamEditor y desde _syncRosterVisibility, pero solo cablea una vez por
  // instancia de DOM (evita doble binding sin la vieja guarda global once).
  const box = document.getElementById('rosterAddBox');
  if (!box || box.dataset.wired === '1') return;
  box.dataset.wired = '1';
  let timer = null;
  const addSearch = document.getElementById('rosterAddSearch');
  if (addSearch) addSearch.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => _rosterSearchRiders(addSearch.value), 280);
  });
  wireGenderToggle('rosterAddGenderMale', 'rosterAddGenderFemale', (g) => {
    _rosterAddGender = g; _updateRosterGenderToggle(); _rosterSearchRiders(addSearch?.value || '');
  });
  const newBtn = document.getElementById('rosterNewRiderBtn');
  if (newBtn) newBtn.addEventListener('click', openNewRiderInTeamForm);
}

// ═════════════════════════════════════════════════════════════════
//  TEMPORADA 2027 DEL EQUIPO (team_seasons — mercado de fichajes)
// ═════════════════════════════════════════════════════════════════
//
// La pantalla de Fichajes lista los equipos desde team_seasons[2027]: nombre,
// categoría (ascensos/descensos) y chapa OCULTABLE (badgeVisible, mig. 122).
// Se edita aquí y NO en `teams` (el trigger sync_team_to_season pisa siempre
// el año en curso → tocar teams contaminaría la vista 2026).

let _season27Row = null;   // fila team_seasons año 2027 del equipo abierto (o null)

function _ts27SetColor(key, value) {
  const color = document.getElementById(`ts27-${key}-color`);
  const text  = document.getElementById(`ts27-${key}-text`);
  if (!color || !text) return;
  const hex = (value || '').toLowerCase();
  const safe = /^#[0-9a-f]{6}$/.test(hex) ? hex : '#000000';
  color.value = safe;
  text.value = safe.toUpperCase();
}

function _ts27GetColor(key) {
  const text = document.getElementById(`ts27-${key}-text`)?.value.trim() || '';
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return document.getElementById(`ts27-${key}-color`)?.value.toLowerCase() || '#000000';
}

function refreshSeason27Preview() {
  const preview = document.getElementById('ts27BadgePreview');
  if (!preview) return;
  const inner = document.getElementById('ts27-innerCircle-enabled')?.checked ? _ts27GetColor('innerCircle') : null;
  preview.innerHTML = buildTeamBadgeSvg({
    badgeTorsoCenter: _ts27GetColor('torsoCenter'),
    badgeTorsoSides:  _ts27GetColor('torsoSides'),
    badgeInnerCircle: inner,
    badgeShorts:      _ts27GetColor('shorts'),
  }, { size: 64 });
}

function _syncSeason27Visibility(teamId, specialEdition) {
  const panel = document.getElementById('teamSeason27Panel');
  if (!panel) return;
  const show = !!teamId && !specialEdition;
  panel.style.display = show ? 'flex' : 'none';
  if (show) loadTeamSeason27(teamId);
}

async function loadTeamSeason27(teamId) {
  const status = document.getElementById('ts27Status');
  if (status) status.textContent = 'Cargando…';
  _season27Row = null;
  try {
    const { data, error } = await supabase
      .from('team_seasons').select('*')
      .eq('teamId', teamId).eq('year', 2027)
      .maybeSingle();
    if (error) throw error;
    _season27Row = data || null;
    // Sin fila 2027 → precargar con la identidad actual (se crea al guardar).
    const team = (_teamsCache || []).find(t => t.id === teamId) || {};
    const src = _season27Row || team;
    const nameEl = document.getElementById('ts27-name');
    if (!nameEl) return; // el drawer se cerró mientras cargaba
    nameEl.value = src.name || '';
    document.getElementById('ts27-category').value = src.category || '';
    // Sin fila todavía → chapa OCULTA por defecto (los kits 2027 no se conocen).
    document.getElementById('ts27-badgeVisible').checked = _season27Row ? (_season27Row.badgeVisible !== false) : false;
    document.getElementById('ts27-continuityDoubt').checked = !!_season27Row?.continuityDoubt;
    _ts27SetColor('headerBg',    src.headerBg         || DEFAULT_TEAM.headerBg);
    _ts27SetColor('headerText',  src.headerText       || DEFAULT_TEAM.headerText);
    _ts27SetColor('torsoCenter', src.badgeTorsoCenter || DEFAULT_TEAM.badgeTorsoCenter);
    _ts27SetColor('torsoSides',  src.badgeTorsoSides  || DEFAULT_TEAM.badgeTorsoSides);
    _ts27SetColor('shorts',      src.badgeShorts      || DEFAULT_TEAM.badgeShorts);
    const innerEnabled = !!src.badgeInnerCircle;
    document.getElementById('ts27-innerCircle-enabled').checked = innerEnabled;
    _ts27SetColor('innerCircle', src.badgeInnerCircle || '#ffd700');
    refreshSeason27Preview();
    // "No continúa" solo tiene sentido si HAY temporada 2027 que retirar.
    const discBtn = document.getElementById('ts27DiscontinueBtn');
    if (discBtn) discBtn.style.display = _season27Row ? '' : 'none';
    if (status) status.textContent = _season27Row ? '' : 'Sin temporada 2027 — este equipo NO aparece en Fichajes. Guarda para crearla.';
  } catch (err) {
    console.error('[loadTeamSeason27]', err);
    if (status) status.textContent = 'Error cargando la temporada 2027: ' + (err.message || err);
  }
}

async function saveTeamSeason27() {
  if (!_editingTeamId) return;
  const status = document.getElementById('ts27Status');
  const name = document.getElementById('ts27-name').value.trim();
  if (!name) { status.textContent = 'Falta el nombre 2027.'; return; }
  const category = document.getElementById('ts27-category').value || null;
  const CATEGORY_GENDER = { WT:'male',WWT:'female',PT:'male',PRW:'female',CT:'male',CTW:'female',NTM:'male',NTW:'female',CLUBM:'male',CLUBW:'female' };
  const inner = document.getElementById('ts27-innerCircle-enabled').checked ? _ts27GetColor('innerCircle') : null;
  status.textContent = 'Guardando…';
  try {
    const payload = {
      id: `${_editingTeamId}_2027`,
      teamId: _editingTeamId,
      year: 2027,
      name,
      category,
      gender: CATEGORY_GENDER[category] || null,
      headerBg:         _ts27GetColor('headerBg'),
      headerText:       _ts27GetColor('headerText'),
      badgeTorsoCenter: _ts27GetColor('torsoCenter'),
      badgeTorsoSides:  _ts27GetColor('torsoSides'),
      badgeInnerCircle: inner,
      badgeShorts:      _ts27GetColor('shorts'),
      badgeVisible:     document.getElementById('ts27-badgeVisible').checked,
      continuityDoubt:  document.getElementById('ts27-continuityDoubt').checked,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from('team_seasons').upsert(payload, { onConflict: 'teamId,year' });
    if (error) throw error;
    status.textContent = 'Guardado.';
    showToast('Temporada 2027 guardada', 'success', 2500);
    await loadTeamSeason27(_editingTeamId);
    await _refreshMarketTeamsIfVisible();
  } catch (err) {
    console.error('[saveTeamSeason27]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

/**
 * Refresca la lista de equipos de la vista Fichajes si está montada — un
 * renombre 2027 o un cambio de chapa/duda debe verse al cerrar el editor.
 * No-op fuera de esa vista (el editor de equipo también vive en Equipos).
 */
async function _refreshMarketTeamsIfVisible() {
  if (!document.getElementById('marketTeamsList')) return;
  const { data } = await supabase.from('team_seasons')
    .select('teamId, name, category, badgeVisible, continuityDoubt')
    .eq('year', MARKET_SEASON);
  _marketSeasons = data || [];
  _trTeamNameById = new Map(_marketSeasons.map(s => [s.teamId, s.name]));
  renderMarketTeams();
  renderTransfersList();   // los nombres 2027 del feed también cambian
}

// Equipos que CIERRAN: marcar que no continúa = borrar su temporada 2027 →
// deja de listarse en Fichajes (la ausencia de fila ES la señal; no hay flag).
// Reversible: "Guardar temporada 2027" vuelve a crearla.
async function discontinueTeamSeason27() {
  if (!_editingTeamId) return;
  const teamName = document.getElementById('ts27-name')?.value.trim() || 'este equipo';
  if (!await confirmDialog(`¿Marcar que ${teamName} NO continúa en 2027? Se elimina su temporada 2027 y deja de aparecer en Fichajes. (Reversible: guarda la temporada de nuevo para recuperarla.)`, { danger: true })) return;
  const status = document.getElementById('ts27Status');
  if (status) status.textContent = 'Eliminando temporada 2027…';
  try {
    const { error } = await supabase.from('team_seasons')
      .delete().eq('teamId', _editingTeamId).eq('year', 2027);
    if (error) throw error;
    showToast('Marcado: el equipo no continúa en 2027', 'success', 3000);
    await loadTeamSeason27(_editingTeamId);
    await _refreshMarketTeamsIfVisible();
  } catch (err) {
    console.error('[discontinueTeamSeason27]', err);
    if (status) status.textContent = 'Error: ' + (err.message || err);
  }
}

// Wiring del panel de temporada 2027 (por apertura del drawer, idempotente por DOM).
function setupSeason27Panel() {
  const panel = document.getElementById('teamSeason27Panel');
  if (!panel || panel.dataset.wired === '1') return;
  panel.dataset.wired = '1';
  document.getElementById('saveTeamSeason27Btn')?.addEventListener('click', saveTeamSeason27);
  document.getElementById('ts27DiscontinueBtn')?.addEventListener('click', discontinueTeamSeason27);
  ['headerBg', 'headerText', 'torsoCenter', 'torsoSides', 'innerCircle', 'shorts'].forEach(key => {
    const color = document.getElementById(`ts27-${key}-color`);
    const text  = document.getElementById(`ts27-${key}-text`);
    if (!color || !text) return;
    color.addEventListener('input', () => { text.value = color.value.toUpperCase(); refreshSeason27Preview(); });
    text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { color.value = v.toLowerCase(); refreshSeason27Preview(); }
    });
  });
  document.getElementById('ts27-innerCircle-enabled')?.addEventListener('change', refreshSeason27Preview);
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE CORREDORES
// ═════════════════════════════════════════════════════════════════

// Género del corredor sobre el que opera el editor/fusión (riders_men/women).
// Lo fija openRosterRiderEditor antes de abrir el modal. NO es un "tab activo":
// la zona Corredores se fusionó en Equipos (los corredores se gestionan desde la
// plantilla de un equipo).
let _ridersGender     = 'male';
let _editingRiderId   = null;
let _ridersAllCache   = [];          // ficha(s) en memoria que el editor puede leer
// Callback de UN SOLO USO que dispara saveRider al guardar. Lo arma quien abre
// el editor desde otro flujo y necesita la ficha recién creada (hoy: el editor
// de un movimiento del mercado, que la deja seleccionada). Se limpia al usarse
// y al abrir el editor por la vía normal → nunca se dispara de más.
let _onRiderSavedOnce = null;

// Cablea (una sola vez) los listeners del modal-editor de corredor. Se invoca
// perezosamente desde openRosterRiderEditor; el modal vive fuera de cualquier
// vista, así que no depende de switchTab.
// Cuerpo de la ficha de corredor dentro del drawer (mismos ids re-*; sin botón
// Cerrar propio ni título — los aporta el drawer; el cierre del backdrop también).
function riderEditorBodyHtml() {
  return `
    <div class="field" id="re-gender-row" style="display:none;margin-bottom:0.75rem">
      <label>Sexo</label>
      ${genderToggleHtml({ idMale: 're-gender-male', idFemale: 're-gender-female', labels: { male: 'Masculino', female: 'Femenino' } })}
      <span class="u-fs-sm u-c-dim" style="display:block;margin-top:0.25rem">Decide en qué catálogo (riders_men / riders_women) se crea la ficha.</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="re-firstName" placeholder="Tadej" class="u-w-full">
      </div>
      <div class="field">
        <label>Apellido(s)</label>
        <input type="text" id="re-lastName" placeholder="Pogačar" class="u-w-full">
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>Otros nombres <span class="u-dim">— separados por coma, para matching alternativo</span></label>
        <input type="text" id="re-otherNames" placeholder="Cano, Zapater, OConnor" class="u-w-full">
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.25rem">
          Usa este campo para segundos apellidos (ej: "Cano" si el corredor se llama Rodríguez Cano), variantes ortográficas o abreviaturas que puedan aparecer en startlists importadas.
        </div>
      </div>
      <div class="field">
        <label>Nacionalidad</label>
        <div class="u-row" style="gap:0.4rem">
          <input type="text" id="re-nationality" placeholder="es" maxlength="5" style="width:4rem;text-transform:lowercase" autocomplete="off">
          <span id="re-nationality-flag" style="font-size:1.4rem;min-width:1.8rem;text-align:center"></span>
        </div>
      </div>
      <div class="field">
        <label>Fecha de nacimiento</label>
        <input type="date" id="re-birthDate" class="u-w-full">
      </div>
      <div class="field">
        <label>Equipo actual</label>
        <select id="re-teamId" class="u-w-full">
          <option value="">— Sin equipo —</option>
        </select>
      </div>
      <div class="field">
        <label>Contrato hasta <span class="u-dim">— año, vacío = desconocido</span></label>
        <input type="number" id="re-contractUntil" min="2020" max="2040" placeholder="2027" class="u-w-full">
      </div>
      <div class="field" style="grid-column:1/-1;display:flex;align-items:center;gap:0.5rem">
        <input type="checkbox" id="re-verified" style="width:auto;margin:0">
        <label for="re-verified" style="margin:0;cursor:pointer">Verificado <span class="u-dim">— marca cuando los datos del corredor estén revisados y completos</span></label>
        <span id="re-source-info" style="margin-left:auto;font-size:0.72rem;color:var(--text-dim)"></span>
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn--primary" id="saveRiderBtn">Guardar</button>
      <button class="btn btn--ghost" id="mergeRiderBtn" title="Fusionar este corredor con otro: las startlists del actual pasan al elegido y este se elimina." style="color:#f59e0b;display:none">Fusionar con otro…</button>
      <button class="btn btn--ghost" id="deleteRiderBtn" style="color:var(--red);display:none">Eliminar</button>
      <span class="u-fs-md u-c-dim" id="riderSaveStatus"></span>
    </div>
  `;
}

// Listeners de la ficha de corredor (por apertura del drawer nivel 2).
function wireRiderEditor() {
  document.getElementById('saveRiderBtn').addEventListener('click', saveRider);
  document.getElementById('deleteRiderBtn').addEventListener('click', deleteRider);
  document.getElementById('mergeRiderBtn').addEventListener('click', openMergeRiderPicker);
  document.getElementById('re-nationality').addEventListener('input', (e) => {
    const code = e.target.value.trim().toLowerCase();
    document.getElementById('re-nationality-flag').innerHTML = _slRiderFlagPreview(code);
  });
  // Selector de sexo (solo visible al CREAR): decide la tabla riders_men/women.
  wireGenderToggle('re-gender-male', 're-gender-female', (g) => {
    _ridersGender = g;
    setGenderToggleActive('re-gender-male', 're-gender-female', g);
  });
}

// Rellena el desplegable de equipo del editor con TODOS los equipos (puede haber
// transfers entre géneros o equipos sin gender), preservando la selección actual.
function _populateRiderEditorTeams() {
  const sel = document.getElementById('re-teamId');
  if (!sel) return;
  const prev = sel.value;
  const allTeamsSorted = (_teamsCache || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  sel.innerHTML = '<option value="">— Sin equipo —</option>';
  for (const t of allTeamsSorted) {
    sel.innerHTML += `<option value="${esc(t.id)}" ${prev === t.id ? 'selected' : ''}>${esc(t.name)}</option>`;
  }
}

function openRiderEditor(riderId) {
  _editingRiderId = riderId;
  const rider = riderId ? _ridersAllCache.find(r => r.id === riderId) : null;

  // Ficha en drawer NIVEL 2 (apilada sobre el editor de equipo, si lo hay).
  openDrawer({
    title: rider ? 'Editar corredor' : 'Nuevo corredor',
    level: 2,
    render: (body) => {
      body.innerHTML = riderEditorBodyHtml();
      wireRiderEditor();
    },
  });

  document.getElementById('deleteRiderBtn').style.display = rider ? '' : 'none';
  document.getElementById('mergeRiderBtn').style.display  = rider ? '' : 'none';
  document.getElementById('riderSaveStatus').textContent  = '';

  // Selector de sexo: solo al CREAR una ficha (al editar, el género lo fija la
  // tabla de la que vino y NO se cambia aquí). Refleja _ridersGender, que el
  // llamador ya prefijó (p. ej. por el equipo de origen del movimiento).
  const genderRow = document.getElementById('re-gender-row');
  if (genderRow) genderRow.style.display = rider ? 'none' : '';
  if (!rider) setGenderToggleActive('re-gender-male', 're-gender-female', _ridersGender);

  // Rellenar el desplegable de equipos ANTES de fijar re-teamId.value (necesita
  // que exista la <option> correspondiente).
  _populateRiderEditorTeams();

  document.getElementById('re-firstName').value   = rider?.firstName   || '';
  document.getElementById('re-lastName').value    = rider?.lastName    || '';
  document.getElementById('re-otherNames').value  = rider?.otherNames  || '';
  document.getElementById('re-nationality').value = rider?.nationality || '';
  document.getElementById('re-nationality-flag').innerHTML = _slRiderFlagPreview(rider?.nationality || '');
  document.getElementById('re-birthDate').value   = rider?.birthDate   || '';
  document.getElementById('re-teamId').value      = rider?.currentTeamId || '';
  document.getElementById('re-contractUntil').value = rider?.contractUntil || '';
  // Verificación: nuevos riders parten como verified=true (los crea el admin).
  // Editando un existente: muestra su estado real.
  document.getElementById('re-verified').checked  = rider ? (rider.verified !== false) : true;
  const srcInfo = document.getElementById('re-source-info');
  if (rider && rider.source) srcInfo.textContent = `origen: ${rider.source}`;
  else srcInfo.textContent = '';
}

function closeRiderEditor() {
  _editingRiderId = null;
  closeDrawer(2);
}

async function saveRider() {
  const status    = document.getElementById('riderSaveStatus');
  const firstName = document.getElementById('re-firstName').value.trim();
  const lastName  = document.getElementById('re-lastName').value.trim();
  if (!firstName || !lastName) { status.textContent = 'Faltan nombre y/o apellido.'; return; }

  status.textContent = 'Guardando…';
  const table = _ridersGender === 'male' ? 'riders_men' : 'riders_women';

  const payload = {
    firstName,
    lastName,
    otherNames:    document.getElementById('re-otherNames').value.trim()  || null,
    nationality:   document.getElementById('re-nationality').value.trim().toLowerCase() || null,
    birthDate:     document.getElementById('re-birthDate').value || null,
    currentTeamId: document.getElementById('re-teamId').value   || null,
    contractUntil: parseInt(document.getElementById('re-contractUntil').value, 10) || null,
    verified:      document.getElementById('re-verified').checked,
    updatedAt:     new Date().toISOString(),
  };

  try {
    if (_editingRiderId) {
      const { error } = await supabase.from(table).update(payload).eq('id', _editingRiderId);
      if (error) {
        // Renombrar una ficha existente puede chocar con OTRA que ya tiene ese
        // mismo "DNI" (identityKey) — típicamente un duplicado huérfano creado por
        // un volcado con el nombre largo. En vez de dejar al admin en un callejón
        // sin salida con el error crudo, ofrecemos fusionar la otra ficha en ESTA
        // (la que se edita, que es la buena) y reintentar el rename.
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          const merged = await _handleRenameIdentityKeyClash(table, firstName, lastName, payload, status);
          if (!merged) return; // el admin canceló o no se pudo: status ya informado
          // _mergeRidersSilent acumuló los otherNames del perdedor en la ficha
          // (matching futuro). Releer ese valor consolidado para no pisarlo con el
          // del input al reintentar el update.
          const { data: tgtNow } = await supabase.from(table)
            .select('otherNames').eq('id', _editingRiderId).maybeSingle();
          if (tgtNow && tgtNow.otherNames) payload.otherNames = tgtNow.otherNames;
          // Reintentar el update tras consolidar el duplicado.
          const { error: retryErr } = await supabase.from(table).update(payload).eq('id', _editingRiderId);
          if (retryErr) throw retryErr;
        } else {
          throw error;
        }
      }

      // P4: propagar a snapshots de startlist_riders para que las apps que
      // todavía leen la tabla original (no la vista resuelta) vean el nombre
      // canónico actualizado. countryCode NO se propaga porque suele ser un
      // override de selección nacional en la startlist (Mundial, JJOO).
      try {
        const { error: propErr } = await supabase
          .from('startlist_riders')
          .update({ firstName, lastName })
          .eq('globalRiderId', _editingRiderId);
        if (propErr) console.warn('[saveRider] snapshot propagation failed', propErr);
      } catch (e) {
        console.warn('[saveRider] snapshot propagation error', e);
      }
    } else {
      // Generar ID slug con el plegado CANÓNICO (fold_name SQL, igual que el
      // catálogo y resolve_riders) en vez del NFD+strip de JS que corrompe ø/ł/ß.
      const slugFromFold = async s => {
        const { data } = await supabase.rpc('fold_name_rpc', { p_text: s });
        return (data || '').replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      };
      const baseSlug = `${await slugFromFold(lastName)}-${await slugFromFold(firstName)}`.replace(/^-|-$/g, '') || 'rider';
      let id = baseSlug;
      // Resolver colisión del id (PK): sufijo de año de nacimiento o numérico.
      const { data: existing } = await supabase.from(table).select('id').eq('id', id);
      if (existing?.length) {
        const year = payload.birthDate ? payload.birthDate.slice(0,4) : Date.now().toString().slice(-4);
        id = `${id}-${year}`;
      }
      _editingRiderId = id;
      const { error } = await supabase.from(table).insert({ id, ...payload, source: 'manual', verified: true });
      if (error) {
        // El índice UNIQUE de identityKey rechaza una ficha cuyo "DNI" ya existe.
        // En vez de dejar al admin en un callejón sin salida, buscamos la(s)
        // ficha(s) que chocan y le ofrecemos editarla o crear un homónimo.
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          _editingRiderId = null;
          await _handleIdentityKeyClash(table, firstName, lastName, payload, status);
          return;
        }
        throw error;
      }
      document.getElementById('deleteRiderBtn').style.display = '';
      document.getElementById('mergeRiderBtn').style.display = '';
      const drawer2Title = document.getElementById('ccDrawer2Title');
      if (drawer2Title) drawer2Title.textContent = 'Editar corredor';
    }

    await _refreshOpenRoster();
    status.textContent = 'Guardado.';
    showToast('Corredor guardado', 'success');

    // Ficha creada desde el editor de un movimiento del mercado: seleccionarla
    // ahí y cerrar este drawer, para no obligar a volver a buscarla.
    if (_onRiderSavedOnce) {
      const cb = _onRiderSavedOnce;
      _onRiderSavedOnce = null;
      cb({ id: _editingRiderId, gender: _ridersGender, ...payload });
    }
  } catch (err) {
    console.error('[saveRider]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

// Reconstruye el identityKey igual que compute_identity_key (migración 075):
// fold_name(first+' '+last) -> split por espacio -> dedup -> orden alfabético ->
// join('-'). Usa fold_name_rpc para que el plegado sea idéntico al de la BD.
async function _computeIdentityKeyClient(firstName, lastName) {
  const { data } = await supabase.rpc('fold_name_rpc', { p_text: `${firstName || ''} ${lastName || ''}` });
  const folded = (data || '').trim();
  if (!folded) return null;
  const tokens = [...new Set(folded.split(/\s+/).filter(Boolean))].sort();
  return tokens.join('-') || null;
}

// Un INSERT de corredor chocó con el índice UNIQUE de identityKey. Buscamos la(s)
// ficha(s) existentes con ese DNI y damos salida al admin: editar la que ya existe
// (el caso normal: "ya está, no lo dupliques") o, si de verdad es otra persona,
// crear un homónimo con sufijo de año (requiere fecha de nacimiento, como hace el
// desambiguador del catálogo).
async function _handleIdentityKeyClash(table, firstName, lastName, payload, status) {
  status.textContent = 'Ese nombre ya existe (mismo DNI). Buscando la ficha…';
  const ikey = await _computeIdentityKeyClient(firstName, lastName);
  let matches = [];
  if (ikey) {
    const { data } = await supabase.from(table).select('*').eq('identityKey', ikey);
    matches = data || [];
  }
  // Fallback: si por lo que sea el identityKey reconstruido no casa, buscar por
  // nombre+apellido exactos (defensivo; no debería hacer falta).
  if (!matches.length) {
    const { data } = await supabase.from(table)
      .select('*').ilike('firstName', firstName).ilike('lastName', lastName);
    matches = data || [];
  }

  if (!matches.length) {
    status.textContent = 'Ya existe un corredor con ese DNI pero no se pudo localizar. Búscalo en la lista y edítalo.';
    return;
  }

  const m = matches[0];
  const dob = m.birthDate ? ` · ${m.birthDate}` : ' · sin fecha';
  const team = (_teamsCache || []).find(t => t.id === m.currentTeamId);
  const teamStr = team ? ` · ${team.name}` : '';
  const hasBirth = !!payload.birthDate;

  // Diálogo de decisión. Ofrecer crear homónimo SOLO si la ficha nueva trae fecha
  // (sin fecha no se puede desambiguar de forma estable → se bloquea).
  const ok = await confirmDialog(
    `Ya existe "${m.firstName} ${m.lastName}"${dob}${teamStr} (id: ${m.id}).\n\n` +
    `Lo más probable es que sea la MISMA persona.\n\n` +
    `• Aceptar → abrir esa ficha para editarla (recomendado).\n` +
    `• Cancelar → no hacer nada (si de verdad es otra persona distinta` +
    (hasBirth ? `, usa el botón de abajo para crear un homónimo con año).` : ` necesitas ponerle fecha de nacimiento para poder distinguirla).`),
    { title: 'Posible duplicado', confirmText: 'Abrir ficha existente' }
  );

  if (ok) {
    // Cargar la ficha existente en la caché del editor para que openRiderEditor
    // la encuentre (el modal lee de _ridersAllCache).
    _ridersAllCache = [m];
    openRiderEditor(m.id);
    status.textContent = `Editando la ficha existente de ${m.firstName} ${m.lastName}.`;
    showToast('Abierta la ficha existente', 'success');
    return;
  }

  // El admin dice que es otra persona. Crear homónimo con sufijo de año, replicando
  // el desempate del catálogo (id y identityKey con '-<año>'). Solo con fecha.
  if (hasBirth) {
    const wantHomonym = await confirmDialog(
      `¿Crear "${firstName} ${lastName}" como persona DISTINTA (homónimo)?\n\n` +
      `Se le añadirá el año de nacimiento (${payload.birthDate.slice(0,4)}) para distinguirla.`,
      { confirmText: 'Crear homónimo' }
    );
    if (wantHomonym) {
      const year = payload.birthDate.slice(0, 4);
      const baseSlug = (await _computeIdentityKeyClient(firstName, lastName)) || 'rider';
      // id e identityKey sufijados con el año (el trigger respeta una clave ya
      // sufijada por el año propio = homónimo declarado, ver migración 075).
      const homId  = `${baseSlug}-${year}`;
      const homKey = `${baseSlug}-${year}`;
      const { error: insErr } = await supabase.from(table).insert({
        id: homId, identityKey: homKey, ...payload,
        source: 'manual', verified: true,
      });
      if (insErr) {
        status.textContent = 'No se pudo crear el homónimo: ' + insErr.message;
        return;
      }
      _editingRiderId = homId;
      // Sembrar la caché del editor con la ficha recién creada para reabrirla.
      _ridersAllCache = [{ id: homId, identityKey: homKey, ...payload, source: 'manual', verified: true }];
      await _refreshOpenRoster();
      openRiderEditor(homId);
      status.textContent = `Creado como homónimo (${homId}).`;
      showToast('Homónimo creado', 'success');
      return;
    }
  }
  status.textContent = 'Cancelado. No se creó ninguna ficha.';
}

// Renombrar la ficha que se está editando (_editingRiderId) chocó con el índice
// UNIQUE de identityKey: ya existe OTRA ficha con ese mismo DNI. La ficha que se
// edita es la buena (verificada por el admin); la otra suele ser un duplicado
// huérfano. Damos salida: fusionar la OTRA ficha en ESTA (traspasa sus startlists/
// afiliaciones aquí, deja un alias del DNI viejo para que no se re-cree, y la borra)
// y devolvemos true para que saveRider() reintente el rename. Devuelve false si el
// admin cancela o no se pudo localizar/fusionar (status ya informado).
async function _handleRenameIdentityKeyClash(table, firstName, lastName, payload, status) {
  status.textContent = 'Ese nombre ya existe (mismo DNI). Buscando la ficha que choca…';
  const ikey = await _computeIdentityKeyClient(firstName, lastName);
  let matches = [];
  if (ikey) {
    const { data } = await supabase.from(table).select('*')
      .eq('identityKey', ikey).neq('id', _editingRiderId);
    matches = data || [];
  }
  if (!matches.length) {
    status.textContent =
      'Otra ficha tiene ese DNI pero no se pudo localizar. Búscala en el catálogo y fusiónala a mano.';
    return false;
  }

  const other = matches[0];
  const dob = other.birthDate ? ` · ${other.birthDate}` : ' · sin fecha';
  const team = (_teamsCache || []).find(t => t.id === other.currentTeamId);
  const teamStr = team ? ` · ${team.name}` : '';

  const ok = await confirmDialog(
    `Al renombrar a "${firstName} ${lastName}" choca con una ficha que ya existe ` +
    `con ese mismo DNI:\n\n` +
    `   "${other.firstName} ${other.lastName}"${dob}${teamStr} (id: ${other.id})\n\n` +
    `Lo más probable es que sea la MISMA persona (un duplicado).\n\n` +
    `• Aceptar → fusionar esa ficha EN ESTA (sus startlists y afiliaciones pasan ` +
    `a la que estás editando; la duplicada se elimina) y aplicar el cambio de nombre.\n` +
    `• Cancelar → no hacer nada.`,
    { title: 'Duplicado al renombrar', confirmText: 'Fusionar y renombrar' }
  );
  if (!ok) {
    status.textContent = 'Cancelado. No se aplicó el cambio de nombre.';
    return false;
  }

  status.textContent = 'Fusionando el duplicado…';
  // La ficha editada es el superviviente; la otra (other) es el perdedor.
  const target = { id: _editingRiderId, firstName, lastName, otherNames: payload.otherNames };
  const { ok: mergedOk, error: mergeErr } = await _mergeRidersSilent(other, target, table);
  if (!mergedOk) {
    status.textContent = 'No se pudo fusionar el duplicado: ' + (mergeErr || 'error');
    return false;
  }

  // Alias del DNI del perdedor → superviviente, para que un volcado futuro por el
  // nombre largo no vuelva a crear el duplicado (red de seguridad, como en el saneo).
  try {
    const gender = table === 'riders_men' ? 'male' : 'female';
    await supabase.from('rider_identity_aliases').insert({
      aliasKey: other.identityKey,
      gender,
      riderId: _editingRiderId,
      note: `dup fusionado al renombrar a ${firstName} ${lastName}`,
    });
  } catch (e) {
    console.warn('[rename clash] no se pudo crear alias:', e);
  }

  return true;
}

async function deleteRider() {
  if (!_editingRiderId) return;
  const rider = _ridersAllCache.find(r => r.id === _editingRiderId);
  const name  = rider ? `${rider.firstName} ${rider.lastName}` : _editingRiderId;

  // Avisar si tiene startlists enlazadas: al borrarlo quedarían apuntando a un
  // globalRiderId huérfano (página /rider/<id> no existiría). Limpiamos esos
  // links antes de borrar para que las apps vuelvan al snapshot.
  const { count: linkedCount } = await supabase
    .from('startlist_riders')
    .select('id', { count: 'exact', head: true })
    .eq('globalRiderId', _editingRiderId);
  const linkedMsg = linkedCount ? ` Aparece en ${linkedCount} startlist(s); sus filas perderán el link a BD (el snapshot del nombre se conserva).` : '';
  if (!await confirmDialog(`¿Eliminar a ${name}?${linkedMsg}`, { danger: true })) return;

  const status = document.getElementById('riderSaveStatus');
  status.textContent = 'Eliminando…';
  const table = _ridersGender === 'male' ? 'riders_men' : 'riders_women';
  try {
    if (linkedCount) {
      const { error: unlinkErr } = await supabase
        .from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', _editingRiderId);
      if (unlinkErr) throw new Error('Limpiando links: ' + unlinkErr.message);
    }
    const { error } = await supabase.from(table).delete().eq('id', _editingRiderId);
    if (error) throw error;
    closeRiderEditor();
    await _refreshOpenRoster();
    showToast('Corredor eliminado', 'success');
  } catch (err) {
    console.error('[deleteRider]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

// ── Fusionar dos riders en BD ───────────────────────────────────────
let _mergePickerEl = null;
function _closeMergePicker() {
  if (_mergePickerEl) { _mergePickerEl.remove(); _mergePickerEl = null; }
  document.removeEventListener('mousedown', _outsideMergePickerClick, true);
}
function _outsideMergePickerClick(e) {
  if (!_mergePickerEl) return;
  if (_mergePickerEl.contains(e.target)) return;
  if (e.target.closest('#mergeRiderBtn')) return;
  _closeMergePicker();
}

async function openMergeRiderPicker() {
  if (!_editingRiderId) return;
  _closeMergePicker();

  const source = _ridersAllCache.find(r => r.id === _editingRiderId);
  if (!source) { showToast('Carga el corredor antes de fusionarlo', 'error'); return; }
  const table = _ridersGender === 'male' ? 'riders_men' : 'riders_women';

  // Contar startlists del source para mostrar impacto al admin.
  const { count: linkedCount } = await supabase
    .from('startlist_riders')
    .select('id', { count: 'exact', head: true })
    .eq('globalRiderId', _editingRiderId);

  const popover = document.createElement('div');
  popover.style.cssText = 'position:absolute;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.75rem;width:420px;max-height:480px;overflow:auto;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
  popover.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text);margin-bottom:0.6rem">
      <div style="font-weight:700;margin-bottom:0.2rem">Fusionar corredor</div>
      <div class="u-fs-xs u-c-dim">
        Origen: <strong style="color:var(--text)">${esc(source.lastName)}, ${esc(source.firstName)}</strong> (${linkedCount || 0} startlist${linkedCount === 1 ? '' : 's'} linkada${linkedCount === 1 ? '' : 's'})
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.15rem">Elige el corredor destino al que moverlas. El origen se eliminará.</div>
    </div>
    <input type="search" class="merge-picker-input" placeholder="Buscar destino por apellido, nombre u otherNames…"
           style="width:100%;padding:0.4rem 0.6rem;font-size:0.82rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none;box-sizing:border-box;margin-bottom:0.4rem">
    <div class="merge-picker-results" style="display:flex;flex-direction:column;gap:0.2rem;min-height:1.2rem"></div>
    <div style="margin-top:0.6rem;border-top:1px solid var(--border);padding-top:0.5rem;text-align:right">
      <button data-action="close" type="button" class="btn btn--ghost" style="padding:0.3rem 0.6rem;font-size:0.72rem">Cancelar</button>
    </div>`;

  const anchor = document.getElementById('mergeRiderBtn');
  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = (rect.left + window.scrollX) + 'px';
  popover.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  const popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 16) {
    popover.style.left = (window.innerWidth - popRect.width - 16) + 'px';
  }
  _mergePickerEl = popover;

  const input = popover.querySelector('.merge-picker-input');
  const results = popover.querySelector('.merge-picker-results');
  let reqId = 0;

  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    if (q.length < 2) {
      results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Escribe al menos 2 letras.</div>';
      return;
    }
    results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Buscando…</div>';
    const safe = q.replace(/[%,()]/g, '');
    const { data, error } = await supabase.from(table)
      .select('id,firstName,lastName,otherNames,nationality,currentTeamId,verified,source')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .neq('id', _editingRiderId)   // no permitir auto-merge
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div style="color:var(--red);font-size:0.72rem;padding:0.3rem">Error: ${esc(error.message)}</div>`; return; }
    if (!data?.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-xs u-p-xs">Sin resultados.</div>';
      return;
    }
    results.innerHTML = data.map(rd => `
      <button type="button" data-tid="${esc(rd.id)}" style="display:flex;align-items:center;gap:0.4rem;padding:0.4rem 0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;text-align:left;font-size:0.78rem;color:var(--text);width:100%">
        ${_slRiderFlagPreview(rd.nationality)}
        <span class="u-grow u-min0"><strong>${esc(rd.lastName)}</strong>, ${esc(rd.firstName)}${rd.otherNames ? ` <span class="u-c-dim u-fs-070">(${esc(rd.otherNames)})</span>` : ''}</span>
        ${rd.verified === false ? '<span title="Sin verificar" style="color:#f59e0b;font-size:0.65rem;font-weight:700">?</span>' : '<span title="Verificado" style="color:#22c55e;font-size:0.65rem;font-weight:700">✓</span>'}
      </button>`).join('');
    results.querySelectorAll('[data-tid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = data.find(x => x.id === btn.dataset.tid);
        if (target) executeMerge(source, target, linkedCount || 0);
      });
    });
  };

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _closeMergePicker(); });
  popover.querySelector('[data-action="close"]').addEventListener('click', _closeMergePicker);

  if (source.lastName) input.value = source.lastName;
  search();
  setTimeout(() => { input.focus(); input.select(); }, 0);
  setTimeout(() => document.addEventListener('mousedown', _outsideMergePickerClick, true), 0);
}

async function executeMerge(source, target, linkedCount) {
  const status = document.getElementById('riderSaveStatus');
  const msg = `Vas a:
  • Mover ${linkedCount} startlist(s) de "${source.lastName}, ${source.firstName}" → "${target.lastName}, ${target.firstName}"
  • Eliminar "${source.lastName}, ${source.firstName}" (id ${source.id}) de la BD

Esta acción no se puede deshacer. ¿Continuar?`;
  if (!await confirmDialog(msg, { danger: true })) return;

  _closeMergePicker();
  status.textContent = 'Fusionando…';
  const table = _ridersGender === 'male' ? 'riders_men' : 'riders_women';

  try {
    // 1. Reapuntar las startlist_riders del source al target.
    if (linkedCount > 0) {
      const { error: upErr } = await supabase
        .from('startlist_riders')
        .update({ globalRiderId: target.id })
        .eq('globalRiderId', source.id);
      if (upErr) throw new Error('Re-link startlists: ' + upErr.message);
    }

    // 2. Si el source tiene otherNames únicos, los acumulamos en el target
    //    para preservar variantes de matching.
    const srcAliases = (source.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const tgtAliases = (target.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const merged = [...new Set([...tgtAliases, ...srcAliases, source.lastName !== target.lastName ? source.lastName : null].filter(Boolean))];
    const newOther = merged.join(', ');
    if (newOther !== (target.otherNames || '')) {
      const { error: upTErr } = await supabase
        .from(table).update({ otherNames: newOther, updatedAt: new Date().toISOString() }).eq('id', target.id);
      if (upTErr) console.warn('[merge] no se pudo actualizar otherNames del target:', upTErr);
    }

    // 3. Eliminar el source.
    const { error: delErr } = await supabase.from(table).delete().eq('id', source.id);
    if (delErr) throw new Error('DELETE source: ' + delErr.message);

    showToast(`Fusión OK: ${linkedCount} startlist(s) movidas y ${source.id} eliminado.`, 'success');
    closeRiderEditor();
    await _refreshOpenRoster();
  } catch (err) {
    console.error('[executeMerge]', err);
    status.textContent = 'Error: ' + (err.message || err);
    showToast('Error en la fusión — revisa la consola', 'error');
  }
}

// ── Detector de duplicados ──────────────────────────────────────────
// Heurística: agrupa por (lastName_normalizado, primera_letra_firstName_normalizado).
// Score por cluster: misma nacionalidad +2, mismo equipo +1, firstName completo
// idéntico +3, mezcla verified/unverified +2. Los de score alto son los más
// probables duplicados y se muestran primero.

function _dupNorm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

// ¿Comparten estos dos riders alguna carrera? Si sí, son PERSONAS DISTINTAS con
// práctica certeza (nadie corre dos veces la misma carrera) → NO fusionar.
// Usa el mapa racesByRider que ya carga el escáner (sin consulta extra).
function _dupShareRace(a, b, racesByRider) {
  const ra = racesByRider.get(a.id), rb = racesByRider.get(b.id);
  if (!ra || !rb || !ra.length || !rb.length) return false;
  const set = new Set(ra.map(r => r.raceId));
  return rb.some(r => set.has(r.raceId));
}

// Señal "mismo humano por nombre": uno es prefijo del otro (nombre incompleto vs
// con 2º nombre: "Sven" ⊂ "Sven Aleksander") o difieren en muy poco (typo /
// transliteración: "Jillian"/"Jilllian", "Yulia"/"Yuliia").
function _dupNameLikelySame(a, b) {
  const na = _dupNorm(a.firstName), nb = _dupNorm(b.firstName);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;   // prefijo
  if (Math.abs(na.length - nb.length) <= 2 && _dupEditDistance(na, nb) <= 2) return true;
  return false;
}

// Levenshtein simple (sin dependencias; nombres son cortos).
function _dupEditDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Devuelve { score, distinct } para un cluster. Si racesByRider está disponible,
// refina: penaliza fuerte los pares que comparten carrera (personas distintas) y
// premia los que comparten fecha de nacimiento o nombre casi idéntico.
function _scoreDupCluster(riders, racesByRider = null) {
  const nationalities = new Set(riders.map(r => r.nationality).filter(Boolean));
  const teams         = new Set(riders.map(r => r.currentTeamId).filter(Boolean));
  const firstNames    = new Set(riders.map(r => _dupNorm(r.firstName)));
  const hasVerified   = riders.some(r => r.verified === true);
  const hasUnverified = riders.some(r => r.verified === false);
  let s = 0;
  if (nationalities.size <= 1)                s += 2;   // todos misma nat (o NULL)
  if (teams.size === 1)                       s += 1;
  if (firstNames.size === 1 && [...firstNames][0]) s += 3;  // nombre exacto idéntico
  if (hasVerified && hasUnverified)           s += 2;

  // Señales por par (solo con el mapa de carreras cargado).
  let anyShareRace = false, anySameDob = false, anyNameSame = false;
  if (racesByRider) {
    for (let i = 0; i < riders.length; i++) {
      for (let j = i + 1; j < riders.length; j++) {
        const a = riders[i], b = riders[j];
        if (_dupShareRace(a, b, racesByRider)) anyShareRace = true;
        if (a.birthDate && b.birthDate && a.birthDate === b.birthDate) anySameDob = true;
        if (_dupNameLikelySame(a, b)) anyNameSame = true;
      }
    }
  }
  // Misma fecha de nacimiento = señal fuerte de mismo humano (salvo gemelos, que
  // suelen compartir carrera → los caza anyShareRace). Nombre casi idéntico = idem.
  if (anySameDob)  s += 4;
  if (anyNameSame) s += 3;
  // Compartir carrera DESCARTA: son personas distintas. Hundir el cluster.
  if (anyShareRace) s -= 10;

  return { score: s, distinct: anyShareRace };
}

// Catálogo (masc/fem) que escanea el detector de duplicados. Independiente del
// editor: el escáner se dispara desde Equipos y tiene su propio toggle en el modal.
let _dupScanGender = 'male';
const _updateDupScanGenderToggle = () =>
  setGenderToggleActive('dupScanGenderMale', 'dupScanGenderFemale', _dupScanGender);

// Cuerpo del escáner de duplicados (mismos ids que el markup estático que
// sustituye). El ✕ lo da el drawer; el toggle masc/fem se cablea por apertura.
function dupScanBodyHtml() {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
      <div class="u-fs-md u-c-dim" id="dupScanSubtitle"></div>
      ${genderToggleHtml({ idMale: 'dupScanGenderMale', idFemale: 'dupScanGenderFemale', value: _dupScanGender, labels: { male: 'Masculino', female: 'Femenino' } })}
    </div>
    <div class="u-stack" id="dupScanContent"></div>`;
}

function wireDupScan() {
  wireGenderToggle('dupScanGenderMale', 'dupScanGenderFemale', (g) => {
    _dupScanGender = g; _updateDupScanGenderToggle(); openDuplicateScanner();
  });
}

async function openDuplicateScanner() {
  // Montar el escáner en el drawer (ancho). Si ya está abierto (p.ej. al
  // togglear género), se reusa y solo se re-renderiza el contenido.
  if (!document.getElementById('dupScanContent')) {
    openDrawer({
      title: 'Posibles duplicados',
      level: 1,
      wide: true,
      render: (body) => { body.innerHTML = dupScanBodyHtml(); wireDupScan(); },
    });
  }
  const content = document.getElementById('dupScanContent');
  const subtitle = document.getElementById('dupScanSubtitle');
  _updateDupScanGenderToggle();
  content.innerHTML = '<div class="u-empty-note">Cargando catálogo…</div>';
  subtitle.textContent = `Catálogo: ${_dupScanGender === 'male' ? 'masculino' : 'femenino'}`;

  const table = _dupScanGender === 'male' ? 'riders_men' : 'riders_women';
  // PostgREST aplica un tope server-side de 1.000 filas que ignora .range()
  // por encima de ese valor. Paginamos manualmente en chunks de 1.000 hasta
  // agotar la tabla para garantizar el barrido COMPLETO del catálogo.
  const riders = [];
  let error = null;
  let offset = 0;
  const CHUNK = 1000;
  while (true) {
    // Paginar por una clave ÚNICA (id), no por lastName: lastName se repite mucho
    // (cientos de apellidos iguales) y PostgREST no garantiza orden estable entre
    // páginas con claves no únicas → filas del borde se duplican o se saltan
    // (causa del "mismo corredor ×2" en el escáner).
    const { data, error: err } = await supabase
      .from(table).select('*').order('id').range(offset, offset + CHUNK - 1);
    if (err) { error = err; break; }
    if (!data || !data.length) break;
    riders.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
    content.innerHTML = `<div class="u-empty-note">Cargando catálogo… ${riders.length} corredores leídos</div>`;
  }
  if (error) {
    content.innerHTML = `<div style="color:var(--red);padding:1rem">Error: ${esc(error.message)}</div>`;
    return;
  }

  const groups = new Map();
  for (const r of (riders || [])) {
    const last = _dupNorm(r.lastName);
    const firstInitial = _dupNorm(r.firstName).charAt(0);
    if (!last) continue;
    const key = `${last}|${firstInitial}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const skipped = _getDupSkipSet();
  const clusters = [];
  let skippedCount = 0;
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const idsKey = list.map(r => r.id).sort().join('|');
    if (skipped.has(idsKey)) { skippedCount++; continue; }
    // Score base (sin carreras todavía). Se refina tras cargar racesByRider.
    const base = _scoreDupCluster(list);
    clusters.push({ key, idsKey, riders: list, score: base.score, distinct: base.distinct });
  }
  clusters.sort((a, b) => b.score - a.score || b.riders.length - a.riders.length);

  subtitle.innerHTML = `${clusters.length} grupos a revisar en ${riders.length} ${_dupScanGender === 'male' ? 'corredores' : 'corredoras'} · ordenados por probabilidad${skippedCount ? ` · <button id="dupClearSkipped" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;text-decoration:underline">${skippedCount} saltados (limpiar)</button>` : ''}.`;
  document.getElementById('dupClearSkipped')?.addEventListener('click', async () => {
    if (await confirmDialog(`¿Olvidar los ${skippedCount} grupos saltados y volver a mostrarlos?`)) {
      _clearDupSkipSet();
      openDuplicateScanner();
    }
  });

  if (!clusters.length) {
    content.innerHTML = `<div class="u-empty-note">${skippedCount ? `Sin duplicados nuevos. ${skippedCount} grupos saltados previamente.` : 'Sin duplicados aparentes 🎉'}</div>`;
    return;
  }

  // Carga las carreras donde aparece cada rider de los clusters detectados,
  // para mostrarlas en cada fila como ayuda al admin (saber dónde se ha visto
  // a cada candidato facilita decidir cuál es el canónico).
  content.innerHTML = '<div class="u-empty-note">Cargando carreras…</div>';
  const allClusterIds = [...new Set(clusters.flatMap(c => c.riders.map(r => r.id)))];
  const racesByRider = await _loadRacesForRiders(allClusterIds);

  // Ahora que tenemos las carreras, refinamos score+distinct (compartir carrera =
  // personas distintas → se hunde; misma fecha / nombre casi idéntico → sube) y
  // reordenamos: los duplicados REALES suben arriba, los falsos positivos
  // (gemelos, hermanos, homónimos) caen al fondo.
  for (const c of clusters) {
    const refined = _scoreDupCluster(c.riders, racesByRider);
    c.score = refined.score;
    c.distinct = refined.distinct;
  }
  clusters.sort((a, b) => b.score - a.score || b.riders.length - a.riders.length);

  _renderDupClusters(clusters, table, racesByRider);
}

// Map<riderId, [{raceId, name, year}, ...]> para cada rider que aparece en
// startlist_riders. Pagina chunks de 200 IDs (URL length) × páginas de 1000
// (límite PostgREST) y deduplica por raceId.
async function _loadRacesForRiders(riderIds) {
  const map = new Map();
  if (!riderIds.length) return map;
  const CHUNK = 200;
  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const slice = riderIds.slice(i, i + CHUNK);
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('startlist_riders')
        .select('globalRiderId, raceId, races!inner(name, year)')
        .in('globalRiderId', slice)
        .range(offset, offset + 999);
      if (error) { console.warn('[loadRacesForRiders]', error); break; }
      if (!data?.length) break;
      for (const row of data) {
        const rid = row.globalRiderId;
        if (!map.has(rid)) map.set(rid, new Map());
        const inner = map.get(rid);
        if (!inner.has(row.raceId)) {
          inner.set(row.raceId, { raceId: row.raceId, name: row.races?.name || row.raceId, year: row.races?.year });
        }
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  // Convertir Maps internos a arrays ordenados por año desc
  const out = new Map();
  for (const [rid, inner] of map) {
    out.set(rid, [...inner.values()].sort((a, b) => (b.year || 0) - (a.year || 0)));
  }
  return out;
}

// Persistencia local de los clusters saltados (per-navegador, suficiente para
// una herramienta de admin individual). La clave es el join de IDs ordenados;
// si alguno de los riders del cluster cambia (fusión externa, edición), el
// cluster pasa a tener IDs distintos y vuelve a aparecer.
const DUP_SKIP_KEY = 'cc_dupScanSkipped';
function _getDupSkipSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DUP_SKIP_KEY) || '[]')); }
  catch { return new Set(); }
}
function _addDupSkip(idsKey) {
  const s = _getDupSkipSet();
  s.add(idsKey);
  localStorage.setItem(DUP_SKIP_KEY, JSON.stringify([...s]));
}
function _clearDupSkipSet() {
  localStorage.removeItem(DUP_SKIP_KEY);
}

function _renderDupClusters(clusters, table, racesByRider = new Map()) {
  const content = document.getElementById('dupScanContent');
  const teamsMap = Object.fromEntries((_teamsCache || []).map(t => [t.id, t]));

  // Helper para listar las carreras de un rider de forma compacta.
  const racesChip = (riderId) => {
    const races = racesByRider.get(riderId) || [];
    if (!races.length) return '<span style="font-size:0.68rem;color:var(--text-dim);font-style:italic">sin startlists</span>';
    const fullList = races.map(r => `${r.name}${r.year ? ' ' + r.year : ''}`).join(' · ');
    const visible = races.slice(0, 3).map(r => `<span style="background:var(--bg-card-hover);border:1px solid var(--border);border-radius:3px;padding:0.05rem 0.3rem;font-size:0.66rem;color:var(--text-dim);white-space:nowrap">${esc(r.name || r.raceId)}${r.year ? ` <span style="opacity:0.7">${r.year}</span>` : ''}</span>`).join(' ');
    const more = races.length > 3 ? ` <span style="font-size:0.66rem;color:var(--text-dim);cursor:help" title="${esc(fullList)}">+${races.length - 3} más</span>` : '';
    return `<span style="display:inline-flex;flex-wrap:wrap;gap:0.2rem;align-items:center" title="${esc(fullList)}">${visible}${more}</span>`;
  };

  content.innerHTML = clusters.map((c, idx) => {
    const sample = c.riders[0];
    const headerName = `${sample.lastName}, ${_dupNorm(sample.firstName).charAt(0).toUpperCase() || '·'}…`;
    // distinct = comparten al menos una carrera → personas distintas con certeza.
    // Se avisa explícitamente para que el admin NO los fusione por error.
    const scoreBadge = c.distinct
      ? '<span title="Comparten carrera → no pueden ser la misma persona" style="background:#64748b22;color:#94a3b8;border:1px solid #64748b66;border-radius:4px;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:700">⚠ DISTINTOS (misma carrera)</span>'
      : c.score >= 7
        ? '<span style="background:#ef444422;color:#ef4444;border:1px solid #ef444466;border-radius:4px;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:700">PROBABLE</span>'
        : c.score >= 4
          ? '<span style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b66;border-radius:4px;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:700">POSIBLE</span>'
          : '<span style="background:var(--bg-card-hover);color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:700">DUDOSO</span>';

    const ridersHtml = c.riders.map(r => {
      const team = teamsMap[r.currentTeamId];
      const checked = r.verified === true ? 'checked' : '';
      // Inputs editables: el admin puede afinar firstName/lastName/nationality
      // directamente en la fila antes (o sin) fusionar. Cada fila tiene un
      // botón "Guardar" que aplica los cambios SOLO a esa fila sin fusionar.
      const inputStyle = 'background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.35rem;font-size:0.78rem;color:var(--text);outline:none;min-width:0';
      // Guardamos el estado original como data-attrs para detectar cambios.
      const origLast = r.lastName || '';
      const origFirst = r.firstName || '';
      const origNat = r.nationality || '';
      return `<div data-rider-id="${esc(r.id)}" data-orig-last="${esc(origLast)}" data-orig-first="${esc(origFirst)}" data-orig-nat="${esc(origNat)}" style="display:flex;flex-direction:column;gap:0.25rem;padding:0.4rem 0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:0.8rem">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <input type="radio" name="dup-cluster-${idx}" value="${esc(r.id)}" ${checked} title="Marcar como canónico" style="margin:0;flex-shrink:0;cursor:pointer">
          <span class="dup-flag-preview" style="min-width:1.4rem;text-align:center;flex-shrink:0">${_slRiderFlagPreview(r.nationality)}</span>
          <input type="text" class="dup-lastname" value="${esc(origLast)}" placeholder="Apellidos" style="${inputStyle};flex:1.4;min-width:8rem;font-weight:700">
          <input type="text" class="dup-firstname" value="${esc(origFirst)}" placeholder="Nombre" style="${inputStyle};flex:1.2;min-width:6rem">
          <input type="text" class="dup-nationality" value="${esc(origNat)}" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2" style="${inputStyle};width:3.2rem;flex-shrink:0;text-transform:lowercase;text-align:center">
          <button data-dup-action="save-row" title="Guardar cambios de esta fila (sin fusionar)" disabled style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:0.2rem 0.5rem;font-size:0.7rem;cursor:pointer;flex-shrink:0;opacity:0.45">💾</button>
          ${r.otherNames ? `<span style="color:var(--text-dim);font-size:0.7rem;flex-shrink:0" title="otherNames: ${esc(r.otherNames)}">+aliases</span>` : ''}
          <span style="font-size:0.68rem;color:${r.verified ? '#22c55e' : '#f59e0b'};font-weight:700;flex-shrink:0">${r.verified ? '✓' : '?'}</span>
          <span style="font-size:0.68rem;color:var(--text-dim);flex-shrink:0">${esc(r.source || '')}</span>
          <span style="font-size:0.7rem;color:var(--text-dim);white-space:nowrap;max-width:12rem;overflow:hidden;text-overflow:ellipsis;flex-shrink:0">${team ? esc(team.name) : '<em>sin equipo</em>'}</span>
          <code style="font-size:0.62rem;color:var(--text-dim);flex-shrink:0">${esc(r.id)}</code>
        </div>
        <div style="padding-left:1.6rem">${racesChip(r.id)}</div>
      </div>`;
    }).join('');

    return `<div data-cluster-idx="${idx}" style="border:1px solid var(--border);border-radius:8px;padding:0.75rem;background:var(--bg-card-hover)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;gap:0.5rem;flex-wrap:wrap">
        <div class="u-row">
          <strong style="font-size:0.85rem">${esc(headerName)}</strong>
          <span class="u-fs-xs u-c-dim">${c.riders.length} candidatos</span>
          ${scoreBadge}
        </div>
        <div style="display:flex;gap:0.4rem">
          <button data-dup-action="merge" data-cluster-idx="${idx}" class="btn btn--primary" style="padding:0.3rem 0.7rem;font-size:0.72rem">Fusionar en el seleccionado</button>
          <button data-dup-action="skip" data-cluster-idx="${idx}" class="btn btn--ghost" style="padding:0.3rem 0.7rem;font-size:0.72rem">Saltar</button>
        </div>
      </div>
      <div class="u-stack u-stack--xs">${ridersHtml}</div>
    </div>`;
  }).join('');

  // Listeners
  content.querySelectorAll('[data-dup-action="skip"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.clusterIdx);
      const cluster = clusters[idx];
      // Persistir el "saltar" en localStorage. Mientras los IDs del cluster
      // no cambien (fusión, edición), no se volverá a mostrar.
      if (cluster?.idsKey) _addDupSkip(cluster.idsKey);
      content.querySelector(`[data-cluster-idx="${idx}"]`).remove();
    });
  });
  // Detección de cambios en cualquier input → habilita el botón Guardar.
  // Y al teclear nacionalidad, refresca la bandera.
  const _toggleRowSave = (row) => {
    const last  = row.querySelector('.dup-lastname').value.trim();
    const first = row.querySelector('.dup-firstname').value.trim();
    const nat   = row.querySelector('.dup-nationality').value.trim().toLowerCase();
    const dirty = (
      last  !== (row.dataset.origLast  || '') ||
      first !== (row.dataset.origFirst || '') ||
      nat   !== (row.dataset.origNat   || '')
    ) && last && first;
    const btn = row.querySelector('[data-dup-action="save-row"]');
    if (btn) { btn.disabled = !dirty; btn.style.opacity = dirty ? '1' : '0.45'; }
  };
  content.querySelectorAll('[data-rider-id]').forEach(row => {
    row.querySelectorAll('.dup-lastname, .dup-firstname, .dup-nationality').forEach(inp => {
      inp.addEventListener('input', () => {
        if (inp.classList.contains('dup-nationality')) {
          const flagEl = row.querySelector('.dup-flag-preview');
          if (flagEl) flagEl.innerHTML = _slRiderFlagPreview(inp.value.trim().toLowerCase());
        }
        _toggleRowSave(row);
      });
    });
  });
  content.querySelectorAll('[data-dup-action="save-row"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-rider-id]');
      const id  = row.dataset.riderId;
      const last  = row.querySelector('.dup-lastname').value.trim();
      const first = row.querySelector('.dup-firstname').value.trim();
      const natRaw = row.querySelector('.dup-nationality').value.trim().toLowerCase();
      const nat = natRaw || null;
      if (!last || !first) { showToast('Necesita nombre y apellido', 'error'); return; }
      btn.disabled = true; btn.textContent = '…';
      const { error } = await supabase.from(table).update({
        firstName: first, lastName: last, nationality: nat,
        verified: true,  // editar manualmente implica validación
        updatedAt: new Date().toISOString(),
      }).eq('id', id);
      if (error) {
        btn.disabled = false; btn.textContent = '💾';
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          // Renombrar esta ficha la dejaría con el mismo DNI que otra existente.
          // Si las dos son la MISMA persona, no la edites: fusiónalas (botón
          // "Fusionar en el seleccionado"). Si es otra persona, ponle un nombre
          // distinto.
          showToast('Ese nombre ya lo tiene otro corredor (mismo DNI). Si es el mismo, fusiónalos en vez de editar; si es otro, usa un nombre distinto.', 'error');
        } else {
          showToast('Error: ' + error.message, 'error');
        }
        return;
      }
      // Actualizar baseline + objeto en memoria del cluster
      row.dataset.origLast = last;
      row.dataset.origFirst = first;
      row.dataset.origNat = natRaw;
      const cluster = clusters.find(c => c.riders.some(r => r.id === id));
      const cached = cluster?.riders.find(r => r.id === id);
      if (cached) { cached.firstName = first; cached.lastName = last; cached.nationality = nat; cached.verified = true; }
      btn.textContent = '💾'; btn.style.opacity = '0.45';
      // Flash verde breve para feedback visual
      const prevBg = row.style.background;
      row.style.background = '#22c55e22';
      setTimeout(() => { row.style.background = prevBg; }, 600);
      showToast('Guardado', 'success');
    });
  });
  content.querySelectorAll('[data-dup-action="merge"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.clusterIdx);
      const cluster = clusters[idx];
      const selected = content.querySelector(`input[name="dup-cluster-${idx}"]:checked`);
      if (!selected) { showToast('Marca el corredor que se queda', 'error'); return; }
      const targetId = selected.value;
      const target = cluster.riders.find(r => r.id === targetId);
      const sources = cluster.riders.filter(r => r.id !== targetId);

      // Leer valores editados de la fila seleccionada (puede que el admin haya
      // ajustado mayúsculas, apellido compuesto o nacionalidad).
      const targetRow = selected.closest('[data-rider-id]');
      const editedFirst = (targetRow.querySelector('.dup-firstname').value || '').trim();
      const editedLast  = (targetRow.querySelector('.dup-lastname').value  || '').trim();
      const editedNatRaw = (targetRow.querySelector('.dup-nationality').value || '').trim().toLowerCase();
      const editedNat = editedNatRaw || null;

      if (!editedFirst || !editedLast) { showToast('El canónico necesita nombre y apellido', 'error'); return; }

      const targetChanged =
        editedFirst !== (target.firstName || '') ||
        editedLast  !== (target.lastName  || '') ||
        editedNat   !== (target.nationality || null);

      const summary = `Fusionar ${sources.length} corredor(es) en "${editedLast}, ${editedFirst}"${editedNat ? ' (' + editedNat + ')' : ''}?

${targetChanged ? '• El canónico se actualizará con los valores editados (verified=true).\n' : ''}• Todas las startlists de los demás se reapuntarán al canónico.
• Los demás se eliminarán de la BD.`;
      if (!await confirmDialog(summary, { danger: true, title: 'Fusionar corredores' })) return;

      btn.disabled = true; btn.textContent = 'Fusionando…';

      // ORDEN CLAVE: borrar los duplicados PRIMERO, editar el canónico DESPUÉS.
      // Si editáramos el canónico antes, su identityKey recalculado (trigger 075)
      // podría chocar con el de un duplicado del MISMO cluster que aún no se ha
      // borrado → el índice UNIQUE rechaza el UPDATE ("duplicate key identity_key").
      // Refrescamos el objeto target en memoria con los valores editados para que
      // _mergeRidersSilent consolide otherNames bien (no depende de que el UPDATE
      // ya esté en BD).
      target.firstName   = editedFirst;
      target.lastName    = editedLast;
      target.nationality = editedNat;

      // 1. Fusionar/borrar los perdedores (libera sus identityKey del índice).
      let merged = 0;
      let failed = 0;
      for (const src of sources) {
        const { ok, error } = await _mergeRidersSilent(src, target, table);
        if (ok) merged++; else { failed++; console.error('[merge]', src.id, error); }
      }

      // 2. Aplicar la edición al canónico (verified=true: el admin lo revisó).
      //    Ya borrados los duplicados del cluster, un identityKey que solo chocaba
      //    con ellos pasa sin problema. Si AÚN choca, es un homónimo de FUERA del
      //    cluster (otra persona real) → mensaje claro en vez del error crudo.
      if (targetChanged || target.verified !== true) {
        const { error: upErr } = await supabase.from(table).update({
          firstName: editedFirst,
          lastName: editedLast,
          nationality: editedNat,
          verified: true,
          updatedAt: new Date().toISOString(),
        }).eq('id', target.id);
        if (upErr) {
          btn.disabled = false; btn.textContent = 'Fusionar en el seleccionado';
          if (upErr.code === '23505' && /identity_key/i.test(upErr.message || '')) {
            showToast('Los duplicados se fusionaron, pero ese nombre ya lo tiene OTRO corredor (mismo DNI) fuera de este grupo. Edítalo distinto o déjalo como estaba.', 'error');
          } else {
            showToast('Duplicados fusionados, pero no se pudo guardar el nombre editado: ' + upErr.message, 'error');
          }
          content.querySelector(`[data-cluster-idx="${idx}"]`)?.remove();
          return;
        }
        target.verified = true;
      }

      content.querySelector(`[data-cluster-idx="${idx}"]`).remove();
      showToast(failed
        ? `Fusionados ${merged}/${sources.length}. Errores: ${failed}. Revisa consola.`
        : `${merged} corredor(es) fusionados en ${target.lastName}.`,
        failed ? 'error' : 'success');
    });
  });
}

async function _mergeRidersSilent(source, target, table) {
  try {
    // 1. Re-link startlists
    const { error: upErr } = await supabase
      .from('startlist_riders').update({ globalRiderId: target.id }).eq('globalRiderId', source.id);
    if (upErr) return { ok: false, error: upErr.message };

    // 2. Acumular otherNames del source en target (mantiene matching futuro)
    const srcAliases = (source.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const tgtAliases = (target.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const merged = [...new Set([...tgtAliases, ...srcAliases,
      source.lastName !== target.lastName ? source.lastName : null].filter(Boolean))];
    const newOther = merged.join(', ');
    if (newOther !== (target.otherNames || '')) {
      const { error: upT } = await supabase.from(table)
        .update({ otherNames: newOther, updatedAt: new Date().toISOString() }).eq('id', target.id);
      if (upT) console.warn('[merge silent] no actualizó otherNames:', upT);
    }

    // 3. Repuntar afiliaciones temporales del perdedor al superviviente.
    //    El panel viejo NO tocaba rider_team_affiliations → al borrar el perdedor sus
    //    afiliaciones quedaban colgando (riderId muerto, sin FK que las arrastre) y el
    //    superviviente podía perder la del año. Política "superviviente manda": solo se
    //    traslada una afiliación del perdedor si el superviviente NO tiene ya una del
    //    mismo (teamId, year). El id de la fila es `riderId__teamId__year`, así que
    //    trasladar = INSERTAR una fila nueva con el id del superviviente (no basta con
    //    UPDATE de riderId). Luego se borran TODAS las del perdedor (no hay ON DELETE
    //    CASCADE hacia riders_*, así que el DELETE del paso 4 no las limpiaría solo).
    const gender = table === 'riders_men' ? 'male' : 'female';
    const { data: srcAffs, error: affErr } = await supabase
      .from('rider_team_affiliations')
      .select('*').eq('riderId', source.id).eq('riderGender', gender);
    if (affErr) {
      console.warn('[merge silent] no leyó afiliaciones del perdedor:', affErr);
    } else if (srcAffs && srcAffs.length) {
      const { data: tgtAffs } = await supabase
        .from('rider_team_affiliations')
        .select('teamId,year').eq('riderId', target.id).eq('riderGender', gender);
      const tgtKeys = new Set((tgtAffs || []).map(a => `${a.teamId}__${a.year}`));
      const toMove = srcAffs
        .filter(a => !tgtKeys.has(`${a.teamId}__${a.year}`))
        .map(a => ({
          ...a,
          id: `${target.id}__${a.teamId}__${a.year}`,
          riderId: target.id,
          updatedAt: new Date().toISOString(),
        }));
      if (toMove.length) {
        const { error: insErr } = await supabase
          .from('rider_team_affiliations').upsert(toMove, { onConflict: 'id' });
        if (insErr) return { ok: false, error: 'trasladar afiliaciones: ' + insErr.message };
      }
      // Borrar todas las afiliaciones del perdedor (las trasladadas ya están copiadas
      // bajo el id del superviviente; las colisionantes se descartan).
      const { error: delAffErr } = await supabase
        .from('rider_team_affiliations')
        .delete().eq('riderId', source.id).eq('riderGender', gender);
      if (delAffErr) return { ok: false, error: 'limpiar afiliaciones: ' + delAffErr.message };
    }

    // 4. DELETE source
    const { error: delErr } = await supabase.from(table).delete().eq('id', source.id);
    if (delErr) return { ok: false, error: delErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE NOTIFICACIONES PUSH
// ═════════════════════════════════════════════════════════════════

const SEND_PUSH_FN = `${SUPABASE_URL}/functions/v1/send-push`;
let _notificationsInitialized = false;
let _pushRaceDays = []; // cache de jornadas para la carrera seleccionada

// ── Resolver deep link value a partir de los selectores en cascada ──
function getComposedDeepLink() {
  const type = document.getElementById('push-deepLinkType').value;
  if (!type) return '';
  if (type === 'tab') return document.getElementById('push-deepLinkTab').value || '';
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
  if (dl.startsWith('race/'))       return `Competición`;
  if (dl.startsWith('stage/'))      return `Jornada`;
  if (dl.startsWith('startlist/'))  return `Dorsales`;
  if (dl.startsWith('startOrder/')) return `Orden de salida`;
  if (dl.startsWith('perfil/'))     return `Perfil de etapa`;
  if (dl.startsWith('team/'))       return `Equipo (Mercado de Fichajes)`;
  const tabLabels = { today: 'Hoy', month: 'Mes', season: 'Temporada', search: 'Buscar', subscribe: 'Suscripción', notifications: 'Avisos', transfers: 'Mercado de Fichajes' };
  return tabLabels[dl] || dl;
}

async function setupNotificationsView() {
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
  }

  titleInput.addEventListener('input', updatePreview);
  subtitleInput.addEventListener('input', updatePreview);
  imageInput.addEventListener('input', updatePreview);

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
  let pushMarketTeams = [];

  function populatePushRaceList(query) {
    const q = (query || '').toLowerCase();
    const year = new Date().getFullYear();
    let filtered = allRaces.filter(r => (r.year || year) === year);
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
    let filtered = allRaces.filter(r => (r.startlistImportedAt != null) && (r.year || year) === year);
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
    uploadBtn.style.cssText = 'display:inline-flex;align-items:center;gap:0.4rem;padding:0.4rem 0.75rem;background:var(--bg);border:1px dashed var(--border);border-radius:8px;cursor:pointer;font-size:0.78rem;color:var(--text-dim);flex-shrink:0';
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
        const filename = `push/${Date.now()}-${file.name.replace(/\s/g, '-')}`;
        const buf = await file.arrayBuffer();
        const res = await r2PutObject(filename, buf, file.type);
        if (!res.ok) throw new Error('Error al subir imagen');
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
    if (countEl) countEl.textContent = `${rows.length} dispositivo${rows.length !== 1 ? 's' : ''}`;
  } catch (err) {
    console.error('[push-debug] Error cargando dispositivos:', err);
    sel.innerHTML = '<option value="">— Error cargando dispositivos —</option>';
    if (countEl) countEl.textContent = String(err?.message || err);
  } finally {
    sel.disabled = false;
  }
}

function _clearPushForm() {
  document.getElementById('push-title').value = '';
  document.getElementById('push-subtitle').value = '';
  document.getElementById('push-imageUrl').value = '';
  document.getElementById('push-deepLinkType').value = '';
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

async function sendPushNotification() {
  const title    = document.getElementById('push-title').value.trim();
  const subtitle = document.getElementById('push-subtitle').value.trim();
  const imageUrl = document.getElementById('push-imageUrl').value.trim();
  const deepLink = getComposedDeepLink();
  // El panel manual siempre envía categoría 'general'. Las categorías
  // Premium (race_start, tv_start, results) las genera el cron
  // auto_dispatch_premium_pushes automáticamente desde race_days/broadcasts.
  const category = 'general';
  const targetPlatforms = _getSelectedTargetPlatforms();
  const debugToken = document.getElementById('push-debug-token')?.value?.trim() || '';
  const errorDiv = document.getElementById('pushSendError');
  const statusEl = document.getElementById('pushSendStatus');
  const btn      = document.getElementById('sendPushBtn');
  const isScheduled = document.getElementById('push-schedule-toggle')?.checked;

  errorDiv.style.display = 'none';
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
    if (!await confirmDialog(`¿Programar notificación para el ${dateStr}?\n\nTítulo: ${title}\n${subtitle ? `Subtítulo: ${subtitle}\n` : ''}${deepLinkInfo}`, { title: 'Programar notificación', confirmText: 'Programar' })) {
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
    let countQuery = supabase.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('isActive', true);
    if (targetPlatforms?.length > 0) countQuery = countQuery.in('platform', targetPlatforms);
    const { count: filteredCount } = await countQuery;
    const n = filteredCount ?? 0;
    const subscriberText = `${n} dispositivo${n !== 1 ? 's' : ''} suscrito${n !== 1 ? 's' : ''}`;
    const platformInfo = targetPlatforms?.length > 0 ? ` (solo ${targetPlatforms.map(pushPlatformLabel).join(', ')})` : '';
    if (!await confirmDialog(`¿Enviar notificación a todos los suscriptores?\n\nTítulo: ${title}\n${subtitle ? `Subtítulo: ${subtitle}\n` : ''}${subscriberText}${platformInfo}${deepLinkInfo}`, { title: 'Enviar a todos', confirmText: 'Enviar' })) {
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
      showToast(`Notificación enviada a ${data.sent} dispositivos`, 'success');
      statusEl.textContent = `Enviada a ${data.sent}/${data.totalDevices} dispositivos`;
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

async function loadScheduledNotifications() {
  const container = document.getElementById('pushScheduledList');
  if (!container) return;
  try {
    // Solo mostramos las creadas a mano desde el panel (category='general').
    // Las Premium (race_start, tv_start, results) las genera el cron
    // auto_dispatch_premium_pushes y se gestionan automáticamente —
    // mostrarlas aquí saturaría el listado con cientos de filas por carrera.
    const { data, error } = await supabase
      .from('scheduled_push_notifications')
      .select('*')
      .in('status', ['pending', 'processing', 'failed', 'cancelled'])
      .eq('category', 'general')
      .order('scheduledAt', { ascending: true })
      .limit(30);
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;padding:0.5rem 0">No hay notificaciones programadas.</div>';
      return;
    }
    container.innerHTML = data.map(n => {
      const scheduledDate = new Date(n.scheduledAt).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
      });
      const dlLabel = n.deepLink ? ` → <span class="u-c-accent">${esc(deepLinkDisplayLabel(n.deepLink))}</span>` : '';

      const isPending    = n.status === 'pending';
      const isProcessing  = n.status === 'processing';
      const isFailed     = n.status === 'failed';
      const isCancelled  = n.status === 'cancelled';

      const platformsText = pushPlatformsLabel(n.targetPlatforms);
      const platformsBadge = platformsText
        ? `<span style="font-size:0.68rem;background:var(--border);color:var(--text-dim);padding:0.1rem 0.45rem;border-radius:20px;font-weight:500" title="Plataformas">${esc(platformsText)}</span>`
        : '';

      const statusBadge = isPending
        ? `<span style="font-size:0.7rem;background:var(--accent);color:#fff;padding:0.1rem 0.45rem;border-radius:20px;font-weight:600">Pendiente</span>`
        : isProcessing
          ? `<span style="font-size:0.7rem;background:var(--accent);color:#fff;padding:0.1rem 0.45rem;border-radius:20px;font-weight:600">Enviando…</span>`
        : isFailed
          ? `<span style="font-size:0.7rem;background:#e55;color:#fff;padding:0.1rem 0.45rem;border-radius:20px;font-weight:600">Fallida</span>`
          : `<span style="font-size:0.7rem;background:var(--border);color:var(--text-dim);padding:0.1rem 0.45rem;border-radius:20px;font-weight:600">Cancelada</span>`;

      const sendNowBtn = isPending
        ? `<button onclick="sendScheduledNotificationNow('${esc(n.id)}')" style="font-size:0.72rem;padding:0.2rem 0.6rem;border:1px solid var(--accent);border-radius:6px;background:var(--accent);cursor:pointer;color:#fff;font-weight:600;white-space:nowrap">Enviar ahora</button>`
        : '';
      const cancelBtn = isPending
        ? `<button onclick="cancelScheduledNotification('${esc(n.id)}')" style="font-size:0.72rem;padding:0.2rem 0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;color:var(--text-dim);white-space:nowrap">Cancelar</button>`
        : '';

      const errorNote = isFailed && n.errorMessage
        ? `<div style="font-size:0.72rem;color:#e55;margin-top:0.2rem">${esc(n.errorMessage.slice(0, 120))}</div>`
        : '';

      return `<div style="padding:0.75rem 0;border-bottom:1px solid var(--border);display:flex;gap:0.75rem;align-items:flex-start">
        ${n.imageUrl ? `<img src="${esc(n.imageUrl)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;margin-top:0.1rem">` : ''}
        <div class="u-grow u-min0">
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.2rem">
            <span style="font-weight:600;font-size:0.85rem">${esc(n.title)}</span>
            ${statusBadge}
            ${platformsBadge}
          </div>
          ${n.subtitle ? `<div class="u-fs-md u-c-muted">${esc(n.subtitle)}</div>` : ''}
          <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.2rem">${scheduledDate}${dlLabel}</div>
          ${errorNote}
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0">
          ${sendNowBtn}
          ${cancelBtn}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:#e55;font-size:0.82rem">${esc(err.message)}</div>`;
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
        deepLink: notification.deepLink || undefined,
        category: notification.category || 'general',
        targetRegions: Array.isArray(notification.targetRegions) && notification.targetRegions.length > 0
          ? notification.targetRegions
          : undefined,
        targetPlatforms: Array.isArray(notification.targetPlatforms) && notification.targetPlatforms.length > 0
          ? notification.targetPlatforms
          : undefined,
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
      })
      .eq('id', id);
    if (updateError) throw updateError;

    showToast(`Notificación enviada a ${result.sent} dispositivos`, 'success');
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
    // Solo historial de envíos manuales (category='general'). Las
    // Premium (race_start/tv_start/results) son automáticas y generan
    // demasiados registros para revisarlas aquí.
    const { data, error } = await supabase
      .from('push_notifications')
      .select('*')
      .eq('category', 'general')
      .order('sentAt', { ascending: false })
      .limit(20);
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;padding:0.5rem 0">No se han enviado notificaciones aún.</div>';
      return;
    }
    container.innerHTML = data.map(n => {
      const date = new Date(n.sentAt).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
      });
      const dlLabel = n.deepLink ? ` → <span class="u-c-accent">${esc(deepLinkDisplayLabel(n.deepLink))}</span>` : '';
      const platformsText = pushPlatformsLabel(n.targetPlatforms);
      const platformsBadge = platformsText
        ? `<span style="font-size:0.68rem;background:var(--border);color:var(--text-dim);padding:0.1rem 0.45rem;border-radius:20px;font-weight:500;margin-left:0.4rem" title="Plataformas">${esc(platformsText)}</span>`
        : '';
      return `<div style="padding:0.75rem 0;border-bottom:1px solid var(--border);display:flex;gap:0.75rem;align-items:flex-start">
        ${n.imageUrl ? `<img src="${esc(n.imageUrl)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;margin-top:0.1rem">` : ''}
        <div class="u-grow u-min0">
          <div style="font-weight:600;font-size:0.85rem">${esc(n.title)}${platformsBadge}</div>
          ${n.subtitle ? `<div class="u-fs-md u-c-muted">${esc(n.subtitle)}</div>` : ''}
          <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.25rem">${date} · ${n.recipientCount} destinatarios${dlLabel}</div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:#e55;font-size:0.82rem">${esc(err.message)}</div>`;
  }
}

async function loadSubscriberCount() {
  const el = document.getElementById('pushSubscriberCount');
  try {
    const { count, error } = await supabase
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('isActive', true);
    if (error) throw error;
    const n = count ?? 0;
    el.textContent = `${n} dispositivo${n !== 1 ? 's' : ''} suscrito${n !== 1 ? 's' : ''}`;
  } catch {
    el.textContent = '';
  }
}

// ═════════════════════════════════════════════════════════════════
//  TRADUCCIONES EN — solo edición manual
// ═════════════════════════════════════════════════════════════════

window.markTranslationAsManual = async function(field) {
  const area = document.getElementById('editorArea');
  const rdId = area?.dataset.rdId;
  if (!rdId) return;
  try {
    const { data: rdForTr, error: fetchErr } = await supabase.from('race_days').select('translations').eq('id', rdId).single();
    if (fetchErr) throw fetchErr;
    const existingTr = rdForTr?.translations || {};
    const existingEn = existingTr.en || {};
    const fieldEntry = existingEn[field];
    if (!fieldEntry?.value) { showToast('No hay traducción para marcar'); return; }
    const newEn = { ...existingEn, [field]: { ...fieldEntry, status: 'manual', updatedAt: new Date().toISOString() } };
    const newTranslations = { ...existingTr, en: newEn };
    const { error } = await supabase.from('race_days').update({ translations: newTranslations }).eq('id', rdId);
    if (error) throw error;
    _editorCache = null;
    await openEditor(rdId);
    showToast(`Traducción "${field}" marcada como manual`, 'success', 2500);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
};


// ═════════════════════════════════════════════════════════════════
//  DETECCIÓN DE COLORES DE MAILLOT (desde el editor de equipo)
// ═════════════════════════════════════════════════════════════════

let _jerseyDetectorState = null;

// ── Overlay de detección ──────────────────────────────────────────

function _jerseyColorFieldHtml(key, label) {
  return `<div style="display:flex;flex-direction:column;gap:0.2rem">
    <label style="font-size:0.76rem;color:var(--text-dim)">${esc(label)}</label>
    <div style="display:flex;gap:0.35rem;align-items:center">
      <input type="color" id="jd-${key}-color" style="width:34px;height:30px;padding:2px;border:1px solid var(--border);background:var(--bg);border-radius:4px;cursor:pointer">
      <input type="text" id="jd-${key}-text" value="#000000" maxlength="7" style="flex:1;font-family:monospace;font-size:0.82rem;text-transform:uppercase;padding:0.28rem 0.4rem;border:1px solid var(--border);background:var(--bg);border-radius:4px;color:var(--text)">
    </div>
  </div>`;
}

function _getOrCreateJerseyOverlay() {
  let ov = document.getElementById('jerseyDetectorOverlay');
  if (ov) return ov;

  ov = document.createElement('div');
  ov.id = 'jerseyDetectorOverlay';
  ov.className = 'modal-overlay';
  ov.style.cssText = 'display:none;z-index:300';
  ov.innerHTML = `
    <div class="modal" style="max-width:640px;max-height:92vh;overflow:hidden">
      <div class="modal__header">
        <div class="modal__title" id="jerseyDetectorTitle">Detectar colores de maillot</div>
        <button class="btn btn--ghost" id="jerseyDetectorCloseBtn" style="padding:0.25rem 0.5rem;font-size:0.75rem">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem">

        <!-- 1 · Seleccionar imagen -->
        <div id="jerseyStep1" style="display:flex;flex-direction:column;gap:0.65rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Seleccionar imagen del maillot</div>

          <div style="display:flex;align-items:center;gap:0.6rem">
            <button class="btn btn--ghost" id="jerseyUploadBtn" style="font-size:0.8rem">📁 Subir imagen</button>
            <span id="jerseyFileLabel" style="font-size:0.78rem;color:var(--text-dim)">PNG, JPG o WEBP — máx 10 MB</span>
            <input type="file" id="jerseyFileInput" accept="image/png,image/jpeg,image/webp" style="display:none">
          </div>
        </div>

        <!-- Status -->
        <div id="jerseyDetectorStatus" style="font-size:0.82rem;color:var(--text-dim);display:none;padding:0.5rem 0.75rem;border-radius:6px;background:var(--bg-card);border:1px solid var(--border)"></div>

        <!-- 2 · Preview de colores -->
        <div id="jerseyColorsPreview" style="display:none;flex-direction:column;gap:0.75rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Colores detectados — revisa y ajusta</div>
          <div style="display:grid;grid-template-columns:120px 1fr;gap:1rem;align-items:start">
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;position:sticky;top:0">
              <div id="jerseyBadgePreview" style="width:100px;height:100px;display:flex;align-items:center;justify-content:center"></div>
              <div id="jerseyHeaderPreview" style="width:100%;text-align:center;padding:0.35rem 0.4rem;border-radius:5px;font-family:var(--font-display);font-weight:700;font-size:0.75rem;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Cabecera</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.45rem">
              ${_jerseyColorFieldHtml('headerBg',   'Fondo cabecera')}
              ${_jerseyColorFieldHtml('headerText',  'Texto cabecera')}
              ${_jerseyColorFieldHtml('torsoCenter', 'Central torso')}
              ${_jerseyColorFieldHtml('torsoSides',  'Laterales')}
              <div style="display:flex;flex-direction:column;gap:0.2rem">
                <label style="font-size:0.76rem;color:var(--text-dim);display:flex;align-items:center;gap:0.4rem">
                  Círculo interior
                  <label style="display:inline-flex;align-items:center;gap:0.25rem;font-weight:400;cursor:pointer">
                    <input type="checkbox" id="jd-innerCircle-enabled">
                    <span style="font-size:0.7rem;color:var(--text-dim)">activar</span>
                  </label>
                </label>
                <div style="display:flex;gap:0.35rem;align-items:center">
                  <input type="color" id="jd-innerCircle-color" style="width:34px;height:30px;padding:2px;border:1px solid var(--border);background:var(--bg);border-radius:4px;cursor:pointer">
                  <input type="text" id="jd-innerCircle-text" value="#FFD700" maxlength="7" style="flex:1;font-family:monospace;font-size:0.82rem;text-transform:uppercase;padding:0.28rem 0.4rem;border:1px solid var(--border);background:var(--bg);border-radius:4px;color:var(--text)">
                </div>
              </div>
              ${_jerseyColorFieldHtml('shorts', 'Culotte')}
            </div>
          </div>
        </div>

        <!-- Asociar en listas de inscritos (aparece tras guardar colores) -->
        <div id="jerseyStartlistStep" style="display:none;flex-direction:column;gap:0.65rem">
          <div id="jerseyStartlistStepTitle" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Asociar en listas de inscritos</div>
          <div id="jerseyStartlistStepBody" style="display:flex;flex-direction:column;gap:0.5rem"></div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:0.9rem 1.25rem;border-top:1px solid var(--border);display:flex;align-items:center;gap:0.75rem">
        <button class="btn btn--primary" id="jerseyDetectorSaveBtn" style="display:none">Guardar colores</button>
        <button class="btn btn--primary" id="jerseyAssocBtn" style="display:none">Asociar seleccionadas</button>
        <button class="btn btn--ghost" id="jerseyDetectorCancelBtn">Cancelar</button>
        <span class="u-fs-md u-c-dim" id="jerseyDetectorSaveStatus"></span>
      </div>
    </div>`;

  document.body.appendChild(ov);

  ov.addEventListener('click', e => { if (e.target === ov) closeJerseyDetector(); });
  ov.querySelector('#jerseyDetectorCloseBtn').addEventListener('click', closeJerseyDetector);
  ov.querySelector('#jerseyDetectorCancelBtn').addEventListener('click', closeJerseyDetector);
  ov.querySelector('#jerseyDetectorSaveBtn').addEventListener('click', saveJerseyColors);
  ov.querySelector('#jerseyAssocBtn').addEventListener('click', confirmJerseyStartlistLinks);
  ov.querySelector('#jerseyUploadBtn').addEventListener('click', () => ov.querySelector('#jerseyFileInput').click());
  ov.querySelector('#jerseyFileInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) jerseyHandleFile(file);
  });

  const allKeys = ['headerBg', 'headerText', 'torsoCenter', 'torsoSides', 'innerCircle', 'shorts'];
  allKeys.forEach(key => {
    const colorEl = ov.querySelector(`#jd-${key}-color`);
    const textEl  = ov.querySelector(`#jd-${key}-text`);
    if (!colorEl || !textEl) return;
    colorEl.addEventListener('input', () => { textEl.value = colorEl.value.toUpperCase(); refreshJerseyPreview(); });
    textEl.addEventListener('input', () => {
      const v = textEl.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { colorEl.value = v.toLowerCase(); refreshJerseyPreview(); }
    });
  });
  ov.querySelector('#jd-innerCircle-enabled').addEventListener('change', refreshJerseyPreview);

  return ov;
}

function openJerseyDetector(teamId, teamName, { applyCallback } = {}) {
  _jerseyDetectorState = { teamId, teamName, applyCallback };
  const ov = _getOrCreateJerseyOverlay();

  ov.querySelector('#jerseyDetectorTitle').textContent = `Detectar colores — ${teamName}`;
  ov.querySelector('#jerseyStep1').style.display = 'flex';
  ov.querySelector('#jerseyStep1').style.flexDirection = 'column';
  ov.querySelector('#jerseyColorsPreview').style.display = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').disabled = false;
  ov.querySelector('#jerseyAssocBtn').style.display = 'none';
  ov.querySelector('#jerseyStartlistStep').style.display = 'none';
  ov.querySelector('#jerseyStartlistStepTitle').style.display = '';
  ov.querySelector('#jerseyStartlistStepBody').innerHTML = '';
  ov.querySelector('#jerseyDetectorStatus').style.display = 'none';
  ov.querySelector('#jerseyDetectorStatus').textContent = '';
  ov.querySelector('#jerseyDetectorSaveStatus').textContent = '';
  ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cancelar';
  ov.querySelector('#jerseyFileLabel').textContent = 'PNG, JPG o WEBP — máx 10 MB';
  ov.style.display = 'flex';
}

function closeJerseyDetector() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (ov) ov.style.display = 'none';
  _jerseyDetectorState = null;
}

async function jerseyHandleFile(file) {
  // La edición de colores se realiza directamente en el formulario del equipo.
  // Este manejador queda como salvaguarda para overlays antiguos aún cacheados.
  console.warn('[team colors] La detección automática ya no está disponible.', file.name);
}

function _jerseyApplyColors(raw) {
  let colors = { ...raw };

  // Anti-blanco: si headerBg es blanco puro, sustituir por el color de torso más representativo
  if (colors.headerBg === '#ffffff') {
    const alt = [colors.badgeTorsoCenter, colors.badgeTorsoSides].find(c => c && c !== '#ffffff');
    colors.headerBg  = alt || '#f0f0f0';
    colors.headerText = '#000000';
  }

  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;

  const setVal = (key, val) => {
    if (!val) return;
    const c = ov.querySelector(`#jd-${key}-color`);
    const t = ov.querySelector(`#jd-${key}-text`);
    if (c) c.value = val.toLowerCase();
    if (t) t.value = val.toUpperCase();
  };

  setVal('headerBg',   colors.headerBg);
  setVal('headerText', colors.headerText);
  setVal('torsoCenter', colors.badgeTorsoCenter);
  setVal('torsoSides',  colors.badgeTorsoSides);
  setVal('shorts',      colors.badgeShorts);

  const innerEnabled = ov.querySelector('#jd-innerCircle-enabled');
  if (colors.badgeInnerCircle) {
    innerEnabled.checked = true;
    setVal('innerCircle', colors.badgeInnerCircle);
  } else {
    innerEnabled.checked = false;
  }

  ov.querySelector('#jerseyColorsPreview').style.display = 'flex';
  ov.querySelector('#jerseyColorsPreview').style.flexDirection = 'column';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = '';
  ov.querySelector('#jerseyDetectorSaveBtn').disabled = false;
  refreshJerseyPreview();
}

function refreshJerseyPreview() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;
  const get = key => (ov.querySelector(`#jd-${key}-text`)?.value || '').trim().toLowerCase();
  const innerEnabled = ov.querySelector('#jd-innerCircle-enabled')?.checked;

  const team = {
    name:             _jerseyDetectorState?.teamName || '',
    headerBg:         get('headerBg'),
    headerText:       get('headerText'),
    badgeTorsoCenter: get('torsoCenter'),
    badgeTorsoSides:  get('torsoSides'),
    badgeShorts:      get('shorts'),
    badgeInnerCircle: innerEnabled ? get('innerCircle') : null,
  };

  const badgeEl = ov.querySelector('#jerseyBadgePreview');
  if (badgeEl) badgeEl.innerHTML = buildTeamBadgeSvg(team, { size: 100 });

  const hdrEl = ov.querySelector('#jerseyHeaderPreview');
  if (hdrEl) {
    hdrEl.style.background = team.headerBg || '#1f2937';
    hdrEl.style.color      = team.headerText || '#ffffff';
    hdrEl.textContent      = team.name;
  }
}

function _jerseyReadColors() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return null;
  const get = key => (ov.querySelector(`#jd-${key}-text`)?.value || '').trim().toLowerCase();
  const innerEnabled = ov.querySelector('#jd-innerCircle-enabled')?.checked;
  return {
    headerBg:         get('headerBg'),
    headerText:       get('headerText'),
    badgeTorsoCenter: get('torsoCenter'),
    badgeTorsoSides:  get('torsoSides'),
    badgeShorts:      get('shorts'),
    badgeInnerCircle: innerEnabled ? get('innerCircle') : null,
  };
}

async function saveJerseyColors() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState) return;
  const saveBtn    = ov.querySelector('#jerseyDetectorSaveBtn');
  const saveStatus = ov.querySelector('#jerseyDetectorSaveStatus');
  const colors = _jerseyReadColors();
  if (!colors) return;

  const HEX = /^#[0-9a-f]{6}$/;
  const bad = ['headerBg', 'headerText', 'badgeTorsoCenter', 'badgeTorsoSides', 'badgeShorts']
    .find(k => !HEX.test(colors[k] || ''));
  if (bad) { saveStatus.textContent = `Color inválido en "${bad}"`; return; }

  // Modo "equipo nuevo": aplica colores al formulario del editor sin guardar en BD
  if (_jerseyDetectorState.applyCallback) {
    _jerseyDetectorState.applyCallback(colors);
    closeJerseyDetector();
    return;
  }

  if (!_jerseyDetectorState.teamId) return;
  saveBtn.disabled = true;
  saveStatus.textContent = 'Guardando…';

  try {
    const { error } = await supabase.from('teams').update(colors).eq('id', _jerseyDetectorState.teamId);
    if (error) throw error;

    const savedId   = _jerseyDetectorState.teamId;
    const savedName = _jerseyDetectorState.teamName;

    if (_teamsCache) {
      const idx = _teamsCache.findIndex(t => t.id === savedId);
      if (idx >= 0) Object.assign(_teamsCache[idx], colors);
    }
    // Refresca el editor abierto detrás del overlay para ver los colores sin F5.
    refreshTeamEditorColors(savedId, colors);

    saveBtn.style.display = 'none';
    saveStatus.textContent = '✓ Colores guardados. Buscando apariciones en listas…';
    ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cerrar';

    const team = _teamsCache?.find(t => t.id === savedId);
    const matches = await _jerseyCheckStartlistMatches(team);

    if (matches.length > 0) {
      _jerseyRenderStartlistStep(matches);
      saveStatus.textContent = '';
    } else {
      showToast(`Colores guardados: ${savedName}`, 'success', 3000);
      closeJerseyDetector();
    }
  } catch (err) {
    saveStatus.textContent = `Error: ${err.message}`;
    saveBtn.disabled = false;
  }
}

// ── Paso 3: buscar apariciones en listas enriquecidas ────────────

async function _jerseyCheckStartlistMatches(team) {
  if (!team) return [];

  // Fetch enriched races (use allRaces if already loaded, otherwise query)
  let enrichedRaces;
  if (Array.isArray(allRaces) && allRaces.length > 0) {
    enrichedRaces = allRaces.filter(r => r.enrichedStartlist);
  } else {
    const { data, error } = await supabase
      .from('races').select('id, name, year, gender').eq('enrichedStartlist', true);
    if (error) { console.error('[jerseyAssoc] races fetch', error); return []; }
    enrichedRaces = data || [];
  }
  if (enrichedRaces.length === 0) return [];

  const raceById = {};
  enrichedRaces.forEach(r => { raceById[r.id] = r; });
  const enrichedIds = enrichedRaces.map(r => r.id);

  // Fetch unmatched teams in those races
  const { data: unmatched, error: stErr } = await supabase
    .from('startlist_teams')
    .select('id, teamName, raceId')
    .is('teamId', null)
    .in('raceId', enrichedIds);
  if (stErr) { console.error('[jerseyAssoc] startlist_teams fetch', stErr); return []; }
  if (!unmatched?.length) return [];

  const teamGender = team.gender || null;

  return unmatched
    .filter(st => {
      const race = raceById[st.raceId];
      if (!race) return false;
      // Reject explicit cross-gender mismatches (both sides set and different)
      if (teamGender && race.gender && teamGender !== race.gender) return false;
      return !!findMatchingTeam(st.teamName, [team]);
    })
    .map(st => {
      const race = raceById[st.raceId];
      return {
        id:         st.id,
        teamName:   st.teamName,
        raceId:     st.raceId,
        raceName:   race?.name  || st.raceId,
        raceYear:   race?.year  || null,
        raceGender: race?.gender || null,
      };
    })
    .sort((a, b) =>
      (b.raceYear ?? 0) - (a.raceYear ?? 0) || a.raceName.localeCompare(b.raceName)
    );
}

function _openJerseyStartlistOnly(teamId, teamName, matches) {
  _jerseyDetectorState = { teamId, teamName };
  const ov = _getOrCreateJerseyOverlay();
  ov.querySelector('#jerseyDetectorTitle').textContent  = `Asociar en listas — ${teamName}`;
  ov.querySelector('#jerseyStep1').style.display        = 'none';
  ov.querySelector('#jerseyDetectorStatus').style.display = 'none';
  ov.querySelector('#jerseyColorsPreview').style.display  = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = 'none';
  ov.querySelector('#jerseyAssocBtn').style.display       = 'none';
  ov.querySelector('#jerseyStartlistStep').style.display  = 'none';
  ov.querySelector('#jerseyStartlistStepTitle').style.display = 'none';
  ov.querySelector('#jerseyStartlistStepBody').innerHTML  = '';
  ov.querySelector('#jerseyDetectorSaveStatus').textContent = '';
  ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cerrar';
  ov.style.display = 'flex';
  _jerseyRenderStartlistStep(matches);
}

function _jerseyRenderStartlistStep(matches) {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState) return;

  const step     = ov.querySelector('#jerseyStartlistStep');
  const body     = ov.querySelector('#jerseyStartlistStepBody');
  const assocBtn = ov.querySelector('#jerseyAssocBtn');
  if (!step || !body) return;

  const teamName = _jerseyDetectorState.teamName;

  const rowsHtml = matches.map(m => {
    const genderWarning = !m.raceGender
      ? `<span title="El género de esta carrera no está especificado" style="font-size:0.7rem;color:#f59e0b;flex-shrink:0">⚠ sin género</span>`
      : '';
    return `<label style="display:flex;align-items:center;gap:0.6rem;padding:0.3rem 0.5rem;border-radius:5px;cursor:pointer">
      <input type="checkbox" class="sl-assoc-check" data-id="${esc(m.id)}" checked style="flex-shrink:0;cursor:pointer">
      <span class="u-grow u-min0 u-truncate">
        <span style="font-size:0.83rem;font-weight:600">${esc(m.raceName)}${m.raceYear ? ` ${m.raceYear}` : ''}</span>
        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:0.35rem">"${esc(m.teamName)}"</span>
      </span>
      ${genderWarning}
    </label>`;
  }).join('');

  body.innerHTML = `
    <div class="u-fs-082">
      ${matches.length === 1 ? 'Se encontró' : 'Se encontraron'} <strong>${matches.length}</strong> aparición${matches.length > 1 ? 'es' : ''}
      de <strong>${esc(teamName)}</strong> en listas enriquecidas sin asociar.
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <div style="max-height:190px;overflow-y:auto;padding:0.25rem 0.25rem">
        ${rowsHtml}
      </div>
      <div style="border-top:1px solid var(--border);padding:0.3rem 0.5rem;display:flex;align-items:center;gap:0.5rem">
        <button class="btn btn--ghost" id="jerseyAssocCheckAll" style="font-size:0.7rem;padding:0.15rem 0.4rem">Todas</button>
        <button class="btn btn--ghost" id="jerseyAssocUncheckAll" style="font-size:0.7rem;padding:0.15rem 0.4rem">Ninguna</button>
      </div>
    </div>`;

  step.style.display = 'flex';

  assocBtn.textContent = `Asociar seleccionadas (${matches.length})`;
  assocBtn.style.display = '';
  assocBtn.disabled = false;

  // Select-all / unselect-all helpers
  body.querySelector('#jerseyAssocCheckAll')?.addEventListener('click', () => {
    body.querySelectorAll('.sl-assoc-check').forEach(cb => { cb.checked = true; });
    _jerseyUpdateAssocCount();
  });
  body.querySelector('#jerseyAssocUncheckAll')?.addEventListener('click', () => {
    body.querySelectorAll('.sl-assoc-check').forEach(cb => { cb.checked = false; });
    _jerseyUpdateAssocCount();
  });
  body.querySelectorAll('.sl-assoc-check').forEach(cb =>
    cb.addEventListener('change', _jerseyUpdateAssocCount)
  );

  // Scroll step into view
  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _jerseyUpdateAssocCount() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;
  const n = ov.querySelectorAll('.sl-assoc-check:checked').length;
  const btn = ov.querySelector('#jerseyAssocBtn');
  if (btn) btn.textContent = `Asociar seleccionadas (${n})`;
}

async function confirmJerseyStartlistLinks() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState?.teamId) return;

  const checked = Array.from(ov.querySelectorAll('.sl-assoc-check:checked')).map(cb => cb.dataset.id);
  if (checked.length === 0) {
    closeJerseyDetector();
    return;
  }

  const assocBtn   = ov.querySelector('#jerseyAssocBtn');
  const saveStatus = ov.querySelector('#jerseyDetectorSaveStatus');
  const teamId     = _jerseyDetectorState.teamId;
  const teamName   = _jerseyDetectorState.teamName;

  assocBtn.disabled = true;
  saveStatus.textContent = 'Asociando…';

  try {
    // Supabase update in batches of 100 to respect URL length limits
    for (let i = 0; i < checked.length; i += 100) {
      const batch = checked.slice(i, i + 100);
      const { error } = await supabase
        .from('startlist_teams')
        .update({ teamId })
        .in('id', batch);
      if (error) throw error;
    }

    showToast(
      `${checked.length} aparición${checked.length > 1 ? 'es' : ''} asociada${checked.length > 1 ? 's' : ''}: ${teamName}`,
      'success', 4000
    );
    closeJerseyDetector();
  } catch (err) {
    saveStatus.textContent = `Error al asociar: ${err.message}`;
    assocBtn.disabled = false;
  }
}

// ═════════════════════════════════════════════════════════════════
//  CINTILLO «HOY» — today_highlights (manual editorial)
// ═════════════════════════════════════════════════════════════════

let _highlightsViewReady = false;
let _highlightsCache = null;
let _highlightRaceDaysCache = {};         // raceId → race_days[] (lazy, para el editor)
let _highlightRaceDaysByIdCache = {};     // raceDayId → race_day (bulk, para la lista)
let _editingHighlightId = null;
let _hlSelectedRace = null;
let _hlRaceSearchDebounce = null;

// ── Helpers de fecha+hora para visibleFrom/visibleUntil (TIMESTAMPTZ) ─

/**
 * Convierte un timestamptz ISO (devuelto por Supabase) al formato que espera
 * `<input type="datetime-local">`: "YYYY-MM-DDTHH:MM" en hora local del editor.
 */
function _toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convierte el valor de `<input type="datetime-local">` (sin TZ, hora local del
 * editor) a un ISO con TZ explícita para que Supabase lo guarde como TIMESTAMPTZ.
 * El navegador ya interpreta "2026-05-29T14:00" en la TZ local del editor.
 */
function _fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Formatea un timestamptz ISO a algo legible en la lista de destacados.
 * Ej: "29 may 14:00". Usa la TZ local del editor.
 */
function _fmtVisibilityInstant(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function fetchHighlights({ force = false } = {}) {
  if (_highlightsCache && !force) return _highlightsCache;
  const { data, error } = await supabase
    .from('today_highlights')
    .select('*')
    .order('position', { ascending: true });
  if (error) { console.error('[highlights] fetch', error); return []; }
  _highlightsCache = data || [];
  return _highlightsCache;
}

async function _fetchRaceDaysForHighlight(raceId) {
  if (_highlightRaceDaysCache[raceId]) return _highlightRaceDaysCache[raceId];
  const { data, error } = await supabase
    .from('race_days')
    .select('id, slug, date, stageNumber, startLocation, finishLocation, primaryType, startOrderImportedAt')
    .eq('raceId', raceId)
    .order('date', { ascending: true });
  if (error) { console.error('[highlights] race_days', error); return []; }
  _highlightRaceDaysCache[raceId] = data || [];
  return _highlightRaceDaysCache[raceId];
}

// ═════════════════════════════════════════════════════════════════
//  FICHAJES — mercado de la temporada 2027 (rider_transfers, mig. 122)
// ═════════════════════════════════════════════════════════════════
//
// Un movimiento por fila. Convención por type (espejo del CHECK de la 122):
//   'transfer'   → fromTeam* = equipo que deja, toTeam* = al que va.
//   'renewal'    → toTeamId  = equipo con el que renueva (fromTeam* NULL).
//   'retirement' → fromTeam* = equipo que deja (toTeam* NULL).
// fromTeamName/toTeamName = texto libre para equipos fuera del catálogo.
// status 'rumor' NO aparece en el feed público de confirmaciones; en el detalle
// de equipo sale con badge Rumor. Al confirmar con contrato, se sincroniza
// riders_*.contractUntil (lo muestra la sección "continúan").

const MARKET_SEASON = 2027;
const MARKET_PREV_SEASON = MARKET_SEASON - 1;

let _transfersViewReady   = false;
let _transfersCache       = [];      // filas de rider_transfers + .rider hidratado
let _marketSeasons        = [];      // filas team_seasons del mercado (lista de equipos)
let _marketDiv            = 'WT';    // división activa en la lista de equipos
// El nombre de un equipo depende del LADO del movimiento: de dónde sale un
// corredor es el equipo de la temporada en curso (2026, la que se está
// corriendo); a dónde va es el de la temporada del mercado (2027). Un mapa por
// año; `teams` NO sirve de archivo histórico (su trigger sync_team_to_season
// pisa siempre el año en curso). Espejo de js/fichajes.js.
let _trTeamNamePrev       = new Map();  // teamId → nombre 2026 (origen)
let _trTeamNameById       = new Map();  // teamId → nombre 2027 (destino)
let _editingTransferId    = null;
let _trAutoResolvedExisting = false;
let _trSelectedRider      = null;    // { id, gender, firstName, lastName, nationality, currentTeamId }
let _trSearchDebounce     = null;
let _trSituationState     = 'undecided';
let _trYearUnknown        = false;
let _trLifetime           = false;

function _localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function setupFichajesView() {
  if (!_transfersViewReady) {
    _transfersViewReady = true;
    const bind = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
      else console.warn(`[setupFichajesView] #${id} no existe en el DOM — listener omitido (¿app.html cacheado?)`);
    };
    // La vista es equipo-céntrica (espejo del front): división → equipo →
    // editor de temporada 2027. La lista plana de TODOS los movimientos queda
    // como herramienta de auditoría en un drawer aparte.
    bind('newTeam27Btn', 'click', openTeamEditorForMarket);
    bind('addTransferDirectBtn', 'click', () => openTransferEditor(null));
    bind('allTransfersBtn', 'click', openAllTransfersDrawer);
    const seasonEl = document.getElementById('fichajesSeason');
    if (seasonEl) seasonEl.textContent = `· temporada ${MARKET_SEASON}`;
  }
  await fetchTeams();
  await loadTransfers();
  renderMarketTeams();
}

// ── Lista de equipos de la temporada del mercado ──────────────────
// Espejo de la lista pública de /fichajes/: 4 divisiones, orden alfabético.
// Es el atajo para renombrar un equipo 2027 (sponsor nuevo), moverlo de
// división, activar su chapa o marcar su continuidad en duda sin salir a la
// vista Equipos.
const MARKET_DIVISIONS = ['WT', 'PT', 'WWT', 'PRW'];

function renderMarketTeams() {
  const btns = document.getElementById('marketDivBtns');
  const list = document.getElementById('marketTeamsList');
  if (!btns || !list) return;

  btns.innerHTML = MARKET_DIVISIONS.map(d => {
    const active = d === _marketDiv;
    const n = _marketSeasons.filter(s => s.category === d).length;
    return `<button class="btn ${active ? 'btn--primary' : 'btn--ghost'}" data-mdiv="${d}"
      style="padding:0.3rem 0.7rem;font-size:0.75rem">${d}${n ? ` <span style="opacity:0.65">${n}</span>` : ''}</button>`;
  }).join('');
  btns.querySelectorAll('[data-mdiv]').forEach(b =>
    b.addEventListener('click', () => { _marketDiv = b.dataset.mdiv; renderMarketTeams(); })
  );

  const teams = _marketSeasons
    .filter(s => s.category === _marketDiv)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));

  if (teams.length === 0) {
    list.innerHTML = `<div class="u-fs-085 u-c-dim" style="padding:0.5rem 0">Sin equipos en esta división. Usa <strong>+ Equipo ${MARKET_SEASON}</strong> para crear uno que nazca este año.</div>`;
    return;
  }

  const chip = (text, color) =>
    `<span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:0.1rem 0.35rem;border-radius:4px;background:${color}26;color:${color};white-space:nowrap">${esc(text)}</span>`;

  list.innerHTML = teams.map(s => {
    // El nombre de la temporada EN CURSO cuando difiere del del mercado: es la
    // señal de un renombre de sponsor ya registrado.
    const prev = _trTeamNamePrev.get(s.teamId);
    const renamed = prev && prev !== s.name;
    // Chapa que se verá en Fichajes: colores 2027 publicados / colores antiguos
    // (equipo que ya existía en la temporada previa) / vacío (equipo nuevo, sin
    // kit antiguo que enseñar). `prev` truthy = hay fila team_seasons previa.
    const badgeChip = s.badgeVisible
      ? chip(`Colores ${MARKET_SEASON}`, 'var(--accent)')
      : prev
        ? chip(`Colores ${MARKET_PREV_SEASON}`, '#6b7280')
        : chip('Nuevo · sin chapa', '#9ca3af');
    return `
      <div class="market-team-row" data-team="${esc(s.teamId)}" style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.65rem;background:var(--bg-card);border:1px solid ${s.continuityDoubt ? '#8b5cf6' : 'var(--border)'};border-radius:6px;cursor:pointer">
        <span style="flex:1;min-width:0;font-size:0.85rem"><strong>${esc(s.name || s.teamId)}</strong>
          ${renamed ? `<span class="u-c-dim" style="font-size:0.72rem;margin-left:0.3rem">· ${MARKET_PREV_SEASON}: ${esc(prev)}</span>` : ''}
        </span>
        ${s.continuityDoubt ? chip('Duda', '#8b5cf6') : ''}
        ${badgeChip}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-dim);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');

  list.querySelectorAll('.market-team-row').forEach(row => {
    // Tocar un equipo abre su EDITOR DE TEMPORADA 2027 (situación de cada
    // corredor + incorporaciones), no el editor de identidad — ese vive dentro,
    // en un botón de la cabecera del drawer.
    row.addEventListener('click', () => openTeamSituationEditor(row.dataset.team));
  });
}

/**
 * Abre el editor de un equipo YA existente enfocado en su temporada del
 * mercado: despliega el panel «Temporada 2027» y lleva el foco al nombre (el
 * caso de uso normal desde aquí es un renombre de sponsor).
 */
async function openTeamEditorForSeason(teamId) {
  await fetchTeams();
  openTeamEditor(teamId);
  // El panel de temporada lo puebla loadTeamSeason27 de forma asíncrona.
  setTimeout(() => {
    const panel = document.getElementById('teamSeason27Panel');
    panel?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.getElementById('ts27-name')?.focus();
  }, 260);
}

// Equipo NUEVO para el mercado (nace en 2027, aún no existe en el catálogo):
// reutiliza el editor de equipo estándar — al guardar la identidad aparece el
// panel "Temporada 2027", donde se fija nombre/categoría 2027 y la chapa.
// Un equipo sin startlists 2026 no aparece en ninguna superficie pública del
// año en curso, así que crear la identidad ahora es inocuo.
async function openTeamEditorForMarket() {
  await fetchTeams();
  openTeamEditor(null);
  // Nace en la temporada del mercado → firstSeason en el INSERT (mig. 129): el
  // trigger no le estampará una temporada del año en curso, así que NO tendrá
  // colores "antiguos" y el mercado lo dejará vacío hasta publicar la chapa.
  _newTeamMarketBorn = true;
  const status = document.getElementById('teamSaveStatus');
  if (status) status.textContent = `Equipo nuevo para el mercado ${MARKET_SEASON}: guarda la identidad (nombre + categoría) y rellena después el panel «Temporada ${MARKET_SEASON}».`;
}

// ══════════════════════════════════════════════════════════════════
//  EDITOR DE TEMPORADA 2027 POR EQUIPO (situación de cada corredor)
// ══════════════════════════════════════════════════════════════════
//
// Espejo del front /fichajes/: se entra en un equipo y se decide la situación
// 2027 de cada corredor de su plantilla 2026. Cuatro estados, que se traducen
// a DB así (T = el equipo abierto):
//
//   Continúa (+año / "sin año") → afiliación 2027 (teamId=T, contractUntil) y
//       se BORRA cualquier rider_transfers de T para ese corredor. La
//       plantilla 2027 se MATERIALIZA aquí (el front la lee de las afiliaciones).
//   Duda (+año opcional)       → rider_transfers renewal+doubt (toTeamId=T) +
//       afiliación 2027 (sigue "formando parte", pero el front lo saca de
//       "continúan" a "en duda").
//   Cambio (+equipo +año)      → rider_transfers transfer (from=T, to=nuevo) y
//       se BORRA la afiliación 2027 a T (ya no continúa aquí).
//   Fin de contrato            → se BORRA la afiliación 2027 a T. Con "retirada"
//       marcada → rider_transfers retirement (from=T); sin ella → transfer con
//       destino DESCONOCIDO (from=T, toTeamName='?') = baja sin destino.
//
// El género del corredor decide la tabla riders_* y el año va como smallint.

let _tseTeamId       = null;   // equipo abierto
let _tseSituations   = new Map();   // riderId → { rider, state, year, yearUnknown, newTeamId, retired, initial }
let _tseIncoming     = [];     // transfers type=transfer con toTeamId = este equipo
let _tseGender       = null;   // género del equipo (para el picker de destino)

const TSE_STATES = [
  { key: 'stay',   label: 'Continúa',        color: 'var(--accent)' },
  { key: 'doubt',  label: 'Duda',            color: '#8b5cf6' },
  { key: 'change', label: 'Cambio',          color: '#f59e0b' },
  { key: 'end',    label: 'Fin de contrato', color: '#ef4444' },
];

function _tseNewId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Marcador de "baja sin destino conocido" en el texto libre de destino.
const TSE_UNKNOWN_DEST = '?';
// Contrato VITALICIO: año centinela (dateTo = 9999-12-31) → sin fecha de fin
// declarada; ordena el primero de "continúan" y se pinta ∞ en vez de año.
const TSE_LIFETIME_YEAR = 9999;

/**
 * Carga plantilla 2026 + afiliaciones 2027 + movimientos del equipo y abre el
 * drawer con la situación de cada corredor.
 */
async function openTeamSituationEditor(teamId) {
  await fetchTeams();
  _tseTeamId = teamId;
  const season = _marketSeasons.find(s => s.teamId === teamId);
  const teamCat = season?.category || (_teamsCache || []).find(t => t.id === teamId)?.category || null;
  _tseGender = season?.gender
    || (_teamsCache || []).find(t => t.id === teamId)?.gender
    || ({ WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' })[teamCat]
    || null;

  const teamName = season?.name || (_teamsCache || []).find(t => t.id === teamId)?.name || teamId;

  openDrawer({
    title: `${teamName} · Temporada ${MARKET_SEASON}`,
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = `<div class="u-fs-085 u-c-dim" style="padding:1rem 0">Cargando plantilla…</div>`;
    },
  });

  try {
    const [roster, affiliations] = await Promise.all([
      _tseFetchRoster(teamId, _tseGender),
      _tseFetchAffiliations(teamId),
    ]);
    // Movimientos ya cargados en _transfersCache (loadTransfers). Origen (from=T)
    // decide continua/cambio/fin; destino (to=T, transfer) son las incorporaciones.
    const affByRider = new Map(affiliations.map(a => [a.riderId, a]));
    const outByRider = new Map();   // salidas registradas de T (transfer/retirement from=T)
    _transfersCache.forEach(t => {
      if ((t.type === 'transfer' || t.type === 'retirement') && t.fromTeamId === teamId) {
        outByRider.set(t.riderId, t);
      }
    });
    const renewalByRider = new Map(); // renovaciones confirmadas/rumor/duda con este equipo
    _transfersCache.forEach(t => {
      if (t.type === 'renewal' && t.toTeamId === teamId) renewalByRider.set(t.riderId, t);
    });

    // Estado inicial por corredor de la plantilla 2026.
    _tseSituations = new Map();
    roster.forEach(r => {
      const out = outByRider.get(r.id);
      const renewal = renewalByRider.get(r.id);
      const aff = affByRider.get(r.id);
      let state = 'undecided', year = null, yearUnknown = false, newTeamId = null, retired = false;
      let rumor = false, announcedAt = _localDateKey(), lifetime = false;
      if (out) {
        if (out.type === 'retirement') { state = 'end'; retired = true; }
        else if (out.toTeamName === TSE_UNKNOWN_DEST && !out.toTeamId) { state = 'end'; retired = false; }
        else {
          state = 'change'; newTeamId = out.toTeamId || null; year = out.contractUntil || null;
          rumor = out.status === 'rumor';
          announcedAt = out.announcedAt || _localDateKey();
        }
      } else if (renewal?.status === 'doubt') {
        state = 'doubt'; year = renewal.contractUntil || null;
      } else if (aff || renewal) {
        const affYear = _affYear(aff?.dateTo);
        const effectiveYear = renewal?.contractUntil ?? affYear;
        state = 'stay';
        rumor = renewal?.status === 'rumor';
        announcedAt = renewal?.announcedAt || _localDateKey();
        if (effectiveYear === TSE_LIFETIME_YEAR) { lifetime = true; year = null; yearUnknown = false; }
        else { year = effectiveYear; yearUnknown = effectiveYear == null; }
      }
      const init = { state, year, yearUnknown, lifetime, newTeamId, retired, rumor, announcedAt };
      _tseSituations.set(r.id, { rider: r, ...init, initial: { ...init } });
    });

    // Incorporaciones del mercado: los fichajes efectivos a mitad de temporada
    // pertenecen al feed informativo, no a la plantilla editable de 2027.
    _tseIncoming = _transfersCache.filter(t =>
      !t.midSeason && t.type === 'transfer' && t.toTeamId === teamId);

    _tseRenderEditor(body_of(1), { teamId, teamName, teamCat });
  } catch (err) {
    console.error('[openTeamSituationEditor]', err);
    const b = body_of(1);
    if (b) b.innerHTML = `<div style="color:var(--red);font-size:0.9rem;padding:1rem 0">Error cargando la plantilla: ${esc(err.message || String(err))}</div>`;
  }
}

// Devuelve el body del drawer de un nivel sin exponer internals de drawer.js.
function body_of(level) {
  return document.getElementById(level === 2 ? 'ccDrawer2Body' : 'ccDrawer1Body');
}

async function _tseFetchRoster(teamId, gender) {
  const cols = 'id, firstName, lastName, nationality, currentTeamId, contractUntil';
  const tables = gender === 'male' ? ['riders_men']
    : gender === 'female' ? ['riders_women']
    : ['riders_men', 'riders_women'];
  const results = await Promise.all(tables.map(tb =>
    supabase.from(tb).select(cols).eq('currentTeamId', teamId).then(r => (r.data || []).map(x => ({ ...x, gender: tb === 'riders_men' ? 'male' : 'female' })))
  ));
  return results.flat().sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
}

async function _tseFetchAffiliations(teamId) {
  const { data, error } = await supabase.from('rider_team_affiliations')
    .select('id, riderId, riderGender, teamId, year, dateFrom, dateTo')
    .eq('year', MARKET_SEASON)
    .eq('teamId', teamId);
  if (error) throw error;
  return data || [];
}

// El contrato se guarda como FECHAS en la afiliación: fin = 31-dic del año
// marcado (decisión Dani), inicio = 1-ene de la temporada del mercado. La UI y
// el front trabajan con el AÑO; estas dos funciones convierten.
function _affYear(dateTo) {
  if (!dateTo) return null;
  const y = parseInt(String(dateTo).slice(0, 4), 10);
  return isNaN(y) ? null : y;
}
function _affDateTo(year) { return year ? `${year}-12-31` : null; }
const _AFF_DATE_FROM = `${MARKET_SEASON}-01-01`;

function _tseRenderEditor(body, { teamName, teamCat }) {
  if (!body) return;
  const rows = [..._tseSituations.values()];
  const staying = rows.filter(s => s.state === 'stay').length;

  body.innerHTML = `
    <div class="u-stack" style="gap:1rem">
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-size:1rem;font-weight:700">${esc(teamName)}</div>
          <div class="u-fs-xs u-c-dim">${esc(teamCat || '')} · temporada ${MARKET_SEASON}</div>
        </div>
        <button class="btn btn--ghost" id="tse-edit-identity" style="padding:0.3rem 0.7rem;font-size:0.75rem" title="Renombre de sponsor, chapa 2027, continuidad en duda…">Editar identidad 2027</button>
      </div>

      <div class="u-stack u-stack--xs">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-dim);font-weight:600;white-space:nowrap">Plantilla 2026 → situación ${MARKET_SEASON}</div>
          <div class="u-grow u-hr-line"></div>
          <span class="u-fs-sm u-c-dim" id="tse-roster-count">${rows.length} corredor${rows.length === 1 ? '' : 'es'}</span>
        </div>
        <div class="u-fs-sm u-c-dim">Marca la situación de cada corredor. <strong style="color:var(--accent)">Continúa</strong> lo incluye en la plantilla ${MARKET_SEASON}; el resto lo saca. Los que dejes sin marcar NO entran en ${MARKET_SEASON}.</div>
        <div id="tse-roster" class="u-stack u-stack--xs" style="margin-top:0.35rem"></div>
      </div>

      <div class="u-stack u-stack--xs">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-dim);font-weight:600;white-space:nowrap">Incorporaciones ${MARKET_SEASON}</div>
          <div class="u-grow u-hr-line"></div>
          <button class="btn btn--ghost" id="tse-new-signing" style="padding:0.2rem 0.6rem;font-size:0.74rem;color:var(--accent)">+ Nueva incorporación</button>
        </div>
        <div id="tse-incoming" class="u-stack u-stack--xs"></div>
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1.25rem;position:sticky;bottom:0;background:var(--bg-card);padding:0.75rem 0;border-top:1px solid var(--border)">
      <button class="btn btn--primary" id="tse-save">Guardar equipo</button>
      <span class="u-fs-md u-c-dim" id="tse-save-status"></span>
    </div>
  `;

  _tseRenderRoster();
  _tseRenderIncoming();

  document.getElementById('tse-edit-identity')?.addEventListener('click', () => openTeamEditorForSeason(_tseTeamId));
  document.getElementById('tse-new-signing')?.addEventListener('click', _tseOpenNewSigning);
  document.getElementById('tse-save')?.addEventListener('click', _tseSaveTeam);
}

// Un año de contrato entre 2026 y 2040, o null.
function _tseParseYear(v) {
  const n = parseInt(String(v || '').trim(), 10);
  if (isNaN(n) || n < 2026 || n > 2040) return null;
  return n;
}

function _tseRenderRoster() {
  const box = document.getElementById('tse-roster');
  if (!box) return;
  const rows = [..._tseSituations.values()];
  if (rows.length === 0) {
    box.innerHTML = `<div class="u-fs-085 u-c-dim" style="padding:0.5rem 0">Este equipo no tiene plantilla 2026 (sin corredores con currentTeamId aquí).</div>`;
    return;
  }
  box.innerHTML = rows.map(s => {
    const r = s.rider;
    const seg = TSE_STATES.map(st => {
      const active = s.state === st.key;
      return `<button type="button" class="tse-seg-btn" data-rider="${esc(r.id)}" data-state="${st.key}"
        style="padding:0.22rem 0.5rem;font-size:0.72rem;font-weight:600;border:1px solid ${active ? st.color : 'var(--border)'};border-radius:5px;cursor:pointer;
        background:${active ? st.color + '22' : 'transparent'};color:${active ? st.color : 'var(--text-muted)'};white-space:nowrap">${st.label}</button>`;
    }).join('');
    return `
      <div class="tse-rider-row" data-rider="${esc(r.id)}" style="display:flex;flex-direction:column;gap:0.4rem;padding:0.55rem 0.65rem;background:var(--bg-card);border:1px solid var(--border);border-radius:6px">
        <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap">
          <span style="width:1.5em;text-align:center">${_slRiderFlagPreview(r.nationality || '')}</span>
          <span style="flex:1;min-width:9rem;font-size:0.85rem"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
            <span class="u-c-dim u-fs-070">${r.gender === 'female' ? '♀' : '♂'}</span></span>
          <div style="display:flex;gap:0.3rem;flex-wrap:wrap">${seg}</div>
        </div>
        <div class="tse-rider-extra" data-rider="${esc(r.id)}"></div>
      </div>`;
  }).join('');

  box.querySelectorAll('.tse-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = _tseSituations.get(btn.dataset.rider);
      if (!s) return;
      // Toggle-off: volver a "sin decidir" si se re-pulsa el estado activo.
      s.state = (s.state === btn.dataset.state) ? 'undecided' : btn.dataset.state;
      _tseRenderRoster();
      _tseUpdateStayCount();
    });
  });
  [..._tseSituations.values()].forEach(s => _tseRenderRiderExtra(s));
  _tseUpdateStayCount();
}

function _tseUpdateStayCount() {
  // (contador informativo, opcional — dejado por si se quiere mostrar)
}

// Campos contextuales bajo cada corredor según su estado.
function _tseRenderRiderExtra(s) {
  const wrap = document.querySelector(`.tse-rider-extra[data-rider="${CSS.escape(s.rider.id)}"]`);
  if (!wrap) return;
  const yearInput = (disabled) => `<input type="number" class="tse-year" data-rider="${esc(s.rider.id)}" min="2026" max="2040" placeholder="año contrato"
      value="${s.year || ''}" ${disabled ? 'disabled' : ''} style="width:8rem;padding:0.25rem 0.45rem;font-size:0.78rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)${disabled ? ';opacity:0.5' : ''}">`;
  const chk = (cls, checked, label) => `<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;cursor:pointer">
      <input type="checkbox" class="${cls}" data-rider="${esc(s.rider.id)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  let html = '';
  if (s.state === 'stay') {
    // Vitalicio deshabilita el año y el "sin año" (contrato sin fecha de fin).
    html = `<div style="display:flex;align-items:center;gap:0.9rem;flex-wrap:wrap;padding-left:2.05rem">
      ${yearInput(s.yearUnknown || s.lifetime)}
      ${chk('tse-yearunknown', s.yearUnknown, 'No se sabe el año')}
      ${chk('tse-lifetime', s.lifetime, 'Vitalicio ∞')}
      ${chk('tse-stay-rumor', s.rumor, 'Rumor (continuidad sin confirmar)')}
    </div>`;
  } else if (s.state === 'doubt') {
    html = `<div style="display:flex;align-items:center;gap:0.9rem;flex-wrap:wrap;padding-left:2.05rem">
      ${yearInput(false)}
      <span class="u-fs-sm u-c-dim">Duda de renovación: sigue en plantilla ${MARKET_SEASON} pero sin confirmar.</span>
    </div>`;
  } else if (s.state === 'change') {
    // El destino de un fichaje es la temporada del MERCADO → nombre/categoría de
    // team_seasons[2027] (con el que va a correr), con fallback al catálogo para
    // equipos sin fila 2027.
    const seasonById = new Map((_marketSeasons || []).map(x => [x.teamId, x]));
    const teams = (_teamsCache || [])
      .filter(t => !t.specialEdition && t.id !== _tseTeamId && (!s.rider.gender || !t.gender || t.gender === s.rider.gender))
      .map(t => {
        const s27 = seasonById.get(t.id);
        return { id: t.id, name: (s27?.name || _trTeamNameById.get(t.id) || t.name), category: (s27?.category || t.category) };
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    // Fecha de confirmación (announcedAt): solo aplica a un fichaje CONFIRMADO
    // (ordena y agrupa el feed). Un rumor no sale en el feed → sin fecha.
    const dateRow = s.rumor ? '' : `<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem">
        <span class="u-c-dim">Confirmado el</span>
        <input type="date" class="tse-announced" data-rider="${esc(s.rider.id)}" value="${esc(s.announcedAt || _localDateKey())}"
          style="padding:0.22rem 0.4rem;font-size:0.78rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)">
      </label>`;
    html = `<div style="display:flex;flex-direction:column;gap:0.5rem;padding-left:2.05rem">
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
        <select class="tse-newteam" data-rider="${esc(s.rider.id)}" style="flex:1;min-width:11rem;padding:0.25rem 0.4rem;font-size:0.78rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)">
          <option value="">— Equipo de destino —</option>
          ${teams.map(t => `<option value="${esc(t.id)}"${t.id === s.newTeamId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`).join('')}
        </select>
        ${yearInput(false)}
      </div>
      <div style="display:flex;align-items:center;gap:0.9rem;flex-wrap:wrap">
        ${chk('tse-rumor', s.rumor, 'Rumor (aún sin confirmar)')}
        ${dateRow}
      </div>
    </div>`;
  } else if (s.state === 'end') {
    html = `<div style="display:flex;align-items:center;gap:0.9rem;flex-wrap:wrap;padding-left:2.05rem">
      ${chk('tse-retired', s.retired, 'Se retira')}
      <span class="u-fs-sm u-c-dim">${s.retired ? 'Cuelga la bici.' : 'Acaba contrato sin equipo conocido (baja sin destino).'}</span>
    </div>`;
  }
  wrap.innerHTML = html;

  wrap.querySelector('.tse-year')?.addEventListener('input', (e) => { s.year = _tseParseYear(e.target.value); });
  wrap.querySelector('.tse-yearunknown')?.addEventListener('change', (e) => {
    s.yearUnknown = e.target.checked;
    if (s.yearUnknown) { s.year = null; s.lifetime = false; }
    _tseRenderRiderExtra(s);
  });
  wrap.querySelector('.tse-lifetime')?.addEventListener('change', (e) => {
    s.lifetime = e.target.checked;
    if (s.lifetime) { s.year = null; s.yearUnknown = false; }
    _tseRenderRiderExtra(s);
  });
  wrap.querySelector('.tse-stay-rumor')?.addEventListener('change', (e) => { s.rumor = e.target.checked; });
  wrap.querySelector('.tse-newteam')?.addEventListener('change', (e) => { s.newTeamId = e.target.value || null; });
  wrap.querySelector('.tse-retired')?.addEventListener('change', (e) => { s.retired = e.target.checked; _tseRenderRiderExtra(s); });
  wrap.querySelector('.tse-rumor')?.addEventListener('change', (e) => { s.rumor = e.target.checked; _tseRenderRiderExtra(s); });
  wrap.querySelector('.tse-announced')?.addEventListener('change', (e) => { s.announcedAt = e.target.value || _localDateKey(); });
}

function _tseRenderIncoming() {
  const box = document.getElementById('tse-incoming');
  if (!box) return;
  if (_tseIncoming.length === 0) {
    box.innerHTML = `<div class="u-fs-085 u-c-dim" style="padding:0.35rem 0">Sin incorporaciones registradas hacia este equipo.</div>`;
    return;
  }
  box.innerHTML = _tseIncoming.map(t => {
    const r = t.rider;
    const name = r ? `${r.lastName}, ${r.firstName}` : t.riderId;
    const from = _trTeamLabel(t.fromTeamId, t.fromTeamName, 'from');
    const isRumor = t.status === 'rumor';
    return `<div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;padding:0.45rem 0.65rem;background:var(--bg-card);border:1px solid ${isRumor ? '#f59e0b' : 'var(--border)'};border-radius:6px">
      <span style="width:1.5em;text-align:center">${_slRiderFlagPreview(t.rider?.nationality || '')}</span>
      <span style="flex:1;min-width:9rem;font-size:0.85rem"><strong>${esc(name)}</strong>
        <span class="u-c-dim" style="font-size:0.72rem">· ${esc(from)}</span></span>
      ${t.contractUntil ? `<span class="u-fs-xs u-c-dim">${esc(String(t.contractUntil))}</span>` : ''}
      ${isRumor ? `<span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;padding:0.1rem 0.35rem;border-radius:4px;background:rgba(245,158,11,0.15);color:#f59e0b">Rumor</span>` : ''}
      <button class="btn btn--ghost tse-incoming-edit" data-id="${esc(t.id)}" style="padding:0.15rem 0.45rem;font-size:0.7rem">Editar</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.tse-incoming-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = _transfersCache.find(x => x.id === btn.dataset.id);
      if (t) openTransferEditor(t);
    });
  });
}

/**
 * "Nueva incorporación": busca/crea una ficha y la asocia a ESTE equipo desde
 * 2027 → transfer (from = equipo actual del corredor, to = T) + afiliación 2027.
 * Reutiliza el editor de movimiento estándar pero con el destino prefijado a T.
 */
function _tseOpenNewSigning() {
  // Reusa el editor de movimiento estándar (drawer nivel 1) con el destino
  // prefijado a ESTE equipo; el editor de ficha nueva se apila en nivel 2 sin
  // colisión (el team-editor de nivel 1 se ha reemplazado por el movimiento).
  // Al guardar: además del transfer, se materializa la afiliación 2027 hacia T,
  // y se vuelve al editor de equipo.
  // La afiliación 2027 del destino la sincroniza saveTransfer (solo si el
  // fichaje es confirmado); aquí basta con recargar y volver al equipo.
  const teamId = _tseTeamId;
  openTransferEditor(null, { presetToTeamId: teamId, onSaved: async () => {
    await loadTransfers();
    await openTeamSituationEditor(teamId);
  } });
}

// ── Escritura de afiliaciones 2027 (materialización de plantilla) ──────
// Un corredor solo puede tener UNA afiliación por año → la clave lógica es
// (riderId, year). Al continuar en T se borra cualquier afiliación 2027 previa
// (a otro equipo) y se inserta/actualiza la de T. `year` = año de fin de
// contrato (UI); se guarda como dateTo = 31-dic de ese año (dateFrom = 1-ene
// de la temporada del mercado). year null = contrato sin definir → dateTo NULL.
async function _upsertAffiliation2027(riderId, gender, teamId, year) {
  const { data: existing, error: selErr } = await supabase.from('rider_team_affiliations')
    .select('id, teamId')
    .eq('riderId', riderId)
    .eq('year', MARKET_SEASON);
  if (selErr) throw selErr;
  const rows = existing || [];
  const mine = rows.find(a => a.teamId === teamId);
  // Borrar afiliaciones 2027 a OTROS equipos (el corredor cambió de casa).
  const others = rows.filter(a => a.teamId !== teamId).map(a => a.id);
  if (others.length) {
    const { error } = await supabase.from('rider_team_affiliations').delete().in('id', others);
    if (error) throw error;
  }
  const dateTo = _affDateTo(year);
  const now = new Date().toISOString();
  if (mine) {
    const { error } = await supabase.from('rider_team_affiliations')
      .update({ dateFrom: _AFF_DATE_FROM, dateTo, updatedAt: now })
      .eq('id', mine.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('rider_team_affiliations').insert({
      id: _tseNewId('aff'),
      riderId, riderGender: gender, teamId, year: MARKET_SEASON,
      dateFrom: _AFF_DATE_FROM, dateTo, source: 'manual', verified: true,
    });
    if (error) throw error;
  }
}

async function _deleteAffiliation2027(riderId, teamId) {
  const { error } = await supabase.from('rider_team_affiliations')
    .delete()
    .eq('riderId', riderId)
    .eq('year', MARKET_SEASON)
    .eq('teamId', teamId);
  if (error) throw error;
}

// Sincroniza la afiliación 2027 de destino de un FICHAJE (type='transfer' con
// equipo del catálogo): un fichaje CONFIRMADO materializa la afiliación al
// destino (entra en la plantilla 2027); un rumor NO (no es un hecho → solo sale
// en "Llegan · Rumor"). Al confirmar un rumor de llegada se crea; al degradar a
// rumor se borra. Solo actúa sobre fichajes al catálogo; el resto (renovación,
// retirada, destino texto libre) no toca afiliaciones aquí.
async function _syncSigningAffiliation(t) {
  if (!t || t.type !== 'transfer' || !t.toTeamId) return;
  // `midSeason` no es evidencia contractual para la temporada siguiente. La
  // afiliación 2027 solo se escribe desde un contrato/roster verificado; no
  // tocarla aquí preserva tanto una continuidad ya confirmada como la ausencia
  // correcta de afiliación cuando aún no se ha anunciado el contrato.
  if (t.midSeason) return;
  if (t.status === 'confirmed') {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  } else {
    await _deleteAffiliation2027(t.riderId, t.toTeamId);
  }
}

// Sincronización común del editor individual de Fichajes. Primero elimina la
// materialización previa de la temporada y después aplica exactamente el estado
// guardado: continuidad/duda en el equipo asociado, cambio confirmado en el
// destino, o ninguna afiliación para cambio rumoreado/fin de contrato.
async function _syncMarketSituationAffiliation(t) {
  if (!t || t.midSeason) return;
  const { error: clearErr } = await supabase.from('rider_team_affiliations')
    .delete().eq('riderId', t.riderId).eq('year', MARKET_SEASON);
  if (clearErr) throw clearErr;
  if (t.type === 'renewal' && t.toTeamId) {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  } else if (t.type === 'transfer' && t.status === 'confirmed' && t.toTeamId) {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  }
}

// Borra las filas rider_transfers de T (from=T, o renewal+doubt to=T) de un
// corredor: se usa al cambiar su estado (p. ej. de "cambio"/"duda" a "continúa").
async function _tseClearRiderTransfersForTeam(riderId, teamId) {
  const ids = _transfersCache.filter(t =>
    t.riderId === riderId && !t.midSeason && (
      ((t.type === 'transfer' || t.type === 'retirement') && t.fromTeamId === teamId) ||
      (t.type === 'renewal' && t.toTeamId === teamId)
    )).map(t => t.id);
  if (!ids.length) return;
  const { error } = await supabase.from('rider_transfers').delete().in('id', ids);
  if (error) throw error;
}

// Un corredor debe tener UN SOLO movimiento vigente en el mercado (decisión Dani,
// 2026-07-20). Al guardar un movimiento desde el editor independiente, se borran
// TODOS los demás de ese corredor en la temporada (salvo el que se está guardando):
// arregla el caso "fin de contrato huérfano + cambio a otro equipo" (el saliente
// seguía mostrándolo como fin de contrato) y evita dos movimientos coexistentes,
// incluso al mismo equipo. Se limpian también sus afiliaciones 2027 (la del
// movimiento guardado la vuelve a poner _syncSigningAffiliation / _tseSaveTeam).
async function _clearOtherTransfersForRider(riderId, keepId) {
  const ids = (_transfersCache || [])
    // Los movimientos mid-season comparten tabla y temporada del mercado por
    // comodidad editorial, pero pueden coexistir con un fichaje para 2027.
    .filter(t => t.riderId === riderId && t.season === MARKET_SEASON && t.id !== keepId && !t.midSeason)
    .map(t => t.id);
  if (!ids.length) return;
  const { error } = await supabase.from('rider_transfers').delete().in('id', ids);
  if (error) throw error;
}

/**
 * Aplica en lote la situación de cada corredor que cambió respecto al estado
 * inicial. Cada estado se traduce a afiliación 2027 + rider_transfers según la
 * tabla del encabezado.
 */
async function _tseSaveTeam() {
  const status = document.getElementById('tse-save-status');
  const teamId = _tseTeamId;

  // Validación previa: cambio sin destino / año fuera de rango se avisan.
  for (const s of _tseSituations.values()) {
    if (s.state === 'change' && !s.newTeamId) {
      if (status) { status.style.color = 'var(--red)'; status.textContent = `${s.rider.lastName}: elige el equipo de destino del cambio.`; }
      return;
    }
  }

  if (status) { status.style.color = 'var(--text-dim)'; status.textContent = 'Guardando…'; }
  try {
    for (const s of _tseSituations.values()) {
      const r = s.rider;
      // Nada que hacer si no cambió respecto al estado inicial.
      if (_tseSameSituation(s, s.initial)) continue;

      // Todo estado (menos "sin decidir") reescribe desde cero: limpiar las
      // filas de transfers de T de ese corredor y decidir la afiliación.
      await _tseClearRiderTransfersForTeam(r.id, teamId);

      if (s.state === 'stay') {
        // Vitalicio → año centinela 9999; "sin año" → null; si no, el año.
        const year = s.lifetime ? TSE_LIFETIME_YEAR : (s.yearUnknown ? null : s.year);
        await _upsertAffiliation2027(r.id, r.gender, teamId, year);
        if (s.rumor) {
          const { error } = await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            toTeamId: teamId, type: 'renewal', status: 'rumor',
            contractUntil: year, announcedAt: s.announcedAt || _localDateKey(), dateVisible: true,
          });
          if (error) throw error;
        }
        // Sync opcional del año a la ficha (no el centinela ni el desconocido).
        if (year && year !== TSE_LIFETIME_YEAR) await _syncTransferContractToRider({ status: 'confirmed', type: 'renewal', contractUntil: year, riderGender: r.gender, riderId: r.id });
      } else if (s.state === 'doubt') {
        // Duda: sigue afiliado a T, + rider_transfers renewal+doubt.
        await _upsertAffiliation2027(r.id, r.gender, teamId, s.year || null);
        await supabase.from('rider_transfers').insert({
          id: _tseNewId('tr'),
          season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
          toTeamId: teamId, type: 'renewal', status: 'doubt',
          contractUntil: s.year || null, announcedAt: _localDateKey(), dateVisible: true,
        });
      } else if (s.state === 'change') {
        await _deleteAffiliation2027(r.id, teamId);
        // Un rumor no sale en el feed → su fecha de anuncio es HOY (irrelevante);
        // un cambio confirmado lleva la fecha de confirmación que marcó el editor.
        await supabase.from('rider_transfers').insert({
          id: _tseNewId('tr'),
          season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
          fromTeamId: teamId, toTeamId: s.newTeamId, type: 'transfer',
          status: s.rumor ? 'rumor' : 'confirmed',
          contractUntil: s.year || null,
          announcedAt: (s.rumor ? _localDateKey() : (s.announcedAt || _localDateKey())),
          dateVisible: true,
        });
      } else if (s.state === 'end') {
        await _deleteAffiliation2027(r.id, teamId);
        if (s.retired) {
          await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            fromTeamId: teamId, type: 'retirement', status: 'confirmed',
            announcedAt: _localDateKey(), dateVisible: true,
          });
        } else {
          // Baja sin destino conocido: transfer con destino '?'.
          await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            fromTeamId: teamId, toTeamName: TSE_UNKNOWN_DEST, type: 'transfer', status: 'confirmed',
            announcedAt: _localDateKey(), dateVisible: true,
          });
        }
      } else {
        // 'undecided': ya se limpiaron sus transfers de T arriba; también quitar
        // su afiliación 2027 a T (deja de formar parte hasta que se decida).
        await _deleteAffiliation2027(r.id, teamId);
      }
    }

    showToast('Equipo guardado', 'success', 2500);
    closeDrawer(1);
    await loadTransfers();
    renderMarketTeams();
  } catch (err) {
    console.error('[_tseSaveTeam]', err);
    if (status) { status.style.color = 'var(--red)'; status.textContent = 'Error: ' + (err.message || err); }
  }
}

function _tseSameSituation(a, b) {
  if (a.state !== b.state) return false;
  const yearA = a.state === 'stay' && a.yearUnknown ? null : a.year;
  const yearB = b.state === 'stay' && b.yearUnknown ? null : b.year;
  if ((yearA || null) !== (yearB || null)) return false;
  if (a.state === 'stay' && a.yearUnknown !== b.yearUnknown) return false;
  if (a.state === 'stay' && !!a.lifetime !== !!b.lifetime) return false;
  if (a.state === 'stay' && !!a.rumor !== !!b.rumor) return false;
  if (a.state === 'change') {
    if ((a.newTeamId || null) !== (b.newTeamId || null)) return false;
    if (!!a.rumor !== !!b.rumor) return false;
    // La fecha de confirmación solo importa si NO es rumor.
    if (!a.rumor && (a.announcedAt || null) !== (b.announcedAt || null)) return false;
  }
  if (a.state === 'end' && a.retired !== b.retired) return false;
  return true;
}

// ── Drawer de auditoría: TODOS los movimientos (lista plana, filtros) ──
function openAllTransfersDrawer() {
  openDrawer({
    title: `Todos los movimientos · ${MARKET_SEASON}`,
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = `
        <div class="u-row" style="gap:0.6rem;flex-wrap:wrap;margin-bottom:0.75rem">
          <input type="search" id="transfersSearch" placeholder="Buscar corredor o equipo…" style="flex:1;min-width:12rem;padding:0.4rem 0.7rem;font-size:0.82rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
          <select id="transfersStatusFilter" style="padding:0.4rem 0.5rem;font-size:0.8rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
            <option value="all">Todos</option>
            <option value="confirmed">Confirmados</option>
            <option value="rumor">Rumores</option>
            <option value="doubt">Dudas</option>
            <option value="hidden">Fecha oculta</option>
          </select>
          <button class="btn btn--primary" id="addTransferBtn" style="padding:0.4rem 0.8rem;font-size:0.78rem">+ Nuevo movimiento</button>
          <span class="u-fs-sm u-c-dim" id="transfersCount" style="align-self:center"></span>
        </div>
        <div class="u-stack u-stack--xs" id="transfersList"><div class="u-fs-085 u-c-dim">Cargando…</div></div>
      `;
      document.getElementById('addTransferBtn').addEventListener('click', () => openTransferEditor(null));
      document.getElementById('transfersStatusFilter').addEventListener('change', renderTransfersList);
      document.getElementById('transfersSearch').addEventListener('input', renderTransfersList);
      renderTransfersList();
    },
  });
}

async function loadTransfers() {
  const list = document.getElementById('transfersList');
  if (list) list.innerHTML = '<div class="u-fs-085 u-c-dim">Cargando…</div>';
  try {
    const [transfersRes, seasonsRes, prevSeasonsRes] = await Promise.all([
      supabase.from('rider_transfers')
        .select('*')
        .eq('season', MARKET_SEASON)
        .order('announcedAt', { ascending: false })
        .order('createdAt', { ascending: false }),
      supabase.from('team_seasons')
        .select('teamId, name, category, badgeVisible, continuityDoubt')
        .eq('year', MARKET_SEASON),
      supabase.from('team_seasons').select('teamId, name').eq('year', MARKET_PREV_SEASON),
    ]);
    if (transfersRes.error) throw transfersRes.error;
    if (seasonsRes.error) throw seasonsRes.error;
    if (prevSeasonsRes.error) throw prevSeasonsRes.error;
    const rows = transfersRes.data || [];
    // Filas completas de la temporada del mercado: alimentan la lista de
    // equipos 2027 de esta vista (renombres, chapa, continuidad en duda).
    _marketSeasons = seasonsRes.data || [];
    _trTeamNameById = new Map(_marketSeasons.map(s => [s.teamId, s.name]));
    _trTeamNamePrev = new Map((prevSeasonsRes.data || []).map(s => [s.teamId, s.name]));

    // Hidratar fichas (nombre + bandera) por género, en bulk.
    const cols = 'id, firstName, lastName, nationality, currentTeamId, contractUntil';
    const menIds   = [...new Set(rows.filter(r => r.riderGender === 'male').map(r => r.riderId))];
    const womenIds = [...new Set(rows.filter(r => r.riderGender === 'female').map(r => r.riderId))];
    const [men, women] = await Promise.all([
      menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
      womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
    ]);
    const riderByKey = new Map();
    men.forEach(r => riderByKey.set(`male:${r.id}`, r));
    women.forEach(r => riderByKey.set(`female:${r.id}`, r));
    _transfersCache = rows.map(t => ({ ...t, rider: riderByKey.get(`${t.riderGender}:${t.riderId}`) || null }));
  } catch (err) {
    console.error('[loadTransfers]', err);
    if (list) list.innerHTML = `<div style="color:var(--red);font-size:0.85rem">Error cargando los movimientos: ${esc(err.message || String(err))}</div>`;
    _transfersCache = [];
  }
}

const TRANSFER_TYPE_LABELS = { transfer: 'Fichaje', renewal: 'Renovación', retirement: 'Retirada' };

// `side`: 'from' → nombre de la temporada en curso (el equipo que el corredor
// deja); 'to' → nombre de la temporada del mercado (con el que va a correr).
// Último recurso = el catálogo `teams`, para equipos sin fila en ninguna de las
// dos temporadas (destinos fuera de las 4 divisiones sembradas…).
function _trTeamLabel(teamId, freeText, side = 'to') {
  if (!teamId) return freeText || '—';
  const primary  = side === 'from' ? _trTeamNamePrev : _trTeamNameById;
  const fallback = side === 'from' ? _trTeamNameById : _trTeamNamePrev;
  return primary.get(teamId)
    || fallback.get(teamId)
    || (_teamsCache || []).find(x => x.id === teamId)?.name
    || teamId;
}

function _trRiderLabel(t) {
  const r = t.rider;
  return r ? `${r.lastName}, ${r.firstName}` : t.riderId;
}

// El volcado inicial asignó 20/07/2026 a las filas sin fecha editorial. Sus
// timestamps de creación/actualización difieren como máximo unas décimas por
// los defaults y triggers del lote; cualquier diferencia >= 1 s indica edición.
function _trIsDefaultImport(t) {
  if (t.announcedAt !== '2026-07-20') return false;
  const created = Date.parse(t.createdAt || '');
  const updated = Date.parse(t.updatedAt || '');
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;

  const unchangedSinceImport = Math.abs(updated - created) < 1000;
  // Ocho bajas sin destino de UAE Team L'IMAD recibieron juntas una actualización
  // técnica el 27/07, sin edición editorial. Una edición posterior cambia updatedAt.
  const uaeLegacyBatchUpdate =
    created === Date.parse('2026-07-20T13:00:57.868Z') &&
    updated === Date.parse('2026-07-27T09:52:12.424Z') &&
    t.type === 'transfer' && t.status === 'confirmed' &&
    !t.toTeamId && t.toTeamName === TSE_UNKNOWN_DEST;

  return unchangedSinceImport || uaeLegacyBatchUpdate;
}

function renderTransfersList() {
  const container = document.getElementById('transfersList');
  const countEl = document.getElementById('transfersCount');
  if (!container) return;

  const statusFilter = document.getElementById('transfersStatusFilter')?.value || 'all';
  const q = (document.getElementById('transfersSearch')?.value || '').toLowerCase().trim();

  const filtered = (_transfersCache || []).filter(t => {
    // Las filas del volcado inicial sin edición manual no aportan una novedad
    // editorial. Aparecen en cuanto se modifica cualquier campo o su fecha.
    if (_trIsDefaultImport(t)) return false;
    // 'hidden' no es un status: cruza los tres (lo que no sale en el feed).
    if (statusFilter === 'hidden') {
      if (t.dateVisible !== false) return false;
    } else if (statusFilter !== 'all' && t.status !== statusFilter) {
      return false;
    }
    if (!q) return true;
    const hay = [
      _trRiderLabel(t),
      _trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'),
      _trTeamLabel(t.toTeamId, t.toTeamName),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (countEl) countEl.textContent = filtered.length ? `${filtered.length} movimiento${filtered.length === 1 ? '' : 's'}` : '';

  if (filtered.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:0.5rem 0">
      ${(_transfersCache || []).length === 0
        ? 'No hay movimientos todavía. Pulsa <strong>+ Nuevo movimiento</strong> para registrar el primero.'
        : 'Sin resultados con ese filtro.'}
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const isRumor = t.status === 'rumor';
    const isDoubt = t.status === 'doubt';
    const dateHidden = t.dateVisible === false;
    const dateBit = t.announcedAt ? `${t.announcedAt.slice(8, 10)}/${t.announcedAt.slice(5, 7)}/${t.announcedAt.slice(2, 4)}` : '';
    // Una DUDA no es una renovación: es "duda de si sigue o se va". Se etiqueta
    // como Duda y su texto es neutro ("en duda · <equipo>"), no "renueva con".
    const typeLabel = isDoubt ? 'Duda' : (TRANSFER_TYPE_LABELS[t.type] || t.type);
    let movement;
    if (isDoubt) {
      movement = `en duda <span class="u-c-dim">·</span> <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    } else if (t.type === 'renewal') {
      movement = `renueva con <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    } else if (t.type === 'retirement') {
      movement = `se retira <span class="u-c-dim">(${esc(_trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'))})</span>`;
    } else {
      movement = `${esc(_trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'))} <span class="u-c-dim">→</span> <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    }
    const contractBit = t.contractUntil
      ? `<span class="u-c-dim" style="white-space:nowrap">${t.contractUntil === TSE_LIFETIME_YEAR ? 'vitalicio ∞' : `hasta ${esc(String(t.contractUntil))}`}</span>`
      : '';
    const chipCss = 'font-size:0.64rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:0.12rem 0.4rem;border-radius:4px;white-space:nowrap';
    const statusChip = isRumor
      ? `<span style="${chipCss};background:rgba(245,158,11,0.15);color:#f59e0b">Rumor</span>`
      : isDoubt
      ? `<span style="${chipCss};background:rgba(139,92,246,0.15);color:#8b5cf6">Duda</span>`
      : `<span style="${chipCss};background:var(--accent-dim, rgba(26,115,232,0.12));color:var(--accent)">Confirmado</span>`;
    const midSeasonChip = t.midSeason
      ? `<span style="${chipCss};background:rgba(59,130,246,0.14);color:#2563eb">M. temporada</span>`
      : '';
    const borderColor = isRumor ? '#f59e0b' : isDoubt ? '#8b5cf6' : 'var(--border)';
    // Fecha tachada = no sale en el feed público (dateVisible=false).
    const dateStyle = dateHidden ? 'text-decoration:line-through;opacity:0.55' : '';
    return `
      <div class="transfer-row" data-id="${esc(t.id)}" style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0.65rem;background:var(--bg-card);border:1px solid ${borderColor};border-radius:6px;flex-wrap:wrap">
        <span class="u-fs-xs u-c-dim" style="width:4.2em;flex-shrink:0;${dateStyle}" ${dateHidden ? 'title="Oculto del listado de últimos"' : ''}>${esc(dateBit)}</span>
        <span style="flex-shrink:0;width:1.5em;text-align:center">${_slRiderFlagPreview(t.rider?.nationality || '')}</span>
        <span style="min-width:10rem;font-size:0.85rem"><strong>${esc(_trRiderLabel(t))}</strong>
          <span class="u-c-dim" style="font-size:0.66rem;margin-left:0.25rem">${t.riderGender === 'female' ? '♀' : '♂'}</span>
        </span>
        <span class="u-fs-xs u-c-dim" style="white-space:nowrap">${esc(typeLabel)}</span>
        <span style="flex:1;min-width:12rem;font-size:0.8rem">${movement} ${contractBit}</span>
        ${statusChip}
        ${midSeasonChip}
        ${isRumor || isDoubt ? `<button class="btn btn--ghost transfer-confirm" style="padding:0.2rem 0.5rem;font-size:0.72rem;color:var(--accent)">Confirmar</button>` : ''}
        <button class="btn btn--ghost transfer-edit" style="padding:0.2rem 0.5rem;font-size:0.72rem">Editar</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.transfer-row').forEach(rowEl => {
    const t = (_transfersCache || []).find(x => x.id === rowEl.dataset.id);
    if (!t) return;
    rowEl.querySelector('.transfer-edit')?.addEventListener('click', () => openTransferEditor(t));
    rowEl.querySelector('.transfer-confirm')?.addEventListener('click', () => confirmTransferQuick(t));
  });
}

// Confirmación rápida de un rumor o una duda desde el listado: pasa a
// confirmado con fecha de anuncio HOY (editable después en el editor) + sync
// de contrato. Confirmar es PUBLICAR → la fecha se hace visible aunque
// estuviera oculta (si no, quedaría confirmado pero fuera del feed).
async function confirmTransferQuick(t) {
  const label = TRANSFER_TYPE_LABELS[t.type] || t.type;
  if (!await confirmDialog(`¿Confirmar ${label.toLowerCase()} de ${_trRiderLabel(t)}? La fecha de anuncio pasará a hoy (editable).`)) return;
  try {
    const { error } = await supabase.from('rider_transfers')
      .update({ status: 'confirmed', announcedAt: _localDateKey(), dateVisible: true, updatedAt: new Date().toISOString() })
      .eq('id', t.id);
    if (error) throw error;
    // Un corredor = un solo movimiento: al confirmar, el resto de sus movimientos
    // de la temporada sobran (p. ej. un fin de contrato huérfano tras confirmar un
    // rumor de fichaje). Antes de sincronizar la afiliación del destino.
    await _clearOtherTransfersForRider(t.riderId, t.id);
    await _syncTransferContractToRider({ ...t, status: 'confirmed' });
    // Confirmar un fichaje lo mete en la plantilla 2027 (materializa la afiliación).
    await _syncSigningAffiliation({ ...t, status: 'confirmed' });
    showToast('Movimiento confirmado', 'success', 2500);
    await loadTransfers();
    renderTransfersList();
  } catch (err) {
    console.error('[confirmTransferQuick]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Sync del fin de contrato a la ficha: solo movimientos CONFIRMADOS con año de
// contrato. Ni un rumor ni una DUDA tocan la ficha (no son hechos: no pueden
// pisar el contrato conocido); una retirada tampoco.
async function _syncTransferContractToRider(t) {
  if (t.status !== 'confirmed' || !t.contractUntil || t.contractUntil === TSE_LIFETIME_YEAR || t.type === 'retirement') return;
  const table = t.riderGender === 'male' ? 'riders_men' : 'riders_women';
  const { error } = await supabase.from(table)
    .update({ contractUntil: t.contractUntil, updatedAt: new Date().toISOString() })
    .eq('id', t.riderId);
  if (error) console.warn('[transfers] sync contractUntil a la ficha falló', error);
}

// ── Editor de movimiento (drawer nivel 1) ─────────────────────────
function transferEditorBodyHtml() {
  return `
    <div class="u-stack">
      <div class="field" id="tr-rider-row">
        <label>Corredor</label>
        <input type="search" id="tr-rider-search" placeholder="Busca por nombre o apellido (mín. 3 letras)…" autocomplete="off" class="u-w-full">
        <div id="tr-rider-results" style="display:none;flex-direction:column;gap:0.2rem;max-height:240px;overflow-y:auto;margin-top:0.25rem"></div>
        <div id="tr-rider-selected" style="display:none;padding:0.5rem 0.7rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-top:0.25rem;align-items:center;gap:0.6rem">
          <span id="tr-rider-selected-flag" style="width:1.5em;text-align:center"></span>
          <span id="tr-rider-selected-name" style="flex:1;font-size:0.9rem;font-weight:600"></span>
          <span id="tr-rider-selected-team" class="u-fs-xs u-c-dim"></span>
          <button class="btn btn--ghost" id="tr-rider-clear" style="padding:0.25rem 0.55rem;font-size:0.72rem">Cambiar</button>
        </div>
      </div>

      <div>
        <label style="display:block;font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:0.4rem">Situación ${MARKET_SEASON}</label>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
          ${TSE_STATES.map(st => `<button type="button" class="tr-situation-btn" data-state="${st.key}"
            style="padding:0.3rem 0.65rem;font-size:0.78rem;font-weight:600;border:1px solid var(--border);border-radius:5px;cursor:pointer;background:transparent;color:var(--text-muted)">${st.label}</button>`).join('')}
        </div>
      </div>

      <div class="field" id="tr-from-row">
        <label>Equipo de origen <span class="u-dim" id="tr-from-hint">— solo editable si el corredor no tiene equipo asociado</span></label>
        <div id="tr-from-associated" class="u-fs-085" style="display:none;padding:0.45rem 0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:5px"></div>
        <div class="u-row u-row--gap-sm" id="tr-from-inputs">
          <select id="tr-fromTeamId" style="flex:1;min-width:10rem"></select>
          <input type="text" id="tr-fromTeamName" placeholder="Texto libre (júnior, amateur…)" style="flex:1;min-width:8rem">
        </div>
      </div>

      <div class="field" id="tr-to-row">
        <label>Equipo de destino <span class="u-dim">— si no está en el catálogo, usa el texto libre</span></label>
        <div class="u-row u-row--gap-sm">
          <select id="tr-toTeamId" style="flex:1;min-width:10rem"></select>
          <input type="text" id="tr-toTeamName" placeholder="Texto libre" style="flex:1;min-width:8rem">
        </div>
      </div>

      <div class="field-row field-row--3" id="tr-detail-row">
        <div class="field" id="tr-contract-row">
          <label>Contrato hasta <span class="u-dim">— año</span></label>
          <input type="number" id="tr-contractUntil" min="2026" max="2040" placeholder="2029" class="u-w-full">
          <div id="tr-stay-contract-options" style="display:none;gap:0.8rem;flex-wrap:wrap;margin-top:0.4rem">
            <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;cursor:pointer"><input type="checkbox" id="tr-yearUnknown"><span>No se sabe el año</span></label>
            <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;cursor:pointer"><input type="checkbox" id="tr-lifetime"><span>Vitalicio ∞</span></label>
          </div>
        </div>
        <div class="field" id="tr-flags-row">
          <label>Condición</label>
          <label id="tr-rumor-label" style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;padding-top:0.35rem">
            <input type="checkbox" id="tr-rumor"><span>Rumor (sin confirmar)</span>
          </label>
          <label id="tr-retired-label" style="display:none;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;padding-top:0.35rem">
            <input type="checkbox" id="tr-retired"><span>Se retira</span>
          </label>
          <span id="tr-doubt-label" class="u-fs-sm u-c-dim" style="display:none;padding-top:0.35rem">Duda de renovación.</span>
        </div>
        <div class="field">
          <label>Fecha del anuncio</label>
          <input type="date" id="tr-announcedAt" class="u-w-full">
          <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.8rem;margin-top:0.35rem">
            <input type="checkbox" id="tr-dateHidden">
            <span>Ocultar del listado de últimos</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.8rem;margin-top:0.35rem">
            <input type="checkbox" id="tr-midSeason">
            <span>Fichaje de mitad de temporada</span>
          </label>
        </div>
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn--primary" id="saveTransferBtn">Guardar</button>
      <button class="btn btn--ghost" id="deleteTransferBtn" style="color:var(--red);display:none">Eliminar</button>
      <span class="u-fs-md u-c-dim" id="transferSaveStatus"></span>
    </div>
  `;
}

function wireTransferEditor() {
  document.getElementById('saveTransferBtn').addEventListener('click', saveTransfer);
  document.getElementById('deleteTransferBtn').addEventListener('click', deleteTransfer);
  document.getElementById('tr-rider-clear').addEventListener('click', _trClearRiderSelection);
  document.getElementById('tr-rider-search').addEventListener('input', (e) => {
    clearTimeout(_trSearchDebounce);
    _trSearchDebounce = setTimeout(() => _trSearchRiders(e.target.value), 280);
  });
  document.querySelectorAll('.tr-situation-btn').forEach(btn => btn.addEventListener('click', () => {
    _trSituationState = btn.dataset.state;
    _trRefreshTypeVisibility();
  }));
  document.getElementById('tr-yearUnknown')?.addEventListener('change', (e) => {
    _trYearUnknown = e.target.checked;
    if (_trYearUnknown) _trLifetime = false;
    _trRefreshTypeVisibility();
  });
  document.getElementById('tr-lifetime')?.addEventListener('change', (e) => {
    _trLifetime = e.target.checked;
    if (_trLifetime) _trYearUnknown = false;
    _trRefreshTypeVisibility();
  });
}

// Muestra los mismos cuatro estados que el editor por equipo. El equipo asociado
// fija origen y continuidad; un origen manual solo existe para fichas sin equipo.
function _trRefreshTypeVisibility() {
  const state = _trSituationState;
  const hasSituation = TSE_STATES.some(x => x.key === state);
  const fromRow = document.getElementById('tr-from-row');
  const toRow   = document.getElementById('tr-to-row');
  const hasAssociatedTeam = !!_trSelectedRider?.currentTeamId;
  const needsOrigin = state === 'change' || state === 'end';
  if (fromRow) fromRow.style.display = needsOrigin ? '' : 'none';
  if (toRow) toRow.style.display = state === 'change' ? '' : 'none';
  const associated = document.getElementById('tr-from-associated');
  const inputs = document.getElementById('tr-from-inputs');
  if (associated) {
    associated.style.display = needsOrigin && hasAssociatedTeam ? '' : 'none';
    const team = (_teamsCache || []).find(t => t.id === _trSelectedRider?.currentTeamId);
    associated.textContent = team?.name || _trSelectedRider?.currentTeamId || '';
  }
  if (inputs) inputs.style.display = needsOrigin && !hasAssociatedTeam ? 'flex' : 'none';

  const contractRow = document.getElementById('tr-contract-row');
  if (contractRow) contractRow.style.display = state === 'end' ? 'none' : '';
  const detailRow = document.getElementById('tr-detail-row');
  if (detailRow) detailRow.style.display = hasSituation ? '' : 'none';
  const stayOpts = document.getElementById('tr-stay-contract-options');
  if (stayOpts) stayOpts.style.display = state === 'stay' ? 'flex' : 'none';
  const contractInput = document.getElementById('tr-contractUntil');
  if (contractInput) contractInput.disabled = state === 'stay' && (_trYearUnknown || _trLifetime);
  const unknown = document.getElementById('tr-yearUnknown');
  const lifetime = document.getElementById('tr-lifetime');
  if (unknown) unknown.checked = _trYearUnknown;
  if (lifetime) lifetime.checked = _trLifetime;

  const rumorLabel = document.getElementById('tr-rumor-label');
  const retiredLabel = document.getElementById('tr-retired-label');
  const doubtLabel = document.getElementById('tr-doubt-label');
  if (rumorLabel) rumorLabel.style.display = state === 'stay' || state === 'change' ? 'inline-flex' : 'none';
  if (retiredLabel) retiredLabel.style.display = state === 'end' ? 'inline-flex' : 'none';
  if (doubtLabel) doubtLabel.style.display = state === 'doubt' ? 'block' : 'none';
  const mid = document.getElementById('tr-midSeason')?.closest('label');
  if (mid) mid.style.display = state === 'change' ? 'inline-flex' : 'none';

  document.querySelectorAll('.tr-situation-btn').forEach(btn => {
    const meta = TSE_STATES.find(x => x.key === btn.dataset.state);
    const active = btn.dataset.state === state;
    btn.style.borderColor = active ? meta.color : 'var(--border)';
    btn.style.background = active ? meta.color + '22' : 'transparent';
    btn.style.color = active ? meta.color : 'var(--text-muted)';
  });
}

function _trPopulateTeamSelect(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const gender = _trSelectedRider?.gender || null;
  const teams = (_teamsCache || [])
    .filter(t => !t.specialEdition && (!gender || !t.gender || t.gender === gender))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">— Fuera del catálogo / ninguno —</option>' +
    teams.map(t =>
      `<option value="${esc(t.id)}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`
    ).join('');
  sel.value = selectedId || '';
}

async function _trSearchRiders(q) {
  const results = document.getElementById('tr-rider-results');
  if (!results) return;
  const term = (q || '').trim();
  if (term.length < 3) { results.style.display = 'none'; results.innerHTML = ''; return; }
  const safe = term.replace(/[%,()]/g, '');
  results.style.display = 'flex';
  results.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:0.3rem 0">Buscando…</div>';
  try {
    const cols = 'id, firstName, lastName, nationality, birthDate, currentTeamId, contractUntil';
    const filter = `lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`;
    const [men, women] = await Promise.all([
      supabase.from('riders_men').select(cols).or(filter).order('lastName').limit(12).then(r => r.data || []),
      supabase.from('riders_women').select(cols).or(filter).order('lastName').limit(12).then(r => r.data || []),
    ]);
    const rows = [
      ...men.map(r => ({ ...r, gender: 'male' })),
      ...women.map(r => ({ ...r, gender: 'female' })),
    ].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
    if (rows.length === 0) {
      results.innerHTML = `
        <div style="color:var(--text-dim);font-size:0.8rem;padding:0.3rem 0">Sin resultados para «${esc(term)}».</div>
        ${_trCreateRiderBtnHtml(term)}`;
      _trWireCreateRiderBtn(term);
      return;
    }
    results.innerHTML = rows.map((r, i) => {
      const team = r.currentTeamId ? (_teamsCache || []).find(t => t.id === r.currentTeamId) : null;
      return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.5rem;border-radius:5px;background:var(--bg-card);border:1px solid var(--border);cursor:pointer" data-idx="${i}">
        <span style="width:1.5em;text-align:center">${_slRiderFlagPreview(r.nationality)}</span>
        <span style="flex:1;min-width:0;font-size:0.82rem"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
          <span class="u-c-dim u-fs-070">${r.gender === 'female' ? '♀' : '♂'}${r.birthDate ? ` '${esc(String(r.birthDate).slice(2, 4))}` : ''}</span>
          ${team ? `<span style="display:block;font-size:0.66rem;color:var(--text-dim)">${esc(team.name)}</span>` : ''}
        </span>
      </div>`;
    // Con resultados también se ofrece crear: ninguno puede ser el corredor
    // buscado (homónimos, o la ficha aún no existe pese a haber parecidos).
    }).join('') + _trCreateRiderBtnHtml(term);
    results.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => _trSelectRider(rows[Number(el.dataset.idx)]));
    });
    _trWireCreateRiderBtn(term);
  } catch (err) {
    console.error('[_trSearchRiders]', err);
    results.innerHTML = `<div style="color:var(--red);font-size:0.8rem;padding:0.3rem 0">Error: ${esc(err.message || String(err))}</div>`;
  }
}

/**
 * Atajo para dar de alta una ficha que no está en el catálogo sin salir del
 * editor del movimiento (el mercado trae corredores nuevos constantemente:
 * júniors que suben, fichajes desde fuera del catálogo).
 */
function _trCreateRiderBtnHtml(term) {
  return `<button type="button" class="btn btn--ghost" id="tr-create-rider"
    style="padding:0.3rem 0.6rem;font-size:0.76rem;color:var(--accent);align-self:flex-start;margin-top:0.15rem">
    + Crear ficha de «${esc(term)}»
  </button>`;
}

function _trWireCreateRiderBtn(term) {
  const btn = document.getElementById('tr-create-rider');
  if (btn) btn.addEventListener('click', () => _trCreateRiderFromSearch(term));
}

/**
 * Abre el editor de ficha ESTÁNDAR en drawer nivel 2 (sobre el del movimiento),
 * precargado con lo tecleado. Reutilizarlo —en vez de un mini-formulario propio—
 * mantiene una sola vía de alta: el id sale del plegado canónico (fold_name_rpc)
 * y las colisiones de identityKey siguen ofreciendo fusionar en vez de crear un
 * duplicado, que es justo lo que ensucia el catálogo.
 * Al guardar, la ficha queda seleccionada en el movimiento (_onRiderSavedOnce).
 */
async function _trCreateRiderFromSearch(term) {
  // El género del movimiento lo decide la ficha; por defecto, el de la división
  // del equipo de origen si ya se eligió (si no, masculino, editable).
  const fromTeamId = document.getElementById('tr-fromTeamId')?.value || '';
  const fromTeam = (_teamsCache || []).find(t => t.id === fromTeamId);
  _ridersGender = fromTeam?.gender === 'female' ? 'female' : 'male';

  _ridersAllCache = [];
  openRiderEditor(null);          // nivel 2: se apila sobre el movimiento

  // Precargar lo tecleado: "Apellido, Nombre" o "Nombre Apellido" → campos.
  const parts = term.split(',').map(s => s.trim()).filter(Boolean);
  let firstName = '', lastName = term.trim();
  if (parts.length >= 2) {
    lastName = parts[0];
    firstName = parts.slice(1).join(' ');
  } else {
    const words = term.trim().split(/\s+/);
    if (words.length >= 2) { firstName = words[0]; lastName = words.slice(1).join(' '); }
  }
  const fnEl = document.getElementById('re-firstName');
  const lnEl = document.getElementById('re-lastName');
  if (fnEl) fnEl.value = firstName;
  if (lnEl) lnEl.value = lastName;
  if (fromTeamId) {
    const teamSel = document.getElementById('re-teamId');
    if (teamSel) teamSel.value = fromTeamId;   // equipo actual = el de origen
  }
  const st = document.getElementById('riderSaveStatus');
  if (st) st.textContent = 'Ficha nueva para el mercado: al guardar queda seleccionada en el movimiento.';
  (firstName ? lnEl : fnEl)?.focus();

  // Al guardar: seleccionar en el movimiento y cerrar el drawer de la ficha.
  _onRiderSavedOnce = (rider) => {
    _trSelectRider({
      id: rider.id,
      gender: rider.gender,
      firstName: rider.firstName,
      lastName: rider.lastName,
      nationality: rider.nationality,
      currentTeamId: rider.currentTeamId,
      contractUntil: rider.contractUntil,
    });
    closeDrawer(2);
  };
}

function _trSelectRider(r) {
  _trSelectedRider = r;
  const search = document.getElementById('tr-rider-search');
  const results = document.getElementById('tr-rider-results');
  const sel = document.getElementById('tr-rider-selected');
  if (search) { search.style.display = 'none'; search.value = ''; }
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
  if (sel) sel.style.display = 'flex';
  const team = r.currentTeamId ? (_teamsCache || []).find(t => t.id === r.currentTeamId) : null;
  document.getElementById('tr-rider-selected-flag').innerHTML = _slRiderFlagPreview(r.nationality || '');
  document.getElementById('tr-rider-selected-name').textContent = `${r.lastName}, ${r.firstName} ${r.gender === 'female' ? '♀' : '♂'}`;
  document.getElementById('tr-rider-selected-team').textContent = team ? team.name : (r.currentTeamId || 'sin equipo');
  // Repoblar selects con el género del corredor + preseleccionar su equipo
  // actual como origen (si el campo estaba vacío).
  const fromSel = document.getElementById('tr-fromTeamId');
  const prevFrom = fromSel?.value || '';
  _trPopulateTeamSelect('tr-fromTeamId', prevFrom || r.currentTeamId || '');
  _trPopulateTeamSelect('tr-toTeamId', document.getElementById('tr-toTeamId')?.value || '');
  _trRefreshTypeVisibility();
  if (!_editingTransferId) _trResolveSelectedRiderSituation(r);
}

// Carga en el formulario una situación ya registrada. Cuando procede de un
// rider_transfers real, el drawer pasa a editar esa fila en lugar de crear un
// duplicado. Una situación sintética derivada de afiliación solo precarga la UI.
function _trApplySituation(t, { existing = false } = {}) {
  const isContractEnd = t?.type === 'transfer' && !t?.toTeamId && t?.toTeamName === TSE_UNKNOWN_DEST;
  _trSituationState = t?.type === 'renewal'
    ? (t.status === 'doubt' ? 'doubt' : 'stay')
    : (t?.type === 'retirement' || isContractEnd)
      ? 'end'
      : 'change';
  _trLifetime = _trSituationState === 'stay' && t?.contractUntil === TSE_LIFETIME_YEAR;
  _trYearUnknown = _trSituationState === 'stay' && t?.contractUntil == null;

  if (existing) {
    _editingTransferId = t.id;
    _trAutoResolvedExisting = true;
    const title = document.getElementById('ccDrawer1Title');
    if (title) title.textContent = 'Editar movimiento';
    const del = document.getElementById('deleteTransferBtn');
    if (del) del.style.display = 'inline-block';
  }

  const presetTo = _trSituationState === 'change' ? (t?.toTeamId || '') : '';
  _trPopulateTeamSelect('tr-fromTeamId', t?.fromTeamId || _trSelectedRider?.currentTeamId || '');
  _trPopulateTeamSelect('tr-toTeamId', presetTo);
  document.getElementById('tr-fromTeamName').value = t?.fromTeamName || '';
  document.getElementById('tr-toTeamName').value = _trSituationState === 'change' ? (t?.toTeamName || '') : '';
  document.getElementById('tr-contractUntil').value = _trLifetime ? '' : (t?.contractUntil || '');
  document.getElementById('tr-rumor').checked = t?.status === 'rumor';
  document.getElementById('tr-retired').checked = t?.type === 'retirement';
  document.getElementById('tr-announcedAt').value = t?.announcedAt || _localDateKey();
  document.getElementById('tr-dateHidden').checked = t ? t.dateVisible === false : false;
  document.getElementById('tr-midSeason').checked = t?.midSeason === true;
  _trRefreshTypeVisibility();
}

async function _trResolveSelectedRiderSituation(r) {
  const existing = (_transfersCache || []).find(t =>
    t.riderId === r.id && t.riderGender === r.gender && !t.midSeason);
  if (existing) {
    _trApplySituation(existing, { existing: true });
    return;
  }

  const selectedKey = `${r.gender}:${r.id}`;
  const status = document.getElementById('transferSaveStatus');
  if (status) status.textContent = 'Comprobando situación registrada…';
  const { data: aff, error } = await supabase.from('rider_team_affiliations')
    .select('teamId, dateTo')
    .eq('riderId', r.id)
    .eq('riderGender', r.gender)
    .eq('year', MARKET_SEASON)
    .limit(1)
    .maybeSingle();
  if (`${_trSelectedRider?.gender}:${_trSelectedRider?.id}` !== selectedKey || _editingTransferId) return;
  if (status) status.textContent = '';
  if (error) {
    console.error('[_trResolveSelectedRiderSituation]', error);
    return;
  }
  if (!aff) {
    _trSituationState = _transferEditorOpts?.presetToTeamId ? 'change' : 'undecided';
    _trRefreshTypeVisibility();
    return;
  }

  const contractUntil = _affYear(aff.dateTo);
  const derived = aff.teamId === r.currentTeamId
    ? { type: 'renewal', status: 'confirmed', toTeamId: aff.teamId, contractUntil }
    : { type: 'transfer', status: 'confirmed', fromTeamId: r.currentTeamId, toTeamId: aff.teamId, contractUntil };
  _trApplySituation(derived);
}

function _trClearRiderSelection() {
  if (_trAutoResolvedExisting) {
    _editingTransferId = null;
    _trAutoResolvedExisting = false;
    const title = document.getElementById('ccDrawer1Title');
    if (title) title.textContent = 'Nuevo movimiento';
    const del = document.getElementById('deleteTransferBtn');
    if (del) del.style.display = 'none';
  }
  _trSelectedRider = null;
  const search = document.getElementById('tr-rider-search');
  const sel = document.getElementById('tr-rider-selected');
  if (search) { search.style.display = ''; search.value = ''; search.focus(); }
  if (sel) sel.style.display = 'none';
  _trRefreshTypeVisibility();
}

// opts = { presetToTeamId, onSaved } — usado por "Nueva incorporación" del
// editor de equipo: prefija el destino y ejecuta un hook al guardar (para
// materializar la afiliación 2027 y volver al equipo).
let _transferEditorOpts = null;

function openTransferEditor(t, opts = null) {
  _editingTransferId = t?.id || null;
  _trAutoResolvedExisting = false;
  _transferEditorOpts = opts;

  openDrawer({
    title: t ? 'Editar movimiento' : 'Nuevo movimiento',
    level: 1,
    render: (body) => {
      body.innerHTML = transferEditorBodyHtml();
      wireTransferEditor();
    },
    onClose: () => { _transferEditorOpts = null; },
  });

  document.getElementById('transferSaveStatus').textContent = '';
  document.getElementById('deleteTransferBtn').style.display = t ? 'inline-block' : 'none';

  // Estado base. Un movimiento nuevo no presupone un cambio: al seleccionar
  // corredor se resuelve su situación real; si no existe, el usuario la marca.
  _trSituationState = opts?.presetToTeamId ? 'change' : 'undecided';
  _trLifetime = false;
  _trYearUnknown = false;

  // Corredor
  _trSelectedRider = null;
  if (t) {
    const r = t.rider || { id: t.riderId, firstName: '', lastName: t.riderId, nationality: '', currentTeamId: null };
    _trSelectRider({ ...r, gender: t.riderGender });
  } else {
    _trClearRiderSelection();
  }

  if (t) {
    _trApplySituation(t);
  } else {
    _trPopulateTeamSelect('tr-fromTeamId', '');
    _trPopulateTeamSelect('tr-toTeamId', opts?.presetToTeamId || '');
    document.getElementById('tr-fromTeamName').value = '';
    document.getElementById('tr-toTeamName').value = '';
    document.getElementById('tr-contractUntil').value = '';
    document.getElementById('tr-rumor').checked = false;
    document.getElementById('tr-retired').checked = false;
    document.getElementById('tr-announcedAt').value = _localDateKey();
    document.getElementById('tr-dateHidden').checked = false;
    document.getElementById('tr-midSeason').checked = false;
    _trRefreshTypeVisibility();
  }
}

async function saveTransfer() {
  const status = document.getElementById('transferSaveStatus');
  status.style.color = 'var(--text-dim)';

  if (!_trSelectedRider) { status.style.color = 'var(--red)'; status.textContent = 'Selecciona un corredor.'; return; }

  const state = _trSituationState;
  if (!TSE_STATES.some(x => x.key === state)) {
    status.style.color = 'var(--red)'; status.textContent = 'Selecciona la situación 2027.'; return;
  }
  const associatedTeamId = _trSelectedRider.currentTeamId || null;
  let type = null, trStatus = 'confirmed';
  let fromTeamId = null, fromTeamName = null, toTeamId = null, toTeamName = null;

  if (state === 'stay' || state === 'doubt') {
    if (!associatedTeamId) {
      status.style.color = 'var(--red)';
      status.textContent = 'Para continuar o quedar en duda, el corredor necesita un equipo asociado en su ficha.';
      return;
    }
    type = 'renewal';
    trStatus = state === 'doubt' ? 'doubt' : (document.getElementById('tr-rumor').checked ? 'rumor' : 'confirmed');
    toTeamId = associatedTeamId;
  } else {
    fromTeamId = associatedTeamId || document.getElementById('tr-fromTeamId').value || null;
    fromTeamName = associatedTeamId ? null : (document.getElementById('tr-fromTeamName').value.trim() || null);
    if (fromTeamId) fromTeamName = null;
    if (!fromTeamId && !fromTeamName) {
      status.style.color = 'var(--red)';
      status.textContent = 'Indica el equipo de origen del corredor sin equipo asociado.';
      return;
    }
    if (state === 'change') {
      type = 'transfer';
      trStatus = document.getElementById('tr-rumor').checked ? 'rumor' : 'confirmed';
      toTeamId = document.getElementById('tr-toTeamId').value || null;
      toTeamName = document.getElementById('tr-toTeamName').value.trim() || null;
      if (toTeamId) toTeamName = null;
      if (!toTeamId && !toTeamName) {
        status.style.color = 'var(--red)'; status.textContent = 'Elige el equipo de destino (catálogo o texto libre).'; return;
      }
      if (toTeamId && toTeamId === fromTeamId) {
        status.style.color = 'var(--red)'; status.textContent = 'El destino debe ser distinto del equipo de origen.'; return;
      }
    } else {
      const retired = document.getElementById('tr-retired').checked;
      type = retired ? 'retirement' : 'transfer';
      toTeamName = retired ? null : TSE_UNKNOWN_DEST;
    }
  }

  const contractRaw = state === 'end' ? '' : document.getElementById('tr-contractUntil').value.trim();
  const contractUntil = state === 'stay' && _trLifetime
    ? TSE_LIFETIME_YEAR
    : (state === 'stay' && _trYearUnknown ? null : (contractRaw ? parseInt(contractRaw, 10) : null));
  if (contractUntil !== null && contractUntil !== TSE_LIFETIME_YEAR && (isNaN(contractUntil) || contractUntil < 2026 || contractUntil > 2040)) {
    status.style.color = 'var(--red)'; status.textContent = 'El año de contrato debe estar entre 2026 y 2040.'; return;
  }

  const payload = {
    season: MARKET_SEASON,
    riderId: _trSelectedRider.id,
    riderGender: _trSelectedRider.gender,
    fromTeamId, fromTeamName, toTeamId, toTeamName,
    type,
    status: trStatus,
    contractUntil,
    announcedAt: document.getElementById('tr-announcedAt').value || _localDateKey(),
    dateVisible: !document.getElementById('tr-dateHidden').checked,
    midSeason: state === 'change' && document.getElementById('tr-midSeason').checked,
    updatedAt: new Date().toISOString(),
  };

  status.textContent = 'Guardando…';
  try {
    let savedId = _editingTransferId;
    if (_editingTransferId) {
      const { error } = await supabase.from('rider_transfers').update(payload).eq('id', _editingTransferId);
      if (error) throw error;
    } else {
      const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from('rider_transfers').insert({ id, ...payload });
      if (error) throw error;
      _editingTransferId = id;
      savedId = id;
    }
    // Un corredor = un solo movimiento: borrar cualquier otro suyo de la temporada
    // (deja huérfano un fin de contrato al fichar por otro equipo, o duplicados al
    // mismo destino). Antes de sincronizar afiliaciones para no repisar la buena.
    await _clearOtherTransfersForRider(payload.riderId, savedId);
    await _syncTransferContractToRider(payload);
    // Mantener la plantilla 2027 coherente con los cuatro estados del editor.
    await _syncMarketSituationAffiliation(payload);
    const onSaved = _transferEditorOpts?.onSaved;
    showToast('Movimiento guardado', 'success', 2500);
    _transferEditorOpts = null;
    closeDrawer(1);
    _editingTransferId = null;
    if (onSaved) {
      // Hook de "Nueva incorporación": vuelve al editor de equipo (la afiliación
      // ya quedó sincronizada arriba).
      await onSaved({ id: savedId, ...payload });
    } else {
      await loadTransfers();
      renderTransfersList();
      renderMarketTeams();
    }
  } catch (err) {
    console.error('[saveTransfer]', err);
    status.style.color = 'var(--red)';
    status.textContent = 'Error: ' + (err.message || err);
  }
}

async function deleteTransfer() {
  if (!_editingTransferId) return;
  if (!await confirmDialog('¿Eliminar este movimiento del mercado?', { danger: true })) return;
  try {
    // Si el movimiento era un fichaje confirmado, su afiliación 2027 de destino
    // se creó al confirmarlo → limpiarla al borrar (deja de estar en la plantilla).
    const del = (_transfersCache || []).find(x => x.id === _editingTransferId);
    const { error } = await supabase.from('rider_transfers').delete().eq('id', _editingTransferId);
    if (error) throw error;
    if (del && !del.midSeason && del.type === 'transfer' && del.status === 'confirmed' && del.toTeamId) {
      await _deleteAffiliation2027(del.riderId, del.toTeamId);
    }
    showToast('Movimiento eliminado', 'success', 2500);
    closeDrawer(1);
    _editingTransferId = null;
    await loadTransfers();
    renderTransfersList();
  } catch (err) {
    console.error('[deleteTransfer]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

function setupHighlightsView() {
  if (!_highlightsViewReady) {
    _highlightsViewReady = true;
    document.getElementById('addHighlightBtn').addEventListener('click', () => openHighlightEditor(null));
    // El editor de cintillo se renderiza en el drawer; sus listeners se cablean
    // por apertura en wireHighlightEditor() (ver openHighlightEditor).
  }
  fetchHighlights({ force: true })
    .then(_prefetchHighlightsRaceDays)
    .then(renderHighlightsList);
}

/**
 * Resuelve en bulk los `race_days` referenciados por destacados activos para
 * que la lista no muestre "(carrera desconocida)" en filas con `raceDayId` y
 * para poder pintar "Etapa N" en el subtítulo.
 */
async function _prefetchHighlightsRaceDays() {
  const ids = (_highlightsCache || [])
    .map(h => h.raceDayId)
    .filter(Boolean)
    .filter(id => !_highlightRaceDaysByIdCache[id]);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('race_days')
    .select('id, raceId, date, stageNumber, startLocation, finishLocation, primaryType')
    .in('id', ids);
  if (error) { console.error('[highlights] prefetch race_days', error); return; }
  (data || []).forEach(rd => { _highlightRaceDaysByIdCache[rd.id] = rd; });
}

function _onHighlightRaceSearch() {
  const q = document.getElementById('hl-race-search').value.trim().toLowerCase();
  const resultsDiv = document.getElementById('hl-race-results');
  clearTimeout(_hlRaceSearchDebounce);
  if (!q || q.length < 2) {
    resultsDiv.style.display = 'none';
    return;
  }
  _hlRaceSearchDebounce = setTimeout(() => {
    const matches = allRaces
      .filter(r => (r.name || '').toLowerCase().includes(q) || (r.nameEn || '').toLowerCase().includes(q))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
      .slice(0, 20);
    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div style="padding:0.5rem 0.7rem;color:var(--text-dim);font-size:0.82rem">Sin resultados</div>';
    } else {
      resultsDiv.innerHTML = matches.map(r => {
        const flag = r.hideFlag ? '' : countryFlag(r.countryCode);
        return `
          <div class="hl-race-option" data-race-id="${esc(r.id)}" style="padding:0.5rem 0.7rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid var(--border)">
            ${flag ? `<span>${flag}</span>` : ''}
            <span style="flex:1;font-size:0.85rem">${esc(r.name)}</span>
            <span class="u-fs-xs u-c-dim">${esc(r.startDate || '')} · ${esc(r.uciCategory || '')}</span>
          </div>`;
      }).join('');
      resultsDiv.querySelectorAll('.hl-race-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const id = opt.dataset.raceId;
          const race = allRaces.find(r => r.id === id);
          if (race) _selectHighlightRace(race);
        });
      });
    }
    resultsDiv.style.display = 'block';
  }, 150);
}

async function _selectHighlightRace(race) {
  _hlSelectedRace = race;
  document.getElementById('hl-race-search').style.display = 'none';
  document.getElementById('hl-race-results').style.display = 'none';
  const sel = document.getElementById('hl-race-selected');
  sel.style.display = 'flex';
  // countryFlag() devuelve HTML (<img>), por eso innerHTML — no textContent.
  document.getElementById('hl-race-selected-flag').innerHTML = race.hideFlag ? '' : countryFlag(race.countryCode);
  document.getElementById('hl-race-selected-name').textContent = race.name;

  // Cargar jornadas si la carrera es de varias etapas
  const rds = await _fetchRaceDaysForHighlight(race.id);
  const stageRow = document.getElementById('hl-stage-row');
  const stageSel = document.getElementById('hl-raceDayId');
  if (rds.length === 0) {
    stageRow.style.display = 'none';
    stageSel.innerHTML = '';
  } else if (rds.length === 1) {
    // Una sola jornada: la asignamos pero no mostramos selector
    stageRow.style.display = 'none';
    stageSel.innerHTML = `<option value="${esc(rds[0].id)}" selected>${_describeRaceDay(rds[0])}</option>`;
  } else {
    stageRow.style.display = '';
    stageSel.innerHTML = '<option value="">— Selecciona jornada —</option>' +
      rds.map(rd => `<option value="${esc(rd.id)}">${esc(_describeRaceDay(rd))}</option>`).join('');
  }
  _refreshHighlightTargetWarning();
}

function _describeRaceDay(rd) {
  const stage = rd.stageNumber === 0 ? 'Prólogo' : (rd.stageNumber != null ? `Etapa ${rd.stageNumber}` : '');
  const route = [rd.startLocation, rd.finishLocation].filter(Boolean).join(' › ');
  return [rd.date, stage, route].filter(Boolean).join(' · ');
}

function _clearHighlightRaceSelection() {
  _hlSelectedRace = null;
  document.getElementById('hl-race-search').value = '';
  document.getElementById('hl-race-search').style.display = '';
  document.getElementById('hl-race-selected').style.display = 'none';
  document.getElementById('hl-stage-row').style.display = 'none';
  document.getElementById('hl-raceDayId').innerHTML = '';
  _refreshHighlightTargetWarning();
}

function _refreshHighlightTargetWarning() {
  const warn = document.getElementById('hl-target-warning');
  warn.style.display = 'none';
  warn.textContent = '';

  const targetType = document.querySelector('input[name="hl-targetType"]:checked')?.value || 'raceDay';

  // Entrada custom: ocultar selección de carrera/jornada, mostrar campos custom.
  // Modo Campeonatos y Fichajes: tampoco usan carrera (destino fijo), sin campos custom de URL.
  const isCustom = targetType === 'custom';
  const isChampionships = targetType === 'championships';
  const isTransfers = targetType === 'transfers';
  const noRace = isCustom || isChampionships || isTransfers;
  document.getElementById('hl-race-row').style.display   = noRace ? 'none' : '';
  document.getElementById('hl-custom-row').style.display = isCustom ? 'flex' : 'none';
  if (noRace) {
    document.getElementById('hl-stage-row').style.display = 'none';
    return; // sin carrera → sin avisos de startlist/jornada
  }

  if (!_hlSelectedRace) return;

  if (targetType === 'race') {
    // Competición: vista general de la carrera. No exige startlist ni jornada.
    return;
  }
  if (targetType === 'startlist') {
    if (!_hlSelectedRace.startlistImportedAt) {
      warn.textContent = 'Esta carrera no tiene startlist importada — el enlace fallará. Importa la startlist o cambia el destino.';
      warn.style.display = 'block';
    }
    return;
  }
  if (targetType === 'startOrder') {
    const rdId = document.getElementById('hl-raceDayId').value;
    const rds = _highlightRaceDaysCache[_hlSelectedRace.id] || [];
    const rd = rds.find(r => r.id === rdId);
    if (!rd) {
      warn.textContent = 'Selecciona una jornada.';
      warn.style.display = 'block';
      return;
    }
    if (!rd.startOrderImportedAt) {
      warn.textContent = 'Esta jornada no tiene orden de salida importado — el enlace fallará. Importa el orden de salida o cambia el destino.';
      warn.style.display = 'block';
    }
  }
}

// Cuerpo del editor de cintillo dentro del drawer (mismos ids hl-*).
function highlightEditorBodyHtml() {
  return `
    <div>
      <label style="display:block;font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:0.4rem">Destino del cintillo</label>
      <div class="hl-target-options" style="display:flex;flex-direction:column;gap:0.5rem">
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="raceDay" checked><span>Jornada (detalle de la etapa)</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="race"><span>Competición (vista general de la carrera)</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="startlist"><span>Dorsales (startlist)</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="startOrder"><span>Orden de salida</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="championships"><span>Modo Campeonatos — web abre la página; apps, la pantalla nativa</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="transfers"><span>Mercado de Fichajes — web abre /fichajes/; apps, la pantalla nativa</span></label>
        <label class="hl-target-option"><input type="radio" name="hl-targetType" value="custom"><span>Personalizado (solo web) — URL, título y logo libres</span></label>
      </div>
      <div id="hl-target-warning" style="display:none;color:var(--red);font-size:0.78rem;margin-top:0.4rem"></div>
    </div>
    <div class="field" id="hl-race-row">
      <label>Carrera</label>
      <input type="text" id="hl-race-search" placeholder="Busca por nombre de carrera…" autocomplete="off">
      <div id="hl-race-results" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-top:0.25rem;background:var(--bg)"></div>
      <div id="hl-race-selected" style="display:none;padding:0.5rem 0.7rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-top:0.25rem;align-items:center;gap:0.6rem">
        <span id="hl-race-selected-flag" style="font-size:1.1rem;line-height:1"></span>
        <span id="hl-race-selected-name" style="flex:1;font-size:0.9rem;font-weight:600"></span>
        <button class="btn btn--ghost" id="hl-race-clear" style="padding:0.25rem 0.55rem;font-size:0.72rem">Cambiar</button>
      </div>
    </div>
    <div class="field" id="hl-stage-row" style="display:none">
      <label>Jornada</label>
      <select id="hl-raceDayId"></select>
    </div>
    <div id="hl-custom-row" style="display:none;flex-direction:column;gap:1rem">
      <div class="field-row field-row--2">
        <div class="field">
          <label>URL de destino (ES) <span style="color:var(--red)">*</span></label>
          <input type="text" id="hl-customUrl" placeholder="Ej.: /campeonatos-nacionales-2026/" class="u-w-full">
        </div>
        <div class="field">
          <label>URL de destino (EN) <span class="u-dim">— opcional</span></label>
          <input type="text" id="hl-customUrlEn" placeholder="Ej.: /en/2026-national-championships/" class="u-w-full">
        </div>
      </div>
      <div class="field" id="hl-customLogo-wrap">
        <label>Logo <span class="u-dim">— opcional (URL o subir)</span></label>
        <input type="text" id="hl-customLogo" placeholder="https://assets.calendariociclismo.app/…" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Título personalizado (ES) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customTitle" placeholder="Sobrescribe el nombre de la carrera" class="u-w-full">
      </div>
      <div class="field">
        <label>Título personalizado (EN) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customTitleEn" placeholder="Custom title in English" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Detalle (ES) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customDetail" placeholder="Ej.: Etapa reina · 4500m de desnivel" class="u-w-full">
      </div>
      <div class="field">
        <label>Detalle (EN) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customDetailEn" placeholder="Ej.: Queen stage · 4500m climbing" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Visible desde <span class="u-dim">— opcional, hora local</span></label>
        <input type="datetime-local" id="hl-visibleFrom">
      </div>
      <div class="field">
        <label>Visible hasta <span class="u-dim">— opcional, hora local</span></label>
        <input type="datetime-local" id="hl-visibleUntil">
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn--primary" id="saveHighlightBtn">Guardar</button>
      <button class="btn btn--ghost" id="deleteHighlightBtn" style="color:var(--red);display:none">Eliminar</button>
      <span class="u-fs-md u-c-dim" id="highlightSaveStatus"></span>
    </div>
  `;
}

// Listeners del editor de cintillo (por apertura del drawer).
function wireHighlightEditor() {
  document.getElementById('saveHighlightBtn').addEventListener('click', saveHighlight);
  document.getElementById('deleteHighlightBtn').addEventListener('click', deleteHighlight);
  document.getElementById('hl-race-search').addEventListener('input', _onHighlightRaceSearch);
  document.getElementById('hl-race-clear').addEventListener('click', _clearHighlightRaceSelection);
  document.querySelectorAll('input[name="hl-targetType"]').forEach(r =>
    r.addEventListener('change', _refreshHighlightTargetWarning)
  );
  document.getElementById('hl-raceDayId').addEventListener('change', _refreshHighlightTargetWarning);
}

async function openHighlightEditor(highlight) {
  // Reset
  _editingHighlightId = highlight?.id || null;

  // El editor vive en el drawer: se monta su cuerpo + listeners por apertura.
  openDrawer({
    title: highlight ? 'Editar destacado' : 'Nuevo destacado',
    level: 1,
    render: (body) => {
      body.innerHTML = highlightEditorBodyHtml();
      wireHighlightEditor();
    },
  });

  document.getElementById('highlightSaveStatus').textContent = '';
  document.getElementById('deleteHighlightBtn').style.display = highlight ? 'inline-block' : 'none';
  document.getElementById('hl-customTitle').value     = highlight?.customTitle     || '';
  document.getElementById('hl-customTitleEn').value   = highlight?.customTitleEn   || '';
  document.getElementById('hl-customDetail').value    = highlight?.customDetail    || '';
  document.getElementById('hl-customDetailEn').value  = highlight?.customDetailEn  || '';
  document.getElementById('hl-customUrl').value       = highlight?.customUrl       || '';
  document.getElementById('hl-customUrlEn').value     = highlight?.customUrlEn     || '';
  document.getElementById('hl-customLogo').value      = highlight?.customLogo      || '';
  document.getElementById('hl-visibleFrom').value     = _toDatetimeLocal(highlight?.visibleFrom);
  document.getElementById('hl-visibleUntil').value    = _toDatetimeLocal(highlight?.visibleUntil);
  const targetType = highlight?.targetType || 'raceDay';
  document.querySelector(`input[name="hl-targetType"][value="${targetType}"]`).checked = true;
  _clearHighlightRaceSelection();
  // Enganchar la subida R2 del logo custom (el DOM es nuevo en cada apertura).
  attachInlineUpload(document.getElementById('hl-customLogo'), 'logo');
  _refreshHighlightTargetWarning(); // ajustar visibilidad de secciones según el tipo

  if (highlight) {
    const raceId = highlight.raceId
      || (() => {
        const rd = allRaces.find(r => false); // placeholder
        return null;
      })();
    // Resolver raceId: si vino directo (startlist) usar; si vino raceDayId, traer race_days y de ahí raceId
    let resolvedRaceId = highlight.raceId;
    if (!resolvedRaceId && highlight.raceDayId) {
      const { data: rd } = await supabase.from('race_days').select('raceId').eq('id', highlight.raceDayId).single();
      resolvedRaceId = rd?.raceId;
    }
    const race = resolvedRaceId ? allRaces.find(r => r.id === resolvedRaceId) : null;
    if (race) {
      await _selectHighlightRace(race);
      if (highlight.raceDayId) {
        document.getElementById('hl-raceDayId').value = highlight.raceDayId;
      }
    }
    _refreshHighlightTargetWarning();
  }
}

function closeHighlightEditor() {
  _editingHighlightId = null;
  _hlSelectedRace = null;
  closeDrawer(1);
}

async function saveHighlight() {
  const status = document.getElementById('highlightSaveStatus');
  status.style.color = 'var(--text-dim)';
  status.textContent = 'Guardando…';

  const targetType = document.querySelector('input[name="hl-targetType"]:checked')?.value || 'raceDay';
  const isCustom = targetType === 'custom';
  const isChampionships = targetType === 'championships';
  const isTransfers = targetType === 'transfers';
  const noRace = isCustom || isChampionships || isTransfers;

  // Carrera obligatoria salvo para entradas custom, Campeonatos o Fichajes (sin carrera).
  if (!noRace && !_hlSelectedRace) {
    status.style.color = 'var(--red)';
    status.textContent = 'Selecciona una carrera.';
    return;
  }

  // Campos custom (solo web).
  const customUrl    = document.getElementById('hl-customUrl').value.trim()    || null;
  const customUrlEn  = document.getElementById('hl-customUrlEn').value.trim()  || null;
  const customLogo   = document.getElementById('hl-customLogo').value.trim()   || null;
  const customTitle  = document.getElementById('hl-customTitle').value.trim()  || null;

  if (isCustom) {
    if (!customUrl) {
      status.style.color = 'var(--red)';
      status.textContent = 'La URL de destino (ES) es obligatoria para una entrada personalizada.';
      return;
    }
    if (!customTitle) {
      status.style.color = 'var(--red)';
      status.textContent = 'El título (ES) es obligatorio para una entrada personalizada.';
      return;
    }
  }

  // Validar payload según targetType:
  //   - custom → customUrl (sin carrera)
  //   - startlist / race → solo `raceId`
  //   - raceDay / startOrder → `raceDayId` (con su `raceId` derivado a nivel DB)
  let raceId = null;
  let raceDayId = null;
  if (!noRace) {
    const raceDayIdSel = document.getElementById('hl-raceDayId').value || null;
    const rds = _highlightRaceDaysCache[_hlSelectedRace.id] || [];
    if (targetType === 'startlist' || targetType === 'race') {
      raceId = _hlSelectedRace.id;
    } else {
      raceDayId = raceDayIdSel || (rds.length === 1 ? rds[0].id : null);
      if (!raceDayId) {
        status.style.color = 'var(--red)';
        status.textContent = 'Selecciona una jornada.';
        return;
      }
    }
  }

  const payload = {
    targetType,
    raceId,
    raceDayId,
    customTitle,
    customTitleEn:   document.getElementById('hl-customTitleEn').value.trim()  || null,
    customDetail:    document.getElementById('hl-customDetail').value.trim()   || null,
    customDetailEn:  document.getElementById('hl-customDetailEn').value.trim() || null,
    customUrl:       isCustom ? customUrl   : null,
    customUrlEn:     isCustom ? customUrlEn : null,
    customLogo:      isCustom ? customLogo  : null,
    visibleFrom:     _fromDatetimeLocal(document.getElementById('hl-visibleFrom').value),
    visibleUntil:    _fromDatetimeLocal(document.getElementById('hl-visibleUntil').value),
  };

  try {
    if (_editingHighlightId) {
      const { error } = await supabase.from('today_highlights').update(payload).eq('id', _editingHighlightId);
      if (error) throw error;
    } else {
      const nextPos = (_highlightsCache || []).reduce((mx, h) => Math.max(mx, h.position || 0), -1) + 1;
      const { error } = await supabase.from('today_highlights').insert({ ...payload, position: nextPos });
      if (error) throw error;
    }
    showToast(_editingHighlightId ? 'Destacado actualizado' : 'Destacado creado', 'success', 2500);
    closeHighlightEditor();
    await fetchHighlights({ force: true });
    await _prefetchHighlightsRaceDays();
    renderHighlightsList();
  } catch (err) {
    status.style.color = 'var(--red)';
    status.textContent = 'Error: ' + err.message;
  }
}

async function deleteHighlight() {
  if (!_editingHighlightId) return;
  if (!await confirmDialog('¿Eliminar este destacado del cintillo?', { danger: true })) return;
  const { error } = await supabase.from('today_highlights').delete().eq('id', _editingHighlightId);
  if (error) { showToast('Error al eliminar: ' + error.message); return; }
  showToast('Destacado eliminado', 'success', 2500);
  closeHighlightEditor();
  await fetchHighlights({ force: true });
  renderHighlightsList();
}

function _resolveHighlightDisplay(h) {
  // Devuelve { race, raceDay } para una fila del listado de destacados.
  // Para entradas con `raceDayId`, usa el bulk cache `_highlightRaceDaysByIdCache`
  // (poblado por _prefetchHighlightsRaceDays al cargar el tab).
  const raceDay = h.raceDayId ? _highlightRaceDaysByIdCache[h.raceDayId] || null : null;
  let race = null;
  if (h.raceId) {
    race = allRaces.find(r => r.id === h.raceId) || null;
  } else if (raceDay?.raceId) {
    race = allRaces.find(r => r.id === raceDay.raceId) || null;
  }
  return { race, raceDay };
}

function _stageLabelShort(rd) {
  if (!rd) return '';
  if (rd.stageNumber === 0) return 'Prólogo';
  if (rd.stageNumber != null) return `Etapa ${rd.stageNumber}`;
  return '';
}

function renderHighlightsList() {
  const container = document.getElementById('highlightsList');
  const list = _highlightsCache || [];
  if (list.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:1rem;text-align:center">
      No hay destacados todavía. Pulsa <strong>+ Añadir destacado</strong> para empezar.
    </div>`;
    return;
  }

  const TARGET_LABELS = {
    raceDay:       'Jornada',
    race:          'Competición',
    startlist:     'Dorsales',
    startOrder:    'Orden de salida',
    custom:        'Personalizado',
    championships: 'Campeonatos',
    transfers:     'Fichajes',
  };

  container.innerHTML = list.map((h, idx) => {
    const { race, raceDay } = _resolveHighlightDisplay(h);
    let lhs;
    if (h.targetType === 'custom') {
      // Custom: identificar por su título (o la URL si no hay título).
      lhs = h.customTitle || h.customUrl || '(personalizado)';
    } else if (h.targetType === 'championships') {
      lhs = h.customTitle || 'Campeonatos Nacionales';
    } else if (h.targetType === 'transfers') {
      lhs = h.customTitle || 'Mercado de Fichajes';
    } else {
      // Fila identifica el destacado por la carrera real, no por el customTitle
      // (que es lo que se ve en el cintillo en sí, no en el panel).
      const raceName = race?.name || '(carrera desconocida)';
      const stageBit = raceDay ? _stageLabelShort(raceDay) : '';
      // Para destinos con jornada concreta (raceDay / startOrder), añadir "Etapa N"
      // al nombre de la carrera. Competición e Inscritos van solos.
      const showStage = stageBit && (h.targetType === 'raceDay' || h.targetType === 'startOrder');
      lhs = showStage ? `${raceName} · ${stageBit}` : raceName;
    }
    const targetLabel = TARGET_LABELS[h.targetType] || h.targetType;
    const dateRange = [h.visibleFrom, h.visibleUntil].map(_fmtVisibilityInstant).filter(Boolean).join(' → ');
    const detailBits = [];
    if (h.customDetail) detailBits.push(esc(h.customDetail));
    if (dateRange)      detailBits.push('Visible: ' + esc(dateRange));
    const subtitle = detailBits.join(' · ');
    return `
      <div class="hl-row" data-id="${esc(h.id)}" data-idx="${idx}" style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.7rem;background:var(--bg-card);border:1px solid var(--border);border-radius:8px">
        <span class="hl-handle" style="color:var(--text-dim);font-size:1.2rem;cursor:grab;touch-action:none;user-select:none;padding:0.35rem 0.2rem;margin:-0.35rem -0.1rem;line-height:1" title="Arrastrar para reordenar">⋮⋮</span>
        <div class="u-grow u-min0">
          <div style="font-size:0.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span style="font-weight:600">${esc(lhs)}</span>
            <span style="color:var(--text-dim);margin:0 0.3rem">→</span>
            <span style="font-weight:500">${esc(targetLabel)}</span>
          </div>
          ${subtitle ? `<div style="font-size:0.74rem;color:var(--text-dim);margin-top:0.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>` : ''}
        </div>
        <button class="btn btn--ghost hl-edit-btn" data-id="${esc(h.id)}" style="padding:0.25rem 0.55rem;font-size:0.72rem">Editar</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.hl-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const h = (_highlightsCache || []).find(x => x.id === btn.dataset.id);
      if (h) openHighlightEditor(h);
    });
  });

  // Reordenado por arrastre del tirador ⋮⋮ con Pointer Events (funciona con
  // ratón Y con el dedo en móvil; la HTML5 Drag&Drop API no dispara en táctil).
  _wireHighlightReorder(container);
}

// Arrastre para reordenar el cintillo, vía Pointer Events. El arrastre se
// inicia SOLO desde el tirador `.hl-handle` (con `touch-action:none`), de modo
// que el resto de la fila sigue permitiendo el scroll vertical de la lista con
// el dedo. Durante el arrastre se reordena el DOM en vivo según el punto medio
// de cada fila; al soltar se renumera y se persiste.
function _wireHighlightReorder(container) {
  let dragRow = null;
  let pointerId = null;

  const rowsExceptDragged = () =>
    [...container.querySelectorAll('.hl-row')].filter(r => r !== dragRow);

  const onMove = (e) => {
    if (!dragRow || e.pointerId !== pointerId) return;
    e.preventDefault();
    const y = e.clientY;
    // Primera fila (no la arrastrada) cuyo punto medio queda por debajo del
    // cursor → insertamos la arrastrada antes de ella; si ninguna, al final.
    let before = null;
    for (const r of rowsExceptDragged()) {
      const rect = r.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { before = r; break; }
    }
    if (before) {
      if (before.previousElementSibling !== dragRow) container.insertBefore(dragRow, before);
    } else if (container.lastElementChild !== dragRow) {
      container.appendChild(dragRow);
    }
  };

  const onUp = async (e) => {
    if (!dragRow || e.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    dragRow.style.opacity = '';
    dragRow.style.boxShadow = '';
    document.body.style.userSelect = '';
    dragRow = null;
    pointerId = null;

    // Nuevo orden según el DOM resultante.
    const orderedIds = [...container.querySelectorAll('.hl-row')].map(r => r.dataset.id);
    const byId = new Map((_highlightsCache || []).map(h => [h.id, h]));
    const items = orderedIds.map(id => byId.get(id)).filter(Boolean);
    const changed = items.some((it, i) => it.position !== i);
    items.forEach((it, i) => { it.position = i; });
    _highlightsCache = items;
    if (!changed) return;
    // Persistir y re-renderizar para refrescar índices/listeners.
    const updates = items.map(it => supabase.from('today_highlights').update({ position: it.position }).eq('id', it.id));
    await Promise.all(updates);
    renderHighlightsList();
    showToast('Orden actualizado', 'success', 1800);
  };

  container.querySelectorAll('.hl-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;  // solo botón principal
      const row = handle.closest('.hl-row');
      if (!row) return;
      e.preventDefault();
      dragRow = row;
      pointerId = e.pointerId;
      try { handle.setPointerCapture(pointerId); } catch (_) { /* noop */ }
      row.style.opacity = '0.6';
      row.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  });
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE VERSIONES (PRs mergeados desde GitHub)
// ═════════════════════════════════════════════════════════════════
