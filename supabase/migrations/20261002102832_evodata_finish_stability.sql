-- EvoData publica solo a los clasificados: no emite filas de abandono (DNF, DNS,
-- OTL, DSQ). El censo inicial de la carrera acredita a los inscritos, no que
-- cada uno deba figurar en el resultado, y bloqueaba indefinidamente el cierre
-- automático (Europeo sub-23 femenino 2026: 48 filas frente a 75 inscritos).
-- Como en Tissot, el censo inicial deja de bloquear; un censo diario
-- independiente con expectedVerified=true sigue bloqueando si faltan participantes.
CREATE OR REPLACE FUNCTION private.result_can_auto_finalize(stage_ref text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s public.race_uci_stages; p private.result_publication_state; d public.race_days;
BEGIN
  SELECT * INTO s FROM public.race_uci_stages WHERE id=stage_ref;
  IF NOT FOUND OR s."lockedAt" IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO p FROM private.result_publication_state WHERE "stageRef"=stage_ref;
  IF NOT FOUND OR NOT private.result_source_is_live(p.provider)
    OR p."sourceFormat"<>'progressive' OR p."stableReads"<3
    OR NULLIF(p.evidence->>'observedAt','') IS NULL
    OR p."observedAt"<p."changedAt"+interval '30 minutes' OR p."observedAt">now()
    OR (p.expected IS NOT NULL AND NOT p.complete
      AND NOT (p.provider IN ('tissot','evodata') AND p.evidence->>'expectedVerified' IS DISTINCT FROM 'true'))
    OR COALESCE(p.evidence->>'sourceStatus','') IN ('provisional','incomplete') THEN RETURN false; END IF;
  SELECT day.* INTO d FROM public.race_days day JOIN public.races race ON race.id=day."raceId"
  WHERE day."raceId"=s."raceId" AND NOT COALESCE(race."isCancelled",false)
    AND NOT day."isRestDay" AND NOT day."isCancelledDay"
    AND CASE WHEN s."raceDayId" IS NOT NULL THEN day.id=s."raceDayId"
      ELSE s."isFinalClassification" OR day."stageNumber" IS NOT DISTINCT FROM s."stageNumber" END
  ORDER BY day."dateKey" DESC,day."neutralStartTimeUtc" DESC NULLS LAST,day.id DESC LIMIT 1;
  -- Solo cuentan adquisiciones válidas posteriores a la meta prevista.
  IF d.id IS NULL OR d."estimatedFinishTimeUtc" IS NULL OR d."raceStatus"='running'
    OR p."observedAt"<d."estimatedFinishTimeUtc"+interval '30 minutes' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.race_uci_results r WHERE r."stageRef"=stage_ref
    AND r.rank=1 AND NULLIF(trim(r.irm),'') IS NULL) THEN RETURN false; END IF;
  RETURN p.fingerprint=private.result_fingerprint(stage_ref);
END;
$$;
REVOKE ALL ON FUNCTION private.result_can_auto_finalize(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.result_can_auto_finalize(text) TO cc_results_worker,authenticated;
