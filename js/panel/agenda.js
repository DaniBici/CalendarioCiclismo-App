// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Catálogo de carreras en memoria y agenda diaria (sidebar)
// ─────────────────────────────────────────────────────────────────

import { panelAgendaItemHtml } from './catalog-ui.js';
import { mountFeaturedEditor } from './race-presentation.js';
import {
  supabase, countryFlag, stageLabel, esc, genderRank, grandTourRank, tsSeconds,
  categoryBadge, effectiveCountryCode, nameImpliesFemale,
} from '../shared.js';
import { annotateDoubleSectors } from '../services/races.js';
import { fetchAllRows } from '../services/paged-query.js';
import { compareChampionships } from '../campeonatos-config.js';
import { panelState } from './state.js';
import { loadedRaceYears, loadingRaceYears, uciRankSimple } from './helpers.js';
import { openEditor } from './jornada-editor.js';
import { createNewRaceDay, getRaceSuggestionsForDate } from './race-picker.js';

// ── Carreras ──────────────────────────────────────────────────────
function sortRaces(arr) {
  return arr.sort((a, b) => grandTourRank(a) - grandTourRank(b)
    || uciRankSimple(a.uciCategory) - uciRankSimple(b.uciCategory)
    || (a.name || '').localeCompare(b.name || ''));
}

export function raceYearFromDateKey(dateKey = panelState.currentDateKey) {
  const year = Number(String(dateKey || '').slice(0, 4));
  return Number.isInteger(year) ? year : new Date().getFullYear();
}

export async function ensureRaceYearLoaded(year, { force = false } = {}) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear)) return [];
  if (panelState.allRacesFullyLoaded && !force) {
    return panelState.allRaces.filter(race => Number(race.year) === normalizedYear);
  }
  if (loadedRaceYears.has(normalizedYear) && !force) {
    return panelState.allRaces.filter(race => Number(race.year) === normalizedYear);
  }
  if (loadingRaceYears.has(normalizedYear)) return loadingRaceYears.get(normalizedYear);

  const request = fetchAllRows(() => supabase
    .from('races')
    .select('*')
    .eq('year', normalizedYear)
    .order('id'), 2000)
    .then(rows => {
      panelState.allRaces = panelState.allRaces.filter(race => Number(race.year) !== normalizedYear);
      panelState.allRaces.push(...rows);
      loadedRaceYears.add(normalizedYear);
      sortRaces(panelState.allRaces);
      return rows;
    })
    .finally(() => loadingRaceYears.delete(normalizedYear));

  loadingRaceYears.set(normalizedYear, request);
  return request;
}

export async function ensureAllRacesLoaded() {
  if (panelState.allRacesFullyLoaded) return panelState.allRaces;
  if (panelState.allRacesLoadPromise) return panelState.allRacesLoadPromise;

  panelState.allRacesLoadPromise = fetchAllRows(() => supabase
    .from('races')
    .select('*')
    .order('id'), 2000)
    .then(rows => {
      panelState.allRaces = sortRaces(rows);
      loadedRaceYears.clear();
      rows.forEach(race => {
        const year = Number(race.year);
        if (Number.isInteger(year)) loadedRaceYears.add(year);
      });
      panelState.allRacesFullyLoaded = true;
      return panelState.allRaces;
    })
    .finally(() => { panelState.allRacesLoadPromise = null; });

  return panelState.allRacesLoadPromise;
}

