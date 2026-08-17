// ─────────────────────────────────────────────────────────────────
//  SHARED — funciones y constantes compartidas entre módulos
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { t, getLang, getLocale } from './i18n.js';
import { extractYouTubeId } from './broadcast-embed.js';
export { extractYouTubeId };

// ── Supabase singleton ───────────────────────────────────────────
// SUPABASE_URL y SUPABASE_ANON_KEY son globals definidos en js/config.js
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { supabase };

// ── Caché de documentos de races ─────────────────────────────────
const _raceCache = new Map();
const _technicalGuideCache = new Map();

export function setCachedRace(id, data) { _raceCache.set(id, data); }

export function bulkCacheRaces(raceMap) {
  for (const [id, data] of Object.entries(raceMap)) {
    _raceCache.set(id, data);
  }
}

// La guía técnica pertenece a toda la competición. `assets` conserva la FK a
// una jornada por compatibilidad, pero se reutiliza en cada etapa sin duplicar
// filas ni ficheros.
export async function loadRaceTechnicalGuide(raceId) {
  if (!raceId) return null;
  if (_technicalGuideCache.has(raceId)) return _technicalGuideCache.get(raceId);
  const pending = (async () => {
    const { data: days, error: daysError } = await supabase
      .from('race_days').select('id,dateKey').eq('raceId', raceId).order('dateKey');
    if (daysError || !days?.length) return null;
    const order = new Map(days.map((day, index) => [day.id, index]));
    const { data: guides, error } = await supabase
      .from('assets').select('*').in('raceDayId', days.map(day => day.id)).eq('type', 'technicalGuide');
    if (error || !guides?.length) return null;
    return [...guides].sort((a, b) => (order.get(a.raceDayId) ?? Infinity) - (order.get(b.raceDayId) ?? Infinity))[0];
  })();
  _technicalGuideCache.set(raceId, pending);
  return pending;
}

export function withRaceTechnicalGuide(assets = [], technicalGuide = null) {
  const withoutGuide = assets.filter(asset => asset.type !== 'technicalGuide');
  return technicalGuide ? [technicalGuide, ...withoutGuide] : withoutGuide;
}

// ── Constantes ───────────────────────────────────────────────────
export const UCI_ORDER = {
  'WC': 1, 'CC': 2,
  '1.UWT': 3, '2.UWT': 4,
  'CN': 4.5,
  '1.WWT': 5, '2.WWT': 6,
  '1.Pro': 7, '2.Pro': 8,
  '1.1': 9,  '2.1': 10,
  '1.2': 11, '2.2': 12, '1.2U': 13, '2.2U': 14,
};

// TYPE_LABELS: proxy que devuelve la etiqueta en el idioma activo
export const TYPE_LABELS = new Proxy({}, {
  get(_, key) { return t(`types.${key}`) || key; },
});

// ── Helpers de fecha ─────────────────────────────────────────────
export function toDateKey(date) {
  return date.toLocaleDateString('sv-SE');
}

export function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDateLabelShort(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ── Fechas SEO sin ICU (blindadas contra Googlebot) ──────────────
// El Chrome headless de Googlebot arrastra ICU sin datos de locale completos,
// así que `toLocaleDateString('es-ES', …)` cae a inglés en su render. Para las
// fechas que se embeben en <title>/description/og:* de páginas pre-renderizadas
// (jornada, competición, inscritos) NO se puede usar toLocaleDateString: hay que
// construir el string a mano desde tablas fijas. Así el snippet de Google sale
// siempre en el idioma correcto. Ver docs/memory/seo-og-pages.md.
const _SEO_MONTHS = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const _SEO_WEEKDAYS = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

function _seoLang() { return getLang() === 'en' ? 'en' : 'es'; }

// dateKey "YYYY-MM-DD" → {y, mIdx, d, dow} en hora local mediodía (sin saltos de TZ).
function _seoParts(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return { y, mIdx: m - 1, d, dow };
}

// "lunes, 1 de junio de 2026" / "Monday, 1 June 2026"  (weekday + día + mes + año)
export function seoLongDateWeekday(dateKey, lang = _seoLang()) {
  const { y, mIdx, d, dow } = _seoParts(dateKey);
  const wd = _SEO_WEEKDAYS[lang][dow];
  const mo = _SEO_MONTHS[lang][mIdx];
  return lang === 'en' ? `${wd}, ${d} ${mo} ${y}` : `${wd}, ${d} de ${mo} de ${y}`;
}

// "1 de junio de 2026" / "1 June 2026"  (día + mes + año, sin weekday)
export function seoLongDate(dateKey, lang = _seoLang()) {
  const { y, mIdx, d } = _seoParts(dateKey);
  const mo = _SEO_MONTHS[lang][mIdx];
  return lang === 'en' ? `${d} ${mo} ${y}` : `${d} de ${mo} de ${y}`;
}

// "1 de junio" / "1 June"  (día + mes, sin año)
export function seoDayMonth(dateKey, lang = _seoLang()) {
  const { mIdx, d } = _seoParts(dateKey);
  const mo = _SEO_MONTHS[lang][mIdx];
  return lang === 'en' ? `${d} ${mo}` : `${d} de ${mo}`;
}

// Artículo para el nombre de una carrera: «el Tour…» / «la Vuelta…».
// Femenino por defecto (la mayoría de clásicas); masculinos por primera palabra.
// Paridad: articulo_nombre() en .github/workflows/og-pages.yml.
export function articuloNombre(name) {
  const norm = (name || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const firstWord = norm.split(/\s+/)[0] || '';
  const masculinos = [
    'tour', 'giro', 'gran', 'grande', 'campeonato', 'criterium',
    'circuito', 'circuit', 'grand', 'trofeo', 'trophee',
    'memorial', 'premio', 'prix', 'open', 'paris', 'eschborn', 'o', 'gp'
  ];
  if (masculinos.includes(firstWord)) return 'el';
  // «X Tour» (UAE Tour, Renewi Tour, Alpes Isère Tour…): masculino aunque
  // la palabra clave no vaya primera.
  if (/\btour\b/.test(norm)) return 'el';
  return 'la';
}

// ── Helpers de hora ──────────────────────────────────────────────
// Convierte segundos Unix o ISO string a un objeto {seconds, toDate}
// para compatibilidad con el código que usa .seconds y .toDate()
export function tsSeconds(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') return new Date(ts).getTime() / 1000;
  if (typeof ts === 'number') return ts;
  if (ts.seconds !== undefined) return ts.seconds;
  if (ts.toDate) return ts.toDate().getTime() / 1000;
  return null;
}

export function formatTime(ts) {
  if (!ts) return null;
  const d = typeof ts === 'string' ? new Date(ts) : (ts.toDate ? ts.toDate() : new Date(ts));
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

// Alias semántico: hora Madrid para uso interno/admin/feeds
export const formatTimeMadrid = formatTime;

export function formatTimeUser(ts) {
  if (!ts) return null;
  const d = typeof ts === 'string' ? new Date(ts) : (ts.toDate ? ts.toDate() : new Date(ts));
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const madridStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const madridOffset = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getTime();
  const userOffset   = new Date(d.toLocaleString('en-US', { timeZone: userTZ })).getTime();
  if (Math.round((userOffset - madridOffset) / 60000) === 0) return { display: madridStr, tooltip: null };
  const localStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: userTZ });
  return { display: localStr, tooltip: madridStr };
}

// Horario apilado para las race cards (paridad iOS): salida arriba, flecha ↓,
// meta abajo (en negrita). Si solo hay una de las dos, se muestra esa sola.
// `start`/`finish` son los strings ya formateados (display); `timeTip` el tooltip
// de zona horaria (o null). Devuelve '' si no hay ninguna hora.
export function buildTimeStack(start, finish, timeTip) {
  if (!start && !finish) return '';
  const open = `<span class="race-card__time-stack${timeTip ? ' badge--time-user' : ''}"${timeTip ? ` data-tztip="${timeTip}"` : ''}>`;
  if (start && finish) {
    return open
      + `<span class="race-card__time-start">${start}</span>`
      + `<span class="race-card__time-arrow" aria-hidden="true">↓</span>`
      + `<span class="race-card__time-finish">${finish}</span>`
      + `</span>`;
  }
  return open + `<span class="race-card__time-finish">${start || finish}</span></span>`;
}

// Etiquetas de salida/meta de una jornada: en CRI/CRE ("salida neutralizada"/
// "llegada prevista" no tienen sentido — cada corredor/equipo sale y llega en
// un momento distinto) se sustituyen por "salida 1º corredor/equipo" y
// "meta último corredor/equipo". `rd` necesita `primaryType`; `race` (opcional)
// aporta el género para la variante femenina de corredor.
export function startFinishLabels(rd, race) {
  const isITT = rd.primaryType === 'itt';
  const isTTT = rd.primaryType === 'ttt';
  const fem   = race?.gender === 'female';
  const startLabel  = isITT ? (fem ? t('stage.startFirstRiderF') : t('stage.startFirstRider'))
                     : isTTT ? t('stage.startFirstTeam')
                     : t('stage.neutralStart');
  const finishLabel = isITT ? (fem ? t('stage.finishLastRiderF') : t('stage.finishLastRider'))
                     : isTTT ? t('stage.finishLastTeam')
                     : t('stage.estimatedFinish');
  return { startLabel, finishLabel };
}

// Devuelve la zona horaria del usuario como offset legible, p.ej. "GMT+2" o "GMT-5"
export function getUserTimezoneLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absH = Math.floor(Math.abs(offsetMin) / 60);
  const absM = Math.abs(offsetMin) % 60;
  const offset = absM === 0 ? `GMT${sign}${absH}` : `GMT${sign}${absH}:${String(absM).padStart(2, '0')}`;
  return offset;
}

// ── Orden y ranking UCI ──────────────────────────────────────────
export function stageLabel(n, suffix, isFinal = false) {
  const finalStr = isFinal ? ' (Final)' : '';
  if (n === 0 || n === '0') return t('stage.prologue') + (suffix ? ` ${suffix}` : '') + finalStr;
  return n ? `${t('stage.stage')} ${n}${suffix || ''}${finalStr}` : '';
}

