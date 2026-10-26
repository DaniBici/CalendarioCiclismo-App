import {beforeEach,describe,expect,it,vi} from 'vitest';
import {collectCxAcnRace,collectCxKbwbRace,collectCxRace,collectCxSmartwebRace,collectCxWiclaxRace,cxMadridDate,promoteCxProvisionalResults,runCxPipeline} from '../results-fetchers/cx-results-cron.mjs';
import {applyCxResults,loadCxResultsContext} from '../results-fetchers/cx-results-upsert.mjs';
import {finishAutomationRun,recordAutomationSourceRun,startAutomationRun} from '../automation-monitor.mjs';

// Los colaboradores con E/S se sustituyen por dobles con interfaz: el contexto
// de la carrera, la ingesta de categorías y el registro de la pasada. Las
// pruebas observan sus argumentos y su número de llamadas, no el SQL emitido.
vi.mock('../results-fetchers/cx-results-upsert.mjs',async importOriginal=>({
  ...await importOriginal(),loadCxResultsContext:vi.fn(),applyCxResults:vi.fn(),
}));
vi.mock('../automation-monitor.mjs',async importOriginal=>({
  ...await importOriginal(),startAutomationRun:vi.fn(),finishAutomationRun:vi.fn(),recordAutomationSourceRun:vi.fn(),
}));
beforeEach(()=>{
  vi.clearAllMocks();
  startAutomationRun.mockResolvedValue('9007199254740993');
  finishAutomationRun.mockResolvedValue(undefined);
  recordAutomationSourceRun.mockResolvedValue(undefined);
});

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
// `contexts` se sirve en orden a cada lectura del contexto de la carrera;
// `ingests` recoge los lotes preparados que llegan a la ingesta. `calls` recoge
// los parámetros de las demás sentencias de la recogida (intentos y estado del enlace).
function collectorClient(contexts,{unchanged=false}={}){
  const calls=[],ingests=[];let reads=0;
  loadCxResultsContext.mockImplementation(async()=>structuredClone(contexts[Math.min(reads++,contexts.length-1)]));
  applyCxResults.mockImplementation(async(_client,prepared)=>{
    ingests.push(prepared);
    return prepared.imports.map(manga=>({category:manga.category,rows:manga.rows.length,status:unchanged?'official':prepared.status,unchanged}));
  });
  return {calls,ingests,query:async(_sql,params=[])=>{calls.push(params);return {rows:[]};}};
}
describe('recogida CX sin inferir publicación ni identidades',()=>{
  it('importa oficial desde UCI, mantiene bonos desconocidos y limita la red a mangas vencidas',async()=>{
    const {context,document}=fixture();context.categories.push({...context.categories[0],category:'WE',startTimeUtc:'2026-11-01T16:00:00Z'});
    const client=collectorClient([context]);let requested;
    const result=await collectCxRace(client,context.race.id,{now,fetchCompetition:async options=>{requested=options;return document;}});
    expect(requested.categories).toEqual(['ME']);expect(result).toMatchObject({status:'ok',rowsFound:1,rowsMatched:1,rowsChanged:1});
    expect(client.ingests).toHaveLength(1);const [prepared]=client.ingests;
    expect(prepared.status).toBe('official');expect(prepared.imports[0].evidence).toMatchObject({officialReviewed:true,officialReviewSourceUrl:'https://dataride.uci.ch/iframe/Results/'});
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600',bonusSeconds:null,points:null});
    // Fuera de la ingesta solo se registran los intentos de la categoría y el estado del enlace.
    expect(client.calls).toEqual([['own-cx',['ME'],100,472,0],['ok',null,'own-cx',100,472,0]]);
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
      expect(client.ingests).toHaveLength(0);
    }
  });
  it('resuelve identidades después de la red y respeta una desactivación o bloqueo concurrentes',async()=>{
    const {context,document}=fixture();const fresh=structuredClone(context);fresh.riders.men[0].verified=false;
    const client=collectorClient([context,fresh]);const result=await collectCxRace(client,context.race.id,{now,fetchCompetition:async()=>document});
    expect(result.status).toBe('partial');expect(client.ingests[0].imports[0].rows[0].globalRiderId).toBeNull();
    for(const mutate of [c=>c.link.syncEnabled=false,c=>c.categories[0].resultsLockedAt=now.toISOString()]){
      const current=structuredClone(context);mutate(current);const guarded=collectorClient([context,current]);
      expect((await collectCxRace(guarded,context.race.id,{now,fetchCompetition:async()=>document})).status).toBe('partial');
      expect(guarded.ingests).toHaveLength(0);
    }
  });
  it('rechaza reasignación de enlace y refleja el no-op oficial comunicado por la RPC',async()=>{
    const {context,document}=fixture();const fresh=structuredClone(context);fresh.link.competitionId=101;
    const guarded=collectorClient([context,fresh]);expect((await collectCxRace(guarded,context.race.id,{now,fetchCompetition:async()=>document})).status).toBe('partial');
    expect(guarded.ingests).toHaveLength(0);
    const unchanged=await collectCxRace(collectorClient([context],{unchanged:true}),context.race.id,{now,fetchCompetition:async()=>document});
    expect(unchanged.rowsChanged).toBe(0);expect(unchanged.imported[0]).toMatchObject({status:'official',unchanged:true});
  });
});

