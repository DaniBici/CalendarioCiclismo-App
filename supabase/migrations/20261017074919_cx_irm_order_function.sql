-- Orden canónico de los IRM al final de una categoría de ciclocross:
--   0 clasificados (sin IRM, o con LAP y puesto)
--   1 LAP sin puesto (vuelta perdida)
--   2 DNF/ABD (no terminó)
--   3 DNS (no salió)
--   4 cualquier otro código
-- Dentro de un grupo de IRM, los corredores del mismo equipo (teamName) van juntos, con los
-- equipos por orden de primera aparición; el resto conserva el orden previo. Los clientes
-- ordenan por puesto y después por sortOrder, así que solo cambia la cola sin puesto.
CREATE OR REPLACE FUNCTION private.order_cx_irm_results(p_race_id text, p_category text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  -- (raceId, category, sortOrder) es UNIQUE y no diferible: las filas que cambian pasan
  -- primero a valores negativos y después a su posición final.
  WITH base AS (
    SELECT r.id, r."sortOrder",
      CASE
        WHEN r.irm IS NULL OR (r.irm = 'LAP' AND r.rank IS NOT NULL) THEN 0
        WHEN r.irm = 'LAP' THEN 1
        WHEN r.irm IN ('DNF','ABD') THEN 2
        WHEN r.irm = 'DNS' THEN 3
        ELSE 4
      END AS g,
      nullif(lower(btrim(r."teamName")), '') AS tk
    FROM public.cx_results r
    WHERE r."raceId" = p_race_id AND r.category = p_category
  ), keyed AS (
    SELECT *,
      CASE WHEN g = 0 OR tk IS NULL THEN "sortOrder"
           ELSE min("sortOrder") OVER (PARTITION BY g, tk) END AS tpos
    FROM base
  ), ranked AS (
    SELECT id, "sortOrder",
      (row_number() OVER (ORDER BY g, tpos, tk, "sortOrder", id) - 1)::integer AS new_order
    FROM keyed
  )
  UPDATE public.cx_results r
     SET "sortOrder" = -1 - x.new_order
  FROM ranked x
  WHERE r.id = x.id AND r."sortOrder" IS DISTINCT FROM x.new_order;

  UPDATE public.cx_results
     SET "sortOrder" = -1 - "sortOrder"
   WHERE "raceId" = p_race_id AND category = p_category AND "sortOrder" < 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION private.order_cx_irm_results(text, text) FROM PUBLIC, anon, authenticated;

-- cx_replace_results ordena los IRM tras insertar las filas, único camino de escritura de
-- cx_results (lo usan cx_ingest_results, el panel y los cargadores).
CREATE OR REPLACE FUNCTION public.cx_replace_results(p_race_id text, p_category text, p_rows jsonb, p_status text, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE previous jsonb; payload jsonb; row public.cx_results; mode text; n integer:=0; male boolean; category_lock timestamptz;
BEGIN
  IF current_user<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT "resultsLockedAt" INTO category_lock FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND OR p_status IS NULL OR p_status NOT IN ('pending','provisional','official') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR (p_status<>'pending' AND jsonb_array_length(p_rows)=0) OR coalesce(p_evidence->>'sourceUrl','') !~ '^https?://' THEN
    RAISE EXCEPTION 'Categoría, publicación, filas o fuente inválidos' USING ERRCODE='22023';
  END IF;
  IF current_user='cc_results_worker' AND category_lock IS NOT NULL THEN
    RAISE EXCEPTION 'Resultados bloqueados por revisión administrativa' USING ERRCODE='55000'; END IF;
  SELECT t."pointsScheme"#>>ARRAY['categories',p_category,'mode'] INTO mode FROM public.cx_races r
    JOIN public.cx_tournaments t ON t.id=r."tournamentId" WHERE r.id=p_race_id;
  male:=left(p_category,1)='M';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) v WHERE nullif(v->>'bib','') IS NOT NULL GROUP BY v->>'bib' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) v WHERE v->>'globalRiderId' IS NOT NULL GROUP BY v->>'globalRiderId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Dorsal o ficha duplicados' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder"),'[]') INTO previous
    FROM public.cx_results x WHERE "raceId"=p_race_id AND category=p_category;
  DELETE FROM public.cx_results WHERE "raceId"=p_race_id AND category=p_category;
  FOR payload IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row:=jsonb_populate_record(NULL::public.cx_results,payload);
    IF coalesce(btrim(row."riderDisplay"),'')='' OR (row."globalRiderId" IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
        UNION ALL SELECT 1 FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId")) THEN
      RAISE EXCEPTION 'Nombre vacío o ficha CX inválida' USING ERRCODE='22023';
    END IF;
    IF mode='points' AND row."bonusSeconds" IS NOT NULL OR mode='time' AND coalesce(row."bonusPoints",0)<>0 THEN
      RAISE EXCEPTION 'Bonificación en una unidad distinta del torneo' USING ERRCODE='22023';
    END IF;
    IF row."bonusSeconds" IS NOT NULL AND coalesce(p_evidence->>'bonusSourceUrl','') !~ '^https?://'
      OR coalesce(row."bonusPoints",0)<>0 AND (coalesce(p_evidence->>'adjustmentReason','')='' OR coalesce(p_evidence->>'adjustmentSourceUrl','') !~ '^https?://') THEN
      RAISE EXCEPTION 'Bono o ajuste sin evidencia oficial' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cx_results("raceId",category,rank,"rankText",bib,"riderDisplay","firstName","lastName","globalRiderId","teamName","isoCode2","timeText","gapText",points,"bonusPoints","timeSeconds","bonusSeconds",irm,"sortOrder")
      VALUES(p_race_id,p_category,row.rank,row."rankText",nullif(btrim(row.bib),''),row."riderDisplay",row."firstName",row."lastName",row."globalRiderId",row."teamName",row."isoCode2",row."timeText",row."gapText",row.points,coalesce(row."bonusPoints",0),row."timeSeconds",row."bonusSeconds",row.irm,n);
    n:=n+1;
  END LOOP;
  PERFORM private.order_cx_irm_results(p_race_id,p_category);
  UPDATE public.cx_race_categories SET "resultsStatus"=p_status,"resultsImportedAt"=now(),
    "winnerName"=(SELECT "riderDisplay" FROM public.cx_results WHERE "raceId"=p_race_id AND category=p_category AND rank=1 ORDER BY "sortOrder" LIMIT 1),
    "resultsEvidence"=jsonb_strip_nulls(jsonb_build_object(
      'rankScope',p_evidence->'rankScope','categoryClassificationSourceUrl',p_evidence->'categoryClassificationSourceUrl',
      'adjustmentSourceUrl',p_evidence->'adjustmentSourceUrl','adjustmentReason',p_evidence->'adjustmentReason')),
    "resultsSourceUrl"=p_evidence->>'sourceUrl',"bonusSourceUrl"=p_evidence->>'bonusSourceUrl' WHERE "raceId"=p_race_id AND category=p_category;
  UPDATE public.cx_race_categories SET "resultsInputDigest"=NULL,"resultsProvider"=coalesce(p_evidence->>'inputSource',
    CASE WHEN current_user='cc_results_worker' THEN 'dataride' ELSE 'manual' END) WHERE "raceId"=p_race_id AND category=p_category;
  IF current_user<>'cc_results_worker' THEN
    UPDATE public.cx_race_categories SET "resultsLockedAt"=CASE WHEN p_evidence->'lockAutomatic'='false'::jsonb THEN NULL ELSE now() END
      WHERE "raceId"=p_race_id AND category=p_category;
  END IF;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('replace_results',p_race_id,p_category,previous,jsonb_build_object('status',p_status,'rows',p_rows),p_evidence);
  RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'rows',n,'status',p_status,'mode',mode,'lockedAt',(SELECT "resultsLockedAt" FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category));
END $function$;
