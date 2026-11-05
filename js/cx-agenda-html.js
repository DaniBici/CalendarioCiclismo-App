// ─────────────────────────────────────────────────────────────────
//  AGENDA Y TORNEO CX — tarjetas de carrera y página de torneo, sin DOM
//  Lo usan js/ciclocross.js (agenda, home de Ciclocross y torneo) y el paso de
//  build que escribe /ciclocross/torneos/<slug>/ y /en/cyclocross/series/<slug>/
//  (tools/site/prerender-cx.mjs).
//
//  Lo que en la tarjeta depende del momento y de la región (estado de cada
//  categoría con horario, insignias de TV, resumen y dorsales, marca de hoy) se
//  escribe con `dynamic: true`; con `dynamic: false` queda vacío y refreshTiming()
//  de js/ciclocross.js lo llena en su sitio. La huella de la lista del torneo
//  (js/html-fingerprint.js) es la de esa versión, que no depende de la hora, la
//  zona ni la región.
// ─────────────────────────────────────────────────────────────────

import {waitingResultsHtml,resultsTrophyHtml,startlistCyclistHtml,tvIconHtml} from './services/race-presentation.js';
import {cxLogoHtml} from './components/cx-logo.js';
import {raceCardHtml,overviewButtonHtml} from './components/race-card.js';
import {countryFlag,categoryBadge,buildRaceHeader,formatDateLabel,filterBroadcastsByRegion,seoShortMonth} from './shared.js';
import {t,getLang,getLocale} from './i18n.js';
import {cxListedInAgenda,CX_SPANISH_AUDIENCE} from './services/cx-data.js';
import {cxEsc as esc,cxMonthDays,cxCategories,cxColor,cxRaceName,cxRaceUrl,cxTournamentUrl,cxTournamentPageUrl,cxRacePageUrl,cxAgendaBroadcast,cxAgendaVideo,cxAgendaStartlistCategory,cxCategoryCardState,cxUsesCategoryBadges,cxTime,cxClassLabel,cxRoundBadge,cxRacePlaceholder,cxPlaceholderMessage} from './cx/presentation.js';
import {CX_CATEGORIES} from './cx/editor-logic.js';
import {cxTvEmbedAttrs} from './cx/tv-modal.js';

// Estado vacío con la presentación de Hoy en Carretera (icono + texto).
export const CX_EMPTY_ICON_HTML='<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const cxEmptyStateHtml=()=>`<div class="empty-state"><div class="empty-state__icon">${CX_EMPTY_ICON_HTML}</div><div class="empty-state__text">${esc(t('cx.noRaces'))}</div></div>`;

