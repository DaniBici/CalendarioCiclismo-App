// Flechas comunes de navegación. No alteran los destinos ni el orden de las tiras.
export function arrowHtml(direction, label, extra = '') {
  return `<button type="button" class="cc-scroll-arrow" data-direction="${direction}" aria-label="${label}" ${extra}><span aria-hidden="true">${direction === 'prev' || direction === 'up' ? '‹' : '›'}</span></button>`;
}

function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

export function hasScrollRailOverflow(contentExtent, viewportExtent, leadingControlExtent = 0, trailingControlExtent = 0) {
  return contentExtent > viewportExtent + leadingControlExtent + trailingControlExtent + 2;
}

export function installScrollRail(shell, { rail, prev, next, vertical = false } = {}) {
  if (!shell || shell._ccRailCleanup) return;
  rail ||= shell.querySelector('[data-scroll-rail]');
  prev ||= shell.querySelector('[data-direction="prev"], [data-direction="up"]');
  next ||= shell.querySelector('[data-direction="next"], [data-direction="down"]');
  if (!rail || !prev || !next) return;
  const position = vertical ? 'scrollTop' : 'scrollLeft';
  const size = vertical ? 'clientHeight' : 'clientWidth';
  const extent = vertical ? 'scrollHeight' : 'scrollWidth';
  const controlExtent = vertical ? 'offsetHeight' : 'offsetWidth';
  const axis = vertical ? 'top' : 'left';
  const sync = () => {
    const overflow = hasScrollRailOverflow(
      rail[extent],
      rail[size],
      prev.hidden ? 0 : prev[controlExtent],
      next.hidden ? 0 : next[controlExtent],
    );
    shell.classList.toggle('cc-rail--overflow', overflow);
    prev.hidden = next.hidden = !overflow;
    prev.disabled = rail[position] <= 1;
    next.disabled = rail[position] + rail[size] >= rail[extent] - 2;
  };
  const move = sign => rail.scrollBy({ [axis]: sign * Math.max(80, rail[size] * .75), behavior: scrollBehavior() });
  const back = () => move(-1), forward = () => move(1);
  const focus = event => {
    const target = event.target;
    if (!rail.contains(target)) return;
    const bounds = rail.getBoundingClientRect(), box = target.getBoundingClientRect();
    const start = vertical ? 'top' : 'left', end = vertical ? 'bottom' : 'right';
    const delta = box[start] < bounds[start] ? box[start] - bounds[start] : box[end] > bounds[end] ? box[end] - bounds[end] : 0;
    if (delta) rail.scrollBy({ [axis]: delta, behavior: scrollBehavior() });
  };
  prev.addEventListener('click', back);
  next.addEventListener('click', forward);
  rail.addEventListener('scroll', sync, { passive: true });
  rail.addEventListener('focusin', focus);
  const resize = new ResizeObserver(sync);
  resize.observe(shell); resize.observe(rail);
  const mutation = new MutationObserver(sync);
  mutation.observe(rail, { childList: true, subtree: true });
  shell._ccRailCleanup = () => {
    resize.disconnect(); mutation.disconnect();
    prev.removeEventListener('click', back); next.removeEventListener('click', forward);
    rail.removeEventListener('scroll', sync); rail.removeEventListener('focusin', focus);
    delete shell._ccRailCleanup;
  };
  requestAnimationFrame(sync);
}
