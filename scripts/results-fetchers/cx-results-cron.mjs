#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createCxDataRideClient, fetchCxCompetition } from './cx-dataride-results.mjs';
import { acnVersionMs, buildAcnCxDocument, fetchAcnTables } from './acn-cx-fetch.mjs';
import { processCxCategoryDocuments } from './cx-category-batches.mjs';
import { applyCxResults, loadCxResultsContext, prepareCxResults } from './cx-results-upsert.mjs';
import { cxSyncDecision } from './cx-sync-window.mjs';
import { processStandingsQueue } from '../cx/cx-recompute-standings.mjs';
import { finishAutomationRun, openAutomationClient, recordAutomationSourceRun, startAutomationRun } from '../automation-monitor.mjs';
import { databaseUrl } from '../db/env.mjs';

// Una sola lectura: enlaces DataRide y enlaces de cronometraje (`link.provider='acn'`).
const CX_CANDIDATE_CATEGORIES=`(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('resultsLastFetchAt',s."lastFetchAt") ORDER BY c."sortOrder",c.category),'[]')
      FROM public.cx_race_categories c LEFT JOIN private.cx_results_fetch_state s ON s."raceId"=c."raceId" AND s.category=c.category
      WHERE c."raceId"=r.id AND coalesce(c."dateKey",r."dateKey") BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
      AND extract(month FROM coalesce(c."dateKey",r."dateKey")) IN (8,9,10,11,12,1,2)) AS categories`;
const CX_CANDIDATE_RACE_FILTER=`r."editorialStatus"='published' AND NOT r."isCancelled"
      AND r."dateKey">=make_date(r."seasonStartYear",8,1) AND coalesce(r."endDateKey",r."dateKey")<make_date(r."seasonStartYear"+1,3,1)
      AND extract(month FROM r."dateKey") IN (8,9,10,11,12,1,2)
      AND extract(month FROM coalesce(r."endDateKey",r."dateKey")) IN (8,9,10,11,12,1,2)`;
export async function loadCxSyncCandidates(client) {
  const {rows}=await client.query(`/* cx_sync_candidates */ SELECT race,link,categories FROM (
    SELECT to_jsonb(r) AS race,to_jsonb(l) AS link,${CX_CANDIDATE_CATEGORIES},l."lastFetchAt" AS fetched,r."dateKey" AS day,r.id AS rid
    FROM public.cx_race_uci_links l JOIN public.cx_races r ON r.id=l."raceId"
    WHERE l."disciplineId"=3 AND l."syncEnabled" AND ${CX_CANDIDATE_RACE_FILTER}
    UNION ALL
    SELECT to_jsonb(r),to_jsonb(l)||jsonb_build_object('disciplineId',3),${CX_CANDIDATE_CATEGORIES},l."lastFetchAt",r."dateKey",r.id
    FROM public.cx_race_timing_links l JOIN public.cx_races r ON r.id=l."raceId"
    WHERE l."syncEnabled" AND ${CX_CANDIDATE_RACE_FILTER}
  ) q ORDER BY fetched NULLS FIRST,day,rid`);
  return rows;
}
const decisions=(context,options)=>context.categories.filter(c=>(!options.category||c.category===options.category)&&(!options.categories||options.categories.includes(c.category)))
  .map(manga=>({category:manga.category,...cxSyncDecision(context.race,manga,context.link,options)}));
const sameLink=(left,right)=>left&&right&&['raceId','disciplineId','competitionId','seasonId','uciRaceId'].every(key=>left[key]===right[key]);

async function recordLink(client,link,status,error=null) {
  // No actualizar la metadata de un enlace que el administrador reasignó durante el fetch.
  await client.query(`UPDATE public.cx_race_uci_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND "disciplineId"=3 AND "competitionId"=$4 AND "seasonId"=$5 AND "uciRaceId"=$6`,
  [status,error,link.raceId,link.competitionId,link.seasonId,link.uciRaceId]);
}
async function recordCategoryAttempts(client,link,categories) {
  if(!categories.length)return;
  // La marca es por categoría y solo se conserva si el enlace sigue apuntando a
  // la misma competición que originó la consulta.
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_uci_links l
        WHERE l."raceId"=c."raceId" AND l."disciplineId"=3 AND l."competitionId"=$3
          AND l."seasonId"=$4 AND l."uciRaceId"=$5)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,
  [link.raceId,categories,link.competitionId,link.seasonId,link.uciRaceId]);
}

