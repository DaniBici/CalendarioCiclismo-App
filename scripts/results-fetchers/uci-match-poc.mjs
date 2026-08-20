#!/usr/bin/env node
/**
 * uci-match-poc.mjs — PoC del MATCHER carrera-DB ↔ competitionId UCI.
 *
 * Responde empíricamente: ¿cuántas de nuestras carreras 2026 casan inequívocamente con su
 * competición UCI por FECHA + PAÍS + CLASE (nombre solo desempata)? NO escribe nada (ni BD ni
 * web): solo lee `races` (REST Supabase, key pública) + el universo UCI road y reporta.
 *
 * Estrategia (PLAN-resultados-web.md §4): el nombre UCI diverge ("Dauphiné" = "Tour
 * Auvergne-Rhône-Alpes") y es ruidoso (patrocinadores, duplicados, Junior). Anclas fiables:
 *   - FECHA: solape de [startDate,endDate] nuestro vs [StartDate,EndDate] UCI (±N días).
 *   - PAÍS: countryCode (ISO-2) vs CountryIsoCode2.
 *   - CLASE: uciCategory vs ClassCode (¡misma nomenclatura! 2.UWT=2.UWT…).
 *   - GÉNERO: derivado del nombre UCI (Women/Femmes/Dames…) vs races.gender, para no cruzar
 *     la versión masc/fem de una misma carrera.
 *   El nombre solo RE-ORDENA candidatos empatados (fuzzy sobre nombre plegado sin patrocinador).
 *
 * Uso:
 *   node scripts/results-fetchers/uci-match-poc.mjs
 *   node scripts/results-fetchers/uci-match-poc.mjs --year 2026 --slack 1 --out _results_run/match
 *   node scripts/results-fetchers/uci-match-poc.mjs --ambiguous   # listar solo ambiguas
 *
 * Args:
 *   --year     temporada (default 2026).
 *   --slack    días de tolerancia en el solape de fechas (default 1).
 *   --out      carpeta de salida (default _results_run/match-<year> JUNTO A ESTE script, no
 *              relativo al cwd); escribe match-report.json. La ruta que imprime al terminar
 *              es la real: leer esa, no reconstruirla a mano.
 *   --ambiguous  imprime a stderr el detalle de las ambiguas + sin-match (para inspección).
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const YEAR = parseInt(getArg('year') || '2026', 10);
const SLACK = parseInt(getArg('slack') || '1', 10);
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el match-report en una ruta distinta de la que imprime, y una lectura
// posterior se quedaba con un fichero viejo (mismo bug que los fetchers, TdF E12).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `match-${YEAR}`);
const SHOW = hasFlag('ambiguous');

// Mapa año→seasonId road de DataRide (de GetRestrictedResultsDisciplineSeasons?disciplineId=10).
const ROAD_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

const SUPA_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const SUPA_KEY = 'sb_publishable_4j0S4lUm6dYphrb0DEUYkw_OGAUoCLL'; // publishable (pública, embebida en la web)
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// ── normalización de texto / nombres ──────────────────────────────────────
const STOPWORDS = new Set(['tour', 'de', 'la', 'le', 'du', 'des', 'di', 'a', 'of', 'the', 'gp',
  'grand', 'prix', 'gran', 'premio', 'ronde', 'van', 'giro', 'vuelta', 'tour', 'classic',
  'classique', 'race', 'cycling', 'international', 'internazionale', 'trophy', 'trofeo', 'and',
  'et', 'y', 'el', 'i', 'ii', 'iii', 'memorial', 'gp']);
function fold(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
// quita patrocinadores tras " - " / " / " y stopwords → token-set para comparar
function nameTokens(s) {
  const base = fold(s).split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  return new Set(base);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// /Date(ms)/ → Date (UTC). Usamos el día.
function dotnetDay(s) {
  const m = /\/Date\((-?\d+)\)\//.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return isNaN(d) ? null : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function isoDay(s) { // "2026-06-08" → epoch día UTC
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
const DAY = 86400000;
// ¿solapan los intervalos [a0,a1] y [b0,b1] con tolerancia slack días?
function overlap(a0, a1, b0, b1, slack) {
  if (a0 == null || b0 == null) return false;
  a1 = a1 ?? a0; b1 = b1 ?? b0;
  return a0 - slack * DAY <= b1 && b0 - slack * DAY <= a1;
}

function isJuniorName(s) { return /\b(junior|juniores|juniors|espoirs)\b/i.test(s || ''); }
// Detección de FEMENINO multiidioma en el nombre (en/fr/es/it/nl/de) + "ladies edition" + sufijos
// UCI "WE"/"WU" (Women Elite/Under). NO confundir con palabras que contienen esas letras → \b…\b.
function isWomenName(s) {
  return /\b(women|woman|femmes?|f[ée]mina[s]?|f[ée]minin[es]?|dames|donne|frauen|vrouwen|ladies|femminile|kobiet|emakume[a-z]*|we|wu)\b/i.test(s || '');
}
// El género REAL se ancla en la CLASE (WWT/WC = femenino por definición de la UCI), no solo el
// nombre. Devuelve 'female' | 'male' | null(ambiguo) para una competición UCI.
function uciGender(c) {
  const cls = normClass(c.ClassCode);
  if (/WWT|^WW|^1\.WW|^2\.WW/.test(cls) || cls === 'WC' && isWomenName(c.CompetitionName)) return 'female';
  if (/UWT/.test(cls)) return 'male';
  if (isWomenName(c.CompetitionName)) return 'female';
  return null; // .1/.2/.Pro/CN sin marca → ambiguo, no filtrar por género (deja que clase+nombre decidan)
}

function normClass(c) {
  // "2.UWT" "1.Pro" "2.1" "1.2U" "CN" "CC" "WC" → canonical; trata .2U/U23 equivalentes
  return (c || '').toUpperCase().replace(/\s+/g, '').replace('UCIWT', 'UWT');
}

// ── fetch de datos ─────────────────────────────────────────────────────────
async function fetchOurRaces(year) {
  // nameEn = nombre oficial/local (el MISMO que usa la UCI: "Tour de Suisse", "Ronde van Brugge"…)
  // → es el campo de matching por nombre; originalName como fallback; name (ES) ya no se usa para casar.
  // isCancelled: las carreras canceladas se EXCLUYEN del matcher (no hay resultados que enlazar) — ver main().
  const url = `${SUPA_URL}/rest/v1/races?year=eq.${year}&select=id,slug,name,nameEn,originalName,uciCategory,gender,countryCode,startDate,endDate,isGrandTour,isCancelled`;
  const res = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchUciRoad(seasonId) {
  const body = new URLSearchParams({
    disciplineId: '10', take: '500', skip: '0', page: '1', pageSize: '500',
    'sort[0][field]': 'StartDate', 'sort[0][dir]': 'desc',
    'filter[filters][0][field]': 'RaceTypeId', 'filter[filters][0][value]': '0',
    'filter[filters][1][field]': 'CategoryId', 'filter[filters][1][value]': '0',
    'filter[filters][2][field]': 'SeasonId', 'filter[filters][2][value]': String(seasonId),
  }).toString();
  const res = await fetch('https://dataride.uci.ch/iframe/Competitions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA },
    body,
  });
  const j = await res.json();
  return (j && j.data) || [];
}

// ── CN a nivel de PRUEBA ────────────────────────────────────────────────────
// La UCI publica un Campeonato Nacional entero bajo UN competitionId, con cada prueba
// (línea/CRI × élite/sub23 × M/F) como una "race" de DataRide aparte (su race.Id), p. ej.
// #77913 (Hungría) → {255758 "Men Junior - IRR", 265479 "Men Under 23 - IRR", …}. En
// nuestra BD cada prueba es una ficha (one_day, uciCategory='CN'). Para enlazar ficha↔prueba
// descendemos a Races/ de la competición y casamos por (edad, género, tipo) de forma
// ESTRUCTURADA — el CategoryCode de DataRide ("Men Under 23"/"Women Junior"/"Men Elite") y
// el RaceTypeCode (IRR/ITT) son enums limpios; solo nuestro nameEn se parsea. Los Junior se
// descartan (no tenemos fichas junior). Sostiene la aparición incremental: una prueba aún no
// publicada por la UCI simplemente no aparece en Races/ → la ficha queda sin cnMatch y se
// reintenta en la siguiente pasada (el evening corre a diario).
let CN_COOKIE = '';
async function cnSeedCookie() {
  try {
    const res = await fetch('https://dataride.uci.ch/', { headers: { 'User-Agent': UA } });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    CN_COOKIE = (sc || []).map((c) => c.split(';')[0]).join('; ');
  } catch { CN_COOKIE = ''; }
}
async function cnUciPost(path, formObj) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA };
  if (CN_COOKIE) headers.Cookie = CN_COOKIE;
  const res = await fetch(`https://dataride.uci.ch/iframe/${path}`, { method: 'POST', headers, body: new URLSearchParams(formObj).toString() });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}
// Descompone una prueba en sus tres dimensiones discriminantes. Devuelve null si no se puede
// (→ no casar). 'age': 'elite' | 'u23' | 'junior'. 'type': 'rr' | 'itt' | 'ttt'. 'gender'.
// (A) NUESTRA ficha, desde nameEn ("Hungarian Championships - Men's U23 ITT"):
function cnDecodeOurs(r) {
  const n = ` ${(r.nameEn || r.name || '').toLowerCase()} `;
  const gender = r.gender === 'female' ? 'female' : 'male';
  const age = /\bu23\b|under ?23|sub ?23/.test(n) ? 'u23' : /\bjunior/.test(n) ? 'junior' : 'elite';
  const type = /\bttt\b|team time trial/.test(n) ? 'ttt'
    : /\bitt\b|time trial|\bcri\b|crono/.test(n) ? 'itt'
    : /\brr\b|road race|\blínea\b|\blinea\b|\bin line\b/.test(n) ? 'rr' : null;
  return type ? { age, gender, type } : null;
}
// (B) la "race" de DataRide, desde CategoryCode + RaceTypeCode (enums limpios):
function cnDecodeUci(race) {
  const cat = (race.CategoryCode || race.RaceName || '').toLowerCase();
  const rtc = (race.RaceTypeCode || '').toUpperCase();
  const gender = /\bwomen\b|\bwoman\b/.test(cat) ? 'female' : /\bmen\b/.test(cat) ? 'male' : null;
  const age = /under ?23|\bu23\b/.test(cat) ? 'u23' : /\bjunior/.test(cat) ? 'junior' : /\belite\b/.test(cat) ? 'elite' : 'elite';
  const type = rtc === 'TTT' ? 'ttt' : rtc === 'ITT' ? 'itt' : rtc === 'IRR' ? 'rr' : null;
  return (gender && type) ? { age, gender, type, raceId: race.Id, raceName: clean(race.RaceName) } : null;
}
// Cache de Races/ por competitionId (1 descenso por campeonato, repartido a sus fichas).
const _cnRacesCache = new Map();
async function cnFetchRaces(competitionId) {
  if (_cnRacesCache.has(competitionId)) return _cnRacesCache.get(competitionId);
  let list = [];
  try {
    const races = await cnUciPost('Races/', { disciplineId: '10', competitionId: String(competitionId), take: 60, skip: 0, page: 1, pageSize: 60 });
    list = (races && races.data) || [];
  } catch (e) { log(`    ⚠️  CN Races/ #${competitionId}: ${e.message}`); list = null; }
  _cnRacesCache.set(competitionId, list);
  return list;
}
// Casa una ficha CN contra las pruebas publicadas de una competición. Devuelve la prueba
// única que coincide en (edad, género, tipo), o null. null también si Races/ falló (list===null)
// o si la prueba aún no está publicada (reintento en la siguiente pasada).
async function cnMatchEvent(competitionId, ours) {
  const want = cnDecodeOurs(ours);
  if (!want) return null;
  const list = await cnFetchRaces(competitionId);
  if (!Array.isArray(list)) return null;
  const cand = list.map(cnDecodeUci).filter(Boolean)
    .filter((e) => e.age !== 'junior') // nunca tenemos fichas junior
    .filter((e) => e.age === want.age && e.gender === want.gender && e.type === want.type);
  if (cand.length !== 1) return null;   // 0 = no publicada aún · ≥2 = ambiguo (no debería pasar)
  return { competitionId, uciRaceId: cand[0].raceId, uciRaceName: cand[0].raceName };
}

// ── matcher ────────────────────────────────────────────────────────────────
function scoreCandidate(ours, oTok, c, uGender) {
  const cTok = nameTokens(c.CompetitionName);
  const nameSim = jaccard(oTok, cTok);
  const classMatch = normClass(ours.uciCategory) === normClass(c.ClassCode);
  // genderMatch: el género UCI INEQUÍVOCO del candidato coincide con el nuestro.
  // Clave para parejas masc/fem que la UCI lista como dos competiciones (Scheldeprijs
  // "vrouwen elite" #77415 vs "Scheldeprijs" #77416): nuestra carrera femenina debe
  // preferir la femenina aunque su nombre puntúe peor (los tokens "vrouwen/WE/ladies"
  // bajan el Jaccard). Se ordena ANTES que el nombre. uGender null (clase ambigua) no
  // suma ni resta — solo el match explícito desempata.
  const ourG = ours.gender === 'female' ? 'female' : 'male';
  const genderMatch = uGender != null && uGender === ourG;
  return { nameSim, classMatch, genderMatch };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const seasonId = ROAD_SEASON[YEAR];
  if (!seasonId) throw new Error(`No conozco el seasonId road de ${YEAR}; añádelo a ROAD_SEASON`);

  log(`Matcher PoC — año ${YEAR} (road seasonId ${seasonId}), slack ${SLACK}d`);
  const [oursAll, uci] = await Promise.all([fetchOurRaces(YEAR), fetchUciRoad(seasonId)]);

  // La UCI publica con ~1-2 meses de antelación: la última competición publicada marca el
  // HORIZONTE. Carreras nuestras MÁS ALLÁ de ese horizonte aún no existen del lado UCI →
  // medir el matcher contra ellas sería injusto. Calculamos el horizonte y reportamos las dos
  // cosas: cobertura sobre lo PUBLICABLE y total.
  const uciDays = uci.map((c) => dotnetDay(c.StartDate)).filter((x) => x != null);
  const HORIZON = uciDays.length ? Math.max(...uciDays) : null;
  const horizonISO = HORIZON != null ? new Date(HORIZON).toISOString().slice(0, 10) : '∞';
  // Excluir CANCELADAS: una carrera no disputada (isCancelled) no tiene resultados en la UCI,
  // así que jamás debe casar. Si las dejásemos, solaparían en fecha/país a competiciones ajenas
  // y caerían en 'ambiguous'/'none', ensuciando para siempre la revisión «Resultados UCI» del
  // panel. Excluirlas aquí (única fuente del matching → propaga a backfill y al cron de
  // descubrimiento) es además auto-mantenible: marcar una carrera cancelada en el panel la saca.
  const cancelled = oursAll.filter((r) => r.isCancelled);
  const ours = oursAll.filter((r) => !r.isCancelled);
  if (cancelled.length) log(`Excluidas ${cancelled.length} carreras canceladas (isCancelled) — no se casan con la UCI.`);
  const inHorizon = (r) => HORIZON == null || (isoDay(r.startDate) ?? Infinity) <= HORIZON + SLACK * DAY;

  log(`Nuestras carreras ${YEAR}: ${ours.length}  |  Competiciones road UCI: ${uci.length}`);
  log(`Horizonte UCI (última publicada): ${horizonISO} → ${ours.filter(inHorizon).length} carreras nuestras dentro del horizonte\n`);

  // pre-cómputo de intervalos UCI
  const uciPrep = uci.map((c) => ({
    c,
    b0: dotnetDay(c.StartDate), b1: dotnetDay(c.EndDate),
    iso2: (c.CountryIsoCode2 || '').toLowerCase(),
    gender: uciGender(c),                       // 'female'|'male'|null(ambiguo)
    junior: isJuniorName(c.CompetitionName),
  }));

  const buckets = { unique: [], ambiguous: [], none: [] };

  // Cookie para el descenso CN a Events/ (Races/ no la necesita, pero la sembramos una vez
  // por si acaso). Solo se usa si hay alguna ficha CN; barato si no.
  if (ours.some((r) => normClass(r.uciCategory) === 'CN')) await cnSeedCookie();

  for (const r of ours) {
    const a0 = isoDay(r.startDate), a1 = isoDay(r.endDate);
    // Nombre de matching: nameEn (oficial/local, = el de la UCI) → originalName → name (ES, último recurso).
    const matchName = r.nameEn || r.originalName || r.name;
    const oTok = nameTokens(matchName);
    const ourWomen = r.gender === 'female';

    // País nuestro: puede traer subdivisión ("es-pv","ES-CT") → quedarnos con el país ISO base.
    const ourCountry = (r.countryCode || '').toLowerCase().split('-')[0];

    // 1) candidatos por FECHA + PAÍS
    let cands = uciPrep.filter((u) =>
      overlap(a0, a1, u.b0, u.b1, SLACK) &&
      (!ourCountry || !u.iso2 || u.iso2 === ourCountry));

    // 1.b) RAMA CN — Campeonato Nacional: cada prueba (línea/CRI × élite/sub23 × M/F) es una
    //      ficha nuestra distinta, pero la UCI las publica TODAS bajo un único competitionId
    //      (la competición CN del país). En vez de casar a nivel de competición (colisionarían
    //      las 6-7 fichas), descendemos a las "races" de esa competición y casamos la ficha con
    //      su PRUEBA concreta por (edad, género, tipo). Se emite cnMatch{competitionId,uciRaceId}.
    //      Si la prueba aún no está publicada → cae a 'none' y se reintenta en la próxima pasada.
    if (normClass(r.uciCategory) === 'CN') {
      const recCN = {
        our: { id: r.id, name: r.name, nameEn: r.nameEn, matchName, slug: r.slug, class: r.uciCategory, gender: r.gender, country: r.countryCode, dates: [r.startDate, r.endDate] },
      };
      // competiciones CN candidatas (clase CN) que solapan en fecha+país; normalmente 1.
      const cnComps = [...new Set(cands.filter((u) => normClass(u.c.ClassCode) === 'CN').map((u) => u.c.CompetitionId))];
      let cn = null;
      for (const compId of cnComps) {
        cn = await cnMatchEvent(compId, r);                  // memoizado por competición
        if (cn) break;
      }
      if (cn) {
        recCN.cnMatch = cn;
        buckets.unique.push(recCN);
      } else {
        recCN.cnPending = { comps: cnComps };                // dato útil para depurar
        buckets.none.push(recCN);
      }
      continue;   // las CN no pasan por el matcher por-competición de abajo
    }

    // 2) filtro de GÉNERO: descartar solo cuando el género UCI es INEQUÍVOCO y opuesto
    //    (los ambiguos null se quedan; la clase los desempata abajo). Anti-JUNIOR siempre.
    const ourG = ourWomen ? 'female' : 'male';
    cands = cands.filter((u) => u.gender == null || u.gender === ourG);
    cands = cands.filter((u) => !u.junior); // nuestras carreras nunca son junior

    // 3) score por GÉNERO → clase → nombre, ordenar. El género (cuando es
    //    inequívoco y coincide) manda sobre el nombre: separa correctamente las
    //    parejas masc/fem que la UCI lista como dos competiciones.
    const scored = cands.map((u) => ({ u, ...scoreCandidate(r, oTok, u.c, u.gender) }))
      .sort((x, y) => (y.genderMatch - x.genderMatch) || (y.classMatch - x.classMatch) || (y.nameSim - x.nameSim));

    // 4) clasificar resultado
    const rec = {
      our: { id: r.id, name: r.name, nameEn: r.nameEn, matchName, slug: r.slug, class: r.uciCategory, gender: r.gender, country: r.countryCode, dates: [r.startDate, r.endDate] },
    };
    if (scored.length === 0) {
      buckets.none.push(rec);
    } else if (scored.length === 1) {
      const s = scored[0];
      // Un único candidato por proximidad fecha+país NO basta: exige una señal de
      // IDENTIDAD — clase compatible O nombre con algún solape (sim>0). Sin ninguna
      // (clase distinta Y sim=0) es un falso positivo: típicamente una carrera nuestra
      // NO DISPUTADA (suspendida) que la UCI nunca publicó → 'none', no forzar enlace
      // a una competición ajena cercana en fecha (p.ej. Magna Grecia→S.Vendemiano).
      if (s.classMatch || s.nameSim > 0) {
        rec.match = { competitionId: s.u.c.CompetitionId, uciName: s.u.c.CompetitionName, uciClass: s.u.c.ClassCode, classMatch: s.classMatch, nameSim: +s.nameSim.toFixed(2) };
        buckets.unique.push(rec);
      } else {
        rec.rejected = { competitionId: s.u.c.CompetitionId, uciName: s.u.c.CompetitionName, uciClass: s.u.c.ClassCode, reason: 'único candidato sin clase ni nombre en común (carrera no disputada / sin equivalente)' };
        buckets.none.push(rec);
      }
    } else {
      // ≥2 candidatos → decidir si hay ganador claro o es ambiguo de verdad.
      const classWinners = scored.filter((s) => s.classMatch);
      const genderWinners = scored.filter((s) => s.genderMatch);     // género UCI = el nuestro
      const classAndName = scored.filter((s) => s.classMatch && s.nameSim > 0);
      const top = scored[0], second = scored[1];
      const dSim = top.nameSim - second.nameSim;

      // Cada regla nombra EXPLÍCITAMENTE al candidato que enlaza (winner) — nunca asume
      // que el top es el adecuado. Una grande (Giro, 3 semanas) solapa en fecha decenas
      // de carreras pequeñas del mismo país y aparece como candidata de todas; si la
      // regla enlazara el top a ciegas, una 1.2 de un día colgaría del Giro. Por eso:
      //  · winner se elige a propósito,
      //  · y al final se EXIGE que el winner tenga señal de identidad (clase|género|nombre).
      let winner = null, note = null;

      // (g) GÉNERO: único candidato cuyo género UCI inequívoco coincide Y casa clase →
      //     gana. Resuelve parejas masc/fem que la UCI publica separadas (Scheldeprijs
      //     "vrouwen elite" #77415 para la femenina). El género manda sobre el nombre.
      if (genderWinners.length === 1 && genderWinners[0].classMatch) {
        winner = genderWinners[0]; note = 'género coincide (masc/fem separadas en UCI)';
      }
      // (a) sólo UNO casa la clase → ese (no el top) gana. Pero exige una pizca de
      //     identidad además de la clase: nombre en común O género coincidente. Una
      //     clase compartida por mera coincidencia de calendario (1.2 de un día durante
      //     el Giro… no aplica porque clase difiere; pero dos 2.1 italianas el mismo día
      //     sí) no basta sola → si el único classWinner no tiene nombre ni género, es
      //     ambiguo, no unique.
      else if (classWinners.length === 1 && (classWinners[0].nameSim > 0 || classWinners[0].genderMatch)) {
        winner = classWinners[0]; note = 'única que casa clase';
      }
      // (b) el NOMBRE desempata: top casa clase y su nombre domina claramente al 2º.
      else if (top.classMatch && top.nameSim >= 0.33 && dSim >= 0.15) {
        winner = top; note = 'nombre domina';
      }
      // (b2) ÚNICO con palabra en común: el único candidato que casa clase Y tiene sim>0
      //      ("Trofeo Andratx"→"…- Pollença" sim=0.17, resto 0).
      else if (classAndName.length === 1) {
        winner = classAndName[0]; note = 'único con nombre en común';
      }
      // (c) DUPLICADO UCI: top y 2º casan clase con el MISMO nombre alto (≥0.5, sim≈igual)
      //     → la misma carrera repetida en DataRide. Tomar 1º. Solo si el género no separa.
      else if (top.classMatch && second.classMatch && top.nameSim >= 0.5 && Math.abs(dSim) <= 0.1 && genderWinners.length !== 1) {
        winner = top; note = 'duplicado UCI (mismo nombre ×2) → 1º';
      }

      // Guardia maestra: el winner DEBE tener al menos una señal de identidad real.
      // Un candidato con clase≠, género≠ y nombre=0 (típico de una carrera nuestra NO
      // disputada que solo solapa en fecha/país a una grande) NO es match → ambiguo.
      const hasSignal = winner && (winner.classMatch || winner.genderMatch || winner.nameSim > 0);

      if (winner && hasSignal) {
        rec.match = { competitionId: winner.u.c.CompetitionId, uciName: winner.u.c.CompetitionName, uciClass: winner.u.c.ClassCode, classMatch: winner.classMatch, nameSim: +winner.nameSim.toFixed(2), note };
        rec.alsoConsidered = scored.length;
        buckets.unique.push(rec);
      } else {
        rec.candidates = scored.slice(0, 4).map((s) => ({ competitionId: s.u.c.CompetitionId, uciName: s.u.c.CompetitionName, uciClass: s.u.c.ClassCode, classMatch: s.classMatch, nameSim: +s.nameSim.toFixed(2) }));
        buckets.ambiguous.push(rec);
      }
    }
  }

  // ── DES-COLISIÓN GLOBAL ────────────────────────────────────────────────────
  // race_uci_links tiene UNIQUE(competitionId, disciplineId, uciRaceId): la unidad de
  // unicidad es la PRUEBA. Para todo lo no-CN (r.match) la prueba es 0 (competición entera)
  // → la clave es competitionId|0 y dos carreras con el mismo competitionId colisionan
  // (típico: la UCI lista UNA competición ambigua .1/.2 sin género para un par masc/fem).
  // Para CN (r.cnMatch) la clave es competitionId|uciRaceId → varias fichas CN del MISMO
  // campeonato NO colisionan (cada una apunta a su prueba); solo colisionarían dos fichas
  // que casaran la misma prueba (no debería ocurrir: cnMatchEvent exige match único).
  const collKey = (r) => r.cnMatch
    ? `${r.cnMatch.competitionId}|${r.cnMatch.uciRaceId}`
    : `${r.match.competitionId}|0`;
  const byComp = new Map();
  for (const r of buckets.unique) {
    const k = collKey(r);
    (byComp.get(k) || byComp.set(k, []).get(k)).push(r);
  }
  const collided = new Set();
  for (const [, group] of byComp) {
    if (group.length < 2) continue;
    for (const r of group) {
      collided.add(r);
      const compId = r.cnMatch ? r.cnMatch.competitionId : r.match.competitionId;
      const uciName = r.cnMatch ? r.cnMatch.uciRaceName : r.match.uciName;
      r.collision = {
        competitionId: compId, uciName,
        rivals: group.filter((x) => x !== r).map((x) => ({ id: x.our.id, name: x.our.name, class: x.our.class, gender: x.our.gender })),
      };
      r.candidates = r.cnMatch
        ? [{ competitionId: compId, uciName, uciClass: 'CN', classMatch: true, nameSim: 1 }]
        : [{ competitionId: r.match.competitionId, uciName: r.match.uciName, uciClass: r.match.uciClass, classMatch: r.match.classMatch, nameSim: r.match.nameSim }];
      delete r.match;            // ya no es un enlace firme
      delete r.cnMatch;
    }
  }
  if (collided.size) {
    buckets.unique = buckets.unique.filter((r) => !collided.has(r));
    buckets.ambiguous.push(...collided);
    log(`Des-colisión: ${collided.size} carreras movidas a ambiguo por competitionId compartido.`);
  }

  // Marcar cada rec con si está dentro del horizonte (para segmentar la métrica).
  const tag = (arr) => arr.map((r) => ({ ...r, inHorizon: inHorizon({ startDate: r.our.dates[0] }) }));
  buckets.unique = tag(buckets.unique); buckets.ambiguous = tag(buckets.ambiguous); buckets.none = tag(buckets.none);

  // Cobertura JUSTA: solo carreras dentro del horizonte UCI (las que YA podrían existir).
  const inH = (arr) => arr.filter((r) => r.inHorizon).length;
  const totH = ours.filter(inHorizon).length;
  const noneOutH = buckets.none.filter((r) => !r.inHorizon).length;

  const report = {
    year: YEAR, seasonId, slackDays: SLACK, generatedAt: new Date().toISOString(),
    horizonISO,
    counts: {
      total: ours.length,
      unique: buckets.unique.length, ambiguous: buckets.ambiguous.length, none: buckets.none.length,
      withinHorizon: totH,
      uniqueWithinHorizon: inH(buckets.unique), ambiguousWithinHorizon: inH(buckets.ambiguous), noneWithinHorizon: inH(buckets.none),
      noneBeyondHorizon: noneOutH, // sin match porque aún no publicadas (esperado)
    },
    unique: buckets.unique, ambiguous: buckets.ambiguous, none: buckets.none,
  };
  writeFileSync(join(OUT, 'match-report.json'), JSON.stringify(report, null, 2));

  const pctH = (n) => `${n} (${totH ? (100 * n / totH).toFixed(1) : 0}% del publicable)`;
  log('═'.repeat(60));
  log(`MÉTRICA JUSTA — solo carreras dentro del horizonte UCI (≤ ${horizonISO}):`);
  log(`  universo publicable           : ${totH} carreras`);
  log(`  ✅ match único/claro          : ${pctH(inH(buckets.unique))}`);
  log(`  ⚠️  ambiguo (≥2)              : ${pctH(inH(buckets.ambiguous))}`);
  log(`  ∅  sin match (revisar)        : ${pctH(inH(buckets.none))}`);
  log('─'.repeat(60));
  log(`CONTEXTO — total ${YEAR} (incluye futuras no publicadas):`);
  log(`  ✅ ${buckets.unique.length}  ⚠️ ${buckets.ambiguous.length}  ∅ ${buckets.none.length} (de las cuales ${noneOutH} son futuras aún sin publicar en la UCI)`);
  log('═'.repeat(60));
  log(`Reporte → ${join(OUT, 'match-report.json')}`);

  if (SHOW) {
    log('\n── AMBIGUAS (revisar) ──');
    buckets.ambiguous.slice(0, 40).forEach((r) => {
      log(`  «${r.our.name}» [${r.our.class}/${r.our.gender}] ${r.our.dates[0]}→${r.our.dates[1]}`);
      r.candidates.forEach((c) => log(`      ${c.classMatch ? '✓' : ' '}clase ${String(c.uciClass).padEnd(6)} sim=${c.nameSim}  #${c.competitionId} ${c.uciName}`));
    });
    log('\n── SIN MATCH (muestra) ──');
    buckets.none.slice(0, 40).forEach((r) => log(`  «${r.our.name}» [${r.our.class}/${r.our.gender}] ${r.our.dates[0]}→${r.our.dates[1]} (${r.our.country})`));
  }
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
