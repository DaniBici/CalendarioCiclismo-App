// ─────────────────────────────────────────────────────────────────
//  VENTANA DE REFRESCO — decide si una página debe sondear cambios.
//  Una jornada o carrera solo cambia por la competición en curso entre la
//  víspera y el día siguiente: el margen cubre las zonas horarias y los
//  resultados que se publican tras la meta.
// ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function dayNumber(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey || '');
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
}

/**
 * true si hoy (fecha local de `now`) cae entre `startKey - before` y
 * `endKey + after` días. Sin fecha de inicio no hay ventana.
 */
export function isNearToday(startKey, endKey = startKey, { before = 1, after = 1, now = new Date() } = {}) {
  const start = dayNumber(startKey);
  const end = dayNumber(endKey || startKey) ?? start;
  if (start == null) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  return today >= start - before && today <= end + after;
}
