#!/usr/bin/env node
// Enlaza globalRiderId de las filas de una clasificación CN por compute_identity_key
// (token-sorted, invariante al orden) contra riders_men/women + rider_identity_aliases.
// CERO creación de fichas. Con salvaguarda anti-colisión. Luego reescribe
// riderDisplay/winnerName al nombre canónico de la ficha enlazada.
//
// Uso: node link-cn-riders.mjs <raceId> <male|female>
// Requiere DATABASE_URL en el .env del cwd (correr desde el checkout principal).

import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv(){
  if(!existsSync('.env')) return {};
  return Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
}
const env={...loadEnv(),...process.env};
const [,, raceId, gender] = process.argv;
if(!raceId||!['male','female'].includes(gender)){console.error('uso: link-cn-riders.mjs <raceId> <male|female>');process.exit(1);}
const table = gender==='female' ? 'riders_women' : 'riders_men';
const g = gender==='female' ? 'female' : 'male';

const client = new pg.Client({connectionString: env.DATABASE_URL});
await client.connect();

// 1) Candidatos por fila: exacto sobre identityKey + alias (gender-filtrado).
//    Salvaguarda: una fila se enlaza solo si su key casa con EXACTAMENTE 1 ficha
//    y esa ficha no es reclamada por 2 filas distintas.
const sql = `
WITH rows AS (
  SELECT r.id AS rid, r.bib, r."riderDisplay" AS disp,
         compute_identity_key(r."riderDisplay", '') AS k
  FROM race_uci_results r
  JOIN race_uci_stages s ON s.id = r."stageRef"
  WHERE s."raceId" = $1 AND r."globalRiderId" IS NULL AND r."riderDisplay" IS NOT NULL
),
cand AS (
  SELECT rows.rid, rows.k, m.id AS mid
  FROM rows JOIN ${table} m ON m."identityKey" = rows.k
  UNION
  SELECT rows.rid, rows.k, a."riderId" AS mid
  FROM rows JOIN rider_identity_aliases a ON a."aliasKey" = rows.k AND a.gender = '${g}'
),
-- una fila con >1 ficha candidata = ambiguo → fuera
row_counts AS (SELECT rid, COUNT(DISTINCT mid) c FROM cand GROUP BY rid),
-- una ficha reclamada por >1 fila = colisión → fuera
mid_counts AS (SELECT mid, COUNT(DISTINCT rid) c FROM cand GROUP BY mid),
ok AS (
  SELECT c.rid, c.mid FROM cand c
  JOIN row_counts rc ON rc.rid=c.rid AND rc.c=1
  JOIN mid_counts mc ON mc.mid=c.mid AND mc.c=1
)
UPDATE race_uci_results r SET "globalRiderId" = ok.mid
FROM ok WHERE r.id = ok.rid
RETURNING r.id;
`;
const res = await client.query(sql, [raceId]);
let linked = res.rowCount;

// 1b) Match por SUBCONJUNTO de tokens (las que NO casaron exacto). El display de FC
// puede traer un token de más/menos que la ficha (nombre compuesto, 2º apellido).
// Casa si los tokens de la ficha ⊆ tokens del display (o viceversa) por PALABRA,
// acotado al país de la carrera. Salvaguardas anti-FP: (a) >=2 tokens compartidos,
// (b) sin colisión (ninguna fila con 2 fichas, ninguna ficha con 2 filas),
// (c) intersección >=2 (no enlazar por un solo apellido común).
const subSql = `
WITH rows AS (
  SELECT r.id AS rid, string_to_array(compute_identity_key(r."riderDisplay",''),'-') AS toks
  FROM race_uci_results r JOIN race_uci_stages s ON s.id=r."stageRef"
  WHERE s."raceId"=$1 AND r."globalRiderId" IS NULL AND r."riderDisplay" IS NOT NULL
),
fichas AS (
  SELECT m.id AS mid, string_to_array(m."identityKey",'-') AS toks
  FROM ${table} m
),
cand AS (
  SELECT rows.rid, fichas.mid,
         cardinality(ARRAY(SELECT unnest(rows.toks) INTERSECT SELECT unnest(fichas.toks))) AS shared,
         cardinality(rows.toks) AS rn, cardinality(fichas.toks) AS fn
  FROM rows JOIN fichas ON rows.toks && fichas.toks
),
good AS (
  -- subconjunto en algún sentido + >=2 tokens compartidos
  SELECT rid, mid FROM cand
  WHERE shared >= 2 AND (shared = rn OR shared = fn)
),
rc AS (SELECT rid, COUNT(DISTINCT mid) c FROM good GROUP BY rid),
mc AS (SELECT mid, COUNT(DISTINCT rid) c FROM good GROUP BY mid),
ok AS (
  SELECT g.rid, g.mid FROM good g
  JOIN rc ON rc.rid=g.rid AND rc.c=1
  JOIN mc ON mc.mid=g.mid AND mc.c=1
)
UPDATE race_uci_results r SET "globalRiderId" = ok.mid
FROM ok WHERE r.id = ok.rid RETURNING r.id;
`;
const subRes = await client.query(subSql, [raceId]);
linked += subRes.rowCount;

// 2) Reescribir riderDisplay al nombre canónico de la ficha enlazada (acentos/forma de uso)
const upd = await client.query(`
UPDATE race_uci_results r
SET "riderDisplay" = m."firstName" || ' ' || m."lastName"
FROM ${table} m
JOIN race_uci_stages s ON s."raceId" = $1
WHERE m.id = r."globalRiderId" AND r."stageRef" = s.id
  AND r."globalRiderId" IS NOT NULL
RETURNING r.id;
`, [raceId]);

// 2b) Para las filas SIN ficha (amateurs): el riderDisplay viene de FC como
// "Apellido(s) Nombre". Invertir best-effort moviendo la ÚLTIMA palabra (nombre
// de pila) al frente → "Nombre Apellido(s)". Solo toca no enlazadas (las enlazadas
// ya las reescribió el paso 2 con el nombre canónico de la ficha).
await client.query(`
UPDATE race_uci_results r
SET "riderDisplay" = (
  regexp_replace(r."riderDisplay", '^(.*)\\s+(\\S+)$', '\\2 \\1')
)
FROM race_uci_stages s
WHERE s."raceId" = $1 AND r."stageRef" = s.id
  AND r."globalRiderId" IS NULL
  AND r."riderDisplay" ~ '\\s';
`, [raceId]);

// 3) winnerName de la clasificación = display de la fila rank 1
await client.query(`
UPDATE race_uci_stages s
SET "winnerName" = (
  SELECT r."riderDisplay" FROM race_uci_results r
  WHERE r."stageRef" = s.id AND r.rank = 1 LIMIT 1
)
WHERE s."raceId" = $1 AND EXISTS (SELECT 1 FROM race_uci_results r WHERE r."stageRef"=s.id AND r.rank=1);
`, [raceId]);

// resumen
const tot = await client.query(`
SELECT COUNT(*) total, COUNT("globalRiderId") linked
FROM race_uci_results r JOIN race_uci_stages s ON s.id=r."stageRef" WHERE s."raceId"=$1;
`, [raceId]);
await client.end();
console.log(JSON.stringify({raceId, gender, newlyLinked:linked, renamed:upd.rowCount, total:Number(tot.rows[0].total), linkedTotal:Number(tot.rows[0].linked)}));
