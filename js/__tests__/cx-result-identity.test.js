import {describe,it,expect} from 'vitest';
import {resolveCxPanelResultRows,resolveCxResultIdentity} from '../cx/result-identity.js';

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

describe('resolución por ID UCI de licencia',()=>{
  // Fichas importadas del ranking UCI: uciLicenseId sin uciProfileId.
  const rider={id:'breyer-fredrik',firstName:'Fredrik',lastName:'Breyer',nationality:'NO',birthDate:'2004-08-22',verified:true,uciProfileId:null,uciLicenseId:'10097367974'};
  const row={riderDisplay:'F. Breyer',firstName:'F.',lastName:'Breyer',isoCode2:'NO',uciLicenseId:'100 973 679 74'};
  it('resuelve por el ID de licencia aunque el nombre no coincida y la ficha no tenga uciProfileId',()=>{
    expect(resolveCxResultIdentity(row,[rider,{...rider,id:'otro',uciLicenseId:'10000000001'}])).toMatchObject({id:'breyer-fredrik',reason:'verified_uci_id'});
  });
  it('no resuelve por un ID de otra persona, una ficha no verificada ni una nacionalidad contradictoria',()=>{
    expect(resolveCxResultIdentity({...row,uciLicenseId:'10000000001'},[rider]).id).toBeNull();
    expect(resolveCxResultIdentity(row,[{...rider,verified:false}]).id).toBeNull();
    expect(resolveCxResultIdentity({...row,isoCode2:'SE'},[rider]).id).toBeNull();
  });
});
