import {resolveCxPanelResultRows} from '../cx/result-identity.js';
import {CxCalendarImportState} from '../cx/calendar-import-state.js';
import {PdfTextImportState} from '../pdf-text-import-state.js';
import {extractPdfText} from '../services/pdf-text.js';
import {panelEditorTopbarHtml,panelEditorTabsHtml,panelSectionHtml,panelClassificationRowHtml,panelTeamRowHtml,panelTeamCatalogHtml,panelRiderRowHtml} from './editor-ui.js';
import {riderMatchesSearch,riderSearchTokens,withRiderSearch} from '../results/panel-logic.js';
import {panelDayNavigationHtml,panelCatalogHeaderHtml,wirePanelDayNavigation,panelCatalogModel,panelRaceListItemHtml,renderPanelCatalog} from './catalog-ui.js';
import {cxPanelAgendaDate,cxPanelSeasonForDate,cxPanelAgendaRaces,cxPanelNearestRaceDate} from '../cx/panel-presentation.js';
import {cxCategories,cxCategoryCardState,cxTime} from '../cx/presentation.js';
import {madridDateKey} from '../services/timezone.js';
import {cxLogoImage} from '../components/cx-logo.js';
import {cxAllRows,cxQuery,cxRpc,cxTournamentRounds} from '../services/cx-data.js';
import {resultsTrophyHtml} from '../services/race-presentation.js';
import {attachCountryAutocomplete} from '../country-select.js';
import {automaticTeamHeaderText} from '../team-appearance.js';
import {CX_CATEGORIES,CX_CLASSES,CX_COUNTRY_GROUPS,cxGender,cxSlug,cxSlugWithoutDiscipline,cxRaceSlugSuggestion,cxUniqueRaceSlug,cxSaveErrorMessage,cxEscape as esc,cxUrl,cxAssertMapImageUrl,cxYouTubeWatchUrl,cxLocalParts,cxLocalToUtc,cxDuration,parseCxRows,compareCxStandings,cxManualStandingsRows,cxManualStandingsCalculation} from '../cx/editor-logic.js';
import {CX_DURATION_RULE_VERSION,cxCategoryTiming} from '../cx/timing.js';
import {cxSeason,cxSeasonBounds,cxDateInSeason} from '../cx/season.js';
import {isValidRiderSlug} from '../rider-rename-logic.js';
import {confirmDialog as confirmNative} from '../components/dialog.js';

// Las carreras existentes conservan sus datos editoriales; lo que UCI publica
// distinto se lista para revisarlo a mano.
const CALENDAR_FIELD_LABELS={dateKey:'fecha',endDateKey:'fecha final',class:'clase',countryCode:'país',venue:'sede'};
function calendarResultHtml(result){
  const diffs=result.differences||[];
  const rows=diffs.map(d=>{
    const fields=Object.entries(d.fields||{}).map(([k,v])=>`${esc(CALENDAR_FIELD_LABELS[k]||k)}: ${esc(v.actual??'—')} → UCI ${esc(v.uci??'—')}`);
    if(d.missingCategories?.length)fields.push(`categorías solo en UCI: ${d.missingCategories.map(c=>esc(c)).join(', ')}`);
    return `<li>${esc(d.name)}: ${fields.join('; ')}</li>`;
  }).join('');
  return `<p>Calendario aplicado: ${esc(result.inserted)} altas; ${esc(result.existing)} pruebas existentes sin cambios; ${esc(result.categories)} categorías.</p>`
    +(diffs.length?`<p>${diffs.length} pruebas difieren de UCI y no se han modificado:</p><ul>${rows}</ul>`:'');
}
const confirmDialog=({message,title,confirmText})=>confirmNative(message,{title,confirmText});

const COMMON_TABS=['highlights','notifications','operations','analytics'];
const EDITOR_TABS=[['identity','General'],['tv','TV'],['videos','Vídeos'],['docs','Docs'],['results','Resultados']];
const EDITOR_TAB_KEYS=EDITOR_TABS.map(([key])=>key);
const TABS={cxAgenda:'Agenda',cxRaces:'Carreras',cxTournaments:'Trofeos',cxStartlists:'Dorsales',cxRiders:'Corredores',cxTeams:'Equipos'};
const CX_RAIL_ORDER=['cxAgenda','analytics','operations','cxStartlists','notifications','highlights','cxRiders','cxTeams','cxRaces','cxTournaments'];
const TAB_ICONS={
  cxAgenda:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  cxRaces:'<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  cxTournaments:'<path d="M8 21h8m-4-5v5M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v3a4 4 0 0 0 4 4m9-7h3v3a4 4 0 0 1-4 4"/>',
  cxStartlists:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  cxRiders:'<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>',
  cxTeams:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
};
const STATUS_LABELS={pending:'Pendiente',provisional:'Provisional',official:'Oficial',published:'Publicado',draft:'Borrador'};
let ctx,view,activeTab,renderVersion=0,roadRailOrder=[];
let seasonKey=currentSeason(),races=[],tournaments=[],teams=[];
let commonRaces=[];
let agendaDateKey=cxPanelAgendaDate(madridDateKey(new Date()));let activeRaceId=null;
// Sentido de la última navegación de la agenda; null si el usuario eligió la fecha.
let agendaSkipDirection=0;
const raceFilters={search:'',country:'',category:null,sort:'cat'};
export const cxCommonRaceName=id=>commonRaces.find(r=>r.id===id)?.name;
export async function loadCxCommonRaces(client) {commonRaces=(await cxAllRows(client,'cx_races','id,name,dateKey,seasonKey')).filter(r=>cxDateInSeason(r.seasonKey,r.dateKey));commonRaces.sort((a,b)=>b.dateKey.localeCompare(a.dateKey)||a.name.localeCompare(b.name));return commonRaces;}
export async function fillCxRaceSelect(client,node,selected='',{isCurrent=()=>true}={}) {const rows=await loadCxCommonRaces(client);if(!isCurrent())return;node.innerHTML=option('','Seleccionar carrera CX',selected)+rows.map(r=>option(r.id,`${r.dateKey} · ${r.name} · ${r.seasonKey}`,selected)).join('');}
let commonTournaments=[];
export const cxCommonTournamentName=id=>commonTournaments.find(t=>t.id===id)?.name;
export async function loadCxCommonTournaments(client) {commonTournaments=await cxAllRows(client,'cx_tournaments','id,name,nameEn,slug,seasonKey,logoUrl,colorHex');commonTournaments.sort((a,b)=>(b.seasonKey||'').localeCompare(a.seasonKey||'')||a.name.localeCompare(b.name));return commonTournaments;}
export async function fillCxTournamentSelect(client,node,selected='',{isCurrent=()=>true}={}) {const rows=await loadCxCommonTournaments(client);if(!isCurrent())return;node.innerHTML=option('','Seleccionar torneo CX',selected)+rows.map(t=>option(t.id,`${t.seasonKey||''} · ${t.name}`.trim(),selected)).join('');}
export const isCxTab=tab=>Object.hasOwn(TABS,tab);
function currentSeason() {return cxSeason();}
let currentArea=/^#cx[A-Z]/.test(location.hash)?'cx':'road';
export const panelArea=()=>currentArea;
export const areaAgenda=()=>panelArea()==='cx'?'cxAgenda':'agenda';
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
const options=(values,selected)=>values.map(v=>option(v,v,selected)).join('');
const select=(name,label,values,selected,required=false)=>`<label class="field cx-field">${esc(label)}<select name="${name}" ${required?'required':''}>${values.map(v=>Array.isArray(v)?option(v[0],v[1],selected):option(v,v,selected)).join('')}</select></label>`;
const logoField=value=>{const id=`cx-logo-${crypto.randomUUID()}`;return `<div class="field cx-field cx-logo-field"><label for="${id}">URL del logo</label><div class="field-upload-wrap"><input id="${id}" name="logoUrl" type="url" value="${esc(value)}" placeholder="Pega la URL de una imagen (https://…)" autocomplete="off" spellcheck="false"></div><div class="cx-logo-preview"><span data-logo-image></span><small data-logo-state role="status"></small><button class="btn btn--ghost" data-logo-clear type="button">Quitar</button></div></div>`;};
function wireLogoField(form) {
  const input=form.querySelector('[name=logoUrl]'),preview=form.querySelector('[data-logo-image]'),state=form.querySelector('[data-logo-state]');
  ctx.attachInlineUpload?.(input,'logo');
  const refreshLogo=()=>{
    for(const old of preview.querySelectorAll('img'))old.onload=old.onerror=null;
    preview.replaceChildren();
    try{cxUrl(input.value||null);}catch(error){state.textContent=error.message;return;}
    const tournament=tournaments.find(t=>t.id===form.querySelector('[name=tournamentId]')?.value);
    const image=cxLogoImage({logoUrl:input.value},tournament,{className:'cx-logo-preview__image',alt:'Previsualización del logo',onState:result=>{
      state.textContent=result.status==='empty'?'Sin logo':result.status==='unavailable'?'Logo no disponible.':`${result.source==='tournament'?'Heredado del torneo':'Logo propio'}${result.status==='loading'?' · Cargando…':''}`;
    }});
    if(image)preview.append(image);
  };
  input.addEventListener('input',refreshLogo);
  form.querySelector('[name=tournamentId]')?.addEventListener('change',refreshLogo);
  form.querySelector('[data-logo-clear]').onclick=()=>{input.value='';input.dispatchEvent(new Event('input'));};
  refreshLogo();
}
const input=(name,label,value='',type='text',extra='')=>`<label class="field cx-field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const raceColorField=value=>{const id=`cx-race-color-${crypto.randomUUID()}`;return `<div class="field cx-field"><label for="${id}">Color</label><div class="color-preview"><input class="u-color-dot" type="color" data-race-color-picker value="${esc(value||'#888888')}" aria-label="Seleccionar color de la carrera"><input class="u-grow" id="${id}" name="colorHex" type="text" value="${esc(value||'')}" placeholder="#888888" pattern="#[0-9A-Fa-f]{6}"></div></div>`;};
function wireRaceColorField(form) {
  const picker=form.querySelector('[data-race-color-picker]'),text=form.elements.colorHex;
  picker.addEventListener('input',()=>{text.value=picker.value;});
  text.addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test(text.value))picker.value=text.value;});
}
const textarea=(name,label,value='',extra='')=>`<label class="cx-field cx-wide">${esc(label)}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const checkbox=(name,label,checked)=>`<label class="cx-check"><input name="${name}" type="checkbox" ${checked?'checked':''}>${esc(label)}</label>`;
const actions=(save='Guardar')=>`<div class="cx-actions"><button class="btn btn--primary" type="submit">${save}</button><span class="cx-error" role="alert"></span></div>`;
const dataOf=root=>{const values={};for(const node of root.querySelectorAll('input[name],select[name],textarea[name]')){if(node.disabled || node.type==='radio'&&!node.checked)continue;values[node.name]=node.type==='checkbox'?node.checked:node.value;}return values;};
const emptyNull=v=>v===''?null:v;
const get=form=>Object.fromEntries(Object.entries(dataOf(form)).map(([k,v])=>[k,emptyNull(v)]));
const categoryOptions=(categories,selected,global=false)=>`${global?option('','Todas',selected):''}${categories.map(c=>option(c.category,c.category,selected)).join('')}`;
function errorAt(root,error) {const message=cxSaveErrorMessage(error),target=root.querySelector('.cx-error');if(target)target.textContent=message;ctx.showToast(message,'error');}
function onSubmit(form,handler) {
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(form.getAttribute('aria-busy')==='true'||!form.reportValidity())return;
    const buttons=[...new Set([...form.querySelectorAll('button,input[type="file"]'),...(form.closest('.editor-area')?.querySelectorAll('button')||[])])].map(node=>({node,disabled:node.disabled}));buttons.forEach(({node})=>node.disabled=true);
    const submit=form.querySelector('[type=submit]')||form.closest('.editor-area')?.querySelector('[data-save-section]'),submitHtml=submit?.innerHTML;if(submit)submit.textContent='Procesando…';form.setAttribute('aria-busy','true');
    form.querySelector('.cx-error').textContent='';
    try{await handler();}catch(error){errorAt(form,error);}finally{buttons.forEach(({node,disabled})=>{if(form.isConnected||form.contains(node))node.disabled=disabled;});if(submit)submit.innerHTML=submitHtml;form.removeAttribute('aria-busy');}
  });
}
async function loadRaces(season) {const rows=await cxAllRows(ctx.supabase,'cx_races','*,cx_race_categories(*)',{seasonKey:season});return rows.sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||CX_CLASSES.indexOf(a.class)-CX_CLASSES.indexOf(b.class)||a.name.localeCompare(b.name));}
async function refresh() {if(activeTab)await render(activeTab);}

