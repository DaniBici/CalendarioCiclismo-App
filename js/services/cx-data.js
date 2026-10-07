// Clientes inyectados: se comparte entre panel, web y pruebas sin cargar Auth.
import {cxSeasonMonths,cxDateInSeason,cxSeasonBounds} from '../cx/season.js';
export const CX_AGENDA_SELECT='id,name,nameEn,abbrev,slug,slugEn,seasonKey,dateKey,endDateKey,class,countryCode,venue,tournamentId,colorHex,logoUrl,isCancelled,timezone,assets(type,url),cx_tournaments(id,name,nameEn,slug,colorHex,logoUrl),cx_race_categories(category,startTimeUtc,dateKey,sortOrder,isCancelled,resultsStatus,winnerName,durationFormat,durationRuleVersion,durationMinutes,durationRuleSourceUrl,startlistImportedAt)';

// Clases ocultas en inglés: la categoría nacional española (y los futuros
// calendarios nacionales) está dirigida al público hispanohablante. Espejo de
// CyclocrossPresentation.hiddenClasses (iOS) y CxPresentation.hiddenClasses
// (Android). El panel no filtra.
export function cxHiddenClasses(lang) {
  return lang==='en'?['NAC']:[];
}
export function cxIsHidden(race,lang) {
  return cxHiddenClasses(lang).includes(race?.class);
}
// Carrera visible en la agenda: no está cancelada en su totalidad ni oculta
// por idioma. Las categorías canceladas siguen visibles. Espejo de
// CyclocrossPresentation.listedInAgenda (iOS) y CxPresentation.listedInAgenda
// (Android).
export function cxListedInAgenda(race,lang) {
  return !race?.isCancelled&&!cxIsHidden(race,lang);
}
export const CX_SPANISH_AUDIENCE={
  title:'Available in Spanish',
  text:'This content is intended for Spanish-speaking audiences, mainly in Spain.',
  link:'View in Spanish',
};

export async function cxQuery(query) {
  const {data,error}=await query;
  if(error) throw new Error(error.message);
  return data;
}

// Orden por columna configurable: cx_standings_state no tiene `id` (su clave
// es tournamentId+seasonKey+category) y no admite el orden por defecto.
export async function cxAllRows(client,table,select='*',filters={},orderColumn='id') {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    let query=client.from(table).select(select).order(orderColumn).range(offset,offset+999);
    for(const [key,value] of Object.entries(filters)) query=query.eq(key,value);
    const batch=await cxQuery(query);
    rows.push(...batch);
    if(batch.length<1000) return rows;
  }
}

export async function cxMonth(client,seasonKey,year,month) {
  if(!cxSeasonMonths(seasonKey).includes(`${year}-${String(month).padStart(2,'0')}`))throw new Error('El calendario CX solo admite meses de agosto a febrero.');
  const first=`${year}-${String(month).padStart(2,'0')}-01`;
  const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  return cxQuery(client.from('cx_races').select(CX_AGENDA_SELECT).eq('seasonKey',seasonKey)
    .eq('editorialStatus','published').lte('dateKey',last).or(`dateKey.gte.${first},endDateKey.gte.${first}`)
    .order('dateKey').order('id'));
}

export async function cxSeasonRows(client,seasonKey) {
  cxSeasonMonths(seasonKey);
  const {first,last}=cxSeasonBounds(seasonKey);
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const page=await cxQuery(client.from('cx_races').select(CX_AGENDA_SELECT).eq('seasonKey',seasonKey)
      .eq('editorialStatus','published').gte('dateKey',first).lte('dateKey',last)
      .order('dateKey').order('id').range(offset,offset+999));
    rows.push(...page);if(page.length<1000)return rows;
  }
}

export function cxTournamentNextDate(rows,seasonKey,dateKey) {
  return rows.flatMap(race=>race.cx_race_categories?.length?race.cx_race_categories.filter(c=>!c.isCancelled).map(c=>c.dateKey||race.dateKey):[race.dateKey])
    .filter(date=>date>=dateKey&&cxDateInSeason(seasonKey,date)).sort()[0]||null;
}

