import pg from 'pg';
import { existsSync, readFileSync } from 'fs';

const localEnv = existsSync('.env')
  ? Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
  : {};
const env = { ...localEnv, ...process.env };
if (!env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env o en el entorno');
  process.exit(1);
}
const raceId=process.argv[2];
if (!raceId) {
  console.error('Uso: node .purge-twins.mjs <raceId>');
  process.exit(1);
}
const c=new pg.Client({connectionString:env.DATABASE_URL});
await c.connect();
// Find the synthetic (negative-id) stages we just inserted; delete any positive-id gc/stage twins that duplicate them
const stages=(await c.query(`SELECT id,"classKind","scope" FROM race_uci_stages WHERE "raceId"=$1`,[raceId])).rows;
const synth=stages.filter(s=>s.id.startsWith('ru_-'));
const synthKeys=new Set(synth.map(s=>s.classKind+'|'+s.scope));
const twins=stages.filter(s=>!s.id.startsWith('ru_-') && synthKeys.has(s.classKind+'|'+s.scope));
await c.query('BEGIN');
for(const t of twins){
  await c.query(`DELETE FROM race_uci_results WHERE "stageRef"=$1`,[t.id]);
  await c.query(`DELETE FROM race_uci_stages WHERE id=$1`,[t.id]);
}
await c.query('COMMIT');
const r=await c.query(`SELECT count(*) tot, count("globalRiderId") lk FROM race_uci_results x JOIN race_uci_stages s ON s.id=x."stageRef" WHERE s."raceId"=$1`,[raceId]);
const u=await c.query(`SELECT x."rankText",x."riderDisplay" FROM race_uci_results x JOIN race_uci_stages s ON s.id=x."stageRef" WHERE s."raceId"=$1 AND x."globalRiderId" IS NULL ORDER BY x."sortOrder"`,[raceId]);
console.log(JSON.stringify({purgedTwins:twins.map(t=>t.id),tot:r.rows[0].tot,linked:r.rows[0].lk,unlinked:u.rows}));
await c.end();
