-- Recalcular también las correcciones del panel. El disparador diferido observa
-- el cuadro final de la transacción y no el vacío temporal del DELETE/INSERT.
CREATE FUNCTION public.result_metrics_correction() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ref text; race_id text; day_id text;
BEGIN
  IF TG_OP='DELETE' THEN ref:=OLD."stageRef"; race_id:=OLD."raceId";
  ELSE ref:=NEW."stageRef"; race_id:=NEW."raceId"; END IF;
  SELECT "raceDayId" INTO day_id FROM public.race_uci_stages WHERE id=ref;
  IF day_id IS NOT NULL THEN
    PERFORM public.refresh_race_day_metrics(day_id);
  ELSE
    FOR day_id IN SELECT id FROM public.race_days WHERE "raceId"=race_id LOOP
      PERFORM public.refresh_race_day_metrics(day_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.result_metrics_correction() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER result_winner_insert AFTER INSERT ON public.race_uci_results
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.rank=1) EXECUTE FUNCTION public.result_metrics_correction();
CREATE CONSTRAINT TRIGGER result_winner_delete AFTER DELETE ON public.race_uci_results
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.rank=1) EXECUTE FUNCTION public.result_metrics_correction();
CREATE CONSTRAINT TRIGGER result_winner_update AFTER UPDATE ON public.race_uci_results
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN ((OLD.rank=1 OR NEW.rank=1) AND (OLD.rank IS DISTINCT FROM NEW.rank OR OLD."timeText" IS DISTINCT FROM NEW."timeText" OR OLD.irm IS DISTINCT FROM NEW.irm))
  EXECUTE FUNCTION public.result_metrics_correction();
