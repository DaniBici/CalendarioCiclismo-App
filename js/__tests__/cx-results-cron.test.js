import {describe,expect,it} from 'vitest';
import {collectCxRace,cxMadridDate,runCxPipeline} from '../../scripts/results-fetchers/cx-results-cron.mjs';

const now=new Date('2026-11-01T14:50:00Z');
function fixture(id='own-cx'){
  const race={id,seasonKey:'2026-27',seasonStartYear:2026,dateKey:'2026-11-01',editorialStatus:'published',isCancelled:false};
  const link={raceId:id,disciplineId:3,competitionId:100,seasonId:472,uciRaceId:0,syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const manga={raceId:id,category:'ME',dateKey:null,isCancelled:false,resultsLockedAt:null,resultsStatus:'pending',
    startTimeUtc:'2026-11-01T14:00:00Z',durationFormat:'individual',durationRuleVersion:'2026-07-01'};
  const riders={men:[{id:'own-rider',firstName:'A',lastName:'Prueba',nationality:'ES',birthDate:'2000-01-01',verified:true}],women:[]};
  const context={race,link,categories:[manga],riders};
  const document={schemaVersion:1,source:'dataride',disciplineId:3,competitionId:100,seasonId:472,seasonKey:'2026-27',categories:[{
    category:'ME',dateKey:race.dateKey,uciRaceId:10,eventId:20,publicationHint:'unverified_results',evidence:{sourceUrl:'https://dataride.uci.ch/iframe/Results/'},
    rows:[{rank:1,riderDisplay:'PRUEBA A',isoCode2:'ES',bib:'01',timeText:'1:00:00',timeSeconds:'3600',points:null,bonusPoints:0,bonusSeconds:null}]}]};
  return {context,document};
}
function collectorClient(contexts,{unchanged=false}={}){
  const calls=[];let reads=0;
  return {calls,query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes(' AS context'))return {rows:[{context:structuredClone(contexts[Math.min(reads++,contexts.length-1)])}]};
    if(sql.includes('cx_ingest_results'))return {rows:[{imported:{category:params[1],rows:JSON.parse(params[2]).length,status:unchanged?'official':params[3],unchanged}}]};
    return {rows:[]};
  }};
}
describe('recogida CX sin inferir publicación ni identidades',()=>{
  it('importa oficial desde UCI, mantiene bonos desconocidos y limita la red a mangas vencidas',async()=>{
    const {context,document}=fixture();context.categories.push({...context.categories[0],category:'WE',startTimeUtc:'2026-11-01T16:00:00Z'});
    const client=collectorClient([context]);let requested;
    const result=await collectCxRace(client,context.race.id,{now,fetchCompetition:async options=>{requested=options;return document;}});
    expect(requested.categories).toEqual(['ME']);expect(result).toMatchObject({status:'ok',rowsFound:1,rowsMatched:1,rowsChanged:1});
    const call=client.calls.find(c=>c.sql.includes('cx_ingest_results'));
    expect(call.params[3]).toBe('official');expect(JSON.parse(call.params[4])).toMatchObject({officialReviewed:true,officialReviewSourceUrl:'https://dataride.uci.ch/iframe/Results/'});
    expect(JSON.parse(call.params[2])[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600',bonusSeconds:null,points:null});
    expect(client.calls.some(c=>/\b(?:INSERT\s+INTO|UPDATE)\s+public\.races\b/i.test(c.sql))).toBe(false);
  });
  it('respeta resultados protegidos y consulta por fecha cuando falta la duración acreditada',async()=>{
    for(const manual of [false,true]){
      const {context}=fixture();context.categories[0].resultsLockedAt=now.toISOString();let calls=0;
      expect((await collectCxRace(collectorClient([context]),context.race.id,{now,manual,fetchCompetition:async()=>{calls++;}})).status).toBe('skipped');expect(calls).toBe(0);
    }
    const {context,document}=fixture();context.categories[0].durationFormat=null;let calls=0;
    const value=await collectCxRace(collectorClient([context]),context.race.id,{now,fetchCompetition:async()=>{calls++;return document;}});
    expect(value.status).toBe('ok');expect(calls).toBe(1);
  });
  it('deja en revisión posiciones sin tiempo de ganador y no vacía resultados existentes',async()=>{
    for(const missing of [null,'0']){
      const {context,document}=fixture();document.categories[0].rows[0].timeSeconds=missing;
      const client=collectorClient([context]);const value=await collectCxRace(client,context.race.id,{now,fetchCompetition:async()=>document});
      expect(value).toMatchObject({status:'partial',rowsFound:1,rowsChanged:0,rowsMatched:0});expect(value.reviews).toHaveLength(1);
      expect(client.calls.some(c=>c.sql.includes('cx_ingest_results'))).toBe(false);
    }
  });
  it('resuelve identidades después de la red y respeta una desactivación o bloqueo concurrentes',async()=>{
    const {context,document}=fixture();const fresh=structuredClone(context);fresh.riders.men[0].verified=false;
    const client=collectorClient([context,fresh]);const result=await collectCxRace(client,context.race.id,{now,fetchCompetition:async()=>document});
    expect(result.status).toBe('partial');expect(JSON.parse(client.calls.find(c=>c.sql.includes('cx_ingest_results')).params[2])[0].globalRiderId).toBeNull();
    for(const mutate of [c=>c.link.syncEnabled=false,c=>c.categories[0].resultsLockedAt=now.toISOString()]){
      const current=structuredClone(context);mutate(current);const guarded=collectorClient([context,current]);
      expect((await collectCxRace(guarded,context.race.id,{now,fetchCompetition:async()=>document})).status).toBe('partial');
      expect(guarded.calls.some(c=>c.sql.includes('cx_ingest_results'))).toBe(false);
    }
  });
  it('rechaza reasignación de enlace y refleja el no-op oficial comunicado por la RPC',async()=>{
    const {context,document}=fixture();const fresh=structuredClone(context);fresh.link.competitionId=101;
    const guarded=collectorClient([context,fresh]);expect((await collectCxRace(guarded,context.race.id,{now,fetchCompetition:async()=>document})).status).toBe('partial');
    expect(guarded.calls.some(c=>c.sql.includes('cx_ingest_results'))).toBe(false);
    const unchanged=await collectCxRace(collectorClient([context],{unchanged:true}),context.race.id,{now,fetchCompetition:async()=>document});
    expect(unchanged.rowsChanged).toBe(0);expect(unchanged.imported[0]).toMatchObject({status:'official',unchanged:true});
  });
});

function pipelineClient(candidates,request=null,{acquired=true}={}){
  const calls=[];
  return {calls,query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('cx_sync_candidates'))return {rows:candidates};
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired}]};
    if(sql.includes('claim_results_manual_request(3)'))return {rows:request?[request]:[]};
    if(sql.includes('start_automation_run'))return {rows:[{id:'9007199254740993'}]};
    if(sql.includes('cx_enqueue_automatic_pushes'))return {rows:[{pushes:{found:0,scheduled:0,updated:0,cancelled:0}}]};
    return {rows:[]};
  }};
}
const collected=options=>({raceId:options,status:'ok',rowsFound:3,rowsMatched:2,rowsChanged:2});
describe('pasadas operativas CX separadas de carretera',()=>{
  it('dry-run solo lee decisiones; no reclama, registra ni accede a proveedores',async()=>{
    const client=pipelineClient([fixture().context]);const value=await runCxPipeline(client,{now,dryRun:true,collect:async()=>{throw new Error('No se recoge');},processQueue:async()=>{throw new Error('No se calcula');}});
    expect(value.dryRun).toBe(true);expect(client.calls).toHaveLength(1);expect(value.candidates[0].decisions[0].due).toBe(true);
  });
  it('prioriza una petición manual limitada y conserva requestId BIGINT sin mezclar la cola de carretera',async()=>{
    const request={request_id:'9007199254740993',cx_race_id:'disabled-cx',cx_category:'WJ',attempts:2};
    const client=pipelineClient(['one','two','three'].map(id=>fixture(id).context),request);const calls=[];
    const value=await runCxPipeline(client,{now,limit:2,collect:async(c,id,options)=>{calls.push({id,options});return collected(id);},processQueue:async()=>[]});
    expect(calls.map(c=>c.id)).toEqual(['disabled-cx','one','two']);expect(calls[0].options).toMatchObject({manual:true,category:'WJ'});
    expect(value.manualRequestId).toBe('9007199254740993');
    expect(client.calls.find(c=>c.sql.includes('finish_results_manual_request')).params).toEqual(['9007199254740993',true,null,2]);
    expect(client.calls.some(c=>c.sql.includes('claim_results_manual_request()'))).toBe(false);
    expect(client.calls.at(-1).sql).toContain('pg_advisory_unlock');
    const source=client.calls.find(c=>c.sql.includes('record_automation_source_run')&&c.params[1]==='dataride_cx');expect(source.params.slice(3,7)).toEqual([9,6,6,0]);
  });
  it('la pasada manual global se limita a las mangas de hoy en Madrid, incluidas carreras multidía',async()=>{
    expect(cxMadridDate('2026-10-31T23:30:00Z')).toBe('2026-11-01');
    const today=fixture('today').context;today.race.endDateKey='2026-11-02';today.categories.push({...today.categories[0],category:'WE',dateKey:'2026-11-02'});
    const tomorrow=fixture('tomorrow').context;tomorrow.race.dateKey='2026-11-02';
    const client=pipelineClient([today,tomorrow],{request_id:'1',cx_race_id:null,cx_category:null,attempts:1});const calls=[];
    await runCxPipeline(client,{now:new Date('2026-10-31T23:30:00Z'),collect:async(c,id,options)=>{calls.push({id,options});return collected(id);},processQueue:async()=>[]});
    expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({id:'today',options:{manual:true,categories:['ME']}});
  });
  it('una segunda pasada concurrente no reclama ni publica y los fallos liberan el lock',async()=>{
    const busy=pipelineClient([] ,null,{acquired:false});expect((await runCxPipeline(busy,{now})).status).toBe('noop');expect(busy.calls).toHaveLength(2);
    const failed=pipelineClient([]);await expect(runCxPipeline(failed,{now,processQueue:async()=>{throw new Error('Revisión necesaria');}})).rejects.toThrow('Revisión necesaria');
    expect(failed.calls.some(c=>c.sql.includes('finish_automation_run'))).toBe(true);expect(failed.calls.at(-1).sql).toContain('pg_advisory_unlock');
  });
  it('recoge por fecha si falta formato y mantiene separada la revisión de generales',async()=>{
    const context=fixture().context;context.categories[0].durationFormat=null;const client=pipelineClient([context]);let collections=0;
    const value=await runCxPipeline(client,{now,collect:async(c,id)=>{collections++;return collected(id);},processQueue:async()=>[{claimed:{tournamentId:'own',category:'ME'},review:true,reviewReason:'General manual protegida'}]});
    expect(collections).toBe(1);expect(value).toMatchObject({status:'partial',sourceErrors:0,generalErrors:0,sourceReviews:0,generalReviews:1});
    const source=client.calls.find(c=>c.sql.includes('record_automation_source_run')&&c.params[1]==='dataride_cx');
    expect(source.params[2]).toBe('success');
  });
  it('registra avisos programados y retirados como cambios de cola, sin atribuirles entregas',async()=>{
    const client=pipelineClient([]);const pushes={found:4,scheduled:2,updated:0,cancelled:1};
    const value=await runCxPipeline(client,{now,processQueue:async()=>[],enqueuePushes:async()=>pushes});
    expect(value).toMatchObject({status:'success',pushes});
    const source=client.calls.find(c=>c.sql.includes('record_automation_source_run')&&c.params[1]==='cx_push');
    expect(source.params.slice(3,7)).toEqual([4,2,3,0]);expect(JSON.parse(source.params.at(-1)).delivery).toBe('scheduled_queue');
    expect(value.results).toEqual([]);
  });
});
