import { createHash, randomUUID } from 'node:crypto';

export const HBO_SOURCE_URL = 'https://www.hbomax.com/es/es/sports/cycling';
export const RTVE_SOURCE_URLS = [
  { channel: null, url: 'https://www.rtve.es/play/guia-tve/' },
];
export const RTVE_VUELTA_SCHEDULE_URL = 'https://www.rtve.es/play/noticias/20260818/vuelta-ciclista-2026-hora-donde-ver-gratis-todas-etapas/17194425.shtml';
export const RTVE_VUELTA_VIDEOS_URL = 'https://www.rtve.es/api/programas/144990/videos.json?page=1&size=50';
export const RTVE_LIVES_URL = 'https://api.rtve.es/api/lives/peticiones.json?size=200';
export const PARSER_VERSION = '2026-10-05.1';

const STAGE_RE = /\b(?:stage|etapa|[eé]tape|tappa)\s*(\d{1,2})(?:[a-z])?\b/i;
const CYCLING_RE = /\b(ciclismo|ciclista|cycling|vuelta|giro|tour de france|tour femenino|clasica|clásica|mundial.*ruta|campeonato.*ruta)\b/i;
const GENERIC_WORDS = new Set([
  'la', 'el', 'los', 'las', 'de', 'del', 'a', 'en', 'the', 'of', 'stage', 'etapa',
  'men', 'women', 'masculino', 'femenino', 'ciclismo', 'cycling',
]);
const MIN_WORD_MATCH_SCORE = 82;

