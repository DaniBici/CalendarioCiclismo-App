// Calendario oficial UCI de ciclocross desde el directorio de competiciones
// UCI (uci-competition.tech.uci.ch). No consulta DataRide ni escribe en BD.
// `source`, `version` y `calendarSourceUrl` siguen el contrato de
// `cx_import_calendar`: el ID y la ficha de referencia son los de uci.org.
import {
  UCI_COMPETITION_DIRECTORY_URL, getUciCompetition, listUciCompetitions, mapLimited,
  organizerWebsite, uciCalendarIdOf, uciDates,
} from './uci-competition-api.mjs';

export const UCI_CX_CALENDAR_URL = UCI_COMPETITION_DIRECTORY_URL;
export const CX_CATEGORIES = ['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'];
export const CX_CLASSES = ['CM', 'CDM', 'CC', 'C1', 'C2', 'CN', 'NAC'];
const UCI_CX_CLASSES = new Set(['CDM', 'CMM', 'CM', 'CC', 'C1', 'C2', 'CN']);
// La URL ya empieza por /ciclocross/: el slug no repite la disciplina (misma regla que js/cx/editor-logic.js).
const slugWithoutDiscipline = slug => {
  const clean = `-${slug}-`.replace(/-(?:(?:de|del|of)-)?(?:ciclo-?cros(?:s|se)?|cyclo-?cross|cx)(?=-)/g,'').replace(/^-(?:de|del)(?=-)/,'').replace(/^-|-$/g,'');
  return /[a-z]/.test(clean) ? clean : slug;
};

export function cxSeason(seasonKey) {
  if (!/^\d{4}-\d{2}$/.test(seasonKey)) throw new Error('Temporada inválida; usar YYYY-YY.');
  const startYear = Number(seasonKey.slice(0,4));
  if (startYear < 1900 || startYear > 9998 || Number(seasonKey.slice(5)) !== (startYear+1)%100) throw new Error('Años de temporada incoherentes.');
  return { seasonKey, startYear, endYear:startYear+1 };
}

