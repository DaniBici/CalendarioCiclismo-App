import { classificationInventory, loadFeaturedRaces } from './race-presentation.js';
import { fetchByIds } from './paged-query.js';
import { isNonWinnerIrm } from '../results/uci-irm.js';
import { localizedTeamName } from './national-team-name.js';

// Equipo de cada corredor en cada carrera: entrada = [{raceId, globalRiderId}],
// salida = Map `${raceId}:${globalRiderId}` → nombre del equipo. Los rank 1 de
// race_uci_results no traen teamId, así que se resuelve por la startlist:
// startlist_riders_resolved → startlist_teams → teams. Nombre canónico del
// catálogo si el equipo está enlazado; si no, el de la startlist. Un corredor
// con más de un equipo en la carrera (fichaje a mitad de vuelta) queda sin
// equipo antes que con uno equivocado; sus claves quedan en `ambiguous` (la
// CRE no da ganador si alguno lo es). Solo lecturas por lotes; cualquier fallo
// devuelve el mapa vacío: el equipo es decoración y nunca debe romper el feed.
// `isEn`: las selecciones nacionales se muestran en castellano salvo en inglés.
export async function resolveRiderTeams(client, pairs, isEn=false) {
  const teamByKey=new Map();
  teamByKey.ambiguous=new Set();
  try {
    const wanted=new Set(pairs.filter(p=>p.raceId&&p.globalRiderId).map(p=>`${p.raceId}:${p.globalRiderId}`));
    if(!wanted.size) return teamByKey;
    const raceIds=[...new Set(pairs.map(p=>p.raceId).filter(Boolean))];
    const riderIds=[...new Set(pairs.map(p=>p.globalRiderId).filter(Boolean))];
    // Se trocea por corredor y se acota por carrera en el servidor; el cruce
    // exacto raceId+corredor se hace aquí.
    const slr=await fetchByIds(client,'startlist_riders_resolved','raceId,globalRiderId,teamId','globalRiderId',riderIds,q=>q.in('raceId',raceIds));
    const pksByKey=new Map();
    for(const r of slr) {
      const key=`${r.raceId}:${r.globalRiderId}`;
      if(!r.teamId||!wanted.has(key)) continue;
      if(!pksByKey.has(key)) pksByKey.set(key,new Set());
      pksByKey.get(key).add(r.teamId);
    }
    const pks=[...new Set([...pksByKey.values()].filter(set=>set.size===1).map(set=>[...set][0]))];
    const slts=await fetchByIds(client,'startlist_teams','id,teamId,teamName','id',pks);
    const sltById=new Map(slts.map(row=>[row.id,row]));
    const teams=await fetchByIds(client,'teams','id,name,teamKind,selectionScope,countryCode,selectionCode','id',slts.map(row=>row.teamId));
    const canonical=new Map(teams.map(row=>[row.id,localizedTeamName(row.name,row,isEn)]));
    for(const [key,set] of pksByKey) {
      if(set.size!==1) { teamByKey.ambiguous.add(key); continue; }
      const slt=sltById.get([...set][0]);
      const name=slt&&((slt.teamId&&canonical.get(slt.teamId))||slt.teamName);
      if(name) teamByKey.set(key,name);
    }
    return teamByKey;
  } catch (_) { const empty=new Map(); empty.ambiguous=new Set(); return empty; }
}

// Equipo del ganador de cada categoría de ciclocross (entradas de cxResultEntries): Map `${raceId}:${category}`
// → teamName. cx_race_categories solo guarda el nombre del ganador; el equipo
// está en la fila rank 1 de cx_results. UNA lectura por lotes (solo rank 1,
// ≤6 filas por prueba). Si hay varias filas rank 1 se prefiere la del ganador
// publicado. Cualquier fallo devuelve el mapa vacío: el equipo es decoración.
export async function resolveCxWinnerTeams(client, entries) {
  const teamByKey=new Map();
  try {
    const raceIds=[...new Set(entries.map(e=>e.race?.id).filter(Boolean))];
    if(!raceIds.length) return teamByKey;
    const rows=await fetchByIds(client,'cx_results','id,raceId,category,riderDisplay,teamName','raceId',raceIds,q=>q.eq('rank',1));
    const winners=new Map(entries.flatMap(e=>(e.categories||[]).map(c=>[`${e.race.id}:${c.category}`,c.winnerName])));
    for(const row of rows) {
      const key=`${row.raceId}:${row.category}`;
      const team=(row.teamName||'').trim();
      if(!team) continue;
      if(!teamByKey.has(key)||(winners.get(key)&&row.riderDisplay===winners.get(key))) teamByKey.set(key,team);
    }
    return teamByKey;
  } catch (_) { return new Map(); }
}

