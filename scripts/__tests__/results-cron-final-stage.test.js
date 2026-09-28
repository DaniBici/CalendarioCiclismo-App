import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BACKLOG_RETRY_INTERVAL_SQL,
  CONFIGURED_POLL_INTERVAL_MINUTES_SQL,
  isProtectedInvalidRaceDeletion,
  isFinalStageDump,
  LIVE_RESULT_SOURCES,
  MANUAL_RESULT_SOURCES,
  manual_timingFetchArgs,
  raceresultFetchArgs,
  refreshesCoveredStage,
  shouldResolveBibsByName,
  shouldSeedStartlist,
} from '../results-fetchers/results-cron.mjs';
import {
  hasPublishableResults,
  shouldPublishFinalClassification,
} from '../results-fetchers/results-upsert.mjs';

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

describe('shouldPublishFinalClassification — carreras de un día en DataRide', () => {
  it('acepta una Final Classification única cuando no hay etapa no-final en el payload', () => {
    expect(shouldPublishFinalClassification(false, false)).toBe(true);
  });

  it('mantiene el guard para una vuelta cuyo payload sí contiene etapas', () => {
    expect(shouldPublishFinalClassification(false, true)).toBe(false);
    expect(shouldPublishFinalClassification(true, true)).toBe(true);
  });
});

