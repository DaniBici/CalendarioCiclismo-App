-- Calibración por proveedor sin modificar las cadencias ni los timers.
CREATE TABLE private.result_provider_calibration (
  provider text PRIMARY KEY,
  "lastSampleAt" timestamptz,
  cadences jsonb NOT NULL DEFAULT '[]',
  corrections jsonb NOT NULL DEFAULT '[]',
  "windowSeconds" numeric
);
ALTER TABLE private.result_provider_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_worker ON private.result_provider_calibration FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY calibration_admin ON private.result_provider_calibration FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT,INSERT,UPDATE ON private.result_provider_calibration TO cc_results_worker,authenticated;

CREATE FUNCTION private.calibrate_result_window(source text,sampled timestamptz,cadence numeric,correction numeric) RETURNS numeric
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE state private.result_provider_calibration; cadence_p90 numeric; correction_p95 numeric;
BEGIN
  INSERT INTO private.result_provider_calibration(provider) VALUES(source) ON CONFLICT DO NOTHING;
  SELECT * INTO state FROM private.result_provider_calibration WHERE provider=source FOR UPDATE;
  -- Una descarga aporta varias clasificaciones: su intervalo se cuenta una vez.
  IF cadence>0 AND (state."lastSampleAt" IS NULL OR sampled>state."lastSampleAt") THEN
    state.cadences := state.cadences || jsonb_build_array(cadence);
    IF jsonb_array_length(state.cadences)>64 THEN state.cadences:=state.cadences-0; END IF;
    state."lastSampleAt":=sampled;
  END IF;
  -- Una corrección tardía amplía la ventana, aunque comparta descarga con otra clase.
  IF correction>0 THEN
    state.corrections := state.corrections || jsonb_build_array(correction);
    IF jsonb_array_length(state.corrections)>64 THEN state.corrections:=state.corrections-0; END IF;
  END IF;
  IF jsonb_array_length(state.cadences)>=2 THEN
    SELECT percentile_disc(0.9) WITHIN GROUP (ORDER BY value::numeric) INTO cadence_p90 FROM jsonb_array_elements_text(state.cadences);
    SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY value::numeric) INTO correction_p95 FROM jsonb_array_elements_text(state.corrections);
    state."windowSeconds":=greatest(2*cadence_p90,COALESCE(correction_p95,0));
  END IF;
  UPDATE private.result_provider_calibration SET "lastSampleAt"=state."lastSampleAt",cadences=state.cadences,
    corrections=state.corrections,"windowSeconds"=state."windowSeconds" WHERE provider=source;
  RETURN state."windowSeconds";
