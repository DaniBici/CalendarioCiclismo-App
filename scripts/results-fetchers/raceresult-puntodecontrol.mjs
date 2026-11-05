/**
 * Plantilla de Punto de Control (Uruguay) sobre race|result.
 *
 * El cronometrador no usa las listas estándar ("Stage Results" con selector de
 * etapa ni pestaña live): publica una lista por jornada y otra con la general
 * tras ella, todas en la pestaña "results":
 *   PROLOGO|Prologo          llegada del prólogo (es también la general)
 *   ETAPA N|EtapaN           llegada de la etapa N
 *   ETAPA N|GeneralEtapaN    general tras la etapa N
 *   CRONO|Contrareloj, GeneralCrono, OrdenCrono
 *                            CRI posterior al prólogo, sin número de jornada
 *   PROLOGO|GenEquiposPrologo general por equipos tras la jornada
 *   GENERALES|GralRegularidad, GralCima
 *                            puntos y montaña acumulados (concurso 0; GralSprinter,
 *                            metas volantes, no es clasificación UCI y se ignora)
 * La carpeta (antes de "|") puede llevar el número interno del cronometrador, que
 * no cuenta la CRI publicada como CRONO; el rótulo de la llegada (ShowAs) lleva el
 * oficial: "4ETAPA 2|Etapa2" se muestra como "Etapa 3" y es la etapa 3.
 * Las columnas se localizan por su expresión en DataFields, no por posición. El
 * estado (DNF, DNS…) sustituye al puesto y al tiempo mediante `if([E1]="";…;[E1])`.
 *
 * Antes de la carrera las listas contienen una simulación con la startlist real
 * (Vuelta Femenina 2026: 66 corredoras con tiempos ficticios la víspera del
 * prólogo). Una clasificación solo se emite si es verosímil: el ganador ha podido
 * terminar desde la salida programada y su media cabe en la distancia de la
 * jornada. Una CRI espera además a que todas las corredoras en carrera tengan
 * tiempo o estado.
 */
import { cellText, parseRankCell, reorderName } from './raceresult-results-fetch.mjs';

// Estados en castellano que el cronometrador puede escribir en E1/E2.
const STATUS_MAP = {
  AB: 'DNF', ABANDONO: 'DNF', 'NO TERMINÓ': 'DNF', NT: 'DNF',
  NL: 'DNS', 'NO LARGÓ': 'DNS', 'NO LARGO': 'DNS', NP: 'DNS',
  FC: 'OTL', 'F.C.': 'OTL', 'FUERA DE CONTROL': 'OTL', FT: 'OTL', 'FUERA DE TIEMPO': 'OTL',
  DESC: 'DSQ', DESCALIFICADA: 'DSQ', DESCALIFICADO: 'DSQ',
};

// Media del ganador admitida: fuera de este intervalo la clasificación es una
// simulación o pertenece a otra jornada.
export const MIN_WINNER_KMH = 20;
export const MAX_WINNER_KMH = 60;
// Margen frente al reloj: la llegada del ganador no puede ser anterior a la
// salida programada más su tiempo de carrera.
const CLOCK_SKEW_MS = 2 * 60 * 1000;

export function parseStatusOrRank(value) {
  const text = cellText(value).replace(/\.$/, '');
  const mapped = STATUS_MAP[text.toUpperCase()];
  return mapped ? { irm: mapped } : parseRankCell(text);
}

