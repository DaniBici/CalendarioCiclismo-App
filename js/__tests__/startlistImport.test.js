import { describe, expect, it } from 'vitest';
import {
  parseStartlistImportDocument,
  selectUpcomingStartlistRaces,
  uniqueExistingRiderMatchId,
  validateStartlistImportTarget,
} from '../startlist-import.js';

describe('importación mínima de inscritos en el panel', () => {
  it('acepta el contrato v1 sin país ni decisiones de identidad', () => {
    const imported = parseStartlistImportDocument({
      raceId: 'vuelta-2026',
      expectedRiderCount: 2,
      teams: [{
        teamName: ' Equipo Uno ',
        riders: [
          { dorsal: '1', riderName: 'Ana García López' },
          { dorsal: '2', riderName: 'Van Aert, Wout' },
        ],
      }],
    });

    expect(imported).toMatchObject({ ok: true, raceId: 'vuelta-2026', summary: { teams: 1, riders: 2 } });
    expect(imported.teams[0]).toEqual({
      name: 'Equipo Uno',
      riders: [
        { dorsal: '1', firstName: 'Ana', lastName: 'García López' },
        { dorsal: '2', firstName: 'Wout', lastName: 'Van Aert' },
      ],
    });
  });

  it('admite los aliases anteriores y nunca devuelve identificadores globales', () => {
    const imported = parseStartlistImportDocument({
      teams: [{ name: 'Equipo Uno', riders: [{ dorsal: '11', firstName: 'Marta', lastName: 'Cavalli' }] }],
    });

    expect(imported.ok).toBe(true);
    expect(imported.teams[0].riders[0]).toEqual({ dorsal: '11', firstName: 'Marta', lastName: 'Cavalli' });
  });

  it('rechaza dorsales inválidos, duplicados y recuentos que no coinciden', () => {
    const imported = parseStartlistImportDocument({
      expectedRiderCount: 4,
      teams: [{ teamName: 'Equipo Uno', riders: [
        { dorsal: '01', riderName: 'Corredor Uno' },
        { dorsal: '1', riderName: 'Corredor Dos' },
        { dorsal: '1', riderName: 'Corredor Tres' },
      ] }],
    });

    expect(imported.ok).toBe(false);
    expect(imported.errors.map(error => error.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('sin ceros'),
      expect.stringContaining('duplicado'),
      expect.stringContaining('Declara 4'),
    ]));
  });

  it('solo acepta el enlace automático si la RPC devuelve una coincidencia única', () => {
    expect(uniqueExistingRiderMatchId({ match_count: 1, matched_id: 'ana-garcia' })).toBe('ana-garcia');
    expect(uniqueExistingRiderMatchId({ match_count: 0, matched_id: null })).toBeNull();
    expect(uniqueExistingRiderMatchId({ match_count: 2, matched_id: 'no-debe-usarse' })).toBeNull();
  });

  it('exige una carrera de destino y bloquea un raceId distinto', () => {
    expect(validateStartlistImportTarget('', 'vuelta-2026')).toMatchObject({ ok: false });
    expect(validateStartlistImportTarget('giro-2026', 'vuelta-2026')).toEqual({
      ok: false,
      error: 'El JSON corresponde a vuelta-2026, no a la carrera seleccionada.',
    });
    expect(validateStartlistImportTarget('vuelta-2026', 'vuelta-2026')).toEqual({
      ok: true,
      raceId: 'vuelta-2026',
    });
    expect(validateStartlistImportTarget('vuelta-2026', null)).toEqual({
      ok: true,
      raceId: 'vuelta-2026',
    });
  });

  it('ofrece desde hoy y ordena las carreras por fecha de inicio ascendente', () => {
    const races = [
      { id: 'sin-fecha', name: 'Sin fecha' },
      { id: 'ayer', name: 'Ayer', startDate: '2026-08-21' },
      { id: 'pasado-b', name: 'B', startDate: '2026-08-24' },
      { id: 'hoy', name: 'Hoy', startDate: '2026-08-22' },
      { id: 'manana', name: 'Mañana', startDate: '2026-08-23' },
      { id: 'pasado-a', name: 'A', startDate: '2026-08-24' },
    ];

    expect(selectUpcomingStartlistRaces(races, '2026-08-22').map(race => race.id)).toEqual([
      'hoy',
      'manana',
      'pasado-a',
      'pasado-b',
    ]);
  });
});
