import {startlistCyclistHtml,resultsTrophyHtml} from './services/race-presentation.js';
import {cxLogoImage} from './components/cx-logo.js';
import {supabase,countryFlag,buildRaceHeader,findMatchingTeam,setMeta,setMetaProperty,filterBroadcastsByRegion,broadcastRegionBadgeLabel,seoLongDateWeekday,orEqFilter,pickByPreference} from './shared.js';
import {initI18n,t,getLang,getLocale} from './i18n.js';
import {cxQuery,cxAllRows,cxSeasonRounds,cxIsHidden,CX_SPANISH_AUDIENCE} from './services/cx-data.js';
import {cxEsc as esc,cxCategories,cxCategoryDate,cxRaceName,cxRaceUrl,cxRacePageUrl,cxRacePageLocation,cxClassificationSelection,cxLegacyGeneralFragment,cxTime,cxClassName,cxRankSort,cxRaceMedia,cxProgrammeOrder,cxResultCategories,cxGeneralCategories,cxGeneralSourceCategory,cxStandingMode,cxRoundLabel,cxResultCells,cxResultRank} from './cx/presentation.js';
import {cxStandingsTableHtml,cxWireStandingsScroll} from './cx/standings-table.js';
import {teamStripes} from './team-appearance.js';
import {cxRaceSeo} from './cx/race-seo.js';
import {cxUrl,cxYouTubeVideoId} from './cx/editor-logic.js';
import {cxDateInSeason} from './cx/season.js';
import './race-assets.js';
import {limitScrollToStickyStart} from './results/dom.js';

