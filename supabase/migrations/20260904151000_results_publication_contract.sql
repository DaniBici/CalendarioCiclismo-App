ALTER TABLE public.race_uci_stages
  ADD COLUMN "publicationStatus" text NOT NULL DEFAULT 'provisional' CHECK ("publicationStatus" IN ('provisional','official')),
  ADD COLUMN "lastSyncedAt" timestamptz,
  ADD COLUMN updating boolean NOT NULL DEFAULT false;

CREATE TABLE private.result_publication_state (
  "stageRef" text PRIMARY KEY REFERENCES public.race_uci_stages(id) ON DELETE CASCADE,
  provider text NOT NULL,
  "sourceFormat" text NOT NULL,
  fingerprint text NOT NULL,
  "stableReads" integer NOT NULL DEFAULT 1,
  "observedAt" timestamptz NOT NULL,
  "changedAt" timestamptz NOT NULL,
  "sourceModifiedAt" timestamptz,
  expected jsonb,
  resolved jsonb,
  complete boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE private.result_publication_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY publication_worker ON private.result_publication_state FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY publication_admin ON private.result_publication_state FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT,INSERT,UPDATE,DELETE ON private.result_publication_state TO cc_results_worker,authenticated;

CREATE FUNCTION public.result_time_seconds(value text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parts text[]; total numeric := 0; item text;
BEGIN
  IF value IS NULL OR value !~ '^\d+(:[0-5]?\d){0,2}([.,]\d+)?$' THEN RETURN NULL; END IF;
  parts := string_to_array(replace(value,',','.'),':');
  FOREACH item IN ARRAY parts LOOP total := total*60+item::numeric; END LOOP;
  RETURN NULLIF(total,0);
END;
$$;
REVOKE ALL ON FUNCTION public.result_time_seconds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.result_time_seconds(text) TO cc_results_worker,authenticated;

CREATE FUNCTION public.refresh_race_day_metrics(day_id text) RETURNS void
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
  ELSIF d."timingPolicy"='manual' THEN
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

CREATE FUNCTION public.record_result_observation(stage_ref text, observation jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  s public.race_uci_stages; old private.result_publication_state; d public.race_days;
  source text := observation->>'provider'; format text := observation->>'format';
  sampled timestamptz; digest text; expected_ids jsonb; resolved_ids jsonb;
  row_total integer; unique_total integer; complete boolean := false; stable integer := 1;
  progressive boolean; official boolean; base_kind text; earlier_missing boolean;
BEGIN
  SELECT * INTO s FROM public.race_uci_stages WHERE id=stage_ref FOR UPDATE;
  IF NOT FOUND OR s."lockedAt" IS NOT NULL THEN RETURN; END IF;
  IF source IS NULL OR format IS NULL OR format NOT IN ('uci','pdf','progressive','fixed','unknown') THEN
    RAISE EXCEPTION 'Observación sin origen efectivo válido';
  END IF;
  sampled := COALESCE((observation->>'observedAt')::timestamptz,now());
  SELECT * INTO old FROM private.result_publication_state WHERE "stageRef"=stage_ref;
  -- Reaplicar el mismo archivo no constituye otra lectura de la fuente.
  -- El mismo muestreo no suma estabilidad. Una corrección invalida el estado.
  SELECT count(*), md5(COALESCE(jsonb_agg(jsonb_build_array(r.bib,r."globalRiderId",r."riderDisplay",r."teamId",r.rank,r."rankText",r."timeText",r."gapText",r.points,r."uciPoints",r.irm,r."resultValue")
    ORDER BY r.bib NULLS LAST,r."globalRiderId" NULLS LAST,r."teamId" NULLS LAST,r."sortOrder")::text,''))
    INTO row_total,digest FROM public.race_uci_results r WHERE r."stageRef"=stage_ref;
  IF row_total=0 THEN
    UPDATE private.result_publication_state SET "stableReads"=0,complete=false WHERE "stageRef"=stage_ref;
    UPDATE public.race_uci_stages SET "publicationStatus"='provisional',updating=false WHERE id=stage_ref;
    RETURN;
  END IF;
  IF old.fingerprint=digest AND sampled <= old."observedAt" THEN RETURN; END IF;
  progressive := source IN ('matsport','tissot','domtel','sts') AND format='progressive';
  base_kind := CASE WHEN s."classKind"='teams' OR s."isTeamEvent" THEN 'team' ELSE 'bib' END;
  -- Una integración puede aportar un conjunto independiente acreditado; no se
  -- acepta el recuento bruto ni el conjunto de filas recibidas como denominador.
  IF observation->>'expectedVerified'='true' AND observation->>'expectedKind'=base_kind
      AND jsonb_typeof(observation->'expectedIds')='array' AND NULLIF(observation->>'expectedBasis','') IS NOT NULL THEN
    expected_ids := observation->'expectedIds';
  ELSIF s."raceDayId" IS NOT NULL AND base_kind='bib' AND s."classKind" IN ('stage','gc') THEN
    SELECT * INTO d FROM public.race_days WHERE id=s."raceDayId";
    -- No dar por conocidas las bajas si faltan clasificaciones de etapas previas.
    SELECT EXISTS (SELECT 1 FROM public.race_days prev WHERE prev."raceId"=s."raceId" AND NOT prev."isRestDay" AND NOT prev."isCancelledDay"
      AND (prev."dateKey",COALESCE(prev."neutralStartTimeUtc",'-infinity'::timestamptz),prev.id)
        < (d."dateKey",COALESCE(d."neutralStartTimeUtc",'-infinity'::timestamptz),d.id)
      AND NOT EXISTS (SELECT 1 FROM public.race_uci_stages ps WHERE ps."raceDayId"=prev.id AND ps."classKind"='stage' AND ps."publicationStatus"='official')) INTO earlier_missing;
    IF NOT earlier_missing AND EXISTS (SELECT 1 FROM public.races race WHERE race.id=s."raceId" AND race."startlistImportedAt" IS NOT NULL AND NOT COALESCE(race."startlistProvisional",false)) THEN
      SELECT jsonb_agg(sr.dorsal::text ORDER BY sr.dorsal),count(*),count(DISTINCT sr.dorsal)
      INTO expected_ids,row_total,unique_total FROM public.startlist_riders sr WHERE sr."raceId"=s."raceId" AND sr.dorsal IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.race_uci_results r JOIN public.race_uci_stages ps ON ps.id=r."stageRef" JOIN public.race_days pd ON pd.id=ps."raceDayId"
          WHERE ps."raceId"=s."raceId" AND ps."classKind"='stage' AND r.bib=sr.dorsal::text AND upper(r.irm) IN ('DNS','DNF','OTL','DSQ','ABD')
            AND ((pd."dateKey",COALESCE(pd."neutralStartTimeUtc",'-infinity'::timestamptz),pd.id) < (d."dateKey",COALESCE(d."neutralStartTimeUtc",'-infinity'::timestamptz),d.id)
              OR (s."classKind"='gc' AND pd.id=d.id)));
      IF row_total<>unique_total THEN expected_ids := NULL; END IF;
    END IF;
  END IF;
  SELECT jsonb_agg(identity ORDER BY identity),count(*),count(DISTINCT identity)
  INTO resolved_ids,row_total,unique_total FROM (
    SELECT CASE WHEN base_kind='team' THEN COALESCE(r."teamId",NULLIF(r.bib,'')) ELSE NULLIF(r.bib,'') END AS identity
    FROM public.race_uci_results r WHERE r."stageRef"=stage_ref
      AND (r.rank>0 OR upper(r.irm) IN ('DNS','DNF','OTL','DSQ','ABD'))
  ) rows;
  complete := expected_ids IS NOT NULL AND jsonb_array_length(expected_ids)>0
    AND row_total=unique_total AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(expected_ids) expected(id)
      WHERE NOT COALESCE(resolved_ids,'[]'::jsonb) ? expected.id);
  IF old.fingerprint=digest AND old.provider=source AND old."sourceFormat"=format AND sampled>old."observedAt" THEN stable := old."stableReads"+1; END IF;
  -- Tres adquisiciones distintas: dos intervalos reales del captador del proveedor.
  -- Sin conjunto esperado fiable, la inmovilidad nunca convierte en oficial.
  official := format IN ('uci','pdf') OR (observation->>'sourceStatus'='official' AND NOT progressive)
    OR (progressive AND stable>=3 AND complete AND COALESCE(observation->>'sourceStatus','') NOT IN ('provisional','incomplete'));
  INSERT INTO private.result_publication_state ("stageRef",provider,"sourceFormat",fingerprint,"stableReads","observedAt","changedAt","sourceModifiedAt",expected,resolved,complete,evidence)
  VALUES (stage_ref,source,format,digest,stable,sampled,CASE WHEN stable>1 THEN old."changedAt" ELSE sampled END,
    (observation->>'sourceModifiedAt')::timestamptz,expected_ids,resolved_ids,complete,observation)
  ON CONFLICT ("stageRef") DO UPDATE SET provider=EXCLUDED.provider,"sourceFormat"=EXCLUDED."sourceFormat",fingerprint=EXCLUDED.fingerprint,
    "stableReads"=EXCLUDED."stableReads","observedAt"=EXCLUDED."observedAt","changedAt"=EXCLUDED."changedAt",
    "sourceModifiedAt"=EXCLUDED."sourceModifiedAt",expected=EXCLUDED.expected,resolved=EXCLUDED.resolved,complete=EXCLUDED.complete,evidence=EXCLUDED.evidence;
  UPDATE public.race_uci_stages SET "publicationStatus"=CASE WHEN official THEN 'official' ELSE 'provisional' END,
    "lastSyncedAt"=now(),updating=progressive AND NOT official WHERE id=stage_ref;
  IF s."raceDayId" IS NOT NULL THEN
    PERFORM public.refresh_race_day_metrics(s."raceDayId");
  ELSIF EXISTS (SELECT 1 FROM public.races r WHERE r.id=s."raceId" AND r."raceFormat"='one_day') THEN
    FOR d IN SELECT * FROM public.race_days WHERE "raceId"=s."raceId" LOOP
      PERFORM public.refresh_race_day_metrics(d.id);
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_result_observation(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_result_observation(text,jsonb) TO cc_results_worker,authenticated;

ALTER TABLE public.race_days ADD CONSTRAINT time_limit_requires_basis CHECK
  ("timeLimitSeconds" IS NULL OR ("timeLimitBasis"->>'sourceUrl' IS NOT NULL AND "timeLimitBasis"->>'verifiedAt' IS NOT NULL));

-- No se atribuye oficialidad retrospectiva sin observación del origen efectivo.

-- Solo las columnas derivadas son editables por el trabajador.
GRANT USAGE ON SCHEMA private TO authenticated, cc_results_worker;
GRANT UPDATE ("raceTimeSeconds","averageSpeedKmh","timeLimitSeconds","timeLimitBasis","metricsUpdatedAt") ON public.race_days TO cc_results_worker;
CREATE POLICY day_metrics_worker ON public.race_days FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);

CREATE FUNCTION public.invalidate_result_observations(race_id text, source_provider text, stage_number integer DEFAULT NULL) RETURNS void
LANGUAGE sql SET search_path='' AS $$
  UPDATE private.result_publication_state p SET "stableReads"=0
  FROM public.race_uci_stages s WHERE p."stageRef"=s.id AND s."raceId"=race_id
    AND p.provider=source_provider AND p."sourceFormat"='progressive'
    AND (stage_number IS NULL OR s."stageNumber"=stage_number);
$$;
REVOKE ALL ON FUNCTION public.invalidate_result_observations(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invalidate_result_observations(text,text,integer) TO cc_results_worker,authenticated;

CREATE FUNCTION public.race_day_metrics_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM public.refresh_race_day_metrics(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.race_day_metrics_changed() FROM PUBLIC;
CREATE TRIGGER race_day_metrics_changed AFTER UPDATE OF "distanceKm","competitiveDistanceKm","timingPolicy","isCancelledDay","isRestDay" ON public.race_days
  FOR EACH ROW WHEN (OLD."distanceKm" IS DISTINCT FROM NEW."distanceKm" OR OLD."competitiveDistanceKm" IS DISTINCT FROM NEW."competitiveDistanceKm"
    OR OLD."timingPolicy" IS DISTINCT FROM NEW."timingPolicy" OR OLD."isCancelledDay" IS DISTINCT FROM NEW."isCancelledDay" OR OLD."isRestDay" IS DISTINCT FROM NEW."isRestDay")
  EXECUTE FUNCTION public.race_day_metrics_changed();
