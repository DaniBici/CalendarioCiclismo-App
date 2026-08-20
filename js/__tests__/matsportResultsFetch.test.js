import { describe, it, expect } from 'vitest';
import { irmOf, normGap, normAbsTime, normPoints, mapRows, fnv1a }
  from '../../scripts/results-fetchers/matsport-results-fetch.mjs';

// Datos verificados contra la API en vivo el 2026-07-17:
// GET api.cycling.matsport.com/stages/2026_PYF_STAGE_02
// (CIC Tour Féminin des Pyrénées 2026, etapa 2, 120 filas ITE / 21 ETE).
// Contrato completo en scripts/results-fetchers/MATSPORT-TIMING-API.md.

describe('irmOf — status francés → IRM UCI', () => {
  it('mapea los códigos franceses', () => {
    expect(irmOf('AB')).toBe('DNF');     // abandon
    expect(irmOf('ABD')).toBe('DNF');
    expect(irmOf('NP')).toBe('DNS');     // non partant
    expect(irmOf('HD')).toBe('OTL');     // hors délai
    expect(irmOf('DSQ')).toBe('DSQ');
    expect(irmOf('EX')).toBe('DSQ');     // exclu
  });

  it('acepta los códigos que ya vienen en formato UCI', () => {
    expect(irmOf('DNF')).toBe('DNF');
    expect(irmOf('DNS')).toBe('DNS');
    expect(irmOf('OTL')).toBe('OTL');
  });

  it('status vacío = clasificado (117 de las 120 filas del PYF E2)', () => {
    expect(irmOf('')).toBeNull();
    expect(irmOf(null)).toBeNull();
    expect(irmOf('  ')).toBeNull();
  });

  it('normaliza mayúsculas y espacios', () => {
    expect(irmOf('ab')).toBe('DNF');
    expect(irmOf(' NP ')).toBe('DNS');
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

  it('reconstruye display y equipo por dorsal (las filas no traen nombre)', () => {
    const [w] = mapRows(rankings, SPEC_TIME, riderByBib, teamByNumber);
    expect(w.riderDisplay).toBe('PIETERS Amy');
    expect(w.teamName).toBe('AG INSURANCE - SOUDAL');
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

describe('fnv1a — IDs sintéticos deterministas', () => {
  it('reproduce el competitionId real del Tour de los Pirineos 2026 (-451)', () => {
    // El valor que está en race_uci_links.competitionId en producción. Si esto
    // cambia, se rompen los IDs de todo lo ya volcado desde esta fuente.
    expect(-(fnv1a('matsport:2026_PYF') % 200000)).toBe(-451);
  });

  it('es estable y distinto por competición', () => {
    expect(fnv1a('matsport:2026_PYF')).toBe(fnv1a('matsport:2026_PYF'));
    expect(fnv1a('matsport:2026_PYF')).not.toBe(fnv1a('matsport:2027_PYF'));
  });
});
