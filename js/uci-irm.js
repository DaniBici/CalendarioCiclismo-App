// ─────────────────────────────────────────────────────────────────
//  Códigos IRM de la UCI (irregularidades / no-clasificados) — fuente única.
//
//  El campo `irm` de race_uci_results marca a quien NO terminó: DNF (abandono),
//  DNS (no tomó la salida), OTL (fuera de control / OutTimeLimit), DSQ (descalif.).
//  EN = código oficial UCI; ES = abreviatura local de uso en prensa ciclista.
//
//  Lo consumen tanto la tabla de resultados (resultados.js) como el tachado de
//  abandonos en la lista de inscritos (inscritos.js + rider-tooltip.js).
// ─────────────────────────────────────────────────────────────────

export const IRM_LABELS = {
  DNF: { es: 'ABN', en: 'DNF' },
  ABD: { es: 'ABN', en: 'DNF' },   // ABD = variante UCI de DNF (abandonó)
  DNS: { es: 'NS',  en: 'DNS' },
  OTL: { es: 'FC',  en: 'OTL' },
  DSQ: { es: 'EXP', en: 'DSQ' },
};

// Descripción larga de cada código, para tooltip (title) sobre la etiqueta corta.
// El corredor que abandona/no sale rara vez es de WT/PT → no tiene tooltip de ficha,
// así que la única pista de qué significa "ABN"/"NS"/"FC"/"EXP" es este title.
//
// En español, "Expulsado/a" concuerda con el género de la carrera (`races.gender`):
// masculino por defecto, femenino en carreras femeninas. El resto de descripciones
// son neutras. El inglés no flexiona.
export const IRM_DESCRIPTIONS = {
  DNF: { es: 'Abandono', en: 'Did not finish' },
  ABD: { es: 'Abandono', en: 'Did not finish' },
  DNS: { es: 'No tomó la salida', en: 'Did not start' },
  OTL: { es: 'Fuera de control', en: 'Outside time limit' },
  DSQ: { es: 'Expulsado', esFemale: 'Expulsada', en: 'Disqualified' },
};

// Texto del tooltip para un código IRM. Vacío si el código no se contempla
// (no inventamos descripción para un código desconocido). `female` aplica la
// concordancia de género en español (solo afecta a DSQ → Expulsada).
export function irmDescription(code, lang, female) {
  if (!code) return '';
  const entry = IRM_DESCRIPTIONS[code];
  if (!entry) return '';
  if (lang === 'en') return entry.en;
  return (female && entry.esFemale) || entry.es;
}

// ¿El código marca a quien NO completó la prueba (abandono / no salida / fuera de
// control / descalificación)? Estos códigos sobre el rank 1 significan que ese
// puesto es espurio (la corredora NO ganó: el ganador real es el primer clasificado
// SIN irm). Se opone a códigos de "ruido" como LAP, que la UCI cuelga a veces de la
// propia ganadora — esos NO descalifican (ver resultados.js).
const ABANDON_CODES = new Set(['DNF', 'ABD', 'DNS', 'OTL', 'DSQ']);
export function isAbandonIrm(code) {
  return !!code && ABANDON_CODES.has(code);
}

// Etiqueta localizada de un código IRM. Fallback al propio código si es uno
// no contemplado (la UCI podría introducir otros: NP, AB, …) — así nunca se
// pierde la señal de "fuera de carrera" aunque el código sea desconocido.
export function irmLabel(code, lang) {
  if (!code) return '';
  const entry = IRM_LABELS[code];
  if (!entry) return code;
  return entry[lang === 'en' ? 'en' : 'es'];
}