export function uciRank(cat, name, country) {
  if (/giro de italia/i.test(name || '')) return 0.1;
  if (/tour de francia/i.test(name || '')) return 0.2;
  if (/la vuelta/i.test(name || '')) return 0.3;
  if ((cat === '1.2U' || cat === '2.2U') && /tour del porvenir/i.test(name || '')) return 8.5;
  if (cat === 'CC' && !/europa|europe/i.test(name || '')) return 14.5;
  if (['1.Pro','2.Pro','1.1','2.1'].includes(cat) && /^(CN|TH|JP|TW|KR|HK)$/i.test(country || '') && !/japan cup/i.test(name || '')) return 10.5;
  return UCI_ORDER[cat] ?? 99;
}

export function proLevel(cat, name, country) {
  if (/giro de italia/i.test(name || '')) return 0.1;
  if (/tour de francia/i.test(name || '')) return 0.2;
  if (/la vuelta/i.test(name || '')) return 0.3;
  if (['1.Pro','2.Pro','1.1','2.1'].includes(cat) && /^(CN|TH|JP|TW|KR|HK|AZ)$/i.test(country || '') && !/japan cup/i.test(name || '')) return 10.5;
  const MAP = {'WC':1,'CC':2,'1.UWT':3,'2.UWT':4,'1.WWT':5,'2.WWT':6,
               '1.Pro':7,'2.Pro':8,'1.1':9,'2.1':10,'1.2':11,'2.2':12,'1.2U':13,'2.2U':14};
  return MAP[cat] ?? 99;
}

export function genderRank(g) { return g === 'female' ? 2 : 1; }
export function grandTourRank(race) { return race?.isGrandTour ? 0 : 1; }

// ── Bandera desde código ISO ─────────────────────────────────────
export function countryFlag(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  return `<img src="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${c}.svg" alt="${c}" style="width:1.2em;height:0.9em;object-fit:cover;border-radius:2px;vertical-align:-0.05em;display:inline-block">`;
}

// ── País efectivo (override de jornada > carrera) ────────────────
// Override puramente cosmético: solo afecta a la bandera mostrada,
// nunca a los filtros de país de las distintas vistas.
export function effectiveCountryCode(rd, race) {
  return (rd && rd.countryCode) || (race && race.countryCode) || null;
}

// ── Grupo regional del usuario (por zona horaria) ─────────────────
// Devuelve { group, isEuropean }:
//   - group: el grupo de broadcasts.country que aplica al usuario
//     (ES, PT, FR, BE, NL, IT, DE_AT_CH, UK_IE, SCANDI, EE,
//      LATAM, NORTEAM, ASIAPAC, AFRICA, MENA) o null si no detectable.
//   - isEuropean: true si el usuario está en Europa (cubierto o no por un
//     grupo fino). Determina si ve también EUROPA (pan-europeo).
const _COUNTRY_TZ_MAP = new Map([
  // Europa cubierta por grupo fino
  ['Europe/Madrid', 'ES'], ['Atlantic/Canary', 'ES'], ['Africa/Ceuta', 'ES'],
  ['Europe/Lisbon', 'PT'], ['Atlantic/Azores', 'PT'], ['Atlantic/Madeira', 'PT'],
  ['Europe/Paris', 'FR'], ['Europe/Monaco', 'FR'],
  ['Europe/Brussels', 'BE'],
  ['Europe/Amsterdam', 'NL'],
  ['Europe/Rome', 'IT'], ['Europe/Vatican', 'IT'], ['Europe/San_Marino', 'IT'], ['Europe/Malta', 'IT'],
  ['Europe/Berlin', 'DE_AT_CH'], ['Europe/Busingen', 'DE_AT_CH'],
  ['Europe/Vienna', 'DE_AT_CH'],
  ['Europe/Zurich', 'DE_AT_CH'], ['Europe/Vaduz', 'DE_AT_CH'],
  ['Europe/London', 'UK_IE'], ['Europe/Belfast', 'UK_IE'], ['Europe/Guernsey', 'UK_IE'],
  ['Europe/Jersey', 'UK_IE'], ['Europe/Isle_of_Man', 'UK_IE'], ['Europe/Gibraltar', 'UK_IE'],
  ['Europe/Dublin', 'UK_IE'],
  ['Europe/Copenhagen', 'SCANDI'], ['Atlantic/Faroe', 'SCANDI'],
  ['Europe/Oslo', 'SCANDI'], ['Arctic/Longyearbyen', 'SCANDI'],
  ['Europe/Stockholm', 'SCANDI'],
  ['Europe/Helsinki', 'SCANDI'], ['Europe/Mariehamn', 'SCANDI'],
  ['Atlantic/Reykjavik', 'SCANDI'],
  ['Europe/Warsaw', 'EE'], ['Europe/Prague', 'EE'], ['Europe/Bratislava', 'EE'],
  ['Europe/Ljubljana', 'EE'], ['Europe/Zagreb', 'EE'], ['Europe/Budapest', 'EE'],
  ['Europe/Bucharest', 'EE'], ['Europe/Sofia', 'EE'], ['Europe/Tallinn', 'EE'],
  ['Europe/Riga', 'EE'], ['Europe/Vilnius', 'EE'], ['Europe/Belgrade', 'EE'],
  ['Europe/Sarajevo', 'EE'], ['Europe/Skopje', 'EE'], ['Europe/Podgorica', 'EE'],
  ['Europe/Tirane', 'EE'], ['Europe/Chisinau', 'EE'], ['Europe/Kiev', 'EE'],
  ['Europe/Kyiv', 'EE'], ['Europe/Uzhgorod', 'EE'], ['Europe/Zaporozhye', 'EE'],
  ['Europe/Simferopol', 'EE'], ['Europe/Minsk', 'EE'],
  ['Europe/Athens', 'EE'], ['Asia/Nicosia', 'EE'], ['Europe/Nicosia', 'EE'],
  ['Europe/Istanbul', 'EE'], ['Asia/Istanbul', 'EE'], ['Turkey', 'EE'],
]);

// Mapeo a grupos extracontinentales por prefijo de TZ (más fiable que listar
// todos los TZ de la zona).
function _extracontinentalGroup(tz) {
  // América del Norte
  if (tz === 'America/New_York' || tz === 'America/Chicago' || tz === 'America/Denver'
      || tz === 'America/Los_Angeles' || tz === 'America/Phoenix' || tz === 'America/Anchorage'
      || tz === 'America/Adak' || tz === 'America/Toronto' || tz === 'America/Vancouver'
      || tz === 'America/Edmonton' || tz === 'America/Winnipeg' || tz === 'America/Halifax'
      || tz === 'America/St_Johns' || tz === 'America/Detroit' || tz === 'America/Indianapolis'
      || tz === 'America/Boise' || tz === 'America/Juneau' || tz === 'Pacific/Honolulu'
      || tz === 'America/Regina') return 'NORTEAM';
  // América Latina (todo el resto de America/*)
  if (tz.startsWith('America/')) return 'LATAM';
  // MENA: Norte de África + Oriente Medio
  if (tz === 'Africa/Cairo' || tz === 'Africa/Algiers' || tz === 'Africa/Tunis'
      || tz === 'Africa/Casablanca' || tz === 'Africa/El_Aaiun' || tz === 'Africa/Tripoli'
      || tz === 'Africa/Khartoum' || tz === 'Asia/Riyadh' || tz === 'Asia/Dubai'
      || tz === 'Asia/Qatar' || tz === 'Asia/Kuwait' || tz === 'Asia/Bahrain'
      || tz === 'Asia/Muscat' || tz === 'Asia/Baghdad' || tz === 'Asia/Tehran'
      || tz === 'Asia/Jerusalem' || tz === 'Asia/Tel_Aviv' || tz === 'Asia/Beirut'
      || tz === 'Asia/Damascus' || tz === 'Asia/Amman' || tz === 'Asia/Aden'
      || tz === 'Asia/Hebron' || tz === 'Asia/Gaza') return 'MENA';
  // África subsahariana (resto de Africa/*)
  if (tz.startsWith('Africa/')) return 'AFRICA';
  // Asia / Pacífico
  if (tz.startsWith('Asia/') || tz.startsWith('Pacific/') || tz.startsWith('Australia/')
      || tz === 'Indian/Christmas' || tz === 'Indian/Cocos') return 'ASIAPAC';
  return null;
}

const _EUROPE_EXTRA = new Set(['Atlantic/Azores', 'Atlantic/Madeira', 'Atlantic/Faroe',
  'Arctic/Longyearbyen', 'Atlantic/Canary', 'Africa/Ceuta', 'Atlantic/Reykjavik']);

function _detectUserGroup() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  // Europa cubierta por grupo fino
  const fine = _COUNTRY_TZ_MAP.get(tz);
  if (fine) return { group: fine, isEuropean: true };
  // Europa no cubierta (pan-europeo)
  if (tz.startsWith('Europe/') || _EUROPE_EXTRA.has(tz)) {
    return { group: null, isEuropean: true };
  }
  // Fuera de Europa
  return { group: _extracontinentalGroup(tz), isEuropean: false };
}
const { group: _userCountryGroup, isEuropean: _userIsEuropean } = _detectUserGroup();

// Filtra broadcasts según el país del usuario.
// Reglas:
//   Usuario europeo (cualquier país, cubierto o no):
//     → ALL + EUROPA + (su grupo si está cubierto)
//   Usuario fuera de Europa:
//     → ALL + (su grupo si está cubierto)
//   broadcasts sin `country` se consideran globales (compatibilidad).
//
// Excepción `EUROPA` ↔ `UK_IE`: la marca paneuropea (Eurosport / HBO Max)
// no opera en Reino Unido ni Irlanda, donde su lugar lo ocupa TNT Sports
// (que ya pertenece al grupo `UK_IE`). Por eso, a los usuarios de `UK_IE`
// no se les muestran los broadcasts marcados como `EUROPA`.
export function filterBroadcastsByRegion(broadcasts) {
  if (!broadcasts || !broadcasts.length) return broadcasts;
  return broadcasts.filter(b => {
    if (!b.country || b.country === 'ALL') return true;
    if (b.country === 'EUROPA') return _userIsEuropean && _userCountryGroup !== 'UK_IE';
    if (_userCountryGroup && b.country === _userCountryGroup) return true;
    return false;
  });
}

// ── Tipo de etapa ────────────────────────────────────────────────
export function typeLabel(t) { return TYPE_LABELS[t] || t || ''; }

