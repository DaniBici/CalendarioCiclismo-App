// Identificadores estables compartidos con los placeholders PDF del panel.
const CLASS_INDEX = { stage: 0, gc: 1, points: 2, kom: 3, youth: 4, teams: 5 };

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Variante por unidades UTF-16 (charCodeAt por índice) que usan los fetchers de
// resultados para sus IDs sintéticos. Coincide con fnv1a salvo en caracteres fuera
// del BMP (emoji, CJK ampliado): fnv1a solo procesa el surrogate alto. Los IDs ya
// guardados dependen de cada variante; no intercambiarlas.
export function fnv1aCodeUnits(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export const suggestCompetitionId = (raceId) => -(fnv1a(`manual:${String(raceId || '').trim()}`) % 200000 || 1);
export const synthRaceId = (competitionId, stageNumber) => -(Math.abs(competitionId) * 100 + stageNumber);
export const synthEventId = (competitionId, stageNumber, classKind) =>
  -(Math.abs(competitionId) * 10000 + stageNumber * 100 + (CLASS_INDEX[classKind] ?? 9));
