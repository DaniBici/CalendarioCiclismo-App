import { isNonWinnerIrm } from './uci-irm.js';

// raceDayId distingue los sectores que comparten stageNumber. Las cabeceras
// antiguas sin jornada solo se atribuyen por número cuando no hay ambigüedad.
export function resultClassificationBelongsToDay(stage, rd, raceDays = []) {
  if (!stage || !rd || (stage.raceId && rd.raceId && stage.raceId !== rd.raceId)) return false;
  if (stage.raceDayId != null) return stage.raceDayId === rd.id;
  if (stage.stageNumber == null || rd.stageNumber == null
      || stage.stageNumber !== rd.stageNumber) return false;

  const candidates = raceDays.filter(day => !day.isRestDay
    && day.stageNumber === rd.stageNumber
    && (!day.raceId || !rd.raceId || day.raceId === rd.raceId));
  return candidates.length === 1 && candidates[0].id === rd.id;
}

export function findResultClassificationDuplicate(stages, rd, { kind, scope, isFinal }, raceDays = []) {
  const stageNumber = isFinal ? null : (rd.stageNumber ?? null);
  return stages.find(stage => stage.classKind === kind && stage.scope === scope
    && (!stage.raceId || !rd.raceId || stage.raceId === rd.raceId)
    && (stage.stageNumber ?? null) === stageNumber
    && !!stage.isFinalClassification === isFinal
    && (isFinal || resultClassificationBelongsToDay(stage, rd, raceDays)));
}

// ── Alta manual de clasificaciones del panel ─────────────────────────────
// El id es `ru_<eventId>` y el eventId es SINTÉTICO NEGATIVO determinista (misma
// convención que los fetchers PDF/Matsport/…: fnv1a(salt+clave)%200000). Negativo
// → jamás choca con los eventId positivos de DataRide; el offset por slot+clase lo
// hace único entre clasificaciones de la misma jornada. Se crea SIN bloquear:
// es un placeholder que la fuente oficial PISA si llega (decisión Dani 2026-06-27;
// el upsert purga las gemelas sintéticas por raceId+raceDayId+classKind+scope).
function manualClassificationHash(str) {
  let h = 0x811c9dc5;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}
// Índice por (classKind, isFinal) para separar el eventId de tipos distintos de la
// misma jornada. stage→0, gc→1, points→2, kom→3, youth→4, teams→5; +50 si es final.
const MANUAL_CLASSIFICATION_INDEX = { stage: 0, gc: 1, points: 2, kom: 3, youth: 4, teams: 5 };
function manualClassificationScope(kind, isFinal) {
  // Espejo de cómo el cron mapea scope (cosmético: la web agrupa por stageNumber +
  // classKind, NO usa scope). stage/gc → 'stage'; secundarias overall → 'overall'.
  if (kind === 'stage' || kind === 'gc') return 'stage';
  return isFinal ? 'stage' : 'overall';
}