export function typeBadge(type) {
  const MAP = {
    flat: 'flat', cobbles: 'cobbles',
    rolling: 'rolling',
    cotas: 'cotas',
    medium_mountain: 'medium',
    high_mountain: 'high', summit_finish: 'high', uphill_finish: 'uphill',
    itt: 'chrono', ttt: 'chrono', chrono_climb: 'chrono',
    sterrato: 'sterra', ribinou: 'sterra',
  };
  const cls = MAP[type];
  if (!cls) return '';
  return `<span class="badge badge--type-${cls}">${typeLabel(type)}</span>`;
}

export function resolveTypeBadges(primary, secondary, countryCode) {
  if (primary === 'sterrato' && countryCode?.toUpperCase() === 'FR') {
    return typeBadge('ribinou');
  }
  if (primary === 'flat' && secondary === 'summit_finish') {
    return `<span class="badge badge--type-high">${typeLabel('monopuerto')}</span>`;
  }
  if (primary === 'itt' && (secondary === 'chrono_climb' || secondary === 'summit_finish')) {
    return typeBadge('chrono_climb');
  }
  return typeBadge(primary) + (secondary ? ' ' + typeBadge(secondary) : '');
}

// ── Badge de categoría UCI (color por tier) ──────────────────────
export function categoryBadge(uci, isFemale) {
  const WT  = ['1.UWT','2.UWT','1.WWT','2.WWT'];
  const PRO = ['1.Pro','2.Pro','1.1','2.1'];
  const WC  = ['WC','CC'];
  const MINOR = ['1.2','2.2','1.2U','2.2U'];
  const cls = WC.includes(uci)    ? 'wc'
            : WT.includes(uci)    ? 'wt'
            : PRO.includes(uci)   ? 'pro'
            : MINOR.includes(uci) ? '2'
            : uci                 ? '1'
            : null;
  const uciBadge  = cls ? `<span class="badge badge--${cls}">${uci}</span>` : '';
  const genBadge  = isFemale ? `<span class="badge badge--female" title="Femenino"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><line x1="12" y1="13" x2="12" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/></svg></span>` : '';
  return uciBadge + genBadge;
}

// ── Nombre de carrera según idioma ──────────────────────────────
export function raceName(race) {
  if (!race) return '';
  if (getLang() === 'en' && race.nameEn) return race.nameEn;
  return race.name || '';
}

// ── Localidad de salida/llegada según idioma ─────────────────────
// field: 'startLocation' | 'finishLocation'
export function rdLocation(rd, field) {
  if (!rd) return '';
  const enField = field + 'En';
  if (getLang() === 'en' && rd[enField]) return rd[enField];
  return rd[field] || '';
}

// ── URL helpers ──────────────────────────────────────────────────

// Prefijo de ruta para páginas EN: '/en' (calendariociclismo.app/en/). Si CONFIG.enDomain
// vuelve a tener un dominio EN dedicado y coincide con el hostname, devuelve '' (raíz = en/).
// Usa CONFIG.enDomain > window.EN_DOMAIN para máxima compatibilidad con ES modules
export function enBase() {
  const enDomain = (typeof CONFIG !== 'undefined' && CONFIG.enDomain)
    || (typeof window !== 'undefined' && window.EN_DOMAIN)
    || null;
  return (enDomain && window.location.hostname === enDomain) ? '' : '/en';
}
function _enBase() { return enBase(); }

export function jornadaUrl(rd, extra = {}) {
  if (getLang() === 'en') {
    const base = _enBase();
    if (rd.slugEn) return `${base}/stage/${encodeURIComponent(rd.slugEn)}/`;
    const qs = new URLSearchParams({ id: rd.id });
    Object.entries(extra).forEach(([k, v]) => { if (v) qs.set(k, v); });
    // Con dominio EN dedicado el SPA de stage vive en /stage/ (base==''); en /en/ usamos jornada.html?lang=en
    if (base === '') return `/stage/?${qs.toString()}`;
    qs.set('lang', 'en');
    return `/jornada.html?${qs.toString()}`;
  }
  if (rd.slug) return `/jornada/${encodeURIComponent(rd.slug)}/`;
  const qs = new URLSearchParams({ id: rd.id });
  Object.entries(extra).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return `/jornada.html?${qs.toString()}`;
}

export function raceUrl(race, extra = {}) {
  if (getLang() === 'en') {
    const base = _enBase();
    const s = race.slugEn || race.slug;
    if (s) return `${base}/race/${encodeURIComponent(s)}/`;
    const qs = new URLSearchParams({ id: race.id });
    Object.entries(extra).forEach(([k, v]) => { if (v) qs.set(k, v); });
    return `${base}/race/?${qs.toString()}`;
  }
  if (race.slug) return `/competicion/${encodeURIComponent(race.slug)}/`;
  const qs = new URLSearchParams({ id: race.id });
  Object.entries(extra).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return `/competicion.html?${qs.toString()}`;
}

export function startlistUrl(race) {
  if (getLang() === 'en') {
    const base = enBase();
    const s = race.slugEn || race.slug;
    if (s) return `${base}/startlist/${encodeURIComponent(s)}/`;
    return `${base}/startlist/?race=${race.id}`;
  }
  if (race.slug) return `${CONFIG.basePath}/inscritos/${encodeURIComponent(race.slug)}/`;
  return `${CONFIG.basePath}/inscritos.html?race=${race.id}`;
}

