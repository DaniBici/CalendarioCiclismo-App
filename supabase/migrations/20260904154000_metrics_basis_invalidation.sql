-- Invalidar el fuera de control al cambiar cualquier base, incluso si la media coincide.
CREATE OR REPLACE FUNCTION public.refresh_race_day_metrics(day_id text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.race_days; seconds numeric; distance numeric; speed numeric;
BEGIN
  SELECT * INTO d FROM public.race_days WHERE id=day_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  distance := COALESCE(d."competitiveDistanceKm",d."distanceKm");
  -- CRI: tiempo absoluto del ganador. CRE: solo tiempo de equipo acreditado por
  -- el captador; nunca el tiempo de un compañero de una expansión de roster.
  IF d."timingPolicy"='standard' AND NOT d."isCancelledDay" AND NOT d."isRestDay" AND distance>0 THEN
    IF d."primaryType"='ttt' THEN
      SELECT (p.evidence->>'raceTimeSeconds')::numeric INTO seconds
      FROM private.result_publication_state p JOIN public.race_uci_stages s ON s.id=p."stageRef"
      WHERE s."raceDayId"=day_id AND s."classKind"='stage'
        AND p.evidence->>'raceTimeKind'='team' AND p.evidence->>'raceTimeSeconds' ~ '^\d+(\.\d+)?$'
      ORDER BY s."eventId" DESC LIMIT 1;
    ELSE
      SELECT min(public.result_time_seconds(r."timeText")) INTO seconds
      FROM public.race_uci_results r JOIN public.race_uci_stages s ON s.id=r."stageRef"
      JOIN public.races race ON race.id=s."raceId"
      WHERE (s."raceDayId"=day_id OR (s."raceDayId" IS NULL AND s."raceId"=d."raceId" AND race."raceFormat"='one_day')) AND (s."classKind"='stage' OR (s."classKind"='gc' AND race."raceFormat"='one_day'))
        AND r.rank=1 AND NULLIF(trim(r.irm),'') IS NULL;
    END IF;
    IF seconds>0 THEN speed := distance*3600/seconds; END IF;
  ELSIF d."timingPolicy"='manual' AND NOT d."isCancelledDay" AND NOT d."isRestDay" THEN
    seconds := d."raceTimeSeconds";
    IF seconds>0 AND distance>0 THEN speed := distance*3600/seconds; END IF;
  END IF;
  IF d."raceTimeSeconds" IS DISTINCT FROM seconds OR d."averageSpeedKmh" IS DISTINCT FROM speed THEN
    UPDATE public.race_days SET "raceTimeSeconds"=seconds,"averageSpeedKmh"=speed,
      "timeLimitSeconds"=NULL,"timeLimitBasis"=NULL,"metricsUpdatedAt"=now() WHERE id=day_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_race_day_metrics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_race_day_metrics(text) TO cc_results_worker,authenticated;


CREATE OR REPLACE FUNCTION public.race_day_metrics_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  UPDATE public.race_days SET "timeLimitSeconds"=NULL,"timeLimitBasis"=NULL,"metricsUpdatedAt"=now() WHERE id=NEW.id;
  PERFORM public.refresh_race_day_metrics(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.race_day_metrics_changed() FROM PUBLIC;
