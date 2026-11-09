#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createCxDataRideClient, fetchCxCompetition } from './cx-dataride-results.mjs';
import { acnCategories, acnVersionMs, buildAcnCxDocument, fetchAcnTable, fetchAcnTables, fetchAcnTree } from './acn-cx-fetch.mjs';
import { chronoraceBonusMap, chronoraceContext, chronoraceReportKeys, chronoraceTableUrl, parseChronoraceBonuses } from './chronorace-cx-bonuses.mjs';
import { fetchWiclaxXml, parseWiclaxCx } from './wiclax-cx-fetch.mjs';
import { buildKbwbCxDocument, fetchKbwbRaces } from './kbwb-cx-fetch.mjs';
import { buildSmartwebCxDocument, fetchSmartwebRace, resolveSmartwebIdentities } from './smartweb-cx-fetch.mjs';
import { buildGolazoCxDocument, fetchGolazoPages, golazoFinality, golazoObserve } from './golazo-cx-fetch.mjs';
import { fetchZone4Linked, fetchZone4Tree } from './zone4-cx-fetch.mjs';
import { fetchChronoraceXcoCx } from './chronorace-xco-cx-fetch.mjs';
import { buildFotofinissCxDocument, fetchFotofinissGroups } from './fotofiniss-cx-fetch.mjs';
import { buildRaceresultCxDocument, fetchRaceresultContests } from './raceresult-cx-fetch.mjs';
import { resolveCxResultIdentity } from '../../js/cx/result-identity.js';
import { normalizeCxDocumentTeams } from './cx-team-names.mjs';
import { processCxCategoryDocuments } from './cx-category-batches.mjs';
import { applyCxResults, loadCxResultsContext, prepareCxResults } from './cx-results-upsert.mjs';
import { cxSyncDecision } from './cx-sync-window.mjs';
import { processStandingsQueue } from '../cx/cx-recompute-standings.mjs';
import { finishAutomationRun, openAutomationClient, recordAutomationSourceRun, startAutomationRun } from '../automation-monitor.mjs';
import { databaseUrl } from '../db/env.mjs';

// Una sola lectura: enlaces DataRide y enlaces de cronometraje (`link.provider` acn, wiclax, kbwb, smartweb, zone4, chronorace_xco, fotofiniss, raceresult o golazo).
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
// Golazo, fuente secundaria: solo sus páginas, sin resultados de otra fuente ni oficiales, y con la
// cadencia de su enlace (no comparte la marca por categoría del cronometraje principal).
const golazoEligible=(link,manga)=>Object.values(link.categoryKeys||{}).includes(manga.category)&&manga.resultsStatus!=='official'
  &&(manga.resultsStatus==='pending'||manga.resultsProvider==='golazo');
const decisions=(context,options)=>{
  const golazo=context.link?.provider==='golazo';
  return context.categories.filter(c=>(!options.category||c.category===options.category)&&(!options.categories||options.categories.includes(c.category))
    &&(!golazo||golazoEligible(context.link,c)))
    .map(manga=>({category:manga.category,...cxSyncDecision(context.race,golazo?{...manga,resultsLastFetchAt:context.link.lastFetchAt}:manga,context.link,options)}));
};
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

const sameWiclax=(left,right)=>left&&right&&left.provider==='wiclax'&&right.provider==='wiclax'
  &&left.raceId===right.raceId&&left.sourceUrl===right.sourceUrl&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
async function recordWiclaxLink(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='wiclax' AND "sourceUrl"=$4`,[status,error,link.raceId,link.sourceUrl]);
}
async function recordWiclaxAttempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider='wiclax' AND l."sourceUrl"=$3)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,link.sourceUrl]);
}

/**
 * Recogida desde un archivo Wiclax (.clax) del cronometrador. `categoryKeys`
 * asigna recorridos del archivo (`<Pcs nom>`) a categorías propias. Solo se
 * importan los recorridos que el cronometraje marca como terminados (`finito`)
 * y siempre como `provisional`: la promoción a oficial llega al día civil
 * siguiente. Los equipos toman el nombre canónico de cx_teams o, si no existen,
 * una grafía sin mayúsculas sostenidas. Nunca sustituye una categoría oficial
 * ni una protegida.
 */
export async function collectCxWiclaxRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchClax=fetchWiclaxXml,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='wiclax')return {raceId,provider:'wiclax',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'wiclax',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin recorrido Wiclax asignado en categoryKeys'}));
    const providerOfficial=[];
    for(const value of Object.values(map)){
      const own=context.categories.find(c=>c.category===value);
      if(own?.resultsStatus==='official')providerOfficial.push({category:value,reason:'Resultados ya oficiales; Wiclax no los sustituye'});
    }
    for(const [course,value] of Object.entries(map))if(providerOfficial.some(item=>item.category===value))delete map[course];
    const {fileUrl,xml}=await fetchClax(originalLink.sourceUrl);
    const document=parseWiclaxCx(xml,{map,raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,
      sourceUrl:originalLink.sourceUrl,sourceFileUrl:fileUrl,source:'wiclax'});
    const pending=(document.skipped||[]).map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    const publishable=document.categories.filter(manga=>{
      const winner=manga.rows.find(row=>row.rank===1&&!row.irm);
      if(winner?.timeSeconds!=null&&BigInt(winner.timeSeconds)>0n)return true;
      reviews.push({category:manga.category,reason:'Meta sin tiempo de ganador en Wiclax; revisar antes de importar'});return false;
    });
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameWiclax(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace Wiclax cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of publishable.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordWiclaxAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordWiclaxLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'wiclax',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink?.provider==='wiclax'&&attemptedCategories.length&&!attemptsRecorded)await recordWiclaxAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='wiclax')await recordWiclaxLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'wiclax',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameKbwb=(left,right)=>left&&right&&left.provider==='kbwb'&&right.provider==='kbwb'
  &&left.raceId===right.raceId&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
async function recordKbwbLink(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='kbwb' AND "categoryKeys"=$4::jsonb`,[status,error,link.raceId,JSON.stringify(link.categoryKeys)]);
}
async function recordKbwbAttempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider='kbwb' AND l."categoryKeys"=$3::jsonb)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,JSON.stringify(link.categoryKeys)]);
}

/**
 * Recogida desde las pruebas KBWB de cycling.vlaanderen. `categoryKeys` asigna
 * la clave de cada prueba de la federación a una categoría propia. Una prueba
 * se importa cuando el jurado la publica (`result`=1 y líneas) y siempre como
 * `provisional`: la promoción a oficial llega al día civil siguiente y DataRide
 * la sustituye. Nunca sustituye una categoría oficial ni una protegida.
 */
export async function collectCxKbwbRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchRaces=fetchKbwbRaces,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='kbwb')return {raceId,provider:'kbwb',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'kbwb',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin prueba KBWB asignada en categoryKeys'}));
    const providerOfficial=[];
    for(const [key,value] of Object.entries(map)){
      if(context.categories.find(c=>c.category===value)?.resultsStatus!=='official')continue;
      providerOfficial.push({category:value,reason:'Resultados ya oficiales; KBWB no los sustituye'});delete map[key];
    }
    const document=buildKbwbCxDocument({races:await fetchRaces(map),raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,source:'kbwb'});
    const pending=(document.skipped||[]).map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    reviews.push(...document.invalid.map(item=>({category:item.category,reason:`Clasificación KBWB ${item.key}: ${item.reason}`})));
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameKbwb(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace KBWB cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of document.categories.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordKbwbAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:document.categories.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordKbwbLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'kbwb',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink?.provider==='kbwb'&&attemptedCategories.length&&!attemptsRecorded)await recordKbwbAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='kbwb')await recordKbwbLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'kbwb',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameZone4=(left,right)=>left&&right&&left.provider==='zone4'&&right.provider==='zone4'
  &&left.raceId===right.raceId&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