// Las sentencias propias de la pasada llegan en un orden fijo: candidatos, bloqueo
// de la pasada, reclamación de la petición manual, [cierre de la petición] y
// liberación del bloqueo. El resto de efectos (promoción, avisos, generales,
// registro de la pasada) pasan por colaboradores inyectados o por dobles.
function pipelineClient(candidates,request=null,{acquired=true}={}){
  const calls=[];
  const answers=[{rows:candidates},{rows:[{acquired}]},{rows:request?[request]:[]}];
  return {calls,query:async(_sql,params=[])=>{
    calls.push(params);
    return answers[calls.length-1]||{rows:[]};
  }};
}
const quiet={
  promote:async()=>({promoted:0,categories:[]}),
  enqueuePushes:async()=>({found:0,scheduled:0,updated:0,cancelled:0}),
};
const sourceRun=source=>recordAutomationSourceRun.mock.calls.map(([,run])=>run).find(run=>run.source===source);
const collected=options=>({raceId:options,status:'ok',rowsFound:3,rowsMatched:2,rowsChanged:2});
describe('pasadas operativas CX separadas de carretera',()=>{
  it('dry-run solo lee decisiones; no reclama, registra ni accede a proveedores',async()=>{
    const client=pipelineClient([fixture().context]);const value=await runCxPipeline(client,{now,dryRun:true,collect:async()=>{throw new Error('No se recoge');},processQueue:async()=>{throw new Error('No se calcula');}});
    expect(value.dryRun).toBe(true);expect(client.calls).toHaveLength(1);expect(value.candidates[0].decisions[0].due).toBe(true);
    expect(startAutomationRun).not.toHaveBeenCalled();expect(recordAutomationSourceRun).not.toHaveBeenCalled();
  });
  it('prioriza una petición manual limitada y conserva requestId BIGINT sin mezclar la cola de carretera',async()=>{
    const request={request_id:'9007199254740993',cx_race_id:'disabled-cx',cx_category:'WJ',attempts:2};
    const client=pipelineClient(['one','two','three'].map(id=>fixture(id).context),request);const calls=[];
    const value=await runCxPipeline(client,{...quiet,now,limit:2,collect:async(c,id,options)=>{calls.push({id,options});return collected(id);},processQueue:async()=>[]});
    expect(calls.map(c=>c.id)).toEqual(['disabled-cx','one','two']);expect(calls[0].options).toMatchObject({manual:true,category:'WJ'});
    expect(value.manualRequestId).toBe('9007199254740993');
    // Cinco sentencias: candidatos, bloqueo, reclamación CX, cierre de la petición y liberación; ninguna cola de carretera.
    expect(client.calls).toHaveLength(5);
    expect(client.calls[3]).toEqual(['9007199254740993',true,null,2]);
    const source=sourceRun('dataride_cx');expect([source.itemsFound,source.itemsMatched,source.itemsChanged,source.errors]).toEqual([9,6,6,0]);
  });
  it('la pasada manual global se limita a las mangas de hoy en Madrid, incluidas carreras multidía',async()=>{
    expect(cxMadridDate('2026-10-31T23:30:00Z')).toBe('2026-11-01');
    const today=fixture('today').context;today.race.endDateKey='2026-11-02';today.categories.push({...today.categories[0],category:'WE',dateKey:'2026-11-02'});
    const tomorrow=fixture('tomorrow').context;tomorrow.race.dateKey='2026-11-02';
    const client=pipelineClient([today,tomorrow],{request_id:'1',cx_race_id:null,cx_category:null,attempts:1});const calls=[];
    await runCxPipeline(client,{...quiet,now:new Date('2026-10-31T23:30:00Z'),collect:async(c,id,options)=>{calls.push({id,options});return collected(id);},processQueue:async()=>[]});
    expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({id:'today',options:{manual:true,categories:['ME']}});
  });
  it('una segunda pasada concurrente no reclama ni publica y los fallos liberan el lock',async()=>{
    const busy=pipelineClient([] ,null,{acquired:false});expect((await runCxPipeline(busy,{now})).status).toBe('noop');expect(busy.calls).toHaveLength(2);
    expect(startAutomationRun).not.toHaveBeenCalled();
    const failed=pipelineClient([]);await expect(runCxPipeline(failed,{...quiet,now,processQueue:async()=>{throw new Error('Revisión necesaria');}})).rejects.toThrow('Revisión necesaria');
    expect(finishAutomationRun).toHaveBeenCalledWith(failed,expect.objectContaining({runId:'9007199254740993',status:'error',error:'Revisión necesaria'}));
    // Candidatos, bloqueo, reclamación y, tras el fallo, la liberación del bloqueo.
    expect(failed.calls).toHaveLength(4);
  });
  it('recoge por fecha si falta formato y mantiene separada la revisión de generales',async()=>{
    const context=fixture().context;context.categories[0].durationFormat=null;const client=pipelineClient([context]);let collections=0;
    const value=await runCxPipeline(client,{...quiet,now,collect:async(c,id)=>{collections++;return collected(id);},processQueue:async()=>[{claimed:{tournamentId:'own',category:'ME'},review:true,reviewReason:'General manual protegida'}]});
    expect(collections).toBe(1);expect(value).toMatchObject({status:'partial',sourceErrors:0,generalErrors:0,sourceReviews:0,generalReviews:1});
    expect(sourceRun('dataride_cx').status).toBe('success');
  });
  it('promueve las provisionales por fecha civil de Madrid antes de generales y avisos, y no en dry-run',async()=>{
    const order=[];const client=pipelineClient([]);
    const at=new Date('2026-11-01T23:00:00Z');
    const value=await runCxPipeline(client,{now:at,
      promote:async(c,options)=>{order.push(['promote',options.now]);return {asOf:'2026-11-02',promoted:2,categories:[]};},
      processQueue:async()=>{order.push(['standings']);return [];},enqueuePushes:async()=>{order.push(['pushes']);return {found:0,scheduled:0,updated:0,cancelled:0};}});
    expect(order.map(step=>step[0])).toEqual(['promote','standings','pushes']);expect(order[0][1]).toBe(at);
    expect(value).toMatchObject({status:'success',promoted:{promoted:2}});

    const dry=pipelineClient([]);
    await runCxPipeline(dry,{now,dryRun:true,promote:async()=>{throw new Error('No se promueve');}});
    const calls=[];
    await promoteCxProvisionalResults({query:async(_sql,params)=>{calls.push(params);return {rows:[{promoted:{promoted:0,categories:[]}}]};}},{now:at});
    expect(calls).toEqual([[at.toISOString()]]);
  });
  it('registra avisos programados y retirados como cambios de cola, sin atribuirles entregas',async()=>{
    const client=pipelineClient([]);const pushes={found:4,scheduled:2,updated:0,cancelled:1};
    const value=await runCxPipeline(client,{...quiet,now,processQueue:async()=>[],enqueuePushes:async()=>pushes});
    expect(value).toMatchObject({status:'success',pushes});
    const source=sourceRun('cx_push');
    expect([source.itemsFound,source.itemsMatched,source.itemsChanged,source.errors??0]).toEqual([4,2,3,0]);expect(source.summary.delivery).toBe('scheduled_queue');
    expect(value.results).toEqual([]);
  });
});

