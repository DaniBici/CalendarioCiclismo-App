import {describe,it,expect} from 'vitest';
import {RIDER_SLUG_PATTERN,isValidRiderSlug,homonymIdentityKey,planRenameIdentityKeyClash} from '../rider-rename-logic.js';

describe('validación de slug de ficha de corredor',()=>{
  it('acepta minúsculas, dígitos y guiones',()=>{
    expect(isValidRiderSlug('alvarez-hector')).toBe(true);
    expect(isValidRiderSlug('pogacar-tadej-2')).toBe(true);
    expect(isValidRiderSlug('a')).toBe(true);
    expect(RIDER_SLUG_PATTERN.test('-guion-inicial-y-final-')).toBe(true);
  });
  it('rechaza mayúsculas, espacios, acentos, vacío y no-cadenas',()=>{
    expect(isValidRiderSlug('Alvarez-Hector')).toBe(false);
    expect(isValidRiderSlug('alvarez hector')).toBe(false);
    expect(isValidRiderSlug('álvarez')).toBe(false);
    expect(isValidRiderSlug('hector_2')).toBe(false);
    expect(isValidRiderSlug('')).toBe(false);
    expect(isValidRiderSlug(null)).toBe(false);
    expect(isValidRiderSlug(undefined)).toBe(false);
    expect(isValidRiderSlug(42)).toBe(false);
  });
});

describe('decisión homónimo vs fusión al renombrar una ficha',()=>{
  const base={samePerson:false,baseIdentityKey:'alvarez-hector',birthDate:'2006-03-04',homonymTaken:false};
  it('misma persona → fusionar sin tocar la clave de identidad',()=>{
    expect(planRenameIdentityKeyClash({...base,samePerson:true})).toEqual({action:'merge'});
    expect(planRenameIdentityKeyClash({...base,samePerson:true,birthDate:null})).toEqual({action:'merge'});
  });
  it('personas distintas con clave libre → homónimo declarado con el año propio',()=>{
    expect(planRenameIdentityKeyClash(base)).toEqual({action:'homonym',identityKey:'alvarez-hector-2006'});
  });
  it('personas distintas sin fecha de nacimiento → bloqueado, sin clave',()=>{
    const plan=planRenameIdentityKeyClash({...base,birthDate:null});
    expect(plan.action).toBe('blocked');
    expect(plan.identityKey).toBeUndefined();
  });
  it('clave de homónimo ya ocupada → bloqueado indicando la clave candidata',()=>{
    const plan=planRenameIdentityKeyClash({...base,homonymTaken:true});
    expect(plan.action).toBe('blocked');
    expect(plan.identityKey).toBe('alvarez-hector-2006');
    expect(plan.reason).toContain('alvarez-hector-2006');
  });
  it('la clave de homónimo solo se deriva con base y año de cuatro dígitos',()=>{
    expect(homonymIdentityKey('alvarez-hector','2006-03-04')).toBe('alvarez-hector-2006');
    expect(homonymIdentityKey('alvarez-hector',null)).toBeNull();
    expect(homonymIdentityKey('alvarez-hector','06-03-04')).toBeNull();
    expect(homonymIdentityKey(null,'2006-03-04')).toBeNull();
  });
});
