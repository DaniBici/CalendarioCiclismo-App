import { describe, it, expect } from 'vitest';
import { todayRaceState, profileProgress, hasValidTimeLimit, classificationColor, classificationIsUpdating, formatDurationSeconds, isTttStageClassification, parseDurationText, visibleStageClassifications, loadFeaturedRaces, waitingResultsHtml } from '../services/race-presentation.js';
import { fetchAllRows, fetchByIds } from '../services/paged-query.js';
import { enrichResultFeed } from '../services/result-feed-context.js';
import { automaticTeamHeaderText, teamHeaderColors, marketTeamColors, teamsForSeason } from '../team-appearance.js';
import { resultObservation, COVERED_STAGE_REFRESH_SOURCES } from '../../scripts/results-fetchers/result-publication.mjs';
import { classificationColorSeed } from '../../tools/seed-classification-colors.mjs';

describe('estado y métricas de jornada', () => {
  const day={neutralStartTimeUtc:'2026-09-04T10:00:00Z',estimatedFinishTimeUtc:'2026-09-04T14:00:00Z'};
  it('espera resultados desde la meta prevista sin acreditar finalización', () => {
    expect(todayRaceState(day,Date.parse('2026-09-04T13:59:59Z'))).toBe('running');
    expect(todayRaceState(day,Date.parse('2026-09-04T14:00:00Z'))).toBe('waiting');
    expect(todayRaceState({...day,raceStatus:'running'},Date.parse('2026-09-04T15:00:00Z'))).toBe('waiting');
    for (const estimatedFinishTimeUtc of [null,'invalid']) expect(todayRaceState({...day,estimatedFinishTimeUtc},Date.parse('2026-09-04T15:00:00Z'))).toBe('running');
    expect(todayRaceState({...day,raceStatus:'finished'})).toBe('waiting');
    expect(todayRaceState({...day,_hasInhouse:true})).toBe('results');
  });
  it('descanso y cancelación preceden a los resultados', () => {
    expect(todayRaceState({...day,_hasInhouse:true,isCancelledDay:true})).toBe('cancelled');
    expect(todayRaceState({...day,_hasInhouse:true,isRestDay:true})).toBe('rest');
  });
  it('representa la espera con bandera y puntos, conservando el nombre accesible', () => {
    const html = waitingResultsHtml('es');
    expect(html).toContain('aria-label="Esperando resultados"');
    expect(html.indexOf('race-card__waiting-flag')).toBeLessThan(html.indexOf('race-card__waiting-dots'));
    expect(html).not.toContain('<span>Esperando resultados</span>');
    expect(waitingResultsHtml('en')).toContain('aria-label="Awaiting results"');
  });
  it('limita el avance al recorrido y lo suprime en crono', () => {
    expect(profileProgress(day,Date.parse('2026-09-04T12:00:00Z'))).toBe(.5);
    expect(profileProgress(day,Date.parse('2026-09-04T09:00:00Z'))).toBe(0);
    expect(profileProgress(day,Date.parse('2026-09-04T15:00:00Z'))).toBe(1);
    for(const primaryType of ['itt','ttt']) expect(profileProgress({...day,primaryType,_hasInhouse:true})).toBe(0);
  });
  it('prioriza la salida real y conserva la neutralizada como fallback', () => {
    const withReal = {...day, realStartTimeUtc:'2026-09-04T11:00:00Z'};
    expect(profileProgress(withReal,Date.parse('2026-09-04T10:30:00Z'))).toBe(0);
    expect(profileProgress(withReal,Date.parse('2026-09-04T12:30:00Z'))).toBe(.5);
    expect(profileProgress({...day, realStartTimeUtc:null},Date.parse('2026-09-04T12:00:00Z'))).toBe(.5);
  });
  it('fuera de control exige duración, fuente y comprobación válidas', () => {
    const valid={timeLimitSeconds:15000,timeLimitBasis:{sourceUrl:'https://race.example/rules.pdf',verifiedAt:'2026-09-04T14:00:00Z'}};
    expect(hasValidTimeLimit(valid)).toBe(true);
    for(const timeLimitSeconds of [null,0,-1,'x']) expect(hasValidTimeLimit({...valid,timeLimitSeconds})).toBe(false);
    expect(hasValidTimeLimit({...valid,timeLimitBasis:{...valid.timeLimitBasis,sourceUrl:'javascript:alert(1)'}})).toBe(false);
    expect(hasValidTimeLimit({...valid,timeLimitBasis:{sourceUrl:'https://race.example'}})).toBe(false);
  });
  it('convierte las duraciones del panel entre segundos y h:mm:ss', () => {
    expect(formatDurationSeconds(16440)).toBe('4:34:00');
    expect(formatDurationSeconds(3661.25)).toBe('1:01:01.25');
    expect(formatDurationSeconds(null)).toBe('');
    expect(parseDurationText('4:34:00')).toBe(16440);
    expect(parseDurationText('1:01:01,25')).toBe(3661.25);
    for (const invalid of ['', '4:34', '4:75:00', 'texto']) expect(parseDurationText(invalid)).toBeNull();
  });
});

