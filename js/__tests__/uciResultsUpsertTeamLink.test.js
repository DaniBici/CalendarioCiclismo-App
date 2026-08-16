import { describe, expect, it } from 'vitest';
import { linkTeamResultRowsSql } from '../../scripts/results-fetchers/uci-results-upsert.mjs';

// Las fuentes no dan el nombre del equipo a secas, sino envuelto en el código UCI
// y el país: "NDT - NSN DEVELOPMENT TEAM (SUI)". El matcher comparaba en crudo
// contra teams.name/nameAliases, así que no casaba NINGUNA fila y todas las
// clasificaciones por equipos se quedaban con teamId NULL.
describe('enlace de clasificaciones por equipos', () => {
  const sql = linkTeamResultRowsSql('race_x');

  it('acota el update a la carrera y a las clasificaciones por equipos', () => {
    expect(sql).toContain("r.\"raceId\" = 'race_x'");
    expect(sql).toContain("st.\"raceId\" = 'race_x'");
    expect(sql).toContain("s.\"classKind\" = 'teams'");
  });

  it('despieza el código UCI y el país que envuelven al nombre', () => {
    // Solo el envoltorio "NDT - Nombre" lleva espacios; no eliminar prefijos
    // reales de equipos como "HINO-ONE" o "PIO-RICO".
    expect(sql).toContain("'^\\s*[A-Z0-9]{2,4}\\s+-\\s+'");
    expect(sql).toContain("'\\s*\\([A-Za-z]{3}\\)\\s*$'");
  });

  it('pliega acentos y puntuación como la startlist, para absorber variantes de fuente', () => {
    // "PIO RICO" (fuente) vs "Pío Rico Cycling Team" (ficha).
    expect(sql).toContain('public.fold_team_name');
  });

  it('prefiere el acierto exacto antes de recortar sufijos genéricos', () => {
    // "UAE Development Team" y "UAE Development" son fichas distintas: si se
    // recortase el sufijo primero, la general de una acabaría en la otra.
    expect(sql).toContain('exact_hit DESC');
    expect(sql).toContain("'(cyclingteam|team)$'");
  });

  it('no pisa un enlace ya correcto ni deja que un empate elija al azar', () => {
    expect(sql).toContain('AND m.rn = 1');
    expect(sql).toContain('r."teamId" IS DISTINCT FROM m."teamId"');
  });

  it('escapa el identificador de carrera que llega por parámetro', () => {
    expect(linkTeamResultRowsSql("o'brien")).toContain("'o''brien'");
  });
});
