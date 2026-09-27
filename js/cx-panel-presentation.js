import {cxDateInSeason,cxSeasonBounds} from './cx-season.js?v=20260912cxmonths7';
import {shiftPanelDay} from './panel-catalog-ui.js?v=20260912cxpaneldays';

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
