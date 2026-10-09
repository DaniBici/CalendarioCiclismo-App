import {initCintillo} from './cintillo.js';
import {waitingResultsHtml,resultsTrophyHtml} from './services/race-presentation.js';
import {dateNavigationButton} from './components/date-navigation.js';
import {initDaySwipe} from './components/day-swipe.js';
import {cxLogoImage} from './components/cx-logo.js';
import {raceCardHtml,overviewButtonHtml} from './components/race-card.js';
import {supabase,countryFlag,categoryBadge,buildRaceHeader,setMeta,setMetaProperty,formatDateLabel,openPhBanner,wirePhDescriptions,getPinnedFilter,renderFilterPins,handleFilterEvent,setPressed,announce} from './shared.js';
import {initI18n,t,getLang,getLocale} from './i18n.js';
import {cxCategoryTiming} from './cx/timing.js';
import {cxMonth,cxNextDate,cxTournamentMetadata,cxSeasonRounds,cxSeasonRows,cxHiddenClasses,cxIsHidden,cxListedInAgenda,cxAllRows,CX_SPANISH_AUDIENCE} from './services/cx-data.js';
import {cxEsc as esc,cxSeason,cxSeasonMonths,cxMonthDays,cxCategories,cxColor,cxRaceName,cxRaceUrl,cxTournamentUrl,cxTournamentPageUrl,cxTournamentPage,cxRacePageUrl,cxCategoryCardState,cxUsesCategoryBadges,cxTime,cxClassLabel,cxRoundBadge,cxRaceOpen,cxRacePlaceholder,cxPlaceholderMessage,cxAgendaFilterMatches,cxDayRaces,cxClassificationSelection,cxTournamentGeneralCategories,cxStandingMode} from './cx/presentation.js';
import {cxStandingsTableHtml,cxWireStandingsScroll} from './cx/standings-table.js';
import {CX_CATEGORIES} from './cx/editor-logic.js';
import {cxTournamentDescription} from './cx/tournament-seo.js';
import {cxClampDay,cxRaceDays,cxAdjacentRaceDay,cxStepDay,cxDateStrip} from './cx/today.js';

