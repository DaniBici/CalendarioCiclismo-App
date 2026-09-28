import { classificationInventory, loadFeaturedRaces } from './race-presentation.js';
import { fetchByIds } from './paged-query.js';
import { isNonWinnerIrm } from '../results/uci-irm.js';

export async function enrichResultFeed(client, entries) {
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
  await loadNames(new Set(valid.map(r=>r.globalRiderId).filter(Boolean)));
  const unresolvedRaces=[...new Set(valid.filter(r=>r.bib&&!(names.get(r.globalRiderId)?.name)).map(r=>r.raceId))];
  const startlist=await fetchByIds(client,'startlist_riders_resolved','raceId,dorsal,globalRiderId,firstName,lastName,countryCode','raceId',unresolvedRaces);
  const byBib=new Map(startlist.map(r=>[`${r.raceId}:${r.dorsal}`,r]));
  valid.forEach(r=> { const rider=byBib.get(`${r.raceId}:${r.bib}`); if(rider) { r.globalRiderId ||= rider.globalRiderId; r._startlist=rider; } });
  await loadNames(new Set(valid.map(r=>r.globalRiderId).filter(Boolean)));
  const teamIds=[...new Set(valid.map(r=>r.teamId).filter(Boolean))];
  const teams=await fetchByIds(client,'teams','id,name','id',teamIds);
  const teamNames=new Map(teams.map(r=>[r.id,r.name]));
  const leaders=(ref,team=false)=>valid.filter(r=>r.stageRef===ref).map(row=>team
    ? {name:teamNames.get(row.teamId)||row.riderDisplay,country:null}
    : names.get(row.globalRiderId)||(row._startlist ? {name:[row._startlist.firstName,row._startlist.lastName].filter(Boolean).join(' '),country:row._startlist.countryCode} : {name:row.riderDisplay,country:null})).filter(r=>r.name);
  for(const entry of entries) {
    const primary=leaders(entry._stageRef);
    if(nonWinnerRefs.has(entry._stageRef) && primary.length===0) { entry.winner=''; entry.winnerCountry=null; }
    if(primary.length===1 && entry.rd?.primaryType!=='ttt') { entry.winner=primary[0].name; entry.winnerCountry=primary[0].country; }
    entry.leaders=entry.leaderClasses.flatMap(c=>{
      const winners=leaders(c.stage.id,c.classKind==='teams');
      return winners.length?[{...c,winners}]:[];
    });
  }
  return entries;
}