function cellMeta(race,c) {
  const lang=getLang(),phase=cxCategoryCardState(race,c),results=phase==='results';
  const value=phase==='cancelled'?t('stage.cancelled'):results?t('cx.result'):phase==='awaiting'?t('cx.pendingShort'):(cxTime(c.startTimeUtc,getLocale())||'');
  return {results,href:results?cxRacePageUrl(race,lang,'results',c.category):cxRaceUrl(race,lang,c.category),label:`${t(`cx.category.${c.category}`)}: ${phase==='time'&&!c.startTimeUtc?t('stage.noSchedule'):value}`};
}
// Horario, copa, espera o cancelación bajo la caja de categoría, fuera de
// ella, con la tipografía de salida/meta de Hoy en Carretera. Solo las cards
// abiertas (`open`) llevan el copa enlazado a resultados.
export function cxCardScheduleHtml(race,c,open) {
  const lang=getLang(),phase=cxCategoryCardState(race,c),results=phase==='results';
  const time=cxTime(c.startTimeUtc,getLocale())||'';
  if(results) {
    const label=`${t(`cx.category.${c.category}`)}: ${t('cx.result')}`;
    return open?`<a class="badge badge--results badge--icon" href="${esc(cxRacePageUrl(race,lang,'results',c.category))}" title="${esc(label)}" aria-label="${esc(label)}">${resultsTrophyHtml}<span class="badge__label">${esc(t('cx.result'))}</span></a>`:resultsTrophyHtml;
  }
  if(phase==='awaiting')return waitingResultsHtml(lang,'span');
  // Cancelada: aspa roja de trazo grueso, como la X del emblema de
  // ciclocross, en la mitad central del hueco de la categoría.
  if(phase==='cancelled')return `<svg class="cx-category-cross" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${esc(t('stage.cancelled'))}"><path d="M0 0L100 100M100 0L0 100" vector-effect="non-scaling-stroke"/></svg>`;
  return `<strong class="cx-category-hour"${time?'':` title="${esc(t('stage.noSchedule'))}"`}>${esc(time||'-')}</strong>`;
}
// Badge de TV de la Agenda (cxAgendaBroadcast): hora de la primera emisión
// del día en la región del usuario y «En directo» desde que empieza hasta que
// concluyen todas las categorías; enlaza a la última emisión ya iniciada, que
// se abre en el modal de TV cuando es embebible.
function tvBadgeHtml(race,date) {
  const row=cxAgendaBroadcast(race,date,filterBroadcastsByRegion(race.cx_broadcasts||[]));
  if(!row)return '';
  const label=row.live?t('tv.live'):row.firstStartUtc?cxTime(row.firstStartUtc,getLocale()):'TV';
  return `<a class="badge badge--tv badge--tv-link${row.live?' badge--tv--live':''}" href="${esc(row.url)}" target="_blank" rel="noopener" title="${esc(row.channel||'')}"${cxTvEmbedAttrs(row)}>${tvIconHtml} ${esc(label)}</a>`;
}
// Badge de resumen: vídeos de YouTube de la prueba, incluidas las emisiones
// que ya son vídeo; abre la vista de vídeos de la ficha. Solo en tarjetas que
// abren la ficha.
function summaryBadgeHtml(race,date,open) {
  if(!open||!cxAgendaVideo(race,date,race.cx_videos,filterBroadcastsByRegion(race.cx_broadcasts||[])))return '';
  return `<a class="badge badge--tv badge--tv-link badge--summary" href="${esc(cxRacePageUrl(race,getLang(),'videos'))}">${tvIconHtml} <span class="badge__text">${esc(t('cx.summary'))}</span></a>`;
}
export function cxCardBadgesHtml(race,date,open) {
  const startlist=open?cxAgendaStartlistCategory(race,date):null;
  return `${tvBadgeHtml(race,date)}${summaryBadgeHtml(race,date,open)}${startlist?`<a class="badge badge--startlist" href="${esc(cxRacePageUrl(race,getLang(),'startlist',startlist.category))}">${startlistCyclistHtml} <span class="badge__text">${esc(t('stage.startlistLabel'))}</span></a>`:''}`;
}

/**
 * Entradas de la tarjeta para refreshTiming(): `badges:<carrera>:<día>` →
 * [carrera, día, abierta] y, sin badges de categoría, `<carrera>:<categoría>:<día>`
 * → [carrera, categoría].
 */
export function cxAgendaCardEntries(race,date) {
  const open=!cxRacePlaceholder(race),entries=[[`badges:${race.id}:${date}`,[race,date,open]]];
  if(!cxUsesCategoryBadges(race,date))for(const c of cxCategories(race,date))entries.push([`${race.id}:${c.category}:${date}`,[race,c]]);
  return entries;
}

/**
 * Tarjeta de la carrera en el día `date`. `rounds`: rondas de la temporada
 * (cxSeasonRounds); `inTournament`: página de torneo (sin el torneo en la
 * tarjeta); `dynamic`: con el estado de las categorías con horario y las
 * insignias (si no, vacíos para refreshTiming()).
 */
