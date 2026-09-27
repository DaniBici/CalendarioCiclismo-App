#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const take = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2);
  return resolve(value);
};
const manifestFile = take('--manifest');
const outputFile = take('--out');
if (!manifestFile || !outputFile || args.length) {
  throw new Error('Uso: build-team-continuity-migration.mjs --manifest JSON --out SQL');
}
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (!manifest.complete || manifest.scope !== 'team-continuity-2020-2026' || !manifest.mappings?.length) {
  throw new Error('repair_manifest_invalid');
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const values = manifest.mappings.map(item => `  (${quote(item.sourceTeamId)}, ${quote(item.targetTeamId)}, ${quote(item.gender)})`).join(',\n');
const expected = manifest.mappings.length;
const backupInsert = (entity, table, predicate) => `
INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT ${quote(entity)},md5(to_jsonb(x)::text),to_jsonb(x) FROM ${table} x WHERE ${predicate};`;
const source = column => `${column} IN (SELECT source_id FROM _team_continuity_merge)`;
const sourceOrTarget = column => `${column} IN (SELECT source_id FROM _team_continuity_merge UNION SELECT target_id FROM _team_continuity_merge)`;

const sql = `-- Consolida las identidades longitudinales de equipos UCI 2020-2026.
-- Generado desde el manifiesto dirigido; tres cruces ambiguos permanecen pendientes.
BEGIN;

CREATE TABLE private.repair_team_continuity_20260907_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(entity,row_key)
);
ALTER TABLE private.repair_team_continuity_20260907_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_team_continuity_20260907_backup FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT,INSERT ON TABLE private.repair_team_continuity_20260907_backup TO service_role;
COMMENT ON TABLE private.repair_team_continuity_20260907_backup IS
  'Backup recuperable previo a consolidar identidades longitudinales de equipos UCI 2020-2026.';

CREATE TEMP TABLE _team_continuity_merge(
  source_id text PRIMARY KEY,
  target_id text NOT NULL,
  gender text NOT NULL CHECK(gender IN ('male','female')),
  CHECK(source_id<>target_id)
) ON COMMIT DROP;
INSERT INTO _team_continuity_merge(source_id,target_id,gender) VALUES
${values};

CREATE TEMP TABLE _team_continuity_before AS
SELECT
  (SELECT count(*) FROM public.teams) teams,
  (SELECT count(*) FROM public.team_seasons) team_seasons,
  (SELECT count(*) FROM private.uci_catalog_team_links) uci_links,
  (SELECT count(*) FROM private.historical_team_roster_observations) roster_observations,
  (SELECT count(*) FROM public.rider_team_affiliations) affiliations,
  (SELECT count(*) FROM public.race_uci_results) results,
  (SELECT count(*) FROM public.startlist_teams) startlist_teams;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM _team_continuity_merge) <> ${expected} THEN
    RAISE EXCEPTION 'El manifiesto de continuidad no contiene ${expected} relaciones';
  END IF;
  IF EXISTS(SELECT 1 FROM _team_continuity_merge m JOIN _team_continuity_merge other ON other.target_id=m.source_id) THEN
    RAISE EXCEPTION 'El manifiesto contiene cadenas no normalizadas';
  END IF;
  PERFORM 1 FROM public.teams t WHERE ${sourceOrTarget('t.id')} FOR UPDATE;
  IF (SELECT count(*) FROM _team_continuity_merge m
      JOIN public.teams source ON source.id=m.source_id AND source."historicalCatalogOnly"=true
        AND source.gender=m.gender AND source."specialEdition"=false
      JOIN public.teams target ON target.id=m.target_id AND target.gender=m.gender
        AND target."specialEdition"=false AND target."teamKind"<>'selection') <> ${expected} THEN
    RAISE EXCEPTION 'Las identidades origen o destino cambiaron desde la auditoría';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.team_seasons source
    JOIN _team_continuity_merge m ON m.source_id=source."teamId"
    JOIN public.team_seasons target ON target."teamId"=m.target_id AND target.year=source.year
  ) THEN RAISE EXCEPTION 'Una temporada colisiona con la matriz longitudinal de destino'; END IF;
END
$preflight$;
${backupInsert('teams','public.teams',sourceOrTarget('x.id'))}
${backupInsert('team_seasons','public.team_seasons',source('x."teamId"'))}
${backupInsert('uci_catalog_team_links','private.uci_catalog_team_links',source('x.team_id'))}
${backupInsert('historical_team_roster_observations','private.historical_team_roster_observations',source('x."teamId"'))}
${backupInsert('historical_participation_decisions','private.historical_participation_decisions',source('x."teamId"'))}
${backupInsert('rider_team_affiliations','public.rider_team_affiliations',source('x."teamId"'))}
${backupInsert('race_uci_results','public.race_uci_results',source('x."teamId"'))}
${backupInsert('startlist_teams','public.startlist_teams',source('x."teamId"'))}
${backupInsert('team_link_decisions','public.team_link_decisions',source('x."teamId"'))}
${backupInsert('team_name_aliases','public.team_name_aliases',source('x."teamId"'))}
${backupInsert('team_season_variants','public.team_season_variants',source('x."teamId"'))}
${backupInsert('uci_team_rankings','public.uci_team_rankings',source('x."teamId"'))}
${backupInsert('uci_catalog_baselines','private.uci_catalog_baselines',source('x.team_id'))}
${backupInsert('team_development_links','public.team_development_links',`${source('x."mainTeamId"')} OR ${source('x."developmentTeamId"')}`)}
${backupInsert('teams_parent','public.teams',source('x."parentTeamId"'))}
${backupInsert('riders_men','public.riders_men',source('x."currentTeamId"'))}
${backupInsert('riders_women','public.riders_women',source('x."currentTeamId"'))}
${backupInsert('rider_transfers','public.rider_transfers',`${source('x."fromTeamId"')} OR ${source('x."toTeamId"')}`)}

CREATE TEMP TABLE _team_continuity_backup_count AS
SELECT count(*) rows FROM private.repair_team_continuity_20260907_backup;

UPDATE public.team_seasons x SET "teamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.uci_catalog_team_links x SET team_id=m.target_id,reviewed_at=transaction_timestamp()
FROM _team_continuity_merge m WHERE x.team_id=m.source_id;
UPDATE private.historical_team_roster_observations x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.historical_participation_decisions x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.rider_team_affiliations x
SET "teamId"=m.target_id,
    id='hist_'||md5(concat_ws('|',x."riderGender",x."riderId",m.target_id,x.year,x."dateFrom",x."dateTo",x."sourceUrl")),
    "updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.race_uci_results x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.startlist_teams x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_link_decisions x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_name_aliases x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_season_variants x SET "teamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.uci_team_rankings x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.uci_catalog_baselines x SET team_id=m.target_id
FROM _team_continuity_merge m WHERE x.team_id=m.source_id;
UPDATE public.team_development_links x SET "mainTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."mainTeamId"=m.source_id;
UPDATE public.team_development_links x SET "developmentTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."developmentTeamId"=m.source_id;
UPDATE public.teams x SET "parentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."parentTeamId"=m.source_id;
UPDATE public.riders_men x SET "currentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."currentTeamId"=m.source_id;
UPDATE public.riders_women x SET "currentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."currentTeamId"=m.source_id;
UPDATE public.rider_transfers x SET "fromTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."fromTeamId"=m.source_id;
UPDATE public.rider_transfers x SET "toTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."toTeamId"=m.source_id;

SELECT set_config('app.historical_catalog','on',true);
WITH targets AS (SELECT DISTINCT target_id FROM _team_continuity_merge),
latest AS (
  SELECT DISTINCT ON (s."teamId") s."teamId",s.name,s.category,s.gender,s."headerBg",s."headerText",
    s."badgeTorsoCenter",s."badgeTorsoSides",s."badgeInnerCircle",s."badgeShorts",s."badgeVisible"
  FROM public.team_seasons s JOIN targets t ON t.target_id=s."teamId"
  ORDER BY s."teamId",s.year DESC
), stats AS (
  SELECT s."teamId",min(s.year) first_season,
    string_agg(DISTINCT btrim(s.name),E'\n' ORDER BY btrim(s.name)) FILTER(WHERE btrim(s.name)<>'') aliases
  FROM public.team_seasons s JOIN targets t ON t.target_id=s."teamId" GROUP BY s."teamId"
)
UPDATE public.teams t SET
  "firstSeason"=least(coalesce(t."firstSeason",stats.first_season),stats.first_season),
  name=CASE WHEN t."historicalCatalogOnly" THEN latest.name ELSE t.name END,
  category=CASE WHEN t."historicalCatalogOnly" THEN latest.category ELSE t.category END,
  "headerBg"=CASE WHEN t."historicalCatalogOnly" THEN latest."headerBg" ELSE t."headerBg" END,
  "headerText"=CASE WHEN t."historicalCatalogOnly" THEN latest."headerText" ELSE t."headerText" END,
  "badgeTorsoCenter"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeTorsoCenter" ELSE t."badgeTorsoCenter" END,
  "badgeTorsoSides"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeTorsoSides" ELSE t."badgeTorsoSides" END,
  "badgeInnerCircle"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeInnerCircle" ELSE t."badgeInnerCircle" END,
  "badgeShorts"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeShorts" ELSE t."badgeShorts" END,
  "nameAliases"=stats.aliases,
  "updatedAt"=transaction_timestamp()
FROM latest,stats WHERE t.id=latest."teamId" AND stats."teamId"=t.id;

DO $verify$
DECLARE v_before _team_continuity_before%ROWTYPE;
BEGIN
  SELECT * INTO v_before FROM _team_continuity_before;
  IF (SELECT count(*) FROM public.teams)<>v_before.teams
    OR (SELECT count(*) FROM public.team_seasons)<>v_before.team_seasons
    OR (SELECT count(*) FROM private.uci_catalog_team_links)<>v_before.uci_links
    OR (SELECT count(*) FROM private.historical_team_roster_observations)<>v_before.roster_observations
    OR (SELECT count(*) FROM public.rider_team_affiliations)<>v_before.affiliations
    OR (SELECT count(*) FROM public.race_uci_results)<>v_before.results
    OR (SELECT count(*) FROM public.startlist_teams)<>v_before.startlist_teams THEN
    RAISE EXCEPTION 'La consolidación alteró el número de filas';
  END IF;
  IF EXISTS(SELECT 1 FROM public.team_seasons GROUP BY "teamId",year HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM public.team_seasons s JOIN public.teams t ON t.id=s."teamId" WHERE s.gender IS DISTINCT FROM t.gender)
    OR EXISTS(SELECT 1 FROM private.uci_catalog_team_links l LEFT JOIN public.team_seasons s
      ON s."teamId"=l.team_id AND s.year=l.season WHERE s.id IS NULL OR l.gender IS DISTINCT FROM s.gender OR l.category IS DISTINCT FROM s.category)
    OR EXISTS(SELECT 1 FROM private.historical_team_roster_observations o LEFT JOIN public.teams t ON t.id=o."teamId" WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'La consolidación produjo solapamientos o referencias incompatibles';
  END IF;
  IF EXISTS(SELECT 1 FROM public.team_seasons x WHERE ${source('x."teamId"')})
    OR EXISTS(SELECT 1 FROM private.uci_catalog_team_links x WHERE ${source('x.team_id')})
    OR EXISTS(SELECT 1 FROM private.historical_team_roster_observations x WHERE ${source('x."teamId"')})
    OR EXISTS(SELECT 1 FROM public.rider_team_affiliations x WHERE ${source('x."teamId"')})
    OR EXISTS(SELECT 1 FROM public.race_uci_results x WHERE ${source('x."teamId"')})
    OR EXISTS(SELECT 1 FROM public.startlist_teams x WHERE ${source('x."teamId"')}) THEN
    RAISE EXCEPTION 'Quedan referencias operativas en identidades retiradas';
  END IF;
  IF (SELECT count(*) FROM public.teams t WHERE ${source('t.id')} AND t."historicalCatalogOnly"=true)<>${expected} THEN
    RAISE EXCEPTION 'No se conservaron las ${expected} identidades ocultas de compatibilidad';
  END IF;
  IF (SELECT count(*) FROM private.repair_team_continuity_20260907_backup)
     <> (SELECT rows FROM _team_continuity_backup_count) THEN
    RAISE EXCEPTION 'El backup cambió durante la reparación';
  END IF;
END
$verify$;

COMMIT;

-- Rollback dirigido: restaurar desde row_data por entidad dentro de una transacción,
-- empezando por teams y team_seasons. El backup conserva cada fila completa previa.
`;
await writeFile(outputFile, sql, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify({ mappings: expected, bytes: sql.length })}\n`);
