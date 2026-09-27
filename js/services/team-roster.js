// Una convocatoria en startlist no constituye una afiliación de temporada.
export function isSelectionTeam(team) {
  return team?.teamKind === 'selection'
    || team?.category === 'NTM'
    || team?.category === 'NTW';
}

export function canHaveTeamRoster(team) {
  return !!team && !team.specialEdition && !isSelectionTeam(team);
}
