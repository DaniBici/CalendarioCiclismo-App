import { describe, it, expect } from 'vitest';
import {
  cellText, parseRankCell, normAbsTime, normGap, normPoints, reorderName,
  colsByWidth, mapRows, flattenData, fnv1a, completedLapFromTimingPoint,
  liveCompletionState, eventProfile, idBaseFor, validateDatedResult,
  validateProfileColumns, progressCompletionState, liveStageResultRows, listHeaderDates,
  selectorForStage, liveOverallRows,
}
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

  it('conserva el orden de Philadelphia cuando race|result ya entrega "APELLIDO, Nombre"', () => {
    expect(reorderName('MARTINELLI, Alessio')).toBe('MARTINELLI Alessio');
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

  it('11 col = Stage Results de carrera de un día', () => {
    expect(colsByWidth(11, false)).toMatchObject({
      rank: 2, bib: 3, name: 4, team: 5, value: 9, gap: 10,
    });
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

describe('liveStageResultRows — la lista LIVE agrupa por punto de paso', () => {
  // Fila LIVE (14 col): [3]puesto/IRM [5]dorsal [7]nombre [9]equipo [11]tiempo/gap.
  const lr = (rank, bib, name, team, val) =>
    [bib, 'id', '', rank, '', bib, '[img:flag]', name, '[img:jersey]', team, '', val, '', ''];
  const nested = (finish, partial, start) => ({
    '#1_Tour of Slovakia': {
      '#1_Finish': finish,
      '#2_3 km to go': partial,
      '#4_Start': start,
    },
  });

  it('conserva los finishers de meta y los abandonos, y descarta los parciales sin puesto', () => {
    // Eslovaquia 2026 E2: el paso de "3 km to go" traía filas sin puesto que se colaban
    // junto a las de meta. Solo valen el grupo Finish y los IRM explícitos.
    const rows = liveStageResultRows(nested(
      [lr('1.', '1', 'Paul MAGNIER', 'SOQ', "4h40'21''"), lr('2.', '66', 'Thomas CAPRA', 'BVD', '')],
      [lr('', '122', 'Josef DIRNBAUER', 'ATT', "+5'21''")],
      [lr('DNF', '67', 'Max VAN DER MEULEN', 'DSM', '')],
    ));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row[5])).toEqual(['1', '66', '67']);
    expect(rows.some((row) => row[5] === '122')).toBe(false);
  });

  it('sin un grupo "Finish" nombrado, usa el más poblado como meta', () => {
    const rows = liveStageResultRows({
      '#1_Tour': { '#1_Meta': [lr('1.', '1', 'A A', 'T', '1'), lr('2.', '2', 'B B', 'T', '')],
        '#9_Paso': [lr('', '9', 'C C', 'T', '')] },
    });
    expect(rows.map((row) => row[5])).toEqual(['1', '2']);
  });

  it('data plana (sin grupos) delega en flattenData', () => {
    expect(liveStageResultRows([[1, 2]])).toEqual([[1, 2]]);
    expect(liveStageResultRows(null)).toEqual([]);
  });
});

describe('listHeaderDates — fecha del cabecero de una lista', () => {
  const payload = (...dates) => ({
    list: { ListHeaderText: dates.map((d) => `<div id="stage_date"><span>${d}</span></div>`).join('') },
  });

  it('extrae todas las fechas publicadas en formato YYYY-MM-DD', () => {
    expect(listHeaderDates(payload('17/09/2026', '17/09/2026'))).toEqual(['2026-09-17', '2026-09-17']);
  });

  it('sin cabecero o sin fecha → []', () => {
    expect(listHeaderDates({})).toEqual([]);
    expect(listHeaderDates(payload())).toEqual([]);
  });
});

describe('selectorForStage — selector de etapa de una lista de generales', () => {
  // Selector real del Tour of Norway 2025 (GC): ResultID = nº de etapa.
  const selectors = [
    { ResultID: 4, ShowAs: 'Stage 4' },
    { ResultID: 3, ShowAs: 'Stage 3' },
    { ResultID: 2, ShowAs: 'Stage 2' },
    { ResultID: 1, ShowAs: 'Stage 1' },
  ];

  it('devuelve el ResultID de la etapa pedida', () => {
    expect(selectorForStage(selectors, 2)).toBe(2);
    expect(selectorForStage(selectors, 4)).toBe(4);
  });

  it('no confunde el número de etapa con otros dígitos del ShowAs', () => {
    expect(selectorForStage([{ ResultID: 7, ShowAs: '{EN:Stage 2|FR:Étape 2}' }], 2)).toBe(7);
  });

  it('etapa ausente o lista sin selector → null (mejor omitir que colgar de otra jornada)', () => {
    expect(selectorForStage(selectors, 5)).toBeNull();
    expect(selectorForStage([], 1)).toBeNull();
    expect(selectorForStage(null, 1)).toBeNull();
  });
});

describe('liveOverallRows — puntos y montaña de la jornada en curso', () => {
  const payload = (date = '23/09/2026') => ({
    list: { ListHeaderText: `<div id="stage_date"><span>${date}</span></div>` },
    DataFields: ['BIB', 'ID', '[POSITION]', 'DisplayBib', 'CustomFlag', 'DisplayName',
      'ChampionOrTeamJersey', 'CLUB', 'DisplayPoints([SELECTORTIME])'],
    data: [
      ['4', '4', '1.', '4', '', 'Juan Sebastian MOLANO', '', 'UAE', '41 pt'],
      ['157', '112', '2.', '157', '', 'Gabriele RACCAGNI', '', 'POLTI', '13 pt'],
    ],
  });

  it('lee el dorsal y los puntos de las columnas LIVE, distintas de Results', () => {
    const rows = liveOverallRows(payload(), { classKind: 'points' }, '2026-09-23');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '4', resultValue: '41' });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '157', resultValue: '13' });
  });

  it('rechaza una fecha anterior, una plantilla distinta y dorsales duplicados', () => {
    expect(liveOverallRows(payload('22/09/2026'), { classKind: 'kom' }, '2026-09-23')).toEqual([]);
    const changed = payload(); changed.DataFields[3] = 'DisplayName';
    expect(liveOverallRows(changed, { classKind: 'points' }, '2026-09-23')).toEqual([]);
    const duplicated = payload(); duplicated.data[1][3] = '4';
    expect(liveOverallRows(duplicated, { classKind: 'points' }, '2026-09-23')).toEqual([]);
    expect(liveOverallRows(payload(), { classKind: 'gc' }, '2026-09-23')).toEqual([]);
  });
});

