// ─────────────────────────────────────────────────────────────────
//  Parámetros de /calendario/ (+ EN /en/calendar/) según idioma.
//   · ES: ?vista=mes|temporada&mes=AAAA-MM
//   · EN: ?view=month|season&month=AAAA-MM
//  Las subvistas se identifican internamente como 'mes' | 'temporada'
//  (localStorage cc-cal-subview, data-cal-switch). La lectura acepta las
//  dos formas; la escritura usa la del idioma de la página.
//  ?month=AAAA-MM sin vista es también la URL legacy de mes.html.
//  js/lang-switch.js replica la traducción (script clásico, sin import).
// ─────────────────────────────────────────────────────────────────

const VIEW_FROM_EN = { month: 'mes', season: 'temporada' };
const VIEW_TO_EN   = { mes: 'month', temporada: 'season' };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function names(lang) {
  return lang === 'en'
    ? { view: 'view', month: 'month' }
    : { view: 'vista', month: 'mes' };
}

/** Subvista pedida en la URL: 'mes' | 'temporada' | null. */
export function readCalendarView(params) {
  const es = params.get('vista');
  if (es === 'mes' || es === 'temporada') return es;
  return VIEW_FROM_EN[params.get('view')] || null;
}

/** Mes pedido en la URL (AAAA-MM) o null. */
export function readCalendarMonth(params) {
  for (const key of ['mes', 'month']) {
    const v = params.get(key);
    if (MONTH_RE.test(v || '')) return v;
  }
  return null;
}

/**
 * Escribe vista y mes en `params` con los nombres del idioma y retira los
 * del otro. `month` null elimina el mes; undefined lo conserva.
 */
export function writeCalendarParams(params, lang, { view, month } = {}) {
  const n = names(lang);
  const currentMonth = readCalendarMonth(params);
  ['vista', 'view', 'mes', 'month'].forEach(k => params.delete(k));
  if (view) params.set(n.view, lang === 'en' ? VIEW_TO_EN[view] : view);
  const m = month === undefined ? currentMonth : month;
  if (m) params.set(n.month, m);
  return params;
}
