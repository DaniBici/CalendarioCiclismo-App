import {initCintillo} from './cintillo.js?v=20260913cxscopes';
import {waitingResultsHtml,resultsTrophyHtml} from './services/race-presentation.js?v=20260912cxcohesion';
import {dateNavigationButton} from './components/date-navigation.js?v=20260912cxcohesion';
import {cxLogoImage} from './components/cx-logo.js?v=20260912cxlogos1';
import {supabase,countryFlag,categoryBadge,buildRaceHeader,setMeta,setMetaProperty,formatDateLabel,openPhBanner,wirePhDescriptions,getPinnedFilter,renderFilterPins,handleFilterEvent,setPressed} from './shared.js';
import {initI18n,t,getLang,getLocale} from './i18n.js?v=20260913cxround';
import {cxCategoryTiming} from './cx/timing.js?v=20260913cxdropschedule';
import {cxMonth,cxNextDate,cxTournamentMetadata,cxSeasonRounds,cxSeasonRows,cxHiddenClasses,cxIsHidden,CX_SPANISH_AUDIENCE} from './services/cx-data.js?v=20260927cxhidden';
import {cxEsc as esc,cxSeason,cxSeasonMonths,cxMonthDays,cxCategories,cxColor,cxRaceName,cxRaceUrl,cxTournamentUrl,cxRacePageUrl,cxCategoryCardState,cxUsesCategoryBadges,cxTime,cxClassLabel,cxRoundBadge,cxRaceOpen,cxRacePlaceholder,cxPlaceholderMessage,cxAgendaFilterMatches} from './cx/presentation.js?v=20260920cxrank1';
import {cxTournamentDescription} from './cx/tournament-seo.js?v=20260914cxtournamentlist';

await initI18n();
const root=document.getElementById('cxAgendaContent'),lang=getLang(),locale=getLocale();
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const scope=root.querySelector('[data-cx-tournament-id]')?.dataset||root.dataset;
const tournamentSlug=new URLSearchParams(location.search).get('torneo');
let tournamentId=scope.cxTournamentId||null;
let tournament=null;
if(tournamentId||tournamentSlug) {
  try { tournament=await cxTournamentMetadata(supabase,tournamentId||tournamentSlug,{bySlug:!tournamentId});if(!tournament)throw Error(lang==='en'?'Cyclocross series not found.':'Torneo de ciclocross no encontrado.');tournamentId=tournament.id; }
  catch(e) { root.innerHTML=`<p id="cxAgendaError" role="alert">${esc(t('cx.loadError'))} ${esc(e.message)}</p><button type="button" class="btn">${t('cx.retry')}</button>`;root.querySelector('button').onclick=()=>location.reload();throw e; }
}
const tournamentName=tournament?cxRaceName(tournament,lang):'';
if(tournament) {
  const url=`${location.origin}${cxTournamentUrl(tournament,lang)}`,title=`${tournamentName} · ${tournament.seasonKey} — Calendario Ciclismo`;
  document.title=title;setMetaProperty('og:title',title);setMetaProperty('og:url',url);
  document.querySelector('link[rel=canonical]')?.setAttribute('href',url);
  for(const language of ['es','en','x-default']) {
    let link=document.querySelector(`link[rel=alternate][hreflang="${language}"]`);
    if(!link){link=document.createElement('link');link.rel='alternate';link.hreflang=language;document.head.append(link);}
    link.href=`${location.origin}${cxTournamentUrl(tournament,language==='en'?'en':'es')}`;
  }
}
// La agenda general conserva el controlador mensual; la página de torneo carga
// todas sus pruebas de la temporada en una sola página (sin selector de meses).
const tournamentMode=!!tournamentId;
let season=tournament?.seasonKey||cxSeason(),months=cxSeasonMonths(season),activeMonth=months[0],version=0,busy=false;
const cache=new Map(),renderedCategories=new Map();
let seasonRounds=null;
const heading=tournamentId?buildRaceHeader({race:{...tournament,name:tournamentName,nameEn:tournamentName},hideFlag:!tournament.countryCode,nameHref:''}):`<h1 class="sr-only">${t('cx.title')}</h1>`;
// Filtro de la agenda, con la misma presentación y posición que Hoy en
// Carretera: franja de chips pegada bajo la cabecera. El filtro se puede fijar
// como predeterminado de SOLO esta vista (chincheta), con clave propia.
const CX_PIN_KEY='cc_cx_default_filter',CX_PIN_CATS=['big','pro','spain'];
let agendaFilter=tournamentMode?'all':getPinnedFilter(CX_PIN_KEY,CX_PIN_CATS)||'all';
const filterCats=['all','big','pro','spain'];
const filterBarHtml=()=>`<section class="agenda-filters" id="cxAgendaFilters" aria-label="${esc(t('cx.title'))}"><div class="agenda-filters__inner"><div class="agenda-filter-cats" id="cxAgendaFilterCats">${filterCats.map(key=>`<button type="button" aria-pressed="${key===agendaFilter}" class="tcat-btn${key===agendaFilter?' tcat-btn--active':''}" data-cat="${key}"><span class="btn-label-full">${esc(t(`cx.filter.${key}`))}</span><span class="btn-label-short">${esc(t(`cx.filter.${key}`))}</span></button>`).join('')}</div></div></section>`;
root.innerHTML=tournamentMode
  ?`<div class="cx-agenda-sticky">${heading}</div><p id="cxAgendaError" role="alert"></p><div id="cxMonths"></div>`
  :`<div class="cx-agenda-sticky">${heading}<nav class="temporada-filters cx-month-nav" aria-label="${t('cx.title')}"><div class="date-bar" id="cxMonthBar"></div></nav>${filterBarHtml()}</div><p id="cxAgendaError" role="alert"></p><div id="cxMonths"></div>`;
