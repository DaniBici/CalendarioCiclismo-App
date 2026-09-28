// "H:MM:SS" | "MM:SS" | "SS" → segundos (o null si no parsea).
export function timeToSeconds(txt) {
  if (!txt) return null;
  const parts = String(txt).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
// segundos → gap con la convención de la prensa ciclista:
//   <1min  → +SS"        (p. ej. +7")
//   <1h    → +M'SS"      (p. ej. +1'38")
//   ≥1h    → +H:MM:SS    (p. ej. +1:02:41)
export function secondsToGap(sec) {
  if (sec == null || sec < 0) return null;
  // Segundos ENTEROS siempre (regla de carretera: el tiempo oficial se trunca al
  // segundo). El floor también mata el error flotante de derivar con decimales.
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `+${h}:${String(m).padStart(2, '0')}:${ss}`;
  if (m > 0) return `+${m}'${ss}"`;
  return `+${s}"`;
}
// Normaliza un gap al formato de prensa. La UCI publica los gaps con ':' como
// separador único y SIN unidades ("+41" = 41s, "+1:56" = 1m56s, "+3:13" = 3m13s,
// "+35:09" = 35m09s, "+1:02:41" = 1h02m41s) → re-emitir como +SS"/+M'SS"/+H:MM:SS.
// Si el gap ya trae las marcas de prensa (' o ") se devuelve tal cual.
export function formatGap(gap) {
  if (!gap) return gap;
  const t = String(gap).trim();
  if (t.includes("'") || t.includes('"')) return t;   // ya formateado
  const sec = timeToSeconds(t.replace(/^\+/, ''));      // "+3:13" → 193
  return sec != null ? secondsToGap(sec) : t;
}
// Limpia un tiempo absoluto para PRESENTACIÓN: recorta el bloque de horas a
// cero ("0:06:36"/"00:30:36" → "6:36"/"30:36"), el cero a la izquierda del
// primer bloque y los DECIMALES enteros fuera ("1:04.869" → "1:04"): en
// carretera el tiempo oficial se cuenta en segundos enteros (truncado). La UCI
// publica los tiempos con formatos muy dispares (visto en las CRI del backfill).
export function cleanTimeText(txt) {
  if (!txt) return '';
  let t = String(txt).trim();
  t = t.replace(/^0+:(?=\d)/, '');         // fuera el bloque de horas "0:"/"00:"
  t = t.replace(/^0(?=\d:)/, '');          // "06:36" → "6:36"
  t = t.replace(/\.\d+$/, '');             // decimales fuera (segundos enteros)
  return t;
}
// segundos → tiempo absoluto ("6:36" · "45:53" · "1:05:05"): sin horas a cero
// y en segundos ENTEROS (truncado, regla de carretera).
export function secondsToAbsText(sec) {
  if (sec == null || sec < 0) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
