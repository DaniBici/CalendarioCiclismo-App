-- Bonos por ronda de una general por tiempo (X2O Badkamers Trofee) sin reemplazar la
-- clasificación. A diferencia de cx_replace_results no toca el estado, la fuente, el
-- bloqueo ni la fecha de importación de la manga: el worker puede completar los bonos de
-- una categoría bloqueada sin cambiar sus resultados, y no sustituye los bonos que una
-- carga administrativa tomó de otra fuente. `p_bonuses` = {id de cx_results: segundos} con
-- todas las filas vigentes; si cambiaron desde la lectura devuelve 40001.

CREATE FUNCTION public.cx_apply_round_bonuses(p_race_id text, p_category text, p_bonuses jsonb, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE manga public.cx_race_categories; scheme_mode text; source_url text; previous jsonb; changed integer;
BEGIN
  IF current_user<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT * INTO manga FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manga CX no encontrada' USING ERRCODE='22023'; END IF;
  SELECT t."pointsScheme"#>>ARRAY['categories',p_category,'mode'] INTO scheme_mode FROM public.cx_races r
    JOIN public.cx_tournaments t ON t.id=r."tournamentId" WHERE r.id=p_race_id;
  source_url:=p_evidence->>'bonusSourceUrl';
  IF scheme_mode IS DISTINCT FROM 'time' OR coalesce(source_url,'') !~ '^https?://'
    OR jsonb_typeof(p_bonuses) IS DISTINCT FROM 'object' OR p_bonuses='{}'::jsonb THEN
    RAISE EXCEPTION 'General sin tiempo, fuente de bonos o bonos inválidos' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(p_bonuses) e
    WHERE e.value !~ '^[0-9]{1,2}$' OR e.value::integer>30 OR e.value::integer%5<>0) THEN
    RAISE EXCEPTION 'Bono incompatible con el sprint y la vuelta rápida' USING ERRCODE='22023';
  END IF;
  -- Otra fuente es una carga administrativa: el worker no la sustituye.
  IF current_user='cc_results_worker' AND manga."bonusSourceUrl" IS NOT NULL AND manga."bonusSourceUrl"<>source_url THEN
    RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'unchanged',true,'skipped','other_source');
  END IF;
  IF (SELECT count(*) FROM public.cx_results x WHERE x."raceId"=p_race_id AND x.category=p_category)
      <>(SELECT count(*) FROM jsonb_object_keys(p_bonuses))
    OR EXISTS(SELECT 1 FROM public.cx_results x WHERE x."raceId"=p_race_id AND x.category=p_category AND NOT p_bonuses ? x.id::text) THEN
    RAISE EXCEPTION 'La clasificación cambió desde la lectura' USING ERRCODE='40001';
  END IF;
  SELECT jsonb_object_agg(x.id::text,x."bonusSeconds") INTO previous
    FROM public.cx_results x WHERE x."raceId"=p_race_id AND x.category=p_category;
  UPDATE public.cx_results x SET "bonusSeconds"=(p_bonuses->>x.id::text)::integer
    WHERE x."raceId"=p_race_id AND x.category=p_category AND x."bonusSeconds" IS DISTINCT FROM (p_bonuses->>x.id::text)::integer;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 AND manga."bonusSourceUrl" IS NOT DISTINCT FROM source_url THEN
    RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'unchanged',true);
  END IF;
  UPDATE public.cx_race_categories SET "bonusSourceUrl"=source_url
    WHERE "raceId"=p_race_id AND category=p_category AND "bonusSourceUrl" IS DISTINCT FROM source_url;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('apply_round_bonuses',p_race_id,p_category,jsonb_build_object('bonusSourceUrl',manga."bonusSourceUrl",'bonuses',previous),
      jsonb_build_object('bonusSourceUrl',source_url,'bonuses',p_bonuses),p_evidence);
  RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'unchanged',false,'rows',changed);
END $function$;

REVOKE ALL ON FUNCTION public.cx_apply_round_bonuses(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cx_apply_round_bonuses(text,text,jsonb,jsonb) TO cc_results_worker,cc_agent;
