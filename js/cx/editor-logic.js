export const CX_CATEGORIES=['ME','WE','MU','WU','MJ','WJ'];
export const CX_CLASSES=['CM','CDM','CC','C1','C2','CN','NAC'];
export const CX_COUNTRY_GROUPS=['ALL','ES','EUROPA','PT','FR','BE','NL','IT','DE_AT_CH','UK_IE','SCANDI','EE','LATAM','NORTEAM','ASIAPAC','AFRICA','MENA'];
export const cxGender=category=>category.startsWith('M')?'men':'women';
export const cxSlug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// La URL ya empieza por /ciclocross/ (/en/cyclocross/): el slug no repite la disciplina.
export const cxSlugWithoutDiscipline=slug=>{
  const clean=`-${slug}-`.replace(/-(?:(?:de|del|of)-)?(?:ciclo-?cros(?:s|se)?|cyclo-?cross|cx)(?=-)/g,'').replace(/^-(?:de|del)(?=-)/,'').replace(/^-|-$/g,'');
  return /[a-z]/.test(clean)?clean:slug;
};
export const cxVenueCity=venue=>{
  const text=String(venue??'').replace(/ł/g,'l').replace(/Ł/g,'L').replace(/\([^)]*\)/g,'').trim();
  if(!text) return '';
  const head=text.split(',')[0].trim();
  const part=head.includes(' - ')?head.split(' - ').pop().trim():head;
  return cxSlug(part);
};
export function cxRaceSlugSuggestion({name,nameEn,tournamentName,venue,dateKey,lang='es'}) {
  const year=dateKey?String(dateKey).slice(0,4):'';
  const city=cxVenueCity(venue);
  const base=tournamentName
    ? [cxSlug(tournamentName),city].filter(Boolean).join('-')
    : cxSlug(String(lang==='en'?(nameEn||name):(name)||'').replace(/ł/g,'l').replace(/Ł/g,'L'));
  return [cxSlugWithoutDiscipline(base),year].filter(Boolean).join('-').slice(0,80);
}
export function cxUniqueRaceSlug(suggestion,{races=[],raceId,dateKey,lang='es'}={}) {
  const key=lang==='en'?'slugEn':'slug';
  const used=new Set(races.filter(r=>r.id!==raceId).map(r=>r[key]).filter(Boolean));
  if(!suggestion||!used.has(suggestion))return suggestion;
  const suffix=dateKey?`-${dateKey.slice(5)}`:'';
  const dated=suggestion.slice(0,80-suffix.length)+suffix;
  let candidate=dated,index=2;
  while(used.has(candidate)){
    const serial=`-${index++}`;
    candidate=dated.slice(0,80-serial.length)+serial;
  }
  return candidate;
}
export function cxSaveErrorMessage(error) {
  const message=error.message||String(error);
  if(message.includes('cx_races_slugEn_key'))return 'El slug en inglés ya está en uso por otra carrera. Modificar «Slug (EN)».';
  if(message.includes('cx_races_slug_key'))return 'El slug ya está en uso por otra carrera. Modificar «Slug».';
  return message;
}
export const cxEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cxUrl(value,{optional=true}={}) {
  if(!value && optional) return null;
  let url;try{url=new URL(value);}catch{throw new Error('Dirección web inválida. Usar una URL completa http o https.');}
  if(!['https:','http:'].includes(url.protocol)) throw new Error('Usar una dirección http o https.');
  return url.href;
}
// El mapa de Docs se publica como imagen: la ruta de su URL termina en JPG o PNG.
export function cxAssertMapImageUrl(url) {
  if(url&&!/\.(jpe?g|png)$/i.test(new URL(url).pathname))throw new Error('El mapa debe ser JPG o PNG.');
  return url;
}
export function cxYouTubeVideoId(value) {
  let url;
  try { url=new URL(value); } catch { return null; }
  if(url.protocol!=='https:')return null;
  const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
  let id=null;
  if(host==='youtu.be'&&parts.length===1)id=parts[0];
  else if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(host)) {
    if(parts.length===1&&parts[0]==='watch')id=url.searchParams.get('v');
    else if(parts.length===2&&['live','shorts','embed'].includes(parts[0]))id=parts[1];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null;
}
export function cxYouTubeWatchUrl(value) {
  const id=cxYouTubeVideoId(value);
  if(!id)throw new Error('El vídeo debe ser un enlace HTTPS de YouTube con ID válido.');
  return `https://www.youtube.com/watch?v=${id}`;
}
export function cxSeconds(value) {
  if(value===null || value===undefined || String(value).trim()==='') return null;
  const text=String(value).trim();
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Duración no representable sin pérdida.');
  if(/^\d+$/.test(text)) {const n=BigInt(text);if(n>9223372036854775807n)throw new Error('Duración fuera de rango.');return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n.toString();}
  const parts=text.split(':');
  if(!/^(?:\d+:)?\d{1,2}:\d{2}$/.test(text) || parts.slice(1).some(p=>Number(p)>59)) throw new Error(`Duración inválida: ${value}`);
  return cxSeconds(parts.reduce((n,p)=>n*60n+BigInt(p),0n).toString());
}
export function cxDuration(seconds) {
  if(seconds===null || seconds===undefined || String(seconds).trim()==='') return '—';
  try {const n=BigInt(cxSeconds(seconds));return `${n/3600n}:${String(n%3600n/60n).padStart(2,'0')}:${String(n%60n).padStart(2,'0')}`;}catch{return '—';}
}
export function cxPointValue(value) {
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))throw new Error('Puntos no representables sin pérdida.');
  const text=String(value).trim();
  if(!/^-?\d+(\.\d{1,12})?$/.test(text))throw new Error('Puntos inválidos.');
  const [whole,fraction='']=text.split('.'),digits=fraction.replace(/0+$/,'');
  const integer=BigInt(whole).toString(),negative=text.startsWith('-')&&(integer!=='0'||digits);
  return (negative?'-':'')+integer.replace(/^-/,'')+(digits?'.'+digits:'');
}
export function cxPoints(value,locale='es-ES') {
  if(value==null)return '—';
  try {const text=cxPointValue(value),[whole,fraction]=text.split('.');
    const formatter=new Intl.NumberFormat(locale),integer=formatter.format(BigInt(whole));
    const prefix=whole==='-0'?formatter.formatToParts(-1).find(p=>p.type==='minusSign').value:'';
    const separator=formatter.formatToParts(1.1).find(p=>p.type==='decimal').value;
    return prefix+integer+(fraction?separator+fraction:'');
  }catch{return '—';}
}
export function compareCxStandings(official,stored,mode) {
  if(!['points','time'].includes(mode))throw new Error('Categoría sin modalidad verificada.');
  if(!official.length)throw new Error('La general oficial no contiene filas.');
  const key=mode==='time'?'timeSeconds':'points',problems=[],seen=new Set(),ranks=new Set();
  const total=row=>row[key]==null||String(row[key]).trim()===''?null:mode==='time'?String(cxSeconds(row[key])):cxPointValue(row[key]);
  for(const row of official){
    const name=cxSlug(row.riderDisplay);
    if(seen.has(name)||ranks.has(row.rank))throw new Error('Corredor o puesto repetido en la general oficial.');
    seen.add(name);ranks.add(row.rank);
    if(!Number.isSafeInteger(row.rank)||row.rank<1||total(row)===null)throw new Error(`${row.riderDisplay}: puesto o total oficial desconocido.`);
    const matches=stored.filter(r=>cxSlug(r.riderDisplay)===name);
    if(matches.length!==1){problems.push(`${row.riderDisplay}: ${matches.length?'identidad ambigua':'sin fila calculada'}`);continue;}
    const computed=matches[0];
    if(total(computed)===null||total(computed)!==total(row)||computed.rank!==row.rank)problems.push(`${row.riderDisplay}: oficial ${row.rank} / ${row[key]}; calculado ${computed.rank} / ${computed[key]??'desconocido'}`);
  }
  for(const row of stored)if(!seen.has(cxSlug(row.riderDisplay)))problems.push(`${row.riderDisplay}: falta en la tabla oficial pegada`);
  return problems;
}
// Ajuste manual de una general publicada: `value` es el total editado (tiempo
// h:mm:ss o puntos). `sortByTotal` reordena por total (tiempo ascendente,
// puntos descendentes) y conserva el puesto anterior en los empates.
export function cxManualStandingsRows(rows,mode,{sortByTotal=false}={}) {
  if(!['points','time'].includes(mode))throw new Error('Categoría sin modalidad verificada.');
  const parsed=rows.map(row=>{
    if(String(row.value??'').trim()==='')throw new Error(`${row.riderDisplay}: total vacío.`);
    return {...row,rank:Number(row.rank),total:mode==='time'?BigInt(cxSeconds(row.value)):cxPointValue(row.value)};
  });
  const byTotal=(a,b)=>mode==='time'?(a.total<b.total?-1:a.total>b.total?1:0):Number(b.total)-Number(a.total);
  const ordered=[...parsed].sort((a,b)=>(sortByTotal?byTotal(a,b):0)||a.rank-b.rank);
  if(sortByTotal)ordered.forEach((row,index)=>{row.rank=index+1;});
  if(ordered.some((row,index)=>row.rank!==index+1))throw new Error('Los puestos deben ir de 1 al número de filas, sin repetir.');
  return ordered.map(({total,value:_value,...row})=>({...row,points:mode==='points'?total:null,timeSeconds:mode==='time'?total.toString():null}));
}
// Cálculo que publica `cx_publish_standings` con origen manual. Sin desglose:
// el de la general automática no cuadra con totales editados.
export function cxManualStandingsCalculation(category,mode,rows,state) {
  const ordered=cxManualStandingsRows(rows,mode);
  return {category,unit:mode,status:ordered.length?'ready':'empty',issues:[],roundIds:state?.roundIds||[],breakdown:[],
    rows:ordered.map(row=>({rank:row.rank,globalRiderId:row.globalRiderId,riderDisplay:row.riderDisplay,teamName:row.teamName||null,isoCode2:row.isoCode2||null,points:row.points,timeSeconds:row.timeSeconds}))};
}
export function cxChipText(hex) {
  const channels=hex.slice(1).match(/../g).map(x=>{const n=parseInt(x,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
  const luminance=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  return (luminance+.05)/.05 >= 1.05/(luminance+.05)?'#000000':'#ffffff';
}
export function cxLocalParts(timestamp,timeZone) {
  if(!timestamp || !timeZone) return null;
  const p=new Intl.DateTimeFormat('en-GB',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(timestamp));
  const v=type=>p.find(x=>x.type===type)?.value;
  return {dateKey:`${v('year')}-${v('month')}-${v('day')}`,time:`${v('hour')}:${v('minute')}`,seconds:v('second')};
}
export function cxLocalToUtc(dateKey,time,timeZone) {
  if(!time) return null;
  if(!timeZone) throw new Error('Verificar la zona IANA del lugar antes de guardar horas.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Fecha u hora inválida.');
  const wanted=Date.parse(`${dateKey}T${time}:00Z`);
  if(!Number.isFinite(wanted)) throw new Error('Fecha u hora inválida.');
  const candidates=new Set();
  for(let h=-36;h<=36;h+=6) {
    const instant=wanted+h*3600000,parts=cxLocalParts(instant,timeZone);
    const projected=Date.parse(`${parts.dateKey}T${parts.time}:${parts.seconds}Z`);
    const candidate=wanted-(projected-instant),check=cxLocalParts(candidate,timeZone);
    if(check.dateKey===dateKey && check.time===time) candidates.add(candidate);
  }
  if(candidates.size===0) throw new Error('La hora civil no existe en esa zona y fecha.');
  if(candidates.size>1) throw new Error('La hora civil se repite por el cambio horario; verificar el instante UTC oficial.');
  return new Date([...candidates][0]).toISOString();
}

const aliases={puesto:'rank',pos:'rank',position:'rank',dorsal:'bib',nombre:'firstName',apellido:'lastName',apellidos:'lastName',corredor:'riderDisplay',pais:'countryCode',nacionalidad:'countryCode',equipo:'teamName',fichacx:'globalRiderId',equipocx:'teamId',tiempo:'timeText',diferencia:'gapText',segundos:'timeSeconds',bonosegundos:'bonusSeconds',bonopuntos:'bonusPoints',puntos:'points',estado:'irm'};
const fields=['rank','rankText','bib','firstName','lastName','riderDisplay','countryCode','isoCode2','teamName','teamId','globalRiderId','timeText','gapText','timeSeconds','bonusSeconds','bonusPoints','points','irm'];
const headerKey=v=>{const k=cxSlug(v).replace(/-/g,'');return fields.find(f=>f.toLowerCase()===k)||aliases[k];};
export function parseCxRows(text,kind='results') {
  const value=text.replace(/^\uFEFF/,'');
  const trimmed=value.trim();
  let rows;
  if(trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const doc=JSON.parse(trimmed);rows=Array.isArray(doc)?doc:doc.rows;
  } else {
    const lines=value.split(/\r?\n/).filter(l=>l.trim());
    const columns=(lines.shift()||'').split('\t').map(headerKey);
    if(columns.some(k=>!k) || new Set(columns).size!==columns.length) throw new Error('Cabecera no reconocida o duplicada. Usar columnas separadas por tabuladores.');
    rows=lines.map((line,i)=>{
      const cells=line.split('\t');
      if(cells.length!==columns.length) throw new Error(`Fila ${i+2}: número de columnas distinto de la cabecera.`);
      return Object.fromEntries(columns.map((key,j)=>[key,cells[j].trim()||null]));
    });
  }
  if(!Array.isArray(rows) || rows.length===0) throw new Error('La fuente no contiene filas.');
  return rows.map((source,i)=>{
    const row={...source,sortOrder:i};
    for(const key of ['firstName','lastName','riderDisplay','bib','teamName','teamId','globalRiderId','timeText','gapText','irm']) if(row[key]!==undefined) row[key]=String(row[key]??'').trim()||null;
    if(kind==='startlist' && (!row.firstName || !row.lastName)) throw new Error(`Fila ${i+1}: faltan nombre y apellido.`);
    if(kind==='results') {
      row.riderDisplay ||= [row.lastName,row.firstName].filter(Boolean).join(' ');
      if(!row.riderDisplay) throw new Error(`Fila ${i+1}: falta corredor.`);
      for(const key of ['timeSeconds','bonusSeconds']) row[key]=cxSeconds(row[key]);
      for(const key of ['rank','points','bonusPoints']) {
        if(row[key]===undefined || row[key]===null || row[key]==='') row[key]=key==='bonusPoints'?0:null;
        else if(key==='rank'){row[key]=Number(row[key]);if(!Number.isSafeInteger(row[key])||row[key]<1)throw new Error(`Fila ${i+1}: puesto inválido.`);}
        else {const exact=cxPointValue(row[key]),n=Number(exact);row[key]=Number.isSafeInteger(n)&&String(n)===exact?n:exact;}
      }
    }
    const country=String(row.countryCode||row.isoCode2||'').toUpperCase();
    if(country && !/^[A-Z]{2}$/.test(country)) throw new Error(`Fila ${i+1}: usar país ISO2.`);
    row[kind==='results'?'isoCode2':'countryCode']=country||null;
    return row;
  });
}

export function validateCxScheme(scheme) {
  if(!scheme || typeof scheme!=='object' || Array.isArray(scheme) || !scheme.categories || typeof scheme.categories!=='object' || Array.isArray(scheme.categories)) throw new Error('El reglamento debe definir categorías.');
  for(const [category,rule] of Object.entries(scheme.categories)) {
    if(!CX_CATEGORIES.includes(category) || !rule || !['points','time'].includes(rule.mode)) throw new Error(`Modalidad/categoría inválida: ${category}`);
    if(rule.mode==='points') {if(!Array.isArray(rule.perRank)||!rule.perRank.length)throw new Error(`Faltan puntos por puesto: ${category}`);for(const value of rule.perRank)if(cxPointValue(value).startsWith('-'))throw new Error(`Escala de puntos negativa: ${category}`);}
    if(rule.mode==='time' && rule.perRank!==undefined) throw new Error(`Una general por tiempo no admite puntos por puesto: ${category}`);
  }
  return scheme;
}
