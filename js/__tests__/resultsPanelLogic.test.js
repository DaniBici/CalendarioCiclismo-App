import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  applyPersistedResultSyncDayState,
  filterStartlistRiderCandidates,
  findResultClassificationDuplicate,
  hasResultSyncDayOverride,
  isFinalStageRaceDay,
  nextResultRank,
  normalizeResultTimeInput,
  pairFinalClassifications,
  resultClassificationBelongsToDay,
  resultClassificationOfficialState,
  resultRiderDorsalText,
  resultRiderPickerInitialQuery,
  resultSyncDefaultScope,
  resultSyncScopeOptionsVisible,
  resolveResultLeaderName,
  riderMatchesSearch,
  riderSearchLookupToken,
  shouldMirrorFinalClassification,
  uniquePartialSurnameMatch,
  uniqueStartlistSurnameMatch,
} from '../results-panel-logic.js';

describe('clasificaciones manuales por jornada y sector', () => {
  const sectors = [
    { id: '1a', raceId: 'flanders', stageNumber: 1 },
    { id: '1b', raceId: 'flanders', stageNumber: 1 },
  ];
  const stageA = {
    id: 'stage-a', raceId: 'flanders', raceDayId: '1a', stageNumber: 1,
    classKind: 'stage', scope: 'stage', isFinalClassification: false,
  };
  const request = { kind: 'stage', scope: 'stage', isFinal: false };

  it('permite crear 1B aunque 1A ya tenga esa clasificación', () => {
    expect(findResultClassificationDuplicate([stageA], sectors[1], request, sectors)).toBeUndefined();
    expect(resultClassificationBelongsToDay(stageA, sectors[1], sectors)).toBe(false);
  });

  it('impide duplicar una clasificación del mismo sector', () => {
    expect(findResultClassificationDuplicate([stageA], sectors[0], request, sectors)).toBe(stageA);
    const stageB = { ...stageA, id: 'stage-b', raceDayId: '1b' };
    expect(findResultClassificationDuplicate([stageA, stageB], sectors[1], request, sectors)).toBe(stageB);
  });

  it('no atribuye una cabecera sin jornada a ambos sectores', () => {
    const legacy = { ...stageA, raceDayId: null };
    for (const rd of sectors) {
      expect(resultClassificationBelongsToDay(legacy, rd, sectors)).toBe(false);
      expect(findResultClassificationDuplicate([legacy], rd, request, sectors)).toBeUndefined();
    }
  });

  it('mantiene el fallback legado cuando el número identifica una sola jornada', () => {
    const legacy = { ...stageA, raceDayId: null };
    expect(resultClassificationBelongsToDay(legacy, sectors[0], [sectors[0]])).toBe(true);
    expect(findResultClassificationDuplicate([legacy], sectors[0], request, [sectors[0]])).toBe(legacy);
    expect(resultClassificationBelongsToDay(legacy, sectors[0], [])).toBe(false);
  });

  it('mantiene separados los tipos, los scopes y las carreras', () => {
    expect(findResultClassificationDuplicate([stageA], sectors[0], { ...request, kind: 'gc' }, sectors)).toBeUndefined();
    expect(findResultClassificationDuplicate([stageA], sectors[0], { ...request, scope: 'overall' }, sectors)).toBeUndefined();
    expect(findResultClassificationDuplicate([{ ...stageA, raceId: 'otra' }], sectors[0], request, sectors)).toBeUndefined();
  });

  it('detecta las finales a nivel de carrera, independientemente del sector', () => {
    const final = { ...stageA, raceDayId: null, stageNumber: null, classKind: 'gc', isFinalClassification: true };
    const finalRequest = { ...request, kind: 'gc', isFinal: true };
    for (const rd of sectors) {
      expect(findResultClassificationDuplicate([final], rd, finalRequest, sectors)).toBe(final);
    }
    expect(findResultClassificationDuplicate([stageA], sectors[0], finalRequest, sectors)).toBeUndefined();
  });

  it('reconoce el prólogo y una clasificación de prueba ligada a su jornada', () => {
    for (const stageNumber of [0, null]) {
      const day = { id: 'day', raceId: 'race', stageNumber };
      const stage = { ...stageA, raceId: 'race', raceDayId: day.id, stageNumber };
      expect(findResultClassificationDuplicate([stage], day, request, [day])).toBe(stage);
    }
  });

  it('el alta del panel crea dos sectores con identificadores distintos sin escribir en Supabase', async () => {
    const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
    const createSource = source.slice(source.indexOf('function _ruFnv1a('), source.indexOf('async function _ruMirrorFinalClassification('));
    const inserted = [];
    const createClass = runInNewContext(`${createSource}\n_ruCreateClass`, {
      findResultClassificationDuplicate,
      UCI_CLASS_LABELS: { stage: 'Etapa' },
      supabase: {
        from(table) {
          expect(table).toBe('race_uci_stages');
          return {
            insert(row) {
              inserted.push(row);
              return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
            },
          };
        },
      },
    });
    const race = { raceFormat: 'stage_race' };
    const a = await createClass(sectors[0], race, [], 'stage', false, sectors);
    const b = await createClass(sectors[1], race, [a], 'stage', false, sectors);
    expect(a.raceDayId).toBe('1a');
    expect(b.raceDayId).toBe('1b');
    expect(a.stageNumber).toBe(b.stageNumber);
    expect(a.id).not.toBe(b.id);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventId).toBeLessThan(0);
    expect(b.eventId).toBeLessThan(0);
    await expect(createClass(sectors[1], race, [a, b], 'stage', false, sectors))
      .rejects.toThrow('Ya existe una clasificación');
    expect(inserted).toHaveLength(2);
  });
});

