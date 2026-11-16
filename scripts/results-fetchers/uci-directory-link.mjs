/**
 * Enlace determinista con DataRide a partir del ID del calendario UCI.
 *
 * Cadena: `uciCalendarId` → competición del directorio de competiciones UCI
 * (`v1Code` = `D2CP` + ID) → competición DataRide con el mismo nombre
 * normalizado, fecha de inicio a ±1 día, la misma clase y el mismo país ISO3.
 * Las competiciones con el mismo nombre, clase y fecha (versiones por género o
 * edad, p. ej. Chrono des Nations) se desempatan con las categorías de las
 * carreras DataRide frente a `categoryCodes` del directorio; si persiste el
 * empate, con la fecha de inicio exacta. Sin resultado único no hay enlace.
 *
 * DataRide solo lista competiciones que ya tienen resultados o están en
 * curso: una competición ausente se reintenta en la pasada siguiente.
 *
 * El módulo no decide qué carreras enlazar ni escribe: cada enlazador aporta
 * sus candidatas, sus reglas de ocupación y su INSERT.
 */
'use strict';

import { listUciCompetitions, uciCalendarIdOf } from '../../supabase/functions/_shared/uci-competition-api.mjs';

export const DIRECTORY_DISCIPLINE = Object.freeze({ 10: 'ROA', 3: 'CRO' });
export const UCI_CALENDAR_MATCH_METHOD = 'uci-calendar-id';

// Campeonatos y juegos de carretera: la competición agrupa varias pruebas y
// cada ficha propia es una prueba (enlace con `uciRaceId`). El ID del
// calendario identifica el campeonato, no la prueba: quedan fuera de esta vía.
const ROAD_CHAMPIONSHIP_CLASSES = new Set(['CN', 'CC', 'WC']);
const DIRECTORY_CHAMPIONSHIP_CLASSES = new Set(['CN', 'CC', 'CM', 'JR', 'JC', 'JOJ']);

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// Letras que NFD no descompone y que una fuente puede escribir sin diacrítico.
const LETTERS = new Map([['ł', 'l'], ['ø', 'o'], ['đ', 'd'], ['ð', 'd'], ['þ', 'th'], ['ß', 'ss'], ['æ', 'ae'], ['œ', 'oe'], ['ı', 'i']]);

// Categorías de las carreras DataRide (`CategoryCode` de Races/) → código del directorio.
const DATARIDE_CATEGORY = new Map([
  ['men elite', 'ME'], ['women elite', 'WE'], ['men under 23', 'MU'],
  ['women under 23', 'WU'], ['men junior', 'MJ'], ['women junior', 'WJ'],
]);

/** Nombre de competición comparable: minúsculas sin diacríticos, solo [a-z0-9]. */
export function competitionNameKey(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[łøđðþßæœı]/g, (letter) => LETTERS.get(letter)).replace(/[^a-z0-9]/g, '');
}

/**
 * Día civil de una fecha DataRide `/Date(ms)/`. DataRide serializa la
 * medianoche local de Suiza; con 12 h de margen la fecha UTC es la civil.
 */
export function dataRideDateKey(value) {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]) + 12 * HOUR_MS);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function normalizeUciClass(value) {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '').replace('UCIWT', 'UWT');
}

/** Códigos del directorio (ME, WJ…) de las carreras DataRide de una competición. */
export function dataRideCategoryCodes(races) {
  const codes = new Set();
  for (const race of races || []) {
    const code = DATARIDE_CATEGORY.get(String(race?.CategoryCode ?? '').replace(/\s+/g, ' ').trim().toLowerCase());
    if (code) codes.add(code);
  }
  return codes;
}

