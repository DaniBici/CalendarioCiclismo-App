-- El worker de resultados puede escribir fichas, pero solo lee teams.
-- SELECT FOR SHARE exigiría UPDATE en teams. Un advisory lock compartido por
-- ambos triggers conserva la serialización sin ampliar privilegios.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_regular_team_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_team_id text;
  v_selection boolean;
BEGIN
  IF TG_TABLE_NAME = 'rider_team_affiliations' THEN
    v_team_id := NEW."teamId";
  ELSE
    v_team_id := NEW."currentTeamId";
  END IF;
  IF v_team_id IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('regular-team-roster:' || v_team_id, 0));
  SELECT t."teamKind" = 'selection' OR t.category IN ('NTM', 'NTW')
    INTO v_selection FROM public.teams t WHERE t.id = v_team_id;
  IF v_selection THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Las selecciones no admiten plantilla permanente; usa la startlist para sus convocatorias.',
      CONSTRAINT = 'regular_team_roster_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_selection_team_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW."teamKind" = 'selection' OR NEW.category IN ('NTM', 'NTW') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('regular-team-roster:' || NEW.id, 0));
    IF EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" = NEW.id)
       OR EXISTS (SELECT 1 FROM public.riders_men WHERE "currentTeamId" = NEW.id)
       OR EXISTS (SELECT 1 FROM public.riders_women WHERE "currentTeamId" = NEW.id) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Retira las afiliaciones de plantilla antes de convertir el equipo en selección.',
        CONSTRAINT = 'selection_without_roster';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_regular_team_roster(),
  public.guard_selection_team_classification()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_regular_team_roster(),
  public.guard_selection_team_classification() TO service_role;

COMMIT;
