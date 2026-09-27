import { cxDateInSeason } from '../../js/cx-season.js';
import { cxCategoryTiming } from '../../js/cx-timing.js';

const CATEGORIES=new Set(['ME','WE','MU','WU','MJ','WJ']);
const MADRID_DATE=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});

function madridDate(value) {
  const parts=Object.fromEntries(MADRID_DATE.formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function nextCivilDate(date) {
  const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+1);return value.toISOString().slice(0,10);
}
function intervalPending(manga,at,interval) {
  const last=manga.resultsLastFetchAt?Date.parse(manga.resultsLastFetchAt):NaN;
  return Number.isFinite(last)&&at-last<interval*60000;
}

/** Solo decide; nunca cambia resultsStatus ni deduce una llegada desde una fecha. */
export function cxSyncDecision(race,manga,link,{now=new Date(),manual=false}={}) {
  const skip=(reason,review=false)=>({due:false,reason,review});
  let validSeason=false;
  try{validSeason=cxDateInSeason(race.seasonKey,race.dateKey)&&cxDateInSeason(race.seasonKey,race.endDateKey||race.dateKey)
    &&cxDateInSeason(race.seasonKey,manga.dateKey||race.dateKey);}catch{}
  if(!validSeason||race.editorialStatus!=='published'||race.isCancelled||manga.isCancelled||!CATEGORIES.has(manga.category)
    ||manga.raceId!==race.id||(manga.dateKey||race.dateKey)<race.dateKey||(manga.dateKey||race.dateKey)>(race.endDateKey||race.dateKey))return skip('Carrera/manga fuera de alcance');
  if(!link||link.raceId!==race.id||link.disciplineId!==3||!Number.isSafeInteger(link.competitionId)||link.competitionId<=0
    ||!Number.isSafeInteger(link.seasonId)||link.seasonId<=0)return skip('Enlace DataRide CX inválido',true);
  if(manga.resultsLockedAt)return skip('Resultados protegidos por revisión administrativa');
  if(manual)return {due:true,reason:'Solicitud administrativa: omite ventana y cadencia'};
  if(!link.syncEnabled)return skip('Recogida automática desactivada');
  const start=link.syncStartOffsetMinutes??-15,stop=link.syncStopOffsetMinutes??720,interval=link.syncIntervalMinutes??5;
  if(!Number.isInteger(start)||start< -1440||start>1440||!Number.isInteger(stop)||stop<0||stop>2880||stop<start
    ||!Number.isInteger(interval)||interval<1||interval>240)return skip('Ventana/cadencia inválida',true);
  const at=new Date(now).getTime();
  if(!Number.isFinite(at))return skip('Fecha de evaluación inválida',true);
  const timing=cxCategoryTiming(race,manga,now);
  if(timing.estimatedEndTimeUtc){
    const end=Date.parse(timing.estimatedEndTimeUtc),windowStart=end+start*60000,windowEnd=end+stop*60000;
    const window={estimatedEndTimeUtc:timing.estimatedEndTimeUtc,windowStart:new Date(windowStart).toISOString(),windowEnd:new Date(windowEnd).toISOString(),temporalState:timing.temporalState};
    if(at<windowStart)return {...skip('Ventana aún no abierta'),...window};
    if(at>windowEnd)return {...skip('Ventana agotada; revisar pendientes',manga.resultsStatus!=='official'),...window};
    if(intervalPending(manga,at,interval))return {...skip('Intervalo de categoría aún no vencido'),...window};
    return {due:true,reason:'Ventana de recogida activa',...window};
  }

  // DataRide crea la competición antes de incorporar cada Race/categoría. Si el
  // programa propio no acredita una duración, se consulta por fecha civil para
  // descubrir las clasificaciones que vayan apareciendo, sin inventar una meta.
  const dateKey=manga.dateKey||race.dateKey,current=madridDate(now),next=nextCivilDate(dateKey);
  const knownStart=Date.parse(manga.startTimeUtc),sourceStart=Number.isFinite(knownStart)?knownStart+start*60000:null;
  const sourceWindow={sourceDriven:true,dateKey,temporalState:timing.temporalState,
    ...(sourceStart===null?{}:{windowStart:new Date(sourceStart).toISOString()})};
  if(current<dateKey)return {...skip('Fecha de la manga aún no alcanzada'),...sourceWindow};
  if(sourceStart!==null&&at<sourceStart)return {...skip('Ventana DataRide por fecha aún no abierta'),...sourceWindow};
  if(current>next)return {...skip('Ventana DataRide por fecha agotada; revisar pendientes',manga.resultsStatus!=='official'),...sourceWindow};
  if(current===next){
    const hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
    if(hour>=12)return {...skip('Ventana DataRide por fecha agotada; revisar pendientes',manga.resultsStatus!=='official'),...sourceWindow};
  }
  if(intervalPending(manga,at,interval))return {...skip('Intervalo de categoría aún no vencido'),...sourceWindow};
  return {due:true,reason:'Ventana DataRide por fecha activa',...sourceWindow};
}
