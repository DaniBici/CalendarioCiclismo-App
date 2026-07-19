import { describe, it, expect } from 'vitest';
import { irmOf, normTime, buildStageRows, isEmptyRow, fnv1a }
  from '../../scripts/results-fetchers/domtel-results-fetch.mjs';

// Fuente: domtel-sport.pl (cronometrador POLACO). Datos verificados en vivo contra
// la Course de Solidarnosc et des Champions Olympiques 2026 (pid 8850), etapas 1 y 5.
// Contrato completo en scripts/results-fetchers/DOMTEL-TIMING-API.md.

describe('irmOf(czas, msc) — Domtel no tiene columna IRM: se busca en DOS campos', () => {
  // La firma toma dos argumentos porque el código de abandono puede venir en `Czas`
  // (lo normal) o en `Msc`; se concatenan y se busca por substring, replicando la
  // heurística del propio plugin WordPress (ptc / frontend-script.js).
  it('detecta el código en Czas (caso normal: Msc va vacío en abandonos)', () => {
    expect(irmOf('DNF', '')).toBe('DNF');
    expect(irmOf('DNS', '')).toBe('DNS');
    expect(irmOf('DSQ', '')).toBe('DSQ');
    expect(irmOf('DQ', '')).toBe('DSQ');
  });

  it('detecta el código también si viene en Msc', () => {
    expect(irmOf('', 'DNF')).toBe('DNF');
    expect(irmOf('', 'DNS')).toBe('DNS');
  });

  it('entiende el POLACO en texto, no solo las siglas', () => {
    expect(irmOf('nie ukończył', '')).toBe('DNF');       // "no terminó"
    expect(irmOf('nie wystartował', '')).toBe('DNS');    // "no salió"
    expect(irmOf('dyskwalifikacja', '')).toBe('DSQ');    // "descalificación"
  });

  it('normaliza mayúsculas y variantes de espaciado del polaco', () => {
    expect(irmOf('dnf', '')).toBe('DNF');
    expect(irmOf('Nie Ukonczyl', '')).toBe('DNF');       // sin diacríticos (NIE\s*UKO)
    expect(irmOf('nie  wystartowal', '')).toBe('DNS');   // doble espacio
  });

  it('PRIORIDAD: DNS y DSQ se comprueban ANTES que DNF', () => {
    // El orden importa: una fila que mezcle códigos no debe degradar a DNF.
    expect(irmOf('DNS', 'DNF')).toBe('DNS');
    expect(irmOf('DSQ', 'DNF')).toBe('DSQ');
  });

  it('un tiempo real NO es un abandono', () => {
    expect(irmOf('01:39:08', '1')).toBeNull();
    expect(irmOf('', '')).toBeNull();
    expect(irmOf(null, null)).toBeNull();
  });

  it('OTL no está mapeado en esta fuente → null (Domtel no lo publica)', () => {
    // Documentado: Domtel solo expone DNS/DNF/DSQ/DQ. Un "OTL" cae por el gate de
    // Msc numérico en buildStageRows, no se inventa un IRM que la fuente no da.
    expect(irmOf('OTL', '')).toBeNull();
  });

  it('un código DESCONOCIDO no se fuerza a ningún IRM', () => {
    expect(irmOf('XYZ', '')).toBeNull();
  });
});

describe('normTime — Czas → timeText', () => {
  it('recorta el cero de la hora inicial ("01:39:08" → "1:39:08")', () => {
    expect(normTime('01:39:08')).toBe('1:39:08');
    expect(normTime('1:39:08')).toBe('1:39:08');
    expect(normTime('04:21:02')).toBe('4:21:02');
  });

  it('vacío/null → null', () => {
    expect(normTime('')).toBeNull();
    expect(normTime(null)).toBeNull();
  });

  it('lo que no casa el patrón HH:MM:SS se devuelve TAL CUAL, no se descarta', () => {
    // Comportamiento real: normTime solo recorta la hora; si no reconoce el formato
    // deja pasar el valor crudo (en 'count' Czas es un contador de puntos entero).
    expect(normTime('12')).toBe('12');
    expect(normTime('abc')).toBe('abc');
  });
});

describe('isEmptyRow — etapa no corrida = todas sus filas vacías', () => {
  it('fila sin puesto, sin tiempo y sin gap = placeholder de etapa futura', () => {
    expect(isEmptyRow({ Msc: '', Czas: '', roznica: '' })).toBe(true);
    expect(isEmptyRow({})).toBe(true);
  });

  it('basta UN campo con dato para que la fila cuente', () => {
    expect(isEmptyRow({ Msc: '1', Czas: '', roznica: '' })).toBe(false);
    expect(isEmptyRow({ Msc: '', Czas: 'DNF', roznica: '' })).toBe(false);
  });
});

