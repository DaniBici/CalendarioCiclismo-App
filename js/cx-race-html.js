// ─────────────────────────────────────────────────────────────────
//  FICHA DE CARRERA CX — modelo y HTML, sin DOM
//  Lo usan js/cx-race.js (pintado en el navegador) y el paso de build que
//  escribe /ciclocross/<slug>/, …/inscritos/, …/resultados/ y sus EN
//  (tools/site/prerender-cx.mjs).
//
//  La página se pinta por huecos, cada uno con su huella
//  (js/html-fingerprint.js): el esqueleto (cabecera, documentos, barras de
//  secciones y categorías, contenedores vacíos), el contenido de cada sección
//  y la columna lateral de resultados, dorsales y general. El build llena la
//  sección de la URL, todos sus paneles de categoría y su columna lateral: la
//  categoría va en el fragmento (#WE), que no llega al servidor, y el script
//  en línea de la página (tools/site/prerender-cx.mjs) la muestra antes del
//  primer pintado. El marcado de cada hueco no puede
//  depender del dispositivo, del ancho de pantalla ni de localStorage. Programa
//  (horas, TV en directo, región) y columna lateral (horas) dependen de la zona
//  y del momento: fuera de la zona del build se repintan solo esos huecos.
// ─────────────────────────────────────────────────────────────────

import {startlistCyclistHtml,resultsTrophyHtml,tvStatusChipHtml} from './services/race-presentation.js';
import {cxLogoHtml} from './components/cx-logo.js';
import {buildRaceHeader,findMatchingTeam,filterBroadcastsByRegion,broadcastRegionBadgeLabel,seoLongDate,seoLongDateWeekday} from './shared.js';
import {t,getLang,getLocale} from './i18n.js';
import {cxIsHidden} from './services/cx-data.js';
import {cxEsc as esc,cxCategories,cxCategoryDate,cxRaceName,cxRaceUrl,cxRacePageUrl,cxRacePageLocation,cxClassificationSelection,cxLegacyGeneralFragment,cxTime,cxClassName,cxRankSort,cxRaceMedia,cxTvStatus,CX_TV_STATUS_CHIPS,cxProgrammeOrder,cxResultCategories,cxGeneralCategories,cxGeneralSourceCategory,cxStandingMode,cxRoundLabel,cxResultCells,cxResultRank,cxCompetesBySelection} from './cx/presentation.js';
import {nationalSelectionName} from './services/national-team-name.js';
import {cxStandingsTableHtml} from './cx/standings-table.js';
import {teamStripes} from './team-appearance.js';
import {cxUrl,cxYouTubeVideoId} from './cx/editor-logic.js';
import {cxTvEmbedAttrs} from './cx/tv-modal.js';
import {flagIconUrl} from './flag-url.js';
import {logoPlaceholderHtml} from './components/logo-placeholder.js';

const safeLink=url=>{try{return cxUrl(url);}catch{return null;}};

// Bandera de las tablas sin estilo en línea (tamaño y recorte en
// `.so-flag > img`, css/app.css) y diferida: las categorías ocultas no la piden.
function soFlag(code) {
  if(!code)return '';
  const c=code.toLowerCase();
  return `<img src="${flagIconUrl(c)}" alt="${esc(c)}" loading="lazy">`;
}

