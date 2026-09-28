import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { recomputeCxStandings } from '../cx/standings.js';

const references = JSON.parse(readFileSync(new URL('../../docs/cc-cx-points-schemes.json', import.meta.url)));
const clone = value => structuredClone(value);
function snapshot(name = 'Copa del Mundo', category = 'ME') {
  const scheme = clone(references.references.find(reference => reference.tournament === name).pointsScheme);
  scheme.status = 'verified';
  scheme.edition = { seasonKey: '2026-27', reviewedAt: '2026-09-12' };
  for (const rule of Object.values(scheme.categories)) {
    rule.review = { sourceUrl: 'https://official.test/rules', cotejoUrl: 'https://official.test/standings',
      droppedPlacingsPolicy: 'all', derivedCategory: true, missingRoundBonuses: 'none', forfaitBonusesPolicy: 'discard' };
  }
  return { tournament: { id: 'series', seasonKey: '2026-27', pointsScheme: scheme }, category, rounds: [], riders: [] };
}
function addRound(input, date, rows, changes = {}) {
  const id = `round-${input.rounds.length + 1}`;
  const category = input.tournament.pointsScheme.categories[input.category]?.extras?.derived?.fromCategory || input.category;
  const round = { race: { id, dateKey: date, seasonKey: '2026-27', tournamentId: 'series',
    editorialStatus: 'published', isCancelled: false },
  manga: { category, resultsStatus: 'official', resultsSourceUrl: 'https://official.test/finish',
    bonusSourceUrl: 'https://official.test/bonuses', resultsEvidence: { rankScope: 'officialCategory',
      categoryClassificationSourceUrl: 'https://official.test/category' } },
  results: rows.map(([rider, rank, extras = {}]) => ({ raceId: id, category, globalRiderId: rider,
    riderDisplay: rider, rank, bonusPoints: 0, bonusSeconds: null, timeSeconds: null, irm: null, ...extras })), ...changes };
  input.rounds.push(round);
  for (const row of round.results) if (row.globalRiderId && !input.riders.some(rider => rider.id === row.globalRiderId)) {
    input.riders.push({ id: row.globalRiderId, verified: true, birthDate: '2005-01-01' });
  }
  return round;
}
const result = input => recomputeCxStandings(input);
const review = input => { const value = result(input); expect(value.status).toBe('needs_review'); expect(value.rows).toEqual([]); return value; };