// ── buildStageRows ─────────────────────────────────────────────────────────
describe("buildStageRows mode 'time' — INVARIANTE del tiempo absoluto", () => {
  // Filas de la Course de Solidarnosc 2026 E1 (ganador BOGUSLAWSKI Marceli).
  const rows = [
    { Msc: '1', Numer: '11', Zawodnik: 'BOGUSLAWSKI Marceli', Team: 'Team A', Kraj: 'POL', Czas: '01:39:08', roznica: '' },
    { Msc: '2', Numer: '12', Zawodnik: 'KOWALSKI Jan', Team: 'Team B', Kraj: 'POL', Czas: '01:39:08', roznica: '' },
    { Msc: '3', Numer: '13', Zawodnik: 'NOWAK Piotr', Team: 'Team C', Kraj: 'POL', Czas: '01:40:23', roznica: '+1:15' },
    { Msc: '', Numer: '14', Zawodnik: 'STOSZ Patryk', Team: 'Team D', Kraj: 'POL', Czas: 'DNF', roznica: '' },
  ];

  it('TODA fila clasificada lleva timeText absoluto y NUNCA gapText', () => {
    // INVARIANTE CRÍTICO: Domtel da el Czas absoluto de todos los finishers (los del
    // mismo grupo comparten el del cabeza). La web solo entra en su "Caso A"
    // (deriveGaps, que pinta m.t. sola) si NINGUNA fila trae gapText → colar un gap
    // rompe deriveGaps para la clasificación ENTERA.
    const out = buildStageRows(rows, 'time');
    for (const r of out.filter((x) => !x.irm)) {
      expect(r.timeText).toMatch(/^\d+:\d{2}:\d{2}$/);
      expect(r.gapText).toBeNull();
    }
    expect(out.every((r) => r.gapText === null)).toBe(true);
  });

  it('el gap `roznica` se IGNORA aunque venga poblado', () => {
    const third = buildStageRows(rows, 'time')[2];
    expect(third.timeText).toBe('1:40:23');
    expect(third.gapText).toBeNull();
  });

  it('los del mismo grupo comparten el tiempo del cabeza (m.t. lo deriva la web)', () => {
    const [w, second] = buildStageRows(rows, 'time');
    expect(w.timeText).toBe('1:39:08');
    expect(second.timeText).toBe('1:39:08');
  });

  it('emite dorsal, display y equipo del feed', () => {
    const [w] = buildStageRows(rows, 'time');
    expect(w).toMatchObject({
      rank: 1, rankText: '1', bib: '11',
      riderDisplay: 'BOGUSLAWSKI Marceli', teamName: 'Team A',
    });
  });

  it('un abandono sale como IRM sin puesto ni tiempo, conservando el dorsal', () => {
    const dnf = buildStageRows(rows, 'time')[3];
    expect(dnf).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '14',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('una fila SIN puesto y SIN IRM se descarta (placeholder de etapa futura)', () => {
    const out = buildStageRows([{ Msc: '', Numer: '99', Zawodnik: 'X Y', Czas: '', roznica: '' }], 'time');
    expect(out).toEqual([]);
  });

  it('un Msc no numérico sin IRM se descarta (no se fuerza un rank)', () => {
    const out = buildStageRows([{ Msc: '-', Numer: '99', Zawodnik: 'X Y', Czas: '', roznica: '' }], 'time');
    expect(out).toEqual([]);
  });

  it('lista vacía → []', () => {
    expect(buildStageRows([], 'time')).toEqual([]);
  });
});

describe("buildStageRows mode 'count' — GENERAL POINTS / GENERAL SPRINT", () => {
  // En estas clasificaciones `Czas` NO es un tiempo: es el contador de puntos o
  // esprints ganados. Tratarlo como tiempo metería basura en timeText.
  const rows = [
    { Msc: '1', Numer: '14', Zawodnik: 'STOSZ Patryk', Team: 'Team D', Czas: '16', roznica: '' },
    { Msc: '2', Numer: '11', Zawodnik: 'BOGUSLAWSKI Marceli', Team: 'Team A', Czas: '9', roznica: '' },
  ];

  it('el contador va a resultValue y points; nunca a timeText', () => {
    const [w] = buildStageRows(rows, 'count');
    expect(w).toMatchObject({
      rank: 1, bib: '14', resultValue: '16', points: 16,
      timeText: null, gapText: null,
    });
  });

  it("en 'count' NO se busca IRM: un Czas raro no se lee como abandono", () => {
    // El contador es un entero; aplicar irmOf aquí podría convertir un valor
    // cualquiera en un falso DNF.
    const out = buildStageRows([{ Msc: '1', Numer: '1', Zawodnik: 'X Y', Czas: 'DNF', roznica: '' }], 'count');
    expect(out[0].irm).toBeNull();
    expect(out[0].rank).toBe(1);
  });

  it('un contador no numérico deja points en null pero conserva resultValue', () => {
    const [row] = buildStageRows([{ Msc: '1', Numer: '1', Zawodnik: 'X Y', Czas: 'abc', roznica: '' }], 'count');
    expect(row).toMatchObject({ resultValue: 'abc', points: null });
  });
});

describe('fnv1a — IDs sintéticos deterministas', () => {
  it('reproduce el competitionId real de la Course de Solidarnosc 2026 (-137279)', () => {
    // El valor documentado y en producción (pid 8850). Si esto cambia, se rompen
    // los IDs de todo lo ya volcado desde esta fuente.
    expect(-(fnv1a('domtel:8850') % 200000)).toBe(-137279);
  });

  it('es estable y distinto por pid', () => {
    expect(fnv1a('domtel:8850')).toBe(fnv1a('domtel:8850'));
    expect(fnv1a('domtel:8850')).not.toBe(fnv1a('domtel:8851'));
  });
});
