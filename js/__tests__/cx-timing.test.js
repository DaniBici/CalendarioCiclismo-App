import {describe,it,expect} from 'vitest';
import {CX_DURATION_RULE_VERSION,cxRegulationMinutes,cxCategoryTiming,cxRaceTiming} from '../cx-timing.js';

const start='2027-01-30T14:00:00Z';
const category=(code,extra={})=>({category:code,startTimeUtc:start,durationFormat:'individual',durationRuleVersion:CX_DURATION_RULE_VERSION,resultsStatus:'pending',...extra});

describe('duración UCI y estados de mangas CX',()=>{
  it.each([['ME',60],['WE',50],['MU',50],['WU',45],['MJ',40],['WJ',40]])('aplica %s en los límites de su duración de %i minutos',(code,minutes)=>{
    const c=category(code),end=Date.parse(start)+minutes*60000;
    expect(cxRegulationMinutes(code,'individual')).toBe(minutes);
    expect(cxCategoryTiming({},c,Date.parse(start)-1).temporalState).toBe('scheduled');
    expect(cxCategoryTiming({},c,start).temporalState).toBe('live');
    expect(cxCategoryTiming({},c,end-1).temporalState).toBe('live');
    const finished=cxCategoryTiming({},c,end);
    expect(finished.temporalState).toBe('estimated_finished');
    expect(finished.estimatedEndTimeUtc).toBe(new Date(end).toISOString());
    expect(finished.resultsStatus).toBe('pending');
    expect(c.resultsStatus).toBe('pending');
  });
  it('exige formato, versión y salida, sin inferir agrupaciones ni fabricar horarios',()=>{
    for(const extra of [{startTimeUtc:null},{durationFormat:null},{durationRuleVersion:null},{durationRuleVersion:undefined},{durationRuleVersion:'2027-07-01'}]) {
      const timing=cxCategoryTiming({},category('WE',extra),start);
      expect(timing.temporalState).toBe('unknown');expect(timing.estimatedEndTimeUtc).toBeNull();
    }
    expect(cxCategoryTiming({},category('WE',{durationFormat:'WE_WJ'}),start).durationMinutes).toBe(45);
    expect(cxCategoryTiming({},category('WJ',{durationFormat:'WE_WJ'}),start).durationMinutes).toBe(45);
    expect(cxCategoryTiming({},category('MU',{durationFormat:'WE_WJ'}),start).temporalState).toBe('unknown');
    const race={cx_race_categories:[category('WE'),category('WJ')]};
    expect(cxCategoryTiming(race,race.cx_race_categories[0],start).durationMinutes).toBe(50);
    expect(race.cx_race_categories).toHaveLength(2);
  });
  it('mantiene separados resultados, estimaciones y cancelaciones',()=>{
    const c=category('ME',{resultsStatus:'provisional'});
    const timing=cxCategoryTiming({},c,start);
    expect(timing).toMatchObject({temporalState:'live',displayState:'provisional',resultsStatus:'provisional'});
    expect(cxCategoryTiming({isCancelled:true},c,start).displayState).toBe('cancelled');
    expect(cxCategoryTiming({},category('ME',{isCancelled:true,startTimeUtc:null}),start).temporalState).toBe('cancelled');
    expect(cxCategoryTiming({},category('ME',{resultsStatus:'official'}),start).displayState).toBe('official');
  });
  it('no finaliza un Mundial al terminar su primera manga ni crea una WU derivada',()=>{
    const race={cx_race_categories:[category('WE'),category('ME',{startTimeUtc:'2027-01-31T14:00:00Z'})]};
    expect(cxRaceTiming(race,'2027-01-30T15:00:00Z')).toBe('scheduled');
    expect(cxRaceTiming(race,'2027-01-31T14:30:00Z')).toBe('live');
    expect(cxRaceTiming(race,'2027-01-31T15:00:00Z')).toBe('estimated_finished');
    race.cx_race_categories.push(category('MJ',{startTimeUtc:null}));
    expect(cxRaceTiming(race,'2027-01-31T15:00:00Z')).toBe('unknown');
    race.cx_race_categories[2].isCancelled=true;
    expect(cxRaceTiming(race,'2027-01-31T15:00:00Z')).toBe('estimated_finished');
    expect(race.cx_race_categories.some(c=>c.category==='WU')).toBe(false);
    expect(cxRaceTiming({cx_race_categories:[]},start)).toBe('unknown');
  });
  it('usa minutos transcurridos UTC al cruzar un cambio horario',()=>{
    const timing=cxCategoryTiming({},category('ME',{startTimeUtc:'2026-10-25T00:30:00Z'}),'2026-10-25T01:30:00Z');
    expect(timing.estimatedEndTimeUtc).toBe('2026-10-25T01:30:00.000Z');
    expect(timing.temporalState).toBe('estimated_finished');
  });
});
