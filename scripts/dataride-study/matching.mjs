// Matching conservador: no convierte similitud ni dimensiones ausentes en identidad.
export const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
export function country(v) {
  const raw = String(v ?? '').trim().toUpperCase();
  const base = raw.split(/[-_]/)[0];
  return ({ESP:'ES', FRA:'FR', ITA:'IT', POR:'PT', GBR:'GB', UK:'GB', GER:'DE', DEU:'DE', BEL:'BE', NED:'NL', NLD:'NL', AUS:'AU', CZE:'CZ', CHE:'CH', SUI:'CH', USA:'US'})[base] || base || null;
}
export function classFamily(v) {
  const s = String(v ?? '').toUpperCase().replace(/\s/g, '');
  if (/^(CN|CC|CM|WC|JO)$/.test(s)) return s;
  if (/^[12]\.\d+U$/.test(s)) return s[0]+'U';
  if (/^[12]\.NCUP$/.test(s)) return s[0]+'NCUP';
  if (/^[12]\./.test(s)) return s[0];
  return s || null;
}
const combine = values => { const v = [...new Set(values.filter(Boolean))]; return v.length > 1 ? 'conflict' : v[0] || null; };
export function dimensions(row) {
  const n = norm([row.name, row.nameEn, row.originalName, row.RaceName, row.CategoryCode].filter(Boolean).join(' '));
  const c = String(row.classCode ?? row.uciCategory ?? row.category ?? '').toUpperCase().replace(/\s/g,'');
  const gender = combine([
    row.gender,
    /\b(women|woman|womens|ladies|female|femmes|femme|dames|donna|donne|femenina|femenino|feminina|feminino|femmine|femminile|mujeres|wj|we|wu23)\b/.test(n) ? 'female' : null,
    /\b(men|mens|male|masculino|masculine|hombres|hommes|heren|mj|me|mu23)\b/.test(n) ? 'male' : null,
    c.includes('WWT') ? 'female' : c.includes('UWT') ? 'male' : null,
  ]);
  const age = combine([
    /\b(junior|juniors|junioren|juniores|mj|wj|jr)\b/.test(n) || /^(JR|JC)$/.test(c) ? 'junior' : null,
    /\b(u23|under 23|sub23|sub 23|espoirs|espoir|mu23|wu23)\b/.test(n) || /^[12]\.\d+U$/.test(c) ? 'u23' : null,
    /\b(elite|me|we)\b/.test(n) || c.includes('WT') ? 'elite' : null,
  ]);
  // Ncup no determina por sí solo ni edad ni género. 1.2/2.2 tampoco.
  return {gender, age, family: classFamily(c), country: country(row.countryCode ?? row.country)};
}
export function type(row) {
  const n = norm([row.name, row.nameEn, row.RaceName, row.RaceTypeCode].join(' '));
  if (/\b(ttt|team time trial)\b/.test(n)) return 'ttt';
  if (/\b(itt|cri|individual time trial|crono)\b/.test(n)) return 'itt';
  if (/\b(irr|rr|road race|individual road race|linea|line)\b/.test(n)) return 'rr';
  return null;
}
const aliases = [
 ['tour down under','santos tour down under', 'tour down under femenino', 'tour down under women s', 'santos women s tour down under'],
 ['giro della toscana', 'giro della toscana memorial alfredo martini'],
 ['flecha de brabante','de brabantse pijl','brabantse pijl','de brabantse pijl la fleche brabanconne'],
 ['gp miguel indurain','gran premio miguel indurain'],
 ['volta a catalunya','volta ciclista a catalunya'],
 ['circuito de getxo','circuito de getxo memorial hermanos otxoa'],
];
const aliasMap = new Map(aliases.flatMap((a,i)=>a.map(n=>[n,'alias:'+i])));
const generic = new Set('the of de del della delle di d la le du des da do dos das van von a an and y tour giro volta vuelta classic classique cup grand gran prix premio gp memorial cycling ciclista ciclistico cycliste race road individual time trial team championship championships national'.split(' '));
const demographic = /^(women|woman|womens|ladies|female|femmes|femme|dames|donne|femenina|femenino|feminina|feminino|femmine|femminile|men|mens|male|masculino|hombres|mujeres|elite|u23|under|sub23|sub|23|junior|juniors|junioren|juniores|espoir|espoirs|mu23|wu23|mj|wj|rr|itt|ttt|cri)$/;
export const tokens = name => new Set(norm(name).split(' ').filter(t=>t && !generic.has(t) && !demographic.test(t) && !/^\d+$/.test(t)));
const subset = (a,b) => a.size > 0 && [...a].every(t=>b.has(t));
export function nameEvidence(ours, other) {
  const names = [ours.name,ours.nameEn,ours.originalName].filter(Boolean);
  const right = norm(other.name), rt = tokens(right);
  for (const left of names) {
    const l = norm(left), lt = tokens(l);
    // Un alias truncado no prueba identidad aunque aparezca en un campo propio.
    if (names.some(n=> {const t=tokens(n); return t.size>lt.size && subset(lt,t);})) continue;
    if (!lt.size || !rt.size) continue;
    if (l === right) return {kind:'exact', alias:left};
    if (aliasMap.has(l) && aliasMap.get(l) === aliasMap.get(right)) return {kind:'curated-alias', alias:left};
    if (subset(lt,rt) && subset(rt,lt)) return {kind:'distinctive-tokens', alias:left};
    if (lt.size >= 2 && rt.size >= 2 && (subset(lt,rt) || subset(rt,lt))) return {kind:'containment-review', alias:left};
  }
  return null;
}
export function candidate(ours, comp, internal) {
  const a=dimensions(ours), b=dimensions(comp);
  if ([a.gender,a.age,b.gender,b.age].includes('conflict')) return null;
  if (a.age==='junior' || b.age==='junior') return null;
  if (a.gender && b.gender && a.gender!==b.gender) return null;
  if (a.age && b.age && a.age!==b.age) return null;
  // Las carreras propias sin marcador de edad pertenecen al ámbito élite/abierto.
  if (!a.age && b.age==='u23') return null;
  if (a.family && b.family && a.family!==b.family) return null;
  const championship = ['CN','CC','CM','JO'].includes(a.family);
  if ((!championship || a.family==='CN') && a.country && b.country && a.country!==b.country) return null;
  if (a.family==='CN') {
    if (!a.country || a.country!==b.country) return null;
    const wantedAge=a.age || 'elite', wantedType=type(ours);
    const potential=(internal || []).filter(r=> {
      const d=dimensions(r), t=type(r);
      return ![d.gender,d.age].includes('conflict') && (!d.gender || d.gender===a.gender) && (!d.age || d.age===wantedAge) && (!t || t===wantedType);
    }).map(r=>({raceId:r.Id, name:r.RaceName, dimensions:dimensions(r), type:type(r)}));
    if (internal && !potential.length) return null;
    const exact=potential.length===1 && potential[0].dimensions.gender===a.gender && potential[0].dimensions.age===wantedAge && wantedType && potential[0].type===wantedType;
    return {evidence:'CN-country-internal-dimensions', verified:Boolean(exact), dimensions:{ours:a,source:b}, internalCandidates:potential, internalMissing:!internal};
  }
  const name=nameEvidence(ours,comp);
  if (!name) return null;
  const known = a.gender && b.gender===a.gender && b.age && b.age===(a.age || 'elite') && a.family && a.family===b.family && (championship || a.country && a.country===b.country);
  return {evidence:name.kind, alias:name.alias, dimensions:{ours:a,source:b}, verified:Boolean(known && name.kind!=='containment-review'), reviewReasons:[!b.gender && 'source-gender-unknown',!b.age && 'source-age-unknown',name.kind==='containment-review' && 'partial-name'].filter(Boolean)};
}
export function classifyYear(candidates) {
  return !candidates.length ? 'no_candidate' : candidates.length>1 || candidates.some(c=>c.internalCandidates?.length>1) ? 'ambiguous' : candidates[0].verified ? 'unique_supported' : 'unique_review';
}