// Devuelve la fila de race_uci_stages de una clasificación tecleada en el panel.
// Lanza si ya existe la misma clasificación lógica para la jornada.
export function manualResultClassificationRow(rd, stages, kind, isFinal, raceDays = [], classLabel = kind) {
  // Una "final" no cuelga de etapa (stageNumber null, raceDayId null, como el cron).
  // Si no, cuelga de ESTA jornada.
  const stageNumber = isFinal ? null : (rd.stageNumber ?? null);
  const raceDayId = isFinal ? null : rd.id;
  const scope = manualClassificationScope(kind, isFinal);

  // Guard contra el error más típico: ya existe esa misma clasificación lógica
  // (raceId ya está fijo por la lista) para esta jornada/scope. Mejor avisar que dejar
  // que reviente el UNIQUE del eventId/id con un error críptico.
  const dup = findResultClassificationDuplicate(stages, rd, { kind, scope, isFinal }, raceDays);
  if (dup) {
    const lbl = classLabel + (isFinal ? ' (final)' : '');
    throw new Error(`Ya existe una clasificación «${lbl}» para esta jornada. Edítala desde la lista en vez de crear otra.`);
  }

  const base = manualClassificationHash(`manual:${rd.raceId}`) % 200000;
  const slot = (stageNumber == null ? 99 : stageNumber);     // 99 = bloque final
  const idx = (MANUAL_CLASSIFICATION_INDEX[kind] ?? 9) + (isFinal ? 50 : 0);
  let eventId = -((base * 10000 + slot * 100 + idx) & 0x7fffffff);

  // Garantizar unicidad de eventId frente a lo ya presente (improbable choque, pero
  // dos "finales" de tipos distintos comparten slot 99 → el idx las separa; si aun
  // así colisiona con algo, desplazar).
  const used = new Set(stages.map(s => Number(s.eventId)));
  while (used.has(eventId)) eventId -= 1;

  const id = `ru_${eventId}`;
  const row = {
    id,
    raceId: rd.raceId,
    raceDayId,
    competitionId: eventId,   // sintético: sin DataRide, competitionId = eventId
    uciRaceId: eventId,       // NOT NULL en schema; sintético
    eventId,
    classKind: kind,
    scope,
    eventName: null,
    isTeamEvent: kind === 'teams',
    stageNumber,
    isFinalClassification: isFinal,
    stageDate: rd.dateKey || null,
    raceType: rd.primaryType === 'itt' ? 'ITT' : (rd.primaryType === 'ttt' ? 'TTT' : null),
    rowCount: 0,
    // keepForWeb es una columna GENERADA (migración 092): true cuando classKind ∈
    // {stage,gc,points,kom,youth,teams} Y (classKind ∈ {stage,gc} O scope='overall'
    // O isFinalClassification). manualClassificationScope garantiza scope='overall' en las
    // secundarias no-finales → siempre sale true. NO se inserta a mano.
    // lockedAt: null → placeholder; la fuente oficial puede pisarla hasta que se
    // edite/guarde (que la bloquea) o se use el candado de la lista.
  };
  return row;
}

export function isFinalStageRaceDay(rd, race, raceDays = []) {
  if (race?.raceFormat !== 'stage_race' || rd?.isRestDay || rd?.isCancelledDay
      || rd?.stageNumber == null) return false;

  const racedDays = raceDays.filter((day) => !day.isRestDay && !day.isCancelledDay
    && day.stageNumber != null);
  if (!racedDays.length) return false;

  const ordered = [...racedDays].sort((a, b) => {
    const byDate = String(a.dateKey || '').localeCompare(String(b.dateKey || ''));
    if (byDate) return byDate;
    const timeOf = (day) => day.neutralStartTimeUtc
      ? new Date(day.neutralStartTimeUtc).getTime()
      : Infinity;
    const byTime = timeOf(a) - timeOf(b);
    if (Number.isFinite(byTime) && byTime) return byTime;
    const byStage = Number(a.stageNumber) - Number(b.stageNumber);
    return byStage || String(a.id || '').localeCompare(String(b.id || ''));
  });
  return rd.id === ordered.at(-1)?.id;
}

// Una excepción de horario de jornada se reconoce por sus instantes exactos.
// Cualquier carrera enlazada está activa y una jornada solo puede modificar su
// ventana, no apagar el volcado.
export function hasResultSyncDayOverride(rd) {
  return rd?.resultsSyncStartAt != null
    || rd?.resultsSyncStopAt != null
    || rd?.resultsSyncStartOffsetMinutes != null
    || rd?.resultsSyncIntervalMinutes != null
    || rd?.resultsSyncStopOffsetMinutes != null;
}

export function resultSyncDefaultScope(rd) {
  return rd?.stageNumber != null || hasResultSyncDayOverride(rd) ? 'day' : 'race';
}

export function resultSyncScopeOptionsVisible(race) {
  return race?.raceFormat === 'stage_race';
}

export const RESULT_SYNC_DAY_STATE_SELECT = [
  'resultsSyncStartAt',
  'resultsSyncStopAt',
  'resultsSyncStartOffsetMinutes',
  'resultsSyncIntervalMinutes',
  'resultsSyncStopOffsetMinutes',
].join(',');

// El editor conserva la jornada cargada mientras vuelve a renderizar la pestaña.
// Sustituir en ese objeto los valores confirmados por Postgres evita que el render
// posterior reponga visualmente la ventana anterior.
export function applyPersistedResultSyncDayState(rd, savedDay) {
  if (!rd || !savedDay) return rd;
  RESULT_SYNC_DAY_STATE_SELECT.split(',').forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(savedDay, field)) rd[field] = savedDay[field];
  });
  return rd;
}

