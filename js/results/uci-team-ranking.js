// Reglas puras para interpretar la instantánea del ránking UCI de equipos.
// La UCI aplica el ránking FINAL de la temporada anterior; cualquier mensaje
// sobre la publicación semanal vigente se presenta siempre como proyección.

export const UciRankingTier = Object.freeze({
  WORLD_TOUR: 'world_tour',
  ALL_WORLD_TOUR: 'all_world_tour',
  PRO_SERIES: 'pro_series',
  WOMENS_WORLD_TOUR: 'womens_world_tour',
  STANDARD: 'standard',
});

export function formatUciRankingUpdated(value, isEnglish = false) {
  const prefix = isEnglish ? 'Updated' : 'Actualizado';
  if (!value) return `${prefix}: —`;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = date.toLocaleDateString(isEnglish ? 'en-GB' : 'es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${prefix}: ${formatted}`;
}

export function decorateUciRanking(rows, gender) {
  const selected = rows
    .filter((row) => row.gender === gender)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  const eligibleCategory = gender === 'female' ? 'PRW' : 'PT';
  let eligibleOrdinal = 0;

  return selected.map((row) => {
    if (row.teamCategory === eligibleCategory) eligibleOrdinal += 1;
    const isWorldTour = gender === 'female'
      ? row.teamCategory === 'WWT'
      : row.teamCategory === 'WT';
    let tier = UciRankingTier.STANDARD;
    if (isWorldTour) {
      tier = UciRankingTier.WORLD_TOUR;
    } else if (row.teamCategory === eligibleCategory) {
      if (gender === 'female' && eligibleOrdinal <= 2) {
        tier = UciRankingTier.WOMENS_WORLD_TOUR;
      } else if (gender === 'male' && eligibleOrdinal <= 3) {
        tier = UciRankingTier.ALL_WORLD_TOUR;
      } else if (gender === 'male' && eligibleOrdinal <= 5) {
        tier = UciRankingTier.PRO_SERIES;
      }
    }
    return {
      ...row,
      invitationTier: tier,
      eligibleOrdinal: row.teamCategory === eligibleCategory ? eligibleOrdinal : null,
      grandTourExcluded:
        gender === 'male' && row.teamCategory === 'PT' && Number(row.rank) > 30,
    };
  });
}

export function uciRankingRuleText(row, isEnglish = false) {
  const projection = isEnglish
    ? 'Projection based on the current position.'
    : 'Proyección según la posición actual.';
  const rankingYear = Number(String(row.rankingDate || '').slice(0, 4));
  const invitationYear = Number.isFinite(rankingYear) ? rankingYear + 1 : new Date().getFullYear() + 1;
  const messages = [];

  switch (row.invitationTier) {
    case UciRankingTier.WORLD_TOUR:
      break;
    case UciRankingTier.ALL_WORLD_TOUR:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI WorldTour race, including the Grand Tours, and every ${invitationYear} UCI ProSeries race. ${projection}`
        : `Invitación obligatoria a todas las pruebas UCI WorldTour de ${invitationYear}, incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de ${invitationYear}. ${projection}`);
      break;
    case UciRankingTier.PRO_SERIES:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI ProSeries race. ${projection}`
        : `Invitación obligatoria a todas las pruebas UCI ProSeries de ${invitationYear}. ${projection}`);
      break;
    case UciRankingTier.WOMENS_WORLD_TOUR:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI Women's WorldTour race. ${projection}`
        : `Invitación obligatoria a todas las pruebas UCI Women's WorldTour de ${invitationYear}. ${projection}`);
      break;
    default:
      break;
  }

  if (row.grandTourExcluded) {
    messages.push(isEnglish
      ? `Outside the overall top 30, this UCI ProTeam is not currently eligible for a ${invitationYear} Grand Tour wildcard. ${projection}`
      : `Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de ${invitationYear}. ${projection}`);
  }
  return messages.join(' ');
}
