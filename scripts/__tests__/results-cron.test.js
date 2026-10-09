import { describe, it, expect } from 'vitest';
import {
  isProtectedInvalidRaceDeletion,
  isFinalStageDump,
  manual_timingFetchArgs,
  raceresultFetchArgs,
  shouldResolveBibsByName,
  shouldSeedStartlist,
  stageFetchArgs,
  stageFilterArgs,
} from '../results-fetchers/results-cron.mjs';

// REGRESIÓN (2026-08-07, Tour of Kahramanmaraş 2026, comp 77813).
//
// DataRide publica las clasificaciones finales de una vuelta en una `race` APARTE
// llamada "Final Classification", con stageNumber NULL — no colgando de la última
// etapa. Volcar la última etapa exige por tanto DOS cosas a la vez:
//   1. que el FETCH lea la competición entera (sin `--stage N`, que la dejaría fuera), y
//   2. que el UPSERT reciba `--include-final` (o el filtro `--only-stage N` la tiraría).
//
// La condición original era `!ONE_RACE && targetStage === totalStages`. Como --stage
// solo existe junto a --race-id (ONE_STAGE se define únicamente si hay ONE_RACE), ese
// `!ONE_RACE` hacía la rama INALCANZABLE en el único camino que llega con targetStage
// != null: el "Volcar esta etapa" del panel sobre la última etapa se dejaba la general
// final sin volcar y SIN avisar. En Kahramanmaraş se perdieron las cuatro (general,
// puntos, montaña, jóvenes) hasta que se volcó a mano.
describe('stageFetchArgs — etapas que lee el fetcher', () => {
  it('la última etapa se lee completa salvo en ASO, LAPCLIP, Kyushu y AT Results', () => {
    expect(stageFetchArgs('uci', 8, true, 8)).toEqual([]);
    expect(stageFetchArgs('ASO', 21, true, 21)).toEqual(['--stage', '21']);
    expect(stageFetchArgs('lapclip', 3, true, 3)).toEqual(['--stage', '3']);
    expect(stageFetchArgs('lapclip', null, false, null)).toEqual([]);
    expect(stageFetchArgs('kyushu', 3, true, 3)).toEqual(['--stage', '3']);
    expect(stageFetchArgs('uci', 3, false, 8)).toEqual(['--stage', '3']);
  });

  it('AT Results lee solo el dossier de la última etapa, que contiene la final', () => {
    // Le Tour de Langkawi 2026: la lectura completa fallaba en el dossier de la etapa 2.
    expect(stageFetchArgs('atresults', 8, true, 8)).toEqual(['--stage', '8']);
    expect(stageFetchArgs('atresults', 5, true, 8)).toEqual(['--stage', '8']);
    expect(stageFetchArgs('atresults', 5, false, 8)).toEqual(['--stage', '5']);
    expect(stageFetchArgs('atresults', null, true, null)).toEqual([]);
  });
});

describe('isFinalStageDump — la general final entra también en el volcado manual', () => {
  it('la última etapa dispara la lectura completa aunque el disparo sea manual', () => {
    // El caso exacto de Kahramanmaraş: 4 etapas, "Volcar esta etapa" sobre la 4.
    expect(isFinalStageDump(4, 4)).toBe(true);
  });

  it('una etapa intermedia NO arrastra la general final', () => {
    expect(isFinalStageDump(3, 4)).toBe(false);
    expect(isFinalStageDump(1, 4)).toBe(false);
  });

  it('needsFinal manda por sí solo (la query --configured ya decidió)', () => {
    // La final pendiente puede publicarse DESPUÉS de la última etapa: needsFinal la
    // recupera aunque targetStage no sea la última, o aunque no haya targetStage.
    expect(isFinalStageDump(2, 4, true)).toBe(true);
    expect(isFinalStageDump(null, null, true)).toBe(true);
  });

  it('sin datos suficientes no asume que sea la final', () => {
    // Sin targetStage no hay --only-stage que compensar; sin totalStages (carrera con
    // race_days incompletos) preferimos NO forzar la lectura completa a ciegas.
    expect(isFinalStageDump(null, 4)).toBe(false);
    expect(isFinalStageDump(4, null)).toBe(false);
  });

  it('compara por valor, no por tipo (la BD devuelve numérico y el CLI string)', () => {
    expect(isFinalStageDump('4', 4)).toBe(true);
    expect(isFinalStageDump(4, '4')).toBe(true);
  });

  it('el prólogo (etapa 0) de una vuelta de una sola jornada también es final', () => {
    expect(isFinalStageDump(0, 0)).toBe(true);
  });
});