describe('refreshesCoveredStage — fuentes parciales en directo', () => {
  it('las fuentes parciales siguen actualizando una etapa aunque ya tenga ganador', () => {
    for (const source of LIVE_RESULT_SOURCES) {
      expect(refreshesCoveredStage(source), source).toBe(true);
    }
  });

  it('las fuentes de resultado definitivo conservan el cierre habitual', () => {
    expect(refreshesCoveredStage('uci')).toBe(false);
    expect(refreshesCoveredStage('belgiancycling')).toBe(false);
    expect(LIVE_RESULT_SOURCES).not.toContain('istanbul');
    expect(MANUAL_RESULT_SOURCES).not.toContain('istanbul');
    expect(refreshesCoveredStage('istanbul')).toBe(false);
    expect(LIVE_RESULT_SOURCES).not.toContain('southbohemia');
    expect(MANUAL_RESULT_SOURCES).not.toContain('southbohemia');
    expect(refreshesCoveredStage('southbohemia')).toBe(false);
    expect(LIVE_RESULT_SOURCES).not.toContain('atresults');
    expect(MANUAL_RESULT_SOURCES).not.toContain('atresults');
    expect(refreshesCoveredStage('atresults')).toBe(false);
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

describe('cadencia configurada por fuente', () => {
  it('trata ASO como directo cada minuto', () => {
    expect(LIVE_RESULT_SOURCES).toContain('ASO');
  });

  it('trata manual_timing como directo cada minuto', () => {
    expect(LIVE_RESULT_SOURCES).toContain('manual_timing');
    expect(MANUAL_RESULT_SOURCES).not.toContain('manual_timing');
    expect(refreshesCoveredStage('manual_timing')).toBe(true);
  });

  it('trata CH:RO:NO como fuente progresiva cada minuto', () => {
    expect(LIVE_RESULT_SOURCES).toContain('chronohr');
    expect(MANUAL_RESULT_SOURCES).not.toContain('chronohr');
    expect(refreshesCoveredStage('chronohr')).toBe(true);
  });

  it('trata Maneffic como fuente live cada minuto', () => {
    expect(LIVE_RESULT_SOURCES).toContain('maneffic');
    expect(MANUAL_RESULT_SOURCES).not.toContain('maneffic');
    expect(refreshesCoveredStage('maneffic')).toBe(true);
  });

  it('limita la cadencia alta de DataRide a T+30–T+120', () => {
    expect(CONFIGURED_POLL_INTERVAL_MINUTES_SQL)
      .toContain(`WHEN now() < d."estimatedFinishTimeUtc" + interval '30 minutes' THEN 10`);
    expect(CONFIGURED_POLL_INTERVAL_MINUTES_SQL)
      .toContain(`WHEN now() <= d."estimatedFinishTimeUtc" + interval '120 minutes' THEN 5`);
    expect(CONFIGURED_POLL_INTERVAL_MINUTES_SQL).not.toContain("interval '90 minutes'");
  });
});

describe('enlaces de resultados siempre activos', () => {
  it('el watcher no depende de campos de activación por carrera o jornada', () => {
    const source = readFileSync(
      new URL('../results-fetchers/results-cron.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('autoSyncEnabled');
    expect(source).not.toContain('resultsAutoSyncEnabled');
  });
});

describe('backlog — rotación y reintento de pendientes', () => {
  it('aplica espera creciente a una carrera sin clasificación publicable', () => {
    expect(BACKLOG_RETRY_INTERVAL_SQL).toContain("< 1 THEN interval '10 minutes'");
    expect(BACKLOG_RETRY_INTERVAL_SQL).toContain("< 2 THEN interval '30 minutes'");
    expect(BACKLOG_RETRY_INTERVAL_SQL).toContain("< 3 THEN interval '2 hours'");
    expect(BACKLOG_RETRY_INTERVAL_SQL).toContain("ELSE interval '24 hours'");
  });

  it('deja fuera una pendiente en espera y ordena las disponibles de forma estable', () => {
    const source = readFileSync(
      new URL('../results-fetchers/results-cron.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('l."backlogNextAttemptAt" IS NULL');
    expect(source).toContain('l."backlogNextAttemptAt" ASC NULLS FIRST');
    expect(source).toContain('l."backlogLastAttemptAt" ASC NULLS FIRST');
    expect(source).toContain('l."raceId" ASC');
    expect(source).toContain('"backlogLastAttemptAt" = now()');
    expect(source).toContain("if (!DRY && SCOPE === 'backlog' && targets.length)");
  });

  it('incluye enlaces no resueltos sin jornadas y estados parciales o erróneos', () => {
    const source = readFileSync(
      new URL('../results-fetchers/results-cron.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('NOT EXISTS (SELECT 1 FROM race_days d WHERE d."raceId" = r.id)');
    expect(source).toContain(`l."syncStatus" IN ('pending', 'partial', 'error')`);
  });

  it('trata la protección de una clasificación ya válida como desenlace resuelto', () => {
    expect(isProtectedInvalidRaceDeletion({
      code: '55000',
      message: 'La carrera x conserva una clasificación principal válida; no se borra',
    })).toBe(true);
    expect(isProtectedInvalidRaceDeletion({ code: '55000', message: 'otro error' })).toBe(false);
    expect(isProtectedInvalidRaceDeletion({ code: '22023', message: 'falta un argumento' })).toBe(false);
  });
});

describe('hasPublishableResults — guardia de retirada de carreras inválidas', () => {
  it('rechaza una respuesta DNS-only de DataRide', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'gc',
          scope: 'stage',
          rows: [{ rank: null, rankText: 'DNS', irm: 'DNS' }],
        }],
      }],
    })).toBe(false);
  });

  it('conserva una carrera cuyo payload sí contiene una llegada válida', () => {
    expect(hasPublishableResults({
      stages: [{
        stageNumber: null,
        isFinalClassification: false,
        classifications: [{
          classKind: 'stage',
          scope: 'stage',
          rows: [{ rank: 1, bib: '7', irm: null }],
        }],
      }],
    })).toBe(true);
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

  it('conserva el argumento de etapa para las vueltas históricas', () => {
    expect(raceresultFetchArgs({
      event: 402988,
      competitionId: -17212,
      outDir: '/tmp/raceresult-test',
      delay: 0,
      gender: 'male',
      raceFormat: 'stage_race',
      date: '2026-06-20',
      targetStage: 4,
    })).toContain('--stage');
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

  it('no declara la final en una jornada intermedia', () => {
    expect(raceresultFetchArgs({
      event: 419574,
      competitionId: -50439,
      outDir: '/tmp/raceresult-test',
      delay: 300,
      gender: 'male',
      raceFormat: 'stage_race',
      date: '2026-09-24',
      targetStage: 3,
    })).not.toContain('--final');
  });
});