async function recordZone4Link(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='zone4' AND "categoryKeys"=$4::jsonb`,[status,error,link.raceId,JSON.stringify(link.categoryKeys)]);
}
async function recordZone4Attempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider='zone4' AND l."categoryKeys"=$3::jsonb)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,JSON.stringify(link.categoryKeys)]);
}

/**
 * Recogida desde las páginas de resultados de Zone4. `categoryKeys` asigna cada
 * grupo «<fecha>/<formato>/<nombre>» a una categoría propia. Un grupo se importa
 * cuando el cronometrador lo marca «Official» y siempre como `provisional`: la
 * promoción a oficial llega al día civil siguiente y DataRide la sustituye. Nunca
 * sustituye una categoría oficial ni una protegida.
 */
export async function collectCxZone4Race(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchTree=fetchZone4Tree,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='zone4')return {raceId,provider:'zone4',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'zone4',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin grupo Zone4 asignado en categoryKeys'}));
    const providerOfficial=[];
    for(const [key,value] of Object.entries(map)){
      if(context.categories.find(c=>c.category===value)?.resultsStatus!=='official')continue;
      providerOfficial.push({category:value,reason:'Resultados ya oficiales; Zone4 no los sustituye'});delete map[key];
    }
    const document=Object.keys(map).length?await fetchZone4Linked({categoryKeys:map,raceId,seasonKey:context.race.seasonKey,fetchTree})
      :{schemaVersion:1,source:'zone4',disciplineId:3,raceId,seasonKey:context.race.seasonKey,evidence:{},categories:[],skipped:[],warnings:[]};
    const pending=(document.skipped||[]).filter(item=>item.category).map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameZone4(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace Zone4 cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of document.categories.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordZone4Attempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:document.categories.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordZone4Link(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'zone4',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length,
      sourceWarnings:(document.warnings||[]).slice(0,10)};
  }catch(error){
    if(originalLink?.provider==='zone4'&&attemptedCategories.length&&!attemptsRecorded)await recordZone4Attempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='zone4')await recordZone4Link(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'zone4',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameChronoraceXco=(left,right)=>left&&right&&left.provider==='chronorace_xco'&&right.provider==='chronorace_xco'
  &&left.raceId===right.raceId&&left.ctx===right.ctx;
async function recordChronoraceXcoLink(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='chronorace_xco' AND ctx=$4`,[status,error,link.raceId,link.ctx]);
}
async function recordChronoraceXcoAttempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider='chronorace_xco' AND l.ctx=$3)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,link.ctx]);
}

/**
 * Recogida desde el visor UCI «xco» de Chronorace (Campeonatos de Europa UEC). El enlace
 * guarda el contexto (`20261107_uec`); cada manga es la clave ME…WJ del árbol. Chronorace es
 * el cronometraje oficial del campeonato: la manga se importa como `official` cuando la marca
 * terminada (`Status=Finished` y `AllPassed`), con su fecha civil en la zona de la carrera.
 * Nunca sustituye una categoría oficial de otra fuente ni una protegida; una corrección
 * posterior del directo (descalificación) se reimporta sobre su propia clasificación oficial.
 */
export async function collectCxChronoraceXcoRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchJson=undefined,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='chronorace_xco')return {raceId,provider:'chronorace_xco',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    if(!context.race.timezone)throw new Error('Carrera sin zona horaria: la fecha civil de la manga no se puede verificar');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'chronorace_xco',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const providerOfficial=attemptedCategories.filter(value=>{const own=context.categories.find(c=>c.category===value);
      return own?.resultsStatus==='official'&&own.resultsProvider!=='chronorace_xco';})
      .map(value=>({category:value,reason:'Resultados oficiales de otra fuente; Chronorace no los sustituye'}));
    const wanted=attemptedCategories.filter(value=>!providerOfficial.some(item=>item.category===value));
    const document=wanted.length?await fetchChronoraceXcoCx({url:originalLink.ctx,raceId,seasonKey:context.race.seasonKey,timezone:context.race.timezone,
      only:wanted,source:'chronorace_xco',...(fetchJson?{fetchJson}:{})})
      :{schemaVersion:1,source:'chronorace_xco',disciplineId:3,raceId,seasonKey:context.race.seasonKey,evidence:{},categories:[],skipped:[]};
    const pending=(document.skipped||[]).filter(item=>item.category).map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    const reviews=wanted.filter(value=>!document.categories.some(c=>c.category===value)&&!pending.some(item=>item.category===value))
      .map(value=>({category:value,reason:'Manga sin live timing en el contexto de Chronorace'}));
    // La fecha civil procede de la hora de salida de Chronorace: una manga de otro día no se carga.
    for(const manga of [...document.categories]){
      const own=context.categories.find(c=>c.category===manga.category);
      if(manga.dateKey===(own?.dateKey||context.race.dateKey))continue;
      reviews.push({category:manga.category,reason:`Manga de Chronorace del ${manga.dateKey}, distinta de la fecha propia`});
      document.categories.splice(document.categories.indexOf(manga),1);
    }
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameChronoraceXco(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace Chronorace cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of document.categories.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    await recordChronoraceXcoAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:document.categories.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'official'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordChronoraceXcoLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'chronorace_xco',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink?.provider==='chronorace_xco'&&attemptedCategories.length&&!attemptsRecorded)await recordChronoraceXcoAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='chronorace_xco')await recordChronoraceXcoLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'chronorace_xco',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameSmartweb=(left,right)=>left&&right&&left.provider==='smartweb'&&right.provider==='smartweb'
  &&left.raceId===right.raceId&&left.sourceUrl===right.sourceUrl&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
// smartweb no marca la clasificación como terminada: se publica la tabla que se lee igual en dos pasadas seguidas.
const SMARTWEB_STABLE_MS=4*60000;
const SMARTWEB_MIN_DURATION_RATIO=0.8;
// Enlaces identificados por proveedor y "sourceUrl" (smartweb, fotofiniss, raceresult).
async function recordUrlLink(client,link,status,error=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,"updatedAt"=now()
    WHERE "raceId"=$3 AND provider=$5 AND "sourceUrl"=$4`,[status,error,link.raceId,link.sourceUrl,link.provider]);
}
async function recordUrlAttempts(client,link,categories) {
  if(!categories.length)return;
  await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt")
    SELECT c."raceId",c.category,now() FROM public.cx_race_categories c
    WHERE c."raceId"=$1 AND c.category=ANY($2::text[])
      AND EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider=$4 AND l."sourceUrl"=$3)
    ON CONFLICT ("raceId",category) DO UPDATE SET "lastFetchAt"=excluded."lastFetchAt"`,[link.raceId,categories,link.sourceUrl,link.provider]);
}
// Guarda la huella de cada tabla leída y devuelve desde cuándo se lee sin cambios.
async function recordUrlDigests(client,link,entries,now) {
  if(!entries.length)return new Map();
  const {rows}=await client.query(`INSERT INTO private.cx_results_fetch_state("raceId",category,"lastFetchAt","sourceDigest","sourceDigestAt")
    SELECT c."raceId",c.category,$4::timestamptz,d.digest,$4::timestamptz
    FROM jsonb_to_recordset($2::jsonb) AS d(category text,digest text)
    JOIN public.cx_race_categories c ON c."raceId"=$1 AND c.category=d.category
    WHERE EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=c."raceId" AND l.provider=$5 AND l."sourceUrl"=$3)
    ON CONFLICT ("raceId",category) DO UPDATE SET "sourceDigest"=excluded."sourceDigest",
      "sourceDigestAt"=CASE WHEN private.cx_results_fetch_state."sourceDigest"=excluded."sourceDigest"
        THEN private.cx_results_fetch_state."sourceDigestAt" ELSE excluded."sourceDigestAt" END
    RETURNING category,"sourceDigestAt"`,[link.raceId,JSON.stringify(entries),link.sourceUrl,new Date(now).toISOString(),link.provider]);
  return new Map(rows.map(row=>[row.category,new Date(row.sourceDigestAt).getTime()]));
}