const list=root.querySelector('#cxMonths'),error=root.querySelector('#cxAgendaError');
const filterCatsNode=root.querySelector('#cxAgendaFilterCats');
const filteredRows=rows=>agendaFilter==='all'?rows:rows.filter(race=>cxAgendaFilterMatches(race,agendaFilter));
async function refreshFilter(){ await goMonth(activeMonth,true); }
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
let previous=null,next=null,pills=null,pillsWrap=null,navigation=null,measureNavigation=()=>{};
if(!tournamentMode) {
  const bar=root.querySelector('#cxMonthBar'),left=document.createElement('div'),right=document.createElement('div');
  left.className='date-bar__left';pillsWrap=document.createElement('div');pills=document.createElement('div');right.className='date-bar__right';
  pillsWrap.className='date-bar__pills-wrap';pills.className='date-bar__pills';
  previous=dateNavigationButton({kind:'arrow',direction:'prev',label:t('cx.previousMonth'),onClick:()=>void goMonth(months[months.indexOf(activeMonth)-1])});previous.id='cxPrevious';
  next=dateNavigationButton({kind:'arrow',direction:'next',label:t('cx.nextMonth'),onClick:()=>void goMonth(months[months.indexOf(activeMonth)+1])});next.id='cxNext';
  left.append(previous);right.append(next);pillsWrap.append(pills);bar.append(left,pillsWrap,right);
  for(const key of months){const date=new Date(`${key}-01T12:00:00Z`),name=new Intl.DateTimeFormat(locale,{month:'short',timeZone:'UTC'}).format(date).toLocaleLowerCase(locale),year=key.slice(0,4);const button=dateNavigationButton({kind:'pill',label:new Intl.DateTimeFormat(locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(date),contentHtml:`<span class="date-pill__wd">${esc(name)}</span><span class="date-pill__num">${year}</span>`,onClick:()=>void goMonth(key)});button.dataset.monthChoice=key;pills.append(button);}
  navigation=root.querySelector('.cx-month-nav');
  const sticky=root.querySelector('.cx-agenda-sticky');
  // Flechas visibles solo si la tira de meses llega a desplazarse: cuando los
  // siete meses caben, sobran y se retiran (cx-months-scroll ausente).
  measureNavigation=()=>{root.style.setProperty('--cx-agenda-nav-h',`${sticky.offsetHeight}px`);navigation.classList.toggle('cx-months-scroll',pillsWrap.scrollWidth>pillsWrap.clientWidth+1);};
  const navObserver=new ResizeObserver(measureNavigation);
  navObserver.observe(sticky);navObserver.observe(pillsWrap);
}else {
  const header=root.querySelector('.cx-agenda-sticky');
  measureNavigation=()=>root.style.setProperty('--cx-agenda-nav-h',`${header.offsetHeight}px`);
  new ResizeObserver(measureNavigation).observe(header);
  measureNavigation();
}
// Lleva el día (o el mes, si el día aún no está pintado) al borde superior del
// área visible. `scroll-margin-top` descuenta la cabecera fija; si el destino
// queda cerca del final del documento, el navegador desplaza todo lo posible.
let lastScrollTarget=null,scrollGuard=null;
function scrollTo(node) {
  if(!node)return;
  lastScrollTarget=node;
  measureNavigation();
  node.scrollIntoView({block:'start',behavior:'instant'});
  scrollGuard=window.scrollY;
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
  if(phase==='cancelled')return `<span class="badge badge--cancelled-day">${esc(t('stage.cancelled'))}</span>`;
  return `<strong class="cx-category-hour"${time?'':` title="${esc(t('stage.noSchedule'))}"`}>${esc(time||'—')}</strong>`;
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
  // Sin documento (Libro de Ruta o Mapa) o sin horarios —o cancelada—, la ficha
  // no está lista: card placeholder de Hoy, no enlaza a la carrera ni a sus
  // categorías y abre el aviso de información (tooltip/modal).
  const placeholder=cxRacePlaceholder(race),open=!placeholder,cancelled=race.isCancelled;
  const href=open?`<a href="${esc(url)}">`:'<span>',hrefEnd=open?'</a>':'</span>';
  const categories=cxCategories(race,date),badges=cxUsesCategoryBadges(race,date);
  const tournament=race.cx_tournaments,tournamentUrl=tournament&&!tournamentId?cxTournamentUrl(tournament,lang):null;
  const round=cxRoundBadge(seasonRounds?.get(race.id));
  const menu=tournamentUrl?`<a class="race-card__overview-btn" href="${esc(tournamentUrl)}" aria-label="${esc(cxRaceName(tournament,lang))}"><span aria-hidden="true">☰</span></a>`:'';
  // La card CX es --compact y su subtítulo se pinta en bloque: el gap del flex
  // no actúa, así que el separador lleva espacios propios.
  const sep=' <span class="race-card__sep">·</span> ';
  const meta=[tournamentUrl?esc(cxRaceName(tournament,lang)):'',round,race.venue&&race.venue!==cxRaceName(race,lang)?esc(race.venue):''].filter(Boolean).join(sep);
  // Prueba cancelada: una sola indicación "Cancelada", sin categorías ni
  // tachado, con la presentación de las jornadas canceladas de Hoy.
  const cancelledBadge=cancelled?`<span class="badge badge--cancelled-day">${esc(t('stage.cancelled'))}</span>`:'';
  // Datos del aviso placeholder (mismo banner/tooltip que Hoy en Carretera).
  const phData=placeholder?` data-ph-tooltip="${esc(cxPlaceholderMessage(race))}" data-ph-name="${esc(cxRaceName(race,lang))}" data-ph-flag="${esc(countryFlag(race.countryCode))}" data-ph-sub="${esc([cxClassLabel(race.class,lang),new Date(`${date}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short'})].join(' · '))}"`:'';
  const categoriesHtml=cancelled?'':`<div class="race-card__meta cx-category-times${badges?' cx-category-times--badges':''}" style="--cx-category-count:${categories.length||1}" aria-label="${t('cx.categories')}">${categories.map(c=>{
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
  return `<article class="race-card race-card--composed race-card--compact race-card--cx${placeholder?' race-card--placeholder':''}" ${color?`style="--card-color:${color}"`:''}${open?` data-href="${esc(url)}"`:''}${phData}><div class="race-card__identity"><div class="race-card__logo"><span data-cx-logo-race="${esc(race.id)}"></span><span>${countryFlag(race.countryCode)}</span></div><div class="race-card__main"><div class="race-card__name">${href}${esc(cxRaceName(race,lang))}${hrefEnd}${categoryBadge(cxClassLabel(race.class,lang))}${cancelledBadge}${menu}</div>${meta?`<div class="race-card__sub">${meta}</div>`:''}</div></div>${categoriesHtml}${open?'<span class="feed-row__chevron cx-card-chevron" aria-hidden="true">›</span>':`<a class="race-card__seo-link" href="${esc(url)}">${esc(cxRaceName(race,lang))}</a>`}</article>`;
}
function dayHtml(day) {
  // La etiqueta del día replica a las apps (formatDateLabel): texto plano
  // "Miércoles, 8 de abril", sin círculo con el número ni año.
  return `<section class="cal-day cx-agenda-day${day.date===today()?' cal-day--today':''}" data-date="${day.date}"><h3 class="cal-day__head cx-day-label">${esc(formatDateLabel(day.date))}</h3><div class="cal-day__races cx-day-races">${day.races.map(r=>card(r,day.date)).join('')}</div></section>`;
}
// Estado vacío con la presentación de Hoy en Carretera (icono + texto).
const EMPTY_ICON_HTML='<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const emptyStateHtml=filtered=>`<div class="empty-state"><div class="empty-state__icon">${EMPTY_ICON_HTML}</div><div class="empty-state__text">${esc(t(filtered?'cx.noRacesFilter':'cx.noRaces'))}</div></div>`;
function paint(node,rows,key) {
  const allDays=cxMonthDays(rows,key),days=cxMonthDays(filteredRows(rows),key);
  node.innerHTML=days.length?days.map(dayHtml).join(''):emptyStateHtml(allDays.length>0);
}
function loadLogos(container,rows) {
  for(const slot of container.querySelectorAll('[data-cx-logo-race]')) {
    const race=rows.find(row=>row.id===slot.dataset.cxLogoRace),logo=cxLogoImage(race,race?.cx_tournaments,{onState:state=>slot.parentElement.classList.toggle('race-card__logo--without-logo',['empty','unavailable'].includes(state.status))});
    slot.replaceChildren(...(logo?[logo]:[]));
  }
}
function navState() {
  if(tournamentMode)return;
  previous.disabled=busy||months.indexOf(activeMonth)<=0;next.disabled=busy||months.indexOf(activeMonth)>=months.length-1;
  for(const button of pills.children){const selected=button.dataset.monthChoice===activeMonth;button.classList.toggle('active',selected);button.classList.toggle('is-today',button.dataset.monthChoice===today().slice(0,7));button.disabled=busy;if(selected)button.setAttribute('aria-current','date');else button.removeAttribute('aria-current');if(selected){const rect=button.getBoundingClientRect(),wrap=pillsWrap.getBoundingClientRect();if(rect.left<wrap.left||rect.right>wrap.right)pillsWrap.scrollLeft+=rect.left-wrap.left-(wrap.width-rect.width)/2;}}
}
async function monthRows(key,token) {
  const cacheKey=`${season}:${key}`;
  let rows=cache.get(cacheKey);
  if(!rows){rows=await cxMonth(supabase,season,Number(key.slice(0,4)),Number(key.slice(5)));if(token!==version)return null;rows=rows.filter(race=>!cxIsHidden(race,lang)&&(!tournamentId||race.tournamentId===tournamentId));cache.set(cacheKey,rows);}
  if(token!==version)return null;
  return rows;
}
async function monthNode(key,token) {
  const rows=await monthRows(key,token);if(!rows)return null;
  if(!seasonRounds)seasonRounds=await cxSeasonRounds(supabase,season).then(map=>map,()=>null);
  const node=document.createElement('section');node.className='cx-month';node.dataset.month=key;
  renderedCategories.clear();paint(node,rows,key);
  loadLogos(node,rows);
  wirePhDescriptions(node);
  return node;
}
async function goMonth(key,force=false) {
  if(busy||!months.includes(key)||(!force&&key===activeMonth&&list.querySelector('[data-month]')))return;
  const token=version;busy=true;error.textContent='';navState();
  try {
    const node=await monthNode(key,token);if(!node)return;
    list.replaceChildren(node);activeMonth=key;
    if(!tournamentMode&&typeof history!=='undefined'&&history.replaceState)history.replaceState(null,'',`#${key}`);
    scrollTo(node);
  }catch(e){if(token===version)error.textContent=`${t('cx.loadError')} ${e.message}`;}
  finally {if(token===version){busy=false;navState();}}
}
async function jump() {
  if(busy)return;
  const token=++version;busy=true;error.textContent='';navState();
  const current=months.includes(today().slice(0,7))?today().slice(0,7):months[0];
  const from=current===today().slice(0,7)?today():`${current}-01`;
  const upcoming=cxNextDate(supabase,season,from,tournamentId,cxHiddenClasses(lang)).then(date=>({date}),error=>({error}));
  try {
    const rows=await monthRows(current,token);if(!rows)return;
    let target=from;
    const next=await upcoming;if(next.error)throw next.error;if(token!==version)return;
    if(next.date&&months.includes(next.date.slice(0,7)))target=next.date;
    const node=await monthNode(target.slice(0,7),token);
    if(!node||token!==version)return;
    list.replaceChildren(node);activeMonth=node.dataset.month;
    if(!tournamentMode&&typeof history!=='undefined'&&history.replaceState)history.replaceState(null,'',`#${activeMonth}`);
    scrollTo(list.querySelector(`[data-date="${target}"]`)||node);
  }catch(e){
    if(token===version){
      error.textContent=`${t('cx.loadError')} ${e.message}`;
      if(!list.querySelector('[data-month]')&&cache.has(`${season}:${current}`)) {
        const node=await monthNode(current,token);if(node){list.replaceChildren(node);activeMonth=current;}
      }
    }
  }
  finally {if(token===version){busy=false;navState();}}
}
// Apertura: siempre el mes del próximo día con carreras desde hoy. Si en el mes
// en curso ya no queda ninguna prueba, `cxNextDate` devuelve la primera del mes
// siguiente y se carga ese. Nunca se restaura una posición guardada.
async function openAgenda() {
  const hash=decodeURIComponent((location.hash||'').slice(1));
  if(months.includes(hash)) {
    await goMonth(hash);
    if(list.querySelector('[data-month]'))return;
  }
  await jump();
}
if(!tournamentMode)window.addEventListener('hashchange',()=>{
  const key=decodeURIComponent((location.hash||'').slice(1));
  if(months.includes(key)&&key!==activeMonth)void goMonth(key);
});
async function openTournament() {
  const token=version;busy=true;error.textContent='';
  try {
    let rows=await cxSeasonRows(supabase,season);
    if(token!==version)return;
    const ownRows=rows.filter(race=>race.tournamentId===tournamentId);
    const tournamentRows=ownRows.filter(race=>!cxIsHidden(race,lang));
    // Torneo solo nacional en inglés: aviso con enlace a la versión en castellano.
    if(ownRows.length&&!tournamentRows.length){
      list.innerHTML=`<div class="empty-state"><div class="empty-state__text"><strong>${esc(CX_SPANISH_AUDIENCE.title)}</strong><br>${esc(CX_SPANISH_AUDIENCE.text)}</div><a class="btn btn--ghost" href="${esc(cxTournamentUrl(tournament,'es'))}">${esc(CX_SPANISH_AUDIENCE.link)}</a></div>`;
      return;
    }
    const description=cxTournamentDescription(tournament,tournamentRows);
    setMeta('description',description);setMetaProperty('og:description',description);setMeta('twitter:description',description);
    if(!seasonRounds)seasonRounds=await cxSeasonRounds(supabase,season).then(map=>map,()=>null);
    if(token!==version)return;
    renderedCategories.clear();
    const allDays=months.flatMap(key=>cxMonthDays(tournamentRows,key));
    const days=months.flatMap(key=>cxMonthDays(filteredRows(tournamentRows),key));
    if(!days.length){list.innerHTML=emptyStateHtml(allDays.length>0);return;}
    const node=document.createElement('section');node.className='cx-tournament-list';
    node.innerHTML=days.map(dayHtml).join('');
    list.replaceChildren(node);
    loadLogos(list,tournamentRows);
    wirePhDescriptions(list);
    const from=months.includes(today().slice(0,7))?today():`${months[0]}-01`;
    const next=await cxNextDate(supabase,season,from,tournamentId,cxHiddenClasses(lang)).then(date=>date,()=>null);
    if(token!==version)return;
    const target=next&&months.includes(next.slice(0,7))?next:from;
    activeMonth=target.slice(0,7);
    scrollTo(list.querySelector(`[data-date="${target}"]`)||node);
  }catch(e){if(token===version)error.textContent=`${t('cx.loadError')} ${e.message}`;}
  finally {if(token===version)busy=false;}
}
async function open() {
  if(tournamentMode)await openTournament();else await openAgenda();
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
const cintilloReady=!tournamentId?initCintillo('cx'):null;
await open();
// El cintillo y la cabecera fijan sus alturas después de pintar la agenda
// (`--giro-h`, `--site-header-h`); el anclaje inicial se calculó con la altura
// antigua y quedaba parte del primer día bajo la cabecera. Reajusta el anclaje
// cuando el cintillo ya está montado, solo si el usuario no ha desplazado.
if(cintilloReady)Promise.resolve(cintilloReady).then(()=>{
  requestAnimationFrame(()=>{if(lastScrollTarget?.isConnected&&Math.abs(window.scrollY-(scrollGuard??0))<=2)scrollTo(lastScrollTarget);});
}).catch(()=>{});
