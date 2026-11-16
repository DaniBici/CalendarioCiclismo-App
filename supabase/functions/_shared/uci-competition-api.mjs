// Directorio de competiciones UCI (https://uci-competition.tech.uci.ch). API
// JSON pública, sin sesión ni documentación: listado paginado y ficha con las
// carreras (etapas o categorías) de cada competición. `v1Code` es `D2CP` más
// el ID del calendario de uci.org (`uciCalendarId`); `code` cambia de formato
// desde la temporada 2027 y no identifica nada en la base.
export const UCI_COMPETITION_API = 'https://uci-competition.tech.uci.ch/api';
export const UCI_COMPETITION_DIRECTORY_URL = 'https://uci-competition.tech.uci.ch/competitions';

// Límite máximo de página que acepta el listado.
const PAGE_SIZE = 100;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)' };

// Categorías de corredor: género y edad.
export const UCI_CATEGORY = {
  ME: { gender: 'male', age: 'elite' },
  WE: { gender: 'female', age: 'elite' },
  MU: { gender: 'male', age: 'u23' },
  WU: { gender: 'female', age: 'u23' },
  MJ: { gender: 'male', age: 'junior' },
  WJ: { gender: 'female', age: 'junior' },
};

export function uciCalendarIdOf(item) {
  const m = /^D2CP([1-9]\d*)$/.exec(String(item?.v1Code ?? '').trim());
  return m ? Number(m[1]) : null;
}

export function uciIsoDate(value, label = 'Fecha') {
  const text = String(value ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!date || date.toISOString().slice(0, 10) !== text) throw new Error(`${label} UCI no reconocida: ${text || 'vacía'}`);
  return text;
}

// Fechas de una competición o carrera del directorio, validadas.
export function uciDates(item, label = item?.name) {
  const startDate = uciIsoDate(item?.startDate, `Inicio de ${label}`);
  const endDate = uciIsoDate(item?.endDate ?? item?.startDate, `Fin de ${label}`);
  if (startDate > endDate) throw new Error(`Rango de fechas UCI invertido: ${label}`);
  return { startDate, endDate };
}

// El directorio publica la web tal como la teclea el organizador: con o sin
// protocolo. Un dominio sin protocolo se completa con https; cualquier otro
// esquema o texto se descarta.
export function organizerWebsite(value) {
  const text = String(value ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  if (/^https?:\/\/[^/]+\.[^/]+/i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return null;
}

async function getJson(fetcher, url) {
  const response = await fetcher(url, { headers: HEADERS, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Directorio UCI: HTTP ${response.status} en ${url}`);
  return response.json();
}

// Listado completo de un filtro. Recorre todas las páginas y exige que el
// número de competiciones distintas coincida con `count`.
export async function listUciCompetitions({ fetcher = fetch, query }) {
  const filter = new URLSearchParams(query);
  const url = `${UCI_COMPETITION_API}/competitions?${filter}`;
  const items = new Map();
  let count = null;
  for (let offset = 0; count === null || offset < count; offset += PAGE_SIZE) {
    const page = await getJson(fetcher, `${url}&sortBy=startDate&sortOrder=asc&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!Array.isArray(page?.items) || !Number.isInteger(page.count)) throw new Error('Respuesta del directorio UCI inválida.');
    if (count !== null && page.count !== count) throw new Error('El directorio UCI cambió durante la descarga; repetir la importación.');
    count = page.count;
    for (const item of page.items) {
      if (!item?.id || !item.name) throw new Error('Competición UCI sin identificador o nombre.');
      items.set(item.id, item);
    }
    if (!page.items.length) break;
  }
  if (items.size !== count) throw new Error(`Directorio UCI incompleto: ${items.size} de ${count} competiciones.`);
  return { items: [...items.values()], url };
}

export function getUciCompetition({ fetcher = fetch, id }) {
  return getJson(fetcher, `${UCI_COMPETITION_API}/competitions/${encodeURIComponent(id)}`);
}

/**
 * Competición del directorio con `v1Code` = `D2CP` + `calendarId`. La búsqueda
 * del listado es por subcadena de `code` y del nombre, no de `v1Code`: encuentra
 * las competiciones con `code` = `v1Code` (carretera 2026, CX 2026-27), no las de
 * código propio (carretera 2027: `ROA_2027_2.PRO_001184`). Sin resultado, se
 * recorren las temporadas `seasonYears` (CX: año final). Solo vale la
 * coincidencia exacta de `v1Code`; devuelve null si no existe y falla si está
 * repetido.
 */
export async function findUciCompetitionByCalendarId({ fetcher = fetch, calendarId, disciplineCode, seasonYears = [] }) {
  const id = Number(calendarId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`uciCalendarId inválido: ${calendarId}`);
  const discipline = disciplineCode ? { disciplineCode } : {};
  const exact = (items) => {
    const matches = items.filter((item) => uciCalendarIdOf(item) === id);
    if (matches.length > 1) throw new Error(`Directorio UCI: D2CP${id} repetido`);
    return matches[0] || null;
  };
  const searched = exact((await listUciCompetitions({ fetcher, query: { search: `D2CP${id}`, ...discipline } })).items);
  if (searched) return searched;
  for (const seasonYear of seasonYears) {
    const found = exact((await listUciCompetitions({ fetcher, query: { ...discipline, seasonYear: String(seasonYear) } })).items);
    if (found) return found;
  }
  return null;
}

/**
 * Eventos con resultados de una competición (o de una carrera) y su recuento de
 * filas. `fresh`, como en la clasificación, evita la copia de CloudFront.
 */
export function getUciResultsAvailability({ fetcher = fetch, competitionId, raceId = null, fresh = false }) {
  const query = new URLSearchParams({ ...(raceId ? { raceId } : {}), ...(fresh ? { t: String(Date.now()) } : {}) }).toString();
  return getJson(fetcher, `${UCI_COMPETITION_API}/competitions/${encodeURIComponent(competitionId)}/results-availability${query ? `?${query}` : ''}`);
}

export function uciEventResultsUrl(competitionId, eventId) {
  return `${UCI_COMPETITION_API}/competitions/${encodeURIComponent(competitionId)}/events/${encodeURIComponent(eventId)}/results`;
}

// Clasificación de un evento, completa en una respuesta: `results` con `rank`
// (null en IRM), `mark` (DNF, DNS…), `riderRef` (ID UCI de 11 cifras),
// `firstName`, `lastName`, y `layout` (`team` en la llegada de una CRE).
// CloudFront la conserva hasta una hora; `fresh` añade un parámetro que obliga
// a leerla del origen.
export async function getUciEventClassification({ fetcher = fetch, competitionId, eventId, fresh = false }) {
  const url = uciEventResultsUrl(competitionId, eventId);
  const page = await getJson(fetcher, fresh ? `${url}?t=${Date.now()}` : url);
  if (!Array.isArray(page?.results)) throw new Error('Clasificación del directorio UCI inválida.');
  return page;
}

// Solo las filas de la clasificación.
export async function getUciEventResults(options) {
  return (await getUciEventClassification(options)).results;
}

// Ejecuta `task` sobre cada elemento con concurrencia acotada y reúne los
// fallos sin interrumpir el resto.
export async function mapLimited(items, task, { concurrency = 4, onProgress = () => {} } = {}) {
  const results = new Array(items.length), errors = [];
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await task(items[index]); } catch (error) { errors.push({ item: items[index], error: error.message }); }
      onProgress({ completed: ++completed, total: items.length });
    }
  }));
  return { results, errors };
}