export function mountCxPanel(context) {
  if(ctx)return;
  ctx=context;
  const rail=document.querySelector('.panel-rail__scroll');
  roadRailOrder=[...rail.children];
  for(const item of rail.querySelectorAll('[data-tab]'))item.dataset.panelArea=COMMON_TABS.includes(item.dataset.tab)?'common':'road';
  const toggle=document.createElement('div');toggle.className='cx-area-toggle';toggle.setAttribute('aria-label','Área del panel');
  toggle.innerHTML='<button type="button" data-area="road" aria-label="Carretera" title="Carretera"><span class="cx-area-full">Carretera</span><span class="cx-area-short" aria-hidden="true">Ruta</span></button><button type="button" data-area="cx" aria-label="Ciclocross" title="Ciclocross"><span class="cx-area-full">Ciclocross</span><span class="cx-area-short" aria-hidden="true">CX</span></button>';
  rail.before(toggle);
  for(const [tab,label] of Object.entries(TABS).reverse()) {
    const button=document.createElement('button');button.type='button';button.className='rail-item';button.dataset.tab=tab;button.dataset.panelArea='cx';button.title=label;button.setAttribute('aria-label',label);
    button.innerHTML=`<svg aria-hidden="true" viewBox="0 0 24 24" width="1.05rem" height="1.05rem" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[tab]}</svg><span class="rail-item__label">${label}</span>`;
    rail.prepend(button);
  }
  view=document.createElement('div');view.id='cxView';view.className='cx-panel';view.style.display='none';
  document.querySelector('.panel-layout').append(view);
  toggle.addEventListener('click',event=>{const area=event.target.closest('[data-area]')?.dataset.area;if(area){setArea(area);ctx.navigate(area==='cx'?'cxAgenda':'agenda');}});
  setArea(panelArea());
}
function setArea(area) {
  currentArea=area==='cx'?'cx':'road';
  document.querySelectorAll('[data-panel-area]').forEach(node=>node.hidden=node.dataset.panelArea!=='common'&&node.dataset.panelArea!==area);
  const rail=document.querySelector('.panel-rail__scroll');
  for(const node of area==='cx'?CX_RAIL_ORDER.map(tab=>rail.querySelector(`[data-tab="${tab}"]`)):roadRailOrder)if(node)rail.append(node);
  document.querySelectorAll('.cx-area-toggle [data-area]').forEach(node=>{node.classList.toggle('active',node.dataset.area===area);node.setAttribute('aria-pressed',String(node.dataset.area===area));});
}
export function showCxTab(tab) {
  if(!ctx)return;
  activeTab=isCxTab(tab)?tab:null;if(!activeTab)++renderVersion;view.style.display=activeTab?'flex':'none';
  if(isCxTab(tab)) {setArea('cx');void render(tab);}
  else if(!COMMON_TABS.includes(tab))setArea('road');
}
function raceHeader() {
  const years=Array.from({length:11},(_,i)=>2020+i),selectedYear=Number(seasonKey.slice(0,4));if(!years.includes(selectedYear))years.push(selectedYear);
  const seasons=years.sort((a,b)=>a-b).map(year=>{const season=`${year}-${String((year+1)%100).padStart(2,'0')}`;return [season,season];});
  return `<header class="races-header">${panelCatalogHeaderHtml({tabs:[{key:'races',label:'Carreras'},{key:'tournaments',label:'Trofeos'}],search:raceFilters.search,controls:[
    {key:'period',name:'season',label:'Temporada',options:seasons,value:seasonKey},
    {key:'class',label:'Categoría',options:[['','Todas'],...CX_CLASSES.map(code=>[code,code])],value:raceFilters.category,disabled:true},
    {key:'country',label:'País',options:[['','Todos los países']],disabled:true},
    {key:'sort',label:'Orden',options:[['cat','Por categoría'],['recent','Última actualización']],value:raceFilters.sort,disabled:true},
  ],actions:[{key:'import',label:'Importar calendario UCI',disabled:true},{key:'new',label:'+ Nueva carrera',primary:true,disabled:true}]})}</header><div class="cx-catalog-list cx-list"><p role="status">Cargando…</p></div>`;
}
function agendaHeader(tab='cxAgenda') {
  return `<div class="sidebar"><header class="sidebar__header">${panelDayNavigationHtml({title:TABS[tab],addLabel:tab==='cxStartlists'?'+ Nueva lista de inscritos':'+ Añadir jornada',disabled:true})}</header><div class="sidebar__list cx-list"><p role="status">Cargando…</p></div></div>`;
}
async function render(tab,keepHeader=false) {
  const version=++renderVersion;
  const dayTab=['cxAgenda','cxStartlists'].includes(tab);
  if(dayTab)seasonKey=cxPanelSeasonForDate(agendaDateKey);
  const season=seasonKey;
  const createLabel={cxTournaments:'+ Nuevo trofeo',cxRiders:'+ Nueva ficha',cxTeams:'+ Nuevo equipo'}[tab];
  if(keepHeader)view.querySelector('.cx-list').innerHTML='<p role="status">Cargando…</p>';
  else view.innerHTML=dayTab?agendaHeader(tab):tab==='cxRaces'?raceHeader():`<header class="panel-section-divider cx-toolbar"><div class="races-header__inner"><div class="panel-view-row"><h1 class="panel-view-title">${TABS[tab]}</h1><div class="panel-view-actions"><button type="button" class="btn btn--ghost" data-refresh>Actualizar</button>${createLabel?`<button type="button" class="btn btn--primary" data-new disabled>${createLabel}</button>`:''}</div></div><div class="races-header__row2">${tab==='cxTournaments'?input('season','Temporada',seasonKey,'text','pattern="[0-9]{4}-[0-9]{2}" aria-label="Temporada"'):''}<input class="races-search" type="search" data-search placeholder="Buscar…" aria-label="Buscar" disabled></div></div></header><div class="cx-list"><p role="status">Cargando…</p></div>`;
  view.querySelector('[data-new]')?.setAttribute('disabled','');
  if(tab==='cxRaces')view.querySelector('[data-search]').disabled=true;
  view.querySelector('[name=season]')?.addEventListener('change',event=>{seasonKey=event.target.value;void refresh();});
  view.querySelector('[data-refresh]')?.addEventListener('click',()=>void refresh());
  view.querySelector('[data-subview=tournaments]')?.addEventListener('click',()=>ctx.navigate('cxTournaments'));
  if(dayTab&&!keepHeader)wirePanelDayNavigation({picker:view.querySelector('[data-date]'),previous:view.querySelector('[data-previous]'),next:view.querySelector('[data-next]'),today:view.querySelector('[data-today]')},{getDate:()=>agendaDateKey,todayDate:()=>madridDateKey(new Date()),normalize:cxPanelAgendaDate,onChange:(date,{direction,picked})=>{agendaDateKey=date;agendaSkipDirection=picked?null:direction;void render(tab,true);}});
  if(dayTab&&!keepHeader)agendaSkipDirection=0;
  try {
    const [nextTournaments,nextTeams]=await Promise.all([cxAllRows(ctx.supabase,'cx_tournaments'),cxAllRows(ctx.supabase,'cx_teams')]);
    const nextRaces=['cxAgenda','cxRaces','cxStartlists'].includes(tab)?await loadRaces(season):null;
    if(version!==renderVersion || activeTab!==tab)return;
    tournaments=nextTournaments;teams=nextTeams;if(nextRaces)races=nextRaces;
    // Sin jornadas en el día: salto automático al día con jornadas más cercano.
    if(dayTab&&agendaSkipDirection!==null){const target=cxPanelNearestRaceDate(races,agendaDateKey,agendaSkipDirection);if(target!==agendaDateKey){agendaDateKey=target;const picker=view.querySelector('[data-date]');if(picker)picker.value=target;}}
    view.querySelectorAll('[data-search],[data-new],[data-import],[data-class],[data-country],[data-sort]').forEach(node=>node.disabled=false);
    view.querySelector('[data-import]')?.addEventListener('click',()=>void calendarImport());
    const create=view.querySelector('[data-new]');if(create)create.onclick=()=>tab==='cxTournaments'?editTournament():tab==='cxTeams'?editTeam():tab==='cxRiders'?editRider():tab==='cxStartlists'?openNewCxStartlist():editRace(null,'identity',tab==='cxAgenda'?agendaDateKey:null);
    if(dayTab)agendaList(view.querySelector('.cx-list'),agendaDateKey,races,tab==='cxStartlists'?'startlist':'identity');
    else if(tab==='cxRaces') {
      const countries=[...new Set(races.map(r=>r.countryCode?.toUpperCase()).filter(Boolean))].sort();
      if(!countries.includes(raceFilters.country))raceFilters.country='';
      view.querySelector('[data-country]').innerHTML=option('','Todos los países',raceFilters.country)+countries.map(code=>option(code,code,raceFilters.country)).join('');
      const paint=()=>catalogRaceList();paint();
      view.querySelector('[data-search]').oninput=event=>{raceFilters.search=event.target.value;paint();};
      view.querySelector('[data-class]').onchange=event=>{raceFilters.category=event.target.value||null;paint();};
      view.querySelector('[data-country]').onchange=event=>{raceFilters.country=event.target.value;paint();};
      view.querySelector('[data-sort]').onchange=event=>{raceFilters.sort=event.target.value;paint();};
    } else if(tab==='cxTournaments') {
      const rows=tournaments.filter(t=>t.seasonKey===seasonKey);catalogList(rows,t=>`${t.name} · ${t.seasonKey}`,editTournament);
    } else if(tab==='cxTeams') teamList();
    else riderList(version);
  }catch(error){if(version===renderVersion&&activeTab===tab){const list=view.querySelector('.cx-list');list.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button class="btn btn--ghost" data-retry>Reintentar</button>`;list.querySelector('[data-retry]').onclick=()=>void refresh();}}
}
function agendaList(root,dateKey,rows,section='identity') {
  root.replaceChildren();
  const dayRaces=cxPanelAgendaRaces(rows,dateKey);
  // Mangas como en la web: solo cuentan las pruebas publicadas del torneo.
  const rounds=cxTournamentRounds(rows.filter(race=>race.editorialStatus==='published'),cxPanelSeasonForDate(dateKey));
  const group=document.createElement('div');group.className='panel-list';
  for(const race of dayRaces)group.append(agendaItem(race,dateKey,section,rounds));
  if(group.children.length)root.append(group);else root.innerHTML='<p class="panel-catalog-empty">No hay jornadas para este día.</p>';
}
// Ficha de agenda con la presentación de la web: torneo, manga y lugar; clase;
// y la rejilla de categorías con su hora de España, el trofeo o el aspa.
const CX_CANCELLED_CROSS='<svg class="cx-category-cross" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Cancelada"><path d="M0 0L100 100M100 0L0 100" vector-effect="non-scaling-stroke"/></svg>';
function agendaCategoriesHtml(race,dateKey) {
  const categories=cxCategories(race,dateKey);
  if(!categories.length)return '';
  const states=categories.map(c=>cxCategoryCardState(race,c));
  const withState=categories.some((c,index)=>c.startTimeUtc||states[index]!=='time');
  const cells=categories.map((c,index)=>{
    const state=states[index]==='results'?resultsTrophyHtml:states[index]==='cancelled'?CX_CANCELLED_CROSS:`<strong>${esc(cxTime(c.startTimeUtc,'es-ES','Europe/Madrid')||'—')}</strong>`;
    return `<span class="cx-category-cell"><span class="cx-category-box">${esc(c.category)}</span>${withState?`<span class="cx-category-state">${state}</span>`:''}</span>`;
  }).join('');
  return `<div class="cx-category-times" style="--cx-category-count:${categories.length}">${cells}</div>`;
}
function agendaItem(race,dateKey,section,rounds) {
  const item=document.createElement('button');item.type='button';item.className='sidebar-item sidebar-item--cx';item.dataset.raceId=race.id;
  if(race.id===activeRaceId)item.classList.add('active');
  const tournament=tournaments.find(t=>t.id===race.tournamentId);
  const round=rounds.get(race.id);
  const sub=[tournament?esc(tournament.name):'',round&&round.total>1?`${round.n}/${round.total}`:'',race.venue&&race.venue!==race.name?esc(race.venue):''].filter(Boolean).join(' · ');
  const badges=(ctx.categoryBadge?.(race.class,false)||`<span class="badge">${esc(race.class)}</span>`)+(race.isCancelled?' <span class="badge badge--type-cancelled">Cancelada</span>':'');
  item.innerHTML=`<span class="sidebar-item__flag cx-agenda-logo"><span data-logo></span>${ctx.countryFlag?.(race.countryCode)||''}</span><div class="sidebar-item__info"><div class="sidebar-item__name">${esc(race.name)}</div>${sub?`<div class="sidebar-item__stage">${sub}</div>`:''}<div class="sidebar-item__badges">${badges}</div>${agendaCategoriesHtml(race,dateKey)}</div>`;
  const logo=cxLogoImage(race,tournament);if(logo)item.querySelector('[data-logo]').replaceWith(logo);else item.querySelector('[data-logo]').remove();
  item.onclick=()=>void editRace(race,section);
  return item;
}
function markAgendaActive() {for(const node of document.querySelectorAll('#cxView .sidebar-item[data-race-id]'))node.classList.toggle('active',node.dataset.raceId===activeRaceId);}
function catalogRaceList() {
  const model=panelCatalogModel(races.filter(r=>cxDateInSeason(r.seasonKey,r.dateKey)),{categoryOf:r=>r.class,categoryOrder:CX_CLASSES,selectedCategory:raceFilters.category,...raceFilters});
  raceFilters.category=model.selectedCategory;view.querySelector('[data-class]').value=model.selectedCategory||'';
  renderPanelCatalog(view.querySelector('.cx-list'),model,{onCategory:category=>{raceFilters.category=category;catalogRaceList();},onRace:race=>void editRace(race),itemHtml:(race,{showTimestamp})=>{
    const timestamp=showTimestamp&&(race.updatedAt||race.createdAt);
    const date=timestamp?new Date(timestamp).toLocaleDateString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}):'';
    return panelRaceListItemHtml({flagHtml:ctx.countryFlag?.(race.countryCode)||'',name:race.name,isCancelled:race.isCancelled,category:race.class,metadataHtml:`${race.cx_race_categories.map(c=>esc(c.category)).join(' / ')} · ${esc(race.dateKey)} → ${esc(race.endDateKey||race.dateKey)} · <strong>${esc(race.class)}</strong>${date?` · <span class="u-c-accent">${esc(date)}</span>`:''}`});
  },emptyMessage:`No hay carreras${raceFilters.search?' que coincidan con la búsqueda':` para ${seasonKey}`}.`});
}
function openNewCxStartlist() {
  let dateKey=agendaDateKey,request=0;
  const handle=ctx.openDrawer({title:'Nueva lista de inscritos',render:body=>body.innerHTML=`<div class="sidebar"><header class="sidebar__header">${panelDayNavigationHtml({title:'Inscritos'})}</header><div class="sidebar__list" data-races></div></div>`});
  const root=handle.body.querySelector('[data-races]');
  const paint=async()=>{
    const token=++request,date=dateKey;root.innerHTML='<p class="panel-catalog-empty" role="status">Cargando…</p>';
    try {
      const rows=await loadRaces(cxPanelSeasonForDate(date));
      if(token===request&&root.isConnected)agendaList(root,date,rows,'startlist');
    } catch(error) {if(token===request&&root.isConnected){root.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button type="button" class="btn btn--ghost">Reintentar</button>`;root.querySelector('button').onclick=()=>void paint();}}
  };
  wirePanelDayNavigation({picker:handle.body.querySelector('[data-date]'),previous:handle.body.querySelector('[data-previous]'),next:handle.body.querySelector('[data-next]'),today:handle.body.querySelector('[data-today]')},{getDate:()=>dateKey,todayDate:()=>madridDateKey(new Date()),normalize:cxPanelAgendaDate,onChange:date=>{dateKey=date;void paint();}});
  void paint();
}
let teamsCategory=null,riderSearchVersion=0;
const teamGenderLabel=gender=>({male:'Masculino',female:'Femenino',mixed:'Mixto'}[gender]||'');
function teamList() {
  const root=view.querySelector('.cx-list'),search=view.querySelector('[data-search]');
  const paint=()=>{
    const term=search.value.toLowerCase().trim(),filtered=teams.filter(t=>`${t.name} ${t.uciCode} ${(t.nameAliases||[]).join(' ')}`.toLowerCase().includes(term));
    const sections=[['UCI','Equipos UCI',t=>t.category!=='CLUB'],['CLUBM','Club masculino',t=>t.category==='CLUB'&&t.gender==='male'],['CLUBW','Club femenino',t=>t.category==='CLUB'&&t.gender==='female'],['CLUBX','Club mixto',t=>t.category==='CLUB'&&t.gender==='mixed']].map(([key,label,test])=>({key,label,items:filtered.filter(test)})).filter(s=>s.items.length);
    const catalog=panelTeamCatalogHtml({sections,selectedCategory:teamsCategory,search:term,total:teams.length,rowHtml:t=>panelTeamRowHtml(t,{meta:[teamGenderLabel(t.gender),t.uciCode,t.countryCode]})});
    teamsCategory=catalog.selectedCategory;root.innerHTML=catalog.html;
    root.querySelectorAll('[data-team-category]').forEach(button=>button.onclick=()=>{teamsCategory=button.dataset.teamCategory;paint();});
    root.querySelector('.cat-back__btn')?.addEventListener('click',()=>{teamsCategory=null;paint();});
    root.querySelectorAll('[data-team-id]').forEach(row=>row.onclick=()=>editTeam(teams.find(t=>t.id===row.dataset.teamId)));
  };paint();search.oninput=paint;
}
function riderList(renderToken) {
  const search=view.querySelector('[data-search]'),root=view.querySelector('.cx-list');root.innerHTML='';let debounce;
  const paint=async()=>{
    const token=++riderSearchVersion,term=search.value.trim(),tokens=riderSearchTokens(term);
    if(term.length<3||!tokens.length){root.innerHTML='';return;}
    root.innerHTML='<div class="u-fs-3 u-c-dim">Buscando…</div>';
    try {
      const [men,women]=await Promise.all(['men','women'].map(gender=>cxQuery(withRiderSearch(ctx.supabase.from(`cx_riders_${gender}`).select('*'),tokens).order('lastName').limit(12))));
      if(token!==riderSearchVersion||renderToken!==renderVersion||!root.isConnected)return;
      const rows=[...men.map(r=>({...r,gender:'men'})),...women.map(r=>({...r,gender:'women'}))].filter(r=>riderMatchesSearch(r,term)).sort((a,b)=>`${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`,'es',{sensitivity:'base'}));
      root.innerHTML=rows.length?'<div class="panel-list">'+rows.map((r,index)=>panelRiderRowHtml(r,{index,flagHtml:ctx.countryFlag?.(r.nationality)||'',teamName:teams.find(t=>t.id===r.currentTeamId)?.name})).join('')+'</div>':'<div class="u-fs-3 u-c-dim">Sin resultados.</div>';
      root.querySelectorAll('[data-rider-index]').forEach(button=>button.onclick=()=>editRider(rows[Number(button.dataset.riderIndex)]));
    }catch(error){if(token===riderSearchVersion&&renderToken===renderVersion&&root.isConnected){root.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button type="button" class="btn btn--ghost">Reintentar</button>`;root.querySelector('button').onclick=()=>void paint();}}
  };
  search.oninput=()=>{++riderSearchVersion;clearTimeout(debounce);debounce=setTimeout(()=>void paint(),280);};
}
function cxOriginHtml(link,lastDumpAt) {
  if(!link)return `<div class="ru-origin"><div class="ru-origin__state">Esta carrera <strong>no tiene fuente enlazada</strong> — sin enlace no hay resultados in-house.</div>
    <div class="u-row u-mt-045 u-wrap">
      <a class="btn btn--ghost btn--compact" href="https://dataride.uci.ch/" target="_blank" rel="noopener">Últimos resultados de DataRide ↗</a>
      <button type="button" class="btn btn--primary cru-link-edit btn--compact">Enlazar fuente</button>
    </div></div>`;
  return `<div class="ru-origin">
    <div class="ru-origin__state">Origen: <a href="https://dataride.uci.ch/" target="_blank" rel="noopener">DataRide ↗</a>${lastDumpAt?`<span class="u-c-dim"> · último volcado ${esc(new Date(lastDumpAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}))}</span>`:''}</div>
    ${link.lastFetchError?`<div class="u-c-danger u-fs-1 u-mt-025">${esc(link.lastFetchError)}</div>`:''}
    <div class="u-row u-mt-045 u-wrap">
      <button type="button" class="btn btn--ghost cru-link-edit btn--compact">Cambiar enlace</button>
      <button type="button" class="btn btn--ghost cru-unlink btn--compact u-c-danger">Desenlazar</button>
      <button type="button" class="btn btn--primary cru-dump btn--compact"
        title="Re-vuelca esta carrera, respetando las mangas bloqueadas manualmente.">▶ Volcar esta carrera</button>
    </div></div>`;
}
// Las ventanas CX son minutos relativos al final estimado de cada manga, no horas absolutas.
function cxSyncPolicyHtml(link) {
  const start=link.syncStartOffsetMinutes??-15,stop=link.syncStopOffsetMinutes??720,interval=link.syncIntervalMinutes??30;
  return `<div class="ru-sync-policy u-mt-065">
    <div class="u-fs-1 u-c-muted">Horario de volcado automático</div>
    <div class="ru-sync-box">
      <label><input type="checkbox" data-sync-enabled ${link.syncEnabled?'checked':''}> Recogida automática</label>
      <div class="u-row u-gap-055 u-wrap u-mt-050 u-items-end">
        <label> <span class="u-c-dim">Apertura (min antes del final estimado)</span><input type="number" data-sync-start value="${start}" min="-1440" max="1440" class="u-w-600"></label>
        <label> <span class="u-c-dim">Cierre (min después)</span><input type="number" data-sync-stop value="${stop}" min="0" max="2880" class="u-w-600"></label>
        <label> <span class="u-c-dim">Cadencia (min)</span><input type="number" data-sync-interval value="${interval}" min="1" max="240" class="u-w-500"></label>
        <button type="button" class="btn btn--primary cru-sync-save btn--compact">Guardar programación</button>
      </div></div></div>`;
}
async function resultsView(root,race,categories) {
  const [links,rows]=await Promise.all([cxQuery(ctx.supabase.from('cx_race_uci_links').select('*').eq('raceId',race.id)),cxAllRows(ctx.supabase,'cx_results','*',{raceId:race.id})]);
  if(!root.isConnected)return;
  const link=links[0],lastDump=rows.map(r=>r.updatedAt).filter(Boolean).sort().at(-1);
  const render=()=>resultsView(root,race,categories);
  const byCategory=new Map(categories.map(c=>[c.category,c]));
  root.innerHTML=panelSectionHtml('Resultados',`${cxOriginHtml(link,lastDump)}<div class="cru-link-panel u-mt-050 u-fs-2" style="display:none"></div>${link?cxSyncPolicyHtml(link):''}${categories.length?`<div class="ru-class-list">${categories.map(c=>{
    const own=rows.filter(r=>r.category===c.category),leader=own.find(r=>r.rank===1&&!r.irm)?.riderDisplay;
    return panelClassificationRowHtml({label:c.category,title:STATUS_LABELS[c.resultsStatus]||'Pendiente',rowCount:own.length,leader,locked:Boolean(c.resultsLockedAt),chipsHtml:`<span class="uci-chip">${esc(STATUS_LABELS[c.resultsStatus]||'Pendiente')}</span>${c.resultsLockedAt?`<span class="uci-chip ru-chip-lock" title="Bloqueada el ${esc(new Date(c.resultsLockedAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}))} — el cron no la sobreescribe">🔒 bloqueada</span>`:''}`,actionsHtml:`<button type="button" class="btn btn--ghost cru-lock u-fs-1 u-py-0 u-px-055" data-category="${esc(c.category)}">${c.resultsLockedAt?'Desbloquear':'Bloquear'}</button><button type="button" class="btn btn--ghost cru-edit btn--row" data-category="${esc(c.category)}">Editar</button>${own.length||c.resultsStatus!=='pending'?`<button type="button" class="btn btn--ghost cru-delete btn--row u-c-danger" data-category="${esc(c.category)}" aria-label="Borrar resultados ${esc(c.category)}">Borrar</button>`:''}`});
  }).join('')}</div>`:'<p class="ru-empty">Sin categorías.</p>'}<p class="cx-error" role="alert"></p>`);
  root.querySelectorAll('.cru-link-edit').forEach(button=>button.onclick=()=>{
    const panel=root.querySelector('.cru-link-panel');
    panel.style.display='block';
    panel.innerHTML=`<div class="u-row u-gap-050 u-items-center u-wrap">
      <input type="number" data-comp placeholder="competitionId" min="1" value="${link?.competitionId??''}" class="u-w-950">
      <input type="number" data-season placeholder="seasonId" min="1" value="${link?.seasonId??472}" class="u-w-800" title="Season ID de resultados de DataRide; 472 = 2026-27.">
      <input type="number" data-uci placeholder="uciRaceId (manga, opc.)" min="0" value="${link?.uciRaceId||''}" class="u-w-1200" title="Race ID de DataRide para volcar solo una prueba de la competición. Vacío o 0 = competición entera.">
      <button type="button" class="btn btn--primary cru-link-save u-fs-1 u-py-0 u-px-060">Guardar enlace</button></div>`;
    panel.querySelector('[data-comp]').focus();
    panel.querySelector('.cru-link-save').onclick=async event=>{
      const save=event.currentTarget;
      const competitionId=Number(panel.querySelector('[data-comp]').value),seasonId=Number(panel.querySelector('[data-season]').value),uciRaceId=Number(panel.querySelector('[data-uci]').value)||0;
      if(!Number.isSafeInteger(competitionId)||competitionId<=0||!Number.isSafeInteger(seasonId)||seasonId<=0){errorAt(root,new Error('Introduce competitionId y seasonId numéricos.'));return;}
      save.disabled=true;
      try{await cxQuery(ctx.supabase.from('cx_race_uci_links').upsert({raceId:race.id,disciplineId:3,competitionId,seasonId,uciRaceId,updatedAt:new Date().toISOString()},{onConflict:'raceId'}));ctx.showToast('Enlace guardado','success');await render();}
      catch(error){save.disabled=false;errorAt(root,error);}
    };
  });
  root.querySelector('.cru-unlink')?.addEventListener('click',async()=>{
    try{if(await confirmDialog({title:'Quitar enlace DataRide',message:'Se conserva la carrera y sus resultados.',confirmText:'Quitar'})){await cxQuery(ctx.supabase.from('cx_race_uci_links').delete().eq('raceId',race.id));await render();}}
    catch(error){errorAt(root,error);}
  });
  root.querySelector('.cru-dump')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await cxRpc(ctx.supabase,'cx_enqueue_results_fetch',{p_race_id:race.id,p_category:null});button.textContent='Volcado encolado';ctx.showToast('Volcado DataRide encolado','success');}catch(error){button.disabled=false;errorAt(root,error);}});
  root.querySelector('.cru-sync-save')?.addEventListener('click',async event=>{
    const box=event.currentTarget.closest('.ru-sync-policy'),button=event.currentTarget;
    const start=Number(box.querySelector('[data-sync-start]').value),stop=Number(box.querySelector('[data-sync-stop]').value),interval=Number(box.querySelector('[data-sync-interval]').value);
    if(!Number.isSafeInteger(start)||start<-1440||start>1440||!Number.isSafeInteger(stop)||stop<0||stop>2880||stop<start||!Number.isSafeInteger(interval)||interval<1||interval>240){errorAt(root,new Error('Programación fuera de los límites de la ventana CX.'));return;}
    button.disabled=true;
    try{await cxQuery(ctx.supabase.from('cx_race_uci_links').update({syncEnabled:box.querySelector('[data-sync-enabled]').checked,syncStartOffsetMinutes:start,syncStopOffsetMinutes:stop,syncIntervalMinutes:interval,updatedAt:new Date().toISOString()}).eq('raceId',race.id));ctx.showToast('Programación guardada','success');await render();}
    catch(error){button.disabled=false;errorAt(root,error);}
  });
  root.querySelectorAll('.cru-lock').forEach(button=>button.onclick=async()=>{
    const category=button.dataset.category,c=byCategory.get(category);if(!c)return;
    const locked=Boolean(c.resultsLockedAt);
    const msg=locked?'¿Desbloquear esta manga? El próximo volcado del cron la sobreescribirá con los datos de DataRide (se perderán las correcciones manuales).':'¿Bloquear esta manga sin editarla? El cron dejará de actualizarla con los datos de DataRide.';
    if(!await confirmDialog({title:'Bloqueo de la manga',message:msg,confirmText:locked?'Desbloquear':'Bloquear'}))return;
    try{await cxQuery(ctx.supabase.from('cx_race_categories').update({resultsLockedAt:locked?null:new Date().toISOString()}).eq('raceId',race.id).eq('category',category));ctx.showToast(locked?'Manga desbloqueada — el cron vuelve a sincronizarla.':'Manga bloqueada — el cron no la sobreescribirá.','success');await render();}
    catch(error){errorAt(root,error);}
  });
  root.querySelectorAll('.cru-delete').forEach(button=>button.onclick=async()=>{
    const category=button.dataset.category,c=byCategory.get(category);if(!c)return;
    const count=rows.filter(r=>r.category===category).length;
    if(!await confirmDialog({title:'Borrar resultados',message:`¿Borrar los resultados de la manga ${category}? Se eliminarán sus ${count===1?'1 fila':`${count} filas`} y quedará pendiente. Si la fuente los publica de nuevo, el cron podrá crearlos otra vez.`,confirmText:'Eliminar'}))return;
    try{await cxRpc(ctx.supabase,'cx_replace_results',{p_race_id:race.id,p_category:category,p_rows:[],p_status:'pending',p_evidence:{sourceUrl:c.resultsSourceUrl||null,inputSource:'manual',lockAutomatic:false}});ctx.showToast(`Resultados de ${category} borrados.`,'success');await render();}
    catch(error){errorAt(root,error);}
  });
  const openRows=(category,draft)=>{
    const handle=ctx.openDrawer({level:2,title:`Resultados · ${category}`,render:body=>body.innerHTML='<div data-class-editor></div>'});
    void rowsForm(handle.body.querySelector('[data-class-editor]'),race,categories,'results',{category,profileLevel:null,draft,onSaved:async()=>{handle.close();if(root.isConnected)await resultsView(root,race,categories);},onCreateProfile:snapshot=>{
      const row=snapshot.rows[snapshot.index];
      editRider({gender:cxGender(category),firstName:row.firstName||'',lastName:row.lastName||'',nationality:row.isoCode2||null,source:snapshot.fields.sourceUrl||'manual',verified:false},{level:2,onSaved:profile=>{snapshot.rows[snapshot.index].globalRiderId=profile.id;openRows(category,snapshot);},onCancel:()=>{if(root.isConnected)openRows(category,snapshot);}});
    }}).catch(error=>ctx.showToast(error.message,'error'));
  };
  root.querySelectorAll('.cru-edit').forEach(button=>button.onclick=()=>openRows(button.dataset.category));
}
function catalogList(rows,label,edit) {
  const root=view.querySelector('.cx-list'),search=view.querySelector('[data-search]');
  const paint=()=>{root.replaceChildren();const group=document.createElement('div');group.className='panel-list';for(const row of rows.filter(r=>label(r).toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>label(a).localeCompare(label(b)))){const button=document.createElement('button');button.className='cx-row';const identity=document.createElement('span');identity.className='cx-row__identity';const text=document.createElement('span');text.textContent=label(row);identity.append(text);const logo=cxLogoImage(row);if(logo)identity.prepend(logo);button.append(identity);button.onclick=()=>void edit(row);group.append(button);}if(group.children.length)root.append(group);else root.innerHTML='<p>No hay entradas.</p>';};
  paint();search.oninput=paint;
}

async function calendarImport() {
  const selectedSeason=seasonKey;
  let session;
  const handle=ctx.openDrawer({title:'Importar calendario oficial UCI',onClose:()=>session?.close(),render:body=>{
    body.innerHTML=`<div class="cx-actions"><button class="btn btn--primary" data-fetch>Consultar UCI</button><label class="btn btn--ghost">Abrir manifiesto<input type="file" data-file accept="application/json,.json" hidden></label></div><div data-preview></div><p class="cx-error" role="alert"></p>`;
  }});
  const body=handle.body,root=body.querySelector('[data-preview]'),file=body.querySelector('[data-file]'),fetch=body.querySelector('[data-fetch]');
  function preview(manifest) {
    root.innerHTML=`<p>${manifest.summary.races} pruebas; ${manifest.summary.categories} categorías; ${manifest.summary.excludedCompetitions} competiciones excluidas.</p><div class="cx-table-wrap"><table><thead><tr><th>Fecha</th><th>Prueba</th><th>Clase</th><th>Categorías</th></tr></thead><tbody>${manifest.races.map(item=>`<tr><td>${esc(item.race.dateKey)}</td><td>${esc(item.race.name)}</td><td>${esc(item.race.class)}</td><td>${item.categories.map(c=>esc(c.category)).join(' / ')}</td></tr>`).join('')}</tbody></table></div><button class="btn btn--primary" data-apply>Aplicar calendario</button>`;
    root.querySelector('[data-apply]').onclick=async()=>{if(await session.apply(manifest=>cxRpc(ctx.supabase,'cx_import_calendar',{p_manifest:manifest})))await refresh();};
  }
  session=new CxCalendarImportState(selectedSeason,state=>{
    if(!body.isConnected)return;
    const busy=state.status==='loading'||state.status==='applying';
    body.setAttribute('aria-busy',String(busy));fetch.disabled=busy;file.disabled=state.status==='applying';
    body.querySelector('.cx-error').textContent=state.error?.message||'';
    if(state.status==='loading')root.textContent='Consultando calendario…';
    else if(state.status==='error')root.textContent='No se ha aplicado ningún dato.';
    else if(state.status==='ready')preview(state.manifest);
    else if(state.status==='applying')root.querySelector('[data-apply]').disabled=true;
    else if(state.status==='applied')root.innerHTML=calendarResultHtml(state.result);
  });
  file.onchange=async event=>{const selected=event.target.files[0];if(!selected)return;event.target.value='';await session.load(async()=>JSON.parse(await selected.text()));};
  fetch.onclick=()=>session.load(async()=>{const {data,error}=await ctx.supabase.functions.invoke('cx-calendar',{body:{seasonKey:selectedSeason}});if(error)throw error;if(data?.error)throw new Error(data.error);return data;});
}

function boxSection(parent,title,nodes) {
  const section=document.createElement('div');section.innerHTML=panelSectionHtml(title,'');
  const box=section.firstElementChild;parent.insertBefore(box,nodes[0]);box.querySelector('.editor-section__body').append(...nodes);
}
export function openCxRaceEditor(raceId,section='identity') {
  const target=[...EDITOR_TAB_KEYS,'startlist'].includes(section)?section:'identity';
  return editRace({id:raceId},target,null,{fromPublic:true});
}
async function editRace(existing=null,section='identity',presetDate=null,{duplicate=false,fromPublic=false}={}) {
  try {
    const race=existing?await cxQuery(ctx.supabase.from('cx_races').select('*,cx_race_categories(*)').eq('id',existing.id).single()):{seasonKey,seasonStartYear:Number(seasonKey.slice(0,4)),dateKey:presetDate||(cxDateInSeason(seasonKey,madridDateKey(new Date()))?madridDateKey(new Date()):cxSeasonBounds(seasonKey).first),class:'C2',editorialStatus:'published'};
    if(fromPublic) {
      if(!cxDateInSeason(race.seasonKey,race.dateKey))throw new Error('Carrera fuera de la temporada CX.');
      [tournaments,teams]=await Promise.all([cxAllRows(ctx.supabase,'cx_tournaments'),cxAllRows(ctx.supabase,'cx_teams')]);
      seasonKey=race.seasonKey;agendaDateKey=race.dateKey;
      ctx.navigate('cxAgenda');
    }
    if(duplicate) {
      delete race.id;delete race.updatedAt;delete race.createdAt;
      race.slug='';race.slugEn='';race.editorialStatus='draft';
      for(const category of race.cx_race_categories||[])for(const key of ['resultsStatus','resultsSourceUrl','resultsLockedAt','bonusSourceUrl','resultsEvidence'])delete category[key];
    }
    const categories=race.cx_race_categories||[];
    activeRaceId=race.id||null;markAgendaActive();
    const openSection=duplicate?'identity':section;
    const handle=ctx.openDrawer({title:'Jornada',onClose:()=>{handle.body.classList.remove('cx-jornada-drawer');if(handle.isCurrent()){activeRaceId=null;markAgendaActive();}},render:body=>{
      body.classList.add('cx-jornada-drawer');
      body.innerHTML=`<div class="editor-area">${panelEditorTopbarHtml({name:race.name||'Nueva jornada',flagHtml:ctx.countryFlag?.(race.countryCode)||'',date:race.dateKey,published:Boolean(race.id)&&race.editorialStatus==='published',updated:race.updatedAt?new Date(race.updatedAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'',actionsHtml:`${race.id?`<a class="btn btn--ghost" href="/ciclocross/${esc(race.slug)}/" target="_blank" rel="noopener">Ver ↗</a><button type="button" class="btn btn--ghost" data-dorsals>Dorsales</button><button type="button" class="btn btn--danger" data-delete-race>Borrar</button><button type="button" class="btn btn--ghost" data-duplicate>Duplicar</button>`:''}<button type="button" class="btn btn--ghost" data-draft hidden>Borrador</button><button type="button" class="btn btn--primary" data-save-section>Actualizar</button>`})}<div class="editor-content">${panelEditorTabsHtml(EDITOR_TABS.map(([key,label])=>({key,label,disabled:!race.id&&key!=='identity'})),{attribute:'section'})}<div class="cx-editor-body"></div></div></div>`;
    }});
    const show=async key=>{
      const root=document.createElement('div');handle.body.querySelector('.cx-editor-body').replaceChildren(root);root.innerHTML='<p role="status">Cargando…</p>';
      const save=handle.body.querySelector('[data-save-section]');save.disabled=true;save.hidden=key==='results';save.textContent=key==='identity'?(race.id&&race.editorialStatus==='published'?'Actualizar':'Publicar'):key==='startlist'?'Preparar importación':'Guardar';
      const draft=handle.body.querySelector('[data-draft]');draft.hidden=key!=='identity';
      handle.body.querySelectorAll('[data-section]').forEach(b=>{const selected=b.dataset.section===key;b.classList.toggle('editor-tab--active',selected);b.setAttribute('aria-selected',String(selected));});
      try {
        if(key==='identity'){const slugRaces=await cxAllRows(ctx.supabase,'cx_races','id,slug,slugEn',{seasonKey:race.seasonKey});if(!root.isConnected)return;raceForm(root,race,categories,handle,slugRaces);root.querySelector('.cx-actions [type=submit]').hidden=true;const remove=root.querySelector('[data-delete]');if(remove)remove.hidden=true;}
        else if(key==='tv'||key==='videos'){await mediaForm(root,race,categories,key);if(root.isConnected)root.querySelector('.cx-actions [type=submit]').hidden=true;}
        else if(key==='docs')await docsForm(root,race);
        else if(key==='results'||key==='dataride')await resultsView(root,race,categories);
        else await rowsForm(root,race,categories,'startlist');
        if(root.isConnected)save.disabled=!root.querySelector('form');
      }catch(error){if(!root.isConnected)return;root.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button type="button" class="btn btn--ghost">Reintentar</button>`;root.querySelector('button').onclick=()=>void show(key);}
    };
    handle.body.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>void show(button.dataset.section));
    handle.body.querySelector('[data-dorsals]')?.addEventListener('click',()=>void show('startlist'));
    handle.body.querySelector('[data-save-section]').onclick=()=>{const form=handle.body.querySelector('.cx-editor-body form');if(!form)return;const status=form.querySelector('[name=editorialStatus]');if(status)status.value='published';form.requestSubmit();};
    handle.body.querySelector('[data-draft]').onclick=()=>{const form=handle.body.querySelector('.cx-editor-body form');const status=form?.querySelector('[name=editorialStatus]');if(status){status.value='draft';form.requestSubmit();}};
    handle.body.querySelector('[data-duplicate]')?.addEventListener('click',()=>{handle.close();void editRace({id:existing.id},'identity',null,{duplicate:true});});
    handle.body.querySelector('[data-delete-race]')?.addEventListener('click',async()=>{if(await confirmDialog({title:'Eliminar carrera',message:'Se eliminan la carrera y todos sus datos asociados.',confirmText:'Eliminar'})){try{await cxQuery(ctx.supabase.from('cx_races').delete().eq('id',race.id));handle.close();await refresh();}catch(error){ctx.showToast(error.message,'error');}}});
    await show(openSection);
  }catch(error){ctx.showToast(error.message,'error');}
}

