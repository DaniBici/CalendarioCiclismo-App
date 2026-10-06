import {cxDateInSeason} from './season.js';

// Paridad con cx_tournament_description de tools/site/gen_og_pages.py.
export function cxTournamentDescription(tournament,races,lang='es') {
  const name=tournament.name.trim();
  const own=[...new Map(races.filter(race=>
    (race.tournamentId||race.cx_tournaments?.id)===tournament.id&&
    cxDateInSeason(tournament.seasonKey,race.dateKey)
  ).map(race=>[race.id,race])).values()];
  const dates=own.flatMap(race=>[race.dateKey,race.endDateKey,
    ...(race.cx_race_categories||[]).map(category=>category.dateKey)])
    .filter(date=>cxDateInSeason(tournament.seasonKey,date)).sort();
  if(lang==='en'){
    const nameEn=(tournament.nameEn||name).trim();
    const subject=/^the\s/i.test(nameEn)?nameEn:`The ${nameEn}`;
    const label=date=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',timeZone:'UTC'})
      .format(new Date(`${date}T12:00:00Z`));
    const range=dates.length?` from ${label(dates[0])} to ${label(dates.at(-1))}`:'';
    return `${subject} comprises ${own.length} ${own.length===1?'round':'rounds'}${range}. See dates, schedules, results and how to watch on TV and online streaming.`;
  }
  const subject=/^(el|la)\s/i.test(name)?name:
    `${/\b(copa|coupe|cup|taça|taca|serie|liga|challenge)\b/i.test(name)?'La':'El'} ${name}`;
  const dateLabel=date=>new Intl.DateTimeFormat('es-ES',{
    day:'numeric',month:'long',timeZone:'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const range=dates.length?` del ${dateLabel(dates[0])} al ${dateLabel(dates.at(-1))}`:'';
  return `${subject} abarca ${own.length} ${own.length===1?'prueba':'pruebas'}${range}. Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.`;
}
