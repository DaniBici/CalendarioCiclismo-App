// ─────────────────────────────────────────────────────────────────
//  STARTLIST-DATA — carga y preparación de una lista de inscritos
//  Fuente única para la página /inscritos/ (inscritos.js) y para la página
//  sin interfaz que generan las apps (inscritos-pdf-app.js).
// ─────────────────────────────────────────────────────────────────

import { teamHeaderColors } from '../team-appearance.js';
import { supabase, isNoTeamPlaceholderTeam, embeddedId, orEqFilter, pickByPreference } from '../shared.js';
import { t, getLang } from '../i18n.js';
import { isAbandonIrm } from '../results/uci-irm.js';

// Resuelve la carrera por id (el de la URL o el que incrusta el build en la
// página pre-renderizada) o por slug en una sola consulta (en EN, se prefiere
// slugEn).
export async function resolveStartlistRace({ raceId, slug, isEn }) {
  const id = raceId || (slug ? embeddedId('race-id') : null);
  if (id) {
    const { data } = await supabase.from('races').select('*').eq('id', id).maybeSingle();
    if (data || raceId) return data || null;
  }
  if (!slug) return null;
  const columns = isEn ? ['slugEn', 'slug'] : ['slug'];
  const { data } = await supabase.from('races').select('*').or(orEqFilter(columns, slug)).limit(4);
  return pickByPreference(data, columns, slug);
}

/**
 * Carga equipos, corredores, colores de temporada y abandonos de la carrera.
 * Devuelve null si no hay equipos inscritos.
 */
