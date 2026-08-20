// ─────────────────────────────────────────────────────────────────
//  BUSCAR — buscar.html
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, stageLabel, categoryBadge, initPhTooltip, jornadaUrl, raceUrl, femaleMark }
  from './shared.js';
import { hasModalData, openRaceDataModal } from './race-data-modal.js';
import { t, initI18n } from './i18n.js';

const YEAR  = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);
const MAX_RES = 5;
// Máximo de resultados en la lista combinada (carreras + corredores + etapas).
const MAX_COMBINED = 12;

// ── Datos en memoria ──────────────────────────────────────────────
let races        = [];
let raceDays     = [];
let racesWithRds = new Set();

// PostgREST aplica un tope server-side de 1.000 filas por request que un
// .limit() más alto no evita (mismo tope documentado en panel.js para
// riders_men/women). Un año natural completo de race_days ya supera las
// 1.000 filas → sin paginar, la respuesta se trunca en silencio y el corte
// no sigue la fecha (pueden faltar carreras enteras de mitad de temporada;
// bug real: el Tour de Francia 2026 desaparecía casi entero del buscador).
// Se pagina por `id` (clave única) para que el orden entre páginas sea
// estable — paginar por `dateKey` (no único) puede saltar o duplicar filas
// en el borde de cada página.
async function fetchAllRaceDays(startKey, endKey) {
  const all = [];
  const CHUNK = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('race_days').select('*')
      .eq('editorialStatus', 'published')
      .gte('dateKey', startKey).lte('dateKey', endKey)
      .order('id')
      .range(offset, offset + CHUNK - 1);
    if (error || !data?.length) break;
    all.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
  }
  return all;
}

async function loadData() {
  const [racesResult, rdData] = await Promise.all([
    supabase.from('races').select('*').eq('year', YEAR),
    fetchAllRaceDays(`${YEAR}-01-01`, `${YEAR}-12-31`)
  ]);
  races    = racesResult.data || [];
  raceDays = rdData || [];
  racesWithRds = new Set(raceDays.map(rd => rd.raceId).filter(Boolean));
}

// ── Utilidades ───────────────────────────────────────────────────
function normalize(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').trim();
}
function score(text, q) {
  const t = normalize(text), idx = t.indexOf(q);
  if (idx === -1) return 0;
  if (idx === 0) return 3;
  if (t.includes(' ' + q)) return 2;
  return 1;
}
function toDateKey(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val.toDate) return val.toDate().toISOString().slice(0, 10);
  if (val.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}