describe('detección de CRE en la clasificación de etapa', () => {
  const finishers = [{ rank: 1, resultValue: '2:39:10' }, { rank: 2, resultValue: '0:01' }];
  const withdrawals = [
    ...Array.from({ length: 7 }, () => ({ rank: null, resultValue: 'DNF', timeText: 'DNF' })),
    ...Array.from({ length: 2 }, () => ({ rank: null, resultValue: 'DNS', timeText: 'DNS' })),
  ];

  it('Flanders 1B conserva los corredores aunque DataRide deje los IRM en ResultValue', () => {
    expect(isTttStageClassification({
      rows: [...finishers, ...withdrawals], classKind: 'stage',
      raceDay: { primaryType: 'flat' }, stageRaceType: 'IRR',
    })).toBe(false);
  });

  it('mantiene el colapso de una CRE curada con estructura de equipos', () => {
    const rows = [{ rank: 1 }, { rank: 1 }, { rank: 2 }, { rank: 2 }];
    expect(isTttStageClassification({
      rows, classKind: 'stage', raceDay: { primaryType: 'ttt' }, stageRaceType: 'ITT',
    })).toBe(true);
  });

  it('conserva el fallback fuerte solo cuando no se ha podido mapear la jornada', () => {
    const rows = Array.from({ length: 6 }, () => ({ rank: null }));
    expect(isTttStageClassification({ rows, classKind: 'stage' })).toBe(true);
    expect(isTttStageClassification({ rows, classKind: 'stage', stageRaceType: 'IRR' })).toBe(false);
  });
});