describe('generales CX por categoría y edición', () => {
  it('no activa automáticamente una referencia F1 ni hereda la categoría élite', () => {
    const input = snapshot(); input.tournament.pointsScheme.status = 'reference_requires_edition_review';
    review(input);
    review(snapshot('Superprestige', 'MU'));
    const wrong = snapshot(); wrong.tournament.pointsScheme.edition.seasonKey = '2025-26'; review(wrong);
  });
  it('exige fuentes y cotejo de la categoría, con fecha civil válida', () => {
    const input = snapshot(); input.tournament.pointsScheme.categories.ME.review.cotejoUrl = null; review(input);
    const date = snapshot(); date.tournament.pointsScheme.edition.reviewedAt = '2026-02-30'; review(date);
  });
  it('mantiene vacío un torneo sin rondas oficiales', () => { expect(result(snapshot()).status).toBe('empty'); });
  it('excluye provisionales, canceladas, retiradas, otra temporada y marzo–julio', () => {
    const input = snapshot();
    const kept = addRound(input, '2026-09-12', [['a', 1]]);
    const provisional = addRound(input, '2026-10-12', [['a', 1]]); provisional.manga.resultsStatus = 'provisional';
    const cancelled = addRound(input, '2026-11-12', [['a', 1]]); cancelled.race.isCancelled = true;
    const manga = addRound(input, '2026-12-12', [['a', 1]]); manga.manga.isCancelled = true;
    const draft = addRound(input, '2027-01-12', [['a', 1]]); draft.race.editorialStatus = 'draft';
    const old = addRound(input, '2025-09-12', [['a', 1]]); old.race.seasonKey = '2025-26';
    addRound(input, '2027-03-01', [['a', 1]]);
    const end = addRound(input, '2027-02-28', [['a', 1]]); end.race.endDateKey = '2027-03-01';
    expect(result(input)).toMatchObject({ status: 'ready', roundIds: [kept.race.id], rows: [{ points: '40', timeSeconds: null }] });
  });
  it('respeta la fecha de categoría multidía y febrero bisiesto', () => {
    const input = snapshot(); input.tournament.seasonKey = '2027-28'; input.tournament.pointsScheme.edition.seasonKey = '2027-28';
    const round = addRound(input, '2028-02-28', [['a', 1]]); round.race.seasonKey = '2027-28';
    round.race.endDateKey = '2028-02-29'; round.manga.dateKey = '2028-02-29';
    expect(result(input).status).toBe('ready'); round.manga.dateKey = '2028-03-01'; expect(result(input).status).toBe('empty');
  });
  it('no convierte una ronda oficial vacía o sin fuente en cero', () => {
    const input = snapshot(); addRound(input, '2026-09-12', []); review(input);
    input.rounds[0].results.push({}); input.rounds[0].manga.resultsSourceUrl = null; review(input);
  });
  it('rechaza identidad ausente/duplicada, puestos repetidos, IRM desconocida y colisiones de IDs', () => {
    for (const edit of [row => row.globalRiderId = null, row => row.raceId = 'road-id', row => row.category = 'WE',
      row => row.irm = 'UNKNOWN', row => row.rank = -1, row => row.irm = 'DNF']) {
      const input = snapshot(); const round = addRound(input, '2026-09-12', [['a', 1]]); edit(round.results[0]); review(input);
    }
    const duplicate = snapshot(); addRound(duplicate, '2026-09-12', [['a', 1], ['a', 2]]); review(duplicate);
    const ranks = snapshot(); addRound(ranks, '2026-09-12', [['a', 1], ['b', 1]]); review(ranks);
  });
  it('requiere orden verificable para dos rondas del mismo día', () => {
    const input = snapshot(); addRound(input, '2026-09-12', [['a', 1]]); addRound(input, '2026-09-12', [['a', 1]]); review(input);
    input.rounds[0].manga.startTimeUtc = '2026-09-12T10:00:00Z'; input.rounds[1].manga.startTimeUtc = '2026-09-12T14:00:00Z';
    expect(result(input).rows[0].points).toBe('80');
  });
});

