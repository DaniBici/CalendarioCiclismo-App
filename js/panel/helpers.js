// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Utilidades comunes: toast, formateo de fechas y slugs
// ─────────────────────────────────────────────────────────────────

import { UCI_ORDER } from '../shared.js';
import { panelState } from './state.js';

// ── Slug utils ────────────────────────────────────────────────────
export function toSlug(str) {
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
export function validateSlug(val) {
  if (!val) return null; // vacío = permitido (sin slug)
  if (!/^[a-z0-9-]+$/.test(val)) return 'Solo letras minúsculas, números y guiones.';
  if (val.startsWith('-') || val.endsWith('-')) return 'No puede empezar ni terminar con guión.';
  if (val.length > 80) return 'Máximo 80 caracteres.';
  return null;
}

// ── Estado global ─────────────────────────────────────────────────
// ── Toast ────────────────────────────────────────────────────────
export function showToast(msg, type = 'error', duration = 4000) {
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

export const loadedRaceYears    = new Set();
export const loadingRaceYears   = new Map();

export function setRaceDaySaveInFlight(inFlight) {
  panelState._raceDaySaveInFlight = inFlight;
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

export function formatDateTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
  });
}

// Convierte "HH:MM" + dateKey a ISO string UTC
export function toTimestamp(dateKey, timeStr) {
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

export function uciRankSimple(cat) { return UCI_ORDER[cat] ?? 99; }

// ── Utilidad: formatear timestamp a HH:MM ────────────────────────
export function formatTimeHHMM(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}
