// Botón con menú de acciones (docs/plans/videos-5-2.md, fase 4): <button
// aria-haspopup="menu"> y lista role="menu" con el atributo popover (cierre al
// pulsar fuera y con Escape), colocada por script al abrir bajo el botón (o
// encima si no cabe), con flechas, Inicio y Fin entre opciones. El marcado no
// depende del dispositivo; bindMenuButtons() instala el comportamiento una vez
// por documento. El clic en el botón no llega a la tarjeta; el de una opción
// sí, para que la lista decida (modal de TV o pestaña nueva).

const escAttr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `id`: único en la página. `buttonClass` y `buttonHtml` (marcado ya escapado):
 * el aspecto del botón. `items`: [{ label, href, attrs, sameTab }], con `attrs`
 * como atributos ya escapados; sin `sameTab`, el enlace abre una pestaña nueva.
 */
export function menuButtonHtml({ id, label, buttonClass, buttonHtml, items }) {
  const options = items.map(item => `<a class="menu-popover__item" role="menuitem" tabindex="-1" href="${escAttr(item.href)}"${item.sameTab ? '' : ' target="_blank" rel="noopener"'}${item.attrs || ''}>${escAttr(item.label)}</a>`).join('');
  return `<span class="menu-button"><button type="button" class="${buttonClass}" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${escAttr(id)}" title="${escAttr(label)}" aria-label="${escAttr(label)}">${buttonHtml}</button>`
    + `<span class="menu-popover" id="${escAttr(id)}" role="menu" aria-label="${escAttr(label)}" popover>${options}</span></span>`;
}

const supportsPopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
let openMenu = null;

const buttonOf = menu => document.querySelector(`[data-menu-button][aria-controls="${CSS.escape(menu.id)}"]`);
const itemsOf = menu => [...menu.querySelectorAll('[role="menuitem"]')];

function place(button, menu) {
  const box = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const below = box.bottom + 4;
  const top = below + height > innerHeight - 8 && box.top - 4 - height >= 8 ? box.top - 4 - height : below;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(box.right - width, innerWidth - width - 8)))}px`;
}

function closed(menu, { restoreFocus = false } = {}) {
  const button = buttonOf(menu);
  button?.setAttribute('aria-expanded', 'false');
  if (openMenu === menu) openMenu = null;
  if (restoreFocus) button?.focus();
}

function hide(menu, options) {
  if (supportsPopover) {
    if (menu.matches(':popover-open')) menu.hidePopover();
  } else {
    menu.classList.remove('menu-popover--open');
  }
  closed(menu, options);
}

function show(button, menu, focusIndex = 0) {
  if (openMenu && openMenu !== menu) hide(openMenu);
  if (supportsPopover) menu.showPopover();
  else menu.classList.add('menu-popover--open');
  openMenu = menu;
  button.setAttribute('aria-expanded', 'true');
  place(button, menu);
  const items = itemsOf(menu);
  items.at(focusIndex)?.focus();
}

const bound = new WeakSet();

export function bindMenuButtons(root = document) {
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-menu-button]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const menu = document.getElementById(button.getAttribute('aria-controls'));
      if (!menu) return;
      if (openMenu === menu) hide(menu);
      else show(button, menu);
      return;
    }
    const item = event.target.closest?.('.menu-popover__item');
    if (item) hide(item.closest('.menu-popover'));
    else if (openMenu && !supportsPopover && !event.target.closest?.('.menu-popover')) hide(openMenu);
  }, true);
  root.addEventListener('keydown', event => {
    const button = event.target.closest?.('[data-menu-button]');
    if (button && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const menu = document.getElementById(button.getAttribute('aria-controls'));
      if (menu) show(button, menu, event.key === 'ArrowUp' ? -1 : 0);
      return;
    }
    const menu = event.target.closest?.('.menu-popover');
    if (!menu) return;
    const items = itemsOf(menu);
    const at = items.indexOf(event.target);
    const go = index => { event.preventDefault(); items.at(index % items.length)?.focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(-1);
    else if (event.key === 'Escape') { event.preventDefault(); hide(menu, { restoreFocus: true }); }
    else if (event.key === 'Tab') hide(menu, { restoreFocus: true });
  }, true);
  // Cierre por el navegador (pulsar fuera, Escape): el botón vuelve a cerrado.
  root.addEventListener('toggle', event => {
    if (event.target.classList?.contains('menu-popover') && event.newState === 'closed') {
      closed(event.target, { restoreFocus: event.target.contains(document.activeElement) });
    }
  }, true);
  // Al desplazar, el menú se separaría de su botón: se cierra.
  addEventListener('scroll', () => { if (openMenu) hide(openMenu); }, { passive: true, capture: true });
  addEventListener('resize', () => { if (openMenu) hide(openMenu); }, { passive: true });
}
