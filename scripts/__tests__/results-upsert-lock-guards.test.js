import { describe, it, expect } from 'vitest';
import { buildPlan, shouldIncludeStage } from '../results-fetchers/results-upsert.mjs';

describe('filtro de etapa — general final del último volcado automático', () => {
  it('mantiene la etapa pedida y la pseudo-etapa final con --include-final', () => {
    expect(shouldIncludeStage(3, false, 3, true)).toBe(true);
    expect(shouldIncludeStage(null, true, 3, true)).toBe(true);
    expect(shouldIncludeStage(2, false, 3, true)).toBe(false);
  });

  it('el volcado manual de una etapa sigue excluyendo la general final', () => {
    expect(shouldIncludeStage(3, false, 3, false)).toBe(true);
    expect(shouldIncludeStage(null, true, 3, false)).toBe(false);
  });

  it('no admite un stageNumber null que no esté marcado como final', () => {
    expect(shouldIncludeStage(null, false, 3, true)).toBe(false);
  });

  it('en dobles sectores incluye solo el sector seleccionado', () => {
    expect(shouldIncludeStage(3, false, 3, false, 0, 0)).toBe(true);
    expect(shouldIncludeStage(3, false, 3, false, 1, 0)).toBe(false);
    expect(shouldIncludeStage(3, false, 3, false, 0, 1)).toBe(false);
    expect(shouldIncludeStage(3, false, 3, false, 1, 1)).toBe(true);
  });

  it('la final solo entra por include-final y no hereda el sector', () => {
    expect(shouldIncludeStage(null, true, 3, true, 0, 1)).toBe(true);
    expect(shouldIncludeStage(null, true, 3, false, 0, 1)).toBe(false);
  });

  it('el plan no genera SQL para el sector hermano', () => {
    const data = {
      competitionId: 78302,
      disciplineId: 10,
      stages: [
        { stageNumber: 3, sectorIndex: 0, classifications: [clasificacion({ eventId: 78302030 })] },
        { stageNumber: 3, sectorIndex: 1, classifications: [clasificacion({ eventId: 78302031 })] },
      ],
    };
    const planA = buildPlan(data, null, null, null, { onlyStage: 3, onlySectorIndex: 0 });
    const planB = buildPlan(data, null, null, null, { onlyStage: 3, onlySectorIndex: 1 });

    expect([...planA.acceptedEventIds]).toEqual([78302030]);
    expect([...planB.acceptedEventIds]).toEqual([78302031]);
  });
});

// Guarda de lock ASIMÉTRICA en la purga de gemelas sintéticas.
//
// Contexto: una misma clasificación lógica (raceId + raceDayId/sector + classKind
// + scope) puede existir bajo varios eventId. Los POSITIVOS son de DataRide (fuente
// oficial); los NEGATIVOS son sintéticos (cronometrador, volcado PDF…).
//
// La regla de producto (Dani, 2026-06-10) es "lo oficial pisa al placeholder": un
// volcado provisional nunca debe bloquear a la UCI. Pero la implementación original
// purgaba por "eventId distinto y negativo" a secas, así que también se llevaba por
// delante a una gemela SINTÉTICA curada a mano y bloqueada desde el panel — entre dos
// fuentes provisionales ninguna es "la verdad", así que ahí el candado debe mandar
// (matizado 2026-07-19, caso Giro della Valle d'Aosta 2026: E1-E3 volcadas
// del libro STS y curadas a mano, con el .clax de STS llegando después bajo otro
// eventId sintético).
//
// Estos tests fijan el plan que emite buildPlan (orden, parámetros y banderas de
// cada sentencia). El efecto de las guardas de lock sobre las filas depende del
// SQL ejecutado en la base y se cubre en scripts/data-preflight/tests.

