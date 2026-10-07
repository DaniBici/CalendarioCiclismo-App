import { describe, it, expect } from 'vitest';
import { automaticTeamHeaderText, teamHeaderColors, teamsForSeason } from '../team-appearance.js';

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
