// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Analítica (Google Analytics Data API)
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { getAuthHeaders } from './uploads.js';

// ═════════════════════════════════════════════════════════════════
//  ANALYTICS — Google Analytics Data API (GA4)
// ═════════════════════════════════════════════════════════════════

const GA_FN_URL = `${SUPABASE_URL}/functions/v1/ga-analytics`;
let _analyticsViewReady = false;

// Caché en memoria de respuestas GA4 por (report+rango), TTL corto: evita
// re-disparar las ~7 llamadas a la API por cada apertura de pestaña/cambio
// de rango/reapertura cuando los datos no han podido cambiar todavía, que
// agotaba la cuota de errores del servidor ("RESOURCE_EXHAUSTED").
const GA_CACHE_TTL_MS = 5 * 60 * 1000;
const _gaReportCache = new Map(); // key -> { data, ts }

// La cifra de "nuevos usuarios" es irreal en dos vistas: el mes de lanzamiento
// (abril 2026, cuando TODO visitante contaba como nuevo) y "Desde inicio web"
// (que arrastra ese pico). En esas dos vistas se oculta cualquier mención a
// nuevos usuarios; en el resto de rangos se mantiene intacta.
let _gaHideNewUsers = false;

function analyticsHidesNewUsers(dateRange) {
  const rangeValue = document.getElementById('gaDateRange')?.value;
  if (rangeValue === 'since_start') return true;
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);
  return startISO.startsWith('2026-04') && endISO.startsWith('2026-04');
}

function _gaCacheKey(report, dateRange) {
  return `${report}|${dateRange.startDate}|${dateRange.endDate}`;
}