const clasificacion = (overrides = {}) => ({
  eventId: -1359920101,
  classKind: 'stage',
  scope: 'stage',
  eventName: 'Stage 1',
  stageNumber: 1,
  rowCount: 2,
  rows: [
    { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: "26'25" },
    { rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel', gapText: '+1' },
  ],
  ...overrides,
});

const planDe = (eventId) => {
  const { plan } = buildPlan({
    competitionId: eventId > 0 ? 78302 : -135992,
    disciplineId: 10,
    stages: [{ stageNumber: 1, classifications: [clasificacion({ eventId })] }],
  });
  return plan;
};

const planDeSector = (eventId, sectorIndex) => {
  const { plan } = buildPlan({
    competitionId: -135992,
    disciplineId: 10,
    stages: [{ stageNumber: 1, sectorIndex, classifications: [clasificacion({ eventId })] }],
  });
  return plan;
};

// Las sentencias se identifican por propiedades del plan (nota, resultRow,
// parámetros), no por su texto SQL.
const esEnlace = (p) => typeof p.note === 'string' && p.note.startsWith('puente carrera↔competición');
const enlaceDe = (plan) => plan.find(esEnlace);
const purgaDe = (plan) => plan.find((p) => p.note === null && !p.resultRow && p.params.length > 1);
const insertCabeceraDe = (plan) => plan.find((p) => /^stage /.test(p.note ?? ''));
const insertFilasDe = (plan) => plan.find((p) => p.resultRow);

describe('bloqueo del enlace durante el volcado', () => {
  it('difiere el upsert de race_uci_links hasta el final de la transacción', () => {
    const link = enlaceDe(planDe(380794));

    expect(link).toBeDefined();
    expect(link.deferUntilCommit).toBe(true);
  });
});

describe('enlace de fuentes con código obligatorio', () => {
  const caso = (source, extra = {}) => ({
    competitionId: -135992,
    disciplineId: 10,
    source,
    ...extra,
    stages: [{ stageNumber: 1, classifications: [clasificacion({ eventId: -1359920101 })] }],
  });
  const linkDe = (data) => enlaceDe(buildPlan(data).plan);

  it('race|result propaga el evento como código y exige su identificador', () => {
    expect(linkDe(caso('raceresult', { raceresultEvent: 421325 })).params).toContain('421325');
    expect(() => buildPlan(caso('raceresult'))).toThrow('requiere raceresultEvent');
  });

  // Los CHECK chk_race_uci_links_*_code son NOT NULL duros: Postgres valida el
  // código en la fila propuesta antes del ON CONFLICT y, sin él, el volcado
  // entero revierte (Tour de Luxemburgo E1, 2026-09-16).
  it('cada cronometrador propaga su código y rechaza el volcado sin él', () => {
    for (const [source, column, flag, code] of [
      ['tissot', 'tissotCode', '--tissot-code', 'tdf'],
      ['matsport', 'matsportCode', '--matsport-code', 'LUX'],
      ['ASO', 'asoUrl', '--aso-url', 'https://example.test/aso'],
    ]) {
      expect(linkDe(caso(source, { [column]: code })).params, source).toContain(code);
      expect(() => buildPlan(caso(source)), source).toThrow(flag);
    }
  });
});

describe('purga de gemelas por sector', () => {
  it('pasa el sectorIndex entrante a la purga', () => {
    const purgeA = purgaDe(planDeSector(-1359920101, 0));
    const purgeB = purgaDe(planDeSector(-1359920102, 1));

    expect(purgeA.params.at(-1)).toBe(0);
    expect(purgeB.params.at(-1)).toBe(1);
  });
});

describe('preferencia UCI por clave lógica sectorizada', () => {
  const data = (sectorIndex) => ({
    competitionId: -135992,
    disciplineId: 10,
    stages: [{ stageNumber: 1, sectorIndex, classifications: [clasificacion()] }],
  });

  it('una clasificación oficial de 1A no bloquea la sintética de 1B', () => {
    const officialA = new Set(['1|0|stage|stage']);
    expect(buildPlan(data(1), null, null, officialA).nStages).toBe(1);
  });

  it('una clasificación oficial del mismo sector sí bloquea su gemela sintética', () => {
    const officialB = new Set(['1|1|stage|stage']);
    expect(buildPlan(data(1), null, null, officialB).nStages).toBe(0);
  });
});

describe('fallback de identidad exclusivo de DataRide', () => {
  const oneDay = (source, extra = {}) => buildPlan({
    source,
    competitionId: 78302,
    disciplineId: 10,
    ...extra,
    stages: [{
      stageNumber: null,
      isFinalClassification: false,
      classifications: [clasificacion({
        eventId: 78302001,
        classKind: 'gc',
        scope: 'stage',
        winnerName: 'BRAVO Henrique',
      })],
    }],
  }).plan;

  it('conserva riderDisplay y winnerName cuando el payload es UCI', () => {
    const plan = oneDay('uci');
    expect(insertFilasDe(plan).params[6]).toBe('BRAVO Henrique');
    expect(insertCabeceraDe(plan).params[13]).toBe('BRAVO Henrique');
  });

  it('mantiene la exclusión de identidades para las demás fuentes', () => {
    const plan = oneDay('tissot', { tissotCode: 'tdf' });
    expect(insertFilasDe(plan).params[6]).toBeNull();
    expect(insertCabeceraDe(plan).params[13]).toBeNull();
  });
});

describe('coherencia de parámetros del plan con el bind del servidor', () => {
  // El nº de $N de cada sentencia debe cuadrar SIEMPRE con params.length, o
  // Postgres rechaza el bind y aborta el --apply entero. Se rompió con la
  // pseudo-etapa Final Classification (stageNumber null): "bind message supplies
  // 17 parameters, but prepared statement requires 16" (Giro della Valle
  // d'Aosta 2026, etapa 4). --emit-sql no lo detecta (serializa a literales).
  //
  // El cliente falso reproduce la validación del bind del servidor y recibe las
  // sentencias del plan como lo hace la ruta --apply (client.query(text, params)).
  const clienteFalso = () => {
    const llamadas = [];
    return {
      llamadas,
      query(text, params) {
        const requeridos = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
        if (requeridos !== params.length) {
          throw new Error(`bind message supplies ${params.length} parameters, but prepared statement requires ${requeridos}`);
        }
        llamadas.push({ text, params });
      },
    };
  };

  const planConStage = (stageNumber) => {
    const stages = [{
      stageNumber,
      isFinalClassification: stageNumber == null,
      dateKey: '2026-07-19',
      classifications: [clasificacion({ stageNumber })],
    }];
    // Una final llega siempre junto a una llegada confirmada: desde el gate de
    // integridad no se admite un JSON que contenga solo generales finales.
    if (stageNumber == null) {
      stages.unshift({
        stageNumber: 4,
        dateKey: '2026-07-19',
        classifications: [clasificacion({ stageNumber: 4 })],
      });
    }
    const { plan } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages,
    });
    return plan;
  };

  it('etapa normal y Final Classification: cada sentencia cuadra con sus params', () => {
    for (const stageNumber of [4, null]) {
      const plan = planConStage(stageNumber);
      const cliente = clienteFalso();

      for (const statement of plan) cliente.query(statement.text, statement.params);

      expect(cliente.llamadas, `stageNumber ${stageNumber}`).toHaveLength(plan.length);
    }
  });
});

