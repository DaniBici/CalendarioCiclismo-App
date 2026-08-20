// ─────────────────────────────────────────────────────────────────
//  MODAL DATOS CARRERA
//  Usado desde mes.js y temporada.js
// ─────────────────────────────────────────────────────────────────

import { supabase, formatTimeUser, countryFlag, effectiveCountryCode, TYPE_LABELS, esc, stageLabel, raceName as getRaceName, rdLocation, filterBroadcastsByRegion, enBase, extractYouTubeId, startOrderUrl, startFinishLabels, trapFocus, femaleMark } from './shared.js';
import { getBroadcastEmbed } from './broadcast-embed.js';
import { t, getLang } from './i18n.js';

const STAGE_COLORS = {
  flat:            '#3dba6f',
  rolling:         '#a8e6bc',
  cotas:           '#c7cf5e',
  medium_mountain: '#e6b800',
  high_mountain:   '#e63d3d',
  cobbles:         '#8c8c8c',
  sterrato:        '#c4975a',
  itt:             '#1a5ca8',
  ttt:             '#6aaee8',
  chrono_climb:    '#1a5ca8',
};

function _descriptionHtml(str) {
  if (!str) return '';
  return str.split('\n')
    .map(line => esc(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<u>$1</u>'))
    .filter(line => line.replace(/&amp;nbsp;/g, '').replace(/[ \s]/g, '').length > 0)
    .map(line => `<p>${line}</p>`)
    .join('');
}

function _gaResultPath(raceName, stageNumber) {
  const slug = (raceName || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (stageNumber == null) return `/resultados/${slug}/`;
  if (stageNumber === 0) return `/resultados/${slug}/prologo/`;
  return `/resultados/${slug}/etapa-${stageNumber}/`;
}

// URL de la p\u00e1gina de resultados PROPIA (in-house). Usa el slug REAL de la
// carrera (no el derivado del nombre) \u2014 espejo de js/resultados.js (ES/EN).
function _inhouseResultsUrl(race, stageNumber, suffix = '') {
  const isEn = getLang() === 'en';
  const slug = isEn ? (race.slugEn || race.slug) : race.slug;
  if (!slug) return null;
  const base = isEn ? `${enBase()}/results/` : '/resultados/';
  const sfx = (suffix || '').toLowerCase();   // doble sector: 3A → etapa-3a
  let seg = '';
  if (stageNumber === 0) seg = isEn ? 'prologue/' : 'prologo/';
  else if (stageNumber != null) seg = isEn ? `stage-${stageNumber}${sfx}/` : `etapa-${stageNumber}${sfx}/`;
  return `${base}${encodeURIComponent(slug)}/${seg}`;
}

// Bloque de botones de resultados. Espejo de jornada.js: si hay p\u00e1gina propia
// (inhouseUrl) \u2192 bot\u00f3n principal a nuestra p\u00e1gina + FC/PCS como respaldo discreto.
// Si no \u2192 FC/PCS cl\u00e1sicos (texto plano).
function _resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, stageNumber) {
  const gaStage = stageNumber ?? '';
  const ext = (cls, href, label) =>
    `<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer" data-ga-race="${esc(race.name)}" data-ga-stage="${gaStage}">${label}</a>`;

  if (inhouseUrl) {
    const alts = [
      fcUrl  ? ext('result-alt-btn', fcUrl,  'FirstCycling \u2197&#xFE0E;')    : '',
      pcsUrl ? ext('result-alt-btn', pcsUrl, 'ProCyclingStats \u2197&#xFE0E;') : '',
    ].join('');
    const fallback = alts
      ? `<div class="result-fallback">
           <span class="result-fallback__label">${t('stage.alsoOn') || 'Tambi\u00e9n en'}</span>
           ${alts}
         </div>`
      : '';
    return `<a class="result-btn result-btn--inhouse" href="${esc(inhouseUrl)}">${t('stage.viewResults')}</a>${fallback}`;
  }
  if (!fcUrl && !pcsUrl) return '';
  return `<div class="result-section-btns">${
    fcUrl  ? ext('result-btn', fcUrl,  'FirstCycling')    : ''
  }${
    pcsUrl ? ext('result-btn', pcsUrl, 'ProCyclingStats') : ''
  }</div>`;
}

// \u00bfEsta etapa tiene clasificaciones propias (race_uci_stages.keepForWeb)?
// stageNumber null = clasificaci\u00f3n final / carrera de un d\u00eda.
async function _hasInhouseResults(raceId, stageNumber) {
  if (!raceId) return false;
  let q = supabase.from('race_uci_stages')
    .select('eventId', { count: 'exact', head: true })
    .eq('raceId', raceId).eq('keepForWeb', true);
  q = (stageNumber == null) ? q.is('stageNumber', null) : q.eq('stageNumber', stageNumber);
  const { count } = await q;
  return (count || 0) > 0;
}

// Variante batched para las cards de Hoy/Competici\u00f3n: un solo SELECT para N
// carreras. Espejo del gate de las apps (`hasInhouse || shouldShowResults`,
// TodayScreen/RaceScreen): si la etapa de la card tiene clasificaciones propias,
// el trofeo se muestra sin esperar a la heur\u00edstica horaria ni exigir fcId/pcsSlug.
// Misma clave por stageNumber que jornada.js ('final' = NULL \u2192 un d\u00eda / general),
// de modo que badge visible \u21d4 openResultsModal redirige a /resultados/.
// Las jornadas canceladas pueden tener p\u00e1gina propia de resultados, pero no se
// consideran resultados disponibles para las cards: no deben activar el trofeo.
export async function loadInhouseStageSet(raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const keyOf = rd => `${rd.raceId}#${rd.stageNumber == null ? 'final' : rd.stageNumber}`;
  if (!ids.length) return { has: () => false };
  try {
    const { data } = await supabase.from('race_uci_stages')
      .select('raceId,stageNumber')
      .eq('keepForWeb', true).gt('rowCount', 0)
      .in('raceId', ids);
    const keys = new Set((data || []).map(s => `${s.raceId}#${s.stageNumber == null ? 'final' : s.stageNumber}`));
    return { has: rd => !rd?.isCancelledDay && keys.has(keyOf(rd)) };
  } catch (_) {
    // Sin red \u2192 gate horario cl\u00e1sico.
    return { has: () => false };
  }
}
function _attachResultGaListeners(container) {
  container.querySelectorAll('.result-btn[data-ga-race]').forEach(a => {
    a.addEventListener('click', () => {
      if (!window.gtag) return;
      const stageRaw = a.dataset.gaStage;
      const stage = stageRaw !== '' ? Number(stageRaw) : null;
      gtag('event', 'page_view', {
        page_location: window.location.origin + _gaResultPath(a.dataset.gaRace, stage),
        page_title: a.dataset.gaRace + (stage != null ? ' – Etapa ' + stage : '') + ' — Resultados — Calendario Ciclismo',
      });
    });
  });
}

const _STERRATO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><ellipse cx="7" cy="15" rx="4.5" ry="3"/><ellipse cx="17" cy="15" rx="4" ry="2.8"/><ellipse cx="12.5" cy="9" rx="4.5" ry="3"/></svg>';
const _ASSET_ICONS = {
  startOrder: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V3"/><path d="M10 2h4"/></svg>',
  roadbook:  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  profile:   '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  profileOfficial:    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  profileInteractive: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  ports:     '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="m8 3-4 4 4 4"/><path d="m16 3 4 4-4 4"/><line x1="4" y1="7" x2="20" y2="7"/><path d="m8 17-4 4 4 4"/><path d="m16 17 4 4-4 4"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
  pave:      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M5 20L2 13L6 7L13 4L20 7L22 13L19 20Z"/></svg>',
  sterrato:  _STERRATO_SVG,
  ribinou:   _STERRATO_SVG,
  map:       '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
  live_text: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>',
};
function _assetLabel(key) {
  const icon = _ASSET_ICONS[key] || '';
  const label = t(`assets.${key}`) || key;
  return icon ? `${icon} ${label}` : label;
}
const ASSET_LABELS = new Proxy({}, { get(_, key) { return _assetLabel(key); } });

const TV_STATUS_LABELS = new Proxy({}, {
  get(_, key) { return t(`tv.status.${key}`) || key; },
});

function _raceTimeCheck(rd, offsetMinutes) {
  if (rd.estimatedFinishTimeUtc) {
    return new Date() >= new Date(new Date(rd.estimatedFinishTimeUtc).getTime() + offsetMinutes * 60 * 1000);
  }
  if (rd.dateKey) {
    const [y, m, d] = rd.dateKey.split('-').map(Number);
    return new Date() >= new Date(Date.UTC(y, m - 1, d, 18, 0, 0) + offsetMinutes * 60 * 1000);
  }
  return false;
}
function _shouldShowResults(rd, race) {
  if (rd.isRestDay || rd.isCancelledDay) return false;
  if (!race.fcId && !race.pcsSlug) return false;
  return _raceTimeCheck(rd, -30);
}
function _buildFcUrl(race, stageNumber, fcSeqNum) {
  if (!race.fcId) return null;
  const base = `https://firstcycling.com/race.php?r=${race.fcId}&y=${race.year}`;
  if (stageNumber === null || stageNumber === undefined) return base;
  const num = fcSeqNum != null ? fcSeqNum : stageNumber;
  return base + `&e=${String(num).padStart(2, '0')}`;
}
function _buildPcsUrl(race, stageNumber, stageSuffix) {
  if (!race.pcsSlug) return null;
  const base = `https://www.procyclingstats.com/race/${race.pcsSlug}/${race.year}`;
  if (stageNumber === null || stageNumber === undefined) return `${base}/result`;
  if (stageNumber === 0) return `${base}/prologue/result`;
  const suffix = stageSuffix ? stageSuffix.toLowerCase() : '';
  return `${base}/stage-${stageNumber}${suffix}/result`;
}

function _typeLabel(t) { return TYPE_LABELS[t] || t || '—'; }
function _typeColor(t) { return STAGE_COLORS[t] || null; }

function _resolveTypeLabel(p, s, countryCode) {
  if (p === 'sterrato' && countryCode?.toUpperCase() === 'FR') return _typeLabel('ribinou');
  if (p === 'flat' && s === 'summit_finish') return _typeLabel('monopuerto');
  if (p === 'itt'  && s === 'chrono_climb')  return _typeLabel('chrono_climb');
  return _typeLabel(p) + (s ? ` · ${_typeLabel(s)}` : '');
}

function _resolveTypeColor(p, s) {
  if (p === 'flat' && s === 'summit_finish') return STAGE_COLORS['high_mountain'];
  if (p === 'itt'  && s === 'chrono_climb')  return STAGE_COLORS['itt'];
  return _typeColor(p);
}

function _fmtDateLong(dk) {
  if (!dk) return '';
  const [y, m, d] = dk.split('-').map(Number);
  const locale = getLang() === 'en' ? 'en-GB' : 'es-ES';
  const s = new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Singleton DOM ──────────────────────────────────────────────────
let _overlay = null;

function _getOverlay() {
  if (_overlay) return _overlay;
  _overlay = document.createElement('div');
  _overlay.className = 'rd-modal-overlay';
  _overlay.innerHTML = `
    <div class="rd-modal" role="dialog" aria-modal="true">
      <div class="rd-modal__bar">
        <div class="rd-modal__header-text"></div>
        <button class="rd-modal__close" aria-label="${getLang() === 'en' ? 'Close' : 'Cerrar'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="rd-modal__body"></div>
    </div>
  `;
  document.body.appendChild(_overlay);
  _overlay.addEventListener('click', e => { if (e.target === _overlay) _close(); });
  _overlay.querySelector('.rd-modal__close').addEventListener('click', _close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _overlay?.classList.contains('rd-modal--open')) _close();
  });
  return _overlay;
}

// Trampa de foco compartida por los tres diálogos de este módulo.
let _releaseFocus = null;
function _openFocusTrap(overlay) {
  if (_releaseFocus) _releaseFocus();
  _releaseFocus = trapFocus(overlay.querySelector('.rd-modal') || overlay);
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.remove('rd-modal--open');
  document.body.style.overflow = '';
  if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
  const iframe = _overlay.querySelector('.rd-modal__body iframe');
  if (iframe) iframe.src = 'about:blank';
}

// ── API pública ────────────────────────────────────────────────────

/**
 * Devuelve true si el race_day tiene datos suficientes para mostrar el modal.
 * rd debe incluir los campos de race_days (al menos un subconjunto con los campos de ruta).
 */
export function hasModalData(rd) {
  if (!rd) return false;
  return !!(
    rd.startLocation ||
    rd.distanceKm ||
    rd.primaryType ||
    rd.neutralStartTimeUtc ||
    rd.estimatedFinishTimeUtc ||
    rd.hasAssets ||
    (rd.tvStatus && rd.tvStatus !== 'none') ||
    (rd.elevationProfile && !rd.profileNotViewable) ||
    rd.description ||
    rd.notes
  );
}

/**
 * Abre el modal con los datos de una jornada.
 * @param {object|string} rdOrId  Objeto race_day completo o solo su id (se cargará de Supabase)
 * @param {object}        raceObj Objeto race con al menos name, gender, countryCode, hideFlag
 */
export async function openRaceDataModal(rdOrId, raceObj) {
  const overlay  = _getOverlay();
  const body     = overlay.querySelector('.rd-modal__body');
  const headerEl = overlay.querySelector('.rd-modal__header-text');
  overlay.querySelector('.rd-modal').classList.remove('rd-modal--tv');

  // Cabecera inicial (nombre ya disponible antes del fetch)
  const _raceDisplayName = getRaceName(raceObj);
  const nameImpliesFemale = /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i
    .test(_raceDisplayName || '');
  const isFemale = raceObj.gender === 'female' && !nameImpliesFemale;
  const flag = raceObj.hideFlag ? '' : countryFlag(raceObj.countryCode);
  headerEl.innerHTML =
    `${flag}<span class="rd-modal__race-name">${esc(_raceDisplayName || '')}${isFemale ? femaleMark({ style: 'font-size:0.7em;opacity:0.65' }) : ''}</span>`;

  body.innerHTML = `<div class="rd-modal__loading"><span></span><span></span><span></span></div>`;
  overlay.classList.add('rd-modal--open');
  document.body.style.overflow = 'hidden';
  _openFocusTrap(overlay);

  // Registrar apertura del modal como página virtual en GA4
  if (window.gtag) {
    const slug = (raceObj.name || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    gtag('event', 'page_view', {
      page_location: window.location.origin + '/modal/' + slug + '/',
      page_title: (_raceDisplayName || 'Modal') + ' — Calendario Ciclismo',
    });
  }

  // Determinar si tenemos el rd completo o solo el id
  const rdId       = typeof rdOrId === 'object' ? rdOrId.id : rdOrId;
  const rdProvided = (typeof rdOrId === 'object' && rdOrId.dateKey != null) ? rdOrId : null;

  try {
    const fetches = [
      supabase.from('broadcasts').select('*').eq('raceDayId', rdId).order('sortOrder', { ascending: true }),
      supabase.from('assets').select('*').eq('raceDayId', rdId),
    ];
    if (!rdProvided) {
      fetches.unshift(supabase.from('race_days').select('*').eq('id', rdId).single());
    }
    // Resultados in-house: qué etapas de esta carrera tienen clasificaciones
    // propias (race_uci_stages.keepForWeb). Espejo de jornada.js — una sola
    // consulta por carrera. Va al final del array; su índice se calcula abajo.
    const _uciRaceId = rdProvided?.raceId || raceObj?.id;
    fetches.push(_uciRaceId
      ? supabase.from('race_uci_stages').select('stageNumber').eq('raceId', _uciRaceId).eq('keepForWeb', true)
      : Promise.resolve(null));

    const results = await Promise.all(fetches);

    let rd = rdProvided;
    let bIdx = 0, aIdx = 1;
    if (!rdProvided) {
      rd = results[0].data;
      bIdx = 1; aIdx = 2;
    }

    const broadcasts = filterBroadcastsByRegion(results[bIdx]?.data || []);
    const assets     = (results[aIdx]?.data || []).filter(a => a.url);
    // Set de stageNumbers con resultados propios (null → clasificación final/un día → 'final').
    const inhouseStages = new Set(
      (results[results.length - 1]?.data || []).map(s => s.stageNumber == null ? 'final' : s.stageNumber)
    );

    // Check startlist availability
    const raceId = rd?.raceId || raceObj?.id;
    let hasStartlist = false;
    if (raceId) {
      const { count } = await supabase.from('startlist_teams').select('id', { count: 'exact', head: true }).eq('raceId', raceId);
      hasStartlist = count > 0;
    }

    // Load sibling race days to find previous stage
    let prevRd = null;
    if (raceId && rd?.raceId) {
      const { data: siblings } = await supabase.from('race_days').select('*').eq('raceId', raceId).order('stageNumber', { ascending: true });
      if (siblings && siblings.length > 1) {
        const _navSiblings = siblings.filter(s => !s.isRestDay && !s.isCancelledDay);
        const _currentIdx = _navSiblings.findIndex(s => s.id === rd.id);
        if (_currentIdx > 0) {
          prevRd = _navSiblings[_currentIdx - 1];
        }
      }
    }

    if (!rd) {
      body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('stage.noData')}</div>`;
      return;
    }

    // Si la jornada tiene un país propio (override cosmético, p.ej. etapa de
    // un Grand Tour en el extranjero), reescribir la bandera del header.
    // El override vence también al flag hideFlag de la carrera: si la jornada
    // pide bandera, se muestra aunque la carrera ocultara la suya.
    if (rd.countryCode && (raceObj.hideFlag || rd.countryCode !== raceObj.countryCode)) {
      const newFlag = countryFlag(effectiveCountryCode(rd, raceObj));
      headerEl.innerHTML =
        `${newFlag}<span class="rd-modal__race-name">${esc(_raceDisplayName || '')}${isFemale ? femaleMark({ style: 'font-size:0.7em;opacity:0.65' }) : ''}</span>`;
    }

    // Actualizar cabecera con etapa y fecha
    const _stage = rd.stageNumber ? stageLabel(rd.stageNumber, rd._stageSuffix) : '';
    const _date  = rd.dateKey ? _fmtDateLong(rd.dateKey) : '';
    const _sub   = [_stage, _date].filter(Boolean).join(' · ');
    if (_sub) headerEl.innerHTML += `<div class="rd-modal__date">${_sub}</div>`;

    body.innerHTML = _buildBody(rd, raceObj, broadcasts, assets, hasStartlist, prevRd, inhouseStages);
    _attachResultGaListeners(body);

    // Emisión embebible: abre el reproductor inline al pulsar "Ver".
    body.querySelectorAll('a.tv-link-btn--embed[data-tv-embed]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        openBroadcastTvModal(rd, raceObj, btn.href);
      });
    });

    // Tooltips de escritorio
    if (window.innerWidth >= 600) {
      body.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', () => {
          let tip = document.getElementById('ph-tooltip');
          if (!tip) { tip = document.createElement('div'); tip.id = 'ph-tooltip'; document.body.appendChild(tip); }
          tip.textContent = el.dataset.tooltip;
          tip.style.display = 'block';
        });
        el.addEventListener('mousemove', e => {
          const tip = document.getElementById('ph-tooltip');
          if (tip) { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
        });
        el.addEventListener('mouseleave', () => {
          const tip = document.getElementById('ph-tooltip');
          if (tip) tip.style.display = 'none';
        });
      });
    }

  } catch (err) {
    body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('race.error')}</div>`;
    console.error('[race-data-modal]', err);
  }
}

/**
 * Abre un modal simplificado con solo la cabecera + botones de resultados.
 * Usado desde las cards de Hoy y Competición al clicar el badge "Resultados".
 */
export async function openResultsModal(rdOrId, raceObj) {
  const _resultsDisplayName = getRaceName(raceObj);
  const nameImpliesFemale = /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i
    .test(_resultsDisplayName || '');
  const isFemale = raceObj.gender === 'female' && !nameImpliesFemale;
  const femSpan = isFemale ? femaleMark({ style: 'font-size:0.7em;opacity:0.65' }) : '';

  const rdId       = typeof rdOrId === 'object' ? rdOrId.id : rdOrId;
  const rdProvided = (typeof rdOrId === 'object' && rdOrId.dateKey != null) ? rdOrId : null;

  // ── Chequeo in-house ANTES de pintar nada ──────────────────────────
  // Si esta etapa tiene página de resultados propia → redirigir directo,
  // sin abrir el modal (evita el parpadeo de un modal vacío mientras se
  // resuelve el chequeo). El modal con enlaces PCS/FC es solo el fallback.
  // Necesitamos el rd para conocer stageNumber/raceId; si solo nos dieron
  // el id, lo cargamos aquí (todavía no hay nada dibujado).
  let rd = rdProvided;
  try {
    if (!rd) {
      const { data } = await supabase.from('race_days').select('*').eq('id', rdId).single();
      rd = data;
    }
  } catch (err) {
    console.error('[results-modal]', err);
  }

  if (rd) {
    const inhouseUrl = _inhouseResultsUrl(raceObj, rd.stageNumber, rd._stageSuffix);
    // La cancelada va SIEMPRE a nuestra página (aviso + generales arrastradas):
    // no tiene clasificaciones propias, así que `_hasInhouseResults` diría que no
    // y el trofeo caería a FC/PCS, que tampoco tienen nada que enseñar.
    if (inhouseUrl && (rd.isCancelledDay || await _hasInhouseResults(rd.raceId || raceObj.id, rd.stageNumber))) {
      window.location.href = inhouseUrl;
      return;
    }
  }

  // ── Sin página propia → abrir el modal (fallback PCS/FC) ────────────
  const overlay  = _getOverlay();
  const body     = overlay.querySelector('.rd-modal__body');
  const headerEl = overlay.querySelector('.rd-modal__header-text');
  overlay.querySelector('.rd-modal').classList.remove('rd-modal--tv');

  const flag = raceObj.hideFlag ? '' : countryFlag(raceObj.countryCode);
  headerEl.innerHTML = `${flag}<span class="rd-modal__race-name">${esc(_resultsDisplayName || '')}${femSpan}</span>`;

  body.innerHTML = `<div class="rd-modal__loading"><span></span><span></span><span></span></div>`;
  overlay.classList.add('rd-modal--open');
  document.body.style.overflow = 'hidden';
  _openFocusTrap(overlay);

  if (window.gtag) {
    const slug = (raceObj.name || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    gtag('event', 'page_view', {
      page_location: window.location.origin + '/modal/resultados/' + slug + '/',
      page_title: (_resultsDisplayName || 'Modal') + ' — Resultados — Calendario Ciclismo',
    });
  }

  try {
    if (!rd) {
      body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('stage.noData')}</div>`;
      return;
    }

    if (rd.countryCode && (raceObj.hideFlag || rd.countryCode !== raceObj.countryCode)) {
      const newFlag = countryFlag(effectiveCountryCode(rd, raceObj));
      headerEl.innerHTML = `${newFlag}<span class="rd-modal__race-name">${esc(_resultsDisplayName || '')}${femSpan}</span>`;
    }

    const _stage = rd.stageNumber ? stageLabel(rd.stageNumber, rd._stageSuffix) : '';
    const _date  = rd.dateKey ? _fmtDateLong(rd.dateKey) : '';
    const _sub   = [_stage, _date].filter(Boolean).join(' · ');
    if (_sub) headerEl.innerHTML += `<div class="rd-modal__date">${_sub}</div>`;

    const fcUrl  = _buildFcUrl(raceObj, rd.stageNumber, rd._fcStageNumber);
    const pcsUrl = _buildPcsUrl(raceObj, rd.stageNumber, rd._stageSuffix);

    if (!fcUrl && !pcsUrl) {
      body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('stage.noData')}</div>`;
      return;
    }

    body.innerHTML = `<div class="jornada-section">
      <div class="jornada-section__title">${t('stage.results')}</div>
      <div class="result-section-btns">
        ${fcUrl  ? `<a class="result-btn" href="${fcUrl}"  target="_blank" rel="noopener noreferrer" data-ga-race="${esc(raceObj.name)}" data-ga-stage="${rd.stageNumber ?? ''}">FirstCycling</a>` : ''}
        ${pcsUrl ? `<a class="result-btn" href="${pcsUrl}" target="_blank" rel="noopener noreferrer" data-ga-race="${esc(raceObj.name)}" data-ga-stage="${rd.stageNumber ?? ''}">ProCyclingStats</a>` : ''}
      </div>
    </div>`;
    _attachResultGaListeners(body);

  } catch (err) {
    body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('race.error')}</div>`;
    console.error('[results-modal]', err);
  }
}

/**
 * Abre un modal con cabecera de carrera + emisión embebida. La URL se valida
 * siempre contra la allowlist de `broadcast-embed.js` antes de crear el iframe.
 */
export async function openBroadcastTvModal(rdOrId, raceObj, broadcastUrl, embeddable = null) {
  const embed = getBroadcastEmbed(broadcastUrl, embeddable);
  if (!embed) return;

  const overlay  = _getOverlay();
  const body     = overlay.querySelector('.rd-modal__body');
  const headerEl = overlay.querySelector('.rd-modal__header-text');
  overlay.querySelector('.rd-modal').classList.add('rd-modal--tv');

  const _displayName = getRaceName(raceObj);
  const nameImpliesFemale = /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i
    .test(_displayName || '');
  const isFemale = raceObj.gender === 'female' && !nameImpliesFemale;
  const femSpan = isFemale ? femaleMark({ style: 'font-size:0.7em;opacity:0.65' }) : '';
  const flag = raceObj.hideFlag ? '' : countryFlag(raceObj.countryCode);
  headerEl.innerHTML = `${flag}<span class="rd-modal__race-name">${esc(_displayName || '')}${femSpan}</span>`;

  body.innerHTML = `<div class="rd-modal__loading"><span></span><span></span><span></span></div>`;
  overlay.classList.add('rd-modal--open');
  document.body.style.overflow = 'hidden';
  _openFocusTrap(overlay);

  if (window.gtag) {
    const slug = (raceObj.name || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    gtag('event', 'page_view', {
      page_location: window.location.origin + '/modal/tv/' + slug + '/',
      page_title: (_displayName || 'Modal') + ' — TV — Calendario Ciclismo',
    });
  }

  const rdId       = typeof rdOrId === 'object' ? rdOrId.id : rdOrId;
  const rdProvided = (typeof rdOrId === 'object' && rdOrId.dateKey != null) ? rdOrId : null;

  try {
    let rd = rdProvided;
    if (!rd) {
      const { data } = await supabase.from('race_days').select('*').eq('id', rdId).single();
      rd = data;
    }

    if (!rd) {
      body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('stage.noData')}</div>`;
      return;
    }

    if (rd.countryCode && (raceObj.hideFlag || rd.countryCode !== raceObj.countryCode)) {
      const newFlag = countryFlag(effectiveCountryCode(rd, raceObj));
      headerEl.innerHTML = `${newFlag}<span class="rd-modal__race-name">${esc(_displayName || '')}${femSpan}</span>`;
    }

    const _stage = rd.stageNumber ? stageLabel(rd.stageNumber, rd._stageSuffix) : '';
    const _date  = rd.dateKey ? _fmtDateLong(rd.dateKey) : '';
    const _sub   = [_stage, _date].filter(Boolean).join(' · ');
    if (_sub) headerEl.innerHTML += `<div class="rd-modal__date">${_sub}</div>`;

    const externalText = getLang() === 'en' ? `Open on ${embed.externalLabel}` : `Abrir en ${embed.externalLabel}`;
    body.innerHTML = `<div style="padding:0.75rem">
      <div class="tv-embed-wrap" style="margin-bottom:0">
        <iframe src="${esc(embed.src)}" title="${esc(embed.externalLabel)}"
          frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen></iframe>
      </div>
      <div class="tv-embed-actions">
        <a class="tv-link-btn" href="${esc(embed.externalUrl)}" target="_blank" rel="noopener">${externalText} ↗&#xFE0E;</a>
      </div>
    </div>`;

  } catch (err) {
    body.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">${t('race.error')}</div>`;
    console.error('[broadcast-tv-modal]', err);
  }
}

