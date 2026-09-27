import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(fileURLToPath(new URL('../panel.js', import.meta.url)), 'utf8');
const rosterMigration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260907183000_admin_historical_team_roster.sql', import.meta.url)), 'utf8');

describe('editor administrativo de temporadas de equipo', () => {
  it('edita en el formulario principal la identidad y el código UCI de la temporada seleccionada', () => {
    expect(panelSource).toContain('id="te-uciCode"');
    expect(panelSource).toContain('p_year: _editingTeamSeasonYear');
    expect(panelSource).toContain('p_season: seasonPayload');
    expect(panelSource).toContain('Los cambios solo afectan a esta temporada.');
    expect(panelSource).toContain('id="teamSeason27Panel" hidden');
    expect(panelSource).toContain('setupSeason27Panel();');
    expect(panelSource).toContain('_syncSeason27Visibility(teamId, isSpecialEdition);');
    expect(panelSource).toContain('panel.hidden = !show;');
  });

  it('lee las plantillas UCI históricas sin convertirlas en afiliaciones editables', () => {
    expect(panelSource).toContain("supabase.rpc('admin_get_team_roster'");
    expect(panelSource).toContain("a.readOnly === true");
    expect(panelSource).not.toContain('<span class="badge">Plantilla UCI</span>');
    expect(rosterMigration).toContain('private.historical_team_roster_observations');
    expect(rosterMigration).toContain("true as \"readOnly\"");
    expect(rosterMigration).not.toContain('insert into public.rider_team_affiliations');
  });
});
