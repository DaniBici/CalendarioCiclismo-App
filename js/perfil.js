import { supabase, esc, stageLabel } from './shared.js';
import { t } from './i18n.js';
import { buildElevationProfileSVG }  from './elevation-profile.js';
import { computeClimbStats, effectiveSummitAlt } from './climb-detection.js';

const params  = new URLSearchParams(location.search);
const content = document.getElementById('perfilContent');
const idInput = document.getElementById('rdIdInput');
const loadBtn = document.getElementById('loadBtn');

const SPRINT_TYPES  = new Set(['intermediate_sprint', 'bonus_sprint']);
const TERRAIN_TYPES = new Set(['cobblestone', 'sterrato']);
const TERRAIN_LABELS = new Proxy({}, { get(_, key) { return t(`terrain.${key}`) || key; } });

// ── Auth gate ─────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', () => supabase.auth.signOut());
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user)
    window.location.href = CONFIG.basePath + '/panel/index.html';
});

supabase.auth.getSession().then(({ data: { session } }) => {
  if (!session?.user) {
    window.location.href = CONFIG.basePath + '/panel/index.html';
    return;
  }
  init();
});

function init() {
  const initId = params.get('id') || params.get('slug');
  if (initId) {
    idInput.value = initId;
    loadProfile(initId);
  } else {
    content.innerHTML = `<p class="perf-empty">Introduce un ID o slug de jornada arriba,<br>o añade <code>?id=…</code> a la URL.</p>`;
  }

  loadBtn.addEventListener('click', () => {
    const val = idInput.value.trim();
    if (!val) return;
    const url = new URL(location.href);
    url.searchParams.set('id', val);
    history.replaceState(null, '', url);
    loadProfile(val);
  });
  idInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadBtn.click(); });
}

// ── Load ──────────────────────────────────────────────────────────
async function loadProfile(idOrSlug) {
  content.innerHTML = `<p class="perf-empty">Cargando…</p>`;

  const cols = 'id,raceId,dateKey,stageNumber,isRestDay,startLocation,finishLocation,distanceKm,primaryType,secondaryType,elevationProfile,profileSummits,profileWaypoints';

  let { data: rd, error } = await supabase.from('race_days').select(cols).eq('id', idOrSlug).maybeSingle();
  if (!rd && !error)
    ({ data: rd, error } = await supabase.from('race_days').select(cols).eq('slug', idOrSlug).maybeSingle());

  if (error) { content.innerHTML = `<p class="perf-empty">Error: ${esc(error.message)}</p>`; return; }
  if (!rd)   { content.innerHTML = `<p class="perf-empty">Jornada no encontrada.</p>`; return; }

  let race = null;
  if (rd.raceId) {
    const { data: r } = await supabase.from('races').select('name,year,colorHex').eq('id', rd.raceId).maybeSingle();
    race = r;
  }

  render(rd, race);
}

