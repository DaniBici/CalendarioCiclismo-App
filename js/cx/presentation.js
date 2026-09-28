import {timeToSeconds,secondsToGap,formatGap,cleanTimeText,secondsToAbsText} from '../results/time.js?v=20260914cxresults';
import {cxDataRideSeconds,isCxSubhourDataRideTime,isCxExactSubhourDataRideTime} from './time.js?v=20260920cxtime1';
import {irmLabel,isAbandonIrm} from '../results/uci-irm.js';
import {CX_CATEGORIES,CX_CLASSES,cxEscape,cxChipText,cxDuration,cxPoints,cxUrl} from './editor-logic.js?v=20260912cxf6';
import {CX_ACTIVE_MONTHS,cxSeason,cxSeasonMonths,cxDateInSeason} from './season.js?v=20260912cxmonths7';
import {cxCategoryTiming} from './timing.js?v=20260913cxdropschedule';
import {t} from '../i18n.js?v=20260914cxsections2';

export {cxEscape as cxEsc};
export {cxSeason,cxSeasonMonths};
export const cxRaceName = (race,lang='es') => lang==='en'&&race.nameEn?race.nameEn:race.name;
export const cxRaceUrl = (race,lang='es',category='') =>
  `${lang==='en'?'/en/cyclocross/':'/ciclocross/'}${encodeURIComponent(lang==='en'?(race.slugEn||race.slug):race.slug)}/${category?`#${category}`:''}`;