export function shouldMirrorFinalClassification(stage, isFinalDay) {
  return !!isFinalDay && stage?.classKind !== 'stage' && !stage?.isFinalClassification;
}

export function pairFinalClassifications(mine, finals, isFinalDay) {
  if (!isFinalDay) return { mine: [...mine], finals: [...finals] };

  const remainingFinals = [...finals];
  const pairedMine = mine.map((stage) => {
    if (!shouldMirrorFinalClassification(stage, true)) return stage;
    const twinIndex = remainingFinals.findIndex((final) => final.classKind === stage.classKind);
    if (twinIndex === -1) return { ...stage, _isFinalRaceDay: true };

    const [twin] = remainingFinals.splice(twinIndex, 1);
    return {
      ...stage,
      _isFinalRaceDay: true,
      _finalTwinId: twin.id,
      _finalTwinEventId: twin.eventId,
      _finalTwinLockedAt: twin.lockedAt || null,
      _finalTwinOfficialAt: twin.officialAt || null,
      _finalTwinPublicationStatus: twin.publicationStatus || null,
      _finalTwinUpdatedAt: twin.updatedAt || null,
    };
  });

  return { mine: pairedMine, finals: remainingFinals };
}

// Estado de oficialidad visible de una clasificación (o de su par etapa+final).
// publicationStatus es la señal que leen web y apps; officialAt es el ancla manual
// que impide que el cron degrade a provisional un cuadro oficializado a mano.
// Un par es oficial solo cuando lo son sus dos cabeceras; un desfase se muestra
// como parcial, igual que el candado.
export function resultClassificationOfficialState(stage) {
  const isOfficial = (row) => row.publicationStatus === 'official' || !!row.officialAt;
  const own = isOfficial(stage);
  if (!stage._finalTwinId) {
    return { official: own, partial: false, pinned: !!stage.officialAt };
  }
  const twinOfficial = isOfficial({
    publicationStatus: stage._finalTwinPublicationStatus,
    officialAt: stage._finalTwinOfficialAt,
  });
  return {
    official: own && twinOfficial,
    partial: own !== twinOfficial,
    pinned: !!stage.officialAt || !!stage._finalTwinOfficialAt,
  };
}

function normalizeRiderSurname(value) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/[øöő]/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function riderNameTokens(value) {
  const normalized = normalizeRiderSurname(value);
  return normalized ? normalized.split(' ') : [];
}

export function riderSearchLookupToken(query) {
  return riderNameTokens(query)
    .map((token, index) => ({ token, index }))
    .sort((a, b) => (b.token.length - a.token.length) || (b.index - a.index))[0]?.token || '';
}

export function riderMatchesSearch(rider, query) {
  const wanted = riderNameTokens(query);
  if (!wanted.length) return true;
  const available = riderNameTokens([
    rider?.dorsal,
    rider?.firstName,
    rider?.lastName,
    rider?.otherNames,
    rider?.name,
    rider?.teamDisplay,
  ].filter(Boolean).join(' '));
  return wanted.every((token) => available.some((candidate) => candidate.includes(token)));
}

// Acepta apellido completo o nombre completo en cualquier orden. Solo devuelve
// una fila única; los homónimos quedan sin asociar para evitar enlaces silenciosos.
export function uniqueStartlistSurnameMatch(value, riders = []) {
  const wanted = normalizeRiderSurname(value);
  const wantedTokens = new Set(riderNameTokens(value));
  if (!wanted) return null;
  const matches = riders.filter((rider) => {
    if (normalizeRiderSurname(rider?.lastName) === wanted) return true;
    const fullTokens = new Set(riderNameTokens(
      `${rider?.firstName || ''} ${rider?.lastName || rider?.name || ''}`,
    ));
    return fullTokens.size >= 2 && [...fullTokens].every((token) => wantedTokens.has(token));
  });
  return matches.length === 1 ? matches[0] : null;
}

// Cada campo escrito restringe su parte del nombre. No descartar un nombre
// contradictorio porque el apellido resulte único en la plantilla.
export function startlistRosterCandidates(lastNameQuery, firstNameQuery = '', riders = []) {
  const last = String(lastNameQuery || '').trim();
  const first = String(firstNameQuery || '').trim();
  if (!riderNameTokens(last).length && !riderNameTokens(first).length) return [];
  return riders.filter(rider =>
    (!last || riderMatchesSearch({ lastName: rider?.lastName }, last))
    && (!first || riderMatchesSearch({ firstName: rider?.firstName }, first)));
}