async function markCxRacePageIfMissing(slug) {
  try {
    const response=await fetch(`/ciclocross/${encodeURIComponent(slug)}/`,{method:'HEAD',cache:'no-store'});
    if(response.ok||response.status!==404)return;
    const {error}=await ctx.supabase.rpc('admin_mark_web_pages_dirty');
    if(error)console.warn('No se pudo marcar la creación de páginas CX:',error.message||error);
  }catch(error){console.warn('No se pudo comprobar la página de ciclocross; no se regenera:',error?.message||error);}
}

function raceForm(root,race,categories,handle,slugRaces=[]) {
  const saveId=race.id||crypto.randomUUID();
  root.innerHTML=`<form class="cx-form"><div class="cx-grid">${input('name','Nombre',race.name,'text','required')}${input('nameEn','Nombre (EN)',race.nameEn)}${input('slug','Slug',race.slug,'text','required pattern="[a-z0-9-]+"')}${input('slugEn','Slug (EN)',race.slugEn,'text','pattern="[a-z0-9-]+"')}${input('seasonKey','Temporada',race.seasonKey,'text','required pattern="[0-9]{4}-[0-9]{2}"')}${input('dateKey','Fecha',race.dateKey,'date','required')}${input('endDateKey','Fecha fin (multidía)',race.endDateKey,'date')}${select('class','Clase',CX_CLASSES,race.class,true)}${input('countryCode','País',race.countryCode,'text','maxlength="5" autocomplete="off" spellcheck="false" placeholder="ES, FR, ES-CT…"')}${input('venue','Localidad',race.venue)}${input('timezone','Zona horaria',race.timezone)}${input('websiteUrl','Web oficial',race.websiteUrl,'url')}${select('tournamentId','Torneo',[['','Sin torneo'],...tournaments.map(t=>[t.id,`${t.name} · ${t.seasonKey}`])],race.tournamentId||'')}${raceColorField(race.colorHex)}<input type="hidden" name="editorialStatus" value="${esc(race.editorialStatus||'published')}">${checkbox('isCancelled','Carrera cancelada',race.isCancelled)}${logoField(race.logoUrl)}</div><h2 class="editor-section__header editor-section__title">Categorías</h2><div class="cx-category-options">${CX_CATEGORIES.map(category=>checkbox(`enabled-${category}`,category,categories.some(c=>c.category===category))).join('')}</div><div class="cx-category-grid">${CX_CATEGORIES.map(category=>{const c=categories.find(x=>x.category===category),local=cxLocalParts(c?.startTimeUtc,race.timezone);return `<fieldset data-category="${category}"><legend>${category}</legend>${input('dateKey','Fecha',c?.dateKey||race.dateKey,'date')}${input('time','Salida local',local?.time,'time')}${select('durationFormat','Formato de manga',[['','Sin verificar'],['individual','Manga propia de la categoría'],...(['WE','WJ'].includes(category)?[['WE_WJ','WE y WJ en la misma manga']]:[])],c?.durationFormat||'')}${checkbox('isCancelled','Categoría cancelada',c?.isCancelled)}<small data-timing></small></fieldset>`;}).join('')}</div>${actions()}${race.id?'<button class="btn btn--danger" data-delete type="button">Eliminar carrera</button>':''}</form>`;
  const form=root.querySelector('form');
  boxSection(form,'Identidad',[form.querySelector('.cx-grid')]);
  form.querySelector('h2').remove();
  boxSection(form,'Categorías',[form.querySelector('.cx-category-options'),form.querySelector('.cx-category-grid')]);
  wireLogoField(form);
  wireRaceColorField(form);
  attachCountryAutocomplete(form.querySelector('.cx-grid [name=countryCode]'));
  const updateDateBounds=()=>{
    try {
      const {first,last}=cxSeasonBounds(form.querySelector('.cx-grid [name=seasonKey]').value);
      form.querySelectorAll('input[type=date]').forEach(node=>{node.min=first;node.max=last;});
    }catch { }
  };
  form.querySelector('.cx-grid [name=seasonKey]').addEventListener('change',updateDateBounds);updateDateBounds();
  const updateTiming=field=>{
    const enabled=form.querySelector(`[name=enabled-${field.dataset.category}]`).checked;
    field.hidden=!enabled;
    for(const node of field.children)if(node.tagName!=='LEGEND'){
      node.hidden=!enabled;
      for(const control of node.querySelectorAll('input,select'))control.disabled=!enabled;
      if(node.matches('input,select'))node.disabled=!enabled;
    }
    if(!enabled)return;
    const c=dataOf(field),category=field.dataset.category;
    try {
      const startTimeUtc=cxLocalToUtc(c.dateKey||race.dateKey,c.time,form.querySelector('.cx-grid [name=timezone]').value);
      const timing=cxCategoryTiming({isCancelled:form.querySelector('.cx-grid [name=isCancelled]').checked},{category,startTimeUtc,isCancelled:c.isCancelled,durationFormat:c.durationFormat||null,durationRuleVersion:c.durationFormat?CX_DURATION_RULE_VERSION:null});
      const local=timing.temporalState==='cancelled'?null:cxLocalParts(timing.estimatedEndTimeUtc,form.querySelector('.cx-grid [name=timezone]').value);
      field.querySelector('[data-timing]').textContent=local?`Final estimado: ${local.dateKey} ${local.time}`:'';
    }catch {field.querySelector('[data-timing]').textContent='';}
  };
  const updateAllTiming=()=>form.querySelectorAll('[data-category]').forEach(updateTiming);
  const updateTimingFromEvent=event=>{const field=event.target.closest('[data-category]');if(field)updateTiming(field);else if(['timezone','isCancelled'].includes(event.target.name)||event.target.name.startsWith('enabled-'))updateAllTiming();};
  form.addEventListener('input',updateTimingFromEvent);form.addEventListener('change',updateTimingFromEvent);updateAllTiming();
  const slugField=form.elements.slug,slugEnField=form.elements.slugEn;
  const identityField=name=>form.querySelector(`.cx-grid [name=${name}]`);
  const cxAutoSlug=lang=>cxUniqueRaceSlug(cxRaceSlugSuggestion({name:identityField('name')?.value,nameEn:identityField('nameEn')?.value,tournamentName:(tournament=>lang==='en'?tournament?.nameEn||tournament?.name:tournament?.name)(tournaments.find(t=>t.id===identityField('tournamentId')?.value)),venue:identityField('venue')?.value,dateKey:identityField('dateKey')?.value,lang}),{races:slugRaces,raceId:race.id,dateKey:identityField('dateKey')?.value,lang});
  const applyAutoSlug=()=>{
    if(slugField.dataset.auto)slugField.value=cxAutoSlug('es');
    if(slugEnField?.dataset.auto)slugEnField.value=cxAutoSlug('en');
  };
  if(!race.id){slugField.dataset.auto='1';if(slugEnField&&!slugEnField.value)slugEnField.dataset.auto='1';}
  else {
    const season=identityField('seasonKey')?.value||'',year=identityField('dateKey')?.value?.slice(0,4)||'';
    const base=cxSlugWithoutDiscipline(cxSlug(identityField('name')?.value||''));
    const generated=[season?`${base}-${season}`:'',year?`${base}-${year}`:'',season?`${base}-${season}-`:''].filter(p=>p&&slugField.value&&(slugField.value===p||slugField.value.startsWith(p)));
    if(!slugField.value||generated.length)slugField.dataset.auto='1';
    if(slugEnField&&!slugEnField.value)slugEnField.dataset.auto='1';
  }
  applyAutoSlug();
  const slugAutoEvent=event=>{
    if(event.target===slugField||event.target===slugEnField)delete event.target.dataset.auto;
    else if(['name','nameEn','venue','dateKey','tournamentId'].includes(event.target.name))applyAutoSlug();
  };
  form.addEventListener('input',slugAutoEvent);
  form.addEventListener('change',slugAutoEvent);
  onSubmit(form,async()=>{
    const payload=get(form);for(const key of ['time','durationFormat',...CX_CATEGORIES.map(category=>`enabled-${category}`)])delete payload[key];
    if(payload.countryCode)payload.countryCode=payload.countryCode.toUpperCase();
    // Los nombres repetidos de categorías se leen en sus fieldsets, no en identidad.
    for(const key of ['dateKey','isCancelled'])payload[key]=key==='isCancelled'?form.querySelector(`.cx-grid [name=${key}]`).checked:form.querySelector(`.cx-grid [name=${key}]`).value;
    payload.id=saveId;payload.seasonStartYear=Number(payload.seasonKey.slice(0,4));
    if(!cxDateInSeason(payload.seasonKey,payload.dateKey)||(payload.endDateKey&&!cxDateInSeason(payload.seasonKey,payload.endDateKey)))throw new Error('Las fechas CX deben quedar entre agosto y febrero de la temporada.');
    for(const key of ['websiteUrl','logoUrl'])payload[key]=cxUrl(payload[key]);
    const selected=[...form.querySelectorAll('[data-category]')].filter(f=>form.querySelector(`[name=enabled-${f.dataset.category}]`).checked).map(field=>{
      const c=dataOf(field),category=field.dataset.category,previous=categories.find(x=>x.category===category),local=cxLocalParts(previous?.startTimeUtc,race.timezone);
      if(!cxDateInSeason(payload.seasonKey,c.dateKey||payload.dateKey))throw new Error(`${category}: la fecha debe quedar entre agosto y febrero.`);
      const unchanged=previous?.startTimeUtc && race.timezone===payload.timezone && local?.time===c.time && local?.dateKey===c.dateKey;
      return {category,dateKey:c.dateKey||payload.dateKey,startTimeUtc:unchanged?previous.startTimeUtc:cxLocalToUtc(c.dateKey||payload.dateKey,c.time,payload.timezone),isCancelled:c.isCancelled,sortOrder:CX_CATEGORIES.indexOf(category),durationFormat:c.durationFormat||null,durationRuleVersion:c.durationFormat?CX_DURATION_RULE_VERSION:null};
    });
    const removed=categories.filter(c=>!selected.some(x=>x.category===c.category));
    let allow=false;if(removed.length){allow=await confirmDialog({title:'Eliminar categorías',message:`Se eliminan ${removed.map(c=>c.category).join(', ')} y sus inscritos, resultados, TV y vídeos.`,confirmText:'Eliminar categorías'});if(!allow)return;}
    const id=await cxRpc(ctx.supabase,'cx_save_race',{p_race:payload,p_categories:selected,p_allow_category_removal:allow});
    ctx.showToast('Carrera guardada','success');
    void markCxRacePageIfMissing(payload.slug);
    await refresh();
    if(!form.isConnected||!handle.isCurrent())return;
    handle.close();await editRace({id});
  });
  form.querySelector('[data-delete]')?.addEventListener('click',async()=>{if(await confirmDialog({title:'Eliminar carrera',message:'Se eliminan la carrera y todos sus datos asociados.',confirmText:'Eliminar'})){try{await cxQuery(ctx.supabase.from('cx_races').delete().eq('id',race.id));handle.close();await refresh();}catch(error){errorAt(form,error);}}});
}