export async function cxNextDate(client,seasonKey,dateKey,tournamentId=null,excludeClasses=[]) {
  if(tournamentId) {
    cxSeasonMonths(seasonKey);
    const rows=[],last=new Date(Date.UTC(Number(seasonKey.slice(0,4))+1,2,0)).toISOString().slice(0,10);
    // Solo fechas/cancelación del torneo; no descarga cards de toda la temporada.
    for(let offset=0;;offset+=1000) {
      let query=client.from('cx_races').select('dateKey,cx_race_categories(dateKey,isCancelled)')
        .eq('seasonKey',seasonKey).eq('tournamentId',tournamentId).eq('editorialStatus','published').eq('isCancelled',false)
        .gte('dateKey',`${seasonKey.slice(0,4)}-08-01`).lte('dateKey',last).or(`dateKey.gte.${dateKey},endDateKey.gte.${dateKey}`);
      for(const raceClass of excludeClasses)query=query.neq('class',raceClass);
      const page=await cxQuery(query.order('id').range(offset,offset+999));
      rows.push(...page);if(page.length<1000)break;
    }
    return cxTournamentNextDate(rows,seasonKey,dateKey);
  }
  if(excludeClasses.length)return cxQuery(client.rpc('cx_next_race_date',{p_season_key:seasonKey,p_date_key:dateKey,p_exclude_classes:excludeClasses}));
  return cxQuery(client.rpc('cx_next_race_date',{p_season_key:seasonKey,p_date_key:dateKey},{get:true}));
}

export async function cxRpc(client,name,args={}) {
  return cxQuery(client.rpc(name,args));
}

// Orden del contrato de generales CX: coalesce(categoria.dateKey, race.dateKey),
// categoria.startTimeUtc NULLS LAST y race.id. Una carrera con varias categorías
// cuenta como una sola ronda y se ordena por su primera manga válida. Una
// carrera cancelada en su totalidad sale de la numeración; una manga cancelada
// no altera la de su carrera.
const cxRoundStart=start=>{const time=start?Date.parse(start):NaN;return Number.isFinite(time)?time:Infinity;};
function cxRaceRoundKey(race,seasonKey) {
  const entries=(race.cx_race_categories||[]).map(c=>({date:c.dateKey||race.dateKey,start:cxRoundStart(c.startTimeUtc)}))
    .filter(entry=>cxDateInSeason(seasonKey,entry.date));
  if(!entries.length)entries.push({date:race.dateKey,start:Infinity});
  entries.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
  return entries[0];
}
export function cxTournamentRounds(rows,seasonKey) {
  const byTournament=new Map();
  for(const race of rows) {
    if(!race.tournamentId||race.isCancelled||race.seasonKey!==seasonKey||!cxDateInSeason(seasonKey,race.dateKey))continue;
    if(!byTournament.has(race.tournamentId))byTournament.set(race.tournamentId,[]);
    byTournament.get(race.tournamentId).push(race);
  }
  const rounds=new Map();
  for(const races of byTournament.values()) {
    races.sort((a,b)=>{const ka=cxRaceRoundKey(a,seasonKey),kb=cxRaceRoundKey(b,seasonKey);
      return ka.date.localeCompare(kb.date)||ka.start-kb.start||(a.id<b.id?-1:a.id>b.id?1:0);});
    races.forEach((race,index)=>rounds.set(race.id,{n:index+1,total:races.length}));
  }
  return rounds;
}

const roundsCache=new Map();
export async function cxSeasonRounds(client,seasonKey) {
  cxSeasonMonths(seasonKey);
  if(!roundsCache.has(seasonKey)) {
    const {first,last}=cxSeasonBounds(seasonKey);
    roundsCache.set(seasonKey,(async()=>{
      const rows=[];
      // Solo fechas/cancelación de todas las carreras publicadas; sin cards.
      for(let offset=0;;offset+=1000) {
        const page=await cxQuery(client.from('cx_races').select('id,tournamentId,dateKey,seasonKey,isCancelled,cx_race_categories(dateKey,startTimeUtc,isCancelled)')
          .eq('seasonKey',seasonKey).eq('editorialStatus','published')
          .gte('dateKey',first).lte('dateKey',last).order('id').range(offset,offset+999));
        rows.push(...page);if(page.length<1000)break;
      }
      return cxTournamentRounds(rows,seasonKey);
    })().catch(error=>{roundsCache.delete(seasonKey);throw error;}));
  }
  return roundsCache.get(seasonKey);
}

export async function cxTournamentMetadata(client,id,{bySlug=false}={}) {
  const tournament=await cxQuery(client.from('cx_tournaments').select('id,name,nameEn,slug,seasonKey,logoUrl,pointsScheme').eq(bySlug?'slug':'id',id).maybeSingle());
  if(!tournament)return null;
  return {...tournament,countryCode:null};
}
