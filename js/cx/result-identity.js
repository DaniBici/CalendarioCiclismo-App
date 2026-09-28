import {foldLatin} from '../name-fold.js';

// Mismo plegado latino que public.fold_name; conserva letras de otras escrituras.
const nameKey=value=>foldLatin(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const tokenKey=value=>nameKey(value).split(' ').filter(Boolean).sort().join(' ');
// otherNames guarda el nombre completo de la fuente (alias separados por comas); coincide
// con los mismos tokens en cualquier orden, como cx_rider_name_matches en la ingesta SQL.
const aliasKeys=rider=>String(rider?.otherNames||'').split(',').map(tokenKey).filter(Boolean);
const riderNameKeys=rider=>[nameKey(`${rider.firstName} ${rider.lastName}`),nameKey(`${rider.lastName} ${rider.firstName}`)];
const matchesAlias=(rider,value)=>{const key=tokenKey(value);return Boolean(key)&&aliasKeys(rider).includes(key);};

export function resolveCxResultIdentity(row, riders) {
  const compatible = rider => (!row.isoCode2 || !rider.nationality || row.isoCode2 === rider.nationality)
    && (!row.birthDate || !rider.birthDate || row.birthDate === rider.birthDate
      // Precisión 'year': la ficha guarda el 1 de enero y admite cualquier fecha de ese año.
      || (rider.birthDatePrecision === 'year' && String(row.birthDate).slice(0, 4) === String(rider.birthDate).slice(0, 4)));
  if (row.globalRiderId) {
    const explicit = riders.find(rider => rider.id === row.globalRiderId);
    if (!explicit || !compatible(explicit)) throw new Error('Ficha explícita ajena al catálogo/género CX o incompatible con país/nacimiento');
    return { id: explicit.id, candidates: [explicit.id], reason: explicit.verified ? 'explicit' : 'explicit_unverified' };
  }
  const display = nameKey(row.riderDisplay);
  const candidates = riders.filter(rider => rider.verified === true && compatible(rider) && (row.firstName && row.lastName
    ? (nameKey(row.firstName) === nameKey(rider.firstName) && nameKey(row.lastName) === nameKey(rider.lastName))
      || matchesAlias(rider, `${row.firstName} ${row.lastName}`)
    : riderNameKeys(rider).includes(display) || matchesAlias(rider, row.riderDisplay)));
  return { id: candidates.length === 1 ? candidates[0].id : null, candidates: candidates.map(rider => rider.id),
    reason: candidates.length === 1 ? 'verified_name' : candidates.length ? 'ambiguous' : 'unresolved' };
}


export function resolveCxPanelResultRows(rows,riders,startlist=[]) {
  return rows.map(row=>{
    if(row.globalRiderId)return {...row,globalRiderId:resolveCxResultIdentity(row,riders).id};
    const bib=String(row.bib||'').trim(),matches=bib?startlist.filter(s=>String(s.bib||'').trim()===bib):[];
    const sl=matches.length===1?matches[0]:null,rider=sl?.globalRiderId&&riders.find(r=>r.id===sl.globalRiderId&&r.verified===true);
    const compatible=rider&&(!row.isoCode2||!rider.nationality||row.isoCode2===rider.nationality)
      &&(riderNameKeys(rider).includes(nameKey(row.riderDisplay))||matchesAlias(rider,row.riderDisplay));
    const resolved=compatible?resolveCxResultIdentity({...row,globalRiderId:rider.id},riders):resolveCxResultIdentity(row,riders);
    return {...row,globalRiderId:resolved.id};
  });
}
