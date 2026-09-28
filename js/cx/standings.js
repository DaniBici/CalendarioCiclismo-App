import { cxDateInSeason } from './season.js';

const CX_STANDINGS_ENGINE_VERSION = 3;
const CATEGORIES = ['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'];
const PG_BIGINT_MAX = 9223372036854775807n;
const NON_FINISHERS = new Set(['DNS', 'DNF', 'DSQ', 'DSQ-R', 'ABD', 'OTL']);
const KNOWN_IRM = new Set([...NON_FINISHERS, 'LAP']);
const url = value => typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value);
const irm = row => (row?.irm || '').trim().toUpperCase();
const placed = row => row && Number.isInteger(row.rank) && row.rank > 0 && !NON_FINISHERS.has(irm(row));

// NUMERIC y BIGINT viajan como texto. No redondear puntos decimales ni tiempos de 64 bits.
function decimal(value) {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('Puntos no representables sin pérdida');
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d+(\.\d{1,12})?$/.test(text)) throw new Error('Puntos inválidos');
  const [whole, fraction = ''] = text.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}
function aligned(value, scale) { return value.coefficient * 10n ** BigInt(scale - value.scale); }
function decimalText(coefficient, scale) {
  const sign = coefficient < 0n ? '-' : '';
  let text = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  if (scale) text = `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.?0+$/, '');
  return coefficient === 0n ? '0' : sign + text;
}
function seconds(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Tiempo no representable sin pérdida');
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+$/.test(text)) throw new Error('Tiempo desconocido o inválido');
  const result = BigInt(text);
  if (result > PG_BIGINT_MAX) throw new Error('Tiempo fuera de BIGINT');
  return result;
}
const sum = values => values.reduce((total, value) => total + value, 0n);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const effectiveDate = round => round.manga.dateKey || round.race.dateKey;
function civilDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/**
 * Entrada: snapshot de cx_standings_snapshot. Solo usa filas oficializadas.
 * Salida sin efectos: ready/empty/needs_review, filas y desglose por ronda.
 * La publicación transaccional comprueba nuevamente el digest de la entrada.
 */
export function recomputeCxStandings(snapshot) {
  const output = {
    engineVersion: CX_STANDINGS_ENGINE_VERSION, status: 'needs_review', category: snapshot?.category,
    unit: null, rows: [], roundIds: [], excludedRounds: [], issues: [], breakdown: [],
  };
  const issue = (code, message, details = {}) => output.issues.push({ code, message, ...details });
  try {
    const tournament = snapshot?.tournament;
    const scheme = tournament?.pointsScheme;
    const category = snapshot?.category;
    if (!tournament?.id || !CATEGORIES.includes(category)) throw new Error('Torneo o categoría inválidos');
    const rule = scheme?.categories?.[category];
    if (!rule || !['points', 'time'].includes(rule.mode)) throw new Error('Categoría sin esquema propio');
    output.unit = rule.mode;
    if (scheme.version !== 1 || scheme.status !== 'verified' || scheme.edition?.seasonKey !== tournament.seasonKey
      || !url(rule.review?.cotejoUrl) || !url(rule.review?.sourceUrl)
      || !civilDate(scheme.edition?.reviewedAt)
      || !Array.isArray(scheme.sourceUrls) || !scheme.sourceUrls.length || !scheme.sourceUrls.every(url)) {
      throw new Error('Edición, reglamento y cotejo de categoría sin verificar');
    }
    const derived = rule.extras?.derived;
    const sourceCategory = derived?.fromCategory || category;
    if (!CATEGORIES.includes(sourceCategory) || (derived &&
      (category !== 'WU' || sourceCategory !== 'WE' || derived.ageReference !== 'seasonEndYear'
        || derived.rankPolicy !== 'preserveSourceRank' || rule.review.derivedCategory !== true
        || JSON.stringify(derived.ages) !== '[19,22]'))) throw new Error('General derivada sin regla verificada');
    if (!Array.isArray(snapshot.rounds) || !Array.isArray(snapshot.riders)) throw new Error('Snapshot incompleto');
    const rounds = [];
    const seenRaces = new Set();
    for (const round of snapshot.rounds) {
      const race = round?.race;
      const manga = round?.manga;
      if (!race?.id || seenRaces.has(race.id) || manga?.category !== sourceCategory) throw new Error('Ronda duplicada o categoría incorrecta');
      seenRaces.add(race.id);
      const excluded = race.tournamentId !== tournament.id || race.seasonKey !== tournament.seasonKey
        || race.editorialStatus !== 'published' || race.isCancelled || manga.isCancelled
        || !cxDateInSeason(tournament.seasonKey, race.dateKey)
        || !cxDateInSeason(tournament.seasonKey, race.endDateKey || race.dateKey)
        || !cxDateInSeason(tournament.seasonKey, effectiveDate(round))
        || effectiveDate(round) < race.dateKey || effectiveDate(round) > (race.endDateKey || race.dateKey)
        || manga.resultsStatus !== 'official';
      if (excluded) { output.excludedRounds.push(race.id); continue; }
      if (!url(manga.resultsSourceUrl) || !Array.isArray(round.results) || !round.results.length) {
        issue('round_source', 'Ronda oficial sin resultados o fuente verificable', { raceId: race.id }); continue;
      }
      rounds.push(round);
    }
    rounds.sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b))
      || (a.manga.startTimeUtc || '').localeCompare(b.manga.startTimeUtc || ''));
    output.roundIds = rounds.map(round => round.race.id);
    if (rounds.some((round, index) => index && effectiveDate(round) === effectiveDate(rounds[index - 1])
      && (!round.manga.startTimeUtc || !rounds[index - 1].manga.startTimeUtc
        || round.manga.startTimeUtc === rounds[index - 1].manga.startTimeUtc))) {
      issue('round_order', 'Orden de rondas del mismo día sin verificar');
    }
    if (rule.rounds && (rule.rounds.scope !== 'category' || !Number.isInteger(rule.rounds.expected)
      || rounds.length > rule.rounds.expected)) issue('round_count', 'Número de rondas fuera del reglamento revisado');
    if (output.issues.length) return output;
    if (!rounds.length) { output.status = 'empty'; return output; }
    const riders = new Map();
    for (const rider of snapshot.riders) {
      if (!rider?.id || riders.has(rider.id)) throw new Error('Catálogo CX duplicado o inválido');
      riders.set(rider.id, rider);
    }
    const participants = new Map();
    for (const round of rounds) {
      const identities = new Set();
      const ranks = new Set();
      for (const row of round.results) {
        const id = row.globalRiderId;
        if (row.raceId !== round.race.id || row.category !== sourceCategory) throw new Error('Filas de otra carrera o categoría');
        if (!id || !riders.has(id) || identities.has(id) || !row.riderDisplay?.trim()) {
          issue('identity', 'Fila sin identidad CX resuelta, repetida o sin nombre', { raceId: round.race.id }); continue;
        }
        identities.add(id);
        if ((row.rank != null && (!Number.isInteger(row.rank) || row.rank <= 0 || ranks.has(row.rank)))
          || (irm(row) && !KNOWN_IRM.has(irm(row))) || (!placed(row) && !KNOWN_IRM.has(irm(row)))
          || (row.rank != null && NON_FINISHERS.has(irm(row)))) {
          issue('result_rank', 'Puesto o estado oficial requiere revisión', { raceId: round.race.id, globalRiderId: id }); continue;
        }
        if (row.rank != null) ranks.add(row.rank);
        if (derived) {
          const rider = riders.get(id);
          if (rider.verified !== true || !civilDate(rider.birthDate)) {
            issue('derived_age', 'Identidad o nacimiento femenino sin verificar', { globalRiderId: id }); continue;
          }
          const age = Number(tournament.seasonKey.slice(0, 4)) + 1 - Number(rider.birthDate.slice(0, 4));
          if (age < derived.ages[0] || age > derived.ages[1]) continue;
        }
        if (!participants.has(id)) participants.set(id, { id, results: new Map() });
        participants.get(id).results.set(round.race.id, row);
      }
    }
    if (output.issues.length) return output;
    const entries = [...participants.values()];
    for (const entry of entries) {
      const latest = [...entry.results.values()].at(-1);
      entry.row = { globalRiderId: entry.id, riderDisplay: latest.riderDisplay,
        teamName: latest.teamName || null, isoCode2: latest.isoCode2 || null, points: null, timeSeconds: null };
      entry.rounds = rounds.map(round => ({ raceId: round.race.id, result: entry.results.get(round.race.id) || null }));
    }
    if (rule.mode === 'points') calculatePoints(entries, rounds, rule);
    else calculateTime(entries, rounds, rule);
    const ranked = entries.filter(entry => entry.eligible);
    const tieKeys = (rule.tieBreakers || []).map(tie => tieKey(tie, rule));
    if (!tieKeys.length) throw new Error('Desempates sin configurar');
    const comparator = (a, b) => {
      let result = compare(a.total, b.total) * (rule.mode === 'points' ? -1 : 1);
      for (const key of tieKeys) {
        if (result) break;
        const aKeys = key(a); const bKeys = key(b);
        for (let i = 0; i < aKeys.length && !result; i++) result = compare(aKeys[i], bKeys[i]);
      }
      return result;
    };
    ranked.sort(comparator);
    for (let index = 1; index < ranked.length; index++) {
      if (!comparator(ranked[index - 1], ranked[index])) {
        issue('unresolved_tie', 'Empate no resuelto por el reglamento; requiere clasificación oficial',
          { globalRiderIds: [ranked[index - 1].id, ranked[index].id] });
      }
    }
    output.breakdown = entries.map(entry => ({ globalRiderId: entry.id, eligible: entry.eligible,
      rounds: entry.rounds.map(({ result: _result, ...round }) => round) }));
    if (output.issues.length) return output;
    output.rows = ranked.map((entry, index) => ({ ...entry.row, rank: index + 1 }));
    output.status = output.rows.length ? 'ready' : 'empty';
    return output;
  } catch (error) {
    issue('calculation_review', error.message);
    return output;
  }
}

function calculatePoints(entries, rounds, rule) {
  if (!Array.isArray(rule.perRank) || !rule.perRank.length || rule.extras?.sprints?.enabled
    || rule.extras?.fastestLap?.enabled) throw new Error('Escala de puntos o premios incompatibles');
  const table = rule.perRank.map(decimal);
  if (table.some(point => point.coefficient < 0n)) throw new Error('Escala de puntos negativa');
  const eligibility = rule.review?.pointsEligibilityPolicy === undefined ? 'startedAtLeastOnce' : rule.review.pointsEligibilityPolicy;
  if (!['startedAtLeastOnce', 'awardedAtLeastOnce'].includes(eligibility)) throw new Error('Elegibilidad por puntos sin cotejar');
  const adjustments = [];
  for (const round of rounds) {
    const evidence = round.manga.resultsEvidence || {};
    if (rule.extras?.rankPolicy === 'officialCategoryRank'
      && (evidence.rankScope !== 'officialCategory' || !url(evidence.categoryClassificationSourceUrl))) {
      throw new Error('Falta la clasificación oficial de categoría; no usar el puesto de la manga agrupada');
    }
    for (const row of round.results) {
      if (row.bonusSeconds != null) throw new Error('Bono en segundos dentro de un torneo por puntos');
      const adjustment = decimal(row.bonusPoints ?? 0);
      if (adjustment.coefficient && (rule.extras?.pointAdjustments?.enabled !== true
        || !url(evidence.adjustmentSourceUrl) || !evidence.adjustmentReason?.trim())) {
        throw new Error('Ajuste en puntos no habilitado o sin evidencia auditada');
      }
      adjustments.push(adjustment);
    }
  }
  const scale = Math.max(...table.map(point => point.scale), ...adjustments.map(point => point.scale));
  let keep = rounds.length;
  if (rule.drops?.mode === 'bestResults') {
    const matched = rule.drops.byHeldRounds?.filter(limit => limit.exact === rounds.length
      || (limit.max != null && rounds.length <= limit.max));
    if (matched?.length !== 1 || !Number.isInteger(matched[0].keep) || matched[0].keep < 1) {
      throw new Error('Descartes fuera de las rondas celebradas de la categoría');
    }
    keep = Math.min(rounds.length, matched[0].keep);
  } else if (rule.drops?.mode !== 'none') throw new Error('Política de descartes desconocida');
  for (const entry of entries) {
    for (const round of entry.rounds) {
      const row = round.result;
      const position = placed(row) ? row.rank : null;
      const base = position && position <= table.length ? aligned(table[position - 1], scale) : 0n;
      // Una sanción de general no desaparece al descartar el resultado de la ronda.
      round.base = base; round.adjustment = aligned(decimal(row?.bonusPoints ?? 0), scale);
      round.sourceRank = position; round.missing = !row;
    }
    const retained = [...entry.rounds].sort((a, b) => compare(b.base, a.base)
      || rounds.findIndex(round => round.race.id === b.raceId) - rounds.findIndex(round => round.race.id === a.raceId)).slice(0, keep);
    const retainedIds = new Set(retained.map(round => round.raceId));
    entry.total = sum(retained.map(round => round.base)) + sum(entry.rounds.map(round => round.adjustment));
    entry.row.points = decimalText(entry.total, scale);
    entry.eligible = eligibility === 'awardedAtLeastOnce'
      ? entry.rounds.some(round => round.base > 0n)
      : entry.rounds.some(round => round.result && irm(round.result) !== 'DNS') || entry.total !== 0n;
    for (const round of entry.rounds) {
      round.retained = retainedIds.has(round.raceId); round.points = decimalText(round.base, scale);
      round.bonusPoints = decimalText(round.adjustment, scale); delete round.base; delete round.adjustment;
    }
  }
}

function calculateTime(entries, rounds, rule) {
  const extras = rule.extras;
  const forfait = extras?.forfait;
  const bonusPolicy = rule.review?.forfaitBonusesPolicy;
  if (rule.perRank != null || rule.drops?.mode !== 'none' || extras?.precision !== 'wholeSeconds'
    || extras.timeSource !== 'timeSeconds' || extras.bonusesSource !== 'bonusSeconds'
    || extras.bonusesOperation !== 'subtract' || extras.unknownBonusesPolicy !== 'stopForReview'
    || extras.pointAdjustments?.enabled || forfait?.applyBeforeBonuses !== true
    || !['retain', 'discard'].includes(bonusPolicy)
    || forfait?.gapSeconds !== 300 || forfait?.finishGapCapSeconds !== 300
    || JSON.stringify([...(forfait.states || [])].sort()) !== JSON.stringify(['DNF', 'DNS', 'LAP', 'missingRound'].sort())
    || extras.eligibility?.finishWithinWinnerSecondsAtLeastOnce !== 300
    || rule.review?.missingRoundBonuses !== 'none'
    || extras.sprints?.enabled !== true || extras.sprints?.unit !== 'seconds'
    || extras.sprints?.countPerRound !== 1 || extras.sprints?.phase !== 'endOfFirstLap'
    || JSON.stringify(extras.sprints?.perRank) !== '[15,10,5]'
    || extras.fastestLap?.enabled !== true || extras.fastestLap?.unit !== 'seconds'
    || extras.fastestLap?.excludeStartLoop !== true || extras.fastestLap?.perRider !== true
    || JSON.stringify(extras.fastestLap?.perRank) !== '[15,10,5]') throw new Error('Reglas de tiempo/forfait sin verificar');
  const winnerTimes = new Map();
  for (const round of rounds) {
    if (!url(round.manga.bonusSourceUrl)) throw new Error('Informe oficial de bonos X2O no disponible');
    const winners = round.results.filter(row => placed(row) && row.rank === 1 && !irm(row));
    if (winners.length !== 1) throw new Error('Ganador de ronda desconocido');
    winnerTimes.set(round.race.id, seconds(winners[0].timeSeconds));
    for (const row of round.results) {
      if (decimal(row.bonusPoints ?? 0).coefficient !== 0n) throw new Error('Puntos dentro de una general por tiempo');
      const bonus = seconds(row.bonusSeconds); // NULL impide calcular también DNF/doblados: pudieron ganar premios.
      if (bonus > 30n || bonus % 5n || (irm(row) === 'DNS' && bonus !== 0n)) throw new Error('Bono incompatible con el sprint/vuelta rápida o con DNS');
      if (irm(row) && !forfait.states.includes(irm(row))) throw new Error('Estado sin forfait definido por el reglamento');
    }
  }
  for (const entry of entries) {
    entry.eligible = false;
    const contributions = [];
    for (const round of entry.rounds) {
      const row = round.result;
      const winner = winnerTimes.get(round.raceId);
      const state = row ? irm(row) : 'missingRound';
      let gap = 300n;
      if (!state) {
        const actual = seconds(row.timeSeconds);
        if (actual < winner) throw new Error('Tiempo de meta inferior al ganador');
        const realGap = actual - winner;
        if (realGap <= 300n) entry.eligible = true;
        gap = realGap > 300n ? 300n : realGap;
      }
      const bonus = row ? seconds(row.bonusSeconds) : 0n;
      const isForfait = !!state || seconds(row.timeSeconds) - winner > 300n;
      const appliedBonus = isForfait && bonusPolicy === 'discard' ? 0n : bonus;
      const contribution = winner + gap - appliedBonus;
      if (contribution < 0n) throw new Error('Bono superior al tiempo computado');
      contributions.push(contribution);
      round.sourceRank = placed(row) ? row.rank : null;
      round.missing = !row; round.forfait = isForfait;
      round.winnerSeconds = winner.toString(); round.cappedGapSeconds = gap.toString();
      round.bonusSeconds = bonus.toString(); round.appliedBonusSeconds = appliedBonus.toString();
      round.discardedBonusSeconds = (bonus - appliedBonus).toString(); round.timeSeconds = contribution.toString();
    }
    entry.total = sum(contributions);
    if (entry.total > PG_BIGINT_MAX) throw new Error('Acumulado fuera de BIGINT');
    entry.row.timeSeconds = entry.total.toString();
  }
}

function tieKey(tie, rule) {
  const rank = round => round?.sourceRank ?? Infinity;
  const last = entry => entry.rounds.at(-1);
  if (tie.type === 'countPlacings') {
    if (tie.direction !== 'desc' || !Number.isInteger(tie.ranksFrom) || !Number.isInteger(tie.ranksTo)
      || tie.ranksFrom < 1 || tie.ranksTo > rule.perRank.length || tie.ranksTo < tie.ranksFrom) throw new Error('Conteo de puestos inválido');
    const policy = rule.review.droppedPlacingsPolicy;
    if (rule.drops.mode !== 'none' && !['all', 'retained'].includes(policy)) throw new Error('Desempate con puestos descartados sin cotejar');
    return entry => Array.from({ length: tie.ranksTo - tie.ranksFrom + 1 }, (_, offset) =>
      -entry.rounds.filter(round => (rule.drops.mode === 'none' || policy === 'all' || round.retained)
        && round.sourceRank === offset + tie.ranksFrom).length);
  }
  if (tie.type === 'latestRoundPoints' && tie.direction === 'desc' && rule.mode === 'points') {
    const policy = rule.review.latestRoundPointsPolicy === undefined ? 'lastHeldRound' : rule.review.latestRoundPointsPolicy;
    if (policy === 'lastHeldRound') return entry => [-aligned(decimal(last(entry).points), 12)];
    if (policy === 'backwardsUntilDifferent') return entry => [...entry.rounds].reverse()
      .map(round => -aligned(decimal(round.points), 12));
    throw new Error('Desempate por ronda reciente sin cotejar');
  }
  if (tie.type === 'starts' && tie.direction === 'desc' && JSON.stringify(tie.excludeIrm) === '["DNS"]') {
    return entry => [-entry.rounds.filter(round => round.result && irm(round.result) !== 'DNS').length];
  }
  if (tie.type === 'wins' && tie.direction === 'desc') return entry => [-entry.rounds.filter(round => round.sourceRank === 1).length];
  if (tie.type === 'lastHeldRoundRank' && tie.direction === 'asc') return entry => [rank(last(entry))];
  if (tie.type === 'bestSeriesRank' && tie.direction === 'asc') return entry => [Math.min(...entry.rounds.map(rank))];
  throw new Error('Desempate no implementado por el reglamento');
}
