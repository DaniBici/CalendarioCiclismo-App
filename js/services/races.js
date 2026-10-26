// ─────────────────────────────────────────────────────────────────
//  RACES — lógica de negocio de carreras, sin dependencias DOM
// ─────────────────────────────────────────────────────────────────

// ── Doble sector ────────────────────────────────────────────────
export function hasCalendarForYear(year, now = new Date()) {
  return Number.isInteger(year) && year >= now.getUTCFullYear();
}

/**
 * Detecta dobles sectores.
 *
 * `_stageSuffix` ("A", "B", …): jornadas de la misma carrera, mismo día y
 * mismo stageNumber, ordenadas por hora de inicio.
 *
 * Muta los objetos del array directamente.
 */
export function annotateDoubleSectors(days) {
  const groups = {};
  days.forEach(rd => {
    if (rd.stageNumber == null || rd.isRestDay || rd.isCancelledDay) return;
    const key = `${rd.raceId || ''}|${rd.dateKey}|${rd.stageNumber}`;
    (groups[key] = groups[key] || []).push(rd);
  });
  const SUFFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  Object.values(groups).forEach(group => {
    if (group.length < 2) return;
    group.sort((a, b) => {
      const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
      const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
      return tA - tB;
    });
    group.forEach((rd, i) => { rd._stageSuffix = SUFFIXES[i] || ''; });
  });
}

// ── Etapas hermanas de la página de jornada ────────────────────────
// Columnas de las jornadas hermanas: navegación entre etapas
// (buildStageNav), dobles sectores y resultados de la etapa anterior. Las
// leen js/jornada.js y el prerender del build
// (tools/site/prerender-jornadas.mjs), que deben pintar el mismo HTML.
export const STAGE_SIBLING_COLUMNS = 'id,raceId,dateKey,stageNumber,isRestDay,isCancelledDay,neutralStartTimeUtc,startLocation,startLocationEn,finishLocation,finishLocationEn,slug,slugEn';

// Páginas de perfil y mapa (js/perfil-pub.js, js/mapa-pub.js): columnas de
// la jornada, de las etapas hermanas y de la carrera embebida que leen. El
// build pinta con las mismas (tools/site/prerender-auxiliares.mjs): un campo
// que el navegador no lee no puede cambiar el HTML generado.
const DAY_COLUMNS = [
  'id','slug','slugEn','raceId','dateKey','stageNumber','isRestDay','isCancelledDay',
  'startLocation','finishLocation','startLocationEn','finishLocationEn','distanceKm','countryCode',
  'neutralStartTimeUtc','estimatedFinishTimeUtc',
  'primaryType','secondaryType','startOrderImportedAt','profileNotViewable',
  'elevationProfile','profileSummits','profileWaypoints','routeGpxUrl',
];
export const PERFIL_DAY_COLUMNS = [...DAY_COLUMNS, 'realStartTimeUtc'].join(',');
export const MAPA_DAY_COLUMNS = DAY_COLUMNS.join(',');
const SIBLING_COLUMNS = 'id,slug,slugEn,stageNumber,dateKey,startLocation,finishLocation,startLocationEn,finishLocationEn,isRestDay,neutralStartTimeUtc';
export const PERFIL_SIBLING_COLUMNS = SIBLING_COLUMNS;
export const MAPA_SIBLING_COLUMNS = `${SIBLING_COLUMNS},routeGpxUrl`;
// Columnas de la carrera embebida en la jornada.
export const STAGE_PAGE_RACE_COLUMNS = 'id,slug,slugEn,name,nameEn,year,logoUrl,hideFlag,gender,uciCategory,raceFormat,colorHex,countryCode,websiteUrl,startlistImportedAt,startlistProvisional';

/**
 * Etapas hermanas del selector de perfil y mapa, por número de etapa y, sin
 * él, por fecha. Las filas llegan ordenadas por id: el empate conserva ese
 * orden en el navegador y en el build (misma ordenación estable).
 */
export function sortStagePageSiblings(rows) {
  return [...rows].sort((a, b) => {
    if (a.stageNumber != null && b.stageNumber != null && a.stageNumber !== b.stageNumber)
      return a.stageNumber - b.stageNumber;
    return (a.dateKey || '').localeCompare(b.dateKey || '');
  });
}

/**
 * Ordena las etapas hermanas (número de etapa y hora de salida; sin número,
 * por fecha) y marca los dobles sectores. Muta y devuelve el array.
 */
export function stageSiblings(days) {
  days.sort((a, b) => {
    if (a.stageNumber != null && b.stageNumber != null) {
      if (a.stageNumber !== b.stageNumber) return a.stageNumber - b.stageNumber;
      const tA = a.neutralStartTimeUtc ? new Date(a.neutralStartTimeUtc).getTime() : Infinity;
      const tB = b.neutralStartTimeUtc ? new Date(b.neutralStartTimeUtc).getTime() : Infinity;
      return tA - tB;
    }
    return (a.dateKey || '').localeCompare(b.dateKey || '');
  });
  annotateDoubleSectors(days);
  return days;
}

/**
 * Guía técnica de una competición entre las de sus jornadas (cada fila con
 * `race_days.dateKey` embebido): la de la jornada más temprana, sin la jornada
 * embebida. Con la misma fecha, la primera de `guides`, que llega ordenada por
 * id en el navegador y en el build.
 */