describe('inventario y colores', () => {
  it('ordena solo las clasificaciones existentes en la etapa activa', () => {
    const rows=[{id:'p',classKind:'points'},{id:'s',classKind:'stage'}];
    const inventory=[{classKind:'stage'},{classKind:'gc'},{classKind:'points'}];
    expect(visibleStageClassifications(rows,inventory)).toEqual([rows[1],rows[0]]);
    expect(visibleStageClassifications([],inventory)).toEqual([]);
    expect(visibleStageClassifications([{_cancelledStage:true}],inventory)).toEqual([{_cancelledStage:true}]);
    expect(classificationColor({classKind:'stage',colorHex:'#E6332A'})).toBeNull();
    expect(classificationColor({classKind:'gc',colorHex:'red;display:none'})).toBeNull();
    expect(classificationColor({classKind:'gc'})).toBeNull();
    expect(classificationColor({classKind:'gc',colorHex:'#FFFF00'})).toBe('#FFFF00');
  });
  it('usa la pareja publicada del mercado o la temporada anterior', () => {
    const previous={headerBg:'#123456',headerText:'#FFFFFF'},next={headerBg:'#ABCDEF',headerText:'#000000',badgeVisible:false};
    expect(marketTeamColors(next,previous)).toEqual({background:'#123456',text:'#FFFFFF'});
    expect(marketTeamColors({...next,badgeVisible:true},previous)).toEqual({background:'#ABCDEF',text:'#000000'});
    expect(teamHeaderColors({headerBg:'#123456'})).toEqual({background:'var(--bg-card)',text:'var(--text)'});
  });
  it('resuelve automáticamente un texto legible para la cabecera del equipo', () => {
    expect(automaticTeamHeaderText('#111111')).toBe('#ffffff');
    expect(automaticTeamHeaderText('#fff')).toBe('#000000');
    expect(automaticTeamHeaderText('#e30613')).toBe('#ffffff');
    expect(automaticTeamHeaderText('red')).toBe('#ffffff');
  });
  it('materializa un equipo histórico aislado desde su versión de temporada', async () => {
    const query = {
      data: [{teamId:'hist',name:'Equipo 2021',category:'CT',badgeTorsoCenter:'#123456'}],
      select(){ return this; }, in(){ return this; }, eq(){ return this; },
    };
    const rows = await teamsForSeason({from:()=>query}, [], 2021, ['hist']);
    expect(rows).toEqual([expect.objectContaining({
      id:'hist', name:'Equipo 2021', category:'CT', badgeTorsoCenter:'#123456', badgeShorts:'#000000',
    })]);
  });
  it('rechaza una semilla sin edición acreditada o con color de Etapa', () => {
    const c={classKind:'gc',status:'confirmed',colorHex:'#FFFFFF',editionVerified:true,sourceUrl:'https://race.example/2026'};
    const manifest={edition:2026,consultedAt:'2026-09-04',races:[{id:'r',year:2026,kinds:['gc'],classifications:[c]}]};
    expect(classificationColorSeed(manifest)).toContain('"colorSource" IS NULL');
    c.editionVerified=false; expect(()=>classificationColorSeed(manifest)).toThrow();
    c.editionVerified=true;c.classKind='stage'; expect(()=>classificationColorSeed(manifest)).toThrow();
  });
});

describe('observaciones del origen efectivo', () => {
  it('una CRE Tissot puede contener filas UCI oficiales', () => {
    expect(resultObservation({source:'tissot',fetchedAt:'2026-09-04T14:00:00Z'},{},{publication:{provider:'uci',format:'uci'}})).toMatchObject({provider:'uci',format:'uci',observedAt:'2026-09-04T14:00:00Z'});
  });
  it('distingue el PDF de STS de sus cuadros Wiclax', () => {
    expect(resultObservation({source:'sts'},{},{publication:{provider:'sts',format:'pdf'}}).format).toBe('pdf');
    expect(resultObservation({source:'sts'},{},{}).format).toBe('progressive');
    expect(resultObservation({source:'raceresult'},{},{}).format).toBe('progressive');
  });
  it.each(COVERED_STAGE_REFRESH_SOURCES)('registra adquisiciones progresivas de %s', source => {
    expect(resultObservation({source,fetchedAt:'2026-09-04T14:00:00Z'},{},{})).toMatchObject({provider:source,format:'progressive',observedAt:'2026-09-04T14:00:00Z'});
    expect(resultObservation({source},{},{publication:{format:'pdf'}}).format).toBe('pdf');
  });
});

describe('lecturas completas', () => {
  it('no trunca resultados en el límite de página', async () => {
    const rows=Array.from({length:1001},(_,id)=>({id}));
    expect(await fetchAllRows(()=>({range:async(a,b)=>({data:rows.slice(a,b+1)})}))).toEqual(rows);
  });
  it('propaga un fallo intermedio para conservar el bloque anterior', async () => {
    const error=new Error('sin conexión');
    await expect(fetchAllRows(()=>({range:async(a)=>a?{error}:{data:[1,2]}}),2)).rejects.toBe(error);
  });
  it('divide conjuntos grandes de identificadores y evita duplicados', async () => {
    const calls=[];
    const client={from:()=>({select:()=>({in:(_key,ids)=>{calls.push(ids);return {order(){return this;},range:async()=>({data:ids.map(id=>({id}))})};}})})};
    const ids=Array.from({length:205},(_,i)=>i);
    expect((await fetchByIds(client,'x','id','id',[...ids,1,null])).length).toBe(205);
    expect(calls.map(c=>c.length)).toEqual([100,100,5]);
  });
});

