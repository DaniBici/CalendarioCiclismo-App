import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { irmOf, normGap, normAbsTime, normPoints, mapRows, matsportIdSeed, tailStartersFinished, localNow }
  from '../results-fetchers/matsport-results-fetch.mjs';

// Datos verificados contra la API en vivo el 2026-07-17:
// GET api.cycling.matsport.com/stages/2026_PYF_STAGE_02
// (CIC Tour Féminin des Pyrénées 2026, etapa 2, 120 filas ITE / 21 ETE).
// Contrato completo en scripts/results-fetchers/MATSPORT-TIMING-API.md.

describe('irmOf — status francés → IRM UCI', () => {
  it('mapea los códigos franceses y normaliza mayúsculas y espacios', () => {
    expect(irmOf('AB')).toBe('DNF');     // abandon
    expect(irmOf('HD')).toBe('OTL');     // hors délai
    expect(irmOf('EX')).toBe('DSQ');     // exclu
    expect(irmOf(' np ')).toBe('DNS');   // non partant
  });

  it('status vacío = clasificado (117 de las 120 filas del PYF E2)', () => {
    expect(irmOf('')).toBeNull();
    expect(irmOf(null)).toBeNull();
    expect(irmOf('  ')).toBeNull();
  });

  it('un código DESCONOCIDO se conserva en crudo, no se inventa un mapeo', () => {
    expect(irmOf('XYZ')).toBe('XYZ');
  });
});

describe('normGap — gap Matsport → estilo UCI en BD', () => {
  it('quita el cero a la izquierda de los segundos', () => {
    expect(normGap('+00')).toBe('+0');
    expect(normGap('+05')).toBe('+5');
    expect(normGap('+27')).toBe('+27');
  });

  it('conserva minutos y horas tal cual (PYF E2: +1:59)', () => {
    expect(normGap('+1:59')).toBe('+1:59');
    expect(normGap('+1:22')).toBe('+1:22');
    expect(normGap('+1:02:03')).toBe('+1:02:03');
  });

  it('devuelve null si no es un gap', () => {
    expect(normGap(null)).toBeNull();
    expect(normGap('')).toBeNull();
    expect(normGap('2:42:15')).toBeNull();   // tiempo absoluto, no gap
    expect(normGap('78 pts')).toBeNull();    // en puntos, gap duplica capital
  });
});

describe('normAbsTime — capital → timeText', () => {
  it('acepta el formato de BD tal cual (PYF E2: 2:42:15)', () => {
    expect(normAbsTime('2:42:15')).toBe('2:42:15');
    expect(normAbsTime('10:15:27')).toBe('10:15:27');
    expect(normAbsTime('44:02')).toBe('44:02');
  });

  it('trunca centésimas y un punto final publicados por Matsport', () => {
    expect(normAbsTime('26:49.95')).toBe('26:49');
    expect(normAbsTime('1:02:03.45')).toBe('1:02:03');
    expect(normAbsTime('12:10:10.')).toBe('12:10:10');
  });

  it('rechaza lo que no es tiempo', () => {
    expect(normAbsTime('78 pts')).toBeNull();
    expect(normAbsTime(null)).toBeNull();
    expect(normAbsTime('')).toBeNull();
  });
});

describe('normPoints — capital → resultValue', () => {
  it('extrae el número (PYF E2 IPG: "78 pts")', () => {
    expect(normPoints('78 pts')).toBe('78');
    expect(normPoints('61 pts')).toBe('61');
    expect(normPoints('1 pt')).toBe('1');
    expect(normPoints('48')).toBe('48');
  });

  it('rechaza lo que no son puntos', () => {
    expect(normPoints('2:42:15')).toBeNull();
    expect(normPoints(null)).toBeNull();
  });
});

// ── mapRows ────────────────────────────────────────────────────────────────
// Índices tal como los construye main() desde GET /competitions/2026_PYF.
const riderByBib = new Map([
  [21, { display: 'PIETERS Amy', teamName: 'AG INSURANCE - SOUDAL' }],
  [22, { display: 'VOLLERING Demi', teamName: 'AG INSURANCE - SOUDAL' }],
  [1, { display: 'OSTOLAZA ZABALA Usoa', teamName: 'LABORAL KUTXA - FUNDACION EUSKADI' }],
  [182, { display: 'GARCIA Maria', teamName: 'CERATIZIT' }],
]);
// teams[].position → nombre. OJO: 1, 3 y 6 son TAMBIÉN dorsales de corredoras.
const teamByNumber = new Map([
  [1, 'LABORAL KUTXA - FUNDACION EUSKADI'],
  [3, 'UAE TEAM ADQ'],
  [6, 'VOLKERWESSELS CYCLING TEAM'],
]);

