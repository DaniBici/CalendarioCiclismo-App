import {startlistCyclistHtml,resultsTrophyHtml} from './services/race-presentation.js?v=20260912cxactionicons';
import {cxLogoImage} from './components/cx-logo.js?v=20260912cxlogos1';
import {supabase,countryFlag,buildRaceHeader,findMatchingTeam,setMeta,setMetaProperty,filterBroadcastsByRegion,seoLongDateWeekday} from './shared.js';
import {initI18n,t,getLang,getLocale} from './i18n.js?v=20260914cxsections2';
import {cxQuery,cxAllRows,cxSeasonRounds,cxIsHidden,CX_SPANISH_AUDIENCE} from './services/cx-data.js?v=20260927cxhidden';
import {cxEsc as esc,cxCategories,cxCategoryDate,cxRaceName,cxRacePageUrl,cxRacePageLocation,cxClassificationSelection,cxTime,cxClassLabel,cxStandingTotal,cxRankSort,cxCategoryMedia,cxResultCategories,cxGeneralCategories,cxRoundLabel,cxResultCells,cxResultRank} from './cx/presentation.js?v=20260927cxhms1';
import {teamStripes} from './team-appearance.js';
import {cxRaceSeo} from './cx/race-seo.js?v=20260914cxseo3';
import {cxUrl,cxYouTubeVideoId} from './cx/editor-logic.js?v=20260924cxyoutube1';
import {cxDateInSeason} from './cx/season.js?v=20260912cxmonths7';
import {mountCxPublicEditButton} from './cx/public-edit.js?v=20260914cxpublicedit';
import './race-assets.js?v=20260913cxdocs';
import {limitScrollToStickyStart} from './results/dom.js?v=20260927stickyscroll';

await initI18n();
const root=document.getElementById('cxRaceContent'),lang=getLang(),locale=getLocale();
const safeLink=url=>{try{return cxUrl(url);}catch{return null;}};
const sourceId=root.querySelector('[data-cx-race-id]')?.dataset.cxRaceId;
const route=cxRacePageLocation(location.pathname,location.search);
let page=route.page;
const dateLabel=date=>new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
window.ccHeaderBack?.({href:lang==='en'?'/en/cyclocross/':'/ciclocross/',label:t('cx.back')});

