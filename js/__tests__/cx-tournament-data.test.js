import {describe,it,expect,vi} from 'vitest';
import {cxNextDate,cxTournamentNextDate,cxTournamentMetadata} from '../services/cx-data.js';

function client(tables) {
  const calls=[];
  return {calls,rpc:vi.fn(async()=>({data:'2026-10-01',error:null})),from(table){
    const filters=[],entry={table,select:null,range:null,filters};calls.push(entry);
    const query={select(value){entry.select=value;return this;},eq(key,value){filters.push([key,value]);return this;},gte(){return this;},lte(){return this;},or(){return this;},order(){return this;},range(a,b){entry.range=[a,b];return this;},maybeSingle(){entry.single=true;return this;},then(resolve){
      let data=(tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));
      if(entry.range)data=data.slice(entry.range[0],entry.range[1]+1);
      return Promise.resolve({data:entry.single?data[0]||null:data,error:null}).then(resolve);
    }};return query;
  }};
}
describe('datos de agenda de torneo',()=>{
  it('elige la siguiente manga real, excluyendo canceladas y fechas fuera de temporada',()=>{
    expect(cxTournamentNextDate([
      {dateKey:'2027-01-29',cx_race_categories:[{dateKey:'2027-01-30',isCancelled:true},{dateKey:'2027-01-31',isCancelled:false}]},
      {dateKey:'2027-01-30',cx_race_categories:[]},
      {dateKey:'2027-03-01',cx_race_categories:[]},
    ],'2026-27','2027-01-29')).toBe('2027-01-30');
    expect(cxTournamentNextDate([{dateKey:'2027-03-01'}],'2026-27','2027-02-01')).toBeNull();
  });
  it('pagina solo fechas del torneo publicado y mantiene la RPC de agenda general',async()=>{
    const rows=Array.from({length:1001},()=>({seasonKey:'2026-27',tournamentId:'t',editorialStatus:'published',isCancelled:false,dateKey:'2026-10-01',cx_race_categories:[]}));
    const db=client({cx_races:[...rows,{...rows[0],tournamentId:'other',dateKey:'2026-09-12'}]});
    expect(await cxNextDate(db,'2026-27','2026-09-12','t')).toBe('2026-10-01');
    expect(db.calls.map(call=>call.range)).toEqual([[0,999],[1000,1999]]);
    expect(db.calls.every(call=>call.select==='dateKey,cx_race_categories(dateKey,isCancelled)')).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
    await cxNextDate(db,'2026-27','2026-09-12');
    expect(db.rpc).toHaveBeenCalledWith('cx_next_race_date',{p_season_key:'2026-27',p_date_key:'2026-09-12'},{get:true});
  });
  it('resuelve metadata actual sin atribuir el país de sus carreras',async()=>{
    const tournament={id:'t',name:'Circuito',slug:'circuito',seasonKey:'2026-27',logoUrl:'https://example.org/logo.svg'};
    const race={tournamentId:'t',seasonKey:'2026-27',editorialStatus:'published',countryCode:'ES'};
    const db=client({cx_tournaments:[tournament],cx_races:[race]});
    expect(await cxTournamentMetadata(db,'t')).toEqual({...tournament,countryCode:null});
    expect(db.calls.map(call=>call.table)).toEqual(['cx_tournaments']);
    for(const countryCode of ['BE',null])expect((await cxTournamentMetadata(client({cx_tournaments:[tournament],cx_races:[race,{...race,countryCode}]}),'t')).countryCode).toBeNull();
    expect(await cxTournamentMetadata(client({}),'missing')).toBeNull();
  });
});