// ACN Timing: enlace propio (`timingLink`), documento `acn` y solo `provisional`.
const ticks=iso=>String(BigInt(Date.parse(iso))*10000n+621355968000000000n);
const acnColumns=['sR_Pos','sR_Nr','Name / Team','dI_sC_#NOC','sC_Laps','sR_Time'].map((Name,FieldIdx)=>({Name,FieldIdx}));
function acnFixture(id='own-acn',{updatedAt='2026-11-01T14:30:00Z'}={}){
  const {context}=fixture(id);
  context.timingLink={raceId:id,provider:'acn',eventId:'2156533144205845',ctx:'20261101_hg',categoryKeys:{},syncEnabled:true,
    syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const rows=[['1.',1,'<b>PRUEBA A</b><br/><font size="-2">10000000001 - CLUB A</font>','flags/esp.png','6','<b>1:00:00</b><br/>-']];
  const tables=[{category:'ME',key:'RES31',groupId:'1_31',name:'Men Elite',
    table:{Version:ticks(updatedAt),TableDefinition:{Columns:acnColumns},Groups:[{SlaveRows:rows}]}}];
  const event={EventId:2156533144205845,Title:'HG Cross - Test',Location:'Test',Country:'BEL',StartDate:'2026-11-01T00:00:00',EndDate:'2026-11-01T00:00:00'};
  return {context,fetchTables:async()=>({event,ctx:'20261101_hg',eventDate:'2026-11-01',tables,skipped:[]})};
}
describe('recogida CX desde ACN Timing',()=>{
  it('importa provisional una clasificación estable y registra el evento verificado',async()=>{
    const {context,fetchTables}=acnFixture();context.link=null;
    const client=collectorClient([context]);
    const value=await collectCxAcnRace(client,context.race.id,{now,fetchTables});
    expect(value).toMatchObject({provider:'acn',status:'ok',rowsFound:1,rowsMatched:1,rowsChanged:1});
    expect(client.ingests).toHaveLength(1);const [prepared]=client.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'acn',acn:{eventId:'2156533144205845',ctx:'20261101_hg'}});
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600',isoCode2:'ES'});
    // Intentos de la categoría y estado del enlace de cronometraje, con el evento verificado.
    expect(client.calls).toEqual([['own-acn',['ME'],'2156533144205845','20261101_hg'],['ok',null,'own-acn','2156533144205845','20261101_hg']]);
  });
  it('no importa mientras ACN sigue actualizando ni sobre oficiales de DataRide ni con otro evento',async()=>{
    const live=acnFixture('live',{updatedAt:'2026-11-01T14:48:00Z'});live.context.link=null;
    const liveClient=collectorClient([live.context]);
    const unstable=await collectCxAcnRace(liveClient,'live',{now,fetchTables:live.fetchTables});
    expect(unstable.status).toBe('partial');expect(unstable.reviews[0].reason).toContain('aún actualiza');
    expect(liveClient.ingests).toHaveLength(0);

    const official=acnFixture('official');official.context.link=null;
    Object.assign(official.context.categories[0],{resultsProvider:'dataride',resultsStatus:'official'});
    const officialClient=collectorClient([official.context]);
    const kept=await collectCxAcnRace(officialClient,'official',{now,fetchTables:official.fetchTables});
    expect(kept.skipped[0].reason).toContain('DataRide');
    expect(officialClient.ingests).toHaveLength(0);

    const promoted=acnFixture('promoted');promoted.context.link=null;
    Object.assign(promoted.context.categories[0],{resultsProvider:'acn',resultsStatus:'official'});
    const promotedClient=collectorClient([promoted.context]);
    const frozen=await collectCxAcnRace(promotedClient,'promoted',{now,fetchTables:promoted.fetchTables});
    expect(frozen.skipped[0].reason).toContain('ya oficiales');
    expect(promotedClient.ingests).toHaveLength(0);

    const moved=acnFixture('moved');moved.context.link=null;const fresh=structuredClone(moved.context);fresh.timingLink.eventId='2156533144205999';
    const movedClient=collectorClient([moved.context,fresh]);
    expect((await collectCxAcnRace(movedClient,'moved',{now,fetchTables:moved.fetchTables})).status).toBe('partial');
    expect(movedClient.ingests).toHaveLength(0);
  });
  it('no importa una clasificación estable cuyo ganador no alcanza el 80 % de la duración prevista',async()=>{
    const short=acnFixture('short');short.context.link=null;short.context.categories[0].durationMinutes=90;
    const shortClient=collectorClient([short.context]);
    const held=await collectCxAcnRace(shortClient,'short',{now,fetchTables:short.fetchTables});
    expect(held.status).toBe('partial');expect(held.reviews[0].reason).toContain('duración prevista');
    expect(shortClient.ingests).toHaveLength(0);

    // Con el 80 % alcanzado basta una espera de 2 min; sin duración acreditada rige la de 5 min.
    const reached=acnFixture('reached',{updatedAt:'2026-11-01T14:47:30Z'});reached.context.link=null;reached.context.categories[0].durationMinutes=75;
    const reachedClient=collectorClient([reached.context]);
    expect((await collectCxAcnRace(reachedClient,'reached',{now,fetchTables:reached.fetchTables})).status).toBe('ok');
    const fresh=acnFixture('fresh',{updatedAt:'2026-11-01T14:48:30Z'});fresh.context.link=null;fresh.context.categories[0].durationMinutes=75;
    const freshClient=collectorClient([fresh.context]);
    expect((await collectCxAcnRace(freshClient,'fresh',{now,fetchTables:fresh.fetchTables})).status).toBe('partial');
    expect(freshClient.ingests).toHaveLength(0);
    const unknown=acnFixture('unknown',{updatedAt:'2026-11-01T14:47:30Z'});unknown.context.link=null;
    expect((await collectCxAcnRace(collectorClient([unknown.context]),'unknown',{now,fetchTables:unknown.fetchTables})).status).toBe('partial');

    for(const durationMinutes of [75,null]){
      const fit=acnFixture('fit');fit.context.link=null;fit.context.categories[0].durationMinutes=durationMinutes;
      const fitClient=collectorClient([fit.context]);
      expect((await collectCxAcnRace(fitClient,'fit',{now,fetchTables:fit.fetchTables})).status).toBe('ok');
      expect(fitClient.ingests).toHaveLength(1);
    }
  });
  it('una carrera solo con enlace de cronometraje se recoge por ACN desde collectCxRace',async()=>{
    const {context,fetchTables}=acnFixture('only-acn');context.link=null;
    const client=collectorClient([context]);let dataRide=0;
    const value=await collectCxRace(client,'only-acn',{now,fetchTables,fetchCompetition:async()=>{dataRide++;}});
    expect(value).toMatchObject({provider:'acn',status:'ok'});expect(dataRide).toBe(0);
  });
  it('la pasada despacha el candidato ACN al colector ACN y lo registra en su fuente',async()=>{
    const {context}=acnFixture('scheduled');context.link={...context.timingLink,disciplineId:3};
    const client=pipelineClient([context]);const calls=[];
    const value=await runCxPipeline(client,{...quiet,now,collectAcn:async(c,id)=>{calls.push(id);return {raceId:id,provider:'acn',status:'ok',rowsFound:1,rowsMatched:1,rowsChanged:1};},
      collect:async()=>{throw new Error('No es DataRide');},processQueue:async()=>[]});
    expect(calls).toEqual(['scheduled']);expect(value.status).toBe('success');
    const acn=sourceRun('acn_cx');
    expect([acn.itemsFound,acn.itemsMatched,acn.itemsChanged,acn.errors]).toEqual([1,1,1,0]);
    expect(sourceRun('dataride_cx').status).toBe('noop');
  });
});