function external(url,label,asset=false,attrs='') {const safe=safeLink(url);return safe?`<a class="${asset?'asset-btn':'tv-link-btn'}" href="${esc(safe)}" target="_blank" rel="noopener"${attrs}>${asset?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-5 6-5 14 0 20 5-6 5-14 0-20"/></svg>':''}<span class="${asset?'asset-btn__label':''}">${esc(label)}</span></a>`:'';}
// Zona de documentos de la jornada CX, con la misma presentación que carretera:
// web oficial · Libro de Ruta · Mapa en la tira enmarcada `.asset-links`.
const R2_ASSET_BASE='https://assets.calendariociclismo.app';
const CX_DOC_SVGS={
  website:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  technicalGuide:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
  map:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
};
// El mismo enlace en todos los anchos: los documentos propios llevan
// data-asset-viewer y en escritorio los abre en el visor el manejador
// delegado de js/shared.js.
function cxDocBtn(url,label,iconKey) {
  if(!url)return '';
  const own=url.startsWith(R2_ASSET_BASE);
  return `<a class="asset-btn" href="${esc(url)}" target="_blank" rel="noopener"${own?' data-asset-viewer':''}>${CX_DOC_SVGS[iconKey]}<span class="asset-btn__label">${esc(label)}</span></a>`;
}
function docsStrip(race,assets=[]) {
  const pick=type=>assets.find(a=>a.type===type&&a.url)?.url;
  const buttons=[cxDocBtn(safeLink(race.websiteUrl),t('stage.websiteLabel'),'website'),
    cxDocBtn(pick('technicalGuide'),t('assets.technicalGuide'),'technicalGuide'),
    cxDocBtn(pick('map'),t('assets.map'),'map')].filter(Boolean).join('');
  return buttons?`<section class="jornada-section cx-race-docs"><div class="asset-links-wrap"><div class="asset-links">${buttons}</div></div></section>`:'';
}
// Equipo de la fila: la selección del país en Mundiales y Continentales, sin franjas;
// en el resto, el equipo con sus franjas.
function resultTeamHtml(row,teamList,lang,bySelection) {
  if(bySelection){const name=nationalSelectionName(row.isoCode2,lang==='en');return name?esc(name):'';}
  if(!String(row.teamName||'').trim())return '';
  const team=findMatchingTeam(row.teamName,teamList);
  return `${team?teamStripes(team):''}${esc(row.teamName)}`;
}
function table(rows,header,value,teamList,lang,bySelection=false) {
  const teamCells=new Map(rows.map(row=>[row,resultTeamHtml(row,teamList,lang,bySelection)]));
  const hasTeam=[...teamCells.values()].some(Boolean);
  const values=new Map(rows.map(row=>[row,value(row)]));
  // Las vueltas perdidas necesitan una columna de tiempo más ancha en móvil
  // para no partirse en dos líneas y descuadrar la altura de la fila.
  const hasLaps=[...values.values()].some(html=>html.includes('class="res-lap"'));
  return `<div class="res-table-wrap"><table class="so-table res-table${hasLaps?' res-table--laps':''}"><thead><tr><th class="so-th res-th--rank">#</th><th class="so-th res-th--rider">${t('cx.rider')}</th>${hasTeam?`<th class="so-th res-th--team">${t('cx.team')}</th>`:''}<th class="so-th res-th--result">${esc(header)}</th></tr></thead><tbody>${[...rows].sort(cxRankSort).map(row=>{
    const teamHtml=teamCells.get(row),rank=cxResultRank(row,lang);
    return `<tr class="so-row"><td class="so-td res-td--rank">${typeof rank==='number'?rank:`<span class="res-rank-dnf">${esc(rank)}</span>`}</td><td class="so-td res-td--rider"><span class="so-flag">${soFlag(row.isoCode2)}</span><span class="res-rider-main"><span class="res-rider-name">${esc(row.riderDisplay)}</span>${teamHtml?`<span class="res-rider-team">${teamHtml}</span>`:''}</span></td>${hasTeam?`<td class="so-td res-td--team">${teamHtml?`<span class="res-team-cell">${teamHtml}</span>`:''}</td>`:''}<td class="so-td res-td--result">${values.get(row)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function startlist(rows,teams,lang,bySelection=false) {
  if(!rows.length)return `<p class="cx-empty">${t('cx.noStartlist')}</p>`;
  // Misma tabla que Resultados: Dorsal, Corredor y Equipo; en móvil el equipo
  // pasa a subtítulo bajo el corredor. En Mundiales y Continentales, la selección.
  const teamOf=r=>{
    if(bySelection){const name=nationalSelectionName(r.countryCode,lang==='en');return name?esc(name):'';}
    const team=teams.get(r.teamId);return team?`${teamStripes(team)}${esc(team.name)}`:'';
  };
  const teamCells=new Map(rows.map(r=>[r,teamOf(r)]));
  const hasTeam=[...teamCells.values()].some(Boolean);
  return `<div class="res-table-wrap"><table class="so-table res-table cx-startlist-table"><thead><tr><th class="so-th res-th--rank">${t('cx.bibShort')}</th><th class="so-th res-th--rider">${t('cx.rider')}</th>${hasTeam?`<th class="so-th res-th--team">${t('cx.team')}</th>`:''}</tr></thead><tbody>${[...rows].sort((a,b)=>a.sortOrder-b.sortOrder).map(r=>{
    const teamHtml=teamCells.get(r);
    return `<tr class="so-row"><td class="so-td res-td--rank">${esc(r.bib||'')}</td><td class="so-td res-td--rider"><span class="so-flag">${soFlag(r.countryCode)}</span><span class="res-rider-main"><span class="res-rider-name">${esc(`${r.firstName} ${r.lastName}`)}</span>${teamHtml?`<span class="res-rider-team">${teamHtml}</span>`:''}</span></td>${hasTeam?`<td class="so-td res-td--team">${teamHtml?`<span class="res-team-cell">${teamHtml}</span>`:''}</td>`:''}</tr>`;
  }).join('')}</tbody></table></div>`;
}
function tvEntry(row,hidden,locale,revive=false) {
  const time=!revive&&cxTime(row.startTimeUtc,locale);
  return `<div class="tv-entry" ${hidden?'data-cx-regional-hidden hidden':''}><div class="cx-media-label"><div class="tv-entry__platform-row"><span class="tv-entry__platform">${esc(row.channel||row.title)}</span>${hidden&&broadcastRegionBadgeLabel(row.country)?`<span class="badge badge--uci" data-cx-region>${esc(broadcastRegionBadgeLabel(row.country))}</span>`:''}</div>${row.note?`<div class="tv-entry__channel">${esc(row.note)}</div>`:''}</div><div class="cx-media-actions">${time?`<time class="tv-entry__time" title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(time)}</time>`:''}${external(row.url,`${t('stage.watch')} ↗`,false,cxTvEmbedAttrs(row))}</div></div>`;
}
// Revive por categorías, como la TV: las filas comunes sin encabezado y un
// bloque por categoría, en el orden del programa.
function reviveMedia(rows,categories,locale) {
  if(!rows.length)return '';
  const group=(label,block)=>block.length?`<div class="cx-tv-group">${label?`<h3 class="cx-tv-group__title">${esc(label)}</h3>`:''}<div class="tv-panel__list">${block.map(row=>tvEntry(row,false,locale,true)).join('')}</div></div>`:'';
  const codes=new Set(categories.map(c=>c.category));
  const html=group('',rows.filter(row=>!row.category||!codes.has(row.category)))+categories.map(c=>group(t(`cx.category.${c.category}`),rows.filter(row=>row.category===c.category))).join('');
  return `<section class="tv-panel cx-media-section"><header class="stage-profile-heading"><h2>${t('tv.reviveRaceTitle')}</h2></header>${html}</section>`;
}
function videoMedia(rows,lang) {
  if(!rows.length)return '';
  return `<section class="jornada-section cx-video-section" aria-label="${esc(t('cx.videos'))}"><div class="cx-video-grid">${rows.map(row=>{
    const id=cxYouTubeVideoId(row.url),title=esc(lang==='en'&&row.titleEn||row.title);
    return `<article class="cx-video-card"><h3>${title}</h3><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>${external(row.url,'YouTube ↗')}</article>`;
  }).join('')}</div></section>`;
}
// TV de la jornada CX en el cajón de carretera, dividida por
// categorías: emisiones comunes (sin categoría) sin encabezado y un bloque
// por categoría en directo, en el orden del programa. Como en la jornada de
// carretera, mientras quede alguna categoría en directo (`active`) el estado
// 'pending' añade el chip «Sin confirmar» junto al título y, sin emisiones,
// 'pending', 'none' y 'unavailable_es' muestran la sección con su etiqueta.
function tvGroups(broadcasts,categories,locale,{status=null,active=false}={}) {
  const chip=active&&CX_TV_STATUS_CHIPS.has(status)?status:null;
  if(!broadcasts.length&&!chip)return '';
  const mine=new Set(filterBroadcastsByRegion(broadcasts)),hasHidden=mine.size<broadcasts.length;
  const group=(label,rows)=>rows.length?`<div class="cx-tv-group"${rows.some(row=>mine.has(row))?'':' data-cx-regional-hidden hidden'}>${label?`<h3 class="cx-tv-group__title">${esc(label)}</h3>`:''}<div class="tv-panel__list">${rows.map(row=>tvEntry(row,!mine.has(row),locale)).join('')}</div></div>`:'';
  const html=group('',broadcasts.filter(row=>!row.category))+categories.map(c=>group(t(`cx.category.${c.category}`),broadcasts.filter(row=>row.category===c.category))).join('');
  if(!html&&!chip)return '';
  const pending=chip==='pending'?tvStatusChipHtml('pending',esc(t('tv.status.pending'))):'';
  const statusRow=!html?`<div class="tv-panel__list"><div class="info-row"><span class="info-row__value" style="color:var(--text-muted);font-size:0.9rem">${esc(t(`tv.status.${chip}`))}</span></div></div>`:'';
  return `<section class="tv-panel cx-media-section"><header class="stage-profile-heading"><div class="tv-panel__title"><h2>${t('cx.tv')}</h2>${pending}</div>${hasHidden?`<div class="tv-panel__actions"><button type="button" class="stage-key-toggle" data-cx-tv-filter="mine" aria-pressed="false">${t('tv.filterAll')}</button></div>`:''}</header>${html&&!mine.size?`<p class="cx-empty" data-cx-no-region>${t('tv.noTvRegion')}</p>`:''}${html||statusRow}</section>`;
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

// En escritorio, la TV y el streaming acompañan a los horarios en la columna
// derecha; en móvil, el orden es horarios, mapa y TV.
function programme(model) {
  const {race,categories,results,multiDate,docAssets:assets,lang,locale,media}=model;
  const extra=tvGroups(media.tv,media.liveCategories,locale,{status:cxTvStatus(race,lang),active:media.active})+reviveMedia(media.revive,cxProgrammeOrder(race,categories),locale);
  const scheduled=scheduledCategories(race,categories);
  const rows=scheduled.map(c=>{
    const cancelled=race.isCancelled||c.isCancelled,hasResults=['official','provisional'].includes(c.resultsStatus)&&results.some(row=>row.category===c.category);
    const badges=`${c.startlistImportedAt?`<a class="badge badge--startlist badge--icon" href="${esc(cxRacePageUrl(race,lang,'startlist',c.category))}" title="${esc(t('cx.startlist'))}" aria-label="${esc(t('cx.startlist'))}">${startlistCyclistHtml}<span class="badge__label">${esc(t('cx.startlist'))}</span></a>`:''}${hasResults?`<a class="badge badge--results badge--icon" href="${esc(cxRacePageUrl(race,lang,'results',c.category))}" title="${esc(t('stage.viewResults'))}" aria-label="${esc(t('stage.viewResults'))}">${resultsTrophyHtml}<span class="badge__label">${esc(t('stage.viewResults'))}</span></a>`:''}`;
    return `<section class="cx-programme-row" id="${c.category}"><div class="cx-programme-top"><div class="cx-programme-heading"><time title="${esc(t('stage.yourTimezone'))}: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">${esc(cancelled?t('stage.cancelled'):cxTime(c.startTimeUtc,locale))}</time><h3>${esc(t(`cx.category.${c.category}`))}</h3></div>${badges?`<div class="cx-programme-actions">${badges}</div>`:''}</div>${multiDate?`<p>${esc(seoLongDate(cxCategoryDate(race,c),lang))}</p>`:''}</section>`;
  }).join('');
  const map=mapPreview(assets),schedule=rows?`<section class="stage-profile-panel cx-programme-schedule"><header class="stage-profile-heading"><h2>${t('stage.schedule')}</h2></header><div class="cx-programme-grid">${rows}</div></section>`:extra?'':`<p class="cx-empty">${t('cx.noCategories')}</p>`;
  if(map)return `<div class="cx-programme-layout">${map}<div class="cx-programme-side">${schedule}${extra}</div></div>`;
  return schedule&&extra?`<div class="cx-programme-layout cx-programme-layout--schedule">${schedule}<div class="cx-programme-side">${extra}</div></div>`:schedule+extra;
}

/**
 * Modelo de la ficha a partir de la carrera (con categorías y torneo) y de sus
 * lecturas. `at`: instante de referencia (directo, Revive, publicación).
 */
export function cxRaceModel(race,{broadcasts,videos,inscritos,results,teamRows,rounds,docAssets,states,standings,tournamentRaceRows},{at=new Date()}={}) {
  const lang=getLang(),locale=getLocale(),tournament=race.cx_tournaments;
  const teams=new Map(teamRows.map(team=>[team.id,team]));
  const teamList=teamRows.map(team=>({...team,nameAliases:(team.nameAliases||[]).join('\n')}));
  // Rondas del torneo para las columnas del desglose de la general.
  const tournamentRaces=new Map(tournamentRaceRows.map(row=>[row.id,row]));
  const categories=cxCategories(race),publishedCategories=cxResultCategories(race,results);
  // La raíz de una jornada terminada abre la clasificación principal, igual
  // que los accesos directos de resultados en las apps.
  const generalCategories=cxGeneralCategories(race,standings,results,states);
  const hasProgramme=categories.some(c=>c.startTimeUtc);
  const hasStartlist=inscritos.length>0;
  const media=cxRaceMedia(race,categories,broadcasts,videos,{results,visibleBroadcasts:filterBroadcastsByRegion(broadcasts),at});
  const videoRows=[...new Map(media.videos.filter(row=>cxYouTubeVideoId(row.url)).map(row=>[cxYouTubeVideoId(row.url),row])).values()];
  // La TV vive en el programa: sin horarios, la sección se muestra igualmente
  // cuando hay emisiones.
  const hasMedia=media.tv.length>0||media.revive.length>0||(media.active&&CX_TV_STATUS_CHIPS.has(cxTvStatus(race,lang)));
  // Sin programa, dorsales, resultados ni TV, una carrera con vídeos abre Vídeos.
  const defaultPage=publishedCategories.length?'results':hasProgramme?'programme':hasStartlist?'startlist':hasMedia?'programme':videoRows.length?'videos':'programme';
  const multiDate=new Set(categories.map(c=>cxCategoryDate(race,c))).size>1;
  return {race,lang,locale,tournament,teams,teamList,tournamentRaces,categories,publishedCategories,generalCategories,
    hasProgramme,hasStartlist,hasMedia,media,videoRows,defaultPage,multiDate,inscritos,results,standings,states,rounds,docAssets,
    todayKey:new Date(at).toISOString().slice(0,10)};
}

/**
 * Sección y categoría de la URL. `tabsPage`: la sección de entrada, que decide
 * las pestañas visibles; `legacyGeneral`: categoría de un enlace antiguo
 * #general/#general-XX de resultados (null si no lo es).
 */
export function cxRaceSelection(model,{pathname,search='',hash=''}) {
  const {categories,generalCategories,publishedCategories,videoRows,defaultPage,inscritos}=model;
  const route=cxRacePageLocation(pathname,search);
  // Los enlaces antiguos #general/#general-XX de resultados abren la sección General.
  const legacyGeneral=route.page==='results'&&generalCategories.length?cxLegacyGeneralFragment(hash):null;
  if(legacyGeneral!=null)hash=legacyGeneral;
  // La TV vive dentro del programa, junto a los horarios: los enlaces antiguos
  // ?view=tv aterrizan ahí.
  const tabsPage=route.page==='race'?defaultPage:route.page==='tv'?'programme':route.page;
  const page=legacyGeneral!=null?'general':route.page==='race'||(route.page==='videos'&&!videoRows.length)||(route.page==='general'&&!generalCategories.length)?defaultPage:route.page==='tv'?'programme':route.page;
  const codes=categories.map(c=>c.category);
  const availableCodes=page==='general'?generalCategories:page==='results'?publishedCategories:page==='startlist'?codes.filter(code=>inscritos.some(row=>row.category===code)):codes;
  const selected=cxClassificationSelection(hash,page==='general'||(!hash&&availableCodes.length)?availableCodes:codes);
  return {page,tabsPage,selected,legacyGeneral};
}

// Categorías que conserva el enlace a cada sección: las que existen en el destino.
const carriedCodes=(model,key)=>key==='general'?model.generalCategories:key==='results'?model.publishedCategories:key==='startlist'?model.categories.map(c=>c.category):[];

// Enlace de una pestaña de sección: conserva la categoría al alternar entre
// inscritos, resultados y general cuando existe en el destino (una general
// derivada lleva a su origen).
export function cxRaceSectionHref(model,key,{page,selected}) {
  const {race,lang,tournament}=model;
  const carried=page==='general'&&key!=='general'?cxGeneralSourceCategory(tournament,selected.category):selected.category;
  return cxRacePageUrl(race,lang,key,['results','startlist','general'].includes(page)&&carriedCodes(model,key).includes(carried)?carried:'');
}

// Atributo class con la marca de activo y aria-current en el enlace activo.
const activeClass=(base,on,cls)=>`class="${base}${on?` ${cls}`:''}"${on?' aria-current="page"':''}`;

// Contenedor de un hueco; `slot`: { inner, prerendered } (huella del build).
const filled=(open,close,slot={inner:''})=>`${open.slice(0,-1)}${slot.prerendered?` data-prerendered="${slot.prerendered}"`:''}>${slot.inner}${close}`;

/** Interior de la columna lateral (mapa reducido y horarios): depende de la zona. */
export function cxRaceContextHtml(model,{selected}) {
  const {race,categories,multiDate,docAssets,locale}=model;
  const url=mapImageUrl(docAssets),label=esc(t('assets.map'));
  const map=url?`<section class="stage-profile-panel cx-context-map"><header class="stage-profile-heading"><h2>${label}</h2></header>${mapLink(url,label)}</section>`:'';
  const dayLabel=date=>new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const rows=scheduledCategories(race,categories).map(c=>{
    const value=race.isCancelled||c.isCancelled?t('stage.cancelled'):`${multiDate?`${dayLabel(cxCategoryDate(race,c))} · `:''}${cxTime(c.startTimeUtc,locale)}`;
    return `<div data-cx-context-category="${esc(c.category)}"${c.category===selected.category?' class="res-stage-data__active"':''}><dt>${esc(t(`cx.category.${c.category}`))}</dt><dd>${esc(value)}</dd></div>`;
  }).join('');
  const data=rows?`<section class="res-stage-data"><h2>${t('stage.schedule')}</h2><dl>${rows}</dl></section>`:'';
  return map+data;
}
// Columna lateral de resultados, como en carretera: mapa reducido y datos
// esenciales de la jornada (en CX, el horario de cada categoría). Existe con
// mapa o con alguna categoría con horario, en cualquier zona.
const hasContext=({race,categories,docAssets})=>!!mapImageUrl(docAssets)||scheduledCategories(race,categories).length>0;

// Paneles por categoría de resultados, general y dorsales: atributo de cada
// panel. Cada panel es un hueco; el build llena todos los de la sección de la URL.
export const CX_PANEL_ATTRIBUTES={results:'data-cx-classification-content',general:'data-cx-general',startlist:'data-cx-startlist-category'};
// Categorías con panel en cada sección.
const panelCodes=(model,key)=>key==='general'?model.generalCategories:model.categories.map(c=>c.category);

/** Interior del panel de la categoría `code` en la sección `key`. */
export function cxRacePanelHtml(model,key,code) {
  const {race,lang,locale,tournament,teams,teamList,tournamentRaces,categories,publishedCategories,results,standings,states,rounds,inscritos,todayKey}=model;
  if(key==='results') {
    const c=categories.find(category=>category.category===code);
    const rows=publishedCategories.includes(code)?results.filter(r=>r.category===code).sort((a,b)=>a.sortOrder-b.sortOrder):[],cells=cxResultCells(rows,lang);
    if(!rows.length)return `<p class="cx-empty">${t(race.isCancelled||c.isCancelled?'stage.cancelled':'cx.noResults')}</p>`;
    // DataRide es fuente oficial por contrato, aunque la ingesta mantenga
    // resultsStatus=provisional mientras se completa la revisión interna.
    const source=String(c.resultsSourceUrl||'').toLowerCase(),inputSource=String(c.resultsEvidence?.inputSource||'').toLowerCase();
    const status=source.includes('dataride.uci.ch')||inputSource==='dataride'||cxCategoryDate(race,c)<todayKey||c.resultsStatus==='official'?'official':'provisional';
    return `${publicationHtml(status,lang)}${table(rows,t('cx.time'),r=>{const cell=cells.get(r);return `<span class="${cell.cls}">${esc(cell.text)}</span>`;},teamList,lang,cxCompetesBySelection(race))}`;
  }
  if(key==='general') {
    const roundHeader=(raceId,index)=>{
      const round=tournamentRaces.get(raceId),label=`#${rounds?.get(raceId)?.n??index+1}`;
      if(!round||cxIsHidden(round,lang))return {label};
      return {label,title:cxRaceName(round,lang),href:cxRaceUrl(round,lang)};
    };
    const rows=standings.filter(s=>s.category===code),state=states.find(row=>row.category===code);
    return `${publicationHtml('official',lang)}${cxStandingsTableHtml({rows,state,mode:cxStandingMode(tournament,code,rows),lang,locale,teamList,roundHeader})}`;
  }
  return startlist(inscritos.filter(row=>row.category===code),teams,lang,cxCompetesBySelection(race));
}

/**
 * Interior de la sección `key`. Resultados, general y dorsales llevan un panel
 * por categoría y la columna lateral como huecos: `slots.panel(code)` y
 * `slots.context()` devuelven su contenido ({ inner, prerendered }); por
 * defecto, vacíos.
 */
export function cxRaceSectionHtml(model,key,{selected},slots={}) {
  const {race,lang,videoRows}=model;
  const {panel=()=>({inner:''}),context=()=>({inner:''})}=slots;
  if(key==='programme')return programme(model);
  if(key==='videos')return videoMedia(videoRows,lang)||`<p class="cx-empty">${t('cx.noVideos')}</p>`;
  const contextHtml=hasContext(model)?filled('<aside class="res-context cx-results-context" data-cx-context>','</aside>',context()):'';
  const panels=panelCodes(model,key).map(code=>filled(`<div ${CX_PANEL_ATTRIBUTES[key]}="${esc(code)}"${code===selected.category?'':' hidden'}>`,'</div>',panel(code))).join('');
  const empty={results:race.isCancelled?'stage.cancelled':'cx.noResults',general:'cx.noStandings',startlist:'cx.noStartlist'}[key];
  // Dorsales y general con la maqueta de las clasificaciones, columna lateral incluida.
  const cls={results:'',general:' cx-standings-page',startlist:' cx-startlist-page'}[key];
  return `<div class="res-layout cx-classification-page${cls}${contextHtml?' res-layout--context':''}"><div class="res-main">${panels||`<p class="cx-empty">${t(empty)}</p>`}</div>${contextHtml}</div>`;
}
function publicationHtml(status,lang) {
  return `<div class="res-publication"><div class="res-publication-line"><span>${status==='official'?(lang==='en'?'Official':'Oficial'):(lang==='en'?'Provisional':'Provisional')}</span></div></div>`;
}

const SECTIONS=[['results',''],['general',''],['startlist',''],['programme',' class="cx-race-sections"'],['videos',' class="cx-race-sections"']];

/**
 * Esqueleto de la ficha: cabecera con el logo, documentos, barra fija de
 * secciones y categorías y los contenedores de sección; `section(key)`
 * devuelve el contenido de cada uno ({ inner, prerendered }), vacío por
 * defecto.
 */
export function cxRaceSkeletonHtml(model,sel,section=()=>({inner:''})) {
  const {race,lang,tournament,categories,generalCategories,publishedCategories,hasProgramme,hasMedia,hasStartlist,videoRows,rounds,docAssets}=model;
  const {page,tabsPage,selected}=sel;
  const sectionTabs=[
    hasProgramme||hasMedia||tabsPage==='programme'?['programme',t('cx.programme')]:null,
    hasStartlist||tabsPage==='startlist'?['startlist',t('cx.startlist')]:null,
    publishedCategories.length||tabsPage==='results'?['results',t('stage.results')]:null,
    generalCategories.length?['general',t('cx.general')]:null,
    videoRows.length?['videos',t('cx.videos')]:null,
  ].filter(Boolean);
  if(!sectionTabs.length)sectionTabs.push(['programme',t('cx.programme')]);
  const codes=categories.map(c=>c.category);
  const categoryNavigation=`<nav class="res-stages cx-classification-nav cx-category-nav" data-cx-category-nav aria-label="${esc(t('cx.categories'))}"${['results','startlist'].includes(page)&&codes.length?'':' hidden'}><div class="res-stages__inner">${categories.map(c=>`<a ${activeClass('res-stage-btn',c.category===selected.category,'res-stage-btn--active')} data-cx-classification="${c.category}" href="#${c.category}" aria-label="${esc(t(`cx.category.${c.category}`))}">${c.category}</a>`).join('')}</div></nav>`;
  // Categorías de la general: pueden incluir una general derivada sin manga
  // propia en la carrera (WU de la Copa del Mundo).
  const generalNavigation=generalCategories.length?`<nav class="res-stages cx-classification-nav cx-category-nav" data-cx-general-nav aria-label="${esc(t('cx.standings'))}"${page==='general'?'':' hidden'}><div class="res-stages__inner">${generalCategories.map(code=>`<a ${activeClass('res-stage-btn',code===selected.category,'res-stage-btn--active')} data-cx-general-classification="${code}" href="#${code}" aria-label="${esc(t(`cx.category.${code}`))}">${code}</a>`).join('')}</div></nav>`:'';
  // Selector de secciones oculto cuando solo hay una disponible, como en las apps.
  // `data-cx-carry`: categorías que conserva el enlace, para el script en línea.
  const carry=key=>{const codes=carriedCodes(model,key);return codes.length?` data-cx-carry="${codes.join(' ')}"`:'';};
  const sectionNavigation=sectionTabs.length>1?`<div class="res-tabs-bar cx-section-nav"><nav class="res-tabs" aria-label="${esc(cxRaceName(race,lang))}"><div class="res-tabs__scroll"><div class="res-tabs__inner">${sectionTabs.map(([key,label])=>`<a ${activeClass('res-tab',key===page,'res-tab--active')} data-cx-section-link="${key}"${carry(key)} href="${esc(cxRaceSectionHref(model,key,sel))}">${esc(label)}</a>`).join('')}</div></div></nav></div>`:'';
  const capitalizeDate=value=>value?value.charAt(0).toLocaleUpperCase(lang)+value.slice(1):value;
  const headerDate=race.dateKey?capitalizeDate(seoLongDateWeekday(race.dateKey,lang))+(race.endDateKey&&race.endDateKey!==race.dateKey?` – ${capitalizeDate(seoLongDateWeekday(race.endDateKey,lang))}`:''):'';
  const roundLabel=cxRoundLabel(rounds?.get(race.id));
  const headerDetail=[cxClassName(race.class,lang),tournament&&cxRaceName(tournament,lang),roundLabel?.text,race.venue&&race.venue!==cxRaceName(race,lang)?race.venue:''].filter(Boolean).join(' · ');
  const headerHtml=buildRaceHeader({race:{...race,logoUrl:null},logoHtml:cxLogoHtml(race,tournament,{className:'race-header__logo',onUnavailable:race.class==='CN'?'':"var s=document.createElement('span');s.className='race-header__logo logo-ph';s.setAttribute('aria-hidden','true');this.replaceWith(s)"})||(race.class==='CN'?'':logoPlaceholderHtml('race-header__logo')),nameHref:'',detail:headerDetail,date:esc(headerDate),action:'',extraHtml:race.isCancelled?`<p class="jornada-cancelled-banner">${t('stage.cancelled')}</p>`:''});
  const containers=SECTIONS.map(([key,cls])=>filled(`<div${cls} data-cx-section="${key}"${key===page?'':' hidden'}>`,'</div>',section(key))).join('');
  return `${headerHtml}${docsStrip(race,docAssets)}<div class="cx-sticky-nav" data-cx-sticky-nav>${sectionNavigation}${categoryNavigation}${generalNavigation}</div>${containers}`;
}

/** Ficha completa (sin página generada): todos los huecos llenos, sin huellas. */
export function cxRacePageHtml(model,sel) {
  return cxRaceSkeletonHtml(model,sel,key=>({inner:cxRaceSectionHtml(model,key,sel,{
    panel:code=>({inner:cxRacePanelHtml(model,key,code)}),
    context:()=>({inner:cxRaceContextHtml(model,sel)}),
  })}));
}

const prerenderedPanels=new WeakMap();
/**
 * Ficha generada en el build: la sección de la URL, todos sus paneles de
 * categoría (visible el de `sel`, la categoría por defecto) y la columna
 * lateral llenos, cada hueco con la huella (`fingerprint(html)`) del HTML que
 * pinta el navegador para él; el resto de secciones, vacías. Devuelve
 * { html, fingerprint } del esqueleto.
 * @public tools/site/prerender-cx.mjs lo usa como miembro del módulo cargado con import().
 */
export function cxRacePrerenderedHtml(model,sel,fingerprint) {
  const slot=html=>({inner:html,prerendered:fingerprint(html)});
  // La raíz y su sección comparten paneles: uno por modelo, sección y categoría.
  const panels=prerenderedPanels.get(model)||prerenderedPanels.set(model,new Map()).get(model);
  const panel=code=>{const key=`${sel.page}|${code}`;if(!panels.has(key))panels.set(key,slot(cxRacePanelHtml(model,sel.page,code)));return panels.get(key);};
  const slots={
    panel,
    context:()=>slot(cxRaceContextHtml(model,sel)),
  };
  const section=key=>key!==sel.page?{inner:''}
    :{inner:cxRaceSectionHtml(model,key,sel,slots),prerendered:fingerprint(cxRaceSectionHtml(model,key,sel))};
  return {html:cxRaceSkeletonHtml(model,sel,section),fingerprint:fingerprint(cxRaceSkeletonHtml(model,sel))};
}
