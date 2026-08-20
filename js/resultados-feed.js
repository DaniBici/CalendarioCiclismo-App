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
//   · Sin resultados in-house pero jornada concluida (meta+30) y FC/PCS → la
//     misma card navegable, que abre el modal de fuentes externas; se convierte
//     sola cuando el cron vuelque.
// ─────────────────────────────────────────────────────────────────

import { supabase, esc, countryFlag, raceName as getRaceName, enBase,
         setMeta, setMetaProperty, resolveTypeBadges,
         uciRank, proLevel, genderRank, grandTourRank, tsSeconds,
         nameImpliesFemale, effectiveCountryCode, trapFocus, femaleMark } from './shared.js';
import { getLang } from './i18n.js';
import { buildFcUrl, buildPcsUrl, isRaceConcluded, openResultsModal } from './race-data-modal.js';
import { isAbandonIrm } from './uci-irm.js';
import { compareChampionships } from './campeonatos-config.js';
import {
  decorateUciRanking,
  formatUciRankingUpdated,
  UciRankingTier,
  uciRankingRuleText,
} from './uci-team-ranking.js';

const WINDOW_DAYS = 14;
const SEASON_START = '2026-01-01';

const TROPHY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-0.12em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dk, n) {
  const [y, m, d] = dk.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + n));
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

