import { describe, it, expect } from 'vitest';
import { cellText, parseRankCell, normAbsTime, normGap, normPoints, reorderName, colsByWidth, mapRows, flattenData, fnv1a }
  from '../../scripts/results-fetchers/raceresult-results-fetch.mjs';

// Datos verificados contra Tour of Norway 2025 (eventId 334313, EventOver) y
// Tour of Slovenia 2026 (eventId 402988, la primera carrera conmutada a esta fuente).
// Contrato completo en scripts/results-fetchers/RACERESULT-TIMING-API.md.

describe('cellText — las imágenes son celdas vacías', () => {
  // Banderas y maillots llegan como "[img:...]" en columnas de texto. Sin este filtro,
  // el display de un corredor podría acabar siendo la ruta de su bandera.
  it('trata una celda que es solo imagen como vacía', () => {
    expect(cellText('[img:flags/no.png]')).toBe('');
    expect(cellText('[IMG:jersey.png]')).toBe('');   // insensible a mayúsculas
  });

  it('conserva el texto real y lo normaliza', () => {
    expect(cellText('James BRENNAN')).toBe('James BRENNAN');
    expect(cellText('  x  ')).toBe('x');
    expect(cellText(null)).toBe('');
  });
});

describe('parseRankCell — col [2]: puesto, IRM o estado transitorio', () => {
  it('"1." → rank 1 (se quita el punto)', () => {
    expect(parseRankCell('1.')).toEqual({ rank: 1 });
    expect(parseRankCell('12')).toEqual({ rank: 12 });
  });

  it('mapea los IRM del feed a códigos UCI', () => {
    // El IRM_MAP real de esta fuente. Un mapeo mal hecho deja al abandonado como
    // clasificado (o al revés).
    expect(parseRankCell('DNF')).toEqual({ irm: 'DNF' });
    expect(parseRankCell('AB')).toEqual({ irm: 'DNF' });
    expect(parseRankCell('ABD')).toEqual({ irm: 'DNF' });
    expect(parseRankCell('DNS')).toEqual({ irm: 'DNS' });
    expect(parseRankCell('NP')).toEqual({ irm: 'DNS' });
    expect(parseRankCell('DSQ')).toEqual({ irm: 'DSQ' });
    expect(parseRankCell('DQ')).toEqual({ irm: 'DSQ' });
    expect(parseRankCell('EX')).toEqual({ irm: 'DSQ' });
    expect(parseRankCell('OTL')).toEqual({ irm: 'OTL' });
    expect(parseRankCell('HD')).toEqual({ irm: 'OTL' });
    expect(parseRankCell('OOT')).toEqual({ irm: 'OTL' });
  });

  it('normaliza minúsculas', () => {
    expect(parseRankCell('dnf')).toEqual({ irm: 'DNF' });
  });

  it('los estados TRANSITORIOS de la lista LIVE no son IRM ni puesto', () => {
    // Clave: el corredor CRUZÓ pero su tiempo aún se procesa. Tratarlos como IRM lo
    // marcaría como abandonado en un volcado en vivo; como puesto, daría un rank falso.
    // Se devuelve {} = "sin clasificar todavía" y el feed lo corrige al asentarse.
    expect(parseRankCell('PHOTO')).toEqual({});    // photo-finish pendiente
    expect(parseRankCell('FINISH')).toEqual({});
    expect(parseRankCell('PROV')).toEqual({});
    expect(parseRankCell('TBC')).toEqual({});
    expect(parseRankCell('?')).toEqual({});
    expect(parseRankCell('')).toEqual({});
  });

  it('un código DESCONOCIDO se conserva en crudo, no se inventa mapeo', () => {
    expect(parseRankCell('ZZZ')).toEqual({ irm: 'ZZZ' });
  });
});

describe('normAbsTime — tiempo absoluto race|result → formato BD', () => {
  it('convierte el formato con h y comillas (tabla de la doc)', () => {
    expect(normAbsTime("2h53'29''")).toBe('2:53:29');
    expect(normAbsTime("15h32'22''")).toBe('15:32:22');
  });

  it('sin horas → "MM:SS"', () => {
    expect(normAbsTime("53'29''")).toBe('53:29');
  });

  it('lo que ya viene en formato BD pasa tal cual', () => {
    expect(normAbsTime('2:53:29')).toBe('2:53:29');
  });

  it('un gap NO es un tiempo absoluto', () => {
    // Si esto devolviera algo, un rezagado recibiría timeText y rompería deriveGaps.
    expect(normAbsTime("+28''")).toBeNull();
  });

  it('rechaza puntos, vacío y null', () => {
    expect(normAbsTime('84 pt')).toBeNull();
    expect(normAbsTime('')).toBeNull();
    expect(normAbsTime(null)).toBeNull();
  });
});

