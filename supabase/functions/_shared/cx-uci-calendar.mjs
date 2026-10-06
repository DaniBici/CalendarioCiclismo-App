// Calendario oficial de la web UCI. No consulta DataRide ni escribe en BD.
export const UCI_CX_CALENDAR_URL = 'https://www.uci.org/discipline/cyclo-cross/27qDl3RfvZBNwx1GhqJTwj?tab=calendar';
export const CX_CATEGORIES = ['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'];
export const CX_CLASSES = ['CM', 'CDM', 'CC', 'C1', 'C2', 'CN', 'NAC'];
const categoryNames = { 'Men Elite':'ME', 'Women Elite':'WE', 'Men Under 23':'MU', 'Women Under 23':'WU', 'Men Junior':'MJ', 'Women Junior':'WJ' };
// La URL ya empieza por /ciclocross/: el slug no repite la disciplina (misma regla que js/cx/editor-logic.js).
const slugWithoutDiscipline = slug => {
  const clean = `-${slug}-`.replace(/-(?:(?:de|del|of)-)?(?:ciclo-?cros(?:s|se)?|cyclo-?cross|cx)(?=-)/g,'').replace(/^-(?:de|del)(?=-)/,'').replace(/^-|-$/g,'');
  return /[a-z]/.test(clean) ? clean : slug;
};
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function cxSeason(seasonKey) {
  if (!/^\d{4}-\d{2}$/.test(seasonKey)) throw new Error('Temporada inválida; usar YYYY-YY.');
  const startYear = Number(seasonKey.slice(0,4));
  if (startYear < 1900 || startYear > 9998 || Number(seasonKey.slice(5)) !== (startYear+1)%100) throw new Error('Años de temporada incoherentes.');
  return { seasonKey, startYear, endYear:startYear+1 };
}

export function uciCivilDate(text) {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(String(text).trim());
  if (!m || !months.includes(m[2])) throw new Error(`Fecha UCI no reconocida: ${text}`);
  const year = Number(m[3]), month = months.indexOf(m[2])+1, day = Number(m[1]);
  const date = new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()+1!==month || date.getUTCDate()!==day) throw new Error(`Fecha UCI inválida: ${text}`);
  return date.toISOString().slice(0,10);
}

function decodeAttribute(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1)));
    return {quot:'"',apos:"'",amp:'&',lt:'<',gt:'>'}[entity.toLowerCase()];
  });
}

export function uciCompetitionProps(html) {
  for (const match of html.matchAll(/data-props="([^"]+)"/g)) {
    let props;
    try { props = JSON.parse(decodeAttribute(match[1])); } catch { continue; }
    if (props.competitionDetails && props.schedule) return props;
  }
  throw new Error('La ficha UCI no contiene competición y programa reconocibles.');
}

export function flattenUciCalendar(response, endYear) {
  if (!Array.isArray(response?.items)) throw new Error('Respuesta del calendario UCI inválida.');
  const entries = [];
  for (const month of response.items) {
    if (!Array.isArray(month.items)) throw new Error('Mes del calendario sin días.');
    for (const day of month.items) {
      if (!Array.isArray(day.items)) throw new Error('Día del calendario sin pruebas.');
      for (const item of day.items) {
        const path = item.detailsLink?.url;
        const m = /^\/competition-details\/(\d{4})\/CRO\/(\d+)$/.exec(path || '');
        if (!m || Number(m[1]) !== endYear || !item.name) throw new Error(`Prueba UCI inesperada: ${path || item.name}`);
        entries.push({ ...item, uciCalendarId:Number(m[2]), calendarSourceUrl:`https://www.uci.org${path}` });
      }
    }
  }
  return entries;
}

