import { describe, it, expect } from 'vitest';
import {
  parseTissotTime, parseAbsoluteColonTime, parsePlainSecondsGap,
  absText, gapText, irmCode, classifyTissot, mapTimeRows, mapPointsRows,
  expandTeamTimeTrial, fnv1a, parseEventAbsolute, mapEventRows,
  tissotIdSeed, tissotIdBase, buildMultiEventStages, selectFinishedLiveRows,
} from '../results-fetchers/tissot-results-fetch.mjs';

// Formatos verificados contra la API en vivo del Tour Auvergne-Rhône-Alpes 2026
// (ara2026), primera carrera conmutada a esta fuente, + las variantes cazadas en el
// Tour de France 2026 (E1/E2/E9+). Contrato completo en TISSOT-TIMING-API.md.

describe('parseTissotTime — los 3 dialectos de tiempo que emite Tissot', () => {
  it('formato clásico con h/apóstrofo/comillas (ARA 2026)', () => {
    expect(parseTissotTime('3h43\'58"')).toEqual({ sec: 13438, centis: null });
    expect(parseTissotTime('10h01\'01"')).toEqual({ sec: 36061, centis: null });
    expect(parseTissotTime('01\'29"')).toEqual({ sec: 89, centis: null });
    expect(parseTissotTime('41"')).toEqual({ sec: 41, centis: null });
  });

  it('conserva las centésimas de la CRE (liverankings: "32\'52\\"17")', () => {
    // Solo el crono las trae; si se perdieran, dos equipos separados por 17c
    // empatarían al reconstruir el absoluto en expandTeamTimeTrial.
    expect(parseTissotTime('32\'52"17')).toEqual({ sec: 1972, centis: '17' });
  });

  it('variante COLON + comilla final del TdF 2026 (E9+)', () => {
    // Se prueba ANTES que el formato clásico porque lleva ':' — el clásico nunca.
    expect(parseTissotTime('1:23:45"')).toEqual({ sec: 5025, centis: null });
    expect(parseTissotTime('2:30"')).toEqual({ sec: 150, centis: null });
  });

  it('variante de comilla DOBLE de la CRE desunida (TdF 2026 E1)', () => {
    // "MM:SS''" / "SS''": separador ':' y sufijo '' — sin horas.
    expect(parseTissotTime("5:30''")).toEqual({ sec: 330, centis: null });
    expect(parseTissotTime("30''")).toEqual({ sec: 30, centis: null });
  });

  it('devuelve null si no es un tiempo reconocible', () => {
    expect(parseTissotTime('DNF')).toBeNull();
    expect(parseTissotTime("' '")).toBeNull();
    expect(parseTissotTime('')).toBeNull();
    expect(parseTissotTime(null)).toBeNull();
  });
});

describe('parseAbsoluteColonTime / parsePlainSecondsGap — variante colon del TdF E2', () => {
  // En esta variante el ganador viene "H:MM:SS" (sin comillas) y el resto en
  // segundos crudos "00"/"03". Ambigüedad resuelta por rank: solo el rank 1 puede
  // ser absoluto (ver mapTimeRows).
  it('parseAbsoluteColonTime solo acepta H:MM:SS', () => {
    expect(parseAbsoluteColonTime('4:12:33')).toEqual({ sec: 15153, centis: null });
    expect(parseAbsoluteColonTime('41')).toBeNull();      // segundos crudos: no es absoluto
    expect(parseAbsoluteColonTime('2:30')).toBeNull();    // M:SS: tampoco
  });

  it('parsePlainSecondsGap acepta SS, M:SS y H:MM:SS (siempre gap)', () => {
    expect(parsePlainSecondsGap('41')).toEqual({ sec: 41, centis: null });
    expect(parsePlainSecondsGap('2:30')).toEqual({ sec: 150, centis: null });
    expect(parsePlainSecondsGap('1:23:45')).toEqual({ sec: 5025, centis: null });
    expect(parsePlainSecondsGap('abc')).toBeNull();
  });
});

