import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  parsePlace, cleanName, normAbsTime, normGap, normPoints, bibOf,
  mapStageRows, mapTimeGeneralRows, mapPointsRows, isGeneralConfirmed,
} from '../results-fetchers/livetiming-results-fetch.mjs';

// Fuente: livetiming.at (cronometrador AUSTRIACO). Datos verificados contra el
// LIDL Tour of Austria 2026 (V_ID 260708, etapa 1 Graz→Gamlitz) y etapas 2025.
// Contrato completo en scripts/results-fetchers/LIVETIMING-API.md.

describe('parsePlace — columna Place → rank | IRM', () => {
  it('un puesto numérico da rank', () => {
    expect(parsePlace('1')).toEqual({ rank: 1 });
    expect(parsePlace('97')).toEqual({ rank: 97 });
  });

  it('tolera el punto del ordinal alemán ("1." Platz)', () => {
    expect(parsePlace('1.')).toEqual({ rank: 1 });
  });

  it('el IRM ocupa la columna Place; mapea los códigos austriacos/alemanes', () => {
    // Peculiaridad de esta fuente: el IRM ocupa el sitio del puesto (en FF con
    // Time/Gap a "-"), así que Place es a la vez rank y estado.
    expect(parsePlace('DNF')).toEqual({ irm: 'DNF' });
    expect(parsePlace('AB')).toEqual({ irm: 'DNF' });    // Aufgabe / abandono
    expect(parsePlace('HD')).toEqual({ irm: 'OTL' });    // hors délai / Karenzzeit
    expect(parsePlace('dnf')).toEqual({ irm: 'DNF' });
  });

  it('un código DESCONOCIDO se conserva en crudo, no se inventa un mapeo', () => {
    expect(parsePlace('XYZ')).toEqual({ irm: 'XYZ' });
  });

  it('vacío/null = sin puesto ni IRM (ni rank ni irm)', () => {
    expect(parsePlace('')).toEqual({});
    expect(parsePlace(null)).toEqual({});
    expect(parsePlace('  ')).toEqual({});
  });
});

describe('cleanName — display del corredor', () => {
  it('quita el asterisco de sub23 y respeta el orden UCI ya dado', () => {
    // livetiming ya manda "APELLIDO Nombre" → no hay que reordenar.
    expect(cleanName('*ALVAREZ MARTINEZ Hector', '51')).toBe('ALVAREZ MARTINEZ Hector');
    expect(cleanName('MÜHLBERGER Gregor', '211')).toBe('MÜHLBERGER Gregor');
  });

  it('BUG REAL: nombre VACÍO → "#<dorsal>", porque riderDisplay es NOT NULL en BD', () => {
    // Caso vivido: Tour of Austria 2026 E1, dorsal 172 llegó con Name="".
    // Sin este fallback el primer volcado revienta contra el NOT NULL de
    // riderDisplay y tumba la etapa entera. El resolve por dorsal (082) luego
    // sobrescribe el "#172" con el nombre real de la startlist curada.
    expect(cleanName('', '172')).toBe('#172');
    expect(cleanName(null, '172')).toBe('#172');
    expect(cleanName('   ', '172')).toBe('#172');
  });

  it('sin nombre y sin dorsal cae a "N/A" — nunca null (NOT NULL en BD)', () => {
    expect(cleanName('', null)).toBe('N/A');
    expect(cleanName(null, null)).toBe('N/A');
  });
});

describe('normAbsTime — tiempo absoluto → timeText', () => {
  it('acepta el formato de BD tal cual (Tour of Austria 2026 E1: 4:21:02)', () => {
    expect(normAbsTime('4:21:02')).toBe('4:21:02');
    expect(normAbsTime('4:20:52')).toBe('4:20:52');
    expect(normAbsTime('53:29')).toBe('53:29');
  });

  it('"-" (m.t. / abandono) y vacío → null', () => {
    expect(normAbsTime('-')).toBeNull();
    expect(normAbsTime('')).toBeNull();
    expect(normAbsTime(null)).toBeNull();
  });

  it('un gap NO es un tiempo absoluto', () => {
    // En GC el mismo campo `Time` trae absoluto (rank1) o gap (resto) → esta
    // función tiene que distinguirlos o el gap acabaría en timeText.
    expect(normAbsTime('+0:15')).toBeNull();
    expect(normAbsTime('+25:57')).toBeNull();
  });
});

