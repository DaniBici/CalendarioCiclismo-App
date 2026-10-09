import {describe,it,expect} from 'vitest';
import {cxClampDay,cxRaceDays,cxAdjacentRaceDay,cxStepDay,cxDateStrip} from '../cx/today.js';

const race=(dateKey,categories=[])=>({id:dateKey,name:dateKey,dateKey,seasonKey:'2026-27',cx_race_categories:categories});

describe('vista Hoy de ciclocross',()=>{
  it('reúne los días de las categorías y usa la fecha de la prueba sin programa',()=>{
    const rows=[race('2026-10-10',[{category:'ME',dateKey:'2026-10-11'},{category:'WE',dateKey:'2026-10-10'}]),race('2026-09-19')];
    expect(cxRaceDays(rows)).toEqual(['2026-09-19','2026-10-10','2026-10-11']);
  });
  it('acota el día a la temporada',()=>{
    expect(cxClampDay('2026-07-15','2026-27')).toBe('2026-08-01');
    expect(cxClampDay('2027-03-02','2026-27')).toBe('2027-02-28');
    expect(cxClampDay('2026-11-01','2026-27')).toBe('2026-11-01');
  });
  it('salta al día con carreras contiguo o al día natural, sin salir de la temporada',()=>{
    const days=['2026-08-15','2026-10-04','2027-02-07'];
    expect(cxAdjacentRaceDay(days,'2026-08-15',1,'2026-27')).toBe('2026-10-04');
    expect(cxAdjacentRaceDay(days,'2026-10-04',-1,'2026-27')).toBe('2026-08-15');
    expect(cxStepDay(days,'2026-08-15',-1,'2026-27')).toBe('2026-08-14');
    expect(cxStepDay(days,'2026-08-01',-1,'2026-27')).toBeNull();
    expect(cxStepDay(days,'2027-02-07',1,'2026-27')).toBe('2027-02-08');
    expect(cxStepDay(days,'2027-02-28',1,'2026-27')).toBeNull();
  });
  it('centra la tira de siete días y la desplaza en los extremos de la temporada',()=>{
    expect(cxDateStrip('2026-10-10','2026-27')).toEqual(['2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13']);
    expect(cxDateStrip('2026-08-02','2026-27')[0]).toBe('2026-08-01');
    expect(cxDateStrip('2027-02-27','2026-27').at(-1)).toBe('2027-02-28');
  });
});
