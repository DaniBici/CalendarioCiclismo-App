// Lo que Últimos resultados hace sobre el DOM ya pintado, sin dependencias: lo
// usan la página completa y la versión publicada.
// ── Rejilla de dos columnas ────────────────────────────────────────
// Desde 761 px, como la rejilla de Hoy, cada día es una rejilla de dos
// columnas (css/resultados.css, mismo punto de corte). Cada destacada ocupa en
// su columna las filas que exige su altura natural y las filas normales
// rellenan en orden denso la otra columna. La altura de referencia es la
// mediana de las filas normales del día.
// Solo las destacadas con clasificaciones complementarias crecen en altura.
// Un exceso de hasta FEED_SPAN_TOLERANCE px no añade otra fila: lo absorben
// las filas abarcadas creciendo unos píxeles.
const FEED_TWO_COLUMNS = window.matchMedia('(min-width:761px)');
const FEED_SPAN_TOLERANCE = 12;
export function packFeaturedEntries(root) {
  root.querySelectorAll('.feed-day').forEach((day) => {
    const featured = [...day.querySelectorAll(':scope>.feed-row--featured')];
    if (!featured.length) return;
    featured.forEach((el) => { el.style.gridRow = ''; });
    if (!FEED_TWO_COLUMNS.matches) return;
    const rows = [...day.querySelectorAll(':scope>.feed-row:not(.feed-row--featured)')];
    const items = [...featured, ...rows];
    items.forEach((el) => { el.style.alignSelf = 'start'; });
    const featuredHeights = featured.map(el => el.offsetHeight);
    const rowHeights = rows.map(el => el.offsetHeight).sort((a, b) => a - b);
    items.forEach((el) => { el.style.alignSelf = ''; });
    const rowHeight = rowHeights[Math.floor(rowHeights.length / 2)];
    if (!rowHeight) return;
    const gap = parseFloat(getComputedStyle(day).rowGap) || 0;
    featured.forEach((el, i) => {
      const span = Math.max(1, Math.ceil((featuredHeights[i] + gap - FEED_SPAN_TOLERANCE) / (rowHeight + gap)));
      el.style.gridRow = `span ${span}`;
    });
  });
}

// Ciclocross en dos columnas: la altura de la tarjeta depende del número de
// categorías. Cada columna apila sus tarjetas sin huecos (mampostería): la
// rejilla usa filas de 1 px y cada tarjeta abarca su altura más la separación;
// el flujo denso la coloca en la columna que queda más arriba.
const CX_CARD_GAP = 10;
export function packCxDays(root) {
  root.querySelectorAll('.feed-day__cx-grid').forEach((grid) => {
    const cards = [...grid.children];
    cards.forEach((el) => { el.style.gridRow = ''; });
    if (!FEED_TWO_COLUMNS.matches) return;
    const heights = cards.map(el => el.getBoundingClientRect().height);
    cards.forEach((el, i) => { el.style.gridRow = `span ${Math.ceil(heights[i]) + CX_CARD_GAP}`; });
  });
}

// Filas del ránking con explicación: un toque abre y cierra su regla.
export function bindRankingRows(root) {
  const explainedRows = [...root.querySelectorAll('.uci-ranking-row--explained')];
  const closeRuleTooltips = (except = null) => {
    explainedRows.forEach((row) => {
      if (row === except) return;
      row.classList.remove('uci-ranking-row--tooltip-open');
      row.setAttribute('aria-expanded', 'false');
    });
  };
  const toggleRuleTooltip = (row) => {
    const shouldOpen = !row.classList.contains('uci-ranking-row--tooltip-open');
    closeRuleTooltips(row);
    row.classList.toggle('uci-ranking-row--tooltip-open', shouldOpen);
    row.setAttribute('aria-expanded', String(shouldOpen));
  };
  explainedRows.forEach((row) => {
    row.addEventListener('click', () => toggleRuleTooltip(row));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleRuleTooltip(row);
    });
  });
  root.querySelector('.uci-ranking')?.addEventListener('click', (event) => {
    if (!event.target.closest('.uci-ranking-row--explained')) closeRuleTooltips();
  });
}
