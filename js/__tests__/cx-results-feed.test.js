import {describe,it,expect} from 'vitest';
import {cxResultEntries} from '../cx/results-feed.js';

const category=(code,dateKey,winnerName=null,resultsStatus=winnerName?'official':null)=>({category:code,dateKey,winnerName,resultsStatus});
const race=(id,dateKey,categories,extra={})=>({id,name:id,dateKey,seasonKey:'2026-27',class:'C2',cx_race_categories:categories,...extra});

describe('pestaña Ciclocross de Resultados',()=>{
  it('lista por día, del más reciente al más antiguo, solo las categorías con ganador',()=>{
    const rows=[
      race('a','2026-10-04',[category('WE','2026-10-04','Ganadora'),category('ME','2026-10-04','Ganador'),category('MJ','2026-10-04')]),
      race('b','2026-10-10',[category('ME','2026-10-10','B1'),category('WE','2026-10-11','B2')]),
      race('c','2026-10-11',[category('ME','2026-10-11')]),
    ];
    const entries=cxResultEntries(rows);
    expect(entries.map(e=>`${e.date}:${e.race.id}`)).toEqual(['2026-10-11:b','2026-10-10:b','2026-10-04:a']);
    expect(entries.at(-1).categories.map(c=>`${c.category} ${c.winnerName}`)).toEqual(['ME Ganador','WE Ganadora']);
  });
});
