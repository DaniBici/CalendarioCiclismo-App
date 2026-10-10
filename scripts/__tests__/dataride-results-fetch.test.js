import { describe, it, expect } from 'vitest';
import { cachedRacesForStage, fixInvertedAbsoluteGaps, fixDisguisedGaps, fixPressFormattedAbsolute, isFinalClassificationRace, normalizeDataRideResultValue, normalizeInitialStageOnlyClassification, normalizePointsRows, normalizeRow, _pressToSeconds, uciLicenseFromRow, uciProfileIdFromRow }
  from '../results-fetchers/dataride-results-fetch.mjs';
import { normalizeUciLicense } from '../results-fetchers/uci-license.mjs';

describe('contrato del fetcher UCI', () => {
  it.each(['Final Classification', 'Final Result'])('identifica %s como clasificación final de la carrera', name => {
    expect(isFinalClassificationRace(name)).toBe(true);
  });

  it('no reutiliza una topología parcial de un doble sector', () => {
    const topology = { source: 'uci', stages: [
      { stageNumber: 1, uciRaceId: 257336, stageName: 'Stage 1A' },
    ] };
    expect(cachedRacesForStage(topology, 1)).toEqual([]);
  });

  it('conserva la caché para una etapa ordinaria', () => {
    const stage = { stageNumber: 2, uciRaceId: 257337, stageName: 'Stage 2' };
    expect(cachedRacesForStage({ source: 'uci', stages: [stage] }, 2)).toEqual([stage]);
  });

  it('normaliza como llegada el único Stage General Classification de la etapa 1', () => {
    const input = [{
      eventId: 380754,
      eventName: 'Stage General Classification',
      classKind: 'gc',
      scope: 'stage',
      rows: [{ rank: 1 }],
    }];
    expect(normalizeInitialStageOnlyClassification(1, input)).toEqual([{
      ...input[0], classKind: 'stage', eventName: 'Stage Classification',
    }]);
  });

  it('deriva la general inicial aplicando las bonificaciones de meta', () => {
    const input = [{
      eventId: 380754,
      eventName: 'Stage General Classification',
      classKind: 'gc',
      scope: 'stage',
      winnerName: 'GUAMA Bayron',
      rowCount: 5,
      rows: [
        { rank: 1, rankText: '1', bib: '2', riderDisplay: 'GUAMA Bayron', resultValue: '3:16:40', timeText: '3:16:40', gapText: null, irm: null },
        { rank: 2, rankText: '2', bib: '7', riderDisplay: 'ALVAREZ Hector', resultValue: '3:16:40', timeText: '3:16:40', gapText: null, irm: null },
        { rank: 3, rankText: '3', bib: '3', riderDisplay: 'MONTENEGRO Santiago', resultValue: '3:16:40', timeText: '3:16:40', gapText: null, irm: null },
        { rank: 4, rankText: '4', bib: '1', riderDisplay: 'HUERA Richard', resultValue: '3:16:40', timeText: '3:16:40', gapText: null, irm: null },
        { rank: 70, rankText: '70', bib: '136', riderDisplay: 'LOPEZ SALCEDO Juan Jose', resultValue: null, timeText: null, gapText: null, irm: 'DSQ' },
      ],
    }];
    const [stage, general] = normalizeInitialStageOnlyClassification(1, input, [10, 6, 4]);
    expect(stage).toMatchObject({ eventId: 380754, classKind: 'stage', rowCount: 5 });
    expect(stage.rows).toEqual(input[0].rows);
    expect(general).toMatchObject({ eventId: -3807549, classKind: 'gc', rowCount: 4 });
    expect(general.rows.map((row) => [row.bib, row.rank, row.timeText, row.gapText])).toEqual([
      ['2', 1, '3:16:30', null],
      ['7', 2, null, '+0:04'],
      ['3', 3, null, '+0:06'],
      ['1', 4, null, '+0:10'],
    ]);
  });

  it('no reclasifica una general posterior ni pisa una llegada separada', () => {
    const gc = { eventName: 'Stage General Classification', classKind: 'gc', scope: 'stage' };
    expect(normalizeInitialStageOnlyClassification(2, [gc])).toEqual([gc]);
    const arrival = { eventName: 'Stage Classification', classKind: 'stage', scope: 'stage' };
    expect(normalizeInitialStageOnlyClassification(1, [arrival, gc])).toEqual([arrival, gc]);
  });

  it.each(['DNS', 'DNF', 'OTL', 'DSQ', 'ABD'])('recupera %s desde ResultValue cuando Irm está vacío', code => {
    expect(normalizeRow({ Rank: '', ResultValue: code, Irm: '' })).toMatchObject({
      rank: null, resultValue: code, timeText: null, gapText: null, irm: code,
    });
  });
});

