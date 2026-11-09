// Aviso de las filas sin enlace ([data-ph-tooltip]): al pasar el ratón en escritorio y
// al tocar en móvil. Sin dependencias.
import { COMPACT_VIEWPORT_QUERY } from './viewport-query.js';

const esc = texto => String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _phTooltipWired = false; // guard: en /calendario/ pueden inicializar las dos subvistas

export function initPhTooltip({ skipMobileMes = false } = {}) {
  if (_phTooltipWired) return;
  _phTooltipWired = true;
  const isMobile = () => window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;

  // Desktop: tooltip al hover
  document.addEventListener('mouseover', e => {
    if (isMobile()) return;
    const el = e.target.closest('[data-ph-tooltip]');
    let tip = document.getElementById('ph-tooltip');
    if (el) {
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'ph-tooltip';
        document.body.appendChild(tip);
      }
      tip.textContent = el.dataset.phTooltip;
      tip.style.display = 'block';
    } else if (tip) {
      tip.style.display = 'none';
    }
  });
  document.addEventListener('mousemove', e => {
    if (isMobile()) return;
    if (!e.target.closest('[data-ph-tooltip]')) return;
    const tip = document.getElementById('ph-tooltip');
    if (tip) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top  = (e.clientY + 14) + 'px';
    }
  });

  // Móvil: modal centrado al pulsar
  document.addEventListener('click', e => {
    if (!isMobile()) return;
    const banner = document.getElementById('ph-banner');
    if (e.target.closest('#ph-banner button')) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (banner && e.target === banner) {
      banner.style.display = 'none';
      return;
    }
    const el = e.target.closest('[data-ph-tooltip]');
    if (el && el.classList.contains('tcat-btn')) return;
    if (!el) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (skipMobileMes && (el.closest('.month-grid') || el.closest('.temporada-filters'))) return;
    // Los enlaces y botones de la tarjeta (TV, inscritos…) conservan su acción.
    const control = e.target.closest('a, button');
    if (control && control !== el && el.contains(control)) return;
    if (el.tagName !== 'A') e.preventDefault();
    openPhBanner(el);
  });

  // El tooltip solo existía para el ratón: con teclado no había forma de
  // leerlo (WCAG 1.4.13). Con el foco se muestra anclado al elemento, y
  // Escape lo cierra sin mover el foco.
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-ph-tooltip]');
    const tip = document.getElementById('ph-tooltip');
    if (!el) { if (tip) tip.style.display = 'none'; return; }
    if (isMobile()) return;
    _showPhTooltipFor(el);
  });
  document.addEventListener('focusout', () => {
    const tip = document.getElementById('ph-tooltip');
    if (tip) tip.style.display = 'none';
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tip = document.getElementById('ph-tooltip');
    if (tip && tip.style.display === 'block') tip.style.display = 'none';
  });

  // Los filtros existen ya al cargar; el resto se cablea al repintar.
  wirePhDescriptions();
}

export function openPhBanner(el) {
  const msg     = el.dataset.phMsg || el.dataset.phTooltip || '';
  // flagHtml: HTML del <img> de countryFlag() — se inyecta sin escaping
  const flagHtml = el.dataset.phFlag
    || el.querySelector('.t-race__flag')?.innerHTML?.trim()
    || '';
  const name = el.dataset.phName
    || el.querySelector('.t-race__name')?.textContent?.trim()
    || '';
  const sub  = el.dataset.phSub || [
    el.querySelector('.t-race__dates')?.textContent?.trim(),
    el.querySelector('.t-race__cat')?.textContent?.trim(),
  ].filter(Boolean).join(' · ');

  const barContent = name
    ? `<div class="ph-banner__header-text"><span class="ph-banner__name">${flagHtml ? flagHtml + '\u00a0' : ''}${esc(name)}</span>${sub ? `<div class="ph-banner__sub">${esc(sub)}</div>` : ''}</div>`
    : `<span class="ph-banner__name">${esc(msg)}</span>`;
  const bodyHTML = name ? `<div class="ph-banner__body"><p>${esc(msg)}</p></div>` : '';

  let b = document.getElementById('ph-banner');
  if (!b) { b = document.createElement('div'); b.id = 'ph-banner'; document.body.appendChild(b); }
  b.innerHTML = `<div id="ph-banner-box"><div class="ph-banner__bar">${barContent}<button aria-label="Cerrar">&#215;</button></div>${bodyHTML}</div>`;
  b.style.display = 'flex';
  // Close: botón × o click en el overlay (funciona aunque initPhTooltip no esté activo)
  b.onclick = e => { if (e.target === b || e.target.closest('#ph-banner button')) b.style.display = 'none'; };
}

// ── Tooltip (desktop) / Modal (móvil) para data-ph-tooltip ──────

// El tooltip visual no lo ve un lector de pantalla. Se copia el texto a un
// nodo oculto enlazado con aria-describedby, que sí se anuncia al enfocar.
export function wirePhDescriptions(root = document) {
  let n = 0;
  root.querySelectorAll('[data-ph-tooltip]').forEach(el => {
    if (el.getAttribute('aria-describedby')) return;
    const txt = el.dataset.phTooltip;
    if (!txt) return;
    const id = 'phd-' + (++_phDescSeq);
    const desc = document.createElement('span');
    desc.id = id;
    desc.className = 'sr-only';
    desc.textContent = txt;
    el.appendChild(desc);
    el.setAttribute('aria-describedby', id);
    n++;
  });
  return n;
}
let _phDescSeq = 0;

// Muestra el tooltip anclado bajo el elemento (no bajo el puntero).
function _showPhTooltipFor(el) {
  let tip = document.getElementById('ph-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ph-tooltip';
    document.body.appendChild(tip);
  }
  tip.textContent = el.dataset.phTooltip || '';
  tip.style.display = 'block';
  const r = el.getBoundingClientRect();
  tip.style.left = r.left + 'px';
  tip.style.top  = (r.bottom + 8) + 'px';
}

