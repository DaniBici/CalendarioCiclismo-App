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
//     salida › meta · km + badges de tipo reducidos / ganador en negrita con
//     nombre canónico de la ficha (fallback al winnerName crudo; CRE → crudo).
//   · stageDate puede venir NULL (volcados PDF, migración 090) → la fecha se
//     resuelve por raceDayId→race_days.dateKey o por las fechas de la carrera.
//   · Sin resultados in-house pero jornada concluida (meta+30) y externos → fila
//     con los enlaces externos; se convierte sola cuando el cron vuelque.
// ─────────────────────────────────────────────────────────────────

import { supabase, esc, countryFlag, raceName as getRaceName, enBase,
         setMeta, setMetaProperty, rdLocation, resolveTypeBadges,
         uciRank, proLevel, genderRank, grandTourRank, tsSeconds,
         nameImpliesFemale, effectiveCountryCode } from './shared.js';
import { getLang } from './i18n.js';
import { buildExtUrlA, buildExtUrlB, isRaceConcluded } from './race-data-modal.js';
import { isAbandonIrm } from './uci-irm.js';
import { compareChampionships } from './campeonatos-config.js';

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

  // 2) Jornadas publicadas del rango (fallback externos + recorrido/km/tipos/
  //    hora de las filas in-house, vía raceDayId).
  const { data: raceDays } = await supabase
    .from('race_days')
    .select('id, raceId, dateKey, stageNumber, isRestDay, isCancelledDay, estimatedFinishTimeUtc, neutralStartTimeUtc, startLocation, finishLocation, startLocationEn, finishLocationEn, distanceKm, primaryType, secondaryType, countryCode')
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
      .select('id, name, nameEn, slug, slugEn, year, countryCode, gender, raceFormat, extId, extSlug, uciCategory, colorHex, isGrandTour, startDate, endDate, logoUrl')
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

  // ── Fallback externos: jornadas concluidas SIN volcado in-house ─────
  for (const rd of (raceDays || [])) {
    if (rd.isRestDay || rd.isCancelledDay) continue;
    const race = raceById.get(rd.raceId);
    if (!race || (!race.extId && !race.extSlug)) continue;
    const isOneDay = race.raceFormat === 'one_day';
    const covered = inhouseKeys.has(key(rd.raceId, rd.stageNumber))
      || (isOneDay && (inhouseKeys.has(key(rd.raceId, null)) || seen.has(`${rd.raceId}#oneday`)));
    if (covered) continue;
    if (!isRaceConcluded(rd)) continue;
    const sn = isOneDay ? null : rd.stageNumber;
    entries.push({
      kind: 'ext',
      date: rd.dateKey, race, sn, subOrder: 1, rd,
      extUrlA: buildExtUrlA(race, sn),
      extUrlB: buildExtUrlB(race, sn),
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
    ? ' <span class="feed-row__fem" aria-hidden="true">♀</span>' : '';
  const name = `${esc(getRaceName(e.race))}${fem}`;
  const color = safeCardColor(e.race.colorHex);

  // Línea 2: "Etapa N" y el kilometraje en NEGRITA · salida › meta + badges
  // de tipo (reducidos). Las generales finales solo llevan su etiqueta. Un
  // día: sin etiqueta.
  let subHtml = '';
  if (e.isGcFinal) {
    subHtml = `<span class="feed-row__gclabel">${esc(gcFinalLabel)}</span>`;
  } else {
    const rd = e.rd;
    const startLoc = rd ? (rdLocation(rd, 'startLocation') || '') : '';
    const finishLoc = rd ? (rdLocation(rd, 'finishLocation') || '') : '';
    const route = (!finishLoc || startLoc === finishLoc)
      ? (startLoc || finishLoc || '')
      : `${startLoc} › ${finishLoc}`;
    const km = rd?.distanceKm
      ? `${Number(rd.distanceKm).toLocaleString(locale)} km` : '';
    const stagePart = stageLabel(e.sn, isEn);
    const seg = [];
    if (stagePart) seg.push(`<strong>${esc(stagePart)}</strong>`);
    if (route) seg.push(esc(route));
    if (km) seg.push(`<strong>${esc(km)}</strong>`);
    const text = seg.join(' · ');
    const badges = rd?.primaryType
      ? `<span class="feed-row__badges">${resolveTypeBadges(rd.primaryType, rd.secondaryType, e.race.countryCode)}</span>` : '';
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
  const ext = (href, label) => href
    ? `<a class="feed-row__extbtn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}&nbsp;↗&#xFE0E;</a>` : '';
  return `
    <div class="feed-row feed-row--ext" style="--card-color:${esc(color)}">
      ${leftCol}
      <span class="feed-row__main"><span class="feed-row__race">${name}</span>
        ${subHtml ? `<span class="feed-row__sub">${subHtml}</span>` : ''}</span>
      <span class="feed-row__extbtns">${ext(e.extUrlA, 'FC')}${ext(e.extUrlB, 'fuente externa')}</span>
    </div>`;
}

// ── Índice /resultados/ · /en/results/ ─────────────────────────────
export function renderResultsFeed(content) {
  const _isEn = getLang() === 'en';
  const locale = _isEn ? 'en-GB' : 'es-ES';
  const todayKey = toDateKey(new Date());
  let fromKey = addDays(todayKey, -(WINDOW_DAYS - 1));

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

  async function load() {
    content.innerHTML = `<div class="loading">${_isEn ? 'Loading results' : 'Cargando resultados'}</div>`;
    const entries = await fetchEntries(fromKey, todayKey, _isEn);

    // ── Render ────────────────────────────────────────────────────
    let html = `
      <div class="feed-hero">
        <h1 class="feed-hero__title">${_isEn ? 'Latest results' : 'Últimos resultados'}</h1>
      </div>`;

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
    content.innerHTML = html;

    const moreBtn = document.getElementById('feedMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        const next = addDays(fromKey, -WINDOW_DAYS);
        fromKey = next < SEASON_START ? SEASON_START : next;
        const y = window.scrollY;
        load().then(() => window.scrollTo(0, y));
      });
    }
  }

  load();
}