// El diccionario EN se carga a la vez que los metadatos del torneo.
const i18nReady=initI18n();
const root=document.getElementById('cxAgendaContent'),lang=getLang();
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const scope=root.querySelector('[data-cx-tournament-id]')?.dataset||root.dataset;
const tournamentSlug=new URLSearchParams(location.search).get('torneo');
let tournamentId=scope.cxTournamentId||null;
let tournament=null;
if(tournamentId||tournamentSlug) {
  try { [tournament]=await Promise.all([cxTournamentMetadata(supabase,tournamentId||tournamentSlug,{bySlug:!tournamentId}),i18nReady.catch(()=>{})]);if(!tournament)throw Error(lang==='en'?'Cyclocross series not found.':'Torneo de ciclocross no encontrado.');tournamentId=tournament.id; }
  catch(e) { await i18nReady.catch(()=>{});root.innerHTML=`<p id="cxAgendaError" role="alert">${esc(t('cx.loadError'))} ${esc(e.message)}</p><button type="button" class="btn">${t('cx.retry')}</button>`;root.querySelector('button').onclick=()=>location.reload();throw e; }
}
await i18nReady;
const locale=getLocale();
const tournamentName=tournament?cxRaceName(tournament,lang):'';
if(tournament) {
  const url=`${location.origin}${cxTournamentUrl(tournament,lang)}`,title=`${tournamentName} · ${tournament.seasonKey} - Calendario Ciclismo`;
  document.title=title;setMetaProperty('og:title',title);setMetaProperty('og:url',url);
  document.querySelector('link[rel=canonical]')?.setAttribute('href',url);
  for(const language of ['es','en','x-default']) {
    let link=document.querySelector(`link[rel=alternate][hreflang="${language}"]`);
    if(!link){link=document.createElement('link');link.rel='alternate';link.hreflang=language;document.head.append(link);}
    link.href=`${location.origin}${cxTournamentUrl(tournament,language==='en'?'en':'es')}`;
  }
}
// La agenda general es la vista Hoy de Carretera: un día cada vez dentro de la
// temporada. La página de torneo carga todas sus pruebas de la temporada en una
// sola página.
const tournamentMode=!!tournamentId;
let season=tournament?.seasonKey||cxSeason(),months=cxSeasonMonths(season),version=0,busy=false;
const renderedCategories=new Map();
let seasonRounds=null;
// Las rondas de la temporada se piden desde el inicio (cxSeasonRounds guarda la
// promesa por temporada); el pintado las espera solo si aún no han llegado.
cxSeasonRounds(supabase,season).catch(()=>{});
// En la home (js/home.js) el título principal es el del texto estático de la página.
const homeMode=root.dataset.cxHome!==undefined;
const heading=tournamentId?buildRaceHeader({race:{...tournament,name:tournamentName,nameEn:tournamentName},hideFlag:!tournament.countryCode,nameHref:''}):homeMode?`<h2 class="sr-only">${t('cx.title')}</h2>`:`<h1 class="sr-only">${t('cx.title')}</h1>`;
// Filtro de la agenda, con la misma presentación y posición que Hoy en
// Carretera: franja de chips pegada bajo la cabecera. El filtro se puede fijar
// como predeterminado de SOLO esta vista (chincheta), con clave propia.
const CX_PIN_KEY='cc_cx_default_filter',CX_PIN_CATS=['big','pro','spain'];
let agendaFilter=tournamentMode?'all':getPinnedFilter(CX_PIN_KEY,CX_PIN_CATS)||'all';
const filterCats=['all','big','pro','spain'];
const filterBarHtml=()=>`<section class="agenda-filters" id="cxAgendaFilters" aria-label="${esc(t('cx.title'))}"><div class="agenda-filters__inner"><div class="agenda-filter-cats" id="cxAgendaFilterCats">${filterCats.map(key=>`<button type="button" aria-pressed="${key===agendaFilter}" class="tcat-btn${key===agendaFilter?' tcat-btn--active':''}" data-cat="${key}"><span class="btn-label-full">${esc(t(`cx.filter.${key}`))}</span><span class="btn-label-short">${esc(t(`cx.filter.${key}`))}</span></button>`).join('')}</div></div></section>`;
// Secciones del torneo, como las de la ficha de carrera: Calendario y, cuando
// hay generales publicadas, Clasificación general.
const standingCategories=tournamentMode?CX_CATEGORIES.filter(code=>tournament.pointsScheme?.categories?.[code]):[];
const sectionNavHtml=standingCategories.length?`<div class="res-tabs-bar cx-section-nav" data-cx-tournament-sections hidden><nav class="res-tabs" aria-label="${esc(tournamentName)}"><div class="res-tabs__scroll"><div class="res-tabs__inner">${[['calendar',t('cx.calendar')],['general',t('cx.standings')]].map(([key,label])=>`<a class="res-tab" data-cx-tournament-section="${key}" href="${esc(cxTournamentPageUrl(tournament,lang,key))}">${esc(label)}</a>`).join('')}</div></div></nav></div><div data-cx-general-nav hidden></div>`:'';
root.innerHTML=tournamentMode
  ?`<div class="cx-agenda-sticky">${heading}${sectionNavHtml}</div><p id="cxAgendaError" role="alert"></p><div id="cxAgendaList"></div><div class="cx-tournament-standings" id="cxStandings" hidden></div>`
  :`<div class="cx-agenda-sticky">${heading}<div class="date-bar" id="cxDateBar"></div>${filterBarHtml()}</div><p id="cxAgendaError" role="alert"></p><div id="cxAgendaList" class="cx-day-list"></div>`;