describe('carreras destacadas', () => {
  it('conserva dos carreras por fecha sin duplicar los sectores', async () => {
    const client={rpc:async()=>({data:[
      {dateKey:'2026-09-04',raceId:'a'},{dateKey:'2026-09-04',raceId:'b'},
      {dateKey:'2026-09-04',raceId:'a'},{dateKey:'2026-09-05',raceId:'b'},
    ]})};
    const featured=await loadFeaturedRaces(client,['2026-09-04','2026-09-05']);
    expect([...featured.get('2026-09-04')]).toEqual(['a','b']);
    expect([...featured.get('2026-09-05')]).toEqual(['b']);
    expect(featured.has('2026-09-06')).toBe(false);
  });
  it('propaga los errores para no guardar sobre una selección desconocida', async () => {
    const error=new Error('sin conexión');
    await expect(loadFeaturedRaces({rpc:async()=>({error})},['2026-09-04'])).rejects.toBe(error);
  });
});

describe('líderes del feed por jornada y final', () => {
  it('separa sectores y reserva las secundarias finales para la general final', async () => {
    const data={
      race_days:[{id:'a',raceId:'r',dateKey:'2026-09-04',stageNumber:2,neutralStartTimeUtc:'2026-09-04T08:00:00Z'},{id:'b',raceId:'r',dateKey:'2026-09-04',stageNumber:2,neutralStartTimeUtc:'2026-09-04T14:00:00Z'}],
      race_classifications:[{raceId:'r',classKind:'gc'},{raceId:'r',classKind:'points'},{raceId:'r',classKind:'youth'}],
      race_uci_stages:[{id:'ga',raceId:'r',raceDayId:'a',classKind:'gc',stageNumber:2},{id:'pa',raceId:'r',raceDayId:'a',classKind:'points',stageNumber:2},{id:'gb',raceId:'r',raceDayId:'b',classKind:'gc',stageNumber:2},{id:'pf',raceId:'r',classKind:'points',stageNumber:null,isFinalClassification:true,stageDate:'2026-09-04'}],
      race_uci_results:[{stageRef:'ga',riderDisplay:'Líder A'},{stageRef:'pa',riderDisplay:'Puntos A'},{stageRef:'gb',riderDisplay:'Líder B'},{stageRef:'pf',riderDisplay:'Puntos final'}],
    };
    const client={rpc:async()=>({data:[{dateKey:'2026-09-04',raceId:'r'},{dateKey:'2026-09-04',raceId:'r2'}]}),from:table=>({select(){return this;},in(field,ids){this.rows=(data[table]||[]).filter(row=>ids.includes(row[field]));return this;},eq(){return this;},gt(){return this;},order(){return this;},range:async function(a,b){return {data:this.rows.slice(a,b+1)};}})};
    const race={id:'r',raceFormat:'stage_race'},base={race,date:'2026-09-04',kind:'inhouse'};
    const entries=[{...base,rd:{id:'a'}},{...base,rd:{id:'b'}},{...base,isGcFinal:true},{...base,race:{id:'r2',raceFormat:'one_day'}}];
    await enrichResultFeed(client,entries);
    expect(entries[0].leaders.map(c=>c.winners[0].name)).toEqual(['Líder A','Puntos A']);
    expect(entries[1].leaders).toEqual([]);
    expect(entries[2].leaders.map(c=>c.winners[0].name)).toEqual(['Puntos final']);
    expect(entries.map(e=>e._featured)).toEqual([false,false,true,true]);
  });
});

describe('indicación de actualización', () => {
  const now = Date.parse('2026-09-04T15:00:00Z');
  const row = { publicationStatus:'provisional', updating:true, updatingUntil:'2026-09-04T16:00:00Z' };
  it('solo mantiene el aviso provisional dentro de la ventana', () => {
    expect(classificationIsUpdating(row, now)).toBe(true);
    expect(classificationIsUpdating(row, Date.parse(row.updatingUntil))).toBe(false);
    expect(classificationIsUpdating({...row,publicationStatus:'official'},now)).toBe(false);
    expect(classificationIsUpdating({...row,updating:false},now)).toBe(false);
    expect(classificationIsUpdating({...row,updatingUntil:null},now)).toBe(false);
  });
});
