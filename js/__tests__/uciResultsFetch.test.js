import { describe, it, expect } from 'vitest';
import { fixInvertedAbsoluteGaps, fixDisguisedGaps, fixPressFormattedAbsolute, _toSeconds, _pressToSeconds }
  from '../../scripts/results-fetchers/uci-results-fetch.mjs';

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

describe('_toSeconds', () => {
  it('parsea H:MM:SS, MM:SS y SS', () => {
    expect(_toSeconds('3:02:30')).toBe(10950);
    expect(_toSeconds('4:42')).toBe(282);
    expect(_toSeconds('5')).toBe(5);
    expect(_toSeconds(null)).toBeNull();
  });
});

describe('_pressToSeconds — notación de prensa de la UCI', () => {
  it('parsea "H h M\'SS\\"", "M\'SS\\"" y "SS\\""', () => {
    expect(_pressToSeconds("3h 00'02\"")).toBe(3 * 3600 + 2);
    expect(_pressToSeconds("3h 01'56\"")).toBe(3 * 3600 + 116);
    expect(_pressToSeconds("20'52\"")).toBe(20 * 60 + 52);
    expect(_pressToSeconds("42\"")).toBe(42);
    expect(_pressToSeconds(null)).toBeNull();
  });
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