async function mediaForm(root,race,categories,section) {
  const kind=section==='tv'?'broadcasts':'videos';
  const rows=await cxAllRows(ctx.supabase,`cx_${kind}`,'*',{raceId:race.id});rows.sort((a,b)=>a.sortOrder-b.sortOrder);
  if(!root.isConnected)return;
  root.innerHTML=`<form class="cx-form"><p data-media-empty>No hay ${section==='tv'?'emisiones guardadas':'vídeos guardados'}.</p><div data-media></div><button class="btn btn--ghost" data-add type="button">+ Añadir ${section==='tv'?'emisión':'vídeo'}</button>${actions()}</form>`;
  const form=root.querySelector('form');boxSection(form,section==='tv'?'Televisión':'Vídeos',[form.querySelector('[data-media-empty]'),form.querySelector('[data-media]'),form.querySelector('[data-add]')]);
  const list=form.querySelector('[data-media]');
  const empty=()=>form.querySelector('[data-media-empty]').hidden=Boolean(list.children.length);
  const add=(row={})=>{
    const item=document.createElement('fieldset');item.dataset.id=row.id||crypto.randomUUID();item.className='cx-media-row';
    const local=cxLocalParts(row.startTimeUtc,race.timezone);item.dataset.utc=row.startTimeUtc||'';item.dataset.local=local?`${local.dateKey}T${local.time}`:'';
    item.innerHTML=`<div class="cx-grid"><label class="field cx-field">Categoría<select name="category">${categoryOptions(categories,row.category||'',true)}</select></label>${input(section==='tv'?'channel':'title',section==='tv'?'Canal':'Título',section==='tv'?row.channel:row.title,'text','required')}${section==='videos'?input('titleEn','Título (EN)',row.titleEn):''}${input('url',section==='tv'?'Enlace':'Vídeo de YouTube',row.url,'url','required')}${section==='tv'?`${select('country','Región',CX_COUNTRY_GROUPS,row.country||'ALL')}${input('localStart','Inicio local',local?`${local.dateKey}T${local.time}`:'','datetime-local')}${input('note','Nota',row.note)}${checkbox('showInRevive','Disponible en Revive',row.showInRevive)}${checkbox('isSporza','Sporza',row.isSporza)}`:''}</div><button type="button" class="btn btn--ghost" data-remove>Quitar</button>`;
    item.querySelector('[data-remove]').onclick=async()=>{if(await confirmDialog({title:'Quitar enlace',message:'El enlace se elimina al guardar.',confirmText:'Quitar'})){item.remove();empty();}};list.append(item);empty();
  };
  rows.forEach(add);form.querySelector('[data-add]').onclick=()=>add();
  onSubmit(form,async()=>{
    const payload=[...list.children].map((item,i)=>{
      const value=get(item);value.id=item.dataset.id;value.sortOrder=i;
      value.url=section==='videos'?cxYouTubeWatchUrl(value.url):cxUrl(value.url,{optional:false});
      if(section==='videos')value.titleEn=emptyNull(value.titleEn);
      if(section==='tv'){const local=value.localStart;value.startTimeUtc=local===item.dataset.local?emptyNull(item.dataset.utc):local?cxLocalToUtc(local.slice(0,10),local.slice(11,16),race.timezone):null;delete value.localStart;}
      return value;
    });
    await cxRpc(ctx.supabase,'cx_save_media',{p_race_id:race.id,p_kind:kind,p_rows:payload});ctx.showToast('Enlaces guardados','success');
  });
}

