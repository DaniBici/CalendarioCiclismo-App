// Entradas de Últimos resultados: clasificaciones de un rango de fechas con su
// ganador y su contexto, en el orden del feed. Sin DOM: lo usa también el
// servidor que publica la página, con un cliente sobre filas ya leídas.
import { fetchAllRows, fetchByIds } from './paged-query.js';
import { enrichResultFeed } from './result-feed-context.js';
import { supabase, enBase, categoryRank, genderRank, grandTourRank, tsSeconds } from '../shared.js';
import { localizedTeamName } from './national-team-name.js';
import { isNonWinnerIrm } from '../results/uci-irm.js';
import { compareChampionships } from '../campeonatos-config.js';
import { resultFeedEntryKey, sectorSuffixMap } from './races.js';

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
export async function fetchResultEntries(fromKey, toKey, isEn) {
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
            ? await supabase.from('teams').select('id, name, teamKind, selectionScope, countryCode, selectionCode').in('id', teamIds)
            : { data: [] };
          const teamById = new Map((tms || []).map(row => [row.id, row]));
          for (const e of creEntries) {
            const pks = pksFor(e);
            if (pks.length !== 1) continue;
            const slt = sltById.get(pks[0]);
            if (!slt) continue;
            const team = slt.teamId ? teamById.get(slt.teamId) : null;
            const teamWinner = team?.name || slt.teamName || '';
            if (teamWinner) e.winner = localizedTeamName(teamWinner, team, isEn);
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