export const cxTournamentUrl = (tournament,lang='es') => `${lang==='en'?'/en/cyclocross/series/':'/ciclocross/torneos/'}${encodeURIComponent(tournament.slug)}/`;
export const cxRacePageUrl=(race,lang='es',page='race',category='')=>`${cxRaceUrl(race,lang)}${page==='startlist'?(lang==='en'?'startlist/':'inscritos/'):page==='results'?(lang==='en'?'results/':'resultados/'):['programme','tv','videos'].includes(page)?`?view=${page}`:''}${category?`#${category}`:''}`;
export function cxRacePageLocation(pathname,search='') {
  const parts=pathname.split('/').filter(Boolean),last=parts.at(-1);
  const suffixPage=['inscritos','startlist'].includes(last)?'startlist':['resultados','results'].includes(last)?'results':null;
  const view=new URLSearchParams(search).get('view');
  return {page:suffixPage||(['programme','tv','videos'].includes(view)?view:'race'),slug:decodeURIComponent(suffixPage?parts.at(-2)||'':last||'')};
}
export const cxCategoryDate = (race,category) => category.dateKey||race.dateKey;
export function cxClassificationSelection(fragment,categories,generalCategories=[]) {
  if(fragment==='general'||fragment.startsWith('general-')) {
    const requested=fragment.slice(8),category=generalCategories.includes(requested)?requested:generalCategories[0];
    if(category)return {section:'general',category,fragment:`general-${category}`};
  }
  if(!categories.length&&generalCategories.length)return {section:'general',category:generalCategories[0],fragment:`general-${generalCategories[0]}`};
  const category=categories.includes(fragment)?fragment:cxPrimaryCategory(categories);
  return {section:'results',category:category||null,fragment:category||''};
}
// Orden UCI de categorías: élite masculina es la clasificación principal;
// cuando no está publicada, se usa la primera disponible en ese mismo orden.
function cxPrimaryCategory(categories=[]) {
  return categories.includes('ME')?'ME':categories[0]||null;
}
export function cxResultCategories(race,results) {
  return cxCategories(race).filter(c=>['official','provisional'].includes(c.resultsStatus)&&results.some(row=>row.category===c.category)).map(c=>c.category);
}
export function cxGeneralCategories(race,standings,results,states=[]) {
  const published=cxResultCategories(race,results);
  return CX_CATEGORIES.filter(code=>{
    if(!standings.some(row=>row.category===code))return false;
    const source=race.cx_tournaments?.pointsScheme?.categories?.[code]?.extras?.derived?.fromCategory||code;
    const hasResults=published.includes(source),state=states.find(row=>row.category===code);
    return state?['ready','manual'].includes(state.status)&&(!hasResults||(state.roundIds||[]).includes(race.id)):!hasResults;
  });
}
export function cxCategoryCardState(race,category,at=new Date()) {
  const timing=cxCategoryTiming(race,category,at);
  return timing.displayState==='cancelled'?'cancelled':['official','provisional'].includes(timing.resultsStatus)?'results':timing.temporalState==='estimated_finished'&&cxAwaitsResults(race)?'awaiting':'time';
}
// La espera de resultados solo se muestra en pruebas con servidor de resultados
// inmediato: Mundiales (CM), Continentales (CC) y Copa del Mundo (CDM), más las
// pruebas de los torneos Copa del Mundo, Superprestige y X2O. El resto de
// carreras nacionales no hacen esperar: sus resultados llegan por la UCI más
// tarde o no se publican.
const CX_AWAIT_RESULTS_CLASSES=new Set(['CM','CC','CDM']);
function cxAwaitsResults(race) {
  if(CX_AWAIT_RESULTS_CLASSES.has(race.class))return true;
  const tournament=race.cx_tournaments;
  if(!tournament)return false;
  const identity=`${tournament.slug||''} ${tournament.name||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return identity.includes('superprestige')||identity.includes('x2o')||identity.includes('worldcup')||identity.includes('copadelmundo');
}
// Card no clicable (placeholder de Hoy en Carretera): cancelada o ficha sin
// la carga mínima completa (Libro de Ruta o Mapa, y algún horario).
export function cxRacePlaceholder(race) {
  return !!race.isCancelled||!cxRaceOpen(race);
}
// Mensaje del aviso (tooltip escritorio y modal móvil), igual que Hoy.
export function cxPlaceholderMessage(race) {
  if(race.isCancelled)return t('race.cancelled');
  return race.dateKey>new Date().toISOString().slice(0,10)?t('cx.phFuture'):t('cx.phNoInfo');
}
// Una prueba sin ningún horario asociado (todas sus categorías del día en
// estado «time» y sin `startTimeUtc`) presenta sus indicadores como badges en
// vez de cuadros. En cuanto alguna categoría tiene hora, resultados o
// cancelación se conservan los cuadros.
export function cxUsesCategoryBadges(race,dateKey=null,at=new Date()) {
  const categories=cxCategories(race,dateKey);
  return categories.length>0&&categories.every(c=>!c.startTimeUtc&&cxCategoryCardState(race,c,at)==='time');
}
const CX_TOURNAMENT_COLORS = Object.freeze({worldCup:'#8B173D',superprestige:'#FFC600',x2o:'#00A8C7',copaEspana:'#D71920',exactCross:'#E6342A',coupeFrance:'#0055A4',swissCup:'#D52B1E',czechCup:'#E87524',nationalTrophy:'#6B3FA0',uscx:'#233C78',giroRegioni:'#E94B8A',tacaPortugal:'#008657'});
export function cxTournamentColor(tournament) {
  if(!tournament)return null;
  if(/^#[0-9a-f]{6}$/i.test(tournament.colorHex||''))return tournament.colorHex;
  const identity=`${tournament.slug||''} ${tournament.name||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const key=identity.includes('superprestige')?'superprestige':identity.includes('x2o')?'x2o':
    identity.includes('worldcup')||identity.includes('copadelmundo')?'worldCup':
    identity.includes('copadeespana')||identity.includes('copaespana')?'copaEspana':
    identity.includes('exactcross')||identity.includes('hgcross')?'exactCross':
    identity.includes('coupedefrance')||identity.includes('copadefrancia')?'coupeFrance':
    identity.includes('swisscyclocrosscup')||identity.includes('swisscxcup')?'swissCup':
    identity.includes('toitoi')||identity.includes('hsfsystem')?'czechCup':
    identity.includes('nationaltrophy')?'nationalTrophy':identity.includes('uscx')?'uscx':
    identity.includes('girodelleregioni')||identity.includes('giroregioni')||identity.includes('giroditalia')?'giroRegioni':
    identity.includes('tacadeportugal')||identity.includes('tacaportugal')?'tacaPortugal':null;
  return CX_TOURNAMENT_COLORS[key]||null;
}
export const cxColor = race => cxTournamentColor(race.cx_tournaments)||(/^#[0-9a-f]{6}$/i.test(race.colorHex||'')?race.colorHex:null);
// Una carrera CX se abre desde el calendario con la ficha mínima completa (al
// menos un documento —Libro de Ruta o Mapa— y algún horario) o si alguna de sus
// pruebas ya tiene clasificaciones publicadas.
const CX_DOC_TYPES=['technicalGuide','map'];
const CX_RESULTS_STATUSES=['official','provisional'];
export function cxHasClassifications(race) {
  return (race.cx_race_categories||[]).some(c=>CX_RESULTS_STATUSES.includes(c.resultsStatus));
}
export function cxRaceOpen(race) {
  const hasDocs=(race.assets||[]).some(a=>CX_DOC_TYPES.includes(a.type)&&a.url);
  const hasSchedule=(race.cx_race_categories||[]).some(c=>c.startTimeUtc);
  return hasDocs&&hasSchedule||cxHasClassifications(race);
}
export function cxCategories(race,dateKey=null) {
  return CX_CATEGORIES.map(code=>(race.cx_race_categories||[]).find(c=>c.category===code))
    .filter(c=>c&&CX_ACTIVE_MONTHS.includes(Number(cxCategoryDate(race,c).slice(5,7)))&&(!race.seasonKey||cxDateInSeason(race.seasonKey,cxCategoryDate(race,c)))&&(!dateKey||cxCategoryDate(race,c)===dateKey));
}
function cxAgendaTime(race,dateKey=null) {
  // cxCategories sigue el rango de agenda: ME, WE, MU, WU, MJ y WJ.
  for(const category of cxCategories(race,dateKey)) {
    if(category.isCancelled||!category.startTimeUtc)continue;
    const time=Date.parse(category.startTimeUtc);
    if(Number.isFinite(time))return time;
  }
  return Infinity;
}
function cxCompareRaces(a,b,dateKey=null) {
  const classOrder=r=>{const index=CX_CLASSES.indexOf(r.class);return index<0?CX_CLASSES.length:index;};
  const order=classOrder(a)-classOrder(b);
  return order||cxAgendaTime(a,dateKey)-cxAgendaTime(b,dateKey)||a.name.localeCompare(b.name);
}
// Filtros de la agenda de ciclocross, con la presentación de Hoy en Carretera.
// Todos · Big (Mundial, Copa del Mundo, Continental y los torneos Superprestige,
// X2O y HG Cross) · Pro (todo salvo las nacionales) · España (pruebas en España,
// UCI o no).
const CX_BIG_CLASSES = new Set(['CM', 'CDM', 'CC']);
const CX_BIG_TOURNAMENTS = ['superprestige', 'x2o', 'worldcup', 'copadelmundo', 'exactcross', 'hgcross'];
export function cxAgendaFilterMatches(race, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'spain') return (race.countryCode || '').toLowerCase().startsWith('es');
  if (filter === 'pro') return !['CN', 'NAC'].includes(race.class);
  if (filter === 'big') {
    if (CX_BIG_CLASSES.has(race.class)) return true;
    const tournament = race.cx_tournaments;
    if (!tournament) return false;
    const identity = `${tournament.slug || ''} ${tournament.name || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return CX_BIG_TOURNAMENTS.some(key => identity.includes(key));
  }
  return true;
}
export function cxMonthDays(races,monthKey) {
  if(!CX_ACTIVE_MONTHS.includes(Number(monthKey.slice(5))))return [];
  const days=new Map();
  for(const race of races) {
    const dates=[...new Set(cxCategories(race).map(c=>cxCategoryDate(race,c)))];
    // Las pruebas aún sin programa se muestran en su primera fecha oficial.
    if(!dates.length)dates.push(race.dateKey);
    for(const date of dates.filter(d=>d.startsWith(monthKey))) {
      if(!days.has(date))days.set(date,[]);
      days.get(date).push(race);
    }
  }
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,races])=>({date,races:races.sort((a,b)=>cxCompareRaces(a,b,date))}));
}
export function cxTime(utc,locale='es-ES',timezone=undefined) {
  if(!utc)return null;
  return new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit',timeZone:timezone,hourCycle:'h23'}).format(new Date(utc));
}
export const cxClassLabel = (code,lang='es') => code==='NAC'?(lang==='en'?'Nat':'Nac'):code;
export function cxRoundLabel(round) {
  if(!round||!(round.total>1)||!(round.n>=1)||round.n>round.total)return null;
  return {text:t('cx.round',{n:round.n,total:round.total}),aria:t('cx.roundAria',{n:round.n,total:round.total})};
}
export function cxRoundBadge(round) {
  const label=cxRoundLabel(round);
  return label?`<span class="cx-round-badge"><span aria-hidden="true">${cxEscape(String(label.text))}</span><span class="sr-only">${cxEscape(label.aria)}</span></span>`:'';
}
export function cxStandingTotal(row,mode,locale='es-ES') {
  if(mode==='time')return row.timeSeconds==null?'—':cxDuration(row.timeSeconds);
  if(mode==='points')return cxPoints(row.points,locale);
  return '—';
}
export const cxRankSort=(a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||(a.sortOrder??0)-(b.sortOrder??0);
// Vueltas perdidas (CIC): número de vueltas que separan al corredor del
// ganador; null si la fila no acredita vueltas. La palabra LAP/LAPS en la
// diferencia ("-2 LAPS", "- 4 LAP", "@ 3 LAPS", "2 LAP") acredita por sí sola;
// un entero pelado solo cuenta si la fila está marcada LAP.
export function cxLapsLost(row) {
  if(!row)return null;
  const gapText=String(row.gapText||'').trim();
  if(row.irm!=='LAP'&&!/LAPS?/i.test(gapText))return null;
  for(const candidate of [gapText,row.irm==='LAP'?String(row.timeText||'').trim():'']) {
    const text=candidate.replace(/^['"]+|['"]+$/g,'').replace(/^@\s*/,'').trim();
    const match=/^-\s*(\d+)(?:\s*LAPS?)?$/i.exec(text)||/^(\d+)\s*LAPS?$/i.exec(text);
    if(match)return Number(match[1]);
    if(row.irm==='LAP'&&/^[1-9]\d*$/.test(text))return Number(text);
  }
  return null;
}
// Comparte tiempos, diferencias e IRM con carretera; LAP conserva su puesto.
export function cxResultRank(row,lang='es') {
  if(isAbandonIrm(row.irm))return irmLabel(row.irm,lang);
  return row.rank??(row.irm?irmLabel(row.irm,lang):row.rankText||'–');
}
// timeSeconds ya resuelve el formato con el ganador de la clasificación; el
// texto solo se interpreta cuando falta.
const cxFinishSeconds=row=>{
  const raw=String(row?.timeText??'').trim();
  let seconds;
  if(row?.timeSeconds!=null)seconds=Number(row.timeSeconds);
  else if(isCxSubhourDataRideTime(raw)) {
    const parsed=cxDataRideSeconds(raw);
    seconds=parsed==null?null:Number(parsed);
  } else seconds=timeToSeconds(raw);
  return Number.isFinite(seconds)&&seconds>0?seconds:null;
};
export function cxResultCell(row,winner=null) {
  if(!row)return {text:'',cls:''};
  if(row.irm&&row.irm!=='LAP')return {text:'',cls:''};
  const laps=cxLapsLost(row);
  if(laps!=null)return {text:t(laps===1?'cx.lapOne':'cx.laps',{n:laps}),cls:'res-lap'};
  if(row.irm==='LAP')return {text:t('cx.lapped'),cls:'res-lap'};
  const seconds=cxFinishSeconds(row),winnerSeconds=cxFinishSeconds(winner);
  if(row.rank!==1) {
    let gap=row.gapText;
    if(gap&&winnerSeconds!=null) {
      const gapSeconds=timeToSeconds(String(gap).trim().replace(/^\+/,''));
      if(gapSeconds!=null&&gapSeconds%1!==0)gap=secondsToGap(Math.floor(winnerSeconds+gapSeconds)-Math.floor(winnerSeconds));
    }
    if(!gap&&seconds!=null&&winnerSeconds!=null&&seconds>=winnerSeconds)
      gap=secondsToGap(Math.floor(seconds)-Math.floor(winnerSeconds));
    if(gap)return {text:formatGap(gap),cls:'res-gap'};
  }
  const text=seconds!=null
    ? (isCxExactSubhourDataRideTime(row.timeText)?secondsToAbsText(seconds):row.timeText?cleanTimeText(row.timeText):secondsToAbsText(seconds))
    : cleanTimeText(row.timeText);
  return {text,cls:text&&row.rank===1?'res-time':''};
}
export function cxResultCells(rows,lang='es') {
  const winner=rows.find(row=>row.rank===1&&!row.irm),cells=new Map();
  let head=true,previousGap=null;
  for(const row of [...rows].sort(cxRankSort)) {
    const raw=cxResultCell(row,winner);
    let cell=raw;
    if(row!==winner) {
      const isGap=raw.cls==='res-gap',zero=raw.text==='+0"';
      if(isGap&&((head&&zero)||(!zero&&raw.text===previousGap)))
        cell={text:lang==='en'?'s.t.':'m.t.',cls:'res-gap res-gap--same'};
      if(isGap&&!zero)previousGap=raw.text;
      if(!isGap||!zero)head=false;
    }
    cells.set(row,cell);
  }
  return cells;
}
export function cxCategoryMedia(broadcasts,videos,category,{hasResults=false,cancelled=false,visibleBroadcasts=broadcasts}={}) {
  const applies=row=>!row.category||row.category===category;
  const unique=(rows,key)=>{
    const seen=new Set();return [...rows].sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0)).flatMap(row=>{
      let url;try{url=cxUrl(row.url,{optional:false});}catch{return [];}
      const identity=key(row,url);if(seen.has(identity))return [];seen.add(identity);return [{...row,url}];
    });
  };
  const tv=broadcasts.filter(applies);
  const visible=new Set(visibleBroadcasts);
  const replays=hasResults||cancelled
    ?tv.filter(row=>visible.has(row)&&(row.showInRevive||!cancelled&&row.isSporza))
    :[];
  return {tv:hasResults||cancelled?[]:unique(tv,(row,url)=>`${url}|${row.country||'ALL'}|${row.channel||''}`),
    revive:unique(replays,(_,url)=>url),videos:unique(videos.filter(applies),(_,url)=>url)};
}
