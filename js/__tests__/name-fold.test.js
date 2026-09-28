import {describe,it,expect} from 'vitest';
import {foldName,foldLatin} from '../name-fold.js';
import {resolveCxPanelResultRows} from '../cx/result-identity.js';

describe('plegado de nombres equivalente a public.fold_name',()=>{
  it('pliega todo el rango latino con diacrítico sin partir tokens',()=>{
    expect(foldName('Tvarůžková')).toBe('tvaruzkova');
    expect(foldName('Aleliūnaitė Irmantė')).toBe('aleliunaite irmante');
    expect(foldName('Jokūbas')).toBe('jokubas');
    expect(foldName('Miłosz')).toBe('milosz');
    expect(foldName('ČÉŠĄĘĮŲŐŰĀĒĪŅĻĶĢŖ')).toBe('cesaeiuouaeinlkgr');
    expect(foldName('Ştefan Ţurcan Șerban Țiriac')).toBe('stefan turcan serban tiriac');
    expect(foldName('Æsa Œuvre Þór Ðaði')).toBe('aesa oeuvre thor dadi');
    expect(foldName('Øyvind Đuro İlkay ẞtraße Sıddık')).toBe('oyvind duro ilkay sstrasse siddik');
    expect(foldName('Nguyễn Thị Ộ')).toBe('nguyen thi o');
    expect(foldName("  O'Shea-Smith  ")).toBe('o shea smith');
    expect(foldName('李 明')).toBe('');
  });
  it('conserva otras escrituras en el plegado latino',()=>{
    expect(foldLatin('Иван Łukasz')).toBe('иван lukasz');
  });
});

describe('enlace CX con fuentes ASCII',()=>{
  const riders=[
    {id:'tvaruzkova-tereza',firstName:'Tereza',lastName:'Tvarůžková',nationality:'CZ',verified:true},
    {id:'nowak-milosz',firstName:'Miłosz',lastName:'Nowak',nationality:'PL',verified:true},
  ];
  it('casa la ficha con diacríticos y el resultado publicado sin ellos',()=>{
    const rows=[{riderDisplay:'TVARUZKOVA Tereza',isoCode2:'CZ'},{riderDisplay:'Milosz NOWAK',isoCode2:'PL'}];
    expect(resolveCxPanelResultRows(rows,riders).map(row=>row.globalRiderId)).toEqual(['tvaruzkova-tereza','nowak-milosz']);
  });
});