// ── mapRows ────────────────────────────────────────────────────────────────
// Filas con la forma real de la respuesta (arrays posicionales).
const SPEC_STAGE = { classKind: 'stage', scope: 'stage' };
const SPEC_TEAMS = { classKind: 'teams', scope: 'overall', teamRows: true };
// Stage Results (12 col): [2]rank [3]nombre [5]DORSAL [6]equipo [9]tiempo/gap
const sr = (rank, name, bib, team, val) =>
  ['bibInterno', 'id', rank, name, '[img:flag]', bib, team, '[img:jersey]', '', val, '', ''];
// Philadelphia one-day (11 col): [2]rank [3]DORSAL [4]nombre [5]equipo
// [9]tiempo absoluto de cada corredor [10]gap respecto al ganador.
const od = (rank, bib, name, team, time, gap) =>
  ['bibInterno', 'id', rank, bib, name, team, '[img:flag]', '', '', time, gap];
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

describe('mapRows — Philadelphia: tiempo absoluto y gap están en columnas distintas', () => {
  const rows = () => mapRows([
    od('1.', '54', 'MARTINELLI, Alessio', 'TEAM A', '5:00:18', ''),
    od('2.', '65', 'SMITH, John', 'TEAM B', '5:00:20', '+02'),
    od('3.', '72', 'DOE, Alex', 'TEAM C', '5:00:20', "''"),
  ], SPEC_STAGE, 'race', true);

  it('emite el tiempo del ganador', () => {
    expect(rows()[0]).toMatchObject({
      rank: 1, bib: '54', riderDisplay: 'MARTINELLI Alessio',
      timeText: '5:00:18', gapText: null,
    });
  });

  it('usa el gap de la columna 10 y no el tiempo absoluto de la columna 9', () => {
    expect(rows()[1]).toMatchObject({
      rank: 2, timeText: null, gapText: '+02', resultValue: '+02',
    });
  });

  it('una marca de mismo tiempo hereda el gap del grupo anterior', () => {
    expect(rows()[2]).toMatchObject({ rank: 3, timeText: null, gapText: '+02' });
  });
});

