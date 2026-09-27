import {
  contentHash, dateKeyInZone, fold, normalizedObservation, parseStageNumber,
} from './broadcasts-sync-core.mjs';

export const LEQUIPE_GUIDE_URL = 'https://www.lequipe.fr/programme-tv/agenda';
export const LEQUIPE_GRID_BASE_URL = 'https://dwh.lequipe.fr/api/efr/tvschedule/grid';
export const LEQUIPE_TV_URL = 'https://www.lequipe.fr/tv/';
export const LEQUIPE_CHANNEL_SLUG = 'la-chaine-l-equipe';
export const LEQUIPE_SPORT_SLUG = 'cyclisme-sur-route';
export const LEQUIPE_CANONICAL_CHANNEL = 'L\'Équipe TV';

// El \b de JavaScript es ASCII y no reconoce frontera ante «é»: se ancla con inicio o espacio.
const STAGE_WORD_RE = /(?:^|\s)(?:[eéÉ]tape|etapa|stage|tappa)\b/i;
// La parrilla cataloga como ciclismo y directo programas de estudio posteriores a la carrera.
const STUDIO_RE = /\b(?:emission|magazine|debrief|best of|resume|highlights?|avant course|apres course)\b/;
// L'Équipe numera a la francesa: «1re étape», «2e étape»; el núcleo espera «étape N»
// y su \b ASCII no reconoce frontera ante «é», de ahí la forma «Etape N».
const FRENCH_ORDINAL_STAGE_RE = /\b(\d{1,2})(?:res?|es?|è?me|de)?\s*[eé]tape\b/gi;

function stageFromText(text) {
  return parseStageNumber(String(text || '').replace(FRENCH_ORDINAL_STAGE_RE, 'Etape $1'));
}

function raceText(title, subtitle) {
  const titleIsStage = STAGE_WORD_RE.test(title);
  const subtitleIsStage = STAGE_WORD_RE.test(subtitle);
  if (titleIsStage && !subtitleIsStage) return subtitle;
  return title;
}

function eventIdentity(dateKey, stageNumber, race) {
  const raceKey = fold(race).replace(/\b20\d{2}\b/g, '').trim();
  return `${dateKey}|${stageNumber ?? 'one-day'}|${raceKey}`;
}

function gridDay(dateKey) {
  return `${LEQUIPE_GRID_BASE_URL}/${dateKey.split('-').join('')}`;
}

export function parseLequipeGrid(payload, sourceUrl = LEQUIPE_GUIDE_URL) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!Array.isArray(parsed?.items)) {
    throw new Error('L\'Équipe devolvió una parrilla no utilizable');
  }
  const events = [];
  for (const item of parsed.items) {
    if (item?.channel_slug !== LEQUIPE_CHANNEL_SLUG || item?.sport_slug !== LEQUIPE_SPORT_SLUG) continue;
    if (item.is_live !== true) continue;
    const title = String(item.title || '').trim();
    const subtitle = String(item.summary || '').trim();
    const start = new Date(item.date);
    if (!title || !Number.isFinite(start.getTime())) continue;
    if (STUDIO_RE.test(fold(`${title} ${subtitle}`))) continue;
    const dateKey = dateKeyInZone(start, 'Europe/Paris');
    const stageNumber = stageFromText(`${title} ${subtitle}`);
    const identity = eventIdentity(dateKey, stageNumber, raceText(title, subtitle));
    events.push({
      source: 'lequipe',
      externalEventId: contentHash(identity).slice(0, 32),
      dateKey,
      title,
      subtitle: subtitle || null,
      stageNumber,
      startTimeUtc: start.toISOString(),
      sourceUrl,
      broadcastUrl: LEQUIPE_TV_URL,
      sourceChannel: 'la chaine L\'Équipe',
      channel: LEQUIPE_CANONICAL_CHANNEL,
      country: 'FR',
      reviveCapable: false,
      insertSortOrder: 10,
    });
  }
  // La parrilla puede repetir el mismo programa: una sola observación por identidad.
  return [...new Map(events.map((event) => [event.externalEventId, event])).values()]
    .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
}

export async function collectLequipe(now = new Date(), { fetcher = null, dateKeys = null, diagnostics = [] } = {}) {
  const fetchJson = fetcher || (async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: {
      Accept: 'application/json', 'User-Agent': 'CalendarioCiclismo/broadcasts-sync (+https://calendariociclismo.app)',
    } });
    if (!response.ok) {
      const error = new Error(`L'Équipe: ${response.status} en ${url}`); error.status = response.status; throw error;
    }
    return response.json();
  });
  const today = dateKeyInZone(now, 'Europe/Paris');
  const days = dateKeys || Array.from({ length: 10 }, (_, index) => {
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + index - 1);
    return d.toISOString().slice(0, 10);
  });
  const events = [];
  for (const day of days) {
    try {
      events.push(...parseLequipeGrid(await fetchJson(gridDay(day)), LEQUIPE_GUIDE_URL));
    } catch (error) {
      // Un día futuro sin parrilla publicada no invalida el resto de la ventana.
      if (error.status === 404 && day > today) continue;
      throw error;
    }
  }
  const allowedDates = new Set(days);
  const result = events
    .filter((event) => allowedDates.has(event.dateKey))
    .map((event) => normalizedObservation({ ...event, writeEligible: true }));
  if (!result.length) diagnostics.push({ source: 'lequipe', action: 'no_cycling_events', sourceUrl: LEQUIPE_GUIDE_URL });
  return result;
}
