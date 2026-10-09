import { describe, it, expect } from 'vitest';
import { automaticTeamHeaderText, splitStartlistTeams, teamHeaderColors, teamsForSeason } from '../team-appearance.js';

describe('apariencia de equipo', () => {
  it('sin pareja completa usa la superficie neutra', () => {
    expect(teamHeaderColors({headerBg:'#123456'})).toEqual({background:'var(--bg-card)',text:'var(--text)'});
  });
  it('resuelve automáticamente un texto legible para la cabecera del equipo', () => {
    expect(automaticTeamHeaderText('#111111')).toBe('#ffffff');
    expect(automaticTeamHeaderText('#fff')).toBe('#000000');
    expect(automaticTeamHeaderText('#e30613')).toBe('#ffffff');
    expect(automaticTeamHeaderText('red')).toBe('#ffffff');
  });
  it('materializa un equipo histórico aislado desde su versión de temporada', async () => {
    const query = {
      data: [{teamId:'hist',name:'Equipo 2021',category:'CT',badgeTorsoCenter:'#123456'}],
      select(){ return this; }, in(){ return this; }, eq(){ return this; },
    };
    const rows = await teamsForSeason({from:()=>query}, [], 2021, ['hist']);
    expect(rows).toEqual([expect.objectContaining({
      id:'hist', name:'Equipo 2021', category:'CT', badgeTorsoCenter:'#123456', badgeShorts:'#000000',
    })]);
  });
});

describe('splitStartlistTeams', () => {
  it('separa la startlist y aplica la temporada embebida como teamsForSeason', () => {
    const rows = [
      { id: 's1', teamId: 'uae', teamName: 'UAE', team: { id: 'uae', name: 'UAE Team Emirates', badgeShorts: '#000', team_seasons: [{ teamId: 'uae', name: 'UAE Team Emirates XRG', badgeShorts: null }] } },
      { id: 's2', teamId: 'uae', teamName: 'UAE B', team: { id: 'uae', name: 'UAE Team Emirates', badgeShorts: '#000', team_seasons: [] } },
      { id: 's3', teamId: null, teamName: 'Selección', team: null },
    ];
    const { startlistTeams, teams } = splitStartlistTeams(rows, 2026);
    expect(startlistTeams).toEqual([
      { id: 's1', teamId: 'uae', teamName: 'UAE' },
      { id: 's2', teamId: 'uae', teamName: 'UAE B' },
      { id: 's3', teamId: null, teamName: 'Selección' },
    ]);
    expect(teams).toEqual([{ id: 'uae', name: 'UAE Team Emirates XRG', badgeShorts: '#000' }]);
  });
});
