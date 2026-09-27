import {describe,it,expect} from 'vitest';
import {cxSeason,uciCivilDate,uciCompetitionProps,normalizeUciCompetition,collectUciCxCalendar} from '../../supabase/functions/_shared/cx-uci-calendar.mjs';

const entry={name:'Canmore',country:'CAN',uciCalendarId:79079,calendarSourceUrl:'https://www.uci.org/competition-details/2027/CRO/79079'};
const props={competitionDetails:{name:'Canmore',venue:'Canmore, AB',competitionClass:'C2 - Class 2',website:{url:'https://example.org/'}},schedule:{items:[{date:'12 Sep 2026',races:[{category:'Men Elite',raceType:'Individual',raceClass:'C2 - Class 2'},{category:'Women Junior',raceType:'Individual',raceClass:'C2 - Class 2'}]}]}};
const html=p=>`<div data-props="${JSON.stringify(p).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></div>`;
const list={items:[{items:[{items:[{...entry,detailsLink:{url:'/competition-details/2027/CRO/79079'}}]}]}]};

describe('calendario oficial UCI CX',()=>{
  it('valida años cruzados y fechas civiles reales',()=>{
    expect(cxSeason('2026-27').endYear).toBe(2027);
    expect(()=>cxSeason('2026-28')).toThrow();
    expect(uciCivilDate('9 Jan 2027')).toBe('2027-01-09');
    expect(()=>uciCivilDate('29 Feb 2027')).toThrow();
  });
  it('lee JSON de atributos HTML sin alterar nombres con entidades',()=>{
    const p=structuredClone(props);p.competitionDetails.name='A & B "Cross"';
    expect(uciCompetitionProps(html(p))).toEqual(p);
    expect(()=>uciCompetitionProps('<html>error</html>')).toThrow();
  });
  it('conserva categorías presentes, país ISO2 y horarios desconocidos',()=>{
    const item=normalizeUciCompetition(entry,props,'2026-27',()=> 'ca');
    expect(item.race.countryCode).toBe('CA');
    expect(item.race.slug).toBe('canmore-2026');
    expect(item.race.timezone).toBeNull();
    expect(item.categories.map(c=>c.category)).toEqual(['ME','WJ']);
    expect(item.categories.every(c=>c.startTimeUtc===null)).toBe(true);
  });
  it('desambigua slugs repetidos del mismo nombre y año civil',async()=>{
    const first={...entry,detailsLink:{url:'/competition-details/2027/CRO/79079'}};
    const second={...entry,uciCalendarId:79080,detailsLink:{url:'/competition-details/2027/CRO/79080'}};
    const duplicated={items:[{items:[{items:[first,second]}]}]};
    const manifest=await collectUciCxCalendar({countryCode:()=> 'ca',fetcher:async url=>{
      if(String(url).includes('/api/'))return {ok:true,json:async()=>duplicated};
      return {ok:true,text:async()=>html(props)};
    }});
    const slugs=manifest.races.map(r=>r.race.slug).sort();
    expect(slugs).toEqual(['canmore-2026','canmore-2026-2']);
  });
  it('admite el último día de febrero y rechaza marzo–julio sin desplazar fechas',()=>{
    const p=structuredClone(props);
    for(const month of ['Mar','Apr','May','Jun','Jul']) {
      p.schedule.items[0].date=`1 ${month} 2027`;
      expect(()=>normalizeUciCompetition(entry,p,'2026-27',()=> 'ca')).toThrow(/agosto–febrero/);
    }
    p.schedule.items[0].date='28 Feb 2027';
    expect(normalizeUciCompetition(entry,p,'2026-27',()=> 'ca').race.dateKey).toBe('2027-02-28');
    p.schedule.items[0].date='29 Feb 2028';
    expect(normalizeUciCompetition(entry,p,'2027-28',()=> 'ca').race.dateKey).toBe('2028-02-29');
  });
  it('excluye relevo y máster y rechaza repeticiones que el modelo no representa',()=>{
    const p=structuredClone(props);
    p.schedule.items[0].races.push({category:'Mixed Elite',raceType:'Team Relay',raceClass:'CM - World Championships'});
    expect(normalizeUciCompetition(entry,p,'2026-27',()=> 'ca').excluded).toHaveLength(1);
    p.schedule.items.push({...p.schedule.items[0],date:'13 Sep 2026'});
    expect(()=>normalizeUciCompetition(entry,p,'2026-27',()=> 'ca')).toThrow(/repetida/);
  });
  it('une calendarios upcoming/past por ID, sin usar seasonId de DataRide',async()=>{
    const urls=[];
    const manifest=await collectUciCxCalendar({countryCode:()=> 'ca',fetcher:async url=>{
      urls.push(url);return {ok:true,json:async()=>list,text:async()=>html(props)};
    }});
    expect(manifest.summary).toMatchObject({listedCompetitions:1,races:1,categories:2});
    expect(urls).toHaveLength(3);
    expect(urls.slice(0,2).every(url=>url.includes('year=2027')&&!url.includes('seasonId'))).toBe(true);
  });
  it('no produce un manifiesto vacío ni oculta fichas fallidas',async()=>{
    await expect(collectUciCxCalendar({countryCode:()=>null,fetcher:async()=>({ok:true,json:async()=>({items:[]})})})).rejects.toThrow(/vacío/);
    await expect(collectUciCxCalendar({countryCode:()=>null,fetcher:async url=>url.includes('/api/')?{ok:true,json:async()=>list}:{ok:false,status:503}})).rejects.toThrow(/incompleta/);
  });
});
