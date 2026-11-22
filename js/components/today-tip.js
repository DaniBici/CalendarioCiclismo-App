// Burbujas de Hoy de carretera y de la agenda de Ciclocross, como en las apps
// (TodayTips.swift y TodayTips.kt): primero «Filtros» y, con «Siguiente», la de
// «Ordenar», que se cierra con «Entendido». Aparecen la primera vez que se ve
// Hoy de carretera y la primera vez que se ve Hoy de Ciclocross, después de
// resolver el aviso de cookies. Cerrar la primera con Escape o pulsando fuera
// también da paso a la segunda. Últimos resultados tiene la suya, de «Filtros», la
// primera vez que se abre (scheduleResultsTip).
import { t } from '../i18n.js';

const SEEN_KEY = discipline => `cc_today_tip_${discipline}`;

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(anchor, { title, text, action }, onClose) {
  const tip = document.createElement('div');
  tip.className = 'today-tip';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-labelledby', 'todayTipTitle');
  tip.innerHTML = `<p class="today-tip__title" id="todayTipTitle">${esc(title)}</p>`
    + `<p class="today-tip__text">${esc(text)}</p>`
    + `<div class="today-tip__actions"><button type="button" class="today-tip__btn">${esc(action)}</button></div>`;
  document.body.append(tip);

  const place = () => {
    const box = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const left = Math.max(16, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 16));
    tip.style.top = `${Math.round(box.bottom + 10)}px`;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.setProperty('--tip-arrow-x', `${Math.round(box.left + box.width / 2 - left)}px`);
  };
  place();
  requestAnimationFrame(() => tip.classList.add('today-tip--visible'));

  const close = () => {
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutside, true);
    tip.remove();
    onClose();
  };
  const onKey = event => { if (event.key === 'Escape') close(); };
  const onOutside = event => { if (!tip.contains(event.target)) close(); };
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside, true);
  tip.querySelector('.today-tip__btn').addEventListener('click', close);
  tip.querySelector('.today-tip__btn').focus({ preventScroll: true });
}

function showSequence(filtersBtn, sortBtn, discipline) {
  const seen = () => { try { localStorage.setItem(SEEN_KEY(discipline), '1'); } catch { /* Sin almacenamiento: no vuelven en esta visita. */ } };
  const sortTip = () => {
    if (!sortBtn?.isConnected || !sortBtn.offsetParent) { seen(); return; }
    show(sortBtn, { title: t('filter.tipSortTitle'), text: t('filter.tipSort'), action: t('filter.tipDone') }, seen);
  };
  show(filtersBtn, {
    title: t('filter.tipTitle'),
    text: t(discipline === 'cx' ? 'filter.tipCx' : 'filter.tipRoad'),
    action: t('filter.tipNext'),
  }, () => setTimeout(sortTip, 250));
}

/**
 * Programa las burbujas sobre «Filtros» (`filtersBtn`) y «Ordenar» (`sortBtn`)
 * de `discipline` ('road' o 'cx') si aún no se han visto, cuando se haya
 * respondido al aviso de cookies.
 */
export function scheduleTodayTips(filtersBtn, sortBtn, discipline) {
  if (!filtersBtn || read(SEEN_KEY(discipline))) return;
  const start = () => setTimeout(() => {
    if (filtersBtn.isConnected && filtersBtn.offsetParent) showSequence(filtersBtn, sortBtn, discipline);
  }, 800);
  if (window.ccConsent?.get?.()) start();
  else addEventListener('cc-consent', start, { once: true });
}

/**
 * Burbuja de «Filtros» en Últimos resultados (`filtersBtn`): los filtros de Hoy y
 * Calendario también valen aquí. Una sola vez, la primera vez que se abre la
 * pantalla, cuando se haya respondido al aviso de cookies.
 */
export function scheduleResultsTip(filtersBtn) {
  const key = 'cc_results_tip';
  if (!filtersBtn || read(key)) return;
  const start = () => setTimeout(() => {
    if (!filtersBtn.isConnected || !filtersBtn.offsetParent) return;
    show(filtersBtn, { title: t('filter.tipTitle'), text: t('filter.tipResults'), action: t('filter.tipDone') }, () => {
      try { localStorage.setItem(key, '1'); } catch { /* Sin almacenamiento: no vuelve en esta visita. */ }
    });
  }, 800);
  if (window.ccConsent?.get?.()) start();
  else addEventListener('cc-consent', start, { once: true });
}