describe('absText / gapText — al formato que ya hay en BD vía UCI', () => {
  it('absText omite las horas cuando no las hay', () => {
    expect(absText({ sec: 13438, centis: null })).toBe('3:43:58');
    expect(absText({ sec: 1972, centis: null })).toBe('32:52');
  });

  it('gapText usa el prefijo + y comprime los ceros a la izquierda', () => {
    expect(gapText({ sec: 41, centis: null })).toBe('+41');
    expect(gapText({ sec: 89, centis: null })).toBe('+1:29');
    expect(gapText({ sec: 3723, centis: null })).toBe('+1:02:03');
  });

  it('las centésimas se anexan con punto (crono)', () => {
    expect(absText({ sec: 1972, centis: '17' })).toBe('32:52.17');
    expect(gapText({ sec: 1972, centis: '17' })).toBe('+32:52.17');
  });
});

describe('irmCode — whitelist ESTRICTA de abandonos', () => {
  it('reconoce los códigos de abandono reales', () => {
    expect(irmCode('DNF')).toBe('DNF');
    expect(irmCode('DNS')).toBe('DNS');
    expect(irmCode('OTL')).toBe('OTL');
    expect(irmCode('DSQ')).toBe('DSQ');
    expect(irmCode('ABD')).toBe('ABD');
    expect(irmCode('dnf')).toBe('DNF');   // normaliza mayúsculas
  });

  it('"OK"/"None" NO son abandono: son roster VIGENTE sin posición confirmada', () => {
    // El gotcha documentado en §17 de la doc: el valor "activo" del roster varía por
    // etapa ("OK" en unas, "None" en otras). Tratarlos como IRM marcaría como
    // abandonado a un corredor que sigue en carrera.
    expect(irmCode('OK')).toBeNull();
    expect(irmCode('None')).toBeNull();
  });

  it('un código desconocido NO se inventa como IRM (a diferencia de Matsport)', () => {
    // Aquí la whitelist es deliberada: ante la duda, no es un abandono.
    expect(irmCode('XYZ')).toBeNull();
    expect(irmCode('')).toBeNull();
    expect(irmCode(null)).toBeNull();
  });
});

describe('classifyTissot — rankingType + vista → contrato UCI', () => {
  it('Time cambia de significado segun la vista', () => {
    // El mismo rankingType es la clasificación de etapa en /rankings/stage y la GC
    // del día en /rankings/overall (scope 'stage', como la UCI).
    expect(classifyTissot('Time', 'stage')).toMatchObject({ classKind: 'stage', scope: 'stage' });
    expect(classifyTissot('Time', 'overall')).toMatchObject({ classKind: 'gc', scope: 'stage' });
  });

  it('las secundarias overall conservan scope overall', () => {
    expect(classifyTissot('SprintPoints', 'overall')).toMatchObject({ classKind: 'points', scope: 'overall' });
    expect(classifyTissot('MountainPoints', 'overall')).toMatchObject({ classKind: 'kom', scope: 'overall' });
    expect(classifyTissot('Team', 'overall')).toMatchObject({ classKind: 'teams', scope: 'overall', teamRows: true });
  });

  it('un rankingType desconocido cae a "other" (espíritu de la migración 092)', () => {
    // keepForWeb exige classKind en la whitelist → lo desconocido queda invisible en
    // vez de colarse como una clasificación de etapa falsa.
    expect(classifyTissot('WhatIsThis', 'overall')).toMatchObject({ classKind: 'other', scope: 'overall' });
  });
});