describe('normGap — gap race|result → estilo UCI', () => {
  it('convierte los formatos verificados (tabla de la doc)', () => {
    expect(normGap("+28''")).toBe('+28');
    expect(normGap("+1'15''")).toBe('+1:15');
    expect(normGap("+3'25''")).toBe('+3:25');
    expect(normGap("+1h02'03''")).toBe('+1:02:03');
  });

  it('rellena el cero de los segundos al normalizar minutos', () => {
    expect(normGap("+0'04''")).toBe('+0:04');
  });

  it('lo que ya viene estilo "+1:15" pasa tal cual', () => {
    expect(normGap('+1:15')).toBe('+1:15');
  });

  it('sin "+" no es gap (un tiempo absoluto no debe leerse como diferencia)', () => {
    expect(normGap("28''")).toBeNull();
    expect(normGap("2h53'29''")).toBeNull();
  });

  it('vacío / null → null', () => {
    expect(normGap('')).toBeNull();
    expect(normGap(null)).toBeNull();
  });
});

describe('normPoints — col de puntos → resultValue', () => {
  it('extrae el número (formato "84 pt" de Points/KOM)', () => {
    expect(normPoints('84 pt')).toBe('84');
    expect(normPoints('84 pts')).toBe('84');
    expect(normPoints('84')).toBe('84');
  });

  it('rechaza lo que no son puntos', () => {
    expect(normPoints('2:53:29')).toBeNull();
    expect(normPoints('')).toBeNull();
    expect(normPoints(null)).toBeNull();
  });
});

describe('reorderName — "Nombre APELLIDO" → "APELLIDO Nombre" estilo UCI', () => {
  // Solo display fallback (el corredor se casa por dorsal), pero es lo que se ve en las
  // carreras sin startlist curada.
  it('reordena el caso canónico de la doc y quita el * de sub23', () => {
    expect(reorderName('James Matthew BRENNAN*')).toBe('BRENNAN James Matthew');
  });

  it('nombre simple', () => {
    expect(reorderName('Tadej POGACAR')).toBe('POGACAR Tadej');
  });

  it('apellido compuesto: absorbe TODO el bloque final en mayúsculas', () => {
    // Si solo cogiera el último token, "VAN DER POEL Mathieu" saldría como
    // "POEL Mathieu Van Der" — el apellido partido.
    expect(reorderName('Wout VAN AERT')).toBe('VAN AERT Wout');
    expect(reorderName('Mathieu VAN DER POEL')).toBe('VAN DER POEL Mathieu');
  });

  it('nombre de pila compuesto: todo lo que no es mayúscula es nombre', () => {
    expect(reorderName('Jose Joaquin ROJAS')).toBe('ROJAS Jose Joaquin');
  });

  it('acentos: el apellido acentuado en mayúsculas se reconoce igual', () => {
    // \p{Lu}/\p{Ll} con flag u — un rango [A-Z] dejaría fuera É/Ø/Š y el apellido
    // no se detectaría como mayúscula.
    expect(reorderName('André GREIPEL')).toBe('GREIPEL André');
    expect(reorderName('Tobias Halland JOHANNESSEN')).toBe('JOHANNESSEN Tobias Halland');
    expect(reorderName('Jonas VINGEGAARD HANSEN')).toBe('VINGEGAARD HANSEN Jonas');
  });

  it('sin mayúsculas claras → se devuelve tal cual (no se inventa un orden)', () => {
    expect(reorderName('john smith')).toBe('john smith');
  });

  it('un solo token en mayúsculas se conserva', () => {
    expect(reorderName('MADOUAS')).toBe('MADOUAS');
  });

  it('celda de imagen o vacía → null', () => {
    expect(reorderName('[img:x]')).toBeNull();
    expect(reorderName('')).toBeNull();
  });
});

describe('colsByWidth — el ancho de la fila IDENTIFICA la lista', () => {
  // El invariante central de esta fuente: la fila es un array POSICIONAL y el nº de
  // columnas cambia por tipo de lista. Mapear por índice fijo daría el dorsal de una
  // lista y el nombre de otra. Los 4 anchos están verificados contra Norway 2025 y
  // Slovenia 2026 (eventId 402988).
  it('12 col = Stage Results', () => {
    expect(colsByWidth(12, false)).toMatchObject({ rank: 2, name: 3, bib: 5, team: 6, value: 9 });
  });

  it('13 col = General Classification (nombre y dorsal se DESPLAZAN)', () => {
    // Dos columnas extra al principio del bloque de texto → name 3→5, bib 5→7. Es
    // exactamente el desplazamiento que rompería un mapeo por índice fijo.
    expect(colsByWidth(13, false)).toMatchObject({ rank: 2, name: 5, bib: 7, team: 8, value: 10 });
  });

  it('9 col = Points / KOM / Young', () => {
    expect(colsByWidth(9, false)).toMatchObject({ rank: 2, name: 3, bib: 5, team: 6, value: 8 });
  });

  it('7 col = Team GC → marcado como teamRow', () => {
    expect(colsByWidth(7, false)).toMatchObject({ bib: 0, rank: 2, name: 3, value: 6, teamRow: true });
  });

  it('14 col = LIVE Stage Results (fallback en vivo)', () => {
    expect(colsByWidth(14, false)).toMatchObject({ rank: 3, name: 7, bib: 5, team: 9, value: 11 });
  });

  it('teamRows fuerza el layout de equipo, sea cual sea el ancho', () => {
    expect(colsByWidth(12, true)).toMatchObject({ teamRow: true, bib: 0 });
  });

  it('un ancho desconocido → null (mejor omitir que mapear a ciegas)', () => {
    expect(colsByWidth(99, false)).toBeNull();
  });
});

