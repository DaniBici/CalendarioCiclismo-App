export const CX_ACTIVE_MONTHS=[8,9,10,11,12,1,2];
export const cxSeason=(date=new Date())=>{
  const year=date.getFullYear()-(date.getMonth()<2?1:0);
  return `${year}-${String((year+1)%100).padStart(2,'0')}`;
};
export function cxSeasonMonths(season) {
  const year=Number(season.slice(0,4));
  if(!/^\d{4}-\d{2}$/.test(season)||Number(season.slice(5))!==(year+1)%100)throw new Error('Temporada CX inválida.');
  return Array.from({length:7},(_,i)=>new Date(Date.UTC(year,7+i,1)).toISOString().slice(0,7));
}
export function cxDateInSeason(season,date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!cxSeasonMonths(season).includes(date.slice(0,7)))return false;
  const civil=new Date(`${date}T12:00:00Z`);
  return Number.isFinite(civil.getTime())&&civil.toISOString().slice(0,10)===date;
}
export function cxSeasonBounds(season) {
  const months=cxSeasonMonths(season),year=Number(season.slice(0,4));
  return {first:`${months[0]}-01`,last:new Date(Date.UTC(year+1,2,0)).toISOString().slice(0,10)};
}