describe('mapTimeRows — clasificación por tiempos', () => {
  const rankings = [
    { rank: 1, value: '3h43\'58"', rider: { bib: 72, name: 'BAUDIN Alex', teamName: 'EF EDUCATION - EASYPOST' } },
    { rank: 2, value: '41"', rider: { bib: 11, name: 'B RIDER', teamName: 'T' } },
    { rank: 3, value: "' '", rider: { bib: 12, name: 'C RIDER', teamName: 'T' } },
    { rank: 0, value: 'DNF', rider: { bib: 99, name: 'D RIDER', teamName: 'T' } },
  ];

  it('el ganador lleva timeText absoluto y NUNCA gapText', () => {
    const [w] = mapTimeRows(rankings);
    expect(w).toMatchObject({
      rank: 1, rankText: '1', bib: '72', riderDisplay: 'BAUDIN Alex',
      timeText: '3:43:58', gapText: null, resultValue: '3:43:58', irm: null,
    });
  });

  it('el resto lleva gapText y NO timeText', () => {
    const [, second] = mapTimeRows(rankings);
    expect(second).toMatchObject({ rank: 2, timeText: null, gapText: '+41' });
  });

  it('"\' \'" (mismo grupo) PROPAGA el gap de la fila anterior', () => {
    // Tissot no repite el gap dentro de un grupo: manda la cadena "' '". Sin
    // propagar, el 3º saldría sin diferencia respecto al ganador.
    const [, , third] = mapTimeRows(rankings);
    expect(third).toMatchObject({ rank: 3, gapText: '+41', resultValue: '+41' });
  });

  it('"\' \'" justo detrás del ganador → +0 (mismo tiempo que el líder)', () => {
    const rows = mapTimeRows([
      { rank: 1, value: '3h43\'58"', rider: { bib: 1, name: 'W' } },
      { rank: 2, value: "' '", rider: { bib: 2, name: 'X' } },
    ]);
    expect(rows[1]).toMatchObject({ rank: 2, gapText: '+0' });
  });

  it('la cola de no clasificados (rank 0 + value DNF) sale como IRM sin tiempo', () => {
    const [, , , dnf] = mapTimeRows(rankings);
    expect(dnf).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '99',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('variante colon del TdF E2: ganador absoluto, resto en segundos crudos', () => {
    // "00"/"03" NUNCA son un tiempo absoluto: el rank distingue (solo rank 1 lo es).
    const rows = mapTimeRows([
      { rank: 1, value: '4:12:33', rider: { bib: 1, name: 'W' } },
      { rank: 2, value: '00', rider: { bib: 2, name: 'X' } },
      { rank: 3, value: '03', rider: { bib: 3, name: 'Z' } },
    ]);
    expect(rows[0]).toMatchObject({ timeText: '4:12:33', gapText: null });
    expect(rows[1]).toMatchObject({ timeText: null, gapText: '+0' });
    expect(rows[2]).toMatchObject({ timeText: null, gapText: '+3' });
  });

  it('sin rank y con "OK"/"None" la fila NO se emite (aún sin posición)', () => {
    // Emitirla la clasificaría sin tiempo; se completará en el fetch siguiente.
    expect(mapTimeRows([{ rank: 0, value: 'OK', rider: { bib: 5, name: 'Y' } }])).toHaveLength(0);
    expect(mapTimeRows([{ rank: 0, value: 'None', rider: { bib: 5, name: 'Y' } }])).toHaveLength(0);
  });

  it('teamRows → bib NULL: un bib de equipo casaría con el dorsal de un corredor', () => {
    // Mismo gotcha que Matsport: resolve_uci_results (RPC 082) casa por dorsal.
    const [row] = mapTimeRows([{ rank: 1, value: '32\'52"', team: { name: 'TEAM VISMA' } }], { teamRows: true });
    expect(row).toMatchObject({ bib: null, riderDisplay: 'TEAM VISMA', teamName: 'TEAM VISMA', timeText: '32:52' });
  });
});

describe('mapPointsRows — clasificación por puntos', () => {
  it('el valor entero va en resultValue, sin tiempo ni gap (como la UCI)', () => {
    const [row] = mapPointsRows([{ rank: 1, value: '25', rider: { bib: 7, name: 'P', teamName: 'T' } }]);
    expect(row).toMatchObject({ rank: 1, bib: '7', resultValue: '25', timeText: null, gapText: null });
  });

  it('"\' \'" propaga el valor anterior (empate a puntos)', () => {
    const rows = mapPointsRows([
      { rank: 1, value: '25', rider: { bib: 7, name: 'P' } },
      { rank: 2, value: "' '", rider: { bib: 8, name: 'Q' } },
    ]);
    expect(rows[1]).toMatchObject({ rank: 2, resultValue: '25' });
  });

  it('un abandono conserva el IRM en rankText y sin valor', () => {
    const [row] = mapPointsRows([{ rank: 0, value: 'DNF', rider: { bib: 9, name: 'R' } }]);
    expect(row).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', resultValue: null });
  });

  it('sin rank y sin IRM real ("OK") la fila NO se emite', () => {
    expect(mapPointsRows([{ rank: 0, value: 'OK', rider: { bib: 10, name: 'S' } }])).toHaveLength(0);
  });
});

describe('expandTeamTimeTrial — CRE: NINGUNA fila puede traer gapText', () => {
  // INVARIANTE CRÍTICO: el render TTT de la web (resultados.js, caso A) toma el
  // tiempo del equipo del timeText ABSOLUTO del líder y DERIVA los gaps él mismo;
  // exige que NINGUNA fila traiga gapText. Por eso aquí se reconstruye el absoluto
  // de cada equipo (ganador + gap de Tissot) en vez de reenviar el gap.
  const results = [
    { rank: 1, value: '32\'52"17', team: { name: 'TEAM VISMA' } },
    { rank: 2, value: '10"', team: { name: 'UAE' } },
  ];
  const roster = [
    { name: 'TEAM VISMA', members: [{ bib: 21, name: 'A One', status: 'OK' }, { bib: 22, name: 'B Two', status: 'OK' }] },
    { name: 'UAE', members: [{ bib: 1, name: 'C Three', status: 'OK' }, { bib: 2, name: 'D Four', status: 'DNF' }] },
  ];

  it('ninguna fila trae gapText (romperia deriveGaps en la web)', () => {
    expect(expandTeamTimeTrial(results, roster).some((r) => r.gapText)).toBe(false);
  });

  it('el gap del 2º equipo se reconstruye como tiempo ABSOLUTO (ganador + gap)', () => {
    // 32'52"17 + 10" = 33:02.17 — con las centésimas conservadas.
    const rows = expandTeamTimeTrial(results, roster);
    expect(rows[0]).toMatchObject({ rank: 1, timeText: '32:52.17' });
    expect(rows.find((r) => r.teamName === 'UAE' && r.rank === 2)).toMatchObject({ timeText: '33:02.17' });
  });

  it('patrón UCI: líder con rank + tiempo, compañeros rank NULL detrás', () => {
    const rows = expandTeamTimeTrial(results, roster);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '21', riderDisplay: 'A One' });
    expect(rows[1]).toMatchObject({ rank: null, rankText: null, bib: '22', timeText: null });
  });

  it('excluye SOLO a los miembros con abandono explícito, nunca por status no reconocido', () => {
    // El status "activo" varía por etapa ("OK"/"None") → filtrar por lo no reconocido
    // borraría corredores en carrera. "D Four" (DNF) sí se cae.
    const bibs = expandTeamTimeTrial(results, roster).map((r) => r.bib);
    expect(bibs).toContain('1');       // C Three, status OK
    expect(bibs).not.toContain('2');   // D Four, status DNF
  });

  it('un equipo sin roster se emite como fila de equipo, con bib NULL', () => {
    const [row] = expandTeamTimeTrial([{ rank: 1, value: '32\'52"', team: { name: 'SIN ROSTER' } }], []);
    expect(row).toMatchObject({ rank: 1, bib: null, riderDisplay: 'SIN ROSTER', gapText: null });
  });
});

