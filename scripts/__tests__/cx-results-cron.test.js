import {readFileSync} from 'node:fs';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {collectCxAcnRace,collectCxChronoraceXcoRace,collectCxGolazoRace,collectCxKbwbRace,collectCxRace,collectCxRoundBonuses,collectCxFotofinissRace,collectCxRaceresultRace,collectCxSmartwebRace,collectCxWiclaxRace,collectCxZone4Race,cxMadridDate,promoteCxProvisionalResults,runCxPipeline} from '../results-fetchers/cx-results-cron.mjs';
import {applyCxResults,loadCxResultsContext} from '../results-fetchers/cx-results-upsert.mjs';
import {parseFotofinissGroups} from '../results-fetchers/fotofiniss-cx-fetch.mjs';
import {parseRaceresultList} from '../results-fetchers/raceresult-cx-fetch.mjs';
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
const noBonuses={candidates:0,applied:[],unchanged:[],skipped:[],pending:[],reviews:[]};
const quiet={
  collectBonuses:async()=>noBonuses,
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
      collectBonuses:async()=>{order.push(['bonuses']);return noBonuses;},
      promote:async(c,options)=>{order.push(['promote',options.now]);return {asOf:'2026-11-02',promoted:2,categories:[]};},
      processQueue:async()=>{order.push(['standings']);return [];},enqueuePushes:async()=>{order.push(['pushes']);return {found:0,scheduled:0,updated:0,cancelled:0};}});
    expect(order.map(step=>step[0])).toEqual(['bonuses','promote','standings','pushes']);expect(order[1][1]).toBe(at);
    expect(value).toMatchObject({status:'success',promoted:{promoted:2}});

    const dry=pipelineClient([]);
    await runCxPipeline(dry,{now,dryRun:true,promote:async()=>{throw new Error('No se promueve');}});
    const calls=[];
    await promoteCxProvisionalResults({query:async(_sql,params)=>{calls.push(params);return {rows:[{promoted:{promoted:0,categories:[]}}]};}},{now:at});
    expect(calls).toEqual([[at.toISOString()]]);
  });
});