export function cxAgendaCardHtml(race,date,{rounds=null,inTournament=false,dynamic=true}={}) {
  const lang=getLang(),url=cxRaceUrl(race,lang),color=cxColor(race);
  // Sin documento (Libro de Ruta o Mapa) o sin horarios, la ficha no está
  // lista: card placeholder de Hoy, no enlaza a la carrera ni a sus categorías
  // y abre el aviso de información (tooltip/modal).
  const placeholder=cxRacePlaceholder(race),open=!placeholder;
  const href=open?`<a href="${esc(url)}">`:'<span>',hrefEnd=open?'</a>':'</span>';
  const categories=cxCategories(race,date),badges=cxUsesCategoryBadges(race,date);
  const tournament=race.cx_tournaments,tournamentUrl=tournament&&!inTournament?cxTournamentUrl(tournament,lang):null;
  const round=cxRoundBadge(rounds?.get(race.id));
  const menu=tournamentUrl?overviewButtonHtml(esc(tournamentUrl),esc(cxRaceName(tournament,lang))):'';
  const sep='<span class="race-card__sep">·</span>';
  // Torneo y sede en su propio elemento para recortarse con puntos suspensivos.
  const metaText=(text,venue=false)=>`<span class="cx-card-meta-text${venue?' cx-card-meta-text--venue':''}">${esc(text)}</span>`;
  const meta=[tournamentUrl?metaText(cxRaceName(tournament,lang)):'',round,race.venue&&race.venue!==cxRaceName(race,lang)?metaText(race.venue,true):''].filter(Boolean).join(sep);
  // Datos del aviso placeholder (mismo banner/tooltip que Hoy en Carretera).
  // Día y mes abreviado con tablas fijas, igual que toLocaleDateString.
  const shortDate=`${Number(date.slice(8))} ${seoShortMonth(Number(date.slice(5,7))-1,lang==='en'?'en':'es')}`;
  const phData=placeholder?` data-ph-tooltip="${esc(cxPlaceholderMessage(race))}" data-ph-name="${esc(cxRaceName(race,lang))}" data-ph-flag="${esc(countryFlag(race.countryCode))}" data-ph-sub="${esc([cxClassLabel(race.class,lang),shortDate].join(' · '))}"`:'';
  const categoriesHtml=`<div class="race-card__meta cx-category-times${badges?' cx-category-times--badges':''}" style="--cx-category-count:${categories.length||1}" aria-label="${t('cx.categories')}">${categories.map(c=>{
    const catName=t(`cx.category.${c.category}`);
    if(badges) {
      const {href:catHref,label}=cellMeta(race,c);
      const catAttrs=open?` href="${esc(catHref)}" aria-label="${esc(label)}" title="${esc(label)}"`:` aria-label="${esc(label)}" title="${esc(label)}"`;
      return `<${open?'a':'span'} class="badge badge--uci cx-category-badge"${catAttrs}>${c.category}</${open?'a':'span'}>`;
    }
    // Con horarios: caja solo con el código (mismo ancho, menos alta) y el
    // horario o el copa debajo, fuera de la caja. Las abiertas los repintan
    // con la hora (refreshTiming); las placeholder, no.
    const key=`${race.id}:${c.category}:${date}`;
    const boxAttrs=open?` href="${esc(cxRaceUrl(race,lang,c.category))}" aria-label="${esc(catName)}" title="${esc(catName)}"`:` aria-label="${esc(catName)}" title="${esc(catName)}"`;
    return `<span class="cx-category-cell"${open?` data-cx-timing="${esc(key)}"`:''}><${open?'a':'span'} class="cx-category-box"${boxAttrs}>${c.category}</${open?'a':'span'}><span class="cx-category-state">${dynamic||!open?cxCardScheduleHtml(race,c,open):''}</span></span>`;
  }).join('')}</div>`;
  // Logo con el de su torneo de respaldo; sin ninguno, el hueco se oculta.
  const logo=cxLogoHtml(race,tournament,{onUnavailable:"this.closest('.race-card__logo').classList.add('race-card__logo--without-logo')"});
  // Estructura común de components/race-card.js; la columna derecha son las
  // categorías con su horario o su resultado.
  const inner=raceCardHtml({
    logo:`<div class="race-card__logo${logo?'':' race-card__logo--without-logo'}"><span data-cx-logo-race="${esc(race.id)}">${logo}</span><span>${countryFlag(race.countryCode)}</span></div>`,
    name:`${href}${esc(cxRaceName(race,lang))}${hrefEnd}${menu}`,
    sub:meta,
    badges:`<span class="race-card__name-cat">${categoryBadge(cxClassLabel(race.class,lang))}</span><span class="cx-card-badges" data-cx-badges="${esc(`${race.id}:${date}`)}">${dynamic?cxCardBadgesHtml(race,date,open):''}</span>`,
    metaBlock:categoriesHtml,
  });
  return `<article class="race-card race-card--cx${placeholder?' race-card--placeholder':''}" ${color?`style="--card-color:${color}"`:''}${open?` data-href="${esc(url)}"`:''}${phData}>${inner}${open?'<span class="feed-row__chevron cx-card-chevron" aria-hidden="true">›</span>':`<a class="race-card__seo-link" href="${esc(url)}">${esc(cxRaceName(race,lang))}</a>`}</article>`;
}

