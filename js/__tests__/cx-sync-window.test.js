import {describe,expect,it} from 'vitest';
import {cxSyncDecision} from '../../scripts/results-fetchers/cx-sync-window.mjs';
function fixture(category='ME'){
  return {race:{id:'cx-only',seasonKey:'2026-27',dateKey:'2026-11-01',editorialStatus:'published',isCancelled:false},
    manga:{raceId:'cx-only',category,dateKey:null,startTimeUtc:'2026-11-01T14:00:00Z',durationFormat:'individual',durationRuleVersion:'2026-07-01',resultsStatus:'pending'},
    link:{raceId:'cx-only',disciplineId:3,competitionId:1,seasonId:472,uciRaceId:0,syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5}};
}
const decide=(f,now,manual=false)=>cxSyncDecision(f.race,f.manga,f.link,{now,manual});
describe('ventanas de recogida por final estimado UCI',()=>{
  it('abre ME quince minutos antes de su final aproximado de sesenta, no desde la salida',()=>{
    const f=fixture();expect(decide(f,'2026-11-01T14:44:59Z').due).toBe(false);
    expect(decide(f,'2026-11-01T14:45:00Z')).toMatchObject({due:true,estimatedEndTimeUtc:'2026-11-01T15:00:00.000Z'});
    expect(decide(f,'2026-11-01T16:00:00Z')).toMatchObject({due:true,temporalState:'estimated_finished'});
    expect(f.manga.resultsStatus).toBe('pending');
  });
  it('usa la duración de cada categoría y el formato agrupado verificado',()=>{
    const expected={ME:60,WE:50,MU:50,WU:45,MJ:40,WJ:40};
    for(const [category,minutes] of Object.entries(expected)){
      const f=fixture(category);expect(Date.parse(decide(f,'2026-11-01T16:00:00Z').estimatedEndTimeUtc)-Date.parse(f.manga.startTimeUtc)).toBe(minutes*60000);
    }
    const f=fixture('WE');f.manga.durationFormat='WE_WJ';expect(decide(f,'2026-11-01T16:00:00Z').estimatedEndTimeUtc).toBe('2026-11-01T14:45:00.000Z');
  });
  it('usa la fecha DataRide cuando falta salida, formato o versión y no inventa una llegada',()=>{
    for(const key of ['startTimeUtc','durationFormat','durationRuleVersion']){
      const f=fixture();f.manga[key]=null;
      const decision=decide(f,'2026-11-01T14:00:00Z');
      expect(decision).toMatchObject({due:true,sourceDriven:true,reason:'Ventana DataRide por fecha activa'});
      expect(decision.estimatedEndTimeUtc).toBeUndefined();
      expect(decide(f,'2026-11-02T10:59:59Z')).toMatchObject({due:true,sourceDriven:true});
      expect(decide(f,'2026-11-02T11:00:00Z')).toMatchObject({due:false,review:true,sourceDriven:true});
    }
    const f=fixture();f.manga.durationFormat=null;
    expect(decide(f,'2026-11-01T13:44:59Z')).toMatchObject({due:false,sourceDriven:true});
  });
  it('mantiene la cadencia por categoría, no por el último fetch del enlace',()=>{
    const f=fixture();f.link.lastFetchAt='2026-11-01T15:59:00Z';
    expect(decide(f,'2026-11-01T16:00:00Z').due).toBe(true);
    f.manga.resultsLastFetchAt='2026-11-01T15:59:00Z';
    expect(decide(f,'2026-11-01T16:00:00Z')).toMatchObject({due:false,reason:'Intervalo de categoría aún no vencido'});
    expect(decide(f,'2026-11-01T16:04:00Z').due).toBe(true);
  });
  it('conserva recogida de pendientes después del final dentro del cierre configurado',()=>{
    const f=fixture();expect(decide(f,'2026-11-02T03:00:00Z').due).toBe(true);
    expect(decide(f,'2026-11-02T03:00:01Z')).toMatchObject({due:false,review:true});
    f.manga.resultsStatus='official';expect(decide(f,'2026-11-01T16:00:00Z').due).toBe(true);
  });
  it('manual omite horario/cadencia/activación, pero respeta bloqueos y alcance',()=>{
    const f=fixture();f.link.syncEnabled=false;f.manga.startTimeUtc=null;
    expect(decide(f,'2026-11-01T16:00:00Z',true).due).toBe(true);
    for(const edit of [f=>f.manga.resultsLockedAt='2026-11-01T15:00:00Z',f=>f.race.isCancelled=true,f=>f.manga.isCancelled=true,
      f=>f.link.disciplineId=10,f=>f.manga.raceId='road-id',f=>f.race.editorialStatus='draft',f=>f.manga.category='Mixed']){
      const f=fixture();edit(f);expect(decide(f,'2026-11-01T16:00:00Z',true).due).toBe(false);
    }
  });
  it('excluye marzo–julio y overrides fuera de la carrera también en solicitudes manuales',()=>{
    for(const edit of [f=>f.race.dateKey='2027-03-01',f=>f.race.endDateKey='2027-03-01',f=>f.manga.dateKey='2026-07-31',f=>f.manga.dateKey='2026-11-02']){
      const f=fixture();edit(f);expect(decide(f,'2026-11-01T16:00:00Z',true).due).toBe(false);
    }
  });
  it('permite terminar febrero en UTC del día siguiente sin consultar una carrera de marzo',()=>{
    const f=fixture();f.race.dateKey='2027-02-28';f.manga.startTimeUtc='2027-02-28T23:00:00Z';
    expect(decide(f,'2027-03-01T01:00:00Z')).toMatchObject({due:true,temporalState:'estimated_finished'});
    f.race.dateKey='2027-03-01';expect(decide(f,'2027-03-01T01:00:00Z',true).due).toBe(false);
  });
  it('rechaza offset de cierre negativo y cadencias fuera de contrato',()=>{
    for(const [key,value] of [['syncStopOffsetMinutes',-10],['syncIntervalMinutes',0],['syncStartOffsetMinutes',2000]]){
      const f=fixture();f.link[key]=value;expect(decide(f,'2026-11-01T16:00:00Z')).toMatchObject({due:false,review:true});
    }
  });
});
