#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildPreferredTeamWordCase, isAllCapsTeamName, normalizeTeamDisplayName } from './team-name-case.mjs';

const args = process.argv.slice(2);
const take = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2); return resolve(value);
};
const sqlFile = take('--sql-out'), manifestFile = take('--manifest-out');
if (!sqlFile || !manifestFile || args.length < 2) {
  throw new Error('Uso: build-team-name-normalization.mjs --sql-out SQL --manifest-out JSON DB-CATALOG...');
}
const catalogs = await Promise.all(args.map(async file => JSON.parse(await readFile(resolve(file), 'utf8'))));
const rows = catalogs.flatMap(file => file.catalog.map(row => ({ year: file.year, profile: String(row.profile),
  gender: row.gender, name: row.seasonName })));
const preferredCase = buildPreferredTeamWordCase(rows.map(row => row.name));
const changes = rows.filter(row => isAllCapsTeamName(row.name)).map(row => ({ ...row,
  normalizedName: normalizeTeamDisplayName(row.name, { preferredCase }) }))
  .filter(row => row.normalizedName !== row.name)
  .sort((a, b) => a.year - b.year || a.gender.localeCompare(b.gender) || a.profile.localeCompare(b.profile));
if (new Set(changes.map(row => `${row.year}:${row.gender}:${row.profile}`)).size !== changes.length) {
  throw new Error('team_name_normalization_duplicate_key');
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const values = changes.map(row => `  (${row.year},${quote(row.profile)},${quote(row.gender)},${quote(row.name)},${quote(row.normalizedName)})`).join(',\n');
const expected = changes.length;
const sql = `-- Normaliza el casing de nombres UCI importados entre 2020 y 2026.
BEGIN;

CREATE TABLE private.normalize_uci_team_names_20260907_backup (
  entity text NOT NULL, row_key text NOT NULL, row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(entity,row_key)
);
ALTER TABLE private.normalize_uci_team_names_20260907_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.normalize_uci_team_names_20260907_backup FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT,INSERT ON TABLE private.normalize_uci_team_names_20260907_backup TO service_role;

CREATE TEMP TABLE _uci_team_name_case(
  year integer NOT NULL, profile text NOT NULL, gender text NOT NULL,
  old_name text NOT NULL, new_name text NOT NULL,
  PRIMARY KEY(year,gender,profile), CHECK(old_name<>new_name)
) ON COMMIT DROP;
INSERT INTO _uci_team_name_case(year,profile,gender,old_name,new_name) VALUES
${values};

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM _uci_team_name_case)<>${expected} THEN RAISE EXCEPTION 'Manifiesto de nombres incompleto'; END IF;
  IF (SELECT count(*) FROM _uci_team_name_case m
      JOIN private.uci_catalog_team_links l ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
      JOIN public.team_seasons s ON s."teamId"=l.team_id AND s.year=l.season AND s.name=m.old_name)<>${expected}
  THEN RAISE EXCEPTION 'El catálogo cambió desde la auditoría de casing'; END IF;
  IF EXISTS(SELECT 1 FROM _uci_team_name_case WHERE public.fold_name(old_name)<>public.fold_name(new_name))
  THEN RAISE EXCEPTION 'La normalización altera la identidad plegada'; END IF;
END
$preflight$;

INSERT INTO private.normalize_uci_team_names_20260907_backup(entity,row_key,row_data)
SELECT 'team_seasons',s.id,to_jsonb(s) FROM _uci_team_name_case m
JOIN private.uci_catalog_team_links l ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
JOIN public.team_seasons s ON s."teamId"=l.team_id AND s.year=l.season;

WITH affected AS (
  SELECT DISTINCT t.* FROM _uci_team_name_case m
  JOIN private.uci_catalog_team_links l ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
  JOIN public.teams t ON t.id=l.team_id AND t.name=m.old_name
)
INSERT INTO private.normalize_uci_team_names_20260907_backup(entity,row_key,row_data)
SELECT 'teams',id,to_jsonb(affected) FROM affected;

UPDATE public.team_seasons s SET name=m.new_name,"updatedAt"=transaction_timestamp()
FROM _uci_team_name_case m JOIN private.uci_catalog_team_links l
  ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
WHERE s."teamId"=l.team_id AND s.year=l.season AND s.name=m.old_name;

SELECT set_config('app.historical_catalog','on',true);

WITH candidates AS (
  SELECT DISTINCT ON (l.team_id) l.team_id,m.old_name,m.new_name,m.year
  FROM _uci_team_name_case m JOIN private.uci_catalog_team_links l
    ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
  ORDER BY l.team_id,m.year DESC
)
UPDATE public.teams t SET name=c.new_name,"updatedAt"=transaction_timestamp()
FROM candidates c WHERE t.id=c.team_id AND t.name=c.old_name;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM _uci_team_name_case m
      JOIN private.uci_catalog_team_links l ON l.season=m.year AND l.profile=m.profile AND l.gender=m.gender
      JOIN public.team_seasons s ON s."teamId"=l.team_id AND s.year=l.season AND s.name=m.new_name)<>${expected}
  THEN RAISE EXCEPTION 'No se aplicaron todos los nombres normalizados'; END IF;
  IF EXISTS(SELECT 1 FROM public.team_seasons GROUP BY "teamId",year HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM public.team_seasons s JOIN public.teams t ON t.id=s."teamId" WHERE s.gender IS DISTINCT FROM t.gender)
  THEN RAISE EXCEPTION 'La normalización alteró invariantes del catálogo'; END IF;
END
$verify$;

COMMIT;
`;
const manifest = { version: 1, complete: true, scope: 'uci-team-name-case-2020-2026',
  generatedAt: new Date().toISOString(), rows: changes.length,
  male: changes.filter(row => row.gender === 'male').length,
  female: changes.filter(row => row.gender === 'female').length, changes };
for (const [file, content] of [[sqlFile, sql], [manifestFile, `${JSON.stringify(manifest, null, 2)}\n`]]) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, file);
}
process.stdout.write(`${JSON.stringify({ rows: changes.length, male: manifest.male, female: manifest.female })}\n`);
