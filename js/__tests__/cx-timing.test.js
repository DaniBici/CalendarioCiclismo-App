import {describe,it,expect} from 'vitest';
import {CX_DURATION_RULE_VERSION,cxCategoryTiming} from '../cx/timing.js';

const start='2027-01-30T14:00:00Z';
const category=(code,extra={})=>({category:code,startTimeUtc:start,durationFormat:'individual',durationRuleVersion:CX_DURATION_RULE_VERSION,resultsStatus:'pending',...extra});

describe('duración UCI y estados de mangas CX',()=>{
  it('pasa de programada a en directo y a finalizada estimada en los límites de la duración',()=>{
    const c=category('WE'),end=Date.parse(start)+50*60000;
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
    expect(cxCategoryTiming({},category('MU',{durationFormat:'WITH_ELITE'}),start).durationMinutes).toBe(60);
    expect(cxCategoryTiming({},category('WU',{durationFormat:'WITH_ELITE'}),start).durationMinutes).toBe(50);
    for(const name of ['ME','WE','MJ','WJ'])expect(cxCategoryTiming({},category(name,{durationFormat:'WITH_ELITE'}),start).temporalState).toBe('unknown');
    const race={cx_race_categories:[category('WE'),category('WJ')]};
    expect(cxCategoryTiming(race,race.cx_race_categories[0],start).durationMinutes).toBe(50);
    expect(race.cx_race_categories).toHaveLength(2);
  });
  it('usa minutos transcurridos UTC al cruzar un cambio horario',()=>{
    const timing=cxCategoryTiming({},category('ME',{startTimeUtc:'2026-10-25T00:30:00Z'}),'2026-10-25T01:30:00Z');
    expect(timing.estimatedEndTimeUtc).toBe('2026-10-25T01:30:00.000Z');
    expect(timing.temporalState).toBe('estimated_finished');
  });
});
