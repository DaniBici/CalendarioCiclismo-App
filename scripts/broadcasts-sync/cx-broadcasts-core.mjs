// Lógica pura del sincronizador de emisiones de ciclocross: lectura de las
// fuentes oficiales, emparejamiento con `cx_races` y planificación de altas y
// actualizaciones de `cx_broadcasts`. Sin red ni base de datos.
import { randomUUID } from 'node:crypto';
import {
  dateKeyInZone, fold, hboCatalogEvents, stripHtml, zonedTimeToUtc,
} from './broadcasts-sync-core.mjs';
import { sporzaDateKeyFromLabel, sporzaRowField } from './sporza-collector.mjs';

export const CX_TIME_ZONE = 'Europe/Brussels';
export const HBO_CX_SOURCE = 'hbo_max_cx';
export const SPORZA_CX_SOURCE = 'sporza_cx';
export const CX_SOURCES = [HBO_CX_SOURCE, SPORZA_CX_SOURCE];
export const TNT_URL = 'https://www.hbomax.com/gb/en/sports/cycling';
export const MAX_CHANGE_MS = 3 * 60 * 60_000;

const HBO_PLAY_URL_RE = /^https:\/\/play\.hbomax\.com\/sport\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPORZA_URL_RE = /^https:\/\/(?:[a-z0-9-]+\.)*sporza\.be\//i;

// ---------------------------------------------------------------------------
// Categorías y etiquetas
// ---------------------------------------------------------------------------

// «Men», «Women», «HG cross vrouwen», «Men U23»… → ME, WE, MU. Una etiqueta sin
// género, con ambos o con una modalidad ajena (máster, relevo, open) no se
// clasifica: el sincronizador no deduce una manga de otra.
export function cxCategoryFromLabel(value) {
  const text = fold(value);
  if (/\b(masters?|amateurs?|open|cadets?|kids|mixed|relay|relais|estafeta)\b/.test(text)) return null;
  const women = /\b(women|woman|female|vrouwen|dames|femmes?|feminin[ao]?)\b/.test(text);
  const men = /\b(men|man|male|mannen|heren|hommes?|masculin[ao]?)\b/.test(text);
  const gender = women && !men ? 'W' : men && !women ? 'M' : null;
  if (!gender) return null;
  const level = /\b(u ?23|under 23|beloften|espoirs?|sub ?23)\b/.test(text) ? 'U'
    : /\b(juniors?|junioren|youth|jeugd)\b/.test(text) ? 'J'
      : 'E';
  return `${gender}${level}`;
}

const VENUE_STOPWORDS = new Set([
  'cross', 'cyclocross', 'cyclo', 'veldrit', 'veldrijden', 'internationale', 'international',
  'grand', 'prix', 'the', 'van', 'der', 'den', 'het', 'des', 'cup', 'trofee', 'trophy', 'memorial',
  'ned', 'nld', 'bel', 'fra', 'ger', 'deu', 'gbr', 'lux', 'men', 'women', 'mannen', 'vrouwen', 'elite',
]);
const TOURNAMENT_STOPWORDS = new Set([
  'cross', 'cyclocross', 'cyclo', 'the', 'of', 'de', 'van', 'cup', 'trofee', 'trophy', 'telenet',
  'men', 'women', 'mannen', 'vrouwen', 'elite',
]);

export function venueTokens(value) {
  return fold(value).split(' ').filter((token) => token.length >= 3 && !VENUE_STOPWORDS.has(token));
}

export function tournamentTokens(value) {
  return fold(value).split(' ').filter((token) => token.length >= 2 && !TOURNAMENT_STOPWORDS.has(token));
}

function tokensRelated(left, right) {
  return left === right
    || (Math.min(left.length, right.length) >= 4 && (left.startsWith(right) || right.startsWith(left)));
}

function overlap(left, right) {
  return left.filter((token) => right.some((other) => tokensRelated(token, other))).length;
}

