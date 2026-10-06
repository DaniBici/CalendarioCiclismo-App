-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260629124109, nombre 116_invert_team_truth_affiliations_to_current_team). Texto aplicado en producción, sin cambios.

-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 1 del EXPAND: INVERTIR la verdad del modelo temporal de equipos.
-- rider_team_affiliations pasa a ser la fuente de verdad; riders_*.currentTeamId
-- se DERIVA de la afiliación del año en curso activa HOY.
--
-- Diseño de puente bidireccional (cero downtime; los escritores de currentTeamId
-- siguen funcionando hasta la Fase 2/CONTRACT):
--   · INVERSO (nuevo): escribir/borrar una afiliación → recalcula currentTeamId.
--   · FORWARD (077, conservado y ARREGLADO): escribir currentTeamId → mantiene la
--     afiliación simple del año, ahora sin el bug de colisión de id.
--   · Guarda de recursión con pg_trigger_depth(): cada lado se inhibe cuando el que
--     escribe es el otro trigger, así no se pelean ni hacen bucle.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Derivación: currentTeamId = teamId de la afiliación del año en curso activa hoy ──
CREATE OR REPLACE FUNCTION public.recompute_current_team(p_rider_id text, p_gender text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_year integer := extract(year from now())::int;
  v_team text;
BEGIN
  SELECT a."teamId" INTO v_team
  FROM public.rider_team_affiliations a
  WHERE a."riderId" = p_rider_id
    AND a."riderGender" = p_gender
    AND a.year = v_year
    AND (a."dateFrom" IS NULL OR a."dateFrom" <= CURRENT_DATE)
    AND (a."dateTo"   IS NULL OR a."dateTo"   >= CURRENT_DATE)
  ORDER BY a."dateFrom" DESC NULLS LAST, a."updatedAt" DESC, a.id
  LIMIT 1;

  IF p_gender = 'male' THEN
    UPDATE public.riders_men
       SET "currentTeamId" = v_team, "updatedAt" = now()
     WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  ELSIF p_gender = 'female' THEN
    UPDATE public.riders_women
       SET "currentTeamId" = v_team, "updatedAt" = now()
     WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  END IF;
END $$;

-- ── Trigger INVERSO: cualquier cambio en afiliaciones → recompute del/los rider(s) ──
CREATE OR REPLACE FUNCTION public.sync_affiliation_to_current_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- No reaccionar cuando el que escribe la afiliación es el FORWARD (evita bucle).
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'DELETE') THEN
    PERFORM public.recompute_current_team(OLD."riderId", OLD."riderGender");
    RETURN OLD;
  END IF;

  -- INSERT / UPDATE: recalcular el rider de NEW (y el de OLD si cambió de rider/gender).
  PERFORM public.recompute_current_team(NEW."riderId", NEW."riderGender");
  IF (TG_OP = 'UPDATE') AND
     (OLD."riderId" IS DISTINCT FROM NEW."riderId" OR OLD."riderGender" IS DISTINCT FROM NEW."riderGender") THEN
    PERFORM public.recompute_current_team(OLD."riderId", OLD."riderGender");
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_affiliation_to_current_team ON public.rider_team_affiliations;
CREATE TRIGGER sync_affiliation_to_current_team
AFTER INSERT OR UPDATE OR DELETE ON public.rider_team_affiliations
FOR EACH ROW EXECUTE FUNCTION public.sync_affiliation_to_current_team();

-- ── FORWARD arreglado (sustituye al de 077): currentTeamId → afiliación simple ──
-- Fix del bug de colisión: borra TODA afiliación SIMPLE del año del rider antes de
-- insertar la nueva (no solo la de id coincidente) → no quedan punteros obsoletos.
-- Guarda pg_trigger_depth: no reacciona cuando quien escribe currentTeamId es el INVERSO.
CREATE OR REPLACE FUNCTION public.sync_rider_to_affiliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_year   integer := extract(year from now())::int;
  v_gender text := TG_ARGV[0];
BEGIN
  -- No reaccionar cuando el que escribe currentTeamId es el INVERSO (evita bucle).
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Borrar TODA la afiliación simple (sin fechas) del rider en el año (no solo la del
  -- id que coincidiría) → corrige el bug de colisión de id (cambio de equipo dejaba
  -- punteros obsoletos vivos).
  DELETE FROM public.rider_team_affiliations
  WHERE "riderId" = NEW.id
    AND "riderGender" = v_gender
    AND year = v_year
    AND "dateFrom" IS NULL
    AND "dateTo" IS NULL;

  -- Insertar la nueva simple solo si tiene equipo (NULL = sin equipo → sin afiliación simple).
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