// Bonos por ronda: lectura del informe de Chronorace y RPC idempotente, sin reemplazar resultados.
describe('bonos por ronda desde Chronorace',()=>{
  const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/chronorace-koppenbergcross-2026-me-${name}.json`,import.meta.url),'utf8'));
  const tree={Childs:[{Type:'Folder',Name:'CROME',Childs:['RES31','BEST31'].map(key=>({Type:'result',Id:key,Route:JSON.stringify({Params:{key}})}))}]};
  const after=new Date('2026-11-01T16:01:00Z');
  const candidate=(extra={})=>({raceId:'koppenberg',dateKey:'2026-11-01',category:'ME',bonusSourceUrl:null,resultsImportedAt:'2026-11-01T15:30:00Z',
    publication:{provider:'chronorace',contextSuffix:'x2o'},
    rows:[{id:'10',rank:1,riderDisplay:'Thibau Nys',uciLicenseId:'10065004835',bonusSeconds:null},
      {id:'11',rank:2,riderDisplay:'Michael Vanthourenhout',uciLicenseId:'10007155651',bonusSeconds:null},
      {id:'12',rank:3,riderDisplay:'Gerben Kuypers',uciLicenseId:'10016322757',bonusSeconds:null},
      {id:'13',rank:null,irm:'DNF',riderDisplay:'Victor Van de Putte',uciLicenseId:'10064985940',bonusSeconds:null},
      {id:'14',rank:4,riderDisplay:'Pim Ronhaar',uciLicenseId:'10023108212',bonusSeconds:null}],...extra});
  const client=(candidates,applied={unchanged:false,rows:5})=>{
    const rpc=[];
    return {rpc,query:async(sql,params)=>{
      if(sql.includes('cx_bonus_candidates'))return {rows:candidates};
      rpc.push(params);
      if(applied instanceof Error)throw applied;
      return {rows:[{applied}]};
    }};
  };
  const fetchers={fetchTree:async()=>tree,fetchTable:async(_ctx,key)=>read(key==='RES31'?'res':'best')};
  it('aplica los bonos de todas las filas con la fuente y sus premios como evidencia',async()=>{
    const db=client([candidate()]);const contexts=[];
    const value=await collectCxRoundBonuses(db,{now:after,...fetchers,fetchTree:async ctx=>{contexts.push(ctx);return tree;}});
    expect(contexts).toEqual(['20261101_x2o']);
    expect(value).toMatchObject({candidates:1,applied:[{raceId:'koppenberg',category:'ME'}],reviews:[],pending:[]});
    const [[raceId,category,bonuses,evidence]]=db.rpc;
    expect([raceId,category]).toEqual(['koppenberg','ME']);
    expect(JSON.parse(bonuses)).toEqual({10:15,11:20,12:10,13:15,14:0});
    expect(JSON.parse(evidence)).toMatchObject({bonusSourceUrl:'https://results.chronorace.be/api/results/table/search/20261101_x2o/RES31?srch=&fromRecord=0&pageSize=1000',
      bonusEvidence:{context:'20261101_x2o',awards:expect.arrayContaining([expect.objectContaining({name:'KUYPERS Gerben',seconds:10,lap:2})])}});
  });
  it('con bonos cargados no consulta Chronorace salvo en la comprobación periódica, que es idempotente',async()=>{
    const known=candidate({bonusSourceUrl:'https://results.chronorace.be/x'});known.rows=known.rows.map(row=>({...row,bonusSeconds:0}));
    let trees=0;const countTree=async()=>{trees++;return tree;};
    const idle=client([known]);
    expect(await collectCxRoundBonuses(idle,{now:after,...fetchers,fetchTree:countTree})).toMatchObject({candidates:1,applied:[],unchanged:[]});
    expect(trees).toBe(0);expect(idle.rpc).toHaveLength(0);
    const check=client([known],{unchanged:true});
    expect(await collectCxRoundBonuses(check,{now:new Date('2026-11-01T16:30:00Z'),...fetchers,fetchTree:countTree})).toMatchObject({unchanged:[{category:'ME'}],applied:[]});
    expect(trees).toBe(1);
    const manual=client([known],{unchanged:true,skipped:'other_source'});
    expect(await collectCxRoundBonuses(manual,{now:new Date('2026-11-01T16:30:00Z'),...fetchers})).toMatchObject({skipped:[{category:'ME'}],unchanged:[]});
  });
  it('sin informe o con la tabla aún cambiando espera; pasadas 6 horas lo deja en revisión',async()=>{
    const absent={fetchTree:async()=>null,fetchTable:async()=>{throw new Error('No se consulta');}};
    const soon=client([candidate()]);
    expect(await collectCxRoundBonuses(soon,{now:after,...absent})).toMatchObject({pending:[{reason:expect.stringContaining('20261101_x2o sin publicar')}],reviews:[]});
    expect(soon.rpc).toHaveLength(0);
    expect(await collectCxRoundBonuses(client([candidate()]),{now:new Date('2026-11-01T22:00:00Z'),...absent})).toMatchObject({pending:[],reviews:[{category:'ME'}]});
    const live=client([candidate()]);
    expect(await collectCxRoundBonuses(live,{now:new Date('2026-11-01T15:13:00Z'),...fetchers})).toMatchObject({pending:[{reason:'Chronorace aún actualiza el informe'}]});
    expect(live.rpc).toHaveLength(0);
    const down=client([candidate()]);
    expect(await collectCxRoundBonuses(down,{now:after,...fetchers,fetchTree:async()=>{throw new Error('HTTP 503');}})).toMatchObject({pending:[{reason:'Chronorace no responde: HTTP 503'}],reviews:[]});
  });
  it('sin bonos pasado el plazo sigue en revisión en cada pasada y solo consulta en la comprobación periódica',async()=>{
    const late=new Date('2026-11-05T09:07:00Z');let trees=0;
    const value=await collectCxRoundBonuses(client([candidate()]),{now:late,fetchTree:async()=>{trees++;return null;},fetchTable:fetchers.fetchTable});
    expect(trees).toBe(0);expect(value).toMatchObject({reviews:[{category:'ME',reason:expect.stringContaining('cada 30 minutos')}],pending:[]});
    const check=await collectCxRoundBonuses(client([candidate()]),{now:new Date('2026-11-05T09:30:00Z'),fetchTree:async()=>{trees++;return null;},fetchTable:fetchers.fetchTable});
    expect(trees).toBe(1);expect(check).toMatchObject({reviews:[{reason:expect.stringContaining('sin publicar')}],pending:[]});
    const published=client([candidate()]);
    expect(await collectCxRoundBonuses(published,{now:new Date('2026-11-05T09:30:00Z'),...fetchers})).toMatchObject({applied:[{category:'ME'}],reviews:[]});
  });
  it('con bonos cargados, un informe que no responde no es una revisión',async()=>{
    const known=candidate({bonusSourceUrl:'https://results.chronorace.be/x'});known.rows=known.rows.map(row=>({...row,bonusSeconds:0}));
    const value=await collectCxRoundBonuses(client([known]),{now:new Date('2026-11-02T06:30:00Z'),...fetchers,fetchTree:async()=>{throw new Error('HTTP 503');}});
    expect(value).toMatchObject({reviews:[],pending:[{reason:'Chronorace no responde: HTTP 503'}]});
  });
  it('un fallo al leer los bonos deja la pasada parcial sin detener oficializaciones, generales ni avisos',async()=>{
    const order=[];
    const value=await runCxPipeline(pipelineClient([]),{now,collectBonuses:async()=>{throw new Error('statement timeout');},
      promote:async()=>{order.push('promote');return {promoted:0,categories:[]};},processQueue:async()=>{order.push('standings');return [];},
      enqueuePushes:async()=>{order.push('pushes');return {found:0,scheduled:0,updated:0,cancelled:0};}});
    expect(order).toEqual(['promote','standings','pushes']);
    expect(value).toMatchObject({status:'partial',bonuses:{reviews:[{reason:'Lectura de bonos: statement timeout'}]}});
    expect(sourceRun('chronorace_cx')).toMatchObject({status:'warning'});
  });
  it('un premiado sin fila queda en revisión sin escribir y una clasificación reemplazada se reintenta',async()=>{
    const missing=candidate();missing.rows=missing.rows.filter(row=>row.id!=='12');
    const db=client([missing]);
    expect(await collectCxRoundBonuses(db,{now:after,...fetchers})).toMatchObject({applied:[],reviews:[{reason:expect.stringContaining('KUYPERS')}]});
    expect(db.rpc).toHaveLength(0);
    const conflict=Object.assign(new Error('La clasificación cambió'),{code:'40001'});
    expect(await collectCxRoundBonuses(client([candidate()],conflict),{now:after,...fetchers})).toMatchObject({applied:[],reviews:[],pending:[{category:'ME'}]});
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

function zone4Fixture(id='own-zone4'){
  const {context}=fixture(id);context.link=null;
  context.categories[0].startTimeUtc='2026-11-01T13:00:00Z';
  context.categories.push({...context.categories[0],category:'MJ'});
  context.timingLink={raceId:id,provider:'zone4',categoryKeys:{'2026-11-01/bb48534c/Elite M/H':'ME','2026-11-01/bb48534c/U19 M/H':'MJ'},
    syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const T0=Date.parse('2026-11-01T13:00:00Z')*1000;
  const tree={date:['2026-11-01',null],name:['Sunday Wave 8-9',1],_child_startgroups:[{uuid:['sg',null],recorded_start_time:[T0,1]}],
    _child_courses:[{uuid:['c-me',null],points_list:[[{mode:'start'},{mode:'lap'}],1]},{uuid:['c-mj',null],points_list:[[{mode:'start'},{mode:'lap'}],1]}],
    _child_resultformats:[{uuid:['bb48534c-x',null],name:['Overall',1],_child_resultgroups:[
      {name:['Elite M/H',1],description:['Official',1],criteria_list:[[{course:'c-me'}],1]},
      {name:['U19 M/H',1],description:['Unofficial',1],criteria_list:[[{course:'c-mj'}],1]}]}],
    _child_racers:[{bib:['1',1],first_name:['A',1],last_name:['PRUEBA',1],nat:['ESP',1],team:['TEAM X',1],
      _child_timedentitys:[{course:['c-me',1],startgroup:['sg',1],time_1_list:[[T0+3600e6,'d'],1]}]}]};
  let fetches=0;
  return {context,fetchTree:async url=>{fetches++;return {date:'2026-11-01',formatId:'bb48534c',resultsUrl:url,tree};},fetches:()=>fetches};
}
describe('recogida CX desde Zone4',()=>{
  it('importa provisional los grupos «Official» y deja pendientes los demás',async()=>{
    const {context,fetchTree,fetches}=zone4Fixture();
    const client=collectorClient([context]);
    const value=await collectCxZone4Race(client,context.race.id,{now,fetchTree});
    expect(value).toMatchObject({provider:'zone4',status:'ok',rowsFound:1,rowsChanged:1,reviews:[]});
    expect(value.pending).toEqual([{category:'MJ',reason:'Clasificación no marcada «Official» en Zone4; se reintenta en la siguiente pasada'}]);
    expect(fetches()).toBe(1);
    const [prepared]=client.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'zone4',zone4:{key:'2026-11-01/bb48534c/Elite M/H',status:'Official'}});
    expect(prepared.imports[0].rows[0]).toMatchObject({globalRiderId:'own-rider',timeSeconds:'3600'});
  });
  it('no sustituye categorías oficiales y despacha desde collectCxRace',async()=>{
    const official=zone4Fixture('official');Object.assign(official.context.categories[0],{resultsProvider:'zone4',resultsStatus:'official'});
    const officialClient=collectorClient([official.context]);
    const kept=await collectCxZone4Race(officialClient,'official',{now,fetchTree:official.fetchTree});
    expect(kept.skipped[0].reason).toContain('ya oficiales');expect(officialClient.ingests).toHaveLength(0);

    const only=zone4Fixture('only');const client=collectorClient([only.context]);let acn=0;
    const value=await collectCxRace(client,'only',{now,fetchTree:only.fetchTree,fetchTables:async()=>{acn++;}});
    expect(value).toMatchObject({provider:'zone4',rowsChanged:1});expect(acn).toBe(0);
  });
});

// Directo real del Europeo UEC 2025 (20251108_uec): la élite masculina terminada el domingo 9.
function chronoraceXcoFixture(id='own-xco'){
  const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/chronorace-xco-uec-2025-${name}.json`,import.meta.url),'utf8'));
  const {context}=fixture(id);context.link=null;
  Object.assign(context.race,{seasonKey:'2025-26',seasonStartYear:2025,dateKey:'2025-11-08',endDateKey:'2025-11-09',timezone:'Europe/Brussels'});
  Object.assign(context.categories[0],{dateKey:'2025-11-09',startTimeUtc:'2025-11-09T14:00:00Z'});
  context.categories.push({...context.categories[0],category:'WJ',startTimeUtc:'2025-11-09T14:30:00Z'});
  context.timingLink={raceId:id,provider:'chronorace_xco',ctx:'20251108_uec',categoryKeys:{},
    syncEnabled:true,syncStartOffsetMinutes:-20,syncStopOffsetMinutes:180,syncIntervalMinutes:1};
  const me=read('me'),wj=read('wj');wj.overview.Status='Running';
  const urls=[];
  const fetchJson=async url=>{urls.push(url);
    if(url.includes('/dh?key=cms'))return read('tree');
    const manga=url.endsWith('/ME')?me:wj;return url.includes('/overview/')?manga.overview:manga.registration;};
  return {context,fetchJson,urls};
}
describe('recogida CX desde el visor UCI de Chronorace',()=>{
  const at=new Date('2025-11-09T15:10:00Z');
  it('importa oficial la manga terminada y deja pendiente la que sigue en curso',async()=>{
    const {context,fetchJson,urls}=chronoraceXcoFixture();
    const client=collectorClient([context]);
    const value=await collectCxChronoraceXcoRace(client,context.race.id,{now:at,fetchJson});
    expect(value).toMatchObject({provider:'chronorace_xco',rowsFound:27});
    expect(value.pending).toEqual([{category:'WJ',reason:'Manga sin terminar en Chronorace (Running); se reintenta en la siguiente pasada'}]);
    expect(urls.filter(url=>url.includes('/xco/'))).toHaveLength(4);
    const [prepared]=client.ingests;
    expect(prepared.status).toBe('official');
    expect(prepared.imports[0].category).toBe('ME');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'chronorace_xco',dateKey:'2025-11-09',chronoraceXco:{ctx:'20251108_uec',category:'ME'},
      officialReviewed:true,officialReviewSourceUrl:'https://prod.chronorace.be/angular/results.html#/uci/event/20251108_uec/CRO/CG21/xco/ME/ov'});
  });
  it('no sustituye oficiales de otra fuente, corrige las suyas y despacha desde collectCxRace',async()=>{
    const official=chronoraceXcoFixture('official');
    for(const manga of official.context.categories)Object.assign(manga,{resultsProvider:'dataride',resultsStatus:'official'});
    const officialClient=collectorClient([official.context]);
    const kept=await collectCxChronoraceXcoRace(officialClient,'official',{now:at,fetchJson:official.fetchJson});
    expect(kept.skipped.map(item=>item.reason)).toEqual(Array(2).fill('Resultados oficiales de otra fuente; Chronorace no los sustituye'));
    expect(official.urls).toHaveLength(0);expect(officialClient.ingests).toHaveLength(0);

    const own=chronoraceXcoFixture('own');Object.assign(own.context.categories[0],{resultsProvider:'chronorace_xco',resultsStatus:'official'});
    const ownClient=collectorClient([own.context]);
    await collectCxChronoraceXcoRace(ownClient,'own',{now:at,fetchJson:own.fetchJson});
    expect(ownClient.ingests.map(prepared=>[prepared.status,prepared.imports[0].category])).toEqual([['official','ME']]);

    const only=chronoraceXcoFixture('only');const client=collectorClient([only.context]);let acn=0;
    const value=await collectCxRace(client,'only',{now:at,fetchJson:only.fetchJson,fetchTables:async()=>{acn++;}});
    expect(value).toMatchObject({provider:'chronorace_xco',rowsFound:27});expect(acn).toBe(0);
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

// Campeonato de Letonia 07-11-2026 en fotofiniss.lv: tabla W18 tras la salida 4 (vuelta más lenta 11:48).
const FOTOFINISS_URL='https://fotofiniss.lv/sacensibas/latvijas-cempionats-velokrosa-cx-2026/rezultati';
const fotofinissHtml=readFileSync(new URL('./fixtures/fotofiniss-lc-cx-2026-grupas.html',import.meta.url),'utf8');
function fotofinissFixture(id='own-fotofiniss'){
  const {context}=fixture(id);context.link=null;
  Object.assign(context.race,{class:'CN',countryCode:'LV'});
  Object.assign(context.categories[0],{category:'WJ',startTimeUtc:'2026-11-01T13:40:00Z'});
  context.riders={men:[],women:[{id:'lange-lauma',firstName:'Lauma',lastName:'Lange',nationality:'LV',birthDate:'2009-12-04',verified:true}]};
  context.timingLink={raceId:id,provider:'fotofiniss',sourceUrl:FOTOFINISS_URL,categoryKeys:{W18:'WJ'},
    syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  return {context,fetchGroups:async()=>({resultsUrl:FOTOFINISS_URL,groups:parseFotofinissGroups(fotofinissHtml)})};
}
describe('recogida CX desde fotofiniss',()=>{
  it('espera 1,5 veces la vuelta más lenta sin cambios y después importa provisional',async()=>{
    const first=fotofinissFixture();const recent=smartwebClient([first.context],new Date(now.getTime()-5*60000).toISOString());
    const waiting=await collectCxFotofinissRace(recent,first.context.race.id,{now,fetchGroups:first.fetchGroups});
    expect(waiting).toMatchObject({provider:'fotofiniss',status:'ok',rowsChanged:0});
    expect(waiting.pending).toEqual([{category:'WJ',reason:'Grupo fotofiniss en curso o modificado; se publica tras 18 min sin cambios'}]);
    expect(recent.ingests).toHaveLength(0);

    const second=fotofinissFixture();const stable=smartwebClient([second.context],new Date(now.getTime()-18*60000).toISOString());
    const value=await collectCxFotofinissRace(stable,second.context.race.id,{now,fetchGroups:second.fetchGroups});
    // Las tres juniors sin ficha en el doble quedan como avisos: la ingesta crea sus fichas.
    expect(value).toMatchObject({provider:'fotofiniss',status:'partial',rowsFound:4,rowsChanged:4,reviews:[],warningCount:3});
    const [prepared]=stable.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'fotofiniss',fotofiniss:{sourceUrl:FOTOFINISS_URL,group:'W18'}});
    expect(prepared.imports[0].rows.map(row=>[row.rank,row.irm,row.globalRiderId,row.isoCode2])).toEqual([
      [1,null,'lange-lauma','LV'],[2,'LAP',null,'LV'],[3,'LAP',null,'LV'],[4,'LAP',null,'LV']]);
  });
  it('sin Campeonato Nacional no deduce la nacionalidad y despacha desde collectCxRace',async()=>{
    const open=fotofinissFixture('open');open.context.race.class='C2';
    const client=smartwebClient([open.context],new Date(now.getTime()-18*60000).toISOString());
    const value=await collectCxRace(client,'open',{now,fetchGroups:open.fetchGroups});
    expect(value).toMatchObject({provider:'fotofiniss',rowsChanged:4});
    expect(client.ingests[0].imports[0].rows.map(row=>row.isoCode2)).toEqual(['LV',null,null,null]);
  });
});

// Campeonatos Panamericanos 08-11-2025 en RaceResult (evento 370461): listas finales de ME y MJ.
const RACERESULT_URL='https://my.raceresult.com/370461/';
const raceresultList=name=>parseRaceresultList(JSON.parse(readFileSync(new URL(`./fixtures/raceresult-panam-2025-${name}.json`,import.meta.url),'utf8'))).rows;
function raceresultFixture(id='own-raceresult',{category='ME',contest='24',contestName='Elite Men',rows=raceresultList('me')}={}){
  const {context}=fixture(id);context.link=null;
  Object.assign(context.race,{class:'CC',countryCode:'US'});
  Object.assign(context.categories[0],{category,startTimeUtc:category==='ME'?'2026-11-01T14:00:00Z':'2026-11-01T13:40:00Z'});
  context.riders={men:[{id:'strohmeyer-andrew',firstName:'Andrew',lastName:'Strohmeyer',nationality:'US',birthDate:null,verified:true}],women:[]};
  context.timingLink={raceId:id,provider:'raceresult',sourceUrl:RACERESULT_URL,categoryKeys:{[contest]:category},
    syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  const fetchContests=async()=>({eventUrl:RACERESULT_URL,eventName:'2025 Pan American Cyclocross Championships',eventOver:true,
    contests:[{key:contest,contest,selector:null,contestName,listName:'03: Online Results|Overall Results',headline:`Overall Results ${contestName}`,rows}]});
  return {context,fetchContests};
}
describe('recogida CX desde RaceResult',()=>{
  it('espera 4 min sin cambios con todos los inscritos clasificados y después importa provisional',async()=>{
    const first=raceresultFixture();const recent=smartwebClient([first.context],new Date(now.getTime()-2*60000).toISOString());
    const waiting=await collectCxRaceresultRace(recent,first.context.race.id,{now,fetchContests:first.fetchContests});
    expect(waiting).toMatchObject({provider:'raceresult',status:'ok',rowsChanged:0});
    expect(waiting.pending).toEqual([{category:'ME',reason:'Concurso RaceResult en curso o modificado; se publica tras 4 min sin cambios'}]);
    expect(recent.ingests).toHaveLength(0);

    const second=raceresultFixture();const stable=smartwebClient([second.context],new Date(now.getTime()-5*60000).toISOString());
    const value=await collectCxRaceresultRace(stable,second.context.race.id,{now,fetchContests:second.fetchContests});
    expect(value).toMatchObject({provider:'raceresult',rowsFound:27,rowsChanged:27,reviews:[]});
    const [prepared]=stable.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'raceresult',raceresult:{sourceUrl:RACERESULT_URL,contest:'24'}});
    expect(prepared.imports[0].rows.slice(0,2).map(row=>[row.rank,row.globalRiderId,row.isoCode2,row.timeSeconds])).toEqual([
      [1,'strohmeyer-andrew','US','3680'],[2,null,null,'3731']]);
  });
  it('con inscritos sin puesto ni estado espera 20 min, los deja fuera y despacha desde collectCxRace',async()=>{
    const rows=raceresultList('mj').map(row=>row.place==='DNS'?{...row,place:''}:row);
    const open=raceresultFixture('open',{category:'MJ',contest:'19',contestName:'Junior Men',rows});
    const recent=smartwebClient([open.context],new Date(now.getTime()-5*60000).toISOString());
    const waiting=await collectCxRace(recent,'open',{now,fetchContests:open.fetchContests});
    expect(waiting.pending).toEqual([{category:'MJ',reason:'Concurso RaceResult en curso o modificado (3 inscritos sin puesto ni estado); se publica tras 20 min sin cambios'}]);
    expect(recent.ingests).toHaveLength(0);

    const again=raceresultFixture('open',{category:'MJ',contest:'19',contestName:'Junior Men',rows});
    const stable=smartwebClient([again.context],new Date(now.getTime()-21*60000).toISOString());
    const value=await collectCxRace(stable,'open',{now,fetchContests:again.fetchContests});
    expect(value).toMatchObject({provider:'raceresult',status:'partial',rowsChanged:48});
    expect(value.reviews).toEqual([{category:'MJ',reason:'3 inscritos sin puesto ni estado en RaceResult quedan fuera de la clasificación'}]);
    expect(stable.ingests[0].imports[0].rows.filter(row=>row.irm==='DNS')).toEqual([]);
  });
  it('no sustituye una categoría oficial ni lee un concurso de otra categoría',async()=>{
    const official=raceresultFixture('official');Object.assign(official.context.categories[0],{resultsProvider:'dataride',resultsStatus:'official'});
    let fetched=false;
    const value=await collectCxRaceresultRace(smartwebClient([official.context],now.toISOString()),'official',{now,fetchContests:async()=>{fetched=true;return {};}});
    expect(fetched).toBe(false);
    expect(value.skipped).toEqual([{category:'ME',reason:'Resultados ya oficiales; RaceResult no los sustituye'}]);

    const wrong=raceresultFixture('wrong',{contestName:'Elite Women'});
    const client=smartwebClient([wrong.context],new Date(now.getTime()-5*60000).toISOString());
    const rejected=await collectCxRaceresultRace(client,'wrong',{now,fetchContests:wrong.fetchContests});
    expect(rejected.reviews).toEqual([{category:'ME',reason:'RaceResult: Concurso 24 «Elite Women» no corresponde a ME'}]);
    expect(client.ingests).toHaveLength(0);
  });
});