// Regresión (2026-08-21, Baltic Chain Tour): 1A y 1B comparten stageNumber=1.
describe('timer — aislamiento de dobles sectores', () => {
  it('pasa etapa y sector exactos al upsert', () => {
    expect(stageFilterArgs(3, 0, false)).toEqual([
      '--only-stage', '3', '--only-sector-index', '0',
    ]);
    expect(stageFilterArgs(3, 1, false)).toEqual([
      '--only-stage', '3', '--only-sector-index', '1',
    ]);
  });

  it('solo el último sector incorpora la clasificación final', () => {
    expect(isFinalStageDump(3, 3, false, false)).toBe(false);
    expect(isFinalStageDump(3, 3, false, true)).toBe(true);
    expect(stageFilterArgs(3, 1, true)).toEqual([
      '--only-stage', '3', '--only-sector-index', '1', '--include-final',
    ]);
  });
});

describe('shouldSeedStartlist — importaciones results-only', () => {
  it('no crea inscritos para una carrera marcada resultsOnly', () => {
    expect(shouldSeedStartlist(0, 'uci', true)).toBe(false);
  });

  it('mantiene la siembra UCI para carreras normales sin inscritos', () => {
    expect(shouldSeedStartlist(0, 'uci', false)).toBe(true);
  });

  it('no siembra inscritos desde una fuente que no sea DataRide', () => {
    expect(shouldSeedStartlist(0, 'domtel', false)).toBe(false);
    expect(shouldSeedStartlist(0, 'southbohemia', false)).toBe(false);
    expect(shouldSeedStartlist(0, 'atresults', false)).toBe(false);
  });
});

describe('shouldResolveBibsByName — identidades results-only', () => {
  it('resuelve por nombre las filas DataRide con dorsal sin sembrar inscritos', () => {
    expect(shouldResolveBibsByName('uci', true)).toBe(true);
  });

  it('no activa la resolución nominal para otras fuentes o carreras normales', () => {
    expect(shouldResolveBibsByName('domtel', true)).toBe(false);
    expect(shouldResolveBibsByName('uci', false)).toBe(false);
  });
});

describe('backlog — retirada de carreras inválidas', () => {
  it('trata la protección de una clasificación ya válida como desenlace resuelto', () => {
    expect(isProtectedInvalidRaceDeletion({
      code: '55000',
      message: 'La carrera x conserva una clasificación principal válida; no se borra',
    })).toBe(true);
    expect(isProtectedInvalidRaceDeletion({ code: '55000', message: 'otro error' })).toBe(false);
    expect(isProtectedInvalidRaceDeletion({ code: '22023', message: 'falta un argumento' })).toBe(false);
  });
});

describe('integración automática de manual_timing', () => {
  it('invoca la etapa exacta y exige que exista llegada', () => {
    expect(manual_timingFetchArgs({
      code: 'gironextgen2026',
      stage: 4,
      date: '2026-06-17',
      competitionId: -6123,
      outDir: '/tmp/manual_timing-test',
    })).toEqual([
      '--code', 'gironextgen2026',
      '--stage', '4',
      '--date', '2026-06-17',
      '--competition-id', '-6123',
      '--out', '/tmp/manual_timing-test',
      '--require-arrivi',
    ]);
  });

  it('invoca una carrera de un día sin número de etapa', () => {
    const args = manual_timingFetchArgs({
      code: 'granpiemonte2026', stage: null, date: '2026-10-08',
      competitionId: -147072, outDir: '/tmp/manual_timing-test', oneDay: true,
    });
    expect(args).toContain('--one-day');
    expect(args).not.toContain('--stage');
    expect(args).toContain('--require-arrivi');
  });

  it('emite las clasificaciones finales en la última jornada', () => {
    expect(manual_timingFetchArgs({
      code: 'gironextgen2026', stage: 8, date: '2026-06-21',
      competitionId: -6123, outDir: '/tmp/manual_timing-test', isFinalStage: true,
    })).toContain('--final');
  });
});

describe('integración automática de race|result multiconcurso', () => {
  it('pasa género, formato y fecha a una carrera de un día', () => {
    expect(raceresultFetchArgs({
      event: 406938,
      competitionId: -100345,
      outDir: '/tmp/raceresult-test',
      delay: 300,
      gender: 'female',
      raceFormat: 'one_day',
      date: '2026-08-30',
      targetStage: null,
    })).toEqual([
      '--event', '406938',
      '--competition-id', '-100345',
      '--out', '/tmp/raceresult-test',
      '--delay', '300',
      '--gender', 'female',
      '--one-day',
      '--date', '2026-08-30',
    ]);
  });

  // REGRESIÓN (2026-09-27, CRO Race 2026, E6): la rama raceresult no usaba
  // fetchStageArgs y pasaba siempre --stage N; el fetcher solo emitía la Final
  // Classification sin --stage y con EventOver=true, así que la general final de
  // una vuelta nunca se volcaba en automático. --final viaja junto a --stage.
  it('añade --final en la última jornada sin perder --stage', () => {
    const args = raceresultFetchArgs({
      event: 419574,
      competitionId: -50439,
      outDir: '/tmp/raceresult-test',
      delay: 300,
      gender: 'male',
      raceFormat: 'stage_race',
      date: '2026-09-27',
      targetStage: 6,
      final: true,
    });
    expect(args[args.indexOf('--stage') + 1]).toBe('6');
    expect(args).toContain('--final');
  });
});
