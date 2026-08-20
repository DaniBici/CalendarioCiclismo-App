// ─────────────────────────────────────────────────────────────────
//  CINTILLO «HOY» — carrusel editorial (tabla today_highlights)
//  Extraído de app.js para compartir con la página de Campeonatos.
//  Monta en #giroCountdown. El CSS vive en css/app.css (.giro-countdown).
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, jornadaUrl, raceUrl, startlistUrl, startOrderUrl }
        from './shared.js';
import { t, getLang, initI18n } from './i18n.js';

// Color de fondo de las entradas custom (sin carrera de la que heredar color):
// el azul de acento del sitio.
const _customAccent = '#1a73e8';

function _hexToRgba(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return `rgba(136,136,136,${a})`;
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}

function _buildGcSlide({ href, logoUrl, iconSvg, name, detail, colorHex }) {
  return {
    bg: _hexToRgba(colorHex, 0.16),
    link: `<a class="giro-countdown__link" href="${href}">
      ${iconSvg
          ? iconSvg
          : (logoUrl ? `<img class="giro-countdown__logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="giro-countdown__logo"></span>')}
      <span class="giro-countdown__body">
        <span class="giro-countdown__title-row">
          <span class="giro-countdown__name">${name}</span>
          <svg class="giro-countdown__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
        <span class="giro-countdown__days">${detail}</span>
      </span>
    </a>`
  };
}

// Auto-detail si el admin no especificó customDetail: "Hoy", "Mañana", "Empieza el X", etc.
function _buildHighlightAutoDetail(h, rd, isEn) {
  const _today = toDateKey(new Date());
  const _tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateKey(d); })();
  const MONTHS = t('months.short') || ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fmtDate = (k) => {
    if (!k) return '';
    const d = new Date(k + 'T00:00:00');
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };

  // Para destinos atados a jornada (raceDay / startOrder), usar fecha de la jornada
  if (rd?.date) {
    if (rd.date === _today)    return `<strong>${isEn ? 'Today' : 'Hoy'}</strong>`;
    if (rd.date === _tomorrow) return `<strong>${isEn ? 'Tomorrow' : 'Mañana'}</strong>`;
    return `<strong>${fmtDate(rd.date)}</strong>`;
  }
  // Destino tipo startlist: sin jornada concreta
  return isEn ? '<strong>Startlist</strong>' : '<strong>Dorsales</strong>';
}

export async function initCintillo() {
  const el = document.getElementById('giroCountdown');
  if (!el) return;

  await initI18n();

  const _isEn = getLang() === 'en';

  // Cintillo manual desde panel admin (tabla today_highlights).
  // Cada entrada apunta a una jornada, startlist u orden de salida.
  const { data: highlights, error: hlErr } = await supabase
    .from('today_highlights')
    .select('*')
    .or(`visibleFrom.is.null,visibleFrom.lte.${new Date().toISOString()}`)
    .or(`visibleUntil.is.null,visibleUntil.gte.${new Date().toISOString()}`)
    .order('position', { ascending: true });

  if (hlErr || !highlights || highlights.length === 0) return;

  // 'championships' es un destino SOLO-APPS: las apps lo pintan con su pantalla
  // nativa de Campeonatos; la web lo ignora por completo (para la web se usa un
  // slide 'custom' con logo/URL propios). Se filtra ANTES de resolver carreras,
  // del hash de dismiss y del render, para que la web actúe como si no existiera.
  const webHighlights = highlights.filter(h => h.targetType !== 'championships');
  if (webHighlights.length === 0) return;

  // Resolver carrera y jornada para cada entrada
  const raceIds = new Set();
  const raceDayIds = new Set();
  webHighlights.forEach(h => {
    if (h.raceId) raceIds.add(h.raceId);
    if (h.raceDayId) raceDayIds.add(h.raceDayId);
  });

  const [racesRes, rdsRes] = await Promise.all([
    raceIds.size
      ? supabase.from('races').select('id, name, nameEn, logoUrl, colorHex, slug, slugEn, hideFlag, countryCode, startlistImportedAt').in('id', [...raceIds])
      : Promise.resolve({ data: [] }),
    raceDayIds.size
      ? supabase.from('race_days').select('id, raceId, slug, slugEn, date, stageNumber, startLocation, finishLocation').in('id', [...raceDayIds])
      : Promise.resolve({ data: [] }),
  ]);
  const racesById = Object.fromEntries((racesRes.data || []).map(r => [r.id, r]));
  const rdsById   = Object.fromEntries((rdsRes.data  || []).map(r => [r.id, r]));

  // Cargar también la raza padre de cada raceDay (para nombre/logo si solo viene raceDayId)
  const parentRaceIds = new Set([...raceIds, ...(rdsRes.data || []).map(rd => rd.raceId)].filter(Boolean));
  if (parentRaceIds.size > raceIds.size) {
    const missing = [...parentRaceIds].filter(id => !racesById[id]);
    if (missing.length) {
      const { data: extra } = await supabase.from('races').select('id, name, nameEn, logoUrl, colorHex, slug, slugEn, hideFlag, countryCode, startlistImportedAt').in('id', missing);
      (extra || []).forEach(r => { racesById[r.id] = r; });
    }
  }

  // Dismiss por hash de contenido — al cambiar el cintillo reaparece
  const contentHash = webHighlights.map(h => `${h.id}:${h.targetType}:${h.position}:${h.updatedAt}`).join('|');
  const dismissedHash = localStorage.getItem('cc_giro_dismissed_hash');
  if (dismissedHash === contentHash) return;

  const slides = [];
  webHighlights.forEach(h => {
    // Mercado de fichajes: destino fijo /fichajes/ (+ EN /en/transfers/), sin
    // carrera. Las apps lo pintan con su pantalla nativa de Fichajes (4.0);
    // las versiones antiguas lo descartan solas (targetType desconocido).
    if (h.targetType === 'transfers') {
      const href = _isEn ? '/en/transfers/' : '/fichajes/';
      const name = _isEn
        ? (h.customTitleEn || h.customTitle || 'Transfer market')
        : (h.customTitle || 'Mercado de Fichajes');
      const detail = _isEn ? (h.customDetailEn || h.customDetail || '') : (h.customDetail || '');
      const iconSvg = h.customLogo
        ? null
        : `<svg class="giro-countdown__logo giro-countdown__logo--transfers" viewBox="0 0 24 24" fill="none" stroke="${_customAccent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7H4"/><polyline points="8 3 4 7 8 11"/><path d="M4 17h16"/><polyline points="16 13 20 17 16 21"/></svg>`;
      slides.push(_buildGcSlide({
        href,
        iconSvg,
        logoUrl: h.customLogo || null,
        name,
        detail,
        colorHex: _customAccent,
      }));
      return;
    }

    // Entrada custom (solo web): título/subtítulo/URL/logo propios, sin carrera.
    // Las apps la descartan automáticamente (no resuelven carrera).
    if (h.targetType === 'custom') {
      const href = (_isEn ? (h.customUrlEn || h.customUrl) : h.customUrl);
      if (!href) return;
      const name = _isEn ? (h.customTitleEn || h.customTitle) : h.customTitle;
      if (!name) return;
      const detail = _isEn ? (h.customDetailEn || h.customDetail || '') : (h.customDetail || '');
      slides.push(_buildGcSlide({
        href,
        logoUrl: h.customLogo || null,
        name,
        detail,
        colorHex: _customAccent,
      }));
      return;
    }

    const race = h.raceId
      ? racesById[h.raceId]
      : (h.raceDayId && rdsById[h.raceDayId] ? racesById[rdsById[h.raceDayId].raceId] : null);
    if (!race) return;
    const rd = h.raceDayId ? rdsById[h.raceDayId] : null;

    let href = null;
    if (h.targetType === 'startlist') {
      href = startlistUrl(race);
    } else if (h.targetType === 'race') {
      href = raceUrl(race);
    } else if (h.targetType === 'startOrder' && rd) {
      href = startOrderUrl(rd);
    } else if (h.targetType === 'raceDay' && rd) {
      href = jornadaUrl(rd);
    }
    if (!href) return;

    const rawName = _isEn ? (h.customTitleEn || h.customTitle || race.nameEn || race.name) : (h.customTitle || race.name);
    const rawDetail = _isEn ? (h.customDetailEn || h.customDetail) : h.customDetail;
    // Detalle custom va en regular (el CSS .giro-countdown__days es regular);
    // el auto-detail lleva <strong> interno para destacar la palabra clave.
    const detail = rawDetail
      ? rawDetail
      : _buildHighlightAutoDetail(h, rd, _isEn);

    slides.push(_buildGcSlide({
      href,
      logoUrl: race.logoUrl,
      name: rawName,
      detail,
      colorHex: race.colorHex,
    }));
  });

  if (!slides.length) return;

  const multi = slides.length > 1;
  const dotLabel = getLang() === 'en' ? 'Go to slide' : 'Ir a la diapositiva';
  const dotsHtml = multi
    ? `<div class="giro-countdown__dots">${slides.map((_,i) => `<button class="gc-dot${i===0?' gc-dot--active':''}" data-idx="${i}" aria-label="${dotLabel} ${i+1}"></button>`).join('')}</div>`
    : '';
  const closeBtn = `<button class="giro-countdown__close" aria-label="Cerrar">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
        </button>`;

  el.innerHTML =
    `<div class="giro-card">` +
      slides.map((s, i) => `<div class="giro-bg${i===0?' giro-bg--active':''}" style="background:${s.bg}"></div>`).join('') +
      `<div class="giro-countdown__inner">
        <div class="giro-text-area">
          ${slides.map((s, i) => `<div class="giro-text${i===0?' giro-text--active':''}">${s.link}</div>`).join('')}
        </div>
      </div>` +
      closeBtn +
      dotsHtml +
    `</div>`;

  el.hidden = false;
  document.documentElement.style.setProperty('--giro-h', el.offsetHeight + 'px');

  let gcTimer;
  if (multi) {
    let cur = 0;
    const bgEls   = el.querySelectorAll('.giro-bg');
    const textEls = el.querySelectorAll('.giro-text');
    const dotEls  = el.querySelectorAll('.gc-dot');
    function gcGoTo(idx) {
      bgEls[cur].classList.remove('giro-bg--active');
      textEls[cur].classList.remove('giro-text--active');
      dotEls[cur]?.classList.remove('gc-dot--active');
      cur = idx;
      bgEls[cur].classList.add('giro-bg--active');
      textEls[cur].classList.add('giro-text--active');
      dotEls[cur]?.classList.add('gc-dot--active');
    }
    gcTimer = setInterval(() => gcGoTo((cur + 1) % slides.length), 5000);
    dotEls.forEach(dot => dot.addEventListener('click', () => {
      clearInterval(gcTimer);
      gcGoTo(parseInt(dot.dataset.idx));
    }));

    // Swipe horizontal (móvil)
    const textArea = el.querySelector('.giro-text-area');
    let tStartX = 0, tStartY = 0, tStartTime = 0, suppressClick = false;
    textArea.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      tStartX = e.touches[0].clientX;
      tStartY = e.touches[0].clientY;
      tStartTime = Date.now();
    }, { passive: true });
    textArea.addEventListener('touchend', (e) => {
      const tt = e.changedTouches[0];
      const dx = tt.clientX - tStartX;
      const dy = tt.clientY - tStartY;
      const dt = Date.now() - tStartTime;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt <= 600) {
        clearInterval(gcTimer);
        gcGoTo(dx < 0 ? (cur + 1) % slides.length : (cur - 1 + slides.length) % slides.length);
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 400);
      }
    }, { passive: true });
    textArea.addEventListener('click', (e) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  el.querySelector('.giro-countdown__close').addEventListener('click', () => {
    clearInterval(gcTimer);
    el.hidden = true;
    document.documentElement.style.setProperty('--giro-h', '0px');
    // Dismiss por hash: reaparece automáticamente cuando el admin cambie el cintillo
    localStorage.setItem('cc_giro_dismissed_hash', contentHash);
  });
}