describe('programación automática de resultados', () => {
  it('reconoce una excepción por sus horas exactas, sin booleano de activación', () => {
    expect(hasResultSyncDayOverride({ resultsSyncStartAt: '2026-08-30T15:00:00Z' })).toBe(true);
    expect(hasResultSyncDayOverride({ resultsSyncStopAt: '2026-08-30T18:00:00Z' })).toBe(true);
    expect(hasResultSyncDayOverride({ resultsSyncStartOffsetMinutes: -15 })).toBe(true);
    expect(hasResultSyncDayOverride({ unrelated: false })).toBe(false);
  });

  it('selecciona por defecto la etapa consultada', () => {
    expect(resultSyncDefaultScope({ stageNumber: 2 })).toBe('day');
    expect(resultSyncDefaultScope({ stageNumber: 0 })).toBe('day');
    expect(resultSyncDefaultScope({ stageNumber: null })).toBe('race');
    expect(resultSyncDefaultScope({
      stageNumber: null,
      resultsSyncStartAt: '2026-08-30T15:00:00Z',
    })).toBe('day');
  });

  it('solo ofrece elegir alcance en vueltas por etapas', () => {
    expect(resultSyncScopeOptionsVisible({ raceFormat: 'stage_race' })).toBe(true);
    expect(resultSyncScopeOptionsVisible({ raceFormat: 'one_day' })).toBe(false);
  });

  it('muestra la ventana siempre abierta y sin control de activación', () => {
    const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
    expect(source).toContain('Horario de volcado automático');
    expect(source).not.toContain('<details class="ru-sync-policy"');
    expect(source).not.toContain('id="ru-sync-enabled"');
  });

  it('incorpora al estado visible la ventana confirmada por Postgres', () => {
    const rd = {
      resultsSyncStartAt: '2026-09-02T13:40:00Z',
      resultsSyncStopAt: '2026-09-02T17:17:00Z',
      resultsSyncStartOffsetMinutes: -15,
      unrelated: 'se conserva',
    };
    applyPersistedResultSyncDayState(rd, {
      resultsSyncStartAt: '2026-09-02T13:30:00Z',
      resultsSyncStopAt: '2026-09-02T17:17:00Z',
      resultsSyncStartOffsetMinutes: null,
      resultsSyncIntervalMinutes: null,
      resultsSyncStopOffsetMinutes: null,
    });
    expect(rd).toEqual({
      resultsSyncStartAt: '2026-09-02T13:30:00Z',
      resultsSyncStopAt: '2026-09-02T17:17:00Z',
      resultsSyncStartOffsetMinutes: null,
      resultsSyncIntervalMinutes: null,
      resultsSyncStopOffsetMinutes: null,
      unrelated: 'se conserva',
    });
  });
});

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

  it('arrstra el estado de publicación de la gemela para el interruptor de oficialidad', () => {
    const mine = [
      { id: 'stage', classKind: 'stage' },
      { id: 'points-stage', classKind: 'points', officialAt: null, publicationStatus: 'provisional' },
    ];
    const finals = [
      { id: 'points-final', classKind: 'points', officialAt: '2026-08-22T12:00:00Z', publicationStatus: 'official' },
    ];

    const paired = pairFinalClassifications(mine, finals, true);
    expect(paired.mine[1]).toMatchObject({
      _finalTwinOfficialAt: '2026-08-22T12:00:00Z',
      _finalTwinPublicationStatus: 'official',
    });
  });
});