describe('fnv1a — IDs sintéticos deterministas y NEGATIVOS', () => {
  it('reproduce el competitionId sugerido del ARA 2026 (-161831)', () => {
    // Los eventId de Tissot se derivan de esta base; si cambia, se rompe la
    // idempotencia (ON CONFLICT) de todo lo ya volcado desde esta fuente.
    expect(-(fnv1a('ara2026') % 200000)).toBe(-161831);
  });

  it('la base cabe en el rango que mantiene el eventId > -2^31', () => {
    // eventId = -(base*10000 + slot*100 + idx) → base ≤ 199999 lo garantiza.
    for (const comp of ['ara2026', 'tdf2026', 'tds2026', 'vue2026']) {
      const base = fnv1a(comp) % 200000;
      expect(base).toBeLessThanOrEqual(199999);
      expect(-(base * 10000)).toBeGreaterThan(-(2 ** 31));
    }
  });

  it('es estable y distinto por competición y por año', () => {
    expect(fnv1a('ara2026')).toBe(fnv1a('ara2026'));
    expect(fnv1a('ara2026')).not.toBe(fnv1a('ara2027'));
    expect(fnv1a('ara2026')).not.toBe(fnv1a('tdf2026'));
  });
});

// ── MultiEvents (Mundial): una prueba de un día por invocación ──────────────
// La lista /events/{n}/phases/{p}/results usa un dialecto propio: tiempo absoluto
// con ':' (sin comillas) y gaps con signo "+M:SS", además de IRM con sufijo
// ("DNF6"). Verificado contra el Mundial MTB 2026 (mtbwch2026) en vivo.
describe('parseEventAbsolute — dialecto de las listas MultiEvents', () => {
  it('acepta absolutos con dos puntos y gaps con signo', () => {
    expect(parseEventAbsolute('1:25:26')).toEqual({ sec: 5126, centis: null });
    expect(parseEventAbsolute('25:43')).toEqual({ sec: 1543, centis: null });
    expect(parseEventAbsolute('+0:17')).toEqual({ sec: 17, centis: null });
    expect(parseEventAbsolute('+1:02:03')).toEqual({ sec: 3723, centis: null });
  });

  it('devuelve null para códigos de estado', () => {
    expect(parseEventAbsolute('DNF6')).toBeNull();
    expect(parseEventAbsolute('')).toBeNull();
  });
});

