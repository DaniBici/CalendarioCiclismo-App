-- Una modificación directa del ID de ficha no cambia nacimiento/verified.
-- Invalidar las generales que aún referencian el ID anterior o el nuevo.
CREATE FUNCTION private.cx_standings_identity_id_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; source_category text;
BEGIN
  IF OLD.id IS NOT DISTINCT FROM NEW.id THEN RETURN NULL; END IF;
  FOR target,source_category IN SELECT DISTINCT r."tournamentId",x.category FROM public.cx_results x
    JOIN public.cx_races r ON r.id=x."raceId" WHERE r."tournamentId" IS NOT NULL
    AND x."globalRiderId" IN (OLD.id,NEW.id)
    AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
    PERFORM private.cx_enqueue_standings(target,source_category);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER cx_standings_men_id_changed AFTER UPDATE OF id ON public.cx_riders_men
  FOR EACH ROW EXECUTE FUNCTION private.cx_standings_identity_id_changed();
CREATE TRIGGER cx_standings_women_id_changed AFTER UPDATE OF id ON public.cx_riders_women
  FOR EACH ROW EXECUTE FUNCTION private.cx_standings_identity_id_changed();
REVOKE ALL ON FUNCTION private.cx_standings_identity_id_changed() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
