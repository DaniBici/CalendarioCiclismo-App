-- ═══════════════════════════════════════════════════════════════════
--  DOBLE ESCRITURA AL MODELO TEMPORAL (triggers)
--
--  El panel y los scripts escriben el modelo VIEJO (teams, riders_*.currentTeamId).
--  Estos triggers propagan AUTOMÁTICAMENTE y de forma ATÓMICA al modelo NUEVO
--  (team_seasons, rider_team_affiliations) del AÑO EN CURSO, para que ambos queden
--  coherentes mientras las apps en producción siguen leyendo el viejo (~2 semanas de
--  propagación tras un release). El modelo viejo NUNCA se degrada: es solo lectura
--  para los triggers; estos solo AÑADEN al nuevo.
--
--  Año en curso = extract(year from now()) — el panel no tiene "temporada activa".
--
--  Cubren TODOS los puntos de escritura (panel ~12 + scripts + futuro) sin tocar el
--  JS: imposible olvidar un punto porque la propagación vive en la BD.
-- ═══════════════════════════════════════════════════════════════════

-- ─── A1: teams → team_seasons[año] ───────────────────────────────
-- Upsert de la versión-temporada del año en curso espejando los campos visuales.
-- Los specialEdition NO generan season (son denominaciones de tramo/carrera, no la
-- versión canónica del año — decisión del modelo de vigencia, migración 076).
CREATE OR REPLACE FUNCTION public.sync_team_to_season()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_year integer := extract(year from now())::int;
BEGIN
  IF NEW."specialEdition" IS TRUE THEN
    RETURN NEW;  -- los maillots especiales no son la versión canónica del año
  END IF;

  INSERT INTO public.team_seasons (
    id, "teamId", year, name, "nameAliases", category, gender,
    "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides",
    "badgeInnerCircle", "badgeShorts", translations, "createdAt", "updatedAt"
  ) VALUES (
    NEW.id || '_' || v_year, NEW.id, v_year, NEW.name, NEW."nameAliases",
    NEW.category, NEW.gender,
    COALESCE(NEW."headerBg", '#1f2937'), COALESCE(NEW."headerText", '#ffffff'),
    COALESCE(NEW."badgeTorsoCenter", '#ffffff'), COALESCE(NEW."badgeTorsoSides", '#000000'),
    NEW."badgeInnerCircle", COALESCE(NEW."badgeShorts", '#000000'),
    '{}'::jsonb, now(), now()
  )
  ON CONFLICT ("teamId", year) DO UPDATE SET
    name               = EXCLUDED.name,
    "nameAliases"      = EXCLUDED."nameAliases",
    category           = EXCLUDED.category,
    gender             = EXCLUDED.gender,
    "headerBg"         = EXCLUDED."headerBg",
    "headerText"       = EXCLUDED."headerText",
    "badgeTorsoCenter" = EXCLUDED."badgeTorsoCenter",
    "badgeTorsoSides"  = EXCLUDED."badgeTorsoSides",
    "badgeInnerCircle" = EXCLUDED."badgeInnerCircle",
    "badgeShorts"      = EXCLUDED."badgeShorts",
    "updatedAt"        = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_team_to_season_trg ON public.teams;
CREATE TRIGGER sync_team_to_season_trg
  AFTER INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_to_season();

-- ─── A2: riders_*.currentTeamId → rider_team_affiliations[año] ────
-- Mantiene la afiliación "simple" (sin fechas de traspaso) del año en curso.
-- Se borra la simple previa de ese (riderId, year) —sea cual sea su id/teamId, p.ej.
-- la sembrada por el catálogo oro— y se inserta la nueva. No toca las filas con
-- dateFrom/dateTo (traspasos intra-año), que un futuro editor podría crear.
-- p_gender se pasa por argumento del trigger (riders_men → 'male', riders_women → 'female').
CREATE OR REPLACE FUNCTION public.sync_rider_to_affiliation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_year   integer := extract(year from now())::int;
  v_gender text := TG_ARGV[0];
BEGIN
  -- Borrar la afiliación simple (sin fechas) previa de este rider en el año.
  DELETE FROM public.rider_team_affiliations
  WHERE "riderId" = NEW.id
    AND "riderGender" = v_gender
    AND year = v_year
    AND "dateFrom" IS NULL
    AND "dateTo" IS NULL;

  -- Insertar la nueva solo si tiene equipo (NULL = se quitó el equipo → queda sin afiliación simple).
  IF NEW."currentTeamId" IS NOT NULL THEN
    INSERT INTO public.rider_team_affiliations (
      id, "riderId", "riderGender", "teamId", year,
      "dateFrom", "dateTo", source, verified, "createdAt", "updatedAt"
    ) VALUES (
      NEW.id || '__' || NEW."currentTeamId" || '__' || v_year,
      NEW.id, v_gender, NEW."currentTeamId", v_year,
      NULL, NULL, 'panel', COALESCE(NEW.verified, false), now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      "teamId"    = EXCLUDED."teamId",
      verified    = EXCLUDED.verified,
      "updatedAt" = now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_rider_to_affiliation_men ON public.riders_men;
CREATE TRIGGER sync_rider_to_affiliation_men
  AFTER INSERT OR UPDATE OF "currentTeamId" ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_to_affiliation('male');

DROP TRIGGER IF EXISTS sync_rider_to_affiliation_women ON public.riders_women;
CREATE TRIGGER sync_rider_to_affiliation_women
  AFTER INSERT OR UPDATE OF "currentTeamId" ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_to_affiliation('female');
