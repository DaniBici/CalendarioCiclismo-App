// Lógica pura compartida por el alta de fichas desde el mercado de fichajes.

export const MARKET_DESTINATION_DIVISIONS = Object.freeze(['WT', 'PT', 'WWT', 'PRW']);

const MARKET_DESTINATION_GENDER = Object.freeze({
  WT: 'male',
  PT: 'male',
  WWT: 'female',
  PRW: 'female',
});

export function transferRowBorderColor(status) {
  if (status === 'rumor') return 'transparent';
  if (status === 'doubt') return '#8b5cf6';
  return 'var(--border)';
}

export function transferRiderInitialGender({
  teams = [],
  fromTeamId = null,
  presetToTeamId = null,
  fallback = 'male',
} = {}) {
  const byId = new Map(teams.map(team => [team.id, team]));
  const contextualTeam = byId.get(fromTeamId) || byId.get(presetToTeamId) || null;
  return contextualTeam?.gender === 'female' || contextualTeam?.gender === 'male'
    ? contextualTeam.gender
    : fallback;
}

export function riderTeamOptionLabel(team) {
  const name = team?.name || team?.id || '';
  return `${name}${team?.category ? ` (${team.category})` : ''}`;
}

export function marketDestinationTeamOptions({
  teams = [],
  marketSeasons = [],
  gender = null,
  excludeTeamId = null,
} = {}) {
  const teamById = new Map(teams.map(team => [team.id, team]));
  const seen = new Set();

  return marketSeasons
    .filter(season => {
      const seasonGender = MARKET_DESTINATION_GENDER[season?.category];
      if (!season?.teamId || !seasonGender || seen.has(season.teamId)) return false;
      if (season.teamId === excludeTeamId || (gender && seasonGender !== gender)) return false;
      if (teamById.get(season.teamId)?.specialEdition) return false;
      seen.add(season.teamId);
      return true;
    })
    .map(season => {
      const team = teamById.get(season.teamId) || {};
      return {
        ...team,
        id: season.teamId,
        name: season.name || team.name || season.teamId,
        category: season.category,
        gender: MARKET_DESTINATION_GENDER[season.category],
      };
    });
}

export function isMarketDestinationTeamEligible({
  teamId,
  teams = [],
  marketSeasons = [],
  gender = null,
} = {}) {
  if (!teamId) return false;
  return marketDestinationTeamOptions({ teams, marketSeasons, gender })
    .some(team => team.id === teamId);
}

// La carga con la que se inauguró el mercado asignó 20/07/2026 a las filas sin
// fecha editorial. Sus timestamps solo difieren por los defaults y triggers del
// lote; la excepción UAE recibió después una actualización técnica conjunta.
export function isInitialTransferImport(transfer) {
  if (transfer?.announcedAt !== '2026-07-20') return false;
  const created = Date.parse(transfer.createdAt || '');
  const updated = Date.parse(transfer.updatedAt || '');
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;

  const unchangedSinceImport = Math.abs(updated - created) < 1000;
  const uaeLegacyBatchUpdate =
    created === Date.parse('2026-07-20T13:00:57.868Z') &&
    updated === Date.parse('2026-07-27T09:52:12.424Z') &&
    transfer.type === 'transfer' && transfer.status === 'confirmed' &&
    !transfer.toTeamId && transfer.toTeamName === '?';

  return unchangedSinceImport || uaeLegacyBatchUpdate;
}

export function transferEditorAnnouncementDate({
  transfer = null,
  today,
  autoResolvedFromNew = false,
} = {}) {
  if (autoResolvedFromNew && isInitialTransferImport(transfer)) return today;
  return transfer?.announcedAt || today;
}