const list=root.querySelector('#cxAgendaList'),error=root.querySelector('#cxAgendaError');
const filterCatsNode=root.querySelector('#cxAgendaFilterCats');
const filteredRows=rows=>agendaFilter==='all'?rows:rows.filter(race=>cxAgendaFilterMatches(race,agendaFilter));
function refreshFilter(){ if(currentDay)void goDay(currentDay); }
if(filterCatsNode){
  renderFilterPins(filterCatsNode,agendaFilter,CX_PIN_KEY,CX_PIN_CATS);
  const onFilterEvent=event=>{
    const res=handleFilterEvent(event,CX_PIN_KEY,CX_PIN_CATS);if(!res)return;
    if(res.type==='pin'){renderFilterPins(filterCatsNode,agendaFilter,CX_PIN_KEY,CX_PIN_CATS);return;}
    const changed=agendaFilter!==res.cat;agendaFilter=res.cat;
    for(const node of filterCatsNode.querySelectorAll('.tcat-btn'))setPressed(node,node.dataset.cat===agendaFilter);
    renderFilterPins(filterCatsNode,agendaFilter,CX_PIN_KEY,CX_PIN_CATS);
    if(changed)void refreshFilter();
  };
  filterCatsNode.addEventListener('click',onFilterEvent);
  filterCatsNode.addEventListener('keydown',onFilterEvent);
}
let measureNavigation=()=>{};
if(tournamentMode) {
  const header=root.querySelector('.cx-agenda-sticky');
  // La fila de columnas de la general se fija bajo la cabecera del torneo.
  measureNavigation=()=>{root.style.setProperty('--cx-agenda-nav-h',`${header.offsetHeight}px`);document.documentElement?.style.setProperty('--res-tabs-h',`${header.offsetHeight}px`);};
  new ResizeObserver(measureNavigation).observe(header);
  measureNavigation();
}
// Página de torneo: lleva el día al borde superior del área visible.
// `scroll-margin-top` descuenta la cabecera fija; si el destino queda cerca del
// final del documento, el navegador desplaza todo lo posible.
let lastScrollTarget=null;
function scrollTo(node) {
  if(!node)return;
  lastScrollTarget=node;
  measureNavigation();
  node.scrollIntoView({block:'start',behavior:'instant'});
}
function cellMeta(race,c) {
  const phase=cxCategoryCardState(race,c),results=phase==='results';
  const value=phase==='cancelled'?t('stage.cancelled'):results?t('cx.result'):phase==='awaiting'?t('cx.pendingShort'):(cxTime(c.startTimeUtc,locale)||'');
  return {results,href:results?cxRacePageUrl(race,lang,'results',c.category):cxRaceUrl(race,lang,c.category),label:`${t(`cx.category.${c.category}`)}: ${phase==='time'&&!c.startTimeUtc?t('stage.noSchedule'):value}`};
}
// Horario, copa, espera o cancelación bajo la caja de categoría, fuera de
// ella, con la tipografía de salida/meta de Hoy en Carretera. Solo las cards
// abiertas (`open`) llevan el copa enlazado a resultados.
function scheduleHtml(race,c,open) {
  const phase=cxCategoryCardState(race,c),results=phase==='results';
  const time=cxTime(c.startTimeUtc,locale)||'';
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
function refreshTiming() {
  if(document.hidden)return;
  const currentDay=today();
  for(const day of list.querySelectorAll('[data-date]'))day.classList.toggle('cal-day--today',day.dataset.date===currentDay);
  for(const node of list.querySelectorAll('[data-cx-timing]')) {
    const pair=renderedCategories.get(node.dataset.cxTiming);if(!pair)continue;
    const stateCell=node.querySelector('.cx-category-state');if(!stateCell)continue;
    stateCell.innerHTML=scheduleHtml(pair[0],pair[1],true);
  }
}
function card(race,date) {
  const url=cxRaceUrl(race,lang),color=cxColor(race);
  // Sin documento (Libro de Ruta o Mapa) o sin horarios, la ficha no está
  // lista: card placeholder de Hoy, no enlaza a la carrera ni a sus categorías
  // y abre el aviso de información (tooltip/modal).
  const placeholder=cxRacePlaceholder(race),open=!placeholder;
  const href=open?`<a href="${esc(url)}">`:'<span>',hrefEnd=open?'</a>':'</span>';
  const categories=cxCategories(race,date),badges=cxUsesCategoryBadges(race,date);
  const tournament=race.cx_tournaments,tournamentUrl=tournament&&!tournamentId?cxTournamentUrl(tournament,lang):null;
  const round=cxRoundBadge(seasonRounds?.get(race.id));
  const menu=tournamentUrl?overviewButtonHtml(esc(tournamentUrl),esc(cxRaceName(tournament,lang))):'';
  const sep='<span class="race-card__sep">·</span>';
  // Torneo y sede en su propio elemento para recortarse con puntos suspensivos.
  const metaText=(text,venue=false)=>`<span class="cx-card-meta-text${venue?' cx-card-meta-text--venue':''}">${esc(text)}</span>`;
  const meta=[tournamentUrl?metaText(cxRaceName(tournament,lang)):'',round,race.venue&&race.venue!==cxRaceName(race,lang)?metaText(race.venue,true):''].filter(Boolean).join(sep);
  // Datos del aviso placeholder (mismo banner/tooltip que Hoy en Carretera).
  const phData=placeholder?` data-ph-tooltip="${esc(cxPlaceholderMessage(race))}" data-ph-name="${esc(cxRaceName(race,lang))}" data-ph-flag="${esc(countryFlag(race.countryCode))}" data-ph-sub="${esc([cxClassLabel(race.class,lang),new Date(`${date}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short'})].join(' · '))}"`:'';
  const categoriesHtml=`<div class="race-card__meta cx-category-times${badges?' cx-category-times--badges':''}" style="--cx-category-count:${categories.length||1}" aria-label="${t('cx.categories')}">${categories.map(c=>{
    const catName=t(`cx.category.${c.category}`);
    if(badges) {
      const {href:catHref,label}=cellMeta(race,c);
      const catAttrs=open?` href="${esc(catHref)}" aria-label="${esc(label)}" title="${esc(label)}"`:` aria-label="${esc(label)}" title="${esc(label)}"`;
      return `<${open?'a':'span'} class="badge badge--uci cx-category-badge"${catAttrs}>${c.category}</${open?'a':'span'}>`;
    }
    // Con horarios: caja solo con el código (mismo ancho, menos alta) y el
    // horario o el copa debajo, fuera de la caja.
    const key=`${race.id}:${c.category}:${date}`;renderedCategories.set(key,[race,c]);
    const boxAttrs=open?` href="${esc(cxRaceUrl(race,lang,c.category))}" aria-label="${esc(catName)}" title="${esc(catName)}"`:` aria-label="${esc(catName)}" title="${esc(catName)}"`;
    return `<span class="cx-category-cell"${open?` data-cx-timing="${esc(key)}"`:''}><${open?'a':'span'} class="cx-category-box"${boxAttrs}>${c.category}</${open?'a':'span'}><span class="cx-category-state">${scheduleHtml(race,c,open)}</span></span>`;
  }).join('')}</div>`;
  // Estructura común de components/race-card.js; la columna derecha son las
  // categorías con su horario o su resultado.
  const inner=raceCardHtml({
    logo:`<div class="race-card__logo"><span data-cx-logo-race="${esc(race.id)}"></span><span>${countryFlag(race.countryCode)}</span></div>`,
    name:`${href}${esc(cxRaceName(race,lang))}${hrefEnd}${menu}`,
    sub:meta,
    badges:`<span class="race-card__name-cat">${categoryBadge(cxClassLabel(race.class,lang))}</span>`,
    metaBlock:categoriesHtml,
  });
  return `<article class="race-card race-card--cx${placeholder?' race-card--placeholder':''}" ${color?`style="--card-color:${color}"`:''}${open?` data-href="${esc(url)}"`:''}${phData}>${inner}${open?'<span class="feed-row__chevron cx-card-chevron" aria-hidden="true">›</span>':`<a class="race-card__seo-link" href="${esc(url)}">${esc(cxRaceName(race,lang))}</a>`}</article>`;
}
function dayHtml(day) {
  // La etiqueta del día replica a las apps (formatDateLabel): texto plano
  // "Miércoles, 8 de abril", sin círculo con el número ni año.
  return `<section class="cal-day cx-agenda-day${day.date===today()?' cal-day--today':''}" data-date="${day.date}"><h3 class="cal-day__head cx-day-label">${esc(formatDateLabel(day.date))}</h3><div class="cal-day__races cx-day-races">${day.races.map(r=>card(r,day.date)).join('')}</div></section>`;
}
// Estado vacío con la presentación de Hoy en Carretera (icono + texto).
const EMPTY_ICON_HTML='<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const emptyStateHtml=()=>`<div class="empty-state"><div class="empty-state__icon">${EMPTY_ICON_HTML}</div><div class="empty-state__text">${esc(t('cx.noRaces'))}</div></div>`;
function loadLogos(container,rows) {
  for(const slot of container.querySelectorAll('[data-cx-logo-race]')) {
    const race=rows.find(row=>row.id===slot.dataset.cxLogoRace),logo=cxLogoImage(race,race?.cx_tournaments,{onState:state=>slot.parentElement.classList.toggle('race-card__logo--without-logo',['empty','unavailable'].includes(state.status))});
    slot.replaceChildren(...(logo?[logo]:[]));
  }
}
// ── Vista Hoy (agenda general) ────────────────────────────────────
// Navegación de Hoy en Carretera (js/app.js): siete días con el activo
// centrado, flechas al día con carreras del filtro anterior o siguiente, botón
// Hoy, deslizamiento y auto-avance a medianoche. Las pruebas de la temporada se
// cargan una vez; filtro y día se resuelven en memoria (js/cx/today.js).
const LOADING_HTML=`<div class="loading"><div class="loading__icons">${EMPTY_ICON_HTML}</div><p class="loading__text">${esc(t('cx.loading'))}</p><div class="loading__dots"><span></span><span></span><span></span></div></div>`;
let seasonRows=null,currentDay=null,dayRequest=0,todayAtLoad=today();
const agendaToday=()=>cxClampDay(today(),season);
const visibleRaceDays=()=>cxRaceDays(filteredRows(seasonRows||[]));
const stepTarget=forward=>seasonRows&&currentDay?cxStepDay(visibleRaceDays(),currentDay,forward?1:-1,season):null;
const longDate=key=>new Date(`${key}T12:00:00`).toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'});
function step(forward){const target=stepTarget(forward);if(target)void goDay(target);}
// En la home la URL no cambia: `?date=` abre allí Hoy de carretera.
function writeDayUrl() {
  if(homeMode||typeof history==='undefined'||!history.replaceState)return;
  const params=new URLSearchParams(location.search);
  if(currentDay===today())params.delete('date');else params.set('date',currentDay);
  const query=params.toString();
  history.replaceState(null,'',`${location.pathname}${query?`?${query}`:''}`);
}
function buildDateBar() {
  const bar=root.querySelector('#cxDateBar'),days=visibleRaceDays(),todayKey=agendaToday();
  const left=document.createElement('div'),pillsWrap=document.createElement('div'),pills=document.createElement('div'),right=document.createElement('div');
  left.className='date-bar__left';pillsWrap.className='date-bar__pills-wrap';pills.className='date-bar__pills';right.className='date-bar__right';
  const previous=dateNavigationButton({kind:'arrow',direction:'prev',label:t('today.prevDayLabel'),onClick:()=>step(false)});
  previous.disabled=!cxStepDay(days,currentDay,-1,season);
  left.append(previous,dateNavigationButton({kind:'today',visible:currentDay!==todayKey,label:t('today.todayBtn'),onClick:()=>void goDay(todayKey)}));
  for(const key of cxDateStrip(currentDay,season)) {
    // Abreviatura del día sobre el número, como en Hoy en Carretera.
    const date=new Date(`${key}T12:00:00`);
    let weekday=date.toLocaleDateString(locale,{weekday:'short'}).replace(/\.$/,'');
    weekday=weekday.charAt(0).toUpperCase()+weekday.slice(1);
    const pill=dateNavigationButton({kind:'pill',label:longDate(key),selected:key===currentDay,isToday:key===today(),
      contentHtml:`<span class="date-pill__wd" aria-hidden="true">${esc(weekday)}</span><span class="date-pill__num" aria-hidden="true">${date.toLocaleDateString(locale,{day:'numeric'})}</span>`,
      onClick:()=>void goDay(key)});
    pill.dataset.dk=key;pills.append(pill);
  }
  const following=dateNavigationButton({kind:'arrow',direction:'next',label:t('today.nextDayLabel'),onClick:()=>step(true)});
  following.disabled=!cxStepDay(days,currentDay,1,season);
  right.append(following);pillsWrap.append(pills);bar.replaceChildren(left,pillsWrap,right);
}
function showDay(dateKey,{skipEmpty=false}={}) {
  if(!seasonRows)return;
  currentDay=cxClampDay(dateKey,season);
  const all=cxDayRaces(seasonRows,currentDay),races=cxDayRaces(filteredRows(seasonRows),currentDay);
  const next=races.length?null:cxAdjacentRaceDay(visibleRaceDays(),currentDay,1,season);
  // Auto-navegación de Hoy: en la apertura y, después, solo con el filtro Todas.
  if(next&&(skipEmpty||agendaFilter==='all'))return showDay(next);
  writeDayUrl();buildDateBar();renderedCategories.clear();
  if(!races.length) {
    const message=t(all.length?'today.noRacesFilter':'today.noRaces');
    list.innerHTML=`<div class="empty-state"><div class="empty-state__icon">${EMPTY_ICON_HTML}</div><div class="empty-state__text">${esc(message)}</div>${next?`<button type="button" class="btn btn--ghost" data-cx-next-day="${next}">${esc(t('today.nextDay'))}</button>`:''}</div>`;
    announce(message);
    return;
  }
  list.innerHTML=races.map(race=>card(race,currentDay)).join('');
  loadLogos(list,races);
  wirePhDescriptions(list);
  // La lista se sustituye sin recargar: confirmación para lectores de pantalla.
  announce(t('today.racesFor',{n:races.length===1?t('today.races_one',{n:1}):t('today.races_other',{n:races.length}),date:longDate(currentDay)}));
}
// Cambio de día como en Hoy en Carretera: indicador de carga mientras se relee
// el mes del día de destino; sin red se pinta con las pruebas ya cargadas.
async function goDay(dateKey,options={}) {
  if(!seasonRows)return;
  const request=++dayRequest,day=cxClampDay(dateKey,season),month=day.slice(0,7);
  currentDay=day;buildDateBar();renderedCategories.clear();list.innerHTML=LOADING_HTML;
  try {
    const fresh=(await cxMonth(supabase,season,Number(month.slice(0,4)),Number(month.slice(5)))).filter(race=>cxListedInAgenda(race,lang));
    if(request!==dayRequest)return;
    // Las pruebas del mes se sustituyen por las leídas: altas, cambios y retiradas.
    const ids=new Set(fresh.map(race=>race.id));
    seasonRows=[...seasonRows.filter(race=>!ids.has(race.id)&&!cxRaceDays([race]).some(date=>date.startsWith(month))),...fresh];
  }catch{/* Sin red: se conserva la temporada cargada. */}
  if(request===dayRequest)showDay(day,options);
}
async function loadSeason() {
  return (await cxSeasonRows(supabase,season)).filter(race=>cxListedInAgenda(race,lang));
}
// Día de apertura: `?date=`, el mes de un enlace antiguo de la agenda mensual
// (`#AAAA-MM`) o hoy, que salta al próximo día con carreras si no las tiene.
function initialDay() {
  const date=new URLSearchParams(location.search).get('date');
  if(/^\d{4}-\d{2}-\d{2}$/.test(date||''))return {day:date};
  let hash='';try{hash=decodeURIComponent((location.hash||'').slice(1));}catch{}
  if(months.includes(hash))return {day:visibleRaceDays().find(day=>day.startsWith(hash))||`${hash}-01`};
  return {day:agendaToday(),skipEmpty:true};
}
async function openToday() {
  const request=++dayRequest;
  list.innerHTML=LOADING_HTML;
  try {
    const [rows,rounds]=await Promise.all([loadSeason(),cxSeasonRounds(supabase,season).then(map=>map,()=>null)]);
    if(request!==dayRequest)return;
    seasonRows=rows;seasonRounds=rounds;
    const {day,skipEmpty}=currentDay?{day:currentDay}:initialDay();
    showDay(day,{skipEmpty});
  }catch(e){
    if(request!==dayRequest)return;
    list.innerHTML=`<div class="empty-state day-load-error" role="status"><p>${esc(t('cx.loadError'))} ${esc(e.message)}</p><button type="button" class="btn btn--ghost" data-cx-retry>${esc(t('cx.retry'))}</button></div>`;
  }
}
// Refresco del día en curso mientras quede alguna manga sin resultados.
let dayRefreshing=false;
async function refreshDay() {
  if(document.hidden||dayRefreshing||!seasonRows||currentDay!==today())return;
  const pending=cxDayRaces(seasonRows,currentDay).some(race=>cxCategories(race,currentDay).some(c=>!['results','cancelled'].includes(cxCategoryCardState(race,c))));
  if(!pending)return;
  dayRefreshing=true;
  try {
    const rows=await loadSeason();
    if(JSON.stringify(rows)!==JSON.stringify(seasonRows)){seasonRows=rows;showDay(currentDay);}
  }catch{/* Sin red: se conserva el día visible hasta la siguiente lectura. */}
  finally{dayRefreshing=false;}
}
// Al cruzar la medianoche local pasa al día nuevo solo si se estaba viendo hoy.
function advanceToNewDay() {
  const now=today();if(now===todayAtLoad)return;
  const wasToday=currentDay===cxClampDay(todayAtLoad,season);
  todayAtLoad=now;
  if(!seasonRows)return;
  if(wasToday)void goDay(agendaToday(),{skipEmpty:true});else buildDateBar();
}
if(!tournamentMode) {
  initDaySwipe({list,dateBar:root.querySelector('#cxDateBar'),target:stepTarget,load:key=>void goDay(key)});
  const tick=()=>{advanceToNewDay();void refreshDay();};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
  window.addEventListener('focus',advanceToNewDay);
  const dayTimer=setInterval(tick,60000);
  window.addEventListener('pagehide',()=>clearInterval(dayTimer),{once:true});
  list.addEventListener('click',event=>{
    const nextDay=event.target.closest('[data-cx-next-day]');
    if(nextDay){void goDay(nextDay.dataset.cxNextDay);return;}
    if(event.target.closest('[data-cx-retry]'))void openToday();
  });
}
async function openTournament() {
  const token=version;busy=true;error.textContent='';
  try {
    const from=months.includes(today().slice(0,7))?today():`${months[0]}-01`;
    // Filas, rondas y próxima fecha dependen solo del torneo y la temporada.
    const [rows,rounds,next]=await Promise.all([cxSeasonRows(supabase,season),
      cxSeasonRounds(supabase,season).then(map=>map,()=>null),
      cxNextDate(supabase,season,from,tournamentId,cxHiddenClasses(lang)).then(date=>date,()=>null)]);
    if(token!==version)return;
    if(!seasonRounds)seasonRounds=rounds;
    const ownRows=rows.filter(race=>race.tournamentId===tournamentId&&!race.isCancelled);
    const tournamentRows=ownRows.filter(race=>cxListedInAgenda(race,lang));
    // Torneo solo nacional en inglés: aviso con enlace a la versión en castellano.
    if(ownRows.length&&!tournamentRows.length){
      list.innerHTML=`<div class="empty-state"><div class="empty-state__text"><strong>${esc(CX_SPANISH_AUDIENCE.title)}</strong><br>${esc(CX_SPANISH_AUDIENCE.text)}</div><a class="btn btn--ghost" href="${esc(cxTournamentUrl(tournament,'es'))}">${esc(CX_SPANISH_AUDIENCE.link)}</a></div>`;
      return;
    }
    const description=cxTournamentDescription(tournament,tournamentRows,lang);
    setMeta('description',description);setMetaProperty('og:description',description);setMeta('twitter:description',description);
    renderedCategories.clear();
    const days=months.flatMap(key=>cxMonthDays(filteredRows(tournamentRows),key));
    if(!days.length){list.innerHTML=emptyStateHtml();return;}
    const node=document.createElement('section');node.className='cx-tournament-list';
    node.innerHTML=days.map(dayHtml).join('');
    list.replaceChildren(node);
    loadLogos(list,tournamentRows);
    wirePhDescriptions(list);
    const target=next&&months.includes(next.slice(0,7))?next:from;
    scrollTo(list.querySelector(`[data-date="${target}"]`)||node);
  }catch(e){if(token===version)error.textContent=`${t('cx.loadError')} ${e.message}`;}
  finally {if(token===version)busy=false;}
}
// Clasificación general del torneo: se carga al abrir la sección.
const standingsNode=root.querySelector('#cxStandings'),generalNav=root.querySelector('[data-cx-general-nav]');
let standingsData=null;
async function loadStandings() {
  if(!standingsData)standingsData=(async()=>{
    const filters={tournamentId,seasonKey:season};
    const [states,standings,teamRows,rows,rounds]=await Promise.all([cxAllRows(supabase,'cx_standings_state','*',filters,'category'),cxAllRows(supabase,'cx_tournament_standings','*',filters),
      cxAllRows(supabase,'cx_teams','id,name,nameAliases,uciCode,colorHex,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts'),
      cxSeasonRows(supabase,season),cxSeasonRounds(supabase,season).then(map=>map,()=>null)]);
    return {states,standings,rounds,teamList:teamRows.map(team=>({...team,nameAliases:(team.nameAliases||[]).join('\n')})),
      races:new Map(rows.filter(race=>race.tournamentId===tournamentId).map(race=>[race.id,race]))};
  })().catch(error=>{standingsData=null;throw error;});
  return standingsData;
}
function paintStandings(data,fragment) {
  const categories=cxTournamentGeneralCategories(data.standings,data.states);
  const selected=cxClassificationSelection(fragment,categories);
  // Chips de categoría antes de la tabla, también con una sola categoría.
  generalNav.innerHTML=categories.length?`<nav class="res-stages cx-classification-nav cx-category-nav" aria-label="${esc(t('cx.standings'))}"><div class="res-stages__inner">${categories.map(code=>`<a class="res-stage-btn${code===selected.category?' res-stage-btn--active':''}" href="${esc(cxTournamentPageUrl(tournament,lang,'general',code))}" aria-label="${esc(t(`cx.category.${code}`))}"${code===selected.category?' aria-current="page"':''}>${code}</a>`).join('')}</div></nav>`:'';
  if(!selected.category){standingsNode.innerHTML=`<div class="res-layout cx-classification-page cx-standings-page"><div class="res-main"><p class="cx-empty">${esc(t('cx.noStandings'))}</p></div></div>`;return;}
  const category=selected.category,rows=data.standings.filter(row=>row.category===category),state=data.states.find(row=>row.category===category);
  const roundHeader=(raceId,index)=>{
    const race=data.races.get(raceId),label=`#${data.rounds?.get(raceId)?.n??index+1}`;
    if(!race||cxIsHidden(race,lang))return {label};
    return {label,title:cxRaceName(race,lang),href:cxRaceUrl(race,lang)};
  };
  standingsNode.innerHTML=`<div class="res-layout cx-classification-page cx-standings-page"><div class="res-main"><h2 class="sr-only">${esc(t(`cx.category.${category}`))}</h2>${cxStandingsTableHtml({rows,state,mode:cxStandingMode(tournament,category,rows),lang,locale,teamList:data.teamList,roundHeader})}</div></div>`;
}
let calendarOpened=false,hasStandings=false;
async function showSection() {
  const section=hasStandings?cxTournamentPage(location.search):'calendar';
  for(const node of root.querySelectorAll('[data-cx-tournament-section]')) {
    const active=node.dataset.cxTournamentSection===section;
    node.classList.toggle('res-tab--active',active);
    if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
  }
  list.hidden=section!=='calendar';if(standingsNode)standingsNode.hidden=section!=='general';if(generalNav)generalNav.hidden=section!=='general';
  if(section==='calendar') {
    if(!calendarOpened){calendarOpened=true;await openTournament();}
    return;
  }
  let fragment;try{fragment=decodeURIComponent(location.hash.slice(1));}catch{fragment='';}
  try{paintStandings(await loadStandings(),fragment);cxWireStandingsScroll(standingsNode);error.textContent='';}
  catch(e){error.textContent=`${t('cx.loadError')} ${e.message}`;}
  measureNavigation();
}
if(tournamentMode&&standingCategories.length) {
  root.addEventListener('click',event=>{
    if(!hasStandings)return;
    const link=event.target.closest('[data-cx-tournament-section],[data-cx-general-nav] a');
    if(!link||event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const url=new URL(link.href,location.href);
    if(url.href!==location.href)history.pushState(null,'',url.pathname+url.search+url.hash);
    void showSection().then(()=>{if(cxTournamentPage(location.search)==='calendar'&&lastScrollTarget?.isConnected)scrollTo(lastScrollTarget);else window.scrollTo({top:0,behavior:'instant'});});
  });
  window.addEventListener('popstate',()=>void showSection());
}
async function open() {
  if(!tournamentMode){await openToday();return;}
  if(standingCategories.length) {
    const data=await loadStandings().catch(()=>null);
    hasStandings=!!data&&cxTournamentGeneralCategories(data.standings,data.states).length>0;
    root.querySelector('[data-cx-tournament-sections]').hidden=!hasStandings;
    measureNavigation();
  }
  await showSection();
}
list.onclick=event=>{if(event.target.closest('a,button,input,select'))return;const url=event.target.closest('[data-href]')?.dataset.href;if(url)window.location.href=url;};
// Aviso de las cards placeholder, igual que en Hoy en Carretera: tooltip que
// sigue al cursor en escritorio y modal centrado en móvil. Delegado en la
// lista porque las cards se repintan al cambiar de mes; los enlaces internos
// (hamburguesa, enlace oculto indexable) conservan su navegación.
list.addEventListener('mouseover',event=>{
  if(window.innerWidth<600||!event.target.closest('[data-ph-tooltip]'))return;
  let tip=document.getElementById('ph-tooltip');
  if(!tip){tip=document.createElement('div');tip.id='ph-tooltip';document.body.append(tip);}
  tip.textContent=event.target.closest('[data-ph-tooltip]').dataset.phTooltip;tip.style.display='block';
});
list.addEventListener('mousemove',event=>{
  if(window.innerWidth<600)return;const card=event.target.closest('[data-ph-tooltip]');
  const tip=card&&document.getElementById('ph-tooltip');if(!tip)return;
  tip.style.left=(event.clientX+14)+'px';tip.style.top=(event.clientY+14)+'px';
});
list.addEventListener('mouseout',event=>{
  if(window.innerWidth<600||!event.target.closest('[data-ph-tooltip]'))return;
  if(event.relatedTarget?.closest?.('[data-ph-tooltip]'))return;
  const tip=document.getElementById('ph-tooltip');if(tip)tip.style.display='none';
});
list.addEventListener('click',event=>{
  if(window.innerWidth>=600)return;const card=event.target.closest('[data-ph-tooltip]');
  if(!card||event.target.closest('a,button'))return;
  openPhBanner(card);
});
let timingInterval;
const startTiming=()=>{clearInterval(timingInterval);timingInterval=setInterval(refreshTiming,30000);refreshTiming();};
window.addEventListener('pagehide',()=>clearInterval(timingInterval));window.addEventListener('pageshow',startTiming);
document.addEventListener('visibilitychange',refreshTiming);
startTiming();
if(tournamentId)window.ccHeaderBack?.({href:lang==='en'?'/en/cyclocross/':'/ciclocross/',label:t('cx.back')});
if(!tournamentId)initCintillo('cx');
await open();