describe('gate de integridad — rank 1 válido', () => {
  it('omite toda la etapa si faltan resultados de etapa con rank 1', () => {
    const general = clasificacion({
      eventId: -1359920102,
      classKind: 'gc',
      rows: [
        { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: '3:00:00' },
        { rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel', gapText: '+1' },
      ],
    });
    const { plan, nStages, nRejected } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [{ stageNumber: 1, classifications: [general] }],
    });

    expect(nStages).toBe(0);
    expect(nRejected).toBe(1);
    expect(plan).toEqual([]);
  });

  it('acepta una prueba de un día cuyo resultado principal viene como gc/stage', () => {
    // Las one-day no tienen stageNumber ni raceDayId propio. Algunos proveedores
    // (STS) tipan la llegada como gc/stage; no debe confundirse con una general
    // heredada de una vuelta, que sí conserva un número de etapa.
    const principal = clasificacion({
      eventId: -1359920102,
      classKind: 'gc',
      scope: 'stage',
      rows: [{ rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: '3:00:00' }],
    });
    const { nStages, nRejected } = buildPlan({
      competitionId: -135992,
      disciplineId: 10,
      stages: [{ stageNumber: null, isFinalClassification: false, classifications: [principal] }],
    });

    expect(nStages).toBe(1);
    expect(nRejected).toBe(0);
  });

  it('omite la clasificación final si el payload no confirma ninguna llegada', () => {
    const general = clasificacion({
      eventId: -1359920102,
      classKind: 'gc',
      rows: [
        { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: '3:00:00' },
      ],
    });
    const final = clasificacion({
      eventId: -1359929902,
      classKind: 'gc',
      stageNumber: null,
      scope: 'stage',
      rows: [
        { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: '20:00:00' },
      ],
    });
    const { plan, nStages, nRejected } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [
        { stageNumber: 1, classifications: [general] },
        { stageNumber: null, isFinalClassification: true, classifications: [final] },
      ],
    });

    expect(nStages).toBe(0);
    expect(nRejected).toBe(2);
    expect(plan).toEqual([]);
  });

  it('admite la clasificación final cuando el payload confirma la llegada', () => {
    const final = clasificacion({
      eventId: -1359929902,
      classKind: 'gc',
      stageNumber: null,
      scope: 'stage',
      rows: [
        { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: '20:00:00' },
      ],
    });
    const { nStages, nRejected } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [
        { stageNumber: 1, classifications: [clasificacion()] },
        { stageNumber: null, isFinalClassification: true, classifications: [final] },
      ],
    });

    expect(nStages).toBe(2);
    expect(nRejected).toBe(0);
  });

  it('no genera ninguna escritura si la clasificación no trae rank 1', () => {
    const { plan, nRejected } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [{ stageNumber: 1, classifications: [clasificacion({
        rows: [{ rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel' }],
      })] }],
    });

    expect(nRejected).toBe(1);
    expect(plan).toEqual([]); // tampoco actualiza race_uci_links
  });

  it('omite solo la clasificación cuyo rank 1 lleva IRM', () => {
    const invalida = clasificacion({
      eventId: -1359920102,
      classKind: 'points',
      rows: [
        { rank: 1, rankText: 'DNF', bib: '11', riderDisplay: 'BRAVO Henrique', irm: 'DNF' },
        { rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel' },
      ],
    });
    const { plan, nStages, nRejected } = buildPlan({
      competitionId: -135992,
      disciplineId: 10,
      stages: [{ stageNumber: 1, classifications: [clasificacion(), invalida] }],
    });

    expect(nStages).toBe(1);
    expect(nRejected).toBe(1);
    expect(plan.some((p) => p.params?.includes(-1359920102))).toBe(false);
  });

  it('acepta la etapa si el saneo desplaza un IRM espurio y restaura al ganador', () => {
    const { nStages, nRejected } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [{ stageNumber: 1, classifications: [clasificacion({
        rows: [
          { rank: 1, rankText: 'DNS', bib: '11', riderDisplay: 'BRAVO Henrique', irm: 'DNS' },
          { rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel', timeText: '3:00:00' },
        ],
      })] }],
    });

    expect(nStages).toBe(1);
    expect(nRejected).toBe(0);
  });
});

