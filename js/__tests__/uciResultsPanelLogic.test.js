import { describe, expect, it } from 'vitest';
import {
  filterStartlistRiderCandidates,
  isFinalStageRaceDay,
  nextResultRank,
  normalizeResultTimeInput,
  pairFinalClassifications,
  resultRiderDorsalText,
  resultRiderPickerInitialQuery,
  resolveResultLeaderName,
  riderMatchesSearch,
  riderSearchLookupToken,
  shouldMirrorFinalClassification,
  uniqueStartlistSurnameMatch,
} from '../uci-results-panel-logic.js';

const race = { raceFormat: 'stage_race' };
const days = [
  { id: 'e1', dateKey: '2026-08-20', stageNumber: 1 },
  { id: 'descanso', dateKey: '2026-08-21', stageNumber: null, isRestDay: true },
  { id: 'e2', dateKey: '2026-08-22', stageNumber: 2 },
];

describe('última jornada de una vuelta por etapas', () => {
  it('solo marca la última etapa disputable', () => {
    expect(isFinalStageRaceDay(days[0], race, days)).toBe(false);
    expect(isFinalStageRaceDay(days[2], race, days)).toBe(true);
  });

  it('excluye carreras de un día y jornadas canceladas', () => {
    expect(isFinalStageRaceDay(days[2], { raceFormat: 'one_day' }, days)).toBe(false);
    expect(isFinalStageRaceDay({ ...days[2], isCancelledDay: true }, race, days)).toBe(false);
  });

  it('en una doble jornada solo considera final el último sector', () => {
    const sectors = [
      { id: '3a', dateKey: '2026-08-22', stageNumber: 3, neutralStartTimeUtc: '2026-08-22T08:00:00Z' },
      { id: '3b', dateKey: '2026-08-22', stageNumber: 3, neutralStartTimeUtc: '2026-08-22T13:00:00Z' },
    ];
    expect(isFinalStageRaceDay(sectors[0], race, sectors)).toBe(false);
    expect(isFinalStageRaceDay(sectors[1], race, sectors)).toBe(true);
  });
});

describe('pseudo-clasificación final automática', () => {
  it('se genera para cualquier acumulada de la última etapa, pero no para Etapa', () => {
    expect(shouldMirrorFinalClassification({ classKind: 'points' }, true)).toBe(true);
    expect(shouldMirrorFinalClassification({ classKind: 'gc' }, true)).toBe(true);
    expect(shouldMirrorFinalClassification({ classKind: 'stage' }, true)).toBe(false);
    expect(shouldMirrorFinalClassification({ classKind: 'points' }, false)).toBe(false);
  });

  it('colapsa la cabecera de etapa y la pseudo-final en una sola fila del panel', () => {
    const mine = [
      { id: 'stage', classKind: 'stage' },
      { id: 'points-stage', classKind: 'points', lockedAt: null },
    ];
    const finals = [
      { id: 'points-final', eventId: -2, classKind: 'points', lockedAt: '2026-08-22T12:00:00Z' },
      { id: 'kom-final', eventId: -3, classKind: 'kom' },
    ];

    const paired = pairFinalClassifications(mine, finals, true);
    expect(paired.mine).toHaveLength(2);
    expect(paired.mine[1]).toMatchObject({
      id: 'points-stage',
      _isFinalRaceDay: true,
      _finalTwinId: 'points-final',
      _finalTwinEventId: -2,
    });
    expect(paired.finals.map((stage) => stage.id)).toEqual(['kom-final']);
  });
});