// Edad en años a partir de una fecha de nacimiento ('YYYY-MM-DD' o Date).
// Devuelve null si no hay fecha válida — el llamador decide omitir la edad
// (nunca inventarla). Cálculo por fecha de calendario, no por días/365.
export function riderAge(birthDate, ref = new Date()) {
  if (!birthDate) return null;
  const b = (birthDate instanceof Date) ? birthDate : new Date(birthDate + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  return (age >= 0 && age < 130) ? age : null;
}

// Las fichas públicas de corredor (/corredor/) y de equipo (/equipo/) se
// retiraron. Estas funciones se conservan SOLO como stubs que devuelven null
// para que los call-sites (inscritos, resultados, orden-salida) sigan siendo
// null-safe y muestren nombre/equipo como texto plano, sin enlace.
export function teamLinkUrl(_team) { return null; }
export function riderLinkUrl(_riderId, _team) { return null; }

// Equipo ficticio "Individual" de una startlist: lo siembra resolve_uci_startlist
// (migración 084) para los corredores cuya fila de resultados UCI no trae equipo
// (típicamente DNF que lo pierden en la GC). teamId NULL + nombre 'Individual'.
// La web/apps lo OCULTAN cosméticamente: sus corredores se muestran, pero sin
// cabecera de equipo en inscritos y sin equipo/chapa/filtro en resultados.
export function isIndividualPlaceholderTeam(slTeam) {
  return !!slTeam && !slTeam.teamId
    && String(slTeam.teamName || '').trim().toLowerCase() === 'individual';
}

// Fecha de nacimiento localizada en formato numérico corto (DD/MM/YYYY según
// locale). Devuelve '' si no hay fecha válida. Se combina con riderAge() para
// mostrar "DD/MM/YYYY (edad)".
export function formatBirthDate(birthDate) {
  if (!birthDate) return '';
  const d = (birthDate instanceof Date) ? birthDate : new Date(birthDate + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function startlistOrStageUrl(rd, race) {
  if (race?.startlistImportedAt) return startlistUrl(race);
  return jornadaUrl(rd);
}

export function startOrderUrl(rd) {
  if (getLang() === 'en') {
    const base = enBase();
    const s = rd?.slugEn || rd?.slug;
    if (s) return `${base}/start-order/${encodeURIComponent(s)}/`;
    if (rd?.id) return `${base}/start-order/?id=${rd.id}`;
    return null;
  }
  if (rd?.slug) return `/orden-salida/${encodeURIComponent(rd.slug)}/`;
  if (rd?.id) return `/orden-salida.html?id=${rd.id}`;
  return null;
}

export function startOrderFullUrl(rd) {
  if (getLang() === 'en') {
    // Con dominio EN dedicado (CONFIG.enDomain) la URL vive en su raíz; sin él,
    // el sitio EN cuelga de /en/ del dominio canónico.
    const enDomain = (typeof CONFIG !== 'undefined' && CONFIG.enDomain) || '';
    const webOrigin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
    const origin = enDomain ? `https://${enDomain}` : webOrigin;
    const prefix = enDomain ? '' : '/en';
    const s = rd?.slugEn || rd?.slug;
    if (s) return `${origin}${prefix}/start-order/${encodeURIComponent(s)}/`;
    if (rd?.id) return `${origin}${prefix}/start-order/?id=${rd.id}`;
    return null;
  }
  const origin = (typeof CONFIG !== 'undefined' && CONFIG.webOrigin) ? CONFIG.webOrigin : 'https://calendariociclismo.app';
  if (rd?.slug) return `${origin}/orden-salida/${encodeURIComponent(rd.slug)}/`;
  if (rd?.id) return `${origin}/orden-salida.html?id=${rd.id}`;
  return null;
}

// ── SEO helpers ──────────────────────────────────────────────────
// Bloqueo de SEO en castellano para páginas EN (decisión de producto 2026-06):
// en las páginas en inglés el SEO que indexa Google y se comparte en redes va
// en CASTELLANO (copiado de la versión ES), aunque el contenido visible y el
// título que ve el usuario en la página sigan en inglés. El HTML estático ya
// trae el SEO en español (og-pages.yml para las páginas con slug + los shells
// de /en/). Aquí impedimos que el SPA lo sobrescriba con inglés al hidratar:
// ignoramos las escrituras de SEO-texto y congelamos document.title cuando la
// página es EN. canonical / hreflang / og:url NO se tocan: deben seguir
// apuntando a la URL EN real (la verdad a nivel de URL es inglesa).
export const SEO_ES_LOCK = getLang() === 'en';

// Campos de SEO-texto (e imagen OG, que lleva el título horneado) que NO deben
// recibir el valor inglés del SPA en páginas EN. og:url / og:image:width/height
// / twitter:card quedan fuera a propósito (URL o constantes, no texto inglés).
const _SEO_LOCKED_META = new Set([
  'description', 'keywords',
  'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt',
  'og:title', 'og:description', 'og:image', 'og:image:alt',
]);

if (SEO_ES_LOCK) {
  // Congela document.title: en EN cualquier asignación del SPA se ignora y se
  // conserva el <title> en castellano del HTML estático. Si el navegador no
  // permite redefinir la propiedad, el guard de setMeta cubre el resto del SEO.
  try {
    const _titleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    if (_titleDesc && _titleDesc.get) {
      Object.defineProperty(document, 'title', {
        configurable: true,
        get() { return _titleDesc.get.call(document); },
        set() { /* EN: conservar el <title> en castellano */ },
      });
    }
  } catch { /* noop */ }
}

export function setMeta(name, content) {
  if (SEO_ES_LOCK && _SEO_LOCKED_META.has(name)) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
  el.content = content;
}

export function setMetaProperty(property, content) {
  if (SEO_ES_LOCK && _SEO_LOCKED_META.has(property)) return;
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el); }
  el.content = content;
}

// JSON-LD: en EN conservamos el bloque estático en castellano y no dejamos que
// el SPA lo reemplace por la versión inglesa. true ⇒ el llamante debe abortar.
export function seoJsonLdLocked() { return SEO_ES_LOCK; }

// Comprueba contra el endpoint público oEmbed si un vídeo de YouTube permite
// embed (iframe). Devuelve true (embeddable), false (embed deshabilitado o
// vídeo eliminado/privado) o null si no se ha podido determinar (red, CORS,
// URL no de YouTube). Render: tratar `null` como "embeddable" para no romper.
export async function checkYouTubeEmbeddable(url) {
  const id = extractYouTubeId(url);
  if (!id) return null;
  const canonical = `https://www.youtube.com/watch?v=${id}`;
  const endpoint  = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
  try {
    const res = await fetch(endpoint);
    if (res.ok) return true;
    // 401 → embed explícitamente deshabilitado por el creador.
    // 404 → vídeo no existe / privado / borrado: tampoco se puede embeber.
    if (res.status === 401 || res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

// ── Escape HTML ──────────────────────────────────────────────────
export function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Accesibilidad ───────────────────────────────────────────────

// Estado de un botón de filtro. La clase pinta; aria-pressed es lo único
// que un lector de pantalla puede anunciar (WCAG 4.1.2).
export function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle('tcat-btn--active', on);
  btn.setAttribute('aria-pressed', String(on));
}

// Región activa compartida: un solo nodo por página, creado a demanda.
// Se vacía antes de escribir para que dos mensajes iguales seguidos
// también se anuncien.
export function announce(msg) {
  if (!msg) return;
  let el = document.getElementById('ccStatus');
  if (!el) {
    el = document.createElement('p');
    el.id = 'ccStatus';
    el.className = 'sr-only';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

// Hace operable con teclado un contenedor que solo reacciona al ratón.
// Las tarjetas son grids con enlaces anidados (badges), así que no pueden
// envolverse en <a>/<button> sin romper el layout ni anidar enlaces: se usa
// el mismo patrón role="button" + Enter/Espacio que ya llevan las filas
// desplegables de resultados (WCAG 2.1.1 y 4.1.2).
export function makeCardActivatable(el, { label, onActivate, role = 'button', href = null } = {}) {
  if (!el || typeof onActivate !== 'function') return;
  el.setAttribute('role', role);
  el.setAttribute('tabindex', '0');
  if (label) el.setAttribute('aria-label', label);
  if (href) el.dataset.href = href;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    // Enter/Espacio dentro de un badge o enlace anidado es cosa suya.
    if (e.target !== el && e.target.closest('a, button')) return;
    e.preventDefault();
    onActivate(e);
  });
}

// El símbolo ♀ solo: un lector lo lee «signo femenino» o lo calla del todo.
// El texto oculto lo dice; el glifo queda decorativo (WCAG 1.1.1 y 1.4.1).
export function femaleMark({ style = '', cls = '' } = {}) {
  const label = getLang() === 'en' ? 'Women' : 'Femenino';
  const attrs = (cls ? ` class="${cls}"` : '') + (style ? ` style="${style}"` : '');
  return ` <span${attrs} aria-hidden="true">♀</span>` +
         `<span class="sr-only">${label}</span>`;
}

// apps-modal.js y cookie-consent.js son scripts clásicos (no módulos) y no
// pueden importar: se les expone el helper por window.
if (typeof window !== 'undefined') {
  window.ccTrapFocus = (...a) => trapFocus(...a);
  window.ccAnnounce  = (...a) => announce(...a);
}

const FOCUSABLE = 'a[href],button:not([disabled]),select:not([disabled]),' +
                  'input:not([disabled]),textarea:not([disabled]),' +
                  '[tabindex]:not([tabindex="-1"])';

// Lleva el foco al diálogo, lo mantiene dentro mientras está abierto y lo
// devuelve al elemento que lo abrió. Devuelve la función de limpieza, que
// hay que llamar al cerrar (WCAG 2.4.3).
export function trapFocus(modal, opts = {}) {
  if (!modal) return () => {};
  const prev = document.activeElement;
  const visible = () => [...modal.querySelectorAll(FOCUSABLE)]
    .filter(el => el.offsetParent !== null || el === document.activeElement);

  const first = opts.initial || visible()[0] || modal;
  if (first === modal && !modal.hasAttribute('tabindex')) {
    modal.setAttribute('tabindex', '-1');
  }
  // El navegador aún no ha pintado el diálogo cuando se abre por JS.
  requestAnimationFrame(() => { try { first.focus(); } catch { /* noop */ } });

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const f = visible();
    if (!f.length) { e.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === a || document.activeElement === modal)) {
      e.preventDefault(); z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault(); a.focus();
    }
  };
  modal.addEventListener('keydown', onKey);

  // El resto de la página deja de ser tabulable mientras el diálogo está
  // abierto, sin recorrer el DOM. El overlay del diálogo queda fuera.
  const overlay = modal.closest('.rd-modal-overlay, .asset-modal-overlay, .sg-overlay') || modal;
  const inerted = [...document.body.children].filter(el => el !== overlay && !el.contains(overlay));
  inerted.forEach(el => { el.inert = true; });

  return () => {
    modal.removeEventListener('keydown', onKey);
    inerted.forEach(el => { el.inert = false; });
    try { prev?.focus?.(); } catch { /* noop */ }
  };
}

// ── Modal móvil para data-ph-tooltip ────────────────────────────
export function openPhBanner(el) {
  const msg     = el.dataset.phMsg || el.dataset.phTooltip || '';
  // flagHtml: HTML del <img> de countryFlag() — se inyecta sin escaping
  const flagHtml = el.dataset.phFlag
    || el.querySelector('.t-race__flag')?.innerHTML?.trim()
    || '';
  const name = el.dataset.phName
    || el.querySelector('.t-race__name')?.textContent?.trim()
    || '';
  const sub  = el.dataset.phSub || [
    el.querySelector('.t-race__dates')?.textContent?.trim(),
    el.querySelector('.t-race__cat')?.textContent?.trim(),
  ].filter(Boolean).join(' · ');

  const barContent = name
    ? `<div class="ph-banner__header-text"><span class="ph-banner__name">${flagHtml ? flagHtml + '\u00a0' : ''}${esc(name)}</span>${sub ? `<div class="ph-banner__sub">${esc(sub)}</div>` : ''}</div>`
    : `<span class="ph-banner__name">${esc(msg)}</span>`;
  const bodyHTML = name ? `<div class="ph-banner__body"><p>${esc(msg)}</p></div>` : '';

  let b = document.getElementById('ph-banner');
  if (!b) { b = document.createElement('div'); b.id = 'ph-banner'; document.body.appendChild(b); }
  b.innerHTML = `<div id="ph-banner-box"><div class="ph-banner__bar">${barContent}<button aria-label="Cerrar">&#215;</button></div>${bodyHTML}</div>`;
  b.style.display = 'flex';
  // Close: botón × o click en el overlay (funciona aunque initPhTooltip no esté activo)
  b.onclick = e => { if (e.target === b || e.target.closest('#ph-banner button')) b.style.display = 'none'; };
}

// ── Tooltip (desktop) / Modal (móvil) para data-ph-tooltip ──────
let _phTooltipWired = false; // guard: en /calendario/ pueden inicializar las dos subvistas
export function initPhTooltip({ skipMobileMes = false } = {}) {
  if (_phTooltipWired) return;
  _phTooltipWired = true;
  const isMobile = () => window.innerWidth < 600;

  // Desktop: tooltip al hover
  document.addEventListener('mouseover', e => {
    if (isMobile()) return;
    const el = e.target.closest('[data-ph-tooltip]');
    let tip = document.getElementById('ph-tooltip');
    if (el) {
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'ph-tooltip';
        document.body.appendChild(tip);
      }
      tip.textContent = el.dataset.phTooltip;
      tip.style.display = 'block';
    } else if (tip) {
      tip.style.display = 'none';
    }
  });
  document.addEventListener('mousemove', e => {
    if (isMobile()) return;
    if (!e.target.closest('[data-ph-tooltip]')) return;
    const tip = document.getElementById('ph-tooltip');
    if (tip) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top  = (e.clientY + 14) + 'px';
    }
  });

  // Móvil: modal centrado al pulsar
  document.addEventListener('click', e => {
    if (!isMobile()) return;
    const banner = document.getElementById('ph-banner');
    if (e.target.closest('#ph-banner button')) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (banner && e.target === banner) {
      banner.style.display = 'none';
      return;
    }
    const el = e.target.closest('[data-ph-tooltip]');
    if (el && el.classList.contains('tcat-btn')) return;
    if (!el) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (skipMobileMes && (el.closest('.month-grid') || el.closest('.temporada-filters'))) return;
    if (el.tagName !== 'A') e.preventDefault();
    openPhBanner(el);
  });

  // El tooltip solo existía para el ratón: con teclado no había forma de
  // leerlo (WCAG 1.4.13). Con el foco se muestra anclado al elemento, y
  // Escape lo cierra sin mover el foco.
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-ph-tooltip]');
    const tip = document.getElementById('ph-tooltip');
    if (!el) { if (tip) tip.style.display = 'none'; return; }
    if (isMobile()) return;
    _showPhTooltipFor(el);
  });
  document.addEventListener('focusout', () => {
    const tip = document.getElementById('ph-tooltip');
    if (tip) tip.style.display = 'none';
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tip = document.getElementById('ph-tooltip');
    if (tip && tip.style.display === 'block') tip.style.display = 'none';
  });

  // Los filtros existen ya al cargar; el resto se cablea al repintar.
  wirePhDescriptions();
}