function tournamentsRelated(left, right) {
  if (!left.length || !right.length) return false;
  return overlap(left, right) >= Math.min(2, left.length, right.length);
}

function minuteIso(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(Math.floor(time / 60_000) * 60_000).toISOString();
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// HBO Max
// ---------------------------------------------------------------------------

// Eventos `Cyclo-cross` en directo del catálogo de HBO Max. Los de carretera
// (`Cycling`) los gestiona el sincronizador de carretera.
export function parseHboCyclocrossCatalog(html) {
  const all = hboCatalogEvents(html);
  const events = new Map();
  for (const item of all) {
    if (fold(item.sport) !== 'cyclo cross' || item.eventStatus !== 'live') continue;
    const id = String(item.hbomaxId).toLowerCase();
    const start = Date.parse(item.scheduleDates?.startDate);
    if (!Number.isFinite(start)) continue;
    const label = stripHtml(item.title?.full);
    const subtitle = stripHtml(item.title?.short);
    const parts = label.split('|').map((part) => part.trim()).filter(Boolean);
    events.set(id, {
      source: HBO_CX_SOURCE,
      externalEventId: id,
      label,
      subtitle,
      tournamentLabel: parts.length > 1 ? parts.slice(0, -1).join(' ') : null,
      venueLabel: parts.at(-1) || stripHtml(item.league),
      category: cxCategoryFromLabel(subtitle),
      dateKey: dateKeyInZone(new Date(start), CX_TIME_ZONE),
      startTimeUtc: minuteIso(item.scheduleDates.startDate),
      broadcastUrl: `https://play.hbomax.com/sport/${id}`,
      sourceUrl: item.url ? `https://www.hbomax.com${item.url}` : null,
    });
  }
  return { events: [...events.values()], catalogEventCount: all.length };
}

export function desiredHboRows(event) {
  const base = { category: event.category, startTimeUtc: event.startTimeUtc, isSporza: false };
  return [
    { ...base, role: 'hbo_primary', channel: 'Eurosport (HBO Max)', country: 'EUROPA', url: event.broadcastUrl },
    { ...base, role: 'hbo_mirror', channel: 'TNT Sports (HBO Max)', country: 'UK_IE', url: TNT_URL },
  ];
}

// ---------------------------------------------------------------------------
// Sporza
// ---------------------------------------------------------------------------

function sporzaCategory(competition) {
  const text = fold(competition);
  const gender = /\b(vrouwen|dames|women)\b/.test(text) ? 'W' : 'M';
  const level = /\b(beloften|u ?23)\b/.test(text) ? 'U' : /\b(junioren|juniors?|jeugd)\b/.test(text) ? 'J' : 'E';
  return `${gender}${level}`;
}

function sporzaTournamentLabel(competition) {
  return stripHtml(competition)
    .replace(/\b(vrouwen|dames|mannen|heren|beloften|junioren)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Esquema de livestreams de Sporza: filas `veldrijden` con la hora de emisión.
// Devuelve además el recuento de filas de cualquier deporte, para distinguir una
// página vacía de un contrato roto.
export function parseSporzaCxLivestreams(html, { todayKey }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayKey || ''))) {
    throw new Error('El esquema de livestreams de Sporza requiere la fecha de referencia');
  }
  const rows = [...String(html || '').matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const events = [];
  let currentDay = null;
  let rowCount = 0;
  for (const [, attrs, rowHtml] of rows) {
    if (/_customRow_/.test(attrs)) {
      currentDay = sporzaDateKeyFromLabel(rowHtml, todayKey);
      continue;
    }
    const time = sporzaRowField(rowHtml, '_time_');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    rowCount += 1;
    if (!currentDay) continue;
    const venueLabel = sporzaRowField(rowHtml, '_title_');
    const subtitles = [...rowHtml.matchAll(
      /<[^>]+class="[^"]*\b_subSubTitle_[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    )].map((match) => stripHtml(match[1])).filter(Boolean);
    if (!venueLabel || fold(subtitles[0]) !== 'veldrijden') continue;
    const competition = subtitles.slice(1).join(' ');
    events.push({
      source: SPORZA_CX_SOURCE,
      dateKey: currentDay,
      localTime: time,
      startTimeUtc: zonedTimeToUtc(currentDay, time, CX_TIME_ZONE),
      venueLabel,
      competition,
      tournamentLabel: sporzaTournamentLabel(competition),
      category: sporzaCategory(competition),
    });
  }
  return { events, rowCount };
}

// Partidos de veldrijden del calendario de Sporza (`matchId` estable y URL
// oficial `~matchId`), con la clasificación que declara su nombre.
export function parseSporzaCxSchedule(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const matches = [];
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const item = value.componentProps;
    if (item && item.sport === 'cycling' && item.matchId != null && fold(item.type) === 'veldrijden') {
      const matchId = String(item.matchId);
      if (/^\d+$/.test(matchId)) {
        matches.push({
          matchId,
          competition: stripHtml(item.competition),
          venueLabel: stripHtml(item.competitionName),
          tournamentLabel: sporzaTournamentLabel(item.competition),
          category: sporzaCategory(item.competition),
          url: `https://sporza.be/nl/sport/wielrennen/~${matchId}/`,
        });
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  };
  walk(data);
  return [...new Map(matches.map((match) => [match.matchId, match])).values()];
}

// Une cada livestream con su partido por fecha, categoría, torneo y sede. Sin
// un único partido, la fila no genera enlace: el hub genérico de livestreams
// no sirve como emisión de la prueba.
export function joinSporzaCx(livestreams, matchesByDate) {
  const events = [];
  const diagnostics = [];
  for (const livestream of livestreams) {
    const candidates = (matchesByDate.get(livestream.dateKey) || []).filter((match) => (
      match.category === livestream.category
      && fold(match.tournamentLabel) === fold(livestream.tournamentLabel)
      && overlap(venueTokens(livestream.venueLabel), venueTokens(match.venueLabel)) > 0
    ));
    if (candidates.length !== 1) {
      diagnostics.push({
        source: SPORZA_CX_SOURCE,
        action: 'insufficient_broadcast_evidence',
        title: `${livestream.venueLabel} · ${livestream.competition}`,
        dateKey: livestream.dateKey,
        detail: candidates.length === 0
          ? 'El calendario de Sporza no contiene el partido de este livestream.'
          : 'El calendario de Sporza contiene varios partidos candidatos para este livestream.',
      });
      continue;
    }
    const [match] = candidates;
    events.push({
      ...livestream,
      externalEventId: match.matchId,
      broadcastUrl: match.url,
      sourceUrl: 'https://sporza.be/nl/livestream/',
    });
  }
  return { events, diagnostics };
}

export function desiredSporzaRows(event) {
  return [{
    role: 'sporza',
    category: event.category,
    channel: 'Sporza',
    country: 'BE',
    url: event.broadcastUrl,
    startTimeUtc: event.startTimeUtc,
    isSporza: true,
  }];
}

export function desiredRows(event) {
  return event.source === HBO_CX_SOURCE ? desiredHboRows(event) : desiredSporzaRows(event);
}

// ---------------------------------------------------------------------------
// Emparejamiento con cx_races
// ---------------------------------------------------------------------------

function raceCoversDate(race, dateKey, category) {
  const categories = race.categories || [];
  const own = category && categories.find((item) => item.category === category);
  if (own?.dateKey) return own.dateKey === dateKey;
  if (categories.some((item) => item.dateKey === dateKey)) return true;
  return race.dateKey <= dateKey && dateKey <= (race.endDateKey || race.dateKey);
}

export function matchCxRace(event, races) {
  const venue = venueTokens(event.venueLabel);
  const tournament = tournamentTokens(event.tournamentLabel);
  const scored = races
    .filter((race) => !race.isCancelled && raceCoversDate(race, event.dateKey, event.category))
    .map((race) => ({
      race,
      venueHit: venue.length > 0
        && overlap(venue, venueTokens(`${race.venue || ''} ${race.name || ''} ${race.nameEn || ''}`)) > 0,
      tournamentHit: tournamentsRelated(tournament, tournamentTokens(race.tournamentName))
        || tournamentsRelated(tournament, tournamentTokens(race.tournamentNameEn)),
    }));
  let hits = scored.filter((item) => item.venueHit);
  if (hits.length > 1) {
    const both = hits.filter((item) => item.tournamentHit);
    if (both.length === 1) hits = both;
  }
  if (hits.length === 1) {
    return {
      status: 'matched',
      race: hits[0].race,
      basis: hits[0].tournamentHit ? 'venue+tournament' : 'venue',
    };
  }
  if (hits.length > 1) {
    return { status: 'ambiguous', candidates: hits.map((item) => item.race.id) };
  }
  return { status: 'unmatched', candidates: scored.filter((item) => item.tournamentHit).map((item) => item.race.id) };
}

// ---------------------------------------------------------------------------
// Planificación por carrera
// ---------------------------------------------------------------------------

const isEurosport = (row) => row.country === 'EUROPA' && /^eurosport\b/.test(fold(row.channel));
const isTnt = (row) => row.country === 'UK_IE' && /^tnt sports\b/.test(fold(row.channel));
const isSporzaRow = (row) => row.country === 'BE' && (row.isSporza === true || /^sporza\b/.test(fold(row.channel)));

const COUNTERPART = {
  hbo_primary: isEurosport,
  hbo_mirror: isTnt,
  sporza: isSporzaRow,
};

// Una fila gestionada conserva la forma de enlace que escribe el sincronizador.
// Cualquier otra (enlace editorial distinto, por ejemplo) es una decisión
// manual que la automatización no revierte.
function managedUrl(role, url) {
  const value = String(url || '');
  if (role === 'hbo_primary') return HBO_PLAY_URL_RE.test(value);
  if (role === 'hbo_mirror') return value === TNT_URL;
  return SPORZA_URL_RE.test(value);
}

function issue(entry, desired, action, detail, extra = {}) {
  return {
    source: entry.event.source,
    externalEventId: entry.event.externalEventId,
    role: desired.role,
    category: desired.category,
    title: entry.event.label || `${entry.event.venueLabel} · ${entry.event.competition || entry.event.subtitle || ''}`,
    dateKey: entry.event.dateKey,
    action,
    detail,
    ...extra,
  };
}

// `rows`: filas actuales de la carrera. `entries`: [{event, desired[]}].
// Devuelve las altas y actualizaciones necesarias y un informe por fila.
export function planCxRace({ raceId, rows, entries, newId = randomUUID }) {
  const order = [...rows]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)))
    .map((row) => ({ ...row, startTimeUtc: row.startTimeUtc ? new Date(row.startTimeUtc).toISOString() : null }));
  const original = new Map(order.map((row) => [row.id, { ...row }]));
  const inserts = [];
  const updated = new Map();
  const report = [];

  for (const entry of entries) {
    const resolved = entry.desired.map((desired) => ({
      desired,
      found: order.filter((row) => row.category === desired.category && COUNTERPART[desired.role](row)),
    }));
    const ambiguous = resolved.filter((item) => item.found.length > 1);
    if (ambiguous.length) {
      for (const item of ambiguous) {
        report.push(issue(entry, item.desired, 'ambiguous',
          `La categoría tiene ${item.found.length} filas ${item.desired.channel}; no se modifica ninguna.`));
      }
      continue;
    }
    const locked = resolved.find((item) => item.found[0] && !managedUrl(item.desired.role, item.found[0].url));
    if (locked) {
      report.push(issue(entry, locked.desired, 'manual_lock',
        `La fila ${locked.found[0].channel} tiene un enlace editorial distinto; la automatización no la modifica.`,
        { rowId: locked.found[0].id }));
      continue;
    }

    const plannedUpdates = [];
    let implausible = null;
    for (const { desired, found } of resolved) {
      const row = found[0];
      if (!row) continue;
      const set = {};
      if (row.url !== desired.url) set.url = desired.url;
      if (minuteIso(row.startTimeUtc) !== desired.startTimeUtc) {
        const delta = Math.abs(Date.parse(desired.startTimeUtc) - Date.parse(row.startTimeUtc || desired.startTimeUtc));
        if (row.startTimeUtc && delta > MAX_CHANGE_MS) implausible = { desired, row };
        else set.startTimeUtc = desired.startTimeUtc;
      }
      plannedUpdates.push({ desired, row, set });
    }
    if (implausible) {
      report.push(issue(entry, implausible.desired, 'implausible_change',
        `El cambio horario de ${implausible.row.channel} supera tres horas (${implausible.row.startTimeUtc} → ${implausible.desired.startTimeUtc}).`,
        { rowId: implausible.row.id }));
      continue;
    }

    for (const { desired, row, set } of plannedUpdates) {
      if (Object.keys(set).length === 0) {
        report.push(issue(entry, desired, 'unchanged', null, { rowId: row.id }));
        continue;
      }
      const merged = updated.get(row.id) || { id: row.id, set: {} };
      Object.assign(merged.set, set);
      updated.set(row.id, merged);
      Object.assign(row, set);
      report.push(issue(entry, desired, 'update', null, { rowId: row.id, set }));
    }

    const created = [];
    for (const { desired, found } of resolved) {
      if (found[0]) continue;
      const row = {
        id: newId(), raceId, category: desired.category, channel: desired.channel,
        startTimeUtc: desired.startTimeUtc, url: desired.url, note: null, country: desired.country,
        sortOrder: null, showInRevive: false, isSporza: desired.isSporza,
      };
      created.push({ desired, row });
    }
    if (created.length === 0) continue;

    // Posición: la pareja HBO Max abre el bloque de su categoría (Eurosport y
    // justo después TNT); Sporza cierra el bloque de la suya.
    for (const { desired, row } of created) {
      let index;
      if (desired.role === 'hbo_primary') {
        const sameCategory = order.findIndex((item) => item.category === desired.category);
        const mirror = order.findIndex((item) => item.category === desired.category && isTnt(item));
        index = mirror >= 0 ? mirror : sameCategory >= 0 ? sameCategory : order.length;
      } else if (desired.role === 'hbo_mirror') {
        const primary = order.findIndex((item) => item.category === desired.category && isEurosport(item));
        index = primary >= 0 ? primary + 1 : order.length;
      } else {
        let last = -1;
        order.forEach((item, position) => { if (item.category === desired.category) last = position; });
        index = last >= 0 ? last + 1 : order.length;
      }
      order.splice(index, 0, row);
      inserts.push(row);
      report.push(issue(entry, desired, 'insert', null, { rowId: row.id }));
    }
  }

  if (inserts.length > 0) {
    order.forEach((row, index) => {
      if (row.sortOrder === index) return;
      row.sortOrder = index;
      if (original.has(row.id)) {
        const merged = updated.get(row.id) || { id: row.id, set: {} };
        merged.set.sortOrder = index;
        updated.set(row.id, merged);
      }
    });
  } else {
    order.forEach((row, index) => { if (row.sortOrder == null) row.sortOrder = index; });
  }

  return {
    inserts: inserts.map((row) => ({ ...row })),
    updates: [...updated.values()].map((update) => ({
      ...update,
      before: Object.fromEntries(Object.keys(update.set).map((key) => [key, original.get(update.id)[key]])),
    })),
    report,
  };
}

export { addDays };