const root=document.getElementById('cxRaceContent'),lang=getLang();
const sourceId=root.querySelector('[data-cx-race-id]')?.dataset.cxRaceId;
const route=cxRacePageLocation(location.pathname,location.search);
// La carrera se pide a la vez que el diccionario EN.
const racePromise=findRace();
racePromise.catch(()=>{});
await initI18n();
const locale=getLocale();
const safeLink=url=>{try{return cxUrl(url);}catch{return null;}};
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
  return `<div class="tv-entry" ${hidden?'data-cx-regional-hidden hidden':''}><div class="cx-media-label"><div class="tv-entry__platform-row"><span class="tv-entry__platform">${esc(row.channel||row.title)}</span>${hidden&&broadcastRegionBadgeLabel(row.country)?`<span class="badge badge--uci" data-cx-region>${esc(broadcastRegionBadgeLabel(row.country))}</span>`:''}</div>${row.note?`<div class="tv-entry__channel">${esc(row.note)}</div>`:''}</div><div class="cx-media-actions">${time?`<time class="tv-entry__time" title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(time)}</time>`:''}${external(row.url,`${t('stage.watch')} ↗`)}</div></div>`;
}
function reviveMedia(rows) {
  if(!rows.length)return '';
  return `<section class="jornada-section cx-media-section"><h2 class="jornada-section__title">${t('tv.reviveRaceTitle')}</h2><div class="stage-tv-grid">${rows.map(row=>tvEntry(row,false,true)).join('')}</div></section>`;
}
function videoMedia(rows) {
  if(!rows.length)return '';
  return `<section class="jornada-section cx-video-section" aria-label="${esc(t('cx.videos'))}"><div class="cx-video-grid">${rows.map(row=>{
    const id=cxYouTubeVideoId(row.url),title=esc(lang==='en'&&row.titleEn||row.title);
    return `<article class="cx-video-card"><h3>${title}</h3><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>${external(row.url,'YouTube ↗')}</article>`;
  }).join('')}</div></section>`;
}
// TV de la jornada CX con la presentación de carretera, dividida por
// categorías: emisiones comunes (sin categoría) sin encabezado y un bloque
// por categoría en directo, en el orden del programa.
function tvGroups(broadcasts,categories) {
  if(!broadcasts.length)return '';
  const mine=new Set(filterBroadcastsByRegion(broadcasts)),hasHidden=mine.size<broadcasts.length;
  const group=(label,rows)=>rows.length?`<div class="cx-tv-group"${rows.some(row=>mine.has(row))?'':' data-cx-regional-hidden hidden'}>${label?`<h3 class="cx-tv-group__title">${esc(label)}</h3>`:''}<div class="stage-tv-grid">${rows.map(row=>tvEntry(row,!mine.has(row))).join('')}</div></div>`:'';
  const html=group('',broadcasts.filter(row=>!row.category))+categories.map(c=>group(t(`cx.category.${c.category}`),broadcasts.filter(row=>row.category===c.category))).join('');
  if(!html)return '';
  return `<section class="jornada-section cx-media-section"><div class="jornada-section__title-row"><h2 class="jornada-section__title">${t('cx.tv')}</h2>${hasHidden?`<button type="button" class="stage-key-toggle" data-cx-tv-filter="mine" aria-pressed="false">${t('tv.filterAll')}</button>`:''}</div>${!mine.size?`<p class="cx-empty" data-cx-no-region>${t('tv.noTvRegion')}</p>`:''}${html}</section>`;
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
  return `<section class="stage-profile-panel cx-programme-map"><header class="stage-profile-heading"><h2>${label}</h2></header>${mapLink(url,label)}</section>`;
}
// Solo cuentan las categorías con horario verificado.
function scheduledCategories(race,categories) {
  return cxProgrammeOrder(race,categories).filter(c=>c.startTimeUtc);
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

function programme(race,categories,results,multiDate,assets=[],hasMedia=false) {
  const scheduled=scheduledCategories(race,categories);
  const rows=scheduled.map(c=>{
    const cancelled=race.isCancelled||c.isCancelled,hasResults=['official','provisional'].includes(c.resultsStatus)&&results.some(row=>row.category===c.category);
    const badges=`${c.startlistImportedAt?`<a class="badge badge--startlist badge--icon" href="${esc(cxRacePageUrl(race,lang,'startlist',c.category))}" title="${esc(t('cx.startlist'))}" aria-label="${esc(t('cx.startlist'))}">${startlistCyclistHtml}<span class="badge__label">${esc(t('cx.startlist'))}</span></a>`:''}${hasResults?`<a class="badge badge--results badge--icon" href="${esc(cxRacePageUrl(race,lang,'results',c.category))}" title="${esc(t('stage.viewResults'))}" aria-label="${esc(t('stage.viewResults'))}">${resultsTrophyHtml}<span class="badge__label">${esc(t('stage.viewResults'))}</span></a>`:''}`;
    return `<section class="cx-programme-row" id="${c.category}"><div class="cx-programme-top"><div class="cx-programme-heading"><time title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(cancelled?t('stage.cancelled'):cxTime(c.startTimeUtc,locale))}</time><h3>${esc(t(`cx.category.${c.category}`))}</h3></div>${badges?`<div class="cx-programme-actions">${badges}</div>`:''}</div>${multiDate?`<p>${esc(dateLabel(cxCategoryDate(race,c)))}</p>`:''}</section>`;
  }).join('');
  const map=mapPreview(assets),schedule=rows?`<section class="stage-profile-panel cx-programme-schedule"><header class="stage-profile-heading"><h2>${t('stage.schedule')}</h2></header><div class="cx-programme-grid">${rows}</div></section>`:hasMedia?'':`<p class="cx-empty">${t('cx.noCategories')}</p>`;
  return map?`<div class="cx-programme-layout">${schedule}${map}</div>`:schedule;
}
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
  const teams=new Map(teamRows.map(team=>[team.id,team]));
  const teamList=teamRows.map(team=>({...team,nameAliases:(team.nameAliases||[]).join('\n')}));
  // Rondas del torneo para las columnas del desglose de la general.
  const tournamentRaces=new Map(tournamentRaceRows.map(row=>[row.id,row]));
  const actualCategories=cxCategories(race),publishedCategories=cxResultCategories(race,results);
  // La raíz de una jornada terminada abre la clasificación principal, igual
  // que los accesos directos de resultados en las apps.
  const generalCategories=cxGeneralCategories(race,standings,results,states);
  const hasProgramme=actualCategories.some(c=>c.startTimeUtc);
  const hasStartlist=inscritos.length>0;
  const categories=actualCategories;
  const media=cxRaceMedia(race,categories,broadcasts,videos,{results,visibleBroadcasts:filterBroadcastsByRegion(broadcasts)});
  const tvRows=media.tv,reviveRows=media.revive;
  const videoRows=[...new Map(media.videos.filter(row=>cxYouTubeVideoId(row.url)).map(row=>[cxYouTubeVideoId(row.url),row])).values()];
  // La TV vive en el programa: sin horarios, la sección se muestra igualmente
  // cuando hay emisiones.
  const hasMedia=tvRows.length>0||reviveRows.length>0;
  // Sin programa, dorsales, resultados ni TV, una carrera con vídeos abre Vídeos.
  const defaultPage=publishedCategories.length?'results':hasProgramme?'programme':hasStartlist?'startlist':hasMedia?'programme':videoRows.length?'videos':'programme';
  if(page==='race')page=defaultPage;
  // La TV vive dentro del programa, debajo de horarios: los enlaces antiguos
  // ?view=tv aterrizan ahí.
  if(page==='tv')page='programme';
  const sectionTabs=[
    hasProgramme||hasMedia||page==='programme'?['programme',t('cx.programme')]:null,
    hasStartlist||page==='startlist'?['startlist',t('cx.startlist')]:null,
    publishedCategories.length||page==='results'?['results',t('stage.results')]:null,
    generalCategories.length?['general',t('cx.general')]:null,
    videoRows.length?['videos',t('cx.videos')]:null,
  ].filter(Boolean);
  if(!sectionTabs.length)sectionTabs.push(['programme',t('cx.programme')]);
  const categoryNavigation=`<nav class="res-stages cx-classification-nav cx-category-nav" data-cx-category-nav aria-label="${esc(t('cx.categories'))}"><div class="res-stages__inner">${categories.map(c=>`<a class="res-stage-btn" data-cx-classification="${c.category}" href="#${c.category}" aria-label="${esc(t(`cx.category.${c.category}`))}">${c.category}</a>`).join('')}</div></nav>`;
  // Categorías de la general: pueden incluir una general derivada sin manga
  // propia en la carrera (WU de la Copa del Mundo).
  const generalNavigation=generalCategories.length?`<nav class="res-stages cx-classification-nav cx-category-nav" data-cx-general-nav aria-label="${esc(t('cx.standings'))}"><div class="res-stages__inner">${generalCategories.map(code=>`<a class="res-stage-btn" data-cx-general-classification="${code}" href="#${code}" aria-label="${esc(t(`cx.category.${code}`))}">${code}</a>`).join('')}</div></nav>`:'';
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
  const roundHeader=(raceId,index)=>{
    const round=tournamentRaces.get(raceId),label=`#${rounds?.get(raceId)?.n??index+1}`;
    if(!round||cxIsHidden(round,lang))return {label};
    return {label,title:cxRaceName(round,lang),href:cxRaceUrl(round,lang)};
  };
  const generalHtml=generalCategories.map(category=>{
    const rows=standings.filter(s=>s.category===category),state=states.find(row=>row.category===category);
    return `<div data-cx-general="${esc(category)}">${publicationHtml('official')}${cxStandingsTableHtml({rows,state,mode:cxStandingMode(tournament,category,rows),lang,locale,teamList,roundHeader})}</div>`;
  }).join('');
  const multiDate=new Set(categories.map(c=>cxCategoryDate(race,c))).size>1;
  const contextHtml=resultsContext(race,categories,multiDate,docAssets);
  const classificationsHtml=`<div class="res-layout cx-classification-page${contextHtml?' res-layout--context':''}"><div class="res-main">${classificationPanels||`<p class="cx-empty">${t('cx.noResults')}</p>`}</div>${contextHtml}</div>`;
  const standingsPageHtml=`<div class="res-layout cx-classification-page cx-standings-page${contextHtml?' res-layout--context':''}"><div class="res-main">${generalHtml||`<p class="cx-empty">${t('cx.noStandings')}</p>`}</div>${contextHtml}</div>`;
  const startlistHtml=categories.map(c=>`<section class="cx-category-section" data-cx-startlist-category="${c.category}"><div class="cx-category-content">${startlist(inscritos.filter(row=>row.category===c.category),teams)}</div></section>`).join('');
  const capitalizeDate=value=>value?value.charAt(0).toLocaleUpperCase(lang)+value.slice(1):value;
  const headerDate= race.dateKey ? capitalizeDate(seoLongDateWeekday(race.dateKey,lang)) + (race.endDateKey&&race.endDateKey!==race.dateKey?` – ${capitalizeDate(seoLongDateWeekday(race.endDateKey,lang))}`:'') : '';
  const roundLabel=cxRoundLabel(rounds?.get(race.id));
  const headerDetail=[cxClassName(race.class,lang),tournament&&cxRaceName(tournament,lang),roundLabel?.text,race.venue&&race.venue!==cxRaceName(race,lang)?race.venue:''].filter(Boolean).join(' · ');
  const headerHtml=buildRaceHeader({race:{...race,logoUrl:null},nameHref:'',detail:headerDetail,date:esc(headerDate),action:'',extraHtml:race.isCancelled?`<p class="jornada-cancelled-banner">${t('stage.cancelled')}</p>`:''});
  root.innerHTML=`${headerHtml}${docsStrip(race,docAssets)}<div class="cx-sticky-nav" data-cx-sticky-nav>${sectionNavigation}${categoryNavigation}${generalNavigation}</div><div data-cx-section="results" hidden>${classificationsHtml}</div><div data-cx-section="general" hidden>${standingsPageHtml}</div><div class="cx-race-sections" data-cx-section="startlist" hidden>${startlistHtml||`<p class="cx-empty">${t('cx.noStartlist')}</p>`}</div><div class="cx-race-sections" data-cx-section="programme" hidden>${programme(race,categories,results,multiDate,docAssets,hasMedia)}${tvGroups(tvRows,media.liveCategories)}${reviveMedia(reviveRows)}</div><div class="cx-race-sections" data-cx-section="videos" hidden>${videoMedia(videoRows)||`<p class="cx-empty">${t('cx.noVideos')}</p>`}</div>`;
  cxWireStandingsScroll(root);
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
  const selectSection=()=>{
    const currentRoute=cxRacePageLocation(location.pathname,location.search);
    let hash;try{hash=decodeURIComponent(location.hash.slice(1));}catch{hash='';}
    // Los enlaces antiguos #general/#general-XX de resultados abren la sección General.
    const legacyGeneral=currentRoute.page==='results'&&generalCategories.length?cxLegacyGeneralFragment(hash):null;
    if(legacyGeneral!=null){history.replaceState(null,'',cxRacePageUrl(race,lang,'general',legacyGeneral));hash=legacyGeneral;}
    page=legacyGeneral!=null?'general':currentRoute.page==='race'||(currentRoute.page==='videos'&&!videoRows.length)||(currentRoute.page==='general'&&!generalCategories.length)?defaultPage:currentRoute.page==='tv'?'programme':currentRoute.page;
    const codes=categories.map(c=>c.category);
    const availableCodes=page==='general'?generalCategories:page==='results'?publishedCategories:page==='startlist'?codes.filter(code=>inscritos.some(row=>row.category===code)):codes;
    const selected=cxClassificationSelection(hash,page==='general'||(!hash&&availableCodes.length)?availableCodes:codes);
    for(const node of root.querySelectorAll('[data-cx-section]'))node.hidden=node.dataset.cxSection!==page;
    for(const node of root.querySelectorAll('[data-cx-section-link]')) {
      const key=node.dataset.cxSectionLink,active=key===page;
      node.classList.toggle('res-tab--active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
      // Conserva la categoría al alternar entre inscritos, resultados y general
      // cuando existe en el destino (una general derivada lleva a su origen).
      const carried=page==='general'&&key!=='general'?cxGeneralSourceCategory(tournament,selected.category):selected.category;
      const targetCodes=key==='general'?generalCategories:key==='results'?publishedCategories:key==='startlist'?codes:[];
      node.href=cxRacePageUrl(race,lang,key,['results','startlist','general'].includes(page)&&targetCodes.includes(carried)?carried:'');
    }
    const categoryNav=root.querySelector('[data-cx-category-nav]'),generalNav=root.querySelector('[data-cx-general-nav]');
    categoryNav.hidden=!['results','startlist'].includes(page)||!codes.length;
    if(generalNav)generalNav.hidden=page!=='general';
    for(const node of root.querySelectorAll('[data-cx-startlist-category]'))node.hidden=node.dataset.cxStartlistCategory!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-classification-content]'))node.hidden=node.dataset.cxClassificationContent!==selected.category;
    for(const node of root.querySelectorAll('[data-cx-context-category]'))node.classList.toggle('res-stage-data__active',node.dataset.cxContextCategory===selected.category);
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