END;
$$;
REVOKE ALL ON FUNCTION private.calibrate_result_window(text,timestamptz,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.calibrate_result_window(text,timestamptz,numeric,numeric) TO cc_results_worker,authenticated;

-- Completitud por clase; una adquisición fallida interrumpe la estabilidad.
CREATE OR REPLACE FUNCTION public.record_result_observation(stage_ref text, observation jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  s public.race_uci_stages; old private.result_publication_state; d public.race_days;
  source text := observation->>'provider'; format text := observation->>'format';
  sampled timestamptz; digest text; expected_ids jsonb; resolved_ids jsonb;
  row_total integer; unique_total integer; complete boolean := false; stable integer := 1;
  progressive boolean; official boolean; base_kind text; earlier_missing boolean; window_seconds numeric;
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
  IF old.fingerprint=digest AND sampled <= old."observedAt"
    AND old.provider=source AND old."sourceFormat"=format
    AND (old.evidence-'observedAt')=(observation-'observedAt') THEN RETURN; END IF;
  progressive := source IN ('matsport','tissot','domtel','sts') AND format='progressive';
  SELECT * INTO d FROM public.race_days WHERE id=s."raceDayId";
  IF d.id IS NULL AND s."stageNumber" IS NULL THEN
    SELECT * INTO d FROM public.race_days WHERE "raceId"=s."raceId" AND NOT "isRestDay" AND NOT "isCancelledDay"
      ORDER BY "dateKey" DESC,"neutralStartTimeUtc" DESC NULLS LAST,id DESC LIMIT 1;
  END IF;
  -- isTeamEvent también marca las generales individuales de una CRE en UCI.
  base_kind := CASE WHEN s."classKind"='teams' OR (s."classKind"='stage' AND d."primaryType"='ttt') THEN 'team' ELSE 'bib' END;
  -- Una integración puede aportar un conjunto independiente acreditado; no se
  -- acepta el recuento bruto ni el conjunto de filas recibidas como denominador.
  IF observation->>'expectedVerified'='true' AND observation->>'expectedKind'=base_kind
      AND jsonb_typeof(observation->'expectedIds')='array' AND NULLIF(observation->>'expectedBasis','') IS NOT NULL THEN
    SELECT jsonb_agg(id ORDER BY id),count(*),count(DISTINCT id)
      INTO expected_ids,row_total,unique_total FROM jsonb_array_elements_text(observation->'expectedIds') ids(id);
    IF row_total<>unique_total OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(expected_ids) ids(id) WHERE NULLIF(trim(id),'') IS NULL) THEN expected_ids:=NULL; END IF;
  ELSIF d.id IS NOT NULL AND base_kind='bib' AND s."classKind" IN ('stage','gc') THEN
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
  IF old.fingerprint=digest AND old.provider=source AND old."sourceFormat"=format AND sampled>old."observedAt"
    AND old.expected IS NOT DISTINCT FROM expected_ids
    AND (old.evidence->>'sourceStatus') IS NOT DISTINCT FROM (observation->>'sourceStatus') THEN stable := old."stableReads"+1; END IF;
  IF progressive AND observation->>'observedAt' IS NOT NULL THEN
    window_seconds := private.calibrate_result_window(source,sampled,
      CASE WHEN old.provider=source AND old."stableReads">0 AND sampled>old."observedAt"
        THEN extract(epoch FROM sampled-old."observedAt") END,
      CASE WHEN old.provider=source AND old."stableReads">0 AND old.complete AND complete
        AND old.fingerprint<>digest AND sampled>old."changedAt"
        THEN extract(epoch FROM sampled-old."changedAt") END);
  END IF;
  -- La ventana depende de cadencias y correcciones reales del proveedor.
  -- Sin muestra suficiente o conjunto esperado fiable se conserva Provisional.
  official := COALESCE(observation->>'sourceStatus','') NOT IN ('provisional','incomplete') AND (format IN ('uci','pdf') OR (observation->>'sourceStatus'='official' AND NOT progressive)
    OR (progressive AND stable>=3 AND complete AND window_seconds IS NOT NULL
      AND extract(epoch FROM sampled-old."changedAt")>=window_seconds));
  INSERT INTO private.result_publication_state ("stageRef",provider,"sourceFormat",fingerprint,"stableReads","observedAt","changedAt","sourceModifiedAt",expected,resolved,complete,evidence)
  VALUES (stage_ref,source,format,digest,stable,sampled,CASE WHEN stable>1 THEN old."changedAt" ELSE sampled END,
    (observation->>'sourceModifiedAt')::timestamptz,expected_ids,resolved_ids,complete,observation)
  ON CONFLICT ("stageRef") DO UPDATE SET provider=EXCLUDED.provider,"sourceFormat"=EXCLUDED."sourceFormat",fingerprint=EXCLUDED.fingerprint,
    "stableReads"=EXCLUDED."stableReads","observedAt"=EXCLUDED."observedAt","changedAt"=EXCLUDED."changedAt",
    "sourceModifiedAt"=EXCLUDED."sourceModifiedAt",expected=EXCLUDED.expected,resolved=EXCLUDED.resolved,complete=EXCLUDED.complete,evidence=EXCLUDED.evidence;
  UPDATE public.race_uci_stages SET "publicationStatus"=CASE WHEN official THEN 'official' ELSE 'provisional' END,
    "lastSyncedAt"=now(),updating=progressive AND NOT official AND COALESCE(observation->>'sourceStatus','') NOT IN ('provisional','incomplete') WHERE id=stage_ref;
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


DROP TRIGGER race_day_metrics_changed ON public.race_days;
CREATE TRIGGER race_day_metrics_changed AFTER UPDATE OF "distanceKm","competitiveDistanceKm","timingPolicy","primaryType","isCancelledDay","isRestDay" ON public.race_days
  FOR EACH ROW WHEN (OLD."distanceKm" IS DISTINCT FROM NEW."distanceKm" OR OLD."competitiveDistanceKm" IS DISTINCT FROM NEW."competitiveDistanceKm"
    OR OLD."timingPolicy" IS DISTINCT FROM NEW."timingPolicy" OR OLD."primaryType" IS DISTINCT FROM NEW."primaryType"
    OR OLD."isCancelledDay" IS DISTINCT FROM NEW."isCancelledDay" OR OLD."isRestDay" IS DISTINCT FROM NEW."isRestDay")
  EXECUTE FUNCTION public.race_day_metrics_changed();