function daysBetween(left, right) {
  return Math.round((Date.parse(left) - Date.parse(right)) / DAY_MS);
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

// Ambas fuentes mezclan códigos ISO3 y COI (Singapur es SGP en el directorio y
// SIN en DataRide); el nombre del país, idéntico en ambas, cubre esos casos.
function sameCountry(competition, iso3, countryName) {
  if (String(competition.CountryIsoCode3 ?? '').toUpperCase() === iso3) return true;
  return Boolean(countryName) && competitionNameKey(competition.CountryName) === countryName;
}

function candidateSummary(competition) {
  return {
    competitionId: Number(competition.CompetitionId),
    name: competition.CompetitionName,
    startDate: dataRideDateKey(competition.StartDate),
    classCode: competition.ClassCode,
  };
}

/**
 * Busca la competición DataRide de una competición del directorio.
 * `categoriesOf(competitionId)` devuelve los códigos de categoría DataRide y
 * solo se consulta para desempatar.
 * Devuelve `{ status: 'match', competition, rule }`, `{ status: 'none' }` o
 * `{ status: 'ambiguous', candidates }`.
 */
export async function matchDataRideCompetition(item, competitions, { categoriesOf = null } = {}) {
  const name = competitionNameKey(item?.name);
  const classCode = normalizeUciClass(item?.classCode);
  const country = String(item?.countryCode ?? '').toUpperCase();
  const countryName = competitionNameKey(item?.countryName);
  const start = String(item?.startDate ?? '');
  if (!name || !classCode || !country || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { status: 'none', reason: 'Competición del directorio incompleta' };
  const candidates = (competitions || []).filter((competition) => {
    const date = dataRideDateKey(competition?.StartDate);
    return Number.isSafeInteger(Number(competition?.CompetitionId)) && Number(competition.CompetitionId) > 0
      && date && Math.abs(daysBetween(date, start)) <= 1
      && competitionNameKey(competition.CompetitionName) === name
      && normalizeUciClass(competition.ClassCode) === classCode
      && sameCountry(competition, country, countryName);
  });
  if (!candidates.length) return { status: 'none', reason: 'DataRide aún no lista la competición' };
  if (candidates.length === 1) return { status: 'match', competition: candidates[0], rule: 'name' };

  let remaining = candidates;
  const wanted = new Set(item.categoryCodes || []);
  if (categoriesOf && wanted.size) {
    const byCategory = [];
    for (const competition of remaining) {
      const codes = await categoriesOf(Number(competition.CompetitionId));
      if (codes?.size && sameSet(codes, wanted)) byCategory.push(competition);
    }
    if (byCategory.length === 1) return { status: 'match', competition: byCategory[0], rule: 'categories' };
    if (byCategory.length > 1) remaining = byCategory;
  }
  const sameDay = remaining.filter((competition) => dataRideDateKey(competition.StartDate) === start);
  if (sameDay.length === 1) return { status: 'match', competition: sameDay[0], rule: 'start-date' };
  return { status: 'ambiguous', reason: 'Varias competiciones DataRide con el mismo nombre, clase y país', candidates: candidates.map(candidateSummary) };
}

/**
 * Competiciones del directorio indexadas por `uciCalendarId`. `query` usa los
 * filtros del listado (`disciplineCode`, `seasonYear`, `dateFrom`/`dateTo`).
 * Un `v1Code` repetido invalida ese ID: no se enlaza por él.
 */
export async function directoryByCalendarId({ query, fetcher = fetch }) {
  const { items } = await listUciCompetitions({ fetcher, query });
  const byId = new Map();
  const repeated = new Set();
  for (const item of items) {
    const id = uciCalendarIdOf(item);
    if (id == null) continue;
    if (byId.has(id)) repeated.add(id);
    byId.set(id, item);
  }
  for (const id of repeated) byId.delete(id);
  return byId;
}

/** Ventana de fechas del directorio alrededor de un día, en formato ISO. */
export function directoryWindow(dateKey, { before = 2, after = 2 } = {}) {
  const day = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(day)) throw new Error(`Fecha no reconocida: ${dateKey}`);
  return {
    dateFrom: new Date(day - before * DAY_MS).toISOString().slice(0, 10),
    dateTo: new Date(day + after * DAY_MS).toISOString().slice(0, 10),
  };
}

/**
 * ¿Una carrera de carretera se enlaza por su `uciCalendarId`? Los campeonatos
 * (CN, CC, WC) conservan su vía por prueba.
 */
export function usesCalendarIdLink(race) {
  const id = Number(race?.uciCalendarId);
  return Number.isSafeInteger(id) && id > 0 && !ROAD_CHAMPIONSHIP_CLASSES.has(normalizeUciClass(race?.uciCategory));
}

/**
 * Coherencia entre una carrera de carretera de un género y la competición del
 * directorio: categorías solo de ese género y clase que no sea de campeonato.
 * Devuelve el motivo de incoherencia o null.
 */
export function roadDirectoryMismatch(item, gender) {
  if (DIRECTORY_CHAMPIONSHIP_CLASSES.has(String(item?.classCode ?? '').toUpperCase())) return `clase de campeonato ${item.classCode}`;
  const prefix = gender === 'female' ? 'W' : 'M';
  const codes = (item?.categoryCodes || []).map(String);
  if (codes.some((code) => !code.startsWith(prefix))) return `categorías ${codes.join(',')} frente a una carrera ${gender === 'female' ? 'femenina' : 'masculina'}`;
  return null;
}

/**
 * Enlace determinista de una carrera propia. `race.uciCalendarId` es
 * obligatorio; `gender` (solo carretera) activa la comprobación de coherencia.
 * Devuelve el resultado de `matchDataRideCompetition` más la competición del
 * directorio, o un `none` con el motivo.
 */
export async function resolveByCalendarId(race, { directory, competitions, categoriesOf = null, gender = null }) {
  const calendarId = Number(race?.uciCalendarId);
  if (!Number.isSafeInteger(calendarId) || calendarId <= 0) return { status: 'none', reason: 'Sin uciCalendarId' };
  const item = directory.get(calendarId);
  if (!item) return { status: 'none', reason: `El directorio no tiene D2CP${calendarId}` };
  const mismatch = gender ? roadDirectoryMismatch(item, gender) : null;
  if (mismatch) return { status: 'none', reason: `D2CP${calendarId} incoherente: ${mismatch}`, item, incoherent: true };
  const result = await matchDataRideCompetition(item, competitions, { categoriesOf });
  return { ...result, item };
}