// Documentación CX: los dos huecos de assets de la carrera, con la misma
// presentación que la sección de carretera.
const CX_DOC_TYPES=[
  {type:'technicalGuide',icon:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>'},
  {type:'map',icon:'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>'},
];
// Clave canónica de asset CX: no usar el nombre del archivo ni marcas
// temporales; la revisión (-2, -3…) evita pisar URLs cacheadas al reemplazar.
function nextCxAssetKey(race,type,ext,currentUrl='') {
  const year=String(race.dateKey||'').slice(0,4);
  if(!race.slug||!year)throw new Error('No se puede construir la ruta canónica de este asset.');
  const base=`cx/${race.slug}/${year}/${type}.${ext}`;
  const name=String(currentUrl).split('/').pop()?.split('?')[0]||'';
  const match=name.match(new RegExp(`^${type}-(\\d+)\\.${ext}$`,'i'));
  return match?base.replace(`.${ext}`,`-${Number(match[1])+1}.${ext}`)
    :name===`${type}.${ext}`?base.replace(`.${ext}`,`-2.${ext}`):base;
}
async function uploadCxDoc(file,input,tipo,race) {
  const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
  if(!allowed.includes(file.type))throw new Error('Formato no permitido. Solo JPG, PNG, WebP o PDF.');
  if(tipo==='technicalGuide'&&file.type!=='application/pdf')throw new Error('El libro de ruta debe ser un PDF.');
  if(tipo==='map'&&!['image/jpeg','image/png'].includes(file.type))throw new Error('El mapa debe ser JPG o PNG. Convierte el PDF a imagen antes de subirlo.');
  const maxBytes=tipo==='technicalGuide'?150*1024*1024:10*1024*1024;
  if(file.size>maxBytes)throw new Error(`El archivo supera los ${tipo==='technicalGuide'?'150':'10'} MB.`);
  const ext=tipo==='map'?(file.type==='image/png'?'png':'jpg'):file.name.split('.').pop().toLowerCase();
  const key=nextCxAssetKey(race,tipo,ext,input.value);
  if(tipo==='technicalGuide')await ctx.r2PutTechnicalGuide(key,file,file.type);
  else await ctx.r2PutObject(key,await file.arrayBuffer(),file.type);
  input.value=`${ctx.r2PublicBase}/${key}`;
  input.dispatchEvent(new Event('input'));
}
async function docsForm(root,race) {
  const paint=async()=>{
    const assets=await cxAllRows(ctx.supabase,'assets','*',{cxRaceId:race.id});
    if(!root.isConnected)return;
    root.innerHTML=`<form class="cx-form"><div class="assets-list">${CX_DOC_TYPES.map(({type,icon})=>{
      const asset=assets.find(a=>a.type===type),label=type==='technicalGuide'?'Libro de ruta':'Mapa';
      return `<div class="asset-row" data-asset-type="${type}"><span class="asset-row__type">${icon} ${label}</span><input type="url" class="asset-url-input" data-type="${type}" value="${esc(asset?.url||'')}" placeholder="https://…"><button type="button" class="inline-upload-btn" data-upload="${type}" title="Subir archivo">↑</button><button type="button" class="asset-row__remove" title="Quitar" aria-label="Quitar">✕</button></div>`;
    }).join('')}</div><span class="cx-error" role="alert"></span></form>`;
    const form=root.querySelector('form');
    boxSection(form,'Documentación',[form.querySelector('.assets-list')]);
    for(const {type} of CX_DOC_TYPES) {
      const input=form.querySelector(`.asset-url-input[data-type=${type}]`),row=input.closest('.asset-row');
      row.querySelector('[data-upload]').addEventListener('click',()=> {
        const fileIn=document.createElement('input');fileIn.type='file';fileIn.accept=type==='map'?'image/jpeg,image/png':'application/pdf';fileIn.style.display='none';
        fileIn.onchange=async()=>{const file=fileIn.files[0];fileIn.remove();if(!file)return;
          const button=row.querySelector('[data-upload]');button.textContent='…';button.disabled=true;
          try{await uploadCxDoc(file,input,type,race);button.textContent='✓';setTimeout(()=>{button.textContent='↑';},2000);}
          catch(error){button.textContent='↑';errorAt(form,error);}
          finally{button.disabled=false;}};
        row.append(fileIn);fileIn.click();
      });
      row.querySelector('.asset-row__remove').onclick=()=>{input.value='';};
    }
    onSubmit(form,async()=>{
      cxAssertMapImageUrl(cxUrl(form.querySelector('.asset-url-input[data-type=map]').value.trim()));
      for(const {type} of CX_DOC_TYPES) {
        const input=form.querySelector(`.asset-url-input[data-type=${type}]`),url=cxUrl(input.value.trim());
        const current=assets.find(a=>a.type===type);
        if(!url) {if(current)await cxQuery(ctx.supabase.from('assets').delete().eq('id',current.id));continue;}
        if(current)await cxQuery(ctx.supabase.from('assets').update({url}).eq('id',current.id));
        else await cxQuery(ctx.supabase.from('assets').insert({id:crypto.randomUUID(),cxRaceId:race.id,type,sourceType:'external',url}));
      }
      ctx.showToast('Documentos guardados','success');await refresh();if(root.isConnected)await paint();
    });
  };
  await paint();
}

async function rowsForm(root,race,categories,section,{category:selectedCategory=null,profileLevel=2,onSaved,onCreateProfile,draft}={}) {
  const startlist=section==='startlist';
  const sectionSave=root.closest('.cx-editor-body')?.closest('.cx-jornada-drawer')?.querySelector('[data-save-section]');
  if(!categories.length){root.innerHTML='<p>Sin categorías.</p>';return;}
  let paintVersion=0;
  root.innerHTML=`<div class="cx-actions"><label class="field cx-field">Categoría<select data-category-choice>${categoryOptions(categories,selectedCategory||categories[0]?.category)}</select></label></div><div data-rows-form></div>`;
  const choice=root.querySelector('[data-category-choice]');if(selectedCategory)choice.disabled=true;
  const paint=async()=>{
    if(sectionSave)sectionSave.disabled=true;
    const version=++paintVersion,category=choice.value,target=root.querySelector('[data-rows-form]');target.innerHTML='<p>Cargando…</p>';
    try{
      const rows=await cxAllRows(ctx.supabase,startlist?'cx_startlist_riders':'cx_results','*',{raceId:race.id,category});rows.sort((a,b)=>a.sortOrder-b.sortOrder);
      if(version!==paintVersion||!target.isConnected)return;
      const cat=categories.find(c=>c.category===category),tournament=tournaments.find(t=>t.id===race.tournamentId),mode=tournament?.pointsScheme?.categories?.[category]?.mode;
      target.innerHTML=`<form class="cx-form"><div class="cx-grid">${input('sourceUrl','Fuente oficial',startlist?'':cat?.resultsSourceUrl,'url','required')}${!startlist?`${select('status','Publicación',[['provisional','Provisional'],['official','Oficial'],['pending','Pendiente']],cat?.resultsStatus==='pending'?'provisional':cat?.resultsStatus)}${input('bonusSourceUrl','Fuente oficial de bonos en segundos',cat?.bonusSourceUrl,'url')}${input('adjustmentSourceUrl','Fuente de ajustes en puntos',cat?.resultsEvidence?.adjustmentSourceUrl,'url')}${input('adjustmentReason','Motivo del ajuste en puntos',cat?.resultsEvidence?.adjustmentReason)}${select('rankScope','Puestos de la categoría',[['','Sin comprobación específica'],['officialCategory','Puestos oficiales de esta categoría']],cat?.resultsEvidence?.rankScope||'')}${input('categoryClassificationSourceUrl','Clasificación oficial específica de categoría',cat?.resultsEvidence?.categoryClassificationSourceUrl,'url')}${checkbox('lockAutomatic','Proteger frente al volcado automático',cat?.resultsLockedAt?true:!rows.length)}`:''}</div>${!startlist?`<label class="btn btn--ghost">Extraer texto de PDF<input type="file" data-pdf accept="application/pdf" hidden></label>${textarea('source','Tabla de resultados','','rows="7"')}<button class="btn btn--ghost" data-parse type="button">Preparar resultados</button>`:''}<button class="btn btn--ghost" data-add-row type="button">Añadir corredor</button><div class="cx-table-wrap" data-editable></div>${actions(startlist?'Preparar importación':'Guardar resultados')}<div data-prepared></div></form>`;
      const form=target.querySelector('form');boxSection(form,startlist?'Inscritos':'Clasificación',[form.querySelector('.cx-grid')]);
      if(!startlist){
        const advanced=document.createElement('details');advanced.className='editor-section editor-section--advanced';advanced.innerHTML='<summary class="editor-section__header"><span class="editor-section__title">Bonos y evidencia</span></summary><div class="editor-section__body"></div>';
        const keys=['bonusSourceUrl','adjustmentSourceUrl','adjustmentReason','rankScope','categoryClassificationSourceUrl'];
        for(const key of keys){const field=form.querySelector(`[name=${key}]`)?.closest('label');if(!field)continue;if(mode==='points'&&key==='bonusSourceUrl'||mode==='time'&&['adjustmentSourceUrl','adjustmentReason'].includes(key))field.remove();else advanced.querySelector('.editor-section__body').append(field);}
        form.querySelector('.editor-section').after(advanced);
        const extras=document.createElement('label');extras.className='cx-check';extras.innerHTML='<input type="checkbox" data-result-extras> Detalle de país, segundos y bonos';form.querySelector('[data-editable]').before(extras);
        extras.querySelector('input').onchange=event=>form.querySelectorAll('[data-extra-field]').forEach(cell=>cell.hidden=!event.target.checked);
      }
      let edited=(draft?.rows||rows).map(row=>({...row}));if(draft?.fields)for(const [key,value] of Object.entries(draft.fields)){const field=form.elements[key];if(field)field.type==='checkbox'?field.checked=value:field.value=value??'';}
      const riders=await cxAllRows(ctx.supabase,`cx_riders_${cxGender(category)}`);
      if(version!==paintVersion||!form.isConnected)return;
      const startlistRows=startlist?[]:await cxAllRows(ctx.supabase,'cx_startlist_riders','*',{raceId:race.id,category});
      if(version!==paintVersion||!form.isConnected)return;
      const fields=startlist?[['bib','Dorsal'],['firstName','Nombre'],['lastName','Apellido'],['countryCode','País'],['globalRiderId','Ficha CX'],['teamId','Equipo CX']]:[['rank','Puesto'],['bib','Dorsal'],['riderDisplay','Corredor'],['teamName','Equipo'],['isoCode2','País'],['timeText','Tiempo'],['gapText','Diferencia'],['timeSeconds','Segundos de meta'],['bonusSeconds','Bono (s)'],['bonusPoints','Ajuste (pt)'],['irm','Estado'],['globalRiderId','Ficha CX']].filter(([key])=>mode==='time'?key!=='bonusPoints':mode==='points'?key!=='bonusSeconds':true);
      function draw() {
        const wrap=form.querySelector('[data-editable]');
        wrap.innerHTML=`${edited.length?'':`<p>${startlist?'No hay inscritos en esta categoría.':'No hay resultados en esta categoría.'}</p>`}${edited.length?`<table class="ru-edit-table"><thead><tr>${fields.map(([key,label])=>`<th ${!startlist&&['isoCode2','timeSeconds','bonusSeconds','bonusPoints'].includes(key)?'data-extra-field hidden':''}>${label}</th>`).join('')}<th></th></tr></thead><tbody>${edited.map((row,i)=>`<tr class="ru-row" data-index="${i}">${fields.map(([key,label])=>`<td ${!startlist&&['isoCode2','timeSeconds','bonusSeconds','bonusPoints'].includes(key)?'data-extra-field hidden':''}>${key==='globalRiderId'?`<select data-key="${key}" aria-label="${label}">${option('','Sin ficha',row[key]||'')}${riders.map(r=>option(r.id,`${r.lastName} ${r.firstName} · ${r.nationality||'—'}`,row[key])).join('')}</select>`:key==='teamId'?`<select data-key="${key}" aria-label="${label}">${option('','Sin equipo',row[key]||'')}${teams.map(t=>option(t.id,`${t.uciCode} · ${t.name}`,row[key])).join('')}</select>`:`<input class="ru-in" data-key="${key}" aria-label="${label}" value="${esc(row[key])}" ${['rank','timeSeconds','bonusSeconds','bonusPoints'].includes(key)?'inputmode="numeric"':''}>`}</td>`).join('')}<td><button type="button" class="btn btn--ghost" data-remove-row>Quitar</button>${!row.globalRiderId&&(profileLevel===2||onCreateProfile)?'<button type="button" class="btn btn--ghost" data-create-profile>Crear ficha CX</button>':''}</td></tr>`).join('')}</tbody></table>`:''}`;
        wrap.querySelectorAll('[data-remove-row]').forEach(button=>button.onclick=()=>{readRows();edited.splice(Number(button.closest('tr').dataset.index),1);draw();});
        wrap.querySelectorAll('[data-create-profile]').forEach(button=>button.onclick=()=>{readRows();const index=Number(button.closest('tr').dataset.index),row=edited[index];if(onCreateProfile){onCreateProfile({rows:edited,fields:dataOf(form),index,category});return;}editRider({gender:cxGender(category),firstName:row.firstName||'',lastName:row.lastName||'',nationality:row.countryCode||row.isoCode2||null,source:form.elements.sourceUrl.value||'manual',verified:false},{level:2,onSaved:profile=>{riders.push(profile);row.globalRiderId=profile.id;if(startlist)row.teamId=profile.currentTeamId;draw();}});});
        form.querySelector('[data-add-row]').onclick=()=>{readRows();edited.push({});draw();};
        if(form.querySelector('[data-result-extras]')?.checked)wrap.querySelectorAll('[data-extra-field]').forEach(cell=>cell.hidden=false);
      }
      function readRows(){for(const tr of form.querySelectorAll('tr[data-index]')){const row=edited[Number(tr.dataset.index)];for(const cell of tr.querySelectorAll('[data-key]'))row[cell.dataset.key]=cell.value||null;}}
      draw();
      const parseButton=form.querySelector('[data-parse]');if(parseButton)parseButton.onclick=()=>{try{edited=resolveCxPanelResultRows(parseCxRows(form.elements.source.value,'results'),riders,startlistRows);draw();}catch(error){errorAt(form,error);}};
      let pdfState;
      const pdfInput=form.querySelector('[data-pdf]');
      if(pdfInput) {
        const status=document.createElement('span');status.setAttribute('role','status');pdfInput.closest('label').after(status);
        let buttons=[];
        pdfState=new PdfTextImportState({isCurrent:()=>version===paintVersion&&form.isConnected,onState:pending=>{
          status.textContent=pending?'Extrayendo texto…':'';
          if(pending) {
            if(!buttons.length)buttons=[parseButton,form.querySelector('[type=submit]'),sectionSave].filter(Boolean).map(node=>({node,disabled:node.disabled}));
            for(const {node} of buttons)node.disabled=true;
          } else {
            for(const {node,disabled} of buttons)node.disabled=disabled;
            buttons=[];
          }
        }});
        form.elements.source.addEventListener('input',()=>pdfState.invalidate());
        pdfInput.onchange=()=>{
          const file=pdfInput.files[0];if(!file)return;
          pdfInput.value='';form.querySelector('.cx-error').textContent='';
          void pdfState.read(file,extractPdfText,text=>{form.elements.source.value=text;ctx.showToast('Texto extraído','success');},error=>errorAt(form,error));
        };
      }
      onSubmit(form,async()=>{
        if(pdfState?.pending)throw new Error('Esperar a que termine la extracción del PDF.');
        readRows();const evidence=get(form);delete evidence.source;
        if(!edited.length && (startlist || evidence.status!=='pending'))throw new Error('Una tabla vacía solo permite borrar resultados y marcar la categoría como pendiente.');
        if(!edited.length && !await confirmDialog({title:'Borrar resultados',message:`Se borran los resultados de ${category} y su publicación pasa a pendiente.`,confirmText:'Borrar resultados'}))return;
        let normalized=edited.length?parseCxRows(JSON.stringify(edited),startlist?'startlist':'results'):[];if(!startlist)normalized=resolveCxPanelResultRows(normalized,riders,startlistRows);evidence.sourceUrl=cxUrl(evidence.sourceUrl,{optional:false});
        if(startlist){
          const prepared=await cxRpc(ctx.supabase,'cx_prepare_startlist_import',{p_race_id:race.id,p_category:category,p_document:{sourceUrl:evidence.sourceUrl,rows:normalized}});
          const result=form.querySelector('[data-prepared]');result.innerHTML=`<p>${prepared.rows.length} inscritos; ${prepared.matched} fichas enlazadas; ${prepared.unmatched} sin ficha.</p><button class="btn btn--primary" type="button" data-apply-list>Aplicar lista preparada</button>`;
          result.querySelector('button').onclick=async event=>{event.target.disabled=true;try{const applied=await cxRpc(ctx.supabase,'cx_apply_startlist_import',{p_import_id:prepared.importId});result.innerHTML=`<p>Aplicados ${applied.rows} inscritos.</p>`;await refresh();}catch(error){errorAt(form,error);event.target.disabled=false;}};
        }else{
          const status=evidence.status;delete evidence.status;for(const key of ['bonusSourceUrl','adjustmentSourceUrl','categoryClassificationSourceUrl'])evidence[key]=cxUrl(evidence[key]);
          if(evidence.rankScope==='officialCategory'&&!evidence.categoryClassificationSourceUrl)throw new Error('Indicar la clasificación oficial específica que permite comprobar los puestos de la categoría.');
          evidence.inputSource='manual';
          const saved=await cxRpc(ctx.supabase,'cx_replace_results',{p_race_id:race.id,p_category:category,p_rows:normalized,p_status:status,p_evidence:evidence});cat.resultsStatus=status;cat.resultsSourceUrl=evidence.sourceUrl;cat.bonusSourceUrl=evidence.bonusSourceUrl;cat.resultsEvidence={rankScope:evidence.rankScope,categoryClassificationSourceUrl:evidence.categoryClassificationSourceUrl,adjustmentSourceUrl:evidence.adjustmentSourceUrl,adjustmentReason:evidence.adjustmentReason};cat.resultsLockedAt=saved.lockedAt;ctx.showToast('Resultados guardados','success');await refresh();if(onSaved)await onSaved();
        }
      });
      if(sectionSave){form.querySelector('[type=submit]').hidden=true;sectionSave.disabled=false;}
    }catch(error){if(version!==paintVersion||!target.isConnected)return;target.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button class="btn btn--ghost" data-retry-rows type="button">Reintentar</button>`;target.querySelector('button').onclick=()=>void paint();}
  };
  choice.onchange=()=>void paint();await paint();
}

async function editTournament(existing=null) {
  const row=existing||{seasonKey,pointsScheme:{version:1,status:'draft',categories:{}}};
  const saveId=row.id||crypto.randomUUID();
  const handle=ctx.openDrawer({title:row.name||'Crear trofeo CX',render:body=>{
    body.innerHTML=`<form class="cx-form"><div class="cx-grid">${input('name','Nombre',row.name,'text','required')}${input('nameEn','Nombre en inglés',row.nameEn)}${input('slug','Ruta',row.slug,'text','required pattern="[a-z0-9-]+"')}${input('seasonKey','Temporada',row.seasonKey,'text','required pattern="[0-9]{4}-[0-9]{2}"')}${input('colorHex','Color',row.colorHex,'text','pattern="#[0-9A-Fa-f]{6}"')}${logoField(row.logoUrl)}</div>${actions()}${row.id?'<button class="btn btn--danger" data-delete-tournament type="button">Eliminar torneo</button>':''}<div data-standings></div></form>`;
  }});
  const form=handle.body.querySelector('form');wireLogoField(form);
  if(!row.id)form.elements.name.oninput=()=>form.elements.slug.value=`${cxSlug(form.elements.name.value)}-${form.elements.seasonKey.value}`;
  onSubmit(form,async()=>{const payload=get(form);delete payload.officialStandings;payload.id=saveId;payload.logoUrl=cxUrl(payload.logoUrl);await cxRpc(ctx.supabase,'cx_save_tournament',{p_tournament:payload});ctx.showToast('Torneo guardado','success');handle.close();await refresh();});
  form.querySelector('[data-delete-tournament]')?.addEventListener('click',async()=>{try{if(await confirmDialog({title:'Eliminar trofeo',message:'Solo se puede eliminar un torneo sin carreras asociadas.',confirmText:'Eliminar'})){await cxQuery(ctx.supabase.from('cx_tournaments').delete().eq('id',row.id));handle.close();await refresh();}}catch(error){errorAt(form,error);}});
  if(row.id)await standingsView(form.querySelector('[data-standings]'),row);
}
async function standingsView(root,tournament) {
  const categories=CX_CATEGORIES.filter(c=>tournament.pointsScheme?.categories?.[c]);
  root.innerHTML=panelSectionHtml('General','');
  const body=root.querySelector('.editor-section__body');
  if(!categories.length){body.innerHTML='<p>Sin reglamento asignado.</p>';return;}
  // Los campos del ajuste no llevan `name`: no forman parte del guardado del torneo.
  body.innerHTML=`<label class="field cx-field">Categoría<select data-standing-category>${options(categories,categories[0])}</select></label><p data-standing-state role="status"></p><div data-standing-list></div><div class="cx-grid" data-standing-adjust hidden><label class="field cx-field">Clasificación oficial<input type="url" data-standing-source placeholder="https://"></label><label class="field cx-field">Motivo del ajuste<input type="text" data-standing-reason></label></div><div class="cx-actions" data-standing-actions hidden><button class="btn btn--ghost" type="button" data-standing-sort>Ordenar por total</button><button class="btn btn--primary" type="button" data-standing-publish>Publicar ajuste manual</button><button class="btn btn--ghost" type="button" data-standing-restore hidden>Volver al cálculo automático</button><span class="cx-error" role="alert"></span></div>${textarea('officialStandings','General oficial para cotejar','','rows="6"')}<button class="btn btn--ghost" type="button" data-compare disabled>Comparar</button><div data-discrepancies role="status"></div>`;
  let stored=[],state=null,paintVersion=0;
  const q=selector=>root.querySelector(selector);
  const choice=q('[data-standing-category]'),target=q('[data-standing-list]'),compare=q('[data-compare]'),discrepancies=q('[data-discrepancies]');
  const stateLine=q('[data-standing-state]'),adjust=q('[data-standing-adjust]'),adjustActions=q('[data-standing-actions]'),restore=q('[data-standing-restore]'),adjustError=adjustActions.querySelector('.cx-error');
  const modeOf=()=>tournament.pointsScheme.categories[choice.value]?.mode;
  const STATES={ready:'Calculada automáticamente',manual:'Ajustada a mano: el cálculo automático no la sustituye',empty:'Sin rondas oficiales',needs_review:'Cálculo en revisión',pending:'Cálculo pendiente'};
  // Tabla editable: puesto y total por fila; «Quitar» la excluye del ajuste.
  const editable=(rows,mode)=>`<div class="cx-table-wrap"><table><thead><tr><th>Puesto</th><th>Corredor</th><th>Equipo</th><th>${mode==='time'?'Tiempo acumulado':'Puntos'}</th><th>Quitar</th></tr></thead><tbody>${rows.map((r,index)=>`<tr data-standing-row="${index}"><td><input class="ru-in" data-key="rank" inputmode="numeric" value="${esc(r.rank)}"></td><td>${esc(r.riderDisplay)}</td><td>${esc(r.teamName)}</td><td><input class="ru-in" data-key="total" value="${esc(mode==='time'?cxDuration(r.timeSeconds):r.points??'')}"></td><td><input type="checkbox" data-key="remove"></td></tr>`).join('')}</tbody></table></div>`;
  const editedRows=()=>[...target.querySelectorAll('[data-standing-row]')].flatMap(tr=>{
    if(tr.querySelector('[data-key=remove]').checked)return [];
    const row=stored[Number(tr.dataset.standingRow)];
    return [{...row,rank:tr.querySelector('[data-key=rank]').value.trim(),value:tr.querySelector('[data-key=total]').value.trim()}];
  });
  const paint=async()=>{
    const version=++paintVersion,category=choice.value,mode=modeOf();
    compare.disabled=true;stored=[];state=null;discrepancies.textContent='';adjustError.textContent='';stateLine.textContent='';target.innerHTML='<p>Cargando general…</p>';
    adjust.hidden=adjustActions.hidden=true;
    if(!['points','time'].includes(mode)){target.textContent='Categoría sin modalidad verificada.';return;}
    try{
      const filters={tournamentId:tournament.id,category};
      const [rows,states]=await Promise.all([cxAllRows(ctx.supabase,'cx_tournament_standings','*',filters),cxAllRows(ctx.supabase,'cx_standings_state','*',filters,'category')]);
      if(version!==paintVersion||!root.isConnected)return;
      stored=rows.sort((a,b)=>a.rank-b.rank);state=states[0]||null;
      stateLine.textContent=state?`Estado: ${STATES[state.status]||state.status}.`:'';
      target.innerHTML=stored.length?editable(stored,mode):'<p>No hay general publicada para esta categoría.</p>';
      adjust.hidden=adjustActions.hidden=!stored.length&&state?.status!=='manual';
      restore.hidden=state?.status!=='manual';
      q('[data-standing-sort]').hidden=q('[data-standing-publish]').hidden=!stored.length;
      q('[data-standing-source]').value=state?.status==='manual'?state.sourceUrl||'':'';
      compare.disabled=!stored.length;
    }catch(error){if(version!==paintVersion||!root.isConnected)return;target.innerHTML=`<p class="cx-error" role="alert">${esc(error.message)}</p><button class="btn btn--ghost" type="button">Reintentar</button>`;target.querySelector('button').onclick=()=>void paint();}
  };
  const run=async(button,action)=>{
    adjustError.textContent='';button.disabled=true;
    try{await action();await paint();}catch(error){adjustError.textContent=cxSaveErrorMessage(error);}finally{button.disabled=false;}
  };
  q('[data-standing-sort]').onclick=()=>{try{
    adjustError.textContent='';
    const sorted=cxManualStandingsRows(editedRows(),modeOf(),{sortByTotal:true}),byId=new Map(sorted.map(row=>[row.globalRiderId,row.rank]));
    for(const tr of target.querySelectorAll('[data-standing-row]')){const rank=byId.get(stored[Number(tr.dataset.standingRow)].globalRiderId);if(rank)tr.querySelector('[data-key=rank]').value=rank;}
    const body=target.querySelector('tbody');[...body.children].sort((a,b)=>Number(a.querySelector('[data-key=rank]').value||Infinity)-Number(b.querySelector('[data-key=rank]').value||Infinity)).forEach(tr=>body.append(tr));
  }catch(error){adjustError.textContent=error.message;}};
  q('[data-standing-publish]').onclick=event=>void run(event.currentTarget,async()=>{
    const category=choice.value,sourceUrl=cxUrl(q('[data-standing-source]').value,{optional:false}),reason=q('[data-standing-reason]').value.trim();
    if(!reason)throw new Error('Indicar el motivo del ajuste.');
    const calculation=cxManualStandingsCalculation(category,modeOf(),editedRows(),state);
    if(!await confirmDialog({title:'Publicar ajuste manual',message:'La general quedará fijada a mano y el cálculo automático no la sustituirá hasta volver a él.',confirmText:'Publicar'}))return;
    const snapshot=await cxRpc(ctx.supabase,'cx_standings_snapshot',{p_tournament_id:tournament.id,p_category:category});
    await cxRpc(ctx.supabase,'cx_publish_standings',{p_tournament_id:tournament.id,p_category:category,p_expected_digest:snapshot.digest,p_calculation:calculation,
      p_replace_manual:state?.status==='manual'||stored.some(row=>row.source!=='computed'),p_source:'manual',p_evidence:{sourceUrl,reason}});
    ctx.showToast('General ajustada','success');
  });
  restore.onclick=event=>void run(event.currentTarget,async()=>{
    if(!await confirmDialog({title:'Volver al cálculo automático',message:'Se sustituye el ajuste manual por el cálculo con los resultados publicados.',confirmText:'Recalcular'}))return;
    const {data,error}=await ctx.supabase.functions.invoke('cx-recompute-standings',{body:{tournamentId:tournament.id,category:choice.value,replaceManual:true}});
    if(error)throw error;if(data?.error)throw new Error(data.error);
    ctx.showToast(data?.calculation?.status==='ready'?'General recalculada':'Cálculo sin general publicable: queda en revisión','success');
  });
  choice.onchange=()=>void paint();await paint();
  compare.onclick=()=>{try{
    const official=parseCxRows(root.querySelector('[name=officialStandings]').value);
    const problems=compareCxStandings(official,stored,modeOf());
    discrepancies.textContent=problems.length?problems.join('\n'):'Sin diferencias en las filas cotejadas.';
  }catch(error){discrepancies.textContent=error.message;}};
}

const CX_TEAM_DEFAULTS={headerBg:'#1f2937',headerText:'#ffffff',badgeTorsoCenter:'#ffffff',badgeTorsoSides:'#000000',badgeShorts:'#000000'};
const cxColorField=(key,label,value)=>`<div class="field cx-field"><label>${esc(label)}</label><div class="color-preview"><input class="u-color-dot" type="color" data-cx-color="${key}"><input class="u-grow" type="text" data-cx-color-text="${key}" value="${esc(value)}"></div></div>`;

function editTeam(existing=null) {
  const row=existing||{gender:'mixed',...CX_TEAM_DEFAULTS};
  const saveId=row.id||crypto.randomUUID();
  const handle=ctx.openDrawer({title:row.name||'Crear equipo CX',render:body=>body.innerHTML=`<form class="cx-form"><div class="cx-grid">${input('name','Nombre',row.name,'text','required')}${input('uciCode','Código UCI (3 caracteres)',row.uciCode,'text','required pattern="[A-Z0-9]{3}" maxlength="3"')}${select('category','Categoría',[['UCI','Equipo UCI'],['CLUB','Club']],row.category||'UCI')}${select('gender','Género',['male','female','mixed'],row.gender)}${input('countryCode','País ISO2',row.countryCode,'text','pattern="[A-Z]{2}" maxlength="2"')}${input('nameAliases','Alias separados por punto y coma',(row.nameAliases||[]).join('; '))}</div><div class="cx-colors">${cxColorField('headerBg','Fondo de pestaña / barra de título',row.headerBg||CX_TEAM_DEFAULTS.headerBg)}<div class="cx-colors-row">${cxColorField('torsoSides','Cuadrado cromático 1',row.badgeTorsoSides||CX_TEAM_DEFAULTS.badgeTorsoSides)}${cxColorField('torsoCenter','Cuadrado cromático 2',row.badgeTorsoCenter||CX_TEAM_DEFAULTS.badgeTorsoCenter)}${cxColorField('shorts','Cuadrado cromático 3',row.badgeShorts||CX_TEAM_DEFAULTS.badgeShorts)}</div></div><div class="cx-team-preview"><span class="team-color-squares team-color-squares--small" data-badge aria-label="Tres colores cromáticos"><i></i><i></i><i></i></span><span data-header>Cabecera</span></div>${actions()}${row.id?'<button class="btn btn--danger" type="button" data-delete>Eliminar equipo</button>':''}</form>`});
  const form=handle.body.querySelector('form');boxSection(form,'Identidad',[form.querySelector('.cx-grid'),form.querySelector('.cx-colors'),form.querySelector('.cx-team-preview')]);
  const colorValue=key=>{const text=(form.querySelector(`[data-cx-color-text="${key}"]`).value||'').trim();return /^#[0-9a-fA-F]{6}$/.test(text)?text.toLowerCase():form.querySelector(`[data-cx-color="${key}"]`).value.toLowerCase();};
  const setColor=(key,value)=>{const hex=(value||'').toLowerCase(),safe=/^#[0-9a-f]{6}$/.test(hex)?hex:'#000000';form.querySelector(`[data-cx-color="${key}"]`).value=safe;form.querySelector(`[data-cx-color-text="${key}"]`).value=safe.toUpperCase();};
  const paint=()=>{
    const badge=form.querySelector('[data-badge]'),header=form.querySelector('[data-header]');
    ['torsoSides','torsoCenter','shorts'].forEach((key,index)=>{badge.children[index].style.background=colorValue(key);});
    const headerBg=colorValue('headerBg');header.style.background=headerBg;header.style.color=automaticTeamHeaderText(headerBg);header.textContent=form.elements.name.value||'Cabecera';
  };
  setColor('headerBg',row.headerBg||CX_TEAM_DEFAULTS.headerBg);setColor('torsoSides',row.badgeTorsoSides||CX_TEAM_DEFAULTS.badgeTorsoSides);setColor('torsoCenter',row.badgeTorsoCenter||CX_TEAM_DEFAULTS.badgeTorsoCenter);setColor('shorts',row.badgeShorts||CX_TEAM_DEFAULTS.badgeShorts);
  ['headerBg','torsoCenter','torsoSides','shorts'].forEach(key=>{
    const dot=form.querySelector(`[data-cx-color="${key}"]`),text=form.querySelector(`[data-cx-color-text="${key}"]`);
    dot.addEventListener('input',()=>{text.value=dot.value.toUpperCase();paint();});
    text.addEventListener('input',()=>{const value=text.value.trim();if(/^#[0-9a-fA-F]{6}$/.test(value)){dot.value=value.toLowerCase();paint();}});
  });
  form.elements.name.addEventListener('input',paint);paint();
  onSubmit(form,async()=>{const payload=get(form);const headerBg=colorValue('headerBg');payload.id=saveId;payload.headerBg=headerBg;payload.headerText=automaticTeamHeaderText(headerBg);payload.badgeTorsoCenter=colorValue('torsoCenter');payload.badgeTorsoSides=colorValue('torsoSides');payload.badgeShorts=colorValue('shorts');payload.badgeInnerCircle=null;payload.colorHex=payload.badgeTorsoCenter;payload.nameAliases=(payload.nameAliases||'').split(';').map(v=>v.trim()).filter(Boolean);await cxQuery(ctx.supabase.from('cx_teams').upsert(payload));ctx.showToast('Equipo guardado','success');handle.close();await refresh();});
  form.querySelector('[data-delete]')?.addEventListener('click',async()=>{try{if(await confirmDialog({title:'Eliminar equipo',message:'Los corredores e inscritos asociados quedan sin equipo.',confirmText:'Eliminar'})){await cxQuery(ctx.supabase.from('cx_teams').delete().eq('id',row.id));handle.close();await refresh();}}catch(error){errorAt(form,error);}});
}
function editRider(existing=null,{level=1,onSaved,onCancel}={}) {
  const row=existing||{gender:'men',verified:true,source:'manual'};
  let saved=false;const handle=ctx.openDrawer({level,title:row.id||'Crear ficha de corredor CX',onClose:()=>{if(!saved&&onCancel)queueMicrotask(onCancel);},render:body=>body.innerHTML=`<form class="cx-form"><div class="cx-grid">${select('gender','Género',[['men','Hombres'],['women','Mujeres']],row.gender)}${input('id','Identificador / slug',row.id,'text','required pattern="[a-z0-9-]+" '+(row.id?'readonly':''))}${input('firstName','Nombre',row.firstName,'text','required')}${input('lastName','Apellido',row.lastName,'text','required')}${input('otherNames','Otros nombres',row.otherNames)}${input('nationality','Nacionalidad ISO2',row.nationality,'text','pattern="[A-Z]{2}" maxlength="2"')}${input('birthDate','Fecha de nacimiento',row.birthDate,'date')}${select('birthDatePrecision','Precisión del nacimiento',[['day','Fecha completa'],['year','Solo año (1 de enero)']],row.birthDatePrecision||'day')}${select('currentTeamId','Equipo',[['','Sin equipo'],...teams.map(t=>[t.id,`${t.uciCode} · ${t.name}`])],row.currentTeamId||'')}${input('uciProfileId','Perfil UCI',row.uciProfileId)}${input('uciLicenseId','Licencia UCI (11 dígitos)',row.uciLicenseId,'text','pattern="[0-9]{11}" maxlength="11"')}${input('source','Fuente verificada',row.source,'text','required')}${checkbox('verified','Datos verificados',row.verified)}</div>${actions()}${row.id?'<button class="btn btn--danger" data-delete type="button">Eliminar ficha</button>':''}</form>`});
  const form=handle.body.querySelector('form');boxSection(form,'Identidad',[form.querySelector('.cx-grid')]);
  if(row.id){form.elements.gender.disabled=true;const slugInput=form.elements.id,slugEdit=document.createElement('button');slugEdit.type='button';slugEdit.className='btn btn--ghost';slugEdit.textContent='Editar slug';slugEdit.onclick=()=>{slugInput.readOnly=false;slugEdit.remove();slugInput.focus();};slugInput.closest('label').append(slugEdit);}
  else{const slug=()=>form.elements.id.value=cxSlug(`${form.elements.firstName.value} ${form.elements.lastName.value}`);form.elements.firstName.oninput=slug;form.elements.lastName.oninput=slug;if(row.firstName||row.lastName)slug();}
  if(level===2)form.elements.gender.disabled=true;
  onSubmit(form,async()=>{const payload=get(form),gender=payload.gender||row.gender;delete payload.gender;if(payload.birthDatePrecision==='year'&&payload.birthDate)payload.birthDate=`${payload.birthDate.slice(0,4)}-01-01`;payload.updatedAt=new Date().toISOString();const newId=payload.id||row.id;if(row.id&&newId!==row.id&&!isValidRiderSlug(newId))throw new Error('Slug inválido: solo minúsculas, dígitos y guiones (^[a-z0-9-]+$).');delete payload.id;if(row.id&&newId!==row.id){await cxRpc(ctx.supabase,'cx_rename_rider',{p_gender:gender==='women'?'female':'male',p_old_id:row.id,p_new_id:newId});await cxQuery(ctx.supabase.from(`cx_riders_${gender}`).update(payload).eq('id',newId));}else if(row.id)await cxQuery(ctx.supabase.from(`cx_riders_${gender}`).update(payload).eq('id',row.id));else await cxQuery(ctx.supabase.from(`cx_riders_${gender}`).insert({...payload,id:newId}));ctx.showToast('Ficha guardada','success');saved=true;handle.close();if(onSaved)await onSaved({...payload,id:newId,gender});else await refresh();});
  form.querySelector('[data-delete]')?.addEventListener('click',async()=>{try{if(await confirmDialog({title:'Eliminar ficha',message:'Los inscritos, resultados y generales conservan el nombre publicado y quedan sin enlace a esta ficha.',confirmText:'Eliminar'})){await cxRpc(ctx.supabase,'cx_delete_rider',{p_id:row.id,p_gender:row.gender});handle.close();await refresh();}}catch(error){errorAt(form,error);}});
}