describe('normGap — gap de GC/YU → estilo UCI', () => {
  it('recorta los ceros de cabeza superfluos (+0:15 → +15)', () => {
    expect(normGap('+0:15')).toBe('+15');
    expect(normGap('+0:00')).toBe('+0');
  });

  it('retira los corchetes del Gap de FF ("+[0:00:11]")', () => {
    // Formato propio de la clasificación de etapa. Aunque mapStageRows no use el
    // Gap de FF, la normalización tiene que entenderlo si alguien lo lee.
    expect(normGap('+[0:00:11]')).toBe('+11');
  });

  it('"-" = mismo tiempo, vacío o absoluto sin "+" → null', () => {
    expect(normGap('-')).toBeNull();
    expect(normGap('')).toBeNull();
    expect(normGap('4:21:02')).toBeNull();
  });
});

describe('normPoints — Points → resultValue', () => {
  it('extrae el número (Tour of Austria 2026: PT "15", GP "14")', () => {
    expect(normPoints('15')).toBe('15');
    expect(normPoints('14')).toBe('14');
    expect(normPoints('15 pts')).toBe('15');
    expect(normPoints('1 pt')).toBe('1');
  });

  it('rechaza lo que no son puntos', () => {
    expect(normPoints('4:21:02')).toBeNull();
    expect(normPoints('')).toBeNull();
    expect(normPoints(null)).toBeNull();
  });
});

describe('bibOf — BIB → dorsal', () => {
  it('acepta el dorsal numérico (clave del resolve 082)', () => {
    expect(bibOf({ BIB: '211' })).toBe('211');
    expect(bibOf({ BIB: 211 })).toBe('211');
  });

  it('un BIB no numérico o ausente → null, nunca un dorsal inventado', () => {
    expect(bibOf({ BIB: '' })).toBeNull();
    expect(bibOf({ BIB: 'X' })).toBeNull();
    expect(bibOf({})).toBeNull();
  });
});

