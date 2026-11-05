import {describe,it,expect} from 'vitest';
import {cxMonthDays,cxSeason,cxSeasonMonths,cxLapsLost,cxResultCell,cxResultCells,cxResultRank} from '../cx/presentation.js';
import {cxDateInSeason,cxSeasonBounds} from '../cx/season.js';

describe('agenda y clasificación pública CX',()=>{
  const world={name:'Mundial',slug:'mundial',slugEn:'worlds',class:'CM',dateKey:'2027-01-29',endDateKey:'2027-01-31',cx_race_categories:[
    {category:'ME',dateKey:'2027-01-31'},{category:'WE',dateKey:'2027-01-30'},{category:'MU',dateKey:'2027-01-30'}]};
  it('delimita agosto–febrero y abre la siguiente temporada fuera de esa ventana',()=>{
    expect(cxSeason(new Date(2026,6,31))).toBe('2026-27');
    expect(cxSeason(new Date(2026,7,1))).toBe('2026-27');
    expect(cxSeason(new Date(2027,1,28))).toBe('2026-27');
    expect(cxSeason(new Date(2027,2,1))).toBe('2027-28');
    expect(cxSeasonMonths('2026-27')).toEqual(['2026-08','2026-09','2026-10','2026-11','2026-12','2027-01','2027-02']);
    expect(cxSeasonBounds('2027-28')).toEqual({first:'2027-08-01',last:'2028-02-29'});
    expect(cxDateInSeason('2026-27','2027-02-28')).toBe(true);
    expect(cxDateInSeason('2026-27','2027-02-29')).toBe(false);
    expect(cxDateInSeason('2026-27','2027-03-01')).toBe(false);
    for(let month=3;month<=7;month++) expect(cxMonthDays([{...world,dateKey:`2027-0${month}-01`,cx_race_categories:[]}],`2027-0${month}`)).toEqual([]);
  });
});

describe('vueltas perdidas en la celda de resultados CX',()=>{
  it('reconoce los formatos de vuelta perdida que publica DataRide',()=>{
    expect(cxLapsLost({irm:'LAP',gapText:'-2 LAPS'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',gapText:'- 4 LAP'})).toBe(4);
    expect(cxLapsLost({irm:'LAP',gapText:'@ 3 LAPS'})).toBe(3);
    expect(cxLapsLost({irm:'LAP',gapText:'2 LAP'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',gapText:'-1 LAP'})).toBe(1);
    expect(cxLapsLost({irm:null,gapText:'-2 LAPS'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:'2'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:'- 2'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:"'-1'"})).toBe(1);
    expect(cxLapsLost({irm:'LAP'})).toBeNull();
    expect(cxLapsLost({irm:'LAP',timeText:'0'})).toBeNull();
    expect(cxLapsLost({irm:'LAP',timeText:'1:02:28'})).toBeNull();
    expect(cxLapsLost({irm:null,gapText:'+38'})).toBeNull();
    expect(cxLapsLost({irm:null,timeText:'2'})).toBeNull();
    expect(cxLapsLost(null)).toBeNull();
  });
  it('presenta vueltas perdidas, estado, gap y tiempo sin mezclar la celda',()=>{
    expect(cxResultCell({irm:'LAP',gapText:'-2 LAPS'})).toEqual({text:'-2 vueltas',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP',gapText:'-1 LAP'})).toEqual({text:'-1 vuelta',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP'})).toEqual({text:'vuelta perdida',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP',timeText:'1:02:28'})).toEqual({text:'vuelta perdida',cls:'res-lap'});
    expect(cxResultCell({irm:'DNF'})).toEqual({text:'',cls:''});
    expect(cxResultCell({gapText:'+38'})).toEqual({text:'+38"',cls:'res-gap'});
    expect(cxResultCell({rank:1,timeText:'0:57:15'})).toEqual({text:'57:15',cls:'res-time'});
    expect(cxResultCell({rank:1,timeSeconds:'3600'})).toEqual({text:'1:00:00',cls:'res-time'});
    // Con timeSeconds resuelto, un reloj H:MM:SS exacto no se relee como MM:SS:00.
    expect(cxResultCell({rank:1,timeText:'01:03:00',timeSeconds:'3780'})).toEqual({text:'1:03:00',cls:'res-time'});
    expect(cxResultCell({rank:1,timeText:'45:10:00',timeSeconds:'2710'})).toEqual({text:'45:10',cls:'res-time'});
    expect(cxResultCell({timeSeconds:'invalid'})).toEqual({text:'',cls:''});
    expect(cxResultCell({rank:1,irm:null,gapText:null,timeText:'2'})).toEqual({text:'2',cls:'res-time'});
    expect(cxResultCell({irm:null})).toEqual({text:'',cls:''});
    expect(cxResultCell(null)).toEqual({text:'',cls:''});
  });
  it('presenta los cronos de Canmore y los IRM como carretera, salvo LAP',()=>{
    const rows=[{rank:1,timeText:'1:00:33.8'},{rank:2,timeText:'1:00:40.0'},
      {rank:3,timeText:'1:00:40.9'},{rank:4,irm:'LAP',gapText:'-2 LAPS'},
      {rank:5,irm:'DNF',rankText:'5',timeText:'7:16.9'}];
    const cells=cxResultCells(rows);
    expect([...cells.values()].map(c=>c.text)).toEqual(['1:00:33','+7"','m.t.','-2 vueltas','']);
    expect(cxResultRank(rows[4])).toBe('ABN');
    expect(cxResultRank(rows[4],'en')).toBe('DNF');
    expect(cxResultRank(rows[3])).toBe(4);
    const winner={rank:1,timeText:'42:09.2'},second={rank:2,timeText:'42:09.3'};
    expect(cxResultCells([winner,second]).get(second).text).toBe('m.t.');
    expect(cxResultCell({rank:2,timeText:'42:10.0',gapText:'+0.8'},winner).text).toBe('+1"');
    expect(cxResultCell({rank:2,timeText:'0:00:05'},winner).text).toBe('0:05');
    expect(cxResultCell({rank:1,timeSeconds:'3210'}).text).toBe('53:30');
  });
});