export async function enrichResultFeed(client, entries, isEn=false) {
  const raceIds=[...new Set(entries.map(e=>e.race.id))];
  if (!raceIds.length) return entries;
  const [program,classes,config,featured] = await Promise.all([
    fetchByIds(client,'race_days','id,raceId,dateKey,stageNumber,neutralStartTimeUtc,isRestDay,isCancelledDay','raceId',raceIds,q=>q.eq('editorialStatus','published')),
    fetchByIds(client,'race_uci_stages','id,raceId,raceDayId,stageNumber,classKind,isFinalClassification,stageDate,winnerName,publicationStatus','raceId',raceIds,q=>q.eq('keepForWeb',true).gt('rowCount',0)),
    fetchByIds(client,'race_classifications','*','raceId',raceIds,q=>q,['raceId','classKind']),
    loadFeaturedRaces(client,entries.map(e=>e.date)),
  ]);
  const dayOrder=(a,b)=>(a.dateKey || '').localeCompare(b.dateKey || '') || (a.neutralStartTimeUtc || '').localeCompare(b.neutralStartTimeUtc || '') || (a.stageNumber ?? 0)-(b.stageNumber ?? 0) || a.id.localeCompare(b.id);
  const lastDayByRace=new Map();
  program.filter(d=>!d.isRestDay&&!d.isCancelledDay).sort(dayOrder).forEach(d=>lastDayByRace.set(d.raceId,d.id));
  for(const entry of entries) {
    const sameRace=classes.filter(c=>c.raceId===entry.race.id);
    const inventory=classificationInventory(config.filter(c=>c.raceId===entry.race.id),sameRace);
    entry._featured=!!featured.get(entry.date)?.has(entry.race.id) && (entry.isGcFinal || !entries.some(other=>other.date===entry.date&&other.race.id===entry.race.id&&other.isGcFinal));
    entry.leaderClasses=[];
    if(entry.race.raceFormat==='one_day' || (!entry.isGcFinal && entry.rd?.id===lastDayByRace.get(entry.race.id))) continue;
    if(!entry.isGcFinal && !entry.rd) continue;
    entry.leaderClasses=inventory.flatMap(cfg=>{
      if(cfg.classKind==='stage'||(entry.isGcFinal&&cfg.classKind==='gc')) return [];
      const row=sameRace.find(c=>c.classKind===cfg.classKind && (entry.isGcFinal
        ? (c.isFinalClassification || c.stageNumber==null) && c.stageDate===entry.date
        : !c.isFinalClassification && c.raceDayId===entry.rd.id));
      return row?[{...cfg,stage:row}]:[];
    });
  }
  const refs=[...new Set(entries.flatMap(e=>[e._stageRef,...e.leaderClasses.map(c=>c.stage.id)]).filter(Boolean))];
  if(!refs.length) return entries;
  const winners=await fetchByIds(client,'race_uci_results','stageRef,raceId,bib,globalRiderId,teamId,riderDisplay,irm','stageRef',refs,q=>q.eq('rank',1));
  const valid=winners.filter(r=>!isNonWinnerIrm((r.irm||'').toUpperCase()));
  const nonWinnerRefs=new Set(winners.filter(r=>isNonWinnerIrm((r.irm||'').toUpperCase())).map(r=>r.stageRef));
  // Nombres canónicos primero: el cruce por dorsal de la startlist también
  // debe cubrir filas cuya ficha existe pero no resuelve nombre (oculta por
  // el aislamiento del catálogo histórico o sin nombre público), no solo las
  // que llegan sin globalRiderId.
  const names=new Map(),namesLoaded=new Set();
  const loadNames=async ids=>{
    const pending=[...ids].filter(id=>!namesLoaded.has(id));
    if(!pending.length) return;
    pending.forEach(id=>namesLoaded.add(id));
    const results=await Promise.all(['riders_men','riders_women'].map(table=>fetchByIds(client,table,'id,firstName,lastName,nationality','id',pending)));
    for(const result of results) for(const r of result) names.set(r.id,{name:[r.firstName,r.lastName].filter(Boolean).join(' '),country:r.nationality});
  };
  // Equipos del ganador de cada entrada y de los líderes de las destacadas
  // (solo esas pintan líderes). Se lanzan EN PARALELO con la resolución de
  // nombres; tras el cruce por dorsal solo se piden los corredores nuevos
  // (normalmente ninguno). Las clasificaciones por equipos ya son un equipo.
  const rowsByRef=new Map();
  valid.forEach(r=>{ if(!rowsByRef.has(r.stageRef)) rowsByRef.set(r.stageRef,[]); rowsByRef.get(r.stageRef).push(r); });
  const teamOf=new Map(), teamRequested=new Set();
  const teamPairs=()=>{
    const pairs=[];
    for(const entry of entries) {
      const main=rowsByRef.get(entry._stageRef)||[];
      if(main.length===1&&entry.rd?.primaryType!=='ttt') pairs.push({raceId:entry.race.id,globalRiderId:main[0].globalRiderId});
      if(!entry._featured) continue;
      for(const c of entry.leaderClasses) if(c.classKind!=='teams') for(const r of rowsByRef.get(c.stage.id)||[]) pairs.push({raceId:entry.race.id,globalRiderId:r.globalRiderId});
    }
    return pairs.filter(p=>{
      const key=`${p.raceId}:${p.globalRiderId}`;
      if(!p.globalRiderId||teamRequested.has(key)) return false;
      teamRequested.add(key);
      return true;
    });
  };
  const loadTeams=async()=>{
    const pairs=teamPairs();
    if(pairs.length) (await resolveRiderTeams(client,pairs,isEn)).forEach((name,key)=>teamOf.set(key,name));
  };
  const firstTeams=loadTeams();
  await loadNames(new Set(valid.map(r=>r.globalRiderId).filter(Boolean)));
  const unresolvedRaces=[...new Set(valid.filter(r=>r.bib&&!(names.get(r.globalRiderId)?.name)).map(r=>r.raceId))];
  const startlist=await fetchByIds(client,'startlist_riders_resolved','raceId,dorsal,globalRiderId,firstName,lastName,countryCode','raceId',unresolvedRaces);
  const byBib=new Map(startlist.map(r=>[`${r.raceId}:${r.dorsal}`,r]));
  valid.forEach(r=> { const rider=byBib.get(`${r.raceId}:${r.bib}`); if(rider) { r.globalRiderId ||= rider.globalRiderId; r._startlist=rider; } });
  await Promise.all([loadNames(new Set(valid.map(r=>r.globalRiderId).filter(Boolean))),firstTeams.then(loadTeams)]);
  const teamIds=[...new Set(valid.map(r=>r.teamId).filter(Boolean))];
  const teams=await fetchByIds(client,'teams','id,name,teamKind,selectionScope,countryCode,selectionCode','id',teamIds);
  const teamNames=new Map(teams.map(r=>[r.id,localizedTeamName(r.name,r,isEn)]));
  const leaders=(ref,team=false)=>valid.filter(r=>r.stageRef===ref).map(row=>team
    ? {name:teamNames.get(row.teamId)||row.riderDisplay,country:null}
    : {...(names.get(row.globalRiderId)||(row._startlist ? {name:[row._startlist.firstName,row._startlist.lastName].filter(Boolean).join(' '),country:row._startlist.countryCode} : {name:row.riderDisplay,country:null})),_gid:row.globalRiderId}).filter(r=>r.name);
  // Equipo del corredor en la carrera (solo corredores; ver teamPairs).
  const withTeam=(winner,raceId)=> {
    const { _gid, ...rest } = winner;
    const team=_gid&&teamOf.get(`${raceId}:${_gid}`);
    return team?{...rest,team}:rest;
  };
  for(const entry of entries) {
    const primary=leaders(entry._stageRef);
    if(nonWinnerRefs.has(entry._stageRef) && primary.length===0) { entry.winner=''; entry.winnerCountry=null; }
    if(primary.length===1 && entry.rd?.primaryType!=='ttt') {
      const { name, country, team } = withTeam(primary[0],entry.race.id);
      entry.winner=name; entry.winnerCountry=country;
      if(team) entry.winnerTeam=team; else delete entry.winnerTeam;
    }
    entry.leaders=entry.leaderClasses.flatMap(c=>{
      const winners=leaders(c.stage.id,c.classKind==='teams').map(w=>withTeam(w,entry.race.id));
      return winners.length?[{...c,winners}]:[];
    });
  }
  return entries;
}