/** "00:07:27,38" / "02:02:08" / "7:27.38" → segundos enteros (fracción truncada). */
export function parseClock(value) {
  const text = cellText(value).replace(',', '.');
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(text);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

const pad = (n) => String(n).padStart(2, '0');

/** Segundos → tiempo absoluto de la BD ("2:02:08", "7:27"). */
export function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Diferencia en segundos → gap estilo UCI ("+0", "+28", "+1:15", "+1:02:03"). */
export function formatGap(seconds) {
  if (seconds <= 0) return '+0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `+${h}:${pad(m)}:${pad(s)}`;
  if (m > 0) return `+${m}:${pad(s)}`;
  return `+${s}`;
}

// Carpeta de una lista: "4ETAPA 2|Etapa2" → "4ETAPA 2".
const folderOf = (name) => String(name).split('|')[0];
const ARRIVAL_LIST = /\|\s*(?:Etapa\s*\d+|Contrar?reloj)\s*$/i;

/**
 * Carpeta de una jornada según el rótulo oficial de su llegada ("Etapa 3",
 * "Contrareloj (Etapa 2)"). `listDefs` son las definiciones de la pestaña
 * ({ Name, ShowAs }). Sin rótulo numerado, null: se busca por el número del nombre.
 */
export function stageFolder(listDefs, stageNumber) {
  if (stageNumber === 0) return null;
  const label = new RegExp(`\\bEtapa\\s*${stageNumber}\\b`, 'i');
  const def = (listDefs || []).find((item) => ARRIVAL_LIST.test(String(item?.Name)) && label.test(String(item?.ShowAs ?? '')));
  return def ? folderOf(def.Name) : null;
}

/**
 * Nombres de la lista de llegada y de la general de una jornada. Una CRI posterior
 * al prólogo puede publicarse sin número ("CRONO|Contrareloj", "CRONO|GeneralCrono")
 * y añade su orden de salida ("CRONO|OrdenCrono"). Con `folder` (stageFolder) las
 * listas se toman de esa carpeta, sea cual sea el número de sus nombres.
 */
export function stageListNames(listNames, stageNumber, { itt = false, folder = null } = {}) {
  const find = (re) => listNames.find((name) => re.test(String(name))) || null;
  if (folder) {
    const inFolder = (re) => listNames.find((name) => folderOf(name) === folder && re.test(String(name))) || null;
    const names = { stage: inFolder(ARRIVAL_LIST), gc: inFolder(/\|\s*General(?:Etapa\s*\d+|Crono)\s*$/i) };
    return itt ? { ...names, startOrder: inFolder(/\|\s*OrdenCrono\s*$/i) } : names;
  }
  if (stageNumber === 0) {
    const prologue = find(/\|\s*Pr[oó]logo\s*$/i);
    return { stage: prologue, gc: prologue };
  }
  const names = {
    stage: find(new RegExp(`\\|\\s*Etapa\\s*${stageNumber}\\s*$`, 'i')),
    gc: find(new RegExp(`\\|\\s*GeneralEtapa\\s*${stageNumber}\\s*$`, 'i')),
  };
  if (!itt) return names;
  return {
    stage: names.stage || find(/\|\s*Contrar?reloj\s*$/i),
    gc: names.gc || find(/\|\s*GeneralCrono\s*$/i),
    startOrder: find(/\|\s*OrdenCrono\s*$/i),
  };
}

/**
 * General por equipos tras una jornada ("PROLOGO|GenEquiposPrologo", "…|GenEquiposEtapaN");
 * con `folder`, la de esa carpeta.
 */
export function teamListName(listNames, stageNumber, folder = null) {
  if (folder) return listNames.find((name) => folderOf(name) === folder && /\|\s*GenEquipos/i.test(String(name))) || null;
  const re = stageNumber === 0
    ? /\|\s*GenEquiposPr[oó]logo\s*$/i
    : new RegExp(`\\|\\s*GenEquipos(?:Etapa)?\\s*${stageNumber}\\s*$`, 'i');
  return listNames.find((name) => re.test(String(name))) || null;
}

/**
 * Clasificaciones por puntos de toda la vuelta ("GENERALES|Gral…"). Están en el
 * concurso 0 y su cabecero no indica la jornada: reflejan el acumulado vigente.
 * GralSprinter (metas volantes) no es clasificación UCI y no se emite.
 */
export const POINTS_LISTS = [
  { classKind: 'points', list: /\|\s*GralRegularidad\s*$/i, value: /^GeneralRegularidad$/i },
  { classKind: 'kom', list: /\|\s*GralCima\s*$/i, value: /^GeneralCima$/i },
];

/** Columnas de una clasificación por puntos; `value` es la expresión del total. */
export function locatePointsColumns(fields, value) {
  const list = (Array.isArray(fields) ? fields : []).map((field) => String(field ?? ''));
  const index = (re) => list.findIndex((field) => re.test(field));
  const cols = {
    rank: index(/RANK$/i),
    bib: index(/^BIB$/i),
    name: index(/^FIRSTNAME$|FLNAME|DisplayName/i),
    team: index(/^CLUB$/i),
    points: index(value),
  };
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([key]) => key);
  if (missing.length) throw new Error(`Clasificación por puntos sin columnas: ${missing.join(', ')}`);
  return cols;
}

