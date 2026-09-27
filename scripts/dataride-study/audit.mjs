import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {candidate,classifyYear,dimensions,norm,country} from './matching.mjs';
export function audit(input, output) {
  input=resolve(input); output=resolve(output);
  if(input===output || existsSync(join(output,'resumen.json'))) throw Error('Usar un directorio nuevo; no sobrescribir un estudio existente');
  const hashes={};
  const read=f=>{const b=readFileSync(join(input,f)); hashes[f]=createHash('sha256').update(b).digest('hex'); return JSON.parse(b);};
  const catalog=read('catalogo-dataride-2020-2025.json'), old=read('coincidencias-2026-ediciones.json'), missing=read('sin-coincidencia-en-2026.json'), cn=read('cn-races-dataride.json'), previous=read('resumen.json'), oldGroups=read('series-no-presentes-en-2026.json');
  const ours=[...old,...missing].map(x=>x.our).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(ours.map(x=>x.id)).size!==previous.ourRaces2026Active) throw Error('Snapshot propio incompleto o duplicado');
  if(new Set(catalog.map(c=>`${c.year}:${c.competitionId}`)).size!==catalog.length) throw Error('Catálogo con IDs duplicados por año');
  const cnMap=new Map(cn.filter(x=>Array.isArray(x.races)).map(x=>[x.competitionId,x.races]));
  const years=[2020,2021,2022,2023,2024,2025], rows=[], records=[];
  for(const our of ours) {
    const byYear={};
    for(const year of years) {
      const candidates=catalog.filter(c=>c.year===year).flatMap(c=> {const evidence=candidate(our,c,cnMap.get(c.competitionId)); return evidence ? [{...c,...evidence}] : [];});
      const status=classifyYear(candidates);
      byYear[year]={status,candidates};
      for(const c of candidates) rows.push({ourRaceId:our.id,ourName:our.name,yearStatus:status,...c});
    }
    records.push({our,editionsByYear:byYear});
  }
  // Una misma prueba no puede confirmar dos carreras propias. CN se compara por Id interno.
  const reverse=new Map();
  for(const row of rows) {
    const key=`${row.year}:${row.competitionId}:${row.internalCandidates?.length===1 ? row.internalCandidates[0].raceId : 'competition'}`;
    if(!reverse.has(key)) reverse.set(key,[]); reverse.get(key).push(row);
  }
  const collisions=[];
  for(const [key,items] of reverse) if(new Set(items.map(x=>x.ourRaceId)).size>1) {
    collisions.push({key,ourRaceIds:items.map(x=>x.ourRaceId)});
    for(const item of items) {item.yearStatus='ambiguous';item.reverseCollision=true; records.find(r=>r.our.id===item.ourRaceId).editionsByYear[item.year].status='ambiguous';}
  }
  for(const row of rows) row.yearStatus=records.find(r=>r.our.id===row.ourRaceId).editionsByYear[row.year].status;
  const seen=new Set(rows.map(r=>`${r.year}:${r.competitionId}`));
  const groups=new Map(), excluded=catalog.filter(c=>dimensions(c).age==='junior');
  for(const c of catalog) {
    if(seen.has(`${c.year}:${c.competitionId}`) || dimensions(c).age==='junior') continue;
    const d=dimensions(c), key=[norm(c.name),country(c.country),c.classCode,d.gender,d.age].join('|');
    if(!groups.has(key)) groups.set(key,{groupKey:key,name:c.name,country:c.country,classCode:c.classCode,age:d.age || 'unknown',gender:d.gender || 'unknown',status:'no_candidate_not_proven_absent',competitions:[]});
    groups.get(key).competitions.push(c);
  }
  const unmatched=[...groups.values()].map(g=>({...g,competitionCount:g.competitions.length,years:[...new Set(g.competitions.map(c=>c.year))]}));
  const statuses=Object.fromEntries(['unique_supported','unique_review','ambiguous','no_candidate'].map(s=>[s,records.reduce((n,r)=>n+Object.values(r.editionsByYear).filter(y=>y.status===s).length,0)]));
  const oldJunior=oldGroups.flatMap(g=>g.competitions).filter(c=>dimensions(c).age==='junior');
  const oldStrong=old.flatMap(r=>Object.values(r.editionsByYear).flat().filter(e=>e.status==='strong').map(e=>({ourRaceId:r.our.id,...e})));
  const delta=oldStrong.map(e=> {const r=rows.find(r=>r.ourRaceId===e.ourRaceId && r.year===e.year && r.competitionId===e.competitionId);return {ourRaceId:e.ourRaceId,year:e.year,competitionId:e.competitionId,name:e.name,previousStatus:'strong',status:r?.yearStatus || 'rejected'};});
  const cases=records.filter(r=>/down under|brabante|brabant|indurain|catalunya|getxo|toscana|chrono des nations|west bohemia|portugal.*futuro|giro.*(femen|women|donne)/i.test([r.our.name,r.our.nameEn].join(' ')));
  const summary={generatedAt:new Date().toISOString(),sourceSnapshotAt:previous.generatedAt,inputHashes:hashes,dataRideCompetitions:catalog.length,ourActiveSnapshot:ours.length,ourCancelledExcluded:previous.ourRaces2026Cancelled,previousUnmatchedGroups:oldGroups.length,previousUnmatchedCompetitions:oldGroups.reduce((n,g)=>n+g.competitions.length,0),previousUnmatchedJuniorCompetitions:oldJunior.length,juniorExcludedCompetitions:excluded.length,juniorExcludedGroups:new Set(excluded.map(c=>[norm(c.name),country(c.country),c.classCode].join('|'))).size,candidateRows:rows.length,competitionsWithCandidates:seen.size,raceYearStatuses:statuses,ourRacesWithCandidates:records.filter(r=>Object.values(r.editionsByYear).some(y=>y.candidates.length)).length,ourRacesWithoutCandidates:records.filter(r=>Object.values(r.editionsByYear).every(y=>!y.candidates.length)).length,unmatchedGroups:unmatched.length,unmatchedCompetitions:unmatched.reduce((n,g)=>n+g.competitionCount,0),unmatchedU23Groups:unmatched.filter(g=>g.age==='u23').length,unmatchedU23Competitions:unmatched.filter(g=>g.age==='u23').reduce((n,g)=>n+g.competitionCount,0),unmatchedUnknownAgeCompetitions:unmatched.filter(g=>g.age==='unknown').reduce((n,g)=>n+g.competitionCount,0),reverseCollisions:collisions.length,previousStrongNow:Object.fromEntries(['unique_supported','unique_review','ambiguous','rejected'].map(s=>[s,delta.filter(d=>d.status===s).length]))};
  if(summary.competitionsWithCandidates+summary.unmatchedCompetitions+excluded.length!==catalog.length) throw Error('Partición no exhaustiva/disjunta');
  mkdirSync(output,{recursive:true});
  const write=(f,data)=>writeFileSync(join(output,f),JSON.stringify(data,null,2)+'\n');
  const csv=(f,data,keys)=>{const cell=v=>'"'+String(typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')+'"';writeFileSync(join(output,f),[keys.map(cell).join(','),...data.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');};
  write('resumen.json',summary);write('carreras-2026-snapshot.json',ours);write('catalogo-dataride-2020-2025.json',catalog);
  write('coincidencias-2026-ediciones.json',records.filter(r=>Object.values(r.editionsByYear).some(y=>y.candidates.length)));
  write('sin-coincidencia-en-2026.json',records.filter(r=>Object.values(r.editionsByYear).every(y=>!y.candidates.length)));
  write('series-no-presentes-en-2026.json',unmatched);write('exclusiones-junior.json',excluded);write('series-u23-sin-candidato.json',unmatched.filter(g=>g.age==='u23'));
  write('cn-races-dataride.json',cn);write('colisiones-inversas.json',collisions);write('revision-strong-anteriores.json',delta);write('validacion-casos-reales.json',cases);
  csv('coincidencias-2026-ediciones.csv',rows,['ourRaceId','ourName','year','competitionId','name','classCode','country','yearStatus','evidence','verified','reviewReasons','internalCandidates']);
  csv('series-no-presentes-en-2026.csv',unmatched,['groupKey','name','country','classCode','age','gender','competitionCount','years','status']);
  const manifest={version:2,mode:'audit-only',applyAllowed:false,readyForCreation:[],executableActions:[],sourceSnapshotAt:previous.generatedAt,inputHashes:hashes,requiredReview:['Confirmar identidad, género y edad con fuentes oficiales por edición','Resolver todos los candidatos del año y las colisiones inversas','Verificar pruebas internas de campeonatos y obtener autorización separada para cualquier escritura'],findings:rows.map(r=>({ourRaceId:r.ourRaceId,year:r.year,competitionId:r.competitionId,verdict:r.yearStatus,status:'pendiente',risk:r.yearStatus==='unique_supported'?'identidad apoyada; alta sin validar':'identidad no resuelta',evidence:r.evidence,proposedAction:'revisión documental; no aplicar',applyAllowed:false}))};
  write('manifest-procesado-historico.json',manifest);
  const report=`# Corrección del estudio DataRide 2020–2025 frente a 2026

El estudio original queda sustituido, a efectos de interpretación, por esta auditoría. Ninguna salida autoriza altas, enlaces, resultados ni activación de timers. El manifiesto tiene applyAllowed=false y listas de acciones y altas vacías.

## Fuente y reproducción

Se reutiliza la extracción del ${previous.generatedAt}, sin nueva consulta de Supabase ni de DataRide. Los SHA-256 de las entradas están en resumen.json y en el manifiesto. Las ${ours.length} carreras activas se reconstruyen de los dos archivos del cruce original; las ${previous.ourRaces2026Cancelled} canceladas siguen excluidas. No se dispone del campo originalName ni de las filas originales completas: no se inventan aliases ausentes. Los resultados describen este snapshot, no el estado actual de 2026.

Comando: node scripts/dataride-study/audit.mjs ${input} DIRECTORIO_NUEVO
Comprobaciones: node --test scripts/dataride-study/matching.test.mjs

## Recuentos corregidos

| Concepto | Recuento |
|---|---:|
| Competiciones históricas (ediciones/registros, no carreras únicas) | ${catalog.length} |
| Grupos del antiguo listado sin correspondencia | ${oldGroups.length} |
| Competiciones contenidas en esos grupos | ${summary.previousUnmatchedCompetitions} |
| Competiciones junior detectadas en ese antiguo listado | ${oldJunior.length} |
| Competiciones junior excluidas del catálogo completo | ${excluded.length} |
| Competiciones con algún candidato | ${seen.size} |
| Grupos sin candidato no junior | ${unmatched.length} |
| Competiciones en esos grupos | ${summary.unmatchedCompetitions} |
| Grupos U23 sin candidato (incluidos en la fila anterior) | ${summary.unmatchedU23Groups} |
| Competiciones U23 sin candidato | ${summary.unmatchedU23Competitions} |
| Competiciones sin candidato y edad desconocida | ${summary.unmatchedUnknownAgeCompetitions} |
| Carreras 2026 con candidatos | ${summary.ourRacesWithCandidates} |
| Carreras 2026 sin candidatos | ${summary.ourRacesWithoutCandidates} |
| Filas candidato-carrera-año | ${rows.length} |
| Pares carrera-año con candidato único apoyado | ${statuses.unique_supported} |
| Pares carrera-año con candidato único pendiente | ${statuses.unique_review} |
| Pares carrera-año ambiguos | ${statuses.ambiguous} |
| Pares carrera-año sin candidato | ${statuses.no_candidate} |
| Colisiones inversas | ${collisions.length} |

La partición del catálogo es disjunta: ${seen.size} con candidatos + ${summary.unmatchedCompetitions} sin candidato + ${excluded.length} junior = ${catalog.length}. Los grupos se forman por nombre normalizado, país, categoría, género y edad; no representan identidades de carrera demostradas. Cambios de nombre o categoría pueden dividir una misma carrera en varios grupos. No hay un recuento demostrable de carreras únicas ni de altas necesarias.

## Criterios y exclusiones

Se detectan junior/juniors/junioren/juniores, JR/JC y MJ/WJ; se excluyen del cruce y se conservan en exclusiones-junior.json. U23, Under 23, Sub23, Espoirs, MU23/WU23 y 1.2U/2.2U se separan de junior. Ncup solo identifica una clase, no determina edad o género. Feminina, Femmine y Femminile se interpretan como femenino. Evidencias contradictorias no generan candidatos. La ausencia de marcadores no prueba edad ni género.

ES-CT y ES-PV se reducen a ES antes de quitar puntuación. Se admite una tabla explícita de equivalencias de países. En CN el país identifica el campeonato; en CC/CM/JO el país de celebración no identifica el ámbito continental o mundial. Esos campeonatos requieren coincidencia nominal y revisión de sus dimensiones.

Se elimina Levenshtein. Se exige nombre exacto, alias completo de la tabla, igualdad de tokens distintivos o contención para revisión. Giro, tour, volta, grand prix y otras palabras genéricas no prueban identidad. Los aliases propios truncados respecto de otro nombre propio se descartan. La contención nunca basta para unique_supported. País y familia de categoría incompatibles excluyen candidatos; las variaciones de rango dentro del mismo formato se permiten sin convertirlas en evidencia de identidad.

Se conservan todos los candidatos, sin límite de cuatro ni selección por puntuación. Dos candidatos en un año o una colisión inversa producen ambiguous. Un candidato con dimensiones incompletas es unique_review. unique_supported requiere dimensiones conocidas coherentes y evidencia nominal suficiente; en CN exige una prueba interna única con género, edad y modalidad explícitos. Ningún estado equivale a una alta preparada.

## Casos y revisión del estudio anterior

validacion-casos-reales.json conserva los candidatos y veredictos anuales de los casos presentes en el snapshot. Las pruebas automatizadas cubren Tour Down Under/Santos; Flecha de Brabante/De Brabantse Pijl; GP/Gran Premio Miguel Indurain; Catalunya ES-CT; Getxo ES-PV; Toscana/Romagna; Chrono élite/1.2U; West Bohemia U23/Grand Prix; Giro femenino/Giro Ciclistico 2.2U; Portugal do Futuro/Feminina, junto con variantes demográficas, aliases truncados y ambigüedad.

De las ${oldStrong.length} filas antes strong: ${summary.previousStrongNow.unique_supported} conservan apoyo único, ${summary.previousStrongNow.unique_review} pasan a revisión única, ${summary.previousStrongNow.ambiguous} resultan ambiguas y ${summary.previousStrongNow.rejected} quedan rechazadas por el nuevo criterio. El detalle está en revision-strong-anteriores.json. El resultado original de 815 carreras con candidato fuerte no debe reutilizarse como validación.

## Límites y trabajo pendiente

Sin candidato significa ausencia de candidato bajo este criterio y snapshot; no demuestra ausencia histórica ni que una carrera deba crearse. Persisten falsos negativos posibles por patrocinadores, traducciones no incluidas en la tabla, nombres originales ausentes, cambios de formato o categoría y dimensiones contradictorias. Los aliases solicitados corrigen fallos nominales conocidos, pero no resuelven por sí solos género o edad desconocidos. Chrono des Nations y denominaciones compartidas requieren pruebas internas o documentación oficial por edición. No se ha hecho esa verificación externa.

Los campeonatos pueden contener élite, U23 y junior dentro de una misma competición; excluir competiciones explícitamente junior no elimina sus pruebas internas junior del archivo fuente CN. Estas pruebas se filtran por dimensiones al evaluar cada carrera. Las competiciones CN sin pruebas internas guardadas permanecen pendientes. Los nombres con edades combinadas se tratan como conflicto, pudiendo generar falsos negativos conservadores.

El listado series-no-presentes-en-2026 conserva su nombre por compatibilidad documental; su estado explícito es no_candidate_not_proven_absent. No es una lista de altas. Las categorías de edad desconocida tampoco son un listado validado de élite. Toda conclusión operativa exige investigación adicional y autorización de escritura.

## Conservación

Se conservan íntegros el estudio original, output/ y work/. Este directorio contiene los resultados corregidos, el snapshot reproducible, la evidencia CN, los CSV, el manifiesto y la comparación con strong. La lógica y sus pruebas se mantienen en scripts/dataride-study/. No se crean temporales desechables ni se modifica la base de datos.
`;
  writeFileSync(join(output,'informe.md'),report); return summary;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {if(process.argv.length!==4) throw Error('Uso: audit.mjs ENTRADA SALIDA_NUEVA'); console.log(JSON.stringify(audit(process.argv[2],process.argv[3]),null,2));}