function formatDate(dk) {
  const key = toDateKey(dk);
  if (!key) return '';
  return new Date(key + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatCategory(r) { return r.raceFormat === 'one_day' ? t('stage.oneDay') : t('stage.stageTour'); }
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function phTooltipText(race) {
  return (race.startDate && TODAY < race.startDate) ? t('search.noResults') : t('search.noResults');
}

const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);

// ── Construir card de competición (resultado tipo "race") ─────────
function buildRaceCard(r) {
  const isPlaceholder = !racesWithRds.has(r.id);
  const isFemale = r.gender === 'female' && !nameImpliesFemale(r.name || '');
  const uci   = r.uciCategory || '';
  const color = r.colorHex || '#888';
  const flag  = countryFlag(r.countryCode);
  const name  = r.name || 'Carrera desconocida';
  const startKey = toDateKey(r.startDate);
  const endKey   = toDateKey(r.endDate);
  const dateStr  = startKey === endKey
    ? formatDate(startKey)
    : formatDate(startKey) + ' – ' + formatDate(endKey);
  // Fallback para carreras promovidas desde descripción cuyo startDate es Timestamp no serializable
  const displayDate = dateStr || (r._fallbackDateKey ? formatDate(r._fallbackDateKey) : '');

  const logo = r.logoUrl
    ? `<div class="race-card__logo"><img class="race-logo-img" src="${r.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">${r.hideFlag ? '' : `<span>${flag}</span>`}</div>`
    : (r.hideFlag ? '' : `<div class="race-card__flag">${flag}</div>`);

  const card = document.createElement('div');
  card.className = 'race-card' + (isPlaceholder ? ' race-card--placeholder' : '');
  card.style.setProperty('--card-color', color);

  if (isPlaceholder) {
    const flagHtml = r.hideFlag ? '' : flag;
    card.innerHTML = `
      <div class="race-card__ph-row">
        ${flagHtml ? `<span class="race-card__ph-flag">${flagHtml}</span>` : ''}
        <span class="race-card__ph-name">${name}${isFemale ? femaleMark({ style: 'font-size:0.8em;opacity:0.7' }) : ''}</span>
        <span class="race-card__ph-stage">${dateStr}</span>
      </div>
      <div class="race-card__meta">
        ${uci ? `<div class="race-card__meta-top">${categoryBadge(uci, isFemale)}</div>` : ''}
      </div>`;
    // tooltip
    card.addEventListener('mouseenter', () => {
      if (window.innerWidth < 600) return;
      let tip = document.getElementById('ph-tooltip');
      if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
      tip.textContent = phTooltipText(r);
      tip.style.display = 'block';
    });
    card.addEventListener('mousemove', e => {
      if (window.innerWidth < 600) return;
      const tip = document.getElementById('ph-tooltip');
      if (tip) { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
    });
    card.addEventListener('mouseleave', () => {
      if (window.innerWidth < 600) return;
      const tip = document.getElementById('ph-tooltip');
      if (tip) tip.style.display = 'none';
    });
  } else {
    let href = null;
    let modalRd = null;

    if (r.raceFormat === 'one_day') {
      const rd = raceDays.find(d => d.raceId === r.id);
      if (rd) {
        const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
          && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
        const rdClickable = !r.isNoClickable && (rdViewableProfile || rd.hasAssets === true);
        if (rdClickable) {
          href = jornadaUrl(rd);
        } else if (!r.isCancelled && hasModalData(rd)) {
          modalRd = rd;
        }
      }
    } else {
      href = raceUrl(r);
    }

    card.innerHTML = `
      ${logo}
      <div class="race-card__main">
        <div class="race-card__name">${name}${isFemale ? femaleMark({ style: 'font-size:0.8em;opacity:0.7' }) : ''}</div>
        <div class="race-card__sub">
          ${displayDate ? `<span class="race-card__stage">${displayDate}</span><span class="race-card__sep">·</span>` : ''}
          <span class="race-card__route">${formatCategory(r)}</span>
          ${r._fallbackDateKey ? '<span class="race-card__sep">·</span><span class="race-card__km">En descripción</span>' : ''}
        </div>
      </div>
      <div class="race-card__meta">
        <div class="race-card__meta-top">${categoryBadge(uci, isFemale)}</div>
      </div>`;

    if (href) {
      card.addEventListener('click', () => { window.location.href = href; });
      card.style.cursor = 'pointer';
    } else if (modalRd) {
      card.addEventListener('click', () => { openRaceDataModal(modalRd, r); });
      card.style.cursor = 'pointer';
    } else {
      card.dataset.phTooltip = phTooltipText(r);
    }
  }
  return card;
}

// ── Construir card de etapa (resultado tipo "race_day") ───────────
function buildRdCard(rd) {
  const race  = rd._race || {};
  const uci   = race.uciCategory || '';
  const color = race.colorHex || '#888';
  const isFemale = race.gender === 'female' && !nameImpliesFemale(race.name || '');
  const raceName = race.name || '—';

  const logo = race.logoUrl
    ? `<div class="race-card__logo"><img class="race-logo-img" src="${race.logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">${race.hideFlag ? '' : `<span>${countryFlag(race.countryCode)}</span>`}</div>`
    : (race.hideFlag ? '' : `<div class="race-card__flag">${countryFlag(race.countryCode)}</div>`);

  // Nombre principal según qué coincidió
  let mainName, subExtra;
  if (rd._matchDesc) {
    mainName = (rd.startLocation && rd.finishLocation && rd.startLocation !== rd.finishLocation)
      ? `${rd.startLocation} › ${rd.finishLocation}`
      : rd.startLocation || rd.finishLocation || '—';
    subExtra = t('search.inDescription');
  } else {
    mainName = (rd._matchStart ? rd.startLocation : rd.finishLocation) || '—';
    subExtra = rd._matchStart && !rd.finishLocation ? t('search.startAndFinish') : (rd._matchStart ? t('search.start') : t('search.finish'));
  }

  const stage = stageLabel(rd.stageNumber, rd._stageSuffix);
  const subParts = [
    `<span class="race-card__stage">${formatDate(rd.dateKey)}${stage ? ' · ' + stage : ''}</span>`,
    `<span class="race-card__route">${escHtml(raceName)}</span>`,
    `<span class="race-card__km">${subExtra}</span>`,
  ];

  const href = jornadaUrl(rd);

  const rdViewableProfile = !!(rd.elevationProfile && !rd.profileNotViewable
    && Array.isArray(rd.elevationProfile.points) && rd.elevationProfile.points.length >= 2);
  const rdClickable = !race.isNoClickable && (rdViewableProfile || rd.hasAssets === true);

  const card = document.createElement('div');
  card.className = 'race-card';
  card.style.setProperty('--card-color', color);
  card.style.cursor = rdClickable ? 'pointer' : 'default';
  card.innerHTML = `
    ${logo}
    <div class="race-card__main">
      <div class="race-card__name">${escHtml(mainName)}</div>
      <div class="race-card__sub">
        ${subParts.join('<span class="race-card__sep">·</span>')}
      </div>
    </div>
    <div class="race-card__meta">
      <div class="race-card__meta-top">${categoryBadge(uci, isFemale)}</div>
    </div>`;
  if (rdClickable) {
    card.addEventListener('click', () => { window.location.href = href; });
  } else {
    const todayStr = new Date().toISOString().slice(0, 10);
    card.dataset.phTooltip = (rd.dateKey && todayStr < rd.dateKey)
      ? t('search.noResults')
      : t('search.noResults');
  }
  return card;
}

// ── Busqueda ─────────────────────────────────────────────────────
function search(raw) {
  const q = normalize(raw);
  if (q.length < 2) return { raceResults: [], rdResults: [] };

  const scoredRaces = races
    .filter(r => !r.isCancelled)
    .map(r => ({ r, s: score(r.name, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.r.startDate || '').localeCompare(b.r.startDate || ''));
  const raceResults = scoredRaces.slice(0, MAX_RES).map(x => ({ ...x.r, _score: x.s }));

  const raceMap = Object.fromEntries(races.map(r => [r.id, r]));

  // IDs de carreras ya encontradas directamente (no duplicar)
  const directRaceIds = new Set(raceResults.map(r => r.id));

  // Carreras promovidas desde match en descripción de race_day
  const promotedRaceIds = new Set();
  const promotedRaces   = [];

  const rdResults = raceDays
    .map(rd => {
      const sS = score(rd.startLocation, q), sF = score(rd.finishLocation, q);
      const sD = score(rd.description, q) > 0 ? 1 : 0; // descripción puntúa menos
      const best = Math.max(sS, sF, sD);
      const matchStart = sS >= sF && sS >= sD;
      const matchDesc  = sD > 0 && sS < 1 && sF < 1; // solo si no hay match en loc
      return { rd, s: best, matchStart, matchDesc };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.rd.dateKey || '').localeCompare(b.rd.dateKey || ''))
    .reduce((acc, x) => {
      if (x.matchDesc) {
        // Promover a carrera padre si no está ya en resultados
        const parentRace = raceMap[x.rd.raceId];
        if (parentRace && !directRaceIds.has(parentRace.id) && !promotedRaceIds.has(parentRace.id)) {
          promotedRaceIds.add(parentRace.id);
          // Guardar dateKey del race_day como fallback por si startDate/endDate no son strings
          promotedRaces.push({ ...parentRace, _fallbackDateKey: x.rd.dateKey });
        }
        // No añadir como etapa suelta
      } else {
        acc.push({ ...x.rd, _matchStart: x.matchStart, _matchDesc: false, _race: raceMap[x.rd.raceId], s: x.s });
      }
      return acc;
    }, [])
    .slice(0, MAX_RES);

  // Combinar carreras directas + promovidas (sin sobrepasar MAX_RES)
  const allRaceResults = [...raceResults, ...promotedRaces].slice(0, MAX_RES);

  return { raceResults: allRaceResults, rdResults };
}

// ── Render ───────────────────────────────────────────────────────
function render(raw) {
  const container = document.getElementById('buscarResults');
  const q = normalize(raw);

  if (q.length < 2) {
    container.innerHTML = '<div class="buscar-hint">Escribe al menos 2 caracteres para buscar</div>';
    return;
  }

  const { raceResults, rdResults } = search(raw);
  if (!raceResults.length && !rdResults.length) {
    container.innerHTML = '<div class="buscar-hint">Sin resultados para <strong>' + escHtml(raw) + '</strong></div>';
    return;
  }

  // Lista única mezclada por relevancia: las carreras compiten por score; las
  // etapas (match más débil, por ubicación) van detrás a igual score.
  const items = [
    ...raceResults.map(r => ({ kind: 'race', data: r, s: r._score || 0, weak: 0 })),
    ...rdResults.map(rd => ({ kind: 'stage', data: rd, s: rd.s || 1, weak: 1 })),
  ].sort((a, b) => b.s - a.s || a.weak - b.weak);

  container.innerHTML = '';
  items.slice(0, MAX_COMBINED).forEach(it => {
    if (it.kind === 'race')  container.appendChild(buildRaceCard(it.data));
    else container.appendChild(buildRdCard(it.data));
  });
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  window.__spaDrivenAnalytics = true; // Cancelar fallback de analytics.js — disparamos manualmente
  await initI18n(); // Carga las cadenas EN cuando la página está bajo /en/ (antes faltaba → todo salía en ES)
  const input    = document.getElementById('buscarInput');
  const clearBtn = document.getElementById('buscarClear');
  const results  = document.getElementById('buscarResults');

  results.innerHTML = `<div class="loading"><div class="loading__icons"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg></div><p class="loading__text">${t('loading.data')}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;
  initPhTooltip();

  try {
    await loadData();
  } catch(e) {
    results.innerHTML = `<div class="buscar-hint">${t('search.error')}</div>`;
    console.error(e);
    return;
  }
  if (window.gtag) gtag('event', 'page_view', { page_location: window.gaLocation(), page_title: document.title });

  const urlQ = new URLSearchParams(location.search).get('q') || '';
  if (urlQ) { input.value = urlQ; clearBtn.style.display = 'flex'; render(urlQ); }
  else { results.innerHTML = '<div class="buscar-hint">Escribe al menos 2 car\u00e1cteres para buscar</div>'; }

  let debounceTimer;
  input.addEventListener('input', function() {
    const val = input.value;
    clearBtn.style.display = val ? 'flex' : 'none';
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { render(val); }, 200);
  });

  clearBtn.addEventListener('click', function() {
    input.value = '';
    clearBtn.style.display = 'none';
    results.innerHTML = '<div class="buscar-hint">Escribe al menos 2 car\u00e1cteres para buscar</div>';
    input.focus();
  });
}

init();
