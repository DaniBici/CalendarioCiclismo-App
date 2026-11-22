// «Ordenar» de Hoy y de la agenda de Ciclocross, como en las apps: botón con
// las flechas (Lucide arrow-up-down) y el orden activo («Cat. UCI», «Hora
// TV», «Hora de meta»), con el aspecto de «Filtros» (`.agenda-filter-btn`), y
// menú (js/components/menu-button.js) con las tres opciones; la elegida lleva
// la marca. Elegir cierra el menú y el orden se recuerda. Espejo de `TodaySortLabel` (iOS) y
// `SortMenu` (Android).
import { t } from '../i18n.js';

const SORT_MODES = ['category', 'tvtime', 'finishtime'];

// El orden elegido se recuerda por disciplina; con el de categoría (el
// predeterminado) no hay clave.
export const ROAD_SORT_KEY = 'cc_road_sort';
export const CX_SORT_KEY = 'cc_cx_sort';

export function loadSort(storageKey) {
  try {
    const value = localStorage.getItem(storageKey);
    return SORT_MODES.includes(value) ? value : 'category';
  } catch { return 'category'; }
}

export function saveSort(storageKey, mode) {
  try {
    if (mode === 'category') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, mode);
  } catch { /* Sin almacenamiento, el orden dura lo que la página. */ }
}

const svgIcon = (paths, size = 16, stroke = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const SORT_ICON = svgIcon('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>');
const CHECK_ICON = svgIcon('<path d="M20 6 9 17l-5-5"/>', 16, 2.4);
const CHEVRON_ICON = svgIcon('<path d="m6 9 6 6 6-6"/>', 14);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const buttonInner = current => `${SORT_ICON}<span>${esc(t(`sort.${current}`))}</span>${CHEVRON_ICON}`;
const buttonLabel = current => `${t('sort.label')}: ${t(`sort.${current}`)}`;

function itemsHtml(current) {
  return SORT_MODES.map(mode => `<button type="button" class="menu-popover__item filter-menu__option" role="menuitemradio" tabindex="-1" aria-checked="${mode === current}" data-sort="${mode}"><span class="filter-menu__check">${mode === current ? CHECK_ICON : ''}</span>${esc(t(`sort.${mode}`))}</button>`).join('');
}

/** Botón y menú; `idPrefix` da los ids `…Btn` y `…Menu`. */
export function sortMenuHtml(idPrefix, current = 'category') {
  return `<div class="menu-button filter-menu-wrap"><button type="button" class="filter-menu-btn agenda-filter-btn" id="${idPrefix}Btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${idPrefix}Menu" aria-label="${esc(buttonLabel(current))}">${buttonInner(current)}</button>`
    + `<div class="menu-popover filter-menu" id="${idPrefix}Menu" role="menu" aria-label="${esc(t('sort.label'))}" popover>${itemsHtml(current)}</div></div>`;
}

/** Comportamiento sobre `root` (delegado): `onChange(mode)` al elegir otro orden. */
export function bindSortMenu(root, { idPrefix, getCurrent, onChange }) {
  const render = () => {
    const current = getCurrent();
    const button = document.getElementById(`${idPrefix}Btn`);
    if (button) {
      button.innerHTML = buttonInner(current);
      button.setAttribute('aria-label', buttonLabel(current));
    }
    const menu = document.getElementById(`${idPrefix}Menu`);
    if (menu) menu.innerHTML = itemsHtml(current);
  };
  root.addEventListener('click', event => {
    const option = event.target.closest?.(`#${idPrefix}Menu [data-sort]`);
    if (!option) return;
    const mode = option.dataset.sort;
    if (!SORT_MODES.includes(mode) || mode === getCurrent()) return;
    onChange(mode);
    render();
  });
  return { render };
}