function wiclaxFixture(id='own-wiclax'){
  const {context}=fixture(id);context.link=null;
  context.categories[0].startTimeUtc='2026-11-01T13:00:00Z';
  context.categories.push({...context.categories[0],category:'MJ'});
  context.timingLink={raceId:id,provider:'wiclax',sourceUrl:'https://rs-sport.es/live/g-live.html?f=../CLASIF26/X/X.clax',
    categoryKeys:{'ELITE SUB-23':'ME',JUNIOR:'MJ'},syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const xml=`<Epreuve nom="CX" dt1="2026-11-01"><Etape finito="1," /><Parcours><Pcs nom="ELITE SUB-23" /><Pcs nom="JUNIOR" /></Parcours>
<Engages><E d="1" n="PRUEBA A" c="CICLOS ZUBERO CLUB DEPORTIVO" na="Española" p="ELITE SUB-23" /><E d="2" n="OTRO Juan" c="DESNIVEL +, C.D." na="Española" p="ELITE SUB-23" />
<E d="31" n="JOVEN Luis" c="CLUB X" na="Española" p="JUNIOR" /></Engages>
<Resultats><R d="1" t="01h00'00" b="15h00'00,100" to="7" /><R d="2" t="01h00'05" b="15h00'05,000" to="7" /><R d="31" t="00h20'00" b="14h20'00,000" to="2" /></Resultats></Epreuve>`;
  return {context,fetchClax:async url=>({fileUrl:'https://rs-sport.es/CLASIF26/X/X.clax',xml,url})};
}
describe('recogida CX desde Wiclax',()=>{
  it('importa provisional los recorridos terminados con equipos sin mayúsculas sostenidas',async()=>{
    const {context,fetchClax}=wiclaxFixture();
    const client=collectorClient([context]);
    const value=await collectCxWiclaxRace(client,context.race.id,{now,fetchClax});
    // La ficha nueva queda en aviso, como en ACN: la pasada se marca parcial y la fila se importa.
    expect(value).toMatchObject({provider:'wiclax',status:'partial',rowsFound:2,rowsChanged:2,reviews:[]});
    expect(value.warnings).toMatchObject([{riderDisplay:'Juan Otro',reason:'unresolved'}]);
    expect(value.pending).toEqual([{category:'MJ',reason:'Recorrido sin terminar en el cronometraje; se reintenta en la siguiente pasada'}]);
    expect(client.ingests).toHaveLength(1);const [prepared]=client.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'wiclax',wiclax:{sourceUrl:context.timingLink.sourceUrl}});
    expect(prepared.imports[0].rows.map(row=>row.teamName)).toEqual(['Ciclos Zubero Club Deportivo','Desnivel +, C.D.']);
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600'});
  });
  it('no sustituye categorías oficiales y despacha desde collectCxRace',async()=>{
    const official=wiclaxFixture('official');Object.assign(official.context.categories[0],{resultsProvider:'wiclax',resultsStatus:'official'});
    const officialClient=collectorClient([official.context]);
    const kept=await collectCxWiclaxRace(officialClient,'official',{now,fetchClax:official.fetchClax});
    expect(kept.skipped[0].reason).toContain('ya oficiales');expect(officialClient.ingests).toHaveLength(0);

    const only=wiclaxFixture('only');const client=collectorClient([only.context]);let acn=0;
    const value=await collectCxRace(client,'only',{now,fetchClax:only.fetchClax,fetchTables:async()=>{acn++;}});
    expect(value).toMatchObject({provider:'wiclax',rowsChanged:2});expect(acn).toBe(0);
  });
});