describe('puntos, descartes y desempates', () => {
  it('v2 conserva la elegibilidad previa cuando no se declara otra política', () => {
    const input = snapshot();
    addRound(input, '2026-09-12', [['a', 1], ['b', 26], ['c', null, { irm: 'DNF' }], ['d', null, { irm: 'DNS' }]]);
    const implicit = result(input);
    input.tournament.pointsScheme.categories.ME.review.pointsEligibilityPolicy = 'startedAtLeastOnce';
    expect(result(input)).toEqual(implicit);
    expect(implicit.engineVersion).toBe(3);
    expect(implicit.breakdown.filter(entry => entry.eligible).map(entry => entry.globalRiderId)).toEqual(['a', 'b', 'c']);
    input.tournament.pointsScheme.categories.ME.review.pointsEligibilityPolicy = 'awardedAtLeastOnce';
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['a']);
  });
  it('puntos base otorgados mantienen elegibilidad aunque la sanción deje total cero o negativo', () => {
    for (const penalty of ['-25', '-26']) {
      const input = snapshot('Copa de España');
      input.tournament.pointsScheme.categories.ME.review.pointsEligibilityPolicy = 'awardedAtLeastOnce';
      const round = addRound(input, '2026-09-12', [['a', 1, { bonusPoints: penalty }], ['b', 26]]);
      round.manga.resultsEvidence.adjustmentSourceUrl = 'https://official.test/penalty';
      round.manga.resultsEvidence.adjustmentReason = 'Sanción de general';
      const value = result(input);
      expect(value.status).toBe('ready');
      expect(value.rows.map(row => [row.globalRiderId, row.points])).toEqual([['a', penalty === '-25' ? '0' : '-1']]);
    }
  });
  it('opciones de elegibilidad y ronda desconocidas requieren revisión', () => {
    for (const key of ['pointsEligibilityPolicy', 'latestRoundPointsPolicy']) {
      for (const value of ['unknown', null, false]) {
        const input = snapshot();
        addRound(input, '2026-09-12', [['a', 1]]);
        input.tournament.pointsScheme.categories.ME.review[key] = value;
        review(input);
      }
    }
  });
  it('comparar rondas hacia atrás resuelve solo la primera diferencia deportiva', () => {
    const input = snapshot();
    addRound(input, '2026-09-10', [['a', 1], ['b', 2]]);
    addRound(input, '2026-09-11', [['b', 1], ['a', 2]]);
    addRound(input, '2026-09-12', [['c', 1]]);
    const implicit = review(input);
    input.tournament.pointsScheme.categories.ME.review.latestRoundPointsPolicy = 'lastHeldRound';
    expect(result(input)).toEqual(implicit);
    input.tournament.pointsScheme.categories.ME.review.latestRoundPointsPolicy = 'backwardsUntilDifferent';
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['b', 'a', 'c']);
    // Invertir el orden de las filas no altera el desempate.
    input.rounds.forEach(round => round.results.reverse());
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['b', 'a', 'c']);
    const tied = snapshot();
    tied.tournament.pointsScheme.categories.ME.review.latestRoundPointsPolicy = 'backwardsUntilDifferent';
    addRound(tied, '2026-09-12', [['a', 26], ['b', 27]]);
    review(tied);
  });
  it('usa puestos y no PointPcR/puntos importados, con cero fuera de tabla', () => {
    const input = snapshot(); addRound(input, '2026-09-12', [['a', 1, { points: 999, PointPcR: 999 }], ['b', 26]]);
    expect(result(input).rows.map(row => row.points)).toEqual(['40', '0']);
  });
  it('suma todas las élite y retiene cuatro/cinco resultados juveniles por rondas celebradas', () => {
    const input = snapshot('Copa del Mundo', 'MU');
    for (let i = 0; i < 7; i++) addRound(input, `2026-${String(i + 6).padStart(2, '0')}-12`, [['a', 1]]);
    // Junio/julio no existen en la temporada: quedan cinco rondas oficiales activas.
    expect(result(input).rows[0].points).toBe('160');
    const eight = snapshot('Copa del Mundo', 'MJ');
    for (let i = 0; i < 8; i++) addRound(eight, `2026-09-${String(i + 1).padStart(2, '0')}`, [['a', 1]]);
    expect(result(eight).rows[0].points).toBe('200');
    addRound(eight, '2026-10-01', [['a', 1]]); review(eight);
    const elite = snapshot(); for (let i = 0; i < 5; i++) addRound(elite, `2026-09-0${i + 1}`, [['a', 1]]);
    expect(result(elite).rows[0].points).toBe('200');
  });
  it('cuenta rondas oficiales completas de categoría, no participaciones de un corredor', () => {
    const input = snapshot('Copa del Mundo', 'MU');
    for (let i = 0; i < 8; i++) addRound(input, `2026-09-0${i + 1}`, i < 5 ? [['a', 1], ['b', 2]] : [['b', 1]]);
    const value = result(input); expect(value.rows.find(row => row.globalRiderId === 'a').points).toBe('200');
    expect(value.breakdown.find(entry => entry.globalRiderId === 'a').rounds.filter(round => round.missing)).toHaveLength(3);
  });
  it('no decide cómo desempatar con puestos descartados antes del cotejo', () => {
    const input = snapshot('Copa del Mundo', 'MU'); delete input.tournament.pointsScheme.categories.MU.review.droppedPlacingsPolicy;
    addRound(input, '2026-09-12', [['a', 1]]); review(input);
  });
  it('aplica la política cotejada de puestos descartados, sin cambiar la suma retenida', () => {
    const input = snapshot('Copa del Mundo', 'MU');
    const a = [1, 2, 3, 4, 5, 6, 6, 9]; const b = [2, 1, 4, 3, 7, 5, 8, 6];
    for (let i = 0; i < 8; i++) addRound(input, `2026-09-0${i + 1}`, [['a', a[i]], ['b', b[i]]]);
    expect(result(input).rows.map(row => [row.globalRiderId, row.points])).toEqual([['a', '138'], ['b', '138']]);
    input.tournament.pointsScheme.categories.MU.review.droppedPlacingsPolicy = 'retained';
    expect(result(input).rows.map(row => [row.globalRiderId, row.points])).toEqual([['b', '138'], ['a', '138']]);
  });
  it('desempata Copa del Mundo por puestos premiados y después puntos de la última ronda', () => {
    const input = snapshot(); addRound(input, '2026-09-11', [['a', 1], ['b', 2]]);
    addRound(input, '2026-09-12', [['b', 1], ['a', 2]]);
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['b', 'a']);
  });
  it('cuenta DNF como salida en Superprestige y excluye DNS', () => {
    const input = snapshot('Superprestige'); addRound(input, '2026-09-10', [['a', 1], ['b', 2]]);
    addRound(input, '2026-09-11', [['b', 1], ['a', 2]]);
    addRound(input, '2026-09-12', [['a', null, { irm: 'DNF' }], ['b', null, { irm: 'DNS' }], ['c', 1]]);
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['a', 'b', 'c']);
  });
  it('desempata Superprestige por victorias y última ronda', () => {
    const input = snapshot('Superprestige'); addRound(input, '2026-09-10', [['a', 1], ['b', 2]]);
    addRound(input, '2026-09-11', [['b', 1], ['a', 2]]);
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['b', 'a']);
    const wins = snapshot('Superprestige'); addRound(wins, '2026-09-10', [['a', 1], ['b', 2]]);
    addRound(wins, '2026-09-11', [['a', 4], ['b', 3]]);
    expect(result(wins).rows.map(row => row.globalRiderId)).toEqual(['a', 'b']);
  });
  it('mantiene puntos decimales exactos y la sanción RFEC auditada', () => {
    const input = snapshot('Copa de España'); const rule = input.tournament.pointsScheme.categories.ME;
    rule.perRank = ['9007199254740993.1', '9007199254740993.09'];
    const round = addRound(input, '2026-09-12', [['a', 1, { bonusPoints: '-25' }], ['b', 2]]);
    round.manga.resultsEvidence.adjustmentSourceUrl = 'https://official.test/penalty'; round.manga.resultsEvidence.adjustmentReason = 'Maillot';
    expect(result(input).rows.map(row => row.points)).toEqual(['9007199254740993.09', '9007199254740968.1']);
    delete round.manga.resultsEvidence.adjustmentSourceUrl; review(input);
    const unsafe = snapshot(); unsafe.tournament.pointsScheme.categories.ME.perRank = [9007199254740992];
    addRound(unsafe, '2026-09-12', [['a', 1]]); review(unsafe);
  });
  it('rechaza puntos RFEC deducidos del puesto de una manga agrupada', () => {
    const input = snapshot('Copa de España', 'WU'); const round = addRound(input, '2026-09-12', [['a', 1]]);
    delete round.manga.resultsEvidence.rankScope; review(input);
  });
  it('desempata Copa de España por la última clasificación de categoría', () => {
    const input = snapshot('Copa de España', 'WU'); addRound(input, '2026-09-10', [['a', 1], ['b', 2]]);
    addRound(input, '2026-09-11', [['b', 1], ['a', 2]]);
    expect(result(input).rows.map(row => [row.globalRiderId, row.points])).toEqual([['b', '45'], ['a', '45']]);
  });
  it('rechaza ajustes no habilitados y bonos con unidad incorrecta', () => {
    const input = snapshot(); const round = addRound(input, '2026-09-12', [['a', 1, { bonusPoints: 1 }]]); review(input);
    round.results[0].bonusPoints = 0; round.results[0].bonusSeconds = 0; review(input);
  });
  it('no inventa un desempate por nombre, ID o orden de entrada', () => {
    const input = snapshot(); addRound(input, '2026-09-10', [['a', 26], ['b', 27]]); review(input);
  });
  it('deriva WU por el año final de temporada, conservando puestos WE y sin crear manga', () => {
    const input = snapshot('Copa del Mundo', 'WU');
    addRound(input, '2026-09-12', [['elite', 1], ['u23', 3], ['young', 4], ['last', 5]]);
    input.riders.find(rider => rider.id === 'elite').birthDate = '2000-01-01';
    input.riders.find(rider => rider.id === 'u23').birthDate = '2005-12-31'; // 22 en año 2027, aunque 20 en la ronda.
    input.riders.find(rider => rider.id === 'young').birthDate = '2009-01-01';
    input.riders.find(rider => rider.id === 'last').birthDate = '2008-12-31';
    expect(result(input).rows.map(row => [row.globalRiderId, row.points])).toEqual([['u23', '25'], ['last', '21']]);
    expect(input.rounds[0].manga.category).toBe('WE');
    input.riders[0].verified = false; review(input);
  });
});