// ── Render ────────────────────────────────────────────────────────
function render(rd, race) {
  const profile   = rd.elevationProfile ?? null;
  const summits   = rd.profileSummits   ?? [];
  const waypoints = rd.profileWaypoints ?? [];
  const isTimeTrial = rd.primaryType === 'itt' || rd.primaryType === 'ttt';
  const sprints   = isTimeTrial
    ? waypoints.filter(w => w.type === 'intermediate_split')
    : waypoints.filter(w => SPRINT_TYPES.has(w.type));
  const terrain   = waypoints.filter(w => TERRAIN_TYPES.has(w.type));

  // Title
  let titleParts = [];
  if (race) titleParts.push(`${esc(race.name)} ${race.year ?? ''}`);
  if (!rd.isRestDay && rd.stageNumber != null)
    titleParts.push(esc(stageLabel(rd.stageNumber)));
  else if (rd.dateKey)
    titleParts.push(esc(rd.dateKey));

  const title  = titleParts.join(' — ');
  const metaKm = profile ? `${profile.distance} km` : 'Sin GPX';
  const metaEl = profile
    ? `+${fmt(profile.elevationGain)} m  /  −${fmt(profile.elevationLoss)} m  ·  máx ${fmt(profile.maxElevation)} m`
    : '';

  // SVG
  const svgW = Math.min(window.innerWidth - 80, 1280);
  const { svg: svgStr } = buildElevationProfileSVG({
    profile,
    summits,
    waypoints,
    startLocation:  rd.startLocation  ?? '',
    finishLocation: rd.finishLocation ?? '',
    width:  svgW,
    height: 440,
    color:  race?.colorHex || null,
  });

  const profilePts = profile?.points;
  const summitsBoxHtml = summits.length
    ? `<div class="perf-annot-box">
          <p class="perf-section-title" style="margin-bottom:0.5rem">Puertos (${summits.length})</p>
          ${summits.map(s => {
            const km     = s.km != null ? `${s.km} km` : '?';
            const altRaw = effectiveSummitAlt(s, profilePts);
            const altStr = altRaw != null ? fmt(altRaw) + ' m' : null;
            const cat    = (s.category && s.category !== 'M') ? `Cat. ${s.category}` : null;
            let climbStr = null;
            if (s.startKm != null && s.km != null && profilePts?.length) {
              const stats = computeClimbStats(profilePts, s.startKm, s.km, s.altitude ?? null);
              if (stats) {
                const sign = stats.avgGradient >= 0 ? '' : '−';
                climbStr = `${stats.lengthKm} km · ${sign}${Math.abs(stats.avgGradient).toFixed(1)}%`;
              }
            }
            const parts  = [s.name?.trim() || null, climbStr, altStr, cat].filter(Boolean);
            return `<div class="perf-annot-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const sprintBoxTitle = isTimeTrial ? 'Puntos intermedios' : 'Sprints';
  const sprintsBoxHtml = sprints.length
    ? `<div class="perf-annot-box">
          <p class="perf-section-title" style="margin-bottom:0.5rem">${sprintBoxTitle} (${sprints.length})</p>
          ${sprints.map(w => {
            const km   = w.km != null ? `${w.km} km` : '?';
            const type = isTimeTrial
              ? null
              : (w.type === 'bonus_sprint' ? 'Bonificación' : 'Sprint Int.');
            const name = w.name?.trim() || null;
            const parts = [name, type].filter(Boolean);
            return `<div class="perf-annot-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const terrainBoxHtml = terrain.length
    ? `<div class="perf-annot-box">
          <p class="perf-section-title" style="margin-bottom:0.5rem">Sectores (${terrain.length})</p>
          ${terrain.map(w => {
            const km     = w.km != null ? `${w.km} km` : '?';
            const label  = (rd.primaryType === 'ribinou' && w.type === 'sterrato')
              ? t('terrain.ribinou')
              : (TERRAIN_LABELS[w.type] ?? w.type);
            const name   = w.name?.trim() || null;
            const length = w.lengthKm != null ? `${w.lengthKm} km` : null;
            const parts  = [name, label, length].filter(Boolean);
            return `<div class="perf-annot-item"><b>${km}</b>${esc(parts.join(' · '))}</div>`;
          }).join('')}
        </div>`
    : '';

  const boxCount = [summitsBoxHtml, sprintsBoxHtml, terrainBoxHtml].filter(Boolean).length;
  const keyPointsHtml = boxCount > 0
    ? `<div class="perf-section">
      <p class="perf-section-title">Puntos clave</p>
      <div class="perf-annot-grid${boxCount === 1 ? ' perf-annot-grid--single' : ''}">
        ${summitsBoxHtml}
        ${sprintsBoxHtml}
        ${terrainBoxHtml}
      </div>
    </div>`
    : '';

  content.innerHTML = `
    <div class="perf-header">
      <h1 class="perf-title">${title}</h1>
      <p class="perf-meta">${metaKm}${metaEl ? '  ·  ' + metaEl : ''}</p>
      <p class="perf-meta" style="font-size:0.75rem;color:var(--text-dim)">id: ${esc(rd.id)}</p>
    </div>

    <div class="perf-svg-wrap">${svgStr}</div>

    ${keyPointsHtml}
  `;
}

function fmt(v) {
  return v != null ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '?';
}
