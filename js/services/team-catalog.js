function isHistoricalCatalogTeam(team) {
  return team?.historicalCatalogOnly === true;
}

export function activeCatalogTeams(teams) {
  return (teams || []).filter(team => !isHistoricalCatalogTeam(team));
}

export function teamsForSeasonList(teams, seasons) {
  const matrixById = new Map((teams || []).map(team => [team.id, team]));
  return (seasons || []).flatMap(season => {
    const matrix = matrixById.get(season?.teamId);
    if (!matrix || matrix.specialEdition) return [];
    return [{
      ...matrix,
      ...season,
      id: matrix.id,
      teamId: matrix.id,
      seasonYear: Number(season.year),
      matrixName: matrix.name,
      specialEdition: false,
      historicalCatalogOnly: matrix.historicalCatalogOnly === true,
    }];
  });
}

export function teamSeasonRange(years) {
  const normalized = [...new Set((years || []).map(Number).filter(Number.isInteger))]
    .sort((a, b) => a - b);
  if (!normalized.length) return '';
  if (normalized.length === 1) return String(normalized[0]);
  return `${normalized[0]}–${normalized[normalized.length - 1]}`;
}

export function teamListYearOptions(years, { currentYear, marketYear, minYear = 2020 } = {}) {
  const latestYear = Math.max(Number(currentYear), Number(marketYear));
  const operationalYears = Number.isInteger(latestYear) && latestYear >= minYear
    ? Array.from({ length: latestYear - minYear + 1 }, (_, index) => latestYear - index)
    : [];
  return [...new Set([...(years || []), ...operationalYears]
    .map(Number)
    .filter(year => Number.isInteger(year) && year >= minYear && year <= 2100))]
    .sort((a, b) => b - a);
}

export function teamGenderLabel(gender) {
  if (gender === 'female') return 'Femenino';
  if (gender === 'male') return 'Masculino';
  return 'Sexo sin indicar';
}
