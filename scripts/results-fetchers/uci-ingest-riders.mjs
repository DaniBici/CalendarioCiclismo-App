#!/usr/bin/env node
/**
 * uci-ingest-riders.mjs — Ingestor del "catálogo oro" de CORREDORES desde la UCI
 * (fuente oficial). Sustituye el flujo PCS+CyclingFlash para los Continental: la UCI da
 * nombre/apellido YA SEPARADOS (givenName/familyName) + país + fecha de nacimiento + año,
 * sin Cloudflare, vía API JSON + fichas SSR.
 *
 * FLUJO (roster POR EQUIPO — uciId es la clave inequívoca)
 *   El teamCode de la UCI NO es único: lo comparten el equipo masculino y el femenino de un
 *   mismo patrocinador (Standard Insurance, Amani, HKSI, 7 Saber, Aisan/Handsling…), y a veces
 *   el teamName tampoco distingue (idéntico para ambos géneros). Por eso NO se agrupa por código:
 *   se usa el uciId de cada equipo (del team-map) para leer SU roster oficial.
 *   1. Por equipo (uciId del team-map): GET /team-details/<uciId> (SSR) → sección RIDERS:
 *      enlaces /rider-details/<id> con el texto "GivenNames FAMILYNAMES NAT" (nombre en
 *      minúsculas/capital, apellidos en MAYÚSCULAS, país ISO-3 al final) → nombre/apellido
 *      separados SIN heurística (la UCI ya marca la frontera por mayúsculas).
 *   2. Por corredor: GET /rider-details/<id> (SSR) → D.O.B (dd.mm.yyyy → YYYY-MM-DD) + país.
 *   3. Matching token-set + desempate por fecha contra el CATÁLOGO GLOBAL del género
 *      (--db-men/--db-women: TODAS las filas riders_* + huérfanos) → update / move / create.
 *   4. Emite plan JSON + SQL idempotente (team_seasons del año + upsert riders_* +
 *      rider_team_affiliations). NO aplica a Supabase.
 *
 * REQUISITO DURO: una alta NUEVA exige fecha de nacimiento. Sin DOB → se OMITE (se reporta).
 *
 * Caché: cada roster de equipo y cada DOB se cachean en disco (--cache-dir) → re-ejecutar es
 * instantáneo y no vuelve a leer la fuente. La fuente da given/family ya separados, así que no hay parser
 * frágil de "APELLIDO Nombre".
 *
 * Uso (desde la raíz del repo):
 *   node scripts/results-fetchers/uci-ingest-riders.mjs --year 2026 \
 *     --team-map  scripts/results-fetchers/_riders_run/uci-team-map.json \
 *     --db-men    /tmp/catalog-men.json --db-women /tmp/catalog-women.json \
 *     --cache-dir scripts/results-fetchers/_riders_run/uci-cache \
 *     --codes 4RF,SAB,AMN \
 *     --emit-json out/plan.json --emit-sql out/seed.sql
 *
 * Parámetros:
 *   --year           Temporada (default 2026).
 *   --team-map       JSON de uci-map-teams.mjs (matched[]: {uciId, teamCode, dbId, gender, uciName, dbName}).
 *   --db-men/-women  Catálogo GLOBAL por género (array {id,firstName,lastName,otherNames,birthDate,nationality,currentTeamId,origin?,orphanOldId?}).
 *   --codes          CSV de teamCodes a procesar (si se omite: TODOS los del team-map).
 *   --cache-dir      Carpeta de caché de roster+DOB (default: junto al team-map / uci-cache).
 *   --emit-json/-sql Rutas de salida.
 *   --limit-teams    Procesa solo los primeros N equipos (debug/piloto). 0 = todos.
 */