/** Columnas de la general por equipos: puesto, nombre del equipo y tiempo acumulado. */
export function locateTeamColumns(fields) {
  const list = (Array.isArray(fields) ? fields : []).map((field) => String(field ?? ''));
  const index = (re) => list.findIndex((field) => re.test(field));
  const cols = { rank: index(/RANK$/i), team: index(/^CLUB$/i), time: index(/^EquipGen/i) };
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([key]) => key);
  if (missing.length) throw new Error(`General por equipos sin columnas: ${missing.join(', ')}`);
  return cols;
}

/** Filas ordenadas por puesto → ganador con tiempo absoluto y el resto con diferencia. */
function timedRows(ranked) {
  const base = ranked[0].seconds;
  return ranked.map((row) => {
    const common = { rank: row.rank, rankText: String(row.rank), bib: row.bib, riderDisplay: row.riderDisplay, teamName: row.teamName, points: null, irm: null };
    if (row.rank === 1) {
      const absolute = formatTime(row.seconds);
      return { ...common, resultValue: absolute, timeText: absolute, gapText: null };
    }
    const gap = formatGap(row.seconds - base);
    return { ...common, resultValue: gap, timeText: null, gapText: gap };
  });
}

function checkRanked(ranked, label, value) {
  if (ranked[0].rank !== 1) throw new Error(`${label}: la clasificación no empieza en el puesto 1`);
  ranked.forEach((row, i) => {
    if (i && row.rank <= ranked[i - 1].rank) throw new Error(`${label}: puesto ${row.rank} repetido o desordenado`);
    if (row[value] == null) throw new Error(`${label}: puesto ${row.rank} sin valor`);
  });
}

/**
 * Clasificación por puntos → contrato del upsert (puntos en resultValue). Los
 * empates conservan el orden de race|result (AUTORANK numera sin repetir).
 */
export function mapPointsRows(rows, cols) {
  const parsed = [];
  for (const row of rows || []) {
    const bib = cellText(row[cols.bib]);
    const { rank } = parseRankCell(row[cols.rank]);
    if (!/^\d+$/.test(bib) || rank == null) continue;
    const text = cellText(row[cols.points]).replace(/\s*pts?\.?$/i, '');
    parsed.push({
      rank, bib,
      riderDisplay: reorderName(row[cols.name]),
      teamName: cellText(row[cols.team]) || null,
      points: /^\d+$/.test(text) ? Number(text) : null,
    });
  }
  if (!parsed.length) return [];
  parsed.sort((a, b) => a.rank - b.rank);
  checkRanked(parsed, 'puntos', 'points');
  parsed.forEach((row, i) => {
    if (i && row.points > parsed[i - 1].points) throw new Error(`puntos: dorsal ${row.bib} con más puntos que el puesto anterior`);
  });
  if (new Set(parsed.map((row) => row.bib)).size !== parsed.length) throw new Error('puntos: dorsales duplicados');
  return parsed.map((row) => ({
    rank: row.rank, rankText: String(row.rank), bib: row.bib, riderDisplay: row.riderDisplay, teamName: row.teamName,
    resultValue: String(row.points), timeText: null, gapText: null, points: null, irm: null,
  }));
}

/** General por equipos → filas de equipo (sin dorsal) con tiempo o diferencia. */
export function mapTeamRows(rows, cols) {
  const parsed = [];
  for (const row of rows || []) {
    const team = cellText(row[cols.team]);
    const { rank } = parseRankCell(row[cols.rank]);
    if (!team || rank == null) continue;
    parsed.push({ rank, bib: null, riderDisplay: team, teamName: team, seconds: parseClock(row[cols.time]) });
  }
  if (!parsed.length) return [];
  parsed.sort((a, b) => a.rank - b.rank);
  checkRanked(parsed, 'equipos', 'seconds');
  parsed.forEach((row, i) => {
    if (i && row.seconds < parsed[i - 1].seconds) throw new Error(`equipos: ${row.teamName} con menos tiempo que el puesto anterior`);
  });
  if (new Set(parsed.map((row) => row.teamName)).size !== parsed.length) throw new Error('equipos: equipos duplicados');
  return timedRows(parsed);
}

