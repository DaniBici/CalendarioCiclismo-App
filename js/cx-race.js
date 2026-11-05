import {supabase,setMeta,setMetaProperty,seoLongDateWeekday,orEqFilter,pickByPreference} from './shared.js';
import {initI18n,t,getLang} from './i18n.js';
import {cxQuery,cxAllRows,cxSeasonRounds,cxIsHidden,CX_SPANISH_AUDIENCE} from './services/cx-data.js';
import {cxEsc as esc,cxCategoryDate,cxRacePageUrl,cxRacePageLocation} from './cx/presentation.js';
import {cxWireStandingsScroll} from './cx/standings-table.js';
import {cxRaceSeo} from './cx/race-seo.js';
import {cxDateInSeason} from './cx/season.js';
import './race-assets.js';
import {limitScrollToStickyStart} from './results/dom.js';
import {cxOpenTvEmbed} from './cx/tv-modal.js';
import {applyPrerenderedHtml} from './html-fingerprint.js';
import {CX_PANEL_ATTRIBUTES,cxRaceModel,cxRaceSelection,cxRaceSectionHref,cxRaceSkeletonHtml,cxRaceSectionHtml,cxRacePanelHtml,cxRaceContextHtml,cxRacePageHtml} from './cx-race-html.js';

// Ficha de carrera CX: modelo y HTML en js/cx-race-html.js, común con el
// build (tools/site/prerender-cx.mjs), que escribe la sección de cada URL.
const root=document.getElementById('cxRaceContent'),lang=getLang();
// Página generada: el id va en el <main>; si no, en la cabecera del bloque de gen_og_pages.py.
const sourceId=root.dataset.cxRaceId||root.querySelector('[data-cx-race-id]')?.dataset.cxRaceId;
const route=cxRacePageLocation(location.pathname,location.search);
// La carrera se pide a la vez que el diccionario EN.
const racePromise=findRace();
racePromise.catch(()=>{});
await initI18n();
window.ccHeaderBack?.({href:lang==='en'?'/en/cyclocross/':'/ciclocross/',label:t('cx.back')});