describe('tiempos con puntos de DataRide', () => {
  it.each([
    ['42.36.124', '42:36.124'],
    ['1.02.03.456', '1:02:03.456'],
    ['+2.22', '+2:22'],
    ['+1.02.345', '+1:02.345'],
    ['+1.02.03.456', '+1:02:03.456'],
    ['+0.032', '+0.032'],
    ['+37', '+37'],
    ['17.5', '17.5'],
  ])('canonicaliza %s como %s', (raw, expected) => {
    expect(normalizeDataRideResultValue(raw)).toBe(expected);
  });

  it('normaliza el tiempo absoluto y el gap antes de emitir la fila', () => {
    expect(normalizeRow({ Rank: '1', ResultValue: '42.36.124' })).toMatchObject({
      resultValue: '42:36.124', timeText: '42:36.124', gapText: null,
    });
    expect(normalizeRow({ Rank: '2', ResultValue: '+2.22' })).toMatchObject({
      resultValue: '+2:22', timeText: null, gapText: '+2:22',
    });
  });
});

describe('códigos UCI de licencia', () => {
  it('acepta exactamente 11 cifras y compacta espacios', () => {
    expect(normalizeUciLicense('100 428 096 19')).toBe('10042809619');
    expect(normalizeUciLicense('10042809619')).toBe('10042809619');
  });

  it('rechaza perfiles internos y valores malformados', () => {
    expect(normalizeUciLicense('428096')).toBeNull();
    expect(normalizeUciLicense('USA19940501')).toBeNull();
    expect(normalizeUciLicense('1004280961A')).toBeNull();
  });

  it('busca campos DataRide candidatos pero solo devuelve una licencia válida', () => {
    expect(uciLicenseFromRow({ UciId: '428096', IndividualUciId: '10042809619' })).toBe('10042809619');
    expect(uciLicenseFromRow({ UciId: '428096' })).toBeNull();
  });
});

describe('identificadores de perfil UCI', () => {
  it('conserva perfiles internos sin confundirlos con licencias', () => {
    expect(uciProfileIdFromRow({ IndividualId: '422366' })).toBe('422366');
    expect(uciProfileIdFromRow({ UciId: '428096' })).toBe('428096');
    expect(uciProfileIdFromRow({ UciId: '10042809619' })).toBeNull();
  });

  it('emite perfil y licencia en campos separados', () => {
    expect(normalizeRow({ IndividualId: '422366', IndividualUciId: '10042809619' }))
      .toMatchObject({ uciProfileId: '422366', uciId: '10042809619' });
  });
});

// Filas en la forma que produce normalizeRow (solo los campos que tocan estas funciones).
const row = (rank, gapText, extra = {}) => ({
  rank, rankText: rank == null ? 'DNF' : String(rank), irm: null,
  timeText: null, gapText, ...extra,
});
const winner = (timeText) => ({ rank: 1, rankText: '1', irm: null, timeText, gapText: null });