// Competición del directorio y su ficha (`detail.races`: una carrera por
// categoría y tipo) normalizadas para `cx_import_calendar`.
export function normalizeUciCompetition(item, detail, seasonKey, countryCode) {
  const season = cxSeason(seasonKey);
  const uciCalendarId = uciCalendarIdOf(item);
  if (!uciCalendarId) throw new Error(`Competición UCI sin ID de calendario (v1Code): ${item?.name}`);
  const name = String(item.name || '').trim();
  if (!name) throw new Error(`Competición UCI sin nombre: ${uciCalendarId}`);
  if (!Array.isArray(detail?.races)) throw new Error(`Ficha UCI sin carreras: ${name}`);
  // Las fechas de la competición pueden incluir días sin carreras (víspera de
  // un nacional): el rango sale de los días con carrera, excluidas o no.
  const dates = new Set(), categories = new Map(), excluded = [], classCodes = new Set();
  if (UCI_CX_CLASSES.has(item.classCode)) classCodes.add(item.classCode);
  for (const race of detail.races) {
    const { startDate:dateKey } = uciDates(race, `${name} · ${race.name}`);
    dates.add(dateKey);
    const category = race.categoryCode;
    if (!CX_CATEGORIES.includes(category) || race.raceTypeCode !== 'IND') {
      excluded.push({category:category || null,raceType:race.raceTypeName || race.raceTypeCode || null,dateKey,reason:'outside_six_individual_categories'});
      continue;
    }
    if (UCI_CX_CLASSES.has(race.classCode)) classCodes.add(race.classCode);
    const previous = categories.get(category);
    if (previous && previous.dateKey !== dateKey) throw new Error(`Categoría ${category} repetida en fechas distintas: ${name}`);
    categories.set(category,{category,dateKey,startTimeUtc:null,sortOrder:CX_CATEGORIES.indexOf(category)});
  }
  if (!categories.size) return {excludedCompetition:{uciCalendarId,name,classCodes:[...classCodes],reason:'no_supported_individual_category',excluded}};
  const raceClass = CX_CLASSES.find(code=>classCodes.has(code));
  if (!raceClass) throw new Error(`Clase UCI no soportada: ${item.classCode || 'sin clase'}`);
  const orderedDates = [...dates].sort();
  const start = orderedDates[0], end = orderedDates.at(-1);
  const lastDate = new Date(Date.UTC(season.endYear,2,0)).toISOString().slice(0,10);
  if (start < `${season.startYear}-08-01` || end > lastDate) throw new Error(`Fechas CX fuera de agosto–febrero: ${name}`);
  const slugBase = slugWithoutDiscipline(name.normalize('NFD').replace(/ł/g,'l').replace(/Ł/g,'L').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')) || 'carrera';
  return { race:{
    name,slug:`${slugBase}-${start.slice(0,4)}`,
    seasonKey,seasonStartYear:season.startYear,dateKey:start,endDateKey:end===start?null:end,
    class:raceClass,countryCode:countryCode(item.countryCode)?.toUpperCase() || null,venue:String(item.venue || '').trim() || null,
    websiteUrl:organizerWebsite(item.website),timezone:null,uciCalendarId,
    calendarSourceUrl:`https://www.uci.org/competition-details/${season.endYear}/CRO/${uciCalendarId}`,
  },uciCompetitionId:item.id,categories:[...categories.values()].sort((a,b)=>a.sortOrder-b.sortOrder),classCodes:[...classCodes],excluded };
}

export async function collectUciCxCalendar({seasonKey='2026-27',fetcher=fetch,countryCode,concurrency=4,onProgress=()=>{}}) {
  const season = cxSeason(seasonKey);
  if (typeof countryCode !== 'function') throw new Error('Falta conversor ISO3 a ISO2.');
  // La temporada UCI de ciclocross lleva el año en que termina (2026-27 → 2027).
  const {items,url} = await listUciCompetitions({fetcher,query:{disciplineCode:'CRO',seasonYear:String(season.endYear)}});
  if (!items.length) throw new Error('Calendario UCI vacío: no se genera una importación vacía.');
  const errors=[], byCalendarId=new Map();
  for (const item of items) {
    const id=uciCalendarIdOf(item);
    if (!id) errors.push({uciCompetitionId:item.id,name:item.name,error:'Sin ID de calendario (v1Code)'});
    else if (byCalendarId.has(id)) errors.push({uciCalendarId:id,name:item.name,error:'ID de calendario repetido'});
    else byCalendarId.set(id,item);
  }
  const entries=[...byCalendarId].sort(([a],[b])=>a-b).map(([,item])=>item);
  const {results,errors:failed}=await mapLimited(entries,async item=>
    normalizeUciCompetition(item,await getUciCompetition({fetcher,id:item.id}),seasonKey,countryCode),{concurrency,onProgress});
  errors.push(...failed.map(({item,error})=>({uciCalendarId:uciCalendarIdOf(item),name:item.name,error})));
  if (errors.length) throw new Error(`Importación incompleta; ${errors.length} fichas requieren revisión: ${JSON.stringify(errors)}`);
  const races=results.filter(result=>result.race), exclusions=results.filter(result=>!result.race).map(result=>result.excludedCompetition);
  races.sort((a,b)=>a.race.dateKey.localeCompare(b.race.dateKey)||a.race.uciCalendarId-b.race.uciCalendarId);
  const slugCount=new Map();
  for (const item of races) {
    const n=(slugCount.get(item.race.slug)||0)+1;
    slugCount.set(item.race.slug,n);
    if (n>1) item.race.slug=`${item.race.slug}-${n}`;
  }
  return {version:1,source:'uci_web_calendar',sourceUrl:UCI_CX_CALENDAR_URL,seasonKey,checkedAt:new Date().toISOString(),
    sourceUrls:[url],summary:{listedCompetitions:entries.length,races:races.length,excludedCompetitions:exclusions.length,categories:races.reduce((n,r)=>n+r.categories.length,0)},races,exclusions};
}