describe('autoasociación por apellido en resultados', () => {
  const riders = [
    { dorsal: 12, lastName: 'García Cortina', name: 'Iván García Cortina' },
    { dorsal: 31, lastName: 'Van Aert', name: 'Wout van Aert' },
    { dorsal: 47, lastName: 'Martínez', name: 'Daniel Martínez' },
    { dorsal: 91, lastName: 'Martinez', name: 'Lenny Martinez' },
    { dorsal: 126, firstName: 'Tim', lastName: 'van Dijke', name: 'Tim van Dijke' },
    { dorsal: 76, firstName: 'Marijn', lastName: 'van den Berg', name: 'Marijn van den Berg' },
    { dorsal: 214, firstName: 'Tomáš', lastName: 'Kopecký', name: 'Tomáš Kopecký' },
  ];

  it('reconoce apellidos completos sin distinguir mayúsculas ni tildes', () => {
    expect(uniqueStartlistSurnameMatch('  GARCIA CORTINA ', riders)?.dorsal).toBe(12);
    expect(uniqueStartlistSurnameMatch('van-aert', riders)?.dorsal).toBe(31);
  });

  it('reconoce nombres completos aunque la fuente invierta el orden o pierda diacríticos', () => {
    expect(uniqueStartlistSurnameMatch('VAN DIJKE Tim', riders)?.dorsal).toBe(126);
    expect(uniqueStartlistSurnameMatch('VAN DEN BERG Marijn', riders)?.dorsal).toBe(76);
    expect(uniqueStartlistSurnameMatch('KOPECKY Tomas', riders)?.dorsal).toBe(214);
  });

  it('no asocia coincidencias ambiguas ni parciales', () => {
    expect(uniqueStartlistSurnameMatch('Martínez', riders)).toBeNull();
    expect(uniqueStartlistSurnameMatch('García', riders)).toBeNull();
  });

  it('limita el selector manual a los inscritos y permite buscar por dorsal o nombre', () => {
    const candidates = filterStartlistRiderCandidates(riders, '31');
    expect(candidates.map(rider => rider.name)).toEqual(['Wout van Aert']);
    expect(filterStartlistRiderCandidates(riders, 'martinez').map(rider => rider.dorsal)).toEqual([47, 91]);
    expect(filterStartlistRiderCandidates(riders, 'Dijke Tim').map(rider => rider.dorsal)).toEqual([126]);
    expect(filterStartlistRiderCandidates(riders, 'Tomas Kopecky').map(rider => rider.dorsal)).toEqual([214]);
    expect(riderMatchesSearch(riders.at(-1), 'Kopeck')).toBe(true);
    expect(riderSearchLookupToken('Marijn van den Berg')).toBe('marijn');
    expect(riderSearchLookupToken('John Smith')).toBe('smith');
  });

  it('precarga el nombre completo en el selector de la startlist', () => {
    expect(resultRiderPickerInitialQuery('van den berg', true)).toBe('van den berg');
    expect(resultRiderPickerInitialQuery('Tim van Dijke', true)).toBe('Tim van Dijke');
    expect(resultRiderPickerInitialQuery('Tomáš Kopecký', true)).toBe('Tomáš Kopecký');
    expect(resultRiderPickerInitialQuery('Tomáš Kopecký', false)).toBe('Kopecký');
  });

  it('convierte el dorsal numérico a texto antes de renderizarlo', () => {
    expect(resultRiderDorsalText(76)).toBe('76');
    expect(resultRiderDorsalText(null)).toBe('—');
  });
});

describe('puesto de una fila nueva de resultados', () => {
  it('empieza en 1 y suma uno al puesto de la fila anterior', () => {
    expect(nextResultRank([])).toBe(1);
    expect(nextResultRank(['1'])).toBe(2);
    expect(nextResultRank(['1', '17'])).toBe(18);
  });
});

describe('atajos de diferencias de tiempo', () => {
  it('convierte segundos y minuto.segundos al formato de gap', () => {
    expect(normalizeResultTimeInput('00')).toBe('+0:00');
    expect(normalizeResultTimeInput('33')).toBe('+0:33');
    expect(normalizeResultTimeInput('1.18')).toBe('+1:18');
    expect(normalizeResultTimeInput('1.2')).toBe('+1:02');
    expect(normalizeResultTimeInput('4.18.18', 1)).toBe('4:18:18');
    expect(normalizeResultTimeInput('4.18.18', 2)).toBe('+4:18:18');
    expect(normalizeResultTimeInput('4.8.8', 64)).toBe('+4:08:08');
  });

  it('conserva tiempos completos y entradas fuera de rango', () => {
    expect(normalizeResultTimeInput('+0:14')).toBe('+0:14');
    expect(normalizeResultTimeInput('4:23:12')).toBe('4:23:12');
    expect(normalizeResultTimeInput('78')).toBe('78');
    expect(normalizeResultTimeInput('1.78')).toBe('1.78');
    expect(normalizeResultTimeInput('4.78.18')).toBe('4.78.18');
  });
});

describe('líder visible de una clasificación', () => {
  const riderByBib = {
    21: { name: 'Milan Fretin', teamDisplay: 'Cofidis' },
  };
  const riderByGid = {
    rider_7: { name: 'Arnaud De Lie', teamDisplay: 'Lotto Intermarché' },
  };

  it('prioriza el corredor canónico resuelto por dorsal sobre el nombre crudo', () => {
    const name = resolveResultLeaderName(
      { classKind: 'stage', winnerName: null },
      [{ bib: '21', riderDisplay: 'FRETIN Milan' }],
      riderByBib,
      riderByGid,
    );
    expect(name).toBe('Milan Fretin');
  });

  it('usa globalRiderId cuando no hay dorsal casable e ignora abandonos espurios', () => {
    const name = resolveResultLeaderName(
      { classKind: 'gc', winnerName: 'Nombre fuente' },
      [
        { bib: '99', riderDisplay: 'DNS', irm: 'DNS' },
        { globalRiderId: 'rider_7', riderDisplay: 'DE LIE Arnaud' },
      ],
      riderByBib,
      riderByGid,
    );
    expect(name).toBe('Arnaud De Lie');
  });

  it('muestra el equipo en la clasificación por equipos', () => {
    const name = resolveResultLeaderName(
      { classKind: 'teams', winnerName: null },
      [{ bib: 21, riderDisplay: 'Milan Fretin' }],
      riderByBib,
      riderByGid,
    );
    expect(name).toBe('Cofidis');
  });
});
