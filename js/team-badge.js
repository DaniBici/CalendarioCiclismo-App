// Regla compartida de visibilidad para las chapas de equipos.
// La base de datos rellena los colores ausentes con esta paleta; no representa
// un maillot curado y, por tanto, no debe producir una chapa visible.

const DEFAULT_WHITE = '#ffffff';
const DEFAULT_DARKS = new Set(['#000000', '#111111']);

/** Normaliza colores hex de la paleta de chapas. */
export function normalizeTeamBadgeColor(value) {
  const color = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${[...color.slice(1)].map(c => c + c).join('')}`;
  }
  return null;
}

/**
 * Indica si el equipo tiene colores de equipación curados.
 * La categoría (club, nacional, regional, WT, etc.) no interviene: la regla
 * se aplica a cualquier equipo que llegue a una superficie pública.
 */
export function hasCustomTeamBadgeColors(team) {
  if (!team) return false;

  const torsoCenter = normalizeTeamBadgeColor(team.badgeTorsoCenter);
  const torsoSides = normalizeTeamBadgeColor(team.badgeTorsoSides);
  const shorts = normalizeTeamBadgeColor(team.badgeShorts);
  if (!torsoCenter || !torsoSides || !shorts) return false;

  const innerRaw = String(team.badgeInnerCircle ?? '').trim();
  const inner = innerRaw ? normalizeTeamBadgeColor(innerRaw) : null;
  if (innerRaw && !inner) return false;

  return torsoCenter !== DEFAULT_WHITE
    || !DEFAULT_DARKS.has(torsoSides)
    || !DEFAULT_DARKS.has(shorts)
    || !!inner;
}
