#!/usr/bin/env node
/**
 * uci-disambiguate.mjs — Post-pase sobre el plan completo (full.json) que resuelve las
 * COLISIONES DE IDENTIDAD que el matching name-only deja (la razón de ser del catálogo oro):
 * dos humanos DISTINTOS que comparten nombre colapsan en el mismo slug `apellido-nombre`.
 *
 * Detecta y corrige:
 *  (A) Dos+ ALTAS con el mismo slug nuevo (p.ej. dos "Hao Zhang" de fecha distinta) → la 1ª
 *      mantiene el slug base; las demás reciben sufijo de AÑO de nacimiento (y mes si hace falta).
 *  (B) Dos+ filas (update/move/create) que apuntan al MISMO id existente con FECHAS distintas
 *      = homónimos colapsados. Se queda con el slug base la fila cuya fecha coincide con la del
 *      DB (si la hay) o, a falta de eso, la primera; las demás pasan a ALTA con slug año-sufijado.
 *  (C) Cualquier alta cuyo slug base ya esté OCUPADO por una fila existente (DB) o por un
 *      update/move de otra persona con fecha distinta → sufijo de año.
 *
 * Mantiene intactos los casos sanos. Re-emite SQL idempotente equivalente al del ingestor.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/results-fetchers/uci-disambiguate.mjs \
 *     --full scripts/results-fetchers/_riders_run/full.json \
 *     --db-men /tmp/catalog-men.json --db-women /tmp/catalog-women.json \
 *     --emit-sql scripts/results-fetchers/_riders_run/full.sql \
 *     --emit-json scripts/results-fetchers/_riders_run/full-resolved.json
 */
'use strict';
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const FULL = getArg('full');
const DB_MEN = getArg('db-men');
const DB_WOMEN = getArg('db-women');
const EMIT_SQL = getArg('emit-sql');
const EMIT_JSON = getArg('emit-json');
const YEAR = parseInt(getArg('year') || '2026', 10);
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

