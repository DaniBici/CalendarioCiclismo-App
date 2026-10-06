import {describe,it,expect} from 'vitest';
import {parseCxRows,cxLocalToUtc,cxDuration,cxSeconds,cxChipText,validateCxScheme,cxUrl,cxAssertMapImageUrl,cxSaveErrorMessage,cxYouTubeVideoId,cxYouTubeWatchUrl,cxPointValue,cxPoints,compareCxStandings,cxManualStandingsRows,cxManualStandingsCalculation} from '../cx/editor-logic.js';

describe('editor CX: unidades, datos desconocidos e importación',()=>{
  it('acepta solo vídeos identificables de YouTube y guarda su URL canónica',()=>{
    expect(cxYouTubeVideoId('https://youtu.be/abcdefghijk?t=12')).toBe('abcdefghijk');
    expect(cxYouTubeVideoId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(cxYouTubeWatchUrl('https://m.youtube.com/watch?v=abcdefghijk&feature=share')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    for(const url of ['https://example.org/watch?v=abcdefghijk','https://fakeyoutube.com/watch?v=abcdefghijk','http://youtu.be/abcdefghijk','https://youtube.com/watch?v=bad']) {
      expect(cxYouTubeVideoId(url)).toBeNull();
      expect(()=>cxYouTubeWatchUrl(url)).toThrow(/YouTube/);
    }
  });
  it('distingue bonos desconocidos de ausencia confirmada',()=>{
    const rows=parseCxRows('puesto\tcorredor\tsegundos\tbonosegundos\n1\tUno\t1:01:05\t\n2\tDos\t1:02:00\t0');
    expect(rows[0].timeSeconds).toBe(3665);expect(rows[0].bonusSeconds).toBeNull();expect(rows[1].bonusSeconds).toBe(0);
    expect(cxDuration(27*3600+65)).toBe('27:01:05');
    expect(parseCxRows('puesto\tcorredor\tbonosegundos\n1\tUno\t')[0].bonusSeconds).toBeNull();
  });
  it('rechaza duraciones y columnas ambiguas',()=>{
    expect(()=>cxSeconds('1:99:00')).toThrow();expect(()=>cxSeconds('-10')).toThrow();expect(()=>cxSeconds('99999999999999999999')).toThrow();
    expect(()=>parseCxRows('puesto\tpuesto\n1\t2')).toThrow();
    expect(()=>parseCxRows('puesto\tcorredor\n1\tNombre\textra')).toThrow();
  });
  it('conserva segundos bigint y puntos decimales sin redondearlos',()=>{
    expect(cxSeconds('9223372036854775807')).toBe('9223372036854775807');
    expect(cxDuration('9007199254740993')).toBe('2501999792983:36:33');
    expect(()=>cxSeconds(9007199254740992)).toThrow(/pérdida/);
    const [row]=parseCxRows('puesto\tcorredor\tpuntos\tsegundos\n1\tUno\t9007199254740993.123456789012\t9007199254740993');
    expect(row.points).toBe('9007199254740993.123456789012');expect(row.timeSeconds).toBe('9007199254740993');
    expect(cxPoints('12.123456789012','es-ES')).toBe('12,123456789012');
    expect(cxPoints('-0.125','en-GB')).toBe('-0.125');
    expect(cxPointValue('-000.000')).toBe('0');expect(cxPointValue('0012.500')).toBe('12.5');
    expect(cxDuration(null)).toBe('—');expect(cxPoints(null)).toBe('—');
  });
  it('coteja unidades exactas y distingue totales desconocidos de cero',()=>{
    const official=[{rank:1,riderDisplay:'Uno',points:'12.123456789012'}];
    expect(compareCxStandings(official,[{...official[0],points:'12.123456789013'}],'points')).toHaveLength(1);
    expect(compareCxStandings([{...official[0],points:0}],[{...official[0],points:null}],'points')).toHaveLength(1);
    expect(compareCxStandings([{rank:1,riderDisplay:'Uno',timeSeconds:'9007199254740993'}],[{rank:1,riderDisplay:'Uno',timeSeconds:'9007199254740992'}],'time')).toHaveLength(1);
    expect(compareCxStandings(official,[{...official[0],points:'012.123456789012'}],'points')).toEqual([]);
    expect(()=>compareCxStandings([{rank:1,riderDisplay:'Uno',points:null}],[],'points')).toThrow(/desconocido/);
    expect(()=>compareCxStandings([official[0],{rank:2,riderDisplay:'UNO',points:1}],[],'points')).toThrow(/repetido/);
    expect(()=>compareCxStandings([official[0],{rank:1,riderDisplay:'Dos',points:1}],[],'points')).toThrow(/repetido/);
    expect(compareCxStandings(official,[official[0],{...official[0],rank:2}],'points')[0]).toContain('ambigua');
  });
  it('los inscritos requieren nombre, apellido y país ISO2',()=>{
    expect(parseCxRows('dorsal\tnombre\tapellido\tpais\n\tNombre\tApellido\tbe','startlist')[0]).toMatchObject({bib:null,countryCode:'BE'});
    expect(()=>parseCxRows('nombre\tapellido\tpais\nNombre\tApellido\tBEL','startlist')).toThrow();
  });
  it('admite coexistencia por categoría y no mezcla puntos con tiempos',()=>{
    expect(validateCxScheme({categories:{ME:{mode:'time'},WE:{mode:'points',perRank:[25,20]}}})).toBeTruthy();
    expect(()=>validateCxScheme({categories:{ME:{mode:'time',perRank:[25]}}})).toThrow();
    expect(()=>validateCxScheme({categories:{MJ:{mode:'points'}}})).toThrow();
  });
  it('convierte zonas IANA en verano/invierno y rechaza horas DST imposibles o repetidas',()=>{
    expect(cxLocalToUtc('2026-09-12','15:00','Europe/Brussels')).toBe('2026-09-12T13:00:00.000Z');
    expect(cxLocalToUtc('2026-11-01','15:00','Europe/Brussels')).toBe('2026-11-01T14:00:00.000Z');
    expect(cxLocalToUtc('2026-09-12','15:00','America/Edmonton')).toBe('2026-09-12T21:00:00.000Z');
    expect(()=>cxLocalToUtc('2026-03-29','02:30','Europe/Brussels')).toThrow(/no existe/);
    expect(()=>cxLocalToUtc('2026-10-25','02:30','Europe/Brussels')).toThrow(/se repite/);
    expect(()=>cxLocalToUtc('2026-11-01','15:00',null)).toThrow();
  });
  it('valida enlaces y contraste de chips',()=>{
    expect(()=>cxUrl('javascript:alert(1)')).toThrow();
    expect(cxChipText('#ffffff')).toBe('#000000');expect(cxChipText('#000000')).toBe('#ffffff');
  });
  it('acepta como mapa solo URL JPG o PNG, sin contar la consulta',()=>{
    for(const url of [null,'https://example.org/map.png?v=2','https://example.org/map.JPEG'])expect(cxAssertMapImageUrl(url)).toBe(url);
    for(const ext of ['pdf','webp'])expect(()=>cxAssertMapImageUrl(`https://example.org/map.${ext}?v=2`)).toThrow('El mapa debe ser JPG o PNG.');
  });
  it('traduce los conflictos de slug y conserva el resto de errores de guardado',()=>{
    const duplicate=constraint=>new Error(`duplicate key value violates unique constraint "${constraint}"`);
    expect(cxSaveErrorMessage(duplicate('cx_races_slugEn_key'))).toBe('El slug en inglés ya está en uso por otra carrera. Modificar «Slug (EN)».');
    expect(cxSaveErrorMessage(duplicate('cx_races_slug_key'))).toBe('El slug ya está en uso por otra carrera. Modificar «Slug».');
    expect(cxSaveErrorMessage(new Error('No se pudo guardar'))).toBe('No se pudo guardar');
  });
  it('reordena un ajuste manual de la general por total y exige puestos consecutivos',()=>{
    const rows=[{rank:1,globalRiderId:'a',riderDisplay:'A',value:'8:08:15'},{rank:2,globalRiderId:'b',riderDisplay:'B',value:'8:07:00'},{rank:3,globalRiderId:'c',riderDisplay:'C',value:'8:07:00'}];
    expect(cxManualStandingsRows(rows,'time',{sortByTotal:true}).map(row=>[row.rank,row.globalRiderId,row.timeSeconds])).toEqual([[1,'b','29220'],[2,'c','29220'],[3,'a','29295']]);
    expect(()=>cxManualStandingsRows(rows.map(row=>({...row,rank:1})),'time')).toThrow('Los puestos');
    expect(()=>cxManualStandingsRows([{...rows[0],value:''}],'time')).toThrow('total vacío');
    const calculation=cxManualStandingsCalculation('ME','points',[{rank:2,globalRiderId:'a',riderDisplay:'A',value:'30'},{rank:1,globalRiderId:'b',riderDisplay:'B',value:'40'}],{roundIds:['r1']});
    expect(calculation).toMatchObject({category:'ME',unit:'points',status:'ready',roundIds:['r1'],breakdown:[]});
    expect(calculation.rows.map(row=>[row.rank,row.globalRiderId,row.points])).toEqual([[1,'b','40'],[2,'a','30']]);
  });
});