export function firstTechnicalGuide(guides) {
  if (!guides?.length) return null;
  const [first] = [...guides].sort((a, b) => (a.race_days?.dateKey || '').localeCompare(b.race_days?.dateKey || ''));
  const { race_days: _day, ...guide } = first;
  return guide;
}

// ── Resultados: disponibilidad por jornada ─────────────────────────
/**
 * Construye el detector de jornadas con resultados propios.
 *
 * `raceDayId` es la identidad canónica. El fallback `raceId + stageNumber` se
 * conserva solo para clasificaciones antiguas sin `raceDayId`; no debe
 * aplicarse a filas ya enlazadas porque dos sectores A/B comparten número.
 */
export function buildInhouseResultsMatcher(stages) {
  const dayIds = new Set();
  const linkedStageKeys = new Set();
  const legacyStageKeys = new Set();
  const keyOf = stage => {
    const stageKey = stage.stageNumber == null ? 'final' : stage.stageNumber;
    return `${stage.raceId || ''}#${stageKey}`;
  };

  for (const stage of stages || []) {
    if (stage.raceDayId) {
      dayIds.add(stage.raceDayId);
      linkedStageKeys.add(keyOf(stage));
      continue;
    }
    legacyStageKeys.add(keyOf(stage));
  }
  linkedStageKeys.forEach(key => legacyStageKeys.delete(key));

  return {
    has(rd) {
      if (!rd) return false;
      if (rd.id && dayIds.has(rd.id)) return true;
      return legacyStageKeys.has(keyOf(rd));
    },
  };
}

// ── Resultados: agrupación por sector (dobles sectores A/B) ──────────
/**
 * Un DOBLE SECTOR (etapa partida "3A"/"3B") son DOS jornadas (`race_days`) del
 * mismo día que comparten el MISMO entero `stageNumber` y `dateKey`; se
 * distinguen por la hora de salida (`neutralStartTimeUtc`, A = la más temprana).
 * El sufijo A/B es de runtime. En resultados, las clasificaciones de cada sector
 * llevan el `raceDayId` de SU jornada → así se separan aunque el `stageNumber`
 * coincida.
 *
 * Devuelve el mapa `raceDayId → sufijo` (solo para jornadas de un doble sector)
 * y el conjunto de `stageNumber` que son doble sector. A diferencia de
 * `annotateDoubleSectors`, aquí las jornadas CANCELADAS SÍ cuentan (un sector
 * cancelado sigue siendo A o B y su hermano debe reconocerse como sectorizado).
 *
 * @param {Array<{id, raceId?, stageNumber, dateKey, neutralStartTimeUtc, isRestDay}>} racedDays
 * @returns {{ suffixByDayId: Map<string,string>, sectoredNums: Set<number> }}
 */
export function sectorSuffixMap(racedDays) {
  const groups = new Map();   // `${raceId}|${dateKey}|${stageNumber}` → [race_days]
  for (const d of racedDays || []) {
    if (d.stageNumber == null || d.isRestDay) continue;
    const key = `${d.raceId || ''}|${d.dateKey || ''}|${d.stageNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const SUFFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffixByDayId = new Map();
  const sectoredNums = new Set();
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    grp.sort((a, b) => {
      const ta = a.neutralStartTimeUtc ? Date.parse(a.neutralStartTimeUtc) : Infinity;
      const tb = b.neutralStartTimeUtc ? Date.parse(b.neutralStartTimeUtc) : Infinity;
      if (ta !== tb) return ta - tb;
      return String(a.id).localeCompare(String(b.id));
    });
    grp.forEach((d, i) => { suffixByDayId.set(d.id, SUFFIXES[i] || ''); });
    sectoredNums.add(grp[0].stageNumber);
  }
  return { suffixByDayId, sectoredNums };
}

/**
 * Clave de agrupación de una clasificación de resultados, consciente de sectores.
 * `'final'` (general final, stageNumber null) | `'3'` | `'3A'`/`'3B'` (sector).
 * Solo se añade sufijo si el `stageNumber` es un doble sector Y la clasificación
 * está atribuida (por `raceDayId`) a un sector conocido; si no, cae al número
 * pelado (caso degradado: volcado sin jornada aún).
 */
export function resultStageEntryKey(stageNumber, raceDayId, suffixByDayId, sectoredNums) {
  if (stageNumber == null) return 'final';
  const sfx = (sectoredNums && sectoredNums.has(stageNumber) && raceDayId != null
    && suffixByDayId && suffixByDayId.has(raceDayId))
    ? suffixByDayId.get(raceDayId) : '';
  return `${stageNumber}${sfx}`;
}

/** Clave del feed: la carrera acota la entrada sectorizada. */
export function resultFeedEntryKey(raceId, stageNumber, raceDayId, suffixByDayId, sectoredNums) {
  return `${raceId || ''}#${resultStageEntryKey(stageNumber, raceDayId, suffixByDayId, sectoredNums)}`;
}

/** Descompone una clave de entrada de resultados en `{ stageNumber, suffix }`. */
export function parseResultStageKey(key) {
  if (key === 'final' || key == null) return { stageNumber: null, suffix: '' };
  const m = /^(\d+)([A-Z]*)$/.exec(String(key));
  if (!m) return { stageNumber: null, suffix: '' };
  return { stageNumber: Number(m[1]), suffix: m[2] || '' };
}