// ── mapStageRows (FF) ──────────────────────────────────────────────────────
describe('mapStageRows — FF (etapa): INVARIANTE del tiempo absoluto', () => {
  // Filas del LIDL Tour of Austria 2026 E1 (V_ID 260708).
  const ff = [
    { Place: '1', BIB: '211', Name: 'MÜHLBERGER Gregor', Team: 'AUT', Time: '4:21:02', Gap: '4:21:02' },
    { Place: '2', BIB: '75', Name: 'ZWIEHOFF Ben', Team: 'UEX', Time: '4:21:02', Gap: '-' },
    { Place: '3', BIB: '51', Name: '*ALVAREZ MARTINEZ Hector', Team: 'ESP', Time: '4:21:13', Gap: '+[0:00:11]' },
    { Place: 'DNF', BIB: '99', Name: 'ABANDONA Fulano', Team: 'AUT', Time: '-', Gap: '-' },
  ];

  it('TODA fila clasificada lleva su tiempo ABSOLUTO en timeText, NUNCA gapText', () => {
    // INVARIANTE CRÍTICO (igual que STS/Wiclax): livetiming da el absoluto de CADA
    // corredor en FF. La web solo entra en su "Caso A" (deriveGaps, que pinta m.t.
    // sola) si NINGUNA fila trae gapText; colar un gap aquí rompe deriveGaps para
    // TODA la clasificación, no solo esa fila.
    const rows = mapStageRows(ff);
    for (const r of rows.filter((x) => !x.irm)) {
      expect(r.timeText).toMatch(/^\d+:\d{2}:\d{2}$/);
      expect(r.gapText).toBeNull();
    }
    expect(rows.every((r) => r.gapText === null)).toBe(true);
  });

  it('los del mismo grupo comparten el tiempo del cabeza (m.t. lo deriva la web)', () => {
    const [w, second] = mapStageRows(ff);
    expect(w.timeText).toBe('4:21:02');
    expect(second.timeText).toBe('4:21:02');   // Gap "-" = m.t., pero se emite el absoluto
    expect(second.gapText).toBeNull();
  });

  it('el Gap de FF se IGNORA aunque venga poblado (+[0:00:11])', () => {
    const third = mapStageRows(ff)[2];
    expect(third.timeText).toBe('4:21:13');
    expect(third.gapText).toBeNull();
  });

  it('emite dorsal y display; el asterisco sub23 fuera', () => {
    const third = mapStageRows(ff)[2];
    expect(third).toMatchObject({ rank: 3, rankText: '3', bib: '51', riderDisplay: 'ALVAREZ MARTINEZ Hector' });
  });

  it('un abandono sale como IRM, sin puesto ni tiempo', () => {
    const dnf = mapStageRows(ff)[3];
    expect(dnf).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '99',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('el equipo NO se toma del feed: sale de la startlist por dorsal', () => {
    // El Team de 3 letras (AUT/UEX) es del cronometrador, no el equipo real.
    expect(mapStageRows(ff).every((r) => r.teamName === null)).toBe(true);
  });
});

// ── mapTimeGeneralRows (GC/YU) ─────────────────────────────────────────────
describe('mapTimeGeneralRows — GC/YU: absoluto al rank 1, gap al resto', () => {
  // Contrato OPUESTO al de FF: aquí livetiming solo da absoluto al líder.
  const gc = [
    { markTime: 'bggrn', Place: '1', BIB: '211', Name: 'MÜHLBERGER Gregor', Time: '4:20:52' },
    { markTime: 'bggrn', Place: '2', BIB: '75', Name: 'ZWIEHOFF Ben', Time: '+0:15' },
    { markTime: 'bggrn', Place: '3', BIB: '51', Name: '*ALVAREZ MARTINEZ Hector', Time: '+25:57' },
    { markTime: 'bgred', Place: 'DNF', BIB: '99', Name: 'ABANDONA Fulano', Time: '-' },
  ];

  it('el rank 1 lleva timeText absoluto y NO gap', () => {
    const [w] = mapTimeGeneralRows(gc);
    expect(w).toMatchObject({ rank: 1, timeText: '4:20:52', gapText: null, resultValue: '4:20:52' });
  });

  it('el resto lleva gapText normalizado y NO timeText', () => {
    const [, second, third] = mapTimeGeneralRows(gc);
    expect(second).toMatchObject({ rank: 2, timeText: null, gapText: '+15', resultValue: '+15' });
    expect(third).toMatchObject({ rank: 3, timeText: null, gapText: '+25:57' });
  });

  it('propaga markTime CRUDO (lo necesita el filtro de general confirmada)', () => {
    const rows = mapTimeGeneralRows(gc);
    expect(rows[0].markTime).toBe('bggrn');
    expect(rows[3].markTime).toBe('bgred');
  });
});

describe('mapPointsRows — PT/GP', () => {
  const pt = [
    { markTime: 'bggrn', Place: '1', BIB: '211', Name: 'MÜHLBERGER Gregor', Points: '15' },
    { markTime: 'bgyel', Place: '2', BIB: '75', Name: 'ZWIEHOFF Ben', Points: '14' },
  ];

  it('emite los puntos en resultValue, sin tiempo ni gap', () => {
    const [w] = mapPointsRows(pt);
    expect(w).toMatchObject({ rank: 1, bib: '211', resultValue: '15', timeText: null, gapText: null });
  });

  it('propaga markTime para el filtro de confirmación', () => {
    expect(mapPointsRows(pt).map((r) => r.markTime)).toEqual(['bggrn', 'bgyel']);
  });
});

// ── isGeneralConfirmed ─────────────────────────────────────────────────────
describe('isGeneralConfirmed — solo se vuelca la general que validó el jurado', () => {
  const row = (markTime, extra = {}) => ({ rank: 1, irm: null, markTime, ...extra });

  it('todas las clasificadas en verde → confirmada', () => {
    expect(isGeneralConfirmed([row('bggrn'), row('bggrn')])).toBe(true);
  });

  it('una provisional (amarillo) o en carrera (rojo) → NO confirmada', () => {
    // Con la etapa en curso la general es provisional: volcarla pintaría una
    // clasificación no oficial.
    expect(isGeneralConfirmed([row('bggrn'), row('bgyel')])).toBe(false);
    expect(isGeneralConfirmed([row('bggrn'), row('bgred')])).toBe(false);
  });

  it('los ABANDONOS se ignoran: livetiming los deja en rojo PARA SIEMPRE', () => {
    // Sin esta exclusión ninguna general se confirmaría jamás — toda etapa tiene
    // abandonos y su bgred no cambia nunca.
    const rows = [row('bggrn'), row('bggrn'), { rank: null, irm: 'DNF', markTime: 'bgred' }];
    expect(isGeneralConfirmed(rows)).toBe(true);
  });

  it('solo abandonos (0 clasificadas) → NO confirmada', () => {
    // Un every() sobre lista vacía sería true → publicaría una general vacía.
    expect(isGeneralConfirmed([{ rank: null, irm: 'DNF', markTime: 'bgred' }])).toBe(false);
    expect(isGeneralConfirmed([])).toBe(false);
  });
});

describe('--suggest-id — competitionId sintético', () => {
  it('reproduce el competitionId real de la Vuelta a Austria 2026 (-104960)', () => {
    // Valor en producción (V_ID base 260708). Si cambia, se duplican los IDs ya volcados.
    const out = execFileSync(process.execPath, ['scripts/results-fetchers/livetiming-results-fetch.mjs', '--vid', '260708', '--suggest-id'], { encoding: 'utf8' });
    expect(out.trim()).toBe('-104960');
  });
});
