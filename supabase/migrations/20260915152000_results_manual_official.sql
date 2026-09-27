-- Oficialización manual por clasificación desde el panel (carretera).
--
-- publicationStatus ('provisional'|'official') es la señal visible en web y apps
-- y la recalcula record_result_observation en cada observación del cron. Sin un
-- ancla propia, una oficialización manual sería revertida por la siguiente
-- observación que no acredite oficialidad (p. ej. una corrección de fuente live).
-- "officialAt" es esa ancla: mientras no sea NULL, la observación nunca degrada
-- el cuadro a provisional. Su ciclo de vida replica lockedAt (migración 087):
-- nace y muere con la cabecera y solo lo cambia el interruptor del panel.
ALTER TABLE public.race_uci_stages ADD COLUMN "officialAt" timestamptz;

-- Los permisos de race_uci_stages son a nivel de tabla (authenticated,
-- cc_results_worker): la columna nueva los hereda sin GRANT adicional.

-- record_result_observation con el ancla respetada. Parte de la definición
-- vigente; solo cambian las dos escrituras de "publicationStatus".
CREATE OR REPLACE FUNCTION public.record_result_observation(stage_ref text, observation jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  s public.race_uci_stages; old private.result_publication_state; d public.race_days;
  source text := observation->>'provider'; format text := observation->>'format';
  sampled timestamptz; digest text; expected_ids jsonb; resolved_ids jsonb;
  row_total integer; unique_total integer; complete boolean := false; stable integer := 1;
  progressive boolean; official boolean; base_kind text; has_earlier_day boolean;
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
    -- El ancla manual prevalece también con el cuadro vacío.
    UPDATE public.race_uci_stages SET "publicationStatus"=CASE WHEN s."officialAt" IS NOT NULL THEN 'official' ELSE 'provisional' END,
      updating=false WHERE id=stage_ref;
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
    -- La lista inicial solo acredita el censo de la primera jornada. Después
    -- puede conservar abandonos que una fuente progresiva omite por completo.
    SELECT EXISTS (SELECT 1 FROM public.race_days prev WHERE prev."raceId"=s."raceId" AND NOT prev."isRestDay" AND NOT prev."isCancelledDay"
      AND (prev."dateKey",COALESCE(prev."neutralStartTimeUtc",'-infinity'::timestamptz),prev.id)
        < (d."dateKey",COALESCE(d."neutralStartTimeUtc",'-infinity'::timestamptz),d.id)) INTO has_earlier_day;
    IF NOT has_earlier_day AND EXISTS (SELECT 1 FROM public.races race WHERE race.id=s."raceId" AND race."startlistImportedAt" IS NOT NULL AND NOT COALESCE(race."startlistProvisional",false)) THEN
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
  -- El ancla manual oficializa y evita cualquier downgrade automático.
  UPDATE public.race_uci_stages SET "publicationStatus"=CASE WHEN s."officialAt" IS NOT NULL OR official THEN 'official' ELSE 'provisional' END,
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
