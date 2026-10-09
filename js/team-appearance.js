import { hasCustomTeamBadgeColors } from './team-badge.js';
// Fondo y texto son una pareja editorial. Nunca se derivan del torso de una chapa.
const color = value => typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim()) ? value.trim() : null;

// El editor solo pide el fondo de la pestaña/cabecera. El color del texto se
// resuelve entre blanco y negro según cuál produzca mayor contraste WCAG.
export function automaticTeamHeaderText(background) {
  const value = color(background);
  if (!value) return '#ffffff';
  const short = value.length === 4;
  const channels = short
    ? [...value.slice(1)].map(component => parseInt(component + component, 16))
    : [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map(component => parseInt(component, 16));
  const linear = channels.map(component => {
    const srgb = component / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast > whiteContrast ? '#000000' : '#ffffff';
}

export function teamHeaderColors(team) {
  const background = color(team?.headerBg), text = color(team?.headerText);
  return background && text ? { background, text } : { background: 'var(--bg-card)', text: 'var(--text)' };
}

const TEAM_COLUMNS = 'id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle';
const TEAM_SEASON_COLUMNS = 'teamId,name,category,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts';

// Superpone a cada equipo los valores no nulos de su temporada, en el orden de
// `ids`. Un equipo sin ficha base solo aparece si la temporada trae nombre.
function mergeTeamSeasons(teams, seasonRows, ids) {
  const seasons=new Map((seasonRows || []).map(row=>[row.teamId,row]));
  const baseById = new Map(teams.map(team => [team.id, team]));
  return ids.map(id => {
    const base = baseById.get(id), season = seasons.get(id);
    if (!base && !season?.name) return null;
    const fallback = base || {
      id,
      name: season.name,
      category: season.category || null,
      nameAliases: null,
      headerBg: '#1f2937',
      headerText: '#ffffff',
      badgeTorsoCenter: '#ffffff',
      badgeTorsoSides: '#000000',
      badgeInnerCircle: null,
      badgeShorts: '#000000',
    };
    return {...fallback,...Object.fromEntries(Object.entries(season || {}).filter(([key,value])=>key!=='teamId' && value!=null))};
  }).filter(Boolean);
}

export async function teamsForSeason(client, teams, year, requestedIds = teams.map(team => team.id)) {
  const ids = [...new Set(requestedIds.filter(Boolean))];
  if (!ids.length || !year) return teams;
  const {data,error}=await client.from('team_seasons').select(TEAM_SEASON_COLUMNS).in('teamId',ids).eq('year',year);
  if (error) throw error;
  return mergeTeamSeasons(teams, data, ids);
}

// startlist_teams de una carrera con el equipo canónico y su temporada
// embebidos: una consulta en lugar de tres en serie.
export function startlistTeamsQuery(client, raceId, year, columns = 'id,teamId,teamName') {
  const seasons = year ? `,team_seasons(${TEAM_SEASON_COLUMNS})` : '';
  const query = client.from('startlist_teams').select(`${columns},team:teams(${TEAM_COLUMNS}${seasons})`).eq('raceId', raceId);
  return year ? query.eq('team.team_seasons.year', year) : query;
}

// Separa la respuesta de startlistTeamsQuery: filas de startlist sin el
// embebido y equipos de la temporada (mismo resultado que teamsForSeason).
export function splitStartlistTeams(rows, year) {
  const startlistTeams = [], teams = [], seasons = [], seen = new Set();
  for (const { team, ...row } of rows || []) {
    startlistTeams.push(row);
    if (!team || seen.has(team.id)) continue;
    seen.add(team.id);
    const { team_seasons: teamSeasons, ...base } = team;
    teams.push(base);
    seasons.push(...(teamSeasons || []));
  }
  const ids = [...new Set(startlistTeams.map(row => row.teamId).filter(Boolean))];
  return { startlistTeams, teams: year && ids.length ? mergeTeamSeasons(teams, seasons, ids) : teams };
}

export function teamStripes(team) {
  if (!hasCustomTeamBadgeColors(team)) return '';
  const values = [team?.badgeTorsoSides, team?.badgeTorsoCenter, team?.badgeShorts].map(color);
  // Las filas sin equipación curada usan valores neutros por defecto.
  if (values.some(v => !v)) return '';
  return `<span class="team-stripes" aria-hidden="true">${values.map(value => `<i style="background:${value}"></i>`).join('')}</span>`;
}
