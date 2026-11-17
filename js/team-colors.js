// Regla compartida de visibilidad para los colores de presentación del equipo.
// La base de datos rellena los colores ausentes con esta paleta; no representa
// colores curados y, por tanto, no debe producir el cuadrado de colores.

const DEFAULT_WHITE = '#ffffff';
const DEFAULT_DARKS = new Set(['#000000', '#111111']);

/** Normaliza un color hex de la paleta del equipo. */
function normalizeTeamColor(value) {
  const color = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${[...color.slice(1)].map(c => c + c).join('')}`;
  }
  return null;
}

/**
 * Indica si el equipo tiene colores curados.
 * La categoría (club, nacional, regional, WT, etc.) no interviene: la regla
 * se aplica a cualquier equipo que llegue a una superficie pública.
 * Las tres franjas se guardan en `badgeTorsoSides`, `badgeTorsoCenter` y
 * `badgeShorts`; `badgeInnerCircle` es una columna heredada sin uso que no
 * interviene.
 */
export function hasCustomTeamColors(team) {
  if (!team) return false;

  const center = normalizeTeamColor(team.badgeTorsoCenter);
  const sides = normalizeTeamColor(team.badgeTorsoSides);
  const shorts = normalizeTeamColor(team.badgeShorts);
  if (!center || !sides || !shorts) return false;

  return center !== DEFAULT_WHITE
    || !DEFAULT_DARKS.has(sides)
    || !DEFAULT_DARKS.has(shorts);
}