describe('estado de oficialidad de una clasificación', () => {
  it('reconoce la oficialidad declarada por la fuente y la manual', () => {
    expect(resultClassificationOfficialState({ publicationStatus: 'provisional', officialAt: null }))
      .toEqual({ official: false, partial: false, pinned: false });
    expect(resultClassificationOfficialState({ publicationStatus: 'official', officialAt: null }))
      .toEqual({ official: true, partial: false, pinned: false });
    expect(resultClassificationOfficialState({ publicationStatus: 'official', officialAt: '2026-09-15T10:00:00Z' }))
      .toEqual({ official: true, partial: false, pinned: true });
    // Ancla sin estado aún recalculado también cuenta como oficial.
    expect(resultClassificationOfficialState({ publicationStatus: 'provisional', officialAt: '2026-09-15T10:00:00Z' }))
      .toEqual({ official: true, partial: false, pinned: true });
  });

  it('solo da por oficial un par etapa+final cuando ambas cabeceras lo son', () => {
    const base = {
      _finalTwinId: 'final',
      _finalTwinOfficialAt: null,
      _finalTwinPublicationStatus: 'provisional',
    };
    expect(resultClassificationOfficialState({ ...base, publicationStatus: 'official', officialAt: null }))
      .toEqual({ official: false, partial: true, pinned: false });
    expect(resultClassificationOfficialState({
      ...base,
      publicationStatus: 'official',
      officialAt: '2026-09-15T10:00:00Z',
      _finalTwinPublicationStatus: 'official',
    })).toEqual({ official: true, partial: false, pinned: true });
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

  it('permite un apellido parcial cuando sigue siendo único en la plantilla', () => {
    const roster = [
      { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court-Pienaar' },
      { id: 'julie-martin', firstName: 'Julie', lastName: 'Martin' },
    ];
    expect(uniquePartialSurnameMatch('le', '', roster)?.id).toBe('kim-le-court');
    expect(uniquePartialSurnameMatch('le court', '', roster)?.id).toBe('kim-le-court');
    expect(uniquePartialSurnameMatch('le court-pienaar', '', roster)?.id).toBe('kim-le-court');
  });

  it('usa el nombre para desambiguar apellidos parciales repetidos', () => {
    const roster = [
      { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court-Pienaar' },
      { id: 'ann-le-roux', firstName: 'Ann', lastName: 'Le Roux' },
    ];
    expect(uniquePartialSurnameMatch('le', '', roster)).toBeNull();
    expect(uniquePartialSurnameMatch('le', 'Kim', roster)?.id).toBe('kim-le-court');
  });

  it('asocia por nombre sin apellido y conserva la ambigüedad dentro del equipo', () => {
    const roster = [
      { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court-Pienaar' },
      { id: 'julie-martin', firstName: 'Julie', lastName: 'Martin' },
      { id: 'julie-le-roux', firstName: 'Julie', lastName: 'Le Roux' },
    ];
    expect(uniquePartialSurnameMatch('', 'KIM', roster)?.id).toBe('kim-le-court');
    expect(uniquePartialSurnameMatch('', 'Julie', roster)).toBeNull();
    expect(uniquePartialSurnameMatch('Martin', 'Julie', roster)?.id).toBe('julie-martin');
    expect(uniquePartialSurnameMatch('Le Court', 'Julie', roster)).toBeNull();
    expect(uniquePartialSurnameMatch('', '', roster)).toBeNull();
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

  it.each(['DF', 'NR'])('%s no determina ganador sin ser un abandono', (irm) => {
    const name = resolveResultLeaderName(
      { classKind: 'stage', winnerName: 'Ganador anterior' },
      [{ globalRiderId: 'rider_7', irm }],
      riderByBib,
      riderByGid,
    );
    expect(name).toBe('');
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