export async function ensureRaceLoadedById(raceId) {
  if (!raceId) return null;
  const cached = panelState.allRaces.find(race => race.id === raceId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('races')
    .select('*')
    .eq('id', raceId)
    .maybeSingle();
  if (error) throw error;
  if (data) upsertRaceLocal(data);
  return data || null;
}

export async function loadRaces() {
  await ensureRaceYearLoaded(raceYearFromDateKey());
}

// Actualiza allRaces en memoria sin ir a Firestore
export function upsertRaceLocal(race) {
  const idx = panelState.allRaces.findIndex(r => r.id === race.id);
  if (idx >= 0) panelState.allRaces[idx] = race;
  else panelState.allRaces.push(race);
  sortRaces(panelState.allRaces);
}

export function removeRaceLocal(id) {
  const idx = panelState.allRaces.findIndex(r => r.id === id);
  if (idx >= 0) panelState.allRaces.splice(idx, 1);
}

// ── Sidebar: jornadas del día ─────────────────────────────────────
let sidebarRequest = 0;
export async function loadSidebar() {
  const request = ++sidebarRequest, dateKey = panelState.currentDateKey;
  const list = document.getElementById('sidebarList');
  list._featuredMount = null;
  list.innerHTML = '<div class="u-p-100 u-fs-2 u-c-dim">Cargando…</div>';

  try {
    const days = await loadPanelAgendaDay(dateKey);
    if (request !== sidebarRequest) return;
    panelState.currentDayRaceIds = new Set(days.map(d=>d.raceId).filter(Boolean));
    renderRoadPanelAgenda(list,days,dateKey,{onRaceDay:openEditor,onPendingRace:createNewRaceDay});

    mountFeaturedEditor(supabase,list,dateKey);
  } catch (err) {
    if (request !== sidebarRequest) return;
    console.error(err);
    list.innerHTML = `<div class="u-p-100 u-c-error u-fs-2">Error al cargar</div>`;
  }
}

export async function loadPanelAgendaDay(dateKey) {
    const [, { data: daysData, error }] = await Promise.all([
      ensureRaceYearLoaded(raceYearFromDateKey(dateKey)),
      supabase
        .from('race_days')
        .select('*')
        .eq('dateKey', dateKey),
    ]);
    if (error) throw error;
    let days = daysData || [];

    annotateDoubleSectors(days);

    // Enriquecer con datos de carrera
    days = days.map(rd => ({
      ...rd,
      _race: panelState.allRaces.find(r => r.id === rd.raceId) || {},
    }));

    // Ordenar
    days.sort((a, b) => {
      // Dos Campeonatos Nacionales: orden por país → línea/CRI → categoría
      // (mismo orden que el feed /resultados/ y Hoy/Mes; el rd da el primaryType).
      const cn = compareChampionships(a._race, a, b._race, b);
      if (cn != null && cn !== 0) return cn;
      const diff = uciRankSimple(a._race.uciCategory) - uciRankSimple(b._race.uciCategory);
      if (diff !== 0) return diff;
      const genDiff = genderRank(a._race.gender) - genderRank(b._race.gender);
      if (genDiff !== 0) return genDiff;
      const tA = tsSeconds(a.neutralStartTimeUtc) ?? 999999;
      const tB = tsSeconds(b.neutralStartTimeUtc) ?? 999999;
      if (tA !== tB) return tA - tB;
      return (a._race.name || '').localeCompare(b._race.name || '');
    });

    return days;
}

// Grupo de filas de agenda: una superficie con filas separadas por filete.
function agendaGroup(list) {
  const group = document.createElement('div');
  group.className = 'panel-list';
  list.appendChild(group);
  return group;
}

export function renderRoadPanelAgenda(list,days,dateKey,{onRaceDay,onPendingRace,onlyFirstStageDay=false,hideStageLabel=false}) {
    list.innerHTML = '';
    const dayGroup = agendaGroup(list);

    const visibleDays = onlyFirstStageDay
      ? days.filter(rd => rd._race?.raceFormat !== 'stage_race' || rd._race.startDate === dateKey)
        .filter((rd, index, firstDayRows) => !rd.raceId
          || firstDayRows.findIndex(candidate => candidate.raceId === rd.raceId) === index)
      : days;

    visibleDays.forEach(rd => {
      const item = document.createElement('div');
      item.className = 'sidebar-item' + (onRaceDay === openEditor && rd.id === panelState.currentRaceDayId ? ' active' : '');
      item.dataset.raceId = rd.raceId;
      item.dataset.raceName = rd._race.name || 'Sin carrera';

      const cc    = effectiveCountryCode(rd, rd._race);
      const flag  = countryFlag(cc);
      const name  = rd._race.name || rd._race.abbrev || 'Sin carrera';
      const stage = hideStageLabel ? '' : stageLabel(rd.stageNumber, rd._stageSuffix);
      const catBadge  = categoryBadge(rd._race.uciCategory, rd._race.gender === 'female' && !nameImpliesFemale(rd._race.name || ''));
      const statusBadge = rd.isRestDay
        ? '<span class="badge badge--type-rest">Descanso</span>'
        : rd.isCancelledDay
          ? '<span class="badge badge--type-cancelled">Cancelada</span>'
          : '';

      item.innerHTML = panelAgendaItemHtml({flagHtml:flag,name,detailHtml:esc(stage),badgesHtml:catBadge+(statusBadge ? ' '+statusBadge : '')});
      item.addEventListener('click', () => onRaceDay(rd.id,rd.raceId));
      dayGroup.appendChild(item);
    });

    // Carreras sin jornada asignada en este día
    const pending = getRaceSuggestionsForDate(dateKey,new Set(days.map(d=>d.raceId)))
      .filter(race => !onlyFirstStageDay || race.raceFormat !== 'stage_race' || race.startDate === dateKey);
    if (pending.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'sidebar-pending-divider';
      divider.textContent = 'Por añadir';
      list.appendChild(divider);
      const pendingGroup = agendaGroup(list);

      pending.forEach(race => {
        const flag = countryFlag(race.countryCode);
        const catBadge = categoryBadge(race.uciCategory, race.gender === 'female' && !nameImpliesFemale(race.name || ''));
        const item = document.createElement('div');
        item.className = 'sidebar-item sidebar-item--pending';
        item.dataset.raceId = race.id;
        item.dataset.raceName = race.name;
        item.innerHTML = `
          <span class="sidebar-item__flag">${race.hideFlag ? '' : flag}</span>
          <div class="sidebar-item__info">
            <div class="sidebar-item__name">${race.name}</div>
            <div class="sidebar-item__badges">${catBadge}</div>
          </div>
        `;
        item.addEventListener('click', () => onPendingRace(race.id));
        pendingGroup.appendChild(item);
      });
    } else if (!dayGroup.children.length) {
      list.innerHTML = `<div class="panel-empty u-px-100">No hay jornadas para este día</div>`;
    }

}
