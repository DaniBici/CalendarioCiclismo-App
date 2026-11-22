// Filtros de opciones marcables por grupos, los de Fichajes, Hoy, Mes,
// Temporada y la agenda de Ciclocross: botón «Filtros» con menú desplegable
// (js/components/menu-button.js) y «Limpiar filtros» al final; marcar no cierra
// el menú. Con algún filtro, el botón queda activo.
//
// Cada grupo lista sus opciones ({ value, label() }). El estado es un objeto
// grupo → Set de valores marcados; empiezan todos marcados. Dentro de un grupo
// es OR y entre grupos AND; un grupo con todas sus opciones marcadas no filtra,
// de modo que un valor desconocido (null) solo se oculta si el grupo filtra. Un
// grupo nunca queda vacío: sin ninguna opción equivaldría a «todo oculto», así
// que desmarcar la última vuelve a marcar el grupo entero.
//
// La selección se recuerda en localStorage con una clave por página o
// disciplina: lista de valores por grupo. Un valor que ya no exista se descarta.

const svgIcon = (paths, size = 16, stroke = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const FILTER_ICON = svgIcon('<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>');   // Lucide list-filter
const CHECK_ICON = svgIcon('<path d="M20 6 9 17l-5-5"/>', 16, 2.4);
const CHEVRON_ICON = svgIcon('<path d="m6 9 6 6 6-6"/>', 14);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Estado inicial: todas las opciones marcadas. */
export const newFilters = groups => Object.fromEntries(
  groups.map(g => [g.key, new Set(g.options.map(o => o.value))]));

const groupActive = (g, filters) => g.options.some(o => !filters[g.key]?.has(o.value));

/** Algún grupo con alguna opción desmarcada. */
export const filtersActive = (groups, filters) => groups.some(g => groupActive(g, filters));

/** Pasa el filtro: cada grupo que filtra exige que alguno de los valores del
 *  elemento (`valuesOf(key)` → valor, lista de valores o null) esté marcado. */
export function matchesFilters(groups, filters, valuesOf) {
  if (!filters) return true;
  return groups.every(g => {
    if (!groupActive(g, filters)) return true;
    const value = valuesOf(g.key);
    if (value == null) return false;
    return (Array.isArray(value) ? value : [value]).some(v => filters[g.key].has(v));
  });
}

/** Marca o desmarca una opción (`rawValue` llega del atributo data-value).
 *  Devuelve false si la opción no existe. */
export function toggleFilter(groups, filters, groupKey, rawValue) {
  const g = groups.find(x => x.key === groupKey);
  const option = g?.options.find(o => String(o.value) === rawValue);
  if (!option) return false;
  const active = filters[groupKey];
  if (active.has(option.value)) active.delete(option.value); else active.add(option.value);
  if (active.size === 0) g.options.forEach(o => active.add(o.value));
  return true;
}

/** Selección guardada o, sin ella, la que devuelva `fallback()` (p. ej. la
 *  conversión de un filtro antiguo) o todo marcado. */
export function loadFilters(storageKey, groups, fallback = null) {
  const filters = newFilters(groups);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { saved = null; }
  if (!saved || typeof saved !== 'object') saved = fallback?.() || null;
  if (!saved) return filters;
  for (const g of groups) {
    const values = Array.isArray(saved[g.key]) ? g.options.map(o => o.value).filter(v => saved[g.key].includes(v)) : [];
    if (values.length) filters[g.key] = new Set(values);
  }
  return filters;
}

/** Guarda la selección; con todo marcado se borra la clave. */
export function saveFilters(storageKey, groups, filters) {
  try {
    if (!filtersActive(groups, filters)) { localStorage.removeItem(storageKey); return; }
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(
      groups.map(g => [g.key, g.options.map(o => o.value).filter(v => filters[g.key].has(v))]))));
  } catch { /* Sin almacenamiento, la selección dura lo que la página. */ }
}