// Candidatos del selector manual cuando la carrera tiene startlist. No amplía
// nunca la búsqueda al catálogo global: filtra y ordena únicamente inscritos.
export function filterStartlistRiderCandidates(riders = [], query = '', limit = 50) {
  return [...riders]
    .filter((rider) => riderMatchesSearch(rider, query))
    .sort((a, b) => String(a?.dorsal ?? '').localeCompare(String(b?.dorsal ?? ''), 'es', { numeric: true })
      || String(a?.lastName || '').localeCompare(String(b?.lastName || ''), 'es'))
    .slice(0, limit);
}

// El selector restringido debe conservar el texto completo de la fila: recortar
// al último token perdería partículas relevantes como «van den». La consulta
// global mantiene el apellido final para reducir la búsqueda remota.
export function resultRiderPickerInitialQuery(value, restrictToStartlist) {
  const name = String(value || '').trim();
  if (restrictToStartlist) return name;
  return name.split(/\s+/).filter(Boolean).pop() || name;
}

export function resultRiderDorsalText(value) {
  return String(value ?? '—');
}

export function nextResultRank(rankValues = []) {
  if (!rankValues.length) return 1;
  const previous = Number.parseInt(rankValues.at(-1), 10);
  return Number.isFinite(previous) ? previous + 1 : 1;
}

// Atajos de introducción de diferencias en clasificaciones con tiempo.
// Los formatos completos existentes se conservan sin modificación.
export function normalizeResultTimeInput(value, rank = null) {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  if (/^\d{1,2}$/.test(raw)) {
    const seconds = Number(raw);
    return seconds < 60 ? `+0:${String(seconds).padStart(2, '0')}` : raw;
  }
  const fullTime = raw.match(/^(\d+)\.(\d{1,2})\.(\d{1,2})$/);
  if (fullTime) {
    const minutes = Number(fullTime[2]);
    const seconds = Number(fullTime[3]);
    if (minutes < 60 && seconds < 60) {
      const prefix = Number(rank) > 1 ? '+' : '';
      return `${prefix}${Number(fullTime[1])}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }
  const shortGap = raw.match(/^(\d+)\.(\d{1,2})$/);
  if (shortGap) {
    const seconds = Number(shortGap[2]);
    if (seconds < 60) return `+${Number(shortGap[1])}:${String(seconds).padStart(2, '0')}`;
  }
  return raw;
}

// Resuelve el líder con la misma precedencia visible de la web: dorsal contra
// startlist, globalRiderId y, solo como respaldo, el nombre crudo de la fuente.
// En clasificaciones por equipos devuelve el equipo del corredor líder o el
// winnerName de cabecera, nunca su nombre individual.
export function resolveResultLeaderName(
  stage,
  rankOneRows = [],
  riderByBib = {},
  riderByGid = {},
  teamNameById = {},
) {
  const rows = rankOneRows.filter((row) => !isNonWinnerIrm(String(row?.irm || '').toUpperCase()));
  if (rankOneRows.length && !rows.length) return '';
  if (stage?.classKind === 'teams' || stage?.isTeamEvent) {
    for (const row of rows) {
      const overrideName = row.teamId ? teamNameById[row.teamId] : '';
      if (overrideName) return overrideName;
      const bib = String(row.bib ?? '').trim();
      const rider = (/^\d+$/.test(bib) ? riderByBib[Number(bib)] : null)
        || (row.globalRiderId ? riderByGid[row.globalRiderId] : null);
      const teamName = rider?.teamDisplay || rider?.team || '';
      if (teamName) return teamName;
    }
    return stage?.winnerName || rows[0]?.riderDisplay || '';
  }

  for (const row of rows) {
    const bib = String(row.bib ?? '').trim();
    const rider = (/^\d+$/.test(bib) ? riderByBib[Number(bib)] : null)
      || (row.globalRiderId ? riderByGid[row.globalRiderId] : null);
    if (rider?.name) return rider.name;
    if (row.riderDisplay && row.riderDisplay !== '—') return row.riderDisplay;
  }
  return stage?.winnerName || '';
}