function kbwbFixture(id='own-kbwb'){
  const {context}=fixture(id);context.link=null;
  context.categories[0].startTimeUtc='2026-11-01T13:00:00Z';
  context.categories.push({...context.categories[0],category:'MJ'});
  context.timingLink={raceId:id,provider:'kbwb',categoryKeys:{'14927':'ME','14928':'MJ'},syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const person=(first,last)=>({first_name:first,last_name:last,uci_code:'ESP20000101'});
  const races=[{key:'14927',category:'ME',details:{id:14927,date:'2026-11-01',result:1},results:[{name:'ME',race_result_lines:[
    {place:1,state:'finished',number_of_laps:0,chrono_in_seconds:3600,deficit_chrono_in_seconds:0,team:'TEAM X',person:person('A','PRUEBA')}]}]},
    {key:'14928',category:'MJ',details:{id:14928,date:'2026-11-01',result:0},results:[]}];
  return {context,fetchRaces:async map=>races.filter(race=>race.key in map)};
}
describe('recogida CX desde KBWB',()=>{
  it('importa provisional las pruebas publicadas y deja pendientes las demás',async()=>{
    const {context,fetchRaces}=kbwbFixture();
    const client=collectorClient([context]);
    const value=await collectCxKbwbRace(client,context.race.id,{now,fetchRaces});
    expect(value).toMatchObject({provider:'kbwb',status:'ok',rowsFound:1,rowsChanged:1,reviews:[]});
    expect(value.pending).toEqual([{category:'MJ',reason:'Resultados aún sin publicar en KBWB; se reintenta en la siguiente pasada'}]);
    const [prepared]=client.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'kbwb',kbwb:{raceId:'14927'}});
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600'});
  });
  it('no sustituye categorías oficiales y despacha desde collectCxRace',async()=>{
    const official=kbwbFixture('official');Object.assign(official.context.categories[0],{resultsProvider:'kbwb',resultsStatus:'official'});
    const officialClient=collectorClient([official.context]);
    const kept=await collectCxKbwbRace(officialClient,'official',{now,fetchRaces:official.fetchRaces});
    expect(kept.skipped[0].reason).toContain('ya oficiales');expect(officialClient.ingests).toHaveLength(0);

    const only=kbwbFixture('only');const client=collectorClient([only.context]);let acn=0;
    const value=await collectCxRace(client,'only',{now,fetchRaces:only.fetchRaces,fetchTables:async()=>{acn++;}});
    expect(value).toMatchObject({provider:'kbwb',rowsChanged:1});expect(acn).toBe(0);
  });
});