// El tooltip visual no lo ve un lector de pantalla. Se copia el texto a un
// nodo oculto enlazado con aria-describedby, que sí se anuncia al enfocar.
export function wirePhDescriptions(root = document) {
  let n = 0;
  root.querySelectorAll('[data-ph-tooltip]').forEach(el => {
    if (el.getAttribute('aria-describedby')) return;
    const txt = el.dataset.phTooltip;
    if (!txt) return;
    const id = 'phd-' + (++_phDescSeq);
    const desc = document.createElement('span');
    desc.id = id;
    desc.className = 'sr-only';
    desc.textContent = txt;
    el.appendChild(desc);
    el.setAttribute('aria-describedby', id);
    n++;
  });
  return n;
}
let _phDescSeq = 0;

// Muestra el tooltip anclado bajo el elemento (no bajo el puntero).
function _showPhTooltipFor(el) {
  let tip = document.getElementById('ph-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ph-tooltip';
    document.body.appendChild(tip);
  }
  tip.textContent = el.dataset.phTooltip || '';
  tip.style.display = 'block';
  const r = el.getBoundingClientRect();
  tip.style.left = r.left + 'px';
  tip.style.top  = (r.bottom + 8) + 'px';
}

// ── Filtro fijado (chincheta) ──────────────────────────────────────
// Pin global compartido entre Hoy, Mes y Temporada. Persistido en
// localStorage. `null` cuando el usuario no ha fijado ninguno.
const PIN_STORAGE_KEY = 'cc_default_filter';
const VALID_PIN_CATS  = ['pro', 'uwt', 'wwt', 'male', 'female'];

export function getPinnedFilter() {
  try {
    const v = localStorage.getItem(PIN_STORAGE_KEY);
    return VALID_PIN_CATS.includes(v) ? v : null;
  } catch { return null; }
}

export function setPinnedFilter(cat) {
  try {
    if (VALID_PIN_CATS.includes(cat)) localStorage.setItem(PIN_STORAGE_KEY, cat);
    else localStorage.removeItem(PIN_STORAGE_KEY);
  } catch { /* storage no disponible */ }
}

const PIN_SVG_FILLED  = '<svg class="tcat-pin__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>';
const PIN_SVG_OUTLINE = '<svg class="tcat-pin__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z"/></svg>';

/** Re-renderiza las chinchetas en los `.tcat-btn` del contenedor según el
 *  filtro activo y el fijado. No toca la clase `.tcat-btn--active`. */
export function renderFilterPins(container, activeCat) {
  if (!container) return;
  const pinned = getPinnedFilter();
  container.querySelectorAll('.tcat-btn').forEach(btn => {
    const existing = btn.querySelector('.tcat-pin');
    if (existing) existing.remove();
    const cat = btn.dataset.cat;
    if (cat === 'all' || activeCat === 'all') return;
    let kind = null;
    if (pinned && cat === pinned) kind = 'filled';
    else if (cat === activeCat)   kind = 'outline';
    if (!kind) return;
    const span = document.createElement('span');
    span.className = `tcat-pin tcat-pin--${kind}`;
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    const label = kind === 'filled' ? 'Desfijar filtro' : 'Fijar como filtro predeterminado';
    span.setAttribute('aria-label', label);
    span.setAttribute('title', label);
    span.innerHTML = kind === 'filled' ? PIN_SVG_FILLED : PIN_SVG_OUTLINE;
    btn.appendChild(span);
  });
}

/** Gestiona un click/keydown en el contenedor de filtros. Devuelve:
 *    { type: 'pin', cat }    → pin togglado (el estado ya está persistido)
 *    { type: 'filter', cat } → el caller debe cambiar el filtro activo
 *    null                    → evento irrelevante */
export function handleFilterEvent(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return null;
  const btn = event.target.closest('.tcat-btn');
  if (!btn) return null;
  const cat = btn.dataset.cat;
  const pinEl = event.target.closest('.tcat-pin');
  if (pinEl) {
    event.stopPropagation();
    event.preventDefault();
    const current = getPinnedFilter();
    setPinnedFilter(current === cat ? null : cat);
    return { type: 'pin', cat };
  }
  return { type: 'filter', cat };
}

// ── Equipos (chapa + matching) ───────────────────────────────────
const TEAM_STOPWORDS = new Set([
  'pro','procycling','cycling','team','teams','squad','uci','worldteam',
  'wt','women','womens','féminin','feminin','femenino','féminine',
  'continental','development','presented','by','the','de','la','el','of','&','and',
]);

/** Normaliza un nombre de equipo para matching: minúsculas, sin acentos,
 *  solo letras/números, sin stopwords comunes. */
export function normalizeTeamName(s) {
  if (!s) return '';
  const base = String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!base) return '';
  const tokens = base.split(' ').filter(t => t && !TEAM_STOPWORDS.has(t));
  return tokens.join(' ').trim();
}

/** Busca un equipo en `teams` que corresponda al nombre `teamName`.
 *  Estrategia: coincidencia exacta normalizada (name + aliases) → subcadena. */
export function findMatchingTeam(teamName, teams) {
  if (!teamName || !Array.isArray(teams) || teams.length === 0) return null;
  const target = normalizeTeamName(teamName);
  if (!target) return null;
  for (const t of teams) {
    const names = [t.name, ...((t.nameAliases || '').split('\n'))]
      .map(n => normalizeTeamName(n)).filter(Boolean);
    if (names.includes(target)) return t;
  }
  // Fallback: contención (al menos 4 caracteres para evitar ruido).
  if (target.length >= 4) {
    for (const t of teams) {
      const names = [t.name, ...((t.nameAliases || '').split('\n'))]
        .map(n => normalizeTeamName(n)).filter(n => n && n.length >= 4);
      if (names.some(n => n === target || n.includes(target) || target.includes(n))) return t;
    }
  }
  return null;
}