describe('irmCode — tolera el sufijo numérico de las listas MultiEvents', () => {
  it('reconoce el prefijo de abandono ("DNF6" = abandono en la vuelta 6)', () => {
    expect(irmCode('DNF6')).toBe('DNF');
    expect(irmCode('DNS')).toBe('DNS');
  });
  it('no confunde estados de roster vigente con un abandono', () => {
    expect(irmCode('OK')).toBeNull();
    expect(irmCode('None')).toBeNull();
    expect(irmCode('LAP')).toBeNull();
  });
});

describe('mapEventRows — contrato de las pruebas de un día', () => {
  const raw = [
    { resultType: 'Time', rank: 1, value: '1:25:26', time: '1:25:26', gap: '+0:00', rider: { bib: 78, name: 'PIDCOCK Thomas' } },
    { resultType: 'Time', rank: 2, value: '+0:17', time: '1:25:43', gap: '+0:17', rider: { bib: 5, name: 'ALDRIDGE Charlie' } },
    { resultType: 'IRM', rank: 0, value: 'DNF6', time: 'DNF6', gap: '', rider: { bib: 33, name: 'JUUL Sebastian Fini' } },
  ];
  it('emite tiempo ABSOLUTO en todas las filas y ningún gapText (caso A)', () => {
    const rows = mapEventRows(raw);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '78', timeText: '1:25:26', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '5', timeText: '1:25:43', gapText: null });
  });
  it('manda los abandonos a la cola como IRM, sin puesto', () => {
    const rows = mapEventRows(raw);
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', timeText: null });
  });
});

describe('selectFinishedLiveRows — llegada del MultiEvents en directo', () => {
  const rider = (bib) => ({ bib, name: `CORREDORA ${bib}` });
  const split = (name, rank) => ({ name, rank, resultType: 'Time' });
  it('acepta solo pasos Finish con puesto y tiempo absoluto', () => {
    const live = { results: [
      { rank: 1, rider: rider(35), value: '3:49:10', time: '3:49:10', splits: [split('Lap 9', 1), split('Finish', 1)] },
      { rank: 2, rider: rider(16), value: '+0', time: '3:49:10', splits: [split('Finish', 2)] },
      { rank: 3, rider: rider(23), value: '+33', time: '3:49:43', splits: [split('Lap 9', 3)] },
      { rank: 4, rider: rider(79), value: '+33', time: '3:49:43', splits: [split('Finish', 0)] },
      { rank: 5, rider: rider(25), value: '+33', time: null, splits: [split('Finish', 5)] },
      { rank: 0, rider: rider(94), value: 'DNF', time: 'DNF', splits: [split('Finish', 0)] },
    ] };
    const finished = selectFinishedLiveRows(live);
    expect(finished.map((r) => r.rider.bib)).toEqual([35, 16]);
    const stages = buildMultiEventStages({}, { start: '2026-09-24T13:00:00', type: 'MS' }, finished);
    expect(stages[0].classifications[0].rows.map((r) => [r.rank, r.bib, r.timeText]))
      .toEqual([[1, '35', '3:49:10'], [2, '16', '3:49:10']]);
  });
  it('no publica un ganador virtual procedente de un intermedio', () => {
    expect(selectFinishedLiveRows({ results: [
      { rank: 1, rider: rider(35), time: '3:27:45', splits: [split('Lap 9', 1)] },
    ] })).toEqual([]);
  });
});

