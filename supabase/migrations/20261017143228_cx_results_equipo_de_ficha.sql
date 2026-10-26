-- Resultados CX: el equipo de la ficha prevalece sobre el de la fuente.
-- Una fila con globalRiderId cuya ficha tiene currentTeamId muestra el nombre
-- de ese equipo, venga de DataRide, ACN, Wiclax, carga manual o panel; el
-- teamName de la fuente no crea ni enlaza equipos para ella. Excepción: las
-- selecciones nacionales conservan el nombre de la fuente. Sin ficha o con
-- ficha sin equipo se mantiene el comportamiento anterior (resolución por
-- nombre o alias, alta automática y enlace de la ficha).
CREATE OR REPLACE FUNCTION private.cx_results_team_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_male boolean := left(NEW.category,1) = 'M'; v_team_id text; v_source text; v_canon text;
  v_selection boolean; v_ficha_team text;
BEGIN
  v_selection := nullif(btrim(NEW."teamName"),'') IS NOT NULL
    AND lower(NEW."teamName") ~ '(national|nationalmannschaft|nationale ploeg|selecci[oó]n|s[eé]lection)';
  IF nullif(btrim(NEW."teamName"),'') IS NOT NULL AND private.cx_is_no_team(NEW."teamName") AND NOT v_selection THEN
    NEW."teamName" := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."teamName" IS NOT DISTINCT FROM OLD."teamName"
     AND NEW."globalRiderId" IS NOT DISTINCT FROM OLD."globalRiderId" THEN
    RETURN NEW;
  END IF;
  -- Ficha con equipo: su nombre sustituye al de la fuente.
  IF NEW."globalRiderId" IS NOT NULL AND NOT v_selection THEN
    IF v_male THEN
      SELECT t.name INTO v_ficha_team FROM public.cx_riders_men r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    ELSE
      SELECT t.name INTO v_ficha_team FROM public.cx_riders_women r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    END IF;
    IF v_ficha_team IS NOT NULL THEN
      NEW."teamName" := v_ficha_team;
      RETURN NEW;
    END IF;
  END IF;
  IF nullif(btrim(NEW."teamName"),'') IS NOT NULL THEN
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
  END IF;
  RETURN NEW;
END $function$;
