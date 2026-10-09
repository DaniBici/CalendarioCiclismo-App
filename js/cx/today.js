// Vista Hoy de ciclocross: rango navegable, días con carreras y tira de siete
// días, con las reglas de Hoy en Carretera. Espejo de CyclocrossLogic (iOS y
// Android).
import {cxSeasonBounds} from './season.js';
import {cxRaceDates} from './presentation.js';

function cxAddDays(dateKey,days) {
  const date=new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
// Día de la agenda acotado a la temporada (1 de agosto – fin de febrero).
export function cxClampDay(dateKey,season) {
  const {first,last}=cxSeasonBounds(season);
  return dateKey<first?first:dateKey>last?last:dateKey;
}
// Fechas con carreras, ordenadas y sin repetir.
export function cxRaceDays(races) {
  return [...new Set(races.flatMap(cxRaceDates))].sort();
}
// Día con carreras posterior (direction 1) o anterior (-1) a `dateKey` dentro
// de la temporada; null si no lo hay.
export function cxAdjacentRaceDay(days,dateKey,direction,season) {
  const {first,last}=cxSeasonBounds(season);
  const inRange=day=>day>=first&&day<=last;
  if(direction>0)return days.find(day=>day>dateKey&&inRange(day))||null;
  for(let i=days.length-1;i>=0;i--)if(days[i]<dateKey&&inRange(days[i]))return days[i];
  return null;
}
// Destino de las flechas y del deslizamiento: el día con carreras contiguo o,
// si no lo hay, el día natural; null en los extremos de la temporada.
export function cxStepDay(days,dateKey,direction,season) {
  const target=cxAdjacentRaceDay(days,dateKey,direction,season)||cxAddDays(dateKey,direction);
  return cxClampDay(target,season)===target?target:null;
}
// Siete días con el activo centrado; en los extremos de la temporada la tira
// se desplaza para no ofrecer días fuera de rango.
export function cxDateStrip(dateKey,season) {
  const {first,last}=cxSeasonBounds(season);
  let start=cxAddDays(dateKey,-3);
  if(cxAddDays(start,6)>last)start=cxAddDays(last,-6);
  if(start<first)start=first;
  return Array.from({length:7},(_,i)=>cxAddDays(start,i));
}