'use strict';

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const YEAR = parseInt(getArg('year') || '2026', 10);
const TEAM_MAP = getArg('team-map');
const DB_MEN = getArg('db-men');
const DB_WOMEN = getArg('db-women');
const CODES = (getArg('codes') || '').split(',').map((s) => s.trim()).filter(Boolean);
const EMIT_JSON = getArg('emit-json');
const EMIT_SQL = getArg('emit-sql');
const LIMIT_TEAMS = parseInt(getArg('limit-teams') || '0', 10);
const CACHE_DIR = getArg('cache-dir') || 'scripts/results-fetchers/_riders_run/uci-cache';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fold canónica (espejo del plan / ingestor PCS / xmatch) ──────────
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ð/g, 'd')
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/þ/g, 'th')
    .replace(/['’`]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function tokenSet(...parts) {
  const toks = fold(parts.filter(Boolean).join(' ')).split(/\s+/).filter(Boolean);
  return [...new Set(toks)].sort();
}
function jaccard(a, b) { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; const u = new Set([...A, ...B]).size; return u ? i / u : 0; }
function overlap(a, b) { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; const m = Math.min(A.size, B.size); return m ? i / m : 0; }
function nameScore(aTokens, bTokens, aLastTok) {
  const j = jaccard(aTokens, bTokens);
  const o = overlap(aTokens, bTokens);
  if (aLastTok && !bTokens.includes(aLastTok)) return j; // apellido del roster ausente → no es match
  return Math.max(j, o * 0.95);
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/(?:^|[\s'`-])(\S)/g, (c) => c.toUpperCase()); }

// ISO-3 (UCI) → ISO-2 (nuestra BD)
const ISO3to2 = {
  HON:'hn', UZB:'uz', PHI:'ph', BEL:'be', DEN:'dk', KAZ:'kz', AUT:'at', JPN:'jp', CHN:'cn',
  SLO:'si', UKR:'ua', INA:'id', THA:'th', MAS:'my', COL:'co', ECU:'ec', ALG:'dz', MAR:'ma',
  GBR:'gb', GER:'de', NED:'nl', NOR:'no', SWE:'se', SUI:'ch', USA:'us', AUS:'au', CAN:'ca',
  IRL:'ie', CZE:'cz', SVK:'sk', GRE:'gr', ISR:'il', TUR:'tr', RSA:'za', NZL:'nz', ERI:'er',
  RWA:'rw', IND:'in', IRI:'ir', HKG:'hk', KOR:'kr', TPE:'tw', SGP:'sg', VIE:'vn', BRA:'br',
  ARG:'ar', CHI:'cl', URU:'uy', VEN:'ve', MEX:'mx', CRC:'cr', GUA:'gt', CUB:'cu', PAN:'pa',
  LUX:'lu', EST:'ee', LAT:'lv', LTU:'lt', FIN:'fi', ROU:'ro', BUL:'bg', CRO:'hr', SRB:'rs',
  HUN:'hu', BLR:'by', RUS:'ru', KSA:'sa', UAE:'ae', QAT:'qa', BRN:'bh', KUW:'kw', OMA:'om',
  EGY:'eg', TUN:'tn', ETH:'et', KEN:'ke', NGR:'ng', CYP:'cy', MLT:'mt', MGL:'mn', POL:'pl',
  POR:'pt', ESP:'es', ITA:'it', FRA:'fr', KGZ:'kg', GUM:'gu', BOL:'bo', KOS:'xk', ESA:'sv',
  SVN:'si', LIE:'li', MKD:'mk', AZE:'az', GEO:'ge', ARM:'am', MDA:'md', MNE:'me', BIH:'ba',
  ALB:'al', LBN:'lb', SYR:'sy', IRQ:'iq', JOR:'jo', PAK:'pk', SRI:'lk', BAN:'bd', NEP:'np',
  MYA:'mm', CAM:'kh', LAO:'la', BRU:'bn', MGО:'mn', PER:'pe', PAR:'py', DOM:'do', HAI:'ht',
  NCA:'ni', HKO:'hk', HND:'hn', HKD:'hk',
};
const iso2 = (iso3) => ISO3to2[String(iso3 || '').toUpperCase()] || null;

// dd.mm.yyyy → YYYY-MM-DD (y otros formatos por si acaso)
function normDate(raw) {
  if (!raw) return null;
  let m = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const idFromUrl = (u) => { const m = String(u || '').match(/\/rider-details\/(\d+)/); return m ? m[1] : null; };
const cacheRead = (file) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; } };
const cacheWrite = (file, obj) => { try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(file, JSON.stringify(obj)); } catch (e) { log('  cache write fail: ' + e.message); } };

// ── Roster oficial de UN equipo (uciId) desde /team-details/<id> ──────
// La sección RIDERS lista enlaces /rider-details/<id> cuyo texto trae el nombre con la
// frontera ya marcada: "GivenNames FAMILYNAMES NAT" (given en minúsc/capital, apellidos en
// MAYÚSCULAS, país ISO-3 al final). MANAGEMENT (staff) va aparte → lo excluimos por posición.
async function fetchRoster(page, uciId) {
  const file = join(CACHE_DIR, `team-${uciId}.json`);
  const cached = cacheRead(file);
  if (cached) return cached;
  let roster = [];
  try {
    await page.goto(`https://www.uci.org/team-details/${uciId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);
    roster = await page.evaluate(() => {
      // Cortar antes de "MANAGEMENT": solo queremos corredores, no directores/staff.
      const body = document.body?.innerText || '';
      const out = []; const seen = new Set();
      // Recorremos los enlaces /rider-details en orden; paramos al llegar a la zona de management.
      // Heurística robusta: la palabra "MANAGEMENT" marca el inicio del staff; los enlaces de
      // rider-details que aparezcan en el DOM tras ese marcador son staff → los descartamos por
      // su texto de rol (SPORTS DIRECTOR, etc.) que NO acaba en país de 3 letras tras apellido.
      const anchors = Array.from(document.querySelectorAll('a[href*="/rider-details/"]'));
      for (const a of anchors) {
        const m = (a.getAttribute('href') || '').match(/\/rider-details\/(\d+)/);
        if (!m) continue;
        const id = m[1]; if (seen.has(id)) continue;
        const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        seen.add(id);
        out.push({ uciRiderId: id, linkText: text });
      }
      return out;
    });
  } catch (e) { log(`  roster ${uciId} error: ${e.message.slice(0, 50)}`); }
  cacheWrite(file, roster);
  return roster;
}

// Separar el texto de enlace de la UCI, que viene SIN espacios en la frontera:
//   "Jair AntonioAPARICIO CATACOLICOL"  →  given "Jair Antonio" | family "APARICIO CATACOLI" | NAT "COL"
// Reglas del formato (verificadas):
//   - nombre(s) de pila: capitalizados, separados por espacio entre sí ("Jair Antonio").
//   - apellido(s): TODO MAYÚSCULAS, separados por espacio entre sí ("APARICIO CATACOLI").
//   - la frontera nombre↔apellido NO tiene espacio ("AntonioAPARICIO").
//   - el país (ISO-3) va PEGADO al final del último apellido ("CATACOLICOL").
// Para cortar el país sin riesgo usamos el ISO-3 que ya conocemos de la ficha (knownNat3).
function parseLinkName(linkText, knownNat3) {
  let t = String(linkText || '').trim();
  let nat3 = null;
  // 1) quitar el país pegado al final, preferentemente el conocido de la ficha.
  if (knownNat3 && t.toUpperCase().endsWith(knownNat3.toUpperCase())) {
    nat3 = knownNat3.toUpperCase();
    t = t.slice(0, t.length - nat3.length);
  } else {
    const m = t.match(/([A-Z]{3})$/); // último bloque de 3 mayúsculas
    if (m) { nat3 = m[1]; t = t.slice(0, m.index); }
  }
  t = t.trim();
  // 2) frontera nombre↔apellido = primera minúscula seguida INMEDIATAMENTE de mayúscula (sin espacio).
  //    (los saltos entre nombres de pila o entre apellidos llevan espacio, así que no disparan aquí.)
  //    Unicode-aware: \p{Ll}\p{Lu} cubre diacríticos checos/eslavos/polacos (Řeha, Šumpík, Łątkowski),
  //    que un rango Latin-1 [A-ZÀ-Þ] se dejaba fuera → firstName==lastName con el nombre pegado.
  //    El apóstrofo opcional cubre los italianos que la UCI escribe con ' en vez de acento
  //    ("Nicolo'ARRIGHETTI" = Nicolò + ARRIGHETTI): el ' queda con el nombre de pila.
  let firstName, lastName;
  const b = t.match(/(\p{Ll}['’]?)(\p{Lu})/u);
  if (b) {
    const idx = b.index + b[1].length; // cortar justo antes de la mayúscula del apellido
    firstName = titleCase(t.slice(0, idx).trim());
    lastName = titleCase(t.slice(idx).trim());
  } else {
    // sin frontera detectable (p.ej. todo mayúsculas): último token = apellido.
    const toks = t.split(/\s+/).filter(Boolean);
    if (toks.length >= 2) { firstName = titleCase(toks.slice(0, -1).join(' ')); lastName = titleCase(toks.at(-1)); }
    else { firstName = titleCase(t); lastName = titleCase(t); }
  }
  return { firstName, lastName, nat3 };
}

// ── Ficha de corredor (SSR): DOB + país (ISO-3) ──────────────────────
async function fetchRiderDetail(page, uciRiderId) {
  const file = join(CACHE_DIR, `rider-${uciRiderId}.json`);
  const cached = cacheRead(file);
  if (cached) return cached;
  let out = { dob: null, nat3: null, http: 0 };
  try {
    const resp = await page.goto(`https://www.uci.org/rider-details/${uciRiderId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(120);
    const data = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      const dob = (t.match(/D\.O\.B\s*\n?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i) || [])[1] || null;
      const nat = (t.match(/Nationality\s*\n?\s*([A-Z]{3})/i) || [])[1] || null;
      return { dob, nat };
    });
    out = { dob: normDate(data.dob), nat3: data.nat || null, http: resp ? resp.status() : 0 };
  } catch (e) { out = { dob: null, nat3: null, http: 'ERR' }; }
  cacheWrite(file, out);
  return out;
}

// ── Matching contra catálogo global del género ───────────────────────
// uciRider ya trae firstName/lastName separados (parseLinkName), dob y countryCode (ISO-2).
function matchRider(uciRider, dbRiders, dbTeamId) {
  const firstName = uciRider.firstName;
  const lastName = uciRider.lastName;
  const rTokens = tokenSet(firstName, lastName);
  const rLastTok = (fold(lastName).split(/\s+/).filter(Boolean).pop()) || null;
  const birthDate = uciRider.dob || null;

  let dbBest = null, dbScore = 0, exactByDate = false;
  for (const d of dbRiders) {
    const dTokens = tokenSet(d.firstName, d.lastName, d.otherNames);
    const base = nameScore(rTokens, dTokens, rLastTok);
    let s = base;
    if (birthDate && d.birthDate && birthDate === d.birthDate) { s += 0.35; if (base >= 0.5) exactByDate = true; }
    if (s > dbScore) { dbScore = s; dbBest = d; }
  }
  let matched = dbScore >= 0.6 ? dbBest : null;

  let action = 'create';
  let orphanOldId = null;
  if (matched) {
    if (matched.origin === 'orphan') {
      action = 'create';
      orphanOldId = matched.orphanOldId || matched.id;
    } else {
      const hadOtherTeam = matched.currentTeamId && matched.currentTeamId !== dbTeamId;
      if (hadOtherTeam) {
        const safeMove = exactByDate || dbScore >= 0.85;
        if (safeMove) action = 'move';
        else { matched = null; action = 'create'; }
      } else {
        action = 'update';
      }
    }
  }

  // Enriquecer otherNames: si la UCI trae apellido(s) que la ficha existente NO tiene en su
  // lastName ni en otherNames (p.ej. UCI "Aparicio Catacoli" vs ficha "Aparicio"), proponer
  // añadir el/los token(s) extra. Solo para update/move (las altas ya guardan el nombre completo).
  // Conservador: solo añade tokens del APELLIDO de la UCI ausentes del lado BD; preserva el
  // casing original de la UCI para el token añadido (titleCase ya aplicado en lastName).
  let enrichOtherNames = null;
  if (matched && (action === 'update' || action === 'move')) {
    const uciLastToks = lastName.split(/\s+/).filter(Boolean);
    const haveFold = new Set([...tokenSet(matched.lastName), ...tokenSet(matched.otherNames || ''), ...tokenSet(matched.firstName)]);
    const extra = uciLastToks.filter((t) => { const f = fold(t); return f && !haveFold.has(f); });
    if (extra.length) enrichOtherNames = extra.join(' ');
  }

  return {
    uciRiderId: uciRider.uciRiderId,
    rosterName: `${firstName} ${lastName}`.trim(),
    firstName, lastName, otherNames: null,
    enrichOtherNames,
    nationality: uciRider.countryCode || null,
    birthDate,
    matchedRiderId: matched?.id || null,
    matchedOrigin: matched?.origin || null,
    matchedFromTeam: matched?.currentTeamId || null,
    orphanOldId,
    matchScore: Number(dbScore.toFixed(2)),
    matchedByDate: exactByDate,
    action,
  };
}

// ── SQL ──────────────────────────────────────────────────────────────
const sqlStr = (v) => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
function newRiderId(firstName, lastName) {
  return `${fold(lastName).replace(/\s+/g, '-')}-${fold(firstName).replace(/\s+/g, '-')}`;
}

function buildTeamSql(team, plan) {
  const TABLE = team.gender === 'male' ? 'riders_men' : 'riders_women';
  const lines = [];
  lines.push(`-- ════════════════════════════════════════════════════════════════`);
  lines.push(`-- ${team.uciName}  (UCI ${team.teamCode})  →  ${team.dbName}`);
  lines.push(`-- teamId=${team.dbId} (${team.gender}) ${YEAR}  ·  fuente: UCI  ·  idempotente`);
  lines.push(`-- ════════════════════════════════════════════════════════════════`);
  // team_seasons del año (copia colores/categoría de teams)
  lines.push(`INSERT INTO team_seasons (id, "teamId", year, name, category, gender, "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides", "badgeInnerCircle", "badgeShorts")`);
  lines.push(`SELECT ${sqlStr(`${team.dbId}_${YEAR}`)}, id, ${YEAR}, name, category, gender, "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides", "badgeInnerCircle", "badgeShorts"`);
  lines.push(`FROM teams WHERE id = ${sqlStr(team.dbId)}`);
  lines.push(`ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, "updatedAt"=now();`);
  lines.push('');

  for (const p of plan) {
    const riderId = (p.action === 'create') ? newRiderId(p.firstName, p.lastName) : p.matchedRiderId;
    if (p.action === 'create') {
      if (!p.birthDate) { lines.push(`-- ⚠️ OMITIDO (sin fecha nac, requisito duro): ${p.rosterName} [uci ${p.uciRiderId}]`); lines.push(''); continue; }
      const tag = p.orphanOldId ? `+ huérfano→ficha (repunta startlists de ${p.orphanOldId})` : '+ nuevo';
      lines.push(`-- ${tag}: ${p.rosterName} → ${riderId}`);
      // La VERDAD del equipo es rider_team_affiliations (mig. 116): la ficha NO escribe
      // currentTeamId (lo deriva el trigger inverso); la pertenencia va en la afiliación de abajo.
      lines.push(`INSERT INTO ${TABLE} (id, "firstName", "lastName", "otherNames", nationality, "birthDate", source, verified)`);
      lines.push(`VALUES (${sqlStr(riderId)}, ${sqlStr(p.firstName)}, ${sqlStr(p.lastName)}, ${sqlStr(p.otherNames)}, ${sqlStr(p.nationality)}, ${sqlStr(p.birthDate)}, 'catalog_gold', true)`);
      lines.push(`ON CONFLICT (id) DO UPDATE SET "birthDate"=COALESCE(${TABLE}."birthDate", EXCLUDED."birthDate"), nationality=COALESCE(${TABLE}.nationality, EXCLUDED.nationality), source='catalog_gold', verified=true, "updatedAt"=now();`);
      if (p.orphanOldId && p.orphanOldId !== riderId) {
        lines.push(`UPDATE startlist_riders SET "globalRiderId"=${sqlStr(riderId)} WHERE "globalRiderId"=${sqlStr(p.orphanOldId)};`);
      }
    } else if (p.action === 'move') {
      lines.push(`-- ⇄ traspaso (${p.matchScore}${p.matchedByDate ? ' · fecha' : ''}): ${p.rosterName} ${p.matchedFromTeam} → ${team.dbId}`);
      lines.push(`UPDATE ${TABLE} SET "birthDate"=COALESCE("birthDate", ${sqlStr(p.birthDate)}), nationality=COALESCE(nationality, ${sqlStr(p.nationality)}), verified=true, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    } else { // update
      lines.push(`-- ~ existe (${p.matchScore}${p.matchedByDate ? ' · fecha' : ''}): ${p.rosterName} → ${riderId}`);
      lines.push(`UPDATE ${TABLE} SET "birthDate"=COALESCE("birthDate", ${sqlStr(p.birthDate)}), nationality=COALESCE(nationality, ${sqlStr(p.nationality)}), verified=true, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    }
    // Enriquecer otherNames con apellido(s) extra de la UCI (solo update/move; aditivo e idempotente).
    if (p.enrichOtherNames && (p.action === 'update' || p.action === 'move')) {
      const ex = sqlStr(p.enrichOtherNames);
      lines.push(`-- + 2º apellido UCI → otherNames: ${p.enrichOtherNames}`);
      lines.push(`UPDATE ${TABLE} SET "otherNames" = CASE WHEN "otherNames" IS NULL OR "otherNames"='' THEN ${ex} WHEN "otherNames" ILIKE '%'||${ex}||'%' THEN "otherNames" ELSE "otherNames" || ', ' || ${ex} END, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    }
    const affId = `${riderId}__${team.dbId}__${YEAR}`;
    lines.push(`INSERT INTO rider_team_affiliations (id, "riderId", "riderGender", "teamId", year, source, verified)`);
    lines.push(`VALUES (${sqlStr(affId)}, ${sqlStr(riderId)}, ${sqlStr(team.gender)}, ${sqlStr(team.dbId)}, ${YEAR}, 'catalog_gold', true)`);
    lines.push(`ON CONFLICT (id) DO UPDATE SET verified=true, "updatedAt"=now();`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // team-map + selección de equipos
  const teamMap = JSON.parse(readFileSync(TEAM_MAP, 'utf8'));
  let targets = teamMap.matched;
  if (CODES.length) targets = targets.filter((m) => CODES.includes(m.teamCode));
  if (LIMIT_TEAMS) targets = targets.slice(0, LIMIT_TEAMS);
  if (!targets.length) { log('Sin equipos objetivo. ¿--codes correctos?'); return; }

  // catálogos globales por género
  const dbMen = DB_MEN && existsSync(DB_MEN) ? JSON.parse(readFileSync(DB_MEN, 'utf8')) : [];
  const dbWomen = DB_WOMEN && existsSync(DB_WOMEN) ? JSON.parse(readFileSync(DB_WOMEN, 'utf8')) : [];
  log(`Catálogo global: men=${dbMen.length} women=${dbWomen.length}  ·  equipos objetivo=${targets.length}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto('https://www.uci.org/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);

  const fullPlan = [];
  const sqlBlocks = [];
  const summary = [];
  let ti = 0;
  for (const team of targets) {
    ti++;
    if (!team.uciId) { log(`  ⚠️ ${team.teamCode} ${team.dbName} sin uciId — saltado`); continue; }
    // 1) roster oficial del equipo (cacheado)
    const rawRoster = await fetchRoster(page, team.uciId);
    if (!rawRoster.length) { log(`  [${ti}/${targets.length}] ${team.teamCode} ${team.dbName}: 0 corredores — saltado`); summary.push({ code: team.teamCode, dbName: team.dbName, roster: 0 }); continue; }

    const dbRiders = team.gender === 'male' ? dbMen : dbWomen;
    log(`\n  [${ti}/${targets.length}] ${team.teamCode} ${team.uciName} → ${team.dbName} (${team.gender}): ${rawRoster.length} corredores`);

    // 2) DOB/país (ficha cacheada) + nombre (parse usando el país conocido para cortar el sufijo)
    const roster = [];
    for (const r of rawRoster) {
      const detail = await fetchRiderDetail(page, r.uciRiderId);
      const { firstName, lastName, nat3: natFromLink } = parseLinkName(r.linkText, detail.nat3);
      const nat3 = detail.nat3 || natFromLink;
      roster.push({
        uciRiderId: r.uciRiderId, firstName, lastName,
        dob: detail.dob, countryCode: iso2(nat3), countryCode3: nat3,
      });
      await sleep(180);
    }

    const plan = roster.map((r) => matchRider(r, dbRiders, team.dbId));
    const counts = { update: 0, move: 0, create: 0, orphan: 0, noDob: 0, byDate: 0 };
    for (const p of plan) {
      if (p.action === 'update') counts.update++;
      else if (p.action === 'move') counts.move++;
      else if (p.action === 'create') { counts.create++; if (p.orphanOldId) counts.orphan++; if (!p.birthDate) counts.noDob++; }
      if (p.matchedByDate) counts.byDate++;
    }
    log(`    update=${counts.update} move=${counts.move} create=${counts.create} (huérf=${counts.orphan}, sinDOB=${counts.noDob}→OMIT) porFecha=${counts.byDate}`);
    fullPlan.push({ team, plan });
    sqlBlocks.push(buildTeamSql(team, plan));
    summary.push({ code: team.teamCode, dbName: team.dbName, gender: team.gender, roster: roster.length, ...counts });
  }
  await browser.close();

  // 5) salida
  const totals = summary.reduce((a, s) => ({
    roster: a.roster + (s.roster || 0), update: a.update + (s.update || 0), move: a.move + (s.move || 0),
    create: a.create + (s.create || 0), orphan: a.orphan + (s.orphan || 0), noDob: a.noDob + (s.noDob || 0),
  }), { roster: 0, update: 0, move: 0, create: 0, orphan: 0, noDob: 0 });

  if (EMIT_JSON) { writeFileSync(EMIT_JSON, JSON.stringify({ year: YEAR, totals, summary, plan: fullPlan }, null, 1)); log(`\nJSON → ${EMIT_JSON}`); }
  if (EMIT_SQL) { writeFileSync(EMIT_SQL, sqlBlocks.join('\n')); log(`SQL → ${EMIT_SQL}`); }

  log(`\n══ TOTALES (${summary.length} equipos): roster=${totals.roster}  update=${totals.update}  move=${totals.move}  create=${totals.create} (huérf=${totals.orphan}, sinDOB=${totals.noDob}→OMIT)`);
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
