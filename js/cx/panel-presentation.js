import {cxDateInSeason,cxSeasonBounds} from './season.js';
import {shiftPanelDay} from '../panel/catalog-ui.js';

export function cxPanelAgendaDate(dateKey,direction=0) {
  shiftPanelDay(dateKey,0);
  const year=Number(dateKey.slice(0,4)),month=Number(dateKey.slice(5,7));
  if(month>=8||month<=2)return dateKey;
  return direction<0?cxSeasonBounds(`${year-1}-${String(year%100).padStart(2,'0')}`).last:`${year}-08-01`;
}

export function cxPanelSeasonForDate(dateKey) {
  const year=Number(dateKey.slice(0,4))-(Number(dateKey.slice(5,7))<=2?1:0);
  return `${year}-${String((year+1)%100).padStart(2,'0')}`;
}

export function cxPanelAgendaRaces(races,dateKey) {
  return races.filter(race=>cxDateInSeason(race.seasonKey,dateKey)&&(
    (race.cx_race_categories||[]).some(category=>(category.dateKey||race.dateKey)===dateKey)
    ||!(race.cx_race_categories||[]).length&&race.dateKey===dateKey));
}

// Día con jornadas más cercano en el sentido de la navegación: hacia delante
// con direction>=0 y hacia atrás con direction<0; sin sentido (apertura, Hoy)
// prueba también hacia atrás. Sin días con jornadas devuelve la fecha pedida.
export function cxPanelNearestRaceDate(races,dateKey,direction=0) {
  const days=[...new Set(races.flatMap(race=>{
    const categories=race.cx_race_categories||[];
    const keys=categories.length?categories.map(category=>category.dateKey||race.dateKey):[race.dateKey];
    return keys.filter(key=>key&&cxDateInSeason(race.seasonKey,key));
  }))].sort();
  if(days.includes(dateKey))return dateKey;
  const after=days.find(day=>day>dateKey),before=days.filter(day=>day<dateKey).pop();
  if(direction<0)return before||dateKey;
  return after||(direction>0?dateKey:before||dateKey);
}
