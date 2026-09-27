-- Resultados: el nombre de equipo en mayúsculas que coincide con el nombre
-- plegado del equipo resuelto se guarda con la grafía canónica del catálogo.
CREATE OR REPLACE FUNCTION private.cx_results_team_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_male boolean := left(NEW.category,1) = 'M'; v_team_id text; v_source text; v_canon text;
BEGIN
  IF nullif(btrim(NEW."teamName"),'') IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND NEW."teamName" IS NOT DISTINCT FROM OLD."teamName"
       AND NEW."globalRiderId" IS NOT DISTINCT FROM OLD."globalRiderId" THEN
      RETURN NEW;
    END IF;
    SELECT coalesce(c."resultsSourceUrl", r."websiteUrl") INTO v_source
      FROM public.cx_races r LEFT JOIN public.cx_race_categories c
        ON c."raceId" = r.id AND c.category = NEW.category
     WHERE r.id = NEW."raceId";
    v_team_id := private.cx_ensure_team(NEW."teamName", CASE WHEN v_male THEN 'male' ELSE 'female' END,
      NEW."isoCode2", NEW."raceId", v_source);
    -- Texto en mayúsculas (DataRide) del mismo nombre: se guarda el nombre canónico.
    IF NEW."teamName" = upper(NEW."teamName") AND NEW."teamName" <> lower(NEW."teamName") THEN
      SELECT name INTO v_canon FROM public.cx_teams WHERE id = v_team_id;
      IF v_canon <> upper(v_canon) AND public.fold_team_name(v_canon) = public.fold_team_name(NEW."teamName") THEN
        NEW."teamName" := v_canon;
      END IF;
    END IF;
    v_team_id := private.cx_team_for_rider(v_team_id, v_male, NEW."globalRiderId", NEW."raceId");
    PERFORM private.cx_link_rider_team(v_male, NEW."globalRiderId", v_team_id);
  ELSIF NEW."globalRiderId" IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW."globalRiderId" IS DISTINCT FROM OLD."globalRiderId") THEN
    IF v_male THEN
      SELECT t.name INTO NEW."teamName" FROM public.cx_riders_men r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    ELSE
      SELECT t.name INTO NEW."teamName" FROM public.cx_riders_women r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Filas existentes con la grafía en mayúsculas de un equipo del catálogo.
WITH fix AS (
  SELECT x.id, x."teamName" AS before, t.name AS after
  FROM public.cx_results x
  JOIN public.cx_teams t ON t."parentTeamId" IS NULL
   AND public.fold_team_name(t.name) = public.fold_team_name(x."teamName")
  WHERE x."teamName" = upper(x."teamName") AND x."teamName" <> lower(x."teamName")
    AND t.name <> upper(t.name)
), upd AS (
  UPDATE public.cx_results x SET "teamName" = fix.after FROM fix WHERE x.id = fix.id
  RETURNING x.id, fix.before, fix.after
)
INSERT INTO private.cx_change_log (operation, "raceId", category, before, after, evidence)
SELECT 'results_team_case', NULL, NULL,
  jsonb_agg(jsonb_build_object('id', id, 'teamName', before)),
  jsonb_agg(jsonb_build_object('id', id, 'teamName', after)),
  '{"note":"Grafía canónica de equipos del catálogo en lugar de mayúsculas de DataRide"}'::jsonb
FROM upd HAVING count(*) > 0;