function stageLabel(sn, isEn) {
  if (sn === 0) return isEn ? 'Prologue' : 'Prólogo';
  if (sn != null) return isEn ? `Stage ${sn}` : `Etapa ${sn}`;
  return '';   // pruebas de un día: sin etiqueta (decisión 2026-06-11)
}
function inhouseHref(race, sn, hash, isEn) {
  const slug = isEn ? (race.slugEn || race.slug) : race.slug;
  let url;
  if (!slug) {
    const stage = sn != null ? `&stage=${sn}` : '';
    url = (isEn ? `${enBase()}/results/` : '/resultados.html') + `?race=${encodeURIComponent(race.id)}${stage}`;
  } else {
    const base = isEn ? `${enBase()}/results/` : '/resultados/';
    let seg = '';
    if (sn === 0) seg = isEn ? 'prologue/' : 'prologo/';
    else if (sn != null) seg = isEn ? `stage-${sn}/` : `etapa-${sn}/`;
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
  if (a.race.id === b.race.id) return a.subOrder - b.subOrder;
  const rA = a.race, rB = b.race;
  // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría
  // (espejo de _sortByCategory en app.js; el rd da el primaryType para el slot).
  const cn = compareChampionships(rA, a.rd, rB, b.rd);
  if (cn != null && cn !== 0) return cn;
  const gt = grandTourRank(rA) - grandTourRank(rB);
  if (gt) return gt;
  const lvl = proLevel(rA.uciCategory, rA.name, rA.countryCode) - proLevel(rB.uciCategory, rB.name, rB.countryCode);
  if (lvl) return lvl;
  const gen = genderRank(rA.gender) - genderRank(rB.gender);
  if (gen) return gen;
  const cat = uciRank(rA.uciCategory, rA.name, rA.countryCode) - uciRank(rB.uciCategory, rB.name, rB.countryCode);
  if (cat) return cat;
  if (a._sortTime !== b._sortTime) return a._sortTime - b._sortTime;
  return (rA.name || '').localeCompare(rB.name || '');
}

// ── Datos: entradas de resultados de un rango de fechas, ya ordenadas ──
async function fetchEntries(fromKey, toKey, isEn) {
  // 1) Clasificaciones in-house: etapas + generales. stageDate NULL (PDF)
  //    también entra; su fecha se resuelve después y se filtra en cliente.
  const { data: stages } = await supabase
    .from('race_uci_stages')
    .select('id, raceId, raceDayId, stageNumber, classKind, stageDate, winnerName, isFinalClassification')
    .eq('keepForWeb', true).gt('rowCount', 0)
    .in('classKind', ['stage', 'gc'])
    .or(`stageDate.gte.${fromKey},stageDate.is.null`)
    .or(`stageDate.lte.${toKey},stageDate.is.null`);

  // 2) Jornadas publicadas del rango (fallback FC/PCS + km/desnivel/tipos/
  //    hora de las filas in-house, vía raceDayId).
  const { data: raceDays } = await supabase
    .from('race_days')
    .select('id, raceId, dateKey, stageNumber, isRestDay, isCancelledDay, estimatedFinishTimeUtc, neutralStartTimeUtc, distanceKm, elevationProfile, primaryType, secondaryType, countryCode')
    .eq('editorialStatus', 'published')
    .gte('dateKey', fromKey).lte('dateKey', toKey);

  const rdById = new Map((raceDays || []).map(rd => [rd.id, rd]));
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
    ...(raceDays || []).map(rd => rd.raceId),
  ].filter(Boolean))];
  const raceById = new Map();
  if (raceIds.length) {
    const { data: races } = await supabase.from('races')
      .select('id, name, nameEn, slug, slugEn, year, countryCode, gender, raceFormat, fcId, pcsSlug, uciCategory, colorHex, isGrandTour, startDate, endDate, logoUrl')
      .in('id', raceIds);
    (races || []).forEach(r => raceById.set(r.id, r));
  }

  // ── Entradas in-house ──────────────────────────────────────────
  const key = (rid, sn) => `${rid}#${sn == null ? 'final' : sn}`;
  const inhouseKeys = new Set((stages || []).map(s => key(s.raceId, s.stageNumber)));
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
      // de su carrera (subOrder 0 < 1; cmpEntries la pega a su carrera).
      const k = `${s.raceId}#gcfinal`;
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push({
        _k: k, _stageRef: s.id, kind: 'inhouse', isGcFinal: true,
        date, race, sn: null, subOrder: 0, rd: null,
        winner: cleanWinner(s.winnerName),
        href: inhouseHref(race, null, 'gc', isEn),
      });
    } else if (s.classKind === 'stage' && s.stageNumber != null) {
      const k = key(s.raceId, s.stageNumber);
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push({
        _k: k, _stageRef: s.id, kind: 'inhouse',
        date, race, sn: s.stageNumber, subOrder: 1, rd: entryRd(s, race),
        winner: cleanWinner(s.winnerName),
        href: inhouseHref(race, s.stageNumber, null, isEn),
      });
    }
  }

  // ── Fallback FC/PCS: jornadas concluidas SIN volcado in-house ─────
  for (const rd of (raceDays || [])) {
    if (rd.isRestDay || rd.isCancelledDay) continue;
    const race = raceById.get(rd.raceId);
    if (!race || (!race.fcId && !race.pcsSlug)) continue;
    const isOneDay = race.raceFormat === 'one_day';
    const covered = inhouseKeys.has(key(rd.raceId, rd.stageNumber))
      || (isOneDay && (inhouseKeys.has(key(rd.raceId, null)) || seen.has(`${rd.raceId}#oneday`)));
    if (covered) continue;
    if (!isRaceConcluded(rd)) continue;
    const sn = isOneDay ? null : rd.stageNumber;
    entries.push({
      kind: 'ext',
      date: rd.dateKey, race, sn, subOrder: 1, rd,
      fcUrl: buildFcUrl(race, sn),
      pcsUrl: buildPcsUrl(race, sn),
    });
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
      (w || []).forEach(row => {
        if (isAbandonIrm(row.irm)) return;   // rank 1 espurio (DNS con rank)
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
      for (const e of creEntries) {
        const ids = [...(byRef.get(e._stageRef) || [])].slice(0, 3);
        if (!ids.length) continue;
        try {
          const { data: slr } = await supabase.from('startlist_riders_resolved')
            .select('teamId').eq('raceId', e.race.id).in('globalRiderId', ids).limit(3);
          const slPks = [...new Set((slr || []).map(r => r.teamId).filter(Boolean))];
          if (slPks.length !== 1) continue;
          const { data: slt } = await supabase.from('startlist_teams')
            .select('teamId, teamName').eq('id', slPks[0]).maybeSingle();
          if (!slt) continue;
          let teamWinner = slt.teamName || '';
          if (slt.teamId) {
            const { data: tm } = await supabase.from('teams').select('name').eq('id', slt.teamId).maybeSingle();
            if (tm?.name) teamWinner = tm.name;
          }
          if (teamWinner) e.winner = teamWinner;
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
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || cmpEntries(a, b));
  return entries;
}

// ── Render de una fila ─────────────────────────────────────────────
function entryRowHtml(e, isEn, locale) {
  const gcFinalLabel = isEn ? 'Final GC' : 'General final';
  // País efectivo: la jornada puede transcurrir en un país distinto al de la
  // carrera (etapa que sale de otro país) → prevalece el de la jornada.
  const flagCc = effectiveCountryCode(e.rd, e.race);
  const flag = flagCc ? `<span class="feed-row__flag">${countryFlag(flagCc)}</span>` : '';
  // Logo de la carrera como en las cards de Hoy (race-logo-img + bandera
  // debajo); sin logo → solo la bandera, como hasta ahora.
  const leftCol = e.race.logoUrl
    ? `<span class="feed-row__logo"><img class="race-logo-img" src="${esc(e.race.logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">${flag}</span>`
    : flag;
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
    const gain = rd?.elevationProfile?.elevationGain;
    const elevation = gain != null
      ? `+${Number(Math.round(gain / 10) * 10).toLocaleString(locale)} m`
      : '';
    const stagePart = stageLabel(e.sn, isEn);
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

  const winnerHtml = (e.kind === 'inhouse' && e.winner)
    ? `<span class="feed-row__winner">${TROPHY_SVG} <strong>${esc(e.winner)}</strong></span>` : '';

  if (e.kind === 'inhouse') {
    return `
      <a class="feed-row${e.isGcFinal ? ' feed-row--gc' : ''}" style="--card-color:${esc(color)}" href="${esc(e.href)}">
        ${leftCol}
        <span class="feed-row__main"><span class="feed-row__race">${name}</span>
          ${subHtml ? `<span class="feed-row__sub">${subHtml}</span>` : ''}
          ${winnerHtml}</span>
        <span class="feed-row__chevron" aria-hidden="true">›</span>
      </a>`;
  }
  const externalLabel = isEn
    ? `View results for ${getRaceName(e.race)}`
    : `Ver resultados de ${getRaceName(e.race)}`;
  return `
    <button class="feed-row feed-row--ext" type="button"
            style="--card-color:${esc(color)}"
            data-results-fallback="${esc(e.rd?.id || '')}"
            aria-label="${esc(externalLabel)}">
      ${leftCol}
      <span class="feed-row__main"><span class="feed-row__race">${name}</span>
        ${subHtml ? `<span class="feed-row__sub">${subHtml}</span>` : ''}</span>
      <span class="feed-row__chevron" aria-hidden="true">›</span>
    </button>`;
}

// ── Índice /resultados/ · /en/results/ ─────────────────────────────
export function renderResultsFeed(content) {
  const _isEn = getLang() === 'en';
  const locale = _isEn ? 'en-GB' : 'es-ES';
  const todayKey = toDateKey(new Date());
  let fromKey = addDays(todayKey, -(WINDOW_DAYS - 1));
  let activeView = 'latest';
  let rankingGender = 'male';
  let feedEntries = null;
  let rankingRows = null;
  let infoModal = null;
  let _releaseInfoFocus = null;

  // ── SEO (la home del feed es evergreen) ───────────────────────────
  const title = _isEn
    ? 'Latest results — Calendario Ciclismo'
    : 'Últimos resultados — Calendario Ciclismo App';
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
        <h1 class="feed-hero__title">${_isEn ? 'Results' : 'Resultados'}</h1>
        <div class="feed-view-tabs" role="tablist" aria-label="${_isEn ? 'Results view' : 'Vista de resultados'}">
          <button class="feed-view-tab${activeView === 'latest' ? ' feed-view-tab--active' : ''}"
                  type="button" role="tab" aria-selected="${activeView === 'latest'}" data-results-view="latest">
            ${_isEn ? 'Latest Results' : 'Últimos Resultados'}
          </button>
          <button class="feed-view-tab${activeView === 'ranking' ? ' feed-view-tab--active' : ''}"
                  type="button" role="tab" aria-selected="${activeView === 'ranking'}" data-results-view="ranking">
            ${_isEn ? 'UCI Ranking' : 'Ránking UCI'}
          </button>
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

    if (fromKey > SEASON_START) {
      html += `<div class="feed-more-wrap"><button class="feed-more" id="feedMoreBtn">${_isEn ? 'Load more results' : 'Cargar más resultados'}</button></div>`;
    }
    content.innerHTML = shell(html);
    bindViewTabs();

    const externalByDayId = new Map(entries
      .filter(entry => entry.kind === 'ext' && entry.rd?.id)
      .map(entry => [String(entry.rd.id), entry]));
    content.querySelectorAll('[data-results-fallback]').forEach(card => {
      const entry = externalByDayId.get(card.dataset.resultsFallback);
      if (entry) card.addEventListener('click', () => openResultsModal(entry.rd, entry.race));
    });

    const moreBtn = document.getElementById('feedMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        const next = addDays(fromKey, -WINDOW_DAYS);
        fromKey = next < SEASON_START ? SEASON_START : next;
        const y = window.scrollY;
        await loadFeed();
        window.scrollTo(0, y);
      });
    }
  }

  async function loadFeed() {
    content.innerHTML = shell(`<div class="loading">${_isEn ? 'Loading results' : 'Cargando resultados'}</div>`);
    bindViewTabs();
    try {
      feedEntries = await fetchEntries(fromKey, todayKey, _isEn);
      if (activeView === 'latest') renderFeed(feedEntries);
    } catch (error) {
      console.error('[resultados-feed] latest', error);
      if (activeView === 'latest') {
        content.innerHTML = shell(`<div class="startlist-empty">${_isEn
          ? 'The latest results could not be loaded.'
          : 'No se pudieron cargar los últimos resultados.'}</div>`);
        bindViewTabs();
      }
    }
  }

  function rankingInfoHtml(rows) {
    const updated = formatUciRankingUpdated(rows[0]?.rankingDate, _isEn);
    const sourceUrl = rows[0]?.sourceUrl || 'https://dataride.uci.ch/iframe/Rankings/10';
    const regulationsUrl = 'https://assets.ctfassets.net/761l7gh5x5an/6FEzFHeA2oKMBGb5sdIvQ7/96aad776f210fc38853ec9bf9ec9acba/2-ROA-20260701-E.pdf';
    if (_isEn) {
      return `
        <p><strong>${esc(updated)}.</strong> DataRide normally publishes a new ranking every Tuesday.</p>
        <p>The coloured invitations are a projection from the current position. The regulations use the final ranking of the previous season.</p>
        <ul class="uci-ranking-legend">
          <li><span class="uci-ranking-swatch uci-ranking-swatch--wt"></span> ${rankingGender === 'male' ? 'WorldTeams' : "Women's WorldTeams"}</li>
          <li><span class="uci-ranking-swatch uci-ranking-swatch--orange"></span> ${rankingGender === 'male' ? 'Mandatory WorldTour and ProSeries invitations' : "Mandatory Women's WorldTour invitations"}</li>
          ${rankingGender === 'male' ? '<li><span class="uci-ranking-swatch uci-ranking-swatch--green"></span> Mandatory ProSeries invitations</li>' : ''}
          ${rankingGender === 'male' ? '<li><span class="uci-ranking-swatch uci-ranking-swatch--excluded"></span> ProTeams outside the overall top 30</li>' : ''}
        </ul>
        <p><a href="${esc(sourceUrl)}" target="_blank" rel="noopener">UCI DataRide source</a> ·
        <a href="${regulationsUrl}" target="_blank" rel="noopener">UCI Regulations, art. 2.1.007bis</a></p>`;
    }
    return `
      <p><strong>${esc(updated)}.</strong> DataRide publica normalmente un nuevo ránking cada martes.</p>
      <p>Las invitaciones coloreadas son una proyección de la posición actual. El reglamento emplea el ránking final de la temporada anterior.</p>
      <ul class="uci-ranking-legend">
        <li><span class="uci-ranking-swatch uci-ranking-swatch--wt"></span> ${rankingGender === 'male' ? 'WorldTeams' : "Women's WorldTeams"}</li>
        <li><span class="uci-ranking-swatch uci-ranking-swatch--orange"></span> ${rankingGender === 'male' ? 'Invitaciones obligatorias a todo el WorldTour y ProSeries' : "Invitaciones obligatorias al Women's WorldTour"}</li>
        ${rankingGender === 'male' ? '<li><span class="uci-ranking-swatch uci-ranking-swatch--green"></span> Invitaciones obligatorias a ProSeries</li>' : ''}
        ${rankingGender === 'male' ? '<li><span class="uci-ranking-swatch uci-ranking-swatch--excluded"></span> ProTeams fuera del top-30 absoluto</li>' : ''}
      </ul>
      <p><a href="${esc(sourceUrl)}" target="_blank" rel="noopener">Fuente UCI DataRide</a> ·
      <a href="${regulationsUrl}" target="_blank" rel="noopener">Reglamento UCI, art. 2.1.007bis</a></p>`;
  }

  function closeInfoModal() {
    if (!infoModal) return;
    infoModal.classList.remove('rd-modal--open');
    document.body.style.overflow = '';
    if (_releaseInfoFocus) { _releaseInfoFocus(); _releaseInfoFocus = null; }
    content.querySelector('.uci-ranking-info-button')?.focus();
  }

  function openInfoModal(rows) {
    if (!infoModal) {
      infoModal = document.createElement('div');
      infoModal.className = 'rd-modal-overlay';
      infoModal.innerHTML = `
        <div class="rd-modal uci-ranking-info-modal" role="dialog" aria-modal="true" aria-labelledby="uciRankingInfoTitle">
          <div class="rd-modal__bar">
            <div class="rd-modal__header-text">
              <span class="rd-modal__race-name" id="uciRankingInfoTitle">${_isEn ? 'About the UCI Ranking' : 'Sobre el Ránking UCI'}</span>
            </div>
            <button class="rd-modal__close" type="button" aria-label="${_isEn ? 'Close' : 'Cerrar'}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="rd-modal__body uci-ranking-info-modal__body"></div>
        </div>`;
      infoModal.addEventListener('click', (event) => {
        if (event.target === infoModal) closeInfoModal();
      });
      infoModal.querySelector('.rd-modal__close').addEventListener('click', closeInfoModal);
      document.body.appendChild(infoModal);
    }
    infoModal.querySelector('.uci-ranking-info-modal__body').innerHTML = rankingInfoHtml(rows);
    infoModal.classList.add('rd-modal--open');
    document.body.style.overflow = 'hidden';
    _releaseInfoFocus = trapFocus(infoModal.querySelector('.rd-modal'),
      { initial: infoModal.querySelector('.rd-modal__close') });
  }

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
    const info = rankingInfoHtml(selected);
    const updated = formatUciRankingUpdated(selected[0]?.rankingDate, _isEn);
    const pointsFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
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
        <div class="uci-ranking-heading-row">
          <h2 class="uci-ranking-title">${_isEn ? 'UCI Team Ranking' : 'Ránking UCI por equipos'}</h2>
          <div class="uci-ranking-heading-meta">
            <p class="uci-ranking-updated">${esc(updated)}</p>
            <button class="uci-ranking-info-button" type="button"
                    aria-label="${_isEn ? 'Ranking source and invitation rules' : 'Fuente y reglas de invitación'}"
                    aria-describedby="uciRankingInfoTooltip">i</button>
          </div>
          <div class="uci-ranking-info-tooltip" id="uciRankingInfoTooltip" role="tooltip">${info}</div>
        </div>
        <div class="feed-view-tabs uci-ranking-gender-tabs" aria-label="${_isEn ? 'Ranking gender' : 'Género del ránking'}">
          ${genderButtons}
        </div>
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
      </section>`;
    content.innerHTML = shell(body);
    bindViewTabs();

    content.querySelectorAll('[data-ranking-gender]').forEach((button) => {
      button.addEventListener('click', () => {
        rankingGender = button.dataset.rankingGender;
        renderRanking(rows);
      });
    });
    content.querySelector('.uci-ranking-info-button')?.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 768px)').matches) openInfoModal(selected);
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && infoModal?.classList.contains('rd-modal--open')) closeInfoModal();
  });

  loadFeed();
}