/** Diferencia estilo UCI ("+0", "+28", "+1:15", "+1:02:03") → segundos. */
export function parseGapSeconds(value) {
  const match = /^\+?(?:(\d+):)?(?:(\d+):)?(\d+)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const parts = [match[1], match[2], match[3]].filter((part) => part != null).map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * Jóvenes = general restringida a las corredoras elegibles, renumerada y con la
 * diferencia respecto a la mejor de ellas. Los estados se conservan sin puesto.
 */
export function deriveYouthRows(gcRows, youthBibs) {
  const eligible = new Set((youthBibs || []).map(String));
  const leader = gcRows.find((row) => row.rank === 1);
  const base = leader ? parseClock(leader.timeText) : null;
  if (!eligible.size || base == null) return [];
  const ranked = [];
  for (const row of gcRows) {
    if (!eligible.has(row.bib) || row.rank == null) continue;
    const offset = row.rank === 1 ? 0 : parseGapSeconds(row.gapText);
    if (offset == null) throw new Error(`jóvenes: dorsal ${row.bib} sin diferencia en la general`);
    ranked.push({ ...row, seconds: base + offset });
  }
  if (!ranked.length) return [];
  ranked.sort((a, b) => a.rank - b.rank);
  const renumbered = ranked.map((row, i) => ({ ...row, rank: i + 1 }));
  const statuses = gcRows.filter((row) => eligible.has(row.bib) && row.irm);
  return [...timedRows(renumbered), ...statuses];
}

/** Dorsales de `rows` ausentes del conjunto de participantes. */
export function unknownBibs(rows, participants) {
  return rows.map((row) => row.bib).filter((bib) => !participants.has(bib));
}

/**
 * Las clasificaciones por puntos solo indican el acumulado vigente: pertenecen a
 * la jornada N mientras ninguna jornada posterior haya empezado en `timeZone`.
 */
export function pointsBelongToStage(stages, stageNumber, timeZone, now = Date.now()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return !Object.entries(stages).some(([n, conf]) => Number(n) > stageNumber && conf.dateKey <= today);
}

/**
 * Índices de columna por expresión. `kind` = 'stage' | 'gc'. En la llegada de una
 * etapa en línea el tiempo de etapa es "Cortes" (tiempo con la regla de grupos,
 * sin bonificaciones); el prólogo solo publica el tiempo final.
 */
export function locateColumns(fields, kind) {
  const list = (Array.isArray(fields) ? fields : []).map((field) => String(field ?? ''));
  const index = (re) => list.findIndex((field) => re.test(field));
  const cols = {
    rank: kind === 'gc' ? index(/ClasGen|ClasifGen/i) : index(/\[Clasif/i),
    bib: index(/^BIB$/i),
    name: index(/^FIRSTNAME$|DisplayName/i),
    team: index(/^CLUB$/i),
    time: kind === 'gc' ? index(/GeneralDespues/i) : index(/Cortes/i),
  };
  if (kind === 'gc' && cols.rank < 0) cols.rank = index(/Clas/i);
  if (kind !== 'gc' && cols.time < 0) cols.time = index(/\[TT/i);
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([key]) => key);
  if (missing.length) throw new Error(`Plantilla de Punto de Control sin columnas: ${missing.join(', ')}`);
  return cols;
}

/**
 * Filas de una lista → contrato del upsert. El primero lleva tiempo absoluto; el
 * resto, la diferencia con él. Los estados quedan sin puesto y con su IRM.
 */
export function mapListRows(rows, cols) {
  const parsed = [];
  for (const row of rows || []) {
    const bib = cellText(row[cols.bib]);
    if (!/^\d+$/.test(bib)) continue;
    const { rank, irm } = parseStatusOrRank(row[cols.rank]);
    const seconds = irm ? null : parseClock(row[cols.time]);
    parsed.push({
      rank: irm ? null : rank ?? null,
      bib,
      riderDisplay: reorderName(row[cols.name]),
      teamName: cellText(row[cols.team]) || null,
      seconds,
      irm: irm || null,
    });
  }
  const ranked = parsed.filter((row) => row.rank != null).sort((a, b) => a.rank - b.rank);
  if (!ranked.length) return [];
  if (ranked[0].rank !== 1) throw new Error('la clasificación no empieza en el puesto 1');
  ranked.forEach((row, i) => {
    if (row.seconds == null) throw new Error(`dorsal ${row.bib} con puesto ${row.rank} sin tiempo`);
    if (i && row.seconds < ranked[i - 1].seconds) throw new Error(`dorsal ${row.bib} con menos tiempo que el puesto anterior`);
  });
  const bibs = parsed.map((row) => row.bib);
  if (new Set(bibs).size !== bibs.length) throw new Error('dorsales duplicados');
  const out = timedRows(ranked);
  for (const row of parsed.filter((item) => item.irm)) {
    out.push({ rank: null, rankText: row.irm, bib: row.bib, riderDisplay: row.riderDisplay, teamName: row.teamName,
      resultValue: null, timeText: null, gapText: null, points: null, irm: row.irm });
  }
  return out;
}

/** Segundos del ganador de unas filas ya mapeadas. */
export function winnerSeconds(rows) {
  const winner = rows.find((row) => row.rank === 1);
  return winner ? parseClock(winner.timeText) : null;
}

/**
 * Verosimilitud de la llegada frente a la jornada programada. Sin horario solo se
 * acepta una jornada ya pasada en `timeZone` (relectura completa de la vuelta).
 * Devuelve { status: 'ok' | 'pending' | 'invalid', reason }.
 */
export function assessStage({ winnerSecs, distanceKm, dateKey = null, timeZone = 'UTC', startUtc = null, neutralStartUtc = null, now = Date.now() }) {
  if (!Number.isFinite(winnerSecs) || winnerSecs <= 0) return { status: 'invalid', reason: 'sin tiempo del ganador' };
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return { status: 'invalid', reason: 'la jornada no tiene distancia configurada' };
  const kmh = distanceKm / (winnerSecs / 3600);
  if (kmh < MIN_WINNER_KMH || kmh > MAX_WINNER_KMH) {
    return { status: 'invalid', reason: `media del ganador ${kmh.toFixed(1)} km/h en ${distanceKm} km: simulación o datos de otra jornada` };
  }
  const scheduled = [startUtc, neutralStartUtc].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!scheduled.length) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    return dateKey && dateKey < today
      ? { status: 'ok', reason: `jornada pasada; media del ganador ${kmh.toFixed(1)} km/h` }
      : { status: 'invalid', reason: 'la jornada no tiene horario de salida para validar la clasificación' };
  }
  const earliestFinish = Math.min(...scheduled) + winnerSecs * 1000;
  if (earliestFinish > now + CLOCK_SKEW_MS) {
    return { status: 'pending', reason: `el ganador no puede haber llegado antes de ${new Date(earliestFinish).toISOString()}: simulación o carrera en curso` };
  }
  return { status: 'ok', reason: `media del ganador ${kmh.toFixed(1)} km/h` };
}

/**
 * CRI completa: todas las corredoras que siguen en carrera tienen puesto o estado.
 * `expectedBibs` son los dorsales en carrera al empezar la jornada.
 */
export function ittComplete(rows, expectedBibs) {
  const covered = new Set(rows.filter((row) => row.rank != null || row.irm).map((row) => row.bib));
  const missing = [...expectedBibs].filter((bib) => !covered.has(bib));
  return { ready: expectedBibs.size > 0 && missing.length === 0, missing };
}

/** Dorsales en carrera: participantes menos quienes tienen un estado definitivo. */
export function bibsInRace(rows) {
  return new Set(rows.filter((row) => !row.irm).map((row) => row.bib));
}
