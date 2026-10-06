import { normalizeRow } from './dataride-results-fetch.mjs';
import { cxDataRideSeconds } from '../../js/cx/time.js';

export { cxDataRideSeconds };

export const CX_RESULT_SCHEMA_VERSION = 1;
const BASE = 'https://dataride.uci.ch/iframe/';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Map([
  ['men elite', 'ME'], ['women elite', 'WE'], ['men under 23', 'MU'],
  ['women under 23', 'WU'], ['men junior', 'MJ'], ['women junior', 'WJ'],
]);
const STATES = new Set(['DNS', 'DNF', 'DSQ', 'LAP', 'OTL', 'ABD']);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PARTICLES = new Set(['van', 'de', 'der', 'den', 'di', 'da', 'del', 'della', 'von', 'zu', 'ter', 'ten', 'dos', 'das', 'du', 'la', 'le', 'el']);
function personCase(name) {
  const cap = name.toLocaleLowerCase().replace(/(^|[-'’\s])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase());
  return cap.split(' ').map((word, index) => PARTICLES.has(word.toLowerCase()) && index > 0 ? word.toLowerCase() : word).join(' ');
}

// Un campo con mayúsculas y minúsculas mixtas ya trae grafía editorial
// («de Diego», ficha CX normalizada) y se conserva; solo un campo en mayúsculas
// sostenidas o en minúsculas se normaliza.
const mixedCase = text => /\p{Lu}/u.test(text) && /\p{Ll}/u.test(text);
const displayCase = text => mixedCase(text) ? text : personCase(text);

// La presentación CX sigue la convención común del sitio: nombre y después
// apellido. Los campos separados son la fuente preferente; el display original
// de DataRide solo se conserva como fallback cuando no se puede partir.
export function cxNaturalRiderDisplay(firstName, lastName, fallback = null) {
  const first = clean(firstName);
  const last = clean(lastName);
  return first && last ? `${displayCase(first)} ${displayCase(last)}` : clean(fallback) || null;
}

// DataRide CX publica el DisplayName como «APELLIDO... Nombre...»: los tokens
// iniciales enteramente en mayúsculas forman el apellido y el resto, el nombre.
// Un display sin bloque mayúsculo inicial o sin resto no se parte: se deja NULL;
// en ese caso se conserva el texto original como fallback de presentación.
export function splitCxDisplayName(display) {
  const text = clean(display);
  if (!text) return { firstName: null, lastName: null };
  const tokens = text.split(' ');
  let end = 0;
  while (end < tokens.length && /^\p{Lu}[\p{Lu}'’.-]*$/u.test(tokens[end])) end++;
  if (!end || end === tokens.length) return { firstName: null, lastName: null };
  return { lastName: personCase(tokens.slice(0, end).join(' ').toLowerCase()), firstName: personCase(tokens.slice(end).join(' ').toLowerCase()) };
}

export function classifyCxRace(race) {
  if (race.DisciplineCode !== 'CRO' || race.RaceTypeCode !== 'CRO-IND') {
    return { category: null, reason: race.RaceTypeCode === 'CRO-TR' ? 'Relevo fuera de v1' : 'Disciplina o formato fuera de v1' };
  }
  const category = CATEGORIES.get(clean(race.CategoryCode).toLowerCase());
  const nameCategory = CATEGORIES.get(clean(race.RaceName).toLowerCase());
  if (!category || nameCategory && category !== nameCategory) return { category: null, reason: 'Categoría de origen no reconocida o contradictoria' };
  return { category, reason: null };
}

export function cxDataRideDate(value) {
  const text = clean(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(text);
  const month = match ? months.findIndex(item => item.toLowerCase() === match[2].toLowerCase()) + 1 : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
  return date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}

export function normalizeCxDataRideRows(sourceRows) {
  // Un ganador con hora 0–2 acredita H:MM:SS para toda la clasificación,
  // incluidos los corredores que terminan después de la primera hora: leído
  // como MM:SS:ff daría una meta de cero a dos minutos, imposible en CX.
  const sourceWinner = sourceRows.find(row => !clean(row.Irm)
    && Number(row.RankNumber || row.Rank) === 1);
  const format = /^0?[0-2]:[0-5]\d:[0-5]\d$/.test(clean(sourceWinner?.ResultValue)) ? 'hms' : 'auto';
  const rows = sourceRows.filter(row => !/^race\s+cancelled$/i.test(clean(row.DisplayName || row.IndividualDisplayName))).map((raw, index) => {
    const normalized = normalizeRow(raw);
    const value = clean(raw.ResultValue) || null;
    const rankNumber = positiveId(raw.RankNumber) ? Number(raw.RankNumber) : null;
    const rankFromText = /^\d+$/.test(clean(raw.Rank)) && positiveId(raw.Rank) ? Number(raw.Rank) : null;
    const rank = rankNumber || rankFromText;
    const stateText = clean(raw.Irm || (STATES.has((value || '').toUpperCase()) ? value : '')).toUpperCase();
    const state = stateText || (/^(?:-?\s*\d+|@\s*\d+)\s+LAPS?$/i.test(value || '') ? 'LAP' : null);
    const explicitGap = value?.startsWith('+');
    const split = normalized.firstName && normalized.lastName
      ? { firstName: normalized.firstName, lastName: normalized.lastName }
      : splitCxDisplayName(normalized.riderDisplay || clean(raw.DisplayName) || clean(raw.IndividualDisplayName));
    // Irm=LAP marca vueltas perdidas: los textos con la palabra LAP se conservan
    // verbatim ("-1 LAP", "-2 LAPS", "@ 3 LAPS") y un entero con o sin signo,
    // incluidas las variantes con espacio o comillas, es el déficit "-n LAP".
    // Cero, fracciones y valores sin Irm=LAP no acreditan vueltas perdidas.
    const lapValue = state === 'LAP' ? clean(value).replace(/^['"]+|['"]+$/g, '').replace(/^@\s*/, '').trim() : '';
    const lapDeficit = /^-\s*([1-9]\d*)$/.exec(lapValue) || /^[1-9]\d*$/.test(lapValue) ? Number(lapValue.replace(/^-/, '')) : null;
    const lapGap = state === 'LAP' && /LAP/i.test(value || '') ? value
      : state === 'LAP' && lapDeficit != null ? `-${lapDeficit} LAP` : null;
    // Solo LAP conserva puesto. DataRide publica a veces DNF/DNS con la posición
    // de listado en Rank (Blue Ridge 2026): el estado sustituye al puesto y
    // sourceSortOrder conserva el orden de la fuente.
    const ranked = !state || state === 'LAP';
    return {
      rank: ranked ? rank : null, rankText: ranked ? clean(raw.Rank) || state || null : state, bib: normalized.bib,
      riderDisplay: cxNaturalRiderDisplay(split.firstName, split.lastName, normalized.riderDisplay)
        || [split.firstName, split.lastName].filter(Boolean).join(' ') || null,
      firstName: split.firstName, lastName: split.lastName, isoCode2: normalized.isoCode2?.toUpperCase() || null,
      birthDate: normalized.birthDate, teamName: normalized.teamName,
      timeText: explicitGap || lapGap ? null : value,
      gapText: explicitGap ? value : lapGap,
      timeSeconds: !state && !explicitGap ? cxDataRideSeconds(value, { format }) : null,
      bonusSeconds: null, bonusPoints: 0, points: null, irm: state, sortOrder: index,
      sourceResultId: raw.ResultId == null ? null : String(raw.ResultId),
      sourceSortOrder: raw.SortOrder ?? index,
      sourceConflict: rankNumber && rankFromText && rankNumber !== rankFromText ? 'RankNumber y Rank discrepan' : null,
    };
  });
  const winner = rows.find(row => row.rank === 1 && !row.irm);
  if (winner?.timeSeconds != null) {
    for (const row of rows) {
      if (row.irm) continue;
      if (row.gapText?.startsWith('+')) {
        const gap = cxDataRideSeconds(row.gapText, { gap: true });
        if (gap != null && BigInt(winner.timeSeconds) + BigInt(gap) <= 9223372036854775807n) row.timeSeconds = (BigInt(winner.timeSeconds) + BigInt(gap)).toString();
      } else if (row.timeSeconds != null && row.rank !== 1) {
        if (BigInt(row.timeSeconds) < BigInt(winner.timeSeconds)) row.sourceConflict = 'Absoluto inferior al ganador; formato requiere revisión';
        else row.gapText = `+${BigInt(row.timeSeconds) - BigInt(winner.timeSeconds)}`;
      }
    }
  }
  return rows;
}

export function createCxDataRideClient({ fetchImpl = fetch, delayMs = 120, pageSize = 200, timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(delayMs) || delayMs < 0) throw new Error('Paginación o cadencia inválidas');
  let cookie = ''; let seeded = false;
  const headers = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
  async function seed() {
    const response = await fetchImpl('https://dataride.uci.ch/', { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Sesión DataRide: HTTP ${response.status}`);
    const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
    cookie = cookies.map(value => value.split(';')[0]).join('; '); seeded = true;
  }
  async function post(path, form) {
    if (!seeded) await seed();
    if (delayMs) await sleep(delayMs);
    const response = await fetchImpl(BASE + path, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', ...(path === 'Events/' && cookie ? { Cookie: cookie } : {}) },
      body: new URLSearchParams({ ...form, disciplineId: '3' }), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    let result; try { result = JSON.parse(await response.text()); } catch { throw new Error(`${path}: respuesta no JSON`); }
    return result;
  }
  async function pages(path, form, idField) {
    const data = []; const ids = new Set(); let total = null;
    do {
      const result = await post(path, { ...form, take: String(pageSize), skip: String(data.length), page: String(Math.floor(data.length / pageSize) + 1), pageSize: String(pageSize) });
      if (!result || !Array.isArray(result.data) || !Number.isSafeInteger(result.total) || result.total < 0 || result.data.length > pageSize
        || total != null && total !== result.total) throw new Error(`${path}: forma o total paginado cambió`);
      total = result.total;
      if (data.length < total && !result.data.length) throw new Error(`${path}: página vacía antes del total`);
      for (const row of result.data) {
        if (row[idField] != null) {
          if (typeof row[idField] === 'number' && !Number.isSafeInteger(row[idField])) throw new Error(`${path}: ID numérico fuera del rango seguro`);
          const id = String(row[idField]); if (ids.has(id)) throw new Error(`${path}: ID repetido entre páginas`); ids.add(id);
        }
        data.push(row);
      }
      if (data.length > total) throw new Error(`${path}: filas superiores al total`);
    } while (data.length < total);
    return data;
  }
  let seasonList=null;const catalogs=new Map();
  return { pages, seasons: async()=>{
    if(seasonList)return seasonList;
    const response=await fetchImpl(BASE+'GetDisciplineSeasons/?disciplineId=3',{headers,signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw new Error(`Temporadas CX: HTTP ${response.status}`);
    let result;try{result=JSON.parse(await response.text());}catch{throw new Error('Temporadas CX: respuesta no JSON');}
    if(!Array.isArray(result)||result.some(row=>!positiveId(row.Id)||!Number.isSafeInteger(row.Year)))throw new Error('Catálogo de temporadas CX inválido');
    seasonList=result;return result;
  }, competitionsForSeason: async seasonId=>{
    if(catalogs.has(seasonId))return catalogs.get(seasonId);
    const result=await pages('Competitions/',{'sort[0][field]':'StartDate','sort[0][dir]':'desc',
      'filter[filters][0][field]':'RaceTypeId','filter[filters][0][value]':'0',
      'filter[filters][1][field]':'CategoryId','filter[filters][1][value]':'0',
      'filter[filters][2][field]':'SeasonId','filter[filters][2][value]':String(seasonId)},'CompetitionId');
    catalogs.set(seasonId,result);return result;
  }, events: async raceId => {
    const result = await post('Events/', { raceId: String(raceId) });
    if (!Array.isArray(result)) throw new Error('Events/: se esperaba un array'); return result;
  } };
}

export async function fetchCxCompetition({ competitionId, seasonId = null, uciRaceId = null, category = null, categories = null, client = createCxDataRideClient() }) {
  if (!positiveId(competitionId) || seasonId != null && !positiveId(seasonId) || uciRaceId != null && !positiveId(uciRaceId)
    || category != null && ![...CATEGORIES.values()].includes(category)
    || categories!=null&&(!Array.isArray(categories)||!categories.length||categories.some(value=>![...CATEGORIES.values()].includes(value)))) throw new Error('Destino DataRide CX inválido');
  const document = { schemaVersion: CX_RESULT_SCHEMA_VERSION, source: 'dataride', disciplineId: 3, competitionId: Number(competitionId),
    seasonId: seasonId == null ? null : Number(seasonId), fetchedAt: new Date().toISOString(), categories: [], exclusions: [] };
  if(seasonId!=null){
    const seasons=await client.seasons(),season=seasons.find(row=>row.Id===Number(seasonId));
    if(!season)throw new Error('Temporada DataRide CX inexistente');
    document.seasonKey=`${season.Year-1}-${String(season.Year%100).padStart(2,'0')}`;
    if(!(await client.competitionsForSeason(Number(seasonId))).some(row=>row.CompetitionId===Number(competitionId)))throw new Error('Competición no pertenece a la temporada DataRide CX');
  }
  const races = await client.pages('Races/', { competitionId: String(competitionId) }, 'Id');
  if (uciRaceId != null && !races.some(race => race.Id === Number(uciRaceId))) throw new Error('Race ID no pertenece a la competición');
  const mapped = new Set();
  for (const race of races) {
    if (uciRaceId != null && race.Id !== Number(uciRaceId)) continue;
    if (!positiveId(race.Id)) throw new Error('Race ID inválido en DataRide');
    const classified = classifyCxRace(race);
    if (!classified.category) { document.exclusions.push({ uciRaceId: race.Id, raceName: race.RaceName, reason: classified.reason }); continue; }
    if (category != null && category !== classified.category) continue;
    if (categories != null && !categories.includes(classified.category)) continue;
    if (mapped.has(classified.category)) throw new Error('Dos mangas DataRide de la misma categoría; correspondencia requiere revisión');
    mapped.add(classified.category);
    const events = await client.events(race.Id);
    const general = events.filter(event => clean(event.EventName).toLowerCase() === 'general classification' && !event.IsTeamEvent);
    for (const event of events.filter(event => !general.includes(event))) document.exclusions.push({ uciRaceId: race.Id, eventId: event.EventId, reason: 'Evento fuera de la clasificación individual de meta' });
    if (general.length > 1) throw new Error('Más de una clasificación general por manga');
    if (!general.length) { document.exclusions.push({ uciRaceId: race.Id, reason: 'Clasificación de meta todavía no disponible' }); continue; }
    const event = general[0]; if (!positiveId(event.EventId)) throw new Error('Event ID inválido en DataRide');
    const rows = normalizeCxDataRideRows(await client.pages('Results/', { eventId: String(event.EventId) }, 'ResultId'));
    document.categories.push({ category: classified.category, uciRaceId: race.Id, eventId: event.EventId, eventName: event.EventName,
      dateKey: cxDataRideDate(race.Date), publicationHint: rows.some(row => row.rank || row.irm) ? 'unverified_results' : 'not_published',
      rows, evidence: { sourceUrl: BASE + 'Results/', inputSource: 'dataride',
        dataRide: { disciplineId: 3, competitionId: Number(competitionId), seasonId: document.seasonId, uciRaceId: race.Id, eventId: event.EventId } } });
  }
  if (category != null && !mapped.has(category)) throw new Error('Categoría solicitada no está en la competición');
  return document;
}
