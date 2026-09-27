import test from 'node:test';
import assert from 'node:assert/strict';
import {candidate,dimensions,classFamily,country,classifyYear,nameEvidence} from './matching.mjs';
const own=(name,category='1.1',extra={})=>({name,category,gender:'male',country:'ES',...extra});
const source=(name,classCode='1.1',extra={})=>({name,classCode,country:'ES',...extra});
for(const [a,b,cat,co] of [
 ['Tour Down Under','Santos Tour Down Under','2.UWT','AU'],
 ['Flecha de Brabante','De Brabantse Pijl','1.Pro','BE'],
 ['GP Miguel Indurain','Gran Premio Miguel Indurain','1.Pro','ES'],
 ['Volta a Catalunya','Volta Ciclista a Catalunya','2.UWT','ES-CT'],
 ['Circuito de Getxo','Circuito de Getxo - Memorial Hermanos Otxoa','1.1','ES-PV'],
]) test(`Alias completo: ${a}`,()=>assert.ok(candidate(own(a,cat,{country:co}),source(b,cat,{country:country(co)}))));
test('Toscana nunca Romagna',()=>assert.equal(candidate(own('Giro della Toscana','1.1',{country:'IT'}),source('Giro della Romagna','1.1',{country:'IT'})),null));
test('Chrono élite nunca 1.2U',()=>assert.equal(candidate(own('Chrono des Nations','1.1',{country:'FR'}),source('Chrono des Nations','1.2U',{country:'FR'})),null));
test('West Bohemia U23 nunca Grand Prix',()=>assert.equal(candidate(own('West Bohemia Tour U23','2.2U',{country:'CZ'}),source('Grand Prix West Bohemia','2.1',{country:'CZ'})),null));
test('Giro femenino nunca Giro U23',()=>assert.equal(candidate(own('Giro de Italia femenino','2.WWT',{country:'IT',gender:'female'}),source("Giro Ciclistico d'Italia",'2.2U',{country:'IT'})),null));
test('Portugal futuro nunca Feminina',()=>assert.equal(candidate(own('Volta a Portugal do Futuro','2.2U',{country:'PT'}),source('Volta a Portugal Feminina','2.2',{country:'PT'})),null));
for(const name of ['Junior','Juniors','Junioren','Juniores','MJ','WJ']) test(`Junior: ${name}`,()=>assert.equal(dimensions({name}).age,'junior'));
for(const name of ['Espoirs','MU23','WU23','Under 23','Sub23']) test(`U23: ${name}`,()=>assert.equal(dimensions({name}).age,'u23'));
for(const name of ['Feminina','Femmine','Femminile','Femenino','WJ','WU23']) test(`Femenino: ${name}`,()=>assert.equal(dimensions({name}).gender,'female'));
test('Clase U23 conserva punto y mayúsculas',()=> {for(const c of ['1.2U','2.2u']) {assert.equal(dimensions({category:c}).age,'u23');assert.equal(classFamily(c),c[0]+'U');} assert.equal(classFamily('CN'),'CN');});
test('Ncup no inventa edad ni género',()=> {assert.equal(dimensions({category:'2.Ncup'}).age,null);assert.equal(dimensions({category:'2.Ncup'}).gender,null);});
test('JR/JC excluidos',()=>{for(const classCode of ['JR','JC']) assert.equal(candidate(own('Test'),source('Test',classCode)),null);});
test('Países y subdivisiones',()=> {for(const c of ['ES-CT','ES-PV','ESP','es_ct']) assert.equal(country(c),'ES');assert.equal(country('GB-SCT'),'GB');});
test('CC usa identidad nominal, no país anfitrión',()=> {assert.ok(candidate(own('European Championships Men Elite','CC',{country:'FR'}),source('European Championships Men Elite','CC',{country:'IT'})));assert.equal(candidate(own('European Championships Men Elite','CC'),source('Asian Championships Men Elite','CC')),null);});
test('Alias truncado no prueba identidad',()=>assert.equal(nameEvidence({name:'Giro',nameEn:'Giro della Toscana'},{name:'Giro della Romagna'}),null));
test('País/género contradictorios rechazan',()=> {assert.equal(candidate(own('Test'),source('Test','1.1',{country:'FR'})),null);assert.equal(candidate(own('Test'),source('Test Women')),null);});
test('Ausencia de evidencia no confirma',()=>assert.equal(classifyYear([candidate(own('Test'),source('Test'))]),'unique_review'));
test('No hay corte de cuatro ni strong en ambiguos',()=>{assert.equal(classifyYear(Array.from({length:6},()=>({verified:true}))),'ambiguous');assert.equal(classifyYear([]),'no_candidate');assert.equal(classifyYear([{verified:true}]),'unique_supported');});
test('CN exige dimensiones internas explícitas',()=> {
 const a=own('National Championships Men Elite ITT','CN'),b=source('National Championships','CN');
 assert.equal(candidate(a,b,[{Id:1,RaceName:'Unknown'}]).verified,false);
 assert.equal(candidate(a,b,[{Id:1,RaceName:'Men Elite',RaceTypeCode:'ITT'}]).verified,true);
 assert.equal(candidate(a,b,[{Id:1,RaceName:'Men Junior',RaceTypeCode:'ITT'}]),null);
 assert.equal(classifyYear([candidate(a,b,[{Id:1,RaceName:'Men Elite',RaceTypeCode:'ITT'},{Id:2,RaceName:'Unknown'}])]),'ambiguous');
});

test('Toscana reconoce su memorial completo',()=>assert.ok(candidate(own('Giro della Toscana','1.1',{country:'IT'}),source('Giro della Toscana - Memorial Alfredo Martini','1.1',{country:'IT'}))));
test('Tour Down Under femenino reconoce Santos WWT',()=>assert.equal(candidate(own('Tour Down Under femenino','2.WWT',{country:'AU',gender:'female'}),source('Santos Tour Down Under','2.WWT',{country:'AU'})).verified,true));
