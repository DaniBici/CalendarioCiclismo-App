/**
 * Tipo de prueba (contrarreloj individual, por equipos o línea) de una
 * competición de DataRide y de una carrera propia.
 *
 * DataRide publica algunos campeonatos como una competición por prueba
 * («Caribbean Elite Road Cycling Championships - WE ITT»). Con la misma fecha,
 * país, clase y género, la línea y la contrarreloj son indistinguibles para un
 * matcher que solo mira esos campos: la línea terminaba enlazada con la
 * competición de la contrarreloj y recibía sus resultados.
 *
 * El tipo solo descarta candidatos cuando ambos lados lo declaran y difieren.
 * Un nombre sin marca de tipo no filtra nada.
 */
'use strict';

const TTT = /\bttt\b|team time trial|contrarreloj por equipos/;
const ITT = /\bitt\b|time trial|contrarreloj|\bcri\b|crono/;
const RR = /\birr\b|\brr\b|road race|\blinea\b|\bin line\b/;

function fold(value) {
  return ` ${String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()} `;
}

/** Devuelve 'ttt' | 'itt' | 'rr' o null si el texto no declara el tipo o lo declara ambiguo. */
export function eventKindFromText(...values) {
  const kinds = new Set();
  for (const value of values) {
    const text = fold(value);
    if (TTT.test(text)) kinds.add('ttt');
    else if (ITT.test(text)) kinds.add('itt');
    if (RR.test(text)) kinds.add('rr');
  }
  return kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * Tipo de una carrera propia: primero el texto de sus nombres y, si no lo
 * declaran, el `primaryType` de sus jornadas cuando es de un solo día.
 */
export function ourEventKind({ names = [], primaryTypes = [], raceFormat = null } = {}) {
  const fromNames = eventKindFromText(...names);
  if (fromNames) return fromNames;
  if (raceFormat !== 'one_day') return null;
  const types = new Set(primaryTypes.filter(Boolean));
  if (types.size !== 1) return null;
  const [type] = types;
  if (type === 'itt' || type === 'ttt') return type;
  return 'rr';
}

/** `true` si ambos tipos son conocidos y distintos. */
export function eventKindsConflict(ours, theirs) {
  return ours != null && theirs != null && ours !== theirs;
}
