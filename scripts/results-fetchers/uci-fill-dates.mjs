#!/usr/bin/env node
/**
 * uci-fill-dates.mjs — Rellena SOLO la fecha de nacimiento (birthDate) de fichas que ya
 * existen en el catálogo, leyéndola de la UCI. NO crea, NO mueve, NO renombra: emite
 * únicamente `UPDATE riders_* SET "birthDate"=... WHERE id=... AND "birthDate" IS NULL`.
 *
 * Caso de uso: corredores de equipos UCI (sobre todo ProTeams sembrados por PCS, que no
 * daba fecha) que quedaron sin birthDate y sin gemelo en la BD. La fuente UCI da el DOB.
 *
 * FLUJO:
 *   1. Lee el archivo de objetivos (--targets): array {id,firstName,lastName,nationality,
 *      gender,teamId,teamName,teamCategory} (las fichas sin fecha, exportadas de la BD).
 *   2. Mapea cada teamName BD → uciId contra uci-teams.json (--uci-teams) por token-set de
 *      nombre, con gating de género (WTT/PRT/CTM = male; WTW/PRW/CTW = female). Reusa la
 *      caché de la Fase 1 (team-<uciId>.json, rider-<id>.json) en --cache-dir; lee con
 *      Playwright solo lo que falte.
 *   3. Por equipo: roster UCI → para cada objetivo, casa por token-set del nombre contra el
 *      roster (linkText "NombreAPELLIDOPAÍS"); si casa, lee el DOB de la ficha UCI.
 *   4. Emite SQL idempotente (--emit-sql) + un informe JSON (--emit-json) con casados,
 *      no-casados y equipos sin mapear.
 *
 * Uso:
 *   node scripts/results-fetchers/uci-fill-dates.mjs \
 *     --targets   scripts/results-fetchers/_dates_run/targets.json \
 *     --uci-teams scripts/results-fetchers/_riders_run/uci-teams.json \
 *     --cache-dir scripts/results-fetchers/_riders_run/uci-cache \
 *     --emit-sql  scripts/results-fetchers/_dates_run/fill-dates.sql \
 *     --emit-json scripts/results-fetchers/_dates_run/fill-dates.json \
 *     [--limit-teams N]
 */
'use strict';

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const TARGETS = getArg('targets');
const UCI_TEAMS = getArg('uci-teams');
const CACHE_DIR = getArg('cache-dir');
const EMIT_SQL = getArg('emit-sql');
const EMIT_JSON = getArg('emit-json');
const LIMIT_TEAMS = parseInt(getArg('limit-teams') || '0', 10);
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TARGETS || !UCI_TEAMS || !CACHE_DIR) { log('Faltan --targets / --uci-teams / --cache-dir'); process.exit(1); }
mkdirSync(CACHE_DIR, { recursive: true });

// ── fold canónica (idéntica a la SQL: unaccent-equivalente + token-set) ──
function fold(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ð/g, 'd').replace(/þ/g, 'th')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const tokset = (s) => [...new Set(fold(s).split(' ').filter(Boolean))].sort();
const eqSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const subset = (a, b) => a.every((x) => b.includes(x)); // a ⊆ b

// género del objetivo (BD usa 'male'/'female') vs categoría UCI
const uciGender = (cat) => (['WTW', 'PRW', 'CTW'].includes(cat) ? 'female' : 'male');

const targets = JSON.parse(readFileSync(TARGETS, 'utf8'));
const uciTeamsRaw = JSON.parse(readFileSync(UCI_TEAMS, 'utf8'));
const uciTeams = Array.isArray(uciTeamsRaw) ? uciTeamsRaw : (uciTeamsRaw.all || uciTeamsRaw.teams || []);

// ── Agrupar objetivos por teamId BD ──
const byTeam = new Map();
for (const t of targets) {
  if (!byTeam.has(t.teamId)) byTeam.set(t.teamId, { teamName: t.teamName, teamCategory: t.teamCategory, gender: t.gender, riders: [] });
  byTeam.get(t.teamId).riders.push(t);
}

