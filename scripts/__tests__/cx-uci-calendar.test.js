import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {cxSeason,normalizeUciCompetition,collectUciCxCalendar} from '../../supabase/functions/_shared/cx-uci-calendar.mjs';
import {organizerWebsite} from '../../supabase/functions/_shared/uci-competition-api.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/uci-competition-cx-2026-27.json',import.meta.url),'utf8'));
const iso=code=>({BEL:'be',NED:'nl',ITA:'it',USA:'us'}[code]||null);
const pick=code=>{const item=structuredClone(fixture.list.find(i=>i.v1Code===code));return {item,detail:structuredClone(fixture.details[item.id])};};
const normalize=(code,edit=()=>{})=>{const {item,detail}=pick(code);edit(item,detail);return normalizeUciCompetition(item,detail,'2026-27',iso);};
const directory=({list=fixture.list,details=fixture.details,failDetail=false}={})=>{
  const seen=[];
  const fetcher=async url=>{
    seen.push(String(url));
    const {pathname,searchParams}=new URL(url);
    if (pathname==='/api/competitions') {
      const offset=Number(searchParams.get('offset'));
      return {ok:true,json:async()=>({count:list.length,limit:100,offset,items:list.slice(offset,offset+100)})};
    }
    const detail=details[decodeURIComponent(pathname.split('/').pop())];
    return failDetail||!detail?{ok:false,status:503}:{ok:true,json:async()=>structuredClone(detail)};
  };
  return {fetcher,seen};
};

describe('calendario oficial UCI CX',()=>{
  it('valida años cruzados de temporada',()=>{
    expect(cxSeason('2026-27').endYear).toBe(2027);
    expect(()=>cxSeason('2026-28')).toThrow();
  });
  it('normaliza categorías, país ISO2, ficha uci.org y horarios desconocidos',()=>{
    const item=normalize('D2CP79146');
    expect(item.race).toMatchObject({name:'Telenet Superprestige - Jaarmarktcross',slug:'telenet-superprestige-jaarmarktcross-2026',class:'C1',
      countryCode:'BE',dateKey:'2026-11-11',endDateKey:null,venue:'Niel',timezone:null,uciCalendarId:79146,
      calendarSourceUrl:'https://www.uci.org/competition-details/2027/CRO/79146',websiteUrl:'https://www.jaarmarktcross.be'});
    expect(item.categories.map(c=>c.category)).toEqual(['ME','WE','MJ','WJ']);
    expect(item.categories.every(c=>c.startTimeUtc===null)).toBe(true);
  });
  it('toma las fechas de los días con carrera y recorta el nombre',()=>{
    const item=normalize('D2CP81257');
    expect(item.race).toMatchObject({name:'Dutch National Championships',class:'CN',dateKey:'2027-01-10',endDateKey:null});
  });
  it('excluye el relevo, conserva la fecha de cada categoría y descarta lo que no tiene categorías individuales',()=>{
    const worlds=normalize('D2CP74371');
    // El día del relevo cuenta para el rango de la carrera, no para las categorías.
    expect(worlds.race).toMatchObject({class:'CM',dateKey:'2027-01-29',endDateKey:'2027-01-31'});
    expect(worlds.excluded).toEqual([expect.objectContaining({category:'XE',dateKey:'2027-01-29'})]);
    expect(worlds.categories.find(c=>c.category==='WE').dateKey).toBe('2027-01-30');
    expect(normalize('D2CP79166').excludedCompetition.reason).toBe('no_supported_individual_category');
  });
  it('no repite la disciplina en el slug',()=>{
    expect(normalize('D2CP79146',item=>{item.name='Cyclo-cross Gernelle';}).race.slug).toBe('gernelle-2026');
  });
  it('rechaza marzo–julio, categorías repetidas en fechas distintas y competiciones sin ID',()=>{
    expect(()=>normalize('D2CP79146',(item,detail)=>{for(const race of detail.races)race.startDate=race.endDate='2027-03-01';})).toThrow(/agosto–febrero/);
    expect(normalize('D2CP79146',(item,detail)=>{for(const race of detail.races)race.startDate=race.endDate='2027-02-28';}).race.dateKey).toBe('2027-02-28');
    expect(()=>normalize('D2CP79146',(item,detail)=>{detail.races.push({...detail.races[0],startDate:'2026-11-12',endDate:'2026-11-12'});})).toThrow(/repetida/);
    expect(()=>normalize('D2CP79146',item=>{item.v1Code='CRO_2027_C1_000001';})).toThrow(/v1Code/);
  });
  it('completa webs sin protocolo y descarta texto que no es una URL',()=>{
    expect(organizerWebsite('www.knwu.nl')).toBe('https://www.knwu.nl');
    expect(organizerWebsite('https://trevallivaresine.info/en/')).toBe('https://trevallivaresine.info/en/');
    expect(organizerWebsite('Facebook.com/CX Włoszakowice')).toBeNull();
    expect(organizerWebsite('javascript:alert(1)')).toBeNull();
    expect(organizerWebsite('TBC')).toBeNull();
  });
  it('lee la temporada por su año final y desambigua slugs repetidos',async()=>{
    const {item}=pick('D2CP79146');
    const twin={...item,id:'twin',v1Code:'D2CP99999'};
    const {fetcher,seen}=directory({list:[...fixture.list,twin],details:{...fixture.details,twin:fixture.details[item.id]}});
    const manifest=await collectUciCxCalendar({countryCode:iso,fetcher});
    const listing=new URL(seen[0]).searchParams;
    expect([listing.get('disciplineCode'),listing.get('seasonYear')]).toEqual(['CRO','2027']);
    expect(manifest).toMatchObject({version:1,source:'uci_web_calendar',summary:{listedCompetitions:5,races:4,excludedCompetitions:1,categories:18}});
    expect(manifest.races.map(r=>r.race.slug).filter(s=>s.startsWith('telenet'))).toEqual(['telenet-superprestige-jaarmarktcross-2026','telenet-superprestige-jaarmarktcross-2026-2']);
  });
  it('no produce un manifiesto vacío ni oculta fichas fallidas',async()=>{
    await expect(collectUciCxCalendar({countryCode:iso,fetcher:directory({list:[]}).fetcher})).rejects.toThrow(/vacío/);
    await expect(collectUciCxCalendar({countryCode:iso,fetcher:directory({failDetail:true}).fetcher})).rejects.toThrow(/incompleta/);
  });
});