describe('fixInvertedAbsoluteGaps — tiempos absolutos disfrazados de gap (CN en circuito)', () => {
  it('EE.UU. línea fem 2026: convierte gaps absolutos en gaps reales', () => {
    const rows = [
      winner('3:02:30'),               // 10950s
      row(2, '+3:02:35'),              // abs 10955 → +5s
      row(3, '+3:02:39'),              // abs 10959 → +9s
      row(7, '+3:07:12'),              // abs 11232 → +4:42
    ];
    const out = fixInvertedAbsoluteGaps(rows, false);
    expect(out[0]).toEqual(winner('3:02:30'));   // ganador intacto
    expect(out[1].gapText).toBe('+0:05');
    expect(out[2].gapText).toBe('+0:09');
    expect(out[3].gapText).toBe('+4:42');
    expect(out[1].irm).toBeNull();               // sigue siendo clasificado
  });

  it('marca como ABANDONO a quien tiene tiempo < ganador (no completó la distancia)', () => {
    const rows = [
      winner('3:02:30'),               // 10950s
      row(2, '+3:02:35'),              // finisher (dispara la detección)
      row(30, '+2:36:04'),             // abs 9364 < 10950 → doblado/abandono
      row(50, '+50:15'),               // abs 3015 < 10950 → abandono
    ];
    const out = fixInvertedAbsoluteGaps(rows, false);
    expect(out[2]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', gapText: null, timeText: null });
    expect(out[3]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', gapText: null, timeText: null });
  });

  it('NO toca una clasificación normal (gaps pequeños, ninguno ≥ tiempo del ganador)', () => {
    const rows = [winner('4:00:00'), row(2, '+5'), row(3, '+1:30'), row(4, '+12:20')];
    const out = fixInvertedAbsoluteGaps(rows, false);
    expect(out).toEqual(rows);
  });

  it('NO se dispara con basura suelta si el MEJOR clasificado tiene gap real (caso prólogo El Salvador)', () => {
    // winner 2:42; el 2º está a +0:03 (gap real) aunque haya colas corruptas con +4:46.
    const rows = [
      winner('0:02:42'),               // 162s
      row(2, '+0:03'),                 // gap real 3s → el rank más bajo NO es ≥ ganador
      row(3, '+0:04'),
      row(88, '+4:46'),                // 286 ≥ 162, pero NO es el mejor clasificado
    ];
    const out = fixInvertedAbsoluteGaps(rows, false);
    expect(out).toEqual(rows);        // intacto: no confundir con la corrupción de absolutos
  });

  it('no toca clasificaciones por equipos ni si falta el tiempo del ganador', () => {
    const teamRows = [winner('3:02:30'), row(2, '+3:02:35')];
    expect(fixInvertedAbsoluteGaps(teamRows, true)).toEqual(teamRows);
    const noWinner = [{ rank: 1, rankText: '1', irm: null, timeText: null, gapText: null }, row(2, '+3:02:35')];
    expect(fixInvertedAbsoluteGaps(noWinner, false)).toEqual(noWinner);
  });

  it('respeta los abandonos que la UCI ya marcó', () => {
    const dnf = { rank: null, rankText: 'DNF', irm: 'DNF', timeText: null, gapText: null };
    const rows = [winner('3:02:30'), row(2, '+3:02:35'), dnf];
    const out = fixInvertedAbsoluteGaps(rows, false);
    expect(out[2]).toEqual(dnf);
  });
});

describe('fixDisguisedGaps — regresión (gaps sin + en timeText)', () => {
  it('mueve timeText<ganador a gapText', () => {
    const rows = [
      { rank: 1, rankText: '1', irm: null, timeText: '4:00:00', gapText: null },
      { rank: 2, rankText: '2', irm: null, timeText: '0:00:05', gapText: null },
    ];
    const out = fixDisguisedGaps(rows, false);
    expect(out[1].timeText).toBeNull();
    expect(out[1].gapText).toBe('+0:05');
  });
});

describe('_pressToSeconds — notación de prensa de la UCI', () => {
  it('NO parsea un entero suelto ni el formato con ":"', () => {
    expect(_pressToSeconds('12')).toBeNull();       // sin h ni ' → no es tiempo de prensa
    expect(_pressToSeconds('3:00:02')).toBeNull();  // formato clásico → lo maneja _toSeconds
  });
});

describe('fixPressFormattedAbsolute — tiempos absolutos en notación de prensa (comp 77761)', () => {
  const pRow = (rank, timeText, extra = {}) => ({
    rank, rankText: rank == null ? 'DNF' : String(rank), irm: null, timeText, gapText: null, ...extra,
  });
  it('Memorial Trochanowski 2026: gaps reales y +0 (m.t.) para el grupo del ganador', () => {
    const rows = [
      pRow(1, "3h 00'02\""),   // ganador
      pRow(2, "3h 00'02\""),   // mismo tiempo → +0
      pRow(3, "3h 00'02\""),   // mismo tiempo → +0
      pRow(120, "3h 01'56\""), // +1'54"
      pRow(138, "3h 04'32\""), // +4'30"
    ];
    const out = fixPressFormattedAbsolute(rows, false);
    expect(out[0].timeText).toBe("3h 00'02\"");  // ganador conserva su tiempo
    expect(out[0].gapText).toBeNull();
    expect(out[1]).toMatchObject({ timeText: null, gapText: '+0:00' });
    expect(out[2]).toMatchObject({ timeText: null, gapText: '+0:00' });
    expect(out[3].gapText).toBe('+1:54');
    expect(out[4].gapText).toBe('+4:30');
  });
  it('deja intactos los abandonos que la UCI ya marcó', () => {
    const dnf = { rank: null, rankText: 'DNF', irm: 'DNF', timeText: null, gapText: null };
    const rows = [pRow(1, "3h 00'02\""), pRow(2, "3h 00'02\""), dnf];
    const out = fixPressFormattedAbsolute(rows, false);
    expect(out[2]).toEqual(dnf);
  });
  it('NO toca el formato clásico (ganador absoluto con ":" + gaps con "+")', () => {
    const rows = [
      { rank: 1, rankText: '1', irm: null, timeText: '3:00:02', gapText: null },
      { rank: 2, rankText: '2', irm: null, timeText: null, gapText: '+5' },
    ];
    expect(fixPressFormattedAbsolute(rows, false)).toEqual(rows);
  });
  it('NO toca clasificaciones por equipos ni si falta el tiempo del ganador', () => {
    const teamRows = [pRow(1, "3h 00'02\""), pRow(2, "3h 01'56\"")];
    expect(fixPressFormattedAbsolute(teamRows, true)).toEqual(teamRows);
    const noWinner = [pRow(1, null), pRow(2, "3h 01'56\"")];
    expect(fixPressFormattedAbsolute(noWinner, false)).toEqual(noWinner);
  });
});

describe('puntos y montaña con decimal', () => {
  const row = (rank, resultValue) => normalizeRow({ Rank: String(rank), Bib: String(rank), ResultValue: resultValue });
  it('conserva el entero y no los toma por tiempo ni hueco', () => {
    const rows = fixDisguisedGaps(normalizePointsRows([row(1, '19.0'), row(2, '13.0'), row(3, '8.0')], 'points'), false);
    expect(rows.map(r => [r.resultValue, r.timeText, r.gapText])).toEqual([['19', null, null], ['13', null, null], ['8', null, null]]);
  });
  it('respeta un decimal distinto de cero y no toca clasificaciones por tiempo', () => {
    expect(normalizePointsRows([row(1, '2.50')], 'kom')[0].resultValue).toBe('2.5');
    const gc = [row(1, '3:00:02')];
    expect(normalizePointsRows(gc, 'gc')).toBe(gc);
  });
});