const SPEC_TIME = { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification', time: true };
const SPEC_POINTS = { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' };
const SPEC_TEAMS = { classKind: 'teams', scope: 'stage', eventName: 'Stage Teams Classification', time: true, teamRows: true };

describe('mapRows — clasificación por tiempos (ITE)', () => {
  // Filas textuales del PYF 2026 E2.
  const rankings = [
    { bib: 21, position: 1, capital: '2:42:15', gap: '+00', status: '' },
    { bib: 22, position: 2, capital: '2:44:14', gap: '+1:59', status: '' },
    { bib: 182, position: -1, capital: null, gap: null, status: 'AB' },
  ];

  it('el ganador lleva timeText absoluto y NUNCA gapText (la API manda "+00")', () => {
    const [w] = mapRows(rankings, SPEC_TIME, riderByBib, teamByNumber);
    expect(w).toMatchObject({
      rank: 1, rankText: '1', bib: '21', riderDisplay: 'PIETERS Amy',
      timeText: '2:42:15', gapText: null, irm: null,
    });
  });

  it('el resto lleva gapText y NO timeText', () => {
    const [, second] = mapRows(rankings, SPEC_TIME, riderByBib, teamByNumber);
    expect(second).toMatchObject({
      rank: 2, rankText: '2', bib: '22', timeText: null, gapText: '+1:59',
    });
  });

  it('un abandono (status AB, position -1) sale como IRM sin tiempo ni puesto', () => {
    const [, , ab] = mapRows(rankings, SPEC_TIME, riderByBib, teamByNumber);
    expect(ab).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '182',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('un dorsal que no está en la startlist no rompe: display/teamName a null', () => {
    const [row] = mapRows(
      [{ bib: 999, position: 1, capital: '2:42:15', gap: '+00', status: '' }],
      SPEC_TIME, riderByBib, teamByNumber,
    );
    expect(row).toMatchObject({ bib: '999', riderDisplay: null, teamName: null, timeText: '2:42:15' });
  });
});

describe('mapRows — clasificación por puntos (IPG)', () => {
  it('emite el número en resultValue, sin tiempo', () => {
    const [row] = mapRows(
      [{ bib: 21, position: 1, capital: '78 pts', gap: '78 pts', status: '' }],
      SPEC_POINTS, riderByBib, teamByNumber,
    );
    expect(row).toMatchObject({
      rank: 1, bib: '21', resultValue: '78', timeText: null, gapText: null,
    });
  });
});

describe('mapRows — filas de EQUIPO (ETE/ETG): el bib es un NÚMERO DE EQUIPO', () => {
  // El gotcha grave de esta fuente. En ETE, bib = teams[].position, y colisiona con
  // dorsales reales de la MISMA carrera: en el PYF 2026, bib=3 es "UAE TEAM ADQ" y
  // a la vez el dorsal de una corredora. Emitir ese bib haría que
  // resolve_uci_results (RPC 082) casara la fila del equipo con esa corredora.
  const rankings = [
    { bib: 3, position: 1, capital: '8:19:31', gap: '+00', status: '' },
    { bib: 6, position: 2, capital: '8:20:54', gap: '+1:23', status: '' },
  ];

  it('emite bib NULL — nunca el número de equipo', () => {
    const rows = mapRows(rankings, SPEC_TEAMS, riderByBib, teamByNumber);
    expect(rows[0].bib).toBeNull();
    expect(rows[1].bib).toBeNull();
  });

  it('traduce el número al nombre del equipo, no al del corredor de ese dorsal', () => {
    const rows = mapRows(rankings, SPEC_TEAMS, riderByBib, teamByNumber);
    // bib=3 → "UAE TEAM ADQ" (equipo 3), NO el corredor con dorsal 3.
    expect(rows[0]).toMatchObject({ riderDisplay: 'UAE TEAM ADQ', teamName: 'UAE TEAM ADQ' });
    expect(rows[1]).toMatchObject({ riderDisplay: 'VOLKERWESSELS CYCLING TEAM' });
  });

  it('el equipo ganador lleva tiempo absoluto; el resto, gap', () => {
    const rows = mapRows(rankings, SPEC_TEAMS, riderByBib, teamByNumber);
    expect(rows[0]).toMatchObject({ rank: 1, timeText: '8:19:31', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, timeText: null, gapText: '+1:23' });
  });

  it('un equipo sin nombre en el índice cae a "Team N", sin arrastrar un dorsal', () => {
    const [row] = mapRows(
      [{ bib: 99, position: 1, capital: '8:19:31', gap: '+00', status: '' }],
      SPEC_TEAMS, riderByBib, teamByNumber,
    );
    expect(row).toMatchObject({ bib: null, riderDisplay: 'Team 99' });
  });
});

describe('mapRows — gaps con décimas (Chrono des Nations, PAS_A)', () => {
  it('reconstruye el gap con los tiempos truncados', () => {
    const rows = mapRows([
      { bib: 501, position: 1, capital: '31:49.50', gap: '+00', status: null },
      { bib: 504, position: 2, capital: '31:53.00', gap: '+03.50', status: null },
      { bib: 503, position: 4, capital: '32:50.11', gap: '+1:00.61', status: null },
    ], SPEC_TIME, new Map(), new Map());
    expect(rows.map((r) => r.gapText)).toEqual([null, '+4', '+1:01']);
  });
});

describe('tailStartersFinished — fin de una crono sin ITE', () => {
  // Salida de 1 minuto, los dorsales bajos salen los últimos (sub-23: 501 a las 13:51).
  const arr = (bib) => {
    const start = (13 * 60 + 51 - (bib - 501)) * 60;
    const cap = 1900 + bib;
    const t = (n) => `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    return { bib, position: 1, capital: `${Math.floor(cap / 60)}:${String(cap % 60).padStart(2, '0')}`, hour: t(start + cap), status: null };
  };
  const field = [501, 502, 503, 504, 505, 506, 507, 508];
  it('no termina mientras falte alguno de los tres últimos en salir', () => {
    const r = tailStartersFinished([508, 507, 506, 505, 504, 503, 502].map(arr), field);
    expect(r.done).toBe(false);
    expect(r.reason).toContain('501');
  });
  it('termina cuando los tres últimos en salir (dorsales más bajos) tienen meta', () => {
    expect(tailStartersFinished([508, 507, 506, 505, 504, 503, 502, 501].map(arr), field).done).toBe(true);
  });
  it('un abandono de los últimos cuenta como resuelto', () => {
    const rows = [508, 507, 506, 505, 504, 503, 502].map(arr);
    rows.push({ bib: 501, position: -1, capital: null, hour: null, status: 'AB' });
    expect(tailStartersFinished(rows, field).done).toBe(true);
  });
  it('baja sin marcar entre los últimos: cierra solo con nadie en carrera y la llegada esperada vencida', () => {
    const rows = [508, 507, 506, 505, 504, 503, 502].map(arr);   // falta el 501 (sale a las 13:51)
    const stageDate = '2026-10-18';
    const at = (hh, mm) => ({ date: stageDate, secs: hh * 3600 + mm * 60 });
    const base = { stageDate, running: false };
    expect(tailStartersFinished(rows, field, { ...base, now: at(14, 0) }).done).toBe(false);
    expect(tailStartersFinished(rows, field, { ...base, now: at(15, 0), running: true }).done).toBe(false);
    expect(tailStartersFinished(rows, field, { ...base, now: at(15, 0) }).done).toBe(true);
    expect(tailStartersFinished(rows, field, { ...base, now: { date: '2026-10-19', secs: 0 } }).done).toBe(true);
    expect(tailStartersFinished(rows, field, { stageDate, now: at(15, 0) }).done).toBe(false);
  });
  it('no afirma nada con pocas llegadas ni con un orden de salida incoherente', () => {
    expect(tailStartersFinished([503, 502, 501].map(arr), field).done).toBe(false);
    const mix = [508, 507, 506, 505].map(arr);
    mix[1].hour = '14:00:00';
    expect(tailStartersFinished(mix, field).done).toBe(false);
  });
});

describe('localNow', () => {
  it('devuelve fecha y segundos en la zona pedida', () => {
    expect(localNow('Europe/Paris', new Date('2026-10-18T13:04:20Z'))).toEqual({ date: '2026-10-18', secs: 15 * 3600 + 4 * 60 + 20 });
  });
});

describe('--suggest-id — competitionId sintético', () => {
  it('reproduce el competitionId real del Tour de los Pirineos 2026 (-451)', () => {
    // Valor en producción. Si cambia, se duplican los IDs ya volcados desde esta fuente.
    const out = execFileSync(process.execPath, ['scripts/results-fetchers/matsport-results-fetch.mjs', '--competition', '2026_PYF', '--suggest-id'], { encoding: 'utf8' });
    expect(out.trim()).toBe('-451');
  });

  it('--matsport-stage cambia la semilla: cada prueba de la multiprueba tiene su competitionId', () => {
    const run = (extra = []) => execFileSync(process.execPath, ['scripts/results-fetchers/matsport-results-fetch.mjs', '--competition', '2026_HER', '--suggest-id', ...extra], { encoding: 'utf8' }).trim();
    const ids = [run(), run(['--matsport-stage', '5']), run(['--matsport-stage', '6']), run(['--matsport-stage', '7'])];
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => /^-\d+$/.test(id))).toBe(true);
  });
});

describe('matsportIdSeed', () => {
  it('sin etapa conserva la semilla histórica; con etapa añade #etapa', () => {
    expect(matsportIdSeed('2026_PYF')).toBe('matsport:2026_PYF');
    expect(matsportIdSeed('2026_HER', 7)).toBe('matsport:2026_HER#7');
  });
});