// Guard anti-secuestro del enlace: un volcado manual ('pdf'/'sportstiming')
// sobre una carrera ya enlazada a una fuente automática no toca el enlace.
// Contexto: Vuelta al Ecuador 2026, E6 — el volcado PDF reescribió
// race_uci_links a source='pdf' con competitionId sintético y syncStatus 'ok';
// el cron excluye las fuentes manuales y DataRide nunca reemplazó lo manual.
describe('statement del enlace — guard anti-secuestro manual', () => {
  const carrera = (eventId) => ({
    competitionId: 78836,
    disciplineId: 10,
    stages: [{ stageNumber: 1, classifications: [clasificacion({ eventId })] }],
  });

  it('un volcado pdf emite el enlace diferido con la fuente pdf', () => {
    const { plan } = buildPlan(carrera(-1038250600), null, null, null, null, 'pdf');
    const link = enlaceDe(plan);
    expect(link).toBeTruthy();
    expect(link.deferUntilCommit).toBe(true);
    expect(link.params).toContain('pdf');
  });

  it('un volcado automático (uci) emite el enlace diferido con la fuente uci', () => {
    const { plan } = buildPlan(carrera(380794), null, null, null, null, 'uci');
    const link = enlaceDe(plan);
    expect(link).toBeTruthy();
    expect(link.deferUntilCommit).toBe(true);
    expect(link.params[5]).toBe('uci');
  });

  // Un placeholder no crea el enlace: uno 'pdf' bloquearía el enlazador live y el cron.
  const linkStatements = (plan) => plan.filter(esEnlace);

  it('un manual sin fuente con competición sintética no crea ni modifica el enlace', () => {
    const { plan, nStages } = buildPlan({ ...carrera(-131200500), competitionId: -131200100 });
    expect(nStages).toBe(1);
    expect(linkStatements(plan)).toEqual([]);
  });

  it('un placeholder con competición real y eventos negativos tampoco toca el enlace', () => {
    const { plan, nStages } = buildPlan(carrera(-131200500));
    expect(nStages).toBe(1);
    expect(linkStatements(plan)).toEqual([]);
  });

  it('respeta la fuente automática declarada por un captador sintético', () => {
    const { plan } = buildPlan({ ...carrera(-123), competitionId: -123, source: 'domtel', domtelCode: '8872' });
    const link = enlaceDe(plan);
    expect(link.params[5]).toBe('domtel');
  });

  it('rechaza una competición sintética presentada como DataRide', () => {
    const data = { ...carrera(-131200500), competitionId: -131200100 };
    expect(() => buildPlan({ ...data, source: 'uci' })).toThrow('competitionId positivo');
    expect(() => buildPlan(data, null, null, null, null, 'uci')).toThrow('competitionId positivo');
  });
});
