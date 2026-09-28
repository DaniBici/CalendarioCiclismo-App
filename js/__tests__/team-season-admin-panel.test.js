import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const teamsSource = readFileSync(fileURLToPath(new URL('../panel/teams.js', import.meta.url)), 'utf8');
const rosterSource = readFileSync(fileURLToPath(new URL('../panel/team-roster.js', import.meta.url)), 'utf8');
const rosterMigration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260907183000_admin_historical_team_roster.sql', import.meta.url)), 'utf8');

describe('editor administrativo de temporadas de equipo', () => {
  it('edita en el formulario principal la identidad y el código UCI de la temporada seleccionada', () => {
    expect(teamsSource).toContain('id="te-uciCode"');
    expect(teamsSource).toContain('p_year: panelState._editingTeamSeasonYear');
    expect(teamsSource).toContain('p_season: seasonPayload');
    expect(teamsSource).toContain('Los cambios solo afectan a esta temporada.');
    expect(teamsSource).toContain('id="teamSeason27Panel" hidden');
    expect(teamsSource).toContain('setupSeason27Panel();');
    expect(teamsSource).toContain('_syncSeason27Visibility(teamId, isSpecialEdition);');
    expect(rosterSource).toContain('panel.hidden = !show;');
  });

  it('lee las plantillas UCI históricas sin convertirlas en afiliaciones editables', () => {
    expect(rosterSource).toContain("supabase.rpc('admin_get_team_roster'");
    expect(rosterSource).toContain("a.readOnly === true");
    expect(rosterSource).not.toContain('<span class="badge">Plantilla UCI</span>');
    expect(rosterMigration).toContain('private.historical_team_roster_observations');
    expect(rosterMigration).toContain("true as \"readOnly\"");
    expect(rosterMigration).not.toContain('insert into public.rider_team_affiliations');
  });
});
