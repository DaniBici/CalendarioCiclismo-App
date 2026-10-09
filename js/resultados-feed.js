// ─────────────────────────────────────────────────────────────────
//  ÚLTIMOS RESULTADOS — motor compartido de filas de resultados
//
//  Consumidor: renderResultsFeed(content), el índice /resultados/ y
//  /en/results/ (lo monta resultados.js cuando la URL no trae carrera):
//  cronología inversa agrupada por fecha + "Cargar más" de 14 en 14 días.
//
//  Reglas de las filas (espec Dani 2026-06-11):
//   · Etapas de vueltas y pruebas de un día (estas SIN etiqueta) + las
//     GENERALES FINALES de las vueltas, pegadas a su carrera y POR DELANTE
//     de la etapa correspondiente.
//   · Dentro de cada día, el MISMO orden canónico que las cards de Hoy
//     (grandes vueltas → nivel pro → género → categoría UCI → hora → nombre).
//   · Card con el tinte del color de la carrera (como las cards de Hoy; las
//     generales, ligeramente más fuerte): nombre / "Etapa X" en negrita +
//     etapa · km · desnivel + badge de tipo solo para contrarrelojes / ganador en negrita con
//     nombre canónico de la ficha (fallback al winnerName crudo; CRE → crudo).
//   · stageDate puede venir NULL (volcados PDF, migración 090) → la fecha se
//     resuelve por raceDayId→race_days.dateKey o por las fechas de la carrera.
//   · El feed solo publica clasificaciones propias.
// ─────────────────────────────────────────────────────────────────

import { fetchAllRows, fetchByIds } from './services/paged-query.js';
import { enrichResultFeed } from './services/result-feed-context.js';
import { classificationLabel, classificationColor } from './services/race-presentation.js';
import { supabase, esc, countryFlag, raceName as getRaceName, enBase,
         setMeta, setMetaProperty, resolveTypeBadges,
         categoryRank, genderRank, grandTourRank, tsSeconds,
         nameImpliesFemale, effectiveCountryCode, femaleMark } from './shared.js';
import { getLang, t } from './i18n.js';
import { cyclocrossHome } from './services/today-season.js';
import { cxSeasonRows, cxSeasonRounds, cxListedInAgenda } from './services/cx-data.js';
import { cxSeason, cxRaceName, cxRacePageUrl, cxRoundBadge } from './cx/presentation.js';
import { cxResultEntries } from './cx/results-feed.js';
import { isNonWinnerIrm } from './results/uci-irm.js';
import { compareChampionships } from './campeonatos-config.js';
import { resultFeedEntryKey, sectorSuffixMap } from './services/races.js';
import {
  decorateUciRanking,
  formatUciRankingUpdated,
  UciRankingTier,
  uciRankingRuleText,
} from './results/uci-team-ranking.js';
import {
  RESULTS_SEASON_START,
  initialResultsFromKey,
  previousResultsWindow,
} from './services/result-feed-pagination.js';

// Selecciones nacionales: el catálogo guarda el nombre UCI en inglés
// («France»). En castellano se muestra el nombre del país en castellano.
const NATION_ALIASES = { 'Great Britain': 'GB' };
const NATION_NAMES_ES = { GB: 'Gran Bretaña' };
let _nationCodeByName = null;
function localizedNationName(name) {
  if (getLang() === 'en' || !name || typeof Intl.DisplayNames !== 'function') return name;
  if (!_nationCodeByName) {
    _nationCodeByName = new Map(Object.entries(NATION_ALIASES));
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 65;
    for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      const label = en.of(code);
      if (label && label !== code) _nationCodeByName.set(label, code);
    }
  }
  const code = _nationCodeByName.get(name.trim());
  if (!code) return name;
  return NATION_NAMES_ES[code] || new Intl.DisplayNames(['es'], { type: 'region' }).of(code) || name;
}

const TROPHY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-0.12em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Color del tinte de la card (espejo de safeCardColor en app.js): oscurece los
// colores demasiado claros para que el tinte/borde sea visible en ambos temas.
function safeCardColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return '#888';
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 210) {
    const darken = v => Math.round(v * 0.6).toString(16).padStart(2, '0');
    return '#' + darken(r) + darken(g) + darken(b);
  }
  return '#' + full;
}

function stageLabel(sn, isEn, suffix = '') {
  if (sn === 0) return isEn ? 'Prologue' : 'Prólogo';
  if (sn != null) return isEn ? `Stage ${sn}${suffix}` : `Etapa ${sn}${suffix}`;
  return '';   // pruebas de un día: sin etiqueta (decisión 2026-06-11)
}
function inhouseHref(race, sn, hash, isEn, suffix = '') {
  const slug = isEn ? (race.slugEn || race.slug) : race.slug;
  const sfx = suffix ? String(suffix).toLowerCase() : '';
  let url;
  if (!slug) {
    const stage = sn != null ? `&stage=${sn}${suffix}` : '';
    url = (isEn ? `${enBase()}/results/` : '/resultados.html') + `?race=${encodeURIComponent(race.id)}${stage}`;
  } else {
    const base = isEn ? `${enBase()}/results/` : '/resultados/';
    let seg = '';
    if (sn === 0) seg = isEn ? 'prologue/' : 'prologo/';
    else if (sn != null) seg = isEn ? `stage-${sn}${sfx}/` : `etapa-${sn}${sfx}/`;
    url = `${base}${encodeURIComponent(slug)}/${seg}`;
  }
  return hash ? `${url}#${hash}` : url;
}

// La UCI publica las etapas canceladas con una pseudo-fila "Cancelled Race"
// como ganadora (pseudo-ficha race-cancelled del catálogo) → sin trofeo.
function cleanWinner(name) {
  if (!name || /cancel/i.test(name)) return '';
  return name;
}
// Orden canónico de carreras dentro del día (espejo de _sortByCategory en
// app.js, sin los criterios que aquí no aplican: placeholders/mini-perfil).
// Misma carrera → la general final SIEMPRE por delante de su etapa. El
// desempate horario usa la hora POR CARRERA-DÍA (e._sortTime, precomputada),
// nunca el rd de la entrada: una general (sin rd) compararía 999999 contra
// la hora real de otras carreras y rompería la adyacencia con su etapa
// (comparador no transitivo → bloques entrelazados).
function cmpEntries(a, b) {
  if (a.race.id === b.race.id) {
    const sub = a.subOrder - b.subOrder;
    if (sub) return sub;
    const stage = (a.sn ?? Infinity) - (b.sn ?? Infinity);
    if (stage) return stage;
    return (a.suffix || '').localeCompare(b.suffix || '');
  }
  const rA = a.race, rB = b.race;
  // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría
  // (espejo de _sortByCategory en app.js; el rd da el primaryType para el slot).
  const cn = compareChampionships(rA, a.rd, rB, b.rd);
  if (cn != null && cn !== 0) return cn;
  const gt = grandTourRank(rA) - grandTourRank(rB);
  if (gt) return gt;
  const cat = categoryRank(rA.uciCategory, rA.name, rA.countryCode) - categoryRank(rB.uciCategory, rB.name, rB.countryCode);
  if (cat) return cat;
  const gen = genderRank(rA.gender) - genderRank(rB.gender);
  if (gen) return gen;
  if (a._sortTime !== b._sortTime) return a._sortTime - b._sortTime;
  return (rA.name || '').localeCompare(rB.name || '');
}

