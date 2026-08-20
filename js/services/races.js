// ─────────────────────────────────────────────────────────────────
//  RACES — lógica de negocio de carreras, sin dependencias DOM
// ─────────────────────────────────────────────────────────────────

// ── Doble sector ────────────────────────────────────────────────
/**
 * Detecta dobles sectores y calcula numeración secuencial FirstCycling.
 *
 * `_stageSuffix` ("A", "B", …): jornadas de la misma carrera, mismo día y
 * mismo stageNumber, ordenadas por hora de inicio.
 *
 * `_fcStageNumber`: posición 1-based en la lista ordenada de etapas de la
 * carrera (excluyendo prólogo/descanso/canceladas). FirstCycling no cuenta
 * sectores como etapas, sino cada sector individualmente: etapa 1A=1, 1B=2,
 * etapa 2 (tras doble sector)=3, etc.
 *
 * Muta los objetos del array directamente.
 */
export function annotateDoubleSectors(days, { skipFcNumbers = false } = {}) {
  // — _stageSuffix —
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

  // — _fcStageNumber —
  // Solo cuando se dispone de todas las etapas de la carrera. En contextos con
  // datos parciales (un solo día, un mes) este cálculo sería erróneo porque
  // solo hay 1 etapa por carrera y todas recibirían _fcStageNumber=1.
  if (skipFcNumbers) return;

  const raceGroups = {};
  days.forEach(rd => {
    if (!rd.stageNumber || rd.stageNumber === 0 || rd.isRestDay || rd.isCancelledDay) return;
    (raceGroups[rd.raceId || ''] = raceGroups[rd.raceId || ''] || []).push(rd);
  });
  Object.values(raceGroups).forEach(stageDays => {
    stageDays.sort((a, b) => {
      if (a.stageNumber !== b.stageNumber) return a.stageNumber - b.stageNumber;
      return (a._stageSuffix || '').charCodeAt(0) - (b._stageSuffix || '').charCodeAt(0);
    });
    stageDays.forEach((rd, i) => { rd._fcStageNumber = i + 1; });
  });
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
 * @param {Array<{id, stageNumber, dateKey, neutralStartTimeUtc, isRestDay}>} racedDays
 * @returns {{ suffixByDayId: Map<string,string>, sectoredNums: Set<number> }}
 */
export function sectorSuffixMap(racedDays) {
  const groups = new Map();   // `${dateKey}|${stageNumber}` → [race_days]
  for (const d of racedDays || []) {
    if (d.stageNumber == null || d.isRestDay) continue;
    const key = `${d.dateKey || ''}|${d.stageNumber}`;
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

/** Descompone una clave de entrada de resultados en `{ stageNumber, suffix }`. */
export function parseResultStageKey(key) {
  if (key === 'final' || key == null) return { stageNumber: null, suffix: '' };
  const m = /^(\d+)([A-Z]*)$/.exec(String(key));
  if (!m) return { stageNumber: null, suffix: '' };
  return { stageNumber: Number(m[1]), suffix: m[2] || '' };
}
