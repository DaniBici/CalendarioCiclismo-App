// Botón ← de la cabecera para las páginas que cambian de vista sin recargar: la
// cabecera se construye una vez y esta es la vía para un "volver" dinámico.
// Vive en su posición (a la izquierda del logo) y su hueco está siempre reservado
// (BACK_PLACEHOLDER): aparecer o irse no mueve la cabecera. Usos:
//   headerBack({ href })    → enlace (recarga/navega). P. ej. resultados → feed.
//   headerBack({ onClick }) → botón que ejecuta JS sin navegar (vuelve a una
//                             vista interna, como la ficha de equipo de Fichajes).
//   headerBack(null)        → oculta el botón.
import { STRINGS, BACK_ICON, BACK_PLACEHOLDER } from './header-html.js';

export function headerBack(cfg, fallbackLang = 'es') {
  const header = document.getElementById('siteHeader');
  const inner = header && header.querySelector('.site-header__inner');
  if (!inner) return;
  const lang = header.dataset.lang || fallbackLang;
  const s = STRINGS[lang] || STRINGS.es;
  const existing = inner.querySelector('#backBtn');
  if (existing) existing.remove();
  if (!cfg) { inner.insertAdjacentHTML('afterbegin', BACK_PLACEHOLDER); return; }
  const label = cfg.label || s.backLabel;
  let node;
  if (cfg.onClick) {
    node = document.createElement('button');
    node.type = 'button';
    node.addEventListener('click', cfg.onClick);
  } else {
    node = document.createElement('a');
    node.href = cfg.href || s.home;
  }
  node.className = 'back-btn';
  node.id = 'backBtn';
  node.setAttribute('aria-label', label);
  node.innerHTML = BACK_ICON;
  inner.insertBefore(node, inner.firstChild);
}