const SMARTWEB_URL='https://fccv.es/index.php/smartweb/inscripciones/clasificacion/35255';
function smartwebFixture(id='own-smartweb'){
  const {context}=fixture(id);context.link=null;
  context.categories[0].startTimeUtc='2026-11-01T13:00:00Z';
  context.categories.push({...context.categories[0],category:'MJ'});
  context.timingLink={raceId:id,provider:'smartweb',sourceUrl:SMARTWEB_URL,categoryKeys:{'ELITE-SUB23':'ME','JUNIOR':'MJ'},
    syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const table=rows=>`<table><tr><th>Pos.</th><th>Dorsal</th><th>Nombre</th><th>Apellidos</th><th>Club\\Equipo</th><th>C.A Participante</th><th>Tiempo</th></tr>
    ${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</table>`;
  const fetched={indexUrl:SMARTWEB_URL,index:{dateKey:'2026-11-01',options:[{variant:'fichero',id:'1',label:'ELITE-SUB23'}]},
    pages:{'fichero:1':table([['1','12','A','PRUEBA','CLUB CICLISTA X','VLC','01:00:00.500']])}};
  return {context,fetchRace:async()=>fetched};
}
// Responde a la huella de la tabla con la marca indicada; registra el SQL de cada sentencia.
function smartwebClient(contexts,since){
  const client=collectorClient(contexts);const statements=[];
  client.statements=statements;
  client.query=async(sql,params=[])=>{statements.push(sql);client.calls.push(params);
    if(sql.includes('"sourceDigestAt"'))return {rows:JSON.parse(params[1]).map(({category})=>({category,sourceDigestAt:since}))};
    return {rows:[]};};
  return client;
}
describe('recogida CX desde smartweb',()=>{
  it('espera una segunda lectura igual y después importa provisional',async()=>{
    const first=smartwebFixture();const fresh=smartwebClient([first.context],now.toISOString());
    const waiting=await collectCxSmartwebRace(fresh,first.context.race.id,{now,fetchRace:first.fetchRace});
    expect(waiting).toMatchObject({provider:'smartweb',status:'ok',rowsChanged:0});
    expect(waiting.pending.map(item=>item.category)).toEqual(['MJ','ME']);expect(fresh.ingests).toHaveLength(0);

    const second=smartwebFixture();const stable=smartwebClient([second.context],new Date(now.getTime()-5*60000).toISOString());
    const value=await collectCxSmartwebRace(stable,second.context.race.id,{now,fetchRace:second.fetchRace});
    expect(value).toMatchObject({provider:'smartweb',status:'ok',rowsFound:1,rowsChanged:1,reviews:[]});
    const [prepared]=stable.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'smartweb',smartweb:{sourceUrl:SMARTWEB_URL,label:'ELITE-SUB23',variant:'fichero'}});
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600',teamName:'Club Ciclista X',isoCode2:'ES'});
  });
  it('no publica un ganador por debajo del 80 % de la duración ni sustituye oficiales',async()=>{
    const short=smartwebFixture('short');short.context.categories[0].durationMinutes=90;
    const client=smartwebClient([short.context],new Date(now.getTime()-5*60000).toISOString());
    const value=await collectCxSmartwebRace(client,'short',{now,fetchRace:short.fetchRace});
    expect(value.reviews[0].reason).toContain('80 %');expect(client.ingests).toHaveLength(0);

    const official=smartwebFixture('official');Object.assign(official.context.categories[0],{resultsProvider:'smartweb',resultsStatus:'official'});
    const officialClient=smartwebClient([official.context],now.toISOString());
    const kept=await collectCxSmartwebRace(officialClient,'official',{now,fetchRace:official.fetchRace});
    expect(kept.skipped[0].reason).toContain('ya oficiales');expect(officialClient.ingests).toHaveLength(0);
  });
  it('prepara en seco sin escribir y despacha desde collectCxRace',async()=>{
    const shadow=smartwebFixture('shadow');shadow.context.timingLink.syncEnabled=false;
    const client=smartwebClient([shadow.context],now.toISOString());
    const value=await collectCxSmartwebRace(client,'shadow',{now,dryRun:true,fetchRace:shadow.fetchRace});
    expect(value).toMatchObject({status:'dry_run',prepared:[{category:'ME',rows:1,linked:1}]});
    expect(client.ingests).toHaveLength(0);expect(client.statements.every(sql=>/^\s*SELECT/i.test(sql))).toBe(true);

    const only=smartwebFixture('only');const routed=smartwebClient([only.context],new Date(now.getTime()-5*60000).toISOString());
    expect(await collectCxRace(routed,'only',{now,fetchRace:only.fetchRace})).toMatchObject({provider:'smartweb',rowsChanged:1});
  });
});
