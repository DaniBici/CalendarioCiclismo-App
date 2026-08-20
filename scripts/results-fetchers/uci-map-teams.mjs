#!/usr/bin/env node
/**
 * uci-map-teams.mjs — Mapea los equipos Continental de la UCI (CTM/CTW) a los equipos
 * Continental de NUESTRA BD (CT/CTW), para luego sembrar sus corredores.
 *
 * Reutiliza la fold canónica + scoring token-set/contención + gating de género + penalización
 * feeder del cruce de equipos, apoyándose en señales que da la UCI:
 * countryCode (ISO-3 → ISO-2) y teamCode (sigla UCI de 3 letras).
 *
 * Entradas:
 *   --uci   scripts/results-fetchers/_riders_run/uci-teams.json   (de uci-fetch-teams.mjs)
 *   --db    JSON [{id,name,category,gender,nameAliases,countryCode,men,women}] de teams CT/CTW
 *           (se pasa por --db-file; lo extraemos de Supabase a un archivo).
 * Salida:
 *   --out   JSON { matched:[{uciId,uciName,teamCode,uciCountry,dbId,dbName,score,gender,…}],
 *                  unmatchedUci:[…],  unmatchedDb:[…] }
 *   + impresión legible.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/results-fetchers/uci-map-teams.mjs \
 *     --uci scripts/results-fetchers/_riders_run/uci-teams.json \
 *     --db  scripts/results-fetchers/_riders_run/db-ct-teams.json \
 *     --out scripts/results-fetchers/_riders_run/uci-team-map.json
 */
'use strict';

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const UCI = getArg('uci');
const DB = getArg('db');
const OUT = getArg('out');
if (!UCI || !DB) { console.error('Faltan --uci y --db'); process.exit(1); }

// ── fold canónica (idéntica al ingestor / xmatch) ────────────────────
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
const NOISE = new Set([
  'cycling','team','teams','cyclingteam','pro','p','b','pb','presented','by',
  'uci','squad','project','racing','club','de','la','le','el','of','the',
]);
const FEEDER = new Set(['development','devo','rookies','u23','u19','juniors','junior','academy','gen','z','genz','future','aevolo']);
const GENDER_WORDS = new Set(['women','womens','ladies','feminine','femenino','femmes','dames','frauen','feminines','feminin']);
const DISTINGUISHERS = new Set([...FEEDER, ...GENDER_WORDS, 'national']);
function tokens(name) { return fold(name).split(/\s+/).filter(Boolean); }
function coreTokens(name) {
  const t = tokens(name).filter((x) => !NOISE.has(x) && !DISTINGUISHERS.has(x));
  return t.length ? t : tokens(name);
}
function tokenSet(name) { return [...new Set(coreTokens(name))].sort(); }

function jaccard(a, b) { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; const u = new Set([...A, ...B]).size; return u ? i / u : 0; }
function overlap(a, b) { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; const m = Math.min(A.size, B.size); return m ? i / m : 0; }
function score(aToks, bToks) {
  const j = jaccard(aToks, bToks);
  const o = overlap(aToks, bToks);
  const A = new Set(aToks), B = new Set(bToks);
  const inter = [...A].filter((x) => B.has(x)).length;
  const contain = inter >= 2 ? o * 0.95 : o * 0.6;
  return Math.max(j, contain);
}
function feederPenalty(aName, bName) {
  const fa = new Set(tokens(aName).filter((x) => FEEDER.has(x)));
  const fb = new Set(tokens(bName).filter((x) => FEEDER.has(x)));
  let asym = 0;
  for (const x of fa) if (!fb.has(x)) asym++;
  for (const x of fb) if (!fa.has(x)) asym++;
  return asym > 0 ? 0.45 : 0;
}

// ISO-3 (UCI) → ISO-2 (nuestra BD). Subconjunto suficiente para Continental + WT/PT.
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
};
const iso2 = (iso3) => ISO3to2[String(iso3 || '').toUpperCase()] || null;
const genderOf = (cat) => cat === 'CTW' ? 'female' : cat === 'CTM' ? 'male' : null;

