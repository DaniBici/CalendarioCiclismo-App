import {CX_AGENDA_SELECT,cxHiddenClasses,cxIsHidden} from './services/cx-data.js';
import {cxHighlightSlide,cxTournamentHighlightSlide} from './cx-highlight.js?v=20260913cxscopes';
import { arrowHtml } from './scroll-rail.js';
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

/**
 * @param {'road'|'cx'} [scope] Sección del cintillo. «Hoy» y el resto de
 * superficies de carretera usan `road`; la agenda de Ciclocross usa `cx`. Cada
 * scope tiene sus propias entradas editoriales y no ve las del otro.
 */
export async function initCintillo(scope = 'road') {
  const el = document.getElementById('giroCountdown');
  if (!el) return;
  if (scope !== 'cx') scope = 'road';

  await initI18n();

  const _isEn = getLang() === 'en';

  // Cintillo manual desde panel admin (tabla today_highlights), filtrado por
  // sección. Cada entrada apunta a una jornada, startlist, orden de salida o,
  // en Ciclocross, a una prueba o un torneo.
  const { data: highlights, error: hlErr } = await supabase
    .from('today_highlights')
    .select('*')
    .eq('scope', scope)
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

  const cxIds=[...new Set(webHighlights.filter(h=>h.targetType==='cxRace').map(h=>h.cxRaceId).filter(Boolean))];
  const cxTournamentIds=[...new Set(webHighlights.filter(h=>h.targetType==='cxTournament').map(h=>h.cxTournamentId).filter(Boolean))];
  const [racesRes, rdsRes, cxRes, cxTournamentsRes] = await Promise.all([
    raceIds.size
      ? supabase.from('races').select('id, name, nameEn, logoUrl, colorHex, slug, slugEn, hideFlag, countryCode, startlistImportedAt').in('id', [...raceIds])
      : Promise.resolve({ data: [] }),
    raceDayIds.size
      ? supabase.from('race_days').select('id, raceId, slug, slugEn, date, stageNumber, startLocation, finishLocation').in('id', [...raceDayIds])
      : Promise.resolve({ data: [] }),
    cxIds.length?Promise.resolve(supabase.from('cx_races').select(CX_AGENDA_SELECT).eq('editorialStatus','published').in('id',cxIds)).catch(()=>({data:[]})):Promise.resolve({data:[]}),
    cxTournamentIds.length?Promise.resolve(supabase.from('cx_tournaments').select('id,name,nameEn,slug,seasonKey,colorHex,logoUrl').in('id',cxTournamentIds)).catch(()=>({data:[]})):Promise.resolve({data:[]}),
  ]);
  // En inglés se descartan las carreras nacionales y los torneos solo nacionales.
  const cxLang=_isEn?'en':'es',hiddenClasses=cxHiddenClasses(cxLang);
  let visibleTournamentIds=null;
  if(hiddenClasses.length&&cxTournamentIds.length){
    let query=supabase.from('cx_races').select('tournamentId').eq('editorialStatus','published').in('tournamentId',cxTournamentIds);
    for(const raceClass of hiddenClasses)query=query.neq('class',raceClass);
    const {data}=await Promise.resolve(query).catch(()=>({data:null}));
    visibleTournamentIds=data?new Set(data.map(row=>row.tournamentId)):null;
  }
  const cxById=Object.fromEntries((cxRes.data||[]).filter(r=>!cxIsHidden(r,cxLang)).map(r=>[r.id,r]));
  const cxTournamentsById=Object.fromEntries((cxTournamentsRes.data||[]).filter(t=>!visibleTournamentIds||visibleTournamentIds.has(t.id)).map(t=>[t.id,t]));
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

  const slides = [];
  webHighlights.forEach(h => {
    if(h.targetType==='cxRace'){
      const slide=cxHighlightSlide(h,cxById[h.cxRaceId],_isEn?'en':'es');
      if(slide)slides.push(_buildGcSlide({...slide,detail:slide.detail||_buildHighlightAutoDetail(h,{date:slide.date},_isEn)}));
      return;
    }
    if(h.targetType==='cxTournament'){
      const slide=cxTournamentHighlightSlide(h,cxTournamentsById[h.cxTournamentId],_isEn?'en':'es');
      if(slide)slides.push(_buildGcSlide(slide));
      return;
    }
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
      logoUrl: h.customLogo || race.logoUrl,
      name: rawName,
      detail,
      colorHex: race.colorHex,
    }));
  });

  if (!slides.length) return;

  const multi = slides.length > 1;
  el.innerHTML = `<div class="giro-card">${multi ? arrowHtml('prev', _isEn ? 'Previous item' : 'Entrada anterior') : ''}<div class="giro-text-area"></div>${multi ? arrowHtml('next', _isEn ? 'Next item' : 'Entrada siguiente') : ''}</div>`;
  el.hidden = false;
  const card = el.querySelector('.giro-card'), area = el.querySelector('.giro-text-area');
  const prev = el.querySelector('[data-direction="prev"]'), next = el.querySelector('[data-direction="next"]');
  let current = 0, manual = false, hovered = false, timer;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncHeight = () => document.documentElement.style.setProperty('--giro-h', el.offsetHeight + 'px');
  const go = index => {
    current = Math.max(0, Math.min(slides.length - 1, index));
    card.style.background = `linear-gradient(${slides[current].bg},${slides[current].bg}),var(--bg-card)`;
    area.innerHTML = slides[current].link;
    if (multi) { prev.disabled = current === 0; next.disabled = current === slides.length - 1; }
    syncHeight();
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
  new ResizeObserver(syncHeight).observe(el);
  go(0); resume();
}
