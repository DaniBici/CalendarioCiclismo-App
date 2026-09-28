import {cxDateInSeason} from './season.js?v=20260912cxmonths7';

// El catálogo EN conserva el SEO castellano, igual que las fichas CX.
export function cxTournamentDescription(tournament,races) {
  const name=tournament.name.trim();
  const subject=/^(el|la)\s/i.test(name)?name:
    `${/\b(copa|coupe|cup|taça|taca|serie|liga|challenge)\b/i.test(name)?'La':'El'} ${name}`;
  const own=[...new Map(races.filter(race=>
    (race.tournamentId||race.cx_tournaments?.id)===tournament.id&&
    cxDateInSeason(tournament.seasonKey,race.dateKey)
  ).map(race=>[race.id,race])).values()];
  const dates=own.flatMap(race=>[race.dateKey,race.endDateKey,
    ...(race.cx_race_categories||[]).map(category=>category.dateKey)])
    .filter(date=>cxDateInSeason(tournament.seasonKey,date)).sort();
  const dateLabel=date=>new Intl.DateTimeFormat('es-ES',{
    day:'numeric',month:'long',timeZone:'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const range=dates.length?` del ${dateLabel(dates[0])} al ${dateLabel(dates.at(-1))}`:'';
  return `${subject} abarca ${own.length} ${own.length===1?'prueba':'pruebas'}${range}. Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.`;
}