const ACN_STABLE_MS=5*60000;
// ACN no marca la meta: una tabla en curso con el cronometraje parado no debe publicarse como terminada.
// Con el ganador en el 80 % de la duración prevista basta una espera corta; sin ella, la general.
const ACN_MIN_DURATION_RATIO=0.8;
const ACN_STABLE_REACHED_MS=2*60000;
const sameTiming=(left,right)=>left&&right&&['raceId','eventId','ctx'].every(key=>left[key]===right[key]);
async function recordTimingLink(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='acn' AND "eventId"=$4 AND ctx=$5`,[status,error,link.raceId,link.eventId,link.ctx]);
}
async function recordTimingAttempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider='acn' AND l."eventId"=$3 AND l.ctx=$4)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,link.eventId,link.ctx]);
}

/**
 * Recogida desde ACN Timing (cronometraje del organizador). Publica solo
 * `provisional`: ACN no es la UCI, y la clasificación solo se importa cuando
 * lleva sin cambios ACN_STABLE_REACHED_MS (el ganador alcanza ACN_MIN_DURATION_RATIO
 * de `durationMinutes`) o ACN_STABLE_MS (categoría sin duración acreditada) y el
 * ganador tiene tiempo. Con duración acreditada y ganador por debajo del umbral
 * no se publica. Nunca sustituye
 * una categoría oficial (DataRide o promovida por fecha) ni una protegida.
 */
export async function collectCxAcnRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchTables=fetchAcnTables,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(!originalLink)return {raceId,provider:'acn',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'acn',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const {event,tables,skipped:ignored}=await fetchTables({eventId:originalLink.eventId,ctx:originalLink.ctx,only:attemptedCategories,
      map:originalLink.categoryKeys||{},date:context.race.dateKey});
    const document=buildAcnCxDocument({event,ctx:originalLink.ctx,tables,raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,
      sourceUrl:`https://www.acn-timing.com/?lng=EN#/events/${originalLink.eventId}/ctx/${originalLink.ctx}/cms`,source:'acn'});
    const reviews=attemptedCategories.filter(value=>!document.categories.some(c=>c.category===value)).map(value=>({category:value,reason:'Clasificación no disponible en ACN Timing'}));
    const publishable=[];const providerOfficial=[];
    for(const manga of document.categories){
      if(!attemptedCategories.includes(manga.category))continue;
      const own=context.categories.find(c=>c.category===manga.category);
      if(own?.resultsStatus==='official'){providerOfficial.push({category:manga.category,reason:own.resultsProvider==='dataride'
        ?'Resultados oficiales de DataRide; ACN no los sustituye':'Resultados ya oficiales; ACN no los sustituye'});continue;}
      const updatedAt=Date.parse(manga.sourceUpdatedAt);
      const winner=manga.rows.find(row=>row.rank===1&&!row.irm);
      const winnerSeconds=winner?.timeSeconds==null?null:Number(winner.timeSeconds);
      const planned=Number(own?.durationMinutes);const hasPlanned=Number.isFinite(planned)&&planned>0;
      const reached=hasPlanned&&winnerSeconds!=null&&winnerSeconds>=planned*60*ACN_MIN_DURATION_RATIO;
      if(!Number.isFinite(updatedAt)||new Date(now).getTime()-updatedAt<(reached?ACN_STABLE_REACHED_MS:ACN_STABLE_MS)){
        reviews.push({category:manga.category,reason:'ACN Timing aún actualiza la clasificación; se reintenta en la siguiente pasada'});continue;
      }
      if(winner?.timeSeconds==null||BigInt(winner.timeSeconds)<=0n){reviews.push({category:manga.category,reason:'Meta sin tiempo de ganador en ACN Timing; revisar antes de importar'});continue;}
      if(hasPlanned&&!reached){
        reviews.push({category:manga.category,reason:`Tiempo del ganador en ACN Timing (${Math.floor(winnerSeconds/60)} min) inferior al ${ACN_MIN_DURATION_RATIO*100} % de la duración prevista (${planned} min); se reintenta en la siguiente pasada`});continue;
      }
      publishable.push(manga);
    }
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameTiming(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace ACN cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of publishable.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordTimingAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.filter(c=>attemptedCategories.includes(c.category)).reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordTimingLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'acn',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,skipped:[...processed.skipped,...providerOfficial,...(ignored||[])],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink&&attemptedCategories.length&&!attemptsRecorded)await recordTimingAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink)await recordTimingLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'acn',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