/**
 * Recogida desde las clasificaciones smartweb de la federación (RFEC y
 * autonómicas). `categoryKeys` asigna el rótulo de cada clasificación a una
 * categoría propia. Una tabla se publica cuando se lee igual durante
 * SMARTWEB_STABLE_MS y su ganador tiene tiempo (con duración acreditada, al
 * menos SMARTWEB_MIN_DURATION_RATIO de ella), siempre como `provisional`: la
 * promoción a oficial llega al día civil siguiente. Nunca sustituye una
 * categoría oficial ni una protegida. `dryRun` lee, normaliza y prepara sin
 * escribir nada ni exigir la estabilidad, ventana ni recogida activa.
 */
export async function collectCxSmartwebRace(client,raceId,{now=new Date(),manual=false,dryRun=false,category=null,categories=null,fetchRace=fetchSmartwebRace,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='smartweb')return {raceId,provider:'smartweb',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'smartweb',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin clasificación smartweb asignada en categoryKeys'}));
    const providerOfficial=[];
    for(const [label,value] of Object.entries(map)){
      if(context.categories.find(c=>c.category===value)?.resultsStatus!=='official')continue;
      if(!providerOfficial.some(item=>item.category===value))providerOfficial.push({category:value,reason:'Resultados ya oficiales; smartweb no los sustituye'});
      delete map[label];
    }
    const fetched=await fetchRace(originalLink.sourceUrl,map);
    if(fetched.indexUrl!==originalLink.sourceUrl)throw new Error(`Índice smartweb ${fetched.indexUrl} distinto del enlace`);
    const document=buildSmartwebCxDocument({...fetched,map,raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,source:'smartweb'});
    const pending=document.skipped.map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    reviews.push(...document.invalid.map(item=>({category:item.category,reason:`Clasificación smartweb ${item.reason}`})));
    const candidates=document.categories.filter(manga=>{
      const winner=manga.rows.find(row=>row.rank===1&&!row.irm);const winnerSeconds=Number(winner?.timeSeconds);
      const planned=Number(context.categories.find(c=>c.category===manga.category)?.durationMinutes);
      if(Number.isFinite(planned)&&planned>0&&winnerSeconds<planned*60*SMARTWEB_MIN_DURATION_RATIO){
        reviews.push({category:manga.category,reason:`Tiempo del ganador en smartweb (${Math.floor(winnerSeconds/60)} min) inferior al ${SMARTWEB_MIN_DURATION_RATIO*100} % de la duración prevista (${planned} min); revisar antes de importar`});return false;
      }
      return true;
    });
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    resolveSmartwebIdentities(document,fresh.riders);
    const unchangedLink=sameSmartweb(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace smartweb cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of candidates.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    const due=candidates.filter(c=>stillDue.includes(c.category));
    const sources=document.categories.map(c=>({category:c.category,label:c.sourceGroup,variant:c.sourceVariant,rows:c.rows.length,digest:c.sourceDigest,sourceUrl:c.evidence.sourceUrl}));
    if(dryRun){
      const prepared=[];
      for(const manga of due){
        try{
          const value=prepareCxResults({...document,categories:[manga]},fresh,{status:'provisional'});
          const rows=value.imports[0]?.rows||[];
          prepared.push({category:manga.category,rows:rows.length,linked:rows.filter(row=>row.globalRiderId).length,skipped:value.skipped,
            unresolved:value.warnings.map(item=>({riderDisplay:item.riderDisplay,reason:item.reason,candidates:item.candidates}))});
        }catch(error){reviews.push({category:manga.category,reason:error.message});}
      }
      return {raceId,provider:'smartweb',status:'dry_run',dryRun:true,sources,prepared,document,reviews,pending,omitted:document.omitted,
        sourceWarnings:document.warnings,skipped:providerOfficial};
    }
    const stableSince=await recordUrlDigests(client,originalLink,due.map(c=>({category:c.category,digest:c.sourceDigest})),now);
    const publishable=due.filter(manga=>{
      const since=stableSince.get(manga.category);
      if(Number.isFinite(since)&&new Date(now).getTime()-since>=SMARTWEB_STABLE_MS)return true;
      pending.push({category:manga.category,reason:'Clasificación smartweb nueva o modificada; se publica cuando se lea sin cambios en la siguiente pasada'});return false;
    });
    await recordUrlAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordUrlLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'smartweb',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,sources,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,omitted:document.omitted,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(dryRun)return {raceId,provider:'smartweb',status:'error',dryRun:true,error:error.message,rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(originalLink?.provider==='smartweb'&&attemptedCategories.length&&!attemptsRecorded)await recordUrlAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='smartweb')await recordUrlLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'smartweb',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameFotofiniss=(left,right)=>left&&right&&left.provider==='fotofiniss'&&right.provider==='fotofiniss'
  &&left.raceId===right.raceId&&left.sourceUrl===right.sourceUrl&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
// fotofiniss publica en directo y sin marca de definitiva: un grupo está terminado cuando su tabla
// no cambia durante más de FOTOFINISS_LAP_FACTOR veces la vuelta más lenta leída en él (nadie sigue
// en carrera), y nunca antes de FOTOFINISS_MIN_STABLE_MS.
const FOTOFINISS_MIN_STABLE_MS=4*60000;
const FOTOFINISS_LAP_FACTOR=1.5;

/**
 * Recogida desde las tablas por grupo de edad de fotofiniss.lv. `categoryKeys`
 * asigna el rótulo de cada grupo a una categoría propia. Un grupo se publica
 * cuando su tabla deja de cambiar (FOTOFINISS_LAP_FACTOR por su vuelta más
 * lenta), siempre como `provisional`: la promoción a oficial llega al día civil
 * siguiente y DataRide la sustituye. En un Campeonato Nacional (solo licencias
 * de la federación) la nacionalidad por defecto es la del país, corregida por
 * las fichas verificadas que coinciden por nombre. Nunca sustituye una
 * categoría oficial ni una protegida. `dryRun` lee, normaliza y prepara sin
 * escribir nada ni exigir la estabilidad, ventana ni recogida activa.
 */
export async function collectCxFotofinissRace(client,raceId,{now=new Date(),manual=false,dryRun=false,category=null,categories=null,fetchGroups=fetchFotofinissGroups,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='fotofiniss')return {raceId,provider:'fotofiniss',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'fotofiniss',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin grupo fotofiniss asignado en categoryKeys'}));
    const providerOfficial=[];
    for(const [label,value] of Object.entries(map)){
      if(context.categories.find(c=>c.category===value)?.resultsStatus!=='official')continue;
      providerOfficial.push({category:value,reason:'Resultados ya oficiales; fotofiniss no los sustituye'});delete map[label];
    }
    const fetched=Object.keys(map).length?await fetchGroups(originalLink.sourceUrl):{resultsUrl:originalLink.sourceUrl,groups:[]};
    if(fetched.resultsUrl!==originalLink.sourceUrl)throw new Error(`Evento fotofiniss ${fetched.resultsUrl} distinto del enlace`);
    const defaultCountry=context.race.class==='CN'&&/^[A-Z]{2}/.test(context.race.countryCode||'')?context.race.countryCode.slice(0,2):null;
    const document=buildFotofinissCxDocument({...fetched,map,raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,defaultCountry,source:'fotofiniss'});
    const pending=document.skipped.map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    reviews.push(...document.invalid.map(item=>({category:item.category,reason:`Grupo fotofiniss ${item.reason}`})));
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    // Misma regla que smartweb: el país por defecto cede ante una ficha verificada que coincide por nombre.
    resolveSmartwebIdentities(document,fresh.riders);
    const unchangedLink=sameFotofiniss(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace fotofiniss cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of document.categories.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    const due=document.categories.filter(c=>stillDue.includes(c.category));
    const sources=document.categories.map(c=>({category:c.category,group:c.sourceGroup,rows:c.rows.length,digest:c.sourceDigest,maxLapSeconds:c.maxLapSeconds,sourceUrl:c.evidence.sourceUrl}));
    if(dryRun){
      const prepared=[];
      for(const manga of due){
        try{
          const value=prepareCxResults({...document,categories:[manga]},fresh,{status:'provisional'});
          const rows=value.imports[0]?.rows||[];
          prepared.push({category:manga.category,rows:rows.length,linked:rows.filter(row=>row.globalRiderId).length,skipped:value.skipped,
            unresolved:value.warnings.map(item=>({riderDisplay:item.riderDisplay,reason:item.reason,candidates:item.candidates}))});
        }catch(error){reviews.push({category:manga.category,reason:error.message});}
      }
      return {raceId,provider:'fotofiniss',status:'dry_run',dryRun:true,sources,prepared,document,reviews,pending,sourceWarnings:document.warnings,skipped:providerOfficial};
    }
    const stableSince=await recordUrlDigests(client,originalLink,due.map(c=>({category:c.category,digest:c.sourceDigest})),now);
    const publishable=due.filter(manga=>{
      const since=stableSince.get(manga.category);
      const required=Math.max(FOTOFINISS_MIN_STABLE_MS,FOTOFINISS_LAP_FACTOR*(manga.maxLapSeconds||0)*1000);
      if(Number.isFinite(since)&&new Date(now).getTime()-since>=required)return true;
      pending.push({category:manga.category,reason:`Grupo fotofiniss en curso o modificado; se publica tras ${Math.ceil(required/60000)} min sin cambios`});return false;
    });
    await recordUrlAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordUrlLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'fotofiniss',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,sources,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(dryRun)return {raceId,provider:'fotofiniss',status:'error',dryRun:true,error:error.message,rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(originalLink?.provider==='fotofiniss'&&attemptedCategories.length&&!attemptsRecorded)await recordUrlAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='fotofiniss')await recordUrlLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'fotofiniss',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameRaceresult=(left,right)=>left&&right&&left.provider==='raceresult'&&right.provider==='raceresult'
  &&left.raceId===right.raceId&&left.sourceUrl===right.sourceUrl&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
// RaceResult publica en directo y sin marca de definitiva. Con todos los inscritos con puesto o estado
// basta que la lista no cambie durante RACERESULT_STABLE_MS; si quedan inscritos sin puesto ni estado
// (no salieron y el cronometrador no los marcó), hace falta RACERESULT_OPEN_STABLE_MS y quedan fuera.
const RACERESULT_STABLE_MS=4*60000;
const RACERESULT_OPEN_STABLE_MS=20*60000;

/**
 * Recogida desde las listas por concurso de RACE|RESULT (my.raceresult.com).
 * `categoryKeys` asigna cada concurso («26», o «26/2» con el día del selector)
 * a una categoría propia, y el nombre del concurso debe corresponder a ella.
 * Un concurso se publica cuando su lista deja de cambiar, siempre como
 * `provisional`: la promoción a oficial llega al día civil siguiente y DataRide
 * la sustituye. La lista no trae nacionalidad: las fichas verificadas que
 * coinciden por nombre aportan la suya. Nunca sustituye una categoría oficial
 * ni una protegida. `dryRun` lee, normaliza y prepara sin escribir nada ni
 * exigir la estabilidad, ventana ni recogida activa.
 */
export async function collectCxRaceresultRace(client,raceId,{now=new Date(),manual=false,dryRun=false,category=null,categories=null,fetchContests=fetchRaceresultContests,context:preloaded=null}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.timingLink;
    if(originalLink?.provider!=='raceresult')return {raceId,provider:'raceresult',status:'skipped',decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories});
    attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'raceresult',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys||{}).filter(([,value])=>attemptedCategories.includes(value)));
    const reviews=attemptedCategories.filter(value=>!Object.values(map).includes(value)).map(value=>({category:value,reason:'Categoría sin concurso RaceResult asignado en categoryKeys'}));
    const providerOfficial=[];
    for(const [key,value] of Object.entries(map)){
      if(context.categories.find(c=>c.category===value)?.resultsStatus!=='official')continue;
      providerOfficial.push({category:value,reason:'Resultados ya oficiales; RaceResult no los sustituye'});delete map[key];
    }
    const fetched=Object.keys(map).length?await fetchContests(originalLink.sourceUrl,Object.keys(map)):{eventUrl:originalLink.sourceUrl,contests:[]};
    if(fetched.eventUrl!==originalLink.sourceUrl)throw new Error(`Evento RaceResult ${fetched.eventUrl} distinto del enlace`);
    const document=buildRaceresultCxDocument({...fetched,map,raceId,seasonKey:context.race.seasonKey,dateKey:context.race.dateKey,source:'raceresult'});
    const pending=document.skipped.map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    reviews.push(...document.invalid.map(item=>({category:item.category,reason:`RaceResult: ${item.reason}`})));
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    // Sin nacionalidad en la fuente: una ficha verificada que coincide por nombre aporta la suya.
    resolveSmartwebIdentities(document,fresh.riders);
    const unchangedLink=sameRaceresult(originalLink,fresh.timingLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.timingLink,disciplineId:3}},{now,manual:manual||dryRun,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace RaceResult cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of document.categories.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida durante la consulta'});
    const due=document.categories.filter(c=>stillDue.includes(c.category));
    const sources=document.categories.map(c=>({category:c.category,contest:c.sourceContest,contestName:c.sourceContestName,rows:c.rows.length,unfinished:c.unfinished,digest:c.sourceDigest,sourceUrl:c.evidence.sourceUrl}));
    if(dryRun){
      const prepared=[];
      for(const manga of due){
        try{
          const value=prepareCxResults({...document,categories:[manga]},fresh,{status:'provisional'});
          const rows=value.imports[0]?.rows||[];
          prepared.push({category:manga.category,rows:rows.length,linked:rows.filter(row=>row.globalRiderId).length,skipped:value.skipped,
            unresolved:value.warnings.map(item=>({riderDisplay:item.riderDisplay,reason:item.reason,candidates:item.candidates}))});
        }catch(error){reviews.push({category:manga.category,reason:error.message});}
      }
      return {raceId,provider:'raceresult',status:'dry_run',dryRun:true,sources,prepared,document,reviews,pending,sourceWarnings:document.warnings,skipped:providerOfficial};
    }
    const stableSince=await recordUrlDigests(client,originalLink,due.map(c=>({category:c.category,digest:c.sourceDigest})),now);
    const publishable=due.filter(manga=>{
      const since=stableSince.get(manga.category);
      const required=manga.unfinished?RACERESULT_OPEN_STABLE_MS:RACERESULT_STABLE_MS;
      if(Number.isFinite(since)&&new Date(now).getTime()-since>=required){
        if(manga.unfinished)reviews.push({category:manga.category,reason:`${manga.unfinished} inscritos sin puesto ni estado en RaceResult quedan fuera de la clasificación`});
        return true;
      }
      pending.push({category:manga.category,reason:`Concurso RaceResult en curso o modificado${manga.unfinished?` (${manga.unfinished} inscritos sin puesto ni estado)`:''}; se publica tras ${Math.ceil(required/60000)} min sin cambios`});return false;
    });
    await recordUrlAttempts(client,originalLink,attemptedCategories);attemptsRecorded=true;
    const processed=await processCxCategoryDocuments({
      document,
      categories:publishable.map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordUrlLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null);
    return {raceId,provider:'raceresult',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,sources,
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged})),
      reviews,pending,skipped:[...processed.skipped,...providerOfficial],warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(dryRun)return {raceId,provider:'raceresult',status:'error',dryRun:true,error:error.message,rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(originalLink?.provider==='raceresult'&&attemptedCategories.length&&!attemptsRecorded)await recordUrlAttempts(client,originalLink,attemptedCategories).catch(()=>{});
    if(originalLink?.provider==='raceresult')await recordUrlLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'raceresult',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

const sameGolazo=(left,right)=>left&&right&&left.provider==='golazo'&&right.provider==='golazo'
  &&left.raceId===right.raceId&&left.sourceUrl===right.sourceUrl&&JSON.stringify(left.categoryKeys)===JSON.stringify(right.categoryKeys);
// La marca del enlace (lastFetchAt) es la cadencia de Golazo; sourceState, su estado por categoría.
async function recordGolazoLink(client,link,status,error=null,sourceState=null) {
  await client.query(`UPDATE public.cx_race_timing_links SET "syncStatus"=$1,"lastFetchAt"=now(),"lastFetchError"=$2,
      "sourceState"=coalesce($5::jsonb,"sourceState"),"updatedAt"=now()
    WHERE "raceId"=$3 AND provider='golazo' AND "sourceUrl"=$4`,[status,error,link.raceId,link.sourceUrl,sourceState&&JSON.stringify(sourceState)]);
}
// Golazo no publica dorsal, nacimiento ni UCI ID: una fila se enlaza antes con los inscritos de su manga.
async function resolveGolazoIdentities(client,document,context) {
  if(!document.categories.length)return;
  const {rows}=await client.query(`SELECT category,array_agg("globalRiderId") AS ids FROM public.cx_startlist_riders
    WHERE "raceId"=$1 AND category=ANY($2::text[]) AND "globalRiderId" IS NOT NULL GROUP BY category`,[context.race.id,document.categories.map(c=>c.category)]);
  for(const manga of document.categories){
    const ids=new Set(rows.find(row=>row.category===manga.category)?.ids||[]);
    const entered=(context.riders[manga.category.startsWith('M')?'men':'women']||[]).filter(rider=>ids.has(rider.id));
    for(const row of manga.rows){
      const resolved=resolveCxResultIdentity(row,entered);
      if(resolved.reason==='verified_name')row.globalRiderId=resolved.id;
    }
  }
}

/**
 * Recogida desde la web del organizador Golazo (X2O Trofee), fuente secundaria
 * de la carrera: `categoryKeys` asigna cada página `uitslagen-…` a una
 * categoría. La web publica la clasificación en directo: cada lectura actualiza
 * `sourceState` y la tabla se importa cuando `golazoFinality` la acredita como
 * definitiva (líder en su último paso por meta y tabla estable). Publica solo
 * `provisional` y solo sobre categorías pendientes o ya cargadas desde Golazo:
 * KBWB, DataRide u otro cronometraje la sustituyen y Golazo no los pisa. Nunca
 * sobre una categoría oficial ni protegida.
 */
export async function collectCxGolazoRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,fetchPages=fetchGolazoPages,context:preloaded=null}={}) {
  let originalLink;
  try {
    const context=preloaded||await loadCxResultsContext(client,raceId);originalLink=context.golazoLink;
    if(originalLink?.provider!=='golazo')return {raceId,provider:'golazo',status:'skipped',noLink:true,decisions:[],rowsFound:0,rowsMatched:0,rowsChanged:0};
    if(category&&!context.categories.some(c=>c.category===category))throw new Error('Categoría solicitada ausente en el calendario propio');
    const evaluated=decisions({...context,link:{...originalLink,disciplineId:3}},{now,manual,category,categories});
    const attemptedCategories=evaluated.filter(item=>item.due).map(item=>item.category);
    if(!attemptedCategories.length)return {raceId,provider:'golazo',status:'skipped',decisions:evaluated,rowsFound:0,rowsMatched:0,rowsChanged:0};
    const map=Object.fromEntries(Object.entries(originalLink.categoryKeys).filter(([,value])=>attemptedCategories.includes(value)));
    const document=buildGolazoCxDocument({pages:await fetchPages(originalLink.sourceUrl,map),raceId,seasonKey:context.race.seasonKey,
      dateKey:context.race.dateKey,source:'golazo',siteUrl:originalLink.sourceUrl});
    const pending=document.skipped.map(item=>({category:item.category,reason:`${item.reason}; se reintenta en la siguiente pasada`}));
    const reviews=document.invalid.map(item=>({category:item.category,reason:`Clasificación Golazo ${item.url}: ${item.reason}`}));
    const sourceState={...(originalLink.sourceState||{})};const finals=[];
    for(const manga of document.categories){
      sourceState[manga.category]=golazoObserve(sourceState[manga.category],manga,now);
      const verdict=golazoFinality(sourceState[manga.category],{durationMinutes:context.categories.find(c=>c.category===manga.category)?.durationMinutes,
        now,stamp:manga.sourceGeneratedAt});
      if(verdict.final)finals.push(manga);else pending.push({category:manga.category,reason:verdict.reason});
    }
    await normalizeCxDocumentTeams(client,document);
    const fresh=await loadCxResultsContext(client,raceId);
    const unchangedLink=sameGolazo(originalLink,fresh.golazoLink);
    const stillDue=unchangedLink
      ?decisions({...fresh,link:{...fresh.golazoLink,disciplineId:3}},{now,manual,category,categories}).filter(item=>item.due).map(item=>item.category):[];
    if(!unchangedLink)reviews.push({category:null,reason:'El enlace Golazo cambió durante la consulta; se descarta la respuesta anterior'});
    for(const manga of finals.filter(c=>!stillDue.includes(c.category)))reviews.push({category:manga.category,reason:'La manga dejó de estar disponible para la recogida de Golazo durante la consulta'});
    await resolveGolazoIdentities(client,document,fresh);
    const processed=await processCxCategoryDocuments({
      document,
      categories:finals.filter(value=>stillDue.includes(value.category)).map(value=>value.category),
      prepareCategory:source=>prepareCxResults({...document,categories:[source]},fresh,{status:'provisional'}),
      applyCategory:prepared=>applyCxResults(client,prepared),
    });
    reviews.push(...processed.reviews);
    const rowsFound=document.categories.reduce((sum,c)=>sum+c.rows.length,0);
    const rowsChanged=processed.applied.filter(value=>!value.unchanged).reduce((sum,value)=>sum+value.rows,0);
    const status=reviews.length||processed.skipped.length||processed.warnings.length?'partial':'ok';
    await recordGolazoLink(client,originalLink,status,status==='partial'?JSON.stringify({reviews,skipped:processed.skipped,warnings:processed.warnings.slice(0,10)}).slice(0,4000):null,
      unchangedLink?sourceState:null);
    return {raceId,provider:'golazo',status,rowsFound,rowsMatched:processed.rowsMatched,rowsChanged,
      sources:document.categories.map(c=>({category:c.category,rows:c.rows.length,unclassified:c.evidence.unclassified.length,sourceGeneratedAt:c.sourceGeneratedAt,state:sourceState[c.category]})),
      imported:processed.applied.map(value=>({category:value.category,rows:value.rows,status:value.status,unchanged:!!value.unchanged,skipped:value.skipped||null})),
      reviews,pending,skipped:processed.skipped,warnings:processed.warnings.slice(0,10),warningCount:processed.warnings.length};
  }catch(error){
    if(originalLink?.provider==='golazo')await recordGolazoLink(client,originalLink,'error',error.message.slice(0,4000)).catch(()=>{});
    return {raceId,provider:'golazo',status:'error',error:error.message,errorCode:error.code||null,rowsFound:0,rowsMatched:0,rowsChanged:0};
  }
}

export async function collectCxRace(client,raceId,{now=new Date(),manual=false,category=null,categories=null,dataRideClient=createCxDataRideClient(),fetchCompetition=fetchCxCompetition,fetchTables=fetchAcnTables,fetchClax=fetchWiclaxXml,fetchRaces=fetchKbwbRaces,fetchRace=fetchSmartwebRace,fetchPages=fetchGolazoPages,fetchTree=fetchZone4Tree,fetchJson=undefined,fetchGroups=fetchFotofinissGroups,fetchContests=fetchRaceresultContests}={}) {
  let originalLink;let attemptedCategories=[];let attemptsRecorded=false;
  try {
    const context=await loadCxResultsContext(client,raceId);originalLink=context.link;
    if(!originalLink&&!context.timingLink&&context.golazoLink)return await collectCxGolazoRace(client,raceId,{now,manual,category,categories,fetchPages,context});
    // Carrera solo con enlace de cronometraje: la recogida pertenece a ese proveedor (ACN, Wiclax, KBWB, smartweb, Zone4, Chronorace xco, fotofiniss o RaceResult).
    if(!originalLink&&context.timingLink?.provider==='raceresult')return await collectCxRaceresultRace(client,raceId,{now,manual,category,categories,fetchContests,context});
    if(!originalLink&&context.timingLink?.provider==='fotofiniss')return await collectCxFotofinissRace(client,raceId,{now,manual,category,categories,fetchGroups,context});
    if(!originalLink&&context.timingLink?.provider==='chronorace_xco')return await collectCxChronoraceXcoRace(client,raceId,{now,manual,category,categories,fetchJson,context});
    if(!originalLink&&context.timingLink?.provider==='zone4')return await collectCxZone4Race(client,raceId,{now,manual,category,categories,fetchTree,context});
    if(!originalLink&&context.timingLink?.provider==='smartweb')return await collectCxSmartwebRace(client,raceId,{now,manual,category,categories,fetchRace,context});
    if(!originalLink&&context.timingLink?.provider==='kbwb')return await collectCxKbwbRace(client,raceId,{now,manual,category,categories,fetchRaces,context});
    if(!originalLink&&context.timingLink?.provider==='wiclax')return await collectCxWiclaxRace(client,raceId,{now,manual,category,categories,fetchClax,context});
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
// Bonos por ronda de los torneos cuyo reglamento declara `extras.bonusPublication.provider='chronorace'`.
// Una reingesta de resultados los deja en NULL: la pasada los repone antes de calcular las generales.
// Una categoría con algún bono sin cargar sigue siendo candidata sin límite de fecha: su general está detenida.
const CX_BONUS_RECHECK_MINUTES=30;
const CX_BONUS_OVERDUE_MS=6*3600000;
export async function loadCxBonusCandidates(client,now) {
  const {rows}=await client.query(`/* cx_bonus_candidates */ SELECT r.id AS "raceId",coalesce(c."dateKey",r."dateKey")::text AS "dateKey",c.category,c."bonusSourceUrl",c."resultsImportedAt",
      t."pointsScheme"#>ARRAY['categories',c.category,'extras','bonusPublication'] AS publication,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'rank',x.rank,'riderDisplay',x."riderDisplay",'bonusSeconds',x."bonusSeconds",
        'uciLicenseId',coalesce(m."uciLicenseId",w."uciLicenseId"),'uciProfileId',coalesce(m."uciProfileId",w."uciProfileId")) ORDER BY x."sortOrder"),'[]')
        FROM public.cx_results x LEFT JOIN public.cx_riders_men m ON m.id=x."globalRiderId" LEFT JOIN public.cx_riders_women w ON w.id=x."globalRiderId"
        WHERE x."raceId"=c."raceId" AND x.category=c.category) AS rows
    FROM public.cx_race_categories c JOIN public.cx_races r ON r.id=c."raceId" JOIN public.cx_tournaments t ON t.id=r."tournamentId"
    WHERE t."pointsScheme"#>>ARRAY['categories',c.category,'extras','bonusPublication','provider']='chronorace'
      AND r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT c."isCancelled" AND c."resultsStatus"<>'pending'
      AND (coalesce(c."dateKey",r."dateKey") BETWEEN $1::date-1 AND $1::date OR c."resultsImportedAt">=$2::timestamptz-interval '36 hours'
        OR c."bonusSourceUrl" IS NULL OR EXISTS(SELECT 1 FROM public.cx_results x WHERE x."raceId"=c."raceId" AND x.category=c.category AND x."bonusSeconds" IS NULL))
    ORDER BY r."dateKey",r.id,c."sortOrder"`,[cxMadridDate(now),new Date(now).toISOString()]);
  return rows;
}
export async function collectCxRoundBonuses(client,{now=new Date(),fetchTree=fetchAcnTree,fetchTable=fetchAcnTable}={}) {
  const candidates=await loadCxBonusCandidates(client,now);
  const outcome={candidates:candidates.length,applied:[],unchanged:[],skipped:[],pending:[],reviews:[]};
  const at=new Date(now).getTime(),recheck=new Date(now).getUTCMinutes()%CX_BONUS_RECHECK_MINUTES===0,trees=new Map();
  for(const candidate of candidates){
    const scope={raceId:candidate.raceId,category:candidate.category};
    const loaded=candidate.bonusSourceUrl&&candidate.rows.every(row=>row.bonusSeconds!=null);
    const overdue=!loaded&&at-Date.parse(candidate.resultsImportedAt)>CX_BONUS_OVERDUE_MS;
    // Ya cargados: solo una comprobación periódica por si Chronorace corrige el informe.
    if(loaded&&!recheck)continue;
    // Pasado el plazo la consulta es periódica, pero la categoría sigue en revisión en cada pasada.
    if(overdue&&!recheck){outcome.reviews.push({...scope,reason:'Bonos sin cargar; se consulta Chronorace cada 30 minutos'});continue;}
    const wait=reason=>(overdue?outcome.reviews:outcome.pending).push({...scope,reason});
    const ctx=chronoraceContext(candidate.dateKey,candidate.publication.contextSuffix);
    let keys,results,bestLap;
    try{
      if(!trees.has(ctx))trees.set(ctx,await fetchTree(ctx));
      keys=trees.get(ctx)&&chronoraceReportKeys(acnCategories(trees.get(ctx)).found,candidate.category);
      if(keys)[results,bestLap]=[await fetchTable(ctx,keys.results),await fetchTable(ctx,keys.bestLap)];
    }catch(error){wait(`Chronorace no responde: ${error.message}`);continue;}
    if(!results||!bestLap){wait(`Informe de Chronorace ${ctx} sin publicar`);continue;}
    // Como en ACN Timing, la tabla no marca la meta: se espera a que deje de cambiar.
    if(at-Math.max(acnVersionMs(results.Version),acnVersionMs(bestLap.Version))<ACN_STABLE_MS){wait('Chronorace aún actualiza el informe');continue;}
    try{
      const parsed=parseChronoraceBonuses({results,bestLap});
      if(!parsed.complete){wait(`Bonif de Chronorace incompleto: ${parsed.total} segundos`);continue;}
      const resultsUrl=chronoraceTableUrl(ctx,keys.results);
      const {rows:[{applied}]}=await client.query('SELECT public.cx_apply_round_bonuses($1,$2,$3::jsonb,$4::jsonb) AS applied',[candidate.raceId,candidate.category,
        JSON.stringify(chronoraceBonusMap(parsed,candidate.rows)),
        JSON.stringify({bonusSourceUrl:resultsUrl,bonusEvidence:{context:ctx,resultsTable:resultsUrl,bestLapTable:chronoraceTableUrl(ctx,keys.bestLap),
          resultsVersion:String(results.Version),bestLapVersion:String(bestLap.Version),awards:parsed.awards}})]);
      (applied.skipped?outcome.skipped:applied.unchanged?outcome.unchanged:outcome.applied).push({...scope,...(applied.skipped?{reason:'Bonos de otra fuente; se conservan'}:{})});
    }catch(error){
      if(error.code==='40001')outcome.pending.push({...scope,reason:'La clasificación cambió durante la lectura; se reintenta en la siguiente pasada'});
      else outcome.reviews.push({...scope,reason:error.message.slice(0,500)});
    }
  }
  return outcome;
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
  collect=collectCxRace,collectAcn=collectCxAcnRace,collectWiclax=collectCxWiclaxRace,collectKbwb=collectCxKbwbRace,collectSmartweb=collectCxSmartwebRace,collectZone4=collectCxZone4Race,collectChronoraceXco=collectCxChronoraceXcoRace,collectFotofiniss=collectCxFotofinissRace,collectRaceresult=collectCxRaceresultRace,collectGolazo=collectCxGolazoRace,collectBonuses=collectCxRoundBonuses,dataRideClient=createCxDataRideClient(),promote=promoteCxProvisionalResults,processQueue=processStandingsQueue,enqueuePushes=enqueueCxAutomaticPushes}={}) {
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
        const value=await collect(client,raceId,{now,manual:true,category:request.cx_category,categories:todayCategories,dataRideClient});results.push(value);seen.add(raceId);
        // Golazo después de la fuente principal: no pisa lo que esta acabe de cargar.
        if(value.provider!=='golazo'){
          const secondary=await collectGolazo(client,raceId,{now,manual:true,category:request.cx_category,categories:todayCategories});
          if(!secondary.noLink)results.push(secondary);
        }
      }
      const failed=results.some(value=>value.status==='error');
      await client.query('SELECT private.finish_results_manual_request($1,$2,$3,3,$4)',
        [request.request_id,!failed,failed?'Una o más carreras CX requieren revisión de la recogida':null,request.attempts]);
    }
    let scheduled=0;
    for(const context of candidates){
      const provider=context.link?.provider||'dataride';const key=`${context.race.id}:${provider}`;
      if(seen.has(context.race.id)||seen.has(key)||!decisions(context,{now}).some(item=>item.due))continue;
      results.push(provider==='acn'?await collectAcn(client,context.race.id,{now})
        :provider==='wiclax'?await collectWiclax(client,context.race.id,{now})
        :provider==='kbwb'?await collectKbwb(client,context.race.id,{now})
        :provider==='smartweb'?await collectSmartweb(client,context.race.id,{now})
        :provider==='zone4'?await collectZone4(client,context.race.id,{now})
        :provider==='chronorace_xco'?await collectChronoraceXco(client,context.race.id,{now})
        :provider==='fotofiniss'?await collectFotofiniss(client,context.race.id,{now})
        :provider==='raceresult'?await collectRaceresult(client,context.race.id,{now})
        :provider==='golazo'?await collectGolazo(client,context.race.id,{now})
        :await collect(client,context.race.id,{now,dataRideClient}));seen.add(key);
      if(++scheduled>=limit)break;
    }
    // Antes de las generales: una reingesta de esta pasada no deja la ronda sin bonos al calcular.
    // Un fallo aquí no detiene las oficializaciones, las generales ni los avisos.
    const bonuses=await collectBonuses(client,{now}).catch(error=>({candidates:0,applied:[],unchanged:[],skipped:[],pending:[],
      reviews:[{raceId:null,category:null,reason:`Lectura de bonos: ${error.message}`.slice(0,500)}]}));
    // Antes de las generales y de los avisos: la oficialización encola el recálculo en esta misma pasada.
    const official=await promote(client,{now})||{promoted:0,categories:[]};
    const general=await processQueue(client,{limit:standingsLimit});
    const pushes=await enqueuePushes(client);
    const keyOf=c=>`${c.race.id}:${c.link?.provider||'dataride'}`;
    const decisionReviews=candidates.filter(c=>!seen.has(c.race.id)&&!seen.has(keyOf(c))).flatMap(context=>decisions(context,{now}).filter(d=>d.review).map(d=>({raceId:context.race.id,...d})));
    const sourceErrors=results.filter(value=>value.status==='error').length,generalErrors=general.filter(value=>value.error).length;
    const sourceReviews=results.filter(value=>value.status==='partial').length+decisionReviews.length,generalReviews=general.filter(value=>value.review||value.calculation?.status==='needs_review').length;
    const dataRideResults=results.filter(value=>!['acn','wiclax','kbwb','smartweb','zone4','chronorace_xco','fotofiniss','raceresult','golazo'].includes(value.provider)),fotofinissResults=results.filter(value=>value.provider==='fotofiniss'),raceresultResults=results.filter(value=>value.provider==='raceresult'),zone4Results=results.filter(value=>value.provider==='zone4'),chronoraceXcoResults=results.filter(value=>value.provider==='chronorace_xco'),acnResults=results.filter(value=>value.provider==='acn'),wiclaxResults=results.filter(value=>value.provider==='wiclax'),kbwbResults=results.filter(value=>value.provider==='kbwb'),smartwebResults=results.filter(value=>value.provider==='smartweb'),golazoResults=results.filter(value=>value.provider==='golazo');
    const acnErrors=acnResults.filter(value=>value.status==='error').length,acnReviews=acnResults.filter(value=>value.status==='partial').length;
    const wiclaxErrors=wiclaxResults.filter(value=>value.status==='error').length,wiclaxReviews=wiclaxResults.filter(value=>value.status==='partial').length;
    const kbwbErrors=kbwbResults.filter(value=>value.status==='error').length,kbwbReviews=kbwbResults.filter(value=>value.status==='partial').length;
    const smartwebErrors=smartwebResults.filter(value=>value.status==='error').length,smartwebReviews=smartwebResults.filter(value=>value.status==='partial').length;
    const golazoErrors=golazoResults.filter(value=>value.status==='error').length,golazoReviews=golazoResults.filter(value=>value.status==='partial').length;
    const zone4Errors=zone4Results.filter(value=>value.status==='error').length,zone4Reviews=zone4Results.filter(value=>value.status==='partial').length;
    const chronoraceXcoErrors=chronoraceXcoResults.filter(value=>value.status==='error').length,chronoraceXcoReviews=chronoraceXcoResults.filter(value=>value.status==='partial').length;
    const fotofinissErrors=fotofinissResults.filter(value=>value.status==='error').length,fotofinissReviews=fotofinissResults.filter(value=>value.status==='partial').length;
    const raceresultErrors=raceresultResults.filter(value=>value.status==='error').length,raceresultReviews=raceresultResults.filter(value=>value.status==='partial').length;
    const dataRideErrors=sourceErrors-acnErrors-wiclaxErrors-kbwbErrors-smartwebErrors-golazoErrors-zone4Errors-chronoraceXcoErrors-fotofinissErrors-raceresultErrors,dataRideReviews=sourceReviews-acnReviews-wiclaxReviews-kbwbReviews-smartwebReviews-golazoReviews-zone4Reviews-chronoraceXcoReviews-fotofinissReviews-raceresultReviews;
    await recordAutomationSourceRun(client,{runId,source:'dataride_cx',status:dataRideErrors?'error':dataRideReviews?'warning':dataRideResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:dataRideResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:dataRideResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:dataRideResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:dataRideErrors,summary:{results:dataRideResults,decisions:decisionReviews.slice(0,50)}});
    if(acnResults.length)await recordAutomationSourceRun(client,{runId,source:'acn_cx',status:acnErrors?'error':acnReviews?'warning':acnResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:acnResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:acnResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:acnResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:acnErrors,summary:{results:acnResults}});
    if(wiclaxResults.length)await recordAutomationSourceRun(client,{runId,source:'wiclax_cx',status:wiclaxErrors?'error':wiclaxReviews?'warning':wiclaxResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:wiclaxResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:wiclaxResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:wiclaxResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:wiclaxErrors,summary:{results:wiclaxResults}});
    if(kbwbResults.length)await recordAutomationSourceRun(client,{runId,source:'kbwb_cx',status:kbwbErrors?'error':kbwbReviews?'warning':kbwbResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:kbwbResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:kbwbResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:kbwbResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:kbwbErrors,summary:{results:kbwbResults}});
    if(smartwebResults.length)await recordAutomationSourceRun(client,{runId,source:'smartweb_cx',status:smartwebErrors?'error':smartwebReviews?'warning':smartwebResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:smartwebResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:smartwebResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:smartwebResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:smartwebErrors,summary:{results:smartwebResults}});
    if(zone4Results.length)await recordAutomationSourceRun(client,{runId,source:'zone4_cx',status:zone4Errors?'error':zone4Reviews?'warning':zone4Results.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:zone4Results.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:zone4Results.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:zone4Results.reduce((sum,value)=>sum+value.rowsChanged,0),errors:zone4Errors,summary:{results:zone4Results}});
    if(chronoraceXcoResults.length)await recordAutomationSourceRun(client,{runId,source:'chronorace_xco_cx',status:chronoraceXcoErrors?'error':chronoraceXcoReviews?'warning':chronoraceXcoResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:chronoraceXcoResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:chronoraceXcoResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:chronoraceXcoResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:chronoraceXcoErrors,summary:{results:chronoraceXcoResults}});
    if(fotofinissResults.length)await recordAutomationSourceRun(client,{runId,source:'fotofiniss_cx',status:fotofinissErrors?'error':fotofinissReviews?'warning':fotofinissResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:fotofinissResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:fotofinissResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:fotofinissResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:fotofinissErrors,summary:{results:fotofinissResults}});
    if(raceresultResults.length)await recordAutomationSourceRun(client,{runId,source:'raceresult_cx',status:raceresultErrors?'error':raceresultReviews?'warning':raceresultResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:raceresultResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:raceresultResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:raceresultResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:raceresultErrors,summary:{results:raceresultResults}});
    if(golazoResults.length)await recordAutomationSourceRun(client,{runId,source:'golazo_cx',status:golazoErrors?'error':golazoReviews?'warning':golazoResults.some(r=>r.status==='ok')?'success':'noop',
      itemsFound:golazoResults.reduce((sum,value)=>sum+value.rowsFound,0),itemsMatched:golazoResults.reduce((sum,value)=>sum+value.rowsMatched,0),itemsChanged:golazoResults.reduce((sum,value)=>sum+value.rowsChanged,0),errors:golazoErrors,summary:{results:golazoResults}});
    if(bonuses.candidates||bonuses.reviews.length)await recordAutomationSourceRun(client,{runId,source:'chronorace_cx',status:bonuses.reviews.length?'warning':bonuses.applied.length?'success':'noop',
      itemsFound:bonuses.candidates,itemsMatched:bonuses.applied.length+bonuses.unchanged.length,itemsChanged:bonuses.applied.length,errors:0,summary:bonuses});
    await recordAutomationSourceRun(client,{runId,source:'cx_standings',status:generalErrors?'error':generalReviews?'warning':general.length?'success':'noop',
      itemsFound:general.length,itemsMatched:general.filter(value=>value.published).length,itemsChanged:general.reduce((sum,value)=>sum+(value.published?.rows||0),0),errors:generalErrors,
      summary:{categories:general.map(value=>({tournamentId:value.claimed.tournamentId,category:value.claimed.category,status:value.review?'manual':value.calculation?.status||'error',issues:value.calculation?.issues||[],reviewReason:value.reviewReason||null,error:value.error||null}))}});
    const pushChanges=pushes.scheduled+pushes.updated+pushes.cancelled;
    await recordAutomationSourceRun(client,{runId,source:'cx_push',status:pushChanges?'success':'noop',itemsFound:pushes.found,
      itemsMatched:pushes.scheduled+pushes.updated,itemsChanged:pushChanges,summary:{...pushes,delivery:'scheduled_queue'}});
    const status=sourceErrors||generalErrors?'error':sourceReviews||generalReviews||bonuses.reviews.length?'partial':results.length||bonuses.applied.length||official.promoted||general.length||pushChanges?'success':'noop';
    const summary={disciplineId:3,manualRequestId:request?.request_id||null,candidates:candidates.length,results,bonuses,promoted:official,standings:general.length,pushes,sourceErrors,generalErrors,sourceReviews,generalReviews};
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