function external(url,label,asset=false) {const safe=safeLink(url);return safe?`<a class="${asset?'asset-btn':'tv-link-btn'}" href="${esc(safe)}" target="_blank" rel="noopener">${asset?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-5 6-5 14 0 20 5-6 5-14 0-20"/></svg>':''}<span class="${asset?'asset-btn__label':''}">${esc(label)}</span></a>`:'';}
// Zona de documentos de la jornada CX, con la misma presentación que carretera:
// web oficial · Libro de Ruta · Mapa en la tira enmarcada `.asset-links`.
const R2_ASSET_BASE='https://assets.calendariociclismo.app';
const CX_DOC_SVGS={
  website:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  technicalGuide:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
  map:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
};
function cxDocBtn(url,label,iconKey) {
  if(!url)return '';
  const isR2=url.startsWith(R2_ASSET_BASE);
  if(isR2&&window.innerWidth>=768) {
    const safeUrl=url.replace(/'/g,"\\'"),safeTxt=label.replace(/'/g,"\\'");
    return `<button class="asset-btn" onclick="openAssetModal('${safeUrl}','${safeTxt}')">${CX_DOC_SVGS[iconKey]}<span class="asset-btn__label">${esc(label)}</span></button>`;
  }
  return `<a class="asset-btn" href="${esc(url)}" target="_blank" rel="noopener">${CX_DOC_SVGS[iconKey]}<span class="asset-btn__label">${esc(label)}</span></a>`;
}
function docsStrip(race,assets=[]) {
  const pick=type=>assets.find(a=>a.type===type&&a.url)?.url;
  const buttons=[cxDocBtn(safeLink(race.websiteUrl),t('stage.websiteLabel'),'website'),
    cxDocBtn(pick('technicalGuide'),t('assets.technicalGuide'),'technicalGuide'),
    cxDocBtn(pick('map'),t('assets.map'),'map')].filter(Boolean).join('');
  return buttons?`<section class="jornada-section cx-race-docs"><div class="asset-links-wrap"><div class="asset-links">${buttons}</div></div></section>`:'';
}
function table(rows,header,value,teamList) {
  const hasTeam=rows.some(row=>String(row.teamName||'').trim());
  const values=new Map(rows.map(row=>[row,value(row)]));
  // Las vueltas perdidas necesitan una columna de tiempo más ancha en móvil
  // para no partirse en dos líneas y descuadrar la altura de la fila.
  const hasLaps=[...values.values()].some(html=>html.includes('class="res-lap"'));
  return `<div class="res-table-wrap"><table class="so-table res-table${hasLaps?' res-table--laps':''}"><thead><tr><th class="so-th res-th--rank">#</th><th class="so-th res-th--rider">${t('cx.rider')}</th>${hasTeam?`<th class="so-th res-th--team">${t('cx.team')}</th>`:''}<th class="so-th res-th--result">${esc(header)}</th></tr></thead><tbody>${[...rows].sort(cxRankSort).map(row=>{
    const team=findMatchingTeam(row.teamName,teamList),badge=team?teamStripes(team):'',rank=cxResultRank(row,lang);
    return `<tr class="so-row"><td class="so-td res-td--rank">${typeof rank==='number'?rank:`<span class="res-rank-dnf">${esc(rank)}</span>`}</td><td class="so-td res-td--rider"><span class="so-flag">${countryFlag(row.isoCode2)}</span><span class="res-rider-main"><span class="res-rider-name">${esc(row.riderDisplay)}</span>${row.teamName?`<span class="res-rider-team">${badge}${esc(row.teamName)}</span>`:''}</span></td>${hasTeam?`<td class="so-td res-td--team">${row.teamName?`<span class="res-team-cell">${badge}${esc(row.teamName)}</span>`:''}</td>`:''}<td class="so-td res-td--result">${values.get(row)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function startlist(rows,teams) {
  if(!rows.length)return `<p class="cx-empty">${t('cx.noStartlist')}</p>`;
  return `<div class="cx-startlist">${[...rows].sort((a,b)=>a.sortOrder-b.sortOrder).map(r=>{
    const team=teams.get(r.teamId),badge=team?teamStripes(team):'';
    return `<div class="startlist-rider"><span class="startlist-rider__dorsal">${esc(r.bib||'')}</span><span class="startlist-rider__flag">${countryFlag(r.countryCode)}</span><span class="startlist-rider__name">${esc(`${r.firstName} ${r.lastName}`)}${badge?`<span class="cx-team-badge" title="${esc(team.name)}">${badge}</span>`:''}</span></div>`;
  }).join('')}</div>`;
}
function tvEntry(row,hidden,revive=false) {
  const time=!revive&&cxTime(row.startTimeUtc,locale);
  return `<div class="tv-entry" ${hidden?'data-cx-regional-hidden hidden':''}><div class="cx-media-label"><div class="tv-entry__platform-row"><span class="tv-entry__platform">${esc(row.channel||row.title)}</span>${hidden?`<span class="badge badge--uci" data-cx-region>${esc(t(`cx.regions.${row.country}`))}</span>`:''}</div>${row.note?`<div class="tv-entry__channel">${esc(row.note)}</div>`:''}</div><div class="cx-media-actions">${time?`<time class="tv-entry__time" title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(time)}</time>`:''}${external(row.url,`${t('stage.watch')} ↗`)}</div></div>`;
}
function reviveMedia(rows) {
  if(!rows.length)return '';
  return `<section class="jornada-section cx-media-section"><h2 class="jornada-section__title">${t('tv.reviveRaceTitle')}</h2><div class="stage-tv-grid">${rows.map(row=>tvEntry(row,false,true)).join('')}</div></section>`;
}
function videoMedia(rows) {
  if(!rows.length)return '';
  return `<section class="jornada-section cx-video-section"><h2 class="jornada-section__title">${t('cx.videos')}</h2><div class="cx-video-grid">${rows.map(row=>{
    const id=cxYouTubeVideoId(row.url),title=esc(row.title);
    return `<article class="cx-video-card"><h3>${title}</h3><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>${external(row.url,'YouTube ↗')}</article>`;
  }).join('')}</div></section>`;
}
// TV de la jornada CX con la presentación de carretera, dividida por
// categorías: emisiones comunes (sin categoría) sin encabezado y un bloque
// por categoría con sus emisiones, en el orden CX.
function tvGroups(broadcasts,categories) {
  if(!broadcasts.length)return '';
  const mine=new Set(filterBroadcastsByRegion(broadcasts)),hasHidden=mine.size<broadcasts.length;
  const group=(label,rows)=>rows.length?`<div class="cx-tv-group">${label?`<h3 class="cx-tv-group__title">${esc(label)}</h3>`:''}<div class="stage-tv-grid">${rows.map(row=>tvEntry(row,!mine.has(row))).join('')}</div></div>`:'';
  const html=group('',broadcasts.filter(row=>!row.category))+categories.map(c=>group(t(`cx.category.${c.category}`),broadcasts.filter(row=>row.category===c.category))).join('');
  if(!html)return '';
  return `<section class="jornada-section cx-media-section"><div class="jornada-section__title-row"><h2 class="jornada-section__title">${t('cx.tv')}</h2>${hasHidden?`<button type="button" class="tv-filter-btn" data-cx-tv-filter="mine" aria-pressed="false">${t('tv.filterAll')}</button>`:''}</div>${!mine.size?`<p class="cx-empty" data-cx-no-region>${t('tv.noTvRegion')}</p>`:''}${html}</section>`;
}
function mapImageUrl(assets) {
  const url=safeLink(assets.find(asset=>asset.type==='map'&&asset.url)?.url);
  return url&&/\.(jpe?g|png)$/i.test(new URL(url).pathname)?url:null;
}
function mapLink(url,label) {
  return `<a class="cx-map-preview" href="${esc(url)}" target="_blank" rel="noopener" data-cx-map-open aria-label="${label}"><img src="${esc(url)}" alt="${label}" loading="lazy"></a>`;
}
function mapPreview(assets) {
  const url=mapImageUrl(assets);
  if(!url)return '';
  const label=esc(t('assets.map'));
  return `<section class="jornada-section cx-programme-map"><h2 class="jornada-section__title">${label}</h2>${mapLink(url,label)}</section>`;
}
// Solo cuentan las categorías con horario verificado.
function scheduledCategories(race,categories) {
  return [...categories].sort((a,b)=>cxCategoryDate(race,a).localeCompare(cxCategoryDate(race,b))||(Date.parse(a.startTimeUtc)||Infinity)-(Date.parse(b.startTimeUtc)||Infinity)).filter(c=>c.startTimeUtc);
}
// Columna lateral de resultados, como en carretera: mapa reducido y datos
// esenciales de la jornada (en CX, el horario de cada categoría).
function resultsContext(race,categories,multiDate,assets) {
  const url=mapImageUrl(assets),label=esc(t('assets.map'));
  const map=url?`<section class="stage-profile-panel cx-context-map"><header class="stage-profile-heading"><h2>${label}</h2></header>${mapLink(url,label)}</section>`:'';
  const dayLabel=date=>new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const rows=scheduledCategories(race,categories).map(c=>{
    const value=race.isCancelled||c.isCancelled?t('stage.cancelled'):`${multiDate?`${dayLabel(cxCategoryDate(race,c))} · `:''}${cxTime(c.startTimeUtc,locale)}`;
    return `<div data-cx-context-category="${esc(c.category)}"><dt>${esc(t(`cx.category.${c.category}`))}</dt><dd>${esc(value)}</dd></div>`;
  }).join('');
  const data=rows?`<section class="res-stage-data"><h2>${lang==='en'?'Race data':'Datos de la jornada'}</h2><dl>${rows}</dl></section>`:'';
  return map||data?`<aside class="res-context cx-results-context">${map}${data}</aside>`:'';
}

function programme(race,categories,results,multiDate,assets=[]) {
  const scheduled=scheduledCategories(race,categories);
  const rows=scheduled.map(c=>{
    const cancelled=race.isCancelled||c.isCancelled,hasResults=['official','provisional'].includes(c.resultsStatus)&&results.some(row=>row.category===c.category);
    const badges=`${c.startlistImportedAt?`<a class="badge badge--startlist" href="${esc(cxRacePageUrl(race,lang,'startlist',c.category))}">${startlistCyclistHtml} ${t('cx.startlist')}</a>`:''}${hasResults?`<a class="badge badge--results" href="${esc(cxRacePageUrl(race,lang,'results',c.category))}">${resultsTrophyHtml} ${t('stage.viewResults')}</a>`:''}`;
    return `<section class="cx-programme-row" id="${c.category}"><div class="cx-programme-top"><div class="cx-programme-heading"><time title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(cancelled?t('stage.cancelled'):cxTime(c.startTimeUtc,locale))}</time><h3>${esc(t(`cx.category.${c.category}`))}</h3></div>${badges?`<div class="cx-programme-actions">${badges}</div>`:''}</div>${multiDate?`<p>${esc(dateLabel(cxCategoryDate(race,c)))}</p>`:''}</section>`;
  }).join('');
  const map=mapPreview(assets),schedule=rows?`<section class="jornada-section cx-programme-schedule"><h2 class="jornada-section__title">${t('stage.schedule')}</h2><div class="cx-programme-grid">${rows}</div></section>`:`<p class="cx-empty">${t('cx.noCategories')}</p>`;
  return map?`<div class="cx-programme-layout">${schedule}${map}</div>`:schedule;
}
async function findRace() {
  const select='*,cx_race_categories(*),cx_tournaments(*)';
  const base=()=>supabase.from('cx_races').select(select).eq('editorialStatus','published');
  if(sourceId)return cxQuery(base().eq('id',sourceId).maybeSingle());
  const params=new URLSearchParams(location.search),id=params.get('raceId');
  if(id)return cxQuery(base().eq('id',id).maybeSingle());
  const slug=params.get('slug')||route.slug;
  let race=await cxQuery(base().eq(lang==='en'?'slugEn':'slug',slug).maybeSingle());
  if(!race&&lang==='en')race=await cxQuery(base().eq('slug',slug).maybeSingle());
  return race;
}
function seo(race) {
  // La raíz conserva su canonical aunque abra resultados por defecto. Las
  // vistas ?view= comparten la URL indexable de la jornada, sin duplicados.
  const canonicalPage=cxRacePageLocation(location.pathname).page;
  const {title,description}=cxRaceSeo(race,canonicalPage,seoLongDateWeekday);
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
  const race=await findRace();if(!race||!cxDateInSeason(race.seasonKey,race.dateKey)||(race.endDateKey&&!cxDateInSeason(race.seasonKey,race.endDateKey)))throw new Error(t('cx.notFound'));
  if(cxIsHidden(race,lang)){
    document.querySelector('link[rel=alternate][hreflang="en"]')?.remove();
    setMeta('robots','noindex');
    root.innerHTML=`<div class="race-header cx-race-header"><h1 class="race-header__name">${esc(CX_SPANISH_AUDIENCE.title)}</h1><p>${esc(CX_SPANISH_AUDIENCE.text)}</p><div class="cx-race-actions"><a href="${esc(cxRacePageUrl(race,'es'))}">${esc(CX_SPANISH_AUDIENCE.link)}</a></div></div>`;
  } else {
  const [broadcasts,videos,inscritos,results,teamRows,rounds,docAssets]=await Promise.all([cxAllRows(supabase,'cx_broadcasts','*',{raceId:race.id}),cxAllRows(supabase,'cx_videos','*',{raceId:race.id}),cxAllRows(supabase,'cx_startlist_riders','*',{raceId:race.id}),cxAllRows(supabase,'cx_results','*',{raceId:race.id}),cxQuery(supabase.from('cx_teams').select('id,name,nameAliases,uciCode,colorHex,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,badgeInnerCircle,badgeShorts')),cxSeasonRounds(supabase,race.seasonKey).then(map=>map,()=>null),cxAllRows(supabase,'assets','id,type,url',{cxRaceId:race.id})]);
  const teams=new Map(teamRows.map(team=>[team.id,team]));
  const teamList=teamRows.map(team=>({...team,nameAliases:(team.nameAliases||[]).join('\n')}));
  const tournament=race.cx_tournaments,filters=tournament?{tournamentId:tournament.id,seasonKey:race.seasonKey}:null;
  const [states,standings]=filters?await Promise.all([cxAllRows(supabase,'cx_standings_state','*',filters,'category'),cxAllRows(supabase,'cx_tournament_standings','*',filters)]):[[],[]];
  const actualCategories=cxCategories(race),publishedCategories=cxResultCategories(race,results);
  // La raíz de una jornada terminada abre la clasificación principal, igual
  // que los accesos directos de resultados en las apps.
  const generalCategories=cxGeneralCategories(race,standings,results,states);
  const hasProgramme=actualCategories.some(c=>c.startTimeUtc);
  const hasStartlist=inscritos.length>0;
  const defaultPage=publishedCategories.length?'results':hasProgramme?'programme':hasStartlist?'startlist':'programme';
  if(page==='race')page=defaultPage;
  // La TV vive dentro del programa, debajo de horarios: los enlaces antiguos
  // ?view=tv aterrizan ahí.
  if(page==='tv')page='programme';
  const categories=actualCategories;
  const visibleBroadcasts=filterBroadcastsByRegion(broadcasts);
  const selectedMedia=categories.length?categories.map(c=>cxCategoryMedia(broadcasts,videos,c.category,{
    hasResults:['official','provisional'].includes(c.resultsStatus)&&results.some(row=>row.category===c.category),
    cancelled:race.isCancelled||c.isCancelled,visibleBroadcasts,
  })):[cxCategoryMedia(broadcasts,videos,'',{cancelled:race.isCancelled,visibleBroadcasts})];
  const unique=(entries,key)=>[...new Map(entries.map(row=>[key(row),row])).values()];
  const tvRows=unique(selectedMedia.flatMap(selected=>selected.tv),row=>row.id||`${row.category||''}|${row.url}|${row.country||'ALL'}|${row.channel||''}`)
    .sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0));
  const reviveRows=unique(selectedMedia.flatMap(selected=>selected.revive),row=>row.url)
    .sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0));
  const videoRows=unique(selectedMedia.flatMap(selected=>selected.videos).filter(row=>cxYouTubeVideoId(row.url)),row=>cxYouTubeVideoId(row.url))
    .sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0));
  const sectionTabs=[
    hasProgramme?['programme',t('cx.programme')]:null,
    hasStartlist||page==='startlist'?['startlist',t('cx.startlist')]:null,
    publishedCategories.length||page==='results'?['results',t('stage.results')]:null,
    videoRows.length?['videos',t('cx.videos')]:null,
  ].filter(Boolean);
  if(!sectionTabs.length)sectionTabs.push(['programme',t('cx.programme')]);
  const categoryNavigation=`<nav class="res-stages cx-classification-nav cx-category-nav" data-cx-category-nav aria-label="${esc(t('cx.categories'))}"><div class="res-stages__inner">${categories.map(c=>`<a class="res-stage-btn" data-cx-classification="${c.category}" href="#${c.category}" aria-label="${esc(t(`cx.category.${c.category}`))}">${c.category}</a>`).join('')}${generalCategories.length?`<a class="res-stage-btn" data-cx-classification="general" href="#general">${t('cx.standings')}</a>`:''}</div></nav>`;
  // Selector de secciones oculto cuando solo hay una disponible, como en las apps.
  const sectionNavigation=sectionTabs.length>1?`<div class="res-tabs-bar cx-section-nav"><nav class="res-tabs" aria-label="${esc(cxRaceName(race,lang))}"><div class="res-tabs__scroll"><div class="res-tabs__inner">${sectionTabs.map(([key,label])=>`<a class="res-tab" data-cx-section-link="${key}" href="${esc(cxRacePageUrl(race,lang,key))}">${esc(label)}</a>`).join('')}</div></div></nav></div>`:'';
  const cxPublicationStatus=category=>{
    const source=String(category.resultsSourceUrl||'').toLowerCase();
    const inputSource=String(category.resultsEvidence?.inputSource||'').toLowerCase();
    const date=cxCategoryDate(race,category),todayKey=new Date().toISOString().slice(0,10);
    // DataRide es fuente oficial por contrato, aunque la ingesta mantenga
    // resultsStatus=provisional mientras se completa la revisión interna.
    return source.includes('dataride.uci.ch')||inputSource==='dataride'||date<todayKey||category.resultsStatus==='official'?'official':'provisional';
  };
  const publicationHtml=status=>`<div class="res-publication"><div class="res-publication-line"><span>${status==='official'?(lang==='en'?'Official':'Oficial'):(lang==='en'?'Provisional':'Provisional')}</span></div></div>`;
  const classificationPanels=categories.map(c=>{
    const rows=publishedCategories.includes(c.category)?results.filter(r=>r.category===c.category).sort((a,b)=>a.sortOrder-b.sortOrder):[],cells=cxResultCells(rows,lang);
    return `<div data-cx-classification-content="${esc(c.category)}">${rows.length?`${publicationHtml(cxPublicationStatus(c))}${table(rows,t('cx.time'),r=>{const cell=cells.get(r);return `<span class="${cell.cls}">${esc(cell.text)}</span>`;},teamList)}`:`<p class="cx-empty">${t('cx.noResults')}</p>`}</div>`;
  }).join('');
  const generalClassificationHtml=generalCategories.length?`<div id="general" data-cx-general-section><nav class="res-stages cx-classification-nav" aria-label="${esc(t('cx.standings'))}"><div class="res-stages__inner">${generalCategories.map(code=>`<a class="res-stage-btn" data-cx-general-classification="${code}" href="#general-${code}">${code}</a>`).join('')}</div></nav>${generalCategories.map(category=>{
    const rows=standings.filter(s=>s.category===category);
    const configured=tournament?.pointsScheme?.categories?.[category]?.mode,scheme={mode:['points','time'].includes(configured)?configured:rows.some(row=>row.timeSeconds!=null)?'time':'points'};
    return `<div data-cx-general="${esc(category)}">${rows.length?`${publicationHtml('official')}${table(rows,scheme.mode==='time'?t('cx.totalTime'):t('cx.points'),r=>`<span class="res-pts">${esc(cxStandingTotal(r,scheme.mode,locale))}</span>`,teamList)}`:`<p class="cx-empty">${t('cx.noStandings')}</p>`}</div>`;
  }).join('')}</div>`:'';
  const multiDate=new Set(categories.map(c=>cxCategoryDate(race,c))).size>1;
  const contextHtml=resultsContext(race,categories,multiDate,docAssets);
  const classificationsHtml=`<div class="res-layout cx-classification-page${contextHtml?' res-layout--context':''}"><div class="res-main">${classificationPanels||`<p class="cx-empty">${t('cx.noResults')}</p>`}${generalClassificationHtml}</div>${contextHtml}</div>`;
  const startlistHtml=categories.map(c=>`<section class="cx-category-section" data-cx-startlist-category="${c.category}"><div class="cx-category-content">${startlist(inscritos.filter(row=>row.category===c.category),teams)}</div></section>`).join('');
  const capitalizeDate=value=>value?value.charAt(0).toLocaleUpperCase(lang)+value.slice(1):value;
  const headerDate= race.dateKey ? capitalizeDate(seoLongDateWeekday(race.dateKey,lang)) + (race.endDateKey&&race.endDateKey!==race.dateKey?` – ${capitalizeDate(seoLongDateWeekday(race.endDateKey,lang))}`:'') : '';
  const roundLabel=cxRoundLabel(rounds?.get(race.id));
  const headerDetail=[cxClassLabel(race.class,lang),tournament&&cxRaceName(tournament,lang),roundLabel?.text,race.venue&&race.venue!==cxRaceName(race,lang)?race.venue:''].filter(Boolean).join(' · ');
  const headerHtml=buildRaceHeader({race:{...race,logoUrl:null},nameHref:'',detail:headerDetail,date:esc(headerDate),action:'',extraHtml:race.isCancelled?`<p class="jornada-cancelled-banner">${t('stage.cancelled')}</p>`:''});
  root.innerHTML=`${headerHtml}${docsStrip(race,docAssets)}<div class="cx-sticky-nav" data-cx-sticky-nav>${sectionNavigation}${categoryNavigation}</div><div data-cx-section="results" hidden>${classificationsHtml}</div><div class="cx-race-sections" data-cx-section="startlist" hidden>${startlistHtml||`<p class="cx-empty">${t('cx.noStartlist')}</p>`}</div><div class="cx-race-sections" data-cx-section="programme" hidden>${programme(race,categories,results,multiDate,docAssets)}${tvGroups(tvRows,categories)}${reviveMedia(reviveRows)}</div><div class="cx-race-sections" data-cx-section="videos" hidden>${videoMedia(videoRows)||`<p class="cx-empty">${t('cx.noVideos')}</p>`}</div>`;
  const logo=cxLogoImage(race,tournament,{className:'race-header__logo'});
  if(logo){const brand=root.querySelector('.race-header__flag--solo'),flag=document.createElement('span');flag.className='race-header__flag';flag.append(...brand.childNodes);brand.className='race-header__brand';brand.append(logo,flag);}
  // Secciones y categorías quedan fijas; la fila de columnas de las tablas
  // se fija debajo (--res-tabs-h, como en resultados de carretera).
  const stickyNav=root.querySelector('[data-cx-sticky-nav]');
  if(stickyNav){
    const syncStickyNav=()=>document.documentElement?.style.setProperty('--res-tabs-h',`${Math.ceil(stickyNav.getBoundingClientRect().height)}px`);
    syncStickyNav();
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncStickyNav).observe(stickyNav);
  }
  const editButton=mountCxPublicEditButton(supabase,root,race.id,{getSection:()=>page,lang,basePath:typeof CONFIG==='undefined'?'':CONFIG.basePath});
  const selectSection=()=>{
    const currentRoute=cxRacePageLocation(location.pathname,location.search);
    page=currentRoute.page==='race'||(currentRoute.page==='videos'&&!videoRows.length)?defaultPage:currentRoute.page==='tv'?'programme':currentRoute.page;
    editButton.update();
    let hash;try{hash=decodeURIComponent(location.hash.slice(1));}catch{hash='';}
    const codes=categories.map(c=>c.category);
    const availableCodes=page==='results'?publishedCategories:page==='startlist'?codes.filter(code=>inscritos.some(row=>row.category===code)):codes;
    const selected=cxClassificationSelection(hash,!hash&&availableCodes.length?availableCodes:codes,page==='results'?generalCategories:[]);
    for(const node of root.querySelectorAll('[data-cx-section]'))node.hidden=node.dataset.cxSection!==page;
    for(const node of root.querySelectorAll('[data-cx-section-link]')) {
      const active=node.dataset.cxSectionLink===page;
      node.classList.toggle('res-tab--active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
      // Conserva la categoría al alternar entre inscritos y resultados.
      node.href=cxRacePageUrl(race,lang,node.dataset.cxSectionLink,selected.section==='results'?selected.category||'':'');
    }
    const categoryNav=root.querySelector('[data-cx-category-nav]');
    categoryNav.hidden=!['results','startlist'].includes(page)||!codes.length;
    for(const node of root.querySelectorAll('[data-cx-startlist-category]'))node.hidden=node.dataset.cxStartlistCategory!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-classification-content]'))node.hidden=selected.section!=='results'||node.dataset.cxClassificationContent!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-context-category]'))node.classList.toggle('res-stage-data__active',selected.section==='results'&&node.dataset.cxContextCategory===selected.category);
    const generalSection=root.querySelector('[data-cx-general-section]');if(generalSection)generalSection.hidden=selected.section!=='general';
    for(const node of root.querySelectorAll('[data-cx-general]'))node.hidden=node.dataset.cxGeneral!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-classification],[data-cx-general-classification]')) {
      const active=node.dataset.cxClassification===(selected.section==='general'?'general':selected.category)||selected.section==='general'&&node.dataset.cxGeneralClassification===selected.category;
      node.classList.toggle('res-stage-btn--active',active);
      if(node.dataset.cxClassification==='general')node.hidden=page!=='results';
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    }
    seo(race);
  };
  root.addEventListener('click',event=>{
    const map=event.target.closest('[data-cx-map-open]');
    if(map&&!event.defaultPrevented&&!event.button&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey) {
      event.preventDefault();window.openAssetModal(map.href,t('assets.map'));return;
    }
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