function fold(s){return String(s||'').toLowerCase().replace(/ø/g,'o').replace(/ł/g,'l').replace(/đ/g,'d').replace(/ð/g,'d').replace(/ß/g,'ss').replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/þ/g,'th').replace(/['’`]/g,'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
const baseId = (f,l) => `${fold(l).replace(/\s+/g,'-')}-${fold(f).replace(/\s+/g,'-')}`;
const yearOf = (dob) => (dob && /^(\d{4})-/.test(dob)) ? dob.slice(0,4) : null;
const monthOf = (dob) => (dob && /^\d{4}-(\d{2})/.test(dob)) ? dob.slice(5,7) : null;
const sqlStr = (v) => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

const doc = JSON.parse(readFileSync(FULL, 'utf8'));
const dbMen = JSON.parse(readFileSync(DB_MEN, 'utf8'));
const dbWomen = JSON.parse(readFileSync(DB_WOMEN, 'utf8'));
const dbDob = new Map(); // id → birthDate (de las fichas existentes)
for (const d of [...dbMen, ...dbWomen]) if (d.id && !dbDob.has(d.id)) dbDob.set(d.id, d.birthDate || null);
const existingIds = new Set(dbDob.keys());

// Aplana el plan conservando referencia al bloque/equipo.
const blocks = doc.plan; // [{team, plan:[...]}]
const rows = [];
for (const b of blocks) for (const p of b.plan) rows.push({ p, team: b.team });

// ── (B) conflictos sobre el mismo id existente con fechas distintas ──
const byTarget = new Map(); // matchedRiderId → [{p,team}]
for (const r of rows) {
  if (r.p.action !== 'create' && r.p.matchedRiderId) {
    if (!byTarget.has(r.p.matchedRiderId)) byTarget.set(r.p.matchedRiderId, []);
    byTarget.get(r.p.matchedRiderId).push(r);
  }
}
let reassignedB = 0;
for (const [rid, list] of byTarget) {
  if (list.length < 2) continue;
  const dobs = new Set(list.map(r => r.p.birthDate).filter(Boolean));
  // Si todas las fechas coinciden (o ninguna) → es el MISMO humano repetido en roster (raro pero
  // posible: doble equipo en UCI). Lo dejamos: se queda como update/move múltiple (idempotente).
  if (dobs.size <= 1) continue;
  // Homónimos: hay ≥2 fechas distintas. Elegir quién conserva el id existente.
  const dbBirth = dbDob.get(rid) || null;
  let keeper = null;
  if (dbBirth) keeper = list.find(r => r.p.birthDate === dbBirth) || null;
  if (!keeper) keeper = list[0]; // sin fecha en DB → la primera conserva el id
  for (const r of list) {
    if (r === keeper) continue;
    // Convertir a ALTA (nueva persona). El slug se resolverá en el pase (C) con sufijo de año.
    r.p.action = 'create';
    r.p.matchedRiderId = null;
    r.p._wasConflict = rid;
    reassignedB++;
  }
}

// ── Construir el conjunto de slugs OCUPADOS por identidades NO-create ──
// (ids existentes en DB + ids destino de update/move que SÍ se quedan)
const occupied = new Map(); // id → birthDate conocido (para decidir si una alta colisiona con OTRA persona)
for (const id of existingIds) occupied.set(id, dbDob.get(id) || null);
for (const r of rows) {
  if (r.p.action !== 'create' && r.p.matchedRiderId) {
    if (!occupied.has(r.p.matchedRiderId)) occupied.set(r.p.matchedRiderId, r.p.birthDate || null);
  }
}

// ── (A)+(C) asignar slug único a cada ALTA ──
const mintedDob = new Map(); // slug ya emitido por una alta → su fecha (para detectar colisión real)
let suffixedYear = 0, suffixedMonth = 0;
const creates = rows.filter(r => r.p.action === 'create' && r.p.birthDate);
for (const r of creates) {
  const base = baseId(r.p.firstName, r.p.lastName);
  const y = yearOf(r.p.birthDate);
  const m = monthOf(r.p.birthDate);
  // El slug base "propio" del rider: si esta alta es un HUÉRFANO cuyo id viejo/matcheado ES el
  // slug base, entonces el slug ya está ocupado POR ÉL MISMO (no es colisión con otra persona).
  // Los huérfanos del catálogo tienen birthDate=null, así que sin esta guarda collidesWith los
  // sufijaba siempre y duplicaba la ficha (base + base-AÑO). Ver caso roesems-siebe.
  // OJO: NO incluir `base` aquí (eso desactivaría la detección de colisión entre dos altas
  // distintas con el mismo apellido-nombre, p.ej. dos "Hao Zhang"). Solo el id pre-existente
  // al que esta alta-huérfano resuelve cuenta como "suyo".
  const ownSlugs = new Set([r.p.orphanOldId, r.p.matchedRiderId].filter(Boolean));
  const collidesWith = (slug) => {
    if (ownSlugs.has(slug)) return false; // es su propio id (huérfano/auto-match) → no colisión
    // colisiona si el slug está ocupado por una persona con fecha DISTINTA, o ya minteado con fecha distinta
    if (occupied.has(slug)) { const d = occupied.get(slug); return !d || d !== r.p.birthDate; }
    if (mintedDob.has(slug)) { return mintedDob.get(slug) !== r.p.birthDate; }
    return false;
  };
  let slug = base;
  if (collidesWith(slug)) {
    slug = y ? `${base}-${y}` : base;
    if (collidesWith(slug)) { slug = (y && m) ? `${base}-${y}-${m}` : slug; suffixedMonth++; }
    else if (y) suffixedYear++;
  }
  r.p._riderId = slug;
  mintedDob.set(slug, r.p.birthDate);
}
log(`(B) homónimos reasignados a alta: ${reassignedB}`);
log(`(A/C) altas con sufijo de año: ${suffixedYear}  · con año+mes: ${suffixedMonth}`);

// ── Re-emitir SQL (idéntico patrón que el ingestor) ──
function teamSqlHeader(team) {
  return [
    `-- ════════════════════════════════════════════════════════════════`,
    `-- ${team.uciName}  (UCI ${team.teamCode})  →  ${team.dbName}`,
    `-- teamId=${team.dbId} (${team.gender}) ${YEAR}  ·  fuente: UCI (desambiguado)  ·  idempotente`,
    `-- ════════════════════════════════════════════════════════════════`,
    `INSERT INTO team_seasons (id, "teamId", year, name, category, gender, "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides", "badgeInnerCircle", "badgeShorts")`,
    `SELECT '${team.dbId}_${YEAR}', id, ${YEAR}, name, category, gender, "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides", "badgeInnerCircle", "badgeShorts"`,
    `FROM teams WHERE id = ${sqlStr(team.dbId)}`,
    `ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, "updatedAt"=now();`,
    '',
  ];
}
const out = [];
for (const b of blocks) {
  const team = b.team;
  const TABLE = team.gender === 'male' ? 'riders_men' : 'riders_women';
  out.push(...teamSqlHeader(team));
  for (const p of b.plan) {
    const riderId = (p.action === 'create') ? p._riderId : p.matchedRiderId;
    if (p.action === 'create') {
      if (!p.birthDate) { out.push(`-- ⚠️ OMITIDO (sin fecha nac): ${p.rosterName} [uci ${p.uciRiderId}]`, ''); continue; }
      const tags = [];
      if (p.orphanOldId) tags.push(`huérfano→ficha (repunta ${p.orphanOldId})`);
      if (p._wasConflict) tags.push(`homónimo de ${p._wasConflict} (persona distinta, fecha ${p.birthDate})`);
      if (riderId !== baseId(p.firstName, p.lastName)) tags.push(`slug desambiguado por fecha`);
      out.push(`-- + nuevo${tags.length ? ' ('+tags.join('; ')+')' : ''}: ${p.rosterName} → ${riderId}`);
      // La VERDAD del equipo es rider_team_affiliations (mig. 116): la ficha NO escribe
      // currentTeamId (lo deriva el trigger inverso); la pertenencia va en la afiliación de abajo.
      out.push(`INSERT INTO ${TABLE} (id, "firstName", "lastName", "otherNames", nationality, "birthDate", source, verified)`);
      out.push(`VALUES (${sqlStr(riderId)}, ${sqlStr(p.firstName)}, ${sqlStr(p.lastName)}, ${sqlStr(p.otherNames)}, ${sqlStr(p.nationality)}, ${sqlStr(p.birthDate)}, 'catalog_gold', true)`);
      out.push(`ON CONFLICT (id) DO UPDATE SET "birthDate"=COALESCE(${TABLE}."birthDate", EXCLUDED."birthDate"), nationality=COALESCE(${TABLE}.nationality, EXCLUDED.nationality), source='catalog_gold', verified=true, "updatedAt"=now();`);
      if (p.orphanOldId && p.orphanOldId !== riderId) {
        out.push(`UPDATE startlist_riders SET "globalRiderId"=${sqlStr(riderId)} WHERE "globalRiderId"=${sqlStr(p.orphanOldId)};`);
      }
    } else if (p.action === 'move') {
      out.push(`-- ⇄ traspaso (${p.matchScore}${p.matchedByDate ? ' · fecha' : ''}): ${p.rosterName} ${p.matchedFromTeam} → ${team.dbId}`);
      out.push(`UPDATE ${TABLE} SET "birthDate"=COALESCE("birthDate", ${sqlStr(p.birthDate)}), nationality=COALESCE(nationality, ${sqlStr(p.nationality)}), verified=true, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    } else {
      out.push(`-- ~ existe (${p.matchScore}${p.matchedByDate ? ' · fecha' : ''}): ${p.rosterName} → ${riderId}`);
      out.push(`UPDATE ${TABLE} SET "birthDate"=COALESCE("birthDate", ${sqlStr(p.birthDate)}), nationality=COALESCE(nationality, ${sqlStr(p.nationality)}), verified=true, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    }
    // otherNames enrichment (igual que el ingestor) — sólo si venía marcado
    if (p.enrichOtherNames && (p.action === 'update' || p.action === 'move')) {
      const ex = sqlStr(p.enrichOtherNames);
      out.push(`UPDATE ${TABLE} SET "otherNames" = CASE WHEN "otherNames" IS NULL OR "otherNames"='' THEN ${ex} WHEN "otherNames" ILIKE '%'||${ex}||'%' THEN "otherNames" ELSE "otherNames" || ', ' || ${ex} END, "updatedAt"=now() WHERE id=${sqlStr(riderId)};`);
    }
    const affId = `${riderId}__${team.dbId}__${YEAR}`;
    out.push(`INSERT INTO rider_team_affiliations (id, "riderId", "riderGender", "teamId", year, source, verified)`);
    out.push(`VALUES (${sqlStr(affId)}, ${sqlStr(riderId)}, ${sqlStr(team.gender)}, ${sqlStr(team.dbId)}, ${YEAR}, 'catalog_gold', true)`);
    out.push(`ON CONFLICT (id) DO UPDATE SET verified=true, "updatedAt"=now();`);
    out.push('');
  }
}
if (EMIT_SQL) { writeFileSync(EMIT_SQL, out.join('\n')); log(`SQL → ${EMIT_SQL}`); }
if (EMIT_JSON) { writeFileSync(EMIT_JSON, JSON.stringify(doc, null, 1)); log(`JSON → ${EMIT_JSON}`); }

// Verificación final: ningún slug de alta colisiona con otra alta de fecha distinta ni con id existente de otra persona.
const finalCreate = rows.filter(r => r.p.action === 'create' && r.p.birthDate);
const seen = new Map(); let bad = 0;
for (const r of finalCreate) {
  const id = r.p._riderId;
  if (seen.has(id) && seen.get(id) !== r.p.birthDate) { bad++; log(`  ✗ colisión residual ${id}: ${seen.get(id)} vs ${r.p.birthDate}`); }
  seen.set(id, r.p.birthDate);
  if (existingIds.has(id) && dbDob.get(id) && dbDob.get(id) !== r.p.birthDate) { bad++; log(`  ✗ alta pisa ficha existente ${id} (DB ${dbDob.get(id)} vs ${r.p.birthDate})`); }
}
log(`\nVerificación: altas=${finalCreate.length}  slugs únicos=${new Set(finalCreate.map(r=>r.p._riderId)).size}  colisiones residuales=${bad}`);
