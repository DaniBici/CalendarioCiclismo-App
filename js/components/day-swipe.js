// ── Swipe horizontal para cambiar de día (móvil) ──────────────────
// Compartido por Hoy en Carretera (js/app.js) y Hoy en Ciclocross
// (js/ciclocross.js). El dedo arrastra la lista de carreras (`list`); al soltar
// por encima del umbral (o con un flick rápido) se confirma el cambio al día
// anterior/siguiente con un «settle» animado (la lista sale por un lado y la
// nueva entra por el otro). `target(forward)` devuelve el destino de las
// flechas ◀▶ o null; `load(dateKey)` pinta ese día. El gesto se escucha sobre
// la lista Y sobre el selector de días (`dateBar`) — las 7 píldoras reparten el
// ancho SIN scroll, así que no hay conflicto; el feedback visual (transform)
// siempre va sobre la lista y un arrastre sobre una píldora NO dispara su tap
// (suppressClick). El cintillo tiene gesto propio y vive fuera de ambos.
// Paridad con el DragGesture de las apps (umbral h > v*1.5).
export function initDaySwipe({ list, dateBar, target, load }) {
  if (!list) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DECIDE_PX = 12;   // distancia para decidir si el gesto es horizontal
  const COMMIT_PX = 60;   // distancia para confirmar el cambio de día
  const RESIST    = 0.4;  // rubber-band al rebasar el 60% del ancho

  let startX = 0, startY = 0, startT = 0, width = 0;
  let tracking = false, horizontal = false, dragging = false;
  let animating = false, suppressClick = false;

  function resetTransform() {
    list.style.transition = '';
    list.style.transform = '';
    list.style.willChange = '';
  }

  function settleBack() {
    if (reduceMotion) { resetTransform(); return; }
    list.style.transition = 'transform .22s cubic-bezier(.22,.61,.36,1)';
    list.style.transform = 'translateX(0)';
    setTimeout(resetTransform, 240);
  }

  function commit(forward) {
    const targetDk = target(forward);
    if (!targetDk) { settleBack(); return; }

    if (reduceMotion || !width) { resetTransform(); load(targetDk); return; }

    animating = true;
    const outX = forward ? -width : width;
    const inX  = forward ? width : -width;

    // 1) La lista actual sale por el lado del gesto.
    list.style.transition = 'transform .2s ease-in';
    list.style.transform = `translateX(${outX}px)`;
    setTimeout(() => {
      // 2) Cargar el nuevo día (rellena la lista; loading → contenido «a golpes»).
      load(targetDk);
      // 3) Colocar la lista fuera por el lado opuesto y deslizarla a su sitio.
      list.style.transition = 'none';
      list.style.transform = `translateX(${inX}px)`;
      void list.offsetWidth; // forzar reflow antes de la transición de entrada
      list.style.transition = 'transform .24s cubic-bezier(.22,.61,.36,1)';
      list.style.transform = 'translateX(0)';
      setTimeout(() => { resetTransform(); animating = false; }, 260);
    }, 200);
  }

  function onTouchStart(e) {
    if (animating || e.touches.length !== 1) { tracking = false; return; }
    const tch = e.touches[0];
    startX = tch.clientX; startY = tch.clientY; startT = Date.now();
    width = list.getBoundingClientRect().width || window.innerWidth;
    tracking = true; horizontal = false; dragging = false;
  }

  function onTouchMove(e) {
    if (!tracking || animating || e.touches.length !== 1) return;
    const tch = e.touches[0];
    const dx = tch.clientX - startX;
    const dy = tch.clientY - startY;

    if (!horizontal) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        horizontal = true; dragging = true;
        if (!reduceMotion) { list.style.transition = 'none'; list.style.willChange = 'transform'; }
      } else {
        tracking = false; return; // scroll vertical → no interferir
      }
    }

    e.preventDefault(); // ya es un swipe horizontal: bloquear scroll/overscroll
    if (reduceMotion) return; // sin animación de arrastre, solo se confirma al soltar
    let shift = dx;
    const cap = width * 0.6;
    if (Math.abs(dx) > cap) shift = Math.sign(dx) * (cap + (Math.abs(dx) - cap) * RESIST);
    list.style.transform = `translateX(${shift}px)`;
  }

  function onTouchEnd(e) {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    horizontal = false; dragging = false;
    suppressClick = true; // hubo arrastre horizontal → no abrir tarjeta ni píldora
    setTimeout(() => { suppressClick = false; }, 400);

    const tch = e.changedTouches[0];
    const dx = tch.clientX - startX;
    const dt = Date.now() - startT;
    const flick = dt < 300 && Math.abs(dx) > 30;
    if (Math.abs(dx) > COMMIT_PX || flick) commit(dx < 0);
    else settleBack();
  }

  function onTouchCancel() {
    if (dragging) settleBack();
    tracking = false; horizontal = false; dragging = false;
  }

  // Tras un arrastre horizontal, anular el click que dispararía la tarjeta
  // (lista) o la píldora de día (selector). Ambos handlers escuchan en
  // burbuja; este capture corre antes y corta la propagación.
  function onClickCapture(e) {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
  }

  for (const el of [list, dateBar]) {
    if (!el) continue;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('click', onClickCapture, true);
  }
}