describe('flattenData — `data` puede ser lista PLANA o dict ANIDADO de grupos', () => {
  // El otro invariante estructural: race|result devuelve las filas de dos formas según
  // la lista. Soportar solo una dejaría clasificaciones enteras a 0 filas.
  it('lista plana', () => {
    expect(flattenData([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
  });

  it('dict anidado de grupos (data["#1_Tour"]["#1_Start"])', () => {
    expect(flattenData({ '#1_Tour': { '#1_Start': [[1, 2], [3, 4]] } })).toEqual([[1, 2], [3, 4]]);
  });

  it('dict de un solo nivel', () => {
    expect(flattenData({ grupo: [[1, 2]] })).toEqual([[1, 2]]);
  });

  it('varios grupos → se concatenan en orden', () => {
    expect(flattenData({ a: [[1]], b: [[2]] })).toEqual([[1], [2]]);
  });

  it('null / basura → [] (no revienta)', () => {
    expect(flattenData(null)).toEqual([]);
    expect(flattenData([[1, 2], 'basura', null])).toEqual([[1, 2]]);
  });
});

// ── mapRows ────────────────────────────────────────────────────────────────
// Filas con la forma real de la respuesta (arrays posicionales).
const SPEC_STAGE = { classKind: 'stage', scope: 'stage' };
const SPEC_TEAMS = { classKind: 'teams', scope: 'overall', teamRows: true };
// Stage Results (12 col): [2]rank [3]nombre [5]DORSAL [6]equipo [9]tiempo/gap
const sr = (rank, name, bib, team, val) =>
  ['bibInterno', 'id', rank, name, '[img:flag]', bib, team, '[img:jersey]', '', val, '', ''];
// Points (9 col): [2]rank [3]nombre [5]DORSAL [6]equipo [8]puntos
const pt = (rank, name, bib, team, val) =>
  ['bibInterno', 'id', rank, name, '[img:flag]', bib, team, '[img:jersey]', val];
// Team GC (7 col): [0]bibEquipo [2]rank [3]NOMBRE EQUIPO [6]tiempo/gap
const tg = (bib, rank, name, val) => [bib, 'id', rank, name, 'sigla', '[img:jersey]', val];

describe('mapRows — Stage Results: solo rank1 trae tiempo, el resto por gap', () => {
  it('el líder lleva timeText absoluto y NUNCA gapText', () => {
    const [w] = mapRows([sr('1.', 'James Matthew BRENNAN*', '21', 'TEAM A', "3h14'10''")], SPEC_STAGE, 'stage', true);
    expect(w).toMatchObject({
      rank: 1, rankText: '1', bib: '21', riderDisplay: 'BRENNAN James Matthew',
      timeText: '3:14:10', gapText: null, irm: null,
    });
  });

  it('un rezagado con gap propio lleva gapText y NO timeText', () => {
    const rows = mapRows([
      sr('1.', 'A LEADER', '21', 'TEAM A', "3h14'10''"),
      sr('3.', 'Wout VAN AERT', '23', 'TEAM C', "+1'15''"),
    ], SPEC_STAGE, 'stage', true);
    expect(rows[1]).toMatchObject({ rank: 3, timeText: null, gapText: '+1:15', resultValue: '+1:15' });
  });

  it('celda de tiempo VACÍA en el grupo de cabeza = m.t. del ganador → gapText "+0"', () => {
    // race|result deja la celda vacía a quien llega con el líder. Se emite '+0' (no el
    // tiempo absoluto) para que TODA fila no-líder lleve gapText y el render entre por
    // la rama de gaps uniformemente; con timeText absoluto, allTimed sería false,
    // deriveGaps se apagaría y se pintaría el tiempo literal en vez de m.t.
    const rows = mapRows([
      sr('1.', 'A LEADER', '21', 'TEAM A', "3h14'10''"),
      sr('2.', 'B SAMEGROUP', '22', 'TEAM B', ''),
    ], SPEC_STAGE, 'stage', true);
    expect(rows[1]).toMatchObject({ rank: 2, timeText: null, gapText: '+0', resultValue: '+0' });
  });

  it('tras un CORTE, el m.t. hereda el gap de SU grupo, no el del líder', () => {
    // Regla de producto (Dani): no dar el tiempo del 1er pelotón a quien viene tras un
    // corte. El 4º llega con el 3º (+1:15), no con el ganador → debe llevar +1:15, no +0.
    const rows = mapRows([
      sr('1.', 'A LEADER', '21', 'TEAM A', "3h14'10''"),
      sr('2.', 'B SAMEGROUP', '22', 'TEAM B', ''),
      sr('3.', 'C CUT', '23', 'TEAM C', "+1'15''"),
      sr('4.', 'D WITHCUT', '24', 'TEAM D', ''),
    ], SPEC_STAGE, 'stage', true);
    expect(rows[1].gapText).toBe('+0');       // aún en cabeza
    expect(rows[2].gapText).toBe('+1:15');    // cabeza del nuevo grupo
    expect(rows[3].gapText).toBe('+1:15');    // hereda el de SU grupo
  });

  it('un abandono sale como IRM sin puesto ni tiempo, pero CONSERVA el dorsal', () => {
    // El bib debe sobrevivir: es como se enlaza al corredor real para tacharlo en la
    // startlist.
    const rows = mapRows([
      sr('1.', 'A LEADER', '21', 'TEAM A', "3h14'10''"),
      sr('DNF', 'B OUT', '22', 'TEAM B', ''),
    ], SPEC_STAGE, 'stage', true);
    expect(rows[1]).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '22',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('un dorsal no numérico → bib null (no se arrastra basura al resolve)', () => {
    const [row] = mapRows([sr('1.', 'A LEADER', '[img:x]', 'TEAM A', "3h14'10''")], SPEC_STAGE, 'stage', true);
    expect(row.bib).toBeNull();
  });

  it('ancho de fila inesperado → [] sin reventar', () => {
    expect(mapRows([new Array(99).fill('x')], SPEC_STAGE, 'stage', true)).toEqual([]);
  });

  it('entrada vacía o no-array → []', () => {
    expect(mapRows([], SPEC_STAGE, 'stage', true)).toEqual([]);
    expect(mapRows(null, SPEC_STAGE, 'stage', true)).toEqual([]);
  });
});

describe('mapRows — Points (isTimed=false): el valor son PUNTOS', () => {
  it('emite el número en resultValue, sin tiempo ni gap', () => {
    const rows = mapRows([
      pt('1.', 'James Matthew BRENNAN*', '21', 'TEAM A', '84 pt'),
      pt('2.', 'Tadej POGACAR', '22', 'TEAM B', '61 pts'),
    ], { classKind: 'points', scope: 'overall' }, 'points', false);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '21', resultValue: '84', timeText: null, gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, resultValue: '61' });
  });
});

describe('mapRows — Team GC (7 col): filas de EQUIPO', () => {
  // Igual que en las demás fuentes: el "bib" de una fila de equipo no es un dorsal →
  // emitirlo casaría la fila del equipo con un corredor en resolve_uci_results.
  const rows = () => mapRows([
    tg('1', '1.', 'TEAM ALPHA', "15h32'22''"),
    tg('2', '2.', 'TEAM BETA', "+28''"),
  ], SPEC_TEAMS, 'teams', true);

  it('emite bib NULL — nunca el nº de equipo de la col [0]', () => {
    expect(rows()[0].bib).toBeNull();
    expect(rows()[1].bib).toBeNull();
  });

  it('el display es el nombre del equipo', () => {
    expect(rows()[0]).toMatchObject({ riderDisplay: 'TEAM ALPHA', teamName: 'TEAM ALPHA' });
  });

  it('el equipo líder lleva tiempo absoluto; el resto, gap', () => {
    expect(rows()[0]).toMatchObject({ rank: 1, timeText: '15:32:22', gapText: null });
    expect(rows()[1]).toMatchObject({ rank: 2, timeText: null, gapText: '+28' });
  });
});

describe('fnv1a — IDs sintéticos deterministas', () => {
  it('reproduce el competitionId real del Tour of Slovenia 2026 (-17212)', () => {
    // El valor que está en race_uci_links.competitionId en producción para eventId
    // 402988. Si cambia, se rompen los IDs de todo lo ya volcado desde esta fuente.
    expect(-(fnv1a('raceresult:402988') % 200000)).toBe(-17212);
  });

  it('es estable y distinto por evento', () => {
    expect(fnv1a('raceresult:402988')).toBe(fnv1a('raceresult:402988'));
    expect(fnv1a('raceresult:402988')).not.toBe(fnv1a('raceresult:334313'));
  });
});
