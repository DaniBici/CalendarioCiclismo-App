CREATE OR REPLACE FUNCTION public.reject_dangling_startlist_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."teamId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.teams t
       WHERE t.id = NEW."teamId"
     ) THEN
    RAISE EXCEPTION 'El teamId % no existe en public.teams', NEW."teamId";
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_dangling_startlist_team() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_dangling_startlist_team() TO service_role;

DROP TRIGGER IF EXISTS startlist_team_reference_guard_trg ON public.startlist_teams;
CREATE TRIGGER startlist_team_reference_guard_trg
  BEFORE INSERT OR UPDATE OF "teamId"
  ON public.startlist_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_dangling_startlist_team();

COMMENT ON FUNCTION public.reject_dangling_startlist_team() IS
  'Rechaza teamId inexistentes en startlist_teams; Individual conserva teamId NULL.';
