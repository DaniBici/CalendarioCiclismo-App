-- Enlace de las clasificaciones por equipos (linkTeamResultRowsSql de
-- scripts/results-fetchers/results-upsert.mjs) contra la startlist de la carrera.
-- El UPDATE central es la salida literal de linkTeamResultRowsSql('zz-test-team-link');
-- tras modificar la función, regenerarlo con:
--   node --input-type=module -e "const m=await import('./scripts/results-fetchers/results-upsert.mjs');console.log(m.linkTeamResultRowsSql('zz-test-team-link'))"
-- Ninguna fila de prueba persiste.
BEGIN;
INSERT INTO public.races(id,name,gender,year) VALUES
 ('zz-test-team-link','Prueba enlace de equipos','male',2026),
 ('zz-test-team-link-other','Prueba enlace de equipos, otra carrera','male',2026);
INSERT INTO public.teams(id,name,gender,category,"nameAliases") VALUES
 ('zz-team-link-nsn','ZZNSN Development Team','male','CT',NULL),
 ('zz-team-link-fx','ZZFX - SCOM - Hengxiang Cycling Team','male','CT',NULL),
 ('zz-team-link-pio','ZZ Pío Rico Cycling Team','male','CT',NULL),
 ('zz-team-link-ho','ZZHO-ONE','male','CT',NULL),
 ('zz-team-link-alias','ZZ Nombre Canónico','male','CT','ZZ Nombre Anterior'),
 ('zz-team-link-published','ZZ Nombre Ficha','male','CT',NULL);
INSERT INTO public.startlist_teams(id,"raceId","teamId","teamName") VALUES
 ('zz-team-link-st-nsn','zz-test-team-link','zz-team-link-nsn','ZZNSN Development Team'),
 ('zz-team-link-st-fx','zz-test-team-link','zz-team-link-fx','ZZFX - SCOM - Hengxiang Cycling Team'),
 ('zz-team-link-st-pio','zz-test-team-link','zz-team-link-pio','ZZ Pío Rico Cycling Team'),
 ('zz-team-link-st-ho','zz-test-team-link','zz-team-link-ho','ZZHO-ONE'),
 ('zz-team-link-st-alias','zz-test-team-link','zz-team-link-alias','ZZ Nombre Canónico'),
 ('zz-team-link-st-published','zz-test-team-link','zz-team-link-published','ZZ Nombre Publicado');
INSERT INTO public.race_uci_stages(id,"raceId","competitionId","uciRaceId","eventId","classKind","isTeamEvent") VALUES
 ('zz-team-link-teams','zz-test-team-link',-929000001,-929000001,-929000001,'teams',true),
 ('zz-team-link-stage','zz-test-team-link',-929000001,-929000001,-929000002,'stage',false),
 ('zz-team-link-other-teams','zz-test-team-link-other',-929000003,-929000003,-929000003,'teams',true);
INSERT INTO public.race_uci_results("stageRef","raceId","eventId",rank,bib,"sourceTeamName","riderDisplay") VALUES
 -- Envoltorio de código UCI y país; sourceTeamName prevalece sobre riderDisplay.
 ('zz-team-link-teams','zz-test-team-link',-929000001,1,NULL,'NDT - ZZNSN DEVELOPMENT TEAM (SUI)','ZZ PIO RICO'),
 -- Nombre real con « - »: el recorte del código se come «ZZFX - »; casa core_raw.
 ('zz-team-link-teams','zz-test-team-link',-929000001,2,NULL,'ZZFX - SCOM - HENGXIANG CYCLING TEAM (CHN)',NULL),
 -- Acentos y sufijos genéricos plegados.
 ('zz-team-link-teams','zz-test-team-link',-929000001,3,NULL,'ZZ PIO RICO',NULL),
 -- Guion sin espacios: no es envoltorio y no se recorta.
 ('zz-team-link-teams','zz-test-team-link',-929000001,4,NULL,'ZZHO-ONE (JPN)',NULL),
 -- sourceTeamName vacío: se usa riderDisplay y casa un alias de la ficha.
 ('zz-team-link-teams','zz-test-team-link',-929000001,5,NULL,'  ','ZZ NOMBRE ANTERIOR'),
 -- Forma publicada en la startlist, distinta del nombre de la ficha.
 ('zz-team-link-teams','zz-test-team-link',-929000001,6,NULL,'ZZ Nombre Publicado',NULL),
 ('zz-team-link-teams','zz-test-team-link',-929000001,7,NULL,'ZZ Equipo Desconocido',NULL),
 -- Fuera de alcance: clasificación individual y otra carrera.
 ('zz-team-link-stage','zz-test-team-link',-929000002,1,'1','ZZ PIO RICO','ZZ Corredor'),
 ('zz-team-link-other-teams','zz-test-team-link-other',-929000003,1,NULL,'ZZ PIO RICO',NULL);