export async function collectCxRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,dataRideClient=createCxDataRideClient(),fetchCompetition=fetchCxCompetition,fetchTables=fetchAcnTables}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=await loadCxResultsContext(client,raceId);originalLink=context.link;
    // Carrera solo con enlace de cronometraje: la recogida pertenece a ACN.
    if(!originalLink&&context.timingLink)return await collectCxAcnRace(client,raceId,{now,manual,category,categories,fetchTables,context});
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions(context,{now,manual,category,categories});attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const document=await fetchCompetition({competitionId:originalLink.competitionId,seasonId:originalLink.seasonId,
      uciRaceId:originalLink.uciRaceId>0?originalLink.uciRaceId:null,categories:attemptedCategories,client:dataRideClient});
    const reviews=attemptedCategories.filter(value=>!document.categories.some(c=>c.category===value)).map(category=>({category,reason:'Clasificación de meta no disponible en DataRide'}));
    const publishable=[];
    for(const manga of document.categories){
      const winner=manga.rows.find(row=>row.rank===1&&!row.irm);
      if(!attemptedCategories.includes(manga.category))continue;
      if(manga.publicationHint==='not_published'||winner?.timeSeconds==null||BigInt(winner.timeSeconds)<=0n){
        reviews.push({category:manga.category,reason:'Meta sin tiempo de ganador; revisar la publicación antes de importar'});continue;
      }
      publishable.push(manga);
    }
    // Volver a resolver el catálogo después de la red. Si el enlace cambió, el
    // documento antiguo no se aplica a la nueva competición.
    const fresh=await loadCxResultsContext(client,raceId);
    const stillDue=sameLink(originalLink,fresh.link)
      ?decisions(fresh,{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!sameLink(originalLink,fresh.link))reviews.push({category:null,reason:'El enlace DataRide cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of publishable.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordCategoryAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'official',officialUciResults:true}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.filter(c=>attemptedCategories.includes(c.category)).reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink&&attemptedCategories.length&&!attemptsRecorded)await recordCategoryAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink)await recordLink(client,originalLink,'error',error.message.slice(0,4000));
    return {raceId,status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}
export function cxMadridDate(now) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export async function enqueueCxAutomaticPushes(client) {
  const {rows:[{pushes}]}=await client.query('SELECT private.cx_enqueue_automatic_pushes() AS pushes');
  return pushes;
}

/**
 * Las clasificaciones provisionales pasan a oficiales al comenzar el día civil
 * (Europe/Madrid) siguiente al de su manga. La RPC solo cambia el estado.
 */
export async function promoteCxProvisionalResults(client,{now=new Date()}={}) {
  const {rows:[{promoted}]}=await client.query('SELECT private.cx_promote_provisional_results($1::timestamptz) AS promoted',[new Date(now).toISOString()]);
  return promoted;
}

export async function runCxPipeline(client,{now=new Date(),dryRun=false,limit=2,standingsLimit=20,
  collect=collectCxRace,collectAcn=collectCxAcnRace,dataRideClient=createCxDataRideClient(),promote=promoteCxProvisionalResults,processQueue=processStandingsQueue,enqueuePushes=enqueueCxAutomaticPushes}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(standingsLimit)||standingsLimit<1||standingsLimit>100)throw new Error('Límites CX inválidos');
  const candidates=await loadCxSyncCandidates(client);
  if(dryRun)return {disciplineId:3,dryRun:true,candidates:candidates.map(context=>({raceId:context.race.id,decisions:decisions(context,{now})}))};
  const {rows:[{acquired}]}=await client.query("SELECT pg_try_advisory_lock(hashtext('cc-cx-results')) AS acquired");
  if(!acquired)return {disciplineId:3,status:'noop',reason:'Otra pasada CX está activa'};
  let runId=null;const results=[];const seen=new Set();let request=null;
  try {
    const claim=await client.query('SELECT * FROM private.claim_results_manual_request(3)');request=claim.rows[0]||null;
    runId=await startAutomationRun(client,{job:'cx_results',triggerKind:request?'scheduled_manual':'scheduled',requestId:request?.request_id||null});
    if(request){
      const targets=request.cx_race_id?[request.cx_race_id]:candidates.filter(context=>context.categories.some(c=>(c.dateKey||context.race.dateKey)===cxMadridDate(now))).map(c=>c.race.id);
      for(const raceId of targets){
        const globalContext=request.cx_race_id?null:candidates.find(c=>c.race.id===raceId);
        const todayCategories=globalContext?globalContext.categories.filter(c=>(c.dateKey||globalContext.race.dateKey)===cxMadridDate(now)).map(c=>c.category):null;
        results.push(await collect(client,raceId,{now,manual:true,category:request.cx_category,categories:todayCategories,dataRideClient}));seen.add(raceId);
      }
      const failed=results.some(value=>value.status==='error');
      await client.query('SELECT private.finish_results_manual_request($1,$2,$3,3,$4)',
        [request.request_id,!failed,failed?'Una o más carreras CX requieren revisión de la recogida':null,request.attempts]);
    }
    let scheduled=0;
    for(const context of candidates){
      const acn=context.link?.provider==='acn';const key=`${context.race.id}:${acn?'acn':'dataride'}`;
      if(seen.has(context.race.id)||seen.has(key)||!decisions(context,{now}).some(item=>item.due))continue;
      results.push(acn?await collectAcn(client,context.race.id,{now}):await collect(client,context.race.id,{now,dataRideClient}));seen.add(key);
      if(++scheduled>=limit)break;
    }
    // Antes de las generales y de los avisos: la oficialización encola el recálculo en esta misma pasada.
    const official=await promote(client,{now})||{promoted:0,categories:[]};
    const general=await processQueue(client,{limit:standingsLimit});
    const pushes=await enqueuePushes(client);
    const keyOf=c=>`${c.race.id}:${c.link?.provider==='acn'?'acn':'dataride'}`;
    const decisionReviews=candidates.filter(c=>!seen.has(c.race.id)&&!seen.has(keyOf(c))).flatMap(context=>decisions(context,{now}).filter(d=>d.review).map(d=>({raceId:context.race.id,...d})));
    const sourceErrors=results.filter(value=>value.status==='error').length,generalErrors=general.filter(value=>value.error).length;
    const sourceReviews=results.filter(value=>value.status==='partial').length+decisionReviews.length,generalReviews=general.filter(value=>value.review||value.calculation?.status==='needs_review').length;
    const dataRideResults=results.filter(value=>value.provider!=='acn'),acnResults=results.filter(value=>value.provider==='acn');
    const acnErrors=acnResults.filter(value=>value.status==='error').length,acnReviews=acnResults.filter(value=>value.status==='partial').length;
    const dataRideErrors=sourceErrors-acnErrors,dataRideReviews=sourceReviews-acnReviews;
    await recordAutomationSourceRun(client,{runId,source:'dataride_cx',status:dataRideErrors?'error':dataRideReviews?'warning':dataRideResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:dataRideResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:dataRideResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:dataRideResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:dataRideErrors,summary:{results:dataRideResults,decisions:decisionReviews.slice(0,50)}});
    if(acnResults.length)await recordAutomationSourceRun(client,{runId,source:'acn_cx',status:acnErrors?'error':acnReviews?'warning':acnResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:acnResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:acnResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:acnResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:acnErrors,summary:{results:acnResults}});
    await recordAutomationSourceRun(client,{runId,source:'cx_standings',status:generalErrors?'error':generalReviews?'warning':general.length?'success':'noop',
      itemsFound:general.length,itemsMatched:general.filter(value=>value.published).length,itemsChanged:general.reduce((sum,value)=>sum+(value.published?.rows||0),0),errors:generalErrors,
      summary:{categories:general.map(value=>({tournamentId:value.claimed.tournamentId,category:value.claimed.category,status:value.review?'manual':value.calculation?.status||'error',issues:value.calculation?.issues||[],reviewReason:value.reviewReason||null,error:value.error||null}))}});
    const pushChanges=pushes.scheduled+pushes.updated+pushes.cancelled;
    await recordAutomationSourceRun(client,{runId,source:'cx_push',status:pushChanges?'success':'noop',itemsFound:pushes.found,
      itemsMatched:pushes.scheduled+pushes.updated,itemsChanged:pushChanges,summary:{...pushes,delivery:'scheduled_queue'}});
    const status=sourceErrors||generalErrors?'error':sourceReviews||generalReviews?'partial':results.length||official.promoted||general.length||pushChanges?'success':'noop';
    const summary={disciplineId:3,manualRequestId:request?.request_id||null,candidates:candidates.length,results,promoted:official,standings:general.length,pushes,sourceErrors,generalErrors,sourceReviews,generalReviews};
    await finishAutomationRun(client,{runId,status,summary,error:status==='error'||status==='partial'?'Consultar las fuentes CX y sus revisiones pendientes':null});
    return {status,...summary};
  }catch(error){
    if(runId!=null)await finishAutomationRun(client,{runId,status:'error',summary:{disciplineId:3,results},error:error.message}).catch(()=>{});
    throw error;
  }finally{await client.query("SELECT pg_advisory_unlock(hashtext('cc-cx-results'))");}
}
export async function runCxResultsRuntime({dryRun=false}={}) {
  if(!databaseUrl())throw new Error('Falta DATABASE_URL del runtime CX');
  const client=await openAutomationClient(databaseUrl());
  try{const value=await runCxPipeline(client,{dryRun});process.stdout.write(JSON.stringify(value)+'\n');if(value.status==='error')process.exitCode=1;return value;}
  finally{await client.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.slice(2).some(arg=>arg!=='--dry-run'))throw new Error('Solo se admite --dry-run; los alcances manuales se encolan desde el panel');
  runCxResultsRuntime({dryRun:process.argv.includes('--dry-run')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
