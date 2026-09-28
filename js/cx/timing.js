// UCI Parte V, art. 5.1.048. Los minutos son aproximados; no son una llegada real.
export const CX_DURATION_RULE_VERSION='2026-07-01';
// Fuente: https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/c1ffde19720611fa2fddae4e4601845b/5-CRO-20260701-E.pdf
const individualMinutes={ME:60,WE:50,MU:50,WU:45,MJ:40,WJ:40};

export function cxRegulationMinutes(category,format,version=CX_DURATION_RULE_VERSION) {
  if(version!==CX_DURATION_RULE_VERSION)return null;
  if(format==='individual')return individualMinutes[category]??null;
  if(format==='WE_WJ'&&['WE','WJ'].includes(category))return 45;
  return null;
}

export function cxCategoryTiming(race,category,at=new Date()) {
  // Un formato sin verificar no permite deducir la duración.
  const minutes=cxRegulationMinutes(category.category,category.durationFormat,category.durationRuleVersion??null);
  const start=category.startTimeUtc?Date.parse(category.startTimeUtc):NaN;
  const now=new Date(at).getTime(),known=minutes!==null&&Number.isFinite(start);
  const end=known?start+minutes*60000:null;
  const cancelled=!!(race.isCancelled||category.isCancelled);
  const temporalState=cancelled?'cancelled':!known||!Number.isFinite(now)?'unknown':now<start?'scheduled':now<end?'live':'estimated_finished';
  const resultsStatus=category.resultsStatus||'pending';
  const displayState=cancelled?'cancelled':['provisional','official'].includes(resultsStatus)?resultsStatus:temporalState;
  return {temporalState,displayState,resultsStatus,durationMinutes:minutes,estimatedEndTimeUtc:end===null?null:new Date(end).toISOString()};
}

export function cxRaceTiming(race,at=new Date()) {
  if(race.isCancelled)return 'cancelled';
  const states=(race.cx_race_categories||[]).map(c=>cxCategoryTiming(race,c,at).temporalState).filter(s=>s!=='cancelled');
  if(!states.length)return (race.cx_race_categories||[]).length?'cancelled':'unknown';
  if(states.includes('live'))return 'live';
  if(states.includes('unknown'))return 'unknown';
  if(states.every(s=>s==='estimated_finished'))return 'estimated_finished';
  return 'scheduled';
}