// ── Datos: entradas de resultados de un rango de fechas, ya ordenadas ──
async function fetchEntries(fromKey, toKey, isEn) {
  const stageColumns = 'id, raceId, raceDayId, stageNumber, classKind, stageDate, winnerName, isFinalClassification, updatedAt';
  const raceColumns = 'id, name, nameEn, slug, slugEn, year, countryCode, gender, raceFormat, uciCategory, colorHex, isGrandTour, startDate, endDate, logoUrl';
  // Consultar primero la ventana fechada, sus jornadas y las carreras que se
  // solapan. Los PDF sin stageDate se acotan después a esos IDs de carrera.
  const [datedStages, raceDays, activeRaces] = await Promise.all([
    fetchAllRows(() => supabase.from('race_uci_stages').select(stageColumns)
      .eq('keepForWeb', true).gt('rowCount', 0).in('classKind', ['stage', 'gc'])
      .gte('stageDate', fromKey).lte('stageDate', toKey).order('id')),
    fetchAllRows(() => supabase.from('race_days')
      // Del perfil solo se pinta el desnivel: se pide el campo, no la serie.
      .select('id, raceId, dateKey, stageNumber, isRestDay, isCancelledDay, estimatedFinishTimeUtc, neutralStartTimeUtc, realStartTimeUtc, distanceKm, elevationGain:elevationProfile->elevationGain, primaryType, secondaryType, countryCode, raceStatus, profileNotViewable')
      .eq('editorialStatus', 'published')
      .gte('dateKey', fromKey).lte('dateKey', toKey).order('id')),
    fetchAllRows(() => supabase.from('races').select(raceColumns)
      .or(`startDate.lte.${toKey},startDate.is.null`)
      .or(`endDate.gte.${fromKey},endDate.is.null`).order('id')),
  ]);
  const candidateIds = [...new Set([
    ...raceDays.map(day => day.raceId),
    ...activeRaces.map(race => race.id),
  ].filter(Boolean))];
  const undatedStages = candidateIds.length
    ? await fetchByIds(supabase, 'race_uci_stages', stageColumns, 'raceId', candidateIds,
      query => query.eq('keepForWeb', true).gt('rowCount', 0)
        .in('classKind', ['stage', 'gc']).is('stageDate', null))
    : [];
  const stages = [...datedStages, ...undatedStages].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const rdById = new Map((raceDays || []).map(rd => [rd.id, rd]));
  const { suffixByDayId, sectoredNums } = sectorSuffixMap(raceDays || []);
  (raceDays || []).forEach(rd => { rd._stageSuffix = suffixByDayId.get(rd.id) || ''; });
  const rdsByRace = new Map();
  // Jornada por `${raceId}#${stageNumber}`: fallback cuando la clasificación
  // in-house NO trae raceDayId (el volcado precedió a la creación de la jornada
  // → race_uci_stages.raceDayId NULL). Sin él, la bandera/ruta de la etapa caen
  // al país de la CARRERA e ignoran el override por jornada (p. ej. Giro della
  // Valle d'Aosta et1, en Francia, con race_days.countryCode = 'FR').
  const rdByRaceStage = new Map();
  (raceDays || []).forEach(rd => {
    if (!rdsByRace.has(rd.raceId)) rdsByRace.set(rd.raceId, []);
    rdsByRace.get(rd.raceId).push(rd);
    if (rd.stageNumber != null) {
      const k = `${rd.raceId}#${rd.stageNumber}`;
      if (!rdByRaceStage.has(k)) rdByRaceStage.set(k, rd);
    }
  });

  // 3) Carreras implicadas.
  const raceIds = [...new Set([
    ...(stages || []).map(s => s.raceId),
  ].filter(Boolean))];
  const raceById = new Map(activeRaces.map(race => [race.id, race]));
  const missingRaceIds = raceIds.filter(id => !raceById.has(id));
  if (missingRaceIds.length) {
    const races = await fetchByIds(supabase,'races',raceColumns,'id',missingRaceIds);
    (races || []).forEach(r => raceById.set(r.id, r));
  }
  // ── Entradas in-house ──────────────────────────────────────────
  const key = (rid, sn, raceDayId = null) =>
    resultFeedEntryKey(rid, sn, raceDayId, suffixByDayId, sectoredNums);
  const entries = [];
  const seen = new Set();
  // Jornada de una clasificación: por raceDayId → por `${raceId}#${stageNumber}`
  // si el volcado no lo trajo → la única/primera jornada (un día). Fuente única
  // para entryRd y entryDate.
  const rdFor = (s, race) => (s.raceDayId && rdById.get(s.raceDayId))
    || (s.stageNumber != null && rdByRaceStage.get(`${s.raceId}#${s.stageNumber}`))
    || (race.raceFormat === 'one_day' ? (rdsByRace.get(race.id) || [])[0] : null)
    || null;
  // Fecha real de una clasificación: stageDate → jornada → fechas de carrera.
  const entryDate = (s, race) => s.stageDate
    || rdFor(s, race)?.dateKey
    || (race.raceFormat === 'one_day' ? race.startDate : race.endDate)
    || null;
  const entryRd = (s, race) => rdFor(s, race);

  // La vista de resultados duplica las clasificaciones finales bajo la última
  // etapa publicada: conserva sus pestañas F, pero la columna de contexto
  // (ruta, perfil y assets) es la de esa jornada. Localizamos aquí esa etapa
  // para que la card de la general final entre directamente en ese contexto.
  // Solo cuenta una clasificación de etapa realmente publicada: si no existe,
  // se mantiene el enlace histórico a la pestaña final independiente.
  const finalStageContextByRace = new Map();
  const isLaterStage = (candidate, current) => {
    if (!current) return true;
    const date = (candidate.rd?.dateKey || candidate.stageDate || '').localeCompare(
      current.rd?.dateKey || current.stageDate || ''
    );
    if (date) return date > 0;
    const time = (candidate.rd?.neutralStartTimeUtc || '').localeCompare(current.rd?.neutralStartTimeUtc || '');
    if (time) return time > 0;
    if (candidate.sn !== current.sn) return candidate.sn > current.sn;
    return (candidate.suffix || '').localeCompare(current.suffix || '') > 0;
  };
  for (const s of (stages || [])) {
    if (s.classKind !== 'stage' || s.stageNumber == null) continue;
    const race = raceById.get(s.raceId);
    if (!race) continue;
    const rd = entryRd(s, race);
    if (rd?.isRestDay || rd?.isCancelledDay) continue;
    const candidate = {
      sn: s.stageNumber,
      suffix: rd?._stageSuffix || '',
      rd,
      stageDate: s.stageDate,
    };
    const current = finalStageContextByRace.get(s.raceId);
    if (isLaterStage(candidate, current)) finalStageContextByRace.set(s.raceId, candidate);
  }

  for (const s of (stages || [])) {
    const race = raceById.get(s.raceId);
    if (!race) continue;
    const date = entryDate(s, race);
    if (!date || date < fromKey || date > toKey) continue;
    const isOneDay = race.raceFormat === 'one_day';
    const isFinalGc = s.classKind === 'gc' && (s.isFinalClassification || s.stageNumber == null);

    if (isOneDay) {
      // Una sola entrada por prueba de un día: final 'gc' preferida.
      const k = `${s.raceId}#oneday`;
      if (seen.has(k)) {
        if (isFinalGc) {
          const prev = entries.find(e => e._k === k);
          if (prev && !prev._finalGc) {
            prev.winner = cleanWinner(s.winnerName) || prev.winner;
            prev._finalGc = true; prev._stageRef = s.id;
          }
        }
        continue;
      }
      if (s.classKind === 'gc' && !isFinalGc) continue;
      seen.add(k);
      entries.push({
        _k: k, _finalGc: isFinalGc, _stageRef: s.id, kind: 'inhouse',
        date, race, sn: null, subOrder: 1, rd: entryRd(s, race),
        winner: cleanWinner(s.winnerName),
        href: inhouseHref(race, null, null, isEn),
      });
    } else if (isFinalGc) {
      // General final de una vuelta: entrada propia, POR DELANTE de la etapa
      // de su carrera (subOrder 0 < 1; cmpEntries la pega a su carrera). La
      // URL entra en la última etapa para que las clasificaciones F se vean
      // con el contexto de esa jornada.
      const k = `${s.raceId}#gcfinal`;
      if (seen.has(k)) continue;
      seen.add(k);
      const finalStage = finalStageContextByRace.get(s.raceId);
      entries.push({
        _k: k, _stageRef: s.id, kind: 'inhouse', isGcFinal: true,
        date, race, sn: null, subOrder: 0, rd: null,
        winner: cleanWinner(s.winnerName),
        href: inhouseHref(race, finalStage?.sn ?? null, 'gc', isEn, finalStage?.suffix || ''),
      });
    } else if (s.classKind === 'stage' && s.stageNumber != null) {
      const k = key(s.raceId, s.stageNumber, s.raceDayId);
      if (seen.has(k)) continue;
      seen.add(k);
      const rd = entryRd(s, race);
      const suffix = rd?._stageSuffix || '';
      entries.push({
        _k: k, _stageRef: s.id, kind: 'inhouse',
        date, race, sn: s.stageNumber, suffix, subOrder: 1, rd,
        winner: cleanWinner(s.winnerName),
        href: inhouseHref(race, s.stageNumber, null, isEn, suffix),
      });
    }
  }

  // ── Ganadores con nombre canónico de la ficha (en negrita) ────────
  // rank 1 de cada clasificación → globalRiderId → riders_men/women. Si hay
  // VARIOS rank 1 (CRE: todo el equipo comparte puesto) o no resuelve, se
  // mantiene el winnerName crudo de la fuente.
  try {
    const refIds = entries.filter(e => e.kind === 'inhouse' && e._stageRef).map(e => e._stageRef);
    if (refIds.length) {
      const { data: w } = await supabase.from('race_uci_results')
        .select('stageRef, globalRiderId, irm')
        .in('stageRef', refIds).eq('rank', 1);
      const byRef = new Map();
      const nonWinnerRefs = new Set();
      (w || []).forEach(row => {
        if (isNonWinnerIrm(row.irm)) { nonWinnerRefs.add(row.stageRef); return; }
        if (!byRef.has(row.stageRef)) byRef.set(row.stageRef, new Set());
        if (row.globalRiderId) byRef.get(row.stageRef).add(row.globalRiderId);
      });
      const riderIds = [...new Set([...byRef.values()].filter(s => s.size === 1).map(s => [...s][0]))];
      const nameById = new Map();
      if (riderIds.length) {
        const [{ data: men }, { data: women }] = await Promise.all([
          supabase.from('riders_men').select('id, firstName, lastName').in('id', riderIds),
          supabase.from('riders_women').select('id, firstName, lastName').in('id', riderIds),
        ]);
        [...(men || []), ...(women || [])].forEach(r =>
          nameById.set(r.id, `${r.firstName || ''} ${r.lastName || ''}`.trim()));
      }
      entries.forEach(e => {
        if (e.kind !== 'inhouse' || !e._stageRef) return;
        const set = byRef.get(e._stageRef);
        if (nonWinnerRefs.has(e._stageRef) && !set?.size) e.winner = '';
        if (set && set.size === 1) {
          const nm = nameById.get([...set][0]);
          if (nm) e.winner = nm;
        }
      });

      // CRE: el ganador es el EQUIPO, no un corredor. Señales: la jornada es
      // 'ttt' (cubre la variante B de la UCI, donde solo el líder lleva rank 1)
      // o varios corredores comparten el rank 1 (variante A). El equipo se
      // resuelve por la startlist de la carrera (corredor rank 1 → fila de
      // startlist → equipo, con nombre canónico del catálogo si está enlazado).
      const creEntries = entries.filter(e => e.kind === 'inhouse' && e._stageRef
        && !e.isGcFinal
        && (e.rd?.primaryType === 'ttt' || (byRef.get(e._stageRef)?.size || 0) > 1));
      const creIds = new Map(creEntries.map(e => [e, [...(byRef.get(e._stageRef) || [])].slice(0, 3)]));
      const creRiderIds = [...new Set([...creIds.values()].flat())];
      const creRaceIds = [...new Set(creEntries.map(e => e.race.id))];
      if (creRiderIds.length) {
        try {
          const { data: slr } = await supabase.from('startlist_riders_resolved')
            .select('raceId, globalRiderId, teamId').in('raceId', creRaceIds).in('globalRiderId', creRiderIds);
          const pksFor = e => {
            const ids = new Set(creIds.get(e));
            return [...new Set((slr || []).filter(r => r.raceId === e.race.id && ids.has(r.globalRiderId))
              .map(r => r.teamId).filter(Boolean))];
          };
          const slPks = [...new Set(creEntries.map(pksFor).filter(pks => pks.length === 1).flat())];
          const { data: slts } = slPks.length
            ? await supabase.from('startlist_teams').select('id, teamId, teamName').in('id', slPks)
            : { data: [] };
          const sltById = new Map((slts || []).map(row => [row.id, row]));
          const teamIds = [...new Set((slts || []).map(row => row.teamId).filter(Boolean))];
          const { data: tms } = teamIds.length
            ? await supabase.from('teams').select('id, name').in('id', teamIds)
            : { data: [] };
          const teamName = new Map((tms || []).map(row => [row.id, row.name]));
          for (const e of creEntries) {
            const pks = pksFor(e);
            if (pks.length !== 1) continue;
            const slt = sltById.get(pks[0]);
            if (!slt) continue;
            const teamWinner = (slt.teamId && teamName.get(slt.teamId)) || slt.teamName || '';
            if (teamWinner) e.winner = localizedNationName(teamWinner);
          }
        } catch (_) { /* se queda el ganador que hubiera */ }
      }
    }
  } catch (_) { /* ganador crudo si falla la resolución */ }

  // Hora de salida POR CARRERA-DÍA (consistente entre la general final y la
  // etapa de la misma carrera; ver cmpEntries).
  const timeByRaceDay = new Map();
  entries.forEach(e => {
    const t = e.rd?.neutralStartTimeUtc != null ? (tsSeconds(e.rd.neutralStartTimeUtc) ?? null) : null;
    if (t == null) return;
    const k = `${e.date}#${e.race.id}`;
    const prev = timeByRaceDay.get(k);
    if (prev == null || t < prev) timeByRaceDay.set(k, t);
  });
  entries.forEach(e => {
    e._sortTime = timeByRaceDay.get(`${e.date}#${e.race.id}`) ?? 999999;
  });

  // Cronología inversa; dentro del día, orden canónico de carreras (las
  // generales finales pegadas a su carrera y por delante).
  await enrichResultFeed(supabase,entries);
  // Como en Hoy, las carreras destacadas del día abren ese día, con todas sus
  // entradas (etapa y general final) juntas.
  const featuredDays = new Set(entries.filter(e => e._featured).map(e => `${e.date}#${e.race.id}`));
  const featuredRank = e => Number(featuredDays.has(`${e.date}#${e.race.id}`));
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || featuredRank(b)-featuredRank(a) || cmpEntries(a, b));
  // Marca de agua del sondeo: la última modificación de clasificación leída.
  const watermark = stages.reduce((max, stage) => (stage.updatedAt && stage.updatedAt > max ? stage.updatedAt : max), '');
  return { entries, watermark };
}