// Elite masculina del Koppenbergcross 01-11-2026 (60 min) en koppenbergcross.be: tabla en directo y tabla final.
const GOLAZO_SITE='https://www.koppenbergcross.be/';
const golazoHtml=name=>readFileSync(new URL(`./fixtures/golazo-koppenbergcross-2026-me-${name}.html`,import.meta.url),'utf8');
function golazoFixture(id,{html,sourceState={},manga={}}){
  const {context}=fixture(id);context.link=null;
  Object.assign(context.categories[0],{durationMinutes:60,...manga});
  context.timingLink={raceId:id,provider:'kbwb',categoryKeys:{'14995':'ME'},syncEnabled:true,syncStartOffsetMinutes:-15,syncStopOffsetMinutes:720,syncIntervalMinutes:5};
  context.golazoLink={raceId:id,provider:'golazo',sourceUrl:GOLAZO_SITE,categoryKeys:{'uitslagen-elite-mannen':'ME'},syncEnabled:true,
    syncStartOffsetMinutes:-20,syncStopOffsetMinutes:180,syncIntervalMinutes:1,lastFetchAt:null,sourceState};
  let fetches=0;
  return {context,fetches:()=>fetches,fetchPages:async(siteUrl,map)=>{fetches++;return Object.entries(map).map(([page,category])=>({url:`${siteUrl}${page}/`,page,category,html}));}};
}
// sourceState que la pasada guarda en el enlace (último parámetro de su actualización).
const golazoState=client=>JSON.parse(client.calls.at(-1).at(-1));
describe('recogida CX desde Golazo',()=>{
  const at=minutes=>new Date(Date.parse('2026-11-01T15:00:00Z')+minutes*60000);
  it('sigue al líder en directo e importa provisional la tabla final estable',async()=>{
    const live=golazoFixture('golazo',{html:golazoHtml('live')});const liveClient=collectorClient([live.context]);
    const first=await collectCxGolazoRace(liveClient,'golazo',{now:at(0),fetchPages:live.fetchPages});
    expect(first).toMatchObject({provider:'golazo',status:'ok',rowsChanged:0});
    expect(first.pending[0].reason).toContain('dos pasos');expect(liveClient.ingests).toHaveLength(0);

    const final=golazoFixture('golazo',{html:golazoHtml('final'),sourceState:golazoState(liveClient)});const finalClient=collectorClient([final.context]);
    const second=await collectCxGolazoRace(finalClient,'golazo',{now:at(15),fetchPages:final.fetchPages});
    expect(second.pending[0].reason).toContain('sin cambios');expect(finalClient.ingests).toHaveLength(0);

    // La misma tabla con otra caché siete minutos después.
    const recached=golazoHtml('final').replace(/cache x2o (\S+) \S+/,'cache x2o $1 16:25:00');
    const stable=golazoFixture('golazo',{html:recached,sourceState:golazoState(finalClient)});const stableClient=collectorClient([stable.context]);
    const third=await collectCxGolazoRace(stableClient,'golazo',{now:at(22),fetchPages:stable.fetchPages});
    expect(third).toMatchObject({provider:'golazo',rowsChanged:third.rowsFound});
    const [prepared]=stableClient.ingests;
    expect(prepared.status).toBe('provisional');
    expect(prepared.imports[0].evidence).toMatchObject({inputSource:'golazo',golazo:{sourceUrl:GOLAZO_SITE,page:'uitslagen-elite-mannen'}});
    expect(prepared.imports[0].evidence.sourceGeneratedAt).toBeUndefined();
  });
  it('no consulta categorías cargadas desde otra fuente y despacha desde collectCxRace',async()=>{
    const kbwb=golazoFixture('kbwb',{html:golazoHtml('final'),manga:{resultsStatus:'provisional',resultsProvider:'kbwb'}});
    const value=await collectCxGolazoRace(collectorClient([kbwb.context]),'kbwb',{now:at(15),fetchPages:kbwb.fetchPages});
    expect(value).toMatchObject({provider:'golazo',status:'skipped',decisions:[]});expect(kbwb.fetches()).toBe(0);

    const only=golazoFixture('only',{html:golazoHtml('live')});only.context.timingLink=null;
    expect(await collectCxRace(collectorClient([only.context]),'only',{now:at(0),fetchPages:only.fetchPages})).toMatchObject({provider:'golazo',status:'ok'});
    expect(only.fetches()).toBe(1);
  });
});