describe('tissotIdBase — IDs sintéticos por evento del MultiEvents', () => {
  it('sin evento, la semilla es el comp_id (comportamiento de etapas intacto)', () => {
    expect(-tissotIdBase('ara2026')).toBe(-161831);
    expect(tissotIdSeed('ara2026')).toBe('ara2026');
  });
  it('con evento, cada prueba del Mundial obtiene una base distinta', () => {
    const bases = [1, 2, 3, 4, 5, 8, 10, 12, 13].map((e) => tissotIdBase('crdwch2026', e));
    expect(new Set(bases).size).toBe(bases.length);            // sin colisiones
    expect(-tissotIdBase('crdwch2026', 13)).toBe(-21865);      // línea masculina
    expect(tissotIdSeed('crdwch2026', 5)).toBe('crdwch2026#5');// CRE relevo mixto
  });
});


describe('Relevo MultiEvents — clasificación final visible y tiempos absolutos', () => {
  const team = (name, bib) => ({ name, members: [
    { bib, name: 'CORREDOR Uno' }, { bib: bib + 1, name: 'CORREDORA Dos' },
  ] });
  const raw = [
    { rank: 1, team: team('ITALY', 31), value: '51:32.28', time: '51:32.28', gap: '+0.00' },
    { rank: 3, team: team('SWITZERLAND', 21), value: '+19.90', time: '51:52.18', gap: '+19.90' },
    { rank: 6, team: team('SPAIN', 51), value: '+1:10.77', time: '52:43.05', gap: '+1:10.77' },
  ];
  const build = (rows) => buildMultiEventStages({}, { start: '2026-09-22T12:30:00' }, rows)[0];
  it('la final pasa el filtro de ambas apps y permite resolver los dorsales', () => {
    const stage = build(raw);
    expect(stage).toMatchObject({ stageNumber: null, isFinalClassification: true, raceType: 'TTT' });
    expect(stage.classifications[0]).toMatchObject({ classKind: 'gc', isTeamEvent: false, rowCount: 6 });
    expect(stage.classifications.filter((c) => stage.stageNumber != null || c.classKind !== 'stage')).toHaveLength(1);
    expect(stage.classifications[0].rows.map((r) => r.bib)).toEqual(['31', '32', '21', '22', '51', '52']);
  });
  it('usa el absoluto oficial antes de truncar y mantiene los compañeros sin rango', () => {
    const rows = build(raw).classifications[0].rows;
    expect(rows.filter((r) => r.rank != null).map((r) => r.timeText)).toEqual(['51:32', '51:52', '52:43']);
    expect(rows.filter((r) => r.rank == null).every((r) => r.timeText == null)).toBe(true);
    expect(rows.every((r) => r.gapText == null)).toBe(true);
  });
  it('si falta el absoluto suma con centésimas antes de truncar', () => {
    const rows = build(raw.map(({ time, ...r }) => r)).classifications[0].rows;
    expect(rows.filter((r) => r.rank != null).map((r) => r.timeText)).toEqual(['51:32', '51:52', '52:43']);
  });
  it('rechaza equipos sin miembros para no publicar filas individuales sin dorsal', () => {
    expect(() => build([{ rank: 1, team: { name: 'ITALY' }, value: '51:32.28' }])).toThrow('sin miembros');
  });
});