// Compatibilidad con los consumidores de repeticiones YouTube ya existentes.
export function openYoutubeTvModal(rdOrId, raceObj, ytId) {
  return openBroadcastTvModal(rdOrId, raceObj, `https://www.youtube.com/watch?v=${ytId}`);
}

// ── Construcción del contenido ─────────────────────────────────────
function _shouldShowPreviousResults(prevRd, currentRd, race) {
  if (!prevRd || race.raceFormat === 'one_day') return false;
  if (!race.fcId && !race.pcsSlug) return false;
  if (_shouldShowResults(currentRd, race)) return false;
  return _raceTimeCheck(prevRd, 0);
}

function _buildBody(rd, race, broadcasts, assets, hasStartlist = false, prevRd = null, inhouseStages = new Set()) {
  const arrowSvg = `<svg class="route-arrow" viewBox="0 0 14 22" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <line x1="7" y1="0" x2="7" y2="17" stroke-width="1.5" stroke-linecap="round"/>
    <polyline points="3,13 7,19 11,13" fill="none" stroke-width="1.5"
      stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

  // — Assets —
  // Jornada cancelada: no hay carrera que seguir en directo → fuera el Live
  // Texto. La documentación del recorrido SÍ se conserva (describe la etapa que
  // estaba trazada). Espejo del filtro de `buildActionButtons` en shared.js.
  const assetOrder = ['startOrder', 'roadbook', 'profile', 'ports', 'map', 'live_text'];
  const sortedAssets = [...assets]
    .filter(a => !(rd.isCancelledDay && a.type === 'live_text'))
    .sort((a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type));
  const profileAsset = sortedAssets.find(a => a.type === 'profile');
  const portsAsset   = sortedAssets.find(a => a.type === 'ports');

  // Perfil dinámico desde datos de elevación (igual que jornada.js)
  const _isEnModal = getLang() === 'en';
  const _modalEnB = _isEnModal ? enBase() : null;
  const _profileBase = _isEnModal ? `${_modalEnB}/profile/` : '/perfil/';
  const _profileFallback = _isEnModal ? `${_modalEnB}/profile/?id=${rd.id}` : `/perfil.html?id=${rd.id}`;
  const _modalProfSlug = _isEnModal ? (rd.slugEn || rd.slug) : rd.slug;
  const dynProfileUrl = (rd.elevationProfile && !rd.profileNotViewable)
    ? (_modalProfSlug ? `${_profileBase}${encodeURIComponent(_modalProfSlug)}/` : _profileFallback)
    : null;

  // Mapa interactivo (GPX) sustituye al asset estático `map`, igual que el
  // perfil dinámico al asset `profile`.
  const _mapBase = _isEnModal ? `${_modalEnB}/route-map/` : '/mapa/';
  const _mapFallback = _isEnModal ? `${_modalEnB}/route-map/?id=${rd.id}` : `/mapa.html?id=${rd.id}`;
  const dynMapUrl = rd.routeGpxUrl
    ? (_modalProfSlug ? `${_mapBase}${encodeURIComponent(_modalProfSlug)}/` : _mapFallback)
    : null;
  const hasProfile = !!(dynProfileUrl || profileAsset);
  // Ambos perfiles (interactivo GPX + asset estático) → dos botones distintos;
  // con uno solo, el botón se llama simplemente "Perfil".
  const bothProfiles = !!(dynProfileUrl && profileAsset);
  const dynKey    = bothProfiles ? 'profileInteractive' : 'profile';
  const staticKey = bothProfiles ? 'profileOfficial'    : 'profile';

  const isSterrato = rd.primaryType === 'sterrato';
  const isFrance   = race.countryCode?.toLowerCase() === 'fr';

  // Botón interactivo (enlace a la página propia de perfil).
  const dynProfileBtnHtml = dynProfileUrl
    ? `<a class="asset-btn" href="${dynProfileUrl}">${ASSET_LABELS[dynKey]}</a>`
    : '';
  // Botón del asset estático de perfil.
  const staticProfileBtnHtml = profileAsset
    ? `<a class="asset-btn" href="${profileAsset.url}" target="_blank" rel="noopener">${ASSET_LABELS[staticKey]}</a>`
    : '';

  // `profileBtnHtml` = botón principal en el slot 'profile' (interactivo si existe,
  // si no el asset estático, si no el asset de puertos).
  let profileBtnHtml = '';
  let portsBtnHtml   = '';
  if (dynProfileUrl) {
    profileBtnHtml = dynProfileBtnHtml;
  } else if (profileAsset) {
    profileBtnHtml = staticProfileBtnHtml;
  } else if (portsAsset) {
    const key = isSterrato ? (isFrance ? 'ribinou' : 'sterrato') : 'ports';
    profileBtnHtml = `<a class="asset-btn" href="${portsAsset.url}" target="_blank" rel="noopener">${ASSET_LABELS[key]}</a>`;
  }
  // Cuando hay perfil y además ports, el asset de puertos ocupa su propio slot.
  if (hasProfile && portsAsset) {
    const portsKey = isSterrato ? (isFrance ? 'ribinou' : 'sterrato') : 'ports';
    portsBtnHtml = `<a class="asset-btn" href="${portsAsset.url}" target="_blank" rel="noopener">${ASSET_LABELS[portsKey]}</a>`;
  }
  // Con ambos perfiles, el slot 'profile' muestra primero el OFICIAL (asset
  // estático) y después el INTERACTIVO — tras el rutómetro y antes del mapa.
  const profileSlotHtml = bothProfiles
    ? `${staticProfileBtnHtml}${dynProfileBtnHtml}`
    : profileBtnHtml;

  // Si solo hay perfil dinámico (sin asset estático), inyectar slot sintético
  // para que el botón aparezca en la posición de 'profile' en assetOrder (después del rutómetro)
  const mapAsset = sortedAssets.find(a => a.type === 'map');
  let workingAssets = (dynProfileUrl && !profileAsset)
    ? [...sortedAssets, { type: 'profile' }].sort(
        (a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type)
      )
    : sortedAssets;
  // Mapa dinámico sin asset estático: inyectar slot 'map' en su posición.
  if (dynMapUrl && !mapAsset) {
    workingAssets = [...workingAssets, { type: 'map' }].sort(
      (a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type)
    );
  }

  const assetBtns = workingAssets
    .map(a => {
      if (a.type === 'profile') return profileSlotHtml;
      if (a.type === 'ports')   return hasProfile ? portsBtnHtml : profileBtnHtml;
      if (a.type === 'map' && dynMapUrl) return `<a class="asset-btn" href="${dynMapUrl}">${ASSET_LABELS['map'] || 'Mapa'}</a>`;
      const label = ASSET_LABELS[a.type] || a.type;
      if (a.type === 'startOrder') return `<a class="asset-btn" href="${startOrderUrl(rd)}">${label}</a>`;
      return `<a class="asset-btn" href="${a.url}" target="_blank" rel="noopener">${label}</a>`;
    })
    .filter(Boolean);
  let websiteBtnHtml = '';
  if (race?.websiteUrl) {
    websiteBtnHtml = `<a class="asset-btn" href="${race.websiteUrl}" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> ${t('stage.websiteLabel')}</a>`;
  }
  let startlistBtnHtml = '';
  if (hasStartlist) {
    const _inscSlug = (_isEnModal && (race?.slugEn || race?.slug)) ? (race?.slugEn || race?.slug) : race?.slug;
    const _inscBase = _isEnModal ? `${_modalEnB}/startlist/` : `${CONFIG.basePath}/inscritos/`;
    const inscritosHref = _inscSlug
      ? `${_inscBase}${encodeURIComponent(_inscSlug)}/`
      : `${CONFIG.basePath}/inscritos.html?race=${race?.id}`;
    const startlistLabel = race?.startlistProvisional ? t('stage.startlistProvisional') : (race?.gender === 'female' ? t('stage.startlistLabelFemale') : t('stage.startlistLabel'));
    startlistBtnHtml = `<a class="asset-btn" href="${inscritosHref}"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg> ${startlistLabel}</a>`;
  }
  const assetsHtml = (assetBtns.length > 0 || startlistBtnHtml || websiteBtnHtml)
    ? `<div class="asset-links" style="margin-bottom:0.85rem">${websiteBtnHtml}${startlistBtnHtml}${assetBtns.join('')}</div>`
    : '';

  // — Bloque Recorrido — solo si hay alguna ciudad
  const hasLocation = !!(rd.startLocation || rd.finishLocation);
  const sameLocation = rd.startLocation &&
    (!rd.finishLocation || rd.startLocation === rd.finishLocation);
  let recorridoHtml = '';
  if (hasLocation) {
    recorridoHtml = sameLocation
      ? `<div class="route-block__place route-block__place--solo">${esc(rdLocation(rd, 'startLocation'))}</div>
         <div class="route-block__note">${t('search.startAndFinish')}</div>`
      : `<div class="route-block__place">${esc(rdLocation(rd, 'startLocation') || '—')}</div>
         ${arrowSvg}
         <div class="route-block__place">${esc(rdLocation(rd, 'finishLocation') || '—')}</div>`;
  }

  // — Bloque Distancia y tipo —
  // Solo usar primaryType si tiene traducción conocida (evita valores legacy como 'hilly')
  const knownPrimaryType = rd.primaryType && TYPE_LABELS[rd.primaryType] ? rd.primaryType : null;

  const kmFormatted = rd.distanceKm
    ? Number(rd.distanceKm).toLocaleString(_isEnModal ? 'en-GB' : 'es-ES')
    : null;
  const kmHtml = kmFormatted
    ? `<div class="route-block__km">${kmFormatted}${_isEnModal ? 'km' : ' km'}</div>`
    : `<div class="route-block__km route-block__km--empty">—</div>`;
  const _elevGain = rd.elevationProfile?.elevationGain;
  const elevHtml = _elevGain != null
    ? `<div class="route-block__elev">+${String(Math.round(_elevGain / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, _isEnModal ? ',' : '.')}m</div>`
    : '';
  const tipoHtml = knownPrimaryType
    ? `<div class="route-block__type">${_resolveTypeLabel(knownPrimaryType, rd.secondaryType, race.countryCode)}</div>`
    : '';
  const typeColor = knownPrimaryType ? _resolveTypeColor(knownPrimaryType, rd.secondaryType) : null;

  // — Bloque Horarios (opcional) —
  const startTU  = formatTimeUser(rd.neutralStartTimeUtc);
  const finishTU = formatTimeUser(rd.estimatedFinishTimeUtc);
  const start    = startTU?.display  ?? null;
  const finish   = finishTU?.display ?? null;
  // Jornada cancelada → sin horario: la etapa no se corre y la salida/meta ya
  // no describen nada (paridad con la jornada, las cards y las apps).
  const hasHorarios = !rd.isCancelledDay && !!(start || finish);
  const tzDiffers   = !!(startTU?.tooltip || finishTU?.tooltip);
  const startMadrid  = startTU?.tooltip  ?? start;
  const finishMadrid = finishTU?.tooltip ?? finish;

  const { startLabel, finishLabel } = startFinishLabels(rd, race);

  let horariosHtml = '';
  if (hasHorarios) {
    const startTip  = tzDiffers ? `${startLabel} · Madrid: ${startMadrid}`  : startLabel;
    const finishTip = tzDiffers ? `${finishLabel} · Madrid: ${finishMadrid}` : finishLabel;
    if (start && finish) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTip}">${start}</div>
        ${arrowSvg}
        <div class="route-block__place" data-tooltip="${finishTip}">${finish}</div>`;
    } else if (start) {
      horariosHtml = `<div class="route-block__place" data-tooltip="${startTip}">${start}</div>
        <div class="route-block__note">${startLabel}</div>`;
    } else {
      horariosHtml = `<div class="route-block__place" data-tooltip="${finishTip}">${finish}</div>
        <div class="route-block__note">${finishLabel}</div>`;
    }
  }

  // — Grid de ruta — solo si hay datos de recorrido, distancia, tipo u horarios
  const hasDistType  = !!(rd.distanceKm || knownPrimaryType);
  const hasRouteData = !!(hasLocation || hasDistType || hasHorarios);
  let html = '';

  if (hasRouteData || assetsHtml) {
    // Columnas según bloques visibles
    const blockCount = (hasLocation ? 1 : 0) + (hasDistType ? 1 : 0) + (hasHorarios ? 1 : 0);
    const gridCols = blockCount >= 3 ? '' : blockCount === 2 ? ' route-grid--2col' : ' route-grid--1col';
    html += `<div class="jornada-section jornada-section--route-grid">
    ${assetsHtml}
    ${hasRouteData ? `<div class="route-grid${gridCols}">
      ${hasLocation ? `<div class="route-grid__block">
        <div class="route-grid__title">${t('stage.route')}</div>
        <div class="route-grid__body route-grid__body--route">${recorridoHtml}</div>
      </div>` : ''}
      ${hasDistType ? `<div class="route-grid__block${knownPrimaryType ? ' route-grid__block--type' : ''}"${typeColor ? ` style="--type-color:${typeColor}"` : ''}>
        <div class="route-grid__title">${t('stage.distanceAndType')}</div>
        <div class="route-grid__body">${kmHtml}${elevHtml}${tipoHtml}</div>
      </div>` : ''}
      ${hasHorarios ? `<div class="route-grid__block">
        <div class="route-grid__title" data-tooltip="${tzDiffers ? t('stage.yourTimezone') : t('stage.madridTimezone')}">${t('stage.schedule')}</div>
        <div class="route-grid__body route-grid__body--route">${horariosHtml}</div>
      </div>` : ''}
    </div>` : ''}
  </div>`;
  }

  // — Resultados — (in-house propio O FC/PCS clásicos). Espejo de jornada.js:
  // si hay clasificaciones propias (race_uci_stages.keepForWeb) → botón a nuestra
  // página aunque la carrera no tenga fcId/pcsSlug; FC/PCS quedan como respaldo.
  const _curStageKey = rd.stageNumber == null ? 'final' : rd.stageNumber;
  const _curHasInhouse = inhouseStages.has(_curStageKey);
  const _curResultsAvailable = _shouldShowResults(rd, race) || _curHasInhouse;

  // — Así está la carrera — resultados de la etapa anterior (vueltas por etapas).
  // Solo si los de la etapa ACTUAL aún no están disponibles (no duplicar con la GC del día).
  const _prevStageKey = prevRd ? (prevRd.stageNumber == null ? 'final' : prevRd.stageNumber) : null;
  const _prevHasInhouse = prevRd && !_curResultsAvailable && inhouseStages.has(_prevStageKey);
  if (prevRd && (_shouldShowPreviousResults(prevRd, rd, race) || _prevHasInhouse)) {
    // "Así está la carrera" → clasificación GENERAL (GC) de la etapa anterior,
    // no su clasificación de etapa (#gc selecciona la pestaña General en resultados.js).
    const inhouseUrl = _prevHasInhouse ? _inhouseResultsUrl(race, prevRd.stageNumber, prevRd._stageSuffix) + '#gc' : null;
    const fcUrl  = _buildFcUrl(race, prevRd.stageNumber, prevRd._fcStageNumber);
    const pcsUrl = _buildPcsUrl(race, prevRd.stageNumber, prevRd._stageSuffix);
    const btns = _resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, prevRd.stageNumber);
    if (btns) {
      html += `<div class="jornada-section">
        <div class="jornada-section__title">${t('stage.previousResults')}</div>
        ${btns}
      </div>`;
    }
  }

  // — Resultados (etapa actual) —
  if (_curResultsAvailable) {
    const inhouseUrl = _curHasInhouse ? _inhouseResultsUrl(race, rd.stageNumber, rd._stageSuffix) : null;
    const fcUrl  = _buildFcUrl(race, rd.stageNumber, rd._fcStageNumber);
    const pcsUrl = _buildPcsUrl(race, rd.stageNumber, rd._stageSuffix);
    const btns = _resultsButtonsHtml(inhouseUrl, fcUrl, pcsUrl, race, rd.stageNumber);
    if (btns) {
      html += `<div class="jornada-section">
        <div class="jornada-section__title">${t('stage.results')}</div>
        ${btns}
      </div>`;
    }
  }

  // — Televisión —
  // En la versión EN (/en/), "unavailable_es" es irrelevante: el usuario no está en España.
  // Tratamos el estado como sin marcar para no mostrar "No TV in Spain" y dejar que
  // los broadcasts (filtrados por región) hablen por sí solos.
  const _tvStatus = (_isEnModal && rd.tvStatus === 'unavailable_es') ? null : rd.tvStatus;
  const hasBroadcasts = broadcasts.length > 0;
  const _isReviveBroadcast = b => b.url && (/eurosport|hbo max/i.test(b.channel || '') || /youtube\.com|youtu\.be/i.test(b.url) || b.showInRevive === true);
  const _isRaceConcluded = !!rd.estimatedFinishTimeUtc && _raceTimeCheck(rd, 30);
  const hasReviveBroadcast = hasBroadcasts && _isRaceConcluded && broadcasts.some(_isReviveBroadcast);
  // Carrera concluida → solo mostrar sección si hay broadcasts de tipo Revive
  const hasTvInfo = _isRaceConcluded
    ? hasReviveBroadcast
    : (hasBroadcasts || _tvStatus === 'pending' || _tvStatus === 'none' || _tvStatus === 'unavailable_es');

  if (hasTvInfo) {
    const tvSectionTitle = hasReviveBroadcast ? t('tv.reviveRaceTitle') : t('tv.title');
    const visibleBroadcasts = hasReviveBroadcast
      ? broadcasts.filter(_isReviveBroadcast)
      : broadcasts;

    html += `<div class="jornada-section">
      <div class="jornada-section__title">${tvSectionTitle}</div>`;

    if (hasBroadcasts) {
      visibleBroadcasts.forEach(b => {
        const bTimeTU  = formatTimeUser(b.startTimeUtc);
        const bTime    = hasReviveBroadcast ? null : (bTimeTU?.display ?? null);
        const bTimeTip = bTimeTU?.tooltip ? `Madrid: ${bTimeTU.tooltip}` : null;
        const broadcastEmbed = getBroadcastEmbed(b.url, b.embeddable);
        html += `<div class="tv-entry">
          <div style="flex:1;min-width:0;padding-right:0.75rem">
            <div class="tv-entry__platform">${esc(b.channel || '—')}</div>
            ${!hasReviveBroadcast && b.note ? `<div class="tv-entry__channel" style="font-style:italic">${esc(b.note)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            ${bTime ? `<span class="tv-entry__time${bTimeTip ? ' tv-entry__time--tz' : ''}"${bTimeTip ? ` data-tooltip="${bTimeTip}"` : ''}>${bTime}</span>` : ''}
            ${b.url  ? `<a class="tv-link-btn${broadcastEmbed ? ' tv-link-btn--embed' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener"${broadcastEmbed ? ' data-tv-embed="1"' : ''}>Ver ↗&#xFE0E;</a>` : ''}
          </div>
        </div>`;
      });
    } else {
      const label = TV_STATUS_LABELS[_tvStatus] || t('tv.noInfo');
      html += `<div class="info-row">
        <span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">${label}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // — Descripción —
  if (rd.description) {
    html += `<div class="jornada-section">
      <div class="jornada-description">${_descriptionHtml(rd.description)}</div>
    </div>`;
  }

  // — Bonificaciones —
  if (rd.bonuses) {
    html += `<div class="jornada-section">
      <div class="jornada-section__title">${t('stage.bonuses')}</div>
      <p style="font-size:0.78rem;line-height:1.6;margin:0">${esc(rd.bonuses)}</p>
    </div>`;
  }

  if (rd.notes) {
    html += `<div class="jornada-section">
      <div class="jornada-section__title">${t('stage.notes')}</div>
      <p style="font-size:0.78rem;line-height:1.6;margin:0">${esc(rd.notes)}</p>
    </div>`;
  }

  return html;
}

// ── Exports para reutilización (p. ej. página de Campeonatos) ─────
// URLs de resultados FirstCycling / ProCyclingStats. Para carreras de un día
// (stageNumber null) devuelven la URL de resultado de la prueba.
export function buildFcUrl(race, stageNumber, fcSeqNum)      { return _buildFcUrl(race, stageNumber, fcSeqNum); }
export function buildPcsUrl(race, stageNumber, stageSuffix)  { return _buildPcsUrl(race, stageNumber, stageSuffix); }
// Carrera concluida ≥30 min tras la hora estimada de llegada (misma lógica que las racecards).
export function isRaceConcluded(rd) {
  if (!rd || rd.isRestDay || rd.isCancelledDay) return false;
  return _raceTimeCheck(rd, 30);
}
