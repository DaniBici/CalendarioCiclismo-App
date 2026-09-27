#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [snapshotFile] = process.argv.slice(2);
if (!snapshotFile) throw new Error('Uso: build-current-team-match-query.mjs SNAPSHOT');
const snapshot = JSON.parse(await readFile(resolve(snapshotFile), 'utf8'));
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const rows = snapshot.teams.map(team => `(${[
  String(team.uciTeamProfileId), team.teamName, team.teamCode, team.gender,
  team.countryCode.toLowerCase(), team.sourceWebsite,
].map(quote).join(',')})`).join(',');
process.stdout.write(`
WITH incoming(profile,name,code,gender,country,website) AS (VALUES ${rows}),
candidates AS (
  SELECT i.*,l.team_id,l.source_name AS current_name,l.source_code AS current_code,
    ((public.fold_name(l.source_name)=public.fold_name(i.name))::int
      +(l.source_code=i.code)::int+(lower(t."countryCode")=i.country)::int) AS score
  FROM incoming i
  JOIN private.uci_catalog_team_links l ON l.season=2026 AND l.gender=i.gender
  JOIN public.teams t ON t.id=l.team_id
  WHERE public.fold_name(l.source_name)=public.fold_name(i.name) OR l.source_code=i.code
), ranked AS (
  SELECT *,count(*) OVER(PARTITION BY profile) AS candidate_count,
    max(score) OVER(PARTITION BY profile) AS max_score
  FROM candidates
)
SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY profile,score DESC)
  FILTER(WHERE score=max_score),'[]'::jsonb) AS result
FROM ranked r;
`);