function main() {
  const uciDoc = JSON.parse(readFileSync(UCI, 'utf8'));
  const uciTeams = uciDoc.continental || uciDoc.teams.filter((t) => t.categoryName === 'CTM' || t.categoryName === 'CTW');
  const dbTeams = JSON.parse(readFileSync(DB, 'utf8'));

  // Precompute token sets for db
  const dbPrep = dbTeams.map((d) => {
    const aliasNames = String(d.nameAliases || '').split(/\\n|\n/).map((s) => s.trim()).filter(Boolean);
    return { ...d, _names: [d.name, ...aliasNames], _ts: tokenSet([d.name, ...aliasNames].join(' ')) };
  });

  const matched = [];
  const unmatchedUci = [];
  const usedDb = new Set();

  for (const u of uciTeams) {
    const uGender = genderOf(u.categoryName);
    const uCountry = iso2(u.countryCode);
    const uTs = tokenSet(u.teamName);
    let best = null, bestScore = 0;
    for (const d of dbPrep) {
      // Gating de género: si ambos tienen género y difieren → no es el mismo equipo (gemelo de género).
      // gender=null en la BD es compatible con ambos.
      if (uGender && d.gender && uGender !== d.gender) continue;
      let s = 0;
      for (const dn of d._names) {
        const raw = score(uTs, tokenSet(dn));
        if (raw > s) s = raw;
      }
      s -= feederPenalty(u.teamName, d._names.join(' '));
      // Bonus país: si ambos tienen país y coincide, +0.15 (desempata homónimos de distinto país).
      if (uCountry && d.countryCode && uCountry === d.countryCode) s += 0.15;
      // Penalización país: si ambos tienen país y NO coincide, -0.2 (cuidado: filiales a veces
      // registran país de la matriz; por eso es penalización, no veto).
      else if (uCountry && d.countryCode && uCountry !== d.countryCode) s -= 0.20;
      if (s > bestScore) { bestScore = s; best = d; }
    }
    if (best && bestScore >= 0.5) {
      matched.push({
        uciId: u.uciId, uciName: u.teamName, teamCode: u.teamCode, uciCountry: uCountry,
        category: u.categoryName, gender: uGender,
        dbId: best.id, dbName: best.name, dbCountry: best.countryCode, dbGender: best.gender,
        dbMen: best.men, dbWomen: best.women,
        score: Number(bestScore.toFixed(2)),
      });
      usedDb.add(best.id);
    } else {
      unmatchedUci.push({ uciId: u.uciId, uciName: u.teamName, teamCode: u.teamCode, uciCountry: uCountry, category: u.categoryName, bestDb: best ? best.name : null, bestScore: Number(bestScore.toFixed(2)) });
    }
  }

  const unmatchedDb = dbPrep.filter((d) => !usedDb.has(d.id)).map((d) => ({ dbId: d.id, dbName: d.name, gender: d.gender, country: d.countryCode, men: d.men, women: d.women }));

  // Detección de colisiones: un mismo dbId casado por >1 equipo UCI (señal de error).
  const dbCount = {};
  for (const m of matched) dbCount[m.dbId] = (dbCount[m.dbId] || 0) + 1;
  const collisions = matched.filter((m) => dbCount[m.dbId] > 1);

  const out = {
    counts: { uci: uciTeams.length, db: dbTeams.length, matched: matched.length, unmatchedUci: unmatchedUci.length, unmatchedDb: unmatchedDb.length, collisions: collisions.length },
    matched, unmatchedUci, unmatchedDb, collisions,
  };
  if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); }

  const log = (...a) => process.stderr.write(a.join(' ') + '\n');
  log(`UCI continental=${uciTeams.length}  DB continental=${dbTeams.length}`);
  log(`  matched=${matched.length}  unmatchedUci=${unmatchedUci.length}  unmatchedDb=${unmatchedDb.length}  collisions=${collisions.length}`);
  if (collisions.length) { log('\n  ⚠️ COLISIONES (mismo dbId casado por varios UCI):'); for (const c of collisions) log(`    ${c.uciName} (${c.teamCode}) → ${c.dbName} [${c.score}]`); }
  log('\n  UCI sin casar (revisar):');
  for (const u of unmatchedUci) log(`    ${u.category} ${(u.uciCountry||'··')} ${u.uciName} (${u.teamCode})  bestDb="${u.bestDb}" ${u.bestScore}`);
  log('\n  DB sin casar (no en UCI 2026 o nombre muy distinto):');
  for (const d of unmatchedDb) log(`    ${d.gender||'?'} ${(d.country||'··')} ${d.dbName}  [men=${d.men} women=${d.women}]`);
  if (OUT) log(`\nJSON → ${OUT}`);
}

main();
