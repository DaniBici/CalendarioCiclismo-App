// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Editor de jornada: GPX, mapa de ruta y puertos
// ─────────────────────────────────────────────────────────────────

import { supabase } from '../shared.js';
import { detectClimb, computeClimbStats } from '../stage/climb-detection.js';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';

// ── GPX — parseo en browser y calculo de perfil de elevacion ─────
const _GPX_THRESHOLD_M  = 3;
const _GPX_TARGET_MIN   = 250;
const _GPX_TARGET_MAX   = 350;

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

export async function _gpxHandleUpload(file, rdId, statusEl, summaryEl, btnEl, onSaved = null) {
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
    if (panelState._editorCache?.rdId === rdId) panelState._editorCache.rd = { ...panelState._editorCache.rd, elevationProfile: profile };
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
export async function _mapHandleUpload(file, rdId, statusEl, summaryEl, btnEl) {
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
    if (panelState._editorCache?.rdId === rdId) panelState._editorCache.rd = { ...panelState._editorCache.rd, routeGpxUrl: publicUrl };
    summaryEl.textContent = 'Mapa activo · GPX en Storage';
    summaryEl.style.display = '';
    btnEl.textContent = 'Reemplazar GPX del mapa';
    statusEl.textContent = '';
    showToast('Mapa del recorrido activado', 'success', 3000);
    // Mostrar los botones "Quitar mapa" / "Ver mapa" si no estaban.
    if (!document.getElementById('ed-map-del')) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn--ghost u-fs-080 u-c-red'; delBtn.id = 'ed-map-del';
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

export function _wireMapDelete(delBtn, rdId, summaryEl, btnEl) {
  delBtn.addEventListener('click', async () => {
    if (!await confirmDialog('¿Quitar el mapa interactivo de esta jornada? (el GPX seguirá en Storage; solo se desvincula)', { danger: true })) return;
    const { error } = await supabase.from('race_days').update({ routeGpxUrl: null }).eq('id', rdId);
    if (error) { showToast('Error al quitar: ' + error.message); return; }
    if (panelState._editorCache?.rdId === rdId) panelState._editorCache.rd = { ...panelState._editorCache.rd, routeGpxUrl: null };
    summaryEl.style.display = 'none';
    summaryEl.textContent = '';
    btnEl.textContent = 'Subir GPX del mapa';
    delBtn.nextElementSibling?.remove(); // el enlace "Ver mapa ↗"
    delBtn.remove();
    showToast('Mapa del recorrido quitado', 'success', 3000);
  });
}

export function _refreshSummitStats(row) {
  const stats = row?.querySelector('.ann-stats');
  if (!stats) return;
  const pts = panelState._editorCache?.rd?.elevationProfile?.points;
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

export function _autoDetectSummitClimb(row, silent = false) {
  const pts = panelState._editorCache?.rd?.elevationProfile?.points;
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

export function _interpolateElevation(km, pts) {
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
