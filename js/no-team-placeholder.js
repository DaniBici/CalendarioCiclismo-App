// Estados emitidos por fuentes UCI para corredores sin equipo. No son equipos
// de catálogo: la fila de startlist se conserva para mantener el vínculo con
// sus corredores, pero la presentación no debe mostrarla como una formación.
const NO_TEAM_PLACEHOLDER_FOLDS = new Set([
  'individual',
  'private member',
  'sin equipo',
  'un',
  'un attached leinster',
]);

function normalizeNoTeamPlaceholderName(value) {
  return String(value || '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isNoTeamPlaceholderTeam(slTeam) {
  return !!slTeam && !slTeam.teamId
    && NO_TEAM_PLACEHOLDER_FOLDS.has(normalizeNoTeamPlaceholderName(slTeam.teamName));
}