describe('liveCompletionState — gate de vueltas/meta de Philadelphia', () => {
  const live = (...timingPoints) => ({
    DataFields: [
      'BIB', 'ID', 'AUTORANK', '[ActualBib]', 'DisplayName', 'CLUB',
      'NATION.FLAG', 'gap', 'tpName(TTLastID(51001;50001;52001;115))',
    ],
    data: timingPoints.map((point, index) => [
      String(index + 1), `id-${index}`, String(index + 1), String(index + 1),
      'RIDER', 'TEAM', '', '', point,
    ]),
  });

  it('reconoce etiquetas de vuelta en ambos órdenes', () => {
    expect(completedLapFromTimingPoint('Lap 10 - Manayunk')).toBe(10);
    expect(completedLapFromTimingPoint('5th Lap')).toBe(5);
    expect(completedLapFromTimingPoint('Vuelta 3')).toBe(3);
  });

  it('no habilita la masculina en la vuelta 9', () => {
    expect(liveCompletionState(live('Lap 9 - Lemon Hill'), 10)).toMatchObject({
      ready: false, hasFinish: false, maxLap: 9,
    });
  });

  it('habilita la masculina en la vuelta 10 y la femenina en la 5', () => {
    expect(liveCompletionState(live('Lap 10 - Manayunk'), 10).ready).toBe(true);
    expect(liveCompletionState(live('Lap 5'), 5).ready).toBe(true);
  });

  it('FINISH prevalece aunque no conste el número de vueltas', () => {
    expect(liveCompletionState(live('Race Finish'), 10)).toMatchObject({
      ready: true, hasFinish: true, maxLap: 0,
    });
  });

  it('una lista vacía no emite resultados', () => {
    expect(liveCompletionState(live(), 5)).toMatchObject({ ready: false, rowCount: 0 });
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

  it('mantiene los IDs históricos y separa concursos del mismo evento', () => {
    expect(-idBaseFor('402988')).toBe(-17212);
    expect(idBaseFor('406938', '1', true)).not.toBe(idBaseFor('406938', '2', true));
  });
});

describe('eventProfile — concursos curados de Philadelphia 2026', () => {
  it('asigna 10 vueltas al concurso masculino', () => {
    expect(eventProfile('406938', 'male')).toMatchObject({
      oneDay: true, contest: '1', requiredLaps: 10,
    });
  });

  it('asigna 5 vueltas al concurso femenino', () => {
    expect(eventProfile('406938', 'female')).toMatchObject({
      oneDay: true, contest: '2', requiredLaps: 5,
    });
  });

  it('aplica el gate correcto cuando el concurso se indica de forma explícita', () => {
    expect(eventProfile('406938', null, '2')).toMatchObject({
      oneDay: true, contest: '2', requiredLaps: 5,
    });
  });
});

describe('Québec y Montréal 2026 — mismo evento, concursos y columnas propios', () => {
  const profile = () => eventProfile('417778', 'male', null, '2026-09-13');
  const payload = (date = '13/09/2026') => ({
    list: { ListHeaderText: `<div id="stage_date" class="header_info"><span>${date}</span></div>` },
    DataFields: ['BIB', 'ID', 'StageRank', 'DisplayBib', 'CustomFlag', 'DisplayNameAsterisk'],
  });

  it('selecciona Montréal por fecha y lo separa de Québec aunque ambos sean masculinos', () => {
    expect(profile()).toMatchObject({ contest: '2', dateKey: '2026-09-13', oneDay: true });
    expect(eventProfile('417778', 'male', null, '2026-09-11')).toMatchObject({ contest: '1' });
    expect(idBaseFor('417778', '1', true)).not.toBe(idBaseFor('417778', '2', true));
  });

  it('no usa Québec por defecto sin fecha y rechaza fechas o concursos contradictorios', () => {
    expect(eventProfile('417778', 'male').contest).toBeNull();
    expect(() => eventProfile('417778', 'male', null, '2027-09-13')).toThrow('no configurada');
    expect(() => eventProfile('417778', 'male', '1', '2026-09-13')).toThrow('no corresponde');
    expect(eventProfile('417778', null, '2')).toMatchObject({ dateKey: '2026-09-13' });
  });

  it('contrasta la fecha publicada y el significado de las columnas', () => {
    expect(() => validateDatedResult(payload(), profile())).not.toThrow();
    expect(() => validateDatedResult(payload('11/09/2026'), profile())).toThrow('fecha');
    expect(() => validateDatedResult({}, profile())).toThrow('fecha');
    const wrongColumns = payload();
    wrongColumns.DataFields[3] = 'DisplayNameAsterisk';
    expect(() => validateDatedResult(wrongColumns, profile())).toThrow('Columnas');
  });

  it('usa DisplayBib, conserva los nombres y los grupos de tiempo, y resuelve los abandonos', () => {
    const row = (internal, rank, bib, name, value) =>
      [internal, 'id', rank, bib, '[img:flag]', name, 'TEAM', '[img:jersey]', '', value, '', ''];
    const rows = mapRows([
      row('1002', '1.', '2', 'Isaac DEL TORO ROMERO', "5h13'16''"),
      row('1031', '2.', '31', 'Paul SEIXAS*', ''),
      row('1001', '3.', '1', 'Brandon MCNULTY', "+27''"),
      row('1216', 'DNF', '216', 'Jonas WALTON*', ''),
    ], { cols: profile().cols }, 'race', true);
    expect(rows[0]).toMatchObject({ bib: '2', riderDisplay: 'DEL TORO ROMERO Isaac', timeText: '5:13:16' });
    expect(rows[1]).toMatchObject({ bib: '31', rank: 2, gapText: '+0' });
    expect(rows[2]).toMatchObject({ bib: '1', rank: 3, gapText: '+27' });
    expect(rows[3]).toMatchObject({ bib: '216', rank: null, irm: 'DNF', timeText: null, gapText: null });
  });
});

describe('Gatineau 2026 (racetiming.ca) — centésimas y gate de progreso', () => {
  it('normaliza el tiempo en meta "M:Ss.kk" truncando las centésimas', () => {
    expect(normAbsTime('26:41.47')).toBe('26:41');
    expect(normAbsTime('1:02:03.45')).toBe('1:02:03');
  });

  it('normaliza la diferencia sin signo del cronometrador', () => {
    expect(normGap('14.69')).toBe('+14');
    expect(normGap('1:01.49')).toBe('+1:01');
    expect(normGap('6:33.83')).toBe('+6:33');
    expect(normGap('--')).toBeNull();       // sin diferencia (líder)
    expect(normGap('-5.2')).toBeNull();     // pérdida, no diferencia
    expect(normGap("2h53'29''")).toBeNull();
  });

  it('identifica la crono, su concurso único y sus columnas', () => {
    const profile = eventProfile('422048', 'female');
    expect(profile).toMatchObject({
      oneDay: true, contest: '0',
      cols: { rank: 2, bib: 3, name: 4, team: 5, value: 6, gap: 7 },
    });
    expect(profile.progress).toMatchObject({ lastStarter: /REUSSER/i });
  });

  it('identifica la prueba en línea con sus columnas de tiempo y diferencia', () => {
    expect(eventProfile('422781', 'female')).toMatchObject({
      oneDay: true, contest: '0',
      cols: { rank: 2, bib: 3, name: 5, team: 6, value: 9, gap: 10 },
    });
  });

  it('valida las columnas de la prueba en línea y mapea su fila con nación intercalada', () => {
    const fields = ['BIB', 'ID', 'WithStatus([FinishRankp])', 'PrintedBib', 'NATION.UCINAME', 'DisplayName', 'Team'];
    expect(() => validateProfileColumns({ DataFields: fields }, eventProfile('422781', 'female'))).not.toThrow();
    const profile = eventProfile('422781', 'female');
    const row = (rank, bib, name, finish, gap) =>
      ['i', 'id', rank, bib, 'SUI', name, 'TEAM', '', '12', finish, gap, 'WE(1)', ''];
    const rows = mapRows([
      row('1.', '36', 'HÄBERLIN Steffi', '2:53:26', '-'),
      row('2.', '1', 'BAKER Georgia', '2:53:26', '+0'),
      row('4.', '5', 'ROSEMAN-GANNON Ruby', '2:53:26', '+0'),
    ], { classKind: 'gc', scope: 'stage', cols: profile.cols }, 'race', true);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '36', riderDisplay: 'HÄBERLIN Steffi', timeText: '2:53:26', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '1', gapText: '+0' });
    expect(rows[2]).toMatchObject({ rank: 4, bib: '5', gapText: '+0' });
  });

  it('valida las columnas del perfil y rechaza una plantilla desplazada', () => {
    const fields = ['BIB', 'ID', 'WithStatus(Rank(MaxSplits))', 'PrintedBib', 'DisplayName', 'Team'];
    expect(() => validateProfileColumns({ DataFields: fields }, eventProfile('422048', 'female'))).not.toThrow();
    const wrong = [...fields];
    wrong[4] = 'Team';
    expect(() => validateProfileColumns({ DataFields: wrong }, eventProfile('422048', 'female'))).toThrow('nombre');
  });

  it('mapea la fila del cronometrador con tiempo absoluto y diferencia', () => {
    const profile = eventProfile('422048', 'female');
    const row = (internal, rank, bib, name, finish, gap) =>
      [internal, internal, rank, bib, name, 'TEAM', finish, gap, '45.00 kmh', '', '', ''];
    const rows = mapRows([
      row('14', '1', '14', 'HANSON Lauretta', '26:41.47', '--'),
      row('12', '2', '12', 'COUPLAND Mackenzie', '26:56.17', '14.69'),
    ], { classKind: 'gc', scope: 'stage', cols: profile.cols }, 'race', true);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '14', timeText: '26:41', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '12', timeText: null, gapText: '+14' });
  });

  it('no habilita el volcado mientras un corredor sigue en curso', () => {
    const progress = { fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i };
    const payload = {
      DataFields: ['BIB', 'DisplayName', 'if([STATUS]=0;Split_Count;"") & " / " & [CONTEST.LAPS]'],
      data: [
        ['14', 'HANSON Lauretta', '2 / 2'],
        ['8', 'AHTOSALO Anniina', '1 / 2'],
        ['1', 'REUSSER Marlen', '0 / 2'],
      ],
    };
    expect(progressCompletionState(payload, progress)).toMatchObject({
      ready: false, finished: 1, inProgress: 1, notStarted: 1, lastStarterFinished: false,
    });
  });

  it('habilita el volcado cuando todos han terminado', () => {
    const progress = { fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i };
    const payload = {
      DataFields: ['BIB', 'DisplayName', 'if([STATUS]=0;Split_Count;"") & " / " & [CONTEST.LAPS]'],
      data: [
        ['14', 'HANSON Lauretta', '2 / 2'],
        ['1', 'REUSSER Marlen', '2 / 2'],
      ],
    };
    expect(progressCompletionState(payload, progress)).toMatchObject({ ready: true, lastStarterFinished: true });
  });

  it('marca el último en salir como terminado, pero no publica mientras quede alguien en curso', () => {
    const progress = { fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i };
    const payload = {
      DataFields: ['BIB', 'DisplayName', 'if([STATUS]=0;Split_Count;"") & " / " & [CONTEST.LAPS]'],
      data: [
        ['19', 'BOND Jorja', '1 / 2'],       // sigue en curso tras el paso de Reusser
        ['1', 'REUSSER Marlen', '2 / 2'],    // última en salir, ya en meta
      ],
    };
    expect(progressCompletionState(payload, progress)).toMatchObject({
      ready: false, inProgress: 1, lastStarterFinished: true,
    });
  });

  it('ignora los abandonos sin parciales (no bloquean el cierre)', () => {
    const progress = { fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i };
    const payload = {
      DataFields: ['BIB', 'DisplayName', 'if([STATUS]=0;Split_Count;"") & " / " & [CONTEST.LAPS]'],
      data: [
        ['19', 'BOND Jorja', ' / 2'],        // DNF: el proveedor borra el parcial
        ['1', 'REUSSER Marlen', '2 / 2'],
      ],
    };
    expect(progressCompletionState(payload, progress)).toMatchObject({ ready: true, finished: 1, inProgress: 0 });
  });

  it('falla si la plantilla no expone el campo de progreso', () => {
    const progress = { fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i };
    expect(progressCompletionState({ DataFields: ['BIB'], data: [['1']] }, progress)).toMatchObject({
      ready: false, reason: 'missing-progress-field',
    });
  });
});