/**
 * Día de la lista del torneo. `todayKey`: día local de hoy, con su marca
 * (null sin marca: la pone refreshTiming()).
 */
function cxAgendaDayHtml(day,{todayKey=null,...card}={}) {
  // La etiqueta del día replica a las apps (formatDateLabel): texto plano
  // "Miércoles, 8 de abril", sin círculo con el número ni año.
  return `<section class="cal-day cx-agenda-day${day.date===todayKey?' cal-day--today':''}" data-date="${day.date}"><h3 class="cal-day__head cx-day-label">${esc(formatDateLabel(day.date))}</h3><div class="cal-day__races cx-day-races">${day.races.map(r=>cxAgendaCardHtml(r,day.date,{...card,inTournament:true})).join('')}</div></section>`;
}

// ── Página de torneo ──────────────────────────────────────────────
// Categorías con general configurada: con alguna, la página lleva las
// secciones Carreras y General.
export const cxTournamentStandingCategories=tournament=>CX_CATEGORIES.filter(code=>tournament.pointsScheme?.categories?.[code]);

/**
 * Esqueleto de la página de torneo: cabecera, secciones (ocultas hasta saber si
 * hay generales; `standingsVisible` las muestra), aviso de error, lista y
 * general. `list`: contenido de la lista ({ inner, prerendered }), vacía por
 * defecto.
 */
export function cxTournamentSkeletonHtml(tournament,{standingsVisible=false,list={inner:''}}={}) {
  const lang=getLang(),name=cxRaceName(tournament,lang);
  const heading=buildRaceHeader({race:{...tournament,name,nameEn:name},hideFlag:!tournament.countryCode,nameHref:''});
  // Secciones del torneo, como las de la ficha de carrera: Carreras y, cuando
  // hay generales publicadas, General.
  const sectionNavHtml=cxTournamentStandingCategories(tournament).length?`<div class="res-tabs-bar cx-section-nav" data-cx-tournament-sections${standingsVisible?'':' hidden'}><nav class="res-tabs" aria-label="${esc(name)}"><div class="res-tabs__scroll"><div class="res-tabs__inner">${[['races',t('cx.races')],['general',t('cx.general')]].map(([key,label])=>`<a class="res-tab" data-cx-tournament-section="${key}" href="${esc(cxTournamentPageUrl(tournament,lang,key))}">${esc(label)}</a>`).join('')}</div></div></nav></div><div data-cx-general-nav hidden></div>`:'';
  return `<div class="cx-agenda-sticky">${heading}${sectionNavHtml}</div><p id="cxAgendaError" role="alert"></p><div id="cxAgendaList"${list.prerendered?` data-prerendered="${list.prerendered}"`:''}>${list.inner}</div><div class="cx-tournament-standings" id="cxStandings" hidden></div>`;
}

/**
 * Pruebas del torneo en la temporada (`rows`: cxSeasonRows): las propias sin
 * cancelar, las visibles en el idioma y sus días en los meses de la temporada.
 */
export function cxTournamentDays(tournamentId,rows,months) {
  const lang=getLang();
  const ownRows=rows.filter(race=>race.tournamentId===tournamentId&&!race.isCancelled);
  const tournamentRows=ownRows.filter(race=>cxListedInAgenda(race,lang));
  return {ownRows,tournamentRows,days:months.flatMap(key=>cxMonthDays(tournamentRows,key))};
}

/** Contenido de la lista del torneo: aviso de torneo solo nacional en inglés, estado vacío o los días. */
export function cxTournamentListHtml(tournament,{ownRows,tournamentRows,days},card={}) {
  // Torneo solo nacional en inglés: aviso con enlace a la versión en castellano.
  if(ownRows.length&&!tournamentRows.length)return `<div class="empty-state"><div class="empty-state__text"><strong>${esc(CX_SPANISH_AUDIENCE.title)}</strong><br>${esc(CX_SPANISH_AUDIENCE.text)}</div><a class="btn btn--ghost" href="${esc(cxTournamentUrl(tournament,'es'))}">${esc(CX_SPANISH_AUDIENCE.link)}</a></div>`;
  if(!days.length)return cxEmptyStateHtml();
  return `<section class="cx-tournament-list">${days.map(day=>cxAgendaDayHtml(day,card)).join('')}</section>`;
}