WITH src AS (
  SELECT r.id,
         COALESCE(public.fold_team_name(
           regexp_replace(
             regexp_replace(COALESCE(NULLIF(btrim(r."sourceTeamName"), ''), r."riderDisplay"), '^\s*[A-Z0-9]{2,4}\s+-\s+', ''),
             '\s*\([A-Za-z]{3}\)\s*$', '')), '') AS core,
         COALESCE(public.fold_team_name(
           regexp_replace(COALESCE(NULLIF(btrim(r."sourceTeamName"), ''), r."riderDisplay"),
             '\s*\([A-Za-z]{3}\)\s*$', '')), '') AS core_raw
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  WHERE r."raceId" = 'zz-test-team-link'
    AND s."classKind" = 'teams'
    AND COALESCE(NULLIF(btrim(r."sourceTeamName"), ''), r."riderDisplay") IS NOT NULL
), cand AS (
  SELECT st."teamId",
         st."sortOrder",
         st.id AS st_id,
         COALESCE(public.fold_team_name(btrim(alias.name)), '') AS core
  FROM public.startlist_teams st
  JOIN public.teams t ON t.id = st."teamId"
  CROSS JOIN LATERAL unnest(string_to_array(
    COALESCE(st."teamName", '') || E'\n' || t.name || E'\n' || COALESCE(t."nameAliases", ''), E'\n'
  )) AS alias(name)
  WHERE st."raceId" = 'zz-test-team-link'
    AND btrim(alias.name) <> ''
), matches AS (
  SELECT src.id, cand."teamId",
         row_number() OVER (
           PARTITION BY src.id
           ORDER BY core_hit DESC, exact_hit DESC, cand."sortOrder", cand.st_id
         ) AS rn
  FROM src
  JOIN LATERAL (
    SELECT c."teamId", c."sortOrder", c.st_id,
           (c.core = src.core) AS core_hit,
           (c.core = src.core OR c.core = src.core_raw) AS exact_hit
    FROM cand c
    WHERE c.core = src.core
       OR c.core = src.core_raw
       OR regexp_replace(c.core, '(cyclingteam|team)$', '')
          = regexp_replace(src.core, '(cyclingteam|team)$', '')
  ) cand ON TRUE
)
UPDATE public.race_uci_results r
SET "teamId" = m."teamId"
FROM matches m
WHERE r.id = m.id
  AND m.rn = 1
  AND r."teamId" IS DISTINCT FROM m."teamId";
DO $$
DECLARE v_got jsonb; v_expected jsonb := jsonb_build_object(
  '1','zz-team-link-nsn','2','zz-team-link-fx','3','zz-team-link-pio',
  '4','zz-team-link-ho','5','zz-team-link-alias','6','zz-team-link-published','7',NULL);
BEGIN
  SELECT jsonb_object_agg(rank::text,"teamId") INTO v_got
  FROM public.race_uci_results WHERE "stageRef"='zz-team-link-teams';
  IF v_got IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Enlace de equipos incorrecto: %',v_got;
  END IF;
  IF EXISTS(SELECT 1 FROM public.race_uci_results
    WHERE "stageRef" IN ('zz-team-link-stage','zz-team-link-other-teams') AND "teamId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Enlaza filas fuera de las clasificaciones por equipos de la carrera';
  END IF;
END $$;
ROLLBACK;
SELECT 'OK: envoltorio UCI, nombre con guiones, acentos, alias, forma publicada y alcance' AS result;