export function setupAnalyticsView() {
  if (_analyticsViewReady) {
    return; // ya está inicializado, no recargar
  }
  _analyticsViewReady = true;

  const rangeSelect = document.getElementById('gaDateRange');
  const startInput  = document.getElementById('gaStartDate');
  const endInput    = document.getElementById('gaEndDate');
  const refreshBtn  = document.getElementById('gaRefreshBtn');

  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const now = new Date();
  [
    ['current_month', 0],
    ['prev_month', 1],
    ['month_minus_2', 2],
    ['month_minus_3', 3],
  ].forEach(([value, offset]) => {
    const opt = rangeSelect.querySelector(`option[value="${value}"]`);
    if (!opt) return;
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    opt.textContent = `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  });

  rangeSelect.addEventListener('change', () => {
    const isCustom = rangeSelect.value === 'custom';
    startInput.style.display = isCustom ? '' : 'none';
    endInput.style.display   = isCustom ? '' : 'none';
    if (!isCustom) loadAllAnalytics();
  });

  refreshBtn.addEventListener('click', () => loadAllAnalytics(true));

  startInput.addEventListener('change', () => { if (endInput.value) loadAllAnalytics(); });
  endInput.addEventListener('change', ()   => { if (startInput.value) loadAllAnalytics(); });

  loadAllAnalytics();
}

function getAnalyticsDateRange() {
  const rangeSelect = document.getElementById('gaDateRange');
  if (rangeSelect.value === 'custom') {
    return {
      startDate: document.getElementById('gaStartDate').value,
      endDate:   document.getElementById('gaEndDate').value,
    };
  }
  const days = rangeSelect.value;
  if (days === '0') return { startDate: 'today', endDate: 'today' };
  if (days === '1') return { startDate: 'yesterday', endDate: 'yesterday' };
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (days === 'last_7') {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() - 1);
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return { startDate: fmt(start), endDate: fmt(end) };
  }
  if (days === 'current_week') {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    return { startDate: fmt(monday), endDate: 'today' };
  }
  if (days === 'prev_week') {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysFromMonday - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { startDate: fmt(lastMonday), endDate: fmt(lastSunday) };
  }
  if (days === 'current_month') {
    const now = new Date();
    return { startDate: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: 'today' };
  }
  if (days === 'prev_month') {
    const now = new Date();
    return {
      startDate: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      endDate:   fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (days === 'month_minus_2' || days === 'month_minus_3') {
    const offset = days === 'month_minus_2' ? 2 : 3;
    const now = new Date();
    return {
      startDate: fmt(new Date(now.getFullYear(), now.getMonth() - offset, 1)),
      endDate:   fmt(new Date(now.getFullYear(), now.getMonth() - offset + 1, 0)),
    };
  }
  if (days === 'since_start') {
    // 6 de abril de 2026: día de lanzamiento de la web, incluido en el rango.
    // Debe coincidir con el `startDate` del endpoint público `portfolio_stats`
    // de la edge function: empezar el día 7 dejaba fuera el pico del
    // lanzamiento y el panel mostraba ~10.600 páginas vistas menos que la web.
    return { startDate: '2026-04-06', endDate: 'today' };
  }
  return { startDate: 'today', endDate: 'today' };
}

async function fetchGaReport(report, dateRange, { force = false } = {}) {
  const key = _gaCacheKey(report, dateRange);
  const cached = _gaReportCache.get(key);
  if (!force && cached && (Date.now() - cached.ts) < GA_CACHE_TTL_MS) {
    return cached.data;
  }
  const auth = await getAuthHeaders();
  const res = await fetch(GA_FN_URL, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, ...dateRange }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error desconocido');
  _gaReportCache.set(key, { data: json.data, ts: Date.now() });
  return json.data;
}

async function loadAllAnalytics(force = false) {
  const dateRange = getAnalyticsDateRange();
  const notice = document.getElementById('gaConfigNotice');

  // ¿Vista de lanzamiento (abril 2026 / "Desde inicio web")? → sin nuevos usuarios
  _gaHideNewUsers = analyticsHidesNewUsers(dateRange);
  const newUsersCard = document.getElementById('gaKpiNewUsersCard');
  if (newUsersCard) newUsersCard.style.display = _gaHideNewUsers ? 'none' : '';
  if (force) {
    // El botón "Refrescar" fuerza datos frescos; invalida solo lo cacheado
    // para este rango, no toda la caché (otros rangos ya vistos siguen sirviendo).
    for (const k of Array.from(_gaReportCache.keys())) {
      if (k.endsWith(`|${dateRange.startDate}|${dateRange.endDate}`)) _gaReportCache.delete(k);
    }
  }

  // Reset KPIs to loading state
  ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers','gaKpiPushSubs']
    .forEach(id => { document.getElementById(id).textContent = '…'; });
  ['gaPlatforms','gaPeakHour','gaTopPages','gaTopStages','gaTrafficSources','gaCountries']
    .forEach(id => { document.getElementById(id).innerHTML = '<div class="ga-placeholder">Cargando…</div>'; });

  // En rangos de ≥2 días sustituimos el gráfico de horas por uno con barras
  // por día; en rangos largos (p. ej. "Desde inicio web"), por semana ISO
  // (si no, con meses de datos el gráfico de barras diarias es ilegible).
  // La sección comparte container (gaPeakHour) pero el título y el
  // contenido cambian según el rango.
  const rangeDays = analyticsRangeDays(dateRange);
  const useWeekly = rangeDays > 60;
  const useDaily = !useWeekly && rangeDays >= 2;
  const timeSectionTitleEl = document.getElementById('gaTimeSectionTitle');
  if (timeSectionTitleEl) {
    timeSectionTitleEl.textContent = useWeekly ? 'Usuarios por semana' : (useDaily ? 'Usuarios por día' : 'Hora pico de usuarios');
  }

  // Platform report — pedido en paralelo con el resto. Además de alimentar
  // el bloque "Plataformas", sus totales por plataforma (activeUsers
  // deduplicado por GA4 sobre TODO el rango, sin trocear por fecha) los
  // reutilizan renderDailyPageviews/renderWeeklyPageviews para la leyenda:
  // sumar activeUsers día a día (o semana a semana) sobrecuenta a los
  // usuarios recurrentes, igual que le pasaba al total general.
  const platformsPromise = fetchGaReport('platforms', dateRange);

  // Cada reporte se resuelve de forma independiente: un fallo en uno no debe
  // tumbar al resto (p. ej. dimensiones custom no registradas en GA4 hacían
  // explotar TODOS los paneles porque compartían un único Promise.all).
  const reports = [
    { key: 'overview',        kpiIds: ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers'], render: renderOverviewKpis },
    useWeekly
      ? { key: 'weekly_pageviews', containerId: 'gaPeakHour', render: renderWeeklyPageviews, needsPlatformTotals: true }
      : (useDaily
        ? { key: 'daily_pageviews', containerId: 'gaPeakHour', render: renderDailyPageviews, needsPlatformTotals: true }
        : { key: 'peak_hour',       containerId: 'gaPeakHour', render: renderPeakHour }),
    { key: 'top_pages',       containerId: 'gaTopPages',       render: renderTopPages },
    { key: 'traffic_sources', containerId: 'gaTrafficSources', render: renderTrafficSources },
    { key: 'top_countries',   containerId: 'gaCountries',      render: renderCountries },
    { key: 'top_stages',      containerId: 'gaTopStages',      render: renderTopStages },
  ];

  const [settled, platformsResult] = await Promise.all([
    Promise.allSettled(reports.map(r => fetchGaReport(r.key, dateRange))),
    Promise.allSettled([platformsPromise]).then(([r]) => r),
  ]);

  const platformTotals = platformsResult.status === 'fulfilled'
    ? platformUserTotals(platformsResult.value)
    : null;

  let configMissing = false;
  settled.forEach((result, i) => {
    const { key, containerId, kpiIds, render, needsPlatformTotals } = reports[i];
    if (result.status === 'fulfilled') {
      try { render(result.value, needsPlatformTotals ? platformTotals : undefined); } catch (e) { console.error(`Render ${key} error:`, e); }
      return;
    }
    const msg = result.reason?.message || 'Error desconocido';
    console.error(`Analytics ${key} error:`, msg);
    if (msg.includes('no configuradas')) configMissing = true;
    if (kpiIds) {
      kpiIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    }
    if (containerId) {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = `<div class="ga-placeholder" style="color:var(--red)">${esc(msg)}</div>`;
    }
  });
  notice.style.display = configMissing ? 'flex' : 'none';

  if (platformsResult.status === 'fulfilled') {
    renderPlatforms(platformsResult.value);
  } else {
    console.warn('Platform report not available:', platformsResult.reason?.message);
    document.getElementById('gaPlatforms').innerHTML =
      '<div class="ga-placeholder" style="color:var(--text-dim)">Redespliega la edge function <code>ga-analytics</code> para activar el reporte de plataforma.</div>';
  }

  // Push subscriptions count — queried directly from Supabase, independent of GA
  try {
    const pushCount = await fetchPushSubscriptionsCount(dateRange);
    renderPushKpi(pushCount);
  } catch (err) {
    console.warn('Push subscriptions count error:', err.message);
    document.getElementById('gaKpiPushSubs').textContent = '—';
  }
}

function analyticsRangeDays(dateRange) {
  const start = gaDateToISO(dateRange.startDate);
  const end   = gaDateToISO(dateRange.endDate);
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end   + 'T00:00:00Z');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// ── Push subscriptions KPI ───────────────────────────────────────
function gaDateToISO(gaDate) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(gaDate)) return gaDate;
  if (gaDate === 'today') return new Date().toISOString().slice(0, 10);
  if (gaDate === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  }
  const m = gaDate.match(/^(\d+)daysAgo$/);
  if (m) { const d = new Date(); d.setDate(d.getDate() - Number(m[1])); return d.toISOString().slice(0, 10); }
  return gaDate;
}

async function fetchPushSubscriptionsCount(dateRange) {
  const start = gaDateToISO(dateRange.startDate) + 'T00:00:00.000Z';
  const end   = gaDateToISO(dateRange.endDate)   + 'T23:59:59.999Z';
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .gte('"createdAt"', start)
    .lte('"createdAt"', end);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function renderPushKpi(count) {
  document.getElementById('gaKpiPushSubs').textContent = formatNumber(count);
}

// ── Helpers para extraer datos de la respuesta GA ────────────────
function gaMetricValue(row, idx) {
  return row?.metricValues?.[idx]?.value || '0';
}

function gaDimensionValue(row, idx) {
  return row?.dimensionValues?.[idx]?.value || '(no definido)';
}

function formatNumber(n) {
  return Number(n).toLocaleString('es-ES');
}

function formatDuration(seconds) {
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function formatPercent(val) {
  return (Number(val) * 100).toFixed(1) + '%';
}

// ── Render KPI overview ──────────────────────────────────────────
function renderOverviewKpis(data) {
  const row = data?.rows?.[0];
  if (!row) {
    ['gaKpiUsers','gaKpiPageviews','gaKpiNewUsers']
      .forEach(id => { document.getElementById(id).textContent = '0'; });
    return;
  }
  document.getElementById('gaKpiUsers').textContent    = formatNumber(gaMetricValue(row, 0));
  document.getElementById('gaKpiPageviews').textContent = formatNumber(gaMetricValue(row, 2));
  document.getElementById('gaKpiNewUsers').textContent  = formatNumber(gaMetricValue(row, 5));
}

// ── Render platforms (horizontal bars + metric cards) ────────────
// Totales de activeUsers por plataforma, deduplicados por GA4 sobre TODO
// el rango (report 'platforms', dimensión solo `platform`, sin fecha) — a
// diferencia de sumar activeUsers día a día, que sobrecuenta usuarios
// recurrentes. Usado por la leyenda del gráfico de barras (día/semana).
function platformUserTotals(data) {
  const rows = data?.rows || [];
  const totals = { web: 0, ios: 0, android: 0 };
  for (const row of rows) {
    const key = (gaDimensionValue(row, 0) || '').toLowerCase();
    if (key in totals) totals[key] = Number(gaMetricValue(row, 0));
  }
  return totals;
}

function renderPlatforms(data) {
  const container = document.getElementById('gaPlatforms');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const totalUsers = rows.reduce((sum, r) => sum + Number(gaMetricValue(r, 0)), 0);
  const platformLabels = { web: 'Web', ios: 'iOS', android: 'Android' };
  const platformColors = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Stacked bar with inline labels
  let html = '<div class="ga-stacked-bar">';
  for (const row of rows) {
    const platform = gaDimensionValue(row, 0);
    const key      = platform.toLowerCase();
    const users    = Number(gaMetricValue(row, 0));
    const pct      = totalUsers > 0 ? (users / totalUsers * 100) : 0;
    const label    = platformLabels[key] || platform;
    const color    = platformColors[key] || 'var(--accent)';
    const text     = pct >= 8 ? `<span class="ga-stacked-label">${esc(label)} ${pct.toFixed(1)}%</span>` : '';
    html += `<div class="ga-stacked-segment" data-platform="${key}" style="width:${pct}%;background:${color};min-width:${pct > 0 ? 3 : 0}px" data-tip="${esc(label)} · ${pct.toFixed(1)}%">${text}</div>`;
  }
  html += '</div>';

  // Per-platform metric cards (full color)
  html += '<div class="ga-platform-cards">';
  for (const row of rows) {
    const platform  = gaDimensionValue(row, 0);
    const key       = platform.toLowerCase();
    const label     = platformLabels[key] || platform;
    const color     = platformColors[key] || 'var(--accent)';
    const users    = formatNumber(gaMetricValue(row, 0));
    const newUsersMetric = _gaHideNewUsers ? '' :
      `<div class="ga-platform-card__metric"><span class="ga-platform-card__val">${formatNumber(gaMetricValue(row, 3))}</span><span class="ga-platform-card__lbl">Nuevos</span></div>`;
    html += `<div class="ga-platform-card" data-platform="${key}" style="background:${color};border-color:${color}">
      <div class="ga-platform-card__name">${esc(label)}</div>
      <div class="ga-platform-card__metrics">
        <div class="ga-platform-card__metric"><span class="ga-platform-card__val">${users}</span><span class="ga-platform-card__lbl">Usuarios</span></div>
        ${newUsersMetric}
      </div>
    </div>`;
  }
  html += '</div>';

  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-stacked-bar'));
}

function initStackedTooltip(bar) {
  if (!bar) return;
  let tip = document.getElementById('gaStackedTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'gaStackedTip';
    tip.className = 'ga-tooltip';
    document.body.appendChild(tip);
  }
  bar.addEventListener('mousemove', e => {
    const seg = e.target.closest('[data-tip]');
    if (!seg) return;
    tip.textContent = seg.dataset.tip || '';
    tip.style.left = e.clientX + 'px';
    tip.style.top  = e.clientY + 'px';
    tip.classList.add('visible');
  });
  bar.addEventListener('mouseleave', () => tip.classList.remove('visible'));
}

// ── Render peak hour chart ───────────────────────────────────────
// Filas (hour, platform) → mapa por hora con segmentos apilados por plataforma.
function renderPeakHour(data) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  const byHour = new Map();
  for (const row of rows) {
    const h = Number(gaDimensionValue(row, 0));
    const platform = (gaDimensionValue(row, 1) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 0));
    if (!byHour.has(h)) byHour.set(h, { web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byHour.get(h);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  let peakH = 0;
  let maxUsers = 0;
  for (const [h, b] of byHour) {
    if (b.total > maxUsers) { maxUsers = b.total; peakH = h; }
  }
  const peakHStr = String(peakH).padStart(2, '0');

  let html = `<div class="ga-peak-summary">Pico: <strong>${peakHStr}:00 – ${peakHStr}:59</strong> con <strong>${formatNumber(maxUsers)}</strong> usuarios</div>`;
  html += '<div class="ga-hour-chart">';
  for (let h = 0; h < 24; h++) {
    const bucket = byHour.get(h) || { web: 0, ios: 0, android: 0, total: 0 };
    const pct = maxUsers > 0 ? (bucket.total / maxUsers * 100) : 0;
    const isPeak = h === peakH && bucket.total > 0;

    const tipParts = [`${String(h).padStart(2,'0')}:00 – ${String(h).padStart(2,'0')}:59`, `Total ${formatNumber(bucket.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (bucket[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(bucket[key])}`);
    }
    const tip = tipParts.join(' · ');

    // Segmentos apilados de abajo arriba: web → ios → android.
    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!bucket[key]) continue;
      const segPct = bucket.total > 0 ? (bucket[key] / bucket.total * 100) : 0;
      segments += `<div class="ga-hour-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-hour-bar${isPeak ? ' ga-hour-bar--peak' : ''}" data-tip="${esc(tip)}">
      <div class="ga-hour-fill" style="height:${pct}%">${segments}</div>
      <div class="ga-hour-label">${h}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-hour-chart'));
}

// ── Render daily users chart (rango ≥ 2 días) ────────────────────
// Barra apilada por día: web (accent) + iOS (orange) + Android (green).
// Usa activeUsers (usuarios), no screenPageViews (visitas) — un mismo
// usuario que ve varias páginas cuenta 1 vez, no N.
// `platformTotals`: { web, ios, android } de activeUsers deduplicado por
// GA4 sobre TODO el rango (ver platformUserTotals) — sustituye a la suma
// naive día a día en la leyenda, que sobrecuenta usuarios recurrentes.
function renderDailyPageviews(data, platformTotals) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const dateRange = getAnalyticsDateRange();
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Filas (date, platform) → mapa por fecha con segmentos por plataforma.
  // Métrica: activeUsers (índice 1; índice 0 es screenPageViews, sin usar aquí).
  const byDate = new Map();
  for (const row of rows) {
    const ga = gaDimensionValue(row, 0);  // YYYYMMDD
    const iso = ga.length === 8 ? `${ga.slice(0,4)}-${ga.slice(4,6)}-${ga.slice(6,8)}` : ga;
    const platform = (gaDimensionValue(row, 1) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 1));
    if (!byDate.has(iso)) byDate.set(iso, { web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byDate.get(iso);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  // Continuidad: relleno de huecos.
  const days = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end   = new Date(endISO   + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const bucket = byDate.get(iso) || { web: 0, ios: 0, android: 0, other: 0, total: 0 };
    days.push({ iso, ...bucket });
  }

  const totals = { web: 0, ios: 0, android: 0, total: 0 };
  let peak = days[0];
  for (const day of days) {
    totals.web     += day.web;
    totals.ios     += day.ios;
    totals.android += day.android;
    totals.total   += day.total;
    if (day.total > peak.total) peak = day;
  }
  const avg = days.length ? Math.round(totals.total / days.length) : 0;
  const maxViews = peak.total;

  // Leyenda: preferir los totales deduplicados de GA4 (platformTotals) sobre
  // la suma día a día (totals), que sobrecuenta usuarios recurrentes.
  const legendTotals = platformTotals || totals;

  const fmtDay = iso => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  };
  const fmtDayLong = iso => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  };

  // Densidad de etiquetas: máx 12 visibles.
  const labelStep = Math.max(1, Math.ceil(days.length / 12));

  let html = `<div class="ga-peak-summary">Media diaria: <strong>${formatNumber(avg)}</strong> · Pico: <strong>${fmtDay(peak.iso)}</strong> (${formatNumber(peak.total)})</div>`;

  // Leyenda
  html += '<div class="ga-day-legend">';
  for (const key of PLATFORM_ORDER) {
    if (!legendTotals[key]) continue;
    html += `<div class="ga-day-legend__item"><span class="ga-day-legend__swatch" style="background:${PLATFORM_COLORS[key]}"></span>${PLATFORM_LABELS[key]} <span class="ga-day-legend__val">${formatNumber(legendTotals[key])}</span></div>`;
  }
  html += '</div>';

  html += '<div class="ga-day-chart">';
  days.forEach((day, idx) => {
    const totalPct = maxViews > 0 ? (day.total / maxViews * 100) : 0;
    const showLabel = idx % labelStep === 0 || idx === days.length - 1;
    const tipParts = [fmtDayLong(day.iso), `Total ${formatNumber(day.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (day[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(day[key])}`);
    }
    const tip = tipParts.join(' · ');

    // Segmentos apilados de abajo arriba: web → ios → android.
    // Posicionados con `bottom` absoluto dentro del stack, donde el stack
    // mide el % correspondiente al día respecto al pico del rango.
    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!day[key]) continue;
      const segPct = day.total > 0 ? (day[key] / day.total * 100) : 0;
      segments += `<div class="ga-day-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-day-bar" data-tip="${esc(tip)}">
      <div class="ga-day-bar__col">
        <div class="ga-day-stack" style="height:${totalPct}%">${segments}</div>
      </div>
      <div class="ga-day-label">${showLabel ? fmtDay(day.iso) : ''}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-day-chart'));
}

// ── Semana ISO-8601 (lunes-domingo) de una fecha UTC ─────────────
function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esa semana ISO
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const weekNum = Math.round((d - week1Monday) / 604800000) + 1;
  // Lunes de la semana ISO de `date` (no del jueves usado para el cálculo del año/número).
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - dayNum);
  return { isoYear, weekNum, monday };
}

// ── Render weekly users chart (rangos largos, p. ej. "Desde inicio web") ─
// Mismo lenguaje visual que renderDailyPageviews (barras apiladas por
// plataforma) pero agregado por semana ISO — con meses de datos, una barra
// por día es ilegible. Incluye la semana en curso (parcial) al final.
// `platformTotals`: { web, ios, android } de activeUsers deduplicado por
// GA4 sobre TODO el rango (ver platformUserTotals) — sustituye a la suma
// naive semana a semana en la leyenda, que sobrecuenta usuarios recurrentes.
function renderWeeklyPageviews(data, platformTotals) {
  const container = document.getElementById('gaPeakHour');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const dateRange = getAnalyticsDateRange();
  const startISO = gaDateToISO(dateRange.startDate);
  const endISO   = gaDateToISO(dateRange.endDate);

  const PLATFORM_ORDER  = ['web', 'ios', 'android'];
  const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android' };
  const PLATFORM_COLORS = { web: 'var(--accent)', ios: 'var(--orange)', android: 'var(--green)' };

  // Filas (isoWeek, isoYear, platform) → mapa por semana ISO con segmentos
  // por plataforma. La API de GA4 YA deduplica activeUsers dentro de cada
  // semana (igual que hace 'overview' para todo el rango) — NO se suman
  // días individuales aquí, porque activeUsers no es sumable entre días
  // (un usuario que vuelve varias veces en la semana se contaría de más).
  const byWeek = new Map(); // key "YYYY-Www" → { isoYear, weekNum, monday, web, ios, android, other, total }
  for (const row of rows) {
    const weekNum = Number(gaDimensionValue(row, 0)); // "isoWeek": "01".."53"
    const isoYear = Number(gaDimensionValue(row, 1)); // "isoYear": "2026"
    if (!weekNum || !isoYear) continue;
    // Lunes de esa semana ISO: el jueves de la semana 1 cae siempre en enero;
    // a partir de su lunes, sumamos (weekNum-1) semanas.
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
    const monday = new Date(week1Monday);
    monday.setUTCDate(monday.getUTCDate() + (weekNum - 1) * 7);
    const key = `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    const platform = (gaDimensionValue(row, 2) || '').toLowerCase();
    const users = Number(gaMetricValue(row, 1));
    if (!byWeek.has(key)) byWeek.set(key, { isoYear, weekNum, monday, web: 0, ios: 0, android: 0, other: 0, total: 0 });
    const bucket = byWeek.get(key);
    if (platform in bucket) bucket[platform] += users;
    else bucket.other += users;
    bucket.total += users;
  }

  // Continuidad: relleno de huecos, semana a semana desde el lunes de la
  // semana del inicio hasta el lunes de la semana de fin (incluye la semana
  // en curso, aunque esté parcial).
  const weeks = [];
  const startMonday = isoWeekInfo(new Date(startISO + 'T00:00:00Z')).monday;
  const endMonday   = isoWeekInfo(new Date(endISO   + 'T00:00:00Z')).monday;
  for (let m = new Date(startMonday); m <= endMonday; m.setUTCDate(m.getUTCDate() + 7)) {
    const { isoYear, weekNum, monday } = isoWeekInfo(m);
    const key = `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    const bucket = byWeek.get(key) || { isoYear, weekNum, monday, web: 0, ios: 0, android: 0, other: 0, total: 0 };
    weeks.push({ key, ...bucket });
  }

  const totals = { web: 0, ios: 0, android: 0, total: 0 };
  let peak = weeks[0];
  for (const week of weeks) {
    totals.web     += week.web;
    totals.ios     += week.ios;
    totals.android += week.android;
    totals.total   += week.total;
    if (week.total > peak.total) peak = week;
  }
  const avg = weeks.length ? Math.round(totals.total / weeks.length) : 0;
  const maxViews = peak.total;

  // Leyenda: preferir los totales deduplicados de GA4 (platformTotals) sobre
  // la suma semana a semana (totals), que sobrecuenta usuarios recurrentes.
  const legendTotals = platformTotals || totals;

  const fmtWeek = w => `Sem. ${w.weekNum}`;
  const fmtWeekLong = w => {
    const sunday = new Date(w.monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const fmtD = d => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return `Semana ${w.weekNum} (${fmtD(w.monday)} – ${fmtD(sunday)})`;
  };

  // Densidad de etiquetas: máx 14 visibles.
  const labelStep = Math.max(1, Math.ceil(weeks.length / 14));

  let html = `<div class="ga-peak-summary">Media semanal: <strong>${formatNumber(avg)}</strong> · Pico: <strong>${fmtWeek(peak)}</strong> (${formatNumber(peak.total)})</div>`;

  // Leyenda
  html += '<div class="ga-day-legend">';
  for (const key of PLATFORM_ORDER) {
    if (!legendTotals[key]) continue;
    html += `<div class="ga-day-legend__item"><span class="ga-day-legend__swatch" style="background:${PLATFORM_COLORS[key]}"></span>${PLATFORM_LABELS[key]} <span class="ga-day-legend__val">${formatNumber(legendTotals[key])}</span></div>`;
  }
  html += '</div>';

  html += '<div class="ga-day-chart">';
  weeks.forEach((week, idx) => {
    const totalPct = maxViews > 0 ? (week.total / maxViews * 100) : 0;
    const showLabel = idx % labelStep === 0 || idx === weeks.length - 1;
    const tipParts = [fmtWeekLong(week), `Total ${formatNumber(week.total)}`];
    for (const key of PLATFORM_ORDER) {
      if (week[key] > 0) tipParts.push(`${PLATFORM_LABELS[key]} ${formatNumber(week[key])}`);
    }
    const tip = tipParts.join(' · ');

    let segments = '';
    let cumulative = 0;
    for (const key of PLATFORM_ORDER) {
      if (!week[key]) continue;
      const segPct = week.total > 0 ? (week[key] / week.total * 100) : 0;
      segments += `<div class="ga-day-seg" data-platform="${key}" style="bottom:${cumulative}%;height:${segPct}%;background:${PLATFORM_COLORS[key]}"></div>`;
      cumulative += segPct;
    }

    html += `<div class="ga-day-bar" data-tip="${esc(tip)}">
      <div class="ga-day-bar__col">
        <div class="ga-day-stack" style="height:${totalPct}%">${segments}</div>
      </div>
      <div class="ga-day-label">${showLabel ? fmtWeek(week) : ''}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  initStackedTooltip(container.querySelector('.ga-day-chart'));
}

// ── Render top pages table ───────────────────────────────────────
function renderTopPages(data) {
  const container = document.getElementById('gaTopPages');
  const allRows = data?.rows || [];
  const rows = allRows.filter(r => /\/(jornada|competicion|inscritos|orden-salida|resultados|equipo|corredor|campeonatos|modal|perfil|fichajes|transfers)/.test(gaDimensionValue(r, 0))).slice(0, 15);
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos de páginas</div>'; return; }

  const maxViews = Math.max(...rows.map(r => Number(gaMetricValue(r, 0))));
  let html = `<table class="ga-table"><thead><tr><th>Página</th><th>Usuarios</th><th>Vistas</th><th>Duración</th></tr></thead><tbody>`;
  for (const row of rows) {
    const page     = esc(gaDimensionValue(row, 0));  // pagePath
    const views    = Number(gaMetricValue(row, 0));
    const users    = formatNumber(gaMetricValue(row, 1));
    const duration = formatDuration(gaMetricValue(row, 2));
    const pct      = maxViews > 0 ? (views / maxViews * 100) : 0;
    html += `<tr>
      <td class="ga-bar-cell"><span class="ga-bar" style="width:${pct}%"></span><span style="position:relative">${page}</span></td>
      <td>${users}</td><td>${formatNumber(views)}</td><td>${duration}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render top stages (apps) ─────────────────────────────────────
function renderTopStages(data) {
  const container = document.getElementById('gaTopStages');
  const rows = (data?.rows || []).slice(0, 5);
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  const maxViews = Math.max(...rows.map(r => Number(gaMetricValue(r, 0))));
  let html = `<table class="ga-table"><thead><tr><th>Etapa</th><th>Carrera</th><th>Usuarios</th><th>Vistas</th></tr></thead><tbody>`;
  for (const row of rows) {
    const raceName  = esc(gaDimensionValue(row, 1)) || '—';
    // Las pruebas de un día (clásicas, Campeonatos Nacionales) no tienen
    // etiqueta de etapa → stage_name vacío. En esos casos mostramos "Prueba
    // única" en la columna Etapa en lugar de un "—" suelto.
    const stageName = esc(gaDimensionValue(row, 0)) || 'Prueba única';
    const views     = Number(gaMetricValue(row, 0));
    const users     = formatNumber(gaMetricValue(row, 1));
    const pct       = maxViews > 0 ? (views / maxViews * 100) : 0;
    html += `<tr>
      <td class="ga-bar-cell" style="width:35%"><span class="ga-bar" style="width:${pct}%"></span><span style="position:relative">${stageName}</span></td>
      <td style="width:35%">${raceName}</td>
      <td>${users}</td><td>${formatNumber(views)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render traffic sources ───────────────────────────────────────
function renderTrafficSources(data) {
  const container = document.getElementById('gaTrafficSources');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  let html = `<table class="ga-table"><thead><tr><th>Fuente</th><th>Usuarios</th><th>Vistas</th></tr></thead><tbody>`;
  for (const row of rows) {
    const source = esc(gaDimensionValue(row, 0));
    const users  = formatNumber(gaMetricValue(row, 1));
    const views  = formatNumber(gaMetricValue(row, 3));
    html += `<tr><td>${source}</td><td>${users}</td><td>${views}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Render countries ─────────────────────────────────────────────
function renderCountries(data) {
  const container = document.getElementById('gaCountries');
  const rows = data?.rows || [];
  if (!rows.length) { container.innerHTML = '<div class="ga-placeholder">Sin datos</div>'; return; }

  let html = `<table class="ga-table"><thead><tr><th>País</th><th>Usuarios</th></tr></thead><tbody>`;
  for (const row of rows) {
    const country = esc(gaDimensionValue(row, 0));
    const users   = formatNumber(gaMetricValue(row, 0));
    html += `<tr><td>${country}</td><td>${users}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}
