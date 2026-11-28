// Reglas puras para interpretar el ránking UCI de equipos publicado.
// La UCI aplica el ránking FINAL de la temporada anterior; cualquier mensaje
// sobre la publicación semanal vigente se presenta siempre como proyección.
// La temporada del ránking (seasonYear) va del día siguiente al cierre de la
// anterior (octubre) al tercer domingo de octubre: el ránking 2027 empieza el
// 19-10-2026 y define las invitaciones de 2028.

export const UciRankingTier = Object.freeze({
  WORLD_TOUR: 'world_tour',
  ALL_WORLD_TOUR: 'all_world_tour',
  PRO_SERIES: 'pro_series',
  WOMENS_WORLD_TOUR: 'womens_world_tour',
  STANDARD: 'standard',
});

function formatRankingDate(value, isEnglish) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(isEnglish ? 'en-GB' : 'es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatUciRankingUpdated(value, isEnglish = false) {
  const prefix = isEnglish ? 'Updated' : 'Actualizado';
  if (!value) return `${prefix}: -`;
  return `${prefix}: ${formatRankingDate(value, isEnglish)}`;
}

/**
 * Fecha y hora de la última reescritura del ránking (`syncedAt`, varias al día)
 * en números: «Actualizado: 24/11/2026, 14:32». Sin `timeZone`, la zona del
 * navegador; en el servidor se pinta en UTC con la marca «UTC» y el navegador la
 * pasa a su hora local (`localizeUciRankingUpdated`).
 */
export function formatUciRankingUpdatedAt(value, isEnglish = false, timeZone) {
  const prefix = isEnglish ? 'Updated' : 'Actualizado';
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return `${prefix}: -`;
  const formatted = new Intl.DateTimeFormat(isEnglish ? 'en-GB' : 'es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
  return `${prefix}: ${formatted}${timeZone === 'UTC' ? ' UTC' : ''}`;
}

/** Última reescritura de las filas (ISO) o null. */
export function uciRankingUpdatedAt(rows) {
  return rows.reduce((latest, row) => (
    row.syncedAt && (!latest || new Date(row.syncedAt) > new Date(latest)) ? row.syncedAt : latest
  ), null);
}

/** Pasa a la hora local del navegador las fechas de actualización pintadas en UTC. */
export function localizeUciRankingUpdated(root) {
  root.querySelectorAll('time[data-uci-updated]').forEach((node) => {
    node.textContent = formatUciRankingUpdatedAt(node.dateTime, node.dataset.uciUpdated === 'en');
  });
}

/** Temporada del ránking; las filas anteriores a seasonYear la deducen de la fecha. */
export function uciRankingSeasonYear(row) {
  const season = Number(row?.seasonYear);
  if (Number.isFinite(season) && season > 0) return season;
  const rankingYear = Number(String(row?.rankingDate || '').slice(0, 4));
  return Number.isFinite(rankingYear) && rankingYear > 0 ? rankingYear : new Date().getFullYear();
}

export function uciRankingInvitationYear(row) {
  return uciRankingSeasonYear(row) + 1;
}

/**
 * Origen de los puntos cuando el ránking suma clasificaciones o penalizaciones
 * posteriores a la última publicación oficial de la UCI; vacío si coincide con
 * ella.
 */
export function uciRankingBasisText(rows, isEnglish = false) {
  const adjusted = rows.some((row) =>
    Number(row.provisionalPoints || 0) !== 0 || Number(row.penaltyPoints || 0) !== 0);
  if (!adjusted) return '';
  const officialDate = rows.find((row) => row.officialRankingDate)?.officialRankingDate;
  if (!officialDate) {
    return isEnglish
      ? 'Points from official results until the UCI publishes this season\'s ranking.'
      : 'Puntos de las clasificaciones oficiales hasta que la UCI publique el ránking de esta temporada.';
  }
  const formatted = formatRankingDate(officialDate, isEnglish);
  return isEnglish
    ? `UCI ranking of ${formatted} plus later official results and commissaires' penalties.`
    : `Ránking UCI del ${formatted} más las clasificaciones oficiales y las sanciones del jurado posteriores.`;
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
  const invitationYear = uciRankingInvitationYear(row);
  const messages = [];

  switch (row.invitationTier) {
    case UciRankingTier.WORLD_TOUR:
      break;
    case UciRankingTier.ALL_WORLD_TOUR:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI WorldTour race, including the Grand Tours, and every ${invitationYear} UCI ProSeries race.`
        : `Invitación obligatoria a todas las pruebas UCI WorldTour de ${invitationYear}, incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de ${invitationYear}.`);
      break;
    case UciRankingTier.PRO_SERIES:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI ProSeries race.`
        : `Invitación obligatoria a todas las pruebas UCI ProSeries de ${invitationYear}.`);
      break;
    case UciRankingTier.WOMENS_WORLD_TOUR:
      messages.push(isEnglish
        ? `Mandatory invitation to every ${invitationYear} UCI Women's WorldTour race.`
        : `Invitación obligatoria a todas las pruebas UCI Women's WorldTour de ${invitationYear}.`);
      break;
    default:
      break;
  }

  if (row.grandTourExcluded) {
    messages.push(isEnglish
      ? `Outside the overall top 30, this UCI ProTeam is not currently eligible for a ${invitationYear} Grand Tour wildcard.`
      : `Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de ${invitationYear}.`);
  }
  return messages.join(' ');
}
