import { arrowHtml } from './scroll-rail.js';
// ─────────────────────────────────────────────────────────────────
//  CINTILLO «HOY» — carrusel editorial (tabla today_highlights)
//  Extraído de app.js para compartir con la página de Campeonatos.
//  Monta en #giroCountdown. El CSS vive en css/app.css (.giro-countdown).
// ─────────────────────────────────────────────────────────────────

import { supabase, toDateKey, jornadaUrl, raceUrl, startlistUrl, startOrderUrl }
        from './shared.js';
import { t, getLang, initI18n } from './i18n.js';
import { writeCalendarParams } from './calendario-query.js';

// Color de los iconos de los destinos sin logotipo (Fichajes, Temporada): el
// azul de acento del sitio. La franja no lleva tinte de carrera, como en las
// apps.
const _customAccent = '#1a73e8';

function _buildGcSlide({ href, logoUrl, iconSvg, name, detail }) {
  return {
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

/**
 * @param {'road'|'cx'|Array<'road'|'cx'>} [scope] Sección del cintillo. «Hoy»
 * y el resto de superficies de carretera usan `road`; la agenda de Ciclocross
 * usa `cx`. Cada scope tiene sus propias entradas editoriales y no ve las del
 * otro. Con varias secciones (Ciclocross mientras es la home, sin Hoy de
 * carretera visible), el cintillo es único: las entradas de cada sección por
 * `position`, en el orden de la lista.
 */
export async function initCintillo(scope = 'road') {
  const el = document.getElementById('giroCountdown');
  if (!el) return;
  const scopes = [...new Set([scope].flat().map(s => s === 'cx' ? 'cx' : 'road'))];

  const _isEn = getLang() === 'en';
  const cxModulePromise = scopes.includes('cx') ? import('./cintillo-cx.js') : null;
  cxModulePromise?.catch(() => {});

  // Cintillo manual desde panel admin (tabla today_highlights), filtrado por
  // sección. Cada entrada apunta a una jornada, startlist, orden de salida o,
  // en Ciclocross, a una prueba o un torneo. Se pide a la vez que el
  // diccionario EN.
  const [{ data: highlights, error: hlErr }] = await Promise.all([
    supabase
      .from('today_highlights')
      .select('*')
      .in('scope', scopes)
      .or(`visibleFrom.is.null,visibleFrom.lte.${new Date().toISOString()}`)
      .or(`visibleUntil.is.null,visibleUntil.gte.${new Date().toISOString()}`)
      .order('position', { ascending: true }),
    initI18n(),
  ]);
  if (highlights && scopes.length > 1) highlights.sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || a.position - b.position);

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

  const cxIds=[...new Set(webHighlights.filter(h=>h.targetType==='cxRace').map(h=>h.cxRaceId).filter(Boolean))];
  const cxTournamentIds=[...new Set(webHighlights.filter(h=>h.targetType==='cxTournament').map(h=>h.cxTournamentId).filter(Boolean))];
  // El código de Ciclocross solo se descarga si hay entradas de CX o la
  // sección `cx` está activa (en ese caso, en paralelo a la lectura editorial).
  const cxLang=_isEn?'en':'es';
  const noCx={module:null,cxById:{},cxTournamentsById:{}};
  const cxLoad=cxIds.length||cxTournamentIds.length
    ?(cxModulePromise||import('./cintillo-cx.js'))
      .then(async module=>({module,...await module.loadCxHighlightData(supabase,cxIds,cxTournamentIds,cxLang)}))
      .catch(()=>noCx)
    :noCx;
  // La jornada lleva su carrera embebida (nombre/logo si solo viene raceDayId):
  // todas las lecturas salen en un único round-trip.
  const RACE_COLUMNS = 'id, name, nameEn, logoUrl, slug, slugEn, hideFlag, countryCode, startlistImportedAt';
  const [racesRes, rdsRes, cxData] = await Promise.all([
    raceIds.size
      ? supabase.from('races').select(RACE_COLUMNS).in('id', [...raceIds])
      : Promise.resolve({ data: [] }),
    raceDayIds.size
      ? supabase.from('race_days').select(`id, raceId, slug, slugEn, date, stageNumber, startLocation, finishLocation, race:races(${RACE_COLUMNS})`).in('id', [...raceDayIds])
      : Promise.resolve({ data: [] }),
    cxLoad,
  ]);
  const {module:cxModule,cxById,cxTournamentsById}=cxData;
  const racesById = Object.fromEntries((racesRes.data || []).map(r => [r.id, r]));
  const rdsById = {};
  (rdsRes.data || []).forEach(({ race, ...rd }) => {
    rdsById[rd.id] = rd;
    if (race && !racesById[race.id]) racesById[race.id] = race;
  });

  const slides = [];
  webHighlights.forEach(h => {
    if(h.targetType==='cxRace'){
      const slide=cxModule?.cxHighlightSlide(h,cxById[h.cxRaceId],_isEn?'en':'es');
      if(slide)slides.push(_buildGcSlide({...slide,detail:slide.detail||_buildHighlightAutoDetail(h,{date:slide.date},_isEn)}));
      return;
    }
    if(h.targetType==='cxTournament'){
      const slide=cxModule?.cxTournamentHighlightSlide(h,cxTournamentsById[h.cxTournamentId],_isEn?'en':'es');
      if(slide)slides.push(_buildGcSlide(slide));
      return;
    }
    // Mercado de fichajes: destino fijo /fichajes/ (+ EN /en/transfers/), sin
    // carrera. Las apps lo pintan con su pantalla nativa de Fichajes (4.0);
    // las versiones antiguas lo descartan solas (targetType desconocido).
    if (h.targetType === 'transfers') {
      const href = _isEn ? '/en/transfers/' : '/fichajes/';
      const name = _isEn
        ? (h.customTitleEn || h.customTitle || 'Transfer Market')
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
      }));
      return;
    }

    // Calendario de una temporada: /calendario/ (+ EN /en/calendar/) en la
    // subvista Temporada. Un año distinto del actual abre en enero; el actual,
    // en el mes en curso. Las apps abren su pestaña Calendario (5.0.11).
    if (h.targetType === 'season') {
      const year = Number(h.seasonYear);
      if (!year) return;
      const month = year === new Date().getFullYear() ? null : `${year}-01`;
      const qs = writeCalendarParams(new URLSearchParams(), _isEn ? 'en' : 'es', { view: 'temporada', month });
      const name = _isEn
        ? (h.customTitleEn || h.customTitle || `${year} calendar`)
        : (h.customTitle || `Calendario ${year}`);
      const detail = _isEn ? (h.customDetailEn || h.customDetail || '') : (h.customDetail || '');
      slides.push(_buildGcSlide({
        href: `${_isEn ? '/en/calendar/' : '/calendario/'}?${qs}`,
        iconSvg: `<svg class="giro-countdown__logo" viewBox="0 0 24 24" fill="none" stroke="${_customAccent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
        name,
        detail,
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
      logoUrl: h.customLogo || race.logoUrl,
      name: rawName,
      detail,
    }));
  });

  if (!slides.length) return;

  const multi = slides.length > 1;
  el.innerHTML = `<div class="giro-card">${multi ? arrowHtml('prev', _isEn ? 'Previous item' : 'Entrada anterior') : ''}<div class="giro-text-area"></div>${multi ? arrowHtml('next', _isEn ? 'Next item' : 'Entrada siguiente') : ''}</div>`;
  el.hidden = false;
  const area = el.querySelector('.giro-text-area');
  const prev = el.querySelector('[data-direction="prev"]'), next = el.querySelector('[data-direction="next"]');
  let current = 0, manual = false, hovered = false, timer;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const go = index => {
    current = Math.max(0, Math.min(slides.length - 1, index));
    area.innerHTML = slides[current].link;
    if (multi) { prev.disabled = current === 0; next.disabled = current === slides.length - 1; }
  };
  const stop = () => { clearInterval(timer); timer = null; };
  const resume = () => {
    stop();
    if (multi && !manual && !hovered && !document.hidden && !el.contains(document.activeElement) && !reduced.matches)
      timer = setInterval(() => go((current + 1) % slides.length), 5000);
  };
  const select = delta => { manual = true; stop(); go(current + delta); };
  prev?.addEventListener('click', () => select(-1));
  next?.addEventListener('click', () => select(1));
  el.addEventListener('mouseenter', () => { hovered = true; stop(); });
  el.addEventListener('mouseleave', () => { hovered = false; resume(); });
  el.addEventListener('focusin', stop);
  el.addEventListener('focusout', () => setTimeout(resume, 0));
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', stop);
  reduced.addEventListener('change', resume);
  let startX = 0, startY = 0, suppressClick = false;
  area.addEventListener('touchstart', event => { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }, { passive:true });
  area.addEventListener('touchend', event => {
    const dx = event.changedTouches[0].clientX - startX, dy = event.changedTouches[0].clientY - startY;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      select(dx < 0 ? 1 : -1); suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 400);
    }
  }, { passive:true });
  area.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); }
    else { manual = true; stop(); }
  }, true);
  go(0); resume();
}
