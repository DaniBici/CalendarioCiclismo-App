-- Una CRE final de un día se valida por equipos, igual que una etapa CRE.
-- No contar sus líderes con rango como si fueran todos los dorsales inscritos.
DO $migration$
DECLARE
  original text := pg_get_functiondef('public.record_result_observation(text,jsonb)'::regprocedure);
  old_clause text := $old$base_kind := CASE WHEN s."classKind"='teams' OR (s."classKind"='stage' AND d."primaryType"='ttt') THEN 'team' ELSE 'bib' END;$old$;
  new_clause text := $new$base_kind := CASE WHEN s."classKind"='teams' OR (
    (s."classKind"='stage' OR (s."classKind"='gc' AND s."isFinalClassification"
      AND EXISTS (SELECT 1 FROM public.races r WHERE r.id=s."raceId" AND r."raceFormat"='one_day')))
    AND (d."primaryType"='ttt' OR s."raceType"='TTT')
  ) THEN 'team' ELSE 'bib' END;$new$;
BEGIN
  IF position(old_clause IN original)=0 THEN
    RAISE EXCEPTION 'La función de observaciones ha cambiado; revisar antes de sustituir';
  END IF;
  INSERT INTO private.repair_worlds_mixed_relay_20260922_backup(entity,row_key,row_data)
  VALUES ('function','public.record_result_observation(text,jsonb)',jsonb_build_object('definition',original))
  ON CONFLICT DO NOTHING;
  EXECUTE replace(original,old_clause,new_clause);
END
$migration$;