export async function loadStartlistData(race) {
  const raceId = race.id;

  // ── Fase A: todo lo que depende SOLO de raceId ──
  // race_days (hero), startlist_teams con su equipo global y la temporada
  // embebidos, corredores resueltos y las etapas con resultados in-house
  // (race_uci_stages, para detectar abandonos) son independientes entre sí →
  // un único round-trip.
  const teamSelect = race.year ? '*,team:teams(*,team_seasons(*))' : '*,team:teams(*)';
  let teamsQuery = supabase.from('startlist_teams')
    .select(teamSelect)
    .eq('raceId', raceId)
    .order('sortOrder', { ascending: true });
  if (race.year) teamsQuery = teamsQuery.eq('team.team_seasons.year', race.year);
  const [raceDaysRes, teamsRes, uciStagesRes, ridersRes] = await Promise.all([
    supabase.from('race_days')
      .select('dateKey, isRestDay')
      .eq('raceId', raceId)
      .eq('editorialStatus', 'published')
      .order('dateKey', { ascending: true }),
    teamsQuery,
    supabase.from('race_uci_stages')
      .select('id, stageNumber, rowCount')
      .eq('raceId', raceId)
      .eq('classKind', 'stage'),
    // Vista resuelta: nombre/country canónicos de riders_men/women cuando hay link,
    // fallback al snapshot del propio startlist_riders cuando no. Los corredores
    // de la carrera son los de sus equipos inscritos (teamId → startlist_teams).
    supabase.from('startlist_riders_resolved')
      .select('*')
      .eq('raceId', raceId)
      .not('teamId', 'is', null)
      .order('dorsal', { ascending: true }),
  ]);
  if (teamsRes.error || !teamsRes.data || teamsRes.data.length === 0) return null;

  // Equipo global y temporada salen del embebido; la fila de startlist queda limpia.
  const globalTeamById = {};
  const seasonRows = [];
  const teams = teamsRes.data.map(({ team, ...tm }) => {
    if (team) {
      const { team_seasons: seasons, ...base } = team;
      globalTeamById[base.id] = base;
      seasonRows.push(...(seasons || []));
    }
    return tm;
  });

  // ── Fase B: filas de resultados UCI para tachar abandonos (dependen de las
  // etapas de la fase A).
  const stageRows = (uciStagesRes.data || []).filter(s => (s.rowCount || 0) > 0);
  const outRowsRes = stageRows.length > 0
    ? await supabase.from('race_uci_results')
        .select('globalRiderId, irm, stageRef')
        .in('stageRef', stageRows.map(s => s.id))
        .not('globalRiderId', 'is', null)
        .not('irm', 'is', null)
    : { data: [] };
  const riders = ridersRes.data || [];

  // Colores de temporada para los equipos presentes en esta lista.
  if (race.year) {
    const VISUAL = ['name','nameAliases','category','gender','headerBg','headerText',
                    'badgeTorsoCenter','badgeTorsoSides','badgeInnerCircle','badgeShorts'];
    seasonRows.forEach(s => {
      const base = globalTeamById[s.teamId] || (s.name ? {
        id: s.teamId,
        name: s.name,
        nameAliases: null,
        headerBg: '#1f2937',
        headerText: '#ffffff',
        badgeTorsoCenter: '#ffffff',
        badgeTorsoSides: '#000000',
        badgeInnerCircle: null,
        badgeShorts: '#000000',
      } : null);
      if (!base) return;
      VISUAL.forEach(k => { if (s[k] != null) base[k] = s[k]; });
      globalTeamById[s.teamId] = base;
    });
  }

  // Nombre a mostrar: si hay match, prevalece el nombre del equipo global (tabla teams)
  // sobre el `teamName` importado. Aplica tanto en web como en PDF.
  teams.forEach(tm => {
    const g = tm.teamId ? globalTeamById[tm.teamId] : null;
    tm.displayName = (g && g.name) ? g.name : tm.teamName;
  });

  // Group riders by teamId
  const ridersByTeam = {};
  riders.forEach(r => {
    if (!ridersByTeam[r.teamId]) ridersByTeam[r.teamId] = [];
    ridersByTeam[r.teamId].push(r);
  });

  // Corredores sin dorsal (dorsal=0) al final de su equipo
  Object.values(ridersByTeam).forEach(teamRiders => {
    teamRiders.sort((a, b) => {
      const da = a.dorsal || 0;
      const db = b.dorsal || 0;
      if (da === 0 && db === 0) return 0;
      if (da === 0) return 1;
      if (db === 0) return -1;
      return da - db;
    });
  });

  // Orden de equipos por el dorsal del PRIMER corredor (mínimo dorsal > 0):
  // las startlists entran al panel en cualquier orden (sortOrder = inserción),
  // así que el orden canónico lo imponen los dorsales en el render — este
  // array lo comparten web y PDF. Equipos sin ningún dorsal → al final,
  // conservando sortOrder entre ellos (startlist sin dorsales = orden del panel).
  const firstDorsal = {};
  teams.forEach(tm => {
    const first = (ridersByTeam[tm.id] || [])[0];
    firstDorsal[tm.id] = (first && first.dorsal > 0) ? first.dorsal : Infinity;
  });
  teams.sort((a, b) => {
    const da = firstDorsal[a.id], db = firstDorsal[b.id];
    if (da !== db) return da < db ? -1 : 1;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  // ── Abandonos in-house (resultados UCI) ──────────────────────────
  // Solo en carreras donde recogemos resultados propios (tablas race_uci_*):
  // tachamos a quien ya NO sigue en carrera. Señal = campo `irm` de ABANDONO REAL
  // (DNF/DNS/OTL/DSQ/ABD vía isAbandonIrm) de race_uci_results — NO un código de
  // ruido como 'LAP' (doblada), que la UCI cuelga a veces de corredores en carrera
  // (incl. la propia ganadora; ver resultados.js). Se mira la fila de la etapa MÁS
  // RECIENTE del corredor (un abandono en la etapa 3 aparece con rank normal en
  // las 1-2; lo que manda es su última etapa con fila). Solo se consideran los
  // eventos de resultado de ETAPA (classKind='stage'); la "Stage General
  // Classification" es el GC acumulado, no sirve para detectar abandonos. Cruce
  // por globalRiderId (lo expone startlist_riders_resolved). En vivo desde
  // cliente: refleja el último volcado del cron sin paso de build.
  const riderOutMap = new Map();   // globalRiderId → { irm, stageNumber }
  if (stageRows.length > 0) {
    const stageNumById = new Map(stageRows.map(s => [s.id, s.stageNumber]));
    // Por corredor, quedarse con la fila de mayor stageNumber (null = -1, va
    // primero y lo pisa cualquier etapa numerada). Esa es su "última palabra".
    // Solo cuentan los abandonos reales: un 'LAP' (u otro código de ruido) NO tacha.
    (outRowsRes.data || []).filter(row => isAbandonIrm(row.irm)).forEach(row => {
      const sn = stageNumById.has(row.stageRef) ? stageNumById.get(row.stageRef) : null;
      const prev = riderOutMap.get(row.globalRiderId);
      const snv = sn == null ? -1 : sn;
      const prevv = prev == null ? -2 : (prev.stageNumber == null ? -1 : prev.stageNumber);
      if (!prev || snv >= prevv) riderOutMap.set(row.globalRiderId, { irm: row.irm, stageNumber: sn });
    });
  }

  return {
    raceDays: raceDaysRes.data || [],
    teams,
    riders,
    ridersByTeam,
    globalTeamById,
    riderOutMap,
    // Los estados sin equipo no cuentan como formaciones: sus corredores sí
    // suman en totalRiders.
    totalTeams: teams.filter(tm => !isNoTeamPlaceholderTeam(tm)).length,
    totalRiders: riders.length,
  };
}

function formatDateRange(startDk, endDk) {
  if (!startDk) return '';
  const [sy, sm, sd] = startDk.split('-').map(Number);
  const [ey, em, ed] = (endDk || startDk).split('-').map(Number);
  const startD = new Date(sy, sm - 1, sd);
  const endD   = new Date(ey, em - 1, ed);
  const fmtDay = d => d.getDate();
  const fmtMon = d => d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'es-ES', { month: 'short' });
  if (startDk === (endDk || startDk)) {
    return `${fmtDay(startD)} ${fmtMon(startD)}`;
  }
  if (sm === em && sy === ey) {
    return `${fmtDay(startD)}–${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  if (sy === ey) {
    return `${fmtDay(startD)} ${fmtMon(startD)} – ${fmtDay(endD)} ${fmtMon(endD)}`;
  }
  return `${fmtDay(startD)} ${fmtMon(startD)} ${sy} – ${fmtDay(endD)} ${fmtMon(endD)} ${ey}`;
}

// Etiqueta («Dorsales» / «Lista provisional») y detalle (fechas · categoría ·
// etapas) de la cabecera, iguales en la web y en el PDF.
export function startlistHeroInfo(race, raceDays) {
  const isStageRace = race.raceFormat !== 'one_day';
  const activeDays = (raceDays || []).filter(d => !d.isRestDay && d.dateKey);
  const firstDateKey = activeDays.length ? activeDays[0].dateKey : (race.startDate || null);
  const lastDateKey  = activeDays.length ? activeDays[activeDays.length - 1].dateKey : (race.endDate || race.startDate || null);
  const dateRange    = firstDateKey ? formatDateRange(firstDateKey, lastDateKey) : '';
  const nDays        = activeDays.length;

  const infoParts = [
    dateRange ? `${dateRange} ${race.year}` : race.year,
    race.uciCategory,
    isStageRace && nDays ? t(nDays !== 1 ? 'stage.stagesCount_other' : 'stage.stagesCount_one', { n: nDays }) : '',
  ].filter(Boolean).join(' · ');

  const heroLabel = race.startlistProvisional
    ? t('startlist.provisional')
    : (race.gender === 'female' ? t('startlist.labelFemale') : t('startlist.label'));
  const heroSubline = `<span style="color:var(--text)">${heroLabel}</span>${infoParts ? ' · ' + infoParts : ''}`;
  return { heroLabel, infoParts, heroSubline };
}

// Opciones de generateStartlistPDF a partir de la carga anterior.
export function startlistPdfOptions(race, data, hero) {
  return {
    race,
    teams: data.teams,
    ridersByTeam: data.ridersByTeam,
    heroLabel: hero.heroLabel,
    heroSubline: hero.heroSubline,
    totalTeams: data.totalTeams,
    totalRiders: data.totalRiders,
    // Colores editoriales de cabecera (solo equipos con ficha global).
    teamColors: Object.fromEntries(data.teams.map(team => {
      const gTeam = team.teamId ? data.globalTeamById[team.teamId] : null;
      return [team.id, gTeam ? teamHeaderColors(gTeam) : null];
    })),
    riderOutMap: data.riderOutMap,
  };
}