describe('X2O: segundos, bonos, forfaits y elegibilidad', () => {
  const finish = (timeSeconds, bonusSeconds = 0) => ({ timeSeconds: String(timeSeconds), bonusSeconds });
  it('permite descartar bonos en forfaits revisados y conserva el bono publicado y el tiempo real', () => {
    const input = snapshot('X2O Trofee');
    input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = 'discard';
    const first = addRound(input, '2026-09-12', [['a', 1, finish(3600, 5)], ['b', 2, finish(4010, 30)],
      ['c', null, {irm:'DNF',bonusSeconds:15}], ['d', 3, {irm:'LAP',bonusSeconds:5}],
      ['e', null, {irm:'DNS',bonusSeconds:0}], ['f', 4, finish(3900,10)]]);
    addRound(input, '2026-09-13', [['a', 1, finish(3500)], ['b', 2, finish(3510)], ['c', 3, finish(3520)],
      ['d', 4, finish(3530)], ['e', 5, finish(3540)], ['f', 6, finish(3550)], ['g', 7, finish(3560)]]);
    const value = result(input); expect(value.status).toBe('ready');
    const contribution = rider => value.breakdown.find(entry => entry.globalRiderId === rider).rounds[0];
    expect(contribution('a')).toMatchObject({forfait:false,bonusSeconds:'5',appliedBonusSeconds:'5',discardedBonusSeconds:'0',timeSeconds:'3595'});
    for (const [rider,bonus] of [['b','30'],['c','15'],['d','5']]) {
      expect(contribution(rider)).toMatchObject({forfait:true,bonusSeconds:bonus,appliedBonusSeconds:'0',discardedBonusSeconds:bonus,timeSeconds:'3900'});
    }
    expect(contribution('e')).toMatchObject({forfait:true,bonusSeconds:'0',timeSeconds:'3900',missing:false});
    expect(contribution('g')).toMatchObject({forfait:true,bonusSeconds:'0',timeSeconds:'3900',missing:true});
    expect(contribution('f')).toMatchObject({forfait:false,bonusSeconds:'10',appliedBonusSeconds:'10',timeSeconds:'3890'});
    expect(first.results[1].timeSeconds).toBe('4010');
    expect(first.results[2].bonusSeconds).toBe(15); expect(first.results[2].timeSeconds).toBeNull();
  });
  it('requiere política explícita, mantiene retain para cotejo previo y rechaza desconocidos/bonos NULL', () => {
    const input = snapshot('X2O Trofee');
    addRound(input, '2026-09-12', [['a', 1, finish(3600)], ['b', 2, finish(4010,15)]]);
    addRound(input, '2026-09-13', [['b', 1, finish(3500)], ['a', 2, finish(3510)]]);
    delete input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy; review(input);
    input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = 'retain';
    expect(result(input).rows.find(row => row.globalRiderId === 'b').timeSeconds).toBe('7385');
    for (const policy of [null,'ignore','']) {
      input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = policy; review(input);
    }
    input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = 'discard';
    input.rounds[0].results[1].irm = 'DNF'; input.rounds[0].results[1].rank = null;
    input.rounds[0].results[1].timeSeconds = null; input.rounds[0].results[1].bonusSeconds = null; review(input);
  });
  it('reproduce retain explícito, limita el gap antes de restar bonos y conserva tiempo real', () => {
    const input = snapshot('X2O Trofee');
    input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = 'retain';
    const round = addRound(input, '2026-09-12', [['a', 1, finish(3600, 5)], ['b', 2, finish(4010, 30)], ['c', 3, finish(3880, 10)]]);
    addRound(input, '2026-09-13', [['b', 1, finish(3600)], ['a', 2, finish(3610)], ['c', 3, finish(3620)]]);
    const value = result(input); expect(value.status).toBe('ready');
    expect(value.rows.map(row => [row.globalRiderId, row.timeSeconds, row.points])).toEqual([['a', '7205', null], ['b', '7470', null], ['c', '7490', null]]);
    expect(value.breakdown.find(entry => entry.globalRiderId === 'b').rounds[0]).toMatchObject({ cappedGapSeconds: '300', bonusSeconds: '30', timeSeconds: '3870', forfait: true });
    expect(round.results[1].timeSeconds).toBe('4010');
  });
  it('reproduce los forfaits retain previos sin inventar tiempos reales', () => {
    const input = snapshot('X2O Trofee');
    input.tournament.pointsScheme.categories.ME.review.forfaitBonusesPolicy = 'retain';
    const first = addRound(input, '2026-09-12', [['a', 1, finish(3600)], ['b', null, { irm: 'DNF', bonusSeconds: 15 }],
      ['c', 3, { irm: 'LAP', bonusSeconds: 5 }], ['d', null, { irm: 'DNS', bonusSeconds: 0 }]]);
    addRound(input, '2026-09-13', [['b', 1, finish(3500)], ['c', 2, finish(3510)], ['a', 3, finish(3520)], ['e', 4, finish(3530)]]);
    const value = result(input); expect(value.status).toBe('ready');
    expect(value.rows.map(row => row.globalRiderId)).not.toContain('d');
    expect(value.rows.find(row => row.globalRiderId === 'e').timeSeconds).toBe('7430');
    expect(value.rows.find(row => row.globalRiderId === 'b').timeSeconds).toBe('7385');
    expect(first.results[1].timeSeconds).toBeNull(); expect(first.results[2].timeSeconds).toBeNull();
  });
  it('no publica ningún acumulado con bono desconocido, incluso DNF', () => {
    for (const state of ['', 'DNF', 'LAP', 'DNS']) {
      const input = snapshot('X2O Trofee'); addRound(input, '2026-09-12', [['a', 1, finish(3600)],
        ['b', state === '' ? 2 : null, { irm: state, timeSeconds: state ? null : '3610', bonusSeconds: null }]]); review(input);
    }
  });
  it('exige tiempo absoluto, ganador, fuente de bonos y estado reglamentario', () => {
    for (const edit of [round => round.results[1].timeSeconds = null, round => round.results[1].timeSeconds = '3500',
      round => round.results[0].timeSeconds = null, round => round.manga.bonusSourceUrl = null,
      round => round.results[1].bonusSeconds = 31, round => round.results[1].bonusSeconds = 7,
      round => { round.results[1].irm = 'DNS'; round.results[1].rank = null; round.results[1].bonusSeconds = 5; },
      round => { round.results[1].irm = 'DSQ'; round.results[1].rank = null; }]) {
      const input = snapshot('X2O Trofee'); const round = addRound(input, '2026-09-12', [['a', 1, finish(3600)], ['b', 2, finish(3620)]]); edit(round); review(input);
    }
  });
  it('admite exactamente 300 segundos para elegibilidad, excluye quien nunca termina dentro', () => {
    const input = snapshot('X2O Trofee'); addRound(input, '2026-09-12', [['a', 1, finish(3600)], ['b', 2, finish(3900)], ['c', 3, finish(3901)]]);
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['a', 'b']);
  });
  it('desempata por mejor plaza en la serie y plaza de la última ronda', () => {
    const input = snapshot('X2O Trofee'); addRound(input, '2026-09-12', [['a', 1, finish(3600)], ['b', 2, finish(3610)]]);
    addRound(input, '2026-09-13', [['b', 1, finish(3600)], ['a', 2, finish(3610)]]);
    expect(result(input).rows.map(row => row.globalRiderId)).toEqual(['b', 'a']);
    const best = snapshot('X2O Trofee'); addRound(best, '2026-09-12', [['a', 1, finish(3600)], ['b', 2, finish(3610, 10)]]);
    addRound(best, '2026-09-13', [['c', 1, finish(3500)], ['b', 2, finish(3510)], ['a', 3, finish(3510)]]);
    expect(result(best).rows.map(row => row.globalRiderId)).toEqual(['a', 'b', 'c']);
  });
  it('conserva acumulados mayores de 24 horas y números fuera de Number seguro', () => {
    const input = snapshot('X2O Trofee'); addRound(input, '2026-09-12', [['a', 1, finish('9007199254740993')]]);
    addRound(input, '2026-09-13', [['a', 1, finish('9007199254740993')]]);
    expect(result(input).rows[0].timeSeconds).toBe('18014398509481986');
    input.rounds[0].results[0].timeSeconds = Number('9007199254740993'); review(input);
  });
  it('rechaza desbordamiento BIGINT, puntos/descartes y cambios de premios no revisados', () => {
    const input = snapshot('X2O Trofee'); addRound(input, '2026-09-12', [['a', 1, finish('9223372036854775807')]]);
    addRound(input, '2026-09-13', [['a', 1, finish('9223372036854775807')]]); review(input);
    const points = snapshot('X2O Trofee'); const round = addRound(points, '2026-09-12', [['a', 1, { ...finish(3600), bonusPoints: 1 }]]); review(points);
    round.results[0].bonusPoints = 0; points.tournament.pointsScheme.categories.ME.extras.sprints.perRank = [20, 10, 5]; review(points);
  });
});