// ── Mapear cada equipo BD → uciId (token-set de nombre + gating de género) ──
function mapTeam(teamName, gender) {
  const tn = tokset(teamName);
  let best = null, bestScore = 0;
  for (const u of uciTeams) {
    if (uciGender(u.categoryName) !== gender) continue;
    const un = tokset(u.teamName);
    const inter = tn.filter((x) => un.includes(x)).length;
    const score = inter / Math.max(tn.length, un.length); // jaccard-ish
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return bestScore >= 0.5 ? { uciId: best.uciId, uciName: best.teamName, score: +bestScore.toFixed(2) } : null;
}

// ── Lectura del roster (SSR /team-details/<id>) con caché ──
async function getRoster(page, uciId) {
  const cf = join(CACHE_DIR, `team-${uciId}.json`);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const url = `https://www.uci.org/team-details/${uciId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(800);
  const roster = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href*="/rider-details/"]').forEach((a) => {
      const m = a.getAttribute('href').match(/\/rider-details\/(\d+)/);
      if (m) out.push({ uciRiderId: m[1], linkText: (a.textContent || '').trim() });
    });
    return out;
  });
  writeFileSync(cf, JSON.stringify(roster));
  return roster;
}

// ── Lectura del DOB (SSR /rider-details/<id>) con caché ──
async function getDob(page, riderId) {
  const cf = join(CACHE_DIR, `rider-${riderId}.json`);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const url = `https://www.uci.org/rider-details/${riderId}`;
  let res = { dob: null, nat3: null, http: 0 };
  try {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    res.http = r ? r.status() : 0;
    await sleep(500);
    const txt = await page.evaluate(() => document.body.innerText || '');
    const m = txt.match(/D\.?O\.?B\.?\s*[:\-]?\s*(\d{2})[.\/](\d{2})[.\/](\d{4})/i);
    if (m) res.dob = `${m[3]}-${m[2]}-${m[1]}`;
    const n = txt.match(/\b([A-Z]{3})\b/);
    if (n) res.nat3 = n[1];
  } catch (e) { res.err = String(e).slice(0, 80); }
  writeFileSync(cf, JSON.stringify(res));
  return res;
}

// ── parsear linkText "NombreAPELLIDOPAÍS" -> token-set del nombre (sin el país ISO-3 final) ──
function rosterTokset(linkText, nat3Hint) {
  // quitar país ISO-3 final (3 mayúsculas) si está
  let s = linkText.replace(/[A-Z]{3}$/, '');
  // insertar espacio en frontera minúscula→MAYÚSCULA y antes de secuencias de mayúsculas
  s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
  return tokset(s);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  // visitar home una vez (algunos edges piden origen)
  try { await page.goto('https://www.uci.org/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(500); } catch {}

  const sql = [];
  const report = { matched: [], unmatched: [], teamsUnmapped: [], stats: {} };
  let teamCount = 0;

  for (const [teamId, info] of byTeam) {
    if (LIMIT_TEAMS && teamCount >= LIMIT_TEAMS) break;
    teamCount++;
    const map = mapTeam(info.teamName, info.gender);
    if (!map) { report.teamsUnmapped.push({ teamId, teamName: info.teamName, gender: info.gender }); log(`✗ sin mapear: ${info.teamName} (${info.gender})`); continue; }
    log(`▸ ${info.teamName} → UCI ${map.uciName} [${map.uciId}] score=${map.score} (${info.riders.length} obj)`);
    let roster;
    try { roster = await getRoster(page, map.uciId); } catch (e) { log(`  roster err: ${e}`); continue; }
    // precomputar token-sets del roster
    const rosterTk = roster.map((r) => ({ ...r, tk: rosterTokset(r.linkText) }));

    for (const rider of info.riders) {
      const tk = tokset(`${rider.firstName} ${rider.lastName}`);
      // casar: igualdad de token-set, o token-set del objetivo ⊆ roster (nombre corto)
      let hit = rosterTk.find((r) => eqSet(r.tk, tk)) || rosterTk.find((r) => subset(tk, r.tk) && tk.length >= 2);
      if (!hit) { report.unmatched.push({ id: rider.id, name: `${rider.firstName} ${rider.lastName}`, team: info.teamName }); continue; }
      const dobInfo = await getDob(page, hit.uciRiderId);
      if (!dobInfo.dob) { report.unmatched.push({ id: rider.id, name: `${rider.firstName} ${rider.lastName}`, team: info.teamName, reason: 'sin DOB en UCI' }); continue; }
      const tbl = rider.gender === 'female' ? 'riders_women' : 'riders_men';
      sql.push(`UPDATE ${tbl} SET "birthDate"='${dobInfo.dob}', "updatedAt"=now() WHERE id='${rider.id.replace(/'/g, "''")}' AND "birthDate" IS NULL;`);
      report.matched.push({ id: rider.id, name: `${rider.firstName} ${rider.lastName}`, dob: dobInfo.dob, uciRiderId: hit.uciRiderId });
    }
  }

  report.stats = { teams: byTeam.size, matched: report.matched.length, unmatched: report.unmatched.length, teamsUnmapped: report.teamsUnmapped.length };
  if (EMIT_SQL) writeFileSync(EMIT_SQL, sql.join('\n') + '\n');
  if (EMIT_JSON) writeFileSync(EMIT_JSON, JSON.stringify(report, null, 2));
  log(`\n== matched=${report.matched.length} unmatched=${report.unmatched.length} teamsUnmapped=${report.teamsUnmapped.length} ==`);
  await browser.close();
})();
