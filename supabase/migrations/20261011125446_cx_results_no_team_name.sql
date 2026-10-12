-- Un corredor independiente («INDIVIDUEEL», «Individual», «Geen ploeg»…) no tiene equipo:
-- la fila de resultados guarda teamName NULL en lugar del texto de la fuente, que la web
-- mostraba como si fuera un equipo. cx_ensure_team ya no creaba club para estos nombres;
-- aquí tampoco se conserva el texto. Las selecciones nacionales mantienen su nombre.
CREATE OR REPLACE FUNCTION private.cx_results_team_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_male boolean := left(NEW.category,1) = 'M'; v_team_id text; v_source text; v_canon text;
BEGIN
  IF nullif(btrim(NEW."teamName"),'') IS NOT NULL AND private.cx_is_no_team(NEW."teamName")
     AND lower(NEW."teamName") !~ '(national|nationalmannschaft|nationale ploeg|selecci[oó]n|s[eé]lection)' THEN
    NEW."teamName" := NULL;
  END IF;
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
    -- Texto en mayúsculas de la fuente (DataRide, ACN): la fila enlazada toma el
    -- nombre canónico del equipo resuelto por nombre plegado o por alias.
    IF NEW."teamName" = upper(NEW."teamName") AND NEW."teamName" <> lower(NEW."teamName") THEN
      SELECT name INTO v_canon FROM public.cx_teams WHERE id = v_team_id;
      IF v_canon IS NOT NULL THEN
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
END $function$;