// ── Formato de fecha largo ───────────────────────────────────────
export function formatDateKeyLong(dateKey) {
  if (!dateKey) return '';
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const str = new Date(y, m - 1, d).toLocaleDateString(getLocale(), {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return str.charAt(0).toUpperCase() + str.slice(1);
  } catch { return dateKey; }
}

// ── URL del perfil de elevación ──────────────────────────────────
export function perfilUrl(rd) {
  if (getLang() === 'en') {
    const base = _enBase();
    const s = rd.slugEn || rd.slug;
    if (s) return `${base}/profile/${encodeURIComponent(s)}/`;
    return `${base}/profile/?id=${rd.id}`;
  }
  if (rd.slug) return `/perfil/${encodeURIComponent(rd.slug)}/`;
  return `/perfil.html?id=${rd.id}`;
}

// ── Selector de etapas ───────────────────────────────────────────
export function buildStageNav(navSiblings, currentRdId, urlBuilder, raceHref) {
  if (navSiblings.length <= 1) return '';
  const idx  = navSiblings.findIndex(s => s.id === currentRdId);
  const prev = idx > 0 ? navSiblings[idx - 1] : null;
  const next = idx !== -1 && idx < navSiblings.length - 1 ? navSiblings[idx + 1] : null;

  const options = navSiblings.map(s => {
    const label = (s.stageNumber != null) ? stageLabel(s.stageNumber, s._stageSuffix) : (s.dateKey || s.id);
    const city = s.startLocation
      ? (!s.finishLocation || s.startLocation === s.finishLocation
          ? ` — ${rdLocation(s, 'startLocation')}`
          : ` — ${rdLocation(s, 'startLocation')} › ${rdLocation(s, 'finishLocation')}`)
      : '';
    const url = urlBuilder(s);
    return `<option value="${s.id}" data-url="${esc(url)}"${s.id === currentRdId ? ' selected' : ''}>${label}${city}</option>`;
  }).join('');

  return `<div class="stage-nav">
    <div class="stage-nav__picker">
      <button type="button" class="stage-nav__arrow${!prev ? ' disabled' : ''}"
        ${prev ? `onclick="location.href='${urlBuilder(prev)}'"` : ''}
        aria-label="${esc(t('stage.previous'))}"><span aria-hidden="true">‹</span></button>
      <select class="stage-nav__select" aria-label="${esc(t('stage.pickStage'))}" onchange="location.href=this.options[this.selectedIndex].dataset.url">
        ${options}
      </select>
      <button type="button" class="stage-nav__arrow${!next ? ' disabled' : ''}"
        ${next ? `onclick="location.href='${urlBuilder(next)}'"` : ''}
        aria-label="${esc(t('stage.next'))}"><span aria-hidden="true">›</span></button>
    </div>
    <a class="stage-nav__race" href="${raceHref}">${t('stage.viewAll')}</a>
  </div>`;
}

// ── Panel de botones de acción (web oficial + inscritos + recorrido) ──
// Fuente ÚNICA de verdad del panel `.asset-links`. Lo usan jornada, inscritos,
// orden de salida y resultados, para que las cuatro vistas muestren la misma
// fila de botones que la jornada. Cada vista pasa su `view` para que NO se
// pinte el botón que corresponde a la propia vista (p.ej. en inscritos no sale
// el botón "Inscritos"; en orden de salida no sale el botón de orden).
//
// Salvedad de INSCRITOS (decisión Dani): en una prueba de UN DÍA se muestran
// todos los botones de recorrido (rutómetro/perfil/puertos/mapa/live texto);
// en una VUELTA POR ETAPAS solo se muestra "Ir a la carrera" junto a la web
// oficial (los demás botones se omiten, porque la startlist es de la carrera
// entera, no de una etapa).
//
// En las vistas que NO son la jornada se inserta, tras la web oficial, el botón
// "Ir a la carrera" / "Go to the race": en prueba de un día lleva a la jornada
// única; en vuelta por etapas lleva a la competición (lista de etapas).
const _ACT_STERRATO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="7" cy="15" rx="4.5" ry="3"/><ellipse cx="17" cy="15" rx="4" ry="2.8"/><ellipse cx="12.5" cy="9" rx="4.5" ry="3"/></svg>';
const _ACT_SVGS = {
  website:    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  startlist:  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>',
  race:       '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  cursor:     '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 17 2.51-7.39L21 11.07 4 4z"/><path d="m13.17 13.17 4.66 4.66"/></svg>',
  startOrder: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V3"/><path d="M10 2h4"/></svg>',
  roadbook:   '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  technicalGuide: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
  profile:    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  profileOfficial:    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  profileInteractive: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  ports:      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3-4 4 4 4"/><path d="m16 3 4 4-4 4"/><line x1="4" y1="7" x2="20" y2="7"/><path d="m8 17-4 4 4 4"/><path d="m16 17 4 4-4 4"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
  pave:       '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20L2 13L6 7L13 4L20 7L22 13L19 20Z"/></svg>',
  sterrato:   _ACT_STERRATO_SVG,
  ribinou:    _ACT_STERRATO_SVG,
  map:        '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
  live_text:  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>',
};
// Las dos variantes de mapa comparten el mismo pictograma, como los perfiles.
_ACT_SVGS.mapOfficial = _ACT_SVGS.map;
_ACT_SVGS.mapInteractive = _ACT_SVGS.map;
const _actLabel = (key) => `${_ACT_SVGS[key] || ''}<span class="asset-btn__label">${t(`assets.${key}`) || key}</span>`;
const _actText  = (key) => t(`assets.${key}`) || key;

// startlistUrl ya está definida arriba en este archivo (devuelve la URL de
// /inscritos/ según idioma y slug). Aquí construimos su versión de botón.
function _startlistHref(race) {
  const isEn = getLang() === 'en';
  const slug = isEn ? (race.slugEn || race.slug) : race.slug;
  const enB  = isEn ? enBase() : null;
  const base = isEn ? `${enB}/startlist/` : `${CONFIG.basePath}/inscritos/`;
  return slug ? `${base}${encodeURIComponent(slug)}/` : `${CONFIG.basePath}/inscritos.html?race=${race.id}`;
}

/**
 * Construye la fila `.asset-links` (web oficial + inscritos + "ir a la carrera"
 * + rutómetro/perfil/puertos/mapa/live texto). Devuelve '' si no hay botones.
 *
 * @param {object}  o
 * @param {object}  o.race        carrera
 * @param {object}  o.rd          race_day de la etapa (assets, perfil, etc.)
 * @param {string}  o.view        'jornada' | 'inscritos' | 'startOrder' | 'resultados'
 * @param {Array}   o.assets      filas de la tabla `assets` de esta jornada
 * @param {boolean} o.hasStartlist  si la carrera tiene inscritos
 * @param {boolean} o.navOnly     solo navegación (web oficial + "Ir a la
 *                  etapa/carrera"): sin inscritos ni botones de recorrido.
 *                  Lo usa Resultados.
 * @param {string}  o.style       estilos inline extra para el contenedor
 */
export function buildActionButtons({ race, rd = {}, view, assets = [], hasStartlist = false, navOnly = false, style = '' } = {}) {
  const isEn = getLang() === 'en';
  const isOneDay = race?.raceFormat === 'one_day';
  const isJornada = view === 'jornada';
  // Salvedad de inscritos en vueltas por etapas: sin botones de recorrido.
  // navOnly (Resultados): nunca botones de recorrido.
  const showRouteButtons = !navOnly && (view !== 'inscritos' || isOneDay || assets.some(asset => asset.type === 'technicalGuide'));

  // ── Web oficial — siempre primero si existe ──
  let websiteBtn = '';
  if (race?.websiteUrl) {
    websiteBtn = `<a class="asset-btn" href="${race.websiteUrl}" target="_blank" rel="noopener">${_ACT_SVGS.website}<span class="asset-btn__label">${t('stage.websiteLabel')}</span></a>`;
  }

  // ── "Ir a la carrera" / "Ir a la etapa" (solo fuera de la jornada) ──
  // - Vistas DE una etapa concreta (orden de salida, perfil, resultados): en
  //   vuelta por etapas el botón es "Ir a la etapa" → la jornada de ESA etapa.
  // - Inscritos: su lista es de la carrera entera → "Ir a la carrera" →
  //   competición (lista de etapas).
  // - Prueba de un día (cualquier vista): "Ir a la carrera" → su jornada única.
  let raceBtn = '';
  if (!isJornada) {
    const raceIcon = view === 'inscritos' ? _ACT_SVGS.cursor : _ACT_SVGS.race;
    const isStageView = view === 'startOrder' || view === 'perfil' || view === 'resultados' || view === 'mapa';
    if (isOneDay) {
      const label = isEn ? 'Go to the race' : 'Ir a la carrera';
      const href = jornadaUrl(rd?.id ? rd : { id: race?.id, slug: race?.slug, slugEn: race?.slugEn, dateKey: rd?.dateKey });
      raceBtn = `<a class="asset-btn" href="${href}">${raceIcon}<span class="asset-btn__label">${label}</span></a>`;
    } else if (isStageView && rd?.id) {
      // Vuelta por etapas, vista de etapa → jornada de esta etapa.
      const label = isEn ? 'Go to the stage' : 'Ir a la etapa';
      raceBtn = `<a class="asset-btn" href="${jornadaUrl(rd)}">${_ACT_SVGS.cursor}<span class="asset-btn__label">${label}</span></a>`;
    } else if (race?.id) {
      // Vuelta por etapas, vista de carrera (inscritos) → competición.
      const label = isEn ? 'Go to the race' : 'Ir a la carrera';
      raceBtn = `<a class="asset-btn" href="${raceUrl(race)}">${raceIcon}<span class="asset-btn__label">${label}</span></a>`;
    }
  }

  // ── Inscritos (no en la propia vista de inscritos; no en navOnly) ──
  let startlistBtn = '';
  if (hasStartlist && view !== 'inscritos' && !navOnly) {
    const startlistLabel = race.startlistProvisional
      ? t('startlist.provisional')
      : (race.gender === 'female' ? t('startlist.labelFemale') : t('startlist.label'));
    startlistBtn = `<a class="asset-btn" href="${_startlistHref(race)}">${_ACT_SVGS.startlist}<span class="asset-btn__label">${startlistLabel}</span></a>`;
  }

  // ── Botones de recorrido (assets de la jornada) ──
  let routeBtns = [];
  if (showRouteButtons) {
    // El botón de la PROPIA vista no se muestra (en orden de salida no sale el
    // botón "Orden Salida"). En perfil el asset estático de perfil NO se
    // filtra aquí: si además hay perfil dinámico (GPX), se necesita para el
    // botón "Perfil oficial" (dynProfileUrl más abajo ya suprime el dinámico).
    let validAssets = (assets || []).filter(a => a.url || a.filePath);
    // En inscritos de una vuelta, solo sobrevive el documento común de la
    // competición: el resto pertenece a una etapa concreta.
    if (view === 'inscritos' && !isOneDay) validAssets = validAssets.filter(a => a.type === 'technicalGuide');
    if (view === 'startOrder') validAssets = validAssets.filter(a => a.type !== 'startOrder');
    if (view === 'mapa')       validAssets = validAssets.filter(a => a.type !== 'map');
    // Jornada cancelada: no hay carrera que seguir en directo → fuera el Live
    // Texto. La documentación del recorrido (rutómetro/perfil/mapa) SÍ se
    // conserva: describe la etapa que estaba trazada, no su seguimiento.
    if (rd.isCancelledDay) validAssets = validAssets.filter(a => a.type !== 'live_text');
    // Orden de salida: deriva de startOrderImportedAt aunque falte la fila asset.
    if (view !== 'startOrder' && rd.startOrderImportedAt && !validAssets.some(a => a.type === 'startOrder')) {
      validAssets.push({ type: 'startOrder', sourceType: 'external' });
    }
    const assetOrder = ['technicalGuide', 'startOrder', 'roadbook', 'profile', 'ports', 'map', 'live_text'];
    const sortedAssets = [...validAssets].sort((a, b) =>
      assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type));

    const isMobile = (typeof window !== 'undefined' && window.innerWidth < 768);

    function assetBtnHtml(a, labelKey = a.type) {
      const url = a.url || a.filePath;
      const label = _actLabel(labelKey);
      if (a.type === 'startOrder') {
        return `<a class="asset-btn" href="${startOrderUrl(rd)}">${label}</a>`;
      }
      const isExternal = !url.startsWith('https://assets.calendariociclismo.app');
      if (isMobile || isExternal) {
        return `<a class="asset-btn" href="${url}" target="_blank" rel="noopener">${label}</a>`;
      }
      const safeUrl = url.replace(/'/g, "\\'");
      const safeTxt = _actText(labelKey).replace(/'/g, "\\'");
      return `<button class="asset-btn" onclick="openAssetModal('${safeUrl}','${safeTxt}')">${label}</button>`;
    }

    // Perfil dinámico (GPX) sustituye al asset estático.
    const enB = isEn ? enBase() : null;
    const profileBase = isEn ? `${enB}/profile/` : '/perfil/';
    const profileFallback = isEn ? `${enB}/profile/?id=${rd.id}` : `/perfil.html?id=${rd.id}`;
    const profileSlug = isEn ? (rd.slugEn || rd.slug) : rd.slug;
    // Existe perfil dinámico (GPX), independientemente de si esta vista ES el
    // perfil (eso solo decide si se enlaza a sí misma, más abajo).
    const hasDynProfile = !!(rd.elevationProfile && !rd.profileNotViewable);
    // En la vista de perfil NO se ofrece el botón de perfil (es la propia vista):
    // se suprime el enlace, pero `hasDynProfile` sigue contando para saber si
    // hay que etiquetar el asset estático como "Perfil oficial".
    const dynProfileUrl = (view !== 'perfil' && hasDynProfile)
      ? (profileSlug ? `${profileBase}${encodeURIComponent(profileSlug)}/` : profileFallback)
      : null;

    // Mapa interactivo (GPX en R2) sustituye al asset estático `map`, igual que
    // el perfil dinámico al asset `profile`. En la vista de mapa no se ofrece.
    const mapBase     = isEn ? `${enB}/route-map/` : '/mapa/';
    const mapFallback = isEn ? `${enB}/route-map/?id=${rd.id}` : `/mapa.html?id=${rd.id}`;
    const dynMapUrl = (view !== 'mapa' && rd.routeGpxUrl)
      ? (profileSlug ? `${mapBase}${encodeURIComponent(profileSlug)}/` : mapFallback)
      : null;

    const profileAsset = sortedAssets.find(a => a.type === 'profile');
    const portsAsset   = sortedAssets.find(a => a.type === 'ports');
    const hasProfile = !!(dynProfileUrl || profileAsset);
    // Cuando existen AMBOS (perfil interactivo GPX + asset estático), se ofrecen
    // los dos botones: "Perfil interactivo" (dinámico) y "Perfil oficial"
    // (asset). Con uno solo, el botón se llama simplemente "Perfil". Se basa
    // en `hasDynProfile` (no en `dynProfileUrl`) para que en la propia vista
    // de perfil el estático se siga etiquetando "Perfil oficial" aunque el
    // interactivo no se enlace a sí mismo.
    const bothProfiles = !!(hasDynProfile && profileAsset);
    const dynKey    = bothProfiles ? 'profileInteractive' : 'profile';
    const staticKey = bothProfiles ? 'profileOfficial'    : 'profile';

    const isSterrato = rd.primaryType === 'sterrato';
    const isFrance   = race?.countryCode?.toLowerCase() === 'fr';

    // Botón del asset estático de perfil (modal en desktop, enlace en móvil/externo).
    const staticProfileBtn = (labelKey) => {
      if (!profileAsset) return '';
      const url = (profileAsset.url || profileAsset.filePath).replace(/'/g, "\\'");
      const external = !url.startsWith('https://assets.calendariociclismo.app');
      if (isMobile || external) {
        return `<a class="asset-btn" href="${url}" target="_blank" rel="noopener">${_actLabel(labelKey)}</a>`;
      }
      const txt = _actText(labelKey).replace(/'/g, "\\'");
      return `<button class="asset-btn" onclick="openAssetModal('${url}','${txt}')">${_actLabel(labelKey)}</button>`;
    };

    // `dynProfileHtml`: el perfil interactivo (siempre enlace a la página propia).
    const dynProfileHtml = dynProfileUrl
      ? `<a class="asset-btn" href="${dynProfileUrl}">${_actLabel(dynKey)}</a>`
      : '';
    // `officialProfileHtml`: el asset estático "Perfil oficial" (solo si ambos).
    const officialProfileHtml = bothProfiles ? staticProfileBtn('profileOfficial') : '';

    // `profileHtml` = botón principal en la posición 'profile':
    //   - ambos → el interactivo (el oficial se inyecta como entrada aparte)
    //   - solo dinámico → el interactivo (label 'Perfil')
    //   - solo estático → el asset (label 'Perfil')
    //   - solo ports (sin perfil) → el asset de puertos ocupa el slot
    let profileHtml = '';
    let portsHtml   = '';
    if (hasDynProfile) {
      // Interactivo (o vacío en su propia vista, donde solo se ofrece el
      // estático "Perfil oficial" ya inyectado en `officialProfileHtml`).
      profileHtml = dynProfileHtml;
    } else if (profileAsset) {
      profileHtml = staticProfileBtn(staticKey);
    } else if (portsAsset) {
      const portsUrl = (portsAsset.url || portsAsset.filePath).replace(/'/g, "\\'");
      const portsExternal = !portsUrl.startsWith('https://assets.calendariociclismo.app');
      const effectiveKey = isSterrato ? (isFrance ? 'ribinou' : 'sterrato') : 'ports';
      const modalTitle   = _actText(effectiveKey);
      if (isMobile || portsExternal) {
        profileHtml = `<a class="asset-btn" href="${portsUrl}" target="_blank" rel="noopener">${_actLabel(effectiveKey)}</a>`;
      } else {
        profileHtml = `<button class="asset-btn" onclick="openAssetModal('${portsUrl}','${modalTitle}')">${_actLabel(effectiveKey)}</button>`;
      }
    }
    // Cuando hay perfil (en 'profile') y además ports, el asset de puertos ocupa
    // su propio slot 'ports' con su etiqueta de puertos/sterrato/ribinou.
    if (hasProfile && portsAsset) {
      const portsUrl      = (portsAsset.url || portsAsset.filePath).replace(/'/g, "\\'");
      const portsExternal = !portsUrl.startsWith('https://assets.calendariociclismo.app');
      const portsKey      = isSterrato ? (isFrance ? 'ribinou' : 'sterrato') : 'ports';
      const portsLabel    = _actLabel(portsKey);
      const portsTxt      = _actText(portsKey).replace(/'/g, "\\'");
      if (isMobile || portsExternal) {
        portsHtml = `<a class="asset-btn" href="${portsUrl}" target="_blank" rel="noopener">${portsLabel}</a>`;
      } else {
        portsHtml = `<button class="asset-btn" onclick="openAssetModal('${portsUrl}','${portsTxt}')">${portsLabel}</button>`;
      }
    }

    const mapAsset = sortedAssets.find(a => a.type === 'map');
    // Igual que con perfiles: si conviven el archivo oficial y el trazado GPX,
    // se ofrecen ambos, oficial primero e interactivo después.
    const bothMaps = !!(rd.routeGpxUrl && mapAsset);
    const dynMapKey = bothMaps ? 'mapInteractive' : 'map';
    // Sin asset estático de perfil pero con dinámico → inyectar el slot 'profile'.
    let workingAssets = (dynProfileUrl && !profileAsset)
      ? [...sortedAssets, { type: 'profile' }].sort(
          (a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type))
      : sortedAssets;
    // Mapa dinámico sin asset estático: inyectar la entrada `map` en su orden.
    if (dynMapUrl && !mapAsset) {
      workingAssets = [...workingAssets, { type: 'map' }].sort(
        (a, b) => assetOrder.indexOf(a.type) - assetOrder.indexOf(b.type));
    }

    routeBtns = workingAssets
      .map(a => {
        // Slot 'profile': con ambos perfiles, primero el OFICIAL (asset estático)
        // y después el INTERACTIVO — siempre tras el rutómetro y antes del mapa.
        if (a.type === 'profile') return bothProfiles ? `${officialProfileHtml}${profileHtml}` : profileHtml;
        if (a.type === 'ports')   return hasProfile ? portsHtml : profileHtml;
        if (a.type === 'map' && dynMapUrl) {
          const interactive = `<a class="asset-btn" href="${dynMapUrl}">${_actLabel(dynMapKey)}</a>`;
          return bothMaps ? `${assetBtnHtml(a, 'mapOfficial')}${interactive}` : interactive;
        }
        return assetBtnHtml(a);
      })
      .filter(Boolean);
  }

  // La guía técnica es el único documento de carrera que se adelanta a la
  // navegación y a los demás assets: inmediatamente después de la web oficial.
  const hasTechnicalGuide = (assets || []).some(asset => asset.type === 'technicalGuide' && (asset.url || asset.filePath));
  const technicalGuideBtn = hasTechnicalGuide ? (routeBtns.shift() || '') : '';
  const all = `${websiteBtn}${technicalGuideBtn}${raceBtn}${startlistBtn}${routeBtns.join('')}`;
  if (!all) return '';
  const styleAttr = style ? ` style="${style}"` : '';
  const nextLabel = isEn ? 'More actions' : 'Más acciones';
  return `<div class="asset-links-wrap"><div class="asset-links"${styleAttr}>${all}</div><button class="date-week-arrow asset-links__prev" type="button" aria-label="${isEn ? 'Previous actions' : 'Acciones anteriores'}" hidden onclick="this.previousElementSibling.scrollTo({left:0,behavior:'smooth'})">‹</button><button class="date-week-arrow asset-links__next" type="button" aria-label="${nextLabel}" hidden onclick="this.previousElementSibling.previousElementSibling.scrollTo({left:this.previousElementSibling.previousElementSibling.scrollWidth,behavior:'smooth'})">›</button></div>`;
}

// La flecha solo se enseña cuando quedan acciones fuera del área visible. La
// instalación es delegada porque las filas se insertan después de cargar datos.
function _syncAssetLinksNext(wrapper) {
  const rail = wrapper.querySelector('.asset-links');
  const prev = wrapper.querySelector('.asset-links__prev');
  const next = wrapper.querySelector('.asset-links__next');
  if (!rail || !prev || !next) return;
  prev.hidden = rail.scrollLeft <= 1;
  next.hidden = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
}

// Algunas vistas insertan la tira directamente en un <main> de ancho completo
// y centran solo `.asset-links` con max-width (inscritos, orden de salida,
// resultados). Las flechas son hijas del wrapper, así que `left/right: 0` las
// llevaba a los bordes de la pantalla. Calculamos los insets contra la caja real
// de la tira para que el componente funcione igual dentro y fuera de una card.
function _positionAssetLinksArrows(wrapper) {
  const rail = wrapper.querySelector('.asset-links');
  const prev = wrapper.querySelector('.asset-links__prev');
  const next = wrapper.querySelector('.asset-links__next');
  if (!rail || !prev || !next) return;
  const wrapperRect = wrapper.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  prev.style.left = `${Math.max(0, railRect.left - wrapperRect.left)}px`;
  next.style.right = `${Math.max(0, wrapperRect.right - railRect.right)}px`;
}

function _installAssetLinksNext(wrapper) {
  if (wrapper.dataset.assetLinksNextReady) return;
  wrapper.dataset.assetLinksNextReady = 'true';
  const rail = wrapper.querySelector('.asset-links');
  if (!rail) return;
  const sync = () => _syncAssetLinksNext(wrapper);
  const positionAndSync = () => {
    _positionAssetLinksArrows(wrapper);
    sync();
  };
  rail.addEventListener('scroll', sync, { passive: true });
  const resizeObserver = new ResizeObserver(positionAndSync);
  resizeObserver.observe(wrapper);
  resizeObserver.observe(rail);
  requestAnimationFrame(positionAndSync);
}

if (typeof document !== 'undefined') {
  const installAssetLinksNext = root => {
    if (root.matches?.('.asset-links-wrap')) _installAssetLinksNext(root);
    root.querySelectorAll?.('.asset-links-wrap').forEach(_installAssetLinksNext);
  };
  installAssetLinksNext(document);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) installAssetLinksNext(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => document.querySelectorAll('.asset-links-wrap').forEach(wrapper => {
    _positionAssetLinksArrows(wrapper);
    _syncAssetLinksNext(wrapper);
  }), { passive: true });
}

// ── Detecta si el nombre de la carrera ya implica género femenino ─
export const nameImpliesFemale = n => /femenino|femenina|féminas|femeninos|f[eé]minin[e]?|femmes|women|ladies|donne|dames|elite women/i.test(n);

// ── Hero de carrera (logo, bandera, nombre, categoría, fecha) ────
// Wrapper sobre buildRaceHeader para la vista de jornada: detalle = etapa ·
// categoría, más la fecha larga y, si procede, el banner de jornada anulada.
export function buildRaceHero(rd, race, { showCancelledBanner = false } = {}) {
  const showFlag = !(race?.hideFlag && !rd.countryCode);
  const stage = stageLabel(rd.stageNumber, rd._stageSuffix);
  const uci = race?.uciCategory || '';

  const cancelledHtml = showCancelledBanner && rd.isCancelledDay
    ? `<div class="jornada-cancelled-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        ${race?.raceFormat === 'one_day' ? t('race.cancelled') : t('race.stageCancelled')}
      </div>`
    : '';

  return buildRaceHeader({
    race,
    countryCode: effectiveCountryCode(rd, race || {}),
    hideFlag: !showFlag,
    detail: [stage, uci].filter(Boolean).join(' · '),
    date: rd.dateKey ? formatDateKeyLong(rd.dateKey) : '',
    extraHtml: cancelledHtml,
  });
}

/**
 * Cabecera de carrera unificada (web). Misma presentación en jornada,
 * competición, orden de salida e inscritos; la única variación es el
 * `label` (Inscritos / Orden de Salida), la línea de `detail` (etapa,
 * categoría, nº de etapas…), la `date`, las `stats` y la `action`.
 *
 * El nombre se muestra TAL CUAL está en la BD (caja normal — la BD ya
 * guarda la grafía canónica: "Strade Bianche", "E3 Saxo Classic"…).
 *
 * Opciones:
 *  - race          objeto de carrera (logoUrl, name/nameEn, gender, colorHex…)
 *  - countryCode   código ISO-2 para la bandera (override de race.countryCode)
 *  - hideFlag      true para ocultar la bandera
 *  - nameHref      si se pasa, el nombre enlaza ahí; por defecto enlaza a la
 *                  competición salvo carreras de un día (one_day)
 *  - label         etiqueta destacada al inicio del subtítulo (p.ej. "Inscritos")
 *  - detail        línea de detalle (partes ya unidas por " · ")
 *  - date          línea de fecha (debajo del subtítulo)
 *  - stats         línea de stats (p.ej. "23 equipos · 189 corredores")
 *  - action        HTML del botón/acción a la derecha (PDF, ver jornada…)
 *  - extraHtml     HTML extra al final (p.ej. banner de carrera anulada)
 */
export function buildRaceHeader({
  race,
  countryCode,
  hideFlag = false,
  nameHref = undefined,
  label = '',
  detail = '',
  date = '',
  stats = '',
  action = '',
  extraHtml = '',
} = {}) {
  const r = race || {};
  const name = raceName(r) || '';
  const female = r.gender === 'female' && !nameImpliesFemale(name)
    ? femaleMark({ style: 'font-size:0.55em;opacity:0.7;font-weight:400;vertical-align:0.15em' })
    : '';
  const flag = countryFlag(countryCode != null ? countryCode : r.countryCode || '');
  const showFlag = !hideFlag;
  const logoHtml = r.logoUrl
    ? `<img class="race-header__logo" src="${r.logoUrl}" alt="${esc(name)}" loading="lazy" onerror="this.style.display='none'">`
    : '';

  // Resolución del enlace del nombre: explícito → o competición (no one_day) → o sin enlace
  const href = nameHref !== undefined
    ? nameHref
    : (r.raceFormat !== 'one_day' && r.id ? raceUrl(r) : '');
  // El nombre de la carrera es el título real de la página: va en <h1>, no en
  // un <div> con estilos. Sin él la navegación por encabezados de estas
  // páginas —las más profundas del sitio— empezaba en nivel 2 (WCAG 1.3.1).
  const nameHtml = name
    ? (href
        ? `<h1 class="race-header__name"><a href="${href}" style="text-decoration:none;display:block;color:inherit">${esc(name)}${female}</a></h1>`
        : `<h1 class="race-header__name">${esc(name)}${female}</h1>`)
    : '';

  // Subtítulo: label destacado + detalle, unidos por " · "
  const subParts = [
    label ? `<span class="race-header__label">${label}</span>` : '',
    detail ? esc(detail) : '',
  ].filter(Boolean).join(' · ');

  const colorVar = r.colorHex ? ` style="--card-color:${r.colorHex}"` : '';

  return `<div class="race-header"${colorVar}>
    <div class="race-header__inner">
      <div class="race-header__main">
        ${logoHtml
          ? `<div class="race-header__brand">
               ${logoHtml}
               ${showFlag ? `<span class="race-header__flag">${flag}</span>` : ''}
             </div>`
          : (showFlag ? `<div class="race-header__flag race-header__flag--solo">${flag}</div>` : '')
        }
        <div class="race-header__text">
          ${nameHtml}
          ${subParts ? `<div class="race-header__subtitle">${subParts}</div>` : ''}
          ${date ? `<div class="race-header__date">${date}</div>` : ''}
          ${stats ? `<div class="race-header__stats">${stats}</div>` : ''}
        </div>
      </div>
      ${action || ''}
    </div>
    ${extraHtml || ''}
  </div>`;
}

/** Genera el SVG de la chapa de un equipo.
 *  - Polígono exterior gris (22 lados) simulando la chapa ciclista.
 *  - Interior con torso (sides + stripe central + círculo opcional) y culotte plano. */
export function buildTeamBadgeSvg(team, { size = 24, className = 'team-badge' } = {}) {
  if (!team) return '';
  const s = size;
  const cx = s / 2, cy = s / 2;
  const rOuter = s * 0.48;
  const rInner = s * 0.38;
  // Franja central = 70% del diámetro interior → cada manga lateral = 15%
  const stripeW = rInner * 1.4;
  const sides = 22;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    pts.push(`${(cx + rOuter * Math.cos(a)).toFixed(2)},${(cy + rOuter * Math.sin(a)).toFixed(2)}`);
  }
  const torsoCenter = team.badgeTorsoCenter || '#ffffff';
  const torsoSides  = team.badgeTorsoSides  || '#111111';
  const shorts      = team.badgeShorts      || '#111111';
  const inner       = team.badgeInnerCircle || null;
  // Divisoria torso/culotte al 70% de la altura del círculo (desde arriba).
  const divideY = cy + rInner * 0.4;
  // Círculo interior centrado en la zona de torso (midpoint del semicírculo superior).
  const innerCy = cy - rInner * 0.35;
  const innerR  = rInner * 0.22;
  const clipId = `teamBadgeClip_${Math.random().toString(36).slice(2, 9)}`;
  return `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <polygon points="${pts.join(' ')}" fill="#8a8d91" stroke="#5f6266" stroke-width="${(s * 0.02).toFixed(2)}"/>
    <defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${rInner}"/></clipPath></defs>
    <g clip-path="url(#${clipId})">
      <rect x="0" y="${divideY.toFixed(2)}" width="${s}" height="${(s - divideY + 1).toFixed(2)}" fill="${shorts}"/>
      <rect x="0" y="0" width="${s}" height="${divideY.toFixed(2)}" fill="${torsoSides}"/>
      <rect x="${(cx - stripeW / 2).toFixed(2)}" y="0" width="${stripeW.toFixed(2)}" height="${divideY.toFixed(2)}" fill="${torsoCenter}"/>
      ${inner ? `<circle cx="${cx}" cy="${innerCy.toFixed(2)}" r="${innerR.toFixed(2)}" fill="${inner}"/>` : ''}
      <line x1="0" y1="${divideY.toFixed(2)}" x2="${s}" y2="${divideY.toFixed(2)}" stroke="rgba(0,0,0,0.22)" stroke-width="${(s * 0.025).toFixed(2)}"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="${(s * 0.018).toFixed(2)}"/>
  </svg>`;
}

// ── Modal de assets (escritorio) ─────────────────────────────────
export function openAssetModal(url, label) {
  let overlay = document.getElementById('assetModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'assetModalOverlay';
    overlay.innerHTML = `
      <div class="asset-modal" id="assetModal">
        <div class="asset-modal__bar">
          <span class="asset-modal__title" id="assetModalTitle"></span>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <a class="asset-modal__external" id="assetModalExternal" target="_blank" rel="noopener">↗ ${getLang() === 'en' ? 'New tab' : 'Nueva pestaña'}</a>
            <button class="asset-modal__close" onclick="closeAssetModal()"><svg xmlns="http://www.w3.org/2000/svg" width="14px" height="14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          </div>
        </div>
        <div class="asset-modal__body" id="assetModalBody"></div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAssetModal(); });
    document.body.appendChild(overlay);
  }

  const isImage = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  const isPdf   = /\.pdf(\?|$)/i.test(url);

  const cleanLabel = label.replace(/^\p{Emoji}\s*/u, '');
  document.getElementById('assetModalTitle').textContent = cleanLabel;
  document.getElementById('assetModalExternal').href = url;

  const body = document.getElementById('assetModalBody');
  const modal = document.querySelector('.asset-modal');
  if (isImage) {
    body.innerHTML = `<img src="${url}" alt="${esc(cleanLabel)}" style="width:100%;height:auto;display:block">`;
    modal.classList.add('asset-modal--image');
    modal.classList.remove('asset-modal--document');
  } else if (isPdf) {
    body.innerHTML = `<embed src="${url}" type="application/pdf" style="width:100%;height:100%;border:none">`;
    modal.classList.add('asset-modal--document');
    modal.classList.remove('asset-modal--image');
  } else {
    body.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
    modal.classList.add('asset-modal--document');
    modal.classList.remove('asset-modal--image');
  }

  overlay.classList.add('asset-modal--open');
  document.body.style.overflow = 'hidden';
  _releaseAssetFocus = trapFocus(overlay.querySelector('.asset-modal') || overlay);
}
let _releaseAssetFocus = null;
window.openAssetModal = openAssetModal;

export function closeAssetModal() {
  const overlay = document.getElementById('assetModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('asset-modal--open');
  document.body.style.overflow = '';
  if (_releaseAssetFocus) { _releaseAssetFocus(); _releaseAssetFocus = null; }
  setTimeout(() => {
    const body = document.getElementById('assetModalBody');
    if (body) body.innerHTML = '';
  }, 250);
}
window.closeAssetModal = closeAssetModal;