/** Opciones del menú: se repintan con js/dom-patch.js y conservan el nodo y el
 *  foco del teclado. Un grupo con `label` lleva rótulo; sin él, un filete lo
 *  separa del anterior. Ids derivados de `idPrefix`: rótulos (`-<grupo>`),
 *  menú (`Menu`), botón (`Btn`) y «Limpiar filtros» (`Clear`). */
export function filterMenuItemsHtml(groups, filters, { idPrefix, clearLabel }) {
  return groups.map((g, i) => {
    const labelId = `${idPrefix}-${g.key}`;
    const head = g.label ? `<div class="filter-menu__label" id="${labelId}">${esc(g.label())}</div>` : '';
    const cls = `filter-menu__group${!g.label && i > 0 ? ' filter-menu__group--sep' : ''}`;
    const labelled = g.label ? ` aria-labelledby="${labelId}"` : '';
    return `<div class="${cls}" role="group"${labelled}>${head}${g.options.map(o => {
      const on = filters[g.key].has(o.value);
      return `<button type="button" class="menu-popover__item filter-menu__option" role="menuitemcheckbox" tabindex="-1" aria-checked="${on}" data-group="${g.key}" data-value="${esc(o.value)}"><span class="filter-menu__check">${on ? CHECK_ICON : ''}</span>${esc(o.label())}</button>`;
    }).join('')}</div>`;
  }).join('')
    + `<button type="button" class="menu-popover__item filter-menu__clear" role="menuitem" tabindex="-1" id="${idPrefix}Clear"${filtersActive(groups, filters) ? '' : ' disabled'}>${esc(clearLabel)}</button>`;
}

/** Botón «Filtros» y su menú. `buttonClass`: aspecto del botón en cada página;
 *  `activeClass`, la clase que se añade con algún filtro. */
export function filterMenuHtml(groups, filters, { idPrefix, label, clearLabel, wrapClass = '', buttonClass, activeClass }) {
  const active = filtersActive(groups, filters);
  return `<div class="menu-button filter-menu-wrap${wrapClass ? ` ${wrapClass}` : ''}"><button type="button" class="filter-menu-btn ${buttonClass}${active ? ` ${activeClass}` : ''}" id="${idPrefix}Btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${idPrefix}Menu">${FILTER_ICON}<span>${esc(label)}</span>${CHEVRON_ICON}</button>`
    + `<div class="menu-popover filter-menu" id="${idPrefix}Menu" role="menu" aria-label="${esc(label)}" popover>${filterMenuItemsHtml(groups, filters, { idPrefix, clearLabel })}</div></div>`;
}

/**
 * Comportamiento del menú sobre `root` (delegado, una vez): marcar, limpiar,
 * guardar y repintar opciones y botón. `onChange()` se llama tras cada cambio.
 * `patch(el, html)`: repintado que conserva nodos (js/dom-patch.js).
 */
export function bindFilterMenu(root, { groups, getFilters, setFilters, idPrefix, clearLabel, activeClass, storageKey, patch, onChange }) {
  const render = () => {
    const filters = getFilters();
    const menu = document.getElementById(`${idPrefix}Menu`);
    if (menu) patch(menu, filterMenuItemsHtml(groups, filters, { idPrefix, clearLabel }));
    document.getElementById(`${idPrefix}Btn`)?.classList.toggle(activeClass, filtersActive(groups, filters));
  };
  const changed = () => {
    if (storageKey) saveFilters(storageKey, groups, getFilters());
    render();
    onChange();
  };
  root.addEventListener('click', event => {
    const menu = event.target.closest?.(`#${idPrefix}Menu`);
    if (!menu) return;
    const option = event.target.closest('[data-group]');
    if (option) {
      if (toggleFilter(groups, getFilters(), option.dataset.group, option.dataset.value)) changed();
      return;
    }
    if (event.target.closest(`#${idPrefix}Clear`)) {
      setFilters(newFilters(groups));
      changed();
    }
  });
  return { render };
}
