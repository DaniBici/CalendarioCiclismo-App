import {describe,it,expect} from 'vitest';
import {resolveCxPanelResultRows} from '../cx-result-identity.js';

describe('enlazado de resultados del panel CX con el resolver de ingesta',()=>{
  const rider={id:'cx-uno',firstName:'Uno',lastName:'Local',nationality:'BE',birthDate:'2000-01-02',verified:true};
  const row={rank:1,bib:'10',riderDisplay:'Local Uno',isoCode2:'BE',timeText:'1:00:00',bonusSeconds:null};
  it('resuelve por dorsal curado una identidad única y conserva texto, unidades y entrada',()=>{
    const before=structuredClone(row),other={...rider,id:'homonimo'};
    const [resolved]=resolveCxPanelResultRows([row],[rider,other],[{bib:'10',globalRiderId:rider.id}]);
    expect(resolved).toEqual({...row,globalRiderId:rider.id});expect(row).toEqual(before);
    expect(resolveCxPanelResultRows([row],[rider,other],[{bib:'10',globalRiderId:rider.id},{bib:'10',globalRiderId:other.id}])[0].globalRiderId).toBeNull();
  });
  it('no asigna homónimos, datos contradictorios, fichas no verificadas ni un catálogo ajeno',()=>{
    expect(resolveCxPanelResultRows([{...row,riderDisplay:'Otro Corredor'}],[rider],[{bib:'10',globalRiderId:rider.id}])[0].globalRiderId).toBeNull();
    expect(resolveCxPanelResultRows([{...row,isoCode2:'ES'}],[rider],[{bib:'10',globalRiderId:rider.id}])[0].globalRiderId).toBeNull();
    expect(resolveCxPanelResultRows([row],[{...rider,verified:false}],[{bib:'10',globalRiderId:rider.id}])[0].globalRiderId).toBeNull();
    expect(()=>resolveCxPanelResultRows([{...row,globalRiderId:'road-uno'}],[rider])).toThrow('catálogo/género CX');
    expect(resolveCxPanelResultRows([row],[rider,{...rider,id:'homonimo'}])[0].globalRiderId).toBeNull();
  });
  it('conserva la elección explícita compatible y rechaza país/nacimiento contradictorio',()=>{
    expect(resolveCxPanelResultRows([{...row,globalRiderId:rider.id}],[rider])[0].globalRiderId).toBe(rider.id);
    expect(()=>resolveCxPanelResultRows([{...row,globalRiderId:rider.id,birthDate:'2001-01-02'}],[rider])).toThrow('incompatible');
  });
});
