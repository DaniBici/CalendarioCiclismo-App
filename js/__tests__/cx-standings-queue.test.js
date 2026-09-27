import {describe,expect,it} from 'vitest';
import {processStandingsQueue} from '../../scripts/cx/cx-recompute-standings.mjs';

describe('incidencias de publicación de generales',()=>{
  it('conserva la prioridad manual como revisión, incluso si la general protegida está vacía',async()=>{
    const calls=[];let claims=0;
    const client={query:async(sql,params=[])=>{
      calls.push({sql,params});
      if(sql.includes('cx_claim_standings'))return {rows:[{claimed:claims++?null:{tournamentId:'own',category:'ME',generation:'9007199254740993'}}]};
      if(sql.includes('cx_standings_snapshot'))return {rows:[{snapshot:{digest:'old',input:{tournament:{id:'own',seasonKey:'2026-27',pointsScheme:{}},category:'ME',rounds:[]}}}]};
      if(sql.includes('cx_publish_standings'))throw Object.assign(new Error('General protegida'),{code:'22023'});
      if(sql.includes(' AS protected'))return {rows:[{protected:true}]};
      return {rows:[]};
    }};
    const result=await processStandingsQueue(client);
    expect(result[0]).toMatchObject({review:true,reviewReason:'General protegida'});expect(result[0].error).toBeUndefined();
    expect(calls.find(c=>c.sql.startsWith('UPDATE')).params).toEqual(['review','General protegida','own','ME','9007199254740993']);
    expect(calls.some(c=>c.sql.startsWith('DELETE'))).toBe(false);
  });
  it('una entrada obsoleta se reintenta con la generación reclamada y un error real conserva el error',async()=>{
    for(const code of ['40001','22023']){
      const calls=[];
      const client={query:async(sql,params=[])=>{
        calls.push({sql,params});
        if(sql.includes('cx_claim_standings'))return {rows:[{claimed:{tournamentId:'own',category:'ME',generation:'7'}}]};
        if(sql.includes('cx_standings_snapshot'))throw Object.assign(new Error('Cambio de entrada'),{code});
        if(sql.includes(' AS protected'))return {rows:[{protected:false}]};
        return {rows:[]};
      }};
      const [result]=await processStandingsQueue(client,{limit:1});expect(result.error).toBe('Cambio de entrada');
      const update=calls.find(c=>c.sql.startsWith('UPDATE'));expect(update.params[0]).toBe(code==='40001'?'pending':'error');
      expect(update.params.at(-1)).toBe('7');expect(update.sql).toContain("generation=$5 AND status='running'");
    }
  });
});