async function findRace() {
  const select='*,cx_race_categories(*),cx_tournaments(*)';
  const base=()=>supabase.from('cx_races').select(select).eq('editorialStatus','published');
  if(sourceId)return cxQuery(base().eq('id',sourceId).maybeSingle());
  const params=new URLSearchParams(location.search),id=params.get('raceId');
  if(id)return cxQuery(base().eq('id',id).maybeSingle());
  const slug=params.get('slug')||route.slug;
  // Una sola consulta: en EN se prefiere slugEn y se admite slug.
  const columns=lang==='en'?['slugEn','slug']:['slug'];
  return pickByPreference(await cxQuery(base().or(orEqFilter(columns,slug)).limit(4)),columns,slug);
}
function seo(race) {
  // La raíz conserva su canonical aunque abra resultados por defecto. Las
  // vistas ?view= comparten la URL indexable de la jornada, sin duplicados.
  const canonicalPage=cxRacePageLocation(location.pathname).page;
  const {title,description}=cxRaceSeo(race,canonicalPage,seoLongDateWeekday,lang);
  document.title=title;setMeta('description',description);setMetaProperty('og:description',description);setMeta('twitter:description',description);setMetaProperty('og:title',title);setMeta('twitter:title',title);setMetaProperty('og:url',`${location.origin}${cxRacePageUrl(race,lang,canonicalPage)}`);
  document.querySelector('link[rel=canonical]')?.setAttribute('href',`${location.origin}${cxRacePageUrl(race,lang,canonicalPage)}`);
  // Las carreras nacionales no tienen versión en inglés.
  for(const language of cxIsHidden(race,'en')?['es','x-default']:['es','en','x-default']) {
    let link=document.querySelector(`link[rel=alternate][hreflang="${language}"]`);
    if(!link){link=document.createElement('link');link.rel='alternate';link.hreflang=language;document.head.append(link);}
    link.href=`${location.origin}${cxRacePageUrl(race,language==='en'?'en':'es',canonicalPage)}`;
  }
}
try {
  const race=await racePromise;if(!race||!cxDateInSeason(race.seasonKey,race.dateKey)||(race.endDateKey&&!cxDateInSeason(race.seasonKey,race.endDateKey)))throw new Error(t('cx.notFound'));
  if(cxIsHidden(race,lang)){
    document.querySelector('link[rel=alternate][hreflang="en"]')?.remove();
    setMeta('robots','noindex');
    root.innerHTML=`<div class="race-header cx-race-header"><h1 class="race-header__name">${esc(CX_SPANISH_AUDIENCE.title)}</h1><p>${esc(CX_SPANISH_AUDIENCE.text)}</p><div class="cx-race-actions"><a href="${esc(cxRacePageUrl(race,'es'))}">${esc(CX_SPANISH_AUDIENCE.link)}</a></div></div>`;
  } else {
  // Todo depende solo de la carrera (y de su torneo, ya embebido): un único round-trip.
  const tournament=race.cx_tournaments,filters=tournament?{tournamentId:tournament.id,seasonKey:race.seasonKey}:null;
  const [broadcasts,videos,inscritos,results,teamRows,rounds,docAssets,[states,standings,tournamentRaceRows]]=await Promise.all([cxAllRows(supabase,'cx_broadcasts','*',{raceId:race.id}),cxAllRows(supabase,'cx_videos','*',{raceId:race.id}),cxAllRows(supabase,'cx_startlist_riders','*',{raceId:race.id}),cxAllRows(supabase,'cx_results','*',{raceId:race.id}),cxAllRows(supabase,'cx_teams','id,name,nameAliases,uciCode,colorHex,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts'),cxSeasonRounds(supabase,race.seasonKey).then(map=>map,()=>null),cxAllRows(supabase,'assets','id,type,url',{cxRaceId:race.id}),
    filters?Promise.all([cxAllRows(supabase,'cx_standings_state','*',filters,'category'),cxAllRows(supabase,'cx_tournament_standings','*',filters),cxAllRows(supabase,'cx_races','id,name,nameEn,slug,slugEn,class,countryCode',{tournamentId:tournament.id,editorialStatus:'published'})]):[[],[],[]]]);
  const model=cxRaceModel(race,{broadcasts,videos,inscritos,results,teamRows,rounds,docAssets,states,standings,tournamentRaceRows});
  const {categories,multiDate}=model;
  const currentHash=()=>{try{return decodeURIComponent(location.hash.slice(1));}catch{return '';}};
  const initial=cxRaceSelection(model,{pathname:location.pathname,search:location.search,hash:currentHash()});
  // Página generada en el build: cada hueco con la misma huella se conserva
  // (esqueleto, sección de la URL, panel de la categoría visible y columna
  // lateral) y el resto se pinta.
  if(root.dataset.prerendered!=null) {
    applyPrerenderedHtml(root,cxRaceSkeletonHtml(model,initial));
    for(const node of root.querySelectorAll('[data-cx-section]'))applyPrerenderedHtml(node,cxRaceSectionHtml(model,node.dataset.cxSection,initial));
    for(const [key,attribute] of Object.entries(CX_PANEL_ATTRIBUTES)) {
      for(const node of root.querySelectorAll(`[${attribute}]`))applyPrerenderedHtml(node,cxRacePanelHtml(model,key,node.getAttribute(attribute)));
    }
    for(const node of root.querySelectorAll('[data-cx-context]'))applyPrerenderedHtml(node,cxRaceContextHtml(model,initial));
  } else {
    root.innerHTML=cxRacePageHtml(model,initial);
  }
  cxWireStandingsScroll(root);
  // Columna lateral sin pintar hasta que el mapa tiene tamaño: la imagen no
  // trae dimensiones y, al recibirlas tras retirarse la pantalla de carga,
  // bajaba los horarios a la vista (escritorio).
  if(typeof ResizeObserver!=='undefined')for(const img of root.querySelectorAll('.cx-context-map img')){
    if(img.naturalWidth)continue;
    const context=img.closest('.cx-results-context');context.classList.add('cx-results-context--pending');
    const ready=()=>{sized.disconnect();context.classList.remove('cx-results-context--pending');};
    const sized=new ResizeObserver(()=>{if(img.naturalWidth)ready();});
    sized.observe(img);img.addEventListener('error',ready,{once:true});
  }
  // Secciones y categorías quedan fijas; la fila de columnas de las tablas
  // se fija debajo (--res-tabs-h, como en resultados de carretera).
  const stickyNav=root.querySelector('[data-cx-sticky-nav]');
  if(stickyNav){
    const syncStickyNav=()=>document.documentElement?.style.setProperty('--res-tabs-h',`${Math.ceil(stickyNav.getBoundingClientRect().height)}px`);
    syncStickyNav();
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncStickyNav).observe(stickyNav);
  }
  // Sección y categoría de la URL (cxRaceSelection, la misma que pinta el
  // HTML): al navegar dentro de la ficha se alternan sin repintar.
  const selectSection=()=>{
    const selection=cxRaceSelection(model,{pathname:location.pathname,search:location.search,hash:currentHash()});
    const {page,selected,legacyGeneral}=selection;
    if(legacyGeneral!=null)history.replaceState(null,'',cxRacePageUrl(race,lang,'general',legacyGeneral));
    const codes=categories.map(c=>c.category);
    for(const node of root.querySelectorAll('[data-cx-section]'))node.hidden=node.dataset.cxSection!==page;
    // Los vídeos se cargan al abrir su sección: un iframe «lazy» oculto empezaría a descargar el reproductor.
    if(page==='videos')for(const frame of root.querySelectorAll('[data-cx-video-src]')){frame.src=frame.dataset.cxVideoSrc;frame.removeAttribute('data-cx-video-src');}
    for(const node of root.querySelectorAll('[data-cx-section-link]')) {
      const key=node.dataset.cxSectionLink,active=key===page;
      node.classList.toggle('res-tab--active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
      node.href=cxRaceSectionHref(model,key,selection);
    }
    const categoryNav=root.querySelector('[data-cx-category-nav]'),generalNav=root.querySelector('[data-cx-general-nav]');
    categoryNav.hidden=!['results','startlist'].includes(page)||!codes.length;
    if(generalNav)generalNav.hidden=page!=='general';
    for(const node of root.querySelectorAll('[data-cx-startlist-category]'))node.hidden=node.dataset.cxStartlistCategory!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-classification-content]'))node.hidden=node.dataset.cxClassificationContent!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-context-category]'))node.classList.toggle('cx-schedule__row--active',node.dataset.cxContextCategory===selected.category);
    for(const node of root.querySelectorAll('[data-cx-general]'))node.hidden=node.dataset.cxGeneral!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-classification],[data-cx-general-classification]')) {
      const active=(node.dataset.cxClassification||node.dataset.cxGeneralClassification)===selected.category;
      node.classList.toggle('res-stage-btn--active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    }
    seo(race);
  };
  root.addEventListener('click',event=>{
    const map=event.target.closest('[data-cx-map-open]');
    if(map&&!event.defaultPrevented&&!event.button&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey) {
      event.preventDefault();window.openAssetModal(map.href,t('assets.map'));return;
    }
    // «Ver» de una emisión embebible: modal de TV con la categoría y su fecha;
    // las comunes llevan la fecha de la prueba cuando es de un solo día.
    if(cxOpenTvEmbed(event,link=>{
      const category=categories.find(c=>c.category===link.dataset.tvCategory);
      return {race,category:category?.category,dateKey:category?cxCategoryDate(race,category):multiDate?'':categories.length?cxCategoryDate(race,categories[0]):race.dateKey};
    }))return;
    const button=event.target.closest('[data-cx-tv-filter]');
    if(button) {
      const section=button.closest('.cx-media-section'),all=button.dataset.cxTvFilter==='mine';
      section.querySelectorAll('[data-cx-regional-hidden]').forEach(node=>node.hidden=!all);
      section.querySelector('[data-cx-no-region]')?.toggleAttribute('hidden',all);
      button.dataset.cxTvFilter=all?'all':'mine';button.textContent=t(all?'tv.filterMine':'tv.filterAll');button.setAttribute('aria-pressed',String(all));return;
    }
    const link=event.target.closest('a[href]');
    if(!link||event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.hasAttribute('download')||link.target&&link.target!=='_self')return;
    const url=new URL(link.href,location.href),targetRoute=cxRacePageLocation(url.pathname,url.search);
    if(url.origin!==location.origin||targetRoute.slug!==(lang==='en'?(race.slugEn||race.slug):race.slug))return;
    event.preventDefault();
    if(url.href!==location.href)history.pushState(null,'',url.pathname+url.search+url.hash);
    selectSection();
    // Al cambiar de sección o clasificación, la página sube como máximo hasta
    // donde se fija la barra de secciones y categorías.
    limitScrollToStickyStart(stickyNav);
  });
  window.addEventListener('popstate',selectSection);
  window.addEventListener('hashchange',selectSection);
  selectSection();
  }
}catch(error){root.innerHTML=`<div class="race-header cx-race-header"><h1 class="race-header__name">${t('cx.title')}</h1><p role="alert">${esc(error.message)}</p><div class="cx-race-actions"><a href="${lang==='en'?'/en/cyclocross/':'/ciclocross/'}">${t('cx.back')}</a><button type="button" class="tv-filter-btn" data-cx-retry>${t('cx.retry')}</button></div></div>`;root.querySelector('[data-cx-retry]').onclick=()=>location.reload();}