export function decodeHtml(value) {
  return String(value || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function fold(value) {
  return decodeHtml(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchingForm(value) {
  return fold(value)
    .replace(/\bcto\b/g, 'campeonato')
    .replace(/\brelevos\b/g, 'relevo')
    .replace(/\bmixtos\b/g, 'mixto')
    .replace(/\bcontrarreloj\b/g, 'cri')
    .replace(/\bsub 23\b/g, 'sub23')
    .replace(/\bfem\b/g, 'femenino')
    .replace(/\bmasc\b/g, 'masculino')
    .replace(/\b(?:g p|gp|grand prix|gran premio)\b/g, 'grand prix')
    .replace(/\b(?:trofeo|trophy)\b/g, 'trofeo');
}

// ETB On y la parrilla de EITB rotulan las carreras en euskera.
const BASQUE_RACE_FORMS = [
  [/\bemakumezkoen frantziako tourra\b/g, 'tour de francia femenino'],
  [/\bfrantziako tourra\b/g, 'tour de francia'],
  [/\balemaniako (?:tourra|itzulia)\b/g, 'vuelta a alemania'],
  [/\bburgosko itzulia\b/g, 'vuelta a burgos'],
  [/\bespainiako (?:itzulia|vuelta)\b/g, 'la vuelta'],
  [/\bitaliako giroa\b/g, 'giro de italia'],
  [/\bdonostiako klasik(?:a|oa)\b/g, 'clasica de san sebastian'],
  [/\bordiziako klasik(?:a|oa)\b/g, 'clasica de ordizia'],
  [/\bjaengo klasik(?:a|oa)\b/g, 'clasica jaen'],
  [/\bgetxoko zirkuitua\b/g, 'circuito de getxo'],
  [/\b(?:euskal herriko|eh) itzulia\b/g, 'itzulia basque country'],
  [/\bitzulia emakumeak\b/g, 'itzulia women'],
  [/\bmunduko txapelketa\b/g, 'campeonato del mundo'],
  [/\bemakume(?:ak|en|zkoen|zkoak)\b/g, 'femenino'],
  [/\bgizonezko(?:en|ak)\b/g, 'masculino'],
];

function basqueRaceForm(value) {
  return BASQUE_RACE_FORMS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

// L'Équipe rotula los campeonatos en francés y abrevia el género tras la
// categoría: «Course en ligne Elite F», «Championnats d'Europe».
const FRENCH_RACE_FORMS = [
  [/\bchampionnats? d europe\b/g, 'european championships'],
  [/\bchampionnats? du monde\b/g, 'world championships'],
  [/\bcourse en ligne\b/g, 'road race'],
  [/\bcontre la montre par equipes? mixtes?\b/g, 'mixed relay ttt'],
  [/\brelais mixtes?\b/g, 'mixed relay ttt'],
  [/\bcontre la montre(?: individuel)?\b/g, 'itt'],
  [/\b(elite|u23|espoirs|juniors?) f\b/g, '$1 women'],
  [/\b(elite|u23|espoirs|juniors?) h\b/g, '$1 men'],
  [/\bhommes\b/g, 'men'],
];

function frenchRaceForm(value) {
  return FRENCH_RACE_FORMS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

// RAI rotula los campeonatos en italiano: «Mondiali/Europei», «Cronometro»,
// «Corsa/Gara in linea», «Staffetta mista», «Uomini», «Under 23».
const ITALIAN_RACE_FORMS = [
  [/\b(?:campionati )?mondial[ei]\b/g, 'world championships'],
  [/\b(?:campionati )?europe[io]\b/g, 'european championships'],
  [/\b(?:cronometro )?staffetta mista\b/g, 'mixed relay ttt'],
  [/\bcronometro(?: individuale)?\b/g, 'itt'],
  [/\b(?:corsa|gara) in linea\b/g, 'road race'],
  [/\bunder 23\b/g, 'u23'],
  [/\b(?:uomini|maschile)\b/g, 'men'],
];

function italianRaceForm(value) {
  return ITALIAN_RACE_FORMS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

// RAI y RTBF omiten la categoría élite y, a menudo, la disciplina de la prueba
// en línea: «Europei Lubiana: Elite Donne», «Course en ligne Femmes».
function implicitChampionshipForm(value) {
  if (!/\b(?:world|european) championships\b/.test(value)) return value;
  let text = value;
  if (!/\b(?:itt|ttt|relay|road race|rr)\b/.test(text)) text += ' road race';
  if (!raceLevel(text) && !/\belite\b/.test(text)) text += ' elite';
  return text;
}

// Categoría de edad declarada. Una fuente que nombra sub23 o júnior no puede
// casar con la prueba élite del mismo día, y viceversa.
function raceLevel(value) {
  if (/\b(?:sub23|u23|under 23|beloften|espoirs)\b/.test(value)) return 'sub23';
  if (/\b(?:junior|juniors|juniores|junioren)\b/.test(value)) return 'junior';
  return null;
}

const GENDER_WORDS_RE = /\b(?:women|female|femenin[ao]|feminine|femmes?|dames|femminile|donne|vrouwen)\b/g;

function canonicalGenderWords(value) {
  return value.replace(GENDER_WORDS_RE, 'women');
}

function significant(value) {
  return matchingForm(value).split(' ').filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
}

// «Coppa Agostoni - Giro delle Brianze»: las fuentes rotulan solo el nombre
// principal. Campeonatos y Juegos no se recortan: su prefijo no identifica la
// prueba del día.
function hyphenHead(alias) {
  const [head, ...rest] = String(alias).split(/\s+[-–—]\s+/);
  if (!rest.length || /\b(?:championships?|games)\b/i.test(head)) return null;
  return significant(head).length >= 2 ? matchingForm(head) : null;
}

function aliasesForRace(race, source) {
  const aliases = [race.name, race.nameEn];
  for (const language of Object.values(race.translations || {})) {
    if (language && typeof language === 'object') aliases.push(language.name);
  }
  const folded = new Set(aliases.filter(Boolean).flatMap((alias) => {
    const primary = String(alias).split(/\s*\/\s*/, 1)[0];
    return [matchingForm(alias), matchingForm(primary), hyphenHead(primary)].filter(Boolean);
  }));
  for (const alias of [...folded]) {
    if (/\bcre\b/.test(alias) && /\brelevo mixto\b/.test(alias)) {
      folded.add(alias.replace(/\bcre\b/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (/\bla vuelta\b/.test(alias)) folded.add('vuelta a espana');
    if (/\bvuelta a espana\b/.test(alias)) folded.add('la vuelta');
    if (/\btour de france femmes\b/.test(alias)) folded.add('tour de france femmes avec zwift');
    if (/\bfaun tour femmes\b/.test(alias)) folded.add('faun tour femmes');
    if (/\b(?:il )?giro d abruzzo\b/.test(alias)) {
      folded.add('giro d abruzzo');
      folded.add('tour of abruzzo');
    }
    if (/\btour de luxembourg\b/.test(alias)) {
      folded.add('tour of luxembourg');
      folded.add('ronde van luxemburg');
    }
    if (/\bcro race\b/.test(alias)) folded.add('tour de croatie');
    if (/\bflandrien\b/.test(alias)) folded.add('flandrien 0 0 classic');
    // Mundial y Europeo se redactan distinto según fuente: HBO escribe «Road Race» y
    // «Elite Mixed TTT»; Sporza usa «WK»/«EK», «tijdrit/wegrit», «beloften» y
    // «Mixed team relay».
    const championship = alias.match(/\b(world|european) championships?\b/);
    if (championship) {
      const variants = new Set([alias]);
      if (/\brr\b/.test(alias)) variants.add(alias.replace(/\brr\b/g, 'road race'));
      if (/\brelay ttt\b/.test(alias)) {
        variants.add(alias.replace(/\brelay ttt\b/g, 'ttt'));
        variants.add(alias.replace(/\brelay ttt\b/g, 'relay itt'));
        variants.add(alias.replace(/\brelay ttt\b/g, 'team relay'));
      }
      const short = championship[1] === 'world' ? 'wk' : 'ek';
      for (const variant of [...variants]) {
        folded.add(variant);
        folded.add(variant.replace(/\b(?:world|european) championships?\b/g, short));
      }
    }
    if (/\bil lombardia\b/.test(alias)) folded.add('ronde van lombardije');
    if (/\bfourmies feminine\b/.test(alias)) folded.add('grand prix de fourmies');
    if (/\bpour (?:dames|femmes)\b/.test(alias)) folded.add(alias.replace(/\bpour (dames|femmes)\b/g, '$1'));
  }
  if (source === 'rai') {
    for (const alias of [...folded]) {
      if (/industria and artigianato/.test(alias)) folded.add('grand prix industria and artigianato');
      if (/premondiale giro toscana/.test(alias)) folded.add('giro della toscana');
      if (/memorial marco pantani/.test(alias)) folded.add('memorial pantani');
    }
  }
  return [...folded];
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parseStageNumber(value) {
  const text = String(value || '');
  const match = text.match(STAGE_RE)
    || text.match(/\b(\d{1,2})\s*[ªºa]?\s*(?:etapa|stage|[eé]tape|tappa)\b/i);
  return match ? Number(match[1]) : null;
}

function classText(body, className) {
  const match = body.match(new RegExp(`<[^>]+class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  return stripHtml(match?.[1]);
}

export function isMontoneraEligible(title, subtitle) {
  const race = fold(title);
  const detail = fold(subtitle);
  if (!/\bmen\b|\bmasculin[oa]\b/.test(detail) || /\bwomen\b|femenin[ao]/.test(detail)) return false;
  return [
    /\bgiro d italia\b/,
    /\btour de france\b/,
    /\bla vuelta\b/,
    /\b(?:uci )?(?:road )?world championships?\b/,
    /\b(?:milan|milano)[ -]san remo\b/,
    /\b(?:tour of flanders|ronde van vlaanderen)\b/,
    /\bparis[ -]roubaix\b/,
  ].some((pattern) => pattern.test(race));
}

function hboCatalogEvents(html) {
  const data = html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!data) return [];
  const events = [];
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (value.__typename === 'Event' && value.hbomaxId) events.push(value);
    else Object.values(value).forEach(walk);
  };
  walk(JSON.parse(data));
  return events;
}

// El catálogo se sirve como página Next.js: los eventos viven en el JSON de
// __NEXT_DATA__, no en el marcado. Las emisiones son los eventos `live`; los
// `standalone-event` son grabaciones y solo sirven para detectar La Montonera.
export function parseHboCatalog(html) {
  const montoneraKeys = new Set();
  const events = [];
  for (const item of hboCatalogEvents(html)) {
    const id = String(item.hbomaxId).toLowerCase();
    const path = String(item.url || '').match(/\/sport\/(\d{4})-(\d{1,2})-(\d{1,2})\/([0-9a-f-]{36})$/i);
    if (!path || path[4].toLowerCase() !== id || fold(item.sport) !== 'cycling') continue;
    const title = stripHtml(item.title?.full);
    const subtitle = stripHtml(item.title?.short);
    const dateKey = `${path[1]}-${path[2].padStart(2, '0')}-${path[3].padStart(2, '0')}`;
    const stageNumber = parseStageNumber(`${title} ${subtitle}`);
    const baseTitle = title.replace(/\s*\|\s*La Montonera\b.*$/i, '').trim();
    const montoneraKey = `${dateKey}|${stageNumber ?? 'one-day'}|${fold(baseTitle)}`;
    if (/montonera/i.test(title)) {
      if (isMontoneraEligible(baseTitle, subtitle)) montoneraKeys.add(montoneraKey);
      continue;
    }
    if (item.eventStatus !== 'live') continue;
    const startDate = item.scheduleDates?.startDate;
    events.push({
      source: 'hbo_max',
      externalEventId: id,
      dateKey,
      title,
      subtitle,
      sourceUrl: `https://www.hbomax.com${item.url}`,
      broadcastUrl: `https://play.hbomax.com/sport/${id}`,
      stageNumber,
      startTimeUtc: Number.isFinite(Date.parse(startDate)) ? new Date(startDate).toISOString() : null,
      montoneraKey,
    });
  }
  return [...new Map(events.map((event) => [event.externalEventId, event])).values()]
    .map(({ montoneraKey, ...event }) => ({
      ...event,
      hasMontonera: montoneraKeys.has(montoneraKey),
    }));
}

export function parseHboEventStart(html) {
  const patterns = [
    /"eventScheduleDates"\s*:\s*\{\s*"startDate"\s*:\s*"([^"]+)"/,
    /\\"eventScheduleDates\\"\s*:\s*\{\s*\\"startDate\\"\s*:\s*\\"([^\\"]+)\\"/,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

const SPANISH_MONTHS = new Map([
  ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6],
  ['julio', 7], ['agosto', 8], ['septiembre', 9], ['octubre', 10], ['noviembre', 11], ['diciembre', 12],
]);

export function parseSpanishDate(value) {
  const match = fold(value).match(/\b(\d{1,2}) de ([a-z]+) de (\d{4})\b/);
  const month = match && SPANISH_MONTHS.get(match[2]);
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

export function zonedTimeToUtc(dateKey, time, timeZone = 'Europe/Madrid') {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let candidate = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const wanted = Date.UTC(year, month - 1, day, hour, minute);
    const delta = wanted - represented;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate).toISOString();
}

export function dateKeyInZone(now = new Date(), timeZone = 'Europe/Madrid') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function rtveChannel(value) {
  const folded = fold(value);
  if (folded.includes('teledeporte')) return 'Teledeporte';
  if (/\bla 2\b/.test(folded)) return 'La 2';
  if (/\bla 1\b/.test(folded)) return 'La 1';
  return null;
}

function canonicalRtveChannel(channel) {
  if (channel === 'Teledeporte') return 'TDP / RTVE Play';
  if (channel === 'La 2') return 'La 2 / RTVE Play';
  if (channel === 'La 1') return 'La 1 / RTVE Play';
  return null;
}

function rtveLiveUrl(channel) {
  if (channel === 'Teledeporte') return 'https://www.rtve.es/play/teledeporte/directo/';
  if (channel === 'La 2') return 'https://www.rtve.es/play/videos/directo/la-2/';
  return 'https://www.rtve.es/play/videos/directo/la-1/';
}

export function parseRtveVueltaScheduleArticle(html) {
  const text = stripHtml(html);
  const foldedText = fold(text);
  const year = Number(foldedText.match(/\bvuelta(?: a)? espana\s+(20\d{2})\b/)?.[1]);
  if (!year) return [];

  const events = [];
  const blockRe = /\bEtapa\s+(\d{1,2})\s*:\s*([\s\S]*?)(?=\s+Etapa\s+\d{1,2}\s*:|$)/gi;
  for (const match of text.matchAll(blockRe)) {
    const stageNumber = Number(match[1]);
    const block = match[2];
    const foldedBlock = fold(block);
    const dateMatch = foldedBlock.match(
      /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})\s+de\s+([a-z]+)/,
    );
    const month = dateMatch && SPANISH_MONTHS.get(dateMatch[2]);
    const startMatch = block.match(/\bDesde las\s+(\d{1,2}):(\d{2})\s+horas?\s+en\s+Teledeporte\b/i);
    if (!month || !startMatch) continue;

    const dateKey = `${year}-${String(month).padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
    const localStartTime = `${startMatch[1].padStart(2, '0')}:${startMatch[2]}`;
    const transition = block.match(
      /\by\s+desde las\s+(\d{1,2}):(\d{2})\s+horas?\s+en\s+(La 1|La 2)\b/i,
    );
    const transitionTime = transition
      ? `${transition[1].padStart(2, '0')}:${transition[2]}`
      : null;
    const note = transition ? `Pasa a ${transition[3]} a las ${transitionTime}.` : null;
    events.push({
      source: 'rtve',
      externalEventId: rtveVueltaExternalEventId(dateKey, stageNumber),
      dateKey,
      title: `Ciclismo Vuelta a España ${year} Etapa ${stageNumber}`,
      subtitle: stripHtml(block),
      sourceChannel: 'Teledeporte',
      channel: 'TDP / RTVE Play',
      country: 'ES',
      sourceUrl: RTVE_VUELTA_SCHEDULE_URL,
      broadcastUrl: `https://www.rtve.es/play/videos/directo/ciclismo-vuelta-espana-${year}-masculina-etapa-${stageNumber}/`,
      startTimeUtc: zonedTimeToUtc(dateKey, localStartTime),
      localStartTime,
      stageNumber,
      note,
    });
  }
  return events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
}

export function rtveVueltaExternalEventId(dateKey, stageNumber) {
  return contentHash(`rtve-vuelta-schedule|${dateKey}|${stageNumber}`).slice(0, 32);
}

export function parseRtveStructuredGuide(html) {
  const decoded = String(html).replace(/\\"/g, '"');
  const groupRe = /"nombreCanal":"([^"]+)"[\s\S]{0,500}?"items":(\[[\s\S]*?\]),"canal":\{"id":"([^"]+)"/gi;
  const events = [];
  for (const group of decoded.matchAll(groupRe)) {
    const channel = rtveChannel(group[1]) || rtveChannel(group[3]);
    if (!channel) continue;
    const items = [...group[2].matchAll(/\{"name":[\s\S]*?"orden":\d+\}/g)].map((match) => match[0]);
    const stringField = (item, name) => {
      const value = item.match(new RegExp(`"${name}":"((?:\\\\.|[^"])*)"`))?.[1];
      return value == null ? null : decodeHtml(value.replace(/\\+r|\\+n/g, ' ').replace(/\\+"/g, '"'));
    };
    const numberField = (item, name) => Number(item.match(new RegExp(`"${name}":(?:"(\\d+)"|(\\d+))`))?.slice(1).find(Boolean));
    for (const item of items) {
      const begin = stringField(item, 'begintime') || '';
      if (!/^\d{14}$/.test(begin)) continue;
      const title = stripHtml(stringField(item, 'original_event_name') || stringField(item, 'name'));
      const subtitle = stripHtml(stringField(item, 'original_episode_name')
        || stringField(item, 'episode_name') || stringField(item, 'description'));
      if (!CYCLING_RE.test(`${title} ${subtitle}`)) continue;
      const dateKey = `${begin.slice(0, 4)}-${begin.slice(4, 6)}-${begin.slice(6, 8)}`;
      const localTime = `${begin.slice(8, 10)}:${begin.slice(10, 12)}`;
      const episodeNumber = numberField(item, 'episode_number');
      const isLaVuelta = /\b(?:la vuelta|vuelta a espana)\b/.test(fold(`${title} ${subtitle}`));
      const stageNumber = parseStageNumber(`${title} ${subtitle}`)
        ?? (isLaVuelta && episodeNumber > 0 ? episodeNumber : null);
      const titleIdentity = fold(title)
        .replace(/\b\d{4}\b/g, '')
        .replace(/\b\d+\s*a?\s*(?:etapa|stage)\b.*$/, '')
        .trim();
      const stableKey = `${dateKey}|${stageNumber ?? 'one-day'}|${titleIdentity}`;
      events.push({
        source: 'rtve', externalEventId: contentHash(stableKey).slice(0, 32),
        dateKey, title, subtitle, sourceChannel: channel,
        channel: canonicalRtveChannel(channel), country: 'ES',
        sourceUrl: RTVE_SOURCE_URLS[0].url, broadcastUrl: rtveLiveUrl(channel),
        startTimeUtc: zonedTimeToUtc(dateKey, localTime), localStartTime: localTime,
        stageNumber,
      });
    }
  }
  events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  const byEvent = new Map();
  for (const event of events) {
    if (!byEvent.has(event.externalEventId)) byEvent.set(event.externalEventId, []);
    byEvent.get(event.externalEventId).push(event);
  }
  return [...byEvent.values()].map((group) => {
    const teledeporte = group.filter((event) => event.sourceChannel === 'Teledeporte');
    const isLaVuelta = group.some((event) => fold(`${event.title} ${event.subtitle}`).includes('vuelta a espana'));
    if (isLaVuelta && !teledeporte.length) return null;
    const primary = teledeporte[0] || group[0];
    if (!teledeporte.length) return primary;
    const transition = group.find((event) => event.sourceChannel !== 'Teledeporte'
      && event.startTimeUtc > primary.startTimeUtc);
    return {
      ...primary,
      channel: 'TDP / RTVE Play',
      broadcastUrl: rtveLiveUrl('Teledeporte'),
      note: transition ? `Pasa a ${transition.sourceChannel} a las ${transition.localStartTime}.` : null,
    };
  }).filter(Boolean);
}

const RTVE_LIVES_DATE_RE = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

// Clasifica una emisión por disciplina, categoría y género para casar la
// parrilla lineal de Teledeporte con el directo equivalente de RTVE Play.
export function rtveDisciplineKey(value) {
  const folded = fold(value);
  let discipline = 'linea';
  if (/\bcontrarreloj\b|\bcri\b/.test(folded)) discipline = 'cri';
  else if (/\brelevos?\b|\bcre\b/.test(folded)) discipline = 'cre';
  let level = 'elite';
  if (/\bsub ?23\b|\bu23\b/.test(folded)) level = 'sub23';
  else if (/\bjunior\b/.test(folded)) level = 'junior';
  let gender = 'mixto';
  if (/\bfemenin|\bwomen\b|\bfemale\b|\bfem\b/.test(folded)) gender = 'femenino';
  else if (/\bmasculin|\bmen\b|\bmale\b|\bmasc\b/.test(folded)) gender = 'masculino';
  return `${discipline}|${level}|${gender}`;
}

// Comprueba que dos rótulos comparten al menos una palabra significativa de
// carrera, para no cruzar la hora de un directo con otra prueba del mismo día.
export function rtveRaceHintMatch(left, right) {
  const words = new Set(significant(left));
  if (!words.size) return true;
  return significant(right).some((word) => words.has(word));
}

// Eventos de un día publicados por RTVE Play. Su `inicio` es la hora real de
// emisión, más fiable que el hueco de la parrilla lineal de Teledeporte.
export function parseRtvePlayLives(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed?.page?.items) ? parsed.page.items : [];
  const events = [];
  for (const item of items) {
    const text = `${item?.antetitulo || ''} ${item?.titulo || ''} ${item?.descripcion || ''}`;
    if (!CYCLING_RE.test(text)) continue;
    const start = String(item?.inicio || '').match(RTVE_LIVES_DATE_RE);
    if (!start) continue;
    const htmlUrl = typeof item?.htmlUrl === 'string' ? item.htmlUrl : '';
    if (!htmlUrl.includes('rtve.es/play/videos/directo/')) continue;
    const dateKey = `${start[3]}-${start[2]}-${start[1]}`;
    const localStartTime = `${start[4]}:${start[5]}`;
    events.push({
      source: 'rtve',
      externalEventId: contentHash(`rtve-play-lives|${dateKey}|${item.id || item.uri || htmlUrl}`).slice(0, 32),
      dateKey,
      localStartTime,
      title: stripHtml(item.titulo || 'Campeonato del Mundo en carretera'),
      subtitle: stripHtml(item.descripcion || ''),
      stageNumber: null,
      disciplineKey: rtveDisciplineKey(text),
      sourceUrl: RTVE_LIVES_URL,
      broadcastUrl: htmlUrl,
      channel: 'TDP / RTVE Play',
      country: 'ES',
      startTimeUtc: zonedTimeToUtc(dateKey, localStartTime),
    });
  }
  return events;
}

function rtvePublicationDateKey(value) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(20\d{2})\b/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function parseRtveVueltaVideos(payload) {
  let parsed;
  try { parsed = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return []; }
  const items = Array.isArray(parsed?.page?.items) ? parsed.page.items : [];
  const events = [];
  for (const item of items) {
    const title = String(item?.title || item?.shortTitle || '').trim();
    const longTitle = String(item?.longTitle || title).trim();
    const stageMatch = title.match(/^Etapa\s+(\d{1,2})\s*:/i);
    const dateKey = rtvePublicationDateKey(item?.publicationDate);
    const year = Number(longTitle.match(/\b(20\d{2})\b/)?.[1]);
    const duration = Number(item?.duration || 0);
    let url;
    try { url = new URL(item?.htmlUrl); } catch { continue; }
    if (!stageMatch || !dateKey || year !== Number(dateKey.slice(0, 4))) continue;
    if (!/\b(?:la )?vuelta(?: a españa)?\b/i.test(longTitle)) continue;
    if (item?.pubState?.code !== 'ENPUB' || duration < 60 * 60_000) continue;
    if (url.protocol !== 'https:' || url.hostname !== 'www.rtve.es'
      || !url.pathname.startsWith('/play/videos/vuelta-ciclista-a-espana/')) continue;
    const stageNumber = Number(stageMatch[1]);
    events.push({
      source: 'rtve', externalEventId: `vuelta-replay-${item.id}`,
      dateKey, title: `La Vuelta ${year} Etapa ${stageNumber}`, subtitle: longTitle,
      stageNumber, sourceUrl: RTVE_VUELTA_VIDEOS_URL, broadcastUrl: url.href,
      channel: 'RTVE', country: 'ES', reviveCapable: true,
      finalizeReplay: true,
    });
  }
  return events;
}

export function parseRtveGuide(html, { channel: channelOption = null, referenceDate = dateKeyInZone() } = {}) {
  const events = [];
  const blocks = [...html.matchAll(/<li\b[^>]*class="[^"]*\belem_[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const block of blocks) {
      const item = block[1];
      const timeRange = item.match(/class="horemi"[^>]*>(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
      if (!timeRange) continue;
      const dateLabel = classText(item, 'datemi');
      const explicitDate = parseSpanishDate(dateLabel);
      const offset = fold(dateLabel) === 'manana' ? 1 : fold(dateLabel) === 'hoy' ? 0 : null;
      const dateKey = explicitDate || (offset == null ? null : addDays(referenceDate, offset));
      const channel = channelOption || rtveChannel(classText(item, 'cademi'));
      if (!channel || !dateKey) continue;
      const strong = item.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || '';
      const title = classText(strong, 'maintitle') || stripHtml(strong);
      const description = stripHtml(item.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
      if (!CYCLING_RE.test(`${title} ${description}`)) continue;
      const link = item.match(/href="([^"]+)"/i)?.[1] || 'https://www.rtve.es/play/';
      const programId = item.match(/data-idprogram="([^"]+)"/i)?.[1] || 'sin-programa';
      const stageNumber = parseStageNumber(`${title} ${description}`);
      const stableKey = `${channel}|${dateKey}|${programId}|${stageNumber ?? fold(title)}`;
      events.push({
        source: 'rtve',
        externalEventId: contentHash(stableKey).slice(0, 32),
        dateKey,
        title,
        subtitle: description,
        sourceChannel: channel,
        channel: 'RTVE',
        country: 'ES',
        sourceUrl: new URL(link, 'https://www.rtve.es').href,
        broadcastUrl: channel === 'Teledeporte'
          ? 'https://www.rtve.es/play/teledeporte/ciclismo/'
          : new URL(link, 'https://www.rtve.es').href,
        startTimeUtc: zonedTimeToUtc(dateKey, timeRange[1]),
        endTimeUtc: zonedTimeToUtc(dateKey, timeRange[2]),
        stageNumber,
      });
  }
  events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  const firstByEvent = new Map();
  for (const event of events) {
    if (!firstByEvent.has(event.externalEventId)) firstByEvent.set(event.externalEventId, event);
  }
  return [...firstByEvent.values()];
}

export function normalizedObservation(event) {
  const start = event.startTimeUtc == null ? null : new Date(event.startTimeUtc);
  start?.setUTCSeconds(0, 0);
  const normalized = {
    source: event.source,
    ...(event.source === 'rai' ? { mediaKind: event.mediaKind, durationSeconds: event.durationSeconds, explicitDelayed: event.explicitDelayed === true } : {}),
    externalEventId: event.externalEventId,
    dateKey: event.dateKey,
    title: event.title,
    subtitle: event.subtitle || null,
    stageNumber: event.stageNumber ?? null,
    startTimeUtc: start?.toISOString() || null,
    broadcastUrl: event.broadcastUrl,
    sourceUrl: event.sourceUrl,
    sourceChannel: event.sourceChannel || null,
    channel: event.channel || null,
    country: event.country || null,
    note: event.note || null,
    reviveCapable: event.reviveCapable === true,
    finalizeReplay: event.finalizeReplay === true,
    hasMontonera: event.source === 'hbo_max' ? event.hasMontonera === true : null,
    writeEligible: event.writeEligible !== false,
    insertSortOrder: event.insertSortOrder ?? null,
  };
  return { ...normalized, sourceHash: contentHash(normalized) };
}

function championshipKind(day) {
  return matchingForm(`${day.nameEn || ''} ${day.name || ''}`).match(/\b(world|european) championships?\b/)?.[1] || null;
}

// HBO Max rotula a veces una prueba de un campeonato solo con la sede
// («LJUBLJANA», subtítulo «Men»). La sede se acredita si es salida o llegada de
// alguna prueba de ese campeonato el mismo día; el género decide la prueba.
function venueChampionshipKinds(observation, raceDays) {
  const title = matchingForm(observation.title);
  if (!title) return new Set();
  return new Set(raceDays.filter((day) => day.dateKey === observation.dateKey && championshipKind(day)
    && [day.startLocation, day.finishLocation].some((place) => place && matchingForm(place) === title))
    .map(championshipKind));
}

export function matchObservation(observation, raceDays) {
  let sourceText = matchingForm(`${observation.title} ${observation.subtitle || ''}`);
  if (observation.source === 'rai') sourceText = sourceText.replace(/\b(?:g p|gran premio)\b/g, 'grand prix').replace(/\be\b/g, 'and');
  if (observation.source === 'rtve') {
    sourceText = sourceText.replace(/\bcarretera\s+prueba\b/g, 'linea');
    // RTVE Play titula «Campeonato del Mundo en carretera» y detalla solo la
    // categoría: sin contrarreloj ni relevo, es la prueba en línea.
    if (/\bcarretera\b/.test(sourceText) && !/\b(?:cri|cre|relevo)\b/.test(sourceText)) {
      sourceText = sourceText.replace(/\bcarretera\b/, 'carretera linea');
    }
  }
  if (observation.source === 'eitb') sourceText = basqueRaceForm(sourceText);
  if (observation.source === 'lequipe' || observation.source === 'rtbf') sourceText = frenchRaceForm(sourceText);
  if (observation.source === 'rai') sourceText = italianRaceForm(sourceText);
  if (observation.source === 'rai' || observation.source === 'rtbf') sourceText = implicitChampionshipForm(sourceText);
  // HBO Max omite «Elite» en las contrarrelojes («Women | Šenčur (ITT, 22.1 km)»).
  // Con disciplina declarada y sin categoría, la prueba es la élite; sin
  // disciplina, el rótulo no identifica la prueba y no se completa.
  if (observation.source === 'hbo_max' && /\b(?:itt|ttt|relay|road race)\b/.test(sourceText)) {
    sourceText = implicitChampionshipForm(sourceText);
  }
  if (observation.source === 'sporza') sourceText = sourceText.replace(/\bparijs\b/g, 'paris');
  const sourceLevel = raceLevel(sourceText);
  const canonicalSource = canonicalGenderWords(sourceText);
  const sourceWords = new Set(canonicalSource.split(' '));
  const venueKinds = venueChampionshipKinds(observation, raceDays);
  const candidates = raceDays.filter((day) => day.dateKey === observation.dateKey).map((day) => {
    const aliases = aliasesForRace(day, observation.source);
    if (venueKinds.has(championshipKind(day))) aliases.push(matchingForm(observation.title));
    if (observation.source === 'rai' && observation.stageNumber == null && day.stageNumber != null) {
      return { day, score: 0, aliases: [] };
    }
    const aliasScores = aliases.map((alias) => {
      if (!alias) return { alias, score: 0 };
      const canonicalAlias = canonicalGenderWords(alias);
      if (canonicalSource.includes(canonicalAlias)) return { alias, score: 100 + Math.min(canonicalAlias.length, 30) };
      const words = significant(canonicalAlias);
      const score = words.length >= 2 && words.every((word) => sourceWords.has(word)) ? 80 + words.length : 0;
      return { alias, score };
    });
    let score = Math.max(0, ...aliasScores.map((item) => item.score));
    if (observation.stageNumber != null) {
      if (Number(day.stageNumber) === observation.stageNumber) score += 40;
      else score = 0;
    }
    const dayLevel = raceLevel(matchingForm(`${day.name || ''} ${day.nameEn || ''}`));
    if (sourceLevel && sourceLevel !== dayLevel) score = 0;
    if (!sourceLevel && dayLevel) score -= 20;
    const sourceFemale = /\b(women|female|femenin[ao]|femmes|dames|femminile|donne)\b/.test(sourceText);
    const sourceMale = /\b(men|male|masculin[oa]|maschile|uomini|mannen)\b/.test(sourceText);
    if (sourceFemale && day.gender !== 'female') score = 0;
    if (sourceMale && day.gender === 'female') score = 0;
    if (!sourceFemale && day.gender === 'female' && !aliases.some((alias) => /women|fem|dames/.test(alias))) score -= 20;
    return { day, score, aliases: aliasScores.filter((item) => item.score > 0).map((item) => item.alias) };
  }).filter((candidate) => candidate.score >= MIN_WORD_MATCH_SCORE).sort((a, b) => b.score - a.score);

  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return { status: 'ambiguous', candidates: candidates.map(({ day, score }) => ({ raceDayId: day.raceDayId, score })) };
  }
  if (!candidates.length) return { status: 'unmatched', candidates: [] };
  if (candidates[1] && candidates[0].score - candidates[1].score < 20) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 3).map(({ day, score }) => ({ raceDayId: day.raceDayId, score })) };
  }
  const winner = candidates[0];
  return {
    status: 'matched',
    raceDayId: winner.day.raceDayId,
    raceId: winner.day.raceId,
    score: winner.score,
    evidence: { dateKey: observation.dateKey, stageNumber: observation.stageNumber, aliases: winner.aliases },
  };
}

export function desiredBroadcasts(observation) {
  if (observation.source === 'hbo_max') {
    return [
      { channel: 'Eurosport (HBO Max)', country: 'EUROPA', startTimeUtc: observation.startTimeUtc, url: observation.broadcastUrl, note: observation.hasMontonera ? 'La Montonera al terminar.' : null, showInRevive: true, hasMontonera: observation.hasMontonera === true, insertSortOrder: -20 },
      { channel: 'TNT Sports (HBO Max)', country: 'UK_IE', startTimeUtc: observation.startTimeUtc, url: 'https://www.hbomax.com/gb/en/sports/cycling', note: null, showInRevive: true, hasMontonera: false, insertSortOrder: -10 },
    ];
  }
  return [{
    channel: observation.channel, country: observation.country || 'ES', startTimeUtc: observation.startTimeUtc,
    url: observation.broadcastUrl, note: observation.note || null,
    showInRevive: observation.reviveCapable === true,
    insertSortOrder: observation.insertSortOrder ?? -30,
  }];
}

export function newBroadcastRow(raceDayId, desired) {
  return {
    id: randomUUID(), raceDayId, channel: desired.channel, country: desired.country,
    startTimeUtc: desired.startTimeUtc, url: desired.url, note: desired.note || null,
    sortOrder: desired.insertSortOrder, showInRevive: desired.showInRevive === true, translations: {},
  };
}