// Última modificación de una clasificación del feed posterior a la marca de
// agua, o null. Una fila basta para decidir si se recarga el feed completo.
async function latestResultChange(watermark) {
  const { data, error } = await supabase.from('race_uci_stages').select('updatedAt')
    .eq('keepForWeb', true).gt('rowCount', 0).in('classKind', ['stage', 'gc'])
    .gt('updatedAt', watermark).order('updatedAt', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.updatedAt || null;
}

// ── Render de una fila ─────────────────────────────────────────────
function entryRowHtml(e, isEn, locale) {
  const gcFinalLabel = isEn ? 'Final GC' : 'General final';
  // País efectivo: la jornada puede transcurrir en un país distinto al de la
  // carrera (etapa que sale de otro país) → prevalece el de la jornada.
  const flagCc = effectiveCountryCode(e.rd, e.race);
  const flag = flagCc ? `<span class="feed-row__flag">${countryFlag(flagCc)}</span>` : '';
  // Todas las filas reservan la misma columna para el logo y la bandera.
  const logo = e.race.logoUrl
    ? `<img class="race-logo-img" src="${esc(e.race.logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '';
  const leftCol = `<span class="feed-row__logo">${logo}${flag}</span>`;
  const fem = (e.race.gender === 'female' && !nameImpliesFemale(e.race.name || ''))
    ? femaleMark({ cls: 'feed-row__fem' }) : '';
  const name = `${esc(getRaceName(e.race))}${fem}`;
  const color = safeCardColor(e.race.colorHex);

  // Línea 2: etapa, km y desnivel + badge solo para CRI/CRE/cronoescalada.
  // Las generales finales solo llevan su etiqueta. Un
  // día: sin etiqueta.
  let subHtml = '';
  if (e.isGcFinal) {
    subHtml = `<span class="feed-row__gclabel">${esc(gcFinalLabel)}</span>`;
  } else {
    const rd = e.rd;
    const km = rd?.distanceKm
      ? `${Number(rd.distanceKm).toLocaleString(locale)} km` : '';
    const gain = rd?.elevationGain;
    const elevation = gain != null
      // Separador de millares también con cuatro cifras («+1.810 m»), como en Hoy:
      // es-ES no agrupa por defecto por debajo de 10.000.
      ? `+${Number(Math.round(gain / 10) * 10).toLocaleString(locale, { useGrouping: 'always' })} m`
      : '';
    const stagePart = stageLabel(e.sn, isEn, e.suffix || '');
    const seg = [];
    if (stagePart) seg.push(`<strong>${esc(stagePart)}</strong>`);
    if (km) seg.push(`<strong>${esc(km)}</strong>`);
    if (elevation) seg.push(esc(elevation));
    const text = seg.join(' · ');
    const showType = rd?.primaryType === 'itt' || rd?.primaryType === 'ttt';
    const resultSecondary = rd?.primaryType === 'itt' && ['chrono_climb', 'summit_finish'].includes(rd?.secondaryType)
      ? rd.secondaryType : null;
    const badges = showType
      ? `<span class="feed-row__badges">${resolveTypeBadges(rd.primaryType, resultSecondary, e.race.countryCode)}</span>` : '';
    subHtml = `${text}${badges}`;
  }

  const winnerHtml = e.winner
    ? `<span class="feed-row__winner">${TROPHY_SVG} <strong>${esc(e.winner)}</strong></span>` : '';

  // Destacada (espejo de FeedRowView en iOS/Android): la misma fila con sus
  // clasificaciones complementarias debajo. Solo las vueltas por etapas las
  // tienen; una destacada sin complementarias se pinta como fila normal.
  const leaders = e._featured ? (e.leaders || []).map(c => {
    const dot = classificationColor(c)
      ? `<span class="feed-row__leader-dot" style="background:${classificationColor(c)}"></span>` : '';
    const winners = c.winners.map(w => esc(w.name)).join(' / ');
    return `<span class="feed-row__leader">${dot}<span class="feed-row__leader-label">${esc(classificationLabel(c, isEn ? 'en' : 'es'))}</span>${winners ? `<span class="feed-row__leader-name">${winners}</span>` : ''}</span>`;
  }).join('') : '';

  return `
      <a class="feed-row${e.isGcFinal ? ' feed-row--gc' : ''}${leaders ? ' feed-row--featured' : ''}" style="--card-color:${esc(color)}" href="${esc(e.href)}">
        ${leftCol}
        <span class="feed-row__main"><span class="feed-row__race">${name}</span>
          ${subHtml ? `<span class="feed-row__sub">${subHtml}</span>` : ''}
          ${winnerHtml}${leaders ? `<span class="feed-row__leaders">${leaders}</span>` : ''}</span>
        <span class="feed-row__chevron" aria-hidden="true">›</span>
      </a>`;
}

// ── Fila de ciclocross ─────────────────────────────────────────────
// Prueba CX con la estructura de la destacada de carretera: en lugar de las
// clasificaciones complementarias, una línea por categoría con su código y
// el ganador o la ganadora. La línea secundaria identifica torneo, manga y
// sede, como la tarjeta de Hoy de Ciclocross.
function cxEntryRowHtml(e, isEn, rounds) {
  const lang = isEn ? 'en' : 'es';
  const race = e.race, tournament = race.cx_tournaments;
  const logoUrl = race.logoUrl || tournament?.logoUrl;
  const logo = logoUrl ? `<img class="race-logo-img" src="${esc(logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  const flag = race.countryCode ? `<span class="feed-row__flag">${countryFlag(race.countryCode)}</span>` : '';
  const name = cxRaceName(race, lang);
  const sub = [tournament ? esc(cxRaceName(tournament, lang)) : '', cxRoundBadge(rounds?.get(race.id)), race.venue && race.venue !== name ? esc(race.venue) : ''].filter(Boolean).join(' · ');
  const leaders = e.categories.map(c => `<span class="feed-row__leader"><span class="feed-row__leader-label" title="${esc(t(`cx.category.${c.category}`))}">${esc(c.category)}</span><span class="feed-row__leader-name">${esc(c.winnerName)}</span></span>`).join('');
  return `
      <a class="feed-row feed-row--featured feed-row--cx" href="${esc(cxRacePageUrl(race, lang, 'results', e.categories[0].category))}">
        <span class="feed-row__logo">${logo}${flag}</span>
        <span class="feed-row__main"><span class="feed-row__race">${esc(name)}</span>
          ${sub ? `<span class="feed-row__sub">${sub}</span>` : ''}
          <span class="feed-row__leaders">${leaders}</span></span>
        <span class="feed-row__chevron" aria-hidden="true">›</span>
      </a>`;
}

// ── Rejilla de escritorio ──────────────────────────────────────────
// Con ancho suficiente cada día es una rejilla de dos columnas (css/app.css,
// mismo breakpoint). Cada destacada ocupa en su columna las filas que exige
// su altura natural y las filas normales rellenan en orden denso la otra
// columna. La altura de referencia es la mediana de las filas normales del día.
// Solo las destacadas con clasificaciones complementarias crecen en altura.
// Un exceso de hasta FEED_SPAN_TOLERANCE px no añade otra fila: lo absorben
// las filas abarcadas creciendo unos píxeles.
const FEED_TWO_COLUMNS = window.matchMedia('(min-width:961px)');
const FEED_SPAN_TOLERANCE = 12;
function packFeaturedEntries(root) {
  root.querySelectorAll('.feed-day').forEach((day) => {
    const featured = [...day.querySelectorAll(':scope>.feed-row--featured')];
    if (!featured.length) return;
    featured.forEach((el) => { el.style.gridRow = ''; });
    if (!FEED_TWO_COLUMNS.matches) return;
    const rows = [...day.querySelectorAll(':scope>.feed-row:not(.feed-row--featured)')];
    const items = [...featured, ...rows];
    items.forEach((el) => { el.style.alignSelf = 'start'; });
    const featuredHeights = featured.map(el => el.offsetHeight);
    const rowHeights = rows.map(el => el.offsetHeight).sort((a, b) => a - b);
    items.forEach((el) => { el.style.alignSelf = ''; });
    const rowHeight = rowHeights[Math.floor(rowHeights.length / 2)];
    if (!rowHeight) return;
    const gap = parseFloat(getComputedStyle(day).rowGap) || 0;
    featured.forEach((el, i) => {
      const span = Math.max(1, Math.ceil((featuredHeights[i] + gap - FEED_SPAN_TOLERANCE) / (rowHeight + gap)));
      el.style.gridRow = `span ${span}`;
    });
  });
}

// Ciclocross en dos columnas: la altura de la tarjeta depende del número de
// categorías. Cada columna apila sus tarjetas sin huecos (mampostería): la
// rejilla usa filas de 1 px y cada tarjeta abarca su altura más la separación;
// el flujo denso la coloca en la columna que queda más arriba.
const CX_CARD_GAP = 10;
function packCxDays(root) {
  root.querySelectorAll('.feed-day__cx-grid').forEach((grid) => {
    const cards = [...grid.children];
    cards.forEach((el) => { el.style.gridRow = ''; });
    if (!FEED_TWO_COLUMNS.matches) return;
    const heights = cards.map(el => el.getBoundingClientRect().height);
    cards.forEach((el, i) => { el.style.gridRow = `span ${Math.ceil(heights[i]) + CX_CARD_GAP}`; });
  });
}

// ── Índice /resultados/ · /en/results/ ─────────────────────────────
export function renderResultsFeed(content) {
  const _isEn = getLang() === 'en';
  const locale = _isEn ? 'en-GB' : 'es-ES';
  const todayKey = toDateKey(new Date());
  let fromKey = initialResultsFromKey(todayKey);
  // Pestaña Ciclocross, primera, mientras la home es Ciclocross (del cierre de
  // la temporada de carretera al 31 de diciembre; services/today-season.js).
  const cxTab = cyclocrossHome(todayKey);
  const views = cxTab ? ['cx', 'latest', 'ranking'] : ['latest', 'ranking'];
  const viewLabels = {
    cx: _isEn ? 'Cyclocross' : 'Ciclocross',
    latest: cxTab ? (_isEn ? 'Road' : 'Carretera') : (_isEn ? 'Latest Results' : 'Últimos resultados'),
    ranking: _isEn ? 'UCI Ranking' : 'Ránking UCI',
  };
  let activeView = views[0];
  let rankingGender = 'male';
  let feedEntries = null;
  let rankingRows = null;

  // ── SEO (la home del feed es evergreen) ───────────────────────────
  const title = _isEn
    ? 'Latest results - Calendario Ciclismo'
    : 'Últimos resultados - Calendario Ciclismo App';
  const description = _isEn
    ? 'Latest professional cycling results: stages and one-day classics in reverse chronological order, with winners and full classifications.'
    : 'Últimos resultados del ciclismo profesional: etapas y clásicas en orden cronológico inverso, con ganador y clasificaciones completas.';
  document.title = title;
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation?.() ?? location.href, page_title: title });
  setMeta('description', description);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : location.origin;
  const esUrl = `${origin}/resultados/`;
  const enUrl = `${origin}/en/results/`;
  setMetaProperty('og:url', _isEn ? enUrl : esUrl);
  let canonEl = document.querySelector('link[rel="canonical"]');
  if (!canonEl) { canonEl = document.createElement('link'); canonEl.rel = 'canonical'; document.head.appendChild(canonEl); }
  canonEl.href = _isEn ? enUrl : esUrl;

  function dayHeader(dk) {
    const [y, m, d] = dk.split('-').map(Number);
    const s = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function shell(body) {
    return `
      <div class="feed-hero">
        <h1 class="sr-only">${_isEn ? 'Results' : 'Resultados'}</h1>
        <div class="feed-view-tabs" role="tablist" aria-label="${_isEn ? 'Results view' : 'Vista de resultados'}">
          ${views.map(view => `<button class="feed-view-tab${activeView === view ? ' feed-view-tab--active' : ''}"
                  type="button" role="tab" aria-selected="${activeView === view}" data-results-view="${view}">
            ${viewLabels[view]}
          </button>`).join('')}
        </div>
      </div>
      <div id="resultsFeedPanel">${body}</div>`;
  }

  function bindViewTabs() {
    content.querySelectorAll('[data-results-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.resultsView;
        if (next === activeView) return;
        activeView = next;
        if (activeView === 'ranking') {
          renderRankingOrLoad();
        } else if (activeView === 'cx') {
          if (cxEntries) renderCx(cxEntries); else loadCx();
        } else if (feedEntries) {
          renderFeed(feedEntries);
        } else {
          loadFeed();
        }
      });
    });
  }

  function renderFeed(entries) {
    let html = '';
    if (!entries.length) {
      html += `<div class="startlist-empty">${_isEn
        ? 'No results in this period.' : 'No hay resultados en este periodo.'}</div>`;
    } else {
      let curDate = null;
      for (const e of entries) {
        if (e.date !== curDate) {
          if (curDate !== null) html += '</div>';
          curDate = e.date;
          html += `<div class="feed-day"><div class="feed-day__hdr">${esc(dayHeader(e.date))}</div>`;
        }
        html += entryRowHtml(e, _isEn, locale);
      }
      if (curDate !== null) html += '</div>';
    }

    if (fromKey > RESULTS_SEASON_START) {
      html += `<div class="feed-more-wrap"><button class="feed-more" id="feedMoreBtn">${_isEn ? 'Load more results' : 'Cargar más resultados'}</button></div>`;
    }
    content.innerHTML = shell(html);
    bindViewTabs();
    packFeaturedEntries(content);

    const moreBtn = content.querySelector('#feedMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', loadMoreFeed);
    }
  }

  let feedRequest=0, feedLoading=false, moreLoading=false, feedWatermark=null, pendingWatermark=null, feedProbing=false;

  function setMoreButtonLoading(loading) {
    const button = content.querySelector('#feedMoreBtn');
    if (!button) return;
    button.disabled = loading;
    button.setAttribute('aria-busy', String(loading));
    button.textContent = loading
      ? (_isEn ? 'Loading…' : 'Cargando…')
      : (_isEn ? 'Load more results' : 'Cargar más resultados');
  }

  async function loadMoreFeed() {
    if (moreLoading) return;
    const range = previousResultsWindow(fromKey);
    if (!range) return;

    const request = ++feedRequest;
    const y = window.scrollY;
    moreLoading = true;
    feedLoading = true;
    setMoreButtonLoading(true);

    try {
      const { entries: olderEntries } = await fetchEntries(range.fromKey, range.toKey, _isEn);
      if (request !== feedRequest) return;
      fromKey = range.fromKey;
      feedEntries = [...(feedEntries || []), ...olderEntries];
      moreLoading = false;
      if (activeView === 'latest') {
        renderFeed(feedEntries);
        window.scrollTo(0, y);
      }
    } catch (error) {
      if (request !== feedRequest) return;
      console.error('[resultados-feed] load more', error);
      const wrap = content.querySelector('.feed-more-wrap');
      if (wrap) {
        const note = document.createElement('div');
        note.className = 'res-update-note';
        note.setAttribute('role', 'status');
        note.textContent = _isEn
          ? 'Unable to load more results. Try again.'
          : 'No se pudieron cargar más resultados. Inténtalo de nuevo.';
        wrap.append(note);
      }
    } finally {
      if (request === feedRequest) {
        moreLoading = false;
        feedLoading = false;
        setMoreButtonLoading(false);
      }
    }
  }

  async function loadFeed({refresh=false}={}) {
    const request=++feedRequest;
    feedLoading=true;
    if (!refresh && !feedEntries) {
      content.innerHTML = shell(`<div class="loading">${_isEn ? 'Loading results' : 'Cargando resultados'}</div>`);
      bindViewTabs();
    }
    try {
      const { entries: next, watermark } = await fetchEntries(fromKey,toDateKey(new Date()),_isEn);
      if (request!==feedRequest) return;
      // La marca de agua solo avanza: incluye el cambio que disparó la recarga
      // aunque quede fuera de la ventana del feed.
      feedWatermark = [watermark, pendingWatermark, feedWatermark].filter(Boolean).sort().at(-1)
        || new Date(Date.now() - 5 * 60_000).toISOString();
      pendingWatermark = null;
      const changed = !feedEntries || JSON.stringify(next) !== JSON.stringify(feedEntries);
      feedEntries=next;
      if (activeView==='latest' && changed) {
        const focused=document.activeElement?.closest('a')?.getAttribute('href');
        renderFeed(feedEntries);
        if (focused) [...content.querySelectorAll('a')].find(a=>a.getAttribute('href')===focused)?.focus({preventScroll:true});
      }
    } catch (error) {
      if (request!==feedRequest || activeView!=='latest') return;
      console.error('[resultados-feed] latest',error);
      if(feedEntries) renderFeed(feedEntries);
      else { content.innerHTML=shell(''); bindViewTabs(); }
      const note=document.createElement('div'); note.className='res-update-note'; note.setAttribute('role','status');
      note.innerHTML=`${feedEntries ? (_isEn?'Unable to update · Saved results':'No se pudo actualizar · Datos conservados') : (_isEn?'Unable to load results':'No se pudieron cargar los resultados')} <button type="button">${_isEn?'Retry':'Reintentar'}</button>`;
      content.append(note);
      note.querySelector('button').onclick=()=>loadFeed({refresh:true});
    } finally { if(request===feedRequest) feedLoading=false; }
  }
  let packFrame=0;
  const repackFeed=()=> {
    cancelAnimationFrame(packFrame);
    packFrame=requestAnimationFrame(()=> {
      if(activeView==='latest') packFeaturedEntries(content);
      else if(activeView==='cx') packCxDays(content);
    });
  };
  window.addEventListener('resize',repackFeed);
  document.fonts?.ready.then(repackFeed);
  // Sondeo ligero: solo se recarga el feed si alguna clasificación cambió
  // desde la última lectura.
  const refreshFeed=async()=> {
    if(document.hidden || activeView!=='latest' || feedLoading || feedProbing || !content.isConnected) return;
    if(!feedWatermark) { loadFeed({refresh:true}); return; }
    feedProbing=true;
    try {
      const newest=await latestResultChange(feedWatermark);
      if(newest && !feedLoading) { pendingWatermark=newest; loadFeed({refresh:true}); }
    }
    catch { /* Sin red: se conserva el feed visible hasta la siguiente lectura. */ }
    finally { feedProbing=false; }
  };
  const feedTimer=setInterval(refreshFeed,60000);
  document.addEventListener('visibilitychange',refreshFeed);
  window.addEventListener('pagehide',()=> {clearInterval(feedTimer);document.removeEventListener('visibilitychange',refreshFeed);window.removeEventListener('resize',repackFeed);},{once:true});

  function tierClass(row) {
    switch (row.invitationTier) {
      case UciRankingTier.WORLD_TOUR: return 'uci-ranking-row--wt';
      case UciRankingTier.ALL_WORLD_TOUR:
      case UciRankingTier.WOMENS_WORLD_TOUR: return 'uci-ranking-row--orange';
      case UciRankingTier.PRO_SERIES: return 'uci-ranking-row--green';
      default: return '';
    }
  }

  function renderRanking(rows) {
    const selected = decorateUciRanking(rows, rankingGender);
    const updated = formatUciRankingUpdated(selected[0]?.rankingDate, _isEn);
    // Puntos enteros con separador de millares siempre: las cifras se alinean.
    const pointsFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: 'always' });
    // Explicación de cada etiqueta de puesto (columna izquierda en escritorio):
    // solo los niveles presentes en el ránking seleccionado.
    const rankingYear = Number(String(selected[0]?.rankingDate || '').slice(0, 4));
    const invitationYear = Number.isFinite(rankingYear) && rankingYear > 0 ? rankingYear + 1 : new Date().getFullYear() + 1;
    const keyItems = [
      ['wt', UciRankingTier.WORLD_TOUR, _isEn ? 'WorldTour licence' : 'Licencia WorldTour',
        _isEn ? 'Entitled and required to ride every UCI WorldTour race.' : 'Derecho y obligación de correr todas las pruebas UCI WorldTour.'],
      ['orange', UciRankingTier.ALL_WORLD_TOUR, _isEn ? 'All WorldTour' : 'Todo el WorldTour',
        _isEn ? `Invitation to every ${invitationYear} UCI WorldTour race, Grand Tours included, and every UCI ProSeries race.` : `Invitación a todas las pruebas UCI WorldTour de ${invitationYear}, Grandes Vueltas incluidas, y a todas las UCI ProSeries.`],
      ['orange', UciRankingTier.WOMENS_WORLD_TOUR, _isEn ? "Women's WorldTour" : "Women's WorldTour",
        _isEn ? `Invitation to every ${invitationYear} UCI Women's WorldTour race.` : `Invitación a todas las pruebas UCI Women's WorldTour de ${invitationYear}.`],
      ['green', UciRankingTier.PRO_SERIES, 'ProSeries',
        _isEn ? `Invitation to every ${invitationYear} UCI ProSeries race.` : `Invitación a todas las pruebas UCI ProSeries de ${invitationYear}.`],
    ].filter(([, tier]) => selected.some(row => row.invitationTier === tier));
    if (selected.some(row => row.grandTourExcluded)) {
      keyItems.push(['excluded', null, _isEn ? 'No Grand Tours' : 'Sin Grandes Vueltas',
        _isEn ? `Outside the overall top 30: not eligible for a ${invitationYear} Grand Tour wildcard.` : `Fuera del top-30 absoluto: sin opción a invitación para una Gran Vuelta de ${invitationYear}.`]);
    }
    const keyHtml = keyItems.length ? `<aside class="uci-ranking-key">
        <h3 class="uci-ranking-key__title">${_isEn ? `Invitations ${invitationYear}` : `Invitaciones ${invitationYear}`}</h3>
        ${keyItems.map(([cls, , label, text]) => `<div class="uci-ranking-key__item"><span class="uci-ranking-legend__item uci-ranking-legend__item--${cls}">${label}</span><p>${text}</p></div>`).join('')}
      </aside>` : '';
    const genderButtons = [
      ['male', _isEn ? 'Men' : 'Masculino'],
      ['female', _isEn ? 'Women' : 'Femenino'],
    ].map(([value, label]) => `
      <button class="feed-view-tab${value === rankingGender ? ' feed-view-tab--active' : ''}"
              type="button" data-ranking-gender="${value}">${label}</button>`).join('');
    const rowsHtml = selected.map((row) => {
      const rule = uciRankingRuleText(row, _isEn);
      const classes = [
        'uci-ranking-row',
        tierClass(row),
        row.grandTourExcluded ? 'uci-ranking-row--excluded' : '',
        rule ? 'uci-ranking-row--explained' : '',
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}"${rule ? ` tabindex="0" role="button" aria-expanded="false" data-tooltip="${esc(rule)}"` : ''}>
          <span class="uci-ranking-row__rank">${esc(String(row.rank))}</span>
          <span class="uci-ranking-row__flag">${countryFlag(row.countryCode)}</span>
          <span class="uci-ranking-row__team">${esc(row.displayName || row.sourceName)}</span>
          <span class="uci-ranking-row__category">${esc(row.teamCategory || '')}</span>
          <span class="uci-ranking-row__points">${esc(pointsFormat.format(Number(row.points)))}</span>
        </div>`;
    }).join('');

    const body = `
      <section class="uci-ranking">
        <h2 class="sr-only">${_isEn ? 'UCI Team Ranking' : 'Ránking UCI por equipos'}</h2>
        <div class="uci-ranking-bar">
          <div class="feed-view-tabs uci-ranking-gender-tabs" aria-label="${_isEn ? 'Ranking gender' : 'Género del ránking'}">
            ${genderButtons}
          </div>
          <p class="uci-ranking-updated">${esc(updated)}</p>
        </div>
        <div class="uci-ranking-layout">
        ${keyHtml}
        <!-- Sin role="table": las filas son <div> sin role="row"/"cell" y
             además llevan botones e imágenes dentro, así que el rol prometía
             una estructura de tabla que el marcado no cumple y el lector la
             anunciaba rota. Se conserva el nombre accesible como grupo. -->
        <div class="uci-ranking-table" role="group" aria-label="${_isEn ? 'UCI team ranking' : 'Ránking UCI por equipos'}">
          <div class="uci-ranking-table__head">
            <span>#</span><span></span><span>${_isEn ? 'Team' : 'Equipo'}</span><span>${_isEn ? 'Cat.' : 'Cat.'}</span><span>${_isEn ? 'Points' : 'Puntos'}</span>
          </div>
          ${rowsHtml || `<div class="startlist-empty">${_isEn ? 'Ranking not available.' : 'Ránking no disponible.'}</div>`}
        </div>
        </div>
      </section>`;
    content.innerHTML = shell(body);
    bindViewTabs();

    content.querySelectorAll('[data-ranking-gender]').forEach((button) => {
      button.addEventListener('click', () => {
        rankingGender = button.dataset.rankingGender;
        renderRanking(rows);
      });
    });
    const explainedRows = [...content.querySelectorAll('.uci-ranking-row--explained')];
    const closeRuleTooltips = (except = null) => {
      explainedRows.forEach((row) => {
        if (row === except) return;
        row.classList.remove('uci-ranking-row--tooltip-open');
        row.setAttribute('aria-expanded', 'false');
      });
    };
    const toggleRuleTooltip = (row) => {
      const shouldOpen = !row.classList.contains('uci-ranking-row--tooltip-open');
      closeRuleTooltips(row);
      row.classList.toggle('uci-ranking-row--tooltip-open', shouldOpen);
      row.setAttribute('aria-expanded', String(shouldOpen));
    };
    explainedRows.forEach((row) => {
      row.addEventListener('click', () => toggleRuleTooltip(row));
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleRuleTooltip(row);
      });
    });
    content.querySelector('.uci-ranking')?.addEventListener('click', (event) => {
      if (!event.target.closest('.uci-ranking-row--explained')) closeRuleTooltips();
    });
  }

  async function renderRankingOrLoad() {
    if (rankingRows) {
      renderRanking(rankingRows);
      return;
    }
    content.innerHTML = shell(`<div class="loading">${_isEn ? 'Loading UCI ranking' : 'Cargando ránking UCI'}</div>`);
    bindViewTabs();
    try {
      const { data, error } = await supabase
        .from('uci_team_rankings')
        .select('gender,rank,previousRank,uciTeamId,teamId,teamCategory,sourceName,displayName,teamCode,countryCode,points,rankingDate,sourceUrl')
        .order('gender', { ascending: true })
        .order('rank', { ascending: true });
      if (error) throw error;
      rankingRows = data || [];
      if (activeView === 'ranking') renderRanking(rankingRows);
    } catch (error) {
      console.error('[resultados-feed] ranking', error);
      if (activeView === 'ranking') {
        content.innerHTML = shell(`<div class="startlist-empty">${_isEn
          ? 'The UCI ranking could not be loaded.'
          : 'No se pudo cargar el ránking UCI.'}</div>`);
        bindViewTabs();
      }
    }
  }

  // ── Ciclocross ──────────────────────────────────────────────────
  // La temporada CX en curso se lee de una vez; «Cargar más» amplía en
  // memoria la ventana de días mostrados, como el feed de carretera.
  const CX_WINDOW_DAYS = 14;
  const addDays = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  let cxRounds = null, cxEntries = null, cxFromKey = addDays(todayKey, -(CX_WINDOW_DAYS - 1)), cxRequest = 0, cxLoading = false;

  function renderCx(entries) {
    const visible = entries.filter(e => e.date >= cxFromKey);
    let html = '';
    if (!visible.length) {
      html += `<div class="startlist-empty">${entries.length
        ? (_isEn ? 'No cyclocross results in this period.' : 'No hay resultados de ciclocross en este periodo.')
        : (_isEn ? 'No cyclocross results this season.' : 'No hay resultados de ciclocross en esta temporada.')}</div>`;
    } else {
      let curDate = null;
      for (const e of visible) {
        if (e.date !== curDate) {
          if (curDate !== null) html += '</div></div>';
          curDate = e.date;
          html += `<div class="feed-day feed-day--cx"><div class="feed-day__hdr">${esc(dayHeader(e.date))}</div><div class="feed-day__cx-grid">`;
        }
        html += cxEntryRowHtml(e, _isEn, cxRounds);
      }
      html += '</div></div>';
    }
    if (entries.some(e => e.date < cxFromKey)) {
      html += `<div class="feed-more-wrap"><button class="feed-more" id="cxMoreBtn">${_isEn ? 'Load more results' : 'Cargar más resultados'}</button></div>`;
    }
    content.innerHTML = shell(html);
    bindViewTabs();
    packCxDays(content);
    content.querySelector('#cxMoreBtn')?.addEventListener('click', () => {
      const y = window.scrollY;
      cxFromKey = addDays(cxFromKey, -CX_WINDOW_DAYS);
      renderCx(cxEntries);
      window.scrollTo(0, y);
    });
  }

  async function loadCx({ refresh = false } = {}) {
    const request = ++cxRequest;
    cxLoading = true;
    if (!refresh && !cxEntries) {
      content.innerHTML = shell(`<div class="loading">${_isEn ? 'Loading results' : 'Cargando resultados'}</div>`);
      bindViewTabs();
    }
    try {
      const season = cxSeason();
      const [allRows, rounds] = await Promise.all([cxSeasonRows(supabase, season), cxSeasonRounds(supabase, season).catch(() => null)]);
      const rows = allRows.filter(race => cxListedInAgenda(race, _isEn ? 'en' : 'es'));
      if (request !== cxRequest) return;
      cxRounds = rounds;
      const next = cxResultEntries(rows);
      const changed = !cxEntries || JSON.stringify(next) !== JSON.stringify(cxEntries);
      cxEntries = next;
      if (activeView === 'cx' && changed) renderCx(cxEntries);
    } catch (error) {
      if (request !== cxRequest || activeView !== 'cx') return;
      console.error('[resultados-feed] ciclocross', error);
      if (cxEntries) renderCx(cxEntries);
      else { content.innerHTML = shell(''); bindViewTabs(); }
      const note = document.createElement('div'); note.className = 'res-update-note'; note.setAttribute('role', 'status');
      note.innerHTML = `${cxEntries ? (_isEn ? 'Unable to update · Saved results' : 'No se pudo actualizar · Datos conservados') : (_isEn ? 'Unable to load results' : 'No se pudieron cargar los resultados')} <button type="button">${_isEn ? 'Retry' : 'Reintentar'}</button>`;
      content.append(note);
      note.querySelector('button').onclick = () => loadCx({ refresh: true });
    } finally { if (request === cxRequest) cxLoading = false; }
  }
  if (views.includes('cx')) {
    const refreshCx = () => { if (!document.hidden && activeView === 'cx' && !cxLoading && content.isConnected) loadCx({ refresh: true }); };
    const cxTimer = setInterval(refreshCx, 60000);
    document.addEventListener('visibilitychange', refreshCx);
    window.addEventListener('pagehide', () => { clearInterval(cxTimer); document.removeEventListener('visibilitychange', refreshCx); }, { once: true });
  }

  if (activeView === 'cx') loadCx();
  else loadFeed();
}
