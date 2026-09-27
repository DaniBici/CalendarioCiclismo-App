-- Cierre automático de cuadros live después de 30 minutos observados sin cambios.
CREATE FUNCTION private.result_source_is_live(source text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT lower(source) = ANY(ARRAY['tissot','matsport','raceresult','sts','livetiming','sportsoft',
    'timing.ee','evodata','infocity','aso','manual_timing','chronohr','maneffic','domtel']);
$$;
REVOKE ALL ON FUNCTION private.result_source_is_live(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.result_source_is_live(text) TO cc_results_worker,authenticated;

CREATE FUNCTION private.result_fingerprint(stage_ref text) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(r.bib,r."globalRiderId",r."riderDisplay",r."teamId",r.rank,r."rankText",r."timeText",r."gapText",r.points,r."uciPoints",r.irm,r."resultValue")
    ORDER BY r.bib NULLS LAST,r."globalRiderId" NULLS LAST,r."teamId" NULLS LAST,r."sortOrder")::text,''))
  FROM public.race_uci_results r WHERE r."stageRef"=stage_ref;
$$;
REVOKE ALL ON FUNCTION private.result_fingerprint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.result_fingerprint(text) TO cc_results_worker,authenticated;

CREATE FUNCTION private.result_can_auto_finalize(stage_ref text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s public.race_uci_stages; p private.result_publication_state; d public.race_days;
BEGIN
  SELECT * INTO s FROM public.race_uci_stages WHERE id=stage_ref;
  IF NOT FOUND OR s."lockedAt" IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO p FROM private.result_publication_state WHERE "stageRef"=stage_ref;
  IF NOT FOUND OR NOT private.result_source_is_live(p.provider)
    OR p."sourceFormat"<>'progressive' OR p."stableReads"<3
    OR p."observedAt"<p."changedAt"+interval '30 minutes' OR p."observedAt">now()
    OR (p.expected IS NOT NULL AND NOT p.complete)
    OR COALESCE(p.evidence->>'sourceStatus','') IN ('provisional','incomplete') THEN RETURN false; END IF;
  SELECT day.* INTO d FROM public.race_days day JOIN public.races race ON race.id=day."raceId"
  WHERE day."raceId"=s."raceId" AND NOT COALESCE(race."isCancelled",false)
    AND NOT day."isRestDay" AND NOT day."isCancelledDay"
    AND CASE WHEN s."raceDayId" IS NOT NULL THEN day.id=s."raceDayId"
      ELSE s."isFinalClassification" OR day."stageNumber" IS NOT DISTINCT FROM s."stageNumber" END
  ORDER BY day."dateKey" DESC,day."neutralStartTimeUtc" DESC NULLS LAST,day.id DESC LIMIT 1;
  -- El reloj no avanza por silencio del captador: manda la última lectura válida.
  IF d.id IS NULL OR d."estimatedFinishTimeUtc" IS NULL OR d."raceStatus"='running'
    OR p."observedAt"<d."estimatedFinishTimeUtc"+interval '30 minutes' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.race_uci_results r WHERE r."stageRef"=stage_ref
    AND r.rank=1 AND NULLIF(trim(r.irm),'') IS NULL) THEN RETURN false; END IF;
  -- Una edición posterior a la última descarga también invalida la inmovilidad.
  RETURN p.fingerprint=private.result_fingerprint(stage_ref);
END;
$$;
REVOKE ALL ON FUNCTION private.result_can_auto_finalize(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.result_can_auto_finalize(text) TO cc_results_worker,authenticated;

-- Reconocer el formato de fuentes conocidas conserva las lecturas ya registradas.
-- No crea observaciones ni convierte en oficiales los resultados sin historial.
UPDATE private.result_publication_state SET "sourceFormat"='progressive',
  evidence=jsonb_set(evidence,'{format}','"progressive"')
WHERE "sourceFormat"='unknown' AND private.result_source_is_live(provider);

CREATE OR REPLACE FUNCTION public.record_result_observation(stage_ref text, observation jsonb) RETURNS void
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
  SELECT count(*),private.result_fingerprint(stage_ref)
    INTO row_total,digest FROM public.race_uci_results WHERE "stageRef"=stage_ref;
  IF row_total=0 THEN
    UPDATE private.result_publication_state SET "stableReads"=0,complete=false WHERE "stageRef"=stage_ref;
    UPDATE public.race_uci_stages SET "publicationStatus"='provisional',updating=false WHERE id=stage_ref;
    RETURN;
  END IF;
  IF old.fingerprint=digest AND sampled <= old."observedAt"
    AND old.provider=source AND old."sourceFormat"=format
    AND (old.evidence-'observedAt')=(observation-'observedAt') THEN RETURN; END IF;
  progressive := private.result_source_is_live(source) AND format='progressive';
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
    AND sampled-old."observedAt"<=interval '10 minutes'
    AND (old.evidence->>'sourceStatus') IS NOT DISTINCT FROM (observation->>'sourceStatus') THEN stable := old."stableReads"+1; END IF;
  official := COALESCE(observation->>'sourceStatus','') NOT IN ('provisional','incomplete')
    AND (format IN ('uci','pdf') OR (observation->>'sourceStatus'='official' AND NOT progressive));
  INSERT INTO private.result_publication_state ("stageRef",provider,"sourceFormat",fingerprint,"stableReads","observedAt","changedAt","sourceModifiedAt",expected,resolved,complete,evidence)
  VALUES (stage_ref,source,format,digest,stable,sampled,CASE WHEN stable>1 THEN old."changedAt" ELSE sampled END,
    (observation->>'sourceModifiedAt')::timestamptz,expected_ids,resolved_ids,complete,observation)
  ON CONFLICT ("stageRef") DO UPDATE SET provider=EXCLUDED.provider,"sourceFormat"=EXCLUDED."sourceFormat",fingerprint=EXCLUDED.fingerprint,
    "stableReads"=EXCLUDED."stableReads","observedAt"=EXCLUDED."observedAt","changedAt"=EXCLUDED."changedAt",
    "sourceModifiedAt"=EXCLUDED."sourceModifiedAt",expected=EXCLUDED.expected,resolved=EXCLUDED.resolved,complete=EXCLUDED.complete,evidence=EXCLUDED.evidence;
  official := COALESCE(official,false) OR private.result_can_auto_finalize(stage_ref);
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


CREATE OR REPLACE FUNCTION public.expire_result_updating() RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE stage_ref text; affected integer := 0; expired integer;
BEGIN
  -- El cierre usa estabilidad ya observada, incluso tras terminar la ventana.
  -- Evita competir con un upsert que está sustituyendo las filas del cuadro.
  FOR stage_ref IN
    SELECT s.id FROM public.race_uci_stages s
    JOIN private.result_publication_state p ON p."stageRef"=s.id
    WHERE s."publicationStatus"='provisional' AND s."lockedAt" IS NULL
      AND p."stableReads">=3 AND p."sourceFormat"='progressive'
      AND p."observedAt">=p."changedAt"+interval '30 minutes'
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    IF private.result_can_auto_finalize(stage_ref) THEN
      UPDATE public.race_uci_stages SET "publicationStatus"='official',updating=false WHERE id=stage_ref;
      affected:=affected+1;
    END IF;
  END LOOP;
  UPDATE public.race_uci_stages SET updating=false
    WHERE updating AND ("updatingUntil" IS NULL OR "updatingUntil"<=now());
  GET DIAGNOSTICS expired=ROW_COUNT;
  RETURN affected+expired;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_result_updating() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_result_updating() TO cc_results_worker;
