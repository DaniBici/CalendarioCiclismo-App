// ─────────────────────────────────────────────────────────────────
//  RIDER TOOLTIP — motivo de abandono
//  Tooltip reutilizable para filas de corredor que estén FUERA DE
//  CARRERA en listas con resultados in-house. Muestra únicamente el
//  motivo del abandono ("ABN · etapa 2"), leído de data-rider-dnf.
//  Usado por /inscritos/ y /resultados/. Un único nodo reutilizable,
//  posicionado dentro del viewport. En táctil el tap abre/cierra.
//
//  (Las fichas públicas de corredor/equipo se retiraron: este tooltip
//  ya NO muestra bandera, edad, equipo ni enlaces.)
// ─────────────────────────────────────────────────────────────────

import { esc } from './shared.js';
import { t, getLang } from './i18n.js';
import { irmLabel } from './uci-irm.js';

let _riderTip = null;
let _riderTipAnchor = null;
let _hideTimer = null;
const _isCoarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(hover: none), (pointer: coarse)').matches;

function _ensureRiderTip() {
  if (_riderTip) return _riderTip;
  const el = document.createElement('div');
  el.className = 'rider-tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);
  _riderTip = el;
  // El tooltip es zona segura para el hover: entrar cancela el cierre diferido,
  // salir lo reprograma. Se cablea una sola vez (el nodo se reutiliza).
  el.addEventListener('mouseenter', () => { if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; } });
  el.addEventListener('mouseleave', _scheduleHideRiderTip);
  return el;
}

// Línea "fuera de carrera": "ABN · etapa 2" (solo listas con resultados
// in-house). data-rider-dnf = "irm|stageNumber" (stageNumber vacío en one-day
// → solo el motivo; stageNumber 0 → "· prólogo").
function _buildDnfLineHtml(row) {
  const dnf = row.dataset.riderDnf || '';
  if (!dnf) return '';
  const [irm, snRaw] = dnf.split('|');
  const label = irmLabel(irm, getLang()) || esc(irm);
  const sn = snRaw !== undefined && snRaw !== '' ? snRaw : null;
  const dnfText = sn != null
    ? (Number(sn) === 0
        ? t('startlist.dnfReasonPrologue', { label })
        : t('startlist.dnfReasonStage', { label, n: sn }))
    : t('startlist.dnfReason', { label });
  return `<div class="rider-tip__dnf">${esc(dnfText)}</div>`;
}

function _positionRiderTip(row) {
  const tip = _riderTip;
  if (!tip) return;
  tip.hidden = false;
  // Medir tras render para conocer el tamaño real.
  const r = row.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const margin = 8;
  // Por defecto encima de la fila; si no cabe arriba, debajo.
  let top = r.top - th - margin;
  let placement = 'top';
  if (top < margin) { top = r.bottom + margin; placement = 'bottom'; }
  // Alinear el borde izquierdo con la fila, recortado al viewport.
  let left = r.left;
  const maxLeft = window.innerWidth - tw - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;
  tip.style.top = `${Math.round(top + window.scrollY)}px`;
  tip.style.left = `${Math.round(left + window.scrollX)}px`;
  tip.dataset.placement = placement;
}

function _showRiderTip(row) {
  // Solo se muestra para corredores fuera de carrera (data-rider-dnf); el resto
  // ya no tiene tooltip (las fichas se retiraron).
  if (!row || !row.dataset.riderDnf) return;
  const html = _buildDnfLineHtml(row);
  if (!html) return;
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  const tip = _ensureRiderTip();
  tip.innerHTML = html;
  _riderTipAnchor = row;
  tip.classList.add('rider-tip--visible');
  _positionRiderTip(row);
}

function _hideRiderTip() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  if (!_riderTip) return;
  _riderTip.classList.remove('rider-tip--visible');
  _riderTip.hidden = true;
  _riderTipAnchor = null;
}

// Cierre diferido: da un margen para que el ratón cruce el hueco fila↔tooltip
// y entre en el tooltip (donde se cancela).
function _scheduleHideRiderTip() {
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => { _hideTimer = null; _hideRiderTip(); }, 220);
}

// `rowSelector` permite reutilizar el tooltip en tablas con otra estructura
// (p. ej. /resultados/, donde las filas son <tr> y NO pueden llevar la clase
// .startlist-rider porque su CSS flex rompería el layout de columnas). Por
// defecto, las filas `.startlist-rider` de /inscritos/.
export function setupRiderTooltips(content, rowSelector = '.startlist-rider') {
  if (!content) return;
  const coarse = _isCoarsePointer();

  if (!coarse) {
    // Desktop: hover. Delegación sobre el contenedor.
    content.addEventListener('mouseover', (e) => {
      const row = e.target.closest(rowSelector);
      if (!row || !content.contains(row)) return;
      if (row === _riderTipAnchor) { if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; } return; }
      _showRiderTip(row);
    });
    content.addEventListener('mouseout', (e) => {
      const row = e.target.closest(rowSelector);
      if (!row) return;
      // Si el ratón va al propio tooltip o sigue dentro de la fila, no cerrar.
      const to = e.relatedTarget;
      if (to && _riderTip && _riderTip.contains(to)) return;
      if (to && row.contains(to)) return;
      _scheduleHideRiderTip();
    });
    _ensureRiderTip();
  } else {
    // Táctil: tap abre/cierra.
    content.addEventListener('click', (e) => {
      const row = e.target.closest(rowSelector);
      if (!row || !content.contains(row)) return;
      if (e.target.closest('a')) return;
      if (row === _riderTipAnchor) { _hideRiderTip(); return; }
      _showRiderTip(row);
    });
    // Tap fuera del tooltip y de la fila activa → cerrar.
    document.addEventListener('click', (e) => {
      if (!_riderTipAnchor) return;
      if (_riderTip && _riderTip.contains(e.target)) return;
      if (_riderTipAnchor.contains(e.target)) return;
      _hideRiderTip();
    });
  }

  // Cerrar en scroll/resize (la posición dejaría de ser válida).
  const reposition = () => { if (_riderTipAnchor) _hideRiderTip(); };
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') _hideRiderTip(); });
}