export function normalizeUciCompetition(entry, props, seasonKey, countryCode) {
  const season = cxSeason(seasonKey);
  const details = props.competitionDetails;
  if (!details?.name || !Array.isArray(props.schedule?.items)) throw new Error('Ficha UCI sin nombre o programa.');
  const dates = new Set(), categories = new Map(), excluded = [];
  const classCodes = new Set();
  for (const match of String(details.competitionClass || '').matchAll(/\b(CDM|CMM|CM|CC|C1|C2|CN)\b/g)) classCodes.add(match[1]);
  for (const day of props.schedule.items) {
    const dateKey = uciCivilDate(day.date);
    dates.add(dateKey);
    if (!Array.isArray(day.races)) throw new Error('Programa UCI sin carreras.');
    for (const race of day.races) {
      const category = categoryNames[race.category];
      if (!category || race.raceType !== 'Individual') {
        excluded.push({category:race.category,raceType:race.raceType,dateKey,reason:'outside_six_individual_categories'});
        continue;
      }
      for (const match of String(race.raceClass || '').matchAll(/\b(CDM|CMM|CM|CC|C1|C2|CN)\b/g)) classCodes.add(match[1]);
      const previous = categories.get(category);
      if (previous && previous.dateKey !== dateKey) throw new Error(`Categoría ${category} repetida en fechas distintas: ${details.name}`);
      categories.set(category,{category,dateKey,startTimeUtc:null,sortOrder:CX_CATEGORIES.indexOf(category)});
    }
  }
  if (!categories.size) return {excludedCompetition:{uciCalendarId:entry.uciCalendarId,name:details.name,classCodes:[...classCodes],reason:'no_supported_individual_category',excluded}};
  const raceClass = CX_CLASSES.find(code=>classCodes.has(code));
  if (!raceClass) throw new Error(`Clase UCI no soportada: ${details.competitionClass}`);
  const orderedDates = [...dates].sort();
  const start = orderedDates[0], end = orderedDates.at(-1);
  const lastDate = new Date(Date.UTC(season.endYear,2,0)).toISOString().slice(0,10);
  if (!start || start < `${season.startYear}-08-01` || end > lastDate) throw new Error(`Fechas CX fuera de agosto–febrero: ${details.name}`);
  const slugBase = slugWithoutDiscipline(details.name.normalize('NFD').replace(/ł/g,'l').replace(/Ł/g,'L').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')) || 'carrera';
  const website = details.website?.url;
  if (website && !/^https?:\/\//i.test(website)) throw new Error('Web del organizador con protocolo no admitido.');
  return { race:{
    name:details.name,slug:`${slugBase}-${start.slice(0,4)}`,
    seasonKey,seasonStartYear:season.startYear,dateKey:start,endDateKey:end===start?null:end,
    class:raceClass,countryCode:countryCode(entry.country)?.toUpperCase() || null,venue:details.venue || entry.venue || null,
    websiteUrl:website || null,timezone:null,uciCalendarId:entry.uciCalendarId,calendarSourceUrl:entry.calendarSourceUrl,
  },categories:[...categories.values()].sort((a,b)=>a.sortOrder-b.sortOrder),classCodes:[...classCodes],excluded };
}

export async function collectUciCxCalendar({seasonKey='2026-27',fetcher=fetch,countryCode,concurrency=4,onProgress=()=>{}}) {
  const season = cxSeason(seasonKey);
  if (typeof countryCode !== 'function') throw new Error('Falta conversor ISO3 a ISO2.');
  const headers = {'User-Agent':'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)'};
  const endpoints = ['upcoming','past'].map(kind=>`https://www.uci.org/api/calendar/${kind}?discipline=CRO&year=${season.endYear}`);
  const catalogs = await Promise.all(endpoints.map(async url=>{
    const response = await fetcher(url,{headers,signal:AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error(`Calendario UCI: HTTP ${response.status}`);
    return flattenUciCalendar(await response.json(),season.endYear);
  }));
  const unique = new Map();
  for (const entry of catalogs.flat()) {
    const previous = unique.get(entry.uciCalendarId);
    if (previous && previous.name !== entry.name) throw new Error(`Nombres incompatibles en calendario UCI: ${entry.uciCalendarId}`);
    unique.set(entry.uciCalendarId,entry);
  }
  if (!unique.size) throw new Error('Calendario UCI vacío: no se genera una importación vacía.');
  const entries = [...unique.values()].sort((a,b)=>a.uciCalendarId-b.uciCalendarId);
  const races=[], exclusions=[], errors=[];
  let next=0, completed=0;
  await Promise.all(Array.from({length:Math.max(1,Math.min(4,concurrency,entries.length))},async()=>{
    while (next < entries.length) {
      const entry=entries[next++];
      try {
        const response=await fetcher(entry.calendarSourceUrl,{headers,signal:AbortSignal.timeout(45000)});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const normalized=normalizeUciCompetition(entry,uciCompetitionProps(await response.text()),seasonKey,countryCode);
        if (normalized.race) races.push(normalized); else exclusions.push(normalized.excludedCompetition);
      } catch(error) {errors.push({uciCalendarId:entry.uciCalendarId,name:entry.name,error:error.message});}
      onProgress({completed:++completed,total:entries.length});
    }
  }));
  if (errors.length) throw new Error(`Importación incompleta; ${errors.length} fichas requieren revisión: ${JSON.stringify(errors)}`);
  races.sort((a,b)=>a.race.dateKey.localeCompare(b.race.dateKey)||a.race.uciCalendarId-b.race.uciCalendarId);
  const slugCount=new Map();
  for (const item of races) {
    const n=(slugCount.get(item.race.slug)||0)+1;
    slugCount.set(item.race.slug,n);
    if (n>1) item.race.slug=`${item.race.slug}-${n}`;
  }
  return {version:1,source:'uci_web_calendar',sourceUrl:UCI_CX_CALENDAR_URL,seasonKey,checkedAt:new Date().toISOString(),
    sourceUrls:endpoints,summary:{listedCompetitions:entries.length,races:races.length,excludedCompetitions:exclusions.length,categories:races.reduce((n,r)=>n+r.categories.length,0)},races,exclusions};
}
